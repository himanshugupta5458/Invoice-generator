import { InvoiceForm } from "@/components/invoice/InvoiceForm";

/** Invoice builder — the home screen (§9). */
export default function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">
          New invoice
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Pick a business profile, add the buyer and items, and watch the totals
          update as you type.
        </p>
      </div>

      <InvoiceForm />
    </div>
  );
}
