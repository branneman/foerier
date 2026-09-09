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
  /**
   * The unauthenticated auth endpoints' per-IP token bucket
   * ([auth-design §9.4](../../docs/auth-design.md)), from
   * `AUTH_RATE_LIMIT_CAPACITY` and `AUTH_RATE_LIMIT_PER_MINUTE`.
   *
   * **A size, not a rule.** The bucket exists to protect the box, never to
   * substitute for the 256-bit secrets — there is nothing in one to
   * brute-force — so what number it holds is deployment configuration in
   * exactly the way `PORT` is, and the arithmetic that spends it is pinned by
   * `api/test/server/rateLimit.test.ts` at whatever size it is given.
   *
   * The reason it is a variable at all is Tier 5. `clientKey` reads the
   * `X-Forwarded-For` Caddy sets, and a local e2e run has no Caddy, so every
   * request in it falls into the one `unknown` bucket the fallback names — the
   * whole suite arrives as a single caller. Measured on 2026-09-09: eleven
   * specs spend 35 tokens in about 27 seconds against a budget of roughly 42,
   * and CI went red when that margin ran out (a `429` on the joiner's
   * `POST /auth/register/options`, the join screen falling to the
   * compatibility path with `Something went wrong. Ask for a new link.`, and
   * two retries spending more of the same bucket). Raising a header from the
   * browser instead was tried and cannot work: a request header the app does
   * not send today makes every call preflighted, and CORS `allowHeaders` is
   * `Authorization, Content-Type`.
   */
  authRateLimit: { capacity: number; refillPerMinute: number }
}

/** `auth-design.md` §9.4's own numbers, and the production default. */
const AUTH_RATE_LIMIT_DEFAULT = { capacity: 30, refillPerMinute: 30 }

function positiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} is not a positive integer: ${raw}`)
  }
  return value
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
    authRateLimit: {
      capacity: positiveInt(
        env,
        'AUTH_RATE_LIMIT_CAPACITY',
        AUTH_RATE_LIMIT_DEFAULT.capacity,
      ),
      refillPerMinute: positiveInt(
        env,
        'AUTH_RATE_LIMIT_PER_MINUTE',
        AUTH_RATE_LIMIT_DEFAULT.refillPerMinute,
      ),
    },
  }
}
