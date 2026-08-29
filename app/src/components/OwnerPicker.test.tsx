import {
  createHlcClock,
  personRecorded,
  personRenamed,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
  type Owner,
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
import { OwnerPicker } from './OwnerPicker'

/**
 * Every test seeds a **real** store by emitting real ops, exactly as
 * `HomePicker.test.tsx` does — never a hand-shaped `DepotState`.
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

function renderPicker(
  store: StoreApi<DepotStoreState>,
  value: Owner = { type: 'shared' },
) {
  const selected: Owner[] = []
  render(
    <DepotProvider value={store}>
      <OwnerPicker
        value={value}
        onSelect={(owner) => selected.push(owner)}
        onClose={() => {}}
      />
    </DepotProvider>,
  )
  return { selected }
}

/** The row labels, without the `● NOW` marker the chosen row also carries. */
function rowLabels(): (string | null)[] {
  return screen
    .getAllByTestId('owner-row')
    .map((row) => row.firstElementChild?.textContent ?? null)
}

describe('the owner picker', () => {
  it('lists Shared first, then every recorded Person alphabetically', async () => {
    const store = await seededStore([
      personRecorded('mark', 'Mark'),
      personRecorded('els', 'Els'),
    ])
    renderPicker(store)

    // Shared is not a name, so it is pinned rather than sorted — the same
    // rule that puts `Loose` at the top of the Home picker and `Shared`
    // first under GROUP BY OWNER.
    expect(rowLabels()).toEqual(['Shared', 'Els', 'Mark'])
  })

  it('draws a Person with no name as a dash rather than an empty row', async () => {
    const store = await seededStore([
      personRecorded('els', 'Els'),
      personRenamed('els', null),
    ])
    renderPicker(store)
    expect(rowLabels()).toEqual(['Shared', '—'])
  })

  it('marks the held owner with the SET PHASE anatomy', async () => {
    const store = await seededStore([personRecorded('els', 'Els')])
    renderPicker(store, { type: 'person', personId: 'els' })

    const chosen = screen.getByRole('button', { name: /Els/ })
    expect(chosen).toHaveAttribute('aria-pressed', 'true')
    expect(chosen).toHaveTextContent('● NOW')
    expect(screen.getByRole('button', { name: /Shared/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('selects a Person', async () => {
    const user = userEvent.setup()
    const store = await seededStore([personRecorded('els', 'Els')])
    const { selected } = renderPicker(store)

    await user.click(screen.getByRole('button', { name: /Els/ }))
    expect(selected).toEqual([{ type: 'person', personId: 'els' }])
  })

  it('selects Shared, which is a write and not a clear', async () => {
    const user = userEvent.setup()
    const store = await seededStore([personRecorded('els', 'Els')])
    const { selected } = renderPicker(store, {
      type: 'person',
      personId: 'els',
    })

    await user.click(screen.getByRole('button', { name: /Shared/ }))
    expect(selected).toEqual([{ type: 'shared' }])
  })

  it('records a new Person and selects them in one step', async () => {
    const user = userEvent.setup()
    const store = await seededStore()
    const { selected } = renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ New person' }))
    await user.type(screen.getByLabelText('New person name'), 'Kees')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await store.getState().drained()

    // `person.recorded` is S2's op given a second caller — S4 spends neither
    // of its two op types here. Asserted through the fold rather than the
    // log, because the fold is what every other surface will read.
    const people = Object.values(store.getState().state.people)
    expect(people.map((person) => person.name?.value)).toEqual(['Kees'])
    // Created while picking is selected: the Home picker's rule, and the
    // reason a sitting never has to leave Add gear to record a Person. The
    // id handed back is the one that was just recorded, not a second one.
    expect(selected).toEqual([{ type: 'person', personId: people[0]?.id }])
  })

  it('will not record a Person with a blank name', async () => {
    const user = userEvent.setup()
    const store = await seededStore()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ New person' }))
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    await user.type(screen.getByLabelText('New person name'), '   ')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('offers Shared even in a household with nobody recorded', async () => {
    const store = await seededStore()
    renderPicker(store)
    expect(rowLabels()).toEqual(['Shared'])
  })
})
