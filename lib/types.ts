/**
 * All shared domain types for InvoiceGen (spec §5).
 *
 * Snapshot rule: an `Invoice` embeds frozen copies of the business details, buyer,
 * ship-to, terms, and accent colour used when it was issued. A saved invoice must
 * never be re-rendered from the *current* profile/buyer records — later edits to
 * those must not alter past invoices.
 */

export interface BankDetails {
  accountName: string;
  accountNo: string;
  ifsc: string;
  bankName: string;
  upi: string;
}

export interface BusinessProfile {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  stateCode: string; // 2 digits, e.g. "27"
  gstin: string;
  phone: string;
  email: string;
  bank: BankDetails;
  logoDataUrl?: string;
  invoicePrefix: string; // e.g. "SC/2026/"
  nextInvoiceNumber: number; // e.g. 1
  accentColor: string; // hex, e.g. "#7a5230" — drives invoice theming
  termsAndConditions?: string; // T&C used by every invoice; editable only in /settings
  /**
   * Optional example item descriptions in this business's own words, used to
   * ground Quick Fill's generated names in its vocabulary (§16, v1.2). Absent or
   * empty means Quick Fill generates exactly as it did before the feature
   * existed. Capped and cleaned by `lib/style-examples.ts`; per-business by
   * construction, since one profile's examples are never read for another's.
   */
  styleExamples?: string[];
}

export interface Buyer {
  name: string;
  address: string;
  state: string;
  stateCode: string;
  gstin?: string;
  phone?: string;
}

/**
 * A Buyer that has been saved/reused. Kept separate so an Invoice can embed a
 * plain Buyer snapshot without carrying a store id.
 */
export interface SavedBuyer extends Buyer {
  id: string;
}

/**
 * Shipping party. Same shape as Buyer; kept as a distinct type for clarity at
 * call sites even though the fields are identical. Ship To is display-only — it
 * never affects the CGST/SGST vs IGST decision (§6).
 */
export interface ShipTo {
  name: string;
  address: string;
  state: string;
  stateCode: string;
  gstin?: string;
}

export interface InvoiceItem {
  description: string;
  /** Optional (§4) — a blank HSN/SAC never blocks a save. */
  hsn?: string;
  quantity: number;
  rate: number; // rate is PER-UNIT, pre-tax
  gstRate: number; // total GST %, e.g. 12
}

export type InvoiceStatus = "unpaid" | "paid";

export interface Invoice {
  id: string;
  invoiceNumber: string;
  date: string; // ISO date
  businessProfileId: string; // reference (for history grouping)
  businessSnapshot: BusinessProfile; // frozen copy at issue time
  buyer: Buyer; // frozen copy at issue time (not a live ref)
  shipTo?: ShipTo; // frozen copy; omitted if "same as billing"
  accentColor: string; // frozen from the profile at issue time
  items: InvoiceItem[];
  termsAndConditions?: string; // frozen text used on this invoice
  status: InvoiceStatus; // defaults to "paid" on save; toggled from /invoices
  notes?: string;
}

/** Standard Indian GST slabs offered in the items table (§4). */
export const GST_SLABS = [0, 3, 5, 12, 18, 28] as const;
export type GstSlab = (typeof GST_SLABS)[number];
