import { serve } from '@hono/node-server'

import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createDb, migrateToLatest } from './db/index.ts'

/**
 * The container entrypoint: migrate, then serve. A container that cannot
 * bring the schema up to date never accepts a request
 * (`architecture-design.md` §5).
 */
async function main(): Promise<void> {
  const config = loadConfig()
  const db = createDb(config.databaseUrl)

  await migrateToLatest(db)

  const app = buildApp({
    gitSha: config.gitSha,
    db,
    mode:
      process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
  })

  serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
    console.log(`foerier api listening on :${port} (build ${config.gitSha})`)
  })
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
