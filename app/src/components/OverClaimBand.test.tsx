import {
  createHlcClock,
  gearRecorded,
  overClaimsFor,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripParticipantAdded,
  tripPhaseMoved,
  tripRenamed,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { OverClaimBand } from './OverClaimBand'

/**
 * A **real** store, seeded by emitting real ops — `TripCard.test.tsx`'s rule:
 * `overClaims(state)` is a fold of registers (spec §3.5), so a hand-shaped
 * `OverClaim` would test a shape the reducer might never actually produce.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000007'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000007'
const SEEDED_AT = 1_700_000_000_000

const HERE = 'trip-here'
const ALPS = 'trip-alps'
const JURA = 'trip-jura'

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

async function seeded(
  ...specs: readonly OpSpec[]
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

function renderBand(
  store: StoreApi<DepotStoreState>,
  tripId: string,
  overrides: {
    onRemoveHere?: (entryId: string) => void
    onRemoveThere?: (tripId: string, entryId: string) => void
    onBringFewer?: (entryId: string, count: number) => void
  } = {},
) {
  const state = store.getState().state
  const overClaims = overClaimsFor(state, tripId)
  render(
    <DepotProvider value={store}>
      <OverClaimBand
        tripId={tripId}
        overClaims={overClaims}
        onRemoveHere={overrides.onRemoveHere ?? vi.fn()}
        onRemoveThere={overrides.onRemoveThere ?? vi.fn()}
        onBringFewer={overrides.onBringFewer ?? vi.fn()}
      />
    </DepotProvider>,
  )
  return overClaims
}

describe('the copy table', () => {
  it('names one other Trip, singular entry, "already"', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'tent' }),
    )

    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 1 entry is already claimed by Alps 2026.',
    )
    const row = screen.getByTestId('over-claim-row-tent')
    expect(row).toHaveTextContent('Tent, tunnel 4p')
    // No Trip name on the row: the line above already named the one Trip.
    expect(row).toHaveTextContent('SINGLE · STILL OUT')
    expect(row).not.toHaveTextContent('Alps')
    expect(
      within(row).getByRole('button', { name: 'REMOVE HERE' }),
    ).toBeVisible()
    expect(
      within(row).getByRole('button', { name: 'REMOVE ON ALPS' }),
    ).toBeVisible()
  })

  it('names one other Trip, plural entries', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      gearRecorded('trangia', {
        name: 'Trangia 25',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-tent-here', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(ALPS, 'e-tent-alps', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(HERE, 'e-trangia-here', {
        from: 'depot',
        gearId: 'trangia',
      }),
      tripEntryAdded(ALPS, 'e-trangia-alps', {
        from: 'depot',
        gearId: 'trangia',
      }),
    )

    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 2 entries are already claimed by Alps 2026.',
    )
  })

  it('counts other Trips instead of naming one, from two — and each row carries its own', async () => {
    const store = await seeded(
      gearRecorded('g1', {
        name: 'Gear one',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g2', {
        name: 'Gear two',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g3', {
        name: 'Gear three',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g4', {
        name: 'Gear four',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g5', {
        name: 'Gear five',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripCreated(JURA, 'Jura 2026'),
      tripPhaseMoved(JURA, 'on_trip'),
      tripEntryAdded(HERE, 'e-g1-here', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(ALPS, 'e-g1-alps', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(HERE, 'e-g2-here', { from: 'depot', gearId: 'g2' }),
      tripEntryAdded(JURA, 'e-g2-jura', { from: 'depot', gearId: 'g2' }),
      tripEntryAdded(HERE, 'e-g3-here', { from: 'depot', gearId: 'g3' }),
      tripEntryAdded(ALPS, 'e-g3-alps', { from: 'depot', gearId: 'g3' }),
      tripEntryAdded(HERE, 'e-g4-here', { from: 'depot', gearId: 'g4' }),
      tripEntryAdded(JURA, 'e-g4-jura', { from: 'depot', gearId: 'g4' }),
      tripEntryAdded(HERE, 'e-g5-here', { from: 'depot', gearId: 'g5' }),
      tripEntryAdded(ALPS, 'e-g5-alps', { from: 'depot', gearId: 'g5' }),
    )

    const overClaims = renderBand(store, HERE)
    expect(overClaims).toHaveLength(5)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 5 entries are claimed by 2 other trips.',
    )
    // Each visible row carries its own Trip, not a repeated headline name.
    expect(screen.getByTestId('over-claim-row-g1')).toHaveTextContent(
      'SINGLE · STILL OUT · Alps 2026',
    )
    expect(screen.getByTestId('over-claim-row-g2')).toHaveTextContent(
      'SINGLE · STILL OUT · Jura 2026',
    )
  })

  it('names an unnamed Trip mid-sentence as "an unnamed trip"', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'temp'),
      tripRenamed(ALPS, null),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'tent' }),
    )

    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 1 entry is already claimed by an unnamed trip.',
    )
  })
})

describe('a claim with no other Trip to name', () => {
  it('states the gear was claimed more than once here, without inventing a Trip name', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      // Two offline Devices both add the same Gear to the same Trip: two
      // Entries, one gear, no other Trip in sight (ruling 12).
      tripEntryAdded(HERE, 'e-first', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(HERE, 'e-second', { from: 'depot', gearId: 'tent' }),
    )

    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 2 entries claim more of this gear than the depot holds.',
    )
    const row = screen.getByTestId('over-claim-row-tent')
    expect(row).toHaveTextContent('SINGLE · LISTED ×2')
    expect(row).not.toHaveTextContent('STILL OUT')
    // No other Trip to remove from: the only settle route is here.
    expect(within(row).getAllByRole('button')).toHaveLength(1)
    expect(
      within(row).getByRole('button', { name: 'REMOVE HERE' }),
    ).toBeVisible()
  })
})

describe('the Counted settle route', () => {
  it('offers BRING FEWER HERE computed from the excess, not REMOVE HERE', async () => {
    const onBringFewer = vi.fn()
    const store = await seeded(
      gearRecorded('bag', {
        name: 'Sleeping bag, winter',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'bag' }),
      tripEntryBringCountSet(HERE, 'e-here', 2),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'bag' }),
      tripEntryBringCountSet(ALPS, 'e-alps', 1),
    )

    const overClaims = renderBand(store, HERE, { onBringFewer })
    expect(overClaims).toEqual([
      expect.objectContaining({ gearId: 'bag', supply: 2, claimed: 3 }),
    ])

    const row = screen.getByTestId('over-claim-row-bag')
    expect(row).toHaveTextContent('×2 LISTED · ×1 OUT · OWNED ×2')
    expect(
      within(row).queryByRole('button', { name: 'REMOVE HERE' }),
    ).toBeNull()

    const user = userEvent.setup()
    await user.click(within(row).getByRole('button', { name: 'BRING ×1 HERE' }))
    expect(onBringFewer).toHaveBeenCalledWith('e-here', 1)
  })
})

describe('a per-person over-claim', () => {
  it('names the contested People rather than a supply number', async () => {
    const store = await seeded(
      gearRecorded('headlamp', {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      personRecorded('mark', 'Mark'),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripParticipantAdded(HERE, 'mark'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      // Mark is on both rosters — a per-person Entry draws the *whole* Trip
      // roster, so this is the one Person two Trips both actually claim.
      tripParticipantAdded(ALPS, 'mark'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'headlamp' }),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'headlamp' }),
    )

    renderBand(store, HERE)

    const row = screen.getByTestId('over-claim-row-headlamp')
    expect(row).toHaveTextContent('PER-PERSON · CONTESTED Mark')
    expect(row).not.toHaveTextContent('OWNED')
    expect(
      within(row).getByRole('button', { name: 'REMOVE HERE' }),
    ).toBeVisible()
    expect(
      within(row).getByRole('button', { name: 'REMOVE ON ALPS' }),
    ).toBeVisible()
  })
})

describe('the row cap', () => {
  async function seededWithFiveConflicts() {
    return seeded(
      gearRecorded('g1', {
        name: 'Gear one',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g2', {
        name: 'Gear two',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g3', {
        name: 'Gear three',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g4', {
        name: 'Gear four',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g5', {
        name: 'Gear five',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-g1-here', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(ALPS, 'e-g1-alps', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(HERE, 'e-g2-here', { from: 'depot', gearId: 'g2' }),
      tripEntryAdded(ALPS, 'e-g2-alps', { from: 'depot', gearId: 'g2' }),
      tripEntryAdded(HERE, 'e-g3-here', { from: 'depot', gearId: 'g3' }),
      tripEntryAdded(ALPS, 'e-g3-alps', { from: 'depot', gearId: 'g3' }),
      tripEntryAdded(HERE, 'e-g4-here', { from: 'depot', gearId: 'g4' }),
      tripEntryAdded(ALPS, 'e-g4-alps', { from: 'depot', gearId: 'g4' }),
      tripEntryAdded(HERE, 'e-g5-here', { from: 'depot', gearId: 'g5' }),
      tripEntryAdded(ALPS, 'e-g5-alps', { from: 'depot', gearId: 'g5' }),
    )
  }

  it('caps at three rows and offers + N MORE', async () => {
    const store = await seededWithFiveConflicts()
    renderBand(store, HERE)

    expect(screen.getAllByTestId(/^over-claim-row-/)).toHaveLength(3)
    expect(screen.getByTestId('over-claim-more')).toHaveTextContent('+ 2 MORE')
  })

  it('expands in place when + N MORE is clicked, with no scroll container', async () => {
    const store = await seededWithFiveConflicts()
    renderBand(store, HERE)
    const user = userEvent.setup()

    const rowsContainer = screen.getByTestId('over-claim-rows')
    expect(rowsContainer).not.toHaveStyle({ overflowY: 'auto' })
    expect(rowsContainer).not.toHaveStyle({ overflowY: 'scroll' })

    await user.click(screen.getByTestId('over-claim-more'))

    expect(screen.getAllByTestId(/^over-claim-row-/)).toHaveLength(5)
    expect(screen.queryByTestId('over-claim-more')).toBeNull()
    expect(rowsContainer).not.toHaveStyle({ overflowY: 'auto' })
    expect(rowsContainer).not.toHaveStyle({ overflowY: 'scroll' })
  })
})

describe('an unnamed Trip inside a row', () => {
  async function seededWithNamedAndUnnamedOtherTrips() {
    return seeded(
      gearRecorded('g1', {
        name: 'Gear one',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g2', {
        name: 'Gear two',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripCreated(JURA, 'temp'),
      tripRenamed(JURA, null),
      tripPhaseMoved(JURA, 'on_trip'),
      tripEntryAdded(HERE, 'e-g1-here', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(ALPS, 'e-g1-alps', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(HERE, 'e-g2-here', { from: 'depot', gearId: 'g2' }),
      tripEntryAdded(JURA, 'e-g2-jura', { from: 'depot', gearId: 'g2' }),
    )
  }

  it('renders an unnamed Trip as "Unnamed trip" in a row', async () => {
    const store = await seededWithNamedAndUnnamedOtherTrips()
    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-row-g2')).toHaveTextContent(
      'SINGLE · STILL OUT · Unnamed trip',
    )
    expect(
      within(screen.getByTestId('over-claim-row-g2')).getByRole('button', {
        name: 'REMOVE ON UNNAMED TRIP',
      }),
    ).toBeVisible()
  })

  it('renders no ▲ beside the unnamed name — the data is right', async () => {
    const store = await seededWithNamedAndUnnamedOtherTrips()
    renderBand(store, HERE)

    const row = screen.getByTestId('over-claim-row-g2')
    expect(row.textContent?.includes('▲')).toBe(false)
    // The one ▲ in the whole band is the headline's.
    expect(
      screen.getByTestId('over-claim-attention').textContent?.match(/▲/g),
    ).toHaveLength(1)
  })
})

describe('when there is nothing to settle', () => {
  it('renders nothing at all when there are no over-claims', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'tent' }),
    )

    const { container } = render(
      <DepotProvider value={store}>
        <OverClaimBand
          tripId={HERE}
          overClaims={[]}
          onRemoveHere={vi.fn()}
          onRemoveThere={vi.fn()}
          onBringFewer={vi.fn()}
        />
      </DepotProvider>,
    )

    expect(screen.queryByTestId('over-claim-band')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })
})

describe('settle callbacks', () => {
  it('wires REMOVE HERE and REMOVE ON to the right entry and Trip', async () => {
    const onRemoveHere = vi.fn()
    const onRemoveThere = vi.fn()
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'tent' }),
    )

    renderBand(store, HERE, { onRemoveHere, onRemoveThere })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'REMOVE HERE' }))
    expect(onRemoveHere).toHaveBeenCalledWith('e-here')

    await user.click(screen.getByRole('button', { name: 'REMOVE ON ALPS' }))
    expect(onRemoveThere).toHaveBeenCalledWith(ALPS, 'e-alps')
  })
})
