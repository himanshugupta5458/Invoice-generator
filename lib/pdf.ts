/**
 * PDF download plumbing (spec §8).
 *
 * The document itself lives in components/invoice/InvoicePdf.tsx; this file only
 * covers the two things around it — naming the file and handing the blob to the
 * browser — so the naming rule stays a pure, testable function.
 */

/** Fallback when an invoice number is blank or has no usable characters. */
const FALLBACK_SEGMENT = "draft";

/**
 * Turn an invoice number into a safe filename segment.
 *
 * Real invoice numbers contain separators — "SC/2026/1" is the format §5's
 * `invoicePrefix` produces — and a "/" in a filename is either a path segment or
 * a download the browser rejects outright. Anything outside [A-Za-z0-9._-] is
 * folded to a single dash.
 */
export function sanitizeFileSegment(value: string): string {
  const cleaned = (typeof value === "string" ? value : "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || FALLBACK_SEGMENT;
}

/** `invoice-{invoiceNumber-sanitised}.pdf` (§8). */
export function invoicePdfFileName(invoiceNumber: string): string {
  return `invoice-${sanitizeFileSegment(invoiceNumber)}.pdf`;
}

/**
 * Hand a generated blob to the browser as a download.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari
 * cancels an in-flight download if the URL dies in the same frame as the click.
 */
export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
