import { describe, expect, it } from 'vitest'

import { anOp, aTrip, hlcAt } from '../testUtils/index.ts'
import {
  tripPieceRemoved,
  tripPieceRestored,
  tripEntryAdded,
  type OpSpec,
} from './authoring.ts'
import { emptyState, fold } from './reduce.ts'
import type { DepotState } from './state.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'
const DEFAULT_MS = 1_700_000_000_000

function depot(...specs: readonly (readonly OpSpec[])[]): DepotState {
  return fold(
    specs
      .flat()
      .map((spec, i) =>
        anOp(spec, { hlc: hlcAt(i + 1, DEFAULT_MS), deviceId: DEV_A }),
      ),
    emptyState(),
  )
}

const TRIP = '50000000-0000-7000-8000-000000000001'
const ENTRY = 'e0000000-0000-7000-8000-000000000001'
const GEAR = 'a0000000-0000-7000-8000-000000000001'
const KIM = 'c0000000-0000-7000-8000-000000000003'

describe('trip.piece_removed / trip.piece_restored', () => {
  it('writes a tombstone on one Piece', () => {
    const state = depot(
      aTrip({ id: TRIP }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
    )
    expect(
      state.trips[TRIP]?.entries?.[ENTRY]?.pieces?.[KIM]?.removed?.value,
    ).toBe(true)
  })

  it('restores only when strictly later', () => {
    const later = depot(
      aTrip({ id: TRIP }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
      [tripPieceRestored(TRIP, ENTRY, KIM)],
    )
    expect(
      later.trips[TRIP]?.entries?.[ENTRY]?.pieces?.[KIM]?.removed?.value,
    ).toBe(false)
  })

  it('creates the Entry on sight when the piece op arrives first', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripPieceRemoved(TRIP, ENTRY, KIM),
    ])
    const entry = state.trips[TRIP]?.entries?.[ENTRY]
    expect(entry?.source).toBeUndefined()
    expect(entry?.pieces?.[KIM]?.removed?.value).toBe(true)
  })

  it('ignores a payload with no person_id, writing nothing', () => {
    const state = depot(
      aTrip({ id: TRIP }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [
        {
          type: 'trip.piece_removed',
          aggregate: 'trip',
          aggregate_id: TRIP,
          payload: { entry_id: ENTRY },
        } as unknown as OpSpec,
      ],
    )
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.pieces).toBeUndefined()
  })
})
