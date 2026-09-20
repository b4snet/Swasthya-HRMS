/**
 * In-memory rate limiter (Phase 0). Single-process only — acceptable for
 * local dev; replace with Redis-backed limiter before any shared environment.
 * Documented in docs/compliance/security.md as a known Phase 0 limitation.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bounded memory: never track more than this many keys.
const MAX_BUCKETS = 10_000;

function evictIfNeeded(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
    if (buckets.size < MAX_BUCKETS) return;
  }
}

/**
 * Fixed-window counter keyed by arbitrary string (e.g. `ip` or `email`).
 * Pure with respect to time: pass `now` in tests.
 */
export function rateLimit(
  key: string,
  max: number,
  windowSeconds: number,
  now: number = Date.now(),
): RateLimitResult {
  evictIfNeeded(now);
  const windowMs = windowSeconds * 1000;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: max - existing.count,
    retryAfterSeconds: 0,
  };
}

/**
 * Ops helper (E2E runs): clear all buckets. Deliberately NOT exported as a
 * server action or route — it can only be invoked from trusted server-side
 * code (tests, scripts). Rate limiting itself is untouched.
 */
export function resetRateLimits(): void {
  buckets.clear();
}
