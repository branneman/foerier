import { expect } from '@playwright/test'

import { test } from './quartermaster'

/**
 * Tier 5 — **a refused write reaches the reader** (`docs/design/README.md`
 * §5n K24, K24b).
 *
 * The last place the app could lose a Quartermaster's intent in silence, and
 * the whole path is three surfaces that no lower tier can hold together: the
 * shell's sync marker turning attention, the sheet it opens, and the marker
 * clearing on acknowledgement. Vitest can prove each piece against a store it
 * hand-built; only a browser proves that a real refused write walks all three.
 *
 * **Deliberately carries no production tag.** Nothing here would harm the
 * disposable Household — the write is refused, so nothing is recorded — but
 * the refusal is authored by exceeding §1.4's 16 KB cap, and a spec whose
 * method is "send something deliberately malformed" belongs on a local
 * server rather than on the box.
 */
test('a refused write reaches the reader, and clears when acknowledged', async ({
  quartermaster,
}) => {
  const { page } = quartermaster

  await page.getByRole('link', { name: 'Add gear' }).click()
  // Over §1.4's per-op cap, so the store refuses to author it at all: nothing
  // is appended, nothing folds, and the only trace is the refusal.
  await page.getByRole('textbox', { name: 'Name' }).fill('x'.repeat(17_000))
  await page.getByRole('button', { name: 'Add gear' }).click()

  // The sync line's third state, in the marker's own slot.
  await expect(page.getByText('1 NOT SAVED').first()).toBeVisible()

  await page
    .getByRole('button', { name: /NOT SAVED — what was not saved/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Not saved' })).toBeVisible()
  await expect(page.getByText(/TOO LARGE TO SAVE/)).toBeVisible()
  // No retry: the refused payload is not kept, so a retry would be a door to
  // a room that no longer exists.
  await expect(page.getByRole('button', { name: /try again/i })).toHaveCount(0)

  // Acknowledgement is the clearing act, and nothing else is.
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('1 NOT SAVED')).toHaveCount(0)
})
