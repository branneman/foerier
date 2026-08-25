import { parseArgs } from 'node:util'

import { systemClock, systemIdSource } from '@foerier/shared'

import { createAuthService } from '../auth/service.ts'
import { rpConfig } from '../auth/rp.ts'
import { loadConfig } from '../config.ts'
import { createDb } from '../db/index.ts'

/**
 * The Maintainer bootstrap (`auth-design.md` §3.4).
 *
 *   npm run admin:bootstrap --workspace api -- --name "Veldkamp"
 *
 * Only the **first** Login of a brand-new Household is arranged out of band.
 * Every Invite after that is issued by a Quartermaster from inside the app,
 * which is what keeps account management out of the Maintainer's inbox.
 *
 * The Maintainer is not a role in the product — it is whoever has server
 * access — which is why this is a script rather than an endpoint. There is no
 * open registration endpoint anywhere, so there is no bot surface to
 * rate-limit into safety.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { name: { type: 'string' } },
  })

  const name = values.name?.trim()
  if (name === undefined || name === '') {
    console.error(
      'usage: npm run admin:bootstrap --workspace api -- --name "Veldkamp"',
    )
    process.exit(2)
  }

  const config = loadConfig()
  const db = createDb(config.databaseUrl)

  try {
    const service = createAuthService({
      db,
      clock: systemClock,
      ids: systemIdSource,
      rp: rpConfig(
        process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
      ),
    })

    const { householdId, personId, secret, expiresAt } =
      await service.bootstrapHousehold({ name })

    // The secret lives in the URL **fragment**: a fragment is never sent to a
    // server, so it stays out of Caddy's access log, out of any intermediary's
    // log, and out of the Referer header on any later navigation (§3.2).
    console.log('')
    console.log(`Household "${name}" created.`)
    console.log(`  household_id  ${householdId}`)
    console.log(
      `  person_id     ${personId}   (pre-bound; the joiner names themselves)`,
    )
    console.log(`  expires       ${expiresAt.toISOString()}`)
    console.log('')
    console.log('Join link — single use, hand it over out of band:')
    console.log('')
    console.log(`  https://app.foerier.app/join#${secret}`)
    console.log('')
  } finally {
    await db.destroy()
  }
}

await main()
