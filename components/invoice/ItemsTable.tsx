"use client";

import { useId, useState } from "react";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { useFieldArray, type Control } from "react-hook-form";

import {
  CsvImportButton,
  CsvImportFeedback,
  useCsvImport,
} from "@/components/invoice/CsvImportButton";
import {
  QuickFillButton,
  QuickFillPanel,
  useQuickFill,
} from "@/components/invoice/QuickFillButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/Card";
import { Select, TextInput } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { cn } from "@/components/ui/cn";
import { CSV_TEMPLATE_HEADER } from "@/lib/csv";
import { formatINR } from "@/lib/format";
import type { ComputedInvoice } from "@/lib/gst";
import { GST_SLABS } from "@/lib/types";
import type {
  InvoiceFormValues,
  InvoiceItemFormValues,
} from "@/lib/validation";

export const EMPTY_ITEM = {
  description: "",
  hsn: "",
  quantity: 1,
  rate: 0,
  gstRate: 18,
} as const;

/**
 * One grid template drives the header row and every item row, so the two can
 * never drift out of register. Sized to fit the 42.5rem the builder's left
 * column has at `lg`: the page is capped at `max-w-6xl` (72rem) inside `px-10`,
 * leaving 67rem; the totals panel takes 20rem and the grid gap 1.5rem, and the
 * card's own `px-6` takes 3rem more. The fixed columns and gaps come to
 * 30.75rem, so the flexible description column gets ~11.75rem at worst.
 *
 * The GST column used to be the tight one, because a native `<select>` gives its
 * text far less room than its width suggests: Chrome reserves ~16px at the right
 * edge for its own dropdown arrow *on top of* the author's padding, and that
 * reservation differs per browser, so the usable width was not something this
 * layout could know. At 5.5rem it left ~26px — enough for "28" but not for the
 * ~27px of "28%", which is why the options are bare numbers with the unit
 * carried once by the column heading.
 *
 * That constraint is gone: `Select` now draws its own chevron behind
 * `appearance: none` (see the `select-chevron` utility in globals.css), so the
 * usable text box is exactly width - 12px (`px-3`) - 32px (`pr-8`) - 2px
 * (border) = 42px, in every browser. The bare numbers stay because the heading
 * already carries the unit, but they are now a choice rather than a squeeze.
 *
 * Padding still cannot be trimmed per-instance to claw more back: `cn` is a
 * plain join, so a narrower `pr-*` passed via className loses to the shared
 * `pr-8` on CSS order.
 */
const ROW_GRID =
  "md:grid-cols-[minmax(0,1fr)_5rem_4rem_5.5rem_5.5rem_6.5rem_2rem] md:gap-1.5";

/**
 * Right-aligned figures, and no native spinner: at these column widths the
 * spinner Chrome draws on hover sits on top of the digits it is meant to help
 * with, and quantities on an invoice are typed rather than nudged.
 */
const NUMERIC_INPUT = cn(
  "text-right tabular-nums",
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
);

export interface ItemsTableProps {
  control: Control<InvoiceFormValues>;
  register: UseFormRegister<InvoiceFormValues>;
  /** Live totals from lib/gst.ts; `computed.lines` matches the rows in order. */
  computed: ComputedInvoice;
  /**
   * The selected business profile's own item names, when it has taught Quick
   * Fill any (§16, v1.2). Passed straight through to the generation; absent for
   * a profile that has not, which is the default.
   */
  styleExamples?: string[];
  errors?: FieldErrors<InvoiceFormValues>["items"];
  disabled?: boolean;
}

/**
 * Items entry (§4).
 *
 * Layout note: this is a CSS grid, not a `<table>`. A seven-column table cannot
 * be made legible on a phone — it can only scroll sideways, which hides the
 * description and the amount from each other, the two columns a user actually
 * checks against one another. The same rows therefore reflow into a card per
 * item below `md` and lock into aligned columns above it. Because there is one
 * set of inputs in the DOM either way, react-hook-form registration is
 * unaffected and the two layouts cannot disagree about a value.
 */
export function ItemsTable({
  control,
  register,
  computed,
  styleExamples,
  errors,
  disabled = false,
}: ItemsTableProps) {
  const { fields, append, insert, remove } = useFieldArray({
    control,
    name: "items",
  });
  const [undo, setUndo] = useState<{
    index: number;
    item: InvoiceItemFormValues;
  } | null>(null);

  /**
   * Prefix for the label/input pairs inside each row.
   *
   * Deliberately *not* `field.id`: useFieldArray seeds its ids from
   * `crypto.randomUUID()` in a ref initialiser, which runs once on the server
   * and again in the browser, so the two runs never agree and any DOM attribute
   * built from one is a guaranteed hydration mismatch. `useId` is the opposite
   * — React serialises it with the SSR payload so the client reuses the server's
   * value. Rows are then addressed by position, which hydration also agrees on.
   */
  const rowIdPrefix = useId();

  const lines = computed.lines;

  // `errors` is an array of per-row errors, plus a root error for the array itself.
  const rowErrors = Array.isArray(errors) ? errors : undefined;
  const listError = errors?.root?.message ?? errors?.message;

  /**
   * Append rows that arrived in bulk — from a CSV (§4) or from Quick Fill (§16).
   *
   * Both routes land here so the two features behave identically once their rows
   * have been validated; only where the rows came from differs.
   *
   * The table always opens with one blank row. Appending behind it would leave
   * that blank row in place to fail validation on save, so an untouched blank
   * first row is dropped once real rows arrive. A row the user has typed into is
   * never discarded.
   */
  function handleBulkAppend(imported: InvoiceItemFormValues[]) {
    const first = lines[0];
    const dropBlankFirstRow =
      fields.length === 1 &&
      Boolean(first) &&
      first.description.trim() === "" &&
      !first.hsn?.trim() &&
      first.rate === 0;

    setUndo(null);
    append(imported);
    if (dropBlankFirstRow) remove(0);
  }

  /**
   * Removing offers an undo rather than asking for confirmation first.
   *
   * A confirm dialog on every removal taxes the common case (clearing a row
   * added by mistake) to protect the rare one, and it interrupts typing. Undo
   * costs the user nothing when they meant it and fully restores the row when
   * they did not — including a row that arrived from a CSV.
   */
  function handleRemove(index: number) {
    const line = lines[index];
    setUndo(
      line
        ? {
            index,
            item: {
              description: line.description,
              hsn: line.hsn ?? "",
              quantity: line.quantity,
              rate: line.rate,
              gstRate: line.gstRate,
            },
          }
        : null,
    );
    remove(index);
  }

  function handleUndo() {
    if (!undo) return;
    insert(undo.index, undo.item);
    setUndo(null);
  }

  const csv = useCsvImport(handleBulkAppend);
  // Quick Fill solves its rates against this invoice's tax branch, so it needs
  // the branch the totals panel is already showing (§6, §16).
  const quickFill = useQuickFill(
    handleBulkAppend,
    computed.isIntraState,
    styleExamples,
  );
  const quickFillPanelId = `${rowIdPrefix}quick-fill`;

  return (
    <SectionCard
      title="Items"
      description="Rate is per unit, before tax."
      actions={
        <Badge>
          {fields.length} {fields.length === 1 ? "item" : "items"}
        </Badge>
      }
      footer={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button disabled={disabled} onClick={() => append({ ...EMPTY_ITEM })}>
              <PlusIcon />
              Add item
            </Button>

            <CsvImportButton state={csv} disabled={disabled} />

            <QuickFillButton
              state={quickFill}
              panelId={quickFillPanelId}
              disabled={disabled}
            />
          </div>

          <p className="text-xs leading-relaxed text-ink-500">
            Bulk-add from a CSV with columns{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.6875rem] text-ink-700">
              {CSV_TEMPLATE_HEADER}
            </code>
            . HSN is optional, and the file never leaves your browser.
          </p>
          {/* The one place in the app that calls out, so it says so plainly. */}
          <p className="text-xs leading-relaxed text-ink-500">
            Quick Fill drafts sample items from a description using AI —
            estimates for testing, not verified purchase data. Your description
            is sent to the AI service; nothing else about the invoice is.
          </p>
        </div>
      }
    >
      {/* Column headings belong to the desktop grid only; on a phone each field
          carries its own label inside the card.

          Each heading is inset by the same 12px its control pads its text by,
          so a label sits over its value rather than over its column box. That
          also puts real space between adjacent headings: without it, the
          right-aligned "Rate" ended 6px (one grid gap) from where the
          left-aligned "GST %" began, and the two read as one run of text. */}
      <div
        aria-hidden="true"
        className={cn(
          "hidden border-b border-ink-200 pb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-500 md:grid",
          ROW_GRID,
        )}
      >
        <span className="pl-3">Description</span>
        <span className="pl-3">HSN/SAC</span>
        <span className="pr-3 text-right">Qty</span>
        <span className="pr-3 text-right">Rate</span>
        {/* Left, unlike Qty/Rate: a select renders its value left-aligned. The
            "%" lives here because the options do not carry it. */}
        <span className="pl-3">GST %</span>
        {/* Amount is a bare span, not a padded control, so its heading is flush. */}
        <span className="text-right">Amount</span>
        <span />
      </div>

      <ul className="flex flex-col gap-3 md:gap-0">
        {fields.map((field, index) => {
          const line = lines[index];
          const rowError = rowErrors?.[index];
          const only = fields.length === 1;
          const rowId = `${rowIdPrefix}item-${index}`;

          return (
            <li
              key={field.id}
              className={cn(
                "grid grid-cols-2 gap-3 rounded-xl border border-ink-200 bg-ink-50/50 p-3",
                "md:items-start md:rounded-none md:border-0 md:border-b md:border-ink-100 md:bg-transparent md:p-0 md:py-2.5",
                ROW_GRID,
              )}
            >
              {/* Card header — the row number and its remove action, phone only. */}
              <div className="col-span-2 flex items-center justify-between md:hidden">
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-500">
                  Item {index + 1}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled || only}
                  onClick={() => handleRemove(index)}
                  aria-label={`Remove item ${index + 1}`}
                >
                  <TrashIcon />
                  Remove
                </Button>
              </div>

              <div className="col-span-2 min-w-0 md:col-span-1">
                <CellLabel htmlFor={`${rowId}-description`}>
                  Description
                </CellLabel>
                <TextInput
                  id={`${rowId}-description`}
                  aria-label={`Item ${index + 1} description`}
                  aria-invalid={Boolean(rowError?.description)}
                  disabled={disabled}
                  {...register(`items.${index}.description`)}
                />
                <RowError message={rowError?.description?.message} />
              </div>

              <div className="min-w-0">
                <CellLabel htmlFor={`${rowId}-hsn`}>HSN/SAC</CellLabel>
                <TextInput
                  id={`${rowId}-hsn`}
                  aria-label={`Item ${index + 1} HSN or SAC code`}
                  placeholder="—"
                  disabled={disabled}
                  className="font-mono"
                  {...register(`items.${index}.hsn`)}
                />
              </div>

              <div className="min-w-0">
                <CellLabel htmlFor={`${rowId}-quantity`}>Qty</CellLabel>
                <TextInput
                  id={`${rowId}-quantity`}
                  type="number"
                  min={0}
                  step="any"
                  aria-label={`Item ${index + 1} quantity`}
                  aria-invalid={Boolean(rowError?.quantity)}
                  disabled={disabled}
                  className={NUMERIC_INPUT}
                  {...register(`items.${index}.quantity`, {
                    valueAsNumber: true,
                  })}
                />
                <RowError message={rowError?.quantity?.message} />
              </div>

              <div className="min-w-0">
                <CellLabel htmlFor={`${rowId}-rate`}>Rate</CellLabel>
                <TextInput
                  id={`${rowId}-rate`}
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label={`Item ${index + 1} rate per unit`}
                  aria-invalid={Boolean(rowError?.rate)}
                  disabled={disabled}
                  className={NUMERIC_INPUT}
                  {...register(`items.${index}.rate`, { valueAsNumber: true })}
                />
                <RowError message={rowError?.rate?.message} />
              </div>

              <div className="min-w-0">
                <CellLabel htmlFor={`${rowId}-gstRate`}>GST %</CellLabel>
                {/* Options are bare numbers — see ROW_GRID. The unit stays
                    available to a screen reader through the label and the
                    aria-label, which do have room for it. */}
                <Select
                  id={`${rowId}-gstRate`}
                  aria-label={`Item ${index + 1} GST rate, percent`}
                  disabled={disabled}
                  className="tabular-nums"
                  {...register(`items.${index}.gstRate`, {
                    valueAsNumber: true,
                  })}
                >
                  {GST_SLABS.map((slab) => (
                    <option key={slab} value={slab}>
                      {slab}
                    </option>
                  ))}
                </Select>
              </div>

              {/* The one number worth scanning down the column, so it is the only
                  bold thing in the row; the tax it contains stays subordinate. */}
              <div className="col-span-2 flex items-baseline justify-between gap-2 border-t border-ink-200 pt-2 md:col-span-1 md:block md:border-0 md:pt-2.5">
                <span className="text-xs font-medium text-ink-500 md:hidden">
                  Amount
                </span>
                <span className="block text-right">
                  <span className="block font-semibold tabular-nums text-ink-900">
                    {line ? formatINR(line.lineTotal) : "—"}
                  </span>
                  {line && line.gstAmount > 0 && (
                    <span className="block text-[11px] leading-tight text-ink-500">
                      incl. {formatINR(line.gstAmount)} GST
                    </span>
                  )}
                </span>
              </div>

              <div className="hidden md:flex md:justify-end md:pt-2">
                <button
                  type="button"
                  disabled={disabled || only}
                  onClick={() => handleRemove(index)}
                  aria-label={`Remove item ${index + 1}`}
                  title={only ? "An invoice needs at least one item" : "Remove"}
                  className={cn(
                    "focus-ring rounded-md p-1.5 text-ink-400 transition-colors motion-reduce:transition-none",
                    "hover:bg-red-50 hover:text-red-700",
                    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-400",
                  )}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Running totals, attached to the list like a table foot. On a phone the
          totals panel is far below the fold while items are being typed, so
          this is the only place the figures are visible as rows are added. */}
      <div className="mt-4 flex flex-wrap items-baseline justify-end gap-x-5 gap-y-1.5 rounded-lg bg-ink-50 px-3.5 py-2.5">
        <span className="mr-auto text-xs text-ink-500">
          Taxable{" "}
          <span className="font-medium tabular-nums text-ink-800">
            {formatINR(computed.subTotal)}
          </span>
        </span>
        <span className="text-xs text-ink-500">
          {computed.isIntraState ? "CGST + SGST" : "IGST"}{" "}
          <span className="font-medium tabular-nums text-ink-800">
            {formatINR(computed.totalTax)}
          </span>
        </span>
        <span className="text-sm text-ink-600">
          Items total{" "}
          <span className="font-semibold tabular-nums text-ink-900">
            ₹{formatINR(computed.grandTotalRaw)}
          </span>
        </span>
      </div>

      {listError && (
        <p className="mt-3 text-xs leading-relaxed text-red-600">{listError}</p>
      )}

      {/* Both notices sit directly under the list they describe, full width, so
          a removal and an import read as things that happened to these rows
          rather than as attachments to whichever button triggered them. */}
      <div className="mt-3 flex flex-col gap-2 empty:mt-0">
        <CsvImportFeedback state={csv} />
        <QuickFillPanel
          state={quickFill}
          id={quickFillPanelId}
          disabled={disabled}
        />
      </div>

      {undo && (
        <Notice tone="info" size="sm" className="mt-3 items-center">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Item removed.</span>
            <Button size="sm" onClick={handleUndo} disabled={disabled}>
              Undo
            </Button>
          </div>
        </Notice>
      )}
    </SectionCard>
  );
}

/** Field label shown inside the phone card; the desktop grid has column headings instead. */
function CellLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-xs font-medium text-ink-500 md:hidden"
    >
      {children}
    </label>
  );
}

function RowError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.75 4.25h10.5M6.5 4.25V3a.75.75 0 0 1 .75-.75h1.5A.75.75 0 0 1 9.5 3v1.25M4.25 4.25l.5 8.25a.75.75 0 0 0 .75.75h5a.75.75 0 0 0 .75-.75l.5-8.25" />
    </svg>
  );
}
