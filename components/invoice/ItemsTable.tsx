"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { useFieldArray, type Control } from "react-hook-form";

import { CsvImportButton } from "@/components/invoice/CsvImportButton";
import { Button } from "@/components/ui/Button";
import { Select, TextInput } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { CSV_TEMPLATE_HEADER } from "@/lib/csv";
import { formatINR } from "@/lib/format";
import type { ComputedLine } from "@/lib/gst";
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

export interface ItemsTableProps {
  control: Control<InvoiceFormValues>;
  register: UseFormRegister<InvoiceFormValues>;
  /** Computed lines from lib/gst.ts, in the same order as the rows. */
  lines: ComputedLine[];
  errors?: FieldErrors<InvoiceFormValues>["items"];
  disabled?: boolean;
}

export function ItemsTable({
  control,
  register,
  lines,
  errors,
  disabled = false,
}: ItemsTableProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  // `errors` is an array of per-row errors, plus a root error for the array itself.
  const rowErrors = Array.isArray(errors) ? errors : undefined;
  const listError = errors?.root?.message ?? errors?.message;

  /**
   * Append imported rows (§4).
   *
   * The table always opens with one blank row. Appending behind it would leave
   * that blank row in place to fail validation on save, so an untouched blank
   * first row is dropped once real rows arrive. A row the user has typed into is
   * never discarded.
   */
  function handleCsvImport(imported: InvoiceItemFormValues[]) {
    const first = lines[0];
    const dropBlankFirstRow =
      fields.length === 1 &&
      Boolean(first) &&
      first.description.trim() === "" &&
      !first.hsn?.trim() &&
      first.rate === 0;

    append(imported);
    if (dropBlankFirstRow) remove(0);
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-900">Items</h2>
        <span className="text-xs text-stone-500">
          Rate is per unit, before tax.
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-3xl border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th scope="col" className="py-2 pr-3 font-medium">
                Description
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                HSN/SAC
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Qty
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Rate
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                GST
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Taxable
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Total
              </th>
              <th scope="col" className="py-2">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {fields.map((field, index) => {
              const line = lines[index];
              const rowError = rowErrors?.[index];
              return (
                <tr
                  key={field.id}
                  className="border-b border-stone-100 align-top"
                >
                  <td className="py-2 pr-3">
                    <TextInput
                      aria-label={`Item ${index + 1} description`}
                      aria-invalid={Boolean(rowError?.description)}
                      disabled={disabled}
                      className="min-w-48"
                      {...register(`items.${index}.description`)}
                    />
                    {rowError?.description && (
                      <p className="mt-1 text-xs text-red-700">
                        {rowError.description.message}
                      </p>
                    )}
                  </td>

                  <td className="py-2 pr-3">
                    <TextInput
                      aria-label={`Item ${index + 1} HSN or SAC code`}
                      disabled={disabled}
                      className="w-24"
                      {...register(`items.${index}.hsn`)}
                    />
                  </td>

                  <td className="py-2 pr-3">
                    <TextInput
                      type="number"
                      min={0}
                      step="any"
                      aria-label={`Item ${index + 1} quantity`}
                      aria-invalid={Boolean(rowError?.quantity)}
                      disabled={disabled}
                      className="w-20 text-right tabular-nums"
                      {...register(`items.${index}.quantity`, {
                        valueAsNumber: true,
                      })}
                    />
                    {rowError?.quantity && (
                      <p className="mt-1 text-xs text-red-700">
                        {rowError.quantity.message}
                      </p>
                    )}
                  </td>

                  <td className="py-2 pr-3">
                    <TextInput
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label={`Item ${index + 1} rate per unit`}
                      aria-invalid={Boolean(rowError?.rate)}
                      disabled={disabled}
                      className="w-28 text-right tabular-nums"
                      {...register(`items.${index}.rate`, {
                        valueAsNumber: true,
                      })}
                    />
                    {rowError?.rate && (
                      <p className="mt-1 text-xs text-red-700">
                        {rowError.rate.message}
                      </p>
                    )}
                  </td>

                  <td className="py-2 pr-3">
                    <Select
                      aria-label={`Item ${index + 1} GST rate`}
                      disabled={disabled}
                      className="w-24"
                      {...register(`items.${index}.gstRate`, {
                        valueAsNumber: true,
                      })}
                    >
                      {GST_SLABS.map((slab) => (
                        <option key={slab} value={slab}>
                          {slab}%
                        </option>
                      ))}
                    </Select>
                  </td>

                  <td className="py-3 pr-3 text-right tabular-nums text-stone-700">
                    {line ? formatINR(line.taxable) : "—"}
                  </td>

                  <td className="py-3 pr-3 text-right font-medium tabular-nums text-stone-900">
                    {line ? formatINR(line.lineTotal) : "—"}
                  </td>

                  <td className="py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove item ${index + 1}`}
                      disabled={disabled || fields.length === 1}
                      onClick={() => remove(index)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {listError && (
        <p className={cn("mt-3 text-xs text-red-700")}>{listError}</p>
      )}

      <div className="mt-4 flex flex-wrap items-start gap-3">
        <Button disabled={disabled} onClick={() => append({ ...EMPTY_ITEM })}>
          Add row
        </Button>

        <CsvImportButton
          onImport={handleCsvImport}
          disabled={disabled}
          // Takes the rest of the row so the hint and the import summary get the
          // full width instead of being squeezed into a shrink-to-fit column;
          // on a phone it wraps onto its own full-width line.
          className="min-w-0 flex-1"
          hint={
            <>
              Columns: <code className="font-mono">{CSV_TEMPLATE_HEADER}</code>.
              HSN is optional.
            </>
          }
        />
      </div>
    </section>
  );
}
