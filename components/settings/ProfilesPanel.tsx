"use client";

import { useState } from "react";

import { BusinessProfileForm } from "@/components/settings/BusinessProfileForm";
import { Button } from "@/components/ui/Button";
import { EmptyState, PanelLoading, SectionCard } from "@/components/ui/Card";
import { ReceiptIcon } from "@/components/ui/icons";
import { readableTextOn, resolveAccent } from "@/lib/color";
import { createId } from "@/lib/repository";
import { useHydratedStore, useInvoiceStore } from "@/lib/store";
import type { BusinessProfile } from "@/lib/types";
import { toProfile, type BusinessProfileFormValues } from "@/lib/validation";

type Mode = { kind: "list" } | { kind: "new" } | { kind: "edit"; id: string };

export function ProfilesPanel() {
  const hydrated = useHydratedStore();
  const profiles = useInvoiceStore((state) => state.profiles);
  const saveProfile = useInvoiceStore((state) => state.saveProfile);
  const deleteProfile = useInvoiceStore((state) => state.deleteProfile);
  const busy = useInvoiceStore((state) => state.busy);

  const [mode, setMode] = useState<Mode>({ kind: "list" });

  const editing =
    mode.kind === "edit"
      ? profiles.find((profile) => profile.id === mode.id)
      : undefined;

  async function handleSubmit(values: BusinessProfileFormValues) {
    const id = editing?.id ?? createId();
    // Stay on the form if the write was refused — a profile carrying a logo is
    // the most likely thing to hit the storage quota, and re-typing it all
    // because the panel closed would be the worst possible response.
    if (await saveProfile(toProfile(values, id))) setMode({ kind: "list" });
  }

  async function handleDelete(profile: BusinessProfile) {
    const confirmed = window.confirm(
      `Delete "${profile.name}"? Invoices already issued from this profile keep their own copy of these details and are not affected.`,
    );
    if (confirmed) await deleteProfile(profile.id);
  }

  if (mode.kind === "new" || editing) {
    return (
      <BusinessProfileForm
        key={editing?.id ?? "new"}
        profile={editing}
        busy={busy}
        onSubmit={handleSubmit}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }

  return (
    <SectionCard
      title="Business profiles"
      description="The seller details, numbering, and theme used on your invoices."
      actions={
        <Button variant="primary" onClick={() => setMode({ kind: "new" })}>
          Add profile
        </Button>
      }
      // The rows carry their own padding so their dividers reach the card's
      // edges — a list of separate floating cards reads as separate things,
      // and these are one set.
      bare
    >
      {!hydrated ? (
        <PanelLoading />
      ) : profiles.length === 0 ? (
        <div className="px-5 sm:px-6">
          <EmptyState
            bordered={false}
            icon={<ReceiptIcon className="size-6" />}
            title="No business profiles yet"
            description="A profile holds the seller details, GSTIN, numbering and accent colour that go on every invoice you issue from it."
            action={
              <Button variant="primary" onClick={() => setMode({ kind: "new" })}>
                Add your first profile
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {profiles.map((profile) => {
            const accent = resolveAccent(profile.accentColor);
            return (
              <li
                key={profile.id}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 py-4 sm:px-6"
              >
                <div className="flex min-w-0 items-start gap-3.5">
                  {/* This one swatch is the profile's *invoice* accent, not app
                      chrome — it is how you tell two profiles apart in a list,
                      so it stays on the document's colour system. */}
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-semibold"
                    style={{
                      backgroundColor: accent,
                      color: readableTextOn(accent),
                    }}
                  >
                    {profile.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {profile.name}
                    </p>
                    <p className="mt-1 truncate text-sm text-ink-600">
                      <span className="font-mono">{profile.gstin}</span>
                      {profile.state &&
                        ` · ${profile.state} (${profile.stateCode})`}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      Next invoice:{" "}
                      <span className="font-mono text-ink-700">
                        {profile.invoicePrefix}
                        {profile.nextInvoiceNumber}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() => setMode({ kind: "edit", id: profile.id })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void handleDelete(profile)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
