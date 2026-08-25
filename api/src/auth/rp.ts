/**
 * The relying party (`auth-design.md` §8.1).
 *
 * **In production the RP ID is `foerier.app`** — the registrable parent, so
 * credentials stay valid across `app.`, `api.`, and any future subdomain. It is
 * baked into every credential ever created and cannot be changed without
 * invalidating all of them, which is why the architecture spec pinned it before
 * any code existed.
 */
export const RP_ID = 'foerier.app'
export const RP_NAME = 'foerier'

export const PRODUCTION_ORIGIN = 'https://app.foerier.app'
/** WebAuthn permits `localhost` over plain HTTP as a special case. */
const DEV_ORIGIN = 'http://localhost:5173'
/** Tier 5 runs against a production build served by `vite preview`. */
const PREVIEW_ORIGIN = 'http://localhost:4173'

export type RpMode = 'production' | 'development' | 'test'

export interface RpConfig {
  rpId: string
  rpName: string
  /** An explicit allowlist. Never a wildcard, never a reflected `Origin`. */
  allowedOrigins: string[]
}

/**
 * Why `development` gets a different RP ID, and why that is not a hole.
 *
 * WebAuthn requires the RP ID to be a *registrable suffix of the origin's
 * domain*. `localhost` is not a subdomain of `foerier.app`, so a browser will
 * refuse `rp.id = "foerier.app"` outright on a local machine — there is no
 * configuration that makes both work at once. Local development and the
 * Playwright tier therefore use `localhost`, which produces credentials that
 * are, correctly, useless anywhere else.
 *
 * `test` deliberately uses the **production** values. Tier 2s needs no browser,
 * so it costs nothing to exercise the real RP ID and the real origin there —
 * which means the values that actually ship are the ones under test, and a
 * typo in them fails the suite rather than waiting for the box.
 *
 * Production is not derived from anything and cannot be overridden by an
 * environment variable. A wrong RP ID in production is unrecoverable, so it is
 * a constant, and a Tier 4 contract test asserts that the deployed server
 * really serves it.
 */
export function rpConfig(mode: RpMode): RpConfig {
  if (mode === 'development') {
    return {
      rpId: 'localhost',
      rpName: RP_NAME,
      allowedOrigins: [DEV_ORIGIN, PREVIEW_ORIGIN],
    }
  }

  return {
    rpId: RP_ID,
    rpName: RP_NAME,
    allowedOrigins: [PRODUCTION_ORIGIN],
  }
}

/**
 * The origins the API answers CORS for (`auth-design.md` §8.3).
 *
 * `Access-Control-Allow-Credentials` is deliberately never sent: there are no
 * cookies, so a request without a valid `Authorization` header is anonymous no
 * matter which page issued it. That property is what makes CSRF a non-issue
 * here rather than a mitigated risk.
 */
export function corsOrigins(mode: RpMode): string[] {
  return rpConfig(mode).allowedOrigins
}
