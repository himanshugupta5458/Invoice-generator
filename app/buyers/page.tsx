import type { Metadata } from "next";
import Link from "next/link";

import { BuyersPanel } from "@/components/settings/BuyersPanel";
import { PageHeader } from "@/components/ui/Card";
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
    // Same width as Settings, since it is the same panel seen from a different
    // door — landing on this one should not feel like a different application.
    <div className="flex max-w-4xl flex-col gap-6 sm:gap-8">
      <PageHeader
        title="Buyers"
        description={
          <>
            The customers you can pick when creating an invoice. Also available
            as a tab in{" "}
            <Link
              href="/settings"
              className="focus-ring rounded font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              Settings
            </Link>
            .
          </>
        }
      />

      <StorageErrorBanner />
      <BuyersPanel />
    </div>
  );
}
