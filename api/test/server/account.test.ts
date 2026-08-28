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
 * Tier 2s — invites issued from a signed-in Device: `POST · GET · DELETE
 * /auth/invites`.
 *
 * UUID registry slot #10 (`docs/testing.md`).
 */
const HOUSEHOLD = '0f00000a-0000-4000-8000-00000000000a'

describe('account: invites', () => {
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

  /** Inserts a Login and a Device with a known token, both in HOUSEHOLD. */
  async function signedInDevice(): Promise<{ token: string; loginId: string }> {
    const loginId = systemIdSource.next()
    const personId = systemIdSource.next()
    const deviceId = systemIdSource.next()
    const { token, tokenHash } = issueDeviceToken()

    await db
      .insertInto('login')
      .values({ id: loginId, household_id: HOUSEHOLD, person_id: personId })
      .execute()

    await db
      .insertInto('device')
      .values({
        id: deviceId,
        login_id: loginId,
        household_id: HOUSEHOLD,
        token_hash: tokenHash,
        label: 'Test device',
        expires_at: nextExpiry(h.clock),
        last_seen_at: new Date(h.clock.now()),
      })
      .execute()

    return { token, loginId }
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
  })
})
