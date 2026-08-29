/**
 * `POST /test/reset` from the outside, plus the two things that make it safe
 * to run against a real box
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3, §3.5, §5.1).
 *
 * Shared with Tier 5: `test/e2e/globalSetup.production.ts` imports the same
 * three functions, because the reset and the tripwire are properties of the
 * Household rather than of a tier.
 */

/** Exactly the route's 200 body (`api/src/test/service.ts`). */
export interface ResetCounts {
  /** `op` rows removed. */
  deleted: number
  /** Other Devices of the Household that were live and now are not. */
  revoked: number
  /** Passkeys removed — every one but the caller's. */
  passkeys: number
  /** Outstanding Invites removed. */
  invites: number
}

/**
 * Tell GitHub Actions to redact a value from every subsequent log line (§5.1).
 *
 * The GitHub secret is the exported *private key*; the Device token a run mints
 * from it is a fresh `foe_…` string the masker has never seen, and this is a
 * public repository. So the token is masked the instant it exists, before it is
 * used for anything.
 *
 * `::add-mask::` is a workflow command: the runner honours it only when it
 * occupies a line of the step's own stdout. That is why every caller of this
 * function runs in a main process — Vitest's `globalSetup` (`globalSetup.ts`)
 * and Playwright's — and never in a test worker, whose output Vitest and
 * Playwright both buffer and reprint (§5.1 point 4).
 *
 * Outside Actions it prints a harmless line — deliberately not suppressed, so
 * a local run exercises the same path CI takes.
 */
export function mask(secret: string): void {
  console.log(`::add-mask::${secret}`)
}

export async function resetHousehold(
  /** Always including `/api/v1`. */
  apiBase: string,
  token: string,
): Promise<ResetCounts> {
  const res = await fetch(`${apiBase}/test/reset`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })

  // Status only, never the body, and never the request: both carry the token.
  // A 404 here means the box was started without `E2E_HOUSEHOLD_ID`; a 403
  // means the token's Household is not the configured, disposable one.
  if (res.status !== 200) {
    throw new Error(`POST /test/reset answered ${res.status}`)
  }

  return (await res.json()) as ResetCounts
}

/**
 * The oracle a compromised E2E Household would otherwise never trip (§3.5).
 *
 * §3's `UPDATE` bounds the Household to **exactly one** live Device token, so
 * these counts are exact rather than heuristic: each job signs in once and
 * resets first, so a clean run finds the previous job's single Device and
 * nothing else. More than that means someone else held a token; a Passkey or an
 * Invite means someone added a credential or minted a link.
 *
 * `passkeys === 0` because the route reports what it **deleted**, and the
 * caller's own Passkey is the one it spares. (§3.5's table said `= 1`, counting
 * the survivor rather than the deletions — a wording defect in the spec, since
 * corrected; the route is the authority.)
 *
 * The wipe has already happened by the time this runs, so the counts are the
 * only evidence left — which is why a violation stops the run rather than
 * letting a green suite report the wrong thing.
 */
export function assertTripwire(counts: ResetCounts): void {
  const { revoked, passkeys, invites } = counts

  if (revoked > 1 || passkeys !== 0 || invites !== 0) {
    throw new Error(
      `TRIPWIRE: reset revoked ${revoked} devices / found ${passkeys} foreign passkeys / ${invites} outstanding invites — a credential other than CI's was live — or a previous run was cancelled between sign-in and reset. Rotate per docs/specs/2026-08-28-tier-4-and-5-against-production.md §9.3`,
    )
  }
}
