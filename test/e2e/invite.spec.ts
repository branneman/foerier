import { expect } from '@playwright/test'

import { attachAuthenticator, test } from './quartermaster'

/**
 * Tier 5 — story 28 end to end: a Quartermaster records a Person, issues a
 * join Invite from that Person's row, and the link turns into a second
 * Login on a different device.
 *
 * **Deliberately carries no production tag — this must never run against
 * the box.** The Tier 4/5 spec §5 rules that anything which proves joining
 * stays local, and the mechanism is decisive: `POST /test/reset` cannot
 * delete a Login — by design, since it can never create one either — so
 * every production run would leave one behind in the disposable Household,
 * and the tripwire that says `passkeys = 0, invites = 0, revoked ≤ 1` would
 * have nothing to say about it.
 *
 * (Spelling the tag itself out here would defeat the mechanical check this
 * comment describes: a plain `grep` over this file's own text, not
 * Playwright's title-based `grep` in `playwright.config.ts`, is what proves
 * the tag is absent.)
 */

test('a Quartermaster issues a join Invite from People & logins, and it becomes a second Login', async ({
  quartermaster,
  browser,
}) => {
  // 1. Signed in as the Quartermaster, courtesy of the fixture — the
  // household's first Login, named Els (`quartermaster.ts`). The new Person
  // this test records below is deliberately named something else: reusing
  // "Els" would leave two same-named rows on the same screen and make every
  // text-scoped lookup below ambiguous.
  const { page } = quartermaster

  // 2. `/account/people`, add a Person. At the Desktop viewport this project
  // runs under, the route itself redirects client-side to `/account` and
  // renders the same rows inline (`People.tsx`'s own doc comment,
  // `App.tsx`) — the affordances below exist in both layouts, so the test
  // does not need to fight the redirect.
  await page.goto('/account/people')
  await page.getByRole('button', { name: '+ NEW PERSON' }).click()
  await page.getByRole('textbox', { name: 'New person name' }).fill('Mark')
  // `{ exact: true }`: at the Desktop viewport this project runs under, the
  // PEOPLE & LOGINS card sits beside PASSKEYS' own "Add a passkey on this
  // device" button, and a substring match for "Add" catches both.
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  const markRow = page.locator('li').filter({ hasText: 'Mark' })
  await expect(markRow).toBeVisible()

  // 3. `INVITE ›` on Mark's row, then wait for the issued card and read the
  // link out of the input well — never minted by script, the way a
  // Quartermaster would actually get it.
  await markRow.getByRole('link', { name: 'INVITE ›' }).click()
  await expect(
    page.getByRole('heading', { name: 'Invite for Mark' }),
  ).toBeVisible()

  const well = page.getByText(/\/join#/)
  await expect(well).toBeVisible()
  const wellText = await well.textContent()
  const match = /\/join#(\S+)/.exec(wellText ?? '')
  if (match?.[1] === undefined) {
    throw new Error(`invite well did not carry a secret:\n${wellText}`)
  }
  const secret = match[1]

  // 4. Back to People & logins — the row now reads the outstanding invite.
  //
  // By URL, not by a back link: `useScreenHeader` withholds `‹` at Desktop,
  // where the labeled sidebar **is** the destination
  // (`frontend-design.md` §3.3), and this project runs at Desktop Chrome.
  // The spec clicked `‹ PEOPLE & LOGINS` until the screen-band round made
  // that rule the shipped one; nothing caught it because this file is not
  // tagged `@production`, so CI has never run it.
  await page.goto('/account/people')
  await expect(markRow).toContainText('INVITE OUT · SINGLE USE')

  // 5. A second browser context with its own virtual authenticator opens
  // the link. This Household already has a Login (Els's), so
  // `person_recorded` is true and the joiner does not name themselves — no
  // textbox on this screen, unlike `quartermaster.ts`'s own `joinAs`, which
  // is only for a household's *first* Login. Opening the link must not by
  // itself consume the Invite, so this asserts the confirm screen first and
  // only then triggers the explicit `Join …` POST.
  const context2 = await browser.newContext()
  const page2 = await context2.newPage()
  await attachAuthenticator(page2)

  await page2.goto(`/join#${secret}`)
  await expect(page2.getByRole('heading', { name: /^Join / })).toBeVisible()
  await expect(page2.getByRole('textbox')).toHaveCount(0)

  await page2.getByRole('button', { name: /^Join / }).click()
  await expect(page2.getByRole('heading', { name: 'Signed in.' })).toBeVisible()
  await page2.getByRole('button', { name: 'Open the depot' }).click()
  await expect(page2.getByRole('heading', { name: 'Depot' })).toBeVisible()

  // 6. Back in the first context, a fresh look at People & logins — Mark
  // now has a Login with one Device.
  await page.goto('/account/people')
  await expect(markRow).toContainText('SIGNED IN · 1 DEVICE')
  await expect(
    markRow.getByRole('link', { name: 'DEVICE LINK ›' }),
  ).toBeVisible()
  await expect(markRow.getByRole('button', { name: 'REVOKE' })).toBeVisible()
})
