import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
};

/** Keeps a mistyped URL inside the app's own chrome instead of a bare error. */
export default function NotFound() {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-12 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-stone-900">
        Page not found
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">
        That page does not exist. Your profiles, buyers, and invoices are
        untouched — they are stored in this browser.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block rounded-md bg-stone-900 px-3.5 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
      >
        Go to the invoice builder
      </Link>
    </div>
  );
}
