"use client";

import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { parseInvoiceItemsCsv, type CsvRowError } from "@/lib/csv";
import type { InvoiceItemFormValues } from "@/lib/validation";

/**
 * Bulk-add items from a CSV (§4).
 *
 * The file never leaves the browser: `File.text()` reads it, `lib/csv.ts` parses
 * and validates it, and the caller appends what came back. There is no upload,
 * no server route, and no CSV dependency.
 *
 * The rule this component exists to honour is that a partly-bad file is still
 * useful: valid rows are handed over, and every rejected row is listed with its
 * line number and reason instead of disappearing.
 */

/** Rows listed in full before collapsing into a "…and N more" line. */
const MAX_LISTED_ERRORS = 8;

/** Refuse absurd files before reading them into memory. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface CsvImportButtonProps {
  /** Called with the valid rows only; never called with an empty array. */
  onImport: (items: InvoiceItemFormValues[]) => void;
  /** Static help shown under the button, above any import summary. */
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

interface Summary {
  added: number;
  totalRows: number;
  errors: CsvRowError[];
  fileError?: string;
  fileName: string;
}

export function CsvImportButton({
  onImport,
  hint,
  disabled,
  className,
}: CsvImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      if (file.size > MAX_FILE_BYTES) {
        setSummary({
          added: 0,
          totalRows: 0,
          errors: [],
          fileError: "That file is larger than 2 MB.",
          fileName: file.name,
        });
        return;
      }

      // A user can pick any file through "All files"; a PDF or an image reaches
      // text() as mojibake, which the parser then rejects as "no description
      // column" rather than throwing. The try/catch covers a read that fails
      // outright (a file deleted between picking and reading).
      const result = parseInvoiceItemsCsv(await file.text());

      if (result.items.length > 0) onImport(result.items);

      setSummary({
        added: result.items.length,
        totalRows: result.totalRows,
        errors: result.errors,
        fileError: result.fileError,
        fileName: file.name,
      });
    } catch (cause) {
      console.error("CSV import failed", cause);
      setSummary({
        added: 0,
        totalRows: 0,
        errors: [],
        fileError: "That file could not be read.",
        fileName: file.name,
      });
    } finally {
      setBusy(false);
    }
  }

  const failed = summary
    ? Boolean(summary.fileError) || summary.errors.length > 0
    : false;
  const listed = summary?.errors.slice(0, MAX_LISTED_ERRORS) ?? [];
  const hidden = (summary?.errors.length ?? 0) - listed.length;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="Items CSV file"
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared immediately so picking the same file twice still fires a
          // change event — otherwise a corrected re-upload does nothing.
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />

      <Button
        // self-start so the button stays its natural size while the hint and
        // summary below it stretch to the column's full width.
        className="self-start"
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Reading CSV…" : "Upload CSV"}
      </Button>

      {hint && <p className="text-xs text-stone-500">{hint}</p>}

      {summary && (
        <div
          role={failed ? "alert" : "status"}
          className={
            failed
              ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              : "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800"
          }
        >
          {summary.fileError ? (
            <p>
              <span className="font-medium">{summary.fileName}</span> —{" "}
              {summary.fileError}
            </p>
          ) : (
            <p>
              Added {summary.added} of {summary.totalRows}{" "}
              {summary.totalRows === 1 ? "row" : "rows"} from{" "}
              <span className="font-medium">{summary.fileName}</span>.
            </p>
          )}

          {listed.length > 0 && (
            <>
              <p className="mt-1.5 font-medium">
                {summary.errors.length}{" "}
                {summary.errors.length === 1 ? "row was" : "rows were"} not
                added:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {listed.map((error) => (
                  <li key={error.line}>
                    Row {error.line}: {error.messages.join("; ")}
                  </li>
                ))}
              </ul>
              {hidden > 0 && (
                <p className="mt-1">…and {hidden} more row(s).</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
