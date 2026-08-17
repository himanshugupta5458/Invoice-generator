"use client";

import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/Card";
import { TextArea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { PdfTextError, extractPdfText } from "@/lib/pdf-text";
import {
  MAX_STYLE_EXAMPLES,
  formatStyleExamples,
  parseStyleExamples,
} from "@/lib/style-examples";

/**
 * "Teach Quick Fill your product style" — the optional half of the profile form
 * (§16, v1.2).
 *
 * It is collapsed by default and it says "optional" in its own heading, because
 * it is the one section of this form nobody has to fill in: a profile without
 * examples generates exactly as it did before this existed. A required-looking
 * step between somebody and their first invoice would be a worse feature than no
 * feature.
 *
 * Two ways in, and the paste box is the one that always works. A sample invoice
 * is read in this tab with pdf.js and never uploaded, but a PDF can be a scan,
 * or encrypted, or laid out in a way no heuristic reads correctly — so every
 * failure here ends by pointing at the textarea rather than at a support page.
 *
 * What is stored is not what is typed: `parseStyleExamples` strips the serial
 * numbers, HSN codes and rates that come attached to a pasted invoice row, and
 * the preview under the box shows the result, because a user who cannot see what
 * was kept cannot tell whether it was worth doing.
 */

/** Examples listed under the box before the list collapses into a count. */
const MAX_PREVIEWED = 8;

export interface StyleExamplesFieldProps {
  /** The textarea's text — one example per line. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function StyleExamplesField({
  value,
  onChange,
  disabled = false,
}: StyleExamplesFieldProps) {
  // Open when there is something in it, so editing a profile that already has
  // examples does not hide them behind a disclosure the user has to find.
  const [open, setOpen] = useState(() => value.trim() !== "");
  const [reading, setReading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseStyleExamples(value), [value]);
  const remaining = MAX_STYLE_EXAMPLES - parsed.examples.length;

  async function handlePdf(file: File | undefined) {
    setPdfError(null);
    setPdfNotice(null);
    if (!file) return;

    setReading(true);
    try {
      const text = await extractPdfText(file);
      const found = parseStyleExamples(text);

      if (found.examples.length === 0) {
        setPdfError(
          "That PDF was read, but nothing in it looked like an item name. Paste a few lines below instead.",
        );
        return;
      }

      // Appended, never replacing: a second invoice adds to the vocabulary
      // rather than wiping what the first one taught. Duplicates fall out in the
      // parse, so appending the same file twice changes nothing.
      const merged = [value.trim(), formatStyleExamples(found.examples)]
        .filter(Boolean)
        .join("\n");
      onChange(merged);
      setPdfNotice(
        `Found ${found.examples.length} item ${found.examples.length === 1 ? "name" : "names"} in that PDF. Check them below and delete anything that reads wrong.`,
      );
    } catch (cause) {
      setPdfError(
        cause instanceof PdfTextError
          ? cause.message
          : "That PDF could not be read. Paste a few item lines below instead.",
      );
    } finally {
      setReading(false);
      // Clear the input so re-picking the same file fires `change` again.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const busy = disabled || reading;

  return (
    <SectionCard
      title="Teach Quick Fill your product style (optional)"
      description="Show Quick Fill how this business names its products, and the rows it drafts will use that vocabulary instead of generic English."
      actions={
        <div className="flex items-center gap-2">
          {parsed.examples.length > 0 && (
            <span className="text-xs font-medium text-ink-500 tabular-nums">
              {parsed.examples.length}{" "}
              {parsed.examples.length === 1 ? "example" : "examples"}
            </span>
          )}
          <Button
            size="sm"
            onClick={() => setOpen((shown) => !shown)}
            aria-expanded={open}
            aria-controls={BODY_ID}
          >
            {open ? "Hide" : parsed.examples.length > 0 ? "Edit" : "Add examples"}
          </Button>
        </div>
      }
    >
      {open ? (
        <div id={BODY_ID} className="flex flex-col gap-4">
          {parsed.examples.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-300 bg-ink-50/60 px-4 py-3.5">
              <p className="text-[0.8125rem] font-medium leading-5 text-ink-800">
                Quick Fill does not know your vocabulary yet.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                Left to itself it writes &ldquo;Gold Necklace&rdquo; and
                &ldquo;Wooden Table&rdquo;. Paste a few item lines from one of
                your own invoices — &ldquo;Kundan Necklace Set&rdquo;,
                &ldquo;Antique Finish Jhumka Pair&rdquo; — or upload a sample
                invoice and the names will be pulled out of it. Up to{" "}
                {MAX_STYLE_EXAMPLES}, and they only affect this business profile.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={TEXTAREA_ID}
              className="text-[0.8125rem] font-medium leading-5 text-ink-700"
            >
              Example item descriptions
            </label>
            <TextArea
              id={TEXTAREA_ID}
              rows={6}
              disabled={busy}
              spellCheck={false}
              placeholder={"Kundan Necklace Set\nAntique Finish Jhumka Pair\nOxidised Silver Anklet"}
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
            <p className="text-xs leading-relaxed text-ink-500">
              One per line. Serial numbers, HSN codes and rates pasted along with
              them are stripped out, so a whole invoice row can go in as it comes.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={FILE_ID}
              className="text-[0.8125rem] font-medium leading-5 text-ink-700"
            >
              Or read them from a sample invoice{" "}
              <span className="font-normal text-ink-400">(PDF)</span>
            </label>
            <input
              id={FILE_ID}
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy}
              onChange={(event) => void handlePdf(event.target.files?.[0])}
              className="focus-ring rounded-lg text-sm text-ink-600 file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border file:border-ink-300 file:bg-white file:px-3 file:text-sm file:font-medium file:text-ink-800 hover:file:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="text-xs leading-relaxed text-ink-500">
              Text-based PDFs only — a scan has no text to read. The file is read
              in your browser and never uploaded; only the names you keep are
              saved.
            </p>
          </div>

          {reading && (
            <Notice tone="info" size="sm" role="status">
              Reading that PDF…
            </Notice>
          )}

          {pdfError && (
            <Notice tone="warning" size="sm" role="alert">
              {pdfError}
            </Notice>
          )}

          {pdfNotice && !pdfError && (
            <Notice tone="success" size="sm">
              {pdfNotice}
            </Notice>
          )}

          {parsed.examples.length > 0 && (
            <div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3.5 py-3">
              <p className="text-xs font-semibold text-ink-700">
                What will be saved
                <span className="ml-1.5 font-normal text-ink-500 tabular-nums">
                  {parsed.examples.length} of {MAX_STYLE_EXAMPLES}
                  {remaining > 0 ? ` — ${remaining} more allowed` : " — full"}
                </span>
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {parsed.examples.slice(0, MAX_PREVIEWED).map((example) => (
                  <li
                    key={example}
                    className="inline-flex items-center rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-ink-700 ring-1 ring-inset ring-black/5"
                  >
                    {example}
                  </li>
                ))}
                {parsed.examples.length > MAX_PREVIEWED && (
                  <li className="inline-flex items-center px-1 py-0.5 text-[11px] text-ink-500">
                    …and {parsed.examples.length - MAX_PREVIEWED} more
                  </li>
                )}
              </ul>
              {parsed.dropped > 0 && (
                <p className="mt-2 text-xs leading-relaxed text-amber-700">
                  {parsed.dropped} more{" "}
                  {parsed.dropped === 1 ? "line does" : "lines do"} not fit —
                  Quick Fill keeps at most {MAX_STYLE_EXAMPLES} examples, and
                  they are meant to show a style rather than list a catalogue.
                </p>
              )}
            </div>
          )}
        </div>
      ) : null}
    </SectionCard>
  );
}

/*
 * Fixed ids rather than `useId`. There is exactly one of this section on the
 * page (the profile form is rendered one at a time), and the collapsed state
 * means `aria-controls` has to name an element that is not in the DOM yet — a
 * generated id would still be stable, but a readable one is easier to follow in
 * the accessibility tree.
 */
const BODY_ID = "style-examples-body";
const TEXTAREA_ID = "style-examples-text";
const FILE_ID = "style-examples-pdf";
