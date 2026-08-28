import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Database } from '../../src/db/schema.ts'
import { AuthError } from '../../src/auth/service.ts'
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

/**
 * A second, unrelated Household — used only to construct a device Invite
 * whose `household_id` disagrees with its Login's (`final-review.md` finding
 * 9). UUID registry slot #11 (`docs/testing.md`).
 */
const OTHER_HOUSEHOLD = '0f00000b-0000-4000-8000-00000000000b'

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
    await resetHouseholds(db, [HOUSEHOLD, OTHER_HOUSEHOLD])
    await seedHousehold(db, { id: HOUSEHOLD, name: 'Veldkamp' })
    await seedHousehold(db, { id: OTHER_HOUSEHOLD, name: 'Bakker' })
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

      // No Passkey verified this Device, so there is none to record — and
      // none for `/test/reset` to spare
      // (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3).
      const claimed = await db
        .selectFrom('device')
        .select('passkey_id')
        .where('id', '=', body.device_id)
        .executeTakeFirstOrThrow()
      expect(claimed.passkey_id).toBeNull()
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

    // `final-review.md` finding 9: nothing today mints an Invite whose
    // `household_id` disagrees with its Login's, so this was safe only by
    // accident — `requireAuth` reads `householdId` off `device` and
    // `loginId`/`personId` off the joined `login` (`middleware.ts`), so a
    // mismatched pair would otherwise mint an auth context split across two
    // households.
    it("refuses a device Invite whose household disagrees with its Login's", async () => {
      await seedLoginHere()
      const { secret } = await seedInvite(db, {
        householdId: OTHER_HOUSEHOLD,
        purpose: 'device',
        clock: h.clock,
        loginId: LOGIN,
      })

      expect((await claim(secret)).status).toBe(401)

      const devices = await db
        .selectFrom('device')
        .selectAll()
        .where('login_id', '=', LOGIN)
        .execute()
      expect(devices).toHaveLength(0)
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

  describe('the Maintainer scripts', () => {
    const LOGIN = '0f000009-0000-4000-8000-0000000090c1'
    const PERSON = '0f000009-0000-4000-8000-0000000090c2'

    it('mints a join Invite into an existing Household, with person_recorded false', async () => {
      const service = h.service
      const { secret, personId } = await service.mintJoinInvite({
        householdId: HOUSEHOLD,
      })

      expect(personId).toMatch(/^[0-9a-f-]{36}$/)

      const res = await h.app.request('/api/v1/auth/join/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })
      expect(await jsonOf(res)).toMatchObject({
        household_name: 'Veldkamp',
        person_recorded: false,
        purpose: 'join',
      })
    })

    it('mints a device link for an existing Login', async () => {
      await db
        .insertInto('login')
        .values({ id: LOGIN, household_id: HOUSEHOLD, person_id: PERSON })
        .execute()

      const { secret, householdId } = await h.service.mintDeviceLink({
        loginId: LOGIN,
      })
      expect(householdId).toBe(HOUSEHOLD)

      const res = await h.app.request('/api/v1/auth/device/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })
      expect(await jsonOf(res)).toMatchObject({ login_id: LOGIN })
    })

    it('lists Households with their Logins and Device counts', async () => {
      await db
        .insertInto('login')
        .values({ id: LOGIN, household_id: HOUSEHOLD, person_id: PERSON })
        .execute()

      const households = await h.service.listHouseholds()
      const mine = households.find((row) => row.id === HOUSEHOLD)
      expect(mine?.name).toBe('Veldkamp')
      expect(mine?.logins).toEqual([
        expect.objectContaining({ id: LOGIN, personId: PERSON, devices: 0 }),
      ])
    })

    it('refuses to mint a join Invite into an unknown Household', async () => {
      await expect(
        h.service.mintJoinInvite({
          householdId: '0f000009-0000-4000-8000-0000000090c8',
        }),
      ).rejects.toThrow(AuthError)
    })

    it('refuses to mint a device link for an unknown Login', async () => {
      await expect(
        h.service.mintDeviceLink({
          loginId: '0f000009-0000-4000-8000-0000000090c9',
        }),
      ).rejects.toThrow(AuthError)
    })

    /**
     * The case that carries real weight: a link minted for a disabled Login
     * looks fine and then 401s on first use, which reads to the operator as
     * "claim is broken" rather than "Login is disabled". Refusing at mint
     * time, and leaving no Invite row behind for it, is what makes that
     * failure legible instead.
     */
    it('refuses to mint a device link for a disabled Login, and writes no invite row', async () => {
      await db
        .insertInto('login')
        .values({ id: LOGIN, household_id: HOUSEHOLD, person_id: PERSON })
        .execute()
      await db
        .updateTable('login')
        .set({ disabled_at: new Date(h.clock.now()) })
        .where('id', '=', LOGIN)
        .execute()

      await expect(
        h.service.mintDeviceLink({ loginId: LOGIN }),
      ).rejects.toThrow(AuthError)

      const invites = await db
        .selectFrom('invite')
        .selectAll()
        .where('login_id', '=', LOGIN)
        .execute()
      expect(invites).toHaveLength(0)
    })
  })
})
