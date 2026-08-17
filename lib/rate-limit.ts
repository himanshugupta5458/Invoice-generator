/**
 * In-memory token bucket, used to keep one caller from eating the Quick Fill
 * budget (§16, v1.1).
 *
 * Groq's free tier is a single shared allowance across the whole deployment, not
 * per user, so without this one impatient tab can 429 everybody else. A bucket
 * gives short bursts (a few tries in a row while wording a description) but caps
 * the sustained rate.
 *
 * Pure by construction: `now` is passed in rather than read from the clock, so
 * the refill maths is testable without waiting or faking timers.
 *
 * Deliberately in-memory, and honest about what that means: a serverless
 * deployment runs several instances, so this limits per instance rather than
 * globally, and a cold start starts everyone with a full bucket. That is
 * adequate for its actual job — blunting one client's hammering — and the
 * alternative is the durable store v1 exists to avoid (§7).
 */

export interface TokenBucketOptions {
  /** Burst size: tokens a fresh key starts with, and the ceiling it refills to. */
  capacity: number;
  /** Sustained rate, in tokens restored per second. */
  refillPerSecond: number;
  /**
   * How long a full, untouched bucket is kept before being forgotten. Bounds
   * memory on a long-lived instance seeing many distinct callers.
   */
  idleTtlMs?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole tokens left after this decision. */
  remaining: number;
  /** Seconds until the next token — 0 when the request was allowed. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Spend a token for `key`. Call once per request. */
  check(key: string, now: number): RateLimitDecision;
  /** Live bucket count — for tests and diagnostics. */
  size(): number;
  /** Drop all buckets. */
  reset(): void;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1000;

export function createRateLimiter(options: TokenBucketOptions): RateLimiter {
  const { capacity, refillPerSecond } = options;
  const idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
  const buckets = new Map<string, Bucket>();

  /**
   * Forget keys whose bucket has been full and untouched for the TTL. Only full
   * buckets are dropped: a key still in debt must keep its state, or forgetting
   * it would hand back a free burst.
   */
  function prune(now: number): void {
    for (const [key, bucket] of buckets) {
      const refilled = bucket.tokens + ((now - bucket.updatedAt) / 1000) * refillPerSecond;
      if (refilled >= capacity && now - bucket.updatedAt > idleTtlMs) {
        buckets.delete(key);
      }
    }
  }

  return {
    check(key, now) {
      prune(now);

      const existing = buckets.get(key);
      // A clock that appears to go backwards (or a first sighting) must not mint
      // tokens, so elapsed time is floored at zero.
      const elapsedSeconds = existing
        ? Math.max(0, now - existing.updatedAt) / 1000
        : 0;
      const tokens = existing
        ? Math.min(capacity, existing.tokens + elapsedSeconds * refillPerSecond)
        : capacity;

      if (tokens < 1) {
        buckets.set(key, { tokens, updatedAt: now });
        return {
          allowed: false,
          remaining: 0,
          // Round up: telling someone to wait 0 seconds when they cannot yet
          // succeed just buys another rejected request.
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((1 - tokens) / refillPerSecond),
          ),
        };
      }

      const left = tokens - 1;
      buckets.set(key, { tokens: left, updatedAt: now });
      return {
        allowed: true,
        remaining: Math.floor(left),
        retryAfterSeconds: 0,
      };
    },

    size: () => buckets.size,
    reset: () => buckets.clear(),
  };
}

/**
 * Best-effort client identity for rate limiting.
 *
 * `x-forwarded-for` is a comma-separated chain and the first entry is the
 * original client as far as the proxy is concerned. It is spoofable in general,
 * but on Vercel the platform sets it, and the fallback is deliberately a single
 * shared "unknown" bucket rather than "no limit at all": a caller who strips the
 * headers ends up sharing one bucket with every other such caller.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
