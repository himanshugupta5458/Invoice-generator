"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DownloadPdfButton } from "@/components/invoice/DownloadPdfButton";
import type { InvoicePdfProps } from "@/components/invoice/InvoicePdf";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState, PanelLoading, SectionCard } from "@/components/ui/Card";
import { TextInput } from "@/components/ui/Field";
import { ClockIcon } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
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
    return (
      <SectionCard title="Saved invoices" bare>
        <PanelLoading />
      </SectionCard>
    );
  }

  // Directive empty state (§9): say what to do next, not just that it is empty.
  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={<ClockIcon className="size-6" />}
        title="No invoices saved yet"
        description="Every invoice you save is kept here with its own frozen copy of the seller, buyer and totals — so it re-downloads exactly as it was issued."
        action={
          <Link href="/" className={buttonClasses("primary")}>
            Create an invoice
          </Link>
        }
      />
    );
  }

  return (
    <SectionCard
      title="Saved invoices"
      description="Each row re-downloads from its own snapshot — editing a profile later never changes an invoice already issued."
      actions={
        <>
          <Badge>
            {invoices.length} saved
          </Badge>
          {unpaid > 0 && <Badge tone="warning">{unpaid} unpaid</Badge>}
        </>
      }
      bare
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3 sm:px-6">
        <TextInput
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by invoice number, buyer, or date"
          aria-label="Search invoices"
          className="sm:max-w-xs"
        />

        {/* A segmented control rather than three loose buttons: the three
            options are one setting, and the moving white thumb shows which of
            them is currently narrowing the list below. */}
        <div
          role="group"
          aria-label="Filter by status"
          className="flex gap-1 rounded-lg bg-ink-100 p-1"
        >
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={status === filter.id}
              onClick={() => setStatus(filter.id)}
              className={cn(
                "focus-ring rounded-md px-3 py-1.5 text-xs font-semibold",
                "transition-colors motion-reduce:transition-none",
                status === filter.id
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-ink-600 hover:text-ink-900",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-500 sm:px-6">
          No invoices match the current search or filter.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {rows.map(({ invoice, pdf }) => (
            <li
              key={invoice.id}
              className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-semibold text-ink-900">
                  {invoice.invoiceNumber}
                </p>
                <p className="mt-1 truncate text-sm text-ink-700">
                  {invoice.buyer.name || "—"}
                </p>
                <p className="mt-1 truncate text-xs text-ink-500">
                  {formatDisplayDate(invoice.date)}
                  {" · "}
                  {invoice.businessSnapshot.name}
                </p>
              </div>

              {/* Fixed widths from `sm` up, because "Paid" and "Unpaid" are
                  different lengths: left to flex, every row's badge shifted the
                  amount beside it and the figures stopped lining up down the
                  column — the one thing a list of amounts has to do. */}
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <p className="text-sm font-semibold tabular-nums text-ink-900 sm:w-32 sm:text-right">
                  ₹{formatINR(pdf.computed.grandTotal)}
                </p>

                <div className="sm:w-24">
                  <StatusToggle
                    invoice={invoice}
                    disabled={busy}
                    onToggle={setInvoiceStatus}
                  />
                </div>

                <DownloadPdfButton invoice={pdf} size="sm">
                  Download PDF
                </DownloadPdfButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * The status badge is itself the control (§9: "editable with one click"). The
 * visible text is the current status; the accessible name spells out what the
 * click will do, since "Paid" alone tells a screen-reader user nothing about
 * the action.
 *
 * It keeps the green/amber status palette rather than the brand colour: paid
 * and unpaid have to be tellable apart at a glance down a column, and a state
 * rendered in the product's own accent stops reading as a state at all.
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
        "focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-xs font-semibold transition-colors motion-reduce:transition-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        paid
          ? "border-green-300 bg-green-50 text-green-800 hover:bg-green-100"
          : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100",
      )}
    >
      {/* Colour is not the only carrier of the state — the label says it too —
          but the dot makes the two states separable while scanning. */}
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          paid ? "bg-green-600" : "bg-amber-500",
        )}
      />
      {paid ? "Paid" : "Unpaid"}
    </button>
  );
}
