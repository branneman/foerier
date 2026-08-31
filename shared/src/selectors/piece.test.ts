import { describe, expect, it } from 'vitest'

import { anOp, aGear, aTrip, hlcAt } from '../../testUtils/index.ts'
import {
  tripEntryAdded,
  tripParticipantAdded,
  tripParticipantRemoved,
  tripPieceRemoved,
  type OpSpec,
} from '../authoring.ts'
import { emptyState, fold } from '../reduce.ts'
import type { DepotState, TripState } from '../state.ts'
import { pieceCountOf } from './entry.ts'
import { pieceInclusion, piecesOf } from './piece.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

/** The factories' own default millisecond, so `hlcAt` here matches theirs. */
const DEFAULT_MS = 1_700_000_000_000

const TRIP = 't1'
const ENTRY = 'e1'
const GEAR = 'g1'

const MARK = 'c0000000-0000-7000-8000-000000000001'
const ELS = 'c0000000-0000-7000-8000-000000000002'
const KIM = 'c0000000-0000-7000-8000-000000000003'

/**
 * Folds op specs through the real reducer, stamping each with an increasing
 * clock. Every fixture in this file goes through the fold rather than
 * hand-shaping a `TripState`, so a selector can never pass against a state
 * the reducer could not produce.
 */
function foldAt(ms: number, specs: readonly (readonly OpSpec[])[]): DepotState {
  return fold(
    specs
      .flat()
      .map((spec, i) => anOp(spec, { hlc: hlcAt(i + 1, ms), deviceId: DEV_A })),
    emptyState(),
  )
}

function depot(...specs: readonly (readonly OpSpec[])[]): DepotState {
  return foldAt(DEFAULT_MS, specs)
}

function trip(state: DepotState, id: string): TripState {
  return state.trips[id]!
}

function entryOf(state: DepotState) {
  return state.trips[TRIP]!.entries![ENTRY]!
}

describe('piecesOf', () => {
  it('is every Participant when no piece op has been authored', () => {
    const state = depot(aTrip({ id: TRIP, participants: [MARK, ELS, KIM] }), [
      tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR }),
    ])
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual(
      [MARK, ELS, KIM].sort(),
    )
  })

  it('subtracts a tombstoned Piece', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK, ELS, KIM] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
    )
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual(
      [MARK, ELS].sort(),
    )
  })

  it('gives a late Participant a Piece with no backfill op', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripParticipantAdded(TRIP, ELS)],
    )
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual(
      [MARK, ELS].sort(),
    )
  })

  it('keeps a tombstone across a Participant removal and re-add', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK, KIM] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
      [tripParticipantRemoved(TRIP, KIM)],
      [tripParticipantAdded(TRIP, KIM)],
    )
    // A tombstone never cascades (sync §3.5). Re-asserting "Kim is on the
    // trip" was never a statement about "Kim brings her own headlamp".
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual([MARK])
  })

  it('ignores a tombstone for a Person who is not a Participant', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
    )
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual([MARK])
  })

  it('is empty for a Trip with no Participants', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR }),
    ])
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual([])
  })
})

describe('pieceInclusion', () => {
  it('reports every Participant, included or not', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK, KIM] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
    )
    expect(pieceInclusion(entryOf(state), trip(state, TRIP))).toEqual(
      [
        { personId: MARK, included: true },
        { personId: KIM, included: false },
      ].sort((a, b) => (a.personId < b.personId ? -1 : 1)),
    )
  })
})

describe('pieceCountOf', () => {
  it('counts included Pieces, not Participants', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK, ELS, KIM] }),
      aGear({ id: GEAR, kind: 'per_person' }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
    )
    expect(pieceCountOf(entryOf(state), trip(state, TRIP), state)).toBe(2)
  })
})
