"use client";

import type { UseFormRegister } from "react-hook-form";

import { SectionCard } from "@/components/ui/Card";
import {
  ADDRESS_GRID,
  Checkbox,
  Field,
  TextArea,
  TextInput,
} from "@/components/ui/Field";
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
 * The toggle lives in the card header rather than in the body, which is what
 * keeps the weight right: collapsed, this section is one line of chrome and no
 * form at all, so it cannot compete with Bill To for attention.
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
    <SectionCard
      title="Ship To"
      description={
        sameAsBilling
          ? "Goods ship to the billing address. Uncheck to enter a different shipping party."
          : "Shown on the invoice only — the tax split still follows the Bill To buyer’s state."
      }
      actions={
        <label
          className={
            disabled
              ? "flex cursor-not-allowed items-center gap-2 text-sm text-ink-400"
              : "flex cursor-pointer items-center gap-2 text-sm text-ink-600"
          }
        >
          <Checkbox
            checked={sameAsBilling}
            disabled={disabled}
            onChange={(event) => onToggle(event.target.checked)}
          />
          Same as Bill To
        </label>
      }
      // Collapsed, the card is header-only; padding an empty body would leave a
      // stripe of white under the rule with nothing in it.
      bare={sameAsBilling}
    >
      {sameAsBilling ? null : (
        <div className={ADDRESS_GRID}>
          <Field
            label="Shipping name"
            required
            error={errors.name}
            className="sm:col-span-4"
          >
            {(ids) => (
              <TextInput
                {...ids}
                disabled={disabled}
                {...register("shipTo.name")}
              />
            )}
          </Field>

          <Field label="GSTIN" error={errors.gstin} className="sm:col-span-2">
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
            className="sm:col-span-6"
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

          <Field
            label="State"
            required
            error={errors.state}
            className="sm:col-span-4"
          >
            {(ids) => (
              <TextInput
                {...ids}
                disabled={disabled}
                {...register("shipTo.state")}
              />
            )}
          </Field>

          <Field
            label="State code"
            required
            error={errors.stateCode}
            className="sm:col-span-2"
          >
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
      )}
    </SectionCard>
  );
}
