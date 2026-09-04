import {
  gearRecorded,
  personRecorded,
  placeRecorded,
  tripContainerStageSet,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripParticipantAdded,
  tripPhaseMoved,
  tripPieceRemoved,
  tripPieceStatusSet,
  type OpSpec,
} from '@foerier/shared'
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

/**
 * S9b: the plain row's whereabouts slot, the counted card's real trip
 * slices, and the new per-person card (`docs/design/README.md` §6,
 * §5f D6/D7/D9, spec §4.3).
 */
describe('Find — whereabouts reaches the screen', () => {
  it('reads the trip whereabouts on the plain row while the meta keeps the home path (D9)', async () => {
    const placeId = anId()
    const crateId = anId()
    const tentId = anId()
    const tripId = anId()
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
      tripCreated(tripId, 'Alps 2026'),
      tripPhaseMoved(tripId, 'pack_out'),
      tripEntryAdded(tripId, 'e-duffel', {
        from: 'trip_only',
        name: 'Duffel',
        container: true,
      }),
      tripContainerStageSet(tripId, 'e-duffel', 'car'),
      tripEntryAdded(tripId, 'e-tent', { from: 'depot', gearId: tentId }),
      tripEntryMoved(tripId, 'e-tent', {
        in: 'container',
        entryId: 'e-duffel',
      }),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'tent')

    const row = screen.getByRole('link', { name: 'Tent' })
    // D9: the same GearRow with the meta-slot swap — the whereabouts slot
    // states the trip, the meta beneath keeps the home path unchanged.
    expect(within(row).getByText('▸ Alps 2026 · CAR')).toBeInTheDocument()
    expect(within(row).getByText('⌂ Attic ▸ Crate B')).toBeInTheDocument()
  })

  it('shows one row per slice, at full density, for a Counted gear split home/trip', async () => {
    const mugId = anId()
    const tripId = anId()
    const store = await seededStore([
      gearRecorded(mugId, {
        name: 'Mug',
        container: false,
        kind: 'counted',
        owned_count: 5,
      }),
      tripCreated(tripId, 'Alps 2026'),
      tripPhaseMoved(tripId, 'pack_out'),
      tripEntryAdded(tripId, 'e-mug', { from: 'depot', gearId: mugId }),
      tripEntryBringCountSet(tripId, 'e-mug', 2),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'mug')

    const card = screen.getByRole('link', { name: 'Mug' })
    expect(within(card).getByText('COUNTED · ×5')).toBeInTheDocument()
    expect(within(card).getByText('⌂ LOOSE')).toBeInTheDocument()
    expect(within(card).getByText('▸ Alps 2026 · LOOSE')).toBeInTheDocument()
  })

  it('keeps two trip rows apart when two active Trips both claim a Counted gear', async () => {
    const mugId = anId()
    const alpsId = anId()
    const vosgesId = anId()
    const store = await seededStore([
      gearRecorded(mugId, {
        name: 'Mug',
        container: false,
        kind: 'counted',
        owned_count: 5,
      }),
      tripCreated(alpsId, 'Alps 2026'),
      tripPhaseMoved(alpsId, 'pack_out'),
      tripCreated(vosgesId, 'Vosges'),
      tripPhaseMoved(vosgesId, 'pack_out'),
      tripEntryAdded(alpsId, 'e-alps', { from: 'depot', gearId: mugId }),
      tripEntryBringCountSet(alpsId, 'e-alps', 2),
      tripEntryAdded(vosgesId, 'e-vosges', { from: 'depot', gearId: mugId }),
      tripEntryBringCountSet(vosgesId, 'e-vosges', 2),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'mug')

    const card = screen.getByRole('link', { name: 'Mug' })
    expect(within(card).getByText('▸ Alps 2026 · LOOSE')).toBeInTheDocument()
    expect(within(card).getByText('▸ Vosges · LOOSE')).toBeInTheDocument()
  })

  it('shows the per-person card with one row per Participant, in People-screen order, a removed Piece reading home with no mention of removal (B5)', async () => {
    const tripId = anId()
    const gearId = anId()
    const markId = anId()
    const elsId = anId()
    const store = await seededStore([
      personRecorded(markId, 'Mark'),
      personRecorded(elsId, 'Els'),
      tripCreated(tripId, 'Alps 2026'),
      tripPhaseMoved(tripId, 'pack_out'),
      tripParticipantAdded(tripId, markId),
      tripParticipantAdded(tripId, elsId),
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(tripId, 'e-headlamp', { from: 'depot', gearId }),
      tripPieceRemoved(tripId, 'e-headlamp', elsId),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'headlamp')

    const card = screen.getByTestId('find-per-person-card')
    expect(within(card).getByText('PER-PERSON · ×2')).toBeInTheDocument()

    const rows = within(card).getAllByTestId('find-person-row')
    expect(rows).toHaveLength(2)
    // People-screen order is alphabetic by label — Els before Mark.
    expect(
      within(rows[0] as HTMLElement).getByText('⌂ LOOSE'),
    ).toBeInTheDocument()
    expect(
      within(rows[1] as HTMLElement).getByText('▸ Alps 2026 · LOOSE'),
    ).toBeInTheDocument()
  })

  it('renders no per-person card and a plain row for per-person gear with nothing out', async () => {
    const tripId = anId()
    const gearId = anId()
    const markId = anId()
    const store = await seededStore([
      personRecorded(markId, 'Mark'),
      tripCreated(tripId, 'Alps 2026'),
      tripPhaseMoved(tripId, 'pack_out'),
      tripParticipantAdded(tripId, markId),
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(tripId, 'e-headlamp', { from: 'depot', gearId }),
      tripPieceRemoved(tripId, 'e-headlamp', markId),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'headlamp')

    expect(screen.queryByTestId('find-per-person-card')).toBeNull()
    expect(screen.getByRole('link', { name: 'Headlamp' })).toBeInTheDocument()
  })

  it("takes the unaccounted row's anatomy for a contested Piece — ▲ CLAIMED BY 2 TRIPS + a RESOLVE link to the first claiming Trip by name (D7)", async () => {
    const alpsId = anId()
    const vosgesId = anId()
    const gearId = anId()
    const markId = anId()
    const store = await seededStore([
      personRecorded(markId, 'Mark'),
      tripCreated(alpsId, 'Alps 2026'),
      tripPhaseMoved(alpsId, 'pack_out'),
      tripParticipantAdded(alpsId, markId),
      tripCreated(vosgesId, 'Vosges'),
      tripPhaseMoved(vosgesId, 'pack_out'),
      tripParticipantAdded(vosgesId, markId),
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(alpsId, 'e-alps', { from: 'depot', gearId }),
      tripEntryAdded(vosgesId, 'e-vosges', { from: 'depot', gearId }),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'headlamp')

    const card = screen.getByTestId('find-per-person-card')
    expect(within(card).getByText('▲ CLAIMED BY 2 TRIPS')).toBeInTheDocument()
    const resolve = within(card).getByRole('link', {
      name: 'Resolve on Alps 2026',
    })
    expect(resolve).toHaveTextContent('RESOLVE')
    expect(resolve).toHaveAttribute('href', `/trips/${alpsId}`)
    // RESOLVE wins over the trailing status slot — round 1's ordering.
    expect(within(card).queryByTestId('find-person-status')).toBeNull()
  })

  it("reads each row's trailing slot as that Piece's own packing status, or ⌂ HOME for a Participant reading home (round 1 fix)", async () => {
    const tripId = anId()
    const gearId = anId()
    const markId = anId()
    const elsId = anId()
    const kimId = anId()
    const store = await seededStore([
      personRecorded(markId, 'Mark'),
      personRecorded(elsId, 'Els'),
      personRecorded(kimId, 'Kim'),
      tripCreated(tripId, 'Alps 2026'),
      tripPhaseMoved(tripId, 'pack_out'),
      tripParticipantAdded(tripId, markId),
      tripParticipantAdded(tripId, elsId),
      tripParticipantAdded(tripId, kimId),
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(tripId, 'e-headlamp', { from: 'depot', gearId }),
      tripPieceStatusSet(tripId, 'e-headlamp', markId, 'packed'),
      // Els's Piece is included but never addressed by a status op — an
      // absent register reads `not_packed` (`pieceStatusOf`'s own rule).
      tripPieceRemoved(tripId, 'e-headlamp', kimId),
    ])
    const user = userEvent.setup()

    renderFind(store)
    await user.type(searchField(), 'headlamp')

    const card = screen.getByTestId('find-per-person-card')
    const rows = within(card).getAllByTestId('find-person-row')
    // People-screen order: Els, Kim, Mark.
    expect(
      within(rows[0] as HTMLElement).getByTestId('find-person-status'),
    ).toHaveTextContent('NOT PACKED')
    // Kim's Piece is removed — home, and the trailing slot says so, not a
    // packing status (a Piece at home has none).
    expect(
      within(rows[1] as HTMLElement).getByTestId('find-person-status'),
    ).toHaveTextContent('⌂ HOME')
    expect(
      within(rows[2] as HTMLElement).getByTestId('find-person-status'),
    ).toHaveTextContent('PACKED')
  })
})
