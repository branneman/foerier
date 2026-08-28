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
})
