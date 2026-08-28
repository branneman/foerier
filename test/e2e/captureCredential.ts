import { createPrivateKey } from 'node:crypto'

import { chromium } from '@playwright/test'

import { attachAuthenticator, joinAs } from './quartermaster.ts'

/**
 * The one-time credential capture
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §5).
 *
 * ```
 * PLAYWRIGHT_BASE_URL=https://app.foerier.app \
 *   node test/e2e/captureCredential.ts '<join secret>'
 * ```
 *
 * **Run once, by hand, never in CI.** It joins the E2E Household for real —
 * consuming the Invite the Maintainer's `admin:bootstrap` printed — and then
 * exports the passkey Chrome's virtual authenticator just created, as the three
 * `E2E_*` values Tier 4 and Tier 5 both read (`test/contract/credential.ts`).
 * Nothing here runs again: joining is a once-per-Household act and the
 * Household is never re-created.
 *
 * It is a script rather than a spec because it has no assertion to make and no
 * result to report — its output is a secret, which is the one thing a test
 * runner is built to capture, store and display.
 *
 * The imports carry an explicit `.ts` extension because plain `node` runs this
 * file: Node strips types but does not guess extensions, and the whole
 * `quartermaster` → `production` / `mintInvite` / `reset` chain has to resolve.
 */

/** CDP hands back standard base64; the secret is stored base64url, the
 * encoding `@simplewebauthn` and Tier 4 want, and `globalSetup.production.ts`
 * converts back for `addCredential`. */
function base64ToBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Whether the exported key is ES256 — a P-256 key, the only algorithm
 * `SoftwareAuthenticator` implements (§6.4).
 *
 * Worth a hard refusal rather than a warning: an Ed25519 key looks perfectly
 * healthy here and in Tier 5, and fails only in Tier 4, weeks later, as an
 * unexplained sign-in failure against production. Chrome takes the first
 * algorithm the server offers, so the server offers ES256 first
 * (`api/src/auth/service.ts`) — this is the check that says so out loud.
 */
function isEs256(privateKey: string): boolean {
  const key = createPrivateKey({
    key: Buffer.from(privateKey, 'base64'),
    format: 'der',
    type: 'pkcs8',
  })
  return (
    key.asymmetricKeyType === 'ec' &&
    key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
  )
}

const baseURL = process.env['PLAYWRIGHT_BASE_URL']
const secret = process.argv[2]

if (baseURL === undefined || baseURL === '' || secret === undefined) {
  console.error(
    'usage: PLAYWRIGHT_BASE_URL=https://app.foerier.app node test/e2e/captureCredential.ts <join secret>',
  )
  process.exit(1)
}

// Headed, because this is a human sitting in front of the join screen watching
// a real ceremony happen against a real box.
const browser = await chromium.launch({ headless: false })
try {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()

  const { cdp, authenticatorId } = await attachAuthenticator(page)
  await joinAs(page, secret, 'CI')

  const { credentials } = await cdp.send('WebAuthn.getCredentials', {
    authenticatorId,
  })
  const created = credentials[0]
  if (created === undefined || credentials.length !== 1) {
    throw new Error(
      `expected the ceremony to leave exactly one credential, found ${credentials.length}`,
    )
  }

  if (!isEs256(created.privateKey)) {
    // Never echoing the key itself, not even to say what is wrong with it.
    // `exitCode` rather than `exit`, so the browser below still closes.
    console.error(
      'the captured key is not ES256 (P-256). `SoftwareAuthenticator` cannot replay it,\n' +
        'so Tier 4 would fail against production. Check that both\n' +
        '`generateRegistrationOptions` calls in api/src/auth/service.ts still offer -7\n' +
        'first, redeploy, and capture again with a fresh invite.',
    )
    process.exitCode = 1
  } else {
    console.log(
      '\n# Three GitHub secrets — the second one is a private key. This output is the\n' +
        '# only place it is ever printed; paste it into the secret fields and nowhere\n' +
        '# else, and clear the scrollback afterwards.\n',
    )
    console.log(`E2E_CREDENTIAL_ID=${base64ToBase64Url(created.credentialId)}`)
    console.log(`E2E_PRIVATE_KEY=${created.privateKey}`)
    console.log(`E2E_USER_HANDLE=${created.userHandle ?? ''}`)
    console.log(
      '\n# Store all three on BOTH the `contract` and the `e2e-prod` environments:\n' +
        '# each job mints its own Device token from the same credential, and a token\n' +
        '# never crosses a job boundary (spec §6.4).\n' +
        '#\n' +
        '# This capture also left a live Device token for the E2E Household in the\n' +
        '# browser it just closed. Nothing needs doing: the first run of the suite\n' +
        "# revokes every other Device of the Household (spec §3, §5). It is that run's\n" +
        '# reset, not this script, that cleans up.',
    )
  }
} finally {
  await browser.close()
}
