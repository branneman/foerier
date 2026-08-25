import { describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'

const app = buildApp({ gitSha: '7c39f2a' })

describe('GET /api/v1/version', () => {
  it('reports the commit SHA the image was built from', async () => {
    const res = await app.request('/api/v1/version')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sha: '7c39f2a' })
  })

  it('is never cached', async () => {
    // CI polls this endpoint until it reports the SHA that was just pushed, to
    // know a deploy has landed (docs/testing.md, Tier 4). A cached response
    // would report the previous build and the poller would either pass against
    // the wrong deploy or time out against a correct one.
    const res = await app.request('/api/v1/version')

    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('needs no credentials', async () => {
    // Explicitly unauthenticated (auth-design.md §9.1): the poller runs before
    // any test household exists, and a version endpoint behind auth cannot
    // answer the one question it is for.
    const res = await app.request('/api/v1/version', {
      headers: { authorization: '' },
    })

    expect(res.status).toBe(200)
  })
})

describe('unknown routes', () => {
  it('404s', async () => {
    const res = await app.request('/api/v1/nope')

    expect(res.status).toBe(404)
  })
})
