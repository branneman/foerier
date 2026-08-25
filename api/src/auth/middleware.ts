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
    if (token === null) return c.json({ error: 'unauthorized' }, 401)

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

    if (device === undefined) return c.json({ error: 'unauthorized' }, 401)
    // Revocation is immediate and server-side: a revoked Device fails at its
    // very next request (auth-design.md §6.2).
    if (device.revoked_at !== null)
      return c.json({ error: 'unauthorized' }, 401)
    if (device.expires_at.getTime() <= now.getTime()) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    if (device.disabled_at !== null)
      return c.json({ error: 'unauthorized' }, 401)

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
