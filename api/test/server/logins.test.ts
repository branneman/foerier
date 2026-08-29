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

  function del(path: string, token: string) {
    return h.app.request(`/api/v1${path}`, {
      method: 'DELETE',
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

  it('disables the Login and its next request is 401', async () => {
    const caller = await signedInDevice()
    const target = await signedInDevice()

    expect(
      (await del(`/auth/logins/${target.loginId}`, caller.token)).status,
    ).toBe(204)

    // The middleware rejects a request whose Login is disabled, so the
    // revoked Device fails at its very next call — no waiting for expiry.
    expect((await get('/auth/me', target.token)).status).toBe(401)
  })

  it('revokes the Login’s Devices and the Invites bound to it', async () => {
    const caller = await signedInDevice()
    const target = await signedInDevice()

    const inviteId = systemIdSource.next()
    await db
      .insertInto('invite')
      .values({
        id: inviteId,
        household_id: HOUSEHOLD,
        person_id: systemIdSource.next(),
        purpose: 'device',
        secret_hash: new Uint8Array(32).fill(7),
        login_id: target.loginId,
        created_by_login: caller.loginId,
        person_recorded: true,
        expires_at: new Date(h.clock.now() + 60 * 60_000),
      })
      .execute()

    await del(`/auth/logins/${target.loginId}`, caller.token)

    const device = await db
      .selectFrom('device')
      .select('revoked_at')
      .where('id', '=', target.deviceId)
      .executeTakeFirstOrThrow()
    expect(device.revoked_at).not.toBeNull()

    const invite = await db
      .selectFrom('invite')
      .select('revoked_at')
      .where('id', '=', inviteId)
      .executeTakeFirstOrThrow()
    expect(invite.revoked_at).not.toBeNull()
  })

  /**
   * Story 28: "everything they recorded stays". True by construction — the
   * transaction touches no `op` row, and `op.device_id` carries no foreign
   * key to `device`.
   */
  it('leaves the ops that Login pushed readable', async () => {
    const caller = await signedInDevice()
    const target = await signedInDevice()

    await db
      .insertInto('op')
      .values({
        op_id: systemIdSource.next(),
        household_id: HOUSEHOLD,
        seq: 1,
        aggregate: 'gear',
        aggregate_id: systemIdSource.next(),
        type: 'gear.recorded',
        hlc: '2026-08-25T09:00:00.000Z-0000-aaaa',
        device_id: target.deviceId,
        payload: JSON.stringify({ name: 'Tarp' }),
      })
      .execute()

    await del(`/auth/logins/${target.loginId}`, caller.token)

    const pulled = await get('/sync/pull?since=0', caller.token)
    expect(pulled.status).toBe(200)
    const body = await jsonOf<{ ops: Array<{ type: string }> }>(pulled)
    expect(body.ops.map((op) => op.type)).toContain('gear.recorded')
  })

  /**
   * No Login can disable itself, which is what makes "a Household never
   * reaches zero active Logins" true by construction rather than by a count.
   */
  it('refuses to revoke your own Login', async () => {
    const caller = await signedInDevice()

    const res = await del(`/auth/logins/${caller.loginId}`, caller.token)
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toMatchObject({ error: 'cannot_revoke_self' })

    expect((await get('/auth/me', caller.token)).status).toBe(200)
  })

  it('answers 204 for an unknown id and for a non-UUID', async () => {
    const caller = await signedInDevice()

    expect(
      (
        await del(
          '/auth/logins/0f00000e-0000-4000-8000-0000000000ff',
          caller.token,
        )
      ).status,
    ).toBe(204)
    expect((await del('/auth/logins/not-a-uuid', caller.token)).status).toBe(
      204,
    )
  })
})
