import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { systemIdSource } from '@foerier/shared'

import type { Database } from '../../src/db/schema.ts'
import { issueDeviceToken } from '../../src/auth/tokens.ts'
import { nextExpiry } from '../../src/auth/session.ts'
import { AuthError } from '../../src/auth/service.ts'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server'
import {
  createHarness,
  jsonOf,
  resetHouseholds,
  seedHousehold,
  TEST_ORIGIN,
  TEST_RP_ID,
  type Harness,
} from './harness.ts'
import { SoftwareAuthenticator } from './softwareAuthenticator.ts'

/**
 * Tier 2s — a signed-in Device managing its own account: `POST · GET ·
 * DELETE /auth/invites`, `GET /auth/devices`, `DELETE /auth/devices/:id`,
 * and `GET /auth/me`.
 *
 * UUID registry slot #10 (`docs/testing.md`).
 */
const HOUSEHOLD = '0f00000a-0000-4000-8000-00000000000a'

describe('account', () => {
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
   * Inserts a Device with a known token in HOUSEHOLD, and — unless
   * `sameLoginAs` names an existing one — a fresh Login for it too.
   */
  async function signedInDevice(
    options: {
      suffix?: string
      sameLoginAs?: { loginId: string }
    } = {},
  ): Promise<{ token: string; loginId: string; deviceId: string }> {
    const { suffix, sameLoginAs } = options
    const deviceId = systemIdSource.next()
    const { token, tokenHash } = issueDeviceToken()

    let loginId: string
    if (sameLoginAs !== undefined) {
      loginId = sameLoginAs.loginId
    } else {
      loginId = systemIdSource.next()
      const personId = systemIdSource.next()
      await db
        .insertInto('login')
        .values({ id: loginId, household_id: HOUSEHOLD, person_id: personId })
        .execute()
    }

    await db
      .insertInto('device')
      .values({
        id: deviceId,
        login_id: loginId,
        household_id: HOUSEHOLD,
        token_hash: tokenHash,
        label: suffix === undefined ? 'Test device' : `Test device ${suffix}`,
        expires_at: nextExpiry(h.clock),
        last_seen_at: new Date(h.clock.now()),
      })
      .execute()

    return { token, loginId, deviceId }
  }

  describe('POST /auth/invites', () => {
    it('issues a device link for the calling Login and returns the secret once', async () => {
      const { token, loginId } = await signedInDevice()

      const res = await h.app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ purpose: 'device' }),
      })

      expect(res.status).toBe(200)
      const body = await jsonOf<{
        id: string
        secret: string
        expires_at: string
      }>(res)
      expect(body.secret).toHaveLength(43)

      const invite = await db
        .selectFrom('invite')
        .selectAll()
        .where('id', '=', body.id)
        .executeTakeFirstOrThrow()
      expect(invite.purpose).toBe('device')
      expect(invite.login_id).toBe(loginId)
      expect(invite.created_by_login).toBe(loginId)
    })

    it('expires a device link in one hour, not seven days', async () => {
      const { token } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ purpose: 'device' }),
      })
      const body = await jsonOf<{ expires_at: string }>(res)
      expect(Date.parse(body.expires_at) - h.clock.now()).toBe(60 * 60 * 1000)
    })

    it('refuses a join purpose until S5 can name a Person', async () => {
      const { token } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ purpose: 'join' }),
      })

      expect(res.status).toBe(400)
      const invites = await db
        .selectFrom('invite')
        .selectAll()
        .where('household_id', '=', HOUSEHOLD)
        .execute()
      expect(invites).toHaveLength(0)
    })

    it('rejects an unauthenticated caller', async () => {
      const res = await h.app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'device' }),
      })
      expect(res.status).toBe(401)
    })
  })

  describe('GET and DELETE /auth/invites', () => {
    it('lists outstanding invites without ever returning the secret', async () => {
      const { token } = await signedInDevice()
      await h.app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ purpose: 'device' }),
      })

      const res = await h.app.request('/api/v1/auth/invites', {
        headers: { authorization: `Bearer ${token}` },
      })
      const body = await jsonOf<{ invites: Array<Record<string, unknown>> }>(
        res,
      )
      expect(body.invites).toHaveLength(1)
      expect(body.invites[0]).not.toHaveProperty('secret')
      expect(body.invites[0]).not.toHaveProperty('secret_hash')
    })

    it('revokes one, after which it cannot be claimed', async () => {
      const { token } = await signedInDevice()
      const issued = await jsonOf<{ id: string; secret: string }>(
        await h.app.request('/api/v1/auth/invites', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ purpose: 'device' }),
        }),
      )

      const del = await h.app.request(`/api/v1/auth/invites/${issued.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(del.status).toBe(204)

      const claim = await h.app.request('/api/v1/auth/device/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: issued.secret }),
      })
      expect(claim.status).toBe(401)
    })

    it('never revokes another Login’s invite', async () => {
      // `revokeInvite` scopes on `created_by_login`, not just `household_id`
      // — both Logins here share HOUSEHOLD, so this is the case a regression
      // dropping that clause would still pass the cross-Household suite.
      const mine = await signedInDevice()
      const theirs = await signedInDevice({ suffix: 'b' })

      const issued = await jsonOf<{ id: string }>(
        await h.app.request('/api/v1/auth/invites', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${theirs.token}`,
          },
          body: JSON.stringify({ purpose: 'device' }),
        }),
      )

      const del = await h.app.request(`/api/v1/auth/invites/${issued.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${mine.token}` },
      })
      // "Not yours" and "does not exist" stay the same 204 as every other
      // revoke route.
      expect(del.status).toBe(204)

      const row = await db
        .selectFrom('invite')
        .select('revoked_at')
        .where('id', '=', issued.id)
        .executeTakeFirstOrThrow()
      expect(row.revoked_at).toBeNull()
    })
  })

  describe('GET /auth/devices', () => {
    it('marks the calling Device as the current one', async () => {
      const { token, deviceId } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/devices', {
        headers: { authorization: `Bearer ${token}` },
      })

      const body = await jsonOf<{
        devices: Array<{
          id: string
          current: boolean
          enrolled_passkey_here: boolean
        }>
      }>(res)
      const mine = body.devices.find((device) => device.id === deviceId)
      expect(mine?.current).toBe(true)
      // Seeded straight into the table, so no ceremony ever ran on it.
      expect(mine?.enrolled_passkey_here).toBe(false)
    })

    it('never lists another Login’s Devices', async () => {
      const mine = await signedInDevice()
      const theirs = await signedInDevice({ suffix: 'b' })

      const res = await h.app.request('/api/v1/auth/devices', {
        headers: { authorization: `Bearer ${mine.token}` },
      })
      const body = await jsonOf<{ devices: Array<{ id: string }> }>(res)
      expect(body.devices.map((device) => device.id)).not.toContain(
        theirs.deviceId,
      )
    })

    // `final-review.md` finding 8: correct today only because nothing in this
    // database is a year old yet — a Device past the sliding expiry is
    // already 401'd by `requireAuth` (`middleware.ts:68-70`), yet without
    // this filter it would still be rendered here as signed in.
    it('omits a Device past its own sliding expiry, though nothing revoked it', async () => {
      const mine = await signedInDevice()
      const stale = systemIdSource.next()
      await db
        .insertInto('device')
        .values({
          id: stale,
          login_id: mine.loginId,
          household_id: HOUSEHOLD,
          token_hash: issueDeviceToken().tokenHash,
          label: 'A year-old Device',
          // In the past relative to the harness clock — never revoked, only
          // aged out.
          expires_at: new Date(h.clock.now() - 1),
          last_seen_at: new Date(h.clock.now() - 400 * 24 * 60 * 60 * 1000),
        })
        .execute()

      const res = await h.app.request('/api/v1/auth/devices', {
        headers: { authorization: `Bearer ${mine.token}` },
      })
      const body = await jsonOf<{ devices: Array<{ id: string }> }>(res)
      expect(body.devices.map((device) => device.id)).not.toContain(stale)
    })
  })

  describe('DELETE /auth/devices/:id', () => {
    it('revokes another of my Devices, which then 401s at its next request', async () => {
      const first = await signedInDevice()
      const second = await signedInDevice({ sameLoginAs: first })

      const del = await h.app.request(
        `/api/v1/auth/devices/${second.deviceId}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${first.token}` },
        },
      )
      expect(del.status).toBe(204)

      const after = await h.app.request('/api/v1/auth/me', {
        headers: { authorization: `Bearer ${second.token}` },
      })
      expect(after.status).toBe(401)
    })

    it('leaves another Login’s Device working, and answers 204 exactly as if it were mine', async () => {
      const mine = await signedInDevice()
      const theirs = await signedInDevice({ suffix: 'b' })

      const del = await h.app.request(
        `/api/v1/auth/devices/${theirs.deviceId}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${mine.token}` },
        },
      )
      // The half that actually matters for tenancy: "not yours" must not be
      // distinguishable from "does not exist" (below), or the response code
      // alone lets a caller probe which Device ids exist in other Logins.
      expect(del.status).toBe(204)

      const after = await h.app.request('/api/v1/auth/me', {
        headers: { authorization: `Bearer ${theirs.token}` },
      })
      expect(after.status).toBe(200)
    })

    it('answers a Device id that exists nowhere with the same 204', async () => {
      const mine = await signedInDevice()

      const del = await h.app.request(
        `/api/v1/auth/devices/${systemIdSource.next()}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${mine.token}` },
        },
      )
      expect(del.status).toBe(204)
    })
  })

  describe('GET /auth/me', () => {
    it('carries the household name the Account screen has to print', async () => {
      const { token } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/me', {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(await jsonOf(res)).toMatchObject({ household_name: 'Veldkamp' })
    })

    it('throws the same AuthError as every other auth failure when its Household row is gone', async () => {
      // Not reachable through `/api/v1/auth/me`: `login.household_id` and
      // `device.household_id` are both NOT NULL FKs with `ON DELETE CASCADE`
      // (`api/migrations/0002_auth.ts`), so a Login or Device cannot outlive
      // its Household — there is no way to seed a signed-in Device whose
      // context names a Household row that does not exist. Covered here at
      // the service level instead: `me()` is called directly with a context
      // shaped the way it would be if that state were ever reachable, and it
      // must fail the same way every other `AuthError` site does — not with
      // whatever a raw throw happens to produce — so that `/auth/me`'s route
      // handler (which now wraps this call in the same `try/catch` →
      // `failure()` every other route uses) has something to catch.
      await expect(
        h.service.me({
          loginId: systemIdSource.next(),
          householdId: systemIdSource.next(),
          personId: systemIdSource.next(),
          deviceId: systemIdSource.next(),
        }),
      ).rejects.toThrow(AuthError)
    })
  })

  describe('passkeys', () => {
    it('adds one to an existing Login, with the name the person gave it', async () => {
      const { token, loginId, deviceId } = await signedInDevice()
      const authenticator = new SoftwareAuthenticator({
        origin: TEST_ORIGIN,
        rpId: TEST_RP_ID,
      })

      const options = await jsonOf<PublicKeyCredentialCreationOptionsJSON>(
        await h.app.request('/api/v1/auth/passkeys/options', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        }),
      )

      const res = await h.app.request('/api/v1/auth/passkeys/verify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          response: authenticator.create(options),
          label: 'YubiKey, desk drawer',
        }),
      })
      expect(res.status).toBe(200)

      const rows = await db
        .selectFrom('passkey')
        .selectAll()
        .where('login_id', '=', loginId)
        .execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.label).toBe('YubiKey, desk drawer')
      // Which Device enrolled it — what makes `NO PASSKEY HERE` renderable.
      expect(rows[0]?.created_on_device).toBe(deviceId)
    })

    it('falls back to the derived Device label when none is given', async () => {
      const { token, loginId } = await signedInDevice()
      const authenticator = new SoftwareAuthenticator({
        origin: TEST_ORIGIN,
        rpId: TEST_RP_ID,
      })

      const options = await jsonOf<PublicKeyCredentialCreationOptionsJSON>(
        await h.app.request('/api/v1/auth/passkeys/options', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        }),
      )
      await h.app.request('/api/v1/auth/passkeys/verify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'user-agent':
            'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
        },
        body: JSON.stringify({ response: authenticator.create(options) }),
      })

      const rows = await db
        .selectFrom('passkey')
        .selectAll()
        .where('login_id', '=', loginId)
        .execute()
      expect(rows[0]?.label).toBe('Firefox on Android')
    })

    it('allows removing the last passkey, leaving a device-link-only Login', async () => {
      const { token, loginId } = await signedInDevice()
      await db
        .insertInto('passkey')
        .values({
          id: '0f00000a-0000-4000-8000-0000000000f1',
          login_id: loginId,
          credential_id: Buffer.from('only-one'),
          public_key: Buffer.from('key'),
          sign_count: 0,
          transports: null,
          aaguid: null,
          uv_seen: true,
          label: 'The only one',
          created_on_device: null,
        })
        .execute()

      const res = await h.app.request(
        '/api/v1/auth/passkeys/0f00000a-0000-4000-8000-0000000000f1',
        { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
      )
      expect(res.status).toBe(204)

      // Dropping to zero is legal (`auth-design.md` §2, §5) — the Login is
      // device-link-only, not locked out. The Device keeps working.
      expect(
        (
          await h.app.request('/api/v1/auth/me', {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(200)
    })

    it('never removes another Login’s passkey', async () => {
      const mine = await signedInDevice()
      const theirs = await signedInDevice({ suffix: 'b' })
      await db
        .insertInto('passkey')
        .values({
          id: '0f00000a-0000-4000-8000-0000000000f2',
          login_id: theirs.loginId,
          credential_id: Buffer.from('theirs'),
          public_key: Buffer.from('key'),
          sign_count: 0,
          transports: null,
          aaguid: null,
          uv_seen: true,
          label: null,
          created_on_device: null,
        })
        .execute()

      await h.app.request(
        '/api/v1/auth/passkeys/0f00000a-0000-4000-8000-0000000000f2',
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${mine.token}` },
        },
      )

      const still = await db
        .selectFrom('passkey')
        .selectAll()
        .where('id', '=', '0f00000a-0000-4000-8000-0000000000f2')
        .execute()
      expect(still).toHaveLength(1)
    })
  })

  // `final-review.md` finding 7: `invite.id`, `device.id` and `passkey.id`
  // are all `uuid` columns, so a non-UUID path param used to reach Postgres
  // and come back as a plain-text 500 where every one of these routes
  // documents 204 whether or not a row matched.
  describe('a malformed :id on a DELETE route', () => {
    it('answers 204, not a 500, for /auth/invites/:id', async () => {
      const { token } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/invites/not-a-uuid', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(204)
    })

    it('answers 204, not a 500, for /auth/devices/:id', async () => {
      const { token } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/devices/not-a-uuid', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(204)
    })

    it('answers 204, not a 500, for /auth/passkeys/:id', async () => {
      const { token } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/passkeys/not-a-uuid', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(204)
    })
  })
})
