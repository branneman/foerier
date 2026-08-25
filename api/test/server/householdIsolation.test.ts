import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { systemIdSource, type OpEnvelope } from '@foerier/shared'

import type { Database } from '../../src/db/schema.ts'
import {
  createHarness,
  resetHouseholds,
  seedHousehold,
  seedInvite,
  TEST_ORIGIN,
  TEST_RP_ID,
  jsonOf,
  type Harness,
} from './harness.ts'
import { SoftwareAuthenticator } from './softwareAuthenticator.ts'

/**
 * **Story 31 — the tenancy property.** The boundary foerier would be sold
 * along, and the one obligation every slice must preserve rather than deliver
 * (`architecture-design.md` §8.7).
 *
 * The rule under test: `household_id` comes from the Device token and **never**
 * from a body, query string, or header (`auth-design.md` §9.3). This suite is
 * the analog of `health`'s `MultiUserIsolationTest`, and every slice that adds
 * a read or write path must extend it.
 *
 * UUID registry slots #2 and #3 (`docs/testing.md`).
 */
const HOUSEHOLD_A = '0f000002-0000-4000-8000-000000000002'
const HOUSEHOLD_B = '0f000003-0000-4000-8000-000000000003'

describe('household isolation', () => {
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
    await resetHouseholds(db, [HOUSEHOLD_A, HOUSEHOLD_B])
    await seedHousehold(db, { id: HOUSEHOLD_A, name: 'Veldkamp' })
    await seedHousehold(db, { id: HOUSEHOLD_B, name: 'Oosterhuis' })
  })

  async function post(path: string, body?: unknown, token?: string) {
    return h.app.request(path, {
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
  async function joinHousehold(householdId: string) {
    const invite = await seedInvite(db, { householdId, clock: h.clock })
    const options = await jsonOf<never>(
      await post('/api/v1/auth/register/options', { secret: invite.secret }),
    )

    const device = new SoftwareAuthenticator({
      origin: TEST_ORIGIN,
      rpId: TEST_RP_ID,
    })

    const res = await post('/api/v1/auth/register/verify', {
      secret: invite.secret,
      response: device.create(options),
    })

    return {
      ...((await jsonOf(res)) as {
        token: string
        household_id: string
        person_id: string
        login_id: string
      }),
      device,
      personId: invite.personId,
    }
  }

  async function pull(query: string, token: string) {
    return h.app.request(`/api/v1/sync/pull${query}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  }

  async function householdSeq(householdId: string): Promise<number> {
    const row = await db
      .selectFrom('household')
      .select('op_seq')
      .where('id', '=', householdId)
      .executeTakeFirstOrThrow()
    return row.op_seq
  }

  // A deliberately independent envelope builder — a small local one, not
  // `sync.test.ts`'s, so this suite does not couple to another class's
  // fixtures (see the task brief). `id` comes from `systemIdSource`, a real
  // UUIDv7 generator, rather than a counter reset to 1: `op_id` is the
  // primary key on a shared, persistent `foerier_test` and a predictable
  // counter would collide with `sync.test.ts`'s own ops across files.
  const AGGREGATE_ID = '0198e0b7-aaaa-7f4c-93de-5a6b7c8d9e0f'
  const DEVICE_ID = '0198e0b7-bbbb-7f4c-93de-5a6b7c8d9e0f'

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

  it('resolves each token to its own household, and only its own', async () => {
    const a = await joinHousehold(HOUSEHOLD_A)
    const b = await joinHousehold(HOUSEHOLD_B)

    expect(a.household_id).toBe(HOUSEHOLD_A)
    expect(b.household_id).toBe(HOUSEHOLD_B)
    expect(a.token).not.toBe(b.token)

    const meA = await h.app.request('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${a.token}` },
    })
    const meB = await h.app.request('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${b.token}` },
    })

    await expect(meA.json()).resolves.toMatchObject({
      household_id: HOUSEHOLD_A,
      person_id: a.personId,
    })
    await expect(meB.json()).resolves.toMatchObject({
      household_id: HOUSEHOLD_B,
      person_id: b.personId,
    })
  })

  it('ignores a household_id supplied by the caller', async () => {
    // The heart of the rule. A client that names a household — in the query
    // string, in a header, or in a body — must be answered with its OWN
    // household regardless. Silently rewriting would hide a client bug that is
    // indistinguishable from an attack, so the token simply wins.
    const a = await joinHousehold(HOUSEHOLD_A)

    const res = await h.app.request(
      `/api/v1/auth/me?household_id=${HOUSEHOLD_B}`,
      {
        headers: {
          authorization: `Bearer ${a.token}`,
          'x-household-id': HOUSEHOLD_B,
        },
      },
    )

    await expect(res.json()).resolves.toMatchObject({
      household_id: HOUSEHOLD_A,
    })
  })

  it("cannot redeem another household's invite with an existing token", async () => {
    // An invite is bound to a household at creation. Holding a valid token for
    // A must not make B's outstanding invite usable as A.
    const a = await joinHousehold(HOUSEHOLD_A)
    const bInvite = await seedInvite(db, {
      householdId: HOUSEHOLD_B,
      clock: h.clock,
    })

    const options = await jsonOf<never>(
      await post(
        '/api/v1/auth/register/options',
        { secret: bInvite.secret },
        a.token,
      ),
    )

    const device = new SoftwareAuthenticator({
      origin: TEST_ORIGIN,
      rpId: TEST_RP_ID,
    })
    const res = await post(
      '/api/v1/auth/register/verify',
      { secret: bInvite.secret, response: device.create(options) },
      a.token,
    )

    // It succeeds as a *new* Login in B — that is what a join invite is for —
    // but it must never attach to A's Login or move A into B.
    const created = await jsonOf(res)
    expect(created.household_id).toBe(HOUSEHOLD_B)
    expect(created.login_id).not.toBe(a.login_id)

    const stillA = await h.app.request('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${a.token}` },
    })
    await expect(stillA.json()).resolves.toMatchObject({
      household_id: HOUSEHOLD_A,
      login_id: a.login_id,
    })
  })

  it("revoking one household's device leaves the other signed in", async () => {
    const a = await joinHousehold(HOUSEHOLD_A)
    const b = await joinHousehold(HOUSEHOLD_B)

    await post('/api/v1/auth/signout', undefined, a.token)

    expect(
      (
        await h.app.request('/api/v1/auth/me', {
          headers: { authorization: `Bearer ${a.token}` },
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await h.app.request('/api/v1/auth/me', {
          headers: { authorization: `Bearer ${b.token}` },
        })
      ).status,
    ).toBe(200)
  })

  it("disabling one household's login leaves the other signed in", async () => {
    const a = await joinHousehold(HOUSEHOLD_A)
    const b = await joinHousehold(HOUSEHOLD_B)

    await db
      .updateTable('login')
      .set({ disabled_at: new Date(h.clock.now()) })
      .where('household_id', '=', HOUSEHOLD_A)
      .execute()

    expect(
      (
        await h.app.request('/api/v1/auth/me', {
          headers: { authorization: `Bearer ${a.token}` },
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await h.app.request('/api/v1/auth/me', {
          headers: { authorization: `Bearer ${b.token}` },
        })
      ).status,
    ).toBe(200)
  })

  it('lets two households hold logins for the same person id', async () => {
    // `person_id` is an opaque UUID minted per household, so uniqueness is per
    // household, not global. A global unique constraint would be a
    // cross-household coupling — exactly what the boundary forbids.
    const personId = '0f0000ff-0000-4000-8000-0000000000ff'

    await db
      .insertInto('login')
      .values([
        {
          id: crypto.randomUUID(),
          household_id: HOUSEHOLD_A,
          person_id: personId,
        },
        {
          id: crypto.randomUUID(),
          household_id: HOUSEHOLD_B,
          person_id: personId,
        },
      ])
      .execute()

    const logins = await db
      .selectFrom('login')
      .selectAll()
      .where('person_id', '=', personId)
      .execute()

    expect(logins).toHaveLength(2)
  })

  it('refuses a second login for the same person in one household', async () => {
    // "A Person holds at most one Login" is enforced by the database, not by a
    // check someone can forget to write (story 28).
    const personId = '0f0000fe-0000-4000-8000-0000000000fe'

    await db
      .insertInto('login')
      .values({
        id: crypto.randomUUID(),
        household_id: HOUSEHOLD_A,
        person_id: personId,
      })
      .execute()

    await expect(
      db
        .insertInto('login')
        .values({
          id: crypto.randomUUID(),
          household_id: HOUSEHOLD_A,
          person_id: personId,
        })
        .execute(),
    ).rejects.toThrow()
  })

  // The half of Story 31 auth slice 1 could not assert, because `/sync` did
  // not exist yet (`architecture-design.md` §8.7, `auth-design.md` §9.3).

  it("rejects an op carrying another household's id, and stores nothing", async () => {
    const a = await joinHousehold(HOUSEHOLD_A)
    const foreign = anOp(HOUSEHOLD_B)

    const res = await post('/api/v1/sync/push', { ops: [foreign] }, a.token)
    expect(res.status).toBe(200)

    const body = await jsonOf<{
      results: Array<{ op_id: string; status: string; code?: string }>
    }>(res)
    // Rejected outright — the op's own household_id is what got compared
    // against the token's, never silently rewritten to match it. Silence
    // would hide a client bug indistinguishable from an attack (§9.3).
    expect(body.results).toEqual([
      { op_id: foreign.id, status: 'rejected', code: 'household_mismatch' },
    ])

    // The rejection alone is not the property: a rejection that still wrote
    // a row would pass the status check above. Nothing may have landed in
    // either household — least of all the one the op claimed.
    expect(
      await db
        .selectFrom('op')
        .select('op_id')
        .where('household_id', '=', HOUSEHOLD_B)
        .execute(),
    ).toHaveLength(0)
    expect(
      await db
        .selectFrom('op')
        .select('op_id')
        .where('household_id', '=', HOUSEHOLD_A)
        .execute(),
    ).toHaveLength(0)
  })

  it("never returns household B's ops to household A at any cursor", async () => {
    const a = await joinHousehold(HOUSEHOLD_A)
    const b = await joinHousehold(HOUSEHOLD_B)

    const pushed = await post(
      '/api/v1/sync/push',
      { ops: [anOp(HOUSEHOLD_B), anOp(HOUSEHOLD_B), anOp(HOUSEHOLD_B)] },
      b.token,
    )
    expect(pushed.status).toBe(200)

    // since=0 is the bootstrap case, and the one that would leak everything
    // if it leaked at all — but it is not the only cursor a client ever
    // pulls at, so try one past it too.
    for (const since of [0, 1, 1000]) {
      const res = await pull(`?since=${since}`, a.token)
      expect(res.status).toBe(200)
      const body = await jsonOf<{ ops: unknown[] }>(res)
      expect(body.ops).toEqual([])
    }
  })

  it("never advances household A's op_seq when household B pushes", async () => {
    const b = await joinHousehold(HOUSEHOLD_B)

    const before = await householdSeq(HOUSEHOLD_A)
    expect(before).toBe(0)

    const pushed = await post(
      '/api/v1/sync/push',
      { ops: [anOp(HOUSEHOLD_B), anOp(HOUSEHOLD_B)] },
      b.token,
    )
    expect(pushed.status).toBe(200)

    // The counter the first-sync fold reads as an op count (§7.6). A shared
    // counter would make A's bootstrap wait forever on ops it can never
    // receive.
    expect(await householdSeq(HOUSEHOLD_A)).toBe(before)
  })

  it('gives each household its own seq space starting at 1', async () => {
    const a = await joinHousehold(HOUSEHOLD_A)
    const b = await joinHousehold(HOUSEHOLD_B)

    // B goes first and banks two seqs. If the two households shared one
    // counter, A's very first op would be handed seq 3, not 1.
    const bRes = await post(
      '/api/v1/sync/push',
      { ops: [anOp(HOUSEHOLD_B), anOp(HOUSEHOLD_B)] },
      b.token,
    )
    const bBody = await jsonOf<{ results: Array<{ seq?: number }> }>(bRes)
    expect(bBody.results[0]?.seq).toBe(1)

    const aRes = await post(
      '/api/v1/sync/push',
      { ops: [anOp(HOUSEHOLD_A)] },
      a.token,
    )
    const aBody = await jsonOf<{ results: Array<{ seq?: number }> }>(aRes)
    expect(aBody.results[0]?.seq).toBe(1)
  })

  it('ignores a household_id supplied in the pull query string', async () => {
    const a = await joinHousehold(HOUSEHOLD_A)
    const b = await joinHousehold(HOUSEHOLD_B)

    const aOp = anOp(HOUSEHOLD_A)
    await post('/api/v1/sync/push', { ops: [aOp] }, a.token)
    await post('/api/v1/sync/push', { ops: [anOp(HOUSEHOLD_B)] }, b.token)

    // The token wins; the request never gets a say.
    const res = await pull(`?since=0&household_id=${HOUSEHOLD_B}`, a.token)
    expect(res.status).toBe(200)

    const body = await jsonOf<{
      ops: Array<{ id: string; household_id: string }>
    }>(res)
    expect(body.ops.map((op) => op.id)).toEqual([aOp.id])
    expect(body.ops.every((op) => op.household_id === HOUSEHOLD_A)).toBe(true)
  })
})
