import type { Metadata } from "next";

import { InvoiceHistory } from "@/components/invoice/InvoiceHistory";
import { PageHeader } from "@/components/ui/Card";
import { StorageErrorBanner } from "@/components/ui/StorageErrorBanner";

export const metadata: Metadata = {
  title: "Invoice history",
};

/**
 * Saved invoice history (§4, §11.7). Every row re-downloads from the invoice's
 * own snapshot, so a later edit to the profile or buyer never changes it.
 */
export default function InvoicesPage() {
  return (
    // Wider than Settings: a row here carries an amount, a status control and a
    // download alongside the invoice number, and squeezing those wraps them.
    <div className="flex max-w-5xl flex-col gap-6 sm:gap-8">
      <PageHeader
        title="Invoice history"
        description="Every saved invoice, exactly as it was issued. Re-download the PDF or switch an invoice between paid and unpaid."
      />

      <StorageErrorBanner />
      <InvoiceHistory />
    </div>
  );
}
