import { defineConfig } from 'vitest/config'

/**
 * Tier 2s — the real Hono application wired to a real local Postgres,
 * exercised over HTTP (`docs/testing.md`).
 *
 * Separate from the `api` project because it needs a database that the other
 * tiers deliberately do not: `npm test` must stay runnable with nothing
 * installed but Node.
 *
 * **The single fork below is a correctness requirement, not a tuning knob.**
 * Each test class owns a fixed `household_id` and deletes its own mutable rows
 * in setup rather than rolling back a transaction (the `health` isolation
 * model), so concurrent classes against one database let one class's setup
 * delete another's rows mid-ceremony. Worse, `migrations.test.ts` proves
 * `0003_op.down()` by actually dropping the `op` table and re-creating it, so
 * a class running beside it sees `relation "op" does not exist` — a failure
 * that lands on whichever test happened to be in flight.
 *
 * This is enforced here, in the project config, because `fileParallelism` is a
 * root-level Vitest option that is silently ignored inside one: it only takes
 * effect as `--no-file-parallelism` on the command line, which protects
 * `npm run test:server` and nothing else. `npx vitest run api/test/server/` is
 * an entirely ordinary thing to type and used to run the five files in five
 * workers. `poolOptions` *is* honoured per project, so `singleFork` makes the
 * serialisation a property of the suite rather than of how it was invoked.
 */
export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/server/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // Tier 2s talks to a real database over a real socket; the default 5s is
    // tight for a cold connection pool on a first run.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
