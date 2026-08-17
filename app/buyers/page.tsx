import type { Metadata } from "next";
import Link from "next/link";

import { BuyersPanel } from "@/components/settings/BuyersPanel";
import { StorageErrorBanner } from "@/components/ui/StorageErrorBanner";

export const metadata: Metadata = {
  title: "Buyers",
};

/**
 * Dedicated buyers route (§3). It renders the same panel as the Buyers tab in
 * Settings, so the two views can never drift apart.
 */
export default function BuyersPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">
          Buyers
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Also available as a tab in{" "}
          <Link
            href="/settings"
            className="underline underline-offset-2 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
          >
            Settings
          </Link>
          .
        </p>
      </div>

      <StorageErrorBanner />
      <BuyersPanel />
    </div>
  );
}
