"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/Card";
import { ADDRESS_GRID, Field, TextArea, TextInput } from "@/components/ui/Field";
import type { SavedBuyer } from "@/lib/types";
import {
  buyerFormSchema,
  gstinStateMismatch,
  type BuyerFormValues,
} from "@/lib/validation";

function toFormValues(buyer?: SavedBuyer): BuyerFormValues {
  return {
    name: buyer?.name ?? "",
    address: buyer?.address ?? "",
    state: buyer?.state ?? "",
    stateCode: buyer?.stateCode ?? "",
    gstin: buyer?.gstin ?? "",
    phone: buyer?.phone ?? "",
  };
}

export interface BuyerFormProps {
  /** Omit to create a new buyer. */
  buyer?: SavedBuyer;
  onSubmit: (values: BuyerFormValues) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

export function BuyerForm({
  buyer,
  onSubmit,
  onCancel,
  busy = false,
}: BuyerFormProps) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BuyerFormValues>({
    resolver: zodResolver(buyerFormSchema),
    defaultValues: toFormValues(buyer),
  });

  const gstin = useWatch({ control, name: "gstin" });
  const stateCode = useWatch({ control, name: "stateCode" });

  // A warning, never a block — the same treatment the business profile gets
  // (§4). It matters more here: this state code, not the seller's alone, is what
  // decides whether the invoice is CGST + SGST or IGST (§6).
  const stateMismatch = gstinStateMismatch(gstin ?? "", stateCode ?? "");

  const disabled = busy || isSubmitting;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <SectionCard
        title={buyer ? "Edit buyer" : "New buyer"}
        description="Saved buyers can be picked on an invoice. Editing one here never changes an invoice that has already been issued."
        // The actions live in the card's footer band so "Save" and "Cancel" sit
        // on the edge of the thing they act on, in the same place on every form.
        footer={
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={disabled}>
              {buyer ? "Save changes" : "Add buyer"}
            </Button>
            <Button onClick={onCancel} disabled={disabled}>
              Cancel
            </Button>
          </div>
        }
      >
        {/* The same six-column grid the invoice builder's Bill To uses, so the
            two ways of entering a buyer are visibly the same form. */}
        <div className={ADDRESS_GRID}>
          <Field
            label="Buyer name"
            required
            error={errors.name?.message}
            className="sm:col-span-4"
          >
            {(ids) => <TextInput {...ids} {...register("name")} />}
          </Field>

          <Field
            label="Phone"
            error={errors.phone?.message}
            className="sm:col-span-2"
          >
            {(ids) => (
              <TextInput {...ids} inputMode="tel" {...register("phone")} />
            )}
          </Field>

          <Field
            label="Address"
            required
            error={errors.address?.message}
            className="sm:col-span-6"
          >
            {(ids) => <TextArea {...ids} rows={2} {...register("address")} />}
          </Field>

          <Field
            label="State"
            required
            error={errors.state?.message}
            className="sm:col-span-4"
          >
            {(ids) => <TextInput {...ids} {...register("state")} />}
          </Field>

          <Field
            label="State code"
            required
            error={errors.stateCode?.message}
            hint="Decides CGST + SGST vs IGST on the invoice."
            className="sm:col-span-2"
          >
            {(ids) => (
              <TextInput
                {...ids}
                inputMode="numeric"
                maxLength={2}
                placeholder="27"
                {...register("stateCode")}
              />
            )}
          </Field>

          <Field
            label="GSTIN"
            error={errors.gstin?.message}
            className="sm:col-span-6"
            hint="Optional — leave blank for an unregistered buyer."
            warning={
              stateMismatch
                ? `This GSTIN starts with ${gstin?.trim().slice(0, 2)} but the state code is ${stateCode?.trim()} — check they match.`
                : undefined
            }
          >
            {(ids) => (
              <TextInput
                {...ids}
                placeholder="27ABCDE1234F1Z5"
                maxLength={15}
                spellCheck={false}
                className="font-mono uppercase"
                {...register("gstin")}
              />
            )}
          </Field>
        </div>
      </SectionCard>
    </form>
  );
}
