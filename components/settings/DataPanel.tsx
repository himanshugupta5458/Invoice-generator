"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { triggerDownload } from "@/lib/pdf";
import { useHydratedStore, useInvoiceStore } from "@/lib/store";

/**
 * Export / Import JSON (§7).
 *
 * v1 data lives in this browser only, so this is the backup route: it is how a
 * user moves their profiles, buyers, and invoices to another device or recovers
 * after clearing site data.
 */
export function DataPanel() {
  const hydrated = useHydratedStore();
  const profiles = useInvoiceStore((state) => state.profiles);
  const buyers = useInvoiceStore((state) => state.buyers);
  const invoices = useInvoiceStore((state) => state.invoices);
  const exportData = useInvoiceStore((state) => state.exportData);
  const importData = useInvoiceStore((state) => state.importData);
  const busy = useInvoiceStore((state) => state.busy);

  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Exporting an empty bundle produces a file that looks like a backup but
  // restores nothing, so the action waits until there is something to save.
  const hasData =
    profiles.length > 0 || buyers.length > 0 || invoices.length > 0;

  async function handleExport() {
    setNotice(null);
    const bundle = await exportData();
    if (!bundle) return;

    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    // Shared with the PDF download rather than hand-rolled here: that helper
    // appends the link before clicking it and defers revoking the object URL,
    // without which Safari cancels the download mid-flight.
    triggerDownload(
      blob,
      `invoicegen-backup-${bundle.exportedAt.slice(0, 10)}.json`,
    );

    setNotice("Backup downloaded.");
  }

  async function handleImportFile(file: File | undefined) {
    setNotice(null);
    if (!file) return;

    const replacing =
      profiles.length > 0 || buyers.length > 0 || invoices.length > 0;
    if (
      replacing &&
      !window.confirm(
        "Importing replaces all profiles, buyers, and invoices currently in this browser. Continue?",
      )
    ) {
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    const text = await file.text();
    const ok = await importData(text);
    if (fileInput.current) fileInput.current.value = "";
    setNotice(ok ? "Backup restored." : null);
  }

  const stats = [
    { label: "Profiles", value: profiles.length },
    { label: "Buyers", value: buyers.length },
    { label: "Invoices", value: invoices.length },
  ];

  return (
    <SectionCard
      title="Export & import"
      description="Your data is stored in this browser only. It is not synced across devices, and clearing site data removes it — export a backup to keep a copy."
      footer={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => void handleExport()}
              disabled={busy || !hydrated || !hasData}
            >
              Export JSON
            </Button>
            <Button
              onClick={() => fileInput.current?.click()}
              disabled={busy || !hydrated}
            >
              Import JSON
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => void handleImportFile(event.target.files?.[0])}
            />
          </div>

          {hydrated && !hasData && (
            <p className="text-xs leading-relaxed text-ink-500">
              Nothing to export yet — add a business profile in the{" "}
              <span className="font-medium text-ink-700">Business profiles</span>{" "}
              tab, or import a backup you made on another device.
            </p>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* What a backup would actually contain, so "Export" is not a leap of
            faith — and so a restore can be checked against it afterwards. */}
        <dl className="grid grid-cols-3 gap-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-3 text-center"
            >
              <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-500">
                {stat.label}
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-ink-900">
                {hydrated ? stat.value : "—"}
              </dd>
            </div>
          ))}
        </dl>

        {notice && <Notice tone="success" size="sm">{notice}</Notice>}
      </div>
    </SectionCard>
  );
}
