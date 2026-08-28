import { parseArgs } from 'node:util'

import { systemClock, systemIdSource } from '@foerier/shared'

import { createAuthService } from '../auth/service.ts'
import { PRODUCTION_ORIGIN, rpConfig } from '../auth/rp.ts'
import { loadConfig } from '../config.ts'
import { createDb } from '../db/index.ts'

/**
 * The Maintainer's break-glass Invite (`auth-design.md` §5, §3.4).
 *
 *   npm run admin:invite -- --household <id>   a join Invite; the joiner names themselves
 *   npm run admin:invite -- --login <id>       a device link for an existing Login
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
    options: { household: { type: 'string' }, login: { type: 'string' } },
  })

  const mode =
    process.env['NODE_ENV'] === 'production' ? 'production' : 'development'
  const usage =
    mode === 'production'
      ? 'usage: node dist/invite.js (--household <id> | --login <id>)'
      : 'usage: npm run admin:invite -- (--household <id> | --login <id>)'

  const household = values.household?.trim()
  const login = values.login?.trim()

  if ((household === undefined) === (login === undefined)) {
    console.error(usage)
    console.error('exactly one of --household or --login is required')
    process.exit(2)
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
      mode === 'production' ? PRODUCTION_ORIGIN : 'http://localhost:5173'

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
    }
  } finally {
    await db.destroy()
  }
}

await main()
