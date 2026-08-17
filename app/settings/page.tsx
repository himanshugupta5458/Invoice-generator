import type { Metadata } from "next";

import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { PageHeader } from "@/components/ui/Card";
import { StorageErrorBanner } from "@/components/ui/StorageErrorBanner";

export const metadata: Metadata = {
  title: "Settings",
};

/** Business profiles, buyers, and the JSON backup (§4, §7). */
export default function SettingsPage() {
  return (
    // Narrower than the builder's full width. This page is one column of forms
    // and lists, and an input stretched to 1,100px is harder to read, not
    // easier — the builder earns the extra width by putting a totals panel in it.
    <div className="flex max-w-4xl flex-col gap-6 sm:gap-8">
      <PageHeader
        title="Settings"
        description="Set up your business once, keep your buyers on hand, and back up your data."
      />

      <StorageErrorBanner />
      <SettingsTabs />
    </div>
  );
}
