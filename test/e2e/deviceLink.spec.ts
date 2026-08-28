import { expect, test, type Page } from '@playwright/test'

import { mintInvite, mintJoinInviteInto } from './mintInvite'
import { attachAuthenticator, joinAs } from './quartermaster'

/**
 * S3.5's three golden paths (spec §12.4): the token-only claim, the
 * second-Login regression, and sign-out with something still owed to the
 * outbox. Everything below the browser is real — the real Postgres, the real
 * `/auth` routes, the real IndexedDB session and op log — same discipline as
 * `auth.spec.ts` and `depot.spec.ts`.
 */

/** Reads the signed-in session straight out of IndexedDB — the same record
 * `sessionStore.ts` writes — so a test can learn ids (`householdId`) the UI
 * never displays directly. */
function readSession(page: Page): Promise<{
  token: string
  loginId: string
  personId: string
  householdId: string
  deviceId: string
}> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('foerier')
        request.onerror = () => reject(new Error('foerier would not open'))
        request.onsuccess = () => {
          const db = request.result
          const getRequest = db
            .transaction('auth')
            .objectStore('auth')
            .get('session')
          getRequest.onsuccess = () => {
            db.close()
            resolve(getRequest.result)
          }
          getRequest.onerror = () => {
            db.close()
            reject(new Error('the session would not read'))
          }
        }
      }),
  )
}

/** How many ops the local log is still holding unpushed — same reading
 * `depot.spec.ts`'s own `unsyncedCount` does, over the same store. Read
 * independently rather than assumed, so the sheet's own count is checked
 * against the truth instead of a guess at how many ops one `addGear` call
 * produces. */
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

/** How many op records the local log holds, synced or not — unlike
 * {@link unsyncedCount}, which counts only the outbox. Used after sign-out
 * to prove the log is actually empty rather than merely fully pushed. */
function opCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('foerier')
        request.onerror = () => reject(new Error('foerier would not open'))
        request.onsuccess = () => {
          const db = request.result
          const all = db.transaction('op').objectStore('op').getAll()
          all.onsuccess = () => {
            db.close()
            resolve(all.result.length)
          }
          all.onerror = () => {
            db.close()
            reject(new Error('the op log would not read'))
          }
        }
      }),
  )
}

/** `context.setOffline` cuts the network but leaves `navigator.onLine`
 * untouched — same trick `depot.spec.ts` and `shell.spec.ts` use to raise
 * the engine's own `online`/`offline` listener. */
async function setOnlineFlag(page: Page, online: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(navigator, 'onLine', {
      value,
      configurable: true,
    })
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  }, online)
}

test('a device link redeems in a browser with nothing behind WebAuthn', async ({
  page,
  browser,
}) => {
  const { secret } = await mintInvite()
  await attachAuthenticator(page)

  await joinAs(page, secret, 'Els')
  await page.getByRole('button', { name: 'Open the depot' }).click()
  await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()

  await page.getByRole('link', { name: 'Account' }).click()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
  await page.getByRole('link', { name: 'Sign in on another device' }).click()

  // The link the phone actually gets — read out of the input well, exactly
  // as a quartermaster would copy it, rather than minted by a script.
  const well = page.getByText(/\/join#/)
  await expect(well).toBeVisible()
  const wellText = await well.textContent()
  const match = /\/join#(\S+)/.exec(wellText ?? '')
  if (match?.[1] === undefined) {
    throw new Error(`device-link well did not carry a secret:\n${wellText}`)
  }
  const deviceSecret = match[1]

  const constrained = await browser.newContext()
  const page2 = await constrained.newPage()
  // No `attachAuthenticator(page2)`. That absence is the test: WebAuthn is
  // present in the page and there is nothing behind it, which is exactly
  // the phone this slice exists for.
  await page2.goto(`/join#${deviceSecret}`)

  await expect(
    page2.getByRole('heading', { name: 'Continue without a passkey' }),
  ).toBeVisible()
  await page2.getByRole('button', { name: /^Continue/ }).click()

  await expect(page2.getByRole('heading', { name: 'Signed in.' })).toBeVisible()
  // The success frame's own first-sync fold has to complete — the CTA is
  // gated on it — before this brand-new Device has anything to open.
  await page2.getByRole('button', { name: 'Open the depot' }).click()

  await expect(
    page2.getByRole('navigation', { name: 'Sections' }),
  ).toBeVisible()
})

test('a second joiner sees the name field — the person_recorded regression', async ({
  page,
  browser,
}) => {
  const { secret } = await mintInvite()
  await attachAuthenticator(page)

  await joinAs(page, secret, 'Els')
  await page.getByRole('button', { name: 'Open the depot' }).click()
  await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()

  const { householdId } = await readSession(page)
  const { secret: secondSecret } = await mintJoinInviteInto(householdId)

  const context2 = await browser.newContext()
  const page2 = await context2.newPage()
  await attachAuthenticator(page2)

  await page2.goto(`/join#${secondSecret}`)
  await expect(page2.getByRole('heading', { name: /^Join / })).toBeVisible()

  // Task 1's regression: `previewInvite` used to derive "does the joiner
  // name themselves" from "does this Household have any Login", which is
  // right for the first Person and wrong for every one after. This
  // Household already has Els's Login, so the old proxy would have hidden
  // this field entirely.
  await expect(page2.getByRole('textbox')).toBeVisible()
  await page2.getByRole('textbox').fill('Mark')
  await page2.getByRole('button', { name: 'Continue' }).click()

  await expect(page2.getByRole('heading', { name: 'Signed in.' })).toBeVisible()
  await page2.getByRole('button', { name: 'Open the depot' }).click()
  await expect(page2.getByRole('heading', { name: 'Depot' })).toBeVisible()

  // The name renders in the shell's own avatar — its initial letter is
  // `aria-hidden` (a name that changes as the Person folds in should not be
  // announced), so it is read by text rather than by role.
  await expect(
    page2
      .getByRole('link', { name: 'Account' })
      .getByText('M', { exact: true }),
  ).toBeVisible()

  await page2.getByRole('link', { name: 'Account' }).click()
  await expect(page2.getByRole('heading', { name: 'Account' })).toBeVisible()
  await expect(page2.getByText('Mark', { exact: true })).toBeVisible()
})

test('signing out this device clears a non-empty outbox and lands on /signin', async ({
  page,
  context,
}) => {
  const { secret } = await mintInvite()
  await attachAuthenticator(page)

  await joinAs(page, secret, 'Els')
  await page.getByRole('button', { name: 'Open the depot' }).click()
  await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()
  await expect(page.getByText('SYNCED')).toBeVisible()
  await expect.poll(() => unsyncedCount(page)).toBe(0)

  // ---- record gear offline, so the outbox is non-empty at sign-out -------

  await context.setOffline(true)
  await setOnlineFlag(page, false)

  await page.getByRole('link', { name: 'Add gear' }).click()
  await expect(page.getByRole('heading', { name: 'Add gear' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Name' }).fill('Zeltbahn')
  await page.getByRole('button', { name: 'Add gear' }).click()
  await expect(page.getByTestId('confirmation')).toContainText('Zeltbahn')

  const count = await unsyncedCount(page)
  expect(count).toBeGreaterThan(0)

  // ---- Account, still offline, and this Device's own sign-out ------------

  await page.getByRole('link', { name: 'Account' }).click()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
  await page.getByRole('button', { name: 'SIGN OUT' }).click()

  await expect(
    page.getByText(
      `▲ ${count} changes not yet synced. Signing out clears them.`,
    ),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Sign out and clear' }).click()

  // `navigate('/signin')` is a client-side route change, not a real
  // navigation — `waitForURL`'s default `load` lifecycle wait never fires
  // for it, so the landing is asserted the same way the rest of this file
  // asserts everything else: wait for what the screen renders.
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  expect(page.url()).toContain('/signin')

  // `clearLocalData()` deletes the whole `foerier` database, but the very
  // next thing this path does — `onSignedOut()` calling the session store's
  // own `clear()` — reopens it, so by the time the screen has settled a
  // fresh, empty database legitimately exists again. What has to be gone is
  // its *content*: the session this Device signed in with, and the gear op
  // recorded above.
  await expect.poll(() => readSession(page)).toBeUndefined()
  await expect.poll(() => opCount(page)).toBe(0)
})
