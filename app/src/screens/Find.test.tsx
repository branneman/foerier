import { gearRecorded, placeRecorded, type OpSpec } from '@foerier/shared'
import { cleanup, render, screen, within } from '@testing-library/react'
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
import { DESKTOP, SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { anAuthor, anId, noopEngine } from '../testUtils'
import { Find } from './Find'

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createDepotStore` — by emitting real ops through `emit`, exactly as
 * `Depot.test.tsx` does. `findGear` and `whereabouts` (`@foerier/shared`) are
 * the real selectors from the previous task; nothing here hand-shapes a
 * `DepotState`.
 */

/**
 * Reports its status as `offline` from the moment the store builds it
 * (`store.ts`'s `buildEngine` reads `engine.status()` synchronously, before
 * anything is awaited) — the real path a Quartermaster's device takes while
 * the household is unreachable, not a stand-in for one.
 */
const offlineEngine: EngineFactory = () => ({
  start() {},
  stop() {},
  flush: () => Promise.resolve(),
  pull: () => Promise.resolve(),
  status: () => 'offline',
  bootstrap: () => null,
})

async function seededStore(
  specs: readonly OpSpec[],
  engine: EngineFactory = noopEngine,
): Promise<StoreApi<DepotStoreState>> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return store
}

function renderFind(store: StoreApi<DepotStoreState>) {
  const location = memoryLocation({ path: '/', record: true })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/">
          <DepotProvider value={store}>
            <Find />
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

function searchField(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Search gear' })
}

describe('Find', () => {
  it('shows nothing until something is typed', async () => {
    const axeId = anId()
    const store = await seededStore([
      gearRecorded(axeId, { name: 'Axe', container: false, kind: 'single' }),
    ])

    renderFind(store)

    expect(screen.queryByRole('link', { name: 'Axe' })).toBeNull()
    expect(screen.queryByText(/MATCH/)).toBeNull()
  })

  it('reports the match count', async () => {
    const axeId = anId()
    const strapId = anId()
    const tentId = anId()
    const store = await seededStore([
      gearRecorded(axeId, { name: 'Axe', container: false, kind: 'single' }),
      gearRecorded(strapId, {
        name: 'Axe strap',
        container: false,
        kind: 'single',
      }),
      gearRecorded(tentId, { name: 'Tent', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'axe')

    expect(screen.getByText('2 MATCHES · ON-DEVICE INDEX')).toBeInTheDocument()
  })

  it('shows the full home path for each match', async () => {
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
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'tent')

    const row = screen.getByRole('link', { name: 'Tent' })
    expect(within(row).getByText('⌂ Attic ▸ Crate B')).toBeInTheDocument()
  })

  it('shows the split whereabouts card for counted gear', async () => {
    const mugId = anId()
    const store = await seededStore([
      gearRecorded(mugId, {
        name: 'Mug',
        container: false,
        kind: 'counted',
        owned_count: 4,
      }),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'mug')

    const card = screen.getByRole('link', { name: 'Mug' })
    expect(within(card).getByText('COUNTED · ×4')).toBeInTheDocument()
    // `LOOSE`, not `HOME` — the ubiquitous-language term for gear with no
    // residence, matching `WhereaboutsCard` and `GearDetail`'s COUNT chip.
    expect(within(card).getByText('⌂ LOOSE')).toBeInTheDocument()
  })

  it('says there are no matches rather than showing an empty list', async () => {
    const axeId = anId()
    const store = await seededStore([
      gearRecorded(axeId, { name: 'Axe', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'zzz')

    expect(screen.getByText('No matches.')).toBeInTheDocument()
  })

  it('keeps working while offline', async () => {
    const axeId = anId()
    const store = await seededStore(
      [gearRecorded(axeId, { name: 'Axe', container: false, kind: 'single' })],
      offlineEngine,
    )
    expect(store.getState().sync).toBe('offline')
    const user = userEvent.setup()

    renderFind(store)
    expect(searchField()).not.toBeDisabled()

    await user.type(searchField(), 'axe')

    expect(screen.getByRole('link', { name: 'Axe' })).toBeInTheDocument()
  })

  it('opens gear detail from a match', async () => {
    const tentId = anId()
    const store = await seededStore([
      gearRecorded(tentId, { name: 'Tent', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'tent')
    await user.click(screen.getByRole('link', { name: 'Tent' }))

    expect(await screen.findByText(`Gear detail ${tentId}`)).toBeInTheDocument()
  })

  it('lists recent searches', async () => {
    const axeId = anId()
    const store = await seededStore([
      gearRecorded(axeId, { name: 'Axe', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'axe')
    await user.clear(searchField())

    expect(screen.getByText('RECENT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'axe' })).toBeInTheDocument()
  })

  // The logo header is the phone shell's, and Depot withholds it at Desktop
  // because the sidebar there already carries the logo (`AppShell`). Find
  // drew it at every width, so Desktop showed two — the one drift the three
  // destination screens had between them.
  it('draws the logo header below Desktop and withholds it there', async () => {
    const store = await seededStore([])

    renderFind(store)
    expect(screen.getByText('foerier')).toBeInTheDocument()
    cleanup()

    setViewport(SPLIT, DESKTOP)
    renderFind(store)
    expect(screen.queryByText('foerier')).toBeNull()
  })
})
