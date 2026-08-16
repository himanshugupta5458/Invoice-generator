"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { BuyerSelect } from "@/components/invoice/BuyerSelect";
import { EMPTY_ITEM, ItemsTable } from "@/components/invoice/ItemsTable";
import { InvoicePreview } from "@/components/invoice/InvoicePreview";
import { ShipToSection } from "@/components/invoice/ShipToSection";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextArea, TextInput } from "@/components/ui/Field";
import { StorageErrorBanner } from "@/components/ui/StorageErrorBanner";
import { formatINR } from "@/lib/format";
import { computeInvoice } from "@/lib/gst";
import { createId } from "@/lib/repository";
import { useHydratedStore, useInvoiceStore } from "@/lib/store";
import type { BusinessProfile, SavedBuyer } from "@/lib/types";
import {
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
    termsAndConditions: "",
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
  const terms = useWatch({ control, name: "termsAndConditions" });
  const notes = useWatch({ control, name: "notes" });

  const profile = profiles.find((entry) => entry.id === businessProfileId);

  // Date is set after mount so the server and client render the same markup.
  useEffect(() => {
    setValue("date", today());
  }, [setValue]);

  // Picking a profile fills the invoice number from its prefix + running
  // number, and pre-fills the terms from that profile's default (§4).
  useEffect(() => {
    if (!profile) return;
    setValue(
      "invoiceNumber",
      `${profile.invoicePrefix}${profile.nextInvoiceNumber}`,
    );
    setValue("termsAndConditions", profile.termsAndConditions ?? "");
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

    await saveInvoice(toInvoice(values, profile, createId()));

    // "Save this buyer for next time" (§4) — only for a buyer typed in fresh.
    if (values.saveBuyer && values.buyerId === "") {
      await saveBuyerRecord(toSavedBuyer(values.buyer, createId()));
    }

    // Advance the profile's running number so the next invoice is unique.
    const nextNumber = profile.nextInvoiceNumber + 1;
    await saveProfile({ ...profile, nextInvoiceNumber: nextNumber });

    setSavedNotice(`Invoice ${values.invoiceNumber} saved as unpaid.`);
    setShowPreview(false);
    reset({
      ...blankInvoice(),
      businessProfileId: profile.id,
      date: today(),
      invoiceNumber: `${profile.invoicePrefix}${nextNumber}`,
      termsAndConditions: profile.termsAndConditions ?? "",
    });
  }

  const locked = !profile;
  const disabled = busy || isSubmitting;

  if (hydrated && profiles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-10 text-center">
        <p className="text-sm text-stone-600">
          No business profiles yet — add one in Settings to start.
        </p>
        <Link
          href="/settings"
          className="mt-3 inline-block rounded-md bg-stone-900 px-3.5 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
        >
          Go to Settings
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <StorageErrorBanner />

      {savedNotice && (
        <p
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          {savedNotice}
        </p>
      )}

      <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Business profile"
            required
            error={errors.businessProfileId?.message}
            hint="Everything else unlocks once a profile is selected."
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

          <Field label="Date" required error={errors.date?.message}>
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
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className={locked ? "flex flex-col gap-6 opacity-50" : "flex flex-col gap-6"}>
          <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-stone-900">Bill To</h2>
            <p className="mt-1 text-xs text-stone-500">
              This buyer&rsquo;s state decides whether the invoice is CGST + SGST
              or IGST.
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <Field label="Saved buyer">
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

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Buyer name"
                  required
                  error={errors.buyer?.name?.message}
                >
                  {(ids) => (
                    <TextInput {...ids} disabled={locked} {...register("buyer.name")} />
                  )}
                </Field>

                <Field label="Phone" error={errors.buyer?.phone?.message}>
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
                  className="sm:col-span-2"
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

                <Field label="State" required error={errors.buyer?.state?.message}>
                  {(ids) => (
                    <TextInput {...ids} disabled={locked} {...register("buyer.state")} />
                  )}
                </Field>

                <Field
                  label="State code"
                  required
                  error={errors.buyer?.stateCode?.message}
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
                  className="sm:col-span-2"
                  hint="Optional — leave blank for an unregistered buyer."
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
                <label className="flex items-center gap-2 text-sm text-stone-600">
                  <input
                    type="checkbox"
                    disabled={locked}
                    className="size-4 rounded border-stone-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
                    {...register("saveBuyer")}
                  />
                  Save this buyer for next time
                </label>
              ) : (
                <p className="text-xs text-stone-500">
                  Edits here apply to this invoice only — the saved buyer record
                  is left unchanged.
                </p>
              )}
            </div>
          </section>

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
            lines={computed.lines}
            errors={errors.items}
            disabled={locked}
          />

          <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
            <div className="grid gap-4">
              <Field
                label="Terms & conditions"
                error={errors.termsAndConditions?.message}
                hint="Pre-filled from the business profile; edit for this invoice only."
              >
                {(ids) => (
                  <TextArea
                    {...ids}
                    rows={4}
                    disabled={locked}
                    {...register("termsAndConditions")}
                  />
                )}
              </Field>

              <Field label="Notes" error={errors.notes?.message}>
                {(ids) => (
                  <TextArea
                    {...ids}
                    rows={2}
                    disabled={locked}
                    {...register("notes")}
                  />
                )}
              </Field>
            </div>
          </section>
        </div>

        {/* Live totals stay visible while items are edited (§9). */}
        <aside className="lg:sticky lg:top-6">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-stone-900">Totals</h2>
            <p className="mt-0.5 text-xs text-stone-500">
              {computed.isIntraState
                ? "Intra-state supply — CGST + SGST"
                : "Inter-state supply — IGST"}
            </p>

            <dl className="mt-3 text-sm">
              <div className="flex justify-between py-1">
                <dt className="text-stone-600">Taxable value</dt>
                <dd className="tabular-nums">{formatINR(computed.subTotal)}</dd>
              </div>

              {computed.isIntraState ? (
                <>
                  <div className="flex justify-between py-1">
                    <dt className="text-stone-600">CGST</dt>
                    <dd className="tabular-nums">
                      {formatINR(computed.totalCgst)}
                    </dd>
                  </div>
                  <div className="flex justify-between py-1">
                    <dt className="text-stone-600">SGST</dt>
                    <dd className="tabular-nums">
                      {formatINR(computed.totalSgst)}
                    </dd>
                  </div>
                </>
              ) : (
                <div className="flex justify-between py-1">
                  <dt className="text-stone-600">IGST</dt>
                  <dd className="tabular-nums">
                    {formatINR(computed.totalIgst)}
                  </dd>
                </div>
              )}

              <div className="flex justify-between border-t border-stone-200 py-1">
                <dt className="text-stone-600">Round off</dt>
                <dd className="tabular-nums">
                  {computed.roundOff >= 0 ? "+" : "−"}
                  {formatINR(Math.abs(computed.roundOff))}
                </dd>
              </div>

              <div className="mt-1 flex justify-between border-t border-stone-300 pt-2 text-base font-semibold">
                <dt>Grand total</dt>
                <dd className="tabular-nums">
                  ₹{formatINR(computed.grandTotal)}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-col gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={locked || disabled}
              >
                Save invoice
              </Button>
              <Button
                disabled={locked}
                onClick={() => setShowPreview((current) => !current)}
                aria-expanded={showPreview}
              >
                {showPreview ? "Hide preview" : "Preview"}
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {showPreview && profile && (
        <section aria-label="Invoice preview" className="pt-2">
          <InvoicePreview
            business={profile}
            buyer={toBuyer(buyerValues ?? BLANK_BUYER)}
            shipTo={
              sameAsBilling
                ? undefined
                : {
                    name: shipToValues?.name ?? "",
                    address: shipToValues?.address ?? "",
                    state: shipToValues?.state ?? "",
                    stateCode: shipToValues?.stateCode ?? "",
                    gstin: shipToValues?.gstin || undefined,
                  }
            }
            invoiceNumber={invoiceNumber}
            date={date}
            computed={computed}
            termsAndConditions={terms || undefined}
            notes={notes || undefined}
            accentColor={profile.accentColor}
            status="unpaid"
          />
        </section>
      )}
    </form>
  );
}
