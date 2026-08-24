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
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env['DATABASE_URL'] ?? required('DATABASE_URL'),
    port: Number(env['PORT'] ?? 8080),
    // `dev` rather than a throw: a local checkout has no commit baked in, and
    // refusing to boot over it would make the server unrunnable outside Docker.
    gitSha: env['GIT_SHA'] ?? 'dev',
  }
}
