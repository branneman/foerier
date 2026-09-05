import { describe, expect, it } from 'vitest'

import { aGear, aPerson, aTrip, depot } from '../../testUtils/index.ts'
import {
  tripConsumedCountSet,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryRemoved,
  tripOutcomeSet,
  tripParticipantAdded,
  tripPieceRemoved,
} from '../authoring.ts'
import type { EntryState, HouseholdState, TripState } from '../state.ts'
import { packingItems, packingTotals } from './packing.ts'
import {
  consumedCountOf,
  countOfUnpack,
  isKnownOutcome,
  OUTCOMES,
  outcomeGlyph,
  outcomeLabel,
  outcomeOf,
  pieceOutcomeOf,
  type UnpackItem,
  unpackItems,
  unpackTotals,
} from './unpack.ts'

function tripFrom(state: HouseholdState, id: string): TripState {
  const trip = state.trips[id]
  if (trip === undefined) throw new Error(`the fold holds no Trip ${id}`)
  return trip
}

function entryFrom(trip: TripState, id: string): EntryState {
  const entry = trip.entries?.[id]
  if (entry === undefined) throw new Error(`the fold holds no Entry ${id}`)
  return entry
}

describe('outcomeOf and pieceOutcomeOf: absent and null both read open', () => {
  const TRIP = 't-outcome'
  const ABSENT = 'e-absent'
  const CLEARED = 'e-cleared'
  const BACK = 'e-back'

  const state = depot(
    aTrip({ id: TRIP, name: 'Outcome' }),
    aGear({ id: 'g-absent', name: 'Absent' }),
    aGear({ id: 'g-cleared', name: 'Cleared' }),
    aGear({ id: 'g-back', name: 'Back' }),
    [
      tripEntryAdded(TRIP, ABSENT, { from: 'depot', gearId: 'g-absent' }),
      tripEntryAdded(TRIP, CLEARED, { from: 'depot', gearId: 'g-cleared' }),
      tripOutcomeSet(TRIP, CLEARED, 'back'),
      tripOutcomeSet(TRIP, CLEARED, null),
      tripEntryAdded(TRIP, BACK, { from: 'depot', gearId: 'g-back' }),
      tripOutcomeSet(TRIP, BACK, 'back'),
    ],
  )

  it('reads null for an absent register — no op has ever addressed this outcome', () => {
    expect(entryFrom(tripFrom(state, TRIP), ABSENT).outcome).toBeUndefined()
    expect(outcomeOf(entryFrom(tripFrom(state, TRIP), ABSENT))).toBeNull()
  })

  it('reads null for an explicit null — a different fact about the log, read the same way', () => {
    expect(entryFrom(tripFrom(state, TRIP), CLEARED).outcome?.value).toBeNull()
    expect(outcomeOf(entryFrom(tripFrom(state, TRIP), CLEARED))).toBeNull()
  })

  it('reads an explicit outcome', () => {
    expect(outcomeOf(entryFrom(tripFrom(state, TRIP), BACK))).toBe('back')
  })

  it('pieceOutcomeOf(undefined) is null — a Piece no op has addressed', () => {
    expect(pieceOutcomeOf(undefined)).toBeNull()
  })
})

describe('consumedCountOf', () => {
  const TRIP = 't-consumed'
  const SINGLE = 'e-single'
  const PERPERSON = 'e-lamp'
  const TRIPONLY = 'e-triponly'
  const CONTAINER = 'e-crate'
  const MYSTERY = 'e-mystery'
  const UNSYNCED = 'e-unsynced'
  const COUNTED_VALUE = 'e-counted-value'
  const COUNTED_ZERO = 'e-counted-zero'
  const COUNTED_OVER = 'e-counted-over'
  const COUNTED_ABSENT = 'e-counted-absent'

  const state = depot(
    aTrip({ id: TRIP, name: 'Gate' }),
    aGear({ id: 'g-single', name: 'Single' }),
    aGear({ id: 'g-lamp', name: 'Lamp', kind: 'per_person' }),
    aGear({ id: 'g-crate', name: 'Crate', kind: 'counted', container: true }),
    aGear({ id: 'g-mystery', name: 'Mystery', kind: 'donated' }),
    aGear({ id: 'g-counted-value', name: 'Value', kind: 'counted' }),
    aGear({ id: 'g-counted-zero', name: 'Zero', kind: 'counted' }),
    aGear({ id: 'g-counted-over', name: 'Over', kind: 'counted' }),
    aGear({ id: 'g-counted-absent', name: 'Absent', kind: 'counted' }),
    [
      tripEntryAdded(TRIP, SINGLE, { from: 'depot', gearId: 'g-single' }),
      tripEntryAdded(TRIP, PERPERSON, { from: 'depot', gearId: 'g-lamp' }),
      tripEntryAdded(TRIP, TRIPONLY, {
        from: 'trip_only',
        name: 'Rope',
        container: false,
      }),
      tripEntryAdded(TRIP, CONTAINER, { from: 'depot', gearId: 'g-crate' }),
      tripEntryBringCountSet(TRIP, CONTAINER, 3),
      tripEntryAdded(TRIP, MYSTERY, { from: 'depot', gearId: 'g-mystery' }),
      tripEntryAdded(TRIP, UNSYNCED, { from: 'depot', gearId: 'g-not-here' }),
      tripEntryAdded(TRIP, COUNTED_VALUE, {
        from: 'depot',
        gearId: 'g-counted-value',
      }),
      tripEntryBringCountSet(TRIP, COUNTED_VALUE, 4),
      tripConsumedCountSet(TRIP, COUNTED_VALUE, 2),
      tripEntryAdded(TRIP, COUNTED_ZERO, {
        from: 'depot',
        gearId: 'g-counted-zero',
      }),
      tripEntryBringCountSet(TRIP, COUNTED_ZERO, 4),
      tripConsumedCountSet(TRIP, COUNTED_ZERO, 0),
      tripEntryAdded(TRIP, COUNTED_OVER, {
        from: 'depot',
        gearId: 'g-counted-over',
      }),
      tripEntryBringCountSet(TRIP, COUNTED_OVER, 4),
      tripConsumedCountSet(TRIP, COUNTED_OVER, 99),
      tripEntryAdded(TRIP, COUNTED_ABSENT, {
        from: 'depot',
        gearId: 'g-counted-absent',
      }),
      tripEntryBringCountSet(TRIP, COUNTED_ABSENT, 4),
    ],
  )

  const trip = tripFrom(state, TRIP)

  it('is null for a Single, per-person, trip-only, container, unrecognised-Kind and not-yet-synced Gear', () => {
    expect(consumedCountOf(entryFrom(trip, SINGLE), state)).toBeNull()
    expect(consumedCountOf(entryFrom(trip, PERPERSON), state)).toBeNull()
    expect(consumedCountOf(entryFrom(trip, TRIPONLY), state)).toBeNull()
    // A Counted container: `bringCountOf` answers `3` for it (orthogonal
    // registers), but `consumedCountOf` gates on container-ness first — a
    // container's unit is a flat `1` in `unpackItems`, and there is no
    // "half of one container came back".
    expect(consumedCountOf(entryFrom(trip, CONTAINER), state)).toBeNull()
    expect(consumedCountOf(entryFrom(trip, MYSTERY), state)).toBeNull()
    expect(state.gear['g-not-here']).toBeUndefined()
    expect(consumedCountOf(entryFrom(trip, UNSYNCED), state)).toBeNull()
  })

  it("reads the register's own value for a Counted depot Entry", () => {
    expect(consumedCountOf(entryFrom(trip, COUNTED_VALUE), state)).toBe(2)
  })

  it('floors a register holding 0 at 1, and leaves the register itself unchanged', () => {
    expect(consumedCountOf(entryFrom(trip, COUNTED_ZERO), state)).toBe(1)
    expect(entryFrom(trip, COUNTED_ZERO).consumedCount?.value).toBe(0)
  })

  it('ceilings a register holding 99 at the Bring-count, and leaves the register itself unchanged', () => {
    expect(consumedCountOf(entryFrom(trip, COUNTED_OVER), state)).toBe(4)
    expect(entryFrom(trip, COUNTED_OVER).consumedCount?.value).toBe(99)
  })

  it('reads an absent register as the Bring-count, not 1 — the clamp’s floor read through (ruling)', () => {
    expect(entryFrom(trip, COUNTED_ABSENT).consumedCount).toBeUndefined()
    expect(consumedCountOf(entryFrom(trip, COUNTED_ABSENT), state)).toBe(4)
  })
})

describe('unpackItems is the spine, and it is not packingItems (spec §3.1)', () => {
  const TRIP = 't-spine1'
  const P1 = 'p-1-mark'
  const P2 = 'p-2-kim'
  const P3 = 'p-3-ana'
  const SINGLE = 'e-single'
  const COUNTED = 'e-counted'
  const PERPERSON = 'e-lamp'
  const CONTAINER = 'e-crate'
  const TRIPONLY = 'e-triponly'

  const state = depot(
    aTrip({ id: TRIP, name: 'Spine', participants: [P1, P2, P3] }),
    aPerson({ id: P1, name: 'Mark' }),
    aPerson({ id: P2, name: 'Kim' }),
    aPerson({ id: P3, name: 'Ana' }),
    aGear({ id: 'g-single', name: 'Single' }),
    aGear({ id: 'g-counted', name: 'Counted', kind: 'counted' }),
    aGear({ id: 'g-lamp', name: 'Lamp', kind: 'per_person' }),
    aGear({ id: 'g-crate', name: 'Crate', container: true }),
    [
      tripEntryAdded(TRIP, SINGLE, { from: 'depot', gearId: 'g-single' }),
      tripEntryAdded(TRIP, COUNTED, { from: 'depot', gearId: 'g-counted' }),
      tripEntryBringCountSet(TRIP, COUNTED, 4),
      tripEntryAdded(TRIP, PERPERSON, { from: 'depot', gearId: 'g-lamp' }),
      tripEntryAdded(TRIP, CONTAINER, { from: 'depot', gearId: 'g-crate' }),
      tripEntryAdded(TRIP, TRIPONLY, {
        from: 'trip_only',
        name: 'Rope',
        container: false,
      }),
    ],
  )

  const trip = tripFrom(state, TRIP)

  it('yields 1 + 1 + 3 + 1 = 6 items totalling 9, against packingTotals’s own 9 (spec §3.1)', () => {
    const items = unpackItems(trip, state)
    expect(items).toHaveLength(6)
    expect(unpackTotals(trip, state).total).toBe(9)

    // `packingTotals` reaches the identical 9 by a different route: 1
    // (single) + 4 (counted) + 3 (pieces) + 0 (container, excluded from
    // packing) + 1 (trip-only, included in packing) — the trip-only unit
    // packing counts is exactly the container unit unpack counts instead, so
    // this fixture's two totals coincide without the two arithmetics being
    // the same one. The next test below picks a fixture where they do not
    // coincide, which is the assertion that would fail if `unpackItems` were
    // ever aliased to `packingItems`.
    expect(packingTotals(trip, state).total).toBe(9)
  })

  it('includes the container and excludes the trip-only Entry — the reverse of packingItems', () => {
    const unpackEntryIds = unpackItems(trip, state).map((item) => item.entryId)
    expect(unpackEntryIds).toContain(CONTAINER)
    expect(unpackEntryIds).not.toContain(TRIPONLY)

    const packingEntryIds = packingItems(trip, state).map(
      (item) => item.entryId,
    )
    expect(packingEntryIds).not.toContain(CONTAINER)
    expect(packingEntryIds).toContain(TRIPONLY)
  })

  it('gives the container item a flat unit of 1, not pieceCountOf’s 0', () => {
    const containerItem = unpackItems(trip, state).find(
      (item) => item.entryId === CONTAINER,
    )
    expect(containerItem).toEqual({
      kind: 'entry',
      entryId: CONTAINER,
      units: 1,
      outcome: null,
      consumed: null,
    })
  })
})

describe('a Trip where the two totals genuinely differ (F1’s own arithmetic)', () => {
  const TRIP = 't-spine2'
  const SOLO = 'p-solo'
  const COUNTED = 'e-counted-big'
  const SINGLE = 'e-single'
  const PERPERSON = 'e-lamp'
  const TRIPONLY = 'e-triponly'
  const CONTAINER_A = 'e-crate-a'
  const CONTAINER_B = 'e-crate-b'

  const state = depot(
    aTrip({ id: TRIP, name: 'Differ', participants: [SOLO] }),
    aPerson({ id: SOLO, name: 'Solo' }),
    aGear({ id: 'g-counted-big', name: 'Counted', kind: 'counted' }),
    aGear({ id: 'g-single', name: 'Single' }),
    aGear({ id: 'g-lamp', name: 'Lamp', kind: 'per_person' }),
    aGear({ id: 'g-crate-a', name: 'Crate A', container: true }),
    aGear({ id: 'g-crate-b', name: 'Crate B', container: true }),
    [
      tripEntryAdded(TRIP, COUNTED, { from: 'depot', gearId: 'g-counted-big' }),
      tripEntryBringCountSet(TRIP, COUNTED, 58),
      tripEntryAdded(TRIP, SINGLE, { from: 'depot', gearId: 'g-single' }),
      tripEntryAdded(TRIP, PERPERSON, { from: 'depot', gearId: 'g-lamp' }),
      tripEntryAdded(TRIP, TRIPONLY, {
        from: 'trip_only',
        name: 'Rope',
        container: false,
      }),
      tripEntryAdded(TRIP, CONTAINER_A, { from: 'depot', gearId: 'g-crate-a' }),
      tripEntryAdded(TRIP, CONTAINER_B, { from: 'depot', gearId: 'g-crate-b' }),
    ],
  )

  const trip = tripFrom(state, TRIP)

  it('reads packing = 61, unpack = 62: 61 − 1 trip-only + 2 depot containers', () => {
    expect(packingTotals(trip, state).total).toBe(61)
    expect(unpackTotals(trip, state).total).toBe(62)
  })
})

describe('a sourceless and a removed Entry produce no item', () => {
  const TRIP = 't-excluded'
  const REMOVED = 'e-removed'
  const ORPHANED = 'e-orphan'

  const state = depot(
    aTrip({ id: TRIP, name: 'Excluded' }),
    aGear({ id: 'g-removed', name: 'Removed' }),
    [
      tripEntryAdded(TRIP, REMOVED, { from: 'depot', gearId: 'g-removed' }),
      tripEntryRemoved(TRIP, REMOVED),
      // `trip.entry_bring_count_set` creates the Entry on sight, so a
      // sourceless Entry is reachable without a malformed op.
      tripEntryBringCountSet(TRIP, ORPHANED, 2),
    ],
  )

  const trip = tripFrom(state, TRIP)

  it('excludes both — entriesOf already does', () => {
    expect(trip.entries?.[ORPHANED]?.source).toBeUndefined()
    const entryIds = unpackItems(trip, state).map((item) => item.entryId)
    expect(entryIds).not.toContain(REMOVED)
    expect(entryIds).not.toContain(ORPHANED)
  })
})

describe('a tombstoned Piece and a late Participant', () => {
  const TRIP = 't-piece'
  const MARK = 'p-mark'
  const KIM = 'p-kim'
  const LATE = 'p-late'
  const PERPERSON = 'e-lamp'

  const state = depot(
    aTrip({ id: TRIP, name: 'Pieces', participants: [MARK, KIM] }),
    aPerson({ id: MARK, name: 'Mark' }),
    aPerson({ id: KIM, name: 'Kim' }),
    aPerson({ id: LATE, name: 'Late' }),
    aGear({ id: 'g-lamp', name: 'Lamp', kind: 'per_person' }),
    [
      tripEntryAdded(TRIP, PERPERSON, { from: 'depot', gearId: 'g-lamp' }),
      tripPieceRemoved(TRIP, PERPERSON, KIM),
      // Added after the Entry exists — no backfill op gives Late a Piece.
      tripParticipantAdded(TRIP, LATE),
    ],
  )

  const trip = tripFrom(state, TRIP)

  function pieceItems() {
    return unpackItems(trip, state).filter(
      (item): item is Extract<UnpackItem, { kind: 'piece' }> =>
        item.kind === 'piece' && item.entryId === PERPERSON,
    )
  }

  it('gives a tombstoned Piece no item', () => {
    expect(pieceItems().map((item) => item.personId)).not.toContain(KIM)
  })

  it('gives a Participant added after the Entry an open item, with no backfill op', () => {
    const late = pieceItems().find((item) => item.personId === LATE)
    expect(late).toBeDefined()
    expect(late?.outcome).toBeNull()
    expect(trip.entries?.[PERPERSON]?.pieces?.[LATE]).toBeUndefined()
  })
})

describe('countOfUnpack is the one arithmetic (spec §3.2)', () => {
  it('sums resolved over every item with an outcome, and derives open by subtraction', () => {
    const items: UnpackItem[] = [
      { kind: 'entry', entryId: 'a', units: 3, outcome: 'back', consumed: null }, // prettier-ignore
      { kind: 'entry', entryId: 'b', units: 2, outcome: null, consumed: null }, // prettier-ignore
    ]
    expect(countOfUnpack(items)).toEqual({
      resolved: 3,
      total: 5,
      open: 2,
      back: 3,
      consumed: 0,
      lost: 0,
    })
    expect(countOfUnpack([])).toEqual({
      resolved: 0,
      total: 0,
      open: 0,
      back: 0,
      consumed: 0,
      lost: 0,
    })
  })

  it('never sums open independently — it is total minus resolved', () => {
    const items: UnpackItem[] = [
      { kind: 'entry', entryId: 'a', units: 3, outcome: null, consumed: null }, // prettier-ignore
    ]
    expect(countOfUnpack(items).open).toBe(3)
  })

  it('splits a consumed Counted Entry: the count to consumed, the rest to back, the whole to resolved', () => {
    const items: UnpackItem[] = [
      { kind: 'entry', entryId: 'stove', units: 4, outcome: 'consumed', consumed: 2 }, // prettier-ignore
    ]
    expect(countOfUnpack(items)).toEqual({
      resolved: 4,
      total: 4,
      open: 0,
      back: 2,
      consumed: 2,
      lost: 0,
    })
  })

  it('contributes the whole units to consumed when no count is tracked (a piece, or a non-Counted entry)', () => {
    const items: UnpackItem[] = [
      { kind: 'entry', entryId: 'jacket', units: 1, outcome: 'consumed', consumed: null }, // prettier-ignore
      { kind: 'piece', entryId: 'lamp', personId: 'p1', units: 1, outcome: 'consumed', consumed: null }, // prettier-ignore
    ]
    expect(countOfUnpack(items)).toEqual({
      resolved: 2,
      total: 2,
      open: 0,
      back: 0,
      consumed: 2,
      lost: 0,
    })
  })

  it('sums the four named buckets plus open to total', () => {
    const items: UnpackItem[] = [
      { kind: 'entry', entryId: 'a', units: 1, outcome: 'back', consumed: null }, // prettier-ignore
      { kind: 'entry', entryId: 'b', units: 4, outcome: 'consumed', consumed: 2 }, // prettier-ignore
      { kind: 'entry', entryId: 'c', units: 1, outcome: 'lost', consumed: null }, // prettier-ignore
      { kind: 'entry', entryId: 'd', units: 6, outcome: null, consumed: null }, // prettier-ignore
    ]
    const count = countOfUnpack(items)
    expect(count).toEqual({
      resolved: 6,
      total: 12,
      open: 6,
      back: 3,
      consumed: 2,
      lost: 1,
    })
    expect(count.back + count.consumed + count.lost + count.open).toBe(
      count.total,
    )
  })

  it('counts an unrecognised outcome as resolved, into none of the three named buckets', () => {
    const items: UnpackItem[] = [
      { kind: 'entry', entryId: 'a', units: 3, outcome: 'donated', consumed: null }, // prettier-ignore
    ]
    const count = countOfUnpack(items)
    expect(count).toEqual({
      resolved: 3,
      total: 3,
      open: 0,
      back: 0,
      consumed: 0,
      lost: 0,
    })
    // The three named buckets sum to less than resolved: a value some build
    // wrote deliberately, treated as settled but drawn as none of them
    // (spec §3.2's own argument — the close card renders the segments it
    // has).
    expect(count.back + count.consumed + count.lost).toBeLessThan(
      count.resolved,
    )
  })
})

describe('countOfUnpack through the real fold — ruling: an absent consumedCount reads the Bring-count', () => {
  const TRIP = 't-r1'
  const COUNTED = 'e-counted'

  const state = depot(
    aTrip({ id: TRIP, name: 'R1' }),
    aGear({ id: 'g-counted', name: 'Counted', kind: 'counted' }),
    [
      tripEntryAdded(TRIP, COUNTED, { from: 'depot', gearId: 'g-counted' }),
      tripEntryBringCountSet(TRIP, COUNTED, 4),
      tripOutcomeSet(TRIP, COUNTED, 'consumed'),
      // No `trip.consumed_count_set` at all — the sheet's one-op-per-tap
      // shape (F9): tapping CONSUMED alone authors an outcome and no count.
    ],
  )

  const trip = tripFrom(state, TRIP)

  it('reads the whole Bring-count as consumed and none as back', () => {
    const entry = entryFrom(trip, COUNTED)
    expect(entry.consumedCount).toBeUndefined()
    expect(consumedCountOf(entry, state)).toBe(4)

    expect(unpackTotals(trip, state)).toEqual({
      resolved: 4,
      total: 4,
      open: 0,
      back: 0,
      consumed: 4,
      lost: 0,
    })
  })
})

describe('the outcome table', () => {
  it('draws OPEN and its glyph for null — open is not a row', () => {
    expect(outcomeLabel(null)).toBe('OPEN')
    expect(outcomeGlyph(null)).toBe('○')
    expect(OUTCOMES.some((row) => row.label === 'OPEN')).toBe(false)
  })

  it("draws a known outcome's label and glyph from the table", () => {
    expect(outcomeLabel('back')).toBe('BACK')
    expect(outcomeGlyph('back')).toBe('●')
    expect(outcomeLabel('consumed')).toBe('CONSUMED')
    expect(outcomeGlyph('consumed')).toBe('')
    expect(outcomeLabel('lost')).toBe('LOST')
    expect(outcomeGlyph('lost')).toBe('▲')
  })

  it('draws an unrecognised outcome verbatim, with no glyph', () => {
    expect(outcomeLabel('donated')).toBe('donated')
    expect(outcomeGlyph('donated')).toBe('')
    expect(isKnownOutcome('donated')).toBe(false)
  })

  it('knows exactly the three named outcomes, in the sheet’s chip order', () => {
    expect(OUTCOMES.map((row) => row.id)).toEqual(['back', 'consumed', 'lost'])
    expect(OUTCOMES.every((row) => isKnownOutcome(row.id))).toBe(true)
  })
})
