import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { migrateToLatest } from '../../src/db/index.ts'
import type { Database } from '../../src/db/schema.ts'
import * as m0003 from '../../migrations/0003_op.ts'
import * as m0004 from '../../migrations/0004_device_links.ts'
import * as m0005 from '../../migrations/0005_disposable_household.ts'
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
      'disposable',
      'id',
      'name',
      'op_seq',
    ])
    expect(byName.get('name')).toBe('NO')
    expect(byName.get('created_at')).toBe('NO')
    expect(byName.get('disposable')).toBe('NO')
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

  /**
   * The defect `0006_login_reinvite` exists for. A revoked Login keeps its
   * row — deleting it would take its Passkeys and Devices with it — so a
   * plain unique constraint on (household_id, person_id) would mean a
   * revoked Person can never hold a Login again. Story 28 says "at most one
   * Login", not "at most one ever".
   */
  it('lets a Person hold a new Login after the old one is disabled', async () => {
    const personId = '0f000004-0000-4000-8000-0000000040f1'

    await db
      .insertInto('login')
      .values({
        id: '0f000004-0000-4000-8000-0000000040f2',
        household_id: HOUSEHOLD_A,
        person_id: personId,
        disabled_at: new Date(Date.UTC(2026, 7, 25, 9, 0, 0)),
      })
      .execute()

    await expect(
      db
        .insertInto('login')
        .values({
          id: '0f000004-0000-4000-8000-0000000040f3',
          household_id: HOUSEHOLD_A,
          person_id: personId,
        })
        .execute(),
    ).resolves.toBeDefined()
  })

  it('still refuses two ACTIVE Logins for one Person', async () => {
    const personId = '0f000004-0000-4000-8000-0000000040f4'

    await db
      .insertInto('login')
      .values({
        id: '0f000004-0000-4000-8000-0000000040f5',
        household_id: HOUSEHOLD_A,
        person_id: personId,
      })
      .execute()

    await expect(
      db
        .insertInto('login')
        .values({
          id: '0f000004-0000-4000-8000-0000000040f6',
          household_id: HOUSEHOLD_A,
          person_id: personId,
        })
        .execute(),
    ).rejects.toThrow()
  })
})

/**
 * `0005` — `household.disposable` and `device.passkey_id`
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §12). Both
 * columns are purely additive against empty tables, so — unlike `0004`'s
 * backfill above — this only has to prove the shape: the default, the
 * nullability, and the `on delete set null` behaviour the reset endpoint
 * relies on to tolerate a Device that signed in before this migration ran.
 */
describe('0005 (household.disposable and device.passkey_id)', () => {
  let db: Kysely<Database>

  beforeAll(async () => {
    db = await testDb()
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('0005 adds household.disposable (default false) and device.passkey_id (nullable, set null on delete)', async () => {
    await migrateToLatest(db)
    const cols = await sql<{
      table_name: string
      column_name: string
      column_default: string | null
      is_nullable: string
    }>`
      select table_name, column_name, column_default, is_nullable
        from information_schema.columns
       where (table_name, column_name) in (('household','disposable'), ('device','passkey_id'))
    `.execute(db)
    expect(cols.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table_name: 'household',
          column_name: 'disposable',
          column_default: 'false',
          is_nullable: 'NO',
        }),
        expect.objectContaining({
          table_name: 'device',
          column_name: 'passkey_id',
          is_nullable: 'YES',
        }),
      ]),
    )
    const fk = await sql<{ delete_rule: string }>`
      select rc.delete_rule from information_schema.referential_constraints rc
        join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
       where tc.table_name = 'device' and tc.constraint_name like '%passkey_id%'
    `.execute(db)
    expect(fk.rows[0]?.delete_rule).toBe('SET NULL')
  })

  it('0005 rolls back cleanly', async () => {
    await migrateToLatest(db)
    await m0005.down(db as unknown as Kysely<unknown>)
    const cols = await sql<{ column_name: string }>`
      select column_name from information_schema.columns
       where (table_name, column_name) in (('household','disposable'), ('device','passkey_id'))
    `.execute(db)
    expect(cols.rows).toEqual([])
    await m0005.up(db as unknown as Kysely<unknown>)
  })
})

/**
 * `0004`'s `person_recorded` backfill, and its `up()`/`down()` round-trip.
 *
 * This is the one migration whose `up()` does real work against existing
 * rows rather than merely shaping an empty table: the backfill runs exactly
 * once, against whatever `invite` rows already exist, and reproduces the
 * `anyLogin` derivation `previewInvite` used to compute inline. A test that
 * runs `0004` fresh against an empty `invite` table (which is what simply
 * relying on the migrator having already run would do) proves nothing — the
 * backfill's `update ... where person_recorded is null` would match zero
 * rows and pass vacuously either way. So this test seeds rows in the
 * pre-`0004` shape by calling `down()` first, straddling the backfill's
 * condition (one household with a Login, one without), and only then calls
 * `up()` and inspects what it did.
 *
 * UUID registry slots #4 and #5 (`docs/testing.md`) — the same two
 * households `the op table and the household counter` above uses; this
 * describe block does not add a new slot.
 */
describe('the person_recorded backfill (0004)', () => {
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

  it('reproduces the anyLogin derivation exactly, and down()/up() round-trip both columns', async () => {
    // Widening to the type the migrator actually hands a migration module —
    // see the `op` table's down()/up() test above for why.
    const rawDb = db as unknown as Kysely<unknown>

    // Household B has a Login already; household A does not. This is exactly
    // the distinction the deleted `anyLogin` query in `previewInvite` used to
    // read, and it is what the backfill has to reproduce.
    await db
      .insertInto('login')
      .values({
        id: crypto.randomUUID(),
        household_id: HOUSEHOLD_B,
        person_id: crypto.randomUUID(),
      })
      .execute()

    // Drop 0004's columns so the invite rows below land in the pre-0004
    // shape — the shape every Invite outstanding at a real deploy is in.
    await m0004.down(rawDb)

    const inviteA = crypto.randomUUID()
    const inviteB = crypto.randomUUID()
    const expiresAt = new Date(Date.UTC(2026, 8, 1))

    // Raw SQL, not `db.insertInto('invite')`: the Kysely-typed schema still
    // declares `person_recorded` as a required insert column, but the actual
    // table — mid-`down()` — does not have it yet.
    await sql`
      insert into invite (id, household_id, person_id, purpose, secret_hash, expires_at)
      values (${inviteA}, ${HOUSEHOLD_A}, ${crypto.randomUUID()}, 'join', ${Buffer.from(crypto.randomUUID())}, ${expiresAt})
    `.execute(db)
    await sql`
      insert into invite (id, household_id, person_id, purpose, secret_hash, expires_at)
      values (${inviteB}, ${HOUSEHOLD_B}, ${crypto.randomUUID()}, 'join', ${Buffer.from(crypto.randomUUID())}, ${expiresAt})
    `.execute(db)

    // The backfill under test.
    await m0004.up(rawDb)

    const rows = await db
      .selectFrom('invite')
      .select(['id', 'person_recorded'])
      .where('id', 'in', [inviteA, inviteB])
      .execute()
    const recordedById = new Map(rows.map((r) => [r.id, r.person_recorded]))

    expect(recordedById.get(inviteA)).toBe(false)
    expect(recordedById.get(inviteB)).toBe(true)

    // down() removes both columns...
    await m0004.down(rawDb)

    const afterDown = await sql<{
      table_name: string
      column_name: string
    }>`
      select table_name, column_name
        from information_schema.columns
       where (table_name = 'invite' and column_name = 'person_recorded')
          or (table_name = 'passkey' and column_name = 'created_on_device')
    `.execute(db)
    expect(afterDown.rows).toHaveLength(0)

    // ...and up() restores them — nullable then backfilled then NOT NULL for
    // `invite.person_recorded`, nullable throughout for
    // `passkey.created_on_device` — leaving the schema every other Tier 2s
    // class, and the next run of this file, expects to find.
    await m0004.up(rawDb)

    const afterUp = await sql<{
      table_name: string
      column_name: string
      is_nullable: string
    }>`
      select table_name, column_name, is_nullable
        from information_schema.columns
       where (table_name = 'invite' and column_name = 'person_recorded')
          or (table_name = 'passkey' and column_name = 'created_on_device')
    `.execute(db)
    const nullableByColumn = new Map(
      afterUp.rows.map((r) => [r.column_name, r.is_nullable]),
    )

    expect(nullableByColumn.get('person_recorded')).toBe('NO')
    expect(nullableByColumn.get('created_on_device')).toBe('YES')
  })
})
