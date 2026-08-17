/**
 * Tests for Quick Fill's pure logic (§16, v1.1).
 *
 * Two things matter here and neither needs a network. First, that the prompt we
 * send actually pins down the shape we depend on (JSON, the six GST slabs, the
 * row cap, the target). Second — the important one — that a model reply is
 * treated as hostile input: no row reaches the form without passing the same
 * schema a hand-typed row passes, and nothing that fails disappears quietly.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_GENERATED_ITEMS,
  QUICK_FILL_MODEL,
  QUICK_FILL_SYSTEM_PROMPT,
  buildQuickFillRequestBody,
  buildQuickFillUserPrompt,
  estimateQuickFillTotal,
  parseQuickFillResponse,
} from "@/lib/quick-fill";
import { GST_SLABS } from "@/lib/types";

const GOOD_ROW = {
  description: "Teak side table",
  hsn: "9403",
  quantity: 2,
  rate: 4500,
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
    expect(prompt).toContain("quantity × rate × (1 + gstRate/100)");
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

describe("parseQuickFillResponse", () => {
  it("accepts the object shape it asked for", () => {
    const result = parseQuickFillResponse(
      JSON.stringify({ items: [GOOD_ROW] }),
    );
    expect(result.responseError).toBeUndefined();
    expect(result.rejected).toEqual([]);
    expect(result.items).toEqual([GOOD_ROW]);
  });

  it("accepts a bare array, which the model sometimes returns instead", () => {
    const result = parseQuickFillResponse(JSON.stringify([GOOD_ROW]));
    expect(result.items).toHaveLength(1);
  });

  it("digs the JSON out of markdown fences and stray commentary", () => {
    const fenced =
      'Sure! Here you go:\n```json\n{"items":' +
      JSON.stringify([GOOD_ROW]) +
      "}\n```\nHope that helps.";
    expect(parseQuickFillResponse(fenced).items).toHaveLength(1);
  });

  it("coerces the numbers a model actually writes", () => {
    const result = parseQuickFillResponse(
      JSON.stringify({
        items: [
          {
            description: "Fabric sofa",
            hsn: "9401",
            quantity: "1",
            rate: "₹32,000.00",
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
      rate: 32000,
      gstRate: 18,
    });
  });

  it("accepts the field aliases a model reaches for", () => {
    const result = parseQuickFillResponse(
      JSON.stringify({
        lineItems: [
          { name: "Brass earrings", qty: 4, price: 350, gst: 3, sac: "7117" },
        ],
      }),
    );
    expect(result.items).toEqual([
      {
        description: "Brass earrings",
        hsn: "7117",
        quantity: 4,
        rate: 350,
        gstRate: 3,
      },
    ]);
  });

  it("treats a missing HSN as absent rather than as a failure", () => {
    const result = parseQuickFillResponse(
      JSON.stringify({
        items: [{ description: "Consulting", quantity: 1, rate: 5000, gstRate: 18 }],
      }),
    );
    expect(result.rejected).toEqual([]);
    expect(result.items[0].hsn).toBe("");
  });

  it("refuses a GST rate that is not one of the slabs, and says so", () => {
    const result = parseQuickFillResponse(
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
    const result = parseQuickFillResponse(
      JSON.stringify({
        items: [
          { description: "", quantity: 1, rate: 10, gstRate: 18 },
          { description: "Chair", quantity: 0, rate: 10, gstRate: 18 },
          { description: "Chair", quantity: 1, rate: -5, gstRate: 18 },
          { description: "Chair", quantity: 1, rate: "lots", gstRate: 18 },
          "not an object",
        ],
      }),
    );

    expect(result.items).toEqual([]);
    expect(result.rejected).toHaveLength(5);
    expect(result.rejected.map((row) => row.index)).toEqual([1, 2, 3, 4, 5]);
    expect(result.rejected[4].messages).toEqual(["Not an item object."]);
  });

  it("reports rows beyond the cap instead of trimming them silently", () => {
    const rows = Array.from({ length: MAX_GENERATED_ITEMS + 3 }, (_, i) => ({
      ...GOOD_ROW,
      description: `Item ${i + 1}`,
    }));

    const result = parseQuickFillResponse(JSON.stringify({ items: rows }));
    expect(result.items).toHaveLength(MAX_GENERATED_ITEMS);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].messages[0]).toContain("3 further row(s)");
  });

  it("reports a reply that is not JSON at all", () => {
    const result = parseQuickFillResponse(
      "I'm sorry, I can't help with that request.",
    );
    expect(result.items).toEqual([]);
    expect(result.responseError).toContain("not valid JSON");
  });

  it("reports JSON of the wrong shape, and an empty list", () => {
    expect(parseQuickFillResponse('{"note":"none"}').responseError).toContain(
      "did not contain a list",
    );
    expect(parseQuickFillResponse('{"items":[]}').responseError).toContain(
      "no items",
    );
    expect(parseQuickFillResponse("").responseError).toContain("not valid JSON");
  });
});

describe("estimateQuickFillTotal", () => {
  it("totals quantity x rate plus GST, to the paisa", () => {
    expect(
      estimateQuickFillTotal([
        { description: "a", quantity: 2, rate: 4500, gstRate: 18 },
        { description: "b", quantity: 1, rate: 1000, gstRate: 5 },
      ]),
    ).toBe(11670);
  });

  it("is 0 for no items", () => {
    expect(estimateQuickFillTotal([])).toBe(0);
  });
});
