/**
 * Tests for Quick Fill's rate solver (§16, v1.1).
 *
 * Pure arithmetic, no network and no model — the solver is a separate function
 * from the AI call precisely so this file can exist.
 *
 * Two assertions, made many ways. First, and absolutely: EVERY RATE IS A WHOLE
 * NUMBER OF RUPEES, because that is what a real invoice quotes and it is the
 * constraint that wins whenever the two goals conflict. Second: the grand total
 * `computeInvoice()` reports lands within `quickFillTargetTolerance()` of the
 * target, and the solver says how far off it is rather than implying it hit.
 *
 * Everything else — single slab, mixed slabs, both tax branches, awkward
 * targets, fractional quantities, lopsided weights — is a different way of
 * trying to make one of those two fail.
 */

import { describe, expect, it } from "vitest";

import { computeInvoice } from "@/lib/gst";
import type { QuickFillMixItem } from "@/lib/quick-fill";
import {
  computeQuickFillInvoice,
  quickFillTargetTolerance,
  solveQuickFillRates,
} from "@/lib/quick-fill-solver";
import type { BusinessProfile, Buyer } from "@/lib/types";

function mix(
  gstRate: number,
  weight: number,
  quantity = 1,
  description = `Item ${gstRate}%`,
): QuickFillMixItem {
  return { description, hsn: "9403", quantity, weight, gstRate };
}

/** Solve, or fail the test with the solver's own reason. */
function solve(
  items: QuickFillMixItem[],
  target: number,
  isIntraState = true,
) {
  const result = solveQuickFillRates({ items, target, isIntraState });
  if (!result.ok) {
    throw new Error(`solver refused ₹${target}: ${result.error}`);
  }
  return result;
}

/**
 * The contract, checked in one place: whole-rupee rates, a total that is the GST
 * engine's own, and a gap inside the tolerance for this mix.
 */
function expectSolved(
  items: QuickFillMixItem[],
  target: number,
  isIntraState = true,
) {
  const result = solve(items, target, isIntraState);
  const computed = computeQuickFillInvoice(result.items, isIntraState);

  for (const item of result.items) {
    expect(Number.isInteger(item.rate)).toBe(true);
    expect(item.rate).toBeGreaterThanOrEqual(1);
  }

  // The reported total is the invoice's own, and the reported gap describes it.
  expect(result.total).toBe(computed.grandTotal);
  expect(result.target).toBe(target);
  expect(result.gap).toBe(computed.grandTotal - target);
  expect(Math.abs(result.gap)).toBeLessThanOrEqual(
    quickFillTargetTolerance(items),
  );

  return { result, computed };
}

describe("quickFillTargetTolerance", () => {
  it("is half a rupee for a mix with a single-unit line", () => {
    // One unit at 0% moves the total in ₹1 steps, so the best a whole-rupee rate
    // can do is half a rupee out; the grand total's own rounding covers the rest.
    expect(quickFillTargetTolerance([mix(0, 1, 1)])).toBe(1);
  });

  it("grows with the coarsest dial the mix leaves available", () => {
    // 20 units at 28% move the total in ₹25.60 steps — a rate has to be able to
    // miss by half of that.
    expect(quickFillTargetTolerance([mix(28, 1, 20)])).toBe(14);
  });

  it("is set by the finest line, not the coarsest", () => {
    // The 1-unit line is what does the absorbing, so a 500-unit line beside it
    // does not widen the gap.
    expect(quickFillTargetTolerance([mix(18, 1, 500), mix(12, 1, 1)])).toBe(2);
  });

  it("is 0 for no items", () => {
    expect(quickFillTargetTolerance([])).toBe(0);
  });
});

describe("solveQuickFillRates — whole-rupee rates", () => {
  it("quotes whole rupees, never a back-solved decimal", () => {
    const { result } = expectSolved(
      [
        mix(18, 32000, 1, "Fabric sofa"),
        mix(18, 9000, 2, "Teak side table"),
        mix(12, 2500, 1, "Floor lamp"),
        mix(5, 800, 4, "Cushion cover"),
      ],
      865412,
    );

    // The figures a shop would actually write, not 17675.90 and 287.61.
    expect(result.items.map((item) => item.rate)).toEqual(
      result.items.map((item) => Math.round(item.rate)),
    );
  });

  it("keeps rates whole across every slab and both tax branches", () => {
    for (const slab of [0, 3, 5, 12, 18, 28]) {
      for (const isIntraState of [true, false]) {
        expectSolved([mix(slab, 1, 1), mix(slab, 2, 4)], 45000, isIntraState);
      }
    }
  });

  it("keeps rates whole even where that costs the exact total", () => {
    // One unit at 18% can only make totals of round(rate × 1.18): ₹44,999 at
    // ₹38,135 and ₹45,000 at ₹38,136, and nothing at all in between. ₹45,001 is
    // therefore unreachable, and the rate stays whole rather than becoming
    // ₹38,136.44 to reach it.
    const { result } = expectSolved([mix(18, 1, 1)], 45001);
    expect(Number.isInteger(result.items[0].rate)).toBe(true);
    expect(result.gap).not.toBe(0);
    expect(Math.abs(result.gap)).toBeLessThanOrEqual(1);
  });

  it("still lands exactly when a whole-rupee rate happens to reach the target", () => {
    // The grand total's own rounding to the nearest rupee (§6) gives a whole
    // rate half a rupee of slack, so plenty of targets are still hit dead on.
    // ₹38,136 × 1.18 is ₹45,000.48, which rounds to ₹45,000.
    const { result } = expectSolved([mix(18, 1, 1)], 45000);
    expect(result.items[0].rate).toBe(38136);
    expect(result.gap).toBe(0);
  });
});

describe("solveQuickFillRates — the gap it reports", () => {
  it("reports 0 when the target is genuinely reachable", () => {
    // ₹11,800 at 18% is ₹10,000 taxable over 5 units — ₹2,000 each, exactly.
    const { result } = expectSolved([mix(18, 1, 5, "Chairs")], 11800);
    expect(result.items[0].rate).toBe(2000);
    expect(result.gap).toBe(0);
    expect(result.total).toBe(11800);
  });

  it("signs the gap: negative under the target, positive over", () => {
    const gaps = new Set<string>();
    for (let target = 45000; target <= 45060; target += 1) {
      const { result } = expectSolved([mix(18, 4, 3), mix(12, 1, 2)], target);
      gaps.add(Math.sign(result.gap) < 0 ? "under" : result.gap > 0 ? "over" : "exact");
      // Whichever side it lands on, `total` and `gap` agree with each other.
      expect(result.total - result.target).toBe(result.gap);
    }
    // A run this long lands on both sides, so the sign is carrying information.
    expect(gaps.size).toBeGreaterThan(1);
  });

  it("stays inside the tolerance across a long run of awkward targets", () => {
    const FURNITURE = [
      mix(18, 32000, 1, "Fabric sofa"),
      mix(18, 9000, 2, "Teak side table"),
      mix(12, 2500, 1, "Floor lamp"),
      mix(5, 800, 4, "Cushion cover"),
    ];

    for (const isIntraState of [true, false]) {
      for (let target = 12345; target <= 12395; target += 1) {
        expectSolved(FURNITURE, target, isIntraState);
      }
    }
  });

  it("stays inside the tolerance across four orders of magnitude", () => {
    const MIXED = [mix(18, 3, 2), mix(12, 2, 1), mix(5, 1, 7)];
    for (const target of [500, 4999, 45000, 123457, 9_999_999, 87_654_321]) {
      expectSolved(MIXED, target);
    }
  });

  it("gets closer when the mix leaves a finer dial to turn", () => {
    // Same target, two mixes: the one with a single-unit line can land nearer.
    const coarse = solve([mix(28, 1, 40)], 60000);
    const fine = solve([mix(28, 40, 40), mix(0, 1, 1)], 60000);
    expect(Math.abs(fine.gap)).toBeLessThan(Math.abs(coarse.gap));
    expect(Math.abs(fine.gap)).toBeLessThanOrEqual(1);
  });
});

describe("solveQuickFillRates — how the rates come out", () => {
  it("splits the target by weight, not evenly", () => {
    // 3:1 by weight at the same slab means 3:1 by rate.
    const { result } = expectSolved([mix(18, 3, 1), mix(18, 1, 1)], 40000);
    const [heavy, light] = result.items;
    expect(heavy.rate / light.rate).toBeCloseTo(3, 1);
  });

  it("divides a line's value by its quantity to get a per-unit rate", () => {
    const { result } = expectSolved([mix(18, 1, 5, "Chairs")], 11800);
    expect(result.items[0].quantity).toBe(5);
    expect(result.items[0].rate).toBe(2000);
  });

  it("keeps a 0% line untaxed", () => {
    const { result, computed } = expectSolved(
      [mix(0, 5000, 1, "Fresh produce"), mix(18, 5000, 1, "Packing crate")],
      20000,
    );
    expect(result.items[0].gstRate).toBe(0);
    expect(computed.lines[0].gstAmount).toBe(0);
  });

  it("carries the description, HSN, quantity and slab through untouched", () => {
    const { result } = expectSolved(
      [
        { description: "Brass earrings", hsn: "7117", quantity: 4, weight: 1400, gstRate: 3 },
        { description: "Silver anklet", hsn: "7113", quantity: 1, weight: 2600, gstRate: 3 },
      ],
      5000,
    );

    expect(result.items.map((item) => item.description)).toEqual([
      "Brass earrings",
      "Silver anklet",
    ]);
    expect(result.items.map((item) => item.hsn)).toEqual(["7117", "7113"]);
    expect(result.items.map((item) => item.quantity)).toEqual([4, 1]);
    expect(result.items.map((item) => item.gstRate)).toEqual([3, 3]);
  });
});

describe("solveQuickFillRates — awkward mixes", () => {
  it("handles fractional quantities", () => {
    expectSolved(
      [mix(5, 900, 2.5, "Basmati rice (kg)"), mix(12, 400, 0.75, "Spice mix (kg)")],
      31337,
    );
  });

  it("handles a lopsided weight that would round a line down to nothing", () => {
    expectSolved([mix(18, 1_000_000, 1), mix(18, 1, 1)], 100000);
  });

  it("handles the maximum number of rows", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      mix([0, 3, 5, 12, 18, 28][i % 6], i + 1, (i % 4) + 1, `Item ${i + 1}`),
    );
    expectSolved(rows, 246813);
  });

  it("budgets for a near-weightless line that still costs a rupee a unit", () => {
    // 999 units of something the model gave a rounding-error weight still cost
    // ₹999 at the floor. Split the target by weight alone and that ₹999 is spent
    // twice, leaving the absorbing line to find rupees that are not there.
    expectSolved(
      [
        mix(12, 10_000_000, 100, "Office desk"),
        mix(3, 1000, 1, "Delivery"),
        mix(18, 0.000001, 999, "Cable tie"),
      ],
      450000,
    );
  });

  it("recovers when rounding a many-unit line up overshoots the target", () => {
    // 500 units rounded up a rupee is ₹500 — enough to blow past a small target
    // before the absorbing line is even consulted.
    expectSolved(
      [mix(18, 10_000_000, 500, "Printed flyer"), mix(3, 0.01, 99, "Sticker")],
      1200,
    );
  });

  it("prices a single one-unit line", () => {
    expectSolved([mix(12, 1, 1)], 7777);
  });
});

describe("solveQuickFillRates — targets it refuses", () => {
  function refusal(items: QuickFillMixItem[], target: number) {
    const result = solveQuickFillRates({ items, target, isIntraState: true });
    expect(result.ok).toBe(false);
    return result.ok ? "" : result.error;
  }

  it("refuses a target below the cheapest whole-rupee invoice", () => {
    // Twelve lines of twenty units cannot come to ₹100 at ₹1 a unit.
    const rows = Array.from({ length: 12 }, (_, i) => mix(18, 1, 20, `Item ${i}`));
    const error = refusal(rows, 100);
    expect(error).toContain("too small");
    expect(error).toContain("whole-rupee");
    // Says what the floor actually is, so the user has a number to try.
    expect(error).toMatch(/₹\d/);
  });

  it("refuses a target with paise in it, and says why", () => {
    expect(refusal([mix(18, 1, 1)], 45000.5)).toContain("whole number of rupees");
  });

  it("refuses a target of zero or less", () => {
    expect(refusal([mix(18, 1, 1)], 0)).toContain("greater than 0");
    expect(refusal([mix(18, 1, 1)], -45000)).toContain("greater than 0");
  });

  it("refuses an empty mix rather than returning an empty invoice", () => {
    expect(refusal([], 45000)).toContain("no items");
  });
});

describe("solveQuickFillRates — over a spread of generated mixes", () => {
  /**
   * The invariants, asserted in bulk rather than case by case.
   *
   * Seeded and stepped by hand so the suite runs the same 2,000 mixes every
   * time — a randomised test that changes what it covers between runs is not a
   * regression test.
   */
  function* generated(count: number) {
    const slabs = [0, 3, 5, 12, 18, 28];
    let seed = 20260817;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let n = 0; n < count; n += 1) {
      yield {
        items: Array.from({ length: 1 + Math.floor(next() * 8) }, (_, i) =>
          mix(
            slabs[Math.floor(next() * slabs.length)],
            Math.max(1, next() * 20000),
            1 + Math.floor(next() * 20),
            `Item ${i + 1}`,
          ),
        ),
        target: 1 + Math.floor(next() * 500000),
        isIntraState: next() < 0.5,
      };
    }
  }

  it("keeps every rate whole and every gap inside the tolerance", () => {
    const problems: string[] = [];
    let refused = 0;
    let exact = 0;

    for (const { items, target, isIntraState } of generated(2000)) {
      const result = solveQuickFillRates({ items, target, isIntraState });
      if (!result.ok) {
        // Only the "too small for whole-rupee rates" floor may refuse.
        if (!result.error.includes("too small")) {
          problems.push(`₹${target}: ${result.error}`);
        }
        refused += 1;
        continue;
      }

      const fractional = result.items.filter(
        (item) => !Number.isInteger(item.rate),
      );
      if (fractional.length > 0) {
        problems.push(`₹${target}: fractional rate ${fractional[0].rate}`);
      }

      const grandTotal = computeQuickFillInvoice(
        result.items,
        isIntraState,
      ).grandTotal;
      if (grandTotal !== result.total) {
        problems.push(`₹${target}: reported ₹${result.total}, invoice ₹${grandTotal}`);
      }

      const tolerance = quickFillTargetTolerance(items);
      if (Math.abs(result.gap) > tolerance) {
        problems.push(`₹${target}: gap ${result.gap} over tolerance ${tolerance}`);
      }
      if (result.gap === 0) exact += 1;
    }

    expect(problems).toEqual([]);
    // Sanity on the sweep itself: it is mostly solving, not mostly refusing.
    expect(refused).toBeLessThan(200);
    expect(exact).toBeGreaterThan(0);
  });
});

describe("computeQuickFillInvoice", () => {
  const PROFILE: BusinessProfile = {
    id: "p1",
    name: "Seller",
    address: "1 Road",
    city: "Pune",
    state: "Maharashtra",
    stateCode: "27",
    gstin: "27ABCDE1234F1Z5",
    phone: "",
    email: "",
    bank: { accountName: "", accountNo: "", ifsc: "", bankName: "", upi: "" },
    invoicePrefix: "SC/",
    nextInvoiceNumber: 1,
    accentColor: "#7a5230",
  };

  const buyer = (stateCode: string): Buyer => ({
    name: "Buyer",
    address: "2 Road",
    state: "Somewhere",
    stateCode,
  });

  it("agrees with computeInvoice on a real profile and buyer, both branches", () => {
    // The solver measures against stand-in records; this is the proof that the
    // stand-ins produce the same arithmetic a genuine seller and buyer would.
    const items = solve([mix(18, 3, 2), mix(5, 1, 1)], 45000).items;

    for (const [stateCode, isIntraState] of [
      ["27", true],
      ["29", false],
    ] as const) {
      const stub = computeQuickFillInvoice(items, isIntraState);
      const real = computeInvoice(PROFILE, buyer(stateCode), items);

      expect(stub.isIntraState).toBe(real.isIntraState);
      expect(stub.lines).toEqual(real.lines);
      expect(stub.subTotal).toBe(real.subTotal);
      expect(stub.totalCgst).toBe(real.totalCgst);
      expect(stub.totalSgst).toBe(real.totalSgst);
      expect(stub.totalIgst).toBe(real.totalIgst);
      expect(stub.grandTotalRaw).toBe(real.grandTotalRaw);
      expect(stub.roundOff).toBe(real.roundOff);
      expect(stub.grandTotal).toBe(real.grandTotal);
    }
  });
});
