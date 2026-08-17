/**
 * Tests for POST /api/quick-fill (§16, v1.1).
 *
 * The Groq call is mocked — no key, no network, no free-tier spend. What is
 * actually under test is the handler's contract with the browser: that the key
 * never appears in a response, that every failure path produces a plain sentence
 * instead of an upstream error dump, and that cheap refusals (empty input, rate
 * limit) happen *before* an upstream request is spent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/quick-fill/route";
import { GROQ_COMPLETIONS_URL, QUICK_FILL_MODEL } from "@/lib/quick-fill";
import { quickFillLimiter } from "@/lib/quick-fill-limiter";

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

const ITEMS = [
  { description: "Teak side table", hsn: "9403", quantity: 2, rate: 4500, gstRate: 18 },
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
  it("returns validated items and the total they came to", async () => {
    mockGroq(JSON.stringify({ items: ITEMS }));

    const response = await POST(
      request({ description: "furniture shopping", targetAmount: 45000 }),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.items).toEqual(ITEMS);
    expect(body.rejected).toEqual([]);
    expect(body.total).toBe(10620);
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
          { description: "Lamp", quantity: 1, rate: 900, gstRate: 15 },
        ],
      }),
    );

    const body = await (await POST(request({ description: "furniture" }))).json();
    expect(body.items).toHaveLength(1);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].messages.join(" ")).toContain("GST rate");
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
        items: [{ description: "Lamp", quantity: 1, rate: 900, gstRate: 15 }],
      }),
    );

    const response = await POST(request({ description: "sofa" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("None of the generated rows");
  });
});
