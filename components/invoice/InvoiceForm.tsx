"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { BuyerSelect } from "@/components/invoice/BuyerSelect";
import { DownloadPdfButton } from "@/components/invoice/DownloadPdfButton";
import type { InvoicePdfProps } from "@/components/invoice/InvoicePdf";
import { EMPTY_ITEM, ItemsTable } from "@/components/invoice/ItemsTable";
import { InvoicePreview } from "@/components/invoice/InvoicePreview";
import { ShipToSection } from "@/components/invoice/ShipToSection";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, EmptyState, SectionCard } from "@/components/ui/Card";
import {
  ADDRESS_GRID,
  CheckboxField,
  Field,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { StorageErrorBanner } from "@/components/ui/StorageErrorBanner";
import { FilePlusIcon } from "@/components/ui/icons";
import { formatINR } from "@/lib/format";
import { computeInvoice } from "@/lib/gst";
import { createId } from "@/lib/repository";
import { useHydratedStore, useInvoiceStore } from "@/lib/store";
import type { BusinessProfile, SavedBuyer } from "@/lib/types";
import {
  gstinStateMismatch,
  invoiceFormSchema,
  toBuyer,
  toInvoice,
  toSavedBuyer,
  type InvoiceFormValues,
} from "@/lib/validation";

const BLANK_BUYER = {
  name: "",
  address: "",
  state: "",
  stateCode: "",
  gstin: "",
  phone: "",
};

const BLANK_SHIP_TO = {
  name: "",
  address: "",
  state: "",
  stateCode: "",
  gstin: "",
};

function blankInvoice(): InvoiceFormValues {
  return {
    businessProfileId: "",
    invoiceNumber: "",
    // Filled in on mount — computing "today" during render would not match
    // what the server rendered.
    date: "",
    buyerId: "",
    buyer: { ...BLANK_BUYER },
    saveBuyer: false,
    sameAsBilling: true,
    shipTo: { ...BLANK_SHIP_TO },
    items: [{ ...EMPTY_ITEM }],
    notes: "",
  };
}

function today(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** A stand-in used only to keep the totals panel rendering before a profile is picked. */
const PLACEHOLDER_PROFILE: BusinessProfile = {
  id: "",
  name: "",
  address: "",
  city: "",
  state: "",
  stateCode: "",
  gstin: "",
  phone: "",
  email: "",
  bank: { accountName: "", accountNo: "", ifsc: "", bankName: "", upi: "" },
  invoicePrefix: "",
  nextInvoiceNumber: 1,
  accentColor: "#7a5230",
};

export function InvoiceForm() {
  const hydrated = useHydratedStore();
  const profiles = useInvoiceStore((state) => state.profiles);
  const buyers = useInvoiceStore((state) => state.buyers);
  const saveInvoice = useInvoiceStore((state) => state.saveInvoice);
  const saveBuyerRecord = useInvoiceStore((state) => state.saveBuyer);
  const saveProfile = useInvoiceStore((state) => state.saveProfile);
  const busy = useInvoiceStore((state) => state.busy);

  const [showPreview, setShowPreview] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: blankInvoice(),
  });

  // useWatch rather than watch() so React Compiler can still optimise this.
  const businessProfileId = useWatch({ control, name: "businessProfileId" });
  const buyerId = useWatch({ control, name: "buyerId" });
  const buyerValues = useWatch({ control, name: "buyer" });
  const sameAsBilling = useWatch({ control, name: "sameAsBilling" });
  const shipToValues = useWatch({ control, name: "shipTo" });
  const items = useWatch({ control, name: "items" });
  const invoiceNumber = useWatch({ control, name: "invoiceNumber" });
  const date = useWatch({ control, name: "date" });
  const notes = useWatch({ control, name: "notes" });

  const profile = profiles.find((entry) => entry.id === businessProfileId);

  // A buyer typed straight into this form never passes through the buyer form,
  // so the §4 GSTIN / state-code warning is repeated here. It is advisory: this
  // state code decides CGST + SGST vs IGST (§6), so a typo is worth catching
  // before the invoice is issued, but a genuine mismatch must not block a save.
  const buyerStateMismatch = gstinStateMismatch(
    buyerValues?.gstin ?? "",
    buyerValues?.stateCode ?? "",
  );

  // Date is set after mount so the server and client render the same markup.
  useEffect(() => {
    setValue("date", today());
  }, [setValue]);

  // Picking a profile fills the invoice number from its prefix + running number.
  // Terms are not touched here — they are seller-only and come straight from the
  // profile at preview and save time (§4).
  useEffect(() => {
    if (!profile) return;
    setValue(
      "invoiceNumber",
      `${profile.invoicePrefix}${profile.nextInvoiceNumber}`,
    );
  }, [profile, setValue]);

  // Totals recompute on every change (§4). The tax branch comes from the
  // seller's and Bill To buyer's state codes only — Ship To is not passed in.
  const computed = useMemo(
    () =>
      computeInvoice(
        profile ?? PLACEHOLDER_PROFILE,
        toBuyer(buyerValues ?? BLANK_BUYER),
        items ?? [],
      ),
    [profile, buyerValues, items],
  );

  // Built once and handed to both the preview and the PDF, so what is on screen
  // and what is downloaded cannot describe different invoices. Null until a
  // profile is chosen, which is what gates the Download button.
  const pdfProps = useMemo<InvoicePdfProps | null>(() => {
    if (!profile) return null;
    return {
      business: profile,
      buyer: toBuyer(buyerValues ?? BLANK_BUYER),
      shipTo: sameAsBilling
        ? undefined
        : {
            name: shipToValues?.name ?? "",
            address: shipToValues?.address ?? "",
            state: shipToValues?.state ?? "",
            stateCode: shipToValues?.stateCode ?? "",
            gstin: shipToValues?.gstin || undefined,
          },
      invoiceNumber,
      date,
      computed,
      // Straight from the profile — the same value toInvoice() will freeze in.
      termsAndConditions: profile.termsAndConditions || undefined,
      notes: notes || undefined,
      accentColor: profile.accentColor,
      // Nothing is saved yet, so the badge shows the status this invoice would
      // get on save (§4); /invoices re-downloads with the stored status.
      status: "paid",
    };
  }, [
    profile,
    buyerValues,
    sameAsBilling,
    shipToValues,
    invoiceNumber,
    date,
    computed,
    notes,
  ]);

  function handleBuyerSelect(buyer: SavedBuyer | null) {
    if (!buyer) {
      setValue("buyerId", "");
      setValue("buyer", { ...BLANK_BUYER });
      return;
    }
    setValue("buyerId", buyer.id);
    setValue("buyer", {
      name: buyer.name,
      address: buyer.address,
      state: buyer.state,
      stateCode: buyer.stateCode,
      gstin: buyer.gstin ?? "",
      phone: buyer.phone ?? "",
    });
    setValue("saveBuyer", false);
  }

  async function onSubmit(values: InvoiceFormValues) {
    if (!profile) return;
    setSavedNotice(null);

    const saved = await saveInvoice(toInvoice(values, profile, createId()));
    // Browser storage can refuse the write (quota, private mode). The banner is
    // already showing why; claiming success, clearing the form, and burning an
    // invoice number on top of that would lose the user's work.
    if (!saved) return;

    // "Save this buyer for next time" (§4) — only for a buyer typed in fresh.
    if (values.saveBuyer && values.buyerId === "") {
      await saveBuyerRecord(toSavedBuyer(values.buyer, createId()));
    }

    // Advance the profile's running number so the next invoice is unique.
    const nextNumber = profile.nextInvoiceNumber + 1;
    await saveProfile({ ...profile, nextInvoiceNumber: nextNumber });

    setSavedNotice(`Invoice ${values.invoiceNumber} saved as paid.`);
    setShowPreview(false);
    reset({
      ...blankInvoice(),
      businessProfileId: profile.id,
      date: today(),
      invoiceNumber: `${profile.invoicePrefix}${nextNumber}`,
    });
  }

  const locked = !profile;
  const disabled = busy || isSubmitting;

  if (hydrated && profiles.length === 0) {
    return (
      <EmptyState
        icon={<FilePlusIcon className="size-6" />}
        title="No business profiles yet"
        description="An invoice is issued by a business, so add one in Settings — its name, GSTIN and accent colour — and the builder unlocks."
        action={
          <Link href="/settings" className={buttonClasses("primary")}>
            Go to Settings
          </Link>
        }
      />
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-6"
    >
      <StorageErrorBanner />

      {savedNotice && <Notice tone="success">{savedNotice}</Notice>}

      <SectionCard
        title="Invoice details"
        description="Who is issuing this invoice, and under what number."
      >
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-6">
          <Field
            label="Business profile"
            required
            error={errors.businessProfileId?.message}
            // Only while it is still true. Left up permanently, a hint about
            // unlocking the form sits under a form that is already unlocked.
            hint={
              locked ? "Everything else unlocks once a profile is selected." : undefined
            }
            className="sm:col-span-3"
          >
            {(ids) => (
              <Select {...ids} {...register("businessProfileId")}>
                <option value="">Select a profile…</option>
                {profiles.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Invoice number"
            required
            error={errors.invoiceNumber?.message}
            className="sm:col-span-2"
          >
            {(ids) => (
              <TextInput
                {...ids}
                disabled={locked}
                className="font-mono"
                {...register("invoiceNumber")}
              />
            )}
          </Field>

          <Field
            label="Date"
            required
            error={errors.date?.message}
            className="sm:col-span-1"
          >
            {(ids) => (
              <TextInput
                {...ids}
                type="date"
                disabled={locked}
                {...register("date")}
              />
            )}
          </Field>
        </div>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* Dimmed rather than hidden while locked (§9): the sections stay
            readable, so a first-time user can see what the form will ask for
            before committing to a profile. */}
        <div
          className={
            locked
              ? "flex flex-col gap-6 opacity-60 transition-opacity motion-reduce:transition-none"
              : "flex flex-col gap-6 transition-opacity motion-reduce:transition-none"
          }
        >
          <SectionCard
            title="Bill To"
            description="This buyer’s state decides whether the invoice is CGST + SGST or IGST."
          >
            <div className="flex flex-col gap-5">
              {/* The combobox loads a buyer rather than being a field of one, so
                  it sits above the rule and the typed-in details below it. */}
              <Field
                label="Saved buyer"
                hint="Autofills the details below. Editing them afterwards changes this invoice only."
              >
                {(ids) => (
                  <BuyerSelect
                    id={ids.id}
                    buyers={buyers}
                    selectedId={buyerId}
                    onSelect={handleBuyerSelect}
                    disabled={locked}
                  />
                )}
              </Field>

              <div className={`${ADDRESS_GRID} border-t border-ink-100 pt-5`}>
                <Field
                  label="Buyer name"
                  required
                  error={errors.buyer?.name?.message}
                  className="sm:col-span-4"
                >
                  {(ids) => (
                    <TextInput
                      {...ids}
                      disabled={locked}
                      {...register("buyer.name")}
                    />
                  )}
                </Field>

                <Field
                  label="Phone"
                  error={errors.buyer?.phone?.message}
                  className="sm:col-span-2"
                >
                  {(ids) => (
                    <TextInput
                      {...ids}
                      inputMode="tel"
                      disabled={locked}
                      {...register("buyer.phone")}
                    />
                  )}
                </Field>

                <Field
                  label="Address"
                  required
                  error={errors.buyer?.address?.message}
                  className="sm:col-span-6"
                >
                  {(ids) => (
                    <TextArea
                      {...ids}
                      rows={2}
                      disabled={locked}
                      {...register("buyer.address")}
                    />
                  )}
                </Field>

                <Field
                  label="State"
                  required
                  error={errors.buyer?.state?.message}
                  className="sm:col-span-4"
                >
                  {(ids) => (
                    <TextInput
                      {...ids}
                      disabled={locked}
                      {...register("buyer.state")}
                    />
                  )}
                </Field>

                <Field
                  label="State code"
                  required
                  error={errors.buyer?.stateCode?.message}
                  className="sm:col-span-2"
                >
                  {(ids) => (
                    <TextInput
                      {...ids}
                      inputMode="numeric"
                      maxLength={2}
                      placeholder="27"
                      disabled={locked}
                      {...register("buyer.stateCode")}
                    />
                  )}
                </Field>

                <Field
                  label="GSTIN"
                  error={errors.buyer?.gstin?.message}
                  className="sm:col-span-6"
                  hint="Optional — leave blank for an unregistered buyer."
                  warning={
                    buyerStateMismatch
                      ? `This GSTIN starts with ${buyerValues?.gstin?.trim().slice(0, 2)} but the state code is ${buyerValues?.stateCode?.trim()} — check they match.`
                      : undefined
                  }
                >
                  {(ids) => (
                    <TextInput
                      {...ids}
                      maxLength={15}
                      spellCheck={false}
                      disabled={locked}
                      className="font-mono uppercase"
                      {...register("buyer.gstin")}
                    />
                  )}
                </Field>
              </div>

              {buyerId === "" ? (
                <CheckboxField
                  label="Save this buyer for next time"
                  description="Adds them to the saved-buyer list so the details autofill on the next invoice."
                  disabled={locked}
                  {...register("saveBuyer")}
                />
              ) : (
                <p className="text-xs leading-relaxed text-ink-500">
                  Edits here apply to this invoice only — the saved buyer record
                  is left unchanged.
                </p>
              )}
            </div>
          </SectionCard>

          <ShipToSection
            register={register}
            sameAsBilling={sameAsBilling}
            onToggle={(value) => setValue("sameAsBilling", value)}
            disabled={locked}
            errors={{
              name: errors.shipTo?.name?.message,
              address: errors.shipTo?.address?.message,
              state: errors.shipTo?.state?.message,
              stateCode: errors.shipTo?.stateCode?.message,
              gstin: errors.shipTo?.gstin?.message,
            }}
          />

          <ItemsTable
            control={control}
            register={register}
            computed={computed}
            // From the selected profile only, so Quick Fill writes in this
            // business's vocabulary and never in another's (§16, v1.2).
            styleExamples={profile?.styleExamples}
            errors={errors.items}
            disabled={locked}
          />

          <SectionCard
            // Not "Notes": the field inside is already labelled that, and a card
            // whose heading repeats its only label says nothing twice.
            title="Notes & terms"
            description={
              // T&C are seller-only (§4) — there is no field for them here,
              // so say where they do come from rather than leave a gap.
              <>
                Shown at the foot of the invoice. Terms &amp; conditions come
                from the business profile —{" "}
                <Link
                  href="/settings"
                  className="focus-ring rounded font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
                >
                  edit them in Settings
                </Link>
                .
              </>
            }
          >
            <Field label="Notes" error={errors.notes?.message}>
              {(ids) => (
                <TextArea
                  {...ids}
                  rows={3}
                  placeholder="Anything the buyer should see on this invoice."
                  disabled={locked}
                  {...register("notes")}
                />
              )}
            </Field>
          </SectionCard>
        </div>

        {/* Live totals stay visible while items are edited (§9). Sticky at `lg`;
            below it the running totals under the items list carry the job. */}
        <aside className="lg:sticky lg:top-10">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <h2 className="text-sm font-semibold tracking-tight text-ink-900">
                Totals
              </h2>
              <Badge>{computed.isIntraState ? "CGST + SGST" : "IGST"}</Badge>
            </div>

            <p className="px-5 pt-4 text-xs leading-relaxed text-ink-500">
              {computed.isIntraState
                ? "Intra-state supply — the tax splits in half between centre and state."
                : "Inter-state supply — a single integrated tax."}
            </p>

            <dl className="px-5 py-4 text-sm">
              <div className="flex items-baseline justify-between gap-3 py-1.5">
                <dt className="text-ink-500">Taxable value</dt>
                <dd className="font-medium tabular-nums text-ink-900">
                  {formatINR(computed.subTotal)}
                </dd>
              </div>

              {computed.isIntraState ? (
                <>
                  <div className="flex items-baseline justify-between gap-3 py-1.5">
                    <dt className="text-ink-500">CGST</dt>
                    <dd className="font-medium tabular-nums text-ink-900">
                      {formatINR(computed.totalCgst)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 py-1.5">
                    <dt className="text-ink-500">SGST</dt>
                    <dd className="font-medium tabular-nums text-ink-900">
                      {formatINR(computed.totalSgst)}
                    </dd>
                  </div>
                </>
              ) : (
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <dt className="text-ink-500">IGST</dt>
                  <dd className="font-medium tabular-nums text-ink-900">
                    {formatINR(computed.totalIgst)}
                  </dd>
                </div>
              )}

              <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-ink-100 pt-2.5">
                <dt className="text-ink-500">Round off</dt>
                <dd className="font-medium tabular-nums text-ink-900">
                  {computed.roundOff >= 0 ? "+" : "−"}
                  {formatINR(Math.abs(computed.roundOff))}
                </dd>
              </div>
            </dl>

            {/* The one figure the whole panel exists for, so it gets the band.
                Brand-tinted because this is app chrome — the accent band on the
                invoice document itself is the business profile's colour, and the
                two are deliberately different systems. */}
            <div className="flex items-baseline justify-between gap-3 border-y border-brand-100 bg-brand-50 px-5 py-3.5">
              <span className="text-sm font-medium text-brand-900">
                Grand total
              </span>
              <span className="text-lg font-semibold tabular-nums text-brand-950">
                ₹{formatINR(computed.grandTotal)}
              </span>
            </div>

            <div className="flex flex-col gap-2 px-5 py-4">
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={locked || disabled}
              >
                Save invoice
              </Button>
              <Button
                className="w-full"
                disabled={locked}
                onClick={() => setShowPreview((current) => !current)}
                aria-expanded={showPreview}
              >
                {showPreview ? "Hide preview" : "Preview"}
              </Button>
              {/* Downloads what is on screen — saving first is not required. */}
              {pdfProps && (
                <DownloadPdfButton
                  invoice={pdfProps}
                  className="w-full"
                  disabled={disabled}
                />
              )}

              {locked && (
                <p className="mt-1 text-xs leading-relaxed text-ink-500">
                  Select a business profile above to start.
                </p>
              )}
            </div>
          </Card>
        </aside>
      </div>

      {showPreview && pdfProps && (
        <section aria-label="Invoice preview" className="pt-2">
          <InvoicePreview {...pdfProps} />
        </section>
      )}
    </form>
  );
}
