import { beforeAll, describe, expect, it } from 'vitest'

import { systemIdSource, type OpEnvelope } from '@foerier/shared'

import { hasCredential } from './credential'
import { assertTripwire, resetHousehold } from './reset'
import { signIn } from './signIn'

/**
 * Tier 4, the half that needed a Household
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §6.1).
 *
 * `deployment.test.ts` proves the deployment; this proves the **product** on
 * it. An op pushed is an op pulled — through Caddy, through the deployed
 * process, into the box's Postgres and back out of it — which is the one thing
 * no local tier can show: Tier 2s runs the same code against a local database
 * with no proxy in front of it.
 *
 * **Skipped without the credential secrets**, so a fork's pull request and a
 * developer's laptop still run the unauthenticated file. Nothing here creates a
 * Household; the one it uses was bootstrapped by hand, once, and is marked
 * `disposable` (§5).
 *
 * Deliberately **not** proving tenancy on the box: that needs a second
 * Household and a second production credential, and Tier 2s already proves it
 * against a real Postgres (`householdIsolation.test.ts`). Recorded as an
 * omission in §9, not an oversight.
 */

const API =
  (process.env.CONTRACT_API_URL ?? 'https://api.foerier.app') + '/api/v1'

describe.skipIf(!hasCredential())('the deployed household', () => {
  /**
   * One token for the whole file: minted once, masked once, never asserted on.
   * Every sign-in mints a Device row, and the reset below is what bounds how
   * many of those are ever live (§3.5) — so signing in per test would defeat
   * the tripwire it feeds.
   */
  let token: string
  /**
   * From `/auth/me`, because a push envelope must carry it and the token is not
   * parseable. Not a secret — it is in every op — but it is also never asserted
   * on, since the response it comes from is one §5.1 names as token-bearing.
   */
  let householdId: string

  beforeAll(async () => {
    token = await signIn({ apiBase: API })

    const me = await fetch(`${API}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.status).toBe(200)
    householdId = ((await me.json()) as { household_id: string }).household_id

    // Reset **at the start**, never as teardown: a cancelled or crashed run
    // leaves the Household dirty, and the next run's first act is what fixes
    // it. The tripwire runs on this first reset only — it is an oracle about
    // what the *previous* run left behind (§3.5).
    assertTripwire(await resetHousehold(API, token))
  })

  it('accepts a pushed op and serves it back', async () => {
    const op: OpEnvelope = {
      id: systemIdSource.next(),
      household_id: householdId,
      aggregate: 'gear',
      aggregate_id: crypto.randomUUID(),
      type: 'gear.recorded',
      // §2.2's grammar: ISO-8601 UTC with exactly three fractional digits,
      // then four lowercase hex. One op, so the counter never advances.
      hlc: `${new Date().toISOString()}-0000`,
      device_id: crypto.randomUUID(),
      payload: { name: 'Zeltbahn' },
    }

    const push = await fetch(`${API}/sync/push`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ops: [op] }),
    })

    expect(push.status).toBe(200)
    // A rejected op still answers 200 with a per-op code (§6.1), so the status
    // alone would let a rejection reach the pull below as a bare "not found".
    const pushed = (await push.json()) as {
      results: Array<{ op_id: string; status: string }>
    }
    expect(pushed.results).toMatchObject([{ op_id: op.id, status: 'accepted' }])

    const pull = await fetch(`${API}/sync/pull?since=0`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(pull.status).toBe(200)
    const pulled = (await pull.json()) as { ops: Array<{ id: string }> }
    expect(pulled.ops.map((o) => o.id)).toContain(op.id)
  })

  it('answers reset with exact counts the second time', async () => {
    // The one op the test above pushed, and nothing else: no second Device
    // signed in, no Passkey was added, no Invite was minted. This is the same
    // oracle the tripwire applies, stated as an equality — it is only this
    // exact against a Household this run has already reset once.
    expect(await resetHousehold(API, token)).toEqual({
      deleted: 1,
      revoked: 0,
      passkeys: 0,
      invites: 0,
    })
  })
})
