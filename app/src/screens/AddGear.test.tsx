import {
  createHlcClock,
  placeRecorded,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { cleanup, render, screen } from '@testing-library/react'
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

describe('Add Gear', () => {
  it('emits one gear.recorded carrying every field the form holds', async () => {
    const placeId = anId()
    const store = await seededStore([placeRecorded(placeId, 'Attic')])
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Tent')
    await user.click(screen.getByRole('checkbox', { name: 'Container' }))
    await user.click(screen.getByRole('radio', { name: 'Counted' }))
    const countField = screen.getByRole('spinbutton', { name: 'Owned count' })
    await user.clear(countField)
    await user.type(countField, '4')

    await user.click(screen.getByRole('button', { name: 'Home' }))
    await user.click(screen.getByRole('button', { name: 'Attic' }))

    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { id, gear } = soleGear(store)
    expect(gear.name?.value).toBe('Tent')
    expect(gear.container?.value).toBe(true)
    expect(gear.kind?.value).toBe('counted')
    expect(gear.ownedCount?.value).toBe(4)
    expect(gear.residence?.value).toEqual({ in: 'place', id: placeId })
    expect(await screen.findByText(`Gear detail ${id}`)).toBeInTheDocument()
  })

  it('shows the owned-count field only when Counted is chosen', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    expect(screen.queryByRole('spinbutton', { name: 'Owned count' })).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Counted' }))
    expect(
      screen.getByRole('spinbutton', { name: 'Owned count' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Single' }))
    expect(screen.queryByRole('spinbutton', { name: 'Owned count' })).toBeNull()
  })

  it('omits owned_count from the payload for single and per-person gear', async () => {
    const singleStore = await seededStore()
    const user1 = userEvent.setup()
    renderAddGear(singleStore)
    await user1.type(screen.getByRole('textbox', { name: 'Name' }), 'Axe')
    await user1.click(screen.getByRole('button', { name: 'Add gear' }))
    await singleStore.getState().drained()
    const single = soleGear(singleStore)
    expect(Object.hasOwn(single.gear, 'ownedCount')).toBe(false)
    cleanup()

    const perPersonStore = await seededStore()
    const user2 = userEvent.setup()
    renderAddGear(perPersonStore)
    await user2.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Sleeping bag',
    )
    await user2.click(screen.getByRole('radio', { name: 'Per-person' }))
    await user2.click(screen.getByRole('button', { name: 'Add gear' }))
    await perPersonStore.getState().drained()
    const perPerson = soleGear(perPersonStore)
    expect(Object.hasOwn(perPerson.gear, 'ownedCount')).toBe(false)
  })

  it('defaults the kind to single', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    expect(screen.getByRole('radio', { name: 'Single' })).toBeChecked()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Rope')
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { gear } = soleGear(store)
    expect(gear.kind?.value).toBe('single')
  })

  it('records a container when the container toggle is on', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Crate B')
    await user.click(screen.getByRole('checkbox', { name: 'Container' }))
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { gear } = soleGear(store)
    expect(gear.container?.value).toBe(true)
  })

  it('records gear as loose when no home is chosen', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Rope')
    await user.click(screen.getByRole('button', { name: 'Add gear' }))
    await store.getState().drained()

    const { gear } = soleGear(store)
    expect(Object.hasOwn(gear, 'residence')).toBe(false)
  })

  it('refuses to submit without a name', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderAddGear(store)

    const submit = screen.getByRole('button', { name: 'Add gear' })
    expect(submit).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), '   ')
    expect(submit).toBeDisabled()

    await user.click(submit)
    await store.getState().drained()
    expect(Object.keys(store.getState().state.gear)).toHaveLength(0)
  })
})
