import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

import type { AuthVariables } from '../auth/middleware.ts'
import type { RateLimiter } from '../auth/rateLimiter.ts'
import { NotDisposableError, type TestResetService } from './service.ts'

/**
 * `POST /test/reset` — the one route
 * `docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3 adds, so that
 * CI has a Household it is allowed to destroy.
 *
 * **Three gates, and only the middle one is a branch in this file:**
 *
 * 1. the sub-app is mounted at all only when the server was started with
 *    `E2E_HOUSEHOLD_ID` set (`app.ts`) — "unset ⇒ 404" is true by
 *    construction, with no early return to lose in a refactor;
 * 2. the token's Household must equal that value — the 403 below;
 * 3. the Household row must carry `disposable = true` — read under the wipe's
 *    own lock in `service.ts`, and surfaced here as the same 403.
 *
 * **This is not part of the auth surface.** It authenticates with an ordinary
 * Device token through the existing `requireAuth`; it adds no auth path, no
 * secret class, and no way to create a Household, Login, Person or Invite.
 * `auth-design.md` §3.4 is not amended by it (§3.1).
 *
 * The Household comes from `c.get('auth')` and never from a body, query
 * string or header — the tenancy rule, unrelaxed (`auth-design.md` §9.3).
 */
export interface TestRoutesDeps {
  service: TestResetService
  requireAuth: MiddlewareHandler<{ Variables: AuthVariables }>
  /**
   * `/sync`'s limiter **instance**, not a bucket of this route's own: reset is
   * an authenticated write like push, and should spend from the same
   * per-Device budget (§3.3).
   */
  limiter: RateLimiter
  /** The one Household this route may wipe. */
  e2eHouseholdId: string
}

type Vars = { Variables: AuthVariables }

export function createTestRoutes({
  service,
  requireAuth,
  limiter,
  e2eHouseholdId,
}: TestRoutesDeps) {
  const test = new Hono<Vars>()

  test.use('*', requireAuth)

  // The same per-Device keying `sync/routes.ts` uses, over the same limiter
  // instance. `requireAuth` runs first, so an unauthenticated caller is turned
  // away with 401 and never spends against the bucket at all.
  test.use('*', async (c, next) => {
    const { deviceId } = c.get('auth')
    if (!limiter.take(deviceId)) {
      c.header('Retry-After', String(limiter.retryAfterSeconds()))
      return c.json({ error: 'rate_limited' }, 429)
    }
    await next()
    return undefined
  })

  test.post('/reset', async (c) => {
    const auth = c.get('auth')

    // Gate 2. A valid token for any other Household is refused outright —
    // never retargeted, never partially honoured.
    if (auth.householdId !== e2eHouseholdId) {
      return c.json({ error: 'forbidden' }, 403)
    }

    try {
      return c.json(await service.reset(auth))
    } catch (error) {
      // Gate 3, decided under the lock inside the transaction. Same answer as
      // gate 2: the caller learns it may not wipe this Household, and nothing
      // about why.
      if (error instanceof NotDisposableError) {
        return c.json({ error: 'forbidden' }, 403)
      }
      throw error
    }
  })

  return test
}
