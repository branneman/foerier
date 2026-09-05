import { expect, type Page } from '@playwright/test'

import { test } from './quartermaster'

/**
 * The golden path, end to end: join → add gear → find it → build a trip →
 * pack an item, with an **offline leg** in the middle.
 *
 * One test, because Tier 5's charter is one journey (`docs/testing.md`) and
 * a leg is added by the slice that makes its step reachable. `close the trip`
 * is the sixth step and waits on S10.
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

/** The Trip this run builds. Named per run so a re-run against the shared
 * production Household never reads the last run's Trip as this one's. */
const TRIP = `Vosges ${Date.now()}`

/** The packing row drawing `name` — rows carry no role of their own, so this
 * is `Packing.test.tsx`'s own `rowFor` over the same test id. */
function packingRow(page: Page, name: string) {
  return page.getByTestId('packing-row').filter({ hasText: name })
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

  // ---- build a trip (S6) --------------------------------------------------

  await page.getByRole('link', { name: 'Trips', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible()

  await page.getByRole('link', { name: 'New trip' }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill(TRIP)
  await page.getByRole('button', { name: 'Create trip' }).click()

  // Creating lands on the Trip itself, in `draft` — the phase the reducer
  // writes at `trip.created`, never a payload field.
  await expect(page.getByRole('heading', { name: TRIP })).toBeVisible()
  await expect(page.getByTestId('phase-chip')).toHaveText(/DRAFT/)

  // ---- the gear list (S7) -------------------------------------------------

  // **Reached by a click, which it could not be until the door existed.**
  // `+ Add from the depot` is gated on `editable = !isSplitOrWider`, so it is
  // the phone's; `EDIT LIST ›` lives inside the `GEAR LIST` band, which
  // renders only once the Trip *has* entries — so a Trip with an empty list
  // was a dead end from Split up, and this hop was a `page.goto` standing in
  // for a journey a Quartermaster could not actually make. The empty region
  // now draws that same `EDIT LIST ›`, and this leg is the only tier that
  // proves the whole path from *create a trip* to *add its first entry* is
  // walkable at a laptop width.
  await page.getByRole('link', { name: 'EDIT LIST ›' }).click()
  await expect(
    page.getByRole('heading', { name: `${TRIP} — gear list` }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Add Zeltbahn' }).click()
  await page.getByRole('button', { name: 'Add Feldflasche' }).click()

  // `IN LIST ✓` replaces `+ ADD` on the row itself — the only feedback the
  // picker gives, so that a batch loop never leaves the keyboard.
  await expect(page.getByRole('button', { name: 'Add Zeltbahn' })).toHaveCount(
    0,
  )
  await expect(page.getByTestId('gear-list-section')).toContainText('Zeltbahn')
  await expect(page.getByTestId('gear-list-section')).toContainText(
    'Feldflasche',
  )

  // ---- pack an item (S9a) -------------------------------------------------

  // Back to the Trip, where the `GEAR LIST` band now renders — and with it
  // both of its doors, `PACKING ›` among them.
  await page.getByRole('link', { name: `‹ ${TRIP}` }).click()
  await expect(page.getByRole('heading', { name: TRIP })).toBeVisible()
  await expect(page.getByTestId('gear-list-count')).toContainText('2 ENTRIES')

  await page.getByRole('link', { name: `Open packing for ${TRIP}` }).click()
  await expect(page.getByRole('heading', { name: 'Pack-out' })).toBeVisible()
  await expect(page.getByText('● 0/2 PIECES')).toBeVisible()

  // The pill cycles `not_packed → staged → packed`, so packing one piece is
  // two taps on the same control and each is its own op.
  const row = packingRow(page, 'Zeltbahn')
  await row.getByRole('button', { name: /NOT PACKED/ }).click()
  await row.getByRole('button', { name: /STAGED/ }).click()
  await expect(row.getByRole('button', { name: /PACKED/ })).toBeVisible()

  await expect(page.getByText('● 1/2 PIECES')).toBeVisible()

  // It survives the round trip: the ops left the device and came back with
  // the fold, which is the whole reason this leg is here and not in Tier 3.
  await expect.poll(() => unsyncedCount(page)).toBe(0)
  await page.reload()
  await expect(page.getByText('● 1/2 PIECES')).toBeVisible()
})
