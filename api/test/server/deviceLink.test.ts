import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Database } from '../../src/db/schema.ts'
import {
  createHarness,
  jsonOf,
  resetHouseholds,
  seedHousehold,
  seedInvite,
  type Harness,
} from './harness.ts'

/**
 * Tier 2s — the token-only path and the Invite fact that makes a second
 * joiner possible.
 *
 * UUID registry slot #9 (`docs/testing.md`).
 */
const HOUSEHOLD = '0f000009-0000-4000-8000-000000000009'

describe('device links', () => {
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

  describe('person_recorded is recorded, not guessed', () => {
    it('says false for an invite minted for a Person who does not exist yet', async () => {
      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
        personRecorded: false,
      })

      const res = await h.app.request('/api/v1/auth/join/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })

      expect(res.status).toBe(200)
      expect(await jsonOf(res)).toMatchObject({ person_recorded: false })
    })

    /**
     * The defect this column exists for. The old derivation — "does this
     * Household have any Login" — is exactly right for the first joiner and
     * exactly wrong for the second, who would get no name field and a Login
     * pointing at a Person nobody ever recorded.
     */
    it('still says false for the SECOND joiner, though a Login already exists', async () => {
      await db
        .insertInto('login')
        .values({
          id: '0f000009-0000-4000-8000-0000000090a1',
          household_id: HOUSEHOLD,
          person_id: '0f000009-0000-4000-8000-0000000090a2',
        })
        .execute()

      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
        personRecorded: false,
      })

      const res = await h.app.request('/api/v1/auth/join/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })

      expect(await jsonOf(res)).toMatchObject({ person_recorded: false })
    })

    it('says true for an invite issued against a Person already recorded', async () => {
      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
        personRecorded: true,
      })

      const res = await h.app.request('/api/v1/auth/join/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })

      expect(await jsonOf(res)).toMatchObject({ person_recorded: true })
    })
  })

  describe('POST /auth/device/claim', () => {
    const LOGIN = '0f000009-0000-4000-8000-0000000090b1'
    const PERSON = '0f000009-0000-4000-8000-0000000090b2'

    async function seedLoginHere() {
      await db
        .insertInto('login')
        .values({ id: LOGIN, household_id: HOUSEHOLD, person_id: PERSON })
        .execute()
    }

    function claim(secret: string) {
      return h.app.request('/api/v1/auth/device/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })
    }

    it('signs an existing Login in on a new Device, creating no Passkey', async () => {
      await seedLoginHere()
      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        purpose: 'device',
        clock: h.clock,
        loginId: LOGIN,
      })

      const res = await claim(secret)
      expect(res.status).toBe(200)

      const body = await jsonOf<{
        token: string
        login_id: string
        person_id: string
        household_id: string
        device_id: string
      }>(res)
      expect(body.login_id).toBe(LOGIN)
      expect(body.person_id).toBe(PERSON)
      expect(body.household_id).toBe(HOUSEHOLD)
      expect(body.token.startsWith('foe_')).toBe(true)

      const passkeys = await db
        .selectFrom('passkey')
        .selectAll()
        .where('login_id', '=', LOGIN)
        .execute()
      expect(passkeys).toHaveLength(0)
    })

    it('creates the Login first when the Invite is a join, still with no Passkey', async () => {
      const { secret, personId } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
        personRecorded: false,
      })

      const res = await claim(secret)
      expect(res.status).toBe(200)
      expect(await jsonOf(res)).toMatchObject({ person_id: personId })

      const logins = await db
        .selectFrom('login')
        .selectAll()
        .where('household_id', '=', HOUSEHOLD)
        .execute()
      expect(logins).toHaveLength(1)

      const passkeys = await db
        .selectFrom('passkey')
        .innerJoin('login', 'login.id', 'passkey.login_id')
        .selectAll('passkey')
        .where('login.household_id', '=', HOUSEHOLD)
        .execute()
      expect(passkeys).toHaveLength(0)
    })

    it('refuses a second use of the same link', async () => {
      await seedLoginHere()
      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        purpose: 'device',
        clock: h.clock,
        loginId: LOGIN,
      })

      expect((await claim(secret)).status).toBe(200)
      expect((await claim(secret)).status).toBe(401)

      const devices = await db
        .selectFrom('device')
        .selectAll()
        .where('household_id', '=', HOUSEHOLD)
        .execute()
      expect(devices).toHaveLength(1)
    })

    it('refuses an expired link', async () => {
      await seedLoginHere()
      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        purpose: 'device',
        clock: h.clock,
        loginId: LOGIN,
      })

      // Device Invites last an hour (`auth-design.md` §3.1).
      h.clock.advance(61 * 60 * 1000)
      expect((await claim(secret)).status).toBe(401)
    })

    it('refuses a link whose Login has been disabled', async () => {
      await seedLoginHere()
      await db
        .updateTable('login')
        .set({ disabled_at: new Date(h.clock.now()) })
        .where('id', '=', LOGIN)
        .execute()

      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        purpose: 'device',
        clock: h.clock,
        loginId: LOGIN,
      })

      expect((await claim(secret)).status).toBe(401)
    })

    it('answers 400 for a body with no secret, and consumes nothing', async () => {
      const res = await h.app.request('/api/v1/auth/device/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })
  })
})
