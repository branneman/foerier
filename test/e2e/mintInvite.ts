import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://foerier:foerier@localhost:5433/foerier_test'

/**
 * Mints a fresh Household and its first join Invite by invoking the **real
 * Maintainer bootstrap script**.
 *
 * That is deliberate rather than convenient: `auth-design.md` §3.4 makes this
 * script the only way a Household's first Login is ever arranged, so if it
 * breaks the product has no front door — and a test that seeded rows directly
 * would not notice.
 *
 * Called per test rather than once for the suite, so no test depends on
 * another having run, or on the order they run in.
 */
export async function mintInvite(): Promise<{
  secret: string
  householdName: string
}> {
  const householdName = `E2E ${Date.now().toString(36)}`

  const { stdout } = await run(
    'npm',
    [
      'run',
      'admin:bootstrap',
      '--workspace',
      'api',
      '--',
      '--name',
      householdName,
    ],
    { env: { ...process.env, DATABASE_URL } },
  )

  const link = /https:\/\/app\.foerier\.app\/join#(\S+)/.exec(stdout)
  if (link?.[1] === undefined) {
    throw new Error(`bootstrap printed no join link:\n${stdout}`)
  }

  return { secret: link[1], householdName }
}
