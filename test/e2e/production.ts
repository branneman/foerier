/**
 * What "against production" means, in one place
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §6.2).
 *
 * Retargeting Tier 5 is one variable: `PLAYWRIGHT_BASE_URL`. Its presence is
 * the whole definition of a production run — it is what drops the `webServer`
 * block, and it is what `playwright.config.ts` switches the `globalSetup`,
 * the `@production` grep, `workers: 1` and `trace: 'off'` on. So the flag is
 * derived from that one variable rather than from a second one that could
 * disagree with it.
 *
 * The API origin is separate because the app and the API are separate origins
 * in production (`app.` and `api.`), and only the harness talks to the second
 * one — the reset route. `API_BASE` carries `/api/v1` so that every caller of
 * `resetHousehold` passes the same thing; the version prefix is decided here,
 * once, rather than remembered at each call site.
 */

export const isProduction = process.env['PLAYWRIGHT_BASE_URL'] !== undefined

export const API_URL =
  process.env['PLAYWRIGHT_API_URL'] ?? 'https://api.foerier.app'

/** Always including `/api/v1` — what `resetHousehold` wants. */
export const API_BASE = `${API_URL}/api/v1`

/**
 * Where `globalSetup.production.ts` leaves the signed-in browser state.
 *
 * Gitignored, and no CI step uploads it: it holds a live Device token
 * (§5.1). Relative to the repository root, which is Playwright's cwd.
 */
export const STORAGE_STATE = 'test/e2e/.auth/production.json'

/**
 * The env var carrying the run's Device token from `globalSetup` to the
 * workers.
 *
 * Playwright forks its workers after `globalSetup` has returned, so an
 * assignment to `process.env` there is inherited by every worker. That is the
 * documented channel, and it is the one that keeps the token out of a
 * `use` option — where it would be serialised into a trace or a report.
 */
export const DEVICE_TOKEN = 'E2E_DEVICE_TOKEN'

/** The app origin under test. Only ever read on the production path, where
 * `PLAYWRIGHT_BASE_URL` is set by definition. */
export function appUrl(): string {
  const url = process.env['PLAYWRIGHT_BASE_URL']
  if (url === undefined || url === '') {
    throw new Error(
      'PLAYWRIGHT_BASE_URL must be set: this code runs only in the production project',
    )
  }
  return url
}

/** The token `globalSetup` minted, masked and reset with. */
export function deviceToken(): string {
  const token = process.env[DEVICE_TOKEN]
  if (token === undefined || token === '') {
    throw new Error(
      `${DEVICE_TOKEN} is unset — globalSetup.production.ts did not run, or did not sign in`,
    )
  }
  return token
}
