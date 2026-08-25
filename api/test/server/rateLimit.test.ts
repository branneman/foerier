import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createHarness, TEST_ORIGIN, type Harness } from './harness.ts'

/**
 * Proves the limiter is actually *wired to the routes*.
 *
 * `rateLimiter.test.ts` proves the token-bucket algorithm at Tier 1, where it
 * belongs. What that cannot catch is the middleware being registered on the
 * wrong routes, or on none — so this suite uses a deliberately tiny budget and
 * checks which endpoints it bites.
 */
describe('rate limiting', () => {
  let h: Harness

  beforeAll(async () => {
    h = await createHarness({ rateLimit: { capacity: 2, refillPerMinute: 1 } })
  })

  afterAll(async () => {
    await h.db.destroy()
  })

  function options(ip: string) {
    return h.app.request('/api/v1/auth/login/options', {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, 'x-forwarded-for': ip },
    })
  }

  it('turns away a burst on the unauthenticated endpoints', async () => {
    expect((await options('203.0.113.1')).status).toBe(200)
    expect((await options('203.0.113.1')).status).toBe(200)
    expect((await options('203.0.113.1')).status).toBe(429)
  })

  it('counts each caller separately', async () => {
    // One noisy client must not lock the household out.
    expect((await options('203.0.113.2')).status).toBe(200)
    expect((await options('203.0.113.3')).status).toBe(200)
  })

  it('takes the client from the first X-Forwarded-For entry', async () => {
    // Caddy appends; the left-most entry is the original client.
    const res = await h.app.request('/api/v1/auth/login/options', {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'x-forwarded-for': '203.0.113.9, 10.0.0.1',
      },
    })

    expect(res.status).toBe(200)
  })

  it('does not rate limit the version endpoint', async () => {
    // CI polls it in a tight loop after every deploy; limiting it would make
    // the deploy signal flap (docs/testing.md, Tier 4).
    for (let i = 0; i < 10; i++) {
      const res = await h.app.request('/api/v1/version')
      expect(res.status).toBe(200)
    }
  })
})
