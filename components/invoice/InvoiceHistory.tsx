"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DownloadPdfButton } from "@/components/invoice/DownloadPdfButton";
import type { InvoicePdfProps } from "@/components/invoice/InvoicePdf";
import { cn } from "@/components/ui/cn";
import { TextInput } from "@/components/ui/Field";
import { formatDisplayDate, formatINR } from "@/lib/format";
import { computeInvoice } from "@/lib/gst";
import { countUnpaid, filterInvoices, type StatusFilter } from "@/lib/history";
import { useHydratedStore, useInvoiceStore } from "@/lib/store";
import type { Invoice } from "@/lib/types";

const FILTERS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unpaid", label: "Unpaid" },
  { id: "paid", label: "Paid" },
];

/**
 * Everything the preview/PDF needs, taken from the invoice's own frozen fields.
 *
 * This is the whole point of the snapshot rule (§5): a saved invoice is
 * re-rendered from `businessSnapshot`, its embedded buyer/ship-to, and its
 * frozen terms and accent colour — never from the current profile or saved-buyer
 * records. Editing a profile after issuing an invoice must not change the PDF
 * that invoice re-downloads as. The totals are recomputed from the snapshot's
 * items rather than stored, which is safe because the same pure function
 * produced them at issue time.
 */
export function snapshotPdfProps(invoice: Invoice): InvoicePdfProps {
  return {
    business: invoice.businessSnapshot,
    buyer: invoice.buyer,
    shipTo: invoice.shipTo,
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.date,
    computed: computeInvoice(
      invoice.businessSnapshot,
      invoice.buyer,
      invoice.items,
    ),
    termsAndConditions: invoice.termsAndConditions,
    accentColor: invoice.accentColor,
    status: invoice.status,
    notes: invoice.notes,
  };
}

/** Saved invoice history: list, re-download, and paid/unpaid toggle (§4, §11.7). */
export function InvoiceHistory() {
  const hydrated = useHydratedStore();
  const invoices = useInvoiceStore((state) => state.invoices);
  const setInvoiceStatus = useInvoiceStore((state) => state.setInvoiceStatus);
  const busy = useInvoiceStore((state) => state.busy);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  // One computeInvoice per visible row, memoised so toggling a status does not
  // re-run the maths for every other invoice in the list.
  const rows = useMemo(
    () =>
      filterInvoices(invoices, { query, status }).map((invoice) => ({
        invoice,
        pdf: snapshotPdfProps(invoice),
      })),
    [invoices, query, status],
  );

  const unpaid = countUnpaid(invoices);

  if (!hydrated) {
    return <p className="text-sm text-stone-500">Loading…</p>;
  }

  // Directive empty state (§9): say what to do next, not just that it is empty.
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-10 text-center">
        <p className="text-sm text-stone-600">
          No invoices saved yet — create one on the{" "}
          <Link
            href="/"
            className="font-medium underline underline-offset-2 hover:text-stone-900"
          >
            New invoice
          </Link>{" "}
          page and choose <span className="font-medium">Save invoice</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-500" role="status">
          {invoices.length} saved invoice{invoices.length === 1 ? "" : "s"}
          {unpaid > 0 && ` · ${unpaid} unpaid`}
        </p>

        <div
          role="group"
          aria-label="Filter by status"
          className="flex gap-1 rounded-md border border-stone-300 bg-white p-0.5"
        >
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={status === filter.id}
              onClick={() => setStatus(filter.id)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors motion-reduce:transition-none",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900",
                status === filter.id
                  ? "bg-stone-900 text-white"
                  : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <TextInput
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by invoice number, buyer, or date"
        aria-label="Search invoices"
        className="max-w-sm"
      />

      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">
          No invoices match the current search or filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ invoice, pdf }) => (
            <li
              key={invoice.id}
              className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-stone-900">
                  {invoice.invoiceNumber}
                </p>
                <p className="mt-0.5 truncate text-sm text-stone-600">
                  {invoice.buyer.name || "—"}
                </p>
                <p className="mt-0.5 text-xs text-stone-500">
                  {formatDisplayDate(invoice.date)}
                  {" · "}
                  {invoice.businessSnapshot.name}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <p className="text-sm font-semibold tabular-nums text-stone-900">
                  ₹{formatINR(pdf.computed.grandTotal)}
                </p>

                <StatusToggle
                  invoice={invoice}
                  disabled={busy}
                  onToggle={setInvoiceStatus}
                />

                <DownloadPdfButton invoice={pdf} size="sm">
                  Download PDF
                </DownloadPdfButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The status badge is itself the control (§9: "editable with one click"). The
 * visible text is the current status; the accessible name spells out what the
 * click will do, since "Paid" alone tells a screen-reader user nothing about
 * the action.
 */
function StatusToggle({
  invoice,
  disabled,
  onToggle,
}: {
  invoice: Invoice;
  disabled: boolean;
  onToggle: (id: string, status: Invoice["status"]) => Promise<void>;
}) {
  const paid = invoice.status === "paid";
  const next = paid ? "unpaid" : "paid";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onToggle(invoice.id, next)}
      aria-label={`${invoice.invoiceNumber} is ${invoice.status} — mark as ${next}`}
      title={`Mark as ${next}`}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900",
        "disabled:cursor-not-allowed disabled:opacity-50",
        paid
          ? "border-green-300 bg-green-50 text-green-800 hover:bg-green-100"
          : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100",
      )}
    >
      {paid ? "Paid" : "Unpaid"}
    </button>
  );
}
