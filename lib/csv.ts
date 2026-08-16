/**
 * CSV bulk upload for invoice items (spec §4). Pure — no React, no DOM, no
 * network, and no CSV library: the format is small enough to tokenise here, and
 * §2 says not to add dependencies for v1.
 *
 * Two rules shape everything below:
 *
 *  1. NOTHING IS SILENTLY DROPPED. A row that fails validation comes back in
 *     `errors` with its line number and the reason, so the user can see exactly
 *     which line of their spreadsheet was refused and why. Valid rows in the
 *     same file are still imported — one bad row does not sink the file.
 *  2. THE SAME SCHEMA. Rows are validated with `invoiceItemFormSchema`, the very
 *     schema the items table uses, so a CSV can never introduce an item the form
 *     itself would reject (an off-slab GST rate, a missing description).
 */

import type { InvoiceItemFormValues } from "./validation";
import { invoiceItemFormSchema } from "./validation";

/** One physical row of the file, with the line number a spreadsheet would show. */
export interface CsvRow {
  /** 1-based line number in the file, counting the header row. */
  line: number;
  cells: string[];
}

export interface CsvRowError {
  line: number;
  /** Human-readable reasons, e.g. "GST rate: GST rate must be one of ...". */
  messages: string[];
}

export interface CsvImportResult {
  /** Rows that passed validation, ready to append to the items field array. */
  items: InvoiceItemFormValues[];
  /** Rows that failed, with their line number and reasons. Never truncated. */
  errors: CsvRowError[];
  /** Data rows found in the file (header excluded), valid or not. */
  totalRows: number;
  /**
   * Set when the file could not be read as an items CSV at all — empty, no
   * header, or too big. `items` and `errors` are empty when this is set.
   */
  fileError?: string;
}

/**
 * Upper bound on rows accepted in one go. This is a refusal, not a truncation:
 * over the limit nothing is imported and the user is told the count, rather than
 * quietly getting the first 500 items of a 2,000-row file.
 */
export const MAX_CSV_ROWS = 500;

/** The header the docs and the UI hint quote, in InvoiceItem order. */
export const CSV_TEMPLATE_HEADER = "description,hsn,quantity,rate,gstRate";

type ColumnKey = "description" | "hsn" | "quantity" | "rate" | "gstRate";

/**
 * Accepted header spellings per column, already normalised (lowercased, all
 * non-alphanumerics stripped) — so "HSN/SAC", "hsn sac" and "HSN-SAC" all
 * arrive here as "hsnsac".
 */
const COLUMN_ALIASES: Record<ColumnKey, string[]> = {
  description: [
    "description",
    "desc",
    "item",
    "itemname",
    "particulars",
    "product",
    "productname",
    "details",
  ],
  hsn: ["hsn", "sac", "hsnsac", "sachsn", "hsncode", "hsnsaccode"],
  quantity: ["quantity", "qty", "qtynos", "units", "unit", "nos", "count"],
  rate: [
    "rate",
    "price",
    "unitrate",
    "unitprice",
    "rateperunit",
    "priceperunit",
    "rateperunitpretax",
  ],
  gstRate: [
    "gstrate",
    "gst",
    "gstpercent",
    "gstpercentage",
    "gsttax",
    "tax",
    "taxrate",
  ],
};

/** Labels used when reporting which field of a row was refused. */
const COLUMN_LABELS: Record<ColumnKey, string> = {
  description: "Description",
  hsn: "HSN/SAC",
  quantity: "Quantity",
  rate: "Rate",
  gstRate: "GST rate",
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Tokenise CSV text into rows.
 *
 * Handles what a real export actually contains: a UTF-8 BOM from Excel, quoted
 * fields with embedded commas, doubled quotes as an escaped quote, embedded
 * newlines inside quotes, and CRLF / CR / LF line endings. Entirely blank lines
 * are skipped so a trailing newline does not become a phantom row.
 */
export function parseCsvRows(text: string): CsvRow[] {
  // A UTF-8 BOM is what Excel writes at the head of a UTF-8 export; left in place
  // it would make the first header cell unmatchable.
  const source = (typeof text === "string" ? text : "").replace(/^\uFEFF/, "");
  const rows: CsvRow[] = [];

  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let rowStarted = false;

  function endRow(): void {
    cells.push(field);
    field = "";
    if (cells.some((cell) => cell.trim() !== "")) {
      rows.push({ line: rowLine, cells });
    }
    cells = [];
    rowStarted = false;
  }

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (!rowStarted) {
      rowLine = line;
      rowStarted = true;
    }

    if (inQuotes) {
      if (char === '"') {
        // "" inside a quoted field is a literal quote.
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }

    // A quote only opens a quoted field at the start of one; mid-field it is a
    // literal, so a description like `5" pipe` survives intact.
    if (char === '"' && field === "") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      cells.push(field);
      field = "";
      continue;
    }

    if (char === "\r" || char === "\n") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      endRow();
      line += 1;
      continue;
    }

    field += char;
  }

  // A file that does not end in a newline still has one last row in hand.
  if (rowStarted || field !== "" || cells.length > 0) endRow();

  return rows;
}

/**
 * Numbers as spreadsheets write them: "1,250.00", "₹1250", "18%", " 12 ".
 * Anything left unparseable becomes NaN, which the schema then reports with its
 * own message ("Enter a quantity") rather than a parser-specific one.
 */
function toNumber(raw: string | undefined): number {
  if (raw === undefined) return Number.NaN;
  const cleaned = raw.replace(/[₹,\s%]/g, "");
  if (cleaned === "") return Number.NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Map each column key to the index of the header cell that matched it. */
function mapHeader(cells: string[]): Partial<Record<ColumnKey, number>> {
  const found: Partial<Record<ColumnKey, number>> = {};

  cells.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES) as [
      ColumnKey,
      string[],
    ][]) {
      // First matching header wins, so a duplicated column is ignored rather
      // than overwriting the one already found.
      if (found[key] === undefined && aliases.includes(normalized)) {
        found[key] = index;
        return;
      }
    }
  });

  return found;
}

/**
 * Parse a CSV file into invoice items (§4).
 *
 * Column order is irrelevant, header spelling is forgiving, and `hsn` may be
 * missing entirely since it is optional. Only `description` is structurally
 * required: without it there is nothing to match rows against, so the file is
 * rejected as a whole rather than producing one error per row.
 */
export function parseInvoiceItemsCsv(text: string): CsvImportResult {
  const empty: CsvImportResult = { items: [], errors: [], totalRows: 0 };

  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return { ...empty, fileError: "That file is empty." };
  }

  const [header, ...dataRows] = rows;
  const columns = mapHeader(header.cells);

  if (columns.description === undefined) {
    return {
      ...empty,
      fileError:
        `Could not find a "description" column in the first row. ` +
        `Expected a header like: ${CSV_TEMPLATE_HEADER}`,
    };
  }

  if (dataRows.length === 0) {
    return { ...empty, fileError: "That file has a header row but no items." };
  }

  if (dataRows.length > MAX_CSV_ROWS) {
    return {
      ...empty,
      fileError: `That file has ${dataRows.length} rows — import at most ${MAX_CSV_ROWS} at a time.`,
    };
  }

  const items: InvoiceItemFormValues[] = [];
  const errors: CsvRowError[] = [];

  for (const row of dataRows) {
    const cellAt = (key: ColumnKey): string | undefined => {
      const index = columns[key];
      return index === undefined ? undefined : row.cells[index];
    };

    const candidate = {
      description: cellAt("description") ?? "",
      // Left undefined when the column is absent — hsn is optional (§4).
      hsn: cellAt("hsn"),
      quantity: toNumber(cellAt("quantity")),
      rate: toNumber(cellAt("rate")),
      gstRate: toNumber(cellAt("gstRate")),
    };

    const parsed = invoiceItemFormSchema.safeParse(candidate);
    if (parsed.success) {
      items.push(parsed.data);
      continue;
    }

    errors.push({
      line: row.line,
      messages: parsed.error.issues.map((issue) => {
        const key = issue.path[0] as ColumnKey | undefined;
        const label = key ? COLUMN_LABELS[key] : undefined;
        return label ? `${label}: ${issue.message}` : issue.message;
      }),
    });
  }

  return { items, errors, totalRows: dataRows.length };
}
