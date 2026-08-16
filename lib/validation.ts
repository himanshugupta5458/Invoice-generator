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
import { isValidGstin } from "./format";
import type {
  BusinessProfile,
  Buyer,
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

/**
 * Warn when the GSTIN's first two digits disagree with the state code (§4).
 * Returns false while either field is still incomplete so the form does not
 * nag mid-typing.
 */
export function gstinStateMismatch(gstin: string, stateCode: string): boolean {
  const trimmed = gstin.trim();
  const code = stateCode.trim();
  if (!isValidGstin(trimmed) || !/^\d{2}$/.test(code)) return false;
  return trimmed.slice(0, 2) !== code;
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
  hsn: z.string(),
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

/** The GST slabs offered in the items table, as a Zod enum for later milestones. */
export const gstRateSchema = z
  .number()
  .refine(
    (rate) => (GST_SLABS as readonly number[]).includes(rate),
    `GST rate must be one of ${GST_SLABS.join(", ")}%`,
  );

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

export type { InvoiceItem, ShipTo };
