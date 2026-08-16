/**
 * GST calculation engine (spec §6). Pure functions only — no React, no storage.
 *
 * The two rules a non-developer should be able to follow from this file:
 *
 *  1. INTRA-STATE vs INTER-STATE is decided ONLY by comparing the seller's state
 *     code with the Bill To buyer's state code. Same state -> the tax is split in
 *     half as CGST + SGST. Different state -> the whole tax is a single IGST
 *     amount. The Ship To party is display-only and is deliberately not even an
 *     argument to computeInvoice(), so it can never change the branch.
 *
 *  2. ROUNDING happens ONCE, at the invoice level, on the final grand total.
 *     Each line and each tax figure is stored to 2 decimals (paise) because that
 *     is what money is, but no line is ever rounded up to a whole rupee. Only the
 *     invoice's grand total is rounded to the nearest rupee, and the difference
 *     that rounding creates is reported as one signed `roundOff` line.
 */

import { round2 } from "./format";
import type { BusinessProfile, Buyer, InvoiceItem } from "./types";

/** An item plus its computed tax breakdown. All money values are 2-decimal. */
export interface ComputedLine extends InvoiceItem {
  taxable: number; // quantity * rate
  cgst: number; // 0 on an inter-state invoice
  sgst: number; // 0 on an inter-state invoice
  igst: number; // 0 on an intra-state invoice
  gstAmount: number; // cgst + sgst, or igst
  lineTotal: number; // taxable + gstAmount
}

export interface ComputedInvoice {
  isIntraState: boolean;
  /** Place of supply is the Bill To buyer's state (§6). */
  placeOfSupply: string;
  placeOfSupplyStateCode: string;
  lines: ComputedLine[];
  subTotal: number; // Σ taxable
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number; // totalCgst + totalSgst + totalIgst
  grandTotalRaw: number; // subTotal + totalTax, before rupee rounding
  roundOff: number; // grandTotal - grandTotalRaw (signed)
  grandTotal: number; // grandTotalRaw rounded to the nearest rupee
}

/** Coerce user input (possibly an empty form field) to a usable number. */
function toNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * State codes are 2-digit strings ("27"). Normalise so a profile saved as "7"
 * still matches a buyer saved as "07" — a formatting difference must not flip an
 * invoice from CGST/SGST to IGST.
 */
export function normalizeStateCode(code: string): string {
  const digits = (typeof code === "string" ? code : "").replace(/\D/g, "");
  return digits ? digits.padStart(2, "0") : "";
}

/**
 * Same state code -> intra-state (CGST + SGST). Different -> inter-state (IGST).
 * If either code is missing we cannot prove the supply crosses a state border,
 * so we fall back to intra-state rather than silently charging IGST.
 */
export function isIntraStateSupply(
  sellerStateCode: string,
  buyerStateCode: string,
): boolean {
  const seller = normalizeStateCode(sellerStateCode);
  const buyer = normalizeStateCode(buyerStateCode);
  if (!seller || !buyer) return true;
  return seller === buyer;
}

/**
 * Single entry point for invoice maths.
 *
 * Note the signature: there is no ShipTo parameter. The tax branch depends on
 * the Bill To buyer alone, so a differing Ship To state cannot affect the result.
 */
export function computeInvoice(
  profile: BusinessProfile,
  buyer: Buyer,
  items: InvoiceItem[],
): ComputedInvoice {
  const isIntraState = isIntraStateSupply(profile.stateCode, buyer.stateCode);

  const lines: ComputedLine[] = (items ?? []).map((item) => {
    const quantity = toNumber(item.quantity);
    const rate = toNumber(item.rate);
    const gstRate = toNumber(item.gstRate);

    const taxable = round2(quantity * rate);

    // Intra-state splits the slab down the middle: 18% becomes 9% + 9%.
    // Inter-state charges the full slab once as IGST.
    const cgst = isIntraState ? round2((taxable * (gstRate / 2)) / 100) : 0;
    const sgst = cgst;
    const igst = isIntraState ? 0 : round2((taxable * gstRate) / 100);

    const gstAmount = round2(cgst + sgst + igst);

    return {
      ...item,
      quantity,
      rate,
      gstRate,
      taxable,
      cgst,
      sgst,
      igst,
      gstAmount,
      lineTotal: round2(taxable + gstAmount),
    };
  });

  const subTotal = sum(lines.map((l) => l.taxable));
  const totalCgst = sum(lines.map((l) => l.cgst));
  const totalSgst = sum(lines.map((l) => l.sgst));
  const totalIgst = sum(lines.map((l) => l.igst));
  const totalTax = round2(totalCgst + totalSgst + totalIgst);

  // The one and only rupee rounding on the whole invoice.
  const grandTotalRaw = round2(subTotal + totalTax);
  const grandTotal = Math.round(grandTotalRaw);
  const roundOff = round2(grandTotal - grandTotalRaw);

  return {
    isIntraState,
    placeOfSupply: buyer.state,
    placeOfSupplyStateCode: normalizeStateCode(buyer.stateCode),
    lines,
    subTotal,
    totalCgst,
    totalSgst,
    totalIgst,
    totalTax,
    grandTotalRaw,
    roundOff,
    grandTotal,
  };
}

/** Sum 2-decimal money values, re-rounding to keep float drift out of totals. */
function sum(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + v, 0));
}
