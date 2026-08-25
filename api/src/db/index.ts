import { Kysely, Migrator, PostgresDialect } from 'kysely'
import pg from 'pg'

import type { Database } from './schema.ts'
import { migrationProvider } from './migrations.ts'

// `bigint` (OID 20) arrives as a string, because a Postgres bigint can exceed
// Number.MAX_SAFE_INTEGER. Every bigint column foerier has — the WebAuthn
// signature counter, and `op.seq` / `household.op_seq` (`sync-protocol.md`
// §6.6) — is comfortably safe as a `number`, and comparing any of them as a
// string would silently break: a counter's "must increase" check ('9' >
// '10'), and a seq's ordering and cursor comparisons alike. One parser,
// installed once here, covers every table rather than each call site
// re-deriving it.
pg.types.setTypeParser(20, (value) => Number(value))

export function createDb(databaseUrl: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: databaseUrl }),
    }),
  })
}

/**
 * Runs every pending migration, in order, and throws on the first failure.
 *
 * Called from the container entrypoint before the server starts serving
 * (`architecture-design.md` §5), so a container that cannot migrate never
 * accepts a request. Kysely takes a lock for the duration, so two containers
 * starting at once cannot both apply the same migration.
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error, results } = await migrator.migrateToLatest()

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`migration applied: ${result.migrationName}`)
    } else if (result.status === 'Error') {
      console.error(`migration failed: ${result.migrationName}`)
    }
  }

  if (error !== undefined) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}
