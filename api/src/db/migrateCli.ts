import { loadConfig } from '../config.ts'
import { createDb, migrateToLatest } from './index.ts'

/**
 * `npm run migrate --workspace api`
 *
 * The container runs migrations itself on start; this exists for the local
 * `foerier_test` database, which Tier 2s needs brought up without booting a
 * server (`docs/testing.md`, Tier 2s).
 */
const config = loadConfig()
const db = createDb(config.databaseUrl)

try {
  await migrateToLatest(db)
} finally {
  await db.destroy()
}
