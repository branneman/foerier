import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { systemIdSource, type OpEnvelope } from '@foerier/shared'

import type { Database } from '../../src/db/schema.ts'
import {
  createHarness,
  jsonOf,
  resetHouseholds,
  seedHousehold,
  seedInvite,
  TEST_ORIGIN,
  TEST_RP_ID,
  type Harness,
} from './harness.ts'
import { SoftwareAuthenticator } from './softwareAuthenticator.ts'

/**
 * Tier 2s — `POST /api/v1/test/reset`, the one route
 * `docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3 adds to the
 * production surface, and the three gates that keep it from being anything
 * more than "wipe the one Household everybody already agreed to wipe".
 *
 * §3.3 names the edges this must cover, and the shape it borrows is
 * `householdIsolation.test.ts`'s: the line that must never regress is a
 * tenancy line, so it is tested the way tenancy is tested — with a second,
 * real Household whose rows are counted before and after.
 *
 * UUID registry slots #12 and #13 (`docs/testing.md`).
 */
const E2E = '0f00000c-0000-4000-8000-00000000000c'
const OTHER = '0f00000d-0000-4000-8000-00000000000d'

interface ResetBody {
  deleted: number
  revoked: number
  passkeys: number
  invites: number
}

describe('POST /test/reset', () => {
  /** The server the box runs: `E2E_HOUSEHOLD_ID` set to {@link E2E}. */
  let h: Harness
  /** The same server with the variable unset — the route is not mounted. */
  let unset: Harness
  let db: Kysely<Database>

  beforeAll(async () => {
    h = await createHarness({ e2eHouseholdId: E2E })
    unset = await createHarness()
    db = h.db
  })

  afterAll(async () => {
    await db.destroy()
    await unset.db.destroy()
  })

  beforeEach(async () => {
    await resetHouseholds(db, [E2E, OTHER])
    await seedHousehold(db, { id: E2E, name: 'E2E', disposable: true })
    await seedHousehold(db, { id: OTHER, name: 'Veldkamp' })
    h.clock.set(Date.UTC(2026, 7, 25, 9, 0, 0))
  })

  // Local copies of `householdIsolation.test.ts`'s helpers rather than imports
  // of them: a fixture shared between suites couples them, and this one needs
  // its own `app` anyway — two of the three harnesses here are configured
  // differently from each other.

  async function post(
    app: Harness['app'],
    path: string,
    body?: unknown,
    token?: string,
  ) {
    return app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: TEST_ORIGIN,
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  /** Signs a brand-new Quartermaster into the given household. */
  async function joinHousehold(app: Harness['app'], householdId: string) {
    const invite = await seedInvite(db, { householdId, clock: h.clock })
    const options = await jsonOf<never>(
      await post(app, '/api/v1/auth/register/options', {
        secret: invite.secret,
      }),
    )

    const authenticator = new SoftwareAuthenticator({
      origin: TEST_ORIGIN,
      rpId: TEST_RP_ID,
    })

    const res = await post(app, '/api/v1/auth/register/verify', {
      secret: invite.secret,
      response: authenticator.create(options),
    })

    return (await jsonOf(res)) as {
      token: string
      household_id: string
      person_id: string
      login_id: string
      device_id: string
    }
  }

  function reset(app: Harness['app'], token: string) {
    return post(app, '/api/v1/test/reset', undefined, token)
  }

  // Deliberately independent of `sync.test.ts`'s envelope builder, and with a
  // real UUIDv7 for `op_id`: `foerier_test` is persistent and shared, so a
  // counter reset to 1 would collide with another class's ops.
  const AGGREGATE_ID = '0198e0b7-cccc-7f4c-93de-5a6b7c8d9e0f'
  const DEVICE_ID = '0198e0b7-dddd-7f4c-93de-5a6b7c8d9e0f'

  function anOp(householdId: string): OpEnvelope {
    return {
      id: systemIdSource.next(),
      household_id: householdId,
      aggregate: 'gear',
      aggregate_id: AGGREGATE_ID,
      type: 'gear.recorded',
      hlc: '2026-08-25T09:00:00.000Z-0000',
      device_id: DEVICE_ID,
      payload: { name: 'Tent' },
    }
  }

  async function opCount(householdId: string): Promise<number> {
    const rows = await db
      .selectFrom('op')
      .select('op_id')
      .where('household_id', '=', householdId)
      .execute()
    return rows.length
  }

  async function householdSeq(householdId: string): Promise<number> {
    const row = await db
      .selectFrom('household')
      .select('op_seq')
      .where('id', '=', householdId)
      .executeTakeFirstOrThrow()
    return row.op_seq
  }

  it("refuses a valid token for another household, and wipes neither's ops", async () => {
    // §3.3, edge 1. The gate is not "is this a real token" — it is "is this
    // token's Household the one the box was configured to destroy".
    const other = await joinHousehold(h.app, OTHER)
    const e2e = await joinHousehold(h.app, E2E)

    await post(h.app, '/api/v1/sync/push', { ops: [anOp(OTHER)] }, other.token)
    await post(h.app, '/api/v1/sync/push', { ops: [anOp(E2E)] }, e2e.token)

    const res = await reset(h.app, other.token)
    expect(res.status).toBe(403)
    expect(await jsonOf(res)).toEqual({ error: 'forbidden' })

    // A 403 that still deleted would pass a status-only assertion. Both
    // Households must be exactly as they were.
    expect(await opCount(OTHER)).toBe(1)
    expect(await opCount(E2E)).toBe(1)
  })

  it('does not exist at all when E2E_HOUSEHOLD_ID is unset', async () => {
    // §3.3, edge 2, and the reason `buildApp` mounts conditionally rather than
    // guarding a handler: "unset ⇒ 404" is a fact about the route table, so
    // the test is about *absence* and cannot be satisfied by an early return
    // somebody later refactors away.
    const e2e = await joinHousehold(unset.app, E2E)

    const res = await reset(unset.app, e2e.token)
    expect(res.status).toBe(404)
  })

  it('wipes its own household, spares the caller, and leaves the other alone', async () => {
    // §3.3, edge 3 — the whole contract in one case.
    const first = await joinHousehold(h.app, E2E)
    const caller = await joinHousehold(h.app, E2E)
    const other = await joinHousehold(h.app, OTHER)

    // Something for the reset to find: an outstanding device link, two ops of
    // its own, and one op belonging to a Household it must not touch.
    await h.service.issueDeviceLink({
      deviceId: caller.device_id,
      loginId: caller.login_id,
      householdId: E2E,
      personId: caller.person_id,
    })
    await post(
      h.app,
      '/api/v1/sync/push',
      { ops: [anOp(E2E), anOp(E2E)] },
      caller.token,
    )
    await post(h.app, '/api/v1/sync/push', { ops: [anOp(OTHER)] }, other.token)

    const seqBefore = await householdSeq(E2E)
    expect(seqBefore).toBe(2)

    const res = await reset(h.app, caller.token)
    expect(res.status).toBe(200)
    // The counts are what the route *did*, which is what makes them usable as
    // §3.5's tripwire rather than decoration. `passkeys` counts *deletions*,
    // and it is 1 here only because this case manufactures a second Login: the
    // caller's Passkey is spared, the other one goes. A clean production run
    // deletes none, which is why §3.5's table expects `= 0` and treats any
    // deletion at all as a credential that is not CI's.
    expect(await jsonOf<ResetBody>(res)).toEqual({
      deleted: 2,
      revoked: 1,
      passkeys: 1,
      invites: 1,
    })

    expect(await opCount(E2E)).toBe(0)
    // §3.4: rows go, the counter does not. A client whose cursor sat at 2
    // against a counter restarted at 0 would never pull again.
    expect(await householdSeq(E2E)).toBe(seqBefore)
    expect(await opCount(OTHER)).toBe(1)

    const devices = await db
      .selectFrom('device')
      .select(['id', 'revoked_at'])
      .where('household_id', '=', E2E)
      .execute()
    expect(
      devices.find((device) => device.id === first.device_id)?.revoked_at,
    ).not.toBeNull()
    expect(
      devices.find((device) => device.id === caller.device_id)?.revoked_at,
    ).toBeNull()

    // Exactly one credential survives, and it is the one the caller signed in
    // with — the invariant §3.5's tripwire rests on. With nothing but the
    // caller's Passkey left behind, a later run that deletes one has found a
    // credential somebody else added.
    const callerDevice = await db
      .selectFrom('device')
      .select('passkey_id')
      .where('id', '=', caller.device_id)
      .executeTakeFirstOrThrow()
    const passkeys = await db
      .selectFrom('passkey')
      .innerJoin('login', 'login.id', 'passkey.login_id')
      .select('passkey.id')
      .where('login.household_id', '=', E2E)
      .execute()
    expect(passkeys.map((passkey) => passkey.id)).toEqual([
      callerDevice.passkey_id,
    ])

    const outstanding = await db
      .selectFrom('invite')
      .select('id')
      .where('household_id', '=', E2E)
      .where('used_at', 'is', null)
      .execute()
    expect(outstanding).toHaveLength(0)

    // The other Household's own credentials are not collateral.
    expect(
      await db
        .selectFrom('device')
        .select('revoked_at')
        .where('id', '=', other.device_id)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ revoked_at: null })
  })

  it('refuses a household that was never marked disposable', async () => {
    // The third gate. The env var alone is a typo away from pointing at a
    // real Household, so the Household itself has to have said yes too.
    await resetHouseholds(db, [E2E])
    await seedHousehold(db, { id: E2E, name: 'E2E', disposable: false })

    const caller = await joinHousehold(h.app, E2E)
    await post(h.app, '/api/v1/sync/push', { ops: [anOp(E2E)] }, caller.token)

    const res = await reset(h.app, caller.token)
    expect(res.status).toBe(403)
    expect(await jsonOf(res)).toEqual({ error: 'forbidden' })

    expect(await opCount(E2E)).toBe(1)
    const devices = await db
      .selectFrom('device')
      .select('revoked_at')
      .where('household_id', '=', E2E)
      .execute()
    expect(devices.every((device) => device.revoked_at === null)).toBe(true)
  })

  it("spends from /sync's per-device bucket, not a bucket of its own", async () => {
    // §3.3's third bullet. `buildApp` creates a `RateLimiter` per
    // `v1.route(...)` mount, so `/test` would get a fresh bucket unless the
    // sync limiter *instance* is handed to it — a wiring mistake no unit test
    // of the limiter could see.
    const limited = await createHarness({
      e2eHouseholdId: E2E,
      syncRateLimit: { capacity: 2, refillPerMinute: 1 },
    })
    try {
      const caller = await joinHousehold(limited.app, E2E)

      expect(
        (
          await post(
            limited.app,
            '/api/v1/sync/push',
            { ops: [anOp(E2E)] },
            caller.token,
          )
        ).status,
      ).toBe(200)
      expect(
        (
          await post(
            limited.app,
            '/api/v1/sync/push',
            { ops: [anOp(E2E)] },
            caller.token,
          )
        ).status,
      ).toBe(200)

      expect((await reset(limited.app, caller.token)).status).toBe(429)
    } finally {
      await limited.db.destroy()
    }
  })

  it('spares no passkey when the caller signed in through a device link', async () => {
    // A device-link Device has no `passkey_id` (`device/claim` creates no
    // credential), so there is nothing to exclude and every Passkey of the
    // Household goes. That is the honest reading of §3's `id <> $caller_passkey`
    // and not a case to special-case: CI signs in with a passkey, so this
    // path is the one a *human* would take, and leaving a credential behind
    // for it would be the surprise.
    const owner = await joinHousehold(h.app, E2E)
    const link = await h.service.issueDeviceLink({
      deviceId: owner.device_id,
      loginId: owner.login_id,
      householdId: E2E,
      personId: owner.person_id,
    })

    const claimed = await jsonOf<{ token: string; device_id: string }>(
      await post(h.app, '/api/v1/auth/device/claim', { secret: link.secret }),
    )
    expect(
      await db
        .selectFrom('device')
        .select('passkey_id')
        .where('id', '=', claimed.device_id)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ passkey_id: null })

    const before = await db
      .selectFrom('passkey')
      .innerJoin('login', 'login.id', 'passkey.login_id')
      .select('passkey.id')
      .where('login.household_id', '=', E2E)
      .execute()
    expect(before).toHaveLength(1)

    const res = await reset(h.app, claimed.token)
    expect(res.status).toBe(200)
    expect(await jsonOf<ResetBody>(res)).toMatchObject({
      passkeys: before.length,
    })

    const after = await db
      .selectFrom('passkey')
      .innerJoin('login', 'login.id', 'passkey.login_id')
      .select('passkey.id')
      .where('login.household_id', '=', E2E)
      .execute()
    expect(after).toHaveLength(0)
  })
})
