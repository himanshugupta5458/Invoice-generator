"use client";

import { useRef, useState } from "react";

import { BuyersPanel } from "@/components/settings/BuyersPanel";
import { DataPanel } from "@/components/settings/DataPanel";
import { ProfilesPanel } from "@/components/settings/ProfilesPanel";
import { cn } from "@/components/ui/cn";

const TABS = [
  { id: "profiles", label: "Business profiles" },
  { id: "buyers", label: "Buyers" },
  { id: "data", label: "Export & import" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** The three Settings sections (§4, §7). Split from the route so the page can be a server component with its own metadata. */
export function SettingsTabs() {
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
      {/* The three labels are wider than a phone screen, so the strip scrolls
          rather than pushing the page into horizontal overflow. w-max/min-w-full
          keeps the underline rule spanning the full width on a desktop. */}
      <div className="-mb-1 overflow-x-auto pb-1">
        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex w-max min-w-full gap-1 border-b border-ink-200"
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
                  "focus-ring -mb-px whitespace-nowrap rounded-t-md border-b-2 px-3 pb-2.5 pt-1.5 text-sm",
                  "transition-colors motion-reduce:transition-none",
                  active
                    ? "border-brand-600 font-semibold text-brand-700"
                    : "border-transparent font-medium text-ink-500 hover:border-ink-300 hover:text-ink-900",
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
