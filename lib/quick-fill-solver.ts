/**
 * Quick Fill's rate solver (§16, v1.1) — the half of the feature that does the
 * arithmetic, deliberately kept away from the model that does not.
 *
 * `lib/quick-fill.ts` turns a model reply into a MIX: descriptions, HSN codes,
 * GST slabs, quantities, and a rough relative weight per line. Nothing in that
 * mix is money. This module takes the mix and a GST-inclusive target and solves
 * the per-unit rates so that
 *
 *     computeInvoice(profile, buyer, solvedItems).grandTotal === target
 *
 * exactly — not to within 5%, not to within a rupee. That is asserted here, on
 * the real `computeInvoice()`, before the rows are returned; a solve that cannot
 * be verified is reported as a failure rather than handed over as an
 * approximation the user would have to notice for themselves.
 *
 * ── How the arithmetic works ────────────────────────────────────────────────
 *
 * Everything below is in INTEGER PAISE. Money is not a float, and the whole
 * exercise is about the last paise, so the one place drift could hide is the
 * one place it is not allowed in.
 *
 * The target is GST-inclusive, so each step runs backwards from it:
 *
 *   1. Split the target across the lines in proportion to their weights.
 *   2. Divide each share by (1 + slab/100) to get that line's pre-tax value,
 *      then by its quantity to get a per-unit rate, rounded to the paise.
 *   3. Rounding twenty rates leaves the invoice a few paise either side of the
 *      target. One line — the ABSORBER — is then re-solved to swallow that
 *      residual: its rate is chosen so the recomputed grand total is the target.
 *
 * Step 3 cannot always land on the exact paise, because a line's contribution
 * moves in steps of quantity × (1 + slab/100) paise rather than one paise at a
 * time, and CGST + SGST rounds twice where IGST rounds once. It does not need
 * to: `computeInvoice()` rounds the grand total to the nearest rupee, so
 * anything inside half a rupee lands on the target, and the few paise left over
 * show up on the round-off line that already exists for exactly this. The
 * absorber is picked as the line with the *finest* step so that leftover is as
 * small as it can be — half a step, so a paise or two on a typical mix — and if
 * even the finest grid is coarser than a rupee (a line of several hundred
 * units), the absorber's rate falls back to full precision, which can always hit
 * the paise dead on.
 *
 * Pure: no React, no network, no clock. The only import with any behaviour is
 * `computeInvoice()` itself, which is the point — the solver checks its answer
 * against the engine the invoice will actually be rendered by, not against a
 * second copy of the same sums that could drift away from it.
 */

import { formatINR, round2 } from "./format";
import { computeInvoice, type ComputedInvoice } from "./gst";
import type { QuickFillMixItem } from "./quick-fill";
import type { BusinessProfile, Buyer } from "./types";
import { invoiceItemFormSchema, type InvoiceItemFormValues } from "./validation";

/** No line is priced below one paise; a ₹0 line is not a purchase. */
const MIN_RATE_PAISE = 1;

export interface SolveQuickFillRatesInput {
  /** The model's mix — what was bought, at what slab, and in what proportion. */
  items: readonly QuickFillMixItem[];
  /** The GST-inclusive grand total to hit, in whole rupees. */
  target: number;
  /**
   * True when the seller and the Bill To buyer share a state code (§6). It
   * changes the answer: CGST + SGST rounds the half-slab twice, IGST rounds the
   * full slab once, and the two can differ by a paise on the same line.
   */
  isIntraState: boolean;
}

export type SolveQuickFillRatesResult =
  | {
      ok: true;
      items: InvoiceItemFormValues[];
      /** `computeInvoice().grandTotal` for these rows — equal to the target. */
      total: number;
      /**
       * The rupee round-off the invoice will show. Always under half a rupee —
       * that is what makes the grand total land on the target — and a paise or
       * two on a typical mix.
       */
      roundOff: number;
    }
  | { ok: false; error: string };

/**
 * The two records `computeInvoice()` needs before it will do any arithmetic.
 * Only the state codes are ever read from them; the rest is filled in so the
 * real function can be called rather than its sums copied out into this file.
 */
const VERIFY_PROFILE: BusinessProfile = {
  id: "",
  name: "",
  address: "",
  city: "",
  state: "",
  stateCode: "27",
  gstin: "",
  phone: "",
  email: "",
  bank: { accountName: "", accountNo: "", ifsc: "", bankName: "", upi: "" },
  invoicePrefix: "",
  nextInvoiceNumber: 1,
  accentColor: "#000000",
};

function verifyBuyer(isIntraState: boolean): Buyer {
  return {
    name: "",
    address: "",
    state: "",
    // Same code as the profile keeps it intra-state; any other code makes it
    // inter-state. Which codes they are is irrelevant to the totals (§6).
    stateCode: isIntraState ? "27" : "29",
  };
}

/**
 * Run a set of rows through the app's own GST engine on the given tax branch.
 *
 * Exported because it is what the tests assert against, and what makes the
 * solver's promise checkable: the grand total here is the grand total the form,
 * the preview, and the PDF will all show for these rows.
 */
export function computeQuickFillInvoice(
  items: readonly InvoiceItemFormValues[],
  isIntraState: boolean,
): ComputedInvoice {
  return computeInvoice(VERIFY_PROFILE, verifyBuyer(isIntraState), [...items]);
}

/**
 * `round2(quantity * rate)` in paise, for a rate held as whole paise.
 *
 * Mirrors the first line of `computeInvoice()`. Quantities may be fractional
 * (2.5 kg is a real line), which is why this rounds rather than multiplying two
 * integers.
 */
function taxablePaiseFor(quantity: number, ratePaise: number): number {
  return Math.round(quantity * ratePaise);
}

/**
 * What one line adds to the pre-rounding grand total, in paise.
 *
 * Mirrors `computeInvoice()` exactly, including the difference that matters
 * here: intra-state rounds half the slab and doubles it, so its tax moves in
 * two-paise steps, while inter-state rounds the whole slab once.
 */
function lineTotalPaise(
  taxablePaise: number,
  gstRate: number,
  isIntraState: boolean,
): number {
  if (isIntraState) {
    const half = Math.round((taxablePaise * gstRate) / 200);
    return taxablePaise + 2 * half;
  }
  return taxablePaise + Math.round((taxablePaise * gstRate) / 100);
}

/**
 * The integer nearest to hitting `wanted`, searched around an ideal that
 * rounding may have pushed either way.
 *
 * A handful of candidates is enough: `contribution` is monotonic in `value` and
 * moves by at most a few paise per step, so the best answer is always within a
 * step or two of the arithmetic ideal. Ties go to the smaller value so the same
 * mix and target always solve to the same invoice.
 */
function nearest(
  ideal: number,
  contribution: (value: number) => number,
  wanted: number,
): number {
  const start = Math.max(MIN_RATE_PAISE, Math.floor(ideal) - 2);
  let best = start;
  let bestDistance = Math.abs(contribution(start) - wanted);

  for (let value = start + 1; value <= start + 5; value += 1) {
    const distance = Math.abs(contribution(value) - wanted);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * Which line absorbs the rounding residual.
 *
 * Whichever line has the smallest quantity × (100 + slab) moves the grand total
 * in the smallest steps, so it can be tuned the most finely — the last line by
 * default, and an earlier one only when that one is genuinely finer. The
 * absorber's rate ends up at most a rupee or so off the value its weight asked
 * for, which is invisible next to what the feature is for.
 */
function pickAbsorber(items: readonly QuickFillMixItem[]): number {
  let absorber = 0;
  let finest = Number.POSITIVE_INFINITY;

  items.forEach((item, index) => {
    const step = item.quantity * (100 + item.gstRate);
    // `<=` so a tie resolves to the later line, which is the one a reader would
    // expect to carry the adjustment.
    if (step <= finest) {
      finest = step;
      absorber = index;
    }
  });

  return absorber;
}

function toSolvedItems(
  items: readonly QuickFillMixItem[],
  rates: readonly number[],
): InvoiceItemFormValues[] {
  return items.map((item, index) => ({
    description: item.description,
    hsn: item.hsn,
    quantity: item.quantity,
    rate: rates[index],
    gstRate: item.gstRate,
  }));
}

/**
 * Solve per-unit rates so the mix totals the target exactly (§16).
 *
 * Never approximates silently: either the returned rows verify against
 * `computeInvoice()` at exactly the target, or an `error` sentence explains why
 * that target cannot be met by these items.
 */
export function solveQuickFillRates(
  input: SolveQuickFillRatesInput,
): SolveQuickFillRatesResult {
  const { items, target, isIntraState } = input;

  if (items.length === 0) {
    return { ok: false, error: "There were no items to price." };
  }

  if (!Number.isFinite(target) || target <= 0) {
    return {
      ok: false,
      error: "Enter a target amount greater than 0, or leave it blank.",
    };
  }

  // An invoice's grand total is rounded to the nearest rupee (§6), so a target
  // with paise in it is not a total any invoice can have. Said plainly rather
  // than rounded behind the user's back.
  if (!Number.isInteger(target)) {
    return {
      ok: false,
      error:
        "Use a whole number of rupees — an invoice total is always rounded to the nearest rupee.",
    };
  }

  const targetPaise = Math.round(target * 100);

  // The cheapest invoice these items can make: every line at one paise a unit.
  // Below it no set of rates can reach the target, so say so now with the figure
  // rather than fail the verification later with nothing useful to report.
  const floorPaise = items.reduce(
    (sum, item) =>
      sum +
      lineTotalPaise(
        taxablePaiseFor(item.quantity, MIN_RATE_PAISE),
        item.gstRate,
        isIntraState,
      ),
    0,
  );
  if (targetPaise < floorPaise) {
    return {
      ok: false,
      error: `A target of ₹${formatINR(target)} is too small for ${items.length} item(s) — the least they can come to is ₹${formatINR(floorPaise / 100)}.`,
    };
  }

  // 1 + 2. Split the target by weight, back out a pre-tax rate from each slab.
  //
  // Done as a loop rather than one division because of the floor. A line whose
  // weight is a rounding error still costs a paise a unit, and 999 units at a
  // paise is ₹9.99 that the split never budgeted for — money the other lines
  // have already been promised. So each pass pins the lines that bottom out,
  // takes what they actually cost off the top, and re-divides what is left
  // between the lines still free to move. At most one line is pinned per pass,
  // so this settles in at most `items.length` of them.
  const ratesPaise = new Array<number>(items.length).fill(MIN_RATE_PAISE);
  const pinned = new Array<boolean>(items.length).fill(false);

  for (let pass = 0; pass <= items.length; pass += 1) {
    let poolPaise = targetPaise;
    let poolWeight = 0;

    items.forEach((item, index) => {
      if (pinned[index]) {
        poolPaise -= lineTotalPaise(
          taxablePaiseFor(item.quantity, MIN_RATE_PAISE),
          item.gstRate,
          isIntraState,
        );
      } else {
        poolWeight += item.weight;
      }
    });

    // Every line is on the floor; there is nothing left to divide.
    if (poolWeight <= 0) break;

    let bottomedOut = -1;
    items.forEach((item, index) => {
      if (pinned[index]) return;
      const inclusiveShare = (poolPaise * item.weight) / poolWeight;
      const taxableShare = (inclusiveShare * 100) / (100 + item.gstRate);
      const rate = Math.round(taxableShare / item.quantity);
      ratesPaise[index] = Math.max(MIN_RATE_PAISE, rate);
      if (rate <= MIN_RATE_PAISE && bottomedOut === -1) bottomedOut = index;
    });

    if (bottomedOut === -1) break;
    pinned[bottomedOut] = true;
  }

  // 3. Re-solve one line to swallow the residual from all that rounding.
  const absorberIndex = pickAbsorber(items);
  const absorber = items[absorberIndex];

  /** What every line but the absorber contributes, in paise. */
  function restPaise(rates: readonly number[]): number {
    return items.reduce((sum, item, index) => {
      if (index === absorberIndex) return sum;
      return (
        sum +
        lineTotalPaise(
          taxablePaiseFor(item.quantity, rates[index]),
          item.gstRate,
          isIntraState,
        )
      );
    }, 0);
  }

  /**
   * Solve the absorber against the other lines' rates, then check the answer.
   *
   * `precise` prices the absorber to the paise of *line value* rather than to
   * the paise of per-unit rate. A whole-paise rate is what an invoice normally
   * carries, so it is tried first; a line of several hundred units moves the
   * total in steps bigger than a rupee, and only then is the uglier rate worth
   * it. Returns null when the result does not verify, so the caller can try the
   * next thing rather than hand back rows that miss.
   */
  function attempt(
    rates: readonly number[],
    precise: boolean,
  ): Extract<SolveQuickFillRatesResult, { ok: true }> | null {
    const needed = targetPaise - restPaise(rates);
    const solvedRates = [...rates];

    if (!precise) {
      solvedRates[absorberIndex] = nearest(
        (needed * 100) / ((100 + absorber.gstRate) * absorber.quantity),
        (ratePaise) =>
          lineTotalPaise(
            taxablePaiseFor(absorber.quantity, ratePaise),
            absorber.gstRate,
            isIntraState,
          ),
        needed,
      );
    }

    const rows = toSolvedItems(
      items,
      solvedRates.map((paise) => round2(paise / 100)),
    );

    if (precise) {
      const taxable = nearest(
        (needed * 100) / (100 + absorber.gstRate),
        (taxablePaise) =>
          lineTotalPaise(taxablePaise, absorber.gstRate, isIntraState),
        needed,
      );
      rows[absorberIndex] = {
        ...rows[absorberIndex],
        rate: taxable / (100 * absorber.quantity),
      };
    }

    return verify(rows, target, isIntraState);
  }

  /**
   * The other lines' rates, scaled back to leave the absorber something to work
   * with.
   *
   * Rounding a rate *up* on a line of many units can overshoot the whole target
   * before the absorber gets a look in — half a paise across 5,000 units is ₹25
   * — and the absorber cannot go below a paise a unit to claw it back. Scaling
   * down (and flooring, so rates can only fall) restores a positive remainder.
   */
  function scaledToFit(rates: readonly number[]): number[] {
    const absorberFloor = lineTotalPaise(
      taxablePaiseFor(absorber.quantity, MIN_RATE_PAISE),
      absorber.gstRate,
      isIntraState,
    );
    const room = targetPaise - absorberFloor;
    const rest = restPaise(rates);
    if (rest <= room || rest <= 0 || room <= 0) return [...rates];

    const scale = room / rest;
    return rates.map((paise, index) =>
      index === absorberIndex
        ? paise
        : Math.max(MIN_RATE_PAISE, Math.floor(paise * scale)),
    );
  }

  return (
    attempt(ratesPaise, false) ??
    attempt(ratesPaise, true) ??
    attempt(scaledToFit(ratesPaise), false) ??
    attempt(scaledToFit(ratesPaise), true) ?? {
      ok: false,
      error: `Quick Fill could not make these items add up to exactly ₹${formatINR(target)}. Try a different target.`,
    }
  );
}

/**
 * The check the whole module exists to pass: run the solved rows through the
 * app's GST engine and insist on the target to the rupee.
 *
 * Every row is put back through `invoiceItemFormSchema` on the way out as well.
 * The rates are ours rather than the model's, but they are still generated
 * numbers reaching a form, and §4 does not make exceptions for its own code.
 */
function verify(
  items: InvoiceItemFormValues[],
  target: number,
  isIntraState: boolean,
): Extract<SolveQuickFillRatesResult, { ok: true }> | null {
  for (const item of items) {
    if (!invoiceItemFormSchema.safeParse(item).success) return null;
  }

  const computed = computeQuickFillInvoice(items, isIntraState);
  if (computed.grandTotal !== target) return null;

  return {
    ok: true,
    items,
    total: computed.grandTotal,
    roundOff: computed.roundOff,
  };
}
