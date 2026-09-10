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

/**
 * **The cascade's layer order, proved where it is actually decided.**
 *
 * CSS layers take their order from **first mention**, so the order the browser
 * applies is a property of the *emitted bundle*, not of
 * `ui/styles/index.css`. It shipped inverted: `app/src/main.tsx` imported a
 * component from `@foerier/ui` above the stylesheet, so a dozen
 * `@layer components { … }` blocks were evaluated before the
 * `@layer reset, tokens, …;` statement — `components` was created first and
 * every other layer appended **after** it, so `reset`, `base`, `layout` and
 * `utilities` all beat every component in the package.
 *
 * It was one import and one day: `12c327d` gave `main.tsx` the first `ui`
 * component it had ever imported, and until then the stylesheet genuinely was
 * first.
 *
 * `reset`'s `button { color: inherit }` is the loudest symptom, and the CTA
 * here is where it is cheapest to catch: the button painted its background
 * from `components` and took its text colour from `reset`.
 *
 * **Contrast, not inequality.** The first draft of this asserted that the two
 * colours differ, and it passed against the bug — inherited ink on the accent
 * fill is a *different* colour, just an illegible one. Measured on this
 * button, 2026-09-10: **7.26:1** with the layers in order, **1.74:1** with
 * them inverted. The threshold is WCAG AA's 4.5:1 for body text rather than a
 * number split between those two, so the assertion states a property of the
 * product and happens to catch the cascade, rather than the reverse.
 *
 * No tier below this one can see any of it: Vitest processes no CSS modules
 * and jsdom computes no styles. `ui/src/layerOrder.test.tsx` guards the
 * *mechanism*; this guards the *outcome*, which is what survives someone
 * finding a different mechanism.
 */
test('a control paints its label legibly against its own fill @production', async ({
  page,
}) => {
  await page.goto('/signin')

  const cta = page.getByRole('button', { name: 'Sign in' })
  await expect(cta).toBeVisible()

  const paint = await cta.evaluate((node) => {
    const style = getComputedStyle(node)

    // WCAG 2 relative luminance. Written out rather than pulled in: it is
    // eight lines, it runs inside the page, and a dependency here would be a
    // dependency of the whole e2e tier.
    const luminance = (colour: string): number => {
      const [r, g, b] = colour
        .match(/\d+(\.\d+)?/g)!
        .slice(0, 3)
        .map(Number) as [number, number, number]
      const channel = (value: number): number => {
        const v = value / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    const ink = luminance(style.color)
    const fill = luminance(style.backgroundColor)
    return {
      colour: style.color,
      background: style.backgroundColor,
      ratio: (Math.max(ink, fill) + 0.05) / (Math.min(ink, fill) + 0.05),
    }
  })

  // A transparent fill would make the ratio meaningless rather than failing:
  // the label would be measured against nothing and pass on a technicality.
  expect(paint.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(paint.ratio).toBeGreaterThanOrEqual(4.5)
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
