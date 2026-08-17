/**
 * Tests for Quick Fill's rate solver (§16, v1.1).
 *
 * Pure arithmetic, no network and no model — the solver is a separate function
 * from the AI call precisely so this file can exist.
 *
 * There is really only one assertion here, made many ways: run the solved rows
 * back through the app's own `computeInvoice()` and the grand total is the
 * target, to the rupee. Not within 5%, not within a rupee. Everything else —
 * single slab, mixed slabs, awkward targets, fractional quantities, lopsided
 * weights — is a different way of trying to make that fail.
 */

import { describe, expect, it } from "vitest";

import { computeInvoice } from "@/lib/gst";
import type { QuickFillMixItem } from "@/lib/quick-fill";
import {
  computeQuickFillInvoice,
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

/** The one thing that matters: the invoice these rows make totals the target. */
function expectTotals(
  items: QuickFillMixItem[],
  target: number,
  isIntraState = true,
) {
  const result = solve(items, target, isIntraState);
  const computed = computeQuickFillInvoice(result.items, isIntraState);

  expect(computed.grandTotal).toBe(target);
  expect(result.total).toBe(target);
  return { result, computed };
}

describe("solveQuickFillRates — a single GST slab", () => {
  it("hits a round target exactly", () => {
    expectTotals([mix(18, 1, 2), mix(18, 1, 3)], 45000);
  });

  it("hits every slab exactly on its own", () => {
    for (const slab of [0, 3, 5, 12, 18, 28]) {
      expectTotals([mix(slab, 1, 1), mix(slab, 2, 4)], 45000);
    }
  });

  it("hits a target that the slab cannot divide cleanly", () => {
    // 45000 / 1.18 is 38135.593…, so the pre-tax value has to be chosen against
    // the GST rounding rather than the division taken at face value.
    const { computed } = expectTotals([mix(18, 1, 1)], 45000);
    expect(computed.subTotal + computed.totalTax).toBe(45000);
    // Landed on the paise, so the invoice needs no rupee round-off at all.
    expect(computed.roundOff).toBe(0);
    expect(computed.grandTotalRaw).toBe(45000);
  });

  it("hits a run of consecutive awkward targets", () => {
    // Sweeping a range catches the targets a single line's arithmetic skips —
    // its contribution moves in ~1.18 paise steps, so not every paise is
    // reachable and the last rupee has to come from somewhere.
    for (let target = 9991; target <= 10010; target += 1) {
      expectTotals([mix(28, 1, 3)], target);
    }
  });
});

describe("solveQuickFillRates — mixed GST slabs", () => {
  const FURNITURE = [
    mix(18, 32000, 1, "Fabric sofa"),
    mix(18, 9000, 2, "Teak side table"),
    mix(12, 2500, 1, "Floor lamp"),
    mix(5, 800, 4, "Cushion cover"),
  ];

  it("hits the target across four slabs", () => {
    expectTotals(FURNITURE, 45000);
  });

  it("hits it on an inter-state invoice too", () => {
    // IGST rounds the whole slab once where CGST + SGST rounds half of it twice,
    // so the same mix has to be solved differently for the two branches.
    expectTotals(FURNITURE, 45000, false);
  });

  it("hits a long run of targets on both tax branches", () => {
    for (const isIntraState of [true, false]) {
      for (let target = 12345; target <= 12395; target += 1) {
        expectTotals(FURNITURE, target, isIntraState);
      }
    }
  });

  it("hits targets across four orders of magnitude", () => {
    for (const target of [500, 4999, 45000, 123457, 9_999_999, 87_654_321]) {
      expectTotals(FURNITURE, target);
    }
  });

  it("keeps a 0% line untaxed while still landing on the target", () => {
    const { result, computed } = expectTotals(
      [mix(0, 5000, 1, "Fresh produce"), mix(18, 5000, 1, "Packing crate")],
      20000,
    );
    expect(result.items[0].gstRate).toBe(0);
    expect(computed.lines[0].gstAmount).toBe(0);
  });
});

describe("solveQuickFillRates — how the rates come out", () => {
  it("splits the target by weight, not evenly", () => {
    // 3:1 by weight at the same slab means 3:1 by rate.
    const { result } = expectTotals([mix(18, 3, 1), mix(18, 1, 1)], 40000);
    const [heavy, light] = result.items;
    expect(heavy.rate / light.rate).toBeCloseTo(3, 2);
  });

  it("divides a line's value by its quantity to get a per-unit rate", () => {
    const { result } = expectTotals([mix(18, 1, 5, "Chairs")], 11800);
    // 11800 inclusive is 10000 taxable over 5 units.
    expect(result.items[0].quantity).toBe(5);
    expect(result.items[0].rate).toBeCloseTo(2000, 2);
  });

  it("keeps rates at whole paise and absorbs the drift on one line", () => {
    const { result } = expectTotals(
      [mix(18, 4, 3), mix(12, 3, 2), mix(5, 2, 7), mix(28, 1, 1)],
      67891,
    );

    for (const item of result.items) {
      expect(Number.isInteger(Math.round(item.rate * 100))).toBe(true);
      expect(item.rate * 100).toBeCloseTo(Math.round(item.rate * 100), 6);
      expect(item.rate).toBeGreaterThan(0);
    }
  });

  it("absorbs the drift into the rates, not into the round-off line", () => {
    // Round-off is a consequence of rupee rounding, not a fudge factor: it has
    // to stay inside half a rupee, which is also exactly what makes the grand
    // total land on the target.
    for (let target = 5000; target <= 5060; target += 1) {
      const { computed } = expectTotals(
        [mix(18, 5, 2), mix(5, 3, 9), mix(28, 2, 4)],
        target,
      );
      expect(Math.abs(computed.roundOff)).toBeLessThan(0.5);
      // The absorbing line here is 2 units at 18%, so its rate moves the total
      // in 2.36 paise steps and the leftover cannot exceed half of that.
      expect(Math.abs(computed.roundOff)).toBeLessThanOrEqual(0.02);
    }
  });

  it("leaves no round-off at all when a one-unit line can absorb the drift", () => {
    for (let target = 5000; target <= 5060; target += 1) {
      const { computed } = expectTotals(
        [mix(18, 5, 2), mix(5, 3, 9), mix(12, 2, 1)],
        target,
      );
      // A single unit is a one-paise dial on the taxable value, so the residual
      // is swallowed whole except where the slab's own rounding skips a paise.
      expect(Math.abs(computed.roundOff)).toBeLessThanOrEqual(0.01);
    }
  });

  it("carries the description, HSN, quantity and slab through untouched", () => {
    const { result } = expectTotals(
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
    expectTotals(
      [mix(5, 900, 2.5, "Basmati rice (kg)"), mix(12, 400, 0.75, "Spice mix (kg)")],
      31337,
    );
  });

  it("handles a lopsided weight that would round a line down to nothing", () => {
    // The 1-in-a-million line cannot be priced at its share of ₹1,000, so it is
    // floored at a paise and the heavy line still has to make the total work.
    expectTotals([mix(18, 1_000_000, 1), mix(18, 1, 1)], 1000);
  });

  it("handles the maximum number of rows", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      mix([0, 3, 5, 12, 18, 28][i % 6], i + 1, (i % 4) + 1, `Item ${i + 1}`),
    );
    expectTotals(rows, 246813);
  });

  it("handles large quantities, where a whole-paise rate is too coarse a dial", () => {
    // 500 units move the total in ~5.90 rupee steps, so the absorbing line's
    // rate has to go finer than the paise. It still has to land on the rupee.
    for (let target = 60000; target <= 60010; target += 1) {
      expectTotals([mix(18, 1, 500, "Printed flyers")], target);
    }
  });

  it("prices a single one-unit line", () => {
    expectTotals([mix(12, 1, 1)], 7777);
  });

  it("budgets for a near-weightless line that still costs a paise a unit", () => {
    // 999 units of something the model gave a rounding-error weight still cost
    // ₹9.99 at the floor. Split the target by weight alone and that ₹9.99 is
    // spent twice, leaving the absorbing line to find rupees that are not there.
    expectTotals(
      [
        mix(12, 10_000_000, 100, "Office desk"),
        mix(3, 1000, 1, "Delivery"),
        mix(18, 0.000001, 999, "Cable tie"),
      ],
      45000,
    );
  });

  it("recovers when rounding a many-unit line up overshoots the target", () => {
    // 5,000 units rounded up half a paise is ₹25 — enough to blow past a small
    // target before the absorbing line is even consulted.
    expectTotals(
      [mix(18, 10_000_000, 5000, "Printed flyer"), mix(3, 0.01, 999, "Sticker")],
      100,
    );
  });
});

describe("solveQuickFillRates — over a spread of generated mixes", () => {
  /**
   * The invariant, asserted in bulk rather than case by case.
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

  it("totals the target exactly on every one of them", () => {
    const missed: string[] = [];

    for (const { items, target, isIntraState } of generated(2000)) {
      const result = solveQuickFillRates({ items, target, isIntraState });
      if (!result.ok) {
        missed.push(`₹${target}: refused — ${result.error}`);
        continue;
      }
      const grandTotal = computeQuickFillInvoice(
        result.items,
        isIntraState,
      ).grandTotal;
      if (grandTotal !== target) missed.push(`₹${target}: got ₹${grandTotal}`);
    }

    expect(missed).toEqual([]);
  });
});

describe("solveQuickFillRates — targets it refuses", () => {
  function refusal(items: QuickFillMixItem[], target: number) {
    const result = solveQuickFillRates({ items, target, isIntraState: true });
    expect(result.ok).toBe(false);
    return result.ok ? "" : result.error;
  }

  it("refuses a target below the smallest invoice the items can make", () => {
    // Twelve lines cannot come to ₹1 even at a paise a unit.
    const rows = Array.from({ length: 12 }, (_, i) => mix(18, 1, 20, `Item ${i}`));
    const error = refusal(rows, 1);
    expect(error).toContain("too small");
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
    // The solver verifies against stand-in records; this is the proof that the
    // stand-ins produce the same *arithmetic* a genuine seller and buyer would.
    // Place of supply is the buyer's own name for their state and is the one
    // thing the stand-in cannot supply, so it is compared out.
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
      expect(stub.grandTotal).toBe(45000);
    }
  });
});
