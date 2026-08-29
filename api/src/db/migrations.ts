import type { Migration, MigrationProvider } from 'kysely'

import * as m0001 from '../../migrations/0001_household.ts'
import * as m0002 from '../../migrations/0002_auth.ts'
import * as m0003 from '../../migrations/0003_op.ts'
import * as m0004 from '../../migrations/0004_device_links.ts'
import * as m0005 from '../../migrations/0005_disposable_household.ts'
import * as m0006 from '../../migrations/0006_login_reinvite.ts'

/**
 * Migrations are imported explicitly rather than read off disk with Kysely's
 * `FileMigrationProvider`.
 *
 * Two reasons, both load-bearing: the deployed artifact is a single bundled
 * file with no `migrations/` directory beside it, and an explicit map is
 * type-checked by `tsc --noEmit`, so a migration that does not compile fails
 * Tier 0 rather than the container's first boot.
 *
 * Keys are the migration names Kysely records; they sort lexicographically and
 * must never be renamed once deployed.
 */
const migrations: Record<string, Migration> = {
  '0001_household': m0001,
  '0002_auth': m0002,
  '0003_op': m0003,
  '0004_device_links': m0004,
  '0005_disposable_household': m0005,
  '0006_login_reinvite': m0006,
}

export const migrationProvider: MigrationProvider = {
  getMigrations: () => Promise.resolve(migrations),
}
