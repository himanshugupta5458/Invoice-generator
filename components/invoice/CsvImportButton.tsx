"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
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
 *
 * The trigger and the result panel are separate pieces sharing one `useCsvImport`
 * state, because they belong in different places: the button sits with the other
 * item actions, while the result is a full-width panel under the items it just
 * changed. Bundled together they could only render as a stack wherever the
 * button happened to be, which is what made the feedback read as bolted on.
 */

/** Rows listed in full before collapsing into a "…and N more" line. */
const MAX_LISTED_ERRORS = 8;

/** Refuse absurd files before reading them into memory. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface CsvImportSummary {
  added: number;
  totalRows: number;
  errors: CsvRowError[];
  fileError?: string;
  fileName: string;
}

export interface CsvImportState {
  busy: boolean;
  summary: CsvImportSummary | null;
  dismiss: () => void;
  /** Parses a picked file and records what it did. */
  readFile: (file: File) => Promise<void>;
}

/**
 * Owns the file read and its result so a caller can place the two UI pieces
 * freely. Deliberately holds no ref — the hidden file input and the ref that
 * clicks it stay inside CsvImportButton, where they are created and used in the
 * same component.
 */
export function useCsvImport(
  onImport: (items: InvoiceItemFormValues[]) => void,
): CsvImportState {
  const [summary, setSummary] = useState<CsvImportSummary | null>(null);
  const [busy, setBusy] = useState(false);

  async function readFile(file: File) {
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

  return { busy, summary, readFile, dismiss: () => setSummary(null) };
}

export interface CsvImportButtonProps {
  state: CsvImportState;
  disabled?: boolean;
}

/** The trigger, plus the hidden file input it drives. */
export function CsvImportButton({ state, disabled }: CsvImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, readFile } = state;

  return (
    <>
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
          if (file) void readFile(file);
        }}
      />
      <Button
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon />
        {busy ? "Reading CSV…" : "Upload CSV"}
      </Button>
    </>
  );
}

/** What the import did, and what it refused — rendered wherever the caller wants it. */
export function CsvImportFeedback({ state }: { state: CsvImportState }) {
  const { summary } = state;
  if (!summary) return null;

  const failed = Boolean(summary.fileError) || summary.errors.length > 0;
  const listed = summary.errors.slice(0, MAX_LISTED_ERRORS);
  const hidden = summary.errors.length - listed.length;

  return (
    <div
      role={failed ? "alert" : "status"}
      className={
        failed
          ? "flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          : "flex items-start justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800"
      }
    >
      <div className="min-w-0">
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
              {summary.errors.length === 1 ? "row was" : "rows were"} not added:
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {listed.map((error) => (
                <li key={error.line}>
                  Row {error.line}: {error.messages.join("; ")}
                </li>
              ))}
            </ul>
            {hidden > 0 && <p className="mt-1">…and {hidden} more row(s).</p>}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={state.dismiss}
        aria-label="Dismiss import result"
        className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current motion-reduce:transition-none"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 10.5v-8M5 5.5 8 2.5l3 3M2.75 10.5v2a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}
