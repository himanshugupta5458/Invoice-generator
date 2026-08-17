"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { ColorPicker } from "@/components/settings/ColorPicker";
import { StyleExamplesField } from "@/components/settings/StyleExamplesField";
import { Button } from "@/components/ui/Button";
import { Card, SectionCard } from "@/components/ui/Card";
import { ADDRESS_GRID, Field, TextArea, TextInput } from "@/components/ui/Field";
import { DEFAULT_ACCENT } from "@/lib/color";
import { formatStyleExamples } from "@/lib/style-examples";
import type { BusinessProfile } from "@/lib/types";
import {
  businessProfileFormSchema,
  gstinStateMismatch,
  type BusinessProfileFormValues,
} from "@/lib/validation";

/** Starting point for a new profile's terms. T&C are seller-only (§4). */
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
    // Stored as a list, edited as lines. `toProfile` parses it back (§16).
    styleExamplesText: formatStyleExamples(profile?.styleExamples),
  };
}

export interface BusinessProfileFormProps {
  /** Omit to create a new profile. */
  profile?: BusinessProfile;
  onSubmit: (values: BusinessProfileFormValues) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

/**
 * The longest form in the app, so it is the one that most needs breaking up.
 *
 * Four cards rather than one card of four `<fieldset>`s: the groups here are
 * genuinely different subjects — who you are, how you get paid, how invoices are
 * numbered and branded, and what the small print says — and a single scroll of
 * twenty inputs gives no sense of how much is left. The `<fieldset>` grouping
 * stays inside each card for assistive technology, with its legend hidden
 * because the card's own heading already says the same thing on screen.
 */
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
  const styleExamplesText = useWatch({ control, name: "styleExamplesText" });

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
      className="flex flex-col gap-6"
      noValidate
    >
      {/* An `h2`, not a PageHeader: the page this replaces still owns the `h1`
          ("Settings"), and a second one would leave the document with two. */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink-900">
          {profile ? "Edit business profile" : "New business profile"}
        </h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-500">
          These details appear on every invoice issued from this profile.
        </p>
      </div>

      <SectionCard
        title="Business details"
        description="The seller block printed at the top of the invoice."
      >
        <fieldset className={ADDRESS_GRID}>
          <legend className="sr-only">Business details</legend>

          <Field
            label="Business name"
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
            label="City"
            error={errors.city?.message}
            className="sm:col-span-3"
          >
            {(ids) => <TextInput {...ids} {...register("city")} />}
          </Field>

          <Field
            label="Email"
            error={errors.email?.message}
            className="sm:col-span-3"
          >
            {(ids) => (
              <TextInput {...ids} inputMode="email" {...register("email")} />
            )}
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
            hint="2 digits, e.g. 27 for Maharashtra."
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
            required
            error={errors.gstin?.message}
            className="sm:col-span-6"
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
      </SectionCard>

      <SectionCard
        title="Bank & payment details"
        description="Printed at the foot of the invoice so the buyer can pay you. All optional."
      >
        <fieldset className={ADDRESS_GRID}>
          <legend className="sr-only">Bank and payment details</legend>

          <Field
            label="Account name"
            error={errors.bank?.accountName?.message}
            className="sm:col-span-3"
          >
            {(ids) => <TextInput {...ids} {...register("bank.accountName")} />}
          </Field>

          <Field
            label="Account number"
            error={errors.bank?.accountNo?.message}
            className="sm:col-span-3"
          >
            {(ids) => (
              <TextInput
                {...ids}
                inputMode="numeric"
                className="font-mono"
                {...register("bank.accountNo")}
              />
            )}
          </Field>

          <Field
            label="IFSC"
            error={errors.bank?.ifsc?.message}
            className="sm:col-span-3"
          >
            {(ids) => (
              <TextInput
                {...ids}
                spellCheck={false}
                className="font-mono uppercase"
                {...register("bank.ifsc")}
              />
            )}
          </Field>

          <Field
            label="Bank name"
            error={errors.bank?.bankName?.message}
            className="sm:col-span-3"
          >
            {(ids) => <TextInput {...ids} {...register("bank.bankName")} />}
          </Field>

          <Field
            label="UPI ID"
            error={errors.bank?.upi?.message}
            className="sm:col-span-6"
          >
            {(ids) => (
              <TextInput {...ids} spellCheck={false} {...register("bank.upi")} />
            )}
          </Field>
        </fieldset>
      </SectionCard>

      <SectionCard
        title="Invoice numbering & branding"
        description="How invoices from this profile are numbered, and the colour they carry."
      >
        <fieldset className={ADDRESS_GRID}>
          <legend className="sr-only">Invoice numbering and branding</legend>

          <Field
            label="Invoice prefix"
            required
            error={errors.invoicePrefix?.message}
            hint="Prepended to the running number, e.g. SC/2026/"
            className="sm:col-span-3"
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
            className="sm:col-span-3"
          >
            {(ids) => (
              <TextInput
                {...ids}
                type="number"
                min={1}
                step={1}
                className="tabular-nums"
                {...register("nextInvoiceNumber", { valueAsNumber: true })}
              />
            )}
          </Field>

          <Field
            label="Accent colour"
            error={errors.accentColor?.message}
            className="sm:col-span-6"
            hint="Used for the invoice heading, table header, and totals band. It is this profile's colour, not the app's — invoices from different profiles come out in different colours."
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
            className="sm:col-span-6"
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
                    className="h-12 w-auto rounded-lg border border-ink-200 bg-white object-contain p-1"
                  />
                )}
                <input
                  {...ids}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  onChange={(event) => void handleLogo(event.target.files?.[0])}
                  className="focus-ring rounded-lg text-sm text-ink-600 file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border file:border-ink-300 file:bg-white file:px-3 file:text-sm file:font-medium file:text-ink-800 hover:file:bg-ink-50"
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
      </SectionCard>

      <SectionCard
        title="Terms & conditions"
        description="Printed on every invoice from this profile. This is the only place they can be edited — the builder has no field for them (§4)."
      >
        <Field
          label="Default terms & conditions"
          error={errors.termsAndConditions?.message}
        >
          {(ids) => (
            <TextArea {...ids} rows={6} {...register("termsAndConditions")} />
          )}
        </Field>
      </SectionCard>

      {/* Last, and collapsed: this is the only section of the form that can be
          skipped outright, and it should not sit between the user and the
          fields that actually have to be filled in. */}
      <StyleExamplesField
        value={styleExamplesText ?? ""}
        onChange={(next) =>
          setValue("styleExamplesText", next, { shouldDirty: true })
        }
        disabled={disabled}
      />

      <Card className="px-5 py-4 sm:px-6">
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={disabled}>
            {profile ? "Save changes" : "Create profile"}
          </Button>
          <Button onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
        </div>
      </Card>
    </form>
  );
}
