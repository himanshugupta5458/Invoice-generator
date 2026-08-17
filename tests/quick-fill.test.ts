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
  MAX_COMPLETION_TOKENS,
  MAX_GENERATED_ITEMS,
  QUICK_FILL_MODEL,
  QUICK_FILL_SYSTEM_PROMPT,
  buildQuickFillRequestBody,
  buildQuickFillSystemPrompt,
  buildQuickFillUserPrompt,
  impliedTargetFromMix,
  parseGstRateFromDescription,
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
    expect(body.max_tokens).toBe(MAX_COMPLETION_TOKENS);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({
      role: "system",
      content: QUICK_FILL_SYSTEM_PROMPT,
    });
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toContain("furniture shopping");
  });

  it("defaults to a model Groq still serves", () => {
    // llama-3.3-70b-versatile was the original default and now answers 404
    // model_not_found. This is the guard against shipping a retired name again.
    expect(QUICK_FILL_MODEL).toBe("openai/gpt-oss-120b");
    expect(QUICK_FILL_MODEL).not.toBe("llama-3.3-70b-versatile");
  });

  it("lets the caller override the model, for when this one is retired too", () => {
    const body = buildQuickFillRequestBody({
      description: "furniture shopping",
      model: "llama-4-something-newer",
    });
    expect(body.model).toBe("llama-4-something-newer");
  });

  it("treats a blank override as no override", () => {
    // Deploy platforms hand back "" for a variable somebody created and left
    // empty, and "" is not a model — it would 404 every request.
    for (const model of [undefined, "", "   "]) {
      expect(
        buildQuickFillRequestBody({ description: "sofa", model }).model,
      ).toBe(QUICK_FILL_MODEL);
    }
  });

  it("budgets enough completion tokens for the model's reasoning", () => {
    // Measured against the live API: a 12-item reply spends ~768 completion
    // tokens, roughly 500 of it reasoning. Too small truncates the JSON and
    // surfaces as "not valid JSON"; too large is reserved against the free
    // tier's per-minute cap and buys a 429 instead. See the constant's comment.
    expect(MAX_COMPLETION_TOKENS).toBeGreaterThanOrEqual(1500);
    expect(MAX_COMPLETION_TOKENS).toBeLessThanOrEqual(3000);
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

describe("parseGstRateFromDescription", () => {
  it("reads a slab the user named alongside the goods", () => {
    expect(parseGstRateFromDescription("Motor Parts 5%").gstRate).toBe(5);
    expect(
      parseGstRateFromDescription("artificial jewellery 12%").gstRate,
    ).toBe(12);
  });

  it("accepts the ways somebody actually writes a rate", () => {
    for (const [text, rate] of [
      ["cotton shirts 5%", 5],
      ["cotton shirts 5 %", 5],
      ["cotton shirts 18 percent", 18],
      ["cotton shirts 28pct", 28],
      ["cotton shirts GST 12", 12],
      ["cotton shirts gst: 3", 3],
      ["unbranded grains 0%", 0],
      ["sofa set 5.0%", 5],
    ] as const) {
      expect(parseGstRateFromDescription(text).gstRate).toBe(rate);
    }
  });

  it("says nothing when no rate was named", () => {
    expect(parseGstRateFromDescription("furniture shopping")).toEqual({});
    // A plain number is a quantity or a price, not a tax rate.
    expect(parseGstRateFromDescription("2 sofas and 4 chairs")).toEqual({});
  });

  it("refuses a figure that is not a GST slab, and lists the ones that are", () => {
    const result = parseGstRateFromDescription("motor parts 15%");
    expect(result.gstRate).toBeUndefined();
    expect(result.error).toContain("15% is not a GST slab");
    for (const slab of GST_SLABS) {
      expect(result.error).toContain(String(slab));
    }
  });

  it("refuses a fractional rate", () => {
    expect(parseGstRateFromDescription("sarees 12.5%").error).toContain(
      "not a GST slab",
    );
  });

  it("asks rather than guesses when two different rates are named", () => {
    // "12%" is plausibly the tax and "5%" plausibly a discount, or the reverse.
    // Picking one would put a rate on an invoice on the strength of a guess.
    const result = parseGstRateFromDescription("jewellery 12% with 5% discount");
    expect(result.gstRate).toBeUndefined();
    expect(result.error).toContain("5% and 12%");
    expect(result.error).toContain("say which GST rate applies");
  });

  it("is content when the same rate is named twice", () => {
    expect(
      parseGstRateFromDescription("motor parts 5%, all items at 5%").gstRate,
    ).toBe(5);
  });

  it("does not carry regex state between calls", () => {
    // The patterns are /g; reusing one without resetting lastIndex would make
    // the second call miss.
    expect(parseGstRateFromDescription("motor parts 5%").gstRate).toBe(5);
    expect(parseGstRateFromDescription("motor parts 5%").gstRate).toBe(5);
  });
});

describe("parseQuickFillMix — a slab the user pinned", () => {
  it("puts every row on that slab, whatever the model chose", () => {
    const result = parseQuickFillMix(
      JSON.stringify({
        items: [
          { description: "Brake pad", quantity: 4, weight: 1200, gstRate: 28 },
          { description: "Oil filter", quantity: 2, weight: 400, gstRate: 18 },
        ],
      }),
      5,
    );

    expect(result.rejected).toEqual([]);
    expect(result.items.map((item) => item.gstRate)).toEqual([5, 5]);
  });

  it("keeps a row whose slab was off-list, since the slab is being replaced", () => {
    // Rejecting a good item over a field about to be overwritten would be a
    // refusal with no consequence.
    const result = parseQuickFillMix(
      JSON.stringify({
        items: [{ description: "Brake pad", quantity: 4, weight: 1200, gstRate: 15 }],
      }),
      5,
    );

    expect(result.rejected).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].gstRate).toBe(5);
  });

  it("still refuses a row that is bad for some other reason", () => {
    const result = parseQuickFillMix(
      JSON.stringify({
        items: [{ description: "", quantity: 4, weight: 1200, gstRate: 15 }],
      }),
      5,
    );
    expect(result.items).toEqual([]);
    expect(result.rejected[0].messages.join(" ")).toContain("Describe the item");
  });

  it("leaves the model's per-item slabs alone when nothing was pinned", () => {
    const result = parseQuickFillMix(
      JSON.stringify({
        items: [
          { description: "Brake pad", quantity: 4, weight: 1200, gstRate: 28 },
          { description: "Oil filter", quantity: 2, weight: 400, gstRate: 18 },
        ],
      }),
    );
    expect(result.items.map((item) => item.gstRate)).toEqual([28, 18]);
  });
});

describe("buildQuickFillUserPrompt — a pinned slab", () => {
  it("tells the model the slab and to set it on every row", () => {
    const prompt = buildQuickFillUserPrompt({
      description: "Motor Parts",
      gstRate: 5,
    });
    expect(prompt).toContain("taxed at 5% GST");
    expect(prompt).toContain('"gstRate": 5');
  });

  /**
   * The regression this file previously enshrined.
   *
   * There used to be a test here asserting the prompt contained "genuinely
   * attract 5%" — the clause that told the model to pick goods and HSN codes to
   * suit the pinned slab. That clause is what made "Artificial Jewelry
   * Necklaces, 18% GST" come back as televisions, sofas and A4 paper: the
   * catalogue lists artificial jewellery at 3% / 12% and never 18%, so "these
   * goods" and "goods at 18%" were a contradiction, and the model resolved it by
   * dropping the goods. Against the live model it also produced services instead
   * of goods, HSN codes from the wrong chapter, no HSN at all, and outright
   * refusals.
   *
   * It could never have helped: `parseQuickFillMix` overwrites `gstRate` on
   * every row with the pinned value before validation, so the model's slab
   * choice is discarded regardless. Only its HSN survived — the one thing the
   * clause corrupted.
   */
  it("never asks the model to choose goods or HSN codes to suit the slab", () => {
    const prompt = buildQuickFillUserPrompt({
      description: "Artificial jewellery necklaces",
      gstRate: 18,
    });

    expect(prompt).not.toContain("genuinely attract");
    expect(prompt).toContain("not a filter on what was bought");
    expect(prompt).toMatch(/do\s+NOT change which goods you choose/i);
  });

  it("says nothing about a slab when none was pinned", () => {
    const prompt = buildQuickFillUserPrompt({ description: "Motor Parts" });
    expect(prompt).not.toContain("taxed at");
  });
});

/**
 * Category adherence — what the prompt is required to say.
 *
 * A caveat worth being blunt about: these are contract tests on the prompt, not
 * proof of model behaviour. Nothing here can show that a model obeys an
 * instruction; only that the instruction is present, and that the specific
 * wording which provably broke adherence has not crept back. Model behaviour was
 * checked separately against the live API, and what that spot check confirmed is
 * recorded in `describe("category adherence — live spot check")` below.
 */
describe("category adherence — the prompt's standing rules", () => {
  it("makes the described goods the governing rule", () => {
    expect(QUICK_FILL_SYSTEM_PROMPT).toContain("THE ITEMS ARE THE GOODS DESCRIBED");
    expect(QUICK_FILL_SYSTEM_PROMPT).toMatch(/never substitute goods from another trade/i);
    expect(QUICK_FILL_SYSTEM_PROMPT).toMatch(/never swap goods for\s+services/i);
  });

  it("asks for the category back, so a misread is visible to the user", () => {
    expect(QUICK_FILL_SYSTEM_PROMPT).toContain('"category"');
    expect(QUICK_FILL_SYSTEM_PROMPT).toMatch(/shown back to the\s+user/i);
  });

  it("defaults to a 5-10 item mix rather than the hard cap", () => {
    expect(QUICK_FILL_SYSTEM_PROMPT).toContain("between 5 and 10 items");
    expect(QUICK_FILL_SYSTEM_PROMPT).toContain(String(MAX_GENERATED_ITEMS));
  });

  it("frames the catalogue as a vocabulary, not a menu to pick from", () => {
    const prompt = buildQuickFillSystemPrompt(
      "## Artificial Jewellery — HSN 7117\nKundan necklace set, Meenakari jhumka",
    );

    expect(prompt).toContain("VOCABULARY, not a menu");
    expect(prompt).toMatch(/from THAT section only/);
    expect(prompt).toMatch(/wrong answers/i);
    // The slabs in the catalogue must not be allowed to decide the goods —
    // which is exactly how the jewellery invoice turned into a furniture one.
    expect(prompt).toMatch(/never decide which goods belong/i);
  });

  it("tells the model what this data is for, which stops it refusing", () => {
    // Left unsaid, "put 18% on these goods" read as a request to help misstate
    // tax: the live model answered "I'm sorry, but I can't comply with that
    // request" on roughly one run in five, which reaches the user as a generic
    // "the AI service had a problem".
    expect(QUICK_FILL_SYSTEM_PROMPT).toMatch(/sample data for testing/i);
    expect(QUICK_FILL_SYSTEM_PROMPT).toMatch(/never filed/i);
  });
});

/**
 * What the live API confirmed, recorded so the next person does not have to
 * re-derive it — and so a future prompt edit can be re-checked the same way.
 *
 * Run against `openai/gpt-oss-120b` with the shipped catalogue, description
 * "Artificial Jewelry Necklaces, 18% GST", eight consecutive generations:
 *
 *   before the fix (6 runs): 3 refusals or unparseable replies; of the rest,
 *     one returned design/plating *services*, one returned HSN 8306 and 3926
 *     (base metal and plastics), one returned no HSN at all. Zero runs produced
 *     jewellery with its own HSN. The originally reported grab-bag — LED TV,
 *     ceiling fan, sofa set, dining table, office chair, MS angle, paint, A4
 *     paper — is every catalogue section whose heading lists 18%.
 *
 *   after the fix (8 runs): 8/8 returned 5-6 imitation-jewellery lines, every
 *     row HSN 7117, every row at the pinned 18%. No refusals.
 *
 * A spot check after changing this prompt should confirm the same three things:
 * the goods stay in the described trade, the HSN stays the trade's own code
 * rather than one borrowed to suit the slab, and the request is not refused.
 */
describe("category adherence — live spot check", () => {
  it("is documented above rather than run in CI", () => {
    // A placeholder holding the note in the file it belongs to. Hitting Groq
    // from the suite would make `npm test` need a key, cost the shared free
    // tier, and fail on a flaky network — none of which is a unit test's job.
    expect(true).toBe(true);
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
