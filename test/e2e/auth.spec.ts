import { expect, test, type Page } from '@playwright/test'

import { mintInvite } from './mintInvite'

/**
 * The join and sign-in ceremonies, in a real browser, against a real server.
 *
 * Passkeys come from Chrome's **virtual authenticator** over CDP, which is the
 * only way to run WebAuthn without a human touching a fingerprint sensor
 * (`docs/testing.md`, Tier 5). Everything else is real: the invite came from
 * the Maintainer bootstrap script, the credential is genuinely created and
 * genuinely signed, and the token genuinely lands in IndexedDB.
 */

/** Gives the page a platform authenticator that always consents. */
async function attachAuthenticator(page: Page) {
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

async function joinAs(page: Page, secret: string, name: string) {
  await page.goto(`/join#${secret}`)

  await expect(page.getByRole('heading', { name: /^Join / })).toBeVisible()
  await page.getByRole('textbox').fill(name)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Signed in.' })).toBeVisible()
}

test('a maintainer-minted invite turns into a signed-in quartermaster', async ({
  page,
}) => {
  const { secret } = await mintInvite()
  await attachAuthenticator(page)

  await page.goto(`/join#${secret}`)

  await expect(page.getByRole('heading', { name: /^Join / })).toBeVisible()
  await expect(
    page.getByText('Opening this link changed nothing yet.'),
  ).toBeVisible()
  await expect(page.getByText('Single use')).toBeVisible()

  // The secret must not survive in the address bar: a screen-shared window or
  // the back button would otherwise carry it around (auth-design.md §3.2).
  await expect(page).toHaveURL(/\/join$/)

  // A brand-new household has no People, so the joiner names themselves.
  await page.getByRole('textbox').fill('Els')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Signed in.' })).toBeVisible()
  await expect(page.getByText('Passkey saved on this device.')).toBeVisible()

  await page.getByRole('button', { name: 'Open the depot' }).click()
  await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()

  // Once signed in, that Device stays signed in — ordinary use never asks
  // again (story 26).
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()
})

test('an invite cannot be redeemed twice', async ({ page }) => {
  // Single-use is the whole bound on a stolen link (story 31).
  const { secret } = await mintInvite()
  await attachAuthenticator(page)

  await joinAs(page, secret, 'Els')

  await page.goto(`/join#${secret}`)

  await expect(
    page.getByRole('heading', { name: 'Invite not valid.' }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'Ask a household member for a new one. Nothing was used up by opening this.',
    ),
  ).toBeVisible()
})

test('signing in again is one button, no username and no password', async ({
  page,
}) => {
  const { secret } = await mintInvite()
  await attachAuthenticator(page)

  await joinAs(page, secret, 'Els')

  // Drop the local session the way a cleared browser profile would, leaving
  // the passkey in place. This is the state a returning device is in.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('foerier')
        request.onsuccess = () => resolve()
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
      }),
  )

  await page.goto('/signin')

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  // Discoverable credentials mean the authenticator already knows which
  // credential belongs here. One button is the entire surface.
  await expect(page.getByRole('textbox')).toHaveCount(0)

  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()
})
