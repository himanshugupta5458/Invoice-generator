/**
 * Tests for the token bucket behind Quick Fill (§16, v1.1).
 *
 * `now` is a parameter, not a clock read, so all of this runs instantly and the
 * refill maths is checked exactly rather than approximately.
 */

import { describe, expect, it } from "vitest";

import { clientKeyFromHeaders, createRateLimiter } from "@/lib/rate-limit";

/** Five requests, refilling at one every 12 seconds — the route's real sizing. */
function limiter() {
  return createRateLimiter({ capacity: 5, refillPerSecond: 5 / 60 });
}

describe("createRateLimiter", () => {
  it("allows a full burst, then refuses", () => {
    const rl = limiter();
    for (let i = 0; i < 5; i += 1) {
      const decision = rl.check("1.1.1.1", 0);
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(4 - i);
    }

    const sixth = rl.check("1.1.1.1", 0);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
  });

  it("never reports a retry-after of 0 on a refusal", () => {
    const rl = limiter();
    for (let i = 0; i < 5; i += 1) rl.check("1.1.1.1", 0);

    // 11s in, the next token is 1s away — a rounded-down 0 would just invite an
    // immediate retry that also fails.
    const decision = rl.check("1.1.1.1", 11_000);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("refills at the configured rate and no faster", () => {
    const rl = limiter();
    for (let i = 0; i < 5; i += 1) rl.check("1.1.1.1", 0);

    expect(rl.check("1.1.1.1", 11_000).allowed).toBe(false);
    expect(rl.check("1.1.1.1", 12_000).allowed).toBe(true);
    // That one token is spent again, so the next is another 12s out.
    expect(rl.check("1.1.1.1", 12_000).allowed).toBe(false);
    expect(rl.check("1.1.1.1", 24_000).allowed).toBe(true);
  });

  it("never refills past the burst size, however long it idles", () => {
    const rl = limiter();
    rl.check("1.1.1.1", 0);

    // An hour later the bucket is full, not overflowing: still exactly 5.
    for (let i = 0; i < 5; i += 1) {
      expect(rl.check("1.1.1.1", 3_600_000).allowed).toBe(true);
    }
    expect(rl.check("1.1.1.1", 3_600_000).allowed).toBe(false);
  });

  it("keeps callers in separate buckets", () => {
    const rl = limiter();
    for (let i = 0; i < 5; i += 1) rl.check("1.1.1.1", 0);

    expect(rl.check("1.1.1.1", 0).allowed).toBe(false);
    expect(rl.check("2.2.2.2", 0).allowed).toBe(true);
  });

  it("does not mint tokens when the clock appears to go backwards", () => {
    const rl = limiter();
    for (let i = 0; i < 5; i += 1) rl.check("1.1.1.1", 60_000);
    expect(rl.check("1.1.1.1", 0).allowed).toBe(false);
  });

  it("forgets full, idle buckets but keeps ones still in debt", () => {
    // A 20s TTL against a bucket that takes 60s to refill from empty, so the two
    // keys below are genuinely in different states when the TTL passes.
    const rl = createRateLimiter({
      capacity: 5,
      refillPerSecond: 5 / 60,
      idleTtlMs: 20_000,
    });

    rl.check("idle", 0); // spends 1 of 5
    for (let i = 0; i < 5; i += 1) rl.check("busy", 0); // spends all 5
    expect(rl.size()).toBe(2);

    // 30s on: "idle" has refilled to full and aged out; "busy" is back to 2.5
    // tokens, so dropping it would hand back a free burst. Any check prunes.
    rl.check("other", 30_000);
    expect(rl.size()).toBe(2);

    // Exactly the 2 whole tokens it earned back — not a fresh burst of 5.
    expect(rl.check("busy", 30_000).allowed).toBe(true);
    expect(rl.check("busy", 30_000).allowed).toBe(true);
    expect(rl.check("busy", 30_000).allowed).toBe(false);
  });

  it("resets", () => {
    const rl = limiter();
    for (let i = 0; i < 5; i += 1) rl.check("1.1.1.1", 0);
    rl.reset();
    expect(rl.size()).toBe(0);
    expect(rl.check("1.1.1.1", 0).allowed).toBe(true);
  });
});

describe("clientKeyFromHeaders", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178",
    });
    expect(clientKeyFromHeaders(headers)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(
      clientKeyFromHeaders(new Headers({ "x-real-ip": " 198.51.100.4 " })),
    ).toBe("198.51.100.4");
    // Not "no limit": header-stripped callers share one bucket.
    expect(clientKeyFromHeaders(new Headers())).toBe("unknown");
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": " " }))).toBe(
      "unknown",
    );
  });
});
