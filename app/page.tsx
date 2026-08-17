import type { Metadata } from "next";

import { InvoiceForm } from "@/components/invoice/InvoiceForm";
import { PageHeader } from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "New invoice",
};

/** Invoice builder — the home screen (§9). */
export default function HomePage() {
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <PageHeader
        title="New invoice"
        description="Pick a business profile, add the buyer and items, and watch the totals update as you type."
      />

      <InvoiceForm />
    </div>
  );
}
