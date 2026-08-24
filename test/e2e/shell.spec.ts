import { expect, test } from '@playwright/test'

/**
 * The skeleton's golden path is only this: the shell loads, and it loads
 * *offline*. Offline-first is the product, so the smoke test proves it from
 * the first commit rather than once there is data worth losing.
 *
 * The real journey — sign in → add gear → find it → build a trip → pack →
 * close — accretes as the slices land (docs/testing.md, Tier 5).
 */
test('the shell loads', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
})

test('the shell still loads with the network cut', async ({
  page,
  context,
}) => {
  // Warm the service worker's precache, then pull the network out from under
  // it. A shell that only works online is not this product.
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

  await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()
})
