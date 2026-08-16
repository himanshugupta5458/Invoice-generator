import Link from "next/link";

/**
 * Invoice builder (§4). The full builder — profile dropdown, buyer combobox,
 * Ship To, items table, live totals, accent-themed preview — arrives in
 * milestone 5. Until then this page points at the setup that must happen first.
 */
export default function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">
          New invoice
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Select a business profile, add your buyer and items, and download a
          GST-compliant PDF.
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-10 text-center">
        <p className="text-sm text-stone-600">
          The invoice builder is not wired up yet.
        </p>
        <p className="mt-1 text-sm text-stone-500">
          Start by adding a business profile in{" "}
          <Link
            href="/settings"
            className="font-medium text-stone-900 underline underline-offset-2"
          >
            Settings
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
