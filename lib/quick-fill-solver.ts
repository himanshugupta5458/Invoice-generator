/**
 * Quick Fill's rate solver (§16, v1.1) — the half of the feature that does the
 * arithmetic, deliberately kept away from the model that does not.
 *
 * `lib/quick-fill.ts` turns a model reply into a MIX: descriptions, HSN codes,
 * GST slabs, quantities, and a rough relative weight per line. Nothing in that
 * mix is money. This module takes the mix and a GST-inclusive target and solves
 * the per-unit rates.
 *
 * ── The two goals, and which one wins ───────────────────────────────────────
 *
 * A real Indian invoice quotes whole-rupee rates. ₹17,675.90 for a sofa and
 * ₹287.61 for a cushion cover are the fingerprints of a number worked backwards
 * from a total, and a sample invoice that advertises itself that way is no use
 * for showing somebody what their invoice will look like.
 *
 * So: EVERY RATE IS A WHOLE NUMBER OF RUPEES. That constraint comes first, and
 * it is absolute. Integer rates and an exactly-matched grand total cannot both
 * hold — a line of two units at 18% moves the total in ₹2.36 steps, so most
 * targets simply are not reachable — and when they conflict, the rates win.
 *
 * The target therefore becomes a target rather than a promise: the solver gets
 * as close to it as whole-rupee rates allow, and REPORTS THE GAP. A caller that
 * shows the user "₹8,65,400 — ₹12 under your ₹8,65,412 target" has told them the
 * truth; one that shows "₹8,65,400" next to a target of ₹8,65,412 and says
 * nothing has let them assume something false. `quickFillTargetTolerance()`
 * below is how big that gap can get for a given mix, so a caller can say in
 * advance how close it will land.
 *
 * ── How the arithmetic works ────────────────────────────────────────────────
 *
 * Money is in INTEGER PAISE everywhere below, even though the rates themselves
 * are whole rupees: the line totals and the tax are not whole rupees, and the
 * gap being reported is measured against them.
 *
 * The target is GST-inclusive, so each step runs backwards from it:
 *
 *   1. Split the target across the lines in proportion to their weights.
 *   2. Divide each share by (1 + slab/100) to get that line's pre-tax value,
 *      then by its quantity to get a per-unit rate, rounded to the rupee.
 *   3. Rounding every rate to a rupee leaves the invoice some way either side of
 *      the target. One line — the ABSORBER — is then re-solved to close as much
 *      of that as a whole-rupee rate can: the line with the *finest* step, so
 *      the leftover is the smallest available.
 *
 * The result is checked against the real `computeInvoice()` before it is
 * returned, and the total reported back is that function's own `grandTotal` —
 * the same figure the form, the preview and the PDF will show. The solver never
 * reports a total it has calculated itself.
 *
 * Pure: no React, no network, no clock.
 */

import { formatINR } from "./format";
import { computeInvoice, type ComputedInvoice } from "./gst";
import type { QuickFillMixItem } from "./quick-fill";
import type { BusinessProfile, Buyer } from "./types";
import { invoiceItemFormSchema, type InvoiceItemFormValues } from "./validation";

/** No line is priced below a rupee; rates are whole rupees, and ₹0 is not a price. */
const MIN_RATE = 1;

export interface SolveQuickFillRatesInput {
  /** The model's mix — what was bought, at what slab, and in what proportion. */
  items: readonly QuickFillMixItem[];
  /** The GST-inclusive grand total to aim at, in whole rupees. */
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
      /** Every `rate` is a whole number of rupees. */
      items: InvoiceItemFormValues[];
      /** `computeInvoice().grandTotal` for these rows. */
      total: number;
      /** What was aimed at. */
      target: number;
      /** `total - target`: negative under, positive over, 0 dead on. */
      gap: number;
      /** The rupee round-off the invoice will show. */
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
 * solver's report checkable: the grand total here is the grand total the form,
 * the preview, and the PDF will all show for these rows.
 */
export function computeQuickFillInvoice(
  items: readonly InvoiceItemFormValues[],
  isIntraState: boolean,
): ComputedInvoice {
  return computeInvoice(VERIFY_PROFILE, verifyBuyer(isIntraState), [...items]);
}

/**
 * `round2(quantity * rate)` in paise, for a whole-rupee rate.
 *
 * Mirrors the first line of `computeInvoice()`. Quantities may be fractional
 * (2.5 kg is a real line), which is why this rounds rather than multiplying two
 * integers.
 */
function taxablePaiseFor(quantity: number, rate: number): number {
  return Math.round(quantity * rate * 100);
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
 * How far from the target a mix can land, in rupees, once every rate has to be
 * a whole number.
 *
 * Raising the absorbing line's rate by ₹1 moves the invoice by
 * quantity × (1 + slab/100) rupees, so the closest a whole-rupee rate can get
 * is half of that; the grand total's own rounding to the nearest rupee (§6) can
 * add half a rupee on top. Exported so a caller can tell the user how close to
 * expect *before* spending a request, and so the tests have a bound to hold the
 * solver to rather than a number somebody guessed.
 */
export function quickFillTargetTolerance(
  items: readonly QuickFillMixItem[],
): number {
  if (items.length === 0) return 0;
  const finest = Math.min(
    ...items.map((item) => item.quantity * (100 + item.gstRate)),
  );
  return Math.ceil(finest / 200 + 0.5);
}

/**
 * The integer nearest to hitting `wanted`, searched around an ideal that
 * rounding may have pushed either way.
 *
 * A handful of candidates is enough: `contribution` is monotonic in `value`, so
 * the best answer is either side of the arithmetic ideal. Ties go to the smaller
 * value so the same mix and target always solve to the same invoice.
 */
function nearest(
  ideal: number,
  contribution: (value: number) => number,
  wanted: number,
): number {
  const start = Math.max(MIN_RATE, Math.floor(ideal) - 2);
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
 * default, and an earlier one only when that one is genuinely finer. That choice
 * is what `quickFillTargetTolerance()` is calculated from.
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
 * Solve whole-rupee per-unit rates that bring the mix as close to the target as
 * whole-rupee rates can (§16).
 *
 * Reports the total it actually reached and the gap to the target rather than
 * implying it landed on the nose. Refuses only when the target is below the
 * cheapest invoice these items can make, because then there is nothing to
 * report a gap *from* — every rate would already be at its floor.
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

  // The cheapest invoice these items can make: every line at ₹1 a unit. Below
  // that, no set of whole-rupee rates can get near the target and the "gap" the
  // caller would be shown is the whole figure, so say so now with the number
  // they could actually aim at.
  const floorPaise = items.reduce(
    (sum, item) =>
      sum +
      lineTotalPaise(
        taxablePaiseFor(item.quantity, MIN_RATE),
        item.gstRate,
        isIntraState,
      ),
    0,
  );
  if (targetPaise < floorPaise) {
    return {
      ok: false,
      error: `A target of ₹${formatINR(target)} is too small for ${items.length} item(s) at whole-rupee rates — the least they can come to is ₹${formatINR(floorPaise / 100)}.`,
    };
  }

  // 1 + 2. Split the target by weight, back out a pre-tax rate from each slab.
  //
  // Done as a loop rather than one division because of the floor. A line whose
  // weight is a rounding error still costs ₹1 a unit, and 999 units at ₹1 is
  // ₹999 that the split never budgeted for — money the other lines have already
  // been promised. So each pass pins the lines that bottom out, takes what they
  // actually cost off the top, and re-divides what is left between the lines
  // still free to move. At most one line is pinned per pass, so this settles in
  // at most `items.length` of them.
  const rates = new Array<number>(items.length).fill(MIN_RATE);
  const pinned = new Array<boolean>(items.length).fill(false);

  for (let pass = 0; pass <= items.length; pass += 1) {
    let poolPaise = targetPaise;
    let poolWeight = 0;

    items.forEach((item, index) => {
      if (pinned[index]) {
        poolPaise -= lineTotalPaise(
          taxablePaiseFor(item.quantity, MIN_RATE),
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
      const rate = Math.round(taxableShare / (100 * item.quantity));
      rates[index] = Math.max(MIN_RATE, rate);
      if (rate <= MIN_RATE && bottomedOut === -1) bottomedOut = index;
    });

    if (bottomedOut === -1) break;
    pinned[bottomedOut] = true;
  }

  // 3. Re-solve one line to close as much of the residual as a rupee can.
  const absorberIndex = pickAbsorber(items);
  const absorber = items[absorberIndex];

  /** What every line but the absorber contributes, in paise. */
  function restPaise(candidate: readonly number[]): number {
    return items.reduce((sum, item, index) => {
      if (index === absorberIndex) return sum;
      return (
        sum +
        lineTotalPaise(
          taxablePaiseFor(item.quantity, candidate[index]),
          item.gstRate,
          isIntraState,
        )
      );
    }, 0);
  }

  /** Solve the absorber against the other lines' rates. */
  function withAbsorber(candidate: readonly number[]): number[] {
    const needed = targetPaise - restPaise(candidate);
    const solved = [...candidate];
    solved[absorberIndex] = nearest(
      needed / (absorber.quantity * (100 + absorber.gstRate)),
      (rate) =>
        lineTotalPaise(
          taxablePaiseFor(absorber.quantity, rate),
          absorber.gstRate,
          isIntraState,
        ),
      needed,
    );
    return solved;
  }

  /**
   * The other lines' rates, scaled back to leave the absorber something to work
   * with.
   *
   * Rounding a rate *up* on a line of many units can overshoot the whole target
   * before the absorber gets a look in — half a rupee across 500 units is ₹250 —
   * and the absorber cannot go below ₹1 a unit to claw it back. Scaling down
   * (and flooring, so rates can only fall) restores a positive remainder.
   */
  function scaledToFit(candidate: readonly number[]): number[] {
    const absorberFloor = lineTotalPaise(
      taxablePaiseFor(absorber.quantity, MIN_RATE),
      absorber.gstRate,
      isIntraState,
    );
    const room = targetPaise - absorberFloor;
    const rest = restPaise(candidate);
    if (rest <= room || rest <= 0 || room <= 0) return [...candidate];

    const scale = room / rest;
    return candidate.map((rate, index) =>
      index === absorberIndex
        ? rate
        : Math.max(MIN_RATE, Math.floor(rate * scale)),
    );
  }

  // Both routes are tried and the closer one kept. Scaling only helps when the
  // first pass overshot, and it costs nothing to find out which happened.
  const best = [withAbsorber(rates), withAbsorber(scaledToFit(rates))]
    .map((candidate) => score(toSolvedItems(items, candidate), target, isIntraState))
    .filter((scored): scored is NonNullable<typeof scored> => scored !== null)
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0];

  if (!best) {
    return {
      ok: false,
      error: `Quick Fill could not price these items at whole-rupee rates near ₹${formatINR(target)}. Try a different target.`,
    };
  }

  return best;
}

/**
 * Measure a candidate against the target, through the app's own GST engine.
 *
 * The total reported is `computeInvoice()`'s, never one worked out here, so the
 * figure the user is shown is the figure their invoice will show.
 *
 * Every row is put back through `invoiceItemFormSchema` on the way out as well.
 * The rates are ours rather than the model's, but they are still generated
 * numbers reaching a form, and §4 does not make exceptions for its own code.
 * A candidate that fails either check returns null rather than being handed on.
 */
function score(
  items: InvoiceItemFormValues[],
  target: number,
  isIntraState: boolean,
): Extract<SolveQuickFillRatesResult, { ok: true }> | null {
  for (const item of items) {
    if (!Number.isInteger(item.rate) || item.rate < MIN_RATE) return null;
    if (!invoiceItemFormSchema.safeParse(item).success) return null;
  }

  const computed = computeQuickFillInvoice(items, isIntraState);

  return {
    ok: true,
    items,
    total: computed.grandTotal,
    target,
    gap: computed.grandTotal - target,
    roundOff: computed.roundOff,
  };
}
