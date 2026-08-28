import type { Clock } from '@foerier/shared'
import { guessDeviceLabel } from '@foerier/shared'

/**
 * Session rules (`auth-design.md` §6.2) — pure, so they are unit-testable
 * against a fake clock rather than by waiting a year.
 */

/** Sliding: valid until one year after last use. */
export const SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000

/**
 * How stale `last_seen_at` may get before it is worth a write.
 *
 * Without this throttle the sliding expiry would turn the common sync request
 * — which is otherwise read-only — into an UPDATE on every call.
 */
const LAST_SEEN_THROTTLE_MS = 24 * 60 * 60 * 1000

export function nextExpiry(clock: Clock): Date {
  return new Date(clock.now() + SESSION_LIFETIME_MS)
}

export function shouldRefreshLastSeen(lastSeenAt: Date, clock: Clock): boolean {
  return clock.now() - lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS
}

/**
 * The signature counter rule, including the case that matters.
 *
 * A strictly-increasing counter is WebAuthn's clone detection. But synced
 * passkeys — which is to say almost every passkey a household will own —
 * legitimately report `0` forever, because there is no single authenticator to
 * count. Requiring an increase would lock all of them out, so `0` against `0`
 * is explicitly fine and only a *non-zero* counter that fails to advance is
 * treated as a clone.
 */
export function isSignCountAcceptable({
  stored,
  received,
}: {
  stored: number
  received: number
}): boolean {
  if (stored === 0 && received === 0) return true
  return received > stored
}

/**
 * A coarse label like `Firefox on Android`, for the Devices list.
 *
 * Deliberately imprecise. Story 30 asks for "what it is, roughly" — no IP, no
 * version, nothing that identifies a machine rather than describing it. When
 * it cannot tell, it says so instead of guessing.
 *
 * The actual browser/platform table lives in `@foerier/shared`'s
 * `guessDeviceLabel`, shared with the client's own prefill guess
 * (`app/src/screens/Account.tsx`) so the two surfaces cannot drift apart
 * again the way they already had (`final-review.md` finding 10). This
 * function is only the server's own fallback text for what that returns.
 */
export function deviceLabelFrom(userAgent: string | undefined | null): string {
  return guessDeviceLabel(userAgent) ?? 'Unknown device'
}
