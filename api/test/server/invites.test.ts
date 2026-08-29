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
 * Tier 2s — `POST /auth/invites` learns the join purpose (story 28).
 *
 * UUID registry slot #15 (`docs/testing.md`). Deliberately its own file and
 * its own Household rather than sharing `logins.test.ts`'s scaffolding: each
 * Tier 2s class owns a fixed household id under `docs/testing.md`'s isolation
 * model, and extracting a shared helper would couple the two files' constants.
 */
const HOUSEHOLD = '0f00000f-0000-4000-8000-00000000000f'

describe('invites', () => {
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

  /** A Device on a fresh Login, signed in and within the last-seen window. */
  async function signedInDevice(): Promise<{
    token: string
    loginId: string
    deviceId: string
  }> {
    const loginId = systemIdSource.next()
    const personId = systemIdSource.next()
    await db
      .insertInto('login')
      .values({ id: loginId, household_id: HOUSEHOLD, person_id: personId })
      .execute()

    const deviceId = systemIdSource.next()
    const { token, tokenHash } = issueDeviceToken()
    await db
      .insertInto('device')
      .values({
        id: deviceId,
        login_id: loginId,
        household_id: HOUSEHOLD,
        token_hash: tokenHash,
        label: 'Firefox on Android',
        // Within the middleware's 24h last-seen throttle of the frozen clock
        // (`session.ts`'s `shouldRefreshLastSeen`) — see `logins.test.ts`.
        last_seen_at: new Date(h.clock.now()),
        expires_at: nextExpiry(h.clock),
      })
      .execute()

    return { token, loginId, deviceId }
  }

  function post(path: string, token: string, body: unknown) {
    return h.app.request(`/api/v1${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
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

  it('mints a join Invite for a recorded Person', async () => {
    const caller = await signedInDevice()
    const personId = systemIdSource.next()

    const res = await post('/auth/invites', caller.token, {
      purpose: 'join',
      person_id: personId,
    })
    expect(res.status).toBe(200)

    const body = await jsonOf<{
      id: string
      secret: string
      expires_at: string
    }>(res)
    expect(body.secret).toHaveLength(43)

    const row = await db
      .selectFrom('invite')
      .selectAll()
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow()

    expect(row.purpose).toBe('join')
    expect(row.person_id).toBe(personId)
    expect(row.login_id).toBeNull()
    expect(row.created_by_login).toBe(caller.loginId)
    // Stated by the minting code: the client picked this Person off the
    // folded list, so the joiner does not name themselves (§12.7).
    expect(row.person_recorded).toBe(true)
    // 7 days (auth-design §3.1).
    expect(row.expires_at.getTime() - h.clock.now()).toBe(
      7 * 24 * 60 * 60 * 1000,
    )
  })

  it('is single-use — the second redemption of one secret fails', async () => {
    const caller = await signedInDevice()
    const personId = systemIdSource.next()
    const issued = await post('/auth/invites', caller.token, {
      purpose: 'join',
      person_id: personId,
    })
    expect(issued.status).toBe(200)
    const { secret } = await jsonOf<{ secret: string }>(issued)

    const first = await h.app.request('/api/v1/auth/device/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    expect(first.status).toBe(200)

    const second = await h.app.request('/api/v1/auth/device/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    expect(second.status).toBe(401)
  })

  it('expires after seven days', async () => {
    const caller = await signedInDevice()
    const issued = await post('/auth/invites', caller.token, {
      purpose: 'join',
      person_id: systemIdSource.next(),
    })
    expect(issued.status).toBe(200)
    const { secret } = await jsonOf<{ secret: string }>(issued)

    h.clock.advance(7 * 24 * 60 * 60 * 1000 + 1)

    const res = await h.app.request('/api/v1/auth/device/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    expect(res.status).toBe(401)
  })

  it('refuses a join Invite for a Person who already holds a Login', async () => {
    const caller = await signedInDevice()
    const holder = await signedInDevice()
    const person = await db
      .selectFrom('login')
      .select('person_id')
      .where('id', '=', holder.loginId)
      .executeTakeFirstOrThrow()

    const res = await post('/auth/invites', caller.token, {
      purpose: 'join',
      person_id: person.person_id,
    })
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toMatchObject({ error: 'person_has_login' })
  })

  it('revokes the Person’s previous outstanding join Invite', async () => {
    const caller = await signedInDevice()
    const personId = systemIdSource.next()

    const firstRes = await post('/auth/invites', caller.token, {
      purpose: 'join',
      person_id: personId,
    })
    expect(firstRes.status).toBe(200)
    const first = await jsonOf<{ id: string }>(firstRes)

    const secondRes = await post('/auth/invites', caller.token, {
      purpose: 'join',
      person_id: personId,
    })
    expect(secondRes.status).toBe(200)

    const row = await db
      .selectFrom('invite')
      .select('revoked_at')
      .where('id', '=', first.id)
      .executeTakeFirstOrThrow()
    expect(row.revoked_at).not.toBeNull()
  })

  it('refuses a join Invite with no person_id', async () => {
    const caller = await signedInDevice()

    const res = await post('/auth/invites', caller.token, { purpose: 'join' })
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toMatchObject({ error: 'person_id_required' })
  })

  it('mints a device link against another Person’s Login', async () => {
    const caller = await signedInDevice()
    const other = await signedInDevice()
    const person = await db
      .selectFrom('login')
      .select('person_id')
      .where('id', '=', other.loginId)
      .executeTakeFirstOrThrow()

    const issued = await post('/auth/invites', caller.token, {
      purpose: 'device',
      person_id: person.person_id,
    })
    expect(issued.status).toBe(200)
    const body = await jsonOf<{ id: string }>(issued)

    const row = await db
      .selectFrom('invite')
      .selectAll()
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow()

    expect(row.purpose).toBe('device')
    expect(row.login_id).toBe(other.loginId)
    expect(row.created_by_login).toBe(caller.loginId)
  })

  it('refuses a device link for a Person who holds no Login', async () => {
    const caller = await signedInDevice()

    const res = await post('/auth/invites', caller.token, {
      purpose: 'device',
      person_id: systemIdSource.next(),
    })
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toMatchObject({ error: 'no_login_for_person' })
  })

  it('still mints the caller’s own device link with no person_id', async () => {
    const caller = await signedInDevice()

    const issued = await post('/auth/invites', caller.token, {
      purpose: 'device',
    })
    expect(issued.status).toBe(200)
    const body = await jsonOf<{ id: string }>(issued)

    const row = await db
      .selectFrom('invite')
      .select('login_id')
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow()
    expect(row.login_id).toBe(caller.loginId)
  })

  /**
   * The rule, in one sentence: a join Invite creates a Login — that is
   * Household business — and a device Invite is a credential for one Login,
   * so it stays with its issuer (`auth-design.md` §3.1's own "listable by
   * the issuer", kept for the purpose it was written about and widened for
   * the one it was not).
   */
  it('shows a join Invite to a second Login in the Household', async () => {
    const issuer = await signedInDevice()
    const other = await signedInDevice()
    const personId = systemIdSource.next()

    const mintedRes = await post('/auth/invites', issuer.token, {
      purpose: 'join',
      person_id: personId,
    })
    expect(mintedRes.status).toBe(200)
    const minted = await jsonOf<{ id: string }>(mintedRes)

    const listRes = await get('/auth/invites', other.token)
    expect(listRes.status).toBe(200)
    const { invites } = await jsonOf<{
      invites: Array<{ id: string; purpose: string; person_id: string }>
    }>(listRes)

    expect(invites).toContainEqual(
      expect.objectContaining({
        id: minted.id,
        purpose: 'join',
        person_id: personId,
      }),
    )
  })

  it('lets a second Login revoke a join Invite it did not issue', async () => {
    const issuer = await signedInDevice()
    const other = await signedInDevice()

    const mintedRes = await post('/auth/invites', issuer.token, {
      purpose: 'join',
      person_id: systemIdSource.next(),
    })
    expect(mintedRes.status).toBe(200)
    const minted = await jsonOf<{ id: string }>(mintedRes)

    const delRes = await del(`/auth/invites/${minted.id}`, other.token)
    expect(delRes.status).toBe(204)

    const row = await db
      .selectFrom('invite')
      .select('revoked_at')
      .where('id', '=', minted.id)
      .executeTakeFirstOrThrow()
    expect(row.revoked_at).not.toBeNull()
  })

  it('hides another Login’s device link, and refuses to revoke it', async () => {
    const issuer = await signedInDevice()
    const other = await signedInDevice()

    const mintedRes = await post('/auth/invites', issuer.token, {
      purpose: 'device',
    })
    expect(mintedRes.status).toBe(200)
    const minted = await jsonOf<{ id: string }>(mintedRes)

    const listRes = await get('/auth/invites', other.token)
    expect(listRes.status).toBe(200)
    const { invites } = await jsonOf<{ invites: Array<{ id: string }> }>(
      listRes,
    )
    expect(invites.map((invite) => invite.id)).not.toContain(minted.id)

    // 204 either way — "not yours" and "does not exist" are one answer — but
    // the row must survive.
    const delRes = await del(`/auth/invites/${minted.id}`, other.token)
    expect(delRes.status).toBe(204)
    const row = await db
      .selectFrom('invite')
      .select('revoked_at')
      .where('id', '=', minted.id)
      .executeTakeFirstOrThrow()
    expect(row.revoked_at).toBeNull()
  })
})
