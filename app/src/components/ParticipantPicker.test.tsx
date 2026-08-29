import {
  createHlcClock,
  personRecorded,
  personRenamed,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { ParticipantPicker } from './ParticipantPicker'

/**
 * `OwnerPicker.test.tsx`'s fixtures, because this is `OwnerPicker`'s twin: a
 * **real** store seeded by emitting real ops, never a hand-shaped
 * `DepotState`.
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

/** Every toggle the picker asked for, in order — it emits no `trip.*` op of
 * its own, so this array is the whole of its output. */
type Toggle = { personId: string; next: boolean }

function renderPicker(
  store: StoreApi<DepotStoreState>,
  selected: readonly string[] = [],
) {
  const toggles: Toggle[] = []
  let closed = 0
  render(
    <DepotProvider value={store}>
      <ParticipantPicker
        selected={selected}
        onToggle={(personId, next) => toggles.push({ personId, next })}
        onClose={() => {
          closed += 1
        }}
      />
    </DepotProvider>,
  )
  return { toggles, closes: () => closed }
}

/**
 * The row labels, without the `PARTICIPANT ✓` marker a chosen row carries —
 * and without the leading initial circle, which is why this reads the
 * **second** child. The board draws each row as circle · name · marker.
 */
function rowLabels(): (string | null)[] {
  return screen
    .getAllByTestId('participant-row')
    .map((row) => row.children[1]?.textContent ?? null)
}

/** The initial each row draws, in row order — `''` for an empty circle. */
function rowInitials(): (string | null)[] {
  return screen
    .getAllByTestId('participant-row')
    .map((row) => row.firstElementChild?.textContent ?? null)
}

describe('the participant picker', () => {
  it('lists every recorded Person alphabetically, and nothing else', async () => {
    const store = await seededStore([
      personRecorded('mark', 'Mark'),
      personRecorded('els', 'Els'),
    ])
    renderPicker(store)

    // No pinned first row: `Shared` is a value of the owner register and a
    // Trip has no equivalent — a Participant list is a set of People.
    expect(rowLabels()).toEqual(['Els', 'Mark'])
  })

  it('leads each row with the boards initial circle', async () => {
    const store = await seededStore([
      personRecorded('mark', 'Mark'),
      personRecorded('els', 'Els'),
    ])
    renderPicker(store)

    // `Screens B` 02A's picker draws a 30px circle to the left of every name.
    // It is `aria-hidden`: the name is right beside it, and an initial read
    // aloud is as easily a stray letter (`AccountAvatar`'s rule).
    expect(rowInitials()).toEqual(['E', 'M'])
    const circles = screen
      .getAllByTestId('participant-row')
      .map((row) => row.firstElementChild)
    for (const circle of circles) {
      expect(circle).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('draws a Person with no name as a dash rather than an empty row', async () => {
    const store = await seededStore([
      personRecorded('els', 'Els'),
      personRenamed('els', null),
    ])
    renderPicker(store)
    expect(rowLabels()).toEqual(['—'])
    // And the circle beside it is **empty** rather than an em dash or an
    // invented letter — the treatment `TripCard`, `Trip` and the People
    // screen all give a Person the fold has no name for.
    expect(rowInitials()).toEqual([''])
  })

  it('reflects the held selection on every row', async () => {
    const store = await seededStore([
      personRecorded('mark', 'Mark'),
      personRecorded('els', 'Els'),
    ])
    renderPicker(store, ['els'])

    const els = screen.getByRole('button', { name: /Els/ })
    expect(els).toHaveAttribute('aria-pressed', 'true')
    expect(els).toHaveTextContent('PARTICIPANT ✓')
    const mark = screen.getByRole('button', { name: /Mark/ })
    expect(mark).toHaveAttribute('aria-pressed', 'false')
    expect(mark).not.toHaveTextContent('PARTICIPANT ✓')
  })

  it('marks membership in the multi-select word, not the single-select one', async () => {
    const store = await seededStore([personRecorded('els', 'Els')])
    renderPicker(store, ['els'])

    // `● NOW` states which single value a register holds, and a Participant
    // list is a set — so the marker is the builder's `IN LIST ✓` grammar
    // instead. The two must not be confusable: a reader who has learnt that
    // `● NOW` means "the one" would read a second `● NOW` as a contradiction.
    const els = screen.getByRole('button', { name: /Els/ })
    expect(els).toHaveTextContent('PARTICIPANT ✓')
    expect(els).not.toHaveTextContent('● NOW')
  })

  it('adds a Person to the selection, and stays open', async () => {
    const user = userEvent.setup()
    const store = await seededStore([
      personRecorded('mark', 'Mark'),
      personRecorded('els', 'Els'),
    ])
    const { toggles, closes } = renderPicker(store)

    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: /Mark/ }))

    // Multi-select: picking one does not end the sheet, which is the whole
    // difference from the owner picker.
    expect(toggles).toEqual([
      { personId: 'els', next: true },
      { personId: 'mark', next: true },
    ])
    expect(closes()).toBe(0)
  })

  it('removes a Person without asking', async () => {
    const user = userEvent.setup()
    const store = await seededStore([personRecorded('els', 'Els')])
    const { toggles } = renderPicker(store, ['els'])

    await user.click(screen.getByRole('button', { name: /Els/ }))

    // The tag picker's rule: removal is cheap and instantly reversible — the
    // next tap puts them back — so no confirm, and nothing else comes off
    // with them (invariant 10 makes S8's Pieces derived, not cascaded).
    expect(toggles).toEqual([{ personId: 'els', next: false }])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('emits no op of its own', async () => {
    const user = userEvent.setup()
    const store = await seededStore([personRecorded('els', 'Els')])
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: /Els/ }))
    await store.getState().drained()

    // Controlled, deliberately: `/trips/new` holds a draft selection for a
    // Trip that does not exist yet, so the picker cannot be the thing that
    // addresses one.
    expect(Object.keys(store.getState().state.trips)).toEqual([])
  })

  it('records a new Person and selects them in one step', async () => {
    const user = userEvent.setup()
    const store = await seededStore()
    const { toggles } = renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ NEW PERSON' }))
    await user.type(screen.getByLabelText('New person name'), 'Kees')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await store.getState().drained()

    // `person.recorded` is a **Depot** fact, not a Trip one, so the picker
    // authors it directly even though it authors no `trip.*` op at all.
    const people = Object.values(store.getState().state.people)
    expect(people.map((person) => person.name?.value)).toEqual(['Kees'])
    // Created while picking is selected — the Home picker's rule, inherited
    // through `OwnerPicker`.
    expect(toggles).toEqual([{ personId: people[0]?.id ?? '', next: true }])
  })

  it('folds the create row away again after recording, draft and all', async () => {
    const user = userEvent.setup()
    const store = await seededStore()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ NEW PERSON' }))
    await user.type(screen.getByLabelText('New person name'), 'Kees')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await store.getState().drained()

    // `OwnerPicker` never has to do this: selecting an owner closes that
    // sheet, so mount is its reset. This one stays open for the next
    // Participant, so the row has to reset itself — and reopening it must not
    // show the name just recorded.
    expect(screen.getByRole('button', { name: '+ NEW PERSON' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '+ NEW PERSON' }))
    expect(screen.getByLabelText('New person name')).toHaveValue('')
  })

  it('drops the draft name when the create row is cancelled', async () => {
    const user = userEvent.setup()
    const store = await seededStore()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ NEW PERSON' }))
    await user.type(screen.getByLabelText('New person name'), 'Kee')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: '+ NEW PERSON' }))

    // Abandoning a half-typed name has to abandon it: the sheet outlives the
    // create row, so the row cannot lean on mount for its reset.
    expect(screen.getByLabelText('New person name')).toHaveValue('')
  })

  it('will not record a Person with a blank name', async () => {
    const user = userEvent.setup()
    const store = await seededStore()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ NEW PERSON' }))
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    await user.type(screen.getByLabelText('New person name'), '   ')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('offers the create row in a household with nobody recorded', async () => {
    const store = await seededStore()
    renderPicker(store)

    // The empty case is the one that matters: a Trip planned before anyone
    // was recorded must not be a dead end.
    expect(screen.queryAllByTestId('participant-row')).toEqual([])
    expect(screen.getByRole('button', { name: '+ NEW PERSON' })).toBeVisible()
  })
})
