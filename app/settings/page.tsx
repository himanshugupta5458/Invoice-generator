"use client";

import { useState } from "react";

import { BuyersPanel } from "@/components/settings/BuyersPanel";
import { DataPanel } from "@/components/settings/DataPanel";
import { ProfilesPanel } from "@/components/settings/ProfilesPanel";
import { cn } from "@/components/ui/cn";
import { StorageErrorBanner } from "@/components/ui/StorageErrorBanner";

const TABS = [
  { id: "profiles", label: "Business profiles" },
  { id: "buyers", label: "Buyers" },
  { id: "data", label: "Export & import" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>("profiles");

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

      <div className="border-b border-stone-200">
        <div role="tablist" aria-label="Settings sections" className="flex gap-1">
          {TABS.map((entry) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`tab-${entry.id}`}
                aria-selected={active}
                aria-controls={`panel-${entry.id}`}
                onClick={() => setTab(entry.id)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm transition-colors motion-reduce:transition-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900",
                  active
                    ? "border-stone-900 font-medium text-stone-900"
                    : "border-transparent text-stone-500 hover:text-stone-900",
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={-1}
      >
        {tab === "profiles" && <ProfilesPanel />}
        {tab === "buyers" && <BuyersPanel />}
        {tab === "data" && <DataPanel />}
      </div>
    </div>
  );
}
