/**
 * Every knob the server has, read from the environment once at startup.
 *
 * Deployment configuration reaches the container as environment variables and
 * nothing else — that is the whole of this app's side of the contract with
 * whatever orchestrates it.
 */
export interface Config {
  databaseUrl: string
  port: number
  /**
   * The commit SHA this image was built from, served by `GET /api/v1/version`.
   *
   * Deployables are versioned by SHA rather than semver
   * (`architecture-design.md` §7): they have no external consumer to promise
   * compatibility to, so "which build is this" is answered honestly by the
   * commit. CI polls this endpoint until it reports the SHA that was just
   * pushed, which is how a deploy is known to have landed.
   */
  gitSha: string
  /**
   * The Household `POST /test/reset` is allowed to wipe, lowercased.
   *
   * There is no separate e2e environment (§10): this is set **on the
   * production box**, by the infrastructure repo
   * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3.3), naming
   * the one disposable Household CI is allowed to wipe. Mounting a destructive
   * route in production is safe because that variable is only the first of
   * three gates — the caller's Household must also *equal* it, and must itself
   * be flagged `disposable` (§3.3, §8).
   *
   * Its absence is *not* an error: `undefined` is how the route mount decides
   * not to exist at all (§3, "Mount conditionally"), so a server that never
   * sets this variable never exposes a reset endpoint in the first place.
   */
  e2eHouseholdId: string | undefined
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/**
 * Matches `docker-compose.dev.yml`, so the commands in the readme work against
 * a fresh checkout with nothing exported.
 *
 * Applied **only outside production**. In a container `DATABASE_URL` stays
 * required and its absence is a loud failure to boot: a production server that
 * quietly fell back to a localhost database would come up healthy, serve
 * nothing, and look like a networking problem.
 *
 * **Deliberately its own database, `foerier_dev`, separate from the Tier 2s
 * database (`foerier_test`, `api/test/server/testDb.ts`).**
 * `api/test/server/migrations.test.ts` proves the `0003` migration by actually
 * dropping and recreating the `op` table — that is the correct way to prove a
 * migration, but it means every full test run against a shared database wipes
 * every op in it. A developer's own gear is real data recorded through the
 * dev server; it must not live in the database Tier 2s is allowed to destroy.
 * A fresh `docker-compose.dev.yml` volume creates `foerier_dev` itself
 * (`scripts/initdb/01-dev-database.sql`); an existing checkout needs
 * `npm run db:setup` once.
 */
export const DEV_DATABASE_URL =
  'postgres://foerier:foerier@localhost:5433/foerier_dev'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env['NODE_ENV'] === 'production'

  const e2eHouseholdId = env['E2E_HOUSEHOLD_ID']
  if (
    e2eHouseholdId !== undefined &&
    e2eHouseholdId !== '' &&
    !UUID.test(e2eHouseholdId)
  ) {
    throw new Error(`E2E_HOUSEHOLD_ID is not a UUID: ${e2eHouseholdId}`)
  }

  return {
    databaseUrl:
      env['DATABASE_URL'] ??
      (isProduction ? required('DATABASE_URL') : DEV_DATABASE_URL),
    port: Number(env['PORT'] ?? 8080),
    // `dev` rather than a throw: a local checkout has no commit baked in, and
    // refusing to boot over it would make the server unrunnable outside Docker.
    gitSha: env['GIT_SHA'] ?? 'dev',
    e2eHouseholdId:
      e2eHouseholdId === undefined || e2eHouseholdId === ''
        ? undefined
        : e2eHouseholdId.toLowerCase(),
  }
}
