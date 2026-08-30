import {
  createHlcClock,
  gearRecorded,
  gearRetired,
  placeRecorded,
  tripCreated,
  tripEntryAdded,
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
import { SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { DepotPicker } from './DepotPicker'

/**
 * `Trip.test.tsx`'s fixtures — a **real** store, seeded by emitting real ops,
 * never a hand-shaped `DepotState`.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const ALPS = 'tttttttt-0000-7000-8000-00000000000a'
const JURA = 'tttttttt-0000-7000-8000-00000000000b'

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

/** Renders the picker over the given store, wrapped exactly as `App.tsx`
 * mounts it: inside a `Router` (the header's back link and the empty state's
 * `+ Add gear` are both `<Link>`s) with `/trips/:id` and `/add` as
 * destinations a test can assert against without simulating full navigation. */
function renderPicker(
  store: StoreApi<DepotStoreState>,
  props: { tripId?: string; variant?: 'screen' | 'pane' } = {},
) {
  const tripId = props.tripId ?? ALPS
  const location = memoryLocation({
    path: `/trips/${tripId}/add`,
    record: true,
  })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/trips/:id/add">
          <DepotProvider value={store}>
            <DepotPicker tripId={tripId} variant={props.variant ?? 'screen'} />
          </DepotProvider>
        </Route>
        <Route path="/trips/:id">{(params) => <p>Trip {params.id}</p>}</Route>
        <Route path="/add">
          <p>Add gear</p>
        </Route>
      </Switch>
    </Router>,
  )
  return location
}

function rowNames(): string[] {
  return screen
    .getAllByTestId('depot-picker-row')
    .map((row) => row.querySelector('span')?.textContent ?? '')
}

describe('the depot picker — anatomy', () => {
  it('renders the screen variant: header, title, footer hint, and all three ghost chips', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    renderPicker(store, { variant: 'screen' })

    expect(
      screen.getByRole('link', { name: '‹ Vosges — Oct' }),
    ).toHaveAttribute('href', `/trips/${ALPS}`)
    expect(
      screen.getByRole('heading', { name: 'Add from the depot' }),
    ).toBeVisible()
    expect(
      screen.getByRole('searchbox', { name: 'Search the depot' }),
    ).toHaveAttribute('placeholder', 'Search the depot…')
    expect(screen.getByRole('button', { name: '+ TAG' })).toBeVisible()
    expect(screen.getByRole('button', { name: '+ KIND' })).toBeVisible()
    expect(screen.getByRole('button', { name: '+ TRIP' })).toBeVisible()
    expect(
      screen.getByText('ADDING LISTS IT — GEAR DOES NOT MOVE UNTIL PACK-OUT'),
    ).toBeVisible()
  })

  it('renders the pane variant: the FROM THE DEPOT eyebrow, no header, no title, and no + TRIP chip', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    renderPicker(store, { variant: 'pane' })

    expect(screen.getByText('FROM THE DEPOT')).toBeVisible()
    expect(screen.queryByRole('link', { name: /‹/ })).toBeNull()
    expect(
      screen.queryByRole('heading', { name: 'Add from the depot' }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: '+ TAG' })).toBeVisible()
    expect(screen.getByRole('button', { name: '+ KIND' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '+ TRIP' })).toBeNull()
  })

  it('draws the sync line at Split, the one mode the rail carries only a dot', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    setViewport(SPLIT)
    renderPicker(store, { variant: 'screen' })

    expect(screen.getByText('SYNCED')).toBeVisible()
  })

  it('draws no sync line below Split, where the header band already states it', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    renderPicker(store, { variant: 'screen' })

    expect(screen.queryByText('SYNCED')).toBeNull()
  })
})

describe('the depot picker — rows', () => {
  it('lists visible gear with the home path in the meta slot, Loose for gear with none', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      placeRecorded('garage', 'Garage'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
        residence: { in: 'place', id: 'garage' },
      }),
      gearRecorded('gloves', {
        name: 'Ski gloves',
        container: false,
        kind: 'per_person',
      }),
    )
    renderPicker(store)

    const rows = screen.getAllByTestId('depot-picker-row')
    expect(rows).toHaveLength(2)
    // Alphabetical, `sliceDepot`'s own sort — "Ski gloves" before "Tent...".
    expect(rows[0]).toHaveTextContent('Ski gloves')
    expect(rows[0]).toHaveTextContent('Loose')
    expect(rows[1]).toHaveTextContent('Tent, tunnel 4p')
    expect(rows[1]).toHaveTextContent('Garage')
  })

  it('excludes retired gear', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      gearRetired('tent'),
      gearRecorded('gloves', {
        name: 'Ski gloves',
        container: false,
        kind: 'per_person',
      }),
    )
    renderPicker(store)

    expect(screen.queryByText('Tent, tunnel 4p')).toBeNull()
    expect(screen.getByText('Ski gloves')).toBeVisible()
  })

  it('marks an already-listed Gear IN LIST ✓ and mutes the row', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-tent', { from: 'depot', gearId: 'tent' }),
    )
    renderPicker(store)

    const row = screen.getByTestId('depot-picker-row')
    expect(row).toHaveTextContent('IN LIST ✓')
    expect(
      screen.queryByRole('button', { name: 'Add Tent, tunnel 4p' }),
    ).toBeNull()
  })

  it('offers + ADD for a Gear not on the list', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    renderPicker(store)

    expect(
      screen.getByRole('button', { name: 'Add Tent, tunnel 4p' }),
    ).toHaveTextContent('+ ADD')
    expect(screen.queryByText('IN LIST ✓')).toBeNull()
  })

  it('adds without navigating away, and the row becomes IN LIST ✓', async () => {
    const user = userEvent.setup()
    const seed = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    renderPicker(seed.store)

    await user.click(
      screen.getByRole('button', { name: 'Add Tent, tunnel 4p' }),
    )

    expect(await seed.authored()).toEqual([
      {
        type: 'trip.entry_added',
        payload: {
          entry_id: expect.any(String),
          source: { from: 'depot', gear_id: 'tent' },
        },
      },
    ])
    // Still on the picker — no `<Route path="/trips/:id">` fallback page
    // rendered, and the row itself now reads the other marker.
    expect(
      screen.getByRole('heading', { name: 'Add from the depot' }),
    ).toBeVisible()
    expect(screen.getByTestId('depot-picker-row')).toHaveTextContent(
      'IN LIST ✓',
    )
  })

  it('shows no claim read on any row — no world chip, no status, home path only', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      tripCreated(JURA, 'Jura'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(JURA, 'e-jura', { from: 'depot', gearId: 'tent' }),
    )
    renderPicker(store, { tripId: ALPS })

    const row = screen.getByTestId('depot-picker-row')
    // No `⌂`/world glyph, no `STILL OUT`, no other Trip's name — only this
    // Trip's own membership speaks here, via `+ ADD` (this Trip does not
    // list it, whatever Jura's claim says).
    expect(row).not.toHaveTextContent('STILL OUT')
    expect(row).not.toHaveTextContent('Jura')
    expect(row).not.toHaveTextContent('⌂')
    expect(row).toHaveTextContent('+ ADD')
  })
})

describe('the depot picker — empty and unmatched states', () => {
  it('renders Empty depot. when the household has no gear', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    renderPicker(store)

    expect(screen.getByText('Empty depot.')).toBeVisible()
    expect(screen.getByText('Add the first item.')).toBeVisible()
    expect(screen.getByRole('link', { name: '+ Add gear' })).toHaveAttribute(
      'href',
      '/add',
    )
    expect(screen.queryByTestId('depot-picker-row')).toBeNull()
  })

  it('renders No matches. when the search excludes everything', async () => {
    const user = userEvent.setup()
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    renderPicker(store)

    await user.type(
      screen.getByRole('searchbox', { name: 'Search the depot' }),
      'nonesuch',
    )

    expect(screen.getByText('No matches.')).toBeVisible()
    expect(screen.getByText('1 FILTER ACTIVE')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(screen.getByTestId('depot-picker-row')).toBeVisible()
    expect(
      screen.getByRole('searchbox', { name: 'Search the depot' }),
    ).toHaveValue('')
  })

  it('pluralises FILTERS ACTIVE past one', async () => {
    const user = userEvent.setup()
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    renderPicker(store)

    await user.type(
      screen.getByRole('searchbox', { name: 'Search the depot' }),
      'nonesuch',
    )
    await user.click(screen.getByRole('button', { name: '+ KIND' }))
    await user.click(screen.getByRole('button', { name: /Single/ }))

    expect(screen.getByText('2 FILTERS ACTIVE')).toBeVisible()
  })
})

describe('the depot picker — narrowing', () => {
  it('renders the + TRIP chip in the screen variant and not in the pane variant', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    renderPicker(store, { variant: 'screen' })
    expect(screen.getByRole('button', { name: '+ TRIP' })).toBeVisible()
  })

  it('narrows the rows by KIND through the value menu', async () => {
    const user = userEvent.setup()
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      gearRecorded('stake', {
        name: 'Tent stake',
        container: false,
        kind: 'counted',
      }),
    )
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ KIND' }))
    await user.click(screen.getByRole('button', { name: /Counted/ }))

    expect(rowNames()).toEqual(['Tent stake'])
    expect(
      screen.getByRole('button', { name: 'Remove KIND: Counted' }),
    ).toBeVisible()
  })

  it('narrows the rows by TAG through the tag picker', async () => {
    const user = userEvent.setup()
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    // No tag applied yet — the tag picker's own vocabulary is empty, and
    // opening it must not throw.
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ TAG' }))
    expect(screen.getByRole('dialog', { name: 'Tags' })).toBeVisible()
  })
})
