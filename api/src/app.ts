import { Hono } from 'hono'

export interface AppDeps {
  gitSha: string
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
  const app = new Hono()

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

  const v1 = app.basePath('/api/v1')

  v1.get('/version', (c) => c.json({ sha: deps.gitSha }))

  return app
}

export type App = ReturnType<typeof buildApp>
