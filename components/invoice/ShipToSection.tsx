"use client";

import type { UseFormRegister } from "react-hook-form";

import { Field, TextArea, TextInput } from "@/components/ui/Field";
import type { InvoiceFormValues } from "@/lib/validation";

export interface ShipToSectionProps {
  register: UseFormRegister<InvoiceFormValues>;
  sameAsBilling: boolean;
  onToggle: (sameAsBilling: boolean) => void;
  errors?: {
    name?: string;
    address?: string;
    state?: string;
    stateCode?: string;
    gstin?: string;
  };
  disabled?: boolean;
}

/**
 * Optional shipping party (§4). Collapsed to a single checkbox by default so it
 * reads as a secondary step next to Bill To.
 *
 * Ship To is display-only: it never affects the CGST/SGST vs IGST decision,
 * which is always based on the Bill To buyer's state (§6).
 */
export function ShipToSection({
  register,
  sameAsBilling,
  onToggle,
  errors = {},
  disabled = false,
}: ShipToSectionProps) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-900">Ship To</h2>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={sameAsBilling}
            disabled={disabled}
            onChange={(event) => onToggle(event.target.checked)}
            className="size-4 rounded border-stone-300 text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
          />
          Same as Bill To
        </label>
      </div>

      {sameAsBilling ? (
        <p className="mt-2 text-sm text-stone-500">
          Goods ship to the billing address. Uncheck to enter a different
          shipping party.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-stone-500">
            Shown on the invoice only — the tax split still follows the Bill To
            buyer&rsquo;s state.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Shipping name" required error={errors.name}>
              {(ids) => (
                <TextInput {...ids} disabled={disabled} {...register("shipTo.name")} />
              )}
            </Field>

            <Field label="GSTIN" error={errors.gstin}>
              {(ids) => (
                <TextInput
                  {...ids}
                  disabled={disabled}
                  maxLength={15}
                  spellCheck={false}
                  className="font-mono uppercase"
                  {...register("shipTo.gstin")}
                />
              )}
            </Field>

            <Field
              label="Shipping address"
              required
              error={errors.address}
              className="sm:col-span-2"
            >
              {(ids) => (
                <TextArea
                  {...ids}
                  rows={2}
                  disabled={disabled}
                  {...register("shipTo.address")}
                />
              )}
            </Field>

            <Field label="State" required error={errors.state}>
              {(ids) => (
                <TextInput {...ids} disabled={disabled} {...register("shipTo.state")} />
              )}
            </Field>

            <Field label="State code" required error={errors.stateCode}>
              {(ids) => (
                <TextInput
                  {...ids}
                  inputMode="numeric"
                  maxLength={2}
                  placeholder="27"
                  disabled={disabled}
                  {...register("shipTo.stateCode")}
                />
              )}
            </Field>
          </div>
        </>
      )}
    </section>
  );
}
