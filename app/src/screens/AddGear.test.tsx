import { personRecorded, placeRecorded } from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

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
 * RECORDED AS. Three round-1 decisions are retired and their replacements are
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

    await user.type(screen.getByRole('textbox', { name: 'Owned count' }), '8')
    expect(screen.getByRole('button', { name: 'Add gear' })).toBeEnabled()
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

  it('steps the owned count without typing', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.click(screen.getByRole('radio', { name: 'Counted' }))
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('textbox', { name: 'Owned count' })).toHaveValue(
      '1',
    )

    await user.click(screen.getByRole('button', { name: 'Fewer' }))
    // Never below zero, and never back to empty: once stepped, a count has
    // been chosen.
    expect(screen.getByRole('textbox', { name: 'Owned count' })).toHaveValue(
      '0',
    )
    await user.click(screen.getByRole('button', { name: 'Fewer' }))
    expect(screen.getByRole('textbox', { name: 'Owned count' })).toHaveValue(
      '0',
    )
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
