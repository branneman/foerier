import type { Clock } from '@foerier/shared'

/**
 * A coarse per-IP token bucket for the unauthenticated auth endpoints
 * (`auth-design.md` §9.4).
 *
 * Sized to protect the box, **not** to substitute for the 256-bit secrets —
 * there is nothing to brute-force in those, so this is capacity protection
 * rather than a security control. In-memory is correct while there is one
 * server instance; if that ever changes, the bucket moves to Postgres.
 */

export interface RateLimiterOptions {
  /** Burst size. */
  capacity: number
  refillPerMinute: number
  clock: Clock
}

export interface RateLimiter {
  /** Consumes one token. `false` means the caller should get a 429. */
  take(key: string): boolean
  /** Number of tracked callers. Exposed so the eviction rule is testable. */
  size(): number
  /**
   * Seconds until a caller can expect at least one token back, for a
   * `Retry-After` header. Conservative and per-limiter rather than per-key —
   * it reads the configured refill rate, not any one caller's exact bucket
   * state, which is enough for a client backing off and costs no extra
   * bookkeeping.
   */
  retryAfterSeconds(): number
}

interface Bucket {
  tokens: number
  updatedAt: number
}

export function createRateLimiter({
  capacity,
  refillPerMinute,
  clock,
}: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, Bucket>()
  const refillPerMs = refillPerMinute / 60_000

  // A bucket that has sat full for this long tells us nothing we would not
  // infer from a fresh one, so it can be dropped.
  const idleEvictionMs = (capacity / refillPerMs) * 2

  function evictIdle(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.updatedAt > idleEvictionMs) buckets.delete(key)
    }
  }

  return {
    take(key) {
      const now = clock.now()
      evictIdle(now)

      const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now }
      // Elapsed time floors at zero: a clock that reads earlier than the
      // bucket's last update (a backward NTP step, or a test's fake clock
      // reset between cases sharing one long-lived limiter) must never be
      // read as tokens spent — that drives the bucket arbitrarily negative
      // and locks the caller out far longer than any real burst would.
      const elapsed = Math.max(0, now - bucket.updatedAt)
      const refilled = Math.min(capacity, bucket.tokens + elapsed * refillPerMs)

      if (refilled < 1) {
        buckets.set(key, { tokens: refilled, updatedAt: now })
        return false
      }

      buckets.set(key, { tokens: refilled - 1, updatedAt: now })
      return true
    },

    size: () => buckets.size,

    retryAfterSeconds: () => Math.max(1, Math.ceil(60 / refillPerMinute)),
  }
}
