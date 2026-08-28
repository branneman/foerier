import { systemClock, systemIdSource } from '@foerier/shared'

import { createAuthService } from '../auth/service.ts'
import { rpConfig } from '../auth/rp.ts'
import { loadConfig } from '../config.ts'
import { createDb } from '../db/index.ts'

/**
 * Households and their Logins (`auth-design.md` §5).
 *
 *   npm run admin:list
 *
 * Load-bearing rather than a convenience: `admin:invite --login <id>` cannot
 * be used without a way to find the id, and the alternative is the Maintainer
 * writing SQL against a production database to do routine recovery.
 *
 * Prints no token, no token hash, no secret hash, and no challenge (§9.4). A
 * `person_id` is an opaque UUID with no meaning to the server — the name it
 * points at lives in the op log, which this process has no view of.
 */
async function main(): Promise<void> {
  const mode =
    process.env['NODE_ENV'] === 'production' ? 'production' : 'development'
  const config = loadConfig()
  const db = createDb(config.databaseUrl)

  try {
    const service = createAuthService({
      db,
      clock: systemClock,
      ids: systemIdSource,
      rp: rpConfig(mode),
    })

    const households = await service.listHouseholds()
    if (households.length === 0) {
      console.log('No households. Run admin:bootstrap to create one.')
      return
    }

    for (const household of households) {
      console.log('')
      console.log(`${household.name}`)
      console.log(`  household_id  ${household.id}`)
      if (household.logins.length === 0) {
        console.log('  (no logins — its join invite is still outstanding)')
        continue
      }
      for (const login of household.logins) {
        console.log(
          `  login  ${login.id}  person ${login.personId}  ` +
            `${String(login.devices)} device(s)  since ${login.createdAt.toISOString().slice(0, 10)}`,
        )
      }
    }
    console.log('')
  } finally {
    await db.destroy()
  }
}

await main()
