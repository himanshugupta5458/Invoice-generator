"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Field, TextArea, TextInput } from "@/components/ui/Field";
import type { SavedBuyer } from "@/lib/types";
import { buyerFormSchema, type BuyerFormValues } from "@/lib/validation";

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
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BuyerFormValues>({
    resolver: zodResolver(buyerFormSchema),
    defaultValues: toFormValues(buyer),
  });

  const disabled = busy || isSubmitting;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-4 sm:p-6"
      noValidate
    >
      <div>
        <h3 className="text-base font-semibold text-stone-900">
          {buyer ? "Edit buyer" : "New buyer"}
        </h3>
        <p className="mt-0.5 text-sm text-stone-500">
          Saved buyers can be picked on an invoice. Editing one here never
          changes an invoice that has already been issued.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Buyer name" required error={errors.name?.message}>
          {(ids) => <TextInput {...ids} {...register("name")} />}
        </Field>

        <Field label="Phone" error={errors.phone?.message}>
          {(ids) => <TextInput {...ids} inputMode="tel" {...register("phone")} />}
        </Field>

        <Field
          label="Address"
          required
          error={errors.address?.message}
          className="sm:col-span-2"
        >
          {(ids) => <TextArea {...ids} rows={2} {...register("address")} />}
        </Field>

        <Field label="State" required error={errors.state?.message}>
          {(ids) => <TextInput {...ids} {...register("state")} />}
        </Field>

        <Field
          label="State code"
          required
          error={errors.stateCode?.message}
          hint="Decides CGST + SGST vs IGST on the invoice."
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
          className="sm:col-span-2"
          hint="Optional — leave blank for an unregistered buyer."
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

      <div className="flex flex-wrap gap-2 border-t border-stone-200 pt-4">
        <Button type="submit" variant="primary" disabled={disabled}>
          {buyer ? "Save changes" : "Add buyer"}
        </Button>
        <Button onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
