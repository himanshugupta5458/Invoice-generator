"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { ColorPicker } from "@/components/settings/ColorPicker";
import { Button } from "@/components/ui/Button";
import { Field, TextArea, TextInput } from "@/components/ui/Field";
import { DEFAULT_ACCENT } from "@/lib/color";
import type { BusinessProfile } from "@/lib/types";
import {
  businessProfileFormSchema,
  gstinStateMismatch,
  type BusinessProfileFormValues,
} from "@/lib/validation";

/** Starting point for a new profile's terms; editable per invoice later (§4). */
const DEFAULT_TERMS = `1. Goods once sold will not be taken back or exchanged.
2. Payment is due within 15 days of the invoice date.
3. Interest at 18% per annum is chargeable on overdue amounts.
4. All disputes are subject to local jurisdiction.`;

/** Rejected above this size — base64 logos are stored in localStorage (§7). */
const MAX_LOGO_BYTES = 200 * 1024;

function toFormValues(profile?: BusinessProfile): BusinessProfileFormValues {
  return {
    name: profile?.name ?? "",
    address: profile?.address ?? "",
    city: profile?.city ?? "",
    state: profile?.state ?? "",
    stateCode: profile?.stateCode ?? "",
    gstin: profile?.gstin ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    bank: {
      accountName: profile?.bank.accountName ?? "",
      accountNo: profile?.bank.accountNo ?? "",
      ifsc: profile?.bank.ifsc ?? "",
      bankName: profile?.bank.bankName ?? "",
      upi: profile?.bank.upi ?? "",
    },
    logoDataUrl: profile?.logoDataUrl,
    invoicePrefix: profile?.invoicePrefix ?? "",
    nextInvoiceNumber: profile?.nextInvoiceNumber ?? 1,
    accentColor: profile?.accentColor ?? DEFAULT_ACCENT,
    termsAndConditions: profile?.termsAndConditions ?? DEFAULT_TERMS,
  };
}

export interface BusinessProfileFormProps {
  /** Omit to create a new profile. */
  profile?: BusinessProfile;
  onSubmit: (values: BusinessProfileFormValues) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

export function BusinessProfileForm({
  profile,
  onSubmit,
  onCancel,
  busy = false,
}: BusinessProfileFormProps) {
  const [logoError, setLogoError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BusinessProfileFormValues>({
    resolver: zodResolver(businessProfileFormSchema),
    defaultValues: toFormValues(profile),
  });

  // useWatch (rather than watch()) so these stay plain subscribed values.
  const accentColor = useWatch({ control, name: "accentColor" });
  const logoDataUrl = useWatch({ control, name: "logoDataUrl" });
  const gstin = useWatch({ control, name: "gstin" });
  const stateCode = useWatch({ control, name: "stateCode" });

  // Section 4 asks for a warning, not a rejection: a GSTIN whose first two
  // digits differ from the state code is usually a typo, but can be legitimate.
  const stateMismatch = gstinStateMismatch(gstin ?? "", stateCode ?? "");

  async function handleLogo(file: File | undefined) {
    setLogoError(null);
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("Logo must be under 200 KB — browser storage is limited.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setValue("logoDataUrl", dataUrl, { shouldDirty: true });
  }

  const disabled = busy || isSubmitting;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-6 rounded-lg border border-stone-200 bg-white p-4 sm:p-6"
      noValidate
    >
      <div>
        <h3 className="text-base font-semibold text-stone-900">
          {profile ? "Edit business profile" : "New business profile"}
        </h3>
        <p className="mt-0.5 text-sm text-stone-500">
          These details appear on every invoice issued from this profile.
        </p>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Business details</legend>

        <Field label="Business name" required error={errors.name?.message}>
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

        <Field label="City" error={errors.city?.message}>
          {(ids) => <TextInput {...ids} {...register("city")} />}
        </Field>

        <Field label="Email" error={errors.email?.message}>
          {(ids) => (
            <TextInput {...ids} inputMode="email" {...register("email")} />
          )}
        </Field>

        <Field label="State" required error={errors.state?.message}>
          {(ids) => <TextInput {...ids} {...register("state")} />}
        </Field>

        <Field
          label="State code"
          required
          error={errors.stateCode?.message}
          hint="2 digits, e.g. 27 for Maharashtra."
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
          required
          error={errors.gstin?.message}
          className="sm:col-span-2"
          warning={
            stateMismatch
              ? `This GSTIN starts with ${gstin.trim().slice(0, 2)} but the state code is ${stateCode.trim()} — check they match.`
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
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-stone-900">
          Bank &amp; payment details
        </legend>

        <Field label="Account name" error={errors.bank?.accountName?.message}>
          {(ids) => <TextInput {...ids} {...register("bank.accountName")} />}
        </Field>

        <Field label="Account number" error={errors.bank?.accountNo?.message}>
          {(ids) => (
            <TextInput {...ids} inputMode="numeric" {...register("bank.accountNo")} />
          )}
        </Field>

        <Field label="IFSC" error={errors.bank?.ifsc?.message}>
          {(ids) => (
            <TextInput
              {...ids}
              spellCheck={false}
              className="font-mono uppercase"
              {...register("bank.ifsc")}
            />
          )}
        </Field>

        <Field label="Bank name" error={errors.bank?.bankName?.message}>
          {(ids) => <TextInput {...ids} {...register("bank.bankName")} />}
        </Field>

        <Field
          label="UPI ID"
          error={errors.bank?.upi?.message}
          className="sm:col-span-2"
        >
          {(ids) => <TextInput {...ids} spellCheck={false} {...register("bank.upi")} />}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-stone-900">
          Invoice numbering &amp; branding
        </legend>

        <Field
          label="Invoice prefix"
          required
          error={errors.invoicePrefix?.message}
          hint="Prepended to the running number, e.g. SC/2026/"
        >
          {(ids) => (
            <TextInput
              {...ids}
              placeholder="SC/2026/"
              spellCheck={false}
              className="font-mono"
              {...register("invoicePrefix")}
            />
          )}
        </Field>

        <Field
          label="Next invoice number"
          required
          error={errors.nextInvoiceNumber?.message}
          hint="Increments automatically when an invoice is saved."
        >
          {(ids) => (
            <TextInput
              {...ids}
              type="number"
              min={1}
              step={1}
              {...register("nextInvoiceNumber", { valueAsNumber: true })}
            />
          )}
        </Field>

        <Field
          label="Accent colour"
          error={errors.accentColor?.message}
          className="sm:col-span-2"
          hint="Used for the invoice heading, table header, and totals band."
        >
          {(ids) => (
            <ColorPicker
              id={ids.id}
              aria-describedby={ids["aria-describedby"]}
              value={accentColor}
              onChange={(hex) =>
                setValue("accentColor", hex, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
          )}
        </Field>

        <Field
          label="Logo"
          error={logoError ?? undefined}
          className="sm:col-span-2"
          hint="Optional. PNG or JPG under 200 KB."
        >
          {(ids) => (
            <div className="flex flex-wrap items-center gap-3">
              {logoDataUrl && (
                // A user-supplied data URL — next/image adds nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoDataUrl}
                  alt="Current logo"
                  className="h-12 w-auto rounded border border-stone-200 bg-white object-contain p-1"
                />
              )}
              <input
                {...ids}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={(event) => void handleLogo(event.target.files?.[0])}
                className="text-sm text-stone-600 file:mr-3 file:rounded-md file:border file:border-stone-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-stone-100"
              />
              {logoDataUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setValue("logoDataUrl", undefined, { shouldDirty: true })
                  }
                >
                  Remove
                </Button>
              )}
            </div>
          )}
        </Field>
      </fieldset>

      <Field
        label="Default terms & conditions"
        error={errors.termsAndConditions?.message}
        hint="Pre-filled on every invoice from this profile, and editable per invoice."
      >
        {(ids) => <TextArea {...ids} rows={5} {...register("termsAndConditions")} />}
      </Field>

      <div className="flex flex-wrap gap-2 border-t border-stone-200 pt-4">
        <Button type="submit" variant="primary" disabled={disabled}>
          {profile ? "Save changes" : "Create profile"}
        </Button>
        <Button onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
