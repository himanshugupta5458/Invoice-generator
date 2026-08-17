import type { Metadata } from "next";
import Link from "next/link";

import { buttonClasses } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Page not found",
};

/** Keeps a mistyped URL inside the app's own chrome instead of a bare error. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-dashed border-ink-300 bg-white px-6 py-14 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
        Page not found
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-500">
        That page does not exist. Your profiles, buyers, and invoices are
        untouched — they are stored in this browser.
      </p>
      <Link href="/" className={buttonClasses("primary", "md", "mt-6")}>
        Go to the invoice builder
      </Link>
    </div>
  );
}
