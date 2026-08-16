"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
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

  async function handleExport() {
    setNotice(null);
    const bundle = await exportData();
    if (!bundle) return;

    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `invoicegen-backup-${bundle.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);

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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-stone-900">
          Export &amp; import
        </h2>
        <p className="text-sm text-stone-500">
          Your data is stored in this browser only. It is not synced across
          devices, and clearing site data removes it — export a backup to keep a
          copy.
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-3 rounded-lg border border-stone-200 bg-white p-4 text-center">
        {[
          { label: "Profiles", value: profiles.length },
          { label: "Buyers", value: buyers.length },
          { label: "Invoices", value: invoices.length },
        ].map((stat) => (
          <div key={stat.label}>
            <dt className="text-xs uppercase tracking-wide text-stone-500">
              {stat.label}
            </dt>
            <dd className="text-lg font-semibold text-stone-900 tabular-nums">
              {hydrated ? stat.value : "—"}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => void handleExport()}
          disabled={busy || !hydrated}
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

      {notice && (
        <p role="status" className="text-sm text-stone-600">
          {notice}
        </p>
      )}
    </div>
  );
}
