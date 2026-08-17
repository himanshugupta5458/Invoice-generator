/**
 * The single rate-limiter instance the Quick Fill route shares (§16, v1.1).
 *
 * Kept in its own module rather than inside the route so tests can reset it
 * between cases, and so the route file stays about handling one request.
 *
 * Sizing: Groq's free tier is roughly 30 requests/minute for the whole
 * deployment. Five per IP per minute leaves room for a handful of concurrent
 * users, and the burst of 5 means a user who mistypes a description twice in a
 * row never notices the limit exists.
 */

import { createRateLimiter } from "./rate-limit";

export const QUICK_FILL_BURST = 5;
export const QUICK_FILL_PER_MINUTE = 5;

export const quickFillLimiter = createRateLimiter({
  capacity: QUICK_FILL_BURST,
  refillPerSecond: QUICK_FILL_PER_MINUTE / 60,
});
