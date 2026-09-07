import { describe, expect, it } from 'vitest'

import {
  aGear,
  aPerson,
  aPlace,
  aTrip,
  depot,
  stamp,
} from '../../testUtils/index.ts'
import {
  gearRehomed,
  placeRemoved,
  tripConsumedCountSet,
  tripConsumptionPosted,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripEntryRemoved,
  tripOutcomeSet,
  tripParticipantAdded,
  tripPhaseMoved,
  tripPieceRemoved,
} from '../authoring.ts'
import { emptyState, fold } from '../reduce.ts'
import type { EntryState, HouseholdState, TripState } from '../state.ts'
import { packingItems, packingTotals, ridesAlongCount } from './packing.ts'
import {
  consumedCountOf,
  countOfUnpack,
  insideCountOf,
  isKnownOutcome,
  OUTCOMES,
  outcomeGlyph,
  outcomeLabel,
  outcomeOf,
  owedOf,
  pieceOutcomeOf,
  postedOf,
  rehomedSinceOutcome,
  rehomedSincePieceOutcome,
  returnPathOf,
  standingLostOf,
  type Unaccounted,
  unaccountedOf,
  type UnpackItem,
  unpackDestinationOf,
  unpackItems,
  unpackTotals,
} from './unpack.ts'
import { whereabouts } from './whereabouts.ts'

/**
 * The Depot's own shelf count for one Gear — the home slice's `count`, which
 * is where the unaccounted standing is actually *felt* by a Quartermaster
 * (spec §3.6(3): the home count subtracts the standing's units). Read
 * through `whereabouts` rather than restated here, so R35's headline test
 * asserts the number the screen draws.
 */
function homeCountOf(state: HouseholdState, gearId: string): number | null {
  const home = whereabouts(state, gearId).slices[0]
  if (home === undefined || home.kind !== 'home') {
    throw new Error(`whereabouts(${gearId}) drew no home slice`)
  }
  return home.count
}

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

/**
 * `unpackItems`' loop checks `trip_only`, then container-ness, then
 * `per_person` — and both of the two tests below pin that ORDER, not an
 * arithmetic. Neither combination is exercised by the spine fixture above
 * (which has a depot container and a trip-only Single, but never a trip-only
 * *container* or a per-person *container*), so a swap in either check would
 * pass the whole suite above and still be wrong.
 *
 * `docs/design/README.md` §7 is the shipped authority for the first rule:
 * *"the denominator is every **depot** Entry's units, containers included
 * (F1) … trip-only Entries take no outcome and are excluded."*
 */
describe('unpackItems’ check order is load-bearing (I1, I2)', () => {
  it('excludes a trip-only container exactly like a trip-only Single (I1)', () => {
    // If `kind === 'trip_only'` ever moved below the container check — the
    // natural shape if this loop were later aligned with `packingItems`,
    // which checks container first — a trip-only crate (an improvised,
    // uncatalogued container, e.g. a borrowed one) would draw a `units: 1`,
    // `outcome: null` item. F5 draws no pill on a trip-only row
    // (`CLEARS AT CLOSE` in its place), so nothing could ever author
    // `trip.outcome_set` on it: `open` would never reach zero and the Trip
    // could never close. The failure is severe and the whole suite would
    // stay green throughout — this is the one test that would catch it.
    const TRIP = 't-order-trip-only-crate'
    const CRATE = 'e-borrowed-crate'
    const state = depot(aTrip({ id: TRIP, name: 'Order' }), [
      tripEntryAdded(TRIP, CRATE, {
        from: 'trip_only',
        name: 'Borrowed crate',
        container: true,
      }),
    ])
    const trip = tripFrom(state, TRIP)

    expect(unpackItems(trip, state).map((item) => item.entryId)).not.toContain(
      CRATE,
    )
    expect(unpackTotals(trip, state).total).toBe(0)
  })

  it('gives a per-person depot container one entry item, not a fan-out over Pieces (I2)', () => {
    // If `kind === 'per_person'` were ever checked before container-ness, a
    // per-person crate on this 3-Participant Trip would fan out into three
    // `'piece'` items instead of one container item — over-counting the
    // denominator (one duffel read as 3), and each Piece's outcome could
    // then only be authored through the roster sheet, which F1's container
    // row does not draw at all. Same end state as I1: `open` never reaches
    // zero, the Trip is stuck, and the full suite stays green.
    const TRIP = 't-order-per-person-crate'
    const P1 = 'p-1'
    const P2 = 'p-2'
    const P3 = 'p-3'
    const CRATE = 'e-pp-crate'
    const state = depot(
      aTrip({ id: TRIP, name: 'Order', participants: [P1, P2, P3] }),
      aPerson({ id: P1, name: 'Mark' }),
      aPerson({ id: P2, name: 'Kim' }),
      aPerson({ id: P3, name: 'Ana' }),
      aGear({
        id: 'g-crate-pp',
        name: 'Crate PP',
        kind: 'per_person',
        container: true,
      }),
      [tripEntryAdded(TRIP, CRATE, { from: 'depot', gearId: 'g-crate-pp' })],
    )
    const trip = tripFrom(state, TRIP)

    expect(unpackItems(trip, state)).toEqual([
      { kind: 'entry', entryId: CRATE, units: 1, outcome: null, consumed: null }, // prettier-ignore
    ])
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

/**
 * F5's grouping — spec §3.4. `unpackDestinationOf` answers *where does my
 * body go* (the Place at the root of the home path); `slice.ts`'s `container`
 * dimension answers the different question *where is this filed* (the
 * immediate holder). The nested-container-loose case below is the one that
 * tells the two apart: it has a container to file under, and no Place to walk
 * to.
 */
describe('unpackDestinationOf: the Place at the root of the home path (spec §3.4)', () => {
  const ATTIC = 'place-attic'
  const REMOVED_PLACE = 'place-removed'

  const state = depot(
    aPlace({ id: ATTIC, name: 'Attic' }),
    aPlace({ id: REMOVED_PLACE, name: 'Shed' }),
    [placeRemoved(REMOVED_PLACE)],
    aGear({
      id: 'g-direct',
      name: 'Direct',
      residence: { in: 'place', id: ATTIC },
    }),
    aGear({ id: 'g-crate', name: 'Crate B', container: true }),
    aGear({ id: 'g-nested', name: 'Nested' }),
    [gearRehomed('g-crate', { in: 'place', id: ATTIC })],
    [gearRehomed('g-nested', { in: 'gear', id: 'g-crate' })],
    aGear({ id: 'g-loose', name: 'Loose' }),
    aGear({ id: 'g-loose-crate', name: 'Loose crate', container: true }),
    aGear({ id: 'g-in-loose-crate', name: 'In loose crate' }),
    [gearRehomed('g-in-loose-crate', { in: 'gear', id: 'g-loose-crate' })],
    aGear({
      id: 'g-at-removed',
      name: 'At removed place',
      residence: { in: 'place', id: REMOVED_PLACE },
    }),
  )

  it('reads the Attic for gear directly in the Attic', () => {
    expect(unpackDestinationOf('g-direct', state)).toBe(ATTIC)
  })

  it('reads the Attic for gear nested in Crate B, itself in the Attic', () => {
    expect(unpackDestinationOf('g-nested', state)).toBe(ATTIC)
  })

  it('reads null for loose gear', () => {
    expect(unpackDestinationOf('g-loose', state)).toBeNull()
  })

  it('reads null for gear in a container that is itself loose — there is no Place at the root, which is exactly what Loose means', () => {
    // `g-loose-crate` has never been rehomed, so it is loose itself
    // (`residenceOf`'s own default) — the case that tells this grouping apart
    // from `slice.ts`'s `container` dimension, which would file this gear
    // under `g-loose-crate` and stop there.
    expect(unpackDestinationOf('g-in-loose-crate', state)).toBeNull()
  })

  it('reads null for gear at a removed Place — through the view’s own resolution, not a second test of `removed`', () => {
    expect(unpackDestinationOf('g-at-removed', state)).toBeNull()
  })
})

describe('returnPathOf: the full home path for a row’s meta, depot Entries only (spec §3.4)', () => {
  const TRIP = 't-return-path'
  const ATTIC = 'place-attic'
  const DEPOT = 'e-depot'
  const TRIPONLY = 'e-triponly'

  const state = depot(
    aTrip({ id: TRIP, name: 'Return path' }),
    aPlace({ id: ATTIC, name: 'Attic' }),
    aGear({ id: 'g-crate', name: 'Crate B', container: true }),
    aGear({ id: 'g-tent', name: 'Tent' }),
    [gearRehomed('g-crate', { in: 'place', id: ATTIC })],
    [gearRehomed('g-tent', { in: 'gear', id: 'g-crate' })],
    [
      tripEntryAdded(TRIP, DEPOT, { from: 'depot', gearId: 'g-tent' }),
      tripEntryAdded(TRIP, TRIPONLY, {
        from: 'trip_only',
        name: 'Rope',
        container: false,
      }),
    ],
  )

  const trip = tripFrom(state, TRIP)

  it('returns the segments homePath returns, outermost first, for a depot Entry', () => {
    expect(returnPathOf(entryFrom(trip, DEPOT), state)).toEqual([
      { kind: 'place', id: ATTIC, name: 'Attic' },
      { kind: 'gear', id: 'g-crate', name: 'Crate B' },
    ])
  })

  it('answers [] for a trip-only Entry — it names no Gear and is never asked', () => {
    expect(returnPathOf(entryFrom(trip, TRIPONLY), state)).toEqual([])
  })
})

describe('unaccountedOf — the standing (spec §3.5)', () => {
  const TRIP = 't-alps'
  const OTHER = 't-vosges'
  const MARK = 'p-mark'
  const KIM = 'p-kim'

  it('a lost outcome on a CLOSED Trip still produces a standing — closed Trips are exactly the history this reads (spec §3.5)', () => {
    const state = depot(
      aGear({ id: 'g-tent', name: 'Tent' }),
      aTrip({ id: TRIP, name: 'Vosges 2024', phase: 'closed' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet(TRIP, 'e-tent', 'lost'),
      ],
    )

    const standing: Unaccounted | undefined = unaccountedOf(state).get('g-tent')
    expect(standing).toEqual({
      tripId: TRIP,
      tripName: 'Vosges 2024',
      units: 1,
      personIds: [],
      // Not per-person, so the standing spans no Pieces.
      pieceIds: [],
    })
  })

  it('a Gear with no residence register at all keeps a live standing — nothing to compare against reads earlier than everything', () => {
    const state = depot(
      aGear({ id: 'g-tent', name: 'Tent' }),
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet(TRIP, 'e-tent', 'lost'),
      ],
    )

    expect(state.gear['g-tent']?.residence).toBeUndefined()
    expect(unaccountedOf(state).get('g-tent')).toBeDefined()
  })

  it('a lost outcome on a DRAFT Trip produces a standing too — literal-correct per "every visible Trip" (spec §3.5)', () => {
    const state = depot(
      aGear({ id: 'g-tent', name: 'Tent' }),
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'draft' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet(TRIP, 'e-tent', 'lost'),
      ],
    )

    expect(unaccountedOf(state).get('g-tent')).toBeDefined()
  })

  it('removing the Entry settles the standing — a third route beside re-home and outcome-change (entriesOf filters removed)', () => {
    const state = depot(
      aGear({ id: 'g-tent', name: 'Tent' }),
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet(TRIP, 'e-tent', 'lost'),
        tripEntryRemoved(TRIP, 'e-tent'),
      ],
    )

    expect(unaccountedOf(state).get('g-tent')).toBeUndefined()
  })

  it('a tombstoned Piece’s lost outcome is dropped, never counted (piecesOf filters, ruling R10/R11’s family)', () => {
    const state = depot(
      aPerson({ id: MARK, name: 'Mark' }),
      aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
      aTrip({
        id: TRIP,
        name: 'Alps 2026',
        phase: 'pack_out',
        participants: [MARK],
      }),
      [
        tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: 'g-lamp' }),
        tripOutcomeSet(TRIP, 'e-lamp', 'lost', MARK),
        tripPieceRemoved(TRIP, 'e-lamp', MARK),
      ],
    )

    expect(unaccountedOf(state).get('g-lamp')).toBeUndefined()
  })

  it('a gear.rehomed stamped AFTER the lost outcome clears the standing', () => {
    const base = [
      ...aGear({ id: 'g-tent', name: 'Tent' }),
      ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
      tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
    ]
    const lost = stamp([tripOutcomeSet(TRIP, 'e-tent', 'lost')], { start: 10 })
    const rehomeAfter = stamp([gearRehomed('g-tent', { in: 'loose' })], {
      start: 20,
    })
    const state = fold(
      [...stamp(base, { start: 1 }), ...lost, ...rehomeAfter],
      emptyState(),
    )

    expect(unaccountedOf(state).get('g-tent')).toBeUndefined()
  })

  it('a gear.rehomed stamped BEFORE the lost outcome does not clear it', () => {
    const base = [
      ...aGear({ id: 'g-tent', name: 'Tent' }),
      ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
      tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
    ]
    const rehomeBefore = stamp([gearRehomed('g-tent', { in: 'loose' })], {
      start: 10,
    })
    const lost = stamp([tripOutcomeSet(TRIP, 'e-tent', 'lost')], { start: 20 })
    const state = fold(
      [...stamp(base, { start: 1 }), ...rehomeBefore, ...lost],
      emptyState(),
    )

    expect(unaccountedOf(state).get('g-tent')).toEqual({
      tripId: TRIP,
      tripName: 'Alps 2026',
      units: 1,
      personIds: [],
      // Not per-person, so the standing spans no Pieces.
      pieceIds: [],
    })
  })

  it('a re-home to the SAME residence still clears the standing — the settle route’s whole mechanism, not a redundant write (F16)', () => {
    const base = [
      ...aGear({ id: 'g-tent', name: 'Tent', residence: { in: 'loose' } }),
      ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
      tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
    ]
    const lost = stamp([tripOutcomeSet(TRIP, 'e-tent', 'lost')], { start: 10 })
    const rehomeSame = stamp([gearRehomed('g-tent', { in: 'loose' })], {
      start: 20,
    })
    const state = fold(
      [...stamp(base, { start: 1 }), ...lost, ...rehomeSame],
      emptyState(),
    )

    expect(unaccountedOf(state).get('g-tent')).toBeUndefined()
  })

  it('units: Single reads 1', () => {
    const state = depot(
      aGear({ id: 'g-tent', name: 'Tent' }),
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet(TRIP, 'e-tent', 'lost'),
      ],
    )

    expect(unaccountedOf(state).get('g-tent')?.units).toBe(1)
  })

  it('units: Counted sums two Trips’ Bring-counts when both hold a live lost outcome', () => {
    const state = depot(
      aGear({ id: 'g-peg', name: 'Peg', kind: 'counted' }),
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
      aTrip({ id: OTHER, name: 'Vosges', phase: 'on_trip' }),
      [
        tripEntryAdded(TRIP, 'e-a', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(TRIP, 'e-a', 2),
        tripOutcomeSet(TRIP, 'e-a', 'lost'),
        tripEntryAdded(OTHER, 'e-b', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(OTHER, 'e-b', 3),
        tripOutcomeSet(OTHER, 'e-b', 'lost'),
      ],
    )

    const standing = unaccountedOf(state).get('g-peg')
    expect(standing?.units).toBe(5)
    // The latest of the two — OTHER's `lost` is stamped after TRIP's.
    expect(standing?.tripId).toBe(OTHER)
  })

  it('units: per-person names the lost Pieces only', () => {
    const state = depot(
      aPerson({ id: MARK, name: 'Mark' }),
      aPerson({ id: KIM, name: 'Kim' }),
      aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
      aTrip({
        id: TRIP,
        name: 'Alps 2026',
        phase: 'pack_out',
        participants: [MARK, KIM],
      }),
      [
        tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: 'g-lamp' }),
        tripOutcomeSet(TRIP, 'e-lamp', 'lost', MARK),
      ],
    )

    expect(unaccountedOf(state).get('g-lamp')).toEqual({
      tripId: TRIP,
      tripName: 'Alps 2026',
      units: 1,
      personIds: [MARK],
      // §5i G10: every Piece the standing spans, lost or not.
      pieceIds: [KIM, MARK],
    })
  })

  it('the same Person’s Piece lost on two Trips counts once, not twice', () => {
    const state = depot(
      aPerson({ id: MARK, name: 'Mark' }),
      aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
      aTrip({
        id: TRIP,
        name: 'Alps 2026',
        phase: 'pack_out',
        participants: [MARK],
      }),
      aTrip({
        id: OTHER,
        name: 'Vosges',
        phase: 'on_trip',
        participants: [MARK],
      }),
      [
        tripEntryAdded(TRIP, 'e-a', { from: 'depot', gearId: 'g-lamp' }),
        tripOutcomeSet(TRIP, 'e-a', 'lost', MARK),
        tripEntryAdded(OTHER, 'e-b', { from: 'depot', gearId: 'g-lamp' }),
        tripOutcomeSet(OTHER, 'e-b', 'lost', MARK),
      ],
    )

    const standing = unaccountedOf(state).get('g-lamp')
    expect(standing?.units).toBe(1)
    expect(standing?.personIds).toEqual([MARK])
    // The latest of the two — OTHER's `lost` is stamped after TRIP's.
    expect(standing?.tripId).toBe(OTHER)
  })

  it('a lost per-person CONTAINER Entry produces a whole-Entry standing, never per-Person ones (ruling R10/R11)', () => {
    const state = depot(
      aPerson({ id: MARK, name: 'Mark' }),
      aPerson({ id: KIM, name: 'Kim' }),
      aGear({
        id: 'g-sack',
        name: 'Stuff sack',
        container: true,
        kind: 'per_person',
      }),
      aTrip({
        id: TRIP,
        name: 'Alps 2026',
        phase: 'pack_out',
        participants: [MARK, KIM],
      }),
      [
        tripEntryAdded(TRIP, 'e-sack', { from: 'depot', gearId: 'g-sack' }),
        // Entry-level — no personId — the container's own outcome.
        tripOutcomeSet(TRIP, 'e-sack', 'lost'),
      ],
    )

    expect(unaccountedOf(state).get('g-sack')).toEqual({
      tripId: TRIP,
      tripName: 'Alps 2026',
      units: 1,
      personIds: [],
      // Not per-person, so the standing spans no Pieces.
      pieceIds: [],
    })
  })

  it('names the Trip of the latest live lost outcome, not the first found and not the alphabetically first', () => {
    const state = depot(
      aGear({ id: 'g-tent', name: 'Tent' }),
      aTrip({ id: 'a-trip', name: 'Alps', phase: 'pack_out' }),
      aTrip({ id: 'z-trip', name: 'Zermatt', phase: 'pack_out' }),
      [
        // `visibleTrips` iterates Alps before Zermatt (A→Z) and Alps is
        // stamped first — a "first found" or "alphabetically first" bug
        // would both name Alps. The rule is the stamp, and Zermatt's is
        // later.
        tripEntryAdded('a-trip', 'e-a', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet('a-trip', 'e-a', 'lost'),
        tripEntryAdded('z-trip', 'e-z', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet('z-trip', 'e-z', 'lost'),
      ],
    )

    const standing = unaccountedOf(state).get('g-tent')
    expect(standing?.tripId).toBe('z-trip')
    expect(standing?.tripName).toBe('Zermatt')
  })

  /**
   * **Inverted by ruling R35, deliberately kept rather than deleted.** This
   * test used to assert that a later `back` on another Entry settles nothing
   * — spec §3.5's own sentence, *"they are different units"*. Story 3, story
   * 11 and `domain-model.md` all say the opposite in as many words (*"a
   * re-home, **or a later Trip brings it back**"*), none of them was ever
   * amended, and the spec is the document that yields. The assertion is
   * flipped here, with the reason, so a reader who greps for the old
   * behaviour finds the overturn rather than silence.
   */
  it('a later BACK on a different Entry settles the whole standing (R35 inverts spec §3.5)', () => {
    const state = depot(
      aGear({ id: 'g-peg', name: 'Peg', kind: 'counted' }),
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
      [
        tripEntryAdded(TRIP, 'e-lost', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(TRIP, 'e-lost', 2),
        tripOutcomeSet(TRIP, 'e-lost', 'lost'),
        tripEntryAdded(TRIP, 'e-back', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(TRIP, 'e-back', 1),
        tripOutcomeSet(TRIP, 'e-back', 'back'),
      ],
    )

    expect(unaccountedOf(state).get('g-peg')).toBeUndefined()
  })

  it('an EARLIER back on a different Entry settles nothing — the comparison is a stamp, not a presence (R35)', () => {
    const base = [
      ...aGear({ id: 'g-peg', name: 'Peg', kind: 'counted', ownedCount: 3 }),
      ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
      tripEntryAdded(TRIP, 'e-back', { from: 'depot', gearId: 'g-peg' }),
      tripEntryBringCountSet(TRIP, 'e-back', 1),
      tripEntryAdded(TRIP, 'e-lost', { from: 'depot', gearId: 'g-peg' }),
      tripEntryBringCountSet(TRIP, 'e-lost', 2),
    ]
    const back = stamp([tripOutcomeSet(TRIP, 'e-back', 'back')], { start: 10 })
    const lost = stamp([tripOutcomeSet(TRIP, 'e-lost', 'lost')], { start: 20 })
    const state = fold(
      [...stamp(base, { start: 1 }), ...back, ...lost],
      emptyState(),
    )

    expect(unaccountedOf(state).get('g-peg')).toEqual({
      tripId: TRIP,
      tripName: 'Alps 2026',
      units: 2,
      personIds: [],
      // Not per-person, so the standing spans no Pieces.
      pieceIds: [],
    })
  })

  /**
   * **R35's headline case** — the drift the widened rule exists to stop, end
   * to end and across two Trips, one of them `closed`. The Quartermaster
   * resolves the standing through the route F5's own hint names (the pill →
   * `● BACK`), which emits `trip.outcome_set{back}` and nothing else; before
   * R35 only a re-home could ever end a standing, so this cleared nothing,
   * the home count stayed permanently short, and gear detail read
   * `▲ ×1 LAST SEEN: …` forever.
   */
  it('a later BACK on a DIFFERENT Trip clears a closed Trip’s standing and returns the home count (R35)', () => {
    const base = [
      ...aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 3,
      }),
      ...aTrip({ id: 'a-tessin', name: 'Tessin 2025', phase: 'unpack' }),
      tripEntryAdded('a-tessin', 'e-gas', { from: 'depot', gearId: 'g-gas' }),
      tripEntryBringCountSet('a-tessin', 'e-gas', 1),
    ]
    const lost = stamp([tripOutcomeSet('a-tessin', 'e-gas', 'lost')], {
      start: 10,
    })
    const closed = stamp([tripPhaseMoved('a-tessin', 'closed')], { start: 20 })
    // A later Trip brings one home. Nothing here touches the Depot: `back`
    // writes no `gear.rehomed` and no owned count.
    const later = stamp(
      [
        ...aTrip({ id: 'z-alps', name: 'Alps 2026', phase: 'unpack' }),
        tripEntryAdded('z-alps', 'e-gas-2', {
          from: 'depot',
          gearId: 'g-gas',
        }),
        tripEntryBringCountSet('z-alps', 'e-gas-2', 1),
        tripOutcomeSet('z-alps', 'e-gas-2', 'back'),
      ],
      { start: 30 },
    )

    const before = fold(
      [...stamp(base, { start: 1 }), ...lost, ...closed],
      emptyState(),
    )
    expect(before.trips['a-tessin']?.phase?.value).toBe('closed')
    expect(unaccountedOf(before).get('g-gas')?.units).toBe(1)
    // The short shelf count is what a Quartermaster actually sees.
    expect(homeCountOf(before, 'g-gas')).toBe(2)

    const after = fold(later, before)

    expect(unaccountedOf(after).get('g-gas')).toBeUndefined()
    expect(homeCountOf(after, 'g-gas')).toBe(3)
  })

  it('a Piece marked BACK on another Trip settles a Piece marked LOST — the settle is per Gear, not per Person (R35)', () => {
    const base = [
      ...aPerson({ id: MARK, name: 'Mark' }),
      ...aPerson({ id: KIM, name: 'Kim' }),
      ...aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
      ...aTrip({
        id: 'a-tessin',
        name: 'Tessin 2025',
        phase: 'unpack',
        participants: [MARK],
      }),
      tripEntryAdded('a-tessin', 'e-lamp', { from: 'depot', gearId: 'g-lamp' }),
    ]
    const lost = stamp([tripOutcomeSet('a-tessin', 'e-lamp', 'lost', MARK)], {
      start: 10,
    })
    const later = stamp(
      [
        ...aTrip({
          id: 'z-alps',
          name: 'Alps 2026',
          phase: 'unpack',
          participants: [KIM],
        }),
        tripEntryAdded('z-alps', 'e-lamp-2', {
          from: 'depot',
          gearId: 'g-lamp',
        }),
        // Kim's Piece, not Mark's — the rule is per Gear, exactly as the
        // re-home rule already is.
        tripOutcomeSet('z-alps', 'e-lamp-2', 'back', KIM),
      ],
      { start: 30 },
    )

    const before = fold([...stamp(base, { start: 1 }), ...lost], emptyState())
    expect(unaccountedOf(before).get('g-lamp')?.personIds).toEqual([MARK])

    expect(unaccountedOf(fold(later, before)).get('g-lamp')).toBeUndefined()
  })

  it.each(['back', 'consumed'] as const)(
    '%s produces no standing at all',
    (outcome) => {
      const state = depot(
        aGear({ id: 'g-tent', name: 'Tent' }),
        aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
        [
          tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
          tripOutcomeSet(TRIP, 'e-tent', outcome),
        ],
      )

      expect(unaccountedOf(state).get('g-tent')).toBeUndefined()
    },
  )
})

describe('rehomedSinceOutcome — the RE-HOMED segment’s one comparison (spec §4.6)', () => {
  const TRIP = 't-alps'
  const ATTIC = 'p-attic'
  const SHED = 'p-shed'

  it('an open Entry (no outcome register at all) never draws it, whatever the residence', () => {
    const state = depot(
      aGear({ id: 'g-tent', name: 'Tent' }),
      aTrip({ id: TRIP, name: 'Alps 2026' }),
      [tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' })],
    )
    const entry = entryFrom(tripFrom(state, TRIP), 'e-tent')

    expect(entry.outcome).toBeUndefined()
    expect(rehomedSinceOutcome(entry, state.gear['g-tent'])).toBe(false)
  })

  it('a resolved Entry whose Gear has no residence register at all never draws it — nothing to compare against', () => {
    const state = depot(
      aGear({ id: 'g-tent', name: 'Tent' }),
      aTrip({ id: TRIP, name: 'Alps 2026' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet(TRIP, 'e-tent', 'back'),
      ],
    )
    const entry = entryFrom(tripFrom(state, TRIP), 'e-tent')

    expect(state.gear['g-tent']?.residence).toBeUndefined()
    expect(rehomedSinceOutcome(entry, state.gear['g-tent'])).toBe(false)
  })

  it('a gear.rehomed stamped AFTER the outcome draws it — reHomeOnTheSpot’s own batch order', () => {
    const base = [
      ...aGear({ id: 'g-tent', name: 'Tent' }),
      ...aTrip({ id: TRIP, name: 'Alps 2026' }),
      ...aPlace({ id: ATTIC, name: 'Attic' }),
      tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
    ]
    const back = stamp([tripOutcomeSet(TRIP, 'e-tent', 'back')], { start: 10 })
    const rehomeAfter = stamp(
      [gearRehomed('g-tent', { in: 'place', id: ATTIC })],
      { start: 20 },
    )
    const state = fold(
      [...stamp(base, { start: 1 }), ...back, ...rehomeAfter],
      emptyState(),
    )
    const entry = entryFrom(tripFrom(state, TRIP), 'e-tent')

    expect(rehomedSinceOutcome(entry, state.gear['g-tent'])).toBe(true)
  })

  it('a gear.rehomed stamped BEFORE the outcome does not draw it', () => {
    const base = [
      ...aGear({ id: 'g-tent', name: 'Tent' }),
      ...aTrip({ id: TRIP, name: 'Alps 2026' }),
      ...aPlace({ id: ATTIC, name: 'Attic' }),
      tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
    ]
    const rehomeBefore = stamp(
      [gearRehomed('g-tent', { in: 'place', id: ATTIC })],
      { start: 10 },
    )
    const back = stamp([tripOutcomeSet(TRIP, 'e-tent', 'back')], { start: 20 })
    const state = fold(
      [...stamp(base, { start: 1 }), ...rehomeBefore, ...back],
      emptyState(),
    )
    const entry = entryFrom(tripFrom(state, TRIP), 'e-tent')

    expect(rehomedSinceOutcome(entry, state.gear['g-tent'])).toBe(false)
  })

  it('an EQUAL stamp draws it — "at or after" is inclusive, the one difference from outcomeStands’ strict ">"', () => {
    const base = [
      ...aGear({ id: 'g-tent', name: 'Tent' }),
      ...aTrip({ id: TRIP, name: 'Alps 2026' }),
      ...aPlace({ id: ATTIC, name: 'Attic' }),
      tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
    ]
    const back = stamp([tripOutcomeSet(TRIP, 'e-tent', 'back')], { start: 10 })
    // Same counter, same default device — an identical stamp, the boundary
    // `outcomeStands`' strict `>` would call "still stands" and this
    // function's `>=` calls "re-homed".
    const rehomeSame = stamp(
      [gearRehomed('g-tent', { in: 'place', id: ATTIC })],
      { start: 10 },
    )
    const state = fold(
      [...stamp(base, { start: 1 }), ...back, ...rehomeSame],
      emptyState(),
    )
    const entry = entryFrom(tripFrom(state, TRIP), 'e-tent')

    expect(rehomedSinceOutcome(entry, state.gear['g-tent'])).toBe(true)
  })

  /**
   * **The over-inclusive case, pinned rather than hidden (spec §4.6).** This
   * function cannot tell a `reHomeOnTheSpot` batch from an unrelated later
   * `gear.rehomed` — e.g. one authored from gear detail's own `MOVE`, well
   * after the Trip's own pass resolved this Entry `back`. It reads
   * truthfully ("its home changed since it was resolved") and it is
   * cosmetic: no count depends on it.
   */
  it('a gear.rehomed from an unrelated later MOVE also draws it — the over-inclusive case, pinned', () => {
    const base = [
      ...aGear({ id: 'g-tent', name: 'Tent' }),
      ...aTrip({ id: TRIP, name: 'Alps 2026' }),
      ...aPlace({ id: ATTIC, name: 'Attic' }),
      ...aPlace({ id: SHED, name: 'Shed' }),
      tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
    ]
    const back = stamp([tripOutcomeSet(TRIP, 'e-tent', 'back')], { start: 10 })
    // A wholly unrelated MOVE, much later, naming a different Place — not
    // part of the same reHomeOnTheSpot batch at all.
    const laterMove = stamp(
      [gearRehomed('g-tent', { in: 'place', id: SHED })],
      { start: 500 },
    )
    const state = fold(
      [...stamp(base, { start: 1 }), ...back, ...laterMove],
      emptyState(),
    )
    const entry = entryFrom(tripFrom(state, TRIP), 'e-tent')

    expect(rehomedSinceOutcome(entry, state.gear['g-tent'])).toBe(true)
  })
})

/**
 * **`N INSIDE` — the lid-open count** (§5i G2). F5's own container row, and
 * the half of the old one-word-two-questions pair that stayed on the row.
 */
describe('insideCountOf is the lid-open count, not what moves', () => {
  const TRIP = 't-inside'
  const CRATE = 'e-crate'
  const SACK = 'e-sack'
  const POLES = 'e-poles'
  const TARP = 'e-tarp'

  const state = depot(
    aTrip({ id: TRIP, name: 'Inside' }),
    aGear({ id: 'g-crate', name: 'Crate', container: true }),
    aGear({ id: 'g-sack', name: 'Sack', container: true }),
    aGear({ id: 'g-poles', name: 'Poles', kind: 'counted' }),
    aGear({ id: 'g-tarp', name: 'Tarp' }),
    [
      tripEntryAdded(TRIP, CRATE, { from: 'depot', gearId: 'g-crate' }),
      tripEntryAdded(TRIP, SACK, { from: 'depot', gearId: 'g-sack' }),
      tripEntryAdded(TRIP, POLES, { from: 'depot', gearId: 'g-poles' }),
      tripEntryBringCountSet(TRIP, POLES, 2),
      tripEntryAdded(TRIP, TARP, { from: 'depot', gearId: 'g-tarp' }),
      // Sack and poles directly in the crate; the tarp one level deeper.
      tripEntryMoved(TRIP, SACK, { in: 'container', entryId: CRATE }),
      tripEntryMoved(TRIP, POLES, { in: 'container', entryId: CRATE }),
      tripEntryMoved(TRIP, TARP, { in: 'container', entryId: SACK }),
    ],
  )

  const trip = tripFrom(state, TRIP)

  it('counts direct children only, a nested container as one, units by their count', () => {
    // The sack counts 1 whatever is in it, the poles count their
    // Bring-count of 2, and the tarp two levels down counts nowhere here.
    expect(insideCountOf(trip, state, CRATE)).toBe(3)
  })

  it('counts what the RIDE ALONG number does not, and the two differ on purpose', () => {
    // `ridesAlongCount` over the same crate reaches the tarp; this does
    // not. One word each, because they answer different questions.
    expect(insideCountOf(trip, state, SACK)).toBe(1)
    expect(ridesAlongCount(trip, state, CRATE)).toBe(4)
  })

  it('counts nothing for an empty container', () => {
    expect(insideCountOf(trip, state, TARP)).toBe(0)
  })
})

/**
 * **§5i G12's own predicate, per Piece.** The Entry-level
 * {@link rehomedSinceOutcome} answers `false` for every per-person Entry —
 * that Entry's own outcome register is read by nobody — so a surface asking
 * about a Piece has to ask about the Piece.
 */
describe('rehomedSincePieceOutcome', () => {
  const TRIP = 't-rehomed-piece'
  const ENTRY = 'e-lamp'
  const KIM = 'p-kim'
  const MARK = 'p-mark'

  it('answers false while the lost Piece stands, true once the Gear is home again', () => {
    const base = [
      aTrip({ id: TRIP, name: 'Tessin', participants: [KIM, MARK] }),
      aPerson({ id: KIM, name: 'Kim' }),
      aPerson({ id: MARK, name: 'Mark' }),
      aPlace({ id: 'pl-bak', name: 'Bak 3' }),
      aGear({ id: 'g-lamp', name: 'Lamp', kind: 'per_person' }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-lamp' }),
        tripOutcomeSet(TRIP, ENTRY, 'lost', KIM),
      ],
    ]

    const before = depot(...base)
    const entryBefore = entryFrom(tripFrom(before, TRIP), ENTRY)
    expect(
      rehomedSincePieceOutcome(entryBefore, KIM, before.gear['g-lamp']),
    ).toBe(false)

    const after = depot(...base, [
      gearRehomed('g-lamp', { in: 'place', id: 'pl-bak' }),
    ])
    const entryAfter = entryFrom(tripFrom(after, TRIP), ENTRY)

    // The settle is per **Gear**, not per Person — so Mark's Piece, which
    // was never lost, is not what makes Kim's answer move; the later home
    // write is.
    expect(
      rehomedSincePieceOutcome(entryAfter, KIM, after.gear['g-lamp']),
    ).toBe(true)
  })

  it('answers false for a Piece with no outcome register at all', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Tessin', participants: [KIM] }),
      aPerson({ id: KIM, name: 'Kim' }),
      aGear({ id: 'g-lamp', name: 'Lamp', kind: 'per_person' }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-lamp' })],
    )
    const entry = entryFrom(tripFrom(state, TRIP), ENTRY)

    // Nothing was resolved, so there is no "since" to compare a re-home to.
    expect(rehomedSincePieceOutcome(entry, KIM, state.gear['g-lamp'])).toBe(
      false,
    )
  })
})

describe('postedOf — the running total this Trip has posted (spec §2.1)', () => {
  const TRIP = 't-posted'

  it('reads 0 for an absent register — no close has ever posted this Gear', () => {
    const state = depot(aTrip({ id: TRIP, name: 'Alps 2026' }))

    expect(tripFrom(state, TRIP).postings?.['g-tent']).toBeUndefined()
    expect(postedOf(tripFrom(state, TRIP), 'g-tent')).toBe(0)
  })

  it('reads 0 for an explicit 0 — a restoration took it back to nothing, a different fact read the same way', () => {
    const state = depot(aTrip({ id: TRIP, name: 'Alps 2026' }), [
      tripConsumptionPosted(TRIP, 'g-tent', 0),
    ])

    expect(tripFrom(state, TRIP).postings?.['g-tent']?.value).toBe(0)
    expect(postedOf(tripFrom(state, TRIP), 'g-tent')).toBe(0)
  })

  it('reads the posted total', () => {
    const state = depot(aTrip({ id: TRIP, name: 'Alps 2026' }), [
      tripConsumptionPosted(TRIP, 'g-gas', 2),
    ])

    expect(postedOf(tripFrom(state, TRIP), 'g-gas')).toBe(2)
  })
})

describe('owedOf — a thin read over consumedReductions (spec §2.2)', () => {
  const TRIP = 't-owed'

  it('is consumedReductions(...).get(gearId) ?? 0 for a Counted depot Entry marked consumed', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'unpack' }),
      aGear({ id: 'g-gas', name: 'Gas canister', kind: 'counted' }),
      [
        tripEntryAdded(TRIP, 'e-gas', { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, 'e-gas', 4),
        tripOutcomeSet(TRIP, 'e-gas', 'consumed'),
        tripConsumedCountSet(TRIP, 'e-gas', 2),
      ],
    )

    expect(owedOf(tripFrom(state, TRIP), 'g-gas', state)).toBe(2)
  })

  it('is 0 for a container', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'unpack' }),
      aGear({ id: 'g-crate', name: 'Crate', container: true }),
      [
        tripEntryAdded(TRIP, 'e-crate', { from: 'depot', gearId: 'g-crate' }),
        tripOutcomeSet(TRIP, 'e-crate', 'consumed'),
      ],
    )

    expect(owedOf(tripFrom(state, TRIP), 'g-crate', state)).toBe(0)
  })

  it('is 0 for a Single', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'unpack' }),
      aGear({ id: 'g-stove', name: 'Stove' }),
      [
        tripEntryAdded(TRIP, 'e-stove', { from: 'depot', gearId: 'g-stove' }),
        tripOutcomeSet(TRIP, 'e-stove', 'consumed'),
      ],
    )

    expect(owedOf(tripFrom(state, TRIP), 'g-stove', state)).toBe(0)
  })

  it('is 0 for a trip-only Entry — there is no Gear id to owe against', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'unpack' }),
      [
        tripEntryAdded(TRIP, 'e-tarp', {
          from: 'trip_only',
          name: 'Borrowed tarp',
          container: false,
        }),
        tripOutcomeSet(TRIP, 'e-tarp', 'consumed'),
      ],
    )

    expect(owedOf(tripFrom(state, TRIP), 'g-nonexistent', state)).toBe(0)
  })

  it('is 0 for an unsynced Gear — no gear.recorded has reached this replica', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'unpack' }),
      [
        tripEntryAdded(TRIP, 'e-unsynced', {
          from: 'depot',
          gearId: 'g-unsynced',
        }),
        tripOutcomeSet(TRIP, 'e-unsynced', 'consumed'),
      ],
    )

    expect(state.gear['g-unsynced']).toBeUndefined()
    expect(owedOf(tripFrom(state, TRIP), 'g-unsynced', state)).toBe(0)
  })
})

describe('standingLostOf — what about this Trip is still unaccounted (spec §6)', () => {
  const TRIP = 't-standing'
  const MARK = 'p-mark'
  const KIM = 'p-kim'

  it('returns an Entry whose lost outcome still stands', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'unpack' }),
      aGear({ id: 'g-tent', name: 'Tent' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet(TRIP, 'e-tent', 'lost'),
      ],
    )

    expect(standingLostOf(tripFrom(state, TRIP), state)).toEqual([
      { entryId: 'e-tent', personId: null, gearName: 'Tent', units: 1 },
    ])
  })

  it('omits an Entry settled by a later gear.rehomed — the residence stamp is later than the outcome stamp', () => {
    const base = [
      ...aGear({ id: 'g-tent', name: 'Tent' }),
      ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'unpack' }),
      tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
    ]
    const lost = stamp([tripOutcomeSet(TRIP, 'e-tent', 'lost')], { start: 10 })
    const rehomeAfter = stamp([gearRehomed('g-tent', { in: 'loose' })], {
      start: 20,
    })
    const state = fold(
      [...stamp(base, { start: 1 }), ...lost, ...rehomeAfter],
      emptyState(),
    )

    expect(standingLostOf(tripFrom(state, TRIP), state)).toEqual([])
  })

  it('returns per-Piece standings with their personId, and an Entry-level one with personId: null', () => {
    const state = depot(
      aPerson({ id: MARK, name: 'Mark' }),
      aPerson({ id: KIM, name: 'Kim' }),
      aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
      aGear({ id: 'g-tent', name: 'Tent' }),
      aTrip({
        id: TRIP,
        name: 'Alps 2026',
        phase: 'unpack',
        participants: [MARK, KIM],
      }),
      [
        tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: 'g-lamp' }),
        // KIM's Piece is left open — R35 settles per Gear, so a KIM `back`
        // here would settle MARK's `lost` too, which is a different test
        // (see `unaccountedOf`'s own "settles per Gear, not per Person").
        tripOutcomeSet(TRIP, 'e-lamp', 'lost', MARK),
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet(TRIP, 'e-tent', 'lost'),
      ],
    )

    expect(standingLostOf(tripFrom(state, TRIP), state)).toEqual([
      {
        entryId: 'e-lamp',
        personId: MARK,
        gearName: 'Headlamp',
        units: 1,
      },
      { entryId: 'e-tent', personId: null, gearName: 'Tent', units: 1 },
    ])
  })

  it('returns [] on a Trip where everything is back', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Alps 2026', phase: 'unpack' }),
      aGear({ id: 'g-tent', name: 'Tent' }),
      aGear({ id: 'g-stove', name: 'Stove' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet(TRIP, 'e-tent', 'back'),
        tripEntryAdded(TRIP, 'e-stove', { from: 'depot', gearId: 'g-stove' }),
        tripOutcomeSet(TRIP, 'e-stove', 'back'),
      ],
    )

    expect(standingLostOf(tripFrom(state, TRIP), state)).toEqual([])
  })
})
