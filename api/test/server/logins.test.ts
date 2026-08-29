import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { systemIdSource } from '@foerier/shared'

import type { Database } from '../../src/db/schema.ts'
import { issueDeviceToken } from '../../src/auth/tokens.ts'
import { nextExpiry } from '../../src/auth/session.ts'
import {
  createHarness,
  jsonOf,
  resetHouseholds,
  seedHousehold,
  type Harness,
} from './harness.ts'

/**
 * Tier 2s — `GET /auth/logins` and `DELETE /auth/logins/:id` (story 28).
 *
 * UUID registry slot #14 (`docs/testing.md`).
 */
const HOUSEHOLD = '0f00000e-0000-4000-8000-00000000000e'

interface LoginsBody {
  logins: Array<{
    id: string
    person_id: string
    device_count: number
    last_seen_at: string | null
  }>
}

describe('logins', () => {
  let h: Harness
  let db: Kysely<Database>

  beforeAll(async () => {
    h = await createHarness()
    db = h.db
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await resetHouseholds(db, [HOUSEHOLD])
    await seedHousehold(db, { id: HOUSEHOLD, name: 'Veldkamp' })
    h.clock.set(Date.UTC(2026, 7, 25, 9, 0, 0))
  })

  /** A Login with no Device at all — the state the boards do not draw. */
  async function seedLogin(): Promise<{ loginId: string; personId: string }> {
    const loginId = systemIdSource.next()
    const personId = systemIdSource.next()
    await db
      .insertInto('login')
      .values({ id: loginId, household_id: HOUSEHOLD, person_id: personId })
      .execute()
    return { loginId, personId }
  }

  /** A Device on an existing Login, or on a fresh one. */
  async function signedInDevice(
    options: { sameLoginAs?: { loginId: string }; lastSeenAt?: Date } = {},
  ): Promise<{ token: string; loginId: string; deviceId: string }> {
    const deviceId = systemIdSource.next()
    const { token, tokenHash } = issueDeviceToken()

    const loginId = options.sameLoginAs?.loginId ?? (await seedLogin()).loginId

    await db
      .insertInto('device')
      .values({
        id: deviceId,
        login_id: loginId,
        household_id: HOUSEHOLD,
        token_hash: tokenHash,
        label: 'Firefox on Android',
        last_seen_at: options.lastSeenAt ?? new Date(h.clock.now()),
        expires_at: nextExpiry(h.clock),
      })
      .execute()

    return { token, loginId, deviceId }
  }

  function get(path: string, token: string) {
    return h.app.request(`/api/v1${path}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  }

  it('counts only admissible Devices and reports the newest last seen', async () => {
    // Both within the middleware's 24h last-seen throttle (`session.ts`'s
    // `shouldRefreshLastSeen`) of the frozen clock (09:00 on the 25th): the
    // call below authenticates as `first`, and a value older than that would
    // have the middleware itself bump `first`'s `last_seen_at` to "now" as a
    // side effect of the request, silently replacing the fixture this test
    // means to assert on.
    const older = new Date(Date.UTC(2026, 7, 24, 20, 0, 0))
    const newer = new Date(Date.UTC(2026, 7, 24, 23, 0, 0))

    const first = await signedInDevice({ lastSeenAt: older })
    await signedInDevice({ sameLoginAs: first, lastSeenAt: newer })

    // Revoked, so it must not be counted and must not set `last_seen_at`.
    const revoked = await signedInDevice({
      sameLoginAs: first,
      lastSeenAt: new Date(Date.UTC(2026, 7, 25, 8, 0, 0)),
    })
    await db
      .updateTable('device')
      .set({ revoked_at: new Date(h.clock.now()) })
      .where('id', '=', revoked.deviceId)
      .execute()

    const res = await get('/auth/logins', first.token)
    expect(res.status).toBe(200)

    const { logins } = await jsonOf<LoginsBody>(res)
    const mine = logins.find((row) => row.id === first.loginId)
    expect(mine).toMatchObject({
      device_count: 2,
      last_seen_at: newer.toISOString(),
    })
  })

  it('reports a Login with no Device as zero and null', async () => {
    const caller = await signedInDevice()
    const lonely = await seedLogin()

    const { logins } = await jsonOf<LoginsBody>(
      await get('/auth/logins', caller.token),
    )

    expect(logins.find((row) => row.id === lonely.loginId)).toMatchObject({
      person_id: lonely.personId,
      device_count: 0,
      last_seen_at: null,
    })
  })

  it('omits a disabled Login', async () => {
    const caller = await signedInDevice()
    const gone = await seedLogin()
    await db
      .updateTable('login')
      .set({ disabled_at: new Date(h.clock.now()) })
      .where('id', '=', gone.loginId)
      .execute()

    const { logins } = await jsonOf<LoginsBody>(
      await get('/auth/logins', caller.token),
    )

    expect(logins.map((row) => row.id)).not.toContain(gone.loginId)
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await h.app.request('/api/v1/auth/logins')
    expect(res.status).toBe(401)
  })
})
