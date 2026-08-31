import {
  createHlcClock,
  gearRecorded,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripParticipantAdded,
  tripPieceRemoved,
  type Clock,
  type EntryState,
  type IdSource,
  type OpAuthor,
  type OpSpec,
  type TripState,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { PiecePicker } from './PiecePicker'

/**
 * `PhaseSheet.test.tsx`'s rule, carried over: this picker emits directly
 * (unlike `ParticipantPicker`, which hands its toggle up), so a **real**
 * `OpLog` is what proves "one op per tap" rather than a spy on a prop that
 * does not exist.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000007'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000007'
const TRIP = 'tttttttt-0000-7000-8000-000000000007'
const ENTRY = 'eeeeeeee-0000-7000-8000-000000000007'
const GEAR = 'gggggggg-0000-7000-8000-000000000007'
const SEEDED_AT = 1_700_000_000_000

let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `dddddddd-0000-7000-8000-${suffix}`
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
  trip: () => TripState
  entry: () => EntryState
  /** Every `trip.piece_*` op authored **since** the seed — the picker's
   * whole output, in order. */
  pieceOps: () => Promise<readonly { type: string; personId: unknown }[]>
}

/** Mark, Els and Kim on one Trip, one depot-sourced Headlamp Entry — the
 * fixture every test in this file starts from. `extra` layers on top, so a
 * test asking about a tombstone does not repeat the whole setup. */
async function seeded(...extra: readonly OpSpec[]): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  const specs: readonly OpSpec[] = [
    personRecorded('mark', 'Mark'),
    personRecorded('els', 'Els'),
    personRecorded('kim', 'Kim'),
    tripCreated(TRIP, 'Vosges'),
    tripParticipantAdded(TRIP, 'mark'),
    tripParticipantAdded(TRIP, 'els'),
    tripParticipantAdded(TRIP, 'kim'),
    gearRecorded(GEAR, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR }),
    ...extra,
  ]
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const baseline = (await allPieceOps(log)).length
  return {
    store,
    trip: () => store.getState().state.trips[TRIP]!,
    entry: () => store.getState().state.trips[TRIP]!.entries![ENTRY]!,
    pieceOps: async () => (await allPieceOps(log)).slice(baseline),
  }
}

async function allPieceOps(
  log: OpLog,
): Promise<readonly { type: string; personId: unknown }[]> {
  const all = await log.all()
  return all
    .filter((entry) => entry.op.type.startsWith('trip.piece_'))
    .map((entry) => ({
      type: entry.op.type,
      personId: entry.op.payload['person_id'],
    }))
}

function renderPicker(seed: Seeded) {
  let closed = 0
  render(
    <DepotProvider value={seed.store}>
      <PiecePicker
        trip={seed.trip()}
        entry={seed.entry()}
        onClose={() => {
          closed += 1
        }}
      />
    </DepotProvider>,
  )
  return { closes: () => closed }
}

describe('the piece picker', () => {
  it('states rather than asks', async () => {
    // Kim's Piece is out ahead of render, so the count reads 2 of 3 and the
    // title is the gear's own name — never the straw-man question the S8
    // design round redrew (docs/design/README.md §5d ruling C).
    const seed = await seeded(tripPieceRemoved(TRIP, ENTRY, 'kim'))
    renderPicker(seed)

    expect(screen.getByText('Headlamp')).toBeInTheDocument()
    expect(screen.getByText('WHO BRINGS ONE · 2 OF 3')).toBeInTheDocument()
  })

  it('emits one op per tap, in both directions', async () => {
    const user = userEvent.setup()
    const seed = await seeded(tripPieceRemoved(TRIP, ENTRY, 'kim'))
    renderPicker(seed)

    // Kim's Piece is out: the tap restores it.
    await user.click(screen.getByRole('button', { name: /Kim/ }))
    await seed.store.getState().drained()
    expect(await seed.pieceOps()).toEqual([
      { type: 'trip.piece_restored', personId: 'kim' },
    ])

    // Mark's Piece is in: the tap removes it.
    await user.click(screen.getByRole('button', { name: /Mark/ }))
    await seed.store.getState().drained()
    expect(await seed.pieceOps()).toEqual([
      { type: 'trip.piece_restored', personId: 'kim' },
      { type: 'trip.piece_removed', personId: 'mark' },
    ])
  })

  it('offers no all/none control', async () => {
    const seed = await seeded()
    renderPicker(seed)

    // A roster is a handful of rows — S9's long-press is a status gesture,
    // not this one (§5d ruling C).
    expect(
      screen.queryByRole('button', { name: /all/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /none/i }),
    ).not.toBeInTheDocument()
  })
})
