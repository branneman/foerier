import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migrateToLatest } from '../../src/db/index'
import type { Database } from '../../src/db/schema'
import { testDb } from './testDb'

/**
 * The migration runner is what the container entrypoint calls before it serves
 * a single request, so a failure here is a failure to boot. It earns a Tier 2s
 * test rather than a unit test because the thing that can actually go wrong —
 * SQL Postgres rejects, a migration that is not idempotent across restarts —
 * is invisible without a real database.
 */
describe('migrations', () => {
  let db: Kysely<Database>

  beforeAll(async () => {
    db = await testDb()
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('creates the household table', async () => {
    const columns = await sql<{
      column_name: string
      is_nullable: string
    }>`select column_name, is_nullable
         from information_schema.columns
        where table_name = 'household'`.execute(db)

    const byName = new Map(
      columns.rows.map((c) => [c.column_name, c.is_nullable]),
    )

    expect([...byName.keys()].sort()).toEqual(['created_at', 'id', 'name'])
    expect(byName.get('name')).toBe('NO')
    expect(byName.get('created_at')).toBe('NO')
  })

  it('is a no-op when every migration has already run', async () => {
    // Containers restart, and Watchtower restarts them on every deploy. A
    // migration set that only survives a first run would take the service down
    // on the second one.
    await expect(migrateToLatest(db)).resolves.toBeUndefined()
  })
})
