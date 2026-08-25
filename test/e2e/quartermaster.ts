import { expect, type Page } from '@playwright/test'

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
