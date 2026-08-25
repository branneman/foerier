import type { Kysely } from 'kysely'

import { systemIdSource, type Clock } from '@foerier/shared'
import { fakeClock, type FakeClock } from '@foerier/shared/testUtils'

import { buildApp } from '../../src/app.ts'
import { generateInviteSecret } from '../../src/auth/tokens.ts'
import { inviteExpiry } from '../../src/auth/invite.ts'
import type { Database, InvitePurpose } from '../../src/db/schema.ts'
import { testDb } from './testDb.ts'

/**
 * Tier 2s harness (`docs/testing.md`).
 *
 * The clock is a fake so that expiry can be tested by advancing a year rather
 * than waiting one; everything else — the Hono app, Kysely, Postgres, the
 * ceremonies — is real.
 */

/**
 * Tier 2s runs against the **production** relying-party values on purpose. It
 * needs no browser, so exercising the real RP ID and the real origin costs
 * nothing — and it means a typo in the values that actually ship fails here
 * rather than on the box.
 */
export const TEST_ORIGIN = 'https://app.foerier.app'
export const TEST_RP_ID = 'foerier.app'

export const NOW = Date.UTC(2026, 7, 25, 9, 0, 0)

export interface Harness {
  db: Kysely<Database>
  app: ReturnType<typeof buildApp>
  clock: FakeClock
}

export async function createHarness(
  options: { rateLimit?: { capacity: number; refillPerMinute: number } } = {},
): Promise<Harness> {
  const db = await testDb()
  const clock = fakeClock(NOW)
  const app = buildApp({
    gitSha: 'test',
    db,
    clock,
    ids: systemIdSource,
    mode: 'test',
    // Effectively off by default. Suites here share one process, one frozen
    // clock, and one `unknown` client key, so the production budget would be
    // spent by the third test and every later failure would say 429 instead of
    // what actually broke. `rateLimiter.test.ts` proves the algorithm and
    // `rateLimit.test.ts` proves it is wired to the routes.
    rateLimit: options.rateLimit ?? {
      capacity: 10_000,
      refillPerMinute: 10_000,
    },
  })

  return { db, app, clock }
}

/**
 * Deletes everything belonging to the households this test class owns.
 *
 * Mutable rows are removed in setup rather than rolled back in a transaction,
 * so the suite behaves the same against the persistent `foerier_test` database
 * it will actually be run against (the `health` isolation model).
 */
export async function resetHouseholds(
  db: Kysely<Database>,
  householdIds: string[],
): Promise<void> {
  // `login`, `device` and `invite` all cascade from `household`.
  await db.deleteFrom('household').where('id', 'in', householdIds).execute()

  // `webauthn_challenge` is deliberately NOT cleared. It is the one table not
  // owned by a household — challenges exist before a Login does — so wiping it
  // is a cross-suite side effect that pulls the rug from under any ceremony
  // running in another file. Challenges are single-use and expire in five
  // minutes; the service prunes them lazily on write.
}

export async function seedHousehold(
  db: Kysely<Database>,
  { id, name }: { id: string; name: string },
): Promise<void> {
  await db.insertInto('household').values({ id, name }).execute()
}

export interface SeededInvite {
  /** The plaintext that would travel in the URL fragment. */
  secret: string
  inviteId: string
  personId: string
}

export async function seedInvite(
  db: Kysely<Database>,
  {
    householdId,
    purpose = 'join',
    clock,
    expiresAt,
  }: {
    householdId: string
    purpose?: InvitePurpose
    clock: Clock
    expiresAt?: Date
  },
): Promise<SeededInvite> {
  const { secret, secretHash } = generateInviteSecret()
  const inviteId = systemIdSource.next()
  const personId = systemIdSource.next()

  await db
    .insertInto('invite')
    .values({
      id: inviteId,
      household_id: householdId,
      person_id: personId,
      purpose,
      secret_hash: secretHash,
      login_id: null,
      created_by_login: null,
      expires_at: expiresAt ?? inviteExpiry(purpose, clock),
    })
    .execute()

  return { secret, inviteId, personId }
}

/**
 * `Response.json()` is typed `unknown`, correctly — a network payload is not
 * a promise about its own shape. Tests assert on it immediately, so the cast
 * is confined here rather than sprinkled through every expectation.
 */
export async function jsonOf<T = Record<string, string>>(
  res: Response,
): Promise<T> {
  return (await res.json()) as T
}
