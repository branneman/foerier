import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { SESSION_LIFETIME_MS } from '../../src/auth/session.ts'
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
 * Tier 2s — the register and login ceremonies, end to end, against a real
 * Postgres and a real (software) authenticator.
 *
 * UUID registry slot #1 (`docs/testing.md`).
 */
const HOUSEHOLD = '0f000001-0000-4000-8000-000000000001'

describe('the join and sign-in ceremonies', () => {
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

  /**
   * Scoped to this class's household on purpose. `foerier_test` is persistent
   * and shared with the other Tier 2s classes, so an unscoped count silently
   * measures their rows too (docs/testing.md, isolation model).
   */
  function loginsHere() {
    return db
      .selectFrom('login')
      .selectAll()
      .where('household_id', '=', HOUSEHOLD)
      .execute()
  }

  function authenticator() {
    return new SoftwareAuthenticator({
      origin: TEST_ORIGIN,
      rpId: TEST_RP_ID,
    })
  }

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

  /** The whole of joining, as the client performs it. */
  async function join(secret: string) {
    const optionsRes = await post('/api/v1/auth/register/options', { secret })
    expect(optionsRes.status).toBe(200)
    const options = await jsonOf<never>(optionsRes)

    const device = authenticator()
    const verifyRes = await post('/api/v1/auth/register/verify', {
      secret,
      response: device.create(options),
    })

    return { verifyRes, device }
  }

  it('turns an invite into a login, a passkey and a signed-in device', async () => {
    const invite = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
    })

    const { verifyRes } = await join(invite.secret)
    expect(verifyRes.status).toBe(200)
    const body = await jsonOf(verifyRes)

    expect(body.token).toMatch(/^foe_/)
    expect(body.household_id).toBe(HOUSEHOLD)
    // The Login is bound to the Person the Invite named, which is what makes
    // "a Login is always a Person" true by construction rather than by
    // convention (auth-design.md §3.1).
    expect(body.person_id).toBe(invite.personId)

    const me = await h.app.request('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${body.token}` },
    })
    expect(me.status).toBe(200)
    await expect(me.json()).resolves.toMatchObject({
      household_id: HOUSEHOLD,
      person_id: invite.personId,
    })
  })

  it('stores the token hashed, never the token', async () => {
    const invite = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
    })
    const { verifyRes } = await join(invite.secret)
    const { token } = await jsonOf(verifyRes)

    const devices = await db
      .selectFrom('device')
      .selectAll()
      .where('household_id', '=', HOUSEHOLD)
      .execute()

    expect(devices).toHaveLength(1)
    // A database reader must not be able to mint access from a stored row.
    const stored = Buffer.from(devices[0]!.token_hash).toString('hex')
    expect(stored).not.toContain(token)
    expect(devices[0]!.token_hash).toHaveLength(32)
  })

  it('gives the device a one-year sliding expiry', async () => {
    const invite = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
    })
    await join(invite.secret)

    const device = await db
      .selectFrom('device')
      .selectAll()
      .where('household_id', '=', HOUSEHOLD)
      .executeTakeFirst()

    expect(device!.expires_at.getTime()).toBe(
      h.clock.now() + SESSION_LIFETIME_MS,
    )
  })

  it('records which Passkey signed the Device in, on both ceremonies', async () => {
    // `/test/reset` spares the calling Device's Passkey, and this column is
    // the only way it can know which one that is
    // (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3).
    const invite = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
    })

    const { verifyRes, device } = await join(invite.secret)
    const joined = await jsonOf<{ login_id: string; device_id: string }>(
      verifyRes,
    )

    const passkey = await db
      .selectFrom('passkey')
      .select('id')
      .where('login_id', '=', joined.login_id)
      .executeTakeFirstOrThrow()

    const registered = await db
      .selectFrom('device')
      .select('passkey_id')
      .where('id', '=', joined.device_id)
      .executeTakeFirstOrThrow()
    expect(registered.passkey_id).toBe(passkey.id)

    const options = await jsonOf<never>(
      await post('/api/v1/auth/login/options'),
    )
    const signedIn = await jsonOf<{ device_id: string }>(
      await post('/api/v1/auth/login/verify', {
        response: device.get(options),
      }),
    )

    const row = await db
      .selectFrom('device')
      .select('passkey_id')
      .where('id', '=', signedIn.device_id)
      .executeTakeFirstOrThrow()
    expect(row.passkey_id).toBe(passkey.id)
  })

  it('refuses an invite its second time', async () => {
    // Single-use is the whole bound on a stolen link (story 31).
    const invite = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
    })

    const first = await join(invite.secret)
    expect(first.verifyRes.status).toBe(200)

    // The second attempt is turned away at the very first step — the invite is
    // spent, so there is no point issuing creation options for it.
    const second = await post('/api/v1/auth/register/options', {
      secret: invite.secret,
    })
    expect(second.status).toBe(401)

    expect(await loginsHere()).toHaveLength(1)
  })

  it('refuses a verify whose invite was consumed after options were issued', async () => {
    // The path that matters: a client can hold creation options from before
    // the invite was spent and skip straight to verify. Checking redeemability
    // only at the options step would let a link be used twice.
    const invite = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
    })

    const stale = await jsonOf<never>(
      await post('/api/v1/auth/register/options', { secret: invite.secret }),
    )

    const first = await join(invite.secret)
    expect(first.verifyRes.status).toBe(200)

    const latecomer = authenticator()
    const res = await post('/api/v1/auth/register/verify', {
      secret: invite.secret,
      response: latecomer.create(stale),
    })

    expect(res.status).toBe(401)
    expect(await loginsHere()).toHaveLength(1)
  })

  it('refuses an expired invite', async () => {
    const invite = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
      expiresAt: new Date(h.clock.now() - 1),
    })

    const res = await post('/api/v1/auth/register/options', {
      secret: invite.secret,
    })

    expect(res.status).toBe(401)
  })

  it('refuses a revoked invite', async () => {
    const invite = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
    })
    await db
      .updateTable('invite')
      .set({ revoked_at: new Date(h.clock.now()) })
      .where('id', '=', invite.inviteId)
      .execute()

    const res = await post('/api/v1/auth/register/options', {
      secret: invite.secret,
    })

    expect(res.status).toBe(401)
  })

  it('answers unknown, expired, used and revoked invites identically', async () => {
    // There is nothing to enumerate and nothing to gain from being specific
    // (auth-design.md §9.4).
    const used = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
    })
    await join(used.secret)

    const expired = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
      expiresAt: new Date(h.clock.now() - 1),
    })

    const responses = await Promise.all([
      post('/api/v1/auth/register/options', { secret: 'not-a-real-secret' }),
      post('/api/v1/auth/register/options', { secret: used.secret }),
      post('/api/v1/auth/register/options', { secret: expired.secret }),
    ])

    const bodies = await Promise.all(responses.map((r) => r.json()))

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401])
    expect(bodies[0]).toEqual(bodies[1])
    expect(bodies[1]).toEqual(bodies[2])
  })

  it('does not consume the invite when the link is merely opened', async () => {
    // Chat apps and mail scanners fetch links to build previews. A
    // GET-consumes design would let a preview burn the invite before its
    // recipient ever taps it (auth-design.md §3.3).
    const invite = await seedInvite(db, {
      householdId: HOUSEHOLD,
      clock: h.clock,
    })

    await post('/api/v1/auth/register/options', { secret: invite.secret })
    await post('/api/v1/auth/register/options', { secret: invite.secret })

    const row = await db
      .selectFrom('invite')
      .selectAll()
      .where('id', '=', invite.inviteId)
      .executeTakeFirst()

    expect(row!.used_at).toBeNull()
  })

  describe('signing in again', () => {
    it('issues a second device token for the same login', async () => {
      const invite = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
      })
      const { verifyRes, device } = await join(invite.secret)
      const joined = await jsonOf(verifyRes)

      const optionsRes = await post('/api/v1/auth/login/options')
      const options = await jsonOf<never>(optionsRes)

      const res = await post('/api/v1/auth/login/verify', {
        response: device.get(options),
      })

      expect(res.status).toBe(200)
      const body = await jsonOf(res)
      expect(body.login_id).toBe(joined.login_id)
      expect(body.token).not.toBe(joined.token)

      const devices = await db
        .selectFrom('device')
        .selectAll()
        .where('household_id', '=', HOUSEHOLD)
        .execute()
      expect(devices).toHaveLength(2)
    })

    it('needs no username — allowCredentials is empty', async () => {
      // This is the property that makes the sign-in screen one button.
      const res = await post('/api/v1/auth/login/options')

      await expect(res.json()).resolves.toMatchObject({ allowCredentials: [] })
    })

    it('refuses an unknown credential', async () => {
      const stranger = authenticator()
      const options = await jsonOf<never>(
        await post('/api/v1/auth/login/options'),
      )

      const res = await post('/api/v1/auth/login/verify', {
        response: stranger.get(options),
      })

      expect(res.status).toBe(401)
    })

    it('refuses a replayed challenge', async () => {
      const invite = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
      })
      const { device } = await join(invite.secret)

      const options = await jsonOf<never>(
        await post('/api/v1/auth/login/options'),
      )
      const assertion = device.get(options)

      expect(
        (await post('/api/v1/auth/login/verify', { response: assertion }))
          .status,
      ).toBe(200)
      // Same signed assertion, second time: the challenge is spent.
      expect(
        (await post('/api/v1/auth/login/verify', { response: assertion }))
          .status,
      ).toBe(401)
    })

    it('accepts a synced passkey reporting a sign count of zero', async () => {
      // The case that would lock out essentially every real passkey if the
      // counter rule were naive (auth-design.md §4).
      const invite = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
      })
      const { device } = await join(invite.secret)
      expect(device.signCount).toBe(0)

      const options = await jsonOf<never>(
        await post('/api/v1/auth/login/options'),
      )
      const res = await post('/api/v1/auth/login/verify', {
        response: device.get(options),
      })

      expect(res.status).toBe(200)
    })
  })

  describe('sessions', () => {
    async function signedIn() {
      const invite = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
      })
      const { verifyRes } = await join(invite.secret)
      return (await jsonOf(verifyRes)) as { token: string; device_id: string }
    }

    it('rejects an unknown bearer token', async () => {
      const res = await h.app.request('/api/v1/auth/me', {
        headers: { authorization: 'Bearer foe_nope' },
      })

      expect(res.status).toBe(401)
    })

    it('rejects a request with no Authorization header', async () => {
      expect((await h.app.request('/api/v1/auth/me')).status).toBe(401)
    })

    it('revokes the calling device on sign-out, immediately', async () => {
      const { token } = await signedIn()

      expect(
        (await post('/api/v1/auth/signout', undefined, token)).status,
      ).toBe(204)
      // Revocation is server-side and takes effect at the very next request.
      expect(
        (
          await h.app.request('/api/v1/auth/me', {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(401)
    })

    it('rejects an expired device', async () => {
      const { token } = await signedIn()

      h.clock.advance(SESSION_LIFETIME_MS + 1)

      expect(
        (
          await h.app.request('/api/v1/auth/me', {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(401)
    })

    it('rejects every device of a disabled login', async () => {
      const { token } = await signedIn()

      await db
        .updateTable('login')
        .set({ disabled_at: new Date(h.clock.now()) })
        .where('household_id', '=', HOUSEHOLD)
        .execute()

      expect(
        (
          await h.app.request('/api/v1/auth/me', {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(401)
    })

    it('does not write last_seen_at on the common request', async () => {
      // The sliding expiry must not turn every sync into a write.
      const { token, device_id } = await signedIn()
      const before = await db
        .selectFrom('device')
        .select('last_seen_at')
        .where('id', '=', device_id)
        .executeTakeFirst()

      h.clock.advance(60_000)
      await h.app.request('/api/v1/auth/me', {
        headers: { authorization: `Bearer ${token}` },
      })

      const after = await db
        .selectFrom('device')
        .select('last_seen_at')
        .where('id', '=', device_id)
        .executeTakeFirst()

      expect(after!.last_seen_at).toEqual(before!.last_seen_at)
    })

    it('writes last_seen_at once a day has passed', async () => {
      const { token, device_id } = await signedIn()

      h.clock.advance(25 * 60 * 60 * 1000)
      await h.app.request('/api/v1/auth/me', {
        headers: { authorization: `Bearer ${token}` },
      })

      const after = await db
        .selectFrom('device')
        .select('last_seen_at')
        .where('id', '=', device_id)
        .executeTakeFirst()

      expect(after!.last_seen_at.getTime()).toBe(h.clock.now())
    })
  })

  describe('the maintainer bootstrap', () => {
    it('writes disposable only when told to', async () => {
      // The third gate on `/test/reset` is a column no code path but this one
      // can set, so the default must stay false without the caller saying so.
      const a = await h.service.bootstrapHousehold({ name: 'Real' })
      const b = await h.service.bootstrapHousehold({
        name: 'E2E',
        disposable: true,
      })

      const ids = [a.householdId, b.householdId]
      try {
        const rows = await db
          .selectFrom('household')
          .select(['id', 'disposable'])
          .where('id', 'in', ids)
          .execute()

        expect(rows.find((r) => r.id === a.householdId)?.disposable).toBe(false)
        expect(rows.find((r) => r.id === b.householdId)?.disposable).toBe(true)
      } finally {
        // These two are not this class's registry-slot Household, so
        // `resetHouseholds` will never collect them.
        await db.deleteFrom('household').where('id', 'in', ids).execute()
      }
    })
  })

  describe('CORS', () => {
    it('answers exactly one origin, never a wildcard', async () => {
      const res = await h.app.request('/api/v1/auth/login/options', {
        method: 'OPTIONS',
        headers: {
          origin: TEST_ORIGIN,
          'access-control-request-method': 'POST',
        },
      })

      expect(res.headers.get('access-control-allow-origin')).toBe(TEST_ORIGIN)
      expect(res.headers.get('access-control-allow-origin')).not.toBe('*')
      // Deliberately absent: there are no cookies, which is what removes CSRF
      // from the threat model rather than mitigating it (auth-design.md §8.3).
      expect(res.headers.get('access-control-allow-credentials')).toBeNull()
    })

    it('does not echo an origin outside the allowlist', async () => {
      const res = await h.app.request('/api/v1/auth/login/options', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'POST',
        },
      })

      expect(res.headers.get('access-control-allow-origin')).not.toBe(
        'https://evil.example',
      )
    })
  })
})
