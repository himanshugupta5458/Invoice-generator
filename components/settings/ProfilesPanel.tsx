"use client";

import { useState } from "react";

import { BusinessProfileForm } from "@/components/settings/BusinessProfileForm";
import { Button } from "@/components/ui/Button";
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
    await saveProfile(toProfile(values, id));
    setMode({ kind: "list" });
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-stone-900">
            Business profiles
          </h2>
          <p className="text-sm text-stone-500">
            The seller details, numbering, and theme used on your invoices.
          </p>
        </div>
        <Button variant="primary" onClick={() => setMode({ kind: "new" })}>
          Add profile
        </Button>
      </div>

      {!hydrated ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : profiles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-8 text-center text-sm text-stone-500">
          No business profiles yet — add one to start creating invoices.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {profiles.map((profile) => {
            const accent = resolveAccent(profile.accentColor);
            return (
              <li
                key={profile.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold"
                    style={{
                      backgroundColor: accent,
                      color: readableTextOn(accent),
                    }}
                  >
                    {profile.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-stone-900">
                      {profile.name}
                    </p>
                    <p className="mt-0.5 text-sm text-stone-600">
                      <span className="font-mono">{profile.gstin}</span>
                      {profile.state && ` · ${profile.state} (${profile.stateCode})`}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      Next invoice:{" "}
                      <span className="font-mono">
                        {profile.invoicePrefix}
                        {profile.nextInvoiceNumber}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
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
    </div>
  );
}
