/**
 * Zod schemas for every form and for validating imported backup files (§3, §7).
 *
 * The GSTIN check lives in lib/format.ts as a plain predicate so it stays
 * testable without Zod; here it is surfaced as a refinement (§10).
 *
 * Optional text fields are modelled as "" rather than undefined because that is
 * what an empty <input> produces. `toProfile` / `toBuyer` below convert "" back
 * to undefined at the storage boundary so we never persist empty strings for
 * genuinely absent values.
 */

import { z } from "zod";

import { isValidHexColor, normalizeHex } from "./color";
import { gstinStateCode, isValidGstin } from "./format";
import type {
  BusinessProfile,
  Buyer,
  Invoice,
  InvoiceItem,
  SavedBuyer,
  ShipTo,
} from "./types";
import { GST_SLABS } from "./types";

const GSTIN_MESSAGE =
  "Enter a valid 15-character GSTIN, e.g. 27ABCDE1234F1Z5";

/** Required GSTIN (business profiles must have one). */
export const gstinSchema = z
  .string()
  .trim()
  .min(1, "GSTIN is required")
  .refine(isValidGstin, GSTIN_MESSAGE);

/** Optional GSTIN — blank is fine, but a filled-in value must be valid. */
export const optionalGstinSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || isValidGstin(value), GSTIN_MESSAGE);

export const stateCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}$/, "State code is 2 digits, e.g. 27");

export const hexColorSchema = z
  .string()
  .trim()
  .refine(isValidHexColor, "Enter a hex colour like #7a5230");

export const optionalEmailSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "Enter a valid email address",
  );

export const bankDetailsSchema = z.object({
  accountName: z.string().trim(),
  accountNo: z.string().trim(),
  ifsc: z.string().trim(),
  bankName: z.string().trim(),
  upi: z.string().trim(),
});

/**
 * Business-profile form. `id` is assigned on save, so it is not part of the form.
 *
 * Note what is NOT enforced here: the GSTIN's first two digits matching the
 * state code. Section 4 calls for a *warning*, not a rejection — a genuine
 * mismatch is possible during a state transfer, so `gstinStateMismatch()` below
 * lets the form surface it without blocking the save.
 */
export const businessProfileFormSchema = z.object({
  name: z.string().trim().min(1, "Business name is required"),
  address: z.string().trim().min(1, "Address is required"),
  city: z.string().trim(),
  state: z.string().trim().min(1, "State is required"),
  stateCode: stateCodeSchema,
  gstin: gstinSchema,
  phone: z.string().trim(),
  email: optionalEmailSchema,
  bank: bankDetailsSchema,
  logoDataUrl: z.string().optional(),
  invoicePrefix: z.string().trim().min(1, "Invoice prefix is required"),
  nextInvoiceNumber: z
    .number({ error: "Enter a starting invoice number" })
    .int("Use a whole number")
    .min(1, "Must be 1 or more"),
  accentColor: hexColorSchema,
  termsAndConditions: z.string(),
});

export type BusinessProfileFormValues = z.infer<
  typeof businessProfileFormSchema
>;

export const buyerFormSchema = z.object({
  name: z.string().trim().min(1, "Buyer name is required"),
  address: z.string().trim().min(1, "Address is required"),
  state: z.string().trim().min(1, "State is required"),
  stateCode: stateCodeSchema,
  gstin: optionalGstinSchema,
  phone: z.string().trim(),
});

export type BuyerFormValues = z.infer<typeof buyerFormSchema>;

/** Ship To is display-only, so its fields are only required once it is in use. */
export const shipToFormSchema = z.object({
  name: z.string().trim(),
  address: z.string().trim(),
  state: z.string().trim(),
  stateCode: z.string().trim(),
  gstin: optionalGstinSchema,
});

export type ShipToFormValues = z.infer<typeof shipToFormSchema>;

export const invoiceItemFormSchema = z.object({
  description: z.string().trim().min(1, "Describe the item"),
  // Optional (§4). `.optional()` rather than a plain string so a CSV row that
  // omits the column entirely is as valid as an empty input.
  hsn: z.string().trim().optional(),
  quantity: z
    .number({ error: "Enter a quantity" })
    .positive("Quantity must be more than 0"),
  rate: z.number({ error: "Enter a rate" }).min(0, "Rate cannot be negative"),
  gstRate: z
    .number({ error: "Choose a GST rate" })
    .refine(
      (rate) => (GST_SLABS as readonly number[]).includes(rate),
      `GST rate must be one of ${GST_SLABS.join(", ")}%`,
    ),
});

export type InvoiceItemFormValues = z.infer<typeof invoiceItemFormSchema>;

export const invoiceFormSchema = z
  .object({
    businessProfileId: z.string().min(1, "Select a business profile"),
    invoiceNumber: z.string().trim().min(1, "Invoice number is required"),
    date: z.string().min(1, "Invoice date is required"),
    /** "" when the buyer is being typed in fresh rather than picked. */
    buyerId: z.string(),
    buyer: buyerFormSchema,
    saveBuyer: z.boolean(),
    sameAsBilling: z.boolean(),
    shipTo: shipToFormSchema,
    items: z.array(invoiceItemFormSchema).min(1, "Add at least one item"),
    // No termsAndConditions here on purpose: T&C are seller-only (§4). Every
    // invoice takes its business profile's default, so the builder has no field
    // to validate.
    notes: z.string(),
  })
  .superRefine((values, ctx) => {
    // Only demand Ship To details once "same as billing" is switched off.
    if (values.sameAsBilling) return;

    const required = [
      ["name", "Shipping name is required"],
      ["address", "Shipping address is required"],
      ["state", "Shipping state is required"],
    ] as const;

    for (const [field, message] of required) {
      if (values.shipTo[field].trim() === "") {
        ctx.addIssue({ code: "custom", path: ["shipTo", field], message });
      }
    }

    if (!/^\d{2}$/.test(values.shipTo.stateCode.trim())) {
      ctx.addIssue({
        code: "custom",
        path: ["shipTo", "stateCode"],
        message: "State code is 2 digits, e.g. 27",
      });
    }
  });

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

/**
 * Warn when the GSTIN's first two digits disagree with the state code (§4).
 * Returns false while either field is still incomplete so the form does not
 * nag mid-typing.
 */
export function gstinStateMismatch(gstin: string, stateCode: string): boolean {
  const code = stateCode.trim();
  // gstinStateCode() returns null unless the GSTIN is well-formed, which is
  // also what keeps this quiet while the field is half-typed.
  const encoded = gstinStateCode(gstin);
  if (encoded === null || !/^\d{2}$/.test(code)) return false;
  return encoded !== code;
}

// ---------------------------------------------------------------------------
// Stored-record schemas — used to validate imported backup files (§7).
// ---------------------------------------------------------------------------

export const businessProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  stateCode: z.string(),
  gstin: z.string(),
  phone: z.string(),
  email: z.string(),
  bank: bankDetailsSchema,
  logoDataUrl: z.string().optional(),
  invoicePrefix: z.string(),
  nextInvoiceNumber: z.number(),
  accentColor: z.string(),
  termsAndConditions: z.string().optional(),
});

export const buyerSchema = z.object({
  name: z.string(),
  address: z.string(),
  state: z.string(),
  stateCode: z.string(),
  gstin: z.string().optional(),
  phone: z.string().optional(),
});

export const savedBuyerSchema = buyerSchema.extend({
  id: z.string().min(1),
});

export const shipToSchema = z.object({
  name: z.string(),
  address: z.string(),
  state: z.string(),
  stateCode: z.string(),
  gstin: z.string().optional(),
});

export const invoiceItemSchema = z.object({
  description: z.string(),
  hsn: z.string().optional(),
  quantity: z.number(),
  rate: z.number(),
  gstRate: z.number(),
});

export const invoiceStatusSchema = z.enum(["unpaid", "paid"]);

export const invoiceSchema = z.object({
  id: z.string().min(1),
  invoiceNumber: z.string(),
  date: z.string(),
  businessProfileId: z.string(),
  businessSnapshot: businessProfileSchema,
  buyer: buyerSchema,
  shipTo: shipToSchema.optional(),
  accentColor: z.string(),
  items: z.array(invoiceItemSchema),
  termsAndConditions: z.string().optional(),
  status: invoiceStatusSchema,
  notes: z.string().optional(),
});

/**
 * A backup file. Records are validated structurally (not against the stricter
 * form rules) so a legitimate export always re-imports cleanly, while a wrong
 * file is still rejected before it can replace good data.
 */
export const exportBundleSchema = z.object({
  version: z.number().optional(),
  exportedAt: z.string().optional(),
  profiles: z.array(businessProfileSchema),
  buyers: z.array(savedBuyerSchema),
  invoices: z.array(invoiceSchema),
});

// ---------------------------------------------------------------------------
// Form values -> stored records
// ---------------------------------------------------------------------------

/** "" means "not provided" in a form; storage should hold undefined instead. */
function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function toProfile(
  values: BusinessProfileFormValues,
  id: string,
): BusinessProfile {
  return {
    id,
    name: values.name,
    address: values.address,
    city: values.city,
    state: values.state,
    stateCode: values.stateCode,
    gstin: values.gstin.toUpperCase(),
    phone: values.phone,
    email: values.email,
    bank: {
      ...values.bank,
      ifsc: values.bank.ifsc.toUpperCase(),
    },
    logoDataUrl: values.logoDataUrl || undefined,
    invoicePrefix: values.invoicePrefix,
    nextInvoiceNumber: values.nextInvoiceNumber,
    accentColor: normalizeHex(values.accentColor) ?? values.accentColor,
    termsAndConditions: blankToUndefined(values.termsAndConditions),
  };
}

export function toSavedBuyer(values: BuyerFormValues, id: string): SavedBuyer {
  return {
    id,
    ...toBuyer(values),
  };
}

export function toBuyer(values: BuyerFormValues): Buyer {
  return {
    name: values.name,
    address: values.address,
    state: values.state,
    stateCode: values.stateCode,
    gstin: blankToUndefined(values.gstin)?.toUpperCase(),
    phone: blankToUndefined(values.phone),
  };
}

export function toShipTo(values: ShipToFormValues): ShipTo {
  return {
    name: values.name,
    address: values.address,
    state: values.state,
    stateCode: values.stateCode,
    gstin: blankToUndefined(values.gstin)?.toUpperCase(),
  };
}

export function toInvoiceItems(
  values: InvoiceItemFormValues[],
): InvoiceItem[] {
  return values.map((item) => ({
    description: item.description,
    hsn: blankToUndefined(item.hsn ?? ""),
    quantity: item.quantity,
    rate: item.rate,
    gstRate: item.gstRate,
  }));
}

/**
 * Freeze a form into an issued invoice (§5 snapshot rule).
 *
 * The business details, buyer, ship-to, terms, and accent colour are copied in
 * as they stand right now. Editing the source profile or saved buyer afterwards
 * must never change this invoice, which is why nothing here is stored as a
 * reference — `businessProfileId` is kept only for grouping in history.
 *
 * Terms come from the profile rather than the form: they are seller-only (§4),
 * editable in /settings and nowhere else, but still frozen here at issue time so
 * a later edit to the profile leaves this invoice's text alone.
 */
export function toInvoice(
  values: InvoiceFormValues,
  profile: BusinessProfile,
  id: string,
): Invoice {
  return {
    id,
    invoiceNumber: values.invoiceNumber,
    date: values.date,
    businessProfileId: profile.id,
    businessSnapshot: structuredClone(profile),
    buyer: toBuyer(values.buyer),
    shipTo: values.sameAsBilling ? undefined : toShipTo(values.shipTo),
    accentColor: profile.accentColor,
    items: toInvoiceItems(values.items),
    termsAndConditions: blankToUndefined(profile.termsAndConditions ?? ""),
    // Most invoices are raised against money already collected, so a new one is
    // paid unless the user says otherwise from /invoices (§4).
    status: "paid",
    notes: blankToUndefined(values.notes),
  };
}

export type { InvoiceItem, ShipTo };
