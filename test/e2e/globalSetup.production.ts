import { chromium, expect, type FullConfig, type Page } from '@playwright/test'

import { credential, monotonicSignCount, rpIdFor } from '../contract/credential'
import { assertTripwire, mask, resetHousehold } from '../contract/reset'
import { API_BASE, appUrl, DEVICE_TOKEN, STORAGE_STATE } from './production'
import { attachAuthenticator } from './quartermaster'

/**
 * Tier 5's one sign-in against the deployed box, and the reset that follows it
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §5, §5.1).
 *
 * **Why `globalSetup` and not a test.** The Device token this mints is a fresh
 * `foe_…` string GitHub's masker has never seen — it is *derived* from the
 * secret, not equal to it — and this is a public repository whose job logs are
 * world-readable. `::add-mask::` is the only thing that redacts it, and the
 * runner honours it only on a line of the **step's own stdout**. In CI
 * Playwright's reporter keeps test-worker stdout inside the report rather than
 * echoing it, so a mask called from a test masks nothing. `globalSetup` runs
 * in the main process, on the real stdout (§5.1 point 4). It signs in once,
 * masks the token before the token is used for anything, and hands it to the
 * workers through `process.env` and a storage-state file that no step uploads.
 * No spec ever performs the ceremony itself.
 *
 * **Why a seeded credential and not `joinAs`.** Joining consumes an Invite,
 * and there is exactly one E2E Household which is never re-created (§5). So
 * the passkey was captured once, by hand, and is replayed into Chrome's
 * virtual authenticator each run — with a **monotonic sign count**, never the
 * exported one, because the server's counter check is deliberately not relaxed
 * for this credential (§5.2).
 *
 * **Why the reset is here too.** It is a once-per-run fact: reset is at the
 * start, never a teardown, so a cancelled run leaves the Household dirty and
 * the next run's first act fixes it. And the tripwire is an oracle about what
 * the *previous* run left behind (§3.5) — asserting it again per test would
 * assert nothing, so the fixture resets without it.
 */

/** CDP wants standard base64; the credential secret is stored base64url, the
 * encoding `@simplewebauthn` and Tier 4 want. One of the two has to convert,
 * and the secret keeps the encoding the wire uses. */
function base64UrlToBase64(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
}

/** The Device token, read out of the session record `sessionStore.ts` writes
 * (`auth-design.md` §7.4 — IndexedDB, `auth` store, key `session`). Reading it
 * from where the app actually keeps it is the point: the token the workers
 * reset with is the same one the restored storage state will authenticate
 * with. */
function readToken(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('foerier')
        request.onerror = () => {
          reject(new Error('foerier would not open'))
        }
        request.onsuccess = () => {
          const db = request.result
          const get = db.transaction('auth').objectStore('auth').get('session')
          get.onsuccess = () => {
            db.close()
            const session = get.result as { token?: unknown } | undefined
            if (typeof session?.token !== 'string') {
              reject(new Error('no signed-in session in IndexedDB'))
              return
            }
            resolve(session.token)
          }
          get.onerror = () => {
            db.close()
            reject(new Error('the session would not read'))
          }
        }
      }),
  )
}

/**
 * Drops everything the client synced *before* the reset, keeping the session.
 *
 * The order is forced: the token only exists once the browser has signed in,
 * and by then the sync engine has already pulled whatever the previous run
 * left on the box. The reset then deletes those ops server-side — but the
 * snapshot about to be saved would still carry them locally, and every spec
 * restoring it would start with last run's gear in the Depot. `Find`'s
 * "1 MATCH" is the assertion that would notice; the storage state is what has
 * to be clean.
 *
 * The stores are the app's (`app/src/db.ts`): the op log, its cursor and HLC,
 * and the dead letter. `auth` is deliberately spared — that is the session.
 */
async function clearSyncedState(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('foerier')
        request.onerror = () => {
          reject(new Error('foerier would not open'))
        }
        request.onsuccess = () => {
          const db = request.result
          const stores = ['op', 'meta', 'deadLetter']
          const tx = db.transaction(stores, 'readwrite')
          for (const store of stores) tx.objectStore(store).clear()
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(new Error('the local log would not clear'))
          }
        }
      }),
  )
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const baseURL = appUrl()
  const browser = await chromium.launch()

  try {
    const context = await browser.newContext({ baseURL })
    const page = await context.newPage()

    const { cdp, authenticatorId } = await attachAuthenticator(page)
    const { credentialId, privateKey } = credential()
    const userHandle = process.env['E2E_USER_HANDLE']

    await cdp.send('WebAuthn.addCredential', {
      authenticatorId,
      credential: {
        credentialId: base64UrlToBase64(credentialId),
        // Sign-in is "one button, no username and no password", which is a
        // discoverable-credential flow: the authenticator has to be able to
        // offer this credential unprompted.
        isResidentCredential: true,
        rpId: rpIdFor(baseURL),
        privateKey,
        // The server looks a credential up by id and never reads the handle,
        // but Chrome stores it on a resident credential and returns it in the
        // assertion, so it is replayed as captured.
        ...(userHandle === undefined || userHandle === ''
          ? {}
          : { userHandle }),
        signCount: monotonicSignCount(),
      },
    })

    await page.goto('/signin')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()

    const token = await readToken(page)
    // Masked the instant it exists, before it is used for anything.
    mask(token)
    process.env[DEVICE_TOKEN] = token

    assertTripwire(await resetHousehold(API_BASE, token))

    await clearSyncedState(page)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()

    // `indexedDB: true` because that is where the token lives — cookies and
    // localStorage alone would restore a signed-out browser.
    await context.storageState({ path: STORAGE_STATE, indexedDB: true })
  } finally {
    await browser.close()
  }
}
