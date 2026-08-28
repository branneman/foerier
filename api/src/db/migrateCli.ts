import { loadConfig } from '../config.ts'
import { createDb, migrateToLatest } from './index.ts'

/**
 * `npm run migrate --workspace api`
 *
 * The container runs migrations itself on start; this exists to bring up the
 * database `loadConfig()` resolves without booting a server — locally that is
 * `foerier_dev`, the dev server's own database (`api/src/config.ts`). Tier 2s
 * does not need this: `api/test/server/testDb.ts` migrates `foerier_test`
 * itself, on first use, inside the suite.
 */
const config = loadConfig()
const db = createDb(config.databaseUrl)

try {
  await migrateToLatest(db)
} finally {
  await db.destroy()
}
