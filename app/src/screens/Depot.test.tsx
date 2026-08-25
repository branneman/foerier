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
import { render, screen, within } from '@testing-library/react'
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
import { Depot } from './Depot'

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createDepotStore` — by emitting real ops through `emit`, never by
 * hand-shaping `DepotState`. The engine is a no-op fake: this screen never
 * talks to the network, and the store's own suite (`depot/store.test.ts`)
 * already proves the sync half.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

let nextId = 0

/** A fresh, canonical-shaped id, distinct per call — never reused across
 * tests, so a failing assertion names the id it actually saw. */
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
  specs: readonly OpSpec[],
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

function renderDepot(store: StoreApi<DepotStoreState>, path = '/') {
  const location = memoryLocation({ path, record: true })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/">
          <DepotProvider value={store}>
            <Depot />
          </DepotProvider>
        </Route>
        <Route path="/gear/:id">
          {(params) => <p>Gear detail {params['id']}</p>}
        </Route>
        <Route path="/add">
          <p>Add gear screen</p>
        </Route>
      </Switch>
    </Router>,
  )
  return location
}

/** Rows the screen renders for gear — the FAB is a link too, so this filters
 * to only the ones that navigate to a piece of gear. */
function gearRows(): HTMLElement[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('href')?.startsWith('/gear/'))
}

describe('the Depot list', () => {
  it('lists visible gear by name', async () => {
    const axe = anId()
    const stove = anId()
    const tent = anId()
    const store = await seededStore([
      gearRecorded(tent, { name: 'Tent', container: false, kind: 'single' }),
      gearRecorded(axe, { name: 'Axe', container: false, kind: 'single' }),
      gearRecorded(stove, {
        name: 'Stove',
        container: false,
        kind: 'single',
      }),
    ])

    renderDepot(store)

    expect(gearRows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Axe',
      'Stove',
      'Tent',
    ])
  })

  it('omits retired gear', async () => {
    const keptId = anId()
    const retiredId = anId()
    const store = await seededStore([
      gearRecorded(keptId, { name: 'Axe', container: false, kind: 'single' }),
      gearRecorded(retiredId, {
        name: 'Lantern',
        container: false,
        kind: 'single',
      }),
      gearRetired(retiredId),
    ])

    renderDepot(store)

    expect(screen.queryByRole('link', { name: 'Lantern' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Axe' })).toBeInTheDocument()
  })

  it('shows the full home path for gear inside a container', async () => {
    const placeId = anId()
    const crateId = anId()
    const tentId = anId()
    const store = await seededStore([
      placeRecorded(placeId, 'Attic'),
      gearRecorded(crateId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: placeId },
      }),
      gearRecorded(tentId, {
        name: 'Tent',
        container: false,
        kind: 'single',
        residence: { in: 'gear', id: crateId },
      }),
    ])

    renderDepot(store)

    const row = screen.getByRole('link', { name: 'Tent' })
    expect(within(row).getByText('Attic ▸ Crate B')).toBeInTheDocument()
  })

  it('shows nothing where a home path would be for loose gear', async () => {
    const ropeId = anId()
    const store = await seededStore([
      gearRecorded(ropeId, { name: 'Rope', container: false, kind: 'single' }),
    ])

    renderDepot(store)

    const row = screen.getByRole('link', { name: 'Rope' })
    expect(within(row).queryByTestId('meta')).toBeNull()
  })

  it('shows the owned-count only for counted gear', async () => {
    const tentId = anId()
    const mugId = anId()
    const store = await seededStore([
      gearRecorded(tentId, { name: 'Tent', container: false, kind: 'single' }),
      gearRecorded(mugId, {
        name: 'Mug',
        container: false,
        kind: 'counted',
        owned_count: 4,
      }),
    ])

    renderDepot(store)

    const mugRow = screen.getByRole('link', { name: 'Mug' })
    expect(within(mugRow).getByTestId('meta')).toHaveTextContent('×4')

    const tentRow = screen.getByRole('link', { name: 'Tent' })
    expect(within(tentRow).queryByTestId('meta')).toBeNull()
  })

  it('filters rows by the search field', async () => {
    const axeId = anId()
    const stoveId = anId()
    const tentId = anId()
    const store = await seededStore([
      gearRecorded(axeId, { name: 'Axe', container: false, kind: 'single' }),
      gearRecorded(stoveId, {
        name: 'Stove',
        container: false,
        kind: 'single',
      }),
      gearRecorded(tentId, { name: 'Tent', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()

    renderDepot(store)
    await user.type(
      screen.getByRole('searchbox', { name: 'Search gear' }),
      'sto',
    )

    expect(screen.getByRole('link', { name: 'Stove' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Axe' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Tent' })).toBeNull()
  })

  it('reports the match count when a filter is active', async () => {
    const axeId = anId()
    const stoveId = anId()
    const store = await seededStore([
      gearRecorded(axeId, { name: 'Axe', container: false, kind: 'single' }),
      gearRecorded(stoveId, {
        name: 'Stove',
        container: false,
        kind: 'single',
      }),
    ])
    const user = userEvent.setup()

    renderDepot(store)
    expect(screen.getByText('2 GEAR · 2 PIECES')).toBeInTheDocument()

    await user.type(
      screen.getByRole('searchbox', { name: 'Search gear' }),
      'sto',
    )

    expect(screen.getByText('1 MATCH')).toBeInTheDocument()
    expect(screen.queryByText('2 GEAR · 2 PIECES')).toBeNull()
  })

  it('renders the empty state before anything is recorded', async () => {
    const store = await seededStore([])

    renderDepot(store)

    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument()
    expect(gearRows()).toHaveLength(0)
  })

  it('opens gear detail when a row is activated', async () => {
    const tentId = anId()
    const store = await seededStore([
      gearRecorded(tentId, { name: 'Tent', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()

    renderDepot(store)
    await user.click(screen.getByRole('link', { name: 'Tent' }))

    expect(await screen.findByText(`Gear detail ${tentId}`)).toBeInTheDocument()
  })

  it('opens Add Gear from the FAB', async () => {
    const store = await seededStore([])
    const user = userEvent.setup()

    renderDepot(store)
    await user.click(screen.getByRole('link', { name: 'Add gear' }))

    expect(await screen.findByText('Add gear screen')).toBeInTheDocument()
  })
})
