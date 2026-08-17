import type { Metadata } from "next";

import { InvoiceHistory } from "@/components/invoice/InvoiceHistory";
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">
          Invoice history
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Every saved invoice, exactly as it was issued. Re-download the PDF or
          switch an invoice between paid and unpaid.
        </p>
      </div>

      <StorageErrorBanner />
      <InvoiceHistory />
    </div>
  );
}
