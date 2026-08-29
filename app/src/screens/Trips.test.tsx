import {
  createHlcClock,
  personRecorded,
  tripCreated,
  tripDatesSet,
  tripParticipantAdded,
  tripPhaseMoved,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { Trips } from './Trips'

/**
 * A **real** store seeded by emitting real ops, as every screen test in this
 * directory does. It matters more than usual here because the three sections
 * are `tripSections`' partition and its order: a hand-shaped `DepotState`
 * could put a Trip in a section the fold would never place it in, and the
 * assertion that the list reads top to bottom would then prove nothing.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

/** The seed's wall clock — `DAY N` counts local calendar days from it. */
const SEEDED_AT = 1_700_000_000_000

let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

function fixedClock(): Clock {
  return { now: () => SEEDED_AT }
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
  /** The phase moves authored **since** the seed — the screen's own output. */
  moves: () => Promise<readonly { trip: string; phase: unknown }[]>
}

async function seeded(...specs: readonly OpSpec[]): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const before = (await phaseMoves(log)).length
  return { store, moves: async () => (await phaseMoves(log)).slice(before) }
}

async function phaseMoves(log: OpLog) {
  const all = await log.all()
  return all
    .filter((entry) => entry.op.type === 'trip.phase_moved')
    .map((entry) => ({
      trip: entry.op.aggregate_id,
      phase: entry.op.payload['phase'],
    }))
}

function renderTrips({ store }: Seeded) {
  render(
    <DepotProvider value={store}>
      <Trips />
    </DepotProvider>,
  )
}

/** Every drawn Trip, in DOM order — cards and ledger rows alike. */
function drawn(): (string | undefined)[] {
  return screen.getAllByTestId('trip-entry').map((node) => node.dataset['trip'])
}

const ALPS = 'tttttttt-0000-7000-8000-00000000000a'
const VOSGES = 'tttttttt-0000-7000-8000-00000000000b'
const TESSIN = 'tttttttt-0000-7000-8000-00000000000c'
const SCOTLAND = 'tttttttt-0000-7000-8000-00000000000d'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Trips screen', () => {
  it('says so plainly when the household has no Trips', async () => {
    renderTrips(await seeded())

    // The line `/trips` has drawn since the shell existed, kept word for word.
    expect(screen.getByText('No trips.')).toBeVisible()
    expect(screen.queryAllByTestId('trip-entry')).toHaveLength(0)
    // `+ NEW` survives the empty state: without it the first Trip could never
    // be created.
    expect(screen.getByRole('link', { name: '+ NEW' })).toHaveAttribute(
      'href',
      '/trips/new',
    )
  })

  it('draws the three sections in order, and heads only the last', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(TESSIN, 'Tessin 2025'),
        tripDatesSet(TESSIN, { start: '2025-07-04' }),
        tripPhaseMoved(TESSIN, 'closed'),
        tripCreated(VOSGES, 'Vosges — Oct'),
        tripCreated(ALPS, 'Alps 2026'),
        tripPhaseMoved(ALPS, 'pack_out'),
      ),
    )

    expect(drawn()).toEqual([ALPS, VOSGES, TESSIN])
    // The board puts the active card and the draft card under the title with
    // nothing between them: a header over a single card is noise. `ACTIVE` and
    // `PLANNED` are how the selector partitions, not drawn copy.
    expect(screen.getByText('CLOSED')).toBeVisible()
    expect(screen.queryByText('ACTIVE')).toBeNull()
    expect(screen.queryByText('PLANNED')).toBeNull()
  })

  it('draws active Trips as cards and planned Trips as dashed ones', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        personRecorded('els', 'Els'),
        tripCreated(ALPS, 'Alps 2026'),
        tripParticipantAdded(ALPS, 'els'),
        tripPhaseMoved(ALPS, 'on_trip'),
        tripCreated(VOSGES, 'Vosges — Oct'),
      ),
    )

    expect(screen.getByTestId(`trip-card-${ALPS}`)).toHaveAttribute(
      'data-variant',
      'active',
    )
    expect(screen.getByTestId(`trip-card-${VOSGES}`)).toHaveAttribute(
      'data-variant',
      'planned',
    )
  })

  it('renders every active Trip, not just the one the board drew', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(ALPS, 'Alps 2026'),
        tripDatesSet(ALPS, { start: '2026-08-14' }),
        tripPhaseMoved(ALPS, 'pack_out'),
        tripCreated(VOSGES, 'Vosges — Oct'),
        tripDatesSet(VOSGES, { start: '2026-10-02' }),
        tripPhaseMoved(VOSGES, 'unpack'),
      ),
    )

    // Over-claim is guarded, not prevented, so two active Trips are a
    // reachable and legitimate state (spec §3.5). Start date ascending.
    expect(drawn()).toEqual([ALPS, VOSGES])
  })

  it('orders the closed section most recent first', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(SCOTLAND, 'Scotland 2024'),
        tripDatesSet(SCOTLAND, { start: '2024-05-11' }),
        tripPhaseMoved(SCOTLAND, 'closed'),
        tripCreated(TESSIN, 'Tessin 2025'),
        tripDatesSet(TESSIN, { start: '2025-07-04' }),
        tripPhaseMoved(TESSIN, 'closed'),
      ),
    )

    // Ascending forward and descending back: what happened wants the most
    // recent first.
    expect(drawn()).toEqual([TESSIN, SCOTLAND])
  })

  it('takes the closed rows meta from the dates that exist, and no others', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(TESSIN, 'Tessin 2025'),
        tripDatesSet(TESSIN, { start: '2025-07-04', end: '2025-07-19' }),
        tripPhaseMoved(TESSIN, 'closed'),
        tripCreated(SCOTLAND, 'Scotland 2024'),
        tripPhaseMoved(SCOTLAND, 'closed'),
      ),
    )

    // The board's `JUL 2025 · 54 PIECES · 1 LOST` needs S7's Entries and S10's
    // outcomes; the segment that exists today is the date, and a Trip with no
    // start date simply has none rather than a fabricated one.
    const tessin = screen.getByTestId(`closed-meta-${TESSIN}`)
    expect(tessin).toHaveTextContent('JUL 2025')
    expect(tessin.textContent).not.toContain('PIECES')
    expect(screen.queryByTestId(`closed-meta-${SCOTLAND}`)).toBeNull()
  })

  it('reopens a closed Trip into Unpack, once the decision is taken', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const store = await seeded(
      tripCreated(TESSIN, 'Tessin 2025'),
      tripPhaseMoved(TESSIN, 'closed'),
    )
    renderTrips(store)

    await user.click(screen.getByRole('button', { name: 'Reopen Tessin 2025' }))

    // The ledger row's reopen targets `unpack` specifically, which is why this
    // surface renders the board's sentence word for word.
    const confirm = screen.getByRole('alertdialog')
    expect(confirm).toHaveTextContent(
      'It returns to Unpack exactly as it stood. Closing cleared nothing.',
    )
    expect(await store.moves()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    await store.store.getState().drained()

    expect(await store.moves()).toEqual([{ trip: TESSIN, phase: 'unpack' }])
  })

  it('writes nothing when the reopen is declined', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const store = await seeded(
      tripCreated(TESSIN, 'Tessin 2025'),
      tripPhaseMoved(TESSIN, 'closed'),
    )
    renderTrips(store)

    await user.click(screen.getByRole('button', { name: 'Reopen Tessin 2025' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await store.store.getState().drained()

    expect(await store.moves()).toEqual([])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('opens SET PHASE from a cards chip, for that card and no other', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const store = await seeded(
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'pack_out'),
      tripCreated(VOSGES, 'Vosges — Oct'),
    )
    renderTrips(store)

    // `{open && <PhaseSheet …/>}`: one sheet exists at a time, mounted by the
    // screen, because `ui/`'s primitives have no `open` prop and mount is what
    // resets a sheet's own state.
    expect(screen.queryByRole('dialog')).toBeNull()

    const chips = screen.getAllByTestId('phase-chip')
    await user.click(chips[1]!)

    const sheet = screen.getByRole('dialog')
    expect(sheet).toHaveTextContent('Set phase')

    await user.click(screen.getByRole('button', { name: /ON TRIP/ }))
    await store.store.getState().drained()

    expect(await store.moves()).toEqual([{ trip: VOSGES, phase: 'on_trip' }])
  })
})
