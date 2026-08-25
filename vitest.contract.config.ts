import { defineConfig } from 'vitest/config'

/**
 * Tier 4 — contract tests against the **real deployed server**
 * (`docs/testing.md`). A root-level config rather than a workspace one,
 * because the subject is a deployment, not a package: these tests import no
 * application code and would pass or fail identically against a build from
 * any commit.
 *
 *   npm run test:contract
 *
 * Not in `vitest.config.ts`'s project list: `npm test` must stay runnable with
 * nothing installed but Node, and this tier needs the internet and a box.
 */
export default defineConfig({
  test: {
    name: 'contract',
    environment: 'node',
    include: ['test/contract/**/*.test.ts'],
    // Every assertion is a real request over the public internet to Helsinki.
    testTimeout: 30_000,
  },
})
