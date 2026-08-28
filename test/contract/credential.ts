import type { ExportedCredential } from '../../api/test/server/softwareAuthenticator.ts'

/**
 * The one WebAuthn credential CI holds, read from the environment
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §5).
 *
 * It is captured **once, by hand**, against the deployed app and stored as two
 * GitHub secrets; nothing here creates one. The two encodings are the ones the
 * consumers want rather than the ones this file finds convenient — base64
 * PKCS#8 DER and a base64url id — so a single pair of secrets serves both
 * Chrome's virtual authenticator (Tier 5) and `SoftwareAuthenticator` (Tier 4).
 *
 * Absent secrets are a **skip, not a failure**: `deployment.test.ts` must stay
 * runnable by anyone with an internet connection, and a fork's pull request has
 * no access to them.
 */

const CREDENTIAL_ID = 'E2E_CREDENTIAL_ID'
const PRIVATE_KEY = 'E2E_PRIVATE_KEY'

export function hasCredential(): boolean {
  return (
    (process.env[CREDENTIAL_ID] ?? '') !== '' &&
    (process.env[PRIVATE_KEY] ?? '') !== ''
  )
}

export function credential(): ExportedCredential {
  const credentialId = process.env[CREDENTIAL_ID]
  const privateKey = process.env[PRIVATE_KEY]

  // Half a credential is a configuration mistake, not a "no credentials" run,
  // so it says which half rather than skipping silently. Neither value is
  // echoed: one of them is the private key.
  if (
    credentialId === undefined ||
    credentialId === '' ||
    privateKey === undefined ||
    privateKey === ''
  ) {
    throw new Error(
      `${CREDENTIAL_ID} and ${PRIVATE_KEY} must both be set to run the household-scoped suite`,
    )
  }

  return { credentialId, privateKey }
}

/**
 * The sign count to seed the authenticator with (§5.2).
 *
 * The server requires `received > stored` (`isSignCountAcceptable`), and that
 * check is deliberately **not** relaxed for this credential — an exported
 * private key replayed from elsewhere is exactly the cloned-authenticator case
 * the counter exists to catch. So the harness seeds a value that is strictly
 * monotonic across runs and larger than anything the server can have stored;
 * replaying the *exported* count would break permanently on the second run.
 * Within one run the authenticator advances it on its own.
 */
export function monotonicSignCount(): number {
  return Math.floor(Date.now() / 1000)
}
