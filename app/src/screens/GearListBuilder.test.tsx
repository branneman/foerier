import {
  createHlcClock,
  gearRecorded,
  tripCreated,
  tripEntryAdded,
  tripPhaseMoved,
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

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { DESKTOP, SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { GearListBuilder } from './GearListBuilder'

/**
 * `Trip.test.tsx`'s and `DepotPicker.test.tsx`'s own fixtures — a **real**
 * store, seeded by emitting real ops, never a hand-shaped `DepotState`.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const ALPS = 'tttttttt-0000-7000-8000-00000000000a'

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

interface Seeded {
  store: StoreApi<DepotStoreState>
  /** Everything the *screen* authored — the seed is subtracted. */
  authored: () => Promise<readonly { type: string; payload: object }[]>
}

async function seededStore(...specs: readonly OpSpec[]): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const seedCount = (await log.all()).length

  return {
    store,
    authored: async () => {
      await store.getState().drained()
      return (await log.all())
        .slice(seedCount)
        .map((entry) => ({ type: entry.op.type, payload: entry.op.payload }))
    },
  }
}

/**
 * Renders the builder over the given store, wrapped exactly as `App.tsx`
 * mounts it: inside a `Router` with `searchHook` wired (`Devices.tsx`'s own
 * `?signout` precedent) so the door query param resolves, and with `/trips`
 * and `/trips/:id` as destinations a test can assert the back link's `href`
 * against without simulating full navigation.
 */
function renderBuilder(
  store: StoreApi<DepotStoreState>,
  props: { tripId?: string; door?: 'trips' | 'trip' } = {},
) {
  const tripId = props.tripId ?? ALPS
  const path =
    props.door === 'trips'
      ? `/trips/${tripId}/list?from=trips`
      : `/trips/${tripId}/list`
  const location = memoryLocation({ path, record: true })
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <Switch>
        <Route path="/trips/:id/list">
          <DepotProvider value={store}>
            <GearListBuilder tripId={tripId} />
          </DepotProvider>
        </Route>
        <Route path="/trips/:id">{(params) => <p>Trip {params.id}</p>}</Route>
        <Route path="/trips">
          <p>Trips list</p>
        </Route>
      </Switch>
    </Router>,
  )
  return location
}

describe('the gear list builder — two panes', () => {
  it('renders both panes at Split', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store)

    expect(screen.getByText('FROM THE DEPOT')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Alps 2026 — gear list' }),
    ).toBeVisible()
  })

  it('renders both panes at Desktop', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store)

    expect(screen.getByText('FROM THE DEPOT')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Alps 2026 — gear list' }),
    ).toBeVisible()
  })

  it('renders No such trip. for an id the fold has never seen, rather than a broken pane', async () => {
    const { store } = await seededStore()
    renderBuilder(store, { tripId: 'ffffffff-0000-7000-8000-000000000099' })

    expect(screen.getByText('No such trip.')).toBeVisible()
    expect(screen.queryByText('FROM THE DEPOT')).toBeNull()
  })
})

describe('the gear list builder — footer totals, and no GEAR LIST band', () => {
  it('renders the footer totals bar and no GEAR LIST section band', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(
      tripCreated(ALPS, 'Alps 2026'),
      gearRecorded('g-single', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
    )
    renderBuilder(store)

    expect(screen.getByTestId('gear-list-builder-footer')).toHaveTextContent(
      '1 ENTRY · 1 PIECE · 0 PER-PERSON · 0 TRIP-ONLY',
    )
    expect(screen.queryByText('GEAR LIST')).toBeNull()
    expect(screen.queryByTestId('gear-list-band')).toBeNull()
  })

  it('pluralises every counted noun above one', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(
      tripCreated(ALPS, 'Alps 2026'),
      gearRecorded('g-a', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g-b', {
        name: 'Tent stake',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-a', { from: 'depot', gearId: 'g-a' }),
      tripEntryAdded(ALPS, 'e-b', { from: 'depot', gearId: 'g-b' }),
    )
    renderBuilder(store)

    expect(screen.getByTestId('gear-list-builder-footer')).toHaveTextContent(
      '2 ENTRIES · 2 PIECES · 0 PER-PERSON · 0 TRIP-ONLY',
    )
  })
})

describe('the gear list builder — Start pack-out', () => {
  it('renders Start pack-out for a Draft', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store)

    expect(screen.getByRole('button', { name: 'Start pack-out' })).toBeVisible()
  })

  it('renders it for no other phase', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'pack_out'),
    )
    renderBuilder(store)

    expect(screen.queryByRole('button', { name: 'Start pack-out' })).toBeNull()
  })

  it('does nothing yet — the over-claim preview is Task 14s', async () => {
    setViewport(SPLIT)
    const user = userEvent.setup()
    const { store, authored } = await seededStore(
      tripCreated(ALPS, 'Alps 2026'),
    )
    renderBuilder(store)

    await user.click(screen.getByRole('button', { name: 'Start pack-out' }))

    expect(await authored()).toEqual([])
    expect(
      screen.getByRole('heading', { name: 'Alps 2026 — gear list' }),
    ).toBeVisible()
  })
})

describe('the gear list builder — the dashed trip-only row', () => {
  it('does nothing yet — TripOnlySheet is Task 12s', async () => {
    setViewport(SPLIT)
    const user = userEvent.setup()
    const { store, authored } = await seededStore(
      tripCreated(ALPS, 'Alps 2026'),
    )
    renderBuilder(store)

    await user.click(
      screen.getByRole('button', {
        name: '+ TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE',
      }),
    )

    expect(await authored()).toEqual([])
    expect(
      screen.getByRole('heading', { name: 'Alps 2026 — gear list' }),
    ).toBeVisible()
  })
})

describe('the gear list builder — the two doors', () => {
  it('renders the trips back link when entered from the card', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store, { door: 'trips' })

    expect(screen.getByRole('link', { name: '‹ TRIPS' })).toHaveAttribute(
      'href',
      '/trips',
    )
  })

  it('renders the trip-name back link when entered from the section band', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store, { door: 'trip' })

    expect(screen.getByRole('link', { name: '‹ Alps 2026' })).toHaveAttribute(
      'href',
      `/trips/${ALPS}`,
    )
  })

  it('falls back to the trip-name door with no query at all', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    const location = memoryLocation({
      path: `/trips/${ALPS}/list`,
      record: true,
    })
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <DepotProvider value={store}>
          <GearListBuilder tripId={ALPS} />
        </DepotProvider>
      </Router>,
    )

    expect(screen.getByRole('link', { name: '‹ Alps 2026' })).toBeVisible()
  })

  it('withholds the back link at Desktop, where the sidebar carries TRIPS', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store)

    expect(screen.queryByRole('link', { name: /‹/ })).toBeNull()
  })
})

describe('the gear list builder — no weight anywhere', () => {
  it('draws no EST … KG at any width', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))

    setViewport(SPLIT)
    renderBuilder(store)
    expect(screen.queryByText(/EST/)).toBeNull()
    expect(screen.queryByText(/KG/)).toBeNull()
  })
})
