import {
  createHlcClock,
  gearRecorded,
  gearRetired,
  placeRecorded,
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
import { HomePicker } from './HomePicker'

/**
 * Every test seeds a **real** store by emitting real ops, exactly as
 * `Depot.test.tsx` does — never a hand-shaped `DepotState`.
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
  props: Partial<{ excludeGearId: string }> = {},
) {
  // A real no-op, not `vi.fn()`: no test in this suite asserts on either
  // callback's call state, and this repo's rule is real fakes, never
  // mocking-framework mocks (`docs/testing.md`).
  render(
    <DepotProvider value={store}>
      <HomePicker open onClose={() => {}} onSelect={() => {}} {...props} />
    </DepotProvider>,
  )
}

describe('the Home picker', () => {
  it('lists places, their containers, and loose', async () => {
    const atticId = anId()
    const shedId = anId()
    const crateId = anId()
    const store = await seededStore([
      placeRecorded(atticId, 'Attic'),
      placeRecorded(shedId, 'Shed'),
      gearRecorded(crateId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: atticId },
      }),
    ])

    renderPicker(store)

    expect(screen.getByRole('button', { name: 'Loose' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crate B' })).toBeInTheDocument()
  })

  it('creates a Place inline and emits place.recorded', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ New place' }))
    await user.type(
      screen.getByRole('textbox', { name: 'New place name' }),
      'Garage',
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await store.getState().drained()

    const places = Object.values(store.getState().state.places)
    expect(places).toHaveLength(1)
    expect(places[0]?.name?.value).toBe('Garage')
    expect(screen.getByRole('button', { name: 'Garage' })).toBeInTheDocument()
  })

  it('renames a Place and emits place.renamed', async () => {
    const placeId = anId()
    const store = await seededStore([placeRecorded(placeId, 'Attic')])
    const user = userEvent.setup()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: 'Rename Attic' }))
    const field = screen.getByRole('textbox', { name: 'Rename Attic' })
    await user.clear(field)
    await user.type(field, 'Loft')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.places[placeId]?.name?.value).toBe('Loft')
    expect(screen.getByRole('button', { name: 'Loft' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Attic' })).toBeNull()
  })

  it('names the count of gear that becomes loose before removing a Place', async () => {
    const placeId = anId()
    const specs: OpSpec[] = [placeRecorded(placeId, 'Attic')]
    for (const name of ['Rope', 'Mug', 'Axe', 'Stove']) {
      specs.push(
        gearRecorded(anId(), {
          name,
          container: false,
          kind: 'single',
          residence: { in: 'place', id: placeId },
        }),
      )
    }
    const store = await seededStore(specs)
    const user = userEvent.setup()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: 'Remove Attic' }))

    expect(
      screen.getByText('4 pieces of gear become loose.'),
    ).toBeInTheDocument()
  })

  it('excludes retired gear from the count of gear that becomes loose', async () => {
    const placeId = anId()
    const retiredId = anId()
    const specs: OpSpec[] = [placeRecorded(placeId, 'Attic')]
    for (const name of ['Rope', 'Mug', 'Axe']) {
      specs.push(
        gearRecorded(anId(), {
          name,
          container: false,
          kind: 'single',
          residence: { in: 'place', id: placeId },
        }),
      )
    }
    specs.push(
      gearRecorded(retiredId, {
        name: 'Old lantern',
        container: false,
        kind: 'single',
        residence: { in: 'place', id: placeId },
      }),
      gearRetired(retiredId),
    )
    const store = await seededStore(specs)
    const user = userEvent.setup()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: 'Remove Attic' }))

    // Four pieces reside in Attic, but one is retired — a soft-delete
    // (invariant 7), not gear waiting to be re-homed — so the count reads 3,
    // not 4.
    expect(
      screen.getByText('3 pieces of gear become loose.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('4 pieces of gear become loose.')).toBeNull()
  })

  it('emits place.removed only after the confirmation', async () => {
    const placeId = anId()
    const store = await seededStore([
      placeRecorded(placeId, 'Attic'),
      gearRecorded(anId(), {
        name: 'Rope',
        container: false,
        kind: 'single',
        residence: { in: 'place', id: placeId },
      }),
    ])
    const user = userEvent.setup()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: 'Remove Attic' }))
    expect(store.getState().state.places[placeId]?.removed?.value).not.toBe(
      true,
    )

    await user.click(screen.getByRole('button', { name: 'Remove place' }))
    await store.getState().drained()

    expect(store.getState().state.places[placeId]?.removed?.value).toBe(true)
  })

  it('emits nothing when the confirmation is dismissed', async () => {
    const placeId = anId()
    const store = await seededStore([
      placeRecorded(placeId, 'Attic'),
      gearRecorded(anId(), {
        name: 'Rope',
        container: false,
        kind: 'single',
        residence: { in: 'place', id: placeId },
      }),
    ])
    const user = userEvent.setup()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: 'Remove Attic' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await store.getState().drained()

    expect(
      Object.hasOwn(store.getState().state.places[placeId] ?? {}, 'removed'),
    ).toBe(false)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('does not offer a non-container piece of gear as a home', async () => {
    const placeId = anId()
    const store = await seededStore([
      placeRecorded(placeId, 'Attic'),
      gearRecorded(anId(), {
        name: 'Rope',
        container: false,
        kind: 'single',
        residence: { in: 'place', id: placeId },
      }),
    ])

    renderPicker(store)

    expect(screen.queryByRole('button', { name: 'Rope' })).toBeNull()
  })

  it('does not offer a container as a home for itself or its own descendants', async () => {
    const atticId = anId()
    const crateId = anId()
    const pouchId = anId()
    const tinyBagId = anId()
    const store = await seededStore([
      placeRecorded(atticId, 'Attic'),
      gearRecorded(crateId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: atticId },
      }),
      gearRecorded(pouchId, {
        name: 'Pouch',
        container: true,
        kind: 'single',
        residence: { in: 'gear', id: crateId },
      }),
      gearRecorded(tinyBagId, {
        name: 'Tiny bag',
        container: true,
        kind: 'single',
        residence: { in: 'gear', id: pouchId },
      }),
    ])

    renderPicker(store, { excludeGearId: crateId })

    expect(screen.queryByRole('button', { name: 'Crate B' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pouch' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tiny bag' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Attic' })).toBeInTheDocument()
  })
})
