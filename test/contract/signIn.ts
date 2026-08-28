import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server'

import { SoftwareAuthenticator } from '../../api/test/server/softwareAuthenticator.ts'
import { credential, monotonicSignCount } from './credential'
import { mask } from './reset'

/**
 * A Device token, minted in Node with no browser
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §6.4).
 *
 * One mechanism unblocks both tiers, and it is the **credential**, not the
 * token: `contract` runs before `e2e-prod`, so reusing Tier 5's token would
 * mean a token travelling backwards between jobs, and every route for that
 * leaks — a job output is not masked and an artifact is downloadable from the
 * run page of a public repository. **A Device token never crosses a job
 * boundary.** Each job mints its own from the same secret.
 *
 * The authenticator doing the signing is Tier 2s's own
 * (`api/test/server/softwareAuthenticator.ts`): a real P-256 keypair, real
 * authenticator data, real ECDSA, verified by `@simplewebauthn/server` exactly
 * as a phone is. Importing it across the workspace boundary is deliberate — the
 * alternative is a second implementation of the one ceremony that must never
 * quietly diverge.
 */
export interface SignInOptions {
  /** Always including `/api/v1`. */
  apiBase: string
  /**
   * The origin the credential was captured against. It goes into
   * `clientDataJSON`, and the server checks it against an explicit allowlist
   * (`api/src/auth/rp.ts`), so a wrong value fails verification rather than
   * being ignored.
   */
  appOrigin?: string
}

/**
 * The RP ID for an origin, by the same rule the browser applies: a registrable
 * suffix of the origin's domain.
 *
 * `localhost` is not a subdomain of `foerier.app`, so local development and
 * Tier 5 use `localhost` as the RP ID and produce credentials that are —
 * correctly — useless anywhere else. Production uses the registrable parent
 * `foerier.app`, so one credential stays valid across `app.`, `api.`, and any
 * future subdomain. Derived rather than passed in, so the two secrets a run
 * holds cannot be pointed at the wrong relying party by a third env var.
 */
export function rpIdFor(appOrigin: string): string {
  const { hostname } = new URL(appOrigin)
  return hostname === 'localhost' ? hostname : hostname.replace(/^app\./, '')
}

export async function signIn({
  apiBase,
  appOrigin = process.env.CONTRACT_APP_URL ?? 'https://app.foerier.app',
}: SignInOptions): Promise<string> {
  const optionsRes = await fetch(`${apiBase}/auth/login/options`, {
    method: 'POST',
  })
  if (optionsRes.status !== 200) {
    throw new Error(`POST /auth/login/options answered ${optionsRes.status}`)
  }
  const options =
    (await optionsRes.json()) as PublicKeyCredentialRequestOptionsJSON

  const authenticator = new SoftwareAuthenticator({
    origin: appOrigin,
    rpId: rpIdFor(appOrigin),
    credential: credential(),
    signCount: monotonicSignCount(),
  })

  const verifyRes = await fetch(`${apiBase}/auth/login/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ response: authenticator.get(options) }),
  })

  // The status and nothing else. A `login/verify` body carries the token, and
  // this is a public repository whose job logs are world-readable (§5.1) — an
  // error that quotes the response would print the very thing the next line
  // masks.
  if (verifyRes.status !== 200) {
    throw new Error(`POST /auth/login/verify answered ${verifyRes.status}`)
  }

  const { token } = (await verifyRes.json()) as { token?: unknown }
  if (typeof token !== 'string') {
    throw new Error('POST /auth/login/verify returned no device token')
  }

  // Masked the instant it exists, before it is used for anything.
  mask(token)
  return token
}
