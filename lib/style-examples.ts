/**
 * Style examples — the item names a business actually uses (§16, v1.2).
 *
 * Optional, per-profile grounding for Quick Fill. A profile can carry a short
 * list of example item descriptions — "Kundan Necklace Set", "Antique Finish
 * Jhumka Pair" — and Quick Fill shows them to the model as a *style guide* so
 * the rows it drafts read like that business's own bill rather than like generic
 * English. Nothing about it is required: a profile without examples generates
 * exactly as it did before this module existed.
 *
 * This is deliberately NOT retrieval. There is no database, no embedding, no
 * vector store and no similarity search — the whole list is small enough to put
 * in the prompt verbatim, so it goes in the prompt verbatim. That keeps the
 * app's storage story (§7: localStorage, nothing else) intact.
 *
 * Pure: no React, no filesystem, no network. Two callers rely on that. The
 * settings form parses what the user pasted (or what came out of a PDF) as they
 * type, and the route re-parses whatever the browser sends it, because a value
 * that arrived over the wire has to be bounded on this side too.
 *
 * The parsing exists because of where the text comes from. Somebody teaching the
 * app their vocabulary will paste a column out of a real invoice, and that
 * column arrives with serial numbers, HSN codes, quantities, rates and a totals
 * row attached. Storing those verbatim would teach the model to write
 * "3 Kundan Necklace Set 71171990 2 4,500.00 9,000.00" as a product name, which
 * is worse than teaching it nothing.
 */

/** Examples kept on a profile. Enough to establish a voice, not a catalogue. */
export const MAX_STYLE_EXAMPLES = 20;

/**
 * Cap on one example. The same 80 characters Quick Fill's prompt allows for a
 * generated description — an example longer than the thing it is an example of
 * would be teaching the wrong lesson.
 */
export const MAX_STYLE_EXAMPLE_CHARS = 80;

/**
 * Cap on the list as a whole, so the prompt budget cannot be exhausted by twenty
 * maximum-length examples. Roughly 200 tokens' worth.
 */
export const MAX_STYLE_EXAMPLES_TOTAL_CHARS = 800;

/** Below this an "example" is an initial or a stray column, not a product. */
const MIN_STYLE_EXAMPLE_CHARS = 3;

/**
 * How much pasted or extracted text is looked at in one pass. A whole PDF's text
 * arrives here, and the parse is synchronous and runs on every keystroke in the
 * settings form.
 */
export const MAX_STYLE_SOURCE_CHARS = 20_000;

export interface StyleExamplesParse {
  /** What will be stored: cleaned, deduplicated, and inside every cap. */
  examples: string[];
  /** Lines that had text in them but nothing usable as a product name. */
  skipped: number;
  /** Usable examples left out because a cap was already full. */
  dropped: number;
}

/* ── Recognising the parts of a pasted invoice ─────────────────────────────── */

/** Columns, as text extraction leaves them: a tab, a run of spaces, or a pipe. */
const COLUMN_SPLIT = /\t|\s{2,}|\s*\|\s*/;

/** "1.", "12)", "-", "•" — the line's position in a list, not part of its name. */
const LEADING_MARKER = /^\s*(?:\d{1,3}\s*[.)\]:-]|[-*•·–—>])\s+/;

/** Punctuation that survives a column split but belongs to no product name. */
const EDGE_PUNCTUATION = /^[\s\-–—:;,.|*•·]+|[\s\-–—:;,.|*•·]+$/g;

/**
 * Words that only ever appear in an invoice's furniture — its column headings,
 * its totals band, its tax rows. A line made *entirely* of these is structure,
 * never an item.
 */
const TABLE_FURNITURE = new Set([
  "s", "sr", "sl", "no", "nos", "sno", "srno", "slno", "num", "number",
  "description", "desc", "particulars", "particular", "item", "items", "name",
  "product", "products", "goods", "service", "services", "hsn", "sac", "code",
  "qty", "quantity", "unit", "units", "uom", "rate", "price", "amount", "amt",
  "value", "taxable", "tax", "gst", "cgst", "sgst", "igst", "cess", "total",
  "subtotal", "sub", "grand", "net", "gross", "discount", "disc", "round",
  "off", "rounded", "invoice", "bill", "per", "and", "of", "in", "for", "rs",
  "inr", "rupees", "only", "e", "oe",
]);

/**
 * Lines that identify the *parties* rather than the goods: GSTINs, emails,
 * phone numbers, dates, bank rows. A pasted invoice is full of them and none of
 * them says anything about how this business names its products.
 */
const IDENTIFIER_PATTERNS = [
  /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2}\b/i, // GSTIN
  /[\w.+-]+@[\w-]+\.[\w.]{2,}/, // email
  /\bhttps?:\/\/|\bwww\./i,
  /\b(?:ifsc|a\/c|account\s*(?:no|number)|gstin|gst\s*no|pan\b|state\s*code|phone|mob(?:ile)?|contact|invoice\s*(?:no|date)|dated?\b|due\s*date|place\s*of\s*supply|terms|signature|authorised)/i,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/, // a date
];

/** "Rupees Forty Five Thousand Only" — the amount in words, not an item. */
const AMOUNT_IN_WORDS = /^(?:rupees|inr|amount\s+in\s+words)\b|\bonly\s*[.]?$/i;

/** Units, which are stripped only when they trail a figure ("2 nos", "6 mtr"). */
const UNIT_WORDS = new Set([
  "no", "nos", "pc", "pcs", "piece", "pieces", "unit", "units", "kg", "kgs",
  "gm", "gms", "gram", "grams", "mtr", "mtrs", "metre", "metres", "meter",
  "meters", "ltr", "ltrs", "litre", "litres", "box", "boxes", "pkt", "pkts",
  "packet", "packets", "set", "sets", "pair", "pairs", "pr", "prs", "dozen",
  "qty", "each", "rs", "inr",
]);

/** 4,500 · ₹9,000.00 · 1200/- · 18% · 71171990 — a figure, never a name. */
function isFigureToken(token: string): boolean {
  return /^(?:rs\.?|inr|[₹$])?\d[\d,]*(?:\.\d+)?(?:%|\/-)?[.,]?$/i.test(token);
}

function isUnitToken(token: string): boolean {
  return UNIT_WORDS.has(token.toLowerCase().replace(/[.,]+$/, ""));
}

/** A plain small integer, which in a product name is usually a size or a model. */
function isBareInteger(token: string): boolean {
  return /^\d{1,3}$/.test(token);
}

/**
 * Drop the figures a table row trails behind its description.
 *
 * Scanned right to left, because that is the only end where a figure is
 * reliably data rather than name: "Kundan Necklace Set 2 nos 4,500 9,000" is a
 * row, "Kundan Necklace Set" is the name inside it. A unit word is taken only
 * when a figure sits immediately to its left ("2 nos"), which is what stops the
 * "Set" in "Necklace Set" from being read as one.
 *
 * A single bare integer is kept: "Cotton Shirt 42" and "Bearing 6204" are names
 * with a number in them far more often than they are rows with one column.
 */
function stripTrailingFigures(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  let end = tokens.length;
  let figures = 0;

  while (end > 0) {
    const token = tokens[end - 1];
    if (isFigureToken(token)) {
      figures += 1;
      end -= 1;
      continue;
    }
    if (isUnitToken(token) && end > 1 && isFigureToken(tokens[end - 2])) {
      end -= 1;
      continue;
    }
    break;
  }

  if (end === tokens.length) return text;
  // Nothing but figures — there is no name in this line to save.
  if (end === 0) return "";
  if (figures === 1 && isBareInteger(tokens[tokens.length - 1])) return text;

  return tokens.slice(0, end).join(" ");
}

/** Two letters is the least a product name can be made of. */
function hasName(text: string): boolean {
  return (text.match(/[a-z]/gi)?.length ?? 0) >= 2;
}

function isFurniture(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length === 0) return true; // figures and punctuation only
  return words.every((word) => TABLE_FURNITURE.has(word));
}

/**
 * One line of pasted text, reduced to the product name inside it — or nothing,
 * when there was no product name in it to begin with.
 */
export function cleanStyleExample(line: string): string | undefined {
  // Control characters and non-breaking spaces come along with PDF text.
  const flattened = line
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replace(/[\u00a0\u2007\u202f]/g, " ");

  if (IDENTIFIER_PATTERNS.some((pattern) => pattern.test(flattened))) {
    return undefined;
  }
  if (AMOUNT_IN_WORDS.test(flattened.trim())) return undefined;

  const withoutMarker = flattened.replace(LEADING_MARKER, "");

  // The description is the first column that reads like a name; everything to
  // its right is HSN, quantity, rate and amount.
  const column =
    withoutMarker
      .split(COLUMN_SPLIT)
      .map((part) => part.trim())
      .find((part) => hasName(part) && !isFurniture(part)) ?? "";

  const named = stripTrailingFigures(column.replace(/\s+/g, " ").trim())
    .replace(EDGE_PUNCTUATION, "")
    .trim();

  if (named.length < MIN_STYLE_EXAMPLE_CHARS) return undefined;
  if (!hasName(named) || isFurniture(named)) return undefined;

  return truncateExample(named);
}

/** Cut to the cap at a word boundary — a name, not an ellipsis. */
function truncateExample(text: string): string {
  if (text.length <= MAX_STYLE_EXAMPLE_CHARS) return text;
  const clipped = text.slice(0, MAX_STYLE_EXAMPLE_CHARS);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > MIN_STYLE_EXAMPLE_CHARS ? clipped.slice(0, lastSpace) : clipped)
    .replace(EDGE_PUNCTUATION, "")
    .trim();
}

/* ── Finding the items table inside a whole invoice ────────────────────────── */

/** The row above the items: "Sr Description HSN Qty Rate Amount". */
function isItemsTableHeader(line: string): boolean {
  const text = line.toLowerCase();
  const namesTheColumn = /\b(?:description|particulars?|item\s*name|goods)\b/.test(
    text,
  );
  const namesAFigure = /\b(?:qty|quantity|rate|amount|hsn|sac|price|value)\b/.test(
    text,
  );
  return namesTheColumn && namesAFigure;
}

/** The row below them: where the totals band starts. */
function isTotalsLine(line: string): boolean {
  const text = line.toLowerCase();
  return (
    /\b(?:sub\s*total|grand\s*total|total\s*amount|invoice\s*total|taxable\s*value|amount\s*in\s*words|round(?:ed)?\s*off)\b/.test(
      text,
    ) ||
    /\b(?:cgst|sgst|igst)\b/.test(text) ||
    /^\s*totals?\b/.test(text)
  );
}

/**
 * Narrow a whole pasted invoice down to its item rows.
 *
 * Only when the paste actually looks like an invoice: a header row is required
 * before anything is cut, so somebody pasting a bare list of product names — the
 * other half of what this feature accepts — keeps every line they pasted.
 */
function sliceItemsTable(lines: string[]): string[] {
  const start = lines.findIndex(isItemsTableHeader);
  if (start === -1) return lines;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex(isTotalsLine);
  const rows = end === -1 ? rest : rest.slice(0, end);
  // A header with nothing under it means the guess was wrong, not that the
  // invoice was empty — fall back to reading the lot.
  return rows.some((line) => line.trim() !== "") ? rows : lines;
}

/* ── The parse itself ──────────────────────────────────────────────────────── */

/**
 * Turn cleaned candidates into the stored list: deduplicated, then capped by
 * count and by total length. Extras are counted rather than dropped silently —
 * the settings form says how many did not fit.
 */
function collect(candidates: string[], skipped: number): StyleExamplesParse {
  const examples: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  let dropped = 0;

  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (
      examples.length >= MAX_STYLE_EXAMPLES ||
      total + candidate.length > MAX_STYLE_EXAMPLES_TOTAL_CHARS
    ) {
      dropped += 1;
      continue;
    }

    examples.push(candidate);
    total += candidate.length;
  }

  return { examples, skipped, dropped };
}

function parseLines(lines: string[]): StyleExamplesParse {
  const candidates: string[] = [];
  let skipped = 0;

  for (const line of sliceItemsTable(lines)) {
    if (line.trim() === "") continue;
    const cleaned = cleanStyleExample(line);
    if (cleaned) candidates.push(cleaned);
    else skipped += 1;
  }

  return collect(candidates, skipped);
}

/**
 * Parse pasted text (or a PDF's extracted text) into storable examples.
 *
 * One example per line, which is how both an invoice's item column and a typed
 * list arrive. A single line with commas in it is split on those instead, so
 * "kundan necklace, jhumka, bangles" works as typed — but only when there are no
 * line breaks at all, because a comma inside a line of a list is part of the
 * name ("Cotton shirt, full sleeve").
 */
export function parseStyleExamples(source: string): StyleExamplesParse {
  const text = source.slice(0, MAX_STYLE_SOURCE_CHARS);
  const lines = text.includes("\n")
    ? text.split(/\r?\n/)
    : text.split(/[,;]/);
  return parseLines(lines);
}

/**
 * Bound a list that arrived from somewhere untrusted — a request body, or a
 * profile restored from a backup file.
 *
 * Same cleaner, same caps, applied line by line so a single entry cannot smuggle
 * twenty in on newlines. Anything that is not a list of strings — including a
 * bare string, which is the shape the *form* deals in and never the shape stored
 * or sent — is no examples at all, never an error: this is an optional extra,
 * and a malformed one simply means Quick Fill generates the way it always did.
 * Use `parseStyleExamples` for text somebody typed.
 */
export function sanitiseStyleExamples(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const lines = value
    .filter((entry): entry is string => typeof entry === "string")
    // Bounded before any work is done, so a 10,000-entry array is cheap to
    // refuse. Generous against MAX_STYLE_EXAMPLES because entries may be
    // rejected on the way through.
    .slice(0, MAX_STYLE_EXAMPLES * 5)
    .flatMap((entry) => entry.split(/\r?\n/));

  return parseLines(lines).examples;
}

/** The stored list, back as textarea text. */
export function formatStyleExamples(examples: readonly string[] | undefined): string {
  return (examples ?? []).join("\n");
}
