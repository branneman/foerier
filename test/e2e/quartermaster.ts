import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from '@playwright/test'

// Explicit `.ts`, unlike the rest of `test/e2e`: `captureCredential.ts` is run
// by plain `node`, which strips types but does not guess extensions, so every
// specifier on the path to it has to resolve as written. Playwright and Vitest
// take either form.
import { resetHousehold } from '../contract/reset.ts'
import { mintInvite } from './mintInvite.ts'
import {
  API_BASE,
  appUrl,
  deviceToken,
  isProduction,
  STORAGE_STATE,
} from './production.ts'

/**
 * Getting a real, signed-in Quartermaster into a real browser — the setup
 * every Tier 5 journey starts from.
 *
 * Passkeys come from Chrome's **virtual authenticator** over CDP, which is the
 * only way to run WebAuthn without a human touching a fingerprint sensor
 * (`docs/testing.md`, Tier 5). Nothing else is simulated: the invite came from
 * the Maintainer bootstrap script, the credential is genuinely created and
 * genuinely signed, and the token genuinely lands in IndexedDB.
 */

/** Gives the page a platform authenticator that always consents. */
export async function attachAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  )
  return { cdp, authenticatorId }
}

/** Redeems an invite and names the joiner, leaving the page on the join
 * success screen. */
export async function joinAs(page: Page, secret: string, name: string) {
  await page.goto(`/join#${secret}`)

  await expect(page.getByRole('heading', { name: /^Join / })).toBeVisible()
  await page.getByRole('textbox').fill(name)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Signed in.' })).toBeVisible()
}

/**
 * A signed-in Quartermaster, on the Depot, however this run got there
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §6.2).
 *
 * The two paths are genuinely different acts, and hiding that behind one name
 * is the point: a spec asks for a Quartermaster and gets one.
 *
 * - **Locally** it is exactly what every spec did before this fixture existed:
 *   mint an Invite with the real Maintainer script, attach a virtual
 *   authenticator, join, open the Depot. Nothing about a local run changed.
 * - **Against production** joining is impossible — it would consume an Invite
 *   from the one Household that is never re-created — so the browser starts
 *   from `globalSetup`'s storage state instead, and the test's first act is
 *   `POST /test/reset`, so state comes from this run rather than from whatever
 *   the last one left.
 *
 * The reset's **tripwire is not asserted here**. It is an oracle about what
 * the previous run left behind (§3.5), and `globalSetup` already consumed it;
 * a second assertion would only be asserting the first reset's own work.
 *
 * The storage state is applied here rather than as a project-wide
 * `use.storageState` deliberately: `shell.spec.ts` runs against production too
 * and needs a **signed-out** visitor. A project-wide setting would sign that
 * visitor in, and the spec would quietly stop testing what it exists to test.
 */
export const test = base.extend<{
  quartermaster: { page: Page; context: BrowserContext }
}>({
  quartermaster: async ({ browser, baseURL, page, context }, use) => {
    if (isProduction) {
      await resetHousehold(API_BASE, deviceToken())

      // A context of its own, because `storageState` can only be given at
      // creation — the fixture's own `page` and `context` are signed out and
      // go unused on this path. `baseURL` has to be passed on: a context made
      // by hand inherits nothing from the project's `use`.
      const signedIn = await browser.newContext({
        baseURL: baseURL ?? appUrl(),
        storageState: STORAGE_STATE,
      })
      const signedInPage = await signedIn.newPage()
      await signedInPage.goto('/')
      await expect(
        signedInPage.getByRole('heading', { name: 'Depot' }),
      ).toBeVisible()

      await use({ page: signedInPage, context: signedIn })
      await signedIn.close()
      return
    }

    const { secret } = await mintInvite()
    await attachAuthenticator(page)

    await joinAs(page, secret, 'Els')
    await page.getByRole('button', { name: 'Open the depot' }).click()
    await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()

    await use({ page, context })
  },
})
