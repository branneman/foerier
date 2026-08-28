import { parseArgs } from 'node:util'

import { systemClock, systemIdSource } from '@foerier/shared'

import { createAuthService } from '../auth/service.ts'
import { PRODUCTION_ORIGIN, rpConfig } from '../auth/rp.ts'
import { loadConfig } from '../config.ts'
import { createDb } from '../db/index.ts'
import { parseOriginArg, printOriginNote } from './originArg.ts'

/**
 * The Maintainer's break-glass Invite (`auth-design.md` §5, §3.4).
 *
 *   npm run admin:invite -- --household <id>   a join Invite; the joiner names themselves
 *   npm run admin:invite -- --login <id>       a device link for an existing Login
 *
 * Add `--origin <url>` to print the link against an origin other than the
 * one `NODE_ENV` derives — needed whenever the receiving device is not this
 * machine, which is the device link's entire reason to exist. See
 * `originArg.ts` for what is accepted.
 *
 * Neither is the normal path. In-app issuance is story 28 (S5) for join
 * Invites and the Account screen for device links; this exists because a
 * second Login has no route at all before S5, and because §5's "the single
 * case in this design that leaves the product" needed a mechanism rather than
 * a sentence.
 *
 * Run `npm run admin:list` to find either id.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      household: { type: 'string' },
      login: { type: 'string' },
      origin: { type: 'string' },
    },
  })

  const mode =
    process.env['NODE_ENV'] === 'production' ? 'production' : 'development'
  const usage =
    mode === 'production'
      ? 'usage: node dist/invite.js (--household <id> | --login <id>) [--origin <url>]'
      : 'usage: npm run admin:invite -- (--household <id> | --login <id>) [--origin <url>]'

  const householdArg = values.household?.trim()
  const loginArg = values.login?.trim()
  const household =
    householdArg === undefined || householdArg === '' ? undefined : householdArg
  const login = loginArg === undefined || loginArg === '' ? undefined : loginArg

  if ((household === undefined) === (login === undefined)) {
    console.error(usage)
    console.error('exactly one of --household or --login is required')
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

    const appOrigin =
      originOverride ??
      (mode === 'production' ? PRODUCTION_ORIGIN : 'http://localhost:5173')

    if (household !== undefined) {
      const { personId, secret, expiresAt } = await service.mintJoinInvite({
        householdId: household,
      })
      console.log('')
      console.log('Join invite — single use, 7 days, hand it over out of band:')
      console.log(
        `  person_id   ${personId}   (pre-bound; the joiner names themselves)`,
      )
      console.log(`  expires     ${expiresAt.toISOString()}`)
      console.log('')
      console.log(`  ${appOrigin}/join#${secret}`)
      console.log('')
      printOriginNote(appOrigin)
    } else {
      const { householdId, secret, expiresAt } = await service.mintDeviceLink({
        loginId: login as string,
      })
      console.log('')
      console.log(
        'Device link — single use, 1 hour. The link is the credential.',
      )
      console.log(`  household_id  ${householdId}`)
      console.log(`  expires       ${expiresAt.toISOString()}`)
      console.log('')
      console.log(`  ${appOrigin}/join#${secret}`)
      console.log('')
      printOriginNote(appOrigin)
    }
  } finally {
    await db.destroy()
  }
}

await main()
