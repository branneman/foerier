import {
  createHlcClock,
  personRecorded,
  placeRecorded,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { AddGear } from './AddGear'

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createDepotStore` — by emitting real ops through `emit`, exactly as
 * `Depot.test.tsx` does. The new gear's own id is minted by the screen
 * itself (`systemIdSource`), so a test recovers it by reading back the sole
 * entry in `state.gear` rather than by choosing it up front.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

function fixedClock(): Clock {
  return { now: () => 1_700_000_000_000 }
}

function anAuthor(): OpAuthor {
  return {
    household_id: HOUSEHOLD,
    device_id: DEVICE,
    ids,
    hlc: createHlcClock(fixedClock()),
  }
}

const noopEngine: EngineFactory = () => ({
  start() {},
  stop() {},
  flush: () => Promise.resolve(),
  pull: () => Promise.resolve(),
  status: () => 'idle',
  bootstrap: () => null,
})

async function seededStore(
  specs: readonly OpSpec[] = [],
): Promise<StoreApi<DepotStoreState>> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return store
}

function renderAddGear(store: StoreApi<DepotStoreState>) {
  const location = memoryLocation({ path: '/add', record: true })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/add">
          <DepotProvider value={store}>
            <AddGear />
          </DepotProvider>
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
function soleGear(store: StoreApi<DepotStoreState>) {
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

  // Every board frame of this screen carries `‹ DEPOT` + the sync state, the
  // same header gear detail has. Without it the only way back is the tab bar,
  // which is not where the eye goes on a form.
  it('offers the way back the board draws', async () => {
    const store = await seededStore()
    renderAddGear(store)
    expect(screen.getByRole('link', { name: '‹ DEPOT' })).toBeInTheDocument()
  })

  it('states that the record is local and syncs on its own', async () => {
    const store = await seededStore()
    renderAddGear(store)
    expect(
      screen.getByText('RECORDED ON THIS DEVICE · SYNCS IN THE BACKGROUND'),
    ).toBeInTheDocument()
  })
})
