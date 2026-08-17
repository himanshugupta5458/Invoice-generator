/**
 * POST /api/quick-fill — the app's one server route (§16, v1.1).
 *
 * It exists for a single reason: the Groq API key must never reach the browser.
 * Everything else about the app is still client-side; this handler takes a
 * description, asks a model for a plausible item mix, prices that mix at
 * whole-rupee rates as near the requested total as those allow, and hands back
 * JSON — including how far off it landed. It stores nothing and reads nothing but
 * the request.
 *
 * Order of business, cheapest refusal first:
 *   1. rate limit          — before any parsing, so a flood costs almost nothing
 *   2. body / input checks — before spending a token of Groq's shared free tier
 *   3. configuration       — a missing key is our problem, reported as 503
 *   4. upstream call       — with a timeout, so a hung request cannot hold a
 *                            serverless invocation open until the platform kills it
 *   5. validation          — via lib/quick-fill.ts, which never trusts the model
 *   6. solve               — via lib/quick-fill-solver.ts, which turns the mix
 *                            into whole-rupee rates and reports the total it
 *                            reached through computeInvoice(), gap included
 *
 * Every failure path returns a plain sentence in `error`. The raw upstream
 * message is logged server-side and never forwarded: it can carry request ids
 * and account details, and it is not written for the person reading the screen.
 */

import { quickFillLimiter } from "@/lib/quick-fill-limiter";
import { solveQuickFillRates } from "@/lib/quick-fill-solver";
import {
  GROQ_COMPLETIONS_URL,
  MAX_DESCRIPTION_CHARS,
  MAX_TARGET_AMOUNT,
  buildQuickFillRequestBody,
  impliedTargetFromMix,
  parseQuickFillMix,
  type QuickFillErrorBody,
  type QuickFillResponseBody,
} from "@/lib/quick-fill";
import { clientKeyFromHeaders } from "@/lib/rate-limit";

/** Reads request headers and calls out, so it can never be prerendered. */
export const dynamic = "force-dynamic";

/** Give up on Groq before the platform gives up on us. */
const UPSTREAM_TIMEOUT_MS = 20_000;

const RATE_LIMIT_MESSAGE =
  "Quick Fill is busy — try again in a moment.";

function fail(
  message: string,
  status: number,
  headers?: HeadersInit,
): Response {
  return Response.json({ error: message } satisfies QuickFillErrorBody, {
    status,
    headers,
  });
}

export async function POST(request: Request): Promise<Response> {
  // 1. Rate limit ----------------------------------------------------------
  const decision = quickFillLimiter.check(
    clientKeyFromHeaders(request.headers),
    Date.now(),
  );
  if (!decision.allowed) {
    return fail(RATE_LIMIT_MESSAGE, 429, {
      "Retry-After": String(decision.retryAfterSeconds),
    });
  }

  // 2. Input ---------------------------------------------------------------
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("That request could not be read.", 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fail("That request could not be read.", 400);
  }

  const body = payload as Record<string, unknown>;

  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (description === "") {
    return fail("Describe what you bought first.", 400);
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return fail(
      `Keep the description under ${MAX_DESCRIPTION_CHARS} characters.`,
      400,
    );
  }

  // Absent and null both mean "no target"; anything else present must be a
  // usable number, because silently ignoring a bad one would produce rows that
  // do not match what the user typed with no hint as to why.
  let targetAmount: number | undefined;
  if (body.targetAmount !== undefined && body.targetAmount !== null) {
    const raw = Number(body.targetAmount);
    if (!Number.isFinite(raw) || raw <= 0) {
      return fail("Enter a target amount greater than 0, or leave it blank.", 400);
    }
    // A grand total is rounded to the nearest rupee (§6), so a target with paise
    // in it is not a total any invoice can have — and this route now promises
    // the target exactly rather than approximately.
    if (!Number.isInteger(raw)) {
      return fail(
        "Use a whole number of rupees — an invoice total is always rounded to the nearest rupee.",
        400,
      );
    }
    if (raw > MAX_TARGET_AMOUNT) {
      return fail("That target amount is too large.", 400);
    }
    targetAmount = raw;
  }

  // The tax branch changes the paise (§6): CGST + SGST rounds half the slab
  // twice, IGST rounds the whole slab once. The solver has to price for the
  // branch this invoice is actually on, so the client sends it. Absent means
  // intra-state, which is what computeInvoice() itself falls back to.
  const isIntraState = body.isIntraState !== false;

  // 3. Configuration -------------------------------------------------------
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("GROQ_API_KEY is not set — Quick Fill is unavailable.");
    return fail(
      "Quick Fill is not configured on this server. Add items manually or upload a CSV.",
      503,
    );
  }

  // 4. Upstream ------------------------------------------------------------
  let upstream: Response;
  try {
    upstream = await fetch(GROQ_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(
        buildQuickFillRequestBody({ description, targetAmount }),
      ),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (cause) {
    console.error("Quick Fill upstream request failed", cause);
    return fail(
      "Could not reach the AI service. Check your connection and try again.",
      502,
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error(
      `Quick Fill upstream returned ${upstream.status}`,
      detail.slice(0, 500),
    );

    // Groq's own limit is shared across the whole deployment, so this is the
    // same situation as our limiter refusing — say the same thing.
    if (upstream.status === 429) {
      return fail(RATE_LIMIT_MESSAGE, 429, {
        "Retry-After": upstream.headers.get("retry-after") ?? "20",
      });
    }

    return fail("The AI service had a problem. Try again in a moment.", 502);
  }

  let content: string;
  try {
    const json = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const raw = json.choices?.[0]?.message?.content;
    content = typeof raw === "string" ? raw : "";
  } catch (cause) {
    console.error("Quick Fill upstream returned unreadable JSON", cause);
    return fail("The AI service returned something unreadable.", 502);
  }

  // 5. Validate ------------------------------------------------------------
  const mix = parseQuickFillMix(content);

  if (mix.responseError) {
    console.error("Quick Fill model output rejected:", mix.responseError);
    return fail(
      "The AI returned something we could not read as invoice items. Try rewording the description.",
      502,
    );
  }

  if (mix.items.length === 0) {
    return fail(
      "None of the generated rows were usable. Try rewording the description.",
      502,
    );
  }

  // 6. Solve ---------------------------------------------------------------
  // With no target of their own, the mix's weights are the model's own rough
  // rupee values, so they imply one. Either way there is a figure to aim at and
  // a measured gap to report — there is no second, unchecked path where the
  // prices are whatever the model happened to say.
  const target = targetAmount ?? impliedTargetFromMix(mix.items);
  const solved = solveQuickFillRates({
    items: mix.items,
    target,
    isIntraState,
  });

  // A target these items cannot get near at whole-rupee rates is the user's to
  // fix, not something to paper over.
  if (!solved.ok) return fail(solved.error, 400);

  return Response.json({
    items: solved.items,
    rejected: mix.rejected,
    total: solved.total,
    target: solved.target,
    gap: solved.gap,
  } satisfies QuickFillResponseBody);
}
