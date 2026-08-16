"use client";

import { useRef, useState } from "react";

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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Arrow / Home / End move between tabs, as the ARIA tabs pattern expects.
   * Combined with the roving tabIndex below, the tablist is one stop in the
   * page's tab order rather than three.
   */
  function moveTo(index: number) {
    const next = (index + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: TABS.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    moveTo(target);
  }

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

      {/* The three labels are wider than a phone screen, so the strip scrolls
          rather than pushing the page into horizontal overflow. w-max/min-w-full
          keeps the underline rule spanning the full width on a desktop. */}
      <div className="overflow-x-auto">
        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex w-max min-w-full gap-1 border-b border-stone-200"
        >
          {TABS.map((entry, index) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`tab-${entry.id}`}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                aria-selected={active}
                aria-controls={`panel-${entry.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(entry.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors motion-reduce:transition-none",
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
