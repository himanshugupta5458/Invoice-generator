/**
 * Tests for Quick Fill's pure logic (§16, v1.1).
 *
 * Two things matter here and neither needs a network. First, that the prompt we
 * send actually pins down the shape we depend on (JSON, the six GST slabs, the
 * row cap, weights instead of prices). Second — the important one — that a model
 * reply is treated as hostile input: no row reaches the solver without passing
 * the same schema a hand-typed row passes, and nothing that fails disappears
 * quietly.
 *
 * The arithmetic is not tested here. It is not in this module: the model gives a
 * mix, `lib/quick-fill-solver.ts` prices it, and `tests/quick-fill-solver.test.ts`
 * is where the totals are held to account.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_GENERATED_ITEMS,
  QUICK_FILL_MODEL,
  QUICK_FILL_SYSTEM_PROMPT,
  buildQuickFillRequestBody,
  buildQuickFillUserPrompt,
  impliedTargetFromMix,
  parseQuickFillMix,
} from "@/lib/quick-fill";
import { GST_SLABS } from "@/lib/types";

const GOOD_ROW = {
  description: "Teak side table",
  hsn: "9403",
  quantity: 2,
  weight: 9000,
  gstRate: 18,
};

describe("buildQuickFillUserPrompt", () => {
  it("carries the description through verbatim", () => {
    const prompt = buildQuickFillUserPrompt({
      description: "  artificial jewellery order  ",
    });
    expect(prompt).toContain("artificial jewellery order");
    // Trimmed, so leading whitespace does not become part of the instruction.
    expect(prompt).not.toContain("  artificial");
  });

  it("states the target as a GST-inclusive grand total when one is given", () => {
    const prompt = buildQuickFillUserPrompt({
      description: "furniture shopping",
      targetAmount: 45000,
    });
    expect(prompt).toContain("45000");
    expect(prompt).toContain("GRAND TOTAL including GST");
  });

  it("tells the model the target is for scale, not for it to hit", () => {
    // The whole split: the model judges what a ₹45,000 purchase looks like, the
    // solver makes the figures land. Asking it to do both is what made the old
    // version miss.
    const prompt = buildQuickFillUserPrompt({
      description: "furniture shopping",
      targetAmount: 45000,
    });
    expect(prompt).toContain("judge scale");
    expect(prompt).toContain("Do not try to make the numbers land on it");
  });

  it("tells the model to invent a realistic total when none is given", () => {
    const prompt = buildQuickFillUserPrompt({ description: "office chairs" });
    expect(prompt).toContain("No target total was given");
    expect(prompt).not.toContain("GRAND TOTAL");
  });
});

describe("QUICK_FILL_SYSTEM_PROMPT", () => {
  it("names every GST slab the form accepts, and no others", () => {
    for (const slab of GST_SLABS) {
      expect(QUICK_FILL_SYSTEM_PROMPT).toContain(String(slab));
    }
    expect(QUICK_FILL_SYSTEM_PROMPT).toContain(GST_SLABS.join(", "));
  });

  it("asks for JSON only and caps the row count", () => {
    expect(QUICK_FILL_SYSTEM_PROMPT).toContain("JSON only");
    expect(QUICK_FILL_SYSTEM_PROMPT).toContain(String(MAX_GENERATED_ITEMS));
  });

  it("asks for weights and takes pricing off the model entirely", () => {
    expect(QUICK_FILL_SYSTEM_PROMPT).toContain("weight");
    expect(QUICK_FILL_SYSTEM_PROMPT).toContain("You do not set prices");
    expect(QUICK_FILL_SYSTEM_PROMPT).toContain("do NOT include a");
    // The example row it is shown must not carry a rate either.
    expect(QUICK_FILL_SYSTEM_PROMPT).not.toContain('"rate"');
  });

  it("keeps the user's text out of the standing instruction", () => {
    // The separation is what stops a description reading as an instruction.
    expect(QUICK_FILL_SYSTEM_PROMPT).not.toContain("Purchase description");
  });
});

describe("buildQuickFillRequestBody", () => {
  it("pins the model, JSON mode, and the system/user split", () => {
    const body = buildQuickFillRequestBody({
      description: "furniture shopping",
      targetAmount: 45000,
    });

    expect(body.model).toBe(QUICK_FILL_MODEL);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({
      role: "system",
      content: QUICK_FILL_SYSTEM_PROMPT,
    });
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toContain("furniture shopping");
  });
});

describe("parseQuickFillMix", () => {
  it("accepts the object shape it asked for", () => {
    const result = parseQuickFillMix(JSON.stringify({ items: [GOOD_ROW] }));
    expect(result.responseError).toBeUndefined();
    expect(result.rejected).toEqual([]);
    expect(result.items).toEqual([GOOD_ROW]);
  });

  it("accepts a bare array, which the model sometimes returns instead", () => {
    const result = parseQuickFillMix(JSON.stringify([GOOD_ROW]));
    expect(result.items).toHaveLength(1);
  });

  it("digs the JSON out of markdown fences and stray commentary", () => {
    const fenced =
      'Sure! Here you go:\n```json\n{"items":' +
      JSON.stringify([GOOD_ROW]) +
      "}\n```\nHope that helps.";
    expect(parseQuickFillMix(fenced).items).toHaveLength(1);
  });

  it("coerces the numbers a model actually writes", () => {
    const result = parseQuickFillMix(
      JSON.stringify({
        items: [
          {
            description: "Fabric sofa",
            hsn: "9401",
            quantity: "1",
            weight: "₹32,000.00",
            gstRate: "18%",
          },
        ],
      }),
    );
    expect(result.rejected).toEqual([]);
    expect(result.items[0]).toEqual({
      description: "Fabric sofa",
      hsn: "9401",
      quantity: 1,
      weight: 32000,
      gstRate: 18,
    });
  });

  it("accepts the field aliases a model reaches for", () => {
    const result = parseQuickFillMix(
      JSON.stringify({
        lineItems: [
          { name: "Brass earrings", qty: 4, share: 1400, gst: 3, sac: "7117" },
        ],
      }),
    );
    expect(result.items).toEqual([
      {
        description: "Brass earrings",
        hsn: "7117",
        quantity: 4,
        weight: 1400,
        gstRate: 3,
      },
    ]);
  });

  it("reads a quoted per-unit price as a proportion when the model prices anyway", () => {
    // Told not to, some models still send a rate. A rate is a perfectly good
    // proportion, so it is taken as one — quantity × rate is the line's share —
    // and never used as money.
    const result = parseQuickFillMix(
      JSON.stringify({
        items: [
          { description: "Fabric sofa", quantity: 2, rate: 16000, gstRate: 18 },
        ],
      }),
    );
    expect(result.rejected).toEqual([]);
    expect(result.items[0].weight).toBe(32000);
  });

  it("treats a missing HSN as absent rather than as a failure", () => {
    const result = parseQuickFillMix(
      JSON.stringify({
        items: [
          { description: "Consulting", quantity: 1, weight: 5000, gstRate: 18 },
        ],
      }),
    );
    expect(result.rejected).toEqual([]);
    expect(result.items[0].hsn).toBe("");
  });

  it("refuses a GST rate that is not one of the slabs, and says so", () => {
    const result = parseQuickFillMix(
      JSON.stringify({
        items: [GOOD_ROW, { ...GOOD_ROW, description: "Lamp", gstRate: 15 }],
      }),
    );

    // The good row still lands — one bad row does not sink the batch.
    expect(result.items).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].index).toBe(2);
    expect(result.rejected[0].label).toBe("Lamp");
    expect(result.rejected[0].messages.join(" ")).toContain("GST rate");
  });

  it("refuses rows the form itself would refuse", () => {
    const result = parseQuickFillMix(
      JSON.stringify({
        items: [
          { description: "", quantity: 1, weight: 10, gstRate: 18 },
          { description: "Chair", quantity: 0, weight: 10, gstRate: 18 },
          { description: "Chair", quantity: 1, weight: -5, gstRate: 18 },
          { description: "Chair", quantity: 1, weight: "lots", gstRate: 18 },
          "not an object",
        ],
      }),
    );

    expect(result.items).toEqual([]);
    expect(result.rejected).toHaveLength(5);
    expect(result.rejected.map((row) => row.index)).toEqual([1, 2, 3, 4, 5]);
    expect(result.rejected[2].messages.join(" ")).toContain("Weight");
    expect(result.rejected[4].messages).toEqual(["Not an item object."]);
  });

  it("reports rows beyond the cap instead of trimming them silently", () => {
    const rows = Array.from({ length: MAX_GENERATED_ITEMS + 3 }, (_, i) => ({
      ...GOOD_ROW,
      description: `Item ${i + 1}`,
    }));

    const result = parseQuickFillMix(JSON.stringify({ items: rows }));
    expect(result.items).toHaveLength(MAX_GENERATED_ITEMS);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].messages[0]).toContain("3 further row(s)");
  });

  it("reports a reply that is not JSON at all", () => {
    const result = parseQuickFillMix(
      "I'm sorry, I can't help with that request.",
    );
    expect(result.items).toEqual([]);
    expect(result.responseError).toContain("not valid JSON");
  });

  it("reports JSON of the wrong shape, and an empty list", () => {
    expect(parseQuickFillMix('{"note":"none"}').responseError).toContain(
      "did not contain a list",
    );
    expect(parseQuickFillMix('{"items":[]}').responseError).toContain(
      "no items",
    );
    expect(parseQuickFillMix("").responseError).toContain("not valid JSON");
  });
});

describe("impliedTargetFromMix", () => {
  it("grosses the weights up by their own slabs, to the rupee", () => {
    // 10000 at 18% plus 5000 at 5% is 11800 + 5250.
    expect(
      impliedTargetFromMix([
        { description: "a", quantity: 1, weight: 10000, gstRate: 18 },
        { description: "b", quantity: 1, weight: 5000, gstRate: 5 },
      ]),
    ).toBe(17050);
  });

  it("is a whole rupee, because an invoice total always is", () => {
    const target = impliedTargetFromMix([
      { description: "a", quantity: 1, weight: 1234.56, gstRate: 12 },
    ]);
    expect(Number.isInteger(target)).toBe(true);
  });

  it("never implies a target of zero, however small the weights", () => {
    expect(
      impliedTargetFromMix([
        { description: "a", quantity: 1, weight: 0.0001, gstRate: 0 },
      ]),
    ).toBe(1);
  });
});
