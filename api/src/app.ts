import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Kysely } from 'kysely'

import {
  systemClock,
  systemIdSource,
  type Clock,
  type IdSource,
} from '@foerier/shared'

import { createAuthMiddleware, type AuthVariables } from './auth/middleware.ts'
import { createRateLimiter } from './auth/rateLimiter.ts'
import { createAuthRoutes } from './auth/routes.ts'
import { corsOrigins, rpConfig, type RpMode } from './auth/rp.ts'
import { createAuthService } from './auth/service.ts'
import type { Database } from './db/schema.ts'

export interface AppDeps {
  gitSha: string
  db?: Kysely<Database> | undefined
  clock?: Clock | undefined
  ids?: IdSource | undefined
  /** Selects the relying-party values and the CORS allowlist. */
  mode?: RpMode | undefined
  /**
   * Per-IP budget for the unauthenticated auth endpoints. Injectable so a test
   * can pick a limit that suits what it is proving — the suites exercising the
   * ceremonies raise it out of the way, and one suite lowers it to prove the
   * limiter is actually wired up.
   */
  rateLimit?: { capacity: number; refillPerMinute: number } | undefined
}

/**
 * The API surface.
 *
 * Everything hangs off `/api/v1`. The major lives in the path and is bumped
 * only for a genuine break that cannot be made compatibly
 * (`architecture-design.md` §7); old majors stay alive while old clients
 * exist, because an installed PWA may hold ops queued offline against one.
 */
export function buildApp(deps: AppDeps) {
  const {
    gitSha,
    db,
    clock = systemClock,
    ids = systemIdSource,
    mode = 'test',
    // Order of 30/min, sized to protect the box rather than to substitute for
    // the 256-bit secrets (auth-design.md §9.4).
    rateLimit = { capacity: 30, refillPerMinute: 30 },
  } = deps

  const app = new Hono<{ Variables: AuthVariables }>()

  // Baseline response hygiene for every API response (auth-design.md §8.2).
  // `no-store` in particular is not decoration: it is what makes the version
  // endpoint usable as a deploy signal, and what keeps auth traffic out of any
  // intermediary cache.
  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Cross-Origin-Resource-Policy', 'same-site')
  })

  // `app.` → `api.` is cross-origin, answered with an explicit allowlist echo
  // — never `*`, never a reflected arbitrary Origin (auth-design.md §8.3).
  //
  // `Access-Control-Allow-Credentials` is deliberately absent: there are no
  // cookies to send, so a request without a valid Authorization header is
  // anonymous no matter which page issued it. That is what makes CSRF a
  // non-issue here rather than a mitigated risk.
  app.use(
    '/api/v1/*',
    cors({
      origin: corsOrigins(mode),
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 86400,
      credentials: false,
    }),
  )

  const v1 = app.basePath('/api/v1')

  v1.get('/version', (c) => c.json({ sha: gitSha }))

  if (db !== undefined) {
    const service = createAuthService({
      db,
      clock,
      ids,
      rp: rpConfig(mode),
    })

    v1.route(
      '/auth',
      createAuthRoutes({
        service,
        requireAuth: createAuthMiddleware({ db, clock }),
        limiter: createRateLimiter({ ...rateLimit, clock }),
      }),
    )
  }

  return app
}

export type App = ReturnType<typeof buildApp>
