import type { Metadata } from "next";

import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { StorageErrorBanner } from "@/components/ui/StorageErrorBanner";

export const metadata: Metadata = {
  title: "Settings",
};

/** Business profiles, buyers, and the JSON backup (§4, §7). */
export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">
          Settings
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Set up your business once, keep your buyers on hand, and back up your
          data.
        </p>
      </div>

      <StorageErrorBanner />
      <SettingsTabs />
    </div>
  );
}
