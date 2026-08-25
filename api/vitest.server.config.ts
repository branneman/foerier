import { defineConfig } from 'vitest/config'

/**
 * Tier 2s — the real Hono application wired to a real local Postgres,
 * exercised over HTTP (`docs/testing.md`).
 *
 * Separate from the `api` project because it needs a database that the other
 * tiers deliberately do not: `npm test` must stay runnable with nothing
 * installed but Node.
 *
 * Run single-threaded, via `--no-file-parallelism` in the `test:server` script
 * rather than here: `fileParallelism` is a root-level Vitest option and is
 * silently ignored inside a project config.
 *
 * Serial matters because each test class owns a fixed `household_id` and
 * deletes its own mutable rows in setup rather than rolling back a transaction
 * (the `health` isolation model). Concurrent classes against one database let
 * one class's setup delete another's rows mid-ceremony.
 */
export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/server/**/*.test.ts'],
    // Tier 2s talks to a real database over a real socket; the default 5s is
    // tight for a cold connection pool on a first run.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
