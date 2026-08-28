/**
 * A coarse, best-effort `User-Agent` read like `Firefox on Android` —
 * shared because both the server's authoritative derivation
 * (`api/src/auth/session.ts`'s `deviceLabelFrom`, over the request's own
 * `User-Agent` header) and the client's editable prefill
 * (`app/src/screens/Account.tsx`'s `guessDeviceLabel`, over
 * `navigator.userAgent`) need the identical answer. They used to each carry
 * their own copy of this table, and the copies had already drifted — the
 * client's had `iPhone` checked before `iPad` and no `\b` word-boundary
 * anchors (`final-review.md` finding 10). One table, imported both places, is
 * the only way two surfaces stay unable to disagree about what to call the
 * same Device.
 *
 * Deliberately imprecise: no IP, no version, nothing that identifies a
 * machine rather than describing it (`docs/design/README.md` §12, story 30).
 */

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
 * `null` when either half cannot be told — an absent `User-Agent`, or one
 * naming neither a known browser nor a known platform. Callers decide their
 * own fallback: the server's `deviceLabelFrom` says "Unknown device"; the
 * client's `guessDeviceLabel` leaves its editable field blank instead.
 */
export function guessDeviceLabel(
  userAgent: string | undefined | null,
): string | null {
  if (typeof userAgent !== 'string' || userAgent === '') return null

  const browser = firstMatch(BROWSERS, userAgent)
  const platform = firstMatch(PLATFORMS, userAgent)
  if (browser === null || platform === null) return null

  return `${browser} on ${platform}`
}
