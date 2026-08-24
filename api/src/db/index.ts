import { Kysely, Migrator, PostgresDialect } from 'kysely'
import pg from 'pg'

import type { Database } from './schema'
import { migrationProvider } from './migrations'

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
