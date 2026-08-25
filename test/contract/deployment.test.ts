import { describe, expect, it } from 'vitest'

/**
 * Tier 4 — the contract tier (`docs/testing.md`).
 *
 * These run against the deployed box after Watchtower has confirmed the pushed
 * SHA, and they assert the things a local Postgres and an in-process Hono can
 * never surface: that the migrations ran *there*, that Caddy forwards what the
 * API needs, that the relying party and the CORS allowlist are the production
 * ones, and that both images are actually serving.
 *
 * **No household, no credentials.** The charter's household-scoped suite waits
 * for domain behaviour to exist (S2); everything here is reachable
 * unauthenticated, which is what lets this tier run from the first deploy
 * rather than from the first feature.
 */

const API = process.env.CONTRACT_API_URL ?? 'https://api.foerier.app'
const APP = process.env.CONTRACT_APP_URL ?? 'https://app.foerier.app'

/** The production relying party, pinned in `api/src/auth/rp.ts`. */
const RP_ID = 'foerier.app'

describe('the deployed api', () => {
  it('serves a commit SHA that is not cacheable', async () => {
    const res = await fetch(`${API}/api/v1/version`)

    expect(res.status).toBe(200)
    expect(((await res.json()) as { sha: string }).sha).toMatch(
      /^[0-9a-f]{40}$/,
    )
    // Not decoration: an intermediary caching this would make the deploy
    // signal lie, and this job would pass against the previous build.
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('is reached over a connection Caddy has pinned to https', async () => {
    // Set by the front door, not the app image (infra readme, "Who sets what")
    // — so this is really an assertion about the box's Caddy config.
    const res = await fetch(`${API}/api/v1/version`)

    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
  })

  it('ran its migrations against the box database', async () => {
    // `/auth/login/options` writes a row to `webauthn_challenge` before it
    // answers. A 200 therefore proves three things at once that no local test
    // can: Postgres is reachable from the container, the migrations ran on the
    // box, and the schema they produced is the one this code expects.
    const res = await fetch(`${API}/api/v1/auth/login/options`, {
      method: 'POST',
    })

    expect(res.status).toBe(200)
  })

  it('presents the production relying party', async () => {
    // The RP ID is baked into every credential ever created and cannot be
    // changed without invalidating all of them (`rp.ts`). Tier 2s asserts the
    // constant; only this tier asserts that the deployed process serves it.
    const res = await fetch(`${API}/api/v1/auth/login/options`, {
      method: 'POST',
    })
    const options = (await res.json()) as { rpId?: string }

    expect(options.rpId).toBe(RP_ID)
  })

  it('receives the Authorization header through Caddy', async () => {
    // The failure this exists for is a reverse proxy that strips or rewrites
    // `Authorization`: every authenticated request would 401 in production and
    // pass everywhere else. A *rejected* token proves the header arrived —
    // Hono's own 401 body is the evidence that Hono, not Caddy, answered.
    const res = await fetch(`${API}/api/v1/auth/me`, {
      headers: { Authorization: 'Bearer not-a-real-device-token' },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })
})

describe('the deployed cross-origin allowlist', () => {
  it('answers a preflight from the app origin', async () => {
    const res = await fetch(`${API}/api/v1/auth/login/options`, {
      method: 'OPTIONS',
      headers: {
        Origin: APP,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })

    expect(res.headers.get('access-control-allow-origin')).toBe(APP)
    // Deliberately never sent: there are no cookies, which is what makes CSRF
    // a non-issue here rather than a mitigated risk (`auth-design.md` §8.3).
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('does not echo an origin outside the allowlist', async () => {
    const res = await fetch(`${API}/api/v1/auth/login/options`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://not-foerier.example',
        'Access-Control-Request-Method': 'POST',
      },
    })

    expect(res.headers.get('access-control-allow-origin')).not.toBe(
      'https://not-foerier.example',
    )
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*')
  })
})

describe('the deployed app', () => {
  it('serves the PWA shell', async () => {
    // The api image answers `/version`, so nothing above would notice if the
    // *app* image failed to deploy. This is the second half of the matrix.
    const res = await fetch(APP)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })
})
