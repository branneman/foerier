import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { migrateToLatest } from '../../src/db/index.ts'
import type { Database } from '../../src/db/schema.ts'
import * as m0003 from '../../migrations/0003_op.ts'
import { resetHouseholds, seedHousehold } from './harness.ts'
import { testDb } from './testDb.ts'

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

    expect([...byName.keys()].sort()).toEqual([
      'created_at',
      'id',
      'name',
      'op_seq',
    ])
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

/**
 * The op table and the household counter (`sync-protocol.md` §6.6, §6.7) —
 * the storage layer `/sync` is built on.
 *
 * UUID registry slots #4 and #5 (`docs/testing.md`).
 */
describe('the op table and the household counter', () => {
  const HOUSEHOLD_A = '0f000004-0000-4000-8000-000000000004'
  const HOUSEHOLD_B = '0f000005-0000-4000-8000-000000000005'

  let db: Kysely<Database>

  beforeAll(async () => {
    db = await testDb()
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await resetHouseholds(db, [HOUSEHOLD_A, HOUSEHOLD_B])
    await seedHousehold(db, { id: HOUSEHOLD_A, name: 'Veldkamp' })
    await seedHousehold(db, { id: HOUSEHOLD_B, name: 'Oosterhuis' })
  })

  function newOp(
    overrides: Partial<{
      op_id: string
      household_id: string
      seq: number
      aggregate: string
      aggregate_id: string
      type: string
      hlc: string
      device_id: string
      payload: string
    }> = {},
  ) {
    return {
      op_id: crypto.randomUUID(),
      household_id: HOUSEHOLD_A,
      seq: 1,
      aggregate: 'gear',
      aggregate_id: crypto.randomUUID(),
      type: 'gear.created',
      hlc: '2026-08-25T09:00:00.000Z-0000',
      device_id: crypto.randomUUID(),
      payload: JSON.stringify({}),
      ...overrides,
    }
  }

  it('creates the op table with op_id as its primary key', async () => {
    const columns = await sql<{
      column_name: string
      is_nullable: string
    }>`select column_name, is_nullable
         from information_schema.columns
        where table_name = 'op'`.execute(db)

    const byName = new Map(
      columns.rows.map((c) => [c.column_name, c.is_nullable]),
    )

    expect([...byName.keys()].sort()).toEqual([
      'aggregate',
      'aggregate_id',
      'device_id',
      'hlc',
      'household_id',
      'op_id',
      'payload',
      'received_at',
      'seq',
      'type',
    ])
    for (const notNullColumn of byName.keys()) {
      expect(byName.get(notNullColumn)).toBe('NO')
    }

    const pk = await sql<{
      column_name: string
    }>`select kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
        where tc.table_name = 'op'
          and tc.constraint_type = 'PRIMARY KEY'`.execute(db)

    expect(pk.rows.map((r) => r.column_name)).toEqual(['op_id'])
  })

  it('rejects a second op with the same op_id', async () => {
    const opId = crypto.randomUUID()
    await db
      .insertInto('op')
      .values(newOp({ op_id: opId, seq: 1 }))
      .execute()

    await expect(
      db
        .insertInto('op')
        .values(newOp({ op_id: opId, seq: 2 }))
        .execute(),
    ).rejects.toThrow()
  })

  it('rejects two ops sharing a seq within one household', async () => {
    await db
      .insertInto('op')
      .values(newOp({ seq: 1 }))
      .execute()

    await expect(
      db
        .insertInto('op')
        .values(newOp({ seq: 1 }))
        .execute(),
    ).rejects.toThrow()
  })

  it('allows the same seq in two different households', async () => {
    await db
      .insertInto('op')
      .values(newOp({ household_id: HOUSEHOLD_A, seq: 1 }))
      .execute()
    await db
      .insertInto('op')
      .values(newOp({ household_id: HOUSEHOLD_B, seq: 1 }))
      .execute()

    const rows = await db
      .selectFrom('op')
      .selectAll()
      .where('household_id', 'in', [HOUSEHOLD_A, HOUSEHOLD_B])
      .where('seq', '=', 1)
      .execute()

    expect(rows).toHaveLength(2)
  })

  it('defaults household.op_seq to 0', async () => {
    const household = await db
      .selectFrom('household')
      .select('op_seq')
      .where('id', '=', HOUSEHOLD_A)
      .executeTakeFirstOrThrow()

    expect(household.op_seq).toBe(0)
  })

  it('returns seq and op_seq as numbers, not strings', async () => {
    await db
      .insertInto('op')
      .values(newOp({ seq: 42 }))
      .execute()

    const op = await db
      .selectFrom('op')
      .select('seq')
      .where('household_id', '=', HOUSEHOLD_A)
      .where('seq', '=', 42)
      .executeTakeFirstOrThrow()

    const household = await db
      .selectFrom('household')
      .select('op_seq')
      .where('id', '=', HOUSEHOLD_A)
      .executeTakeFirstOrThrow()

    expect(typeof op.seq).toBe('number')
    expect(typeof household.op_seq).toBe('number')
  })

  it('round-trips a payload through jsonb without double-encoding', async () => {
    const payload = { label: 'Tent', quantity: 2, tags: ['4-season'] }

    await db
      .insertInto('op')
      .values(newOp({ payload: JSON.stringify(payload) }))
      .execute()

    const row = await db
      .selectFrom('op')
      .select('payload')
      .where('household_id', '=', HOUSEHOLD_A)
      .executeTakeFirstOrThrow()

    expect(row.payload).toEqual(payload)
    expect(typeof row.payload).not.toBe('string')
  })

  it('down() drops the op table and the op_seq column', async () => {
    // This is the one test in Tier 2s that touches a table it does not own,
    // and it does not merely read it: for the length of this test the `op`
    // table is gone for every class. That is safe only because the `server`
    // project runs in a single fork — see `api/vitest.server.config.ts`, where
    // the serialisation is enforced rather than left to a CLI flag. A class
    // running beside this one fails with `relation "op" does not exist`.
    //
    // Migration modules type their `db` parameter as `Kysely<unknown>` — see
    // `migrations/0003_op.ts` — because that is the type the migrator hands
    // them; calling one directly from a `Kysely<Database>`-typed test needs
    // the same widening.
    const rawDb = db as unknown as Kysely<unknown>
    await m0003.down(rawDb)

    const opTable = await sql<{
      table_name: string
    }>`select table_name
         from information_schema.tables
        where table_name = 'op'`.execute(db)
    expect(opTable.rows).toHaveLength(0)

    const opSeqColumn = await sql<{
      column_name: string
    }>`select column_name
         from information_schema.columns
        where table_name = 'household' and column_name = 'op_seq'`.execute(db)
    expect(opSeqColumn.rows).toHaveLength(0)

    // `foerier_test` is persistent and shared with the other Tier 2s classes,
    // and the migration-tracking table still says `0003_op` is applied. Undo
    // the drop directly (rather than through the migrator, which would skip
    // it) so the schema this class leaves behind matches what every other
    // class — and the next run of this file — expects to find.
    await m0003.up(rawDb)
  })
})
