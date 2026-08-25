import { type Kysely, sql } from 'kysely'

/**
 * The op table and the household sequence counter (`sync-protocol.md` §6.6,
 * §6.7) — the storage layer `/sync` is built on.
 *
 * `type` is `text`, never a Postgres enum. An enum would make the server's op
 * vocabulary a deploy-order dependency: a new client's new op type must be
 * storable by an older server without coordination, which is the whole point
 * of §6.2's thin server (it validates the envelope and nothing else).
 *
 * `op_id` is the primary key — that is what makes a re-push idempotent
 * (§8.1).
 *
 * `household.op_seq` is a plain counter *column*, not a Postgres `SEQUENCE`
 * (§6.6). Sequences are non-transactional: transaction A can take seq 5 and
 * commit *after* B took 6 and committed, so a client pulling in that window
 * advances its cursor past 5 and never receives it — silent, permanent,
 * undiagnosable data loss. `UPDATE household SET op_seq = op_seq + $n`
 * inside the push transaction serialises writers per household instead.
 *
 * The unique constraint on `(household_id, seq)` is also the pull index
 * (§6.4 filters by household and orders by seq); no separate index is added
 * because Postgres already backs a unique constraint with one.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('household')
    .addColumn('op_seq', 'bigint', (col) => col.notNull().defaultTo(0))
    .execute()

  await db.schema
    .createTable('op')
    .addColumn('op_id', 'uuid', (col) => col.primaryKey())
    .addColumn('household_id', 'uuid', (col) =>
      col.notNull().references('household.id').onDelete('cascade'),
    )
    .addColumn('seq', 'bigint', (col) => col.notNull())
    .addColumn('aggregate', 'text', (col) => col.notNull())
    .addColumn('aggregate_id', 'uuid', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('hlc', 'text', (col) => col.notNull())
    .addColumn('device_id', 'uuid', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('received_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('op_household_seq_unique', ['household_id', 'seq'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('op').execute()
  await db.schema.alterTable('household').dropColumn('op_seq').execute()
}
