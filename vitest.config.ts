import { defineConfig } from 'vitest/config'

/**
 * Tiers 1, 2, 2s and 3 all run under Vitest; they are separated into projects
 * so that the tiers with different needs can be invoked independently
 * (`docs/testing.md`, "Running everything locally").
 *
 *   npm test          → shared · ui · app · api   (Tiers 1, 2, 3)
 *   npm run test:server → server                  (Tier 2s, needs Postgres)
 *
 * `server` is a separate project rather than a separate directory because it
 * exercises the same `api` code, just wired to a real database.
 */
export default defineConfig({
  test: {
    projects: [
      './shared/vitest.config.ts',
      './ui/vitest.config.ts',
      './app/vitest.config.ts',
      './api/vitest.config.ts',
      './api/vitest.server.config.ts',
    ],
  },
})
