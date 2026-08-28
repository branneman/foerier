import type { TestProject } from 'vitest/node'

import { hasCredential } from './credential'
import { assertTripwire, resetHousehold } from './reset'
import { signIn } from './signIn'

/**
 * Tier 4's one sign-in, and the reset that follows it
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §5.1 point 4).
 *
 * **Why `globalSetup` and not a `beforeAll`.** The Device token this mints is a
 * fresh `foe_…` string GitHub's masker has never seen — it is *derived* from
 * the secret, not equal to it — and this is a public repository whose job logs
 * are world-readable. `::add-mask::` is the only thing that redacts it, and the
 * runner honours it only on a line of the **step's own stdout**. `globalSetup`
 * runs in Vitest's main process, writing to that stdout directly; a test file
 * runs in a worker whose output Vitest buffers and reprints, which is fragile
 * for a line-anchored workflow command. So the mask fires here, before the
 * token is used for anything, and no test ever calls `login/verify` itself.
 *
 * The token reaches tests through `provide`/`inject` rather than an env var: it
 * stays a value passed between processes by Vitest instead of something a
 * child process could inherit and print.
 *
 * The **first reset** and its tripwire live here for a second reason: they are
 * once-per-run facts. Reset is at the start, never a teardown, so a cancelled
 * run leaves a dirty Household and the next run's first act fixes it; and the
 * tripwire is an oracle about what the *previous* run left behind (§3.5), so
 * asserting it a second time would assert nothing.
 *
 * Without the credential secrets this does nothing at all, and
 * `household.test.ts` skips itself — `deployment.test.ts` must stay runnable on
 * a fork's pull request, which has none.
 */

declare module 'vitest' {
  export interface ProvidedContext {
    deviceToken: string
  }
}

const API =
  (process.env.CONTRACT_API_URL ?? 'https://api.foerier.app') + '/api/v1'

export default async function setup(project: TestProject): Promise<void> {
  if (!hasCredential()) return

  const token = await signIn({ apiBase: API })
  assertTripwire(await resetHousehold(API, token))

  project.provide('deviceToken', token)
}
