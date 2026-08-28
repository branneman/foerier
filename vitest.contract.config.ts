import { defineConfig } from 'vitest/config'

/**
 * Tier 4 — contract tests against the **real deployed server**
 * (`docs/testing.md`). A root-level config rather than a workspace one,
 * because the subject is a deployment, not a package: these tests exercise no
 * application code and would pass or fail identically against a build from
 * any commit. What they *import* from the workspaces is only what a client
 * would have to reimplement otherwise — a UUIDv7 source, and Tier 2s's
 * software WebAuthn authenticator, which mints the Device token
 * (`test/contract/signIn.ts`).
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
    // One Household, one writer. `household.test.ts` wipes it and then counts
    // exactly what it wrote, so a second file running beside it would race the
    // wipe and the counts alike
    // (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §6.3).
    fileParallelism: false,
    // Signs in once, masks the token on the main process's real stdout — where
    // `::add-mask::` is known to fire — resets the Household, and hands the
    // token to tests by `provide`. No test file mints or masks a token of its
    // own (spec §5.1 point 4). Without the credential secrets it no-ops.
    globalSetup: ['test/contract/globalSetup.ts'],
  },
})
