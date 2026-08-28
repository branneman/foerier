import { parseArgs } from 'node:util'

import { systemClock, systemIdSource } from '@foerier/shared'

import { createAuthService } from '../auth/service.ts'
import { PRODUCTION_ORIGIN, rpConfig } from '../auth/rp.ts'
import { loadConfig } from '../config.ts'
import { createDb } from '../db/index.ts'
import { parseOriginArg, printOriginNote } from './originArg.ts'

/**
 * The Maintainer bootstrap (`auth-design.md` §3.4).
 *
 *   npm run admin:bootstrap -- --name "Veldkamp"                    (local)
 *   node dist/bootstrap.js --name "Veldkamp"                        (in the api image)
 *   npm run admin:bootstrap -- --name "Veldkamp" --origin <url>     (a different device)
 *
 * The first two are not interchangeable, and which one you are running
 * decides which origin the join link carries by default — see the note on
 * `appOrigin` below. `--origin` overrides that default outright, for the
 * household member's device joining is being handed to is not this machine
 * either; see `originArg.ts` for what is accepted.
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
    options: { name: { type: 'string' }, origin: { type: 'string' } },
  })

  const mode =
    process.env['NODE_ENV'] === 'production' ? 'production' : 'development'
  const usage =
    mode === 'production'
      ? 'usage: node dist/bootstrap.js --name "Veldkamp" [--origin <url>]'
      : 'usage: npm run admin:bootstrap -- --name "Veldkamp" [--origin <url>]'

  const name = values.name?.trim()
  if (name === undefined || name === '') {
    // Describes the invocation for the environment this run is actually in.
    // Locally that is an npm script; in the image it is the bundled
    // entrypoint, and the two are not interchangeable — printing the local
    // form to someone inside the container is how a Household ends up in the
    // wrong database, or a link against the wrong origin.
    console.error(usage)
    process.exit(2)
  }

  const originArg = values.origin?.trim()
  let originOverride: string | undefined
  if (originArg !== undefined && originArg !== '') {
    try {
      originOverride = parseOriginArg(originArg)
    } catch (error) {
      console.error(usage)
      console.error(
        `--origin ${error instanceof Error ? error.message : String(error)}`,
      )
      process.exit(2)
    }
  }

  const config = loadConfig()
  const db = createDb(config.databaseUrl)

  try {
    const service = createAuthService({
      db,
      clock: systemClock,
      ids: systemIdSource,
      rp: rpConfig(mode),
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
    // Printed against the origin this run actually targets, `--origin`
    // overriding that when given. A production link handed to someone on a
    // laptop running `npm run dev` is a link that cannot work, and the
    // failure — a passkey ceremony refused by the browser for an RP ID
    // mismatch — reads as a bug rather than as a wrong URL.
    const appOrigin =
      originOverride ??
      (mode === 'production' ? PRODUCTION_ORIGIN : 'http://localhost:5173')

    console.log('Join link — single use, hand it over out of band:')
    console.log('')
    console.log(`  ${appOrigin}/join#${secret}`)
    console.log('')
    printOriginNote(appOrigin)
  } finally {
    await db.destroy()
  }
}

await main()
