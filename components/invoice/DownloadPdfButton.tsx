"use client";

import { useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/Button";
import type { InvoicePdfProps } from "@/components/invoice/InvoicePdf";
import { invoicePdfFileName, triggerDownload } from "@/lib/pdf";

export interface DownloadPdfButtonProps
  extends Omit<ButtonProps, "onClick" | "children"> {
  invoice: InvoicePdfProps;
  children?: React.ReactNode;
}

/**
 * Renders the invoice to a PDF and downloads it (§8).
 *
 * @react-pdf/renderer and the document component are both pulled in with a
 * dynamic import inside the handler rather than a top-level one. The renderer
 * carries its own font/layout engine and is comfortably the largest dependency
 * in the app; importing it lazily keeps it out of the initial bundle for the
 * many page loads that never download anything, and sidesteps SSR entirely
 * since it only ever runs from a click.
 *
 * Takes the same props as InvoicePreview / InvoicePdf, so /invoices can reuse
 * this to re-download a saved invoice straight from its snapshot.
 */
export function DownloadPdfButton({
  invoice,
  children,
  disabled,
  ...props
}: DownloadPdfButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const [{ pdf }, { InvoicePdf }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/invoice/InvoicePdf"),
      ]);

      const blob = await pdf(<InvoicePdf {...invoice} />).toBlob();
      triggerDownload(blob, invoicePdfFileName(invoice.invoiceNumber));
    } catch (cause) {
      // Font fetch failures and out-of-memory renders both surface here; the
      // user needs to know the click did nothing rather than assume it worked.
      console.error("Invoice PDF generation failed", cause);
      setError("Could not generate the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        {...props}
        onClick={handleDownload}
        disabled={disabled || busy}
        aria-busy={busy}
      >
        {busy ? "Preparing PDF…" : (children ?? "Download PDF")}
      </Button>
      {error && (
        <p role="alert" className="text-xs leading-relaxed text-red-600">
          {error}
        </p>
      )}
    </>
  );
}
