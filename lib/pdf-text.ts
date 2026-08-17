/**
 * Client-side PDF text extraction, for teaching Quick Fill a business's own item
 * names from a sample invoice (§16, v1.2).
 *
 * Browser only, and deliberately so: the file is read in the tab, its text is
 * pulled out in the tab, and nothing is uploaded anywhere. That is the same
 * promise CSV import makes ("the file never leaves your browser"), and it is the
 * reason a sample invoice — a real document, with a real buyer's details on it —
 * is safe to hand to this feature at all. Only the item names the user then
 * chooses to keep are ever stored, and only they are ever sent to the model.
 *
 * pdf.js is loaded with a dynamic `import()` inside the handler rather than at
 * module scope, so the ~1 MB library is fetched by the people who upload a PDF
 * and by nobody else. `pdfjs-dist/webpack.mjs` is the library's own bundler
 * entry: it sets up the web worker with a relative URL the bundler can resolve.
 *
 * Text-based PDFs only. A scan is a picture of an invoice, and reading one needs
 * OCR — a different, much larger dependency. This reports that plainly instead of
 * pretending, and the paste box is right there beside it.
 */

import { MAX_STYLE_SOURCE_CHARS } from "./style-examples";

/** Bigger than any one-page invoice; a bound on what we will read into memory. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Pages read. The item names are on the first page or two of an invoice, and a
 * 200-page PDF dropped in here should not lock the tab up finding that out.
 */
export const MAX_PDF_PAGES = 10;

/**
 * Horizontal gap, in PDF points, at which two pieces of text are taken to be in
 * different columns rather than in the same phrase.
 *
 * This matters more than it looks: `lib/style-examples.ts` finds the description
 * inside a table row by splitting the row on its column boundaries, so a row
 * flattened into one run of single-spaced words would arrive as
 * "Kundan Necklace Set 71171990 2 4,500.00" with nothing to split on. Marking the
 * gaps as tabs here is what makes that row parse into a product name. Six points
 * is roughly two spaces at 11pt — wider than word spacing, narrower than any real
 * column gutter.
 */
const COLUMN_GAP_POINTS = 6;

/** Everything this module refuses, said in a sentence the user can act on. */
export class PdfTextError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PdfTextError";
  }
}

export const PDF_NO_TEXT_MESSAGE =
  "No text could be read from that PDF — it looks like a scan or a photo. Paste a few item lines below instead.";

/**
 * Pull the text out of a PDF, laid out one line per line with column boundaries
 * marked by tabs.
 *
 * Throws `PdfTextError` for every failure — an unreadable file, an encrypted
 * one, a scan with no text layer, or pdf.js failing to load at all. The caller
 * shows the message and points at the paste box; there is no failure here that
 * should cost the user anything more than a sentence.
 */
export async function extractPdfText(file: File): Promise<string> {
  if (file.size > MAX_PDF_BYTES) {
    throw new PdfTextError(
      `That PDF is larger than ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB. Paste a few item lines below instead.`,
    );
  }

  let pdfjs: typeof import("pdfjs-dist");
  try {
    pdfjs = await import("pdfjs-dist/webpack.mjs");
  } catch (cause) {
    throw new PdfTextError(
      "The PDF reader could not be loaded. Paste a few item lines below instead.",
      { cause },
    );
  }

  const lines: string[] = [];
  let characters = 0;

  // Held so it can be destroyed in a `finally`: the loading task owns the web
  // worker, and a tab that reads ten invoices should not leave ten running.
  let loadingTask: ReturnType<typeof pdfjs.getDocument> | undefined;

  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    });
    const document = await loadingTask.promise;

    try {
      const pages = Math.min(document.numPages, MAX_PDF_PAGES);
      for (let number = 1; number <= pages && characters < MAX_STYLE_SOURCE_CHARS; number += 1) {
        const page = await document.getPage(number);
        try {
          const content = await page.getTextContent();
          let line = "";
          let previousEnd = 0;

          for (const item of content.items) {
            if (!("str" in item)) continue; // a marked-content boundary

            const x = item.transform[4] as number;
            if (line !== "") {
              const gap = x - previousEnd;
              if (gap > COLUMN_GAP_POINTS) line += "\t";
              else if (gap > 0.5 && !line.endsWith(" ") && !item.str.startsWith(" ")) {
                line += " ";
              }
            }
            line += item.str;
            previousEnd = x + item.width;

            if (item.hasEOL) {
              lines.push(line);
              characters += line.length;
              line = "";
              previousEnd = 0;
            }
          }

          if (line.trim() !== "") {
            lines.push(line);
            characters += line.length;
          }
        } finally {
          page.cleanup();
        }
      }
    } finally {
      await loadingTask.destroy();
      loadingTask = undefined;
    }
  } catch (cause) {
    await loadingTask?.destroy().catch(() => {});
    throw new PdfTextError(
      "That PDF could not be read — it may be damaged or password-protected. Paste a few item lines below instead.",
      { cause },
    );
  }

  const text = lines.join("\n").trim();
  // A PDF that opens fine and yields nothing is the scanned case, and it is
  // common enough to deserve its own sentence rather than "could not be read".
  if (text === "") throw new PdfTextError(PDF_NO_TEXT_MESSAGE);

  return text.slice(0, MAX_STYLE_SOURCE_CHARS);
}
