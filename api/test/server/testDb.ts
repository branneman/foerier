import type { Kysely } from 'kysely'

import { createDb, migrateToLatest } from '../../src/db/index.ts'
import type { Database } from '../../src/db/schema.ts'

/**
 * The Tier 2s database: a real, persistent local Postgres, not a container
 * spun up per run (`docs/testing.md`, Tier 2s).
 *
 * Persistent is the deliberate choice inherited from `health`: it makes the
 * isolation model — every test class owning a fixed `household_id` and
 * deleting its own mutable rows in setup — the thing under test, rather than
 * something a fresh database hides. A suite that only passes against an empty
 * database is not proving tenant isolation.
 */
export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://foerier:foerier@localhost:5433/foerier_test'

let migrated = false

export async function testDb(): Promise<Kysely<Database>> {
  const db = createDb(TEST_DATABASE_URL)
  if (!migrated) {
    await migrateToLatest(db)
    migrated = true
  }
  return db
}
