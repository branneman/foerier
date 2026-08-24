import { type Kysely, sql } from 'kysely'

/**
 * The tenancy root.
 *
 * `household_id` scopes every op and every row in foerier
 * (`architecture-design.md` §5); it is the boundary the product would be sold
 * along, and the one the multi-household isolation test exists to protect. It
 * belongs to no single slice, which is why it lands with the skeleton rather
 * than with the auth tables that reference it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('household')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('household').execute()
}
