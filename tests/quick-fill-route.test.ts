/**
 * Tests for POST /api/quick-fill (§16, v1.1).
 *
 * The Groq call is mocked — no key, no network, no free-tier spend. What is
 * actually under test is the handler's contract with the browser: that a target
 * comes back hit exactly rather than approximately, that the key never appears
 * in a response, that every failure path produces a plain sentence instead of an
 * upstream error dump, and that cheap refusals (empty input, rate limit) happen
 * *before* an upstream request is spent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/quick-fill/route";
import {
  GROQ_COMPLETIONS_URL,
  PROMPT_STYLE_EXAMPLE_LIMIT,
  QUICK_FILL_MODEL,
} from "@/lib/quick-fill";
import { quickFillLimiter } from "@/lib/quick-fill-limiter";
import {
  computeQuickFillInvoice,
  quickFillTargetTolerance,
} from "@/lib/quick-fill-solver";

const API_KEY = "gsk_test_key_do_not_use";

/** A distinct IP per request keeps one test's burst out of another's bucket. */
let ipCounter = 0;

function request(body: unknown, ip?: string): Request {
  ipCounter += 1;
  return new Request("http://localhost/api/quick-fill", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip ?? `10.0.0.${ipCounter}`,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/**
 * Make fetch answer with `content` as the model's message.
 *
 * A new Response per call, not one shared instance: a Response body can only be
 * read once, and several tests below call the handler more than twice.
 */
function mockGroq(content: string): void {
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

/** A model mix: no prices, just proportions. */
const ITEMS = [
  { description: "Teak side table", hsn: "9403", quantity: 2, weight: 9000, gstRate: 18 },
];

const MIXED_ITEMS = [
  { description: "Fabric sofa", hsn: "9401", quantity: 1, weight: 32000, gstRate: 18 },
  { description: "Floor lamp", hsn: "9405", quantity: 2, weight: 2500, gstRate: 12 },
  { description: "Cushion cover", hsn: "6304", quantity: 4, weight: 800, gstRate: 5 },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  quickFillLimiter.reset();
  vi.stubEnv("GROQ_API_KEY", API_KEY);
  // The handler logs upstream problems on purpose; the tests assert on the
  // response, so keep the noise out of the run.
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/quick-fill — the happy path", () => {
  it("returns items priced at whole rupees, near the target", async () => {
    mockGroq(JSON.stringify({ items: MIXED_ITEMS }));

    const response = await POST(
      request({ description: "furniture shopping", targetAmount: 45000 }),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.rejected).toEqual([]);

    // The mix comes back described as the model described it, priced as the
    // solver priced it — in whole rupees, which is what an invoice quotes.
    expect(body.items.map((item: { description: string }) => item.description)).toEqual([
      "Fabric sofa",
      "Floor lamp",
      "Cushion cover",
    ]);
    for (const item of body.items) {
      expect(Number.isInteger(item.rate)).toBe(true);
    }

    // And `total` is the app's own GST engine's figure, not the route's.
    expect(computeQuickFillInvoice(body.items, true).grandTotal).toBe(body.total);
    expect(body.target).toBe(45000);
    expect(body.gap).toBe(body.total - 45000);
  });

  it("reports the gap rather than letting the caller assume it hit", async () => {
    mockGroq(JSON.stringify({ items: MIXED_ITEMS }));

    for (const targetAmount of [4999, 12347, 987654, 865412]) {
      const body = await (
        await POST(request({ description: "furniture", targetAmount }))
      ).json();

      expect(body.target).toBe(targetAmount);
      expect(body.gap).toBe(body.total - targetAmount);
      expect(computeQuickFillInvoice(body.items, true).grandTotal).toBe(
        body.total,
      );
      // Whole-rupee rates cannot reach every figure, but they get close.
      expect(Math.abs(body.gap)).toBeLessThanOrEqual(
        quickFillTargetTolerance(MIXED_ITEMS),
      );
    }
  });

  it("prices for the inter-state branch when the invoice is on it", async () => {
    // IGST rounds the whole slab once where CGST + SGST rounds half of it
    // twice, so the rows have to be solved for the branch they will be taxed on.
    mockGroq(JSON.stringify({ items: MIXED_ITEMS }));

    const body = await (
      await POST(
        request({
          description: "furniture",
          targetAmount: 45000,
          isIntraState: false,
        }),
      )
    ).json();

    expect(body.gap).toBe(body.total - 45000);
    expect(computeQuickFillInvoice(body.items, false).grandTotal).toBe(
      body.total,
    );
    expect(Math.abs(body.gap)).toBeLessThanOrEqual(
      quickFillTargetTolerance(MIXED_ITEMS),
    );
  });

  it("falls back to the mix's own implied total when no target is given", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    const body = await (
      await POST(request({ description: "furniture shopping" }))
    ).json();

    // 9000 at 18% implies 10620, and the rows are priced against that rather
    // than left at whatever the model happened to say.
    expect(body.target).toBe(10620);
    expect(computeQuickFillInvoice(body.items, true).grandTotal).toBe(body.total);
    for (const item of body.items) {
      expect(Number.isInteger(item.rate)).toBe(true);
    }
  });

  it("calls Groq with the key in the header and the model in the body", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    await POST(request({ description: "artificial jewellery order" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(GROQ_COMPLETIONS_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${API_KEY}`,
    );

    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe(QUICK_FILL_MODEL);
    expect(sent.messages[1].content).toContain("artificial jewellery order");
  });

  it("uses GROQ_MODEL when one is set, so a retirement needs no deploy", async () => {
    vi.stubEnv("GROQ_MODEL", "llama-4-something-newer");
    mockGroq(JSON.stringify({ items: ITEMS }));

    await POST(request({ description: "sofa" }));

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.model).toBe("llama-4-something-newer");
  });

  it("falls back to the default when GROQ_MODEL is unset or blank", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    for (const value of [undefined, ""]) {
      fetchMock.mockClear();
      if (value === undefined) vi.stubEnv("GROQ_MODEL", undefined);
      else vi.stubEnv("GROQ_MODEL", value);

      await POST(request({ description: "sofa" }));
      const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(sent.model).toBe(QUICK_FILL_MODEL);
    }
  });

  it("grounds the request in the Indian item catalogue", async () => {
    mockGroq(JSON.stringify({ items: MIXED_ITEMS }));

    await POST(request({ description: "motor parts order" }));

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // Real item names and HSN codes reach the model, in the system turn — so a
    // generated row reads like an Indian shop's bill rather than generic English.
    expect(sent.messages[0].role).toBe("system");
    expect(sent.messages[0].content).toContain("Motor Vehicle Parts");
    expect(sent.messages[0].content).toContain("Clutch plate");
    expect(sent.messages[0].content).toContain("8708");
    // The user's description stays the only untrusted text in the request.
    expect(sent.messages[1].content).not.toContain("Clutch plate");
  });

  it("grounds the descriptions in the profile's own item names when it has some", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    await POST(
      request({
        description: "artificial jewellery order",
        styleExamples: ["Kundan Necklace Set", "Antique Finish Jhumka Pair"],
      }),
    );

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.messages[1].content).toContain("- Kundan Necklace Set");
    expect(sent.messages[1].content).toContain("- Antique Finish Jhumka Pair");
  });

  it("re-cleans and caps style examples rather than trusting the browser", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    await POST(
      request({
        description: "artificial jewellery order",
        styleExamples: [
          "1. Kundan Necklace Set\t71171990\t2\t4,500.00",
          ...Array.from({ length: 50 }, (_, index) => `Silver anklet ${index}`),
        ],
      }),
    );

    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages[1]
      .content as string;
    expect(prompt).toContain("- Kundan Necklace Set");
    expect(prompt).not.toContain("71171990");
    expect(
      prompt.split("\n").filter((line: string) => line.startsWith("- ")).length,
    ).toBe(PROMPT_STYLE_EXAMPLE_LIMIT);
  });

  it("generates as it always did when the profile has taught it nothing", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    // Absent, empty, and outright malformed all mean the same thing: no style
    // grounding, no refusal, and a prompt identical to the one before v1.2.
    const prompts: string[] = [];
    for (const styleExamples of [undefined, [], "not a list", [1, 2, 3]]) {
      fetchMock.mockClear();
      await POST(request({ description: "artificial jewellery order", styleExamples }));
      prompts.push(
        JSON.parse(fetchMock.mock.calls[0][1].body as string).messages[1].content,
      );
    }

    expect(new Set(prompts).size).toBe(1);
    expect(prompts[0]).not.toContain("names its own products");
  });

  it("never puts the API key in the response", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    const response = await POST(request({ description: "furniture" }));
    expect(await response.text()).not.toContain(API_KEY);
  });

  it("passes on the rows it refused alongside the ones it kept", async () => {
    mockGroq(
      JSON.stringify({
        items: [
          ...ITEMS,
          { description: "Lamp", quantity: 1, weight: 900, gstRate: 15 },
        ],
      }),
    );

    const body = await (await POST(request({ description: "furniture" }))).json();
    expect(body.items).toHaveLength(1);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].messages.join(" ")).toContain("GST rate");
  });
});

describe("POST /api/quick-fill — a GST rate named in the description", () => {
  it("puts every row on the named slab, overriding the model", async () => {
    // The model is told 5% and asked for 5% goods, but it returned 18% and 12%
    // anyway — which is exactly why the override does not depend on it obeying.
    mockGroq(
      JSON.stringify({
        items: [
          { description: "Brake pad set", hsn: "8708", quantity: 4, weight: 1200, gstRate: 18 },
          { description: "Oil filter", hsn: "8421", quantity: 2, weight: 400, gstRate: 12 },
        ],
      }),
    );

    const body = await (
      await POST(request({ description: "Motor Parts 5%", targetAmount: 20000 }))
    ).json();

    expect(body.items.map((item: { gstRate: number }) => item.gstRate)).toEqual([
      5, 5,
    ]);
    expect(body.rejected).toEqual([]);

    // And the slab travels to the model too, so it can pick goods that fit it.
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.messages[1].content).toContain("taxed at 5% GST");
  });

  it("leaves the model to choose per item when no rate is named", async () => {
    mockGroq(
      JSON.stringify({
        items: [
          { description: "Brake pad set", quantity: 4, weight: 1200, gstRate: 18 },
          { description: "Oil filter", quantity: 2, weight: 400, gstRate: 12 },
        ],
      }),
    );

    const body = await (
      await POST(request({ description: "Motor Parts", targetAmount: 20000 }))
    ).json();

    expect(body.items.map((item: { gstRate: number }) => item.gstRate)).toEqual([
      18, 12,
    ]);
  });

  it("refuses a rate that is not a slab, without spending an upstream call", async () => {
    const response = await POST(
      request({ description: "Motor Parts 15%", targetAmount: 20000 }),
    );

    expect(response.status).toBe(400);
    const error = (await response.json()).error;
    expect(error).toContain("15% is not a GST slab");
    expect(error).toContain("18");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a description naming two different rates", async () => {
    const response = await POST(
      request({ description: "jewellery 12% with 5% discount" }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("say which GST rate applies");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/quick-fill — input refusals", () => {
  it("rejects an empty description without spending an upstream call", async () => {
    const response = await POST(request({ description: "   " }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Describe what you bought first.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a description over the cap", async () => {
    const response = await POST(request({ description: "x".repeat(501) }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("under 500 characters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a description exactly at the cap", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));
    const response = await POST(request({ description: "x".repeat(500) }));
    expect(response.status).toBe(200);
  });

  it("rejects a target amount that is not a usable number", async () => {
    for (const targetAmount of [0, -1, "abc", 2_000_000_000]) {
      const response = await POST(request({ description: "sofa", targetAmount }));
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a target with paise in it, since a total is whole rupees", async () => {
    const response = await POST(
      request({ description: "sofa", targetAmount: 45000.5 }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("whole number of rupees");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an absent or null target as no target", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    expect((await POST(request({ description: "sofa" }))).status).toBe(200);
    expect(
      (await POST(request({ description: "sofa", targetAmount: null }))).status,
    ).toBe(200);
  });

  it("rejects a body that is not a JSON object", async () => {
    expect((await POST(request("not json at all"))).status).toBe(400);
    expect((await POST(request([1, 2, 3]))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/quick-fill — rate limiting", () => {
  it("refuses the sixth request from one IP with a retry hint", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    for (let i = 0; i < 5; i += 1) {
      expect((await POST(request({ description: "sofa" }, "9.9.9.9"))).status).toBe(200);
    }

    const response = await POST(request({ description: "sofa" }, "9.9.9.9"));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toContain("try again in a moment");
    expect(response.headers.get("Retry-After")).toBeTruthy();
    // The refusal is free — no sixth call to Groq.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not let one IP's burst block another", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    for (let i = 0; i < 6; i += 1) {
      await POST(request({ description: "sofa" }, "9.9.9.9"));
    }
    expect((await POST(request({ description: "sofa" }, "8.8.8.8"))).status).toBe(200);
  });
});

describe("POST /api/quick-fill — failure paths", () => {
  it("reports a missing API key as a configuration problem, not a user error", async () => {
    vi.stubEnv("GROQ_API_KEY", "");

    const response = await POST(request({ description: "sofa" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a retired model as a configuration problem, not a passing outage", async () => {
    // This is how llama-3.3-70b-versatile left: a 404 from an endpoint that was
    // working the day before. Told to "try again in a moment" the user would
    // retry forever, so it is a 503 that says the model is gone.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "The model `some-retired-model` does not exist or you do not have access to it.",
            code: "model_not_found",
          },
        }),
        { status: 404 },
      ),
    );

    const response = await POST(request({ description: "sofa" }));
    expect(response.status).toBe(503);

    const error = (await response.json()).error;
    expect(error).toContain("no longer available");
    expect(error).not.toContain("try again");
  });

  it("names the model in the log, where whoever has to fix it will look", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GROQ_MODEL", "some-retired-model");
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));

    await POST(request({ description: "sofa" }));

    const messages = logged.mock.calls.flat().join(" ");
    expect(messages).toContain("some-retired-model");
    expect(messages).toContain("GROQ_MODEL");
  });

  it("turns an upstream 429 into the same 'try again' message", async () => {
    fetchMock.mockResolvedValue(
      new Response("rate limit exceeded for org_123", {
        status: 429,
        headers: { "retry-after": "17" },
      }),
    );

    const response = await POST(request({ description: "sofa" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");

    const error = (await response.json()).error;
    expect(error).toContain("try again in a moment");
    // The upstream body can name accounts and request ids — it is logged, never
    // forwarded.
    expect(error).not.toContain("org_123");
  });

  it("turns any other upstream failure into a plain 502", async () => {
    fetchMock.mockResolvedValue(new Response("internal", { status: 500 }));

    const response = await POST(request({ description: "sofa" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("again in a moment");
  });

  it("reports a network failure rather than throwing", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const response = await POST(request({ description: "sofa" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("Could not reach");
  });

  it("reports an unreadable upstream envelope", async () => {
    fetchMock.mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));

    const response = await POST(request({ description: "sofa" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("unreadable");
  });

  it("reports model output that is not a list of items", async () => {
    mockGroq("I'm sorry, I can't help with that.");

    const response = await POST(request({ description: "sofa" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("rewording");
  });

  it("reports a generation where every row failed validation", async () => {
    mockGroq(
      JSON.stringify({
        items: [{ description: "Lamp", quantity: 1, weight: 900, gstRate: 15 }],
      }),
    );

    const response = await POST(request({ description: "sofa" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("None of the generated rows");
  });

  it("says a target is out of reach rather than returning rows nowhere near it", async () => {
    // Twelve lines of twenty units cannot come to ₹100 at ₹1 a unit, so there is
    // no gap worth reporting — the whole figure would be the gap.
    mockGroq(
      JSON.stringify({
        items: Array.from({ length: 12 }, (_, i) => ({
          description: `Item ${i + 1}`,
          quantity: 20,
          weight: 500,
          gstRate: 18,
        })),
      }),
    );

    const response = await POST(
      request({ description: "sofa", targetAmount: 100 }),
    );
    expect(response.status).toBe(400);

    const error = (await response.json()).error;
    expect(error).toContain("too small");
    // Names the figure the items can actually reach, so there is something to
    // try next.
    expect(error).toMatch(/₹\d/);
  });
});

/**
 * Category adherence, from the server's side of the boundary.
 *
 * The model's own adherence cannot be tested with a mock — that was measured
 * against the live API and is recorded in tests/quick-fill.test.ts. What IS
 * testable here, and worth locking down, is that nothing between the model and
 * the browser rewrites what came back: a jewellery mix must leave this route as
 * a jewellery mix, carrying the trade's own HSN codes rather than codes the
 * pipeline substituted, because the reported bug was a whole invoice of the
 * wrong goods and the route is the last place that could have caused it.
 */
describe("POST /api/quick-fill — category adherence", () => {
  const JEWELLERY = [
    { description: "Kundan necklace set", hsn: "7117", quantity: 4, weight: 24000, gstRate: 12 },
    { description: "Meenakari jhumka pair", hsn: "7117", quantity: 6, weight: 9000, gstRate: 12 },
    { description: "Temple jewellery choker", hsn: "7117", quantity: 3, weight: 15000, gstRate: 12 },
    { description: "Pearl mangalsutra", hsn: "7117", quantity: 5, weight: 11000, gstRate: 12 },
  ];

  it("returns the described trade's goods and codes untouched", async () => {
    mockGroq(JSON.stringify({ category: "Artificial jewellery", items: JEWELLERY }));

    const response = await POST(
      request({
        description: "Artificial Jewelry Necklaces, 18% GST",
        targetAmount: 99654,
      }),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.items).toHaveLength(JEWELLERY.length);

    // Every row is still the jewellery the model chose, at the jewellery HSN.
    expect(body.items.map((item: { description: string }) => item.description)).toEqual(
      JEWELLERY.map((item) => item.description),
    );
    for (const item of body.items) {
      expect(item.hsn).toBe("7117");
    }

    // And nothing from another trade came along — the shape the bug took.
    const text = JSON.stringify(body.items).toLowerCase();
    for (const stray of ["led tv", "ceiling fan", "sofa", "dining table", "a4 paper", "brake", "clutch"]) {
      expect(text).not.toContain(stray);
    }
  });

  it("applies the slab named in the description without disturbing the goods", async () => {
    // The model answered 12% — the usual slab for imitation jewellery. The user
    // said 18%, so 18% is what the invoice carries, and the goods are unchanged.
    mockGroq(JSON.stringify({ category: "Artificial jewellery", items: JEWELLERY }));

    const response = await POST(
      request({ description: "Artificial Jewelry Necklaces, 18% GST" }),
    );
    const body = await response.json();

    expect(body.items.every((item: { gstRate: number }) => item.gstRate === 18)).toBe(true);
    expect(body.items[0].description).toBe("Kundan necklace set");
    expect(body.items[0].hsn).toBe("7117");
  });

  it("sends the model a prompt that does not let the slab pick the goods", async () => {
    mockGroq(JSON.stringify({ category: "Artificial jewellery", items: JEWELLERY }));

    await POST(request({ description: "Artificial Jewelry Necklaces, 18% GST" }));

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = sent.messages.find((message) => message.role === "user")!.content;
    const system = sent.messages.find((message) => message.role === "system")!.content;

    expect(user).toContain('"gstRate": 18');
    expect(user).not.toContain("genuinely attract");
    expect(system).toContain("THE ITEMS ARE THE GOODS DESCRIBED");
  });
});

/**
 * The "ask before generating" step (§16).
 *
 * The contract that matters is not just *that* it asks, but that asking is
 * free: the whole reason the decision is a heuristic rather than a model call is
 * that finding out whether to spend a generation must not itself spend one. So
 * every test here asserts on `fetchMock` as well as on the body.
 */
describe("POST /api/quick-fill — asking for what is missing", () => {
  it("asks instead of generating when the description says nothing about goods", async () => {
    const response = await POST(
      request({ description: "some stuff for my shop, 50000" }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.needsInfo).toBe(true);
    expect(typeof body.reason).toBe("string");
    expect(body.items).toBeUndefined();

    // Nothing was generated, and nothing was spent finding that out.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still asks when the category field is present but blank", async () => {
    // A category is what tells the route to skip the check, so an empty one must
    // not count as an answer — otherwise a client that always sends the field
    // turns the ask step off for every description at once.
    const response = await POST(
      request({ description: "some stuff for my shop, 50000", category: "   " }),
    );

    expect((await response.json()).needsInfo).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("generates without asking when a trade is named", async () => {
    mockGroq(JSON.stringify({ category: "Furniture", items: ITEMS }));

    const response = await POST(request({ description: "office furniture" }));

    expect(response.status).toBe(200);
    expect((await response.json()).needsInfo).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("generates once the follow-up is answered, without asking again", async () => {
    mockGroq(JSON.stringify({ category: "Artificial jewellery", items: ITEMS }));

    // The same description that was refused above, now carrying an answer.
    const response = await POST(
      request({
        description: "some stuff for my shop, 50000",
        category: "artificial jewellery",
        examples: "kundan necklace, jhumka",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.needsInfo).toBeUndefined();
    expect(body.items.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Both answers reach the model, and as binding rather than as background.
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = sent.messages.find((message) => message.role === "user")!.content;
    expect(user).toContain("artificial jewellery");
    expect(user).toContain("kundan necklace, jhumka");
    expect(user).toContain("Every item must belong to that trade");
  });

  it("prefers the user's own category over the model's in the readout", async () => {
    mockGroq(JSON.stringify({ category: "Furniture", items: ITEMS }));

    const body = await (
      await POST(
        request({
          description: "some stuff, 50000",
          category: "Artificial jewellery",
        }),
      )
    ).json();

    expect(body.understood.category).toBe("Artificial jewellery");
  });
});

describe("POST /api/quick-fill — the understood readout", () => {
  it("reports the category, slab, target and count the server acted on", async () => {
    mockGroq(JSON.stringify({ category: "Artificial jewellery", items: ITEMS }));

    const body = await (
      await POST(
        request({ description: "jewellery, 18% GST", targetAmount: 99654 }),
      )
    ).json();

    expect(body.understood).toEqual({
      category: "Artificial jewellery",
      gstRate: 18,
      target: 99654,
      targetRequested: true,
      itemCount: body.items.length,
    });
  });

  it("marks a target the mix implied rather than one the user asked for", async () => {
    mockGroq(JSON.stringify({ category: "Furniture", items: ITEMS }));

    const body = await (await POST(request({ description: "furniture" }))).json();

    expect(body.understood.targetRequested).toBe(false);
    expect(body.understood.target).toBe(body.target);
  });

  it("omits the slab when the generated rows span several", async () => {
    mockGroq(JSON.stringify({ items: MIXED_ITEMS }));

    const body = await (
      await POST(request({ description: "furniture for a flat" }))
    ).json();

    expect(body.understood.gstRate).toBeUndefined();
    // No category from the model and none from the user means none shown, not
    // an empty chip.
    expect(body.understood.category).toBeUndefined();
  });
});
