import { expect, test } from '@playwright/test'

/**
 * The shell, offline.
 *
 * Offline-first is the product, so this is proved from the first commit rather
 * than once there is data worth losing. With auth in place the thing that must
 * survive a cold, offline start is the **signed-out shell**: the navigation
 * fallback has to resolve `/signin` and `/join` from the precache, or a
 * freshly-installed client is a blank page (`auth-design.md` §8.4).
 *
 * All three carry `@production` and none takes the `quartermaster` fixture:
 * what they need is a **signed-out visitor**, which is what an unmodified
 * browser context already is. That is why the production storage state is
 * applied inside the fixture rather than as a project-wide `use.storageState`
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §6.2) — the
 * latter would sign this visitor in and quietly empty these tests out.
 */

test('a signed-out visitor lands on the sign-in shell @production', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  // Nothing about a Household is readable on a signed-out Device (story 26).
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(
    0,
  )
})

test('the shell still loads with the network cut @production', async ({
  page,
  context,
}) => {
  await page.goto('/')

  // `ready` resolves once the worker is *activated*, which is when precaching
  // has finished — but not when it is controlling this page. The app registers
  // with `registerType: 'prompt'` and therefore no `clientsClaim`, deliberately
  // (an update must never swap the code under a quartermaster mid-pack-out).
  // So the first load is uncontrolled and one reload is needed to hand it over.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  await page.reload()

  // The property this tier can actually prove: with the origin unreachable,
  // the shell still renders — precache and navigation fallback did their job.
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

  // `setOffline` cuts the network but leaves `navigator.onLine` true, so the
  // browser's own offline signal has to be raised to exercise the listener.
  // What the copy says for a given state is Tier 3's business, where the flag
  // is a prop; what is proved here is that the app is wired to the event at
  // all.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    })
    window.dispatchEvent(new Event('offline'))
  })

  await expect(
    page.getByText('Offline. Sign-in needs a connection.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled()

  // The explainer needs no network, so it stays available — the one useful
  // thing left to someone stuck offline on a device with no passkey.
  await expect(
    page.getByRole('button', { name: 'No passkey on this device?' }),
  ).toBeEnabled()
})

test('a cold offline client can still resolve /signin directly @production', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  // A route with no file behind it: only the navigation fallback makes this
  // resolve at all.
  await page.goto('/signin')

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
