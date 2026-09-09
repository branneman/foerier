import type { Kysely } from 'kysely'
import type { MiddlewareHandler } from 'hono'

import type { Clock } from '@foerier/shared'

import type { Database } from '../db/schema.ts'
import type { AuthContext } from './service.ts'
import { shouldRefreshLastSeen } from './session.ts'
import { bearerFrom, hashSecret } from './tokens.ts'

export interface AuthVariables {
  auth: AuthContext
}

export interface AuthMiddlewareDeps {
  db: Kysely<Database>
  clock: Clock
}

/**
 * **One body shape for every failure the API returns**, `sync-protocol.md`
 * §6.3's.
 *
 * This middleware answered `{ "error": "unauthorized" }` and `/sync/*`
 * answered the structured object, so the API spoke two shapes for one status
 * — recorded as a divergence rather than a broken contract, since
 * `auth-design.md` specified no 401 body at all. It is one shape now, emitted
 * here, at the single place a 401 is decided.
 *
 * That deletes `withSyncAuthShape` (`api/src/sync/routes.ts`), which existed
 * only to rewrite this middleware's answer into §6.3's on the way out.
 *
 * **Nothing on the wire depended on the old shape**, which is what made the
 * change safe rather than a lockstep break: the app's auth client reads the
 * *status* and never the body (`AuthRequestError(res.status)`), and the sync
 * transport already tolerated both shapes by design. An installed PWA running
 * an older build is therefore unaffected.
 *
 * `detail` is always `{}` here. The field is §6.3's, and a 401 has nothing to
 * put in it that would not be a hint about why authentication failed.
 */
function unauthorized(c: {
  json: (body: unknown, status: 401) => Response
}): Response {
  return c.json(
    {
      error: {
        code: 'unauthorized',
        message: 'Missing, revoked, or expired device token.',
        detail: {},
      },
    },
    401,
  )
}

/**
 * One middleware in front of every authenticated route
 * (`auth-design.md` §9.3):
 *
 *   Bearer token → SHA-256 → device by token_hash
 *     → reject if missing, revoked, expired, or its Login is disabled
 *     → context = { deviceId, loginId, householdId }
 *     → last_seen_at refreshed at most once per day
 *
 * **The tenancy rule the whole sell-later story rests on:** every handler
 * downstream takes `household_id` from this context and *never* from the
 * request body, the query string, or a header. This is the only place a
 * household id enters the system, which is what makes the isolation testable
 * as a property rather than checked route by route.
 */
export function createAuthMiddleware({
  db,
  clock,
}: AuthMiddlewareDeps): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const token = bearerFrom(c.req.header('authorization'))
    if (token === null) return unauthorized(c)

    const now = new Date(clock.now())

    const device = await db
      .selectFrom('device')
      .innerJoin('login', 'login.id', 'device.login_id')
      .select([
        'device.id as device_id',
        'device.login_id',
        'device.household_id',
        'device.last_seen_at',
        'device.expires_at',
        'device.revoked_at',
        'login.disabled_at',
        'login.person_id',
      ])
      // Denormalised household_id on `device` is what keeps this to one
      // indexed lookup on the hot path.
      .where('device.token_hash', '=', hashSecret(token))
      .executeTakeFirst()

    if (device === undefined) return unauthorized(c)
    // Revocation is immediate and server-side: a revoked Device fails at its
    // very next request (auth-design.md §6.2).
    if (device.revoked_at !== null) return unauthorized(c)
    if (device.expires_at.getTime() <= now.getTime()) return unauthorized(c)
    if (device.disabled_at !== null) return unauthorized(c)

    // Sliding expiry, throttled so the common sync request stays read-only.
    if (shouldRefreshLastSeen(device.last_seen_at, clock)) {
      await db
        .updateTable('device')
        .set({ last_seen_at: now })
        .where('id', '=', device.device_id)
        .execute()
    }

    c.set('auth', {
      deviceId: device.device_id,
      loginId: device.login_id,
      householdId: device.household_id,
      personId: device.person_id,
    })

    await next()
    return undefined
  }
}
