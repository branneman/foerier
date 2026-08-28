import { expect, type Page } from '@playwright/test'

import { test } from './quartermaster'

/**
 * S2's golden path, end to end: join → add gear → see it in the Depot, with
 * an **offline leg** in the middle.
 *
 * Offline-first is the product, not a resilience feature bolted to the side,
 * so the smoke test has to prove it rather than assume it: gear recorded with
 * the network cut is in the Depot immediately, is still there after a reload,
 * and reaches the household by itself once the network is back. Everything
 * below the browser is real — the real Postgres, the real `/sync/push` and
 * `/sync/pull`, the real IndexedDB op log.
 */

/** How many ops the local log is still holding unpushed — a record's `seq`
 * is `null` until the server has assigned one, which is precisely what "in
 * the outbox" means (`docs/sync-protocol.md` §8.1). */
function unsyncedCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('foerier')
        request.onerror = () => reject(new Error('foerier would not open'))
        request.onsuccess = () => {
          const db = request.result
          const all = db.transaction('op').objectStore('op').getAll()
          all.onsuccess = () => {
            const records = all.result as { seq: number | null }[]
            db.close()
            resolve(records.filter((record) => record.seq === null).length)
          }
          all.onerror = () => {
            db.close()
            reject(new Error('the op log would not read'))
          }
        }
      }),
  )
}

/**
 * `context.setOffline` cuts the network but leaves `navigator.onLine`
 * untouched, so the browser's own signal has to be raised by hand for the
 * engine's `online` listener to see it — the same trick `shell.spec.ts` uses.
 */
async function setOnlineFlag(page: Page, online: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(navigator, 'onLine', {
      value,
      configurable: true,
    })
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  }, online)
}

/**
 * S3 redrew this screen (`docs/design/README.md` §3b): **after Add the screen
 * stays**, so the batch loop is type → return → type. Round 1 navigated to
 * the new gear's detail after every record, which this helper used to assert
 * — leaving on purpose is now what has to be asserted instead.
 */
async function addGear(page: Page, name: string) {
  await page.getByRole('link', { name: 'Add gear' }).click()
  await expect(page.getByRole('heading', { name: 'Add gear' })).toBeVisible()

  await page.getByRole('textbox', { name: 'Name' }).fill(name)
  await page.getByRole('button', { name: 'Add gear' }).click()

  // The screen stays, the name clears, and the confirmation line says what
  // was recorded.
  await expect(page.getByTestId('confirmation')).toContainText(name)
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('')
  await expect(page.getByRole('heading', { name: 'Add gear' })).toBeVisible()

  // `exact`, because this screen's own back link reads `‹ DEPOT`.
  await page.getByRole('link', { name: 'Depot', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()
}

test('gear recorded offline reaches the depot, survives a reload, and syncs @production', async ({
  quartermaster,
}) => {
  // Signed in and standing on the Depot — by joining locally, or from
  // `globalSetup`'s storage state against production (`quartermaster.ts`).
  const { page, context } = quartermaster

  // Locally, the join screen's pending first Person is flushed into the log as
  // the household's first op, and the first sync carries it away. Against
  // production there is nothing owed at all — either way the device starts
  // level with the server.
  await expect(page.getByText('SYNCED')).toBeVisible()
  await expect.poll(() => unsyncedCount(page)).toBe(0)

  await addGear(page, 'Zeltbahn')
  await expect(page.getByRole('link', { name: 'Zeltbahn' })).toBeVisible()
  await expect.poll(() => unsyncedCount(page)).toBe(0)

  // ---- the offline leg ----------------------------------------------------

  await context.setOffline(true)
  await setOnlineFlag(page, false)

  await addGear(page, 'Feldflasche')

  // Recorded locally, visible immediately, and the header says why nothing
  // has left the device — one quiet line, never a blocking dialog.
  await expect(page.getByRole('link', { name: 'Feldflasche' })).toBeVisible()
  await expect(page.getByText('OFFLINE')).toBeVisible()
  await expect.poll(() => unsyncedCount(page)).toBeGreaterThan(0)

  // Still there across a reload, with the network still cut: the local op log
  // is the source of truth, not a cache of the server (§7.5).
  await page.reload()
  await expect(page.getByRole('link', { name: 'Feldflasche' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Zeltbahn' })).toBeVisible()

  // ---- find it, still offline ---------------------------------------------

  // Find runs entirely over the local fold — `findGear`/`whereabouts` — so
  // this is the leg that proves story 3 rather than merely exercising it:
  // the radio stays off for all of it.
  await page.getByRole('link', { name: 'Find' }).click()
  await expect(page.getByRole('heading', { name: 'Find' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search gear' }).fill('Feldflasche')
  await expect(page.getByText('1 MATCH · ON-DEVICE INDEX')).toBeVisible()

  const match = page.getByRole('link', { name: 'Feldflasche' })
  await expect(match).toBeVisible()
  await expect(match.getByText('⌂ HOME')).toBeVisible()

  await match.click()
  await expect(page.getByRole('heading', { name: 'Feldflasche' })).toBeVisible()
  await page.getByRole('link', { name: 'Depot', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()

  // ---- back online --------------------------------------------------------

  await context.setOffline(false)
  await setOnlineFlag(page, true)

  // The outbox drains by itself. Nothing was asked of the Quartermaster.
  await expect.poll(() => unsyncedCount(page)).toBe(0)
  await expect(page.getByText('SYNCED')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('link', { name: 'Feldflasche' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Zeltbahn' })).toBeVisible()
})
