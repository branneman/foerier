import { personRecorded, placeRecorded } from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../household/opLog'
import { HouseholdProvider, type HouseholdStoreState } from '../household/store'
import { DESKTOP, SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { anId, seededStore } from '../testUtils'
import { AddGear } from './AddGear'

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createHouseholdStore` — by emitting real ops through `emit`, exactly as
 * `Depot.test.tsx` does. The new gear's own id is minted by the screen
 * itself (`systemIdSource`), so a test recovers it by reading back the sole
 * entry in `state.gear` rather than by choosing it up front.
 */

function renderAddGear(store: StoreApi<HouseholdStoreState>) {
  const location = memoryLocation({ path: '/add', record: true })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/add">
          <HouseholdProvider value={store}>
            <AddGear />
          </HouseholdProvider>
        </Route>
        <Route path="/gear/:id">
          {(params) => <p>Gear detail {params['id']}</p>}
        </Route>
      </Switch>
    </Router>,
  )
  return location
}

/** The one gear entry a test's store holds after a submit, and its id. */
function soleGear(store: StoreApi<HouseholdStoreState>) {
  const entries = Object.entries(store.getState().state.gear)
  expect(entries).toHaveLength(1)
  const entry = entries[0]
  if (entry === undefined) throw new Error('unreachable: length checked above')
  const [id, gear] = entry
  return { id, gear }
}

/**
 * **F1, redrawn round 2** (`docs/design/README.md` §3b, Screens A §06,
 * Components' Add-gear atoms).
 *
 * The order is the ledger line being written: NAME · KIND (+ count) · HOME ·
 * OWNER · TAGS · RECORDED AS. Three round-1 decisions are retired and their replacements are
 * what most of these tests are about:
 *
 * - **The screen stays after Add.** Round 1 navigated to the new gear's
 *   detail after every record; a depot is populated shelf by shelf, and that
 *   made the batch loop a round trip per item.
 * - **The container checkbox is retired.** A checkbox reads as a setting; the
 *   trait is `RECORDED AS · ITEM | CONTAINER`, the glossary's own meta-line
 *   words, sitting last because it is the rarest decision and the only
 *   irreversible one.
 * - **The Owned-count well opens empty and gates the CTA.** A silent `×1` is
 *   a wrong ledger line.
 */
describe('Add gear — the record', () => {
  it('emits one gear.recorded carrying every field the form holds', async () => {
    const placeId = anId()
    const store = await seededStore([placeRecorded(placeId, 'Attic')])
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Tent')
    await user.click(screen.getByRole('radio', { name: 'Counted' }))
    await user.type(screen.getByRole('textbox', { name: 'Owned count' }), '4')
    await user.click(screen.getByRole('radio', { name: 'Container' }))

    await user.click(screen.getByRole('button', { name: 'Home' }))
    await user.click(screen.getByRole('button', { name: 'Attic' }))

    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { gear } = soleGear(store)
    expect(gear.name?.value).toBe('Tent')
    expect(gear.container?.value).toBe(true)
    expect(gear.kind?.value).toBe('counted')
    expect(gear.ownedCount?.value).toBe(4)
    expect(gear.residence?.value).toEqual({ in: 'place', id: placeId })
  })

  /**
   * The second departure from the board (`AddGear.tsx`'s own doc comment):
   * F1's settled order carries no owner, and S4 adds one because the
   * alternative is a gear-detail visit per personal item until story 35's
   * bulk bar lands.
   */
  it('records the chosen owner on the one gear.recorded op', async () => {
    const store = await seededStore([personRecorded('els', 'Els')])
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Down jacket',
    )
    await user.click(screen.getByRole('button', { name: 'Owner' }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { gear } = soleGear(store)
    expect(gear.owner?.value).toEqual({ type: 'person', personId: 'els' })
  })

  it('writes no owner register at all when the owner was left Shared', async () => {
    // Absence already reads SHARED (`selectors/owner.ts`), so writing
    // `{type:'shared'}` on every record would add a register carrying no fact
    // anybody stated — and would make `NEWEST FIRST` depend on a field nobody
    // set. The row still draws `Shared`, because that is what absence means.
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    expect(screen.getByRole('button', { name: 'Owner' })).toHaveTextContent(
      'Shared',
    )
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Tent')
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { gear } = soleGear(store)
    expect(Object.hasOwn(gear, 'owner')).toBe(false)
  })

  it('carries the owner over to the next record in the sitting', async () => {
    // The whole point of the departure: a shelf in a bedroom is one person's,
    // so the second record must not need a second visit to the picker. Same
    // argument the board gives for HOME.
    const store = await seededStore([personRecorded('els', 'Els')])
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Down jacket',
    )
    await user.click(screen.getByRole('button', { name: 'Owner' }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    expect(screen.getByRole('button', { name: 'Owner' })).toHaveTextContent(
      'Els',
    )

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Rain jacket',
    )
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const owners = Object.values(store.getState().state.gear).map(
      (gear) => gear.owner?.value,
    )
    expect(owners).toEqual([
      { type: 'person', personId: 'els' },
      { type: 'person', personId: 'els' },
    ])
  })

  it('resets kind and the trait between records but not the owner', async () => {
    const store = await seededStore([personRecorded('els', 'Els')])
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Down jacket',
    )
    await user.click(screen.getByRole('button', { name: 'Owner' }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('radio', { name: 'Container' }))
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    expect(screen.getByRole('radio', { name: 'Item' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Single' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Owner' })).toHaveTextContent(
      'Els',
    )
  })

  it('records a Person from the picker without leaving the sitting', async () => {
    // The dead end the inline `+ New person` row exists to prevent: the form
    // is half filled and the Person was never recorded.
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Winter boots',
    )
    await user.click(screen.getByRole('button', { name: 'Owner' }))
    await user.click(screen.getByRole('button', { name: '+ New person' }))
    await user.type(screen.getByLabelText('New person name'), 'Kees')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await store.getState().drained()

    // The name survived the picker, and the new Person is already chosen.
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Winter boots',
    )
    expect(screen.getByRole('button', { name: 'Owner' })).toHaveTextContent(
      'Kees',
    )

    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const kees = Object.values(store.getState().state.people)[0]
    const { gear } = soleGear(store)
    expect(gear.owner?.value).toEqual({ type: 'person', personId: kees?.id })
  })

  it('defaults to a single item, loose', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Axe')
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { gear } = soleGear(store)
    expect(gear.kind?.value).toBe('single')
    expect(gear.container?.value).toBe(false)
    expect(Object.hasOwn(gear, 'residence')).toBe(false)
  })

  it('omits owned_count for gear that is not counted', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Mug')
    await user.click(screen.getByRole('radio', { name: 'Per-person' }))
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { gear } = soleGear(store)
    expect(Object.hasOwn(gear, 'ownedCount')).toBe(false)
  })
})

describe('Add gear — the CTA gate', () => {
  it('refuses to record without a name', async () => {
    const store = await seededStore()
    renderAddGear(store)

    expect(screen.getByRole('button', { name: 'Add gear' })).toBeDisabled()
  })

  /**
   * "The well **opens empty** and gates the CTA — a silent ×1 is a wrong
   * ledger line." Round 1 pre-filled `1`, which recorded a count nobody
   * chose every time Counted was picked and the field ignored.
   */
  it('opens the owned-count well empty and gates the CTA on it', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Tent peg')
    expect(screen.getByRole('button', { name: 'Add gear' })).toBeEnabled()

    await user.click(screen.getByRole('radio', { name: 'Counted' }))
    expect(screen.getByRole('textbox', { name: 'Owned count' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Add gear' })).toBeDisabled()

    // **The commit is the blur, not the keystroke** — `ui/Stepper`'s own
    // rule (amendment ruling K), inherited when this well folded into it.
    // Typing fills the component's buffer and nothing else, so the gate is
    // still shut here; leaving the field is what states the number.
    await user.type(screen.getByRole('textbox', { name: 'Owned count' }), '8')
    expect(screen.getByRole('button', { name: 'Add gear' })).toBeDisabled()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Add gear' })).toBeEnabled()
  })

  /**
   * **The one behaviour the fold put at risk.** The CTA is `disabled` until a
   * count is chosen, and `Stepper` commits on blur — so a Quartermaster who
   * types `8` and goes straight for `Add gear` is relying on a tap over a
   * *disabled* button still blurring the well. It does, in both engines this
   * app ships to (measured in Chromium and WebKit before the fold; the
   * measurement itself is in `KEYBOARD-PASS.md`, since no tier can hold it).
   * This asserts the same sequence as far as jsdom can carry it.
   */
  it('records a count typed and never blurred by hand', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Tent peg')
    await user.click(screen.getByRole('radio', { name: 'Counted' }))
    await user.type(screen.getByRole('textbox', { name: 'Owned count' }), '8')

    // The tap that both commits the well and submits the form. The first
    // click blurs and enables; the second is the submit — which is exactly
    // what a real tap does in one gesture, blur landing on mousedown.
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { gear } = soleGear(store)
    expect(gear.ownedCount?.value).toBe(8)
  })

  it('keeps the CTA label constant rather than describing the gate', async () => {
    const store = await seededStore()
    renderAddGear(store)
    expect(screen.getByRole('button', { name: 'Add gear' })).toBeInTheDocument()
  })

  it('shows the owned-count well only while Counted is chosen', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    expect(screen.queryByRole('textbox', { name: 'Owned count' })).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Counted' }))
    expect(
      screen.getByRole('textbox', { name: 'Owned count' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Single' }))
    expect(screen.queryByRole('textbox', { name: 'Owned count' })).toBeNull()
  })

  /**
   * The buttons answer to `ui/Stepper`'s names now — `Decrease Owned count` /
   * `Increase Owned count`, the same two words gear detail and the gear list
   * already spoke. `Fewer` and `More` were this screen's own and were the
   * whole of the debt: one control, two accessible names, on two screens of
   * one app.
   */
  it('steps the owned count without typing', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.click(screen.getByRole('radio', { name: 'Counted' }))
    await user.click(
      screen.getByRole('button', { name: 'Increase Owned count' }),
    )
    expect(screen.getByRole('textbox', { name: 'Owned count' })).toHaveValue(
      '1',
    )

    await user.click(
      screen.getByRole('button', { name: 'Decrease Owned count' }),
    )
    // Never below zero, and never back to empty: once stepped, a count has
    // been chosen.
    expect(screen.getByRole('textbox', { name: 'Owned count' })).toHaveValue(
      '0',
    )
    // At `min` the control is disabled rather than inert — `Stepper`'s own
    // behaviour, and a stronger statement than the old copy's silent floor.
    expect(
      screen.getByRole('button', { name: 'Decrease Owned count' }),
    ).toBeDisabled()
  })
})

/**
 * **The sitting.** After Add the screen stays: the name clears and keeps
 * focus so the loop is type → return → type, Kind / count / trait reset to
 * their defaults, and **Home carries over** — a depot is recorded shelf by
 * shelf.
 */
describe('Add gear — the sitting', () => {
  it('stays on the screen and clears the name for the next record', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.type(name, 'Tent peg')
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    expect(name).toHaveValue('')
    expect(name).toHaveFocus()
    expect(screen.queryByText(/Gear detail/)).toBeNull()
  })

  it('records on the return key, so the loop needs no reach for the CTA', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Tent peg{Enter}',
    )
    await store.getState().drained()

    expect(soleGear(store).gear.name?.value).toBe('Tent peg')
  })

  it('counts the sitting once something has been recorded', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    // Nothing to count before the first record, so the line is absent rather
    // than reading `0 RECORDED`.
    expect(screen.queryByTestId('session-count')).toBeNull()

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Tent peg{Enter}',
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Mallet{Enter}',
    )
    await store.getState().drained()

    expect(screen.getByTestId('session-count')).toHaveTextContent('2 RECORDED')
  })

  it('carries Home over to the next record but resets kind, count and trait', async () => {
    const placeId = anId()
    const store = await seededStore([placeRecorded(placeId, 'Attic')])
    const user = userEvent.setup()
    renderAddGear(store)

    await user.click(screen.getByRole('button', { name: 'Home' }))
    await user.click(screen.getByRole('button', { name: 'Attic' }))
    await user.click(screen.getByRole('radio', { name: 'Counted' }))
    await user.type(screen.getByRole('textbox', { name: 'Owned count' }), '4')
    await user.click(screen.getByRole('radio', { name: 'Container' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Crate B{Enter}',
    )
    await store.getState().drained()

    // A depot is recorded shelf by shelf, so the shelf stays.
    expect(screen.getByRole('button', { name: 'Home' })).toHaveTextContent(
      'Attic',
    )
    expect(screen.getByRole('radio', { name: 'Single' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Item' })).toBeChecked()
    expect(screen.queryByRole('textbox', { name: 'Owned count' })).toBeNull()
  })

  it('confirms what was recorded and where', async () => {
    const placeId = anId()
    const store = await seededStore([placeRecorded(placeId, 'Attic')])
    const user = userEvent.setup()
    renderAddGear(store)

    await user.click(screen.getByRole('button', { name: 'Home' }))
    await user.click(screen.getByRole('button', { name: 'Attic' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Gas canister 450 g{Enter}',
    )
    await store.getState().drained()

    // CAPS is a `text-transform` on the line, not applied here — the same
    // convention the rest of this codebase's label text follows.
    expect(screen.getByTestId('confirmation')).toHaveTextContent(
      'RECORDED · Gas canister 450 g → Attic',
    )
  })

  it('opens the record it just confirmed', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Tent peg{Enter}',
    )
    await store.getState().drained()
    await user.click(screen.getByTestId('confirmation'))

    const { id } = soleGear(store)
    expect(await screen.findByText(`Gear detail ${id}`)).toBeInTheDocument()
  })

  /**
   * **The one departure from the board on this screen.** Screens A §06 draws
   * `UNDO` beside the confirmation line, specified as "restores the record
   * into the form and **removes the op**".
   *
   * An op cannot be removed from an append-only log that may already have
   * pushed it, and story 36 — Undo, Later, opening with a design phase — rules
   * out the only compensating op that exists: "It does not leave the Gear
   * marked, Retired, or otherwise visibly different from how it stood
   * before." A retraction that works only before the first push is the
   * weaker-because-time-passed reversal that story's third criterion forbids
   * by name.
   *
   * So the line ships without it, and the board element is blocked on story
   * 36 rather than wrong.
   */
  it('offers no UNDO, because story 36 has not been designed yet', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Tent peg{Enter}',
    )
    await store.getState().drained()

    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()
  })
})

describe('Add gear — the trait', () => {
  // A checkbox reads as a setting; this is not a setting. The permanence is
  // stated beside it rather than discovered later.
  it('offers the trait as the glossary meta-line words, and says it is fixed', async () => {
    const store = await seededStore()
    renderAddGear(store)

    expect(screen.getByRole('radio', { name: 'Item' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Container' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(
      screen.getByText('CONTAINERS HOLD OTHER GEAR · FIXED WHEN RECORDED'),
    ).toBeInTheDocument()
  })

  it('states that the record is local and syncs on its own', async () => {
    const store = await seededStore()
    renderAddGear(store)
    expect(
      screen.getByText('RECORDED ON THIS DEVICE · SYNCS IN THE BACKGROUND'),
    ).toBeInTheDocument()
  })
})

describe('Add gear — the band above the title', () => {
  /**
   * `useScreenHeader`'s rule on a screen that answers `splitPane: false`.
   * The board draws `Add gear — split 900` as a pane with the Depot list
   * beside it; `App.tsx` routes `/add` to a screen of its own at every width,
   * so at Split `‹ DEPOT` still points at something not on the page.
   *
   * These are half the fact: this suite renders the screen without
   * `AppShell`, so an absence here says the screen withheld a line and
   * nothing about whether the shell drew one. `shell/screenBand.test.tsx`
   * counts the composed page, at these same three widths.
   */
  it('draws the back link and no sync line below Split', async () => {
    renderAddGear(await seededStore())

    // `AppShell`'s own header band already states it, in words, at this
    // width — the width this screen is used at most.
    expect(screen.getByRole('link', { name: '‹ DEPOT' })).toBeVisible()
    expect(screen.queryByText('SYNCED')).toBeNull()
  })

  it('draws both at Split, where the rail has neither a label nor a word', async () => {
    setViewport(SPLIT)
    renderAddGear(await seededStore())

    expect(screen.getByRole('link', { name: '‹ DEPOT' })).toBeVisible()
    expect(screen.getByText('SYNCED')).toBeVisible()
  })

  it('draws neither at Desktop, where the sidebar is the navigation', async () => {
    setViewport(SPLIT, DESKTOP)
    renderAddGear(await seededStore())

    expect(screen.queryByRole('link', { name: '‹ DEPOT' })).toBeNull()
    expect(screen.queryByText('SYNCED')).toBeNull()
  })
})

describe('Add gear — the fact line under the CTA', () => {
  /**
   * `docs/design/README.md` §5, settled: **the fact line follows its CTA
   * block.** `Add gear — phone 393, fresh` and `roomy 540, counted gate`
   * centre `RECORDED ON THIS DEVICE · SYNCS IN THE BACKGROUND` under a
   * full-width pinned primary; `Add gear — split 900` sets it inline beside a
   * 40px button in a two-pane form. `App.tsx` routes `/add` to a standalone
   * screen at every width and that pane has never been built, so only the
   * first treatment exists here — the line centres unconditionally, and the
   * stylesheet gains no width gate.
   *
   * The **field-level** fact lines are a different slot and do not move:
   * `CONTAINERS HOLD OTHER GEAR · FIXED WHEN RECORDED` is drawn flush left on
   * all four frames, `split 900` included, and `OPENS EMPTY — GATES THE CTA`
   * flush left on the one frame that draws it.
   */
  function css(): string {
    return readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'AddGear.module.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
  }

  it('centres the CTA line and leaves the field-level lines flush left', () => {
    expect(css()).toMatch(/\.ctaFact\s*\{[^}]*text-align:\s*center/)
    expect(css()).not.toMatch(/\.fact\s*\{[^}]*text-align/)
  })

  it('gates the alignment on no width at all', () => {
    // The board changes the alignment exactly where it changes the CTA — the
    // Split boundary, 52em, where the form becomes a pane. `/add` is never a
    // pane, so there is nothing here for the line to ride. The one media
    // query in the file is the Roomy 40em measure cap.
    expect(css().match(/@media[^{]*/g)).toEqual(['@media (min-width: 40em) '])
  })

  it('carries the alignment on the CTA line alone', async () => {
    renderAddGear(await seededStore())

    const cta = screen.getByText(
      'RECORDED ON THIS DEVICE · SYNCS IN THE BACKGROUND',
    )
    const trait = screen.getByText(
      'CONTAINERS HOLD OTHER GEAR · FIXED WHEN RECORDED',
    )

    // The two share the mono ledger treatment; the CTA line carries one class
    // more, and that class is the alignment fenced above. Asserted as a
    // containment rather than against a literal, because the module's own
    // names are generated.
    const ctaClasses = cta.className.split(' ').filter((name) => name !== '')
    const traitClasses = trait.className
      .split(' ')
      .filter((name) => name !== '')
    expect(traitClasses).toHaveLength(1)
    expect(ctaClasses).toHaveLength(2)
    expect(ctaClasses).toEqual(expect.arrayContaining(traitClasses))
  })
})

/**
 * **The `TAGS` row** (`docs/specs/2026-09-07-tags-on-add-gear.md`).
 *
 * The third attribute row, after `OWNER`, over ops that have shipped since
 * S3. It drives a **draft**, not the log — `TagPicker` is a pure selection
 * component and the caller owns the write (`patterns.md` §4.3) — and the
 * submit spends that draft as one `gear.tag_applied` per drafted tag, after
 * the `gear.recorded`.
 */
describe('Add gear — the tags row', () => {
  /** Draft `tag` through the picker's `+ CREATE` row, then close it. */
  async function draftTag(
    user: ReturnType<typeof userEvent.setup>,
    tag: string,
  ) {
    await user.click(screen.getByRole('button', { name: 'Tags' }))
    await user.type(screen.getByLabelText('Tag'), tag)
    await user.click(screen.getByTestId('create-tag'))
    await user.click(screen.getByRole('button', { name: 'Close' }))
  }

  it('reads None when empty and the drafted tags with # when not', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    // The position HOME's `Loose` and OWNER's `Shared` hold.
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveTextContent(
      'None',
    )

    await draftTag(user, 'food')
    await draftTag(user, 'kitchen')

    expect(screen.getByRole('button', { name: 'Tags' })).toHaveTextContent(
      '#food #kitchen',
    )
  })

  /**
   * **Not a widened `gear.recorded`.** Its payload carries no `tags`, and
   * sync §5's tolerant reader ignores unknown fields — so a widened op would
   * fold untagged on every build in the wild. `gear.tag_applied` has shipped
   * since S3, so the N+1 ops fold correctly everywhere.
   */
  it('emits the gear.recorded first, then one gear.tag_applied per tag', async () => {
    const log = inMemoryOpLog()
    const store = await seededStore([], { log })
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Stove')
    await draftTag(user, 'kitchen')
    await draftTag(user, 'bushcraft')
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { id } = soleGear(store)
    const logged = await log.all()
    expect(logged.map((record) => [record.op.type, record.op.payload])).toEqual(
      [
        ['gear.recorded', expect.objectContaining({ name: 'Stove' })],
        ['gear.tag_applied', { tag: 'kitchen' }],
        ['gear.tag_applied', { tag: 'bushcraft' }],
      ],
    )
    expect(logged.every((record) => record.op.aggregate_id === id)).toBe(true)
  })

  /**
   * §4.2: a needless write moves the stamp LWW compares, and can therefore
   * beat a genuine concurrent write from a Device that was offline
   * (`patterns.md` §2.3). Asserted on the emitted ops rather than on a screen
   * read, since that is where the bug would be.
   */
  it('emits exactly one op when no tag was drafted', async () => {
    const log = inMemoryOpLog()
    const store = await seededStore([], { log })
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Axe')
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    expect((await log.all()).map((record) => record.op.type)).toEqual([
      'gear.recorded',
    ])
  })

  it('carries the tags over to the next record while kind resets', async () => {
    const log = inMemoryOpLog()
    const store = await seededStore([], { log })
    const user = userEvent.setup()
    renderAddGear(store)

    await draftTag(user, 'food')
    await user.click(screen.getByRole('radio', { name: 'Per-person' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Gas canister{Enter}',
    )
    await store.getState().drained()

    // A shelf is usually one sort of thing, so the sort stays; the Kind is
    // per item and resets, exactly as it does beside HOME and OWNER.
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveTextContent(
      '#food',
    )
    expect(screen.getByRole('radio', { name: 'Single' })).toBeChecked()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Mug{Enter}')
    await store.getState().drained()

    expect((await log.all()).map((record) => record.op.type)).toEqual([
      'gear.recorded',
      'gear.tag_applied',
      'gear.recorded',
      'gear.tag_applied',
    ])
  })
})

describe('Add gear — the CTA in the thumb zone', () => {
  /**
   * `docs/design/README.md` §5 drift (3), the half that was deferred. `New
   * trip` took these two declarations in the round that found the drift;
   * this screen kept its CTA mid-screen — three fields do not fill a phone —
   * on exactly the device the thumb zone exists for, and the fact line
   * centred under it there.
   *
   * The deferral was about **whose round owned the screen**, never about the
   * size of the change: `.screen` was already a flex column, so it wanted
   * `NewTrip`'s two declarations and nothing else.
   *
   * jsdom computes no cascade, so the rules are asserted where they are
   * written (`NewTrip.test.tsx`'s shape, one screen over).
   */
  function css(): string {
    return readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'AddGear.module.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
  }

  it('parks the primary at the foot, with a height for it to push against', () => {
    expect(css()).toMatch(/\.primary\s*\{[^}]*margin-top:\s*auto/)
    // `margin-top: auto` absorbs free space only where there is some: without
    // the screen claiming the column's height, the CTA follows the last field
    // and the pinning silently does nothing.
    expect(css()).toMatch(/\.screen\s*\{[^}]*min-height:\s*100%/)
  })

  it('keeps the line under a full-width block, which is what centring rests on', () => {
    expect(css()).toMatch(/\.primary\s*\{[^}]*width:\s*100%/)
    expect(css()).toMatch(/\.ctaFact\s*\{[^}]*text-align:\s*center/)
  })
})
