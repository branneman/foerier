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
import { GearDetail } from './GearDetail'

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createDepotStore` — by emitting real ops through `emit`, exactly as
 * `Depot.test.tsx` and `AddGear.test.tsx` do. Never a hand-shaped
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

function renderGearDetail(store: StoreApi<DepotStoreState>, gearId: string) {
  const location = memoryLocation({ path: `/gear/${gearId}`, record: true })
  const result = render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/gear/:id">
          <DepotProvider value={store}>
            <GearDetail />
          </DepotProvider>
        </Route>
        <Route path="/">
          <p>Depot list</p>
        </Route>
      </Switch>
    </Router>,
  )
  return { location, container: result.container }
}

describe('Gear detail', () => {
  it('shows the gear name and the MVP meta line', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Sleeping bag, winter',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
    ])
    renderGearDetail(store, gearId)

    expect(
      screen.getByRole('heading', { name: 'Sleeping bag, winter' }),
    ).toBeInTheDocument()
    expect(screen.getByText('ITEM · SHARED · ×2')).toBeInTheDocument()
  })

  it('shows ×N in the meta line only for counted gear', async () => {
    const singleId = anId()
    const singleStore = await seededStore([
      gearRecorded(singleId, { name: 'Axe', container: false, kind: 'single' }),
    ])
    renderGearDetail(singleStore, singleId)
    expect(screen.getByText('ITEM · SHARED')).toBeInTheDocument()
    expect(screen.queryByText(/×/)).toBeNull()
    cleanup()

    const countedId = anId()
    const countedStore = await seededStore([
      gearRecorded(countedId, {
        name: 'Gas canister',
        container: false,
        kind: 'counted',
        owned_count: 3,
      }),
    ])
    renderGearDetail(countedStore, countedId)
    expect(screen.getByText('ITEM · SHARED · ×3')).toBeInTheDocument()
  })

  it('MOVE opens the home picker and emits gear.rehomed', async () => {
    const placeId = anId()
    const gearId = anId()
    const store = await seededStore([
      placeRecorded(placeId, 'Attic'),
      gearRecorded(gearId, { name: 'Rope', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'MOVE' }))
    expect(screen.getByRole('dialog', { name: 'Home' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Attic' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.residence?.value).toEqual({
      in: 'place',
      id: placeId,
    })
    expect(screen.queryByRole('dialog', { name: 'Home' })).toBeNull()
  })

  it('EDIT renames and emits gear.renamed', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, { name: 'Rope', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    const nameField = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(nameField)
    await user.type(nameField, 'Climbing rope')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.name?.value).toBe(
      'Climbing rope',
    )
  })

  it('EDIT changes the owned-count and emits gear.owned_count_set', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Gas canister',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    const countField = screen.getByRole('spinbutton', { name: 'Owned count' })
    await user.clear(countField)
    await user.type(countField, '5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.ownedCount?.value).toBe(5)
  })

  it('EDIT changes the kind and emits gear.kind_set', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('radio', { name: 'Per-person' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.kind?.value).toBe('per_person')
    // The meta line names the containment trait, not the Kind (fix round 1):
    // per-person gear is still an item, so switching Kind must not move the
    // rendered label off ITEM.
    expect(screen.getByText('ITEM · SHARED')).toBeInTheDocument()
  })

  it('RETIRE emits gear.retired only after the confirmation', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Old tent',
        container: false,
        kind: 'single',
      }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'RETIRE' }))
    await store.getState().drained()
    expect(store.getState().state.gear[gearId]?.retired?.value).not.toBe(true)
    expect(
      screen.getByRole('alertdialog', { name: 'Retire Old tent?' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retire gear' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.retired?.value).toBe(true)
  })

  // Fix round 1: this test's original name — 'renders RETIRE as text, not as
  // a filled button' — claimed more than a class-name comparison can prove.
  // `test.css` is off for this project (`vitest.config.ts`), so jsdom never
  // applies `GearDetail.module.css` — a mutation that repaints `.retire` as
  // a filled button *without* renaming the class would pass unnoticed. What
  // this test actually verifies, honestly: RETIRE is styled with a class of
  // its own, distinct from the bordered MOVE/EDIT class. The "text, never a
  // filled button" rule itself — `.retire` in GearDetail.module.css carries
  // no border and no background, matching `HomePicker`'s own `.remove` — is
  // unverified by automated test here and rests on code review.
  it('gives RETIRE a class distinct from the bordered MOVE/EDIT buttons', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Old tent',
        container: false,
        kind: 'single',
      }),
    ])
    renderGearDetail(store, gearId)

    const move = screen.getByRole('button', { name: 'MOVE' })
    const retire = screen.getByRole('button', { name: 'RETIRE' })
    expect(retire.className).not.toBe('')
    expect(retire.className).not.toBe(move.className)
  })

  it('renders a retired piece of gear struck through, with no actions', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Old tent',
        container: false,
        kind: 'single',
      }),
      gearRetired(gearId),
    ])
    const { container } = renderGearDetail(store, gearId)

    expect(container.querySelector('s')?.textContent).toBe('Old tent')
    expect(screen.getByText('RETIRED')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'MOVE' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'EDIT' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'RETIRE' })).toBeNull()
  })

  // The meta line's first segment is the containment trait, not Kind
  // (fix round 1) — Kind's only remaining consequence here is the ×N gate
  // below. An unrecognised `kind` therefore has no token of its own to
  // render verbatim; what obligation 4 (sync-protocol.md §5.3) guarantees
  // at this line's altitude is narrower: no crash, and no false ×N from
  // treating an unrecognised string as `'counted'`.
  it('does not crash or show a false owned-count for an unrecognised kind', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Odd thing',
        container: false,
        kind: 'exotic_future_kind',
      }),
    ])

    expect(() => renderGearDetail(store, gearId)).not.toThrow()
    expect(screen.getByText('ITEM · SHARED')).toBeInTheDocument()
  })

  it('shows CONTAINER in the meta line for container gear', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('CONTAINER · SHARED')).toBeInTheDocument()
  })

  it('shows ITEM in the meta line for per-person gear', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('ITEM · SHARED')).toBeInTheDocument()
  })
})
