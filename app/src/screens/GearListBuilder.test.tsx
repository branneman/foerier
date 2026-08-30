import {
  createHlcClock,
  gearRecorded,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripParticipantAdded,
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

/**
 * Renders the builder over the given store, wrapped exactly as `App.tsx`
 * mounts it: inside a `Router` with `searchHook` wired (`Devices.tsx`'s own
 * `?signout` precedent) so the door query param resolves, and with `/trips`
 * and `/trips/:id` as destinations a test can assert the back link's `href`
 * against without simulating full navigation. `path` overrides the door
 * shorthand entirely, for a query string a door alone can't express (S7
 * review, the multi-param regression below).
 */
function renderBuilder(
  store: StoreApi<DepotStoreState>,
  props: { tripId?: string; door?: 'trips' | 'trip'; path?: string } = {},
) {
  const tripId = props.tripId ?? ALPS
  const path =
    props.path ??
    (props.door === 'trips'
      ? `/trips/${tripId}/list?from=trips`
      : `/trips/${tripId}/list`)
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
  it('renders both panes at Split, with the header in the right pane and no Desktop strip', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store)

    expect(screen.getByText('FROM THE DEPOT')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Alps 2026 — gear list' }),
    ).toBeVisible()
    // S7 review F1: below Desktop the band lives in the right pane, not as a
    // full-width strip above the grid.
    expect(screen.queryByTestId('gear-list-builder-desk-header')).toBeNull()
  })

  it('renders both panes at Desktop, with a full-width strip above the grid', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store)

    expect(screen.getByText('FROM THE DEPOT')).toBeVisible()
    expect(screen.getByTestId('gear-list-builder-desk-header')).toBeVisible()
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

describe('the gear list builder — the Desktop strip (S7 review F1)', () => {
  const ELS = '0f0000aa-0000-4000-8000-0000000000bb'

  it('carries participant initials and the N PIECES read', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store } = await seededStore(
      personRecorded(ELS, 'Els'),
      tripCreated(ALPS, 'Alps 2026'),
      tripParticipantAdded(ALPS, ELS),
      gearRecorded('g-single', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
    )
    renderBuilder(store)

    expect(screen.getByRole('img', { name: 'Participants: Els' })).toBeVisible()
    expect(screen.getByTestId('gear-list-builder-pieces')).toHaveTextContent(
      '1 PIECE',
    )
  })

  it('omits the Participants cluster for a Trip with none', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store)

    expect(screen.queryByRole('img', { name: /Participants/ })).toBeNull()
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

  it('renders it for no other phase — pack_out', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'pack_out'),
    )
    renderBuilder(store)

    expect(screen.queryByRole('button', { name: 'Start pack-out' })).toBeNull()
  })

  // S7 review, "also fix": the previous version of this suite only ever
  // covered `pack_out`, so a `phaseOf` regression that returned `'draft'`
  // for a closed Trip would have passed unnoticed.
  it('renders it for no other phase — closed', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'closed'),
    )
    renderBuilder(store)

    expect(screen.queryByRole('button', { name: 'Start pack-out' })).toBeNull()
  })

  it('moves straight to pack-out when there is nothing to warn about', async () => {
    setViewport(SPLIT)
    const user = userEvent.setup()
    const { store, authored } = await seededStore(
      tripCreated(ALPS, 'Alps 2026'),
    )
    renderBuilder(store)

    await user.click(screen.getByRole('button', { name: 'Start pack-out' }))

    // No conflict, no preview: `PhaseSheet.tsx`'s own rule — "never blocks"
    // also means never adding a screen nobody needs.
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await authored()).toEqual([
      { type: 'trip.phase_moved', payload: { phase: 'pack_out' } },
    ])
    expect(
      screen.getByRole('heading', { name: 'Alps 2026 — gear list' }),
    ).toBeVisible()
  })

  it('opens the over-claim preview when a Draft would clash on activation', async () => {
    setViewport(SPLIT)
    const user = userEvent.setup()
    const { store, authored } = await seededStore(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(ALPS, 'Alps 2026'),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'tent' }),
      tripCreated(JURA, 'Jura 2025'),
      tripPhaseMoved(JURA, 'pack_out'),
      tripEntryAdded(JURA, 'e-jura', { from: 'depot', gearId: 'tent' }),
    )
    renderBuilder(store)

    await user.click(screen.getByRole('button', { name: 'Start pack-out' }))

    const confirm = screen.getByRole('alertdialog')
    expect(confirm).toHaveTextContent('Start pack-out — Alps 2026?')
    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 1 entry is already claimed by Jura 2025.',
    )
    // Not moved yet — a preview states the conflict, it does not decide for
    // the Quartermaster.
    expect(await authored()).toEqual([])
  })
})

describe('the gear list builder — the dashed trip-only row', () => {
  it('opens Trip-only entry, which owns its own write', async () => {
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
    expect(
      screen.getByRole('dialog', { name: 'Trip-only entry' }),
    ).toBeVisible()
    expect(await authored()).toEqual([])

    await user.type(screen.getByLabelText('Name'), 'Guy-line kit')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(screen.queryByRole('dialog', { name: 'Trip-only entry' })).toBeNull()
    expect(await authored()).toEqual([
      {
        type: 'trip.entry_added',
        payload: {
          entry_id: expect.any(String),
          source: {
            from: 'trip_only',
            name: 'Guy-line kit',
            container: false,
          },
        },
      },
    ])
    // Still on the builder: no navigation away.
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

  /**
   * S7 review F4: `splitPane` alone is the wrong proxy at Desktop for this
   * screen specifically, because its two doors don't agree on whether the
   * sidebar already carries their destination. `/trips` (the "trips" door)
   * is the sidebar's own `TRIPS` row — withheld, same as every other
   * `splitPane: false` screen. `/trips/:id` (the "trip" door) names one
   * specific Trip, which no sidebar row ever carries — kept.
   */
  it('withholds the back link at Desktop for the trips door', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store, { door: 'trips' })

    expect(screen.queryByRole('link', { name: /‹/ })).toBeNull()
  })

  it('draws the back link at Desktop for the trip door, unlike every other splitPane: false screen', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store, { door: 'trip' })

    expect(screen.getByRole('link', { name: '‹ Alps 2026' })).toHaveAttribute(
      'href',
      `/trips/${ALPS}`,
    )
  })

  it('draws the trip-door back link exactly once at Desktop — the right pane does not also draw its own', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store, { door: 'trip' })

    expect(screen.getAllByRole('link', { name: /‹/ })).toHaveLength(1)
  })

  // S7 review, "also fix": `search === 'from=trips'` matched the whole query
  // string, so a second param ahead of `from` would silently fall back to
  // the trip door — a trap for Task 13, which owns appending it and may one
  // day compose it with another param.
  it('reads the door correctly out of a multi-param query string', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store } = await seededStore(tripCreated(ALPS, 'Alps 2026'))
    renderBuilder(store, { path: `/trips/${ALPS}/list?x=1&from=trips` })

    expect(screen.queryByRole('link', { name: /‹/ })).toBeNull()
  })
})

describe('the gear list builder — no weight anywhere', () => {
  // S7 review, "also fix": the previous version of this test set one width
  // and seeded a Trip with **zero** Entries, so no computation that could
  // ever produce a weight (or read a Draft's `Start pack-out`, or draw the
  // Desktop strip's `N PIECES`) actually ran — it could not have failed
  // against a real regression. Seeded with a Counted Entry (so `pieceLabel`
  // has a real, non-zero count to format) and checked at both widths the
  // builder renders at.
  function withEntries(): readonly OpSpec[] {
    return [
      tripCreated(ALPS, 'Alps 2026'),
      gearRecorded('g-counted', {
        name: 'Tent stake',
        container: false,
        kind: 'counted',
      }),
      tripEntryAdded(ALPS, 'e-counted', {
        from: 'depot',
        gearId: 'g-counted',
      }),
    ]
  }

  it('draws no EST … KG at Split', async () => {
    setViewport(SPLIT)
    const { store } = await seededStore(...withEntries())
    renderBuilder(store)

    expect(screen.queryByText(/EST/)).toBeNull()
    expect(screen.queryByText(/KG/)).toBeNull()
  })

  it('draws no EST … KG at Desktop', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store } = await seededStore(...withEntries())
    renderBuilder(store)

    expect(screen.queryByText(/EST/)).toBeNull()
    expect(screen.queryByText(/KG/)).toBeNull()
  })
})
