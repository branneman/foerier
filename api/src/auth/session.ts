import type { Clock } from '@foerier/shared'

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

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  // Order matters: Edge and Opera both also claim to be Chrome, and Chrome
  // claims to be Safari.
  [/\bEdg[A-Z]?\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bFirefox\//, 'Firefox'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

const PLATFORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\biPad\b/, 'iPad'],
  [/\biPhone\b/, 'iPhone'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
]

function firstMatch(
  table: ReadonlyArray<readonly [RegExp, string]>,
  ua: string,
): string | null {
  for (const [pattern, name] of table) {
    if (pattern.test(ua)) return name
  }
  return null
}

/**
 * A coarse label like `Firefox on Android`, for the Devices list.
 *
 * Deliberately imprecise. Story 30 asks for "what it is, roughly" — no IP, no
 * version, nothing that identifies a machine rather than describing it. When
 * it cannot tell, it says so instead of guessing.
 */
export function deviceLabelFrom(userAgent: string | undefined | null): string {
  if (typeof userAgent !== 'string' || userAgent === '') return 'Unknown device'

  const browser = firstMatch(BROWSERS, userAgent)
  const platform = firstMatch(PLATFORMS, userAgent)

  if (browser === null || platform === null) return 'Unknown device'
  return `${browser} on ${platform}`
}
