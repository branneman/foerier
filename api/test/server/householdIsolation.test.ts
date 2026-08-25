import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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
})
