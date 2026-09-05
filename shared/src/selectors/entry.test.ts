import { describe, expect, it } from 'vitest'

import {
  anOp,
  aGear,
  aTrip,
  DEFAULT_HLC_MS,
  depot,
  DEV_A,
  hlcAt,
} from '../../testUtils/index.ts'
import {
  gearKindSet,
  gearRenamed,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryRemoved,
  type OpSpec,
} from '../authoring.ts'
import { fold } from '../reduce.ts'
import type { HouseholdState, EntryState, TripState } from '../state.ts'
import {
  bringCountOf,
  entriesOf,
  entryKind,
  entryLabel,
  listTotals,
  pieceCountOf,
  visibleEntry,
} from './entry.ts'

function trip(state: HouseholdState, id: string): TripState {
  return state.trips[id]!
}

function entryOf(
  state: HouseholdState,
  tripId: string,
  entryId: string,
): EntryState | undefined {
  return state.trips[tripId]?.entries?.[entryId]
}

function ids(entries: readonly EntryState[]): readonly string[] {
  return entries.map((e) => e.id)
}

describe('entriesOf', () => {
  it('excludes a tombstoned Entry', () => {
    const state = depot(
      aTrip({ id: 't1' }),
      [
        tripEntryAdded('t1', 'e1', {
          from: 'trip_only',
          name: 'Rope',
          container: false,
        }),
      ],
      [
        tripEntryAdded('t1', 'e2', {
          from: 'trip_only',
          name: 'Stove',
          container: false,
        }),
      ],
      [tripEntryRemoved('t1', 'e1')],
    )
    const list = entriesOf(trip(state, 't1'), state)
    expect(ids(list)).toEqual(['e2'])
  })

  it('excludes a sourceless Entry but keeps it in the fold', () => {
    // A `trip.entry_bring_count_set` with no preceding `trip.entry_added`.
    const state = depot([tripEntryBringCountSet('t1', 'e1', 3)])
    expect(entryOf(state, 't1', 'e1')).toBeDefined()
    expect(entryOf(state, 't1', 'e1')?.source).toBeUndefined()
    expect(ids(entriesOf(trip(state, 't1'), state))).toEqual([])
  })

  it('includes it the moment its trip.entry_added lands', () => {
    const state = depot(
      [tripEntryBringCountSet('t1', 'e1', 3)],
      [
        tripEntryAdded('t1', 'e1', {
          from: 'trip_only',
          name: 'Stove',
          container: false,
        }),
      ],
    )
    expect(ids(entriesOf(trip(state, 't1'), state))).toEqual(['e1'])
  })

  it('orders totally and identically from two op orders', () => {
    const axe = [
      tripEntryAdded('t1', 'e-axe', {
        from: 'trip_only',
        name: 'Axe',
        container: false,
      }),
    ]
    const middle = [
      tripEntryAdded('t1', 'e-middle', {
        from: 'trip_only',
        name: 'Middle',
        container: false,
      }),
    ]
    const zebra = [
      tripEntryAdded('t1', 'e-zebra', {
        from: 'trip_only',
        name: 'Zebra',
        container: false,
      }),
    ]

    const forward = depot(aTrip({ id: 't1' }), axe, middle, zebra)
    const backward = depot(aTrip({ id: 't1' }), zebra, middle, axe)

    const expected = ['e-axe', 'e-middle', 'e-zebra']
    expect(ids(entriesOf(trip(forward, 't1'), forward))).toEqual(expected)
    expect(ids(entriesOf(trip(backward, 't1'), backward))).toEqual(expected)
  })

  it('sorts by label rather than by id when the two disagree', () => {
    // Ids run the opposite way from the labels they name, so a comparator
    // that fell back to `localeCompare` on the id (or dropped the label
    // half entirely) would draw this list backwards.
    const state = depot(
      aTrip({ id: 't1' }),
      [
        tripEntryAdded('t1', 'z-apple', {
          from: 'trip_only',
          name: 'Apple',
          container: false,
        }),
      ],
      [
        tripEntryAdded('t1', 'a-banana', {
          from: 'trip_only',
          name: 'Banana',
          container: false,
        }),
      ],
    )
    expect(ids(entriesOf(trip(state, 't1'), state))).toEqual([
      'z-apple',
      'a-banana',
    ])
  })

  it('breaks a label tie by id, identically regardless of arrival order', () => {
    // Two Entries sharing one label. `Array.prototype.sort` is stable, so
    // without an id tie-break the arrival order would leak straight through
    // — which is per-replica and exactly what this function must not draw.
    const higherFirst = [
      tripEntryAdded('t1', 'e-2', {
        from: 'trip_only',
        name: 'Same',
        container: false,
      }),
    ]
    const lowerFirst = [
      tripEntryAdded('t1', 'e-1', {
        from: 'trip_only',
        name: 'Same',
        container: false,
      }),
    ]

    const arrivedHighFirst = depot(aTrip({ id: 't1' }), higherFirst, lowerFirst)
    const arrivedLowFirst = depot(aTrip({ id: 't1' }), lowerFirst, higherFirst)

    const expected = ['e-1', 'e-2']
    expect(
      ids(entriesOf(trip(arrivedHighFirst, 't1'), arrivedHighFirst)),
    ).toEqual(expected)
    expect(
      ids(entriesOf(trip(arrivedLowFirst, 't1'), arrivedLowFirst)),
    ).toEqual(expected)
  })
})

/**
 * `entriesOf`'s rule, asked about one Entry by id. The tombstone case is the
 * one that bites: the reducer keeps a removed Entry as an entity with
 * `removed: true`, so `trip.entries[id]` stays **defined** after a
 * `trip.entry_removed`, and a reader checking only for `undefined` goes on
 * drawing — and re-removing — an Entry nobody may see.
 */
describe('visibleEntry', () => {
  it('reads a listed Entry by id', () => {
    const state = depot(aTrip({ id: 't1' }), [
      tripEntryAdded('t1', 'e1', {
        from: 'trip_only',
        name: 'Rope',
        container: false,
      }),
    ])
    expect(visibleEntry(trip(state, 't1'), 'e1')?.id).toBe('e1')
  })

  it('reads undefined for a tombstoned Entry the fold still holds', () => {
    const state = depot(
      aTrip({ id: 't1' }),
      [
        tripEntryAdded('t1', 'e1', {
          from: 'trip_only',
          name: 'Rope',
          container: false,
        }),
      ],
      [tripEntryRemoved('t1', 'e1')],
    )
    expect(entryOf(state, 't1', 'e1')).toBeDefined()
    expect(visibleEntry(trip(state, 't1'), 'e1')).toBeUndefined()
  })

  it('reads undefined for a sourceless Entry, and for an id no op named', () => {
    const state = depot(aTrip({ id: 't1' }), [
      tripEntryBringCountSet('t1', 'e1', 3),
    ])
    expect(entryOf(state, 't1', 'e1')).toBeDefined()
    expect(visibleEntry(trip(state, 't1'), 'e1')).toBeUndefined()
    expect(visibleEntry(trip(state, 't1'), 'e-never')).toBeUndefined()
  })
})

describe('entryLabel', () => {
  it("reads the referenced Gear's name through the Depot", () => {
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g1', name: 'Tent' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
    )
    expect(entryLabel(entryOf(state, 't1', 'e1')!, state)).toBe('Tent')

    // No Trip op at all — invariant 8's single-sourcing.
    const renamed = fold(
      [
        anOp(gearRenamed('g1', 'Big tent'), {
          hlc: hlcAt(10, DEFAULT_HLC_MS),
          deviceId: DEV_A,
        }),
      ],
      state,
    )
    expect(entryLabel(entryOf(renamed, 't1', 'e1')!, renamed)).toBe('Big tent')
  })

  it("reads a trip-only Entry's own name, which no Gear rename touches", () => {
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g1', name: 'Tent' }),
      [
        tripEntryAdded('t1', 'e1', {
          from: 'trip_only',
          name: 'Rope',
          container: false,
        }),
      ],
      [gearRenamed('g1', 'Big tent')],
    )
    expect(entryLabel(entryOf(state, 't1', 'e1')!, state)).toBe('Rope')
  })

  it('falls back as tripLabel does when the name is unset', () => {
    const state = depot(aTrip({ id: 't1' }), [
      tripEntryAdded('t1', 'e1', {
        from: 'trip_only',
        name: null,
        container: false,
      }),
    ])
    expect(entryLabel(entryOf(state, 't1', 'e1')!, state)).toBe('—')
  })

  it('falls back to — for a depot Entry whose Gear has not been folded', () => {
    // The ordinary cross-aggregate sync race: `trip.entry_added` named a
    // `gearId` this replica's `gear.recorded` has not arrived for yet.
    const state = depot(aTrip({ id: 't1' }), [
      tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'ghost' }),
    ])
    expect(entryOf(state, 't1', 'e1')?.source).toBeDefined()
    expect(state.gear['ghost']).toBeUndefined()
    expect(entryLabel(entryOf(state, 't1', 'e1')!, state)).toBe('—')
  })

  it('falls back to — for a depot Entry whose Gear is unnamed', () => {
    const state = depot(aTrip({ id: 't1' }), aGear({ id: 'g1', name: '' }), [
      tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' }),
    ])
    expect(entryLabel(entryOf(state, 't1', 'e1')!, state)).toBe('—')
  })
})

describe('entryKind', () => {
  it('reads undefined for a depot Entry whose Gear has not been folded', () => {
    const state = depot(aTrip({ id: 't1' }), [
      tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'ghost' }),
    ])
    expect(state.gear['ghost']).toBeUndefined()
    expect(entryKind(entryOf(state, 't1', 'e1')!, state)).toBeUndefined()
  })

  it('reads undefined for a depot Entry whose Gear carries no kind register', () => {
    // A hand-shaped `gear.recorded` with no `kind` field at all — reachable
    // only through a malformed op, since `gearRecorded` in `authoring.ts`
    // requires `kind`, but the reducer's `writeIfPresent` leaves the
    // register unwritten rather than defaulting it either way.
    const bareGearRecorded: OpSpec = {
      aggregate: 'gear',
      aggregate_id: 'g1',
      type: 'gear.recorded',
      payload: { name: 'Mystery', container: false },
    }
    const state = depot(
      aTrip({ id: 't1' }),
      [bareGearRecorded],
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
    )
    expect(state.gear['g1']).toBeDefined()
    expect(state.gear['g1']?.kind).toBeUndefined()
    expect(entryKind(entryOf(state, 't1', 'e1')!, state)).toBeUndefined()
  })
})

describe('bringCountOf', () => {
  it('reads 1 for a Counted Entry with no register', () => {
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g1', kind: 'counted' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
    )
    expect(bringCountOf(entryOf(state, 't1', 'e1')!, state)).toBe(1)
  })

  it('reads the register for a Counted Entry that has one', () => {
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g1', kind: 'counted' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      [tripEntryBringCountSet('t1', 'e1', 4)],
    )
    expect(bringCountOf(entryOf(state, 't1', 'e1')!, state)).toBe(4)
  })

  it('reads null for Single, per-person and trip-only Entries', () => {
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g1', kind: 'single' }),
      aGear({ id: 'g2', kind: 'per_person' }),
      [tripEntryAdded('t1', 'e-single', { from: 'depot', gearId: 'g1' })],
      [tripEntryAdded('t1', 'e-per-person', { from: 'depot', gearId: 'g2' })],
      [
        tripEntryAdded('t1', 'e-trip-only', {
          from: 'trip_only',
          name: 'Rope',
          container: false,
        }),
      ],
    )
    expect(bringCountOf(entryOf(state, 't1', 'e-single')!, state)).toBeNull()
    expect(
      bringCountOf(entryOf(state, 't1', 'e-per-person')!, state),
    ).toBeNull()
    expect(bringCountOf(entryOf(state, 't1', 'e-trip-only')!, state)).toBeNull()
  })

  it('reads null after the Kind changes to single, leaving the register in state', () => {
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g1', kind: 'counted' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      [tripEntryBringCountSet('t1', 'e1', 4)],
      [gearKindSet('g1', 'single')],
    )
    const entry = entryOf(state, 't1', 'e1')!
    expect(bringCountOf(entry, state)).toBeNull()
    // The register must still be present on EntryState — not cleared.
    expect(entry.bringCount?.value).toBe(4)
  })
})

describe('pieceCountOf', () => {
  it('is 1 for a Single depot Entry', () => {
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g1', kind: 'single' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
    )
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(1)
  })

  it('is the Bring-count for a Counted Entry, and 1 when absent', () => {
    const withCount = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g1', kind: 'counted' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      [tripEntryBringCountSet('t1', 'e1', 5)],
    )
    expect(
      pieceCountOf(
        entryOf(withCount, 't1', 'e1')!,
        trip(withCount, 't1'),
        withCount,
      ),
    ).toBe(5)

    const withoutCount = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g1', kind: 'counted' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
    )
    expect(
      pieceCountOf(
        entryOf(withoutCount, 't1', 'e1')!,
        trip(withoutCount, 't1'),
        withoutCount,
      ),
    ).toBe(1)
  })

  it('is the Participant count for a per-person Entry', () => {
    const state = depot(
      aTrip({ id: 't1', participants: ['p1', 'p2'] }),
      aGear({ id: 'g1', kind: 'per_person' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
    )
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(2)
  })

  it('is 1 for a trip-only Entry', () => {
    const state = depot(aTrip({ id: 't1' }), [
      tripEntryAdded('t1', 'e1', {
        from: 'trip_only',
        name: 'Rope',
        container: false,
      }),
    ])
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(1)
  })

  it('is 1 for Gear whose Kind is unrecognised', () => {
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g1', kind: 'weighed' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
    )
    expect(entryKind(entryOf(state, 't1', 'e1')!, state)).toBe('weighed')
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(1)
  })

  it('is 1 for a depot Entry whose Gear has not been folded', () => {
    const state = depot(aTrip({ id: 't1' }), [
      tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'ghost' }),
    ])
    expect(entryKind(entryOf(state, 't1', 'e1')!, state)).toBeUndefined()
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(1)
  })

  it('is 1 for a depot Entry whose Gear carries no kind register', () => {
    const bareGearRecorded: OpSpec = {
      aggregate: 'gear',
      aggregate_id: 'g1',
      type: 'gear.recorded',
      payload: { name: 'Mystery', container: false },
    }
    const state = depot(
      aTrip({ id: 't1' }),
      [bareGearRecorded],
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
    )
    expect(entryKind(entryOf(state, 't1', 'e1')!, state)).toBeUndefined()
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(1)
  })
})

describe('a container is not a piece (ruling A5)', () => {
  it('counts a depot container Entry as zero pieces', () => {
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g-crate', container: true }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g-crate' })],
    )
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(0)
  })

  it('counts a trip-only container Entry as zero pieces', () => {
    const state = depot(aTrip({ id: 't1' }), [
      tripEntryAdded('t1', 'e1', {
        from: 'trip_only',
        name: 'Crate',
        container: true,
      }),
    ])
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(0)
  })

  it('still lists a container and still counts it as an ENTRY', () => {
    // ENTRIES counts the list, PIECES counts what travels (ruling D). A5 is
    // that sentence read carefully — `entriesOf` is untouched.
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g-single', kind: 'single' }),
      aGear({ id: 'g-crate', container: true }),
      [tripEntryAdded('t1', 'e-single', { from: 'depot', gearId: 'g-single' })],
      [tripEntryAdded('t1', 'e-crate', { from: 'depot', gearId: 'g-crate' })],
      [
        tripEntryAdded('t1', 'e-trip-only', {
          from: 'trip_only',
          name: 'Rope',
          container: false,
        }),
      ],
    )
    expect(ids(entriesOf(trip(state, 't1'), state))).toContain('e-crate')
    expect(listTotals(trip(state, 't1'), state).entries).toBe(3)
  })

  it('leaves a container out of listTotals.pieces', () => {
    // Two non-container Entries at one piece each, one container.
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g-single', kind: 'single' }),
      aGear({ id: 'g-crate', container: true }),
      [tripEntryAdded('t1', 'e-single', { from: 'depot', gearId: 'g-single' })],
      [tripEntryAdded('t1', 'e-crate', { from: 'depot', gearId: 'g-crate' })],
      [
        tripEntryAdded('t1', 'e-trip-only', {
          from: 'trip_only',
          name: 'Rope',
          container: false,
        }),
      ],
    )
    expect(listTotals(trip(state, 't1'), state).pieces).toBe(2)
  })

  it('counts a not-yet-synced Gear as one piece, not zero', () => {
    // `isContainerEntry` reads it as not-a-container — the conservative
    // direction, matching `entryKind`'s `undefined` and `pieceCountOf`'s own
    // default.
    const state = depot(aTrip({ id: 't1' }), [
      tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'ghost' }),
    ])
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(1)
  })

  it('counts a Counted container Entry as zero pieces, whatever its Bring-count (fix round F4)', () => {
    // `container` and `kind` are orthogonal registers — a Counted Entry can
    // be a container (`AddGear`'s `Recorded as` control is separate from its
    // Kind selector). Ruling A5 is the outer gate: a container carries no
    // status, so it contributes nothing to the arithmetic whatever its Kind.
    // `EntryRow`'s own `×N` for this same Entry still reads the Bring-count —
    // see `EntryRow.test.tsx`'s "reads ×N from bringCount, not pieceCount"
    // for that half of the fact.
    const state = depot(
      aTrip({ id: 't1' }),
      aGear({ id: 'g-crate', kind: 'counted', container: true }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g-crate' })],
      [tripEntryBringCountSet('t1', 'e1', 3)],
    )
    expect(bringCountOf(entryOf(state, 't1', 'e1')!, state)).toBe(3)
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(0)
  })

  it('counts a per-person container Entry as zero pieces, whatever its Participant count (fix round F4)', () => {
    const state = depot(
      aTrip({ id: 't1', participants: ['p1', 'p2'] }),
      aGear({ id: 'g-crate', kind: 'per_person', container: true }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g-crate' })],
    )
    expect(
      pieceCountOf(entryOf(state, 't1', 'e1')!, trip(state, 't1'), state),
    ).toBe(0)
  })

  it('counts a trip-only container as a TRIP-ONLY line but not a PIECE (fix round F2)', () => {
    // `tripOnly` and `pieces` are not a subset relationship: a trip-only
    // container is a line (`tripOnly += 1`, unconditionally) that carries no
    // status and so travels as nothing (`pieces += 0`). This is the
    // assertion whose absence let F2's stale "subset of pieces" docstring
    // stand uncaught.
    const state = depot(aTrip({ id: 't1' }), [
      tripEntryAdded('t1', 'e1', {
        from: 'trip_only',
        name: 'Crate',
        container: true,
      }),
    ])
    const totals = listTotals(trip(state, 't1'), state)
    expect(totals.tripOnly).toBe(1)
    expect(totals.pieces).toBe(0)
  })

  it('counts a per-person container as zero PIECES and zero PER-PERSON (fix round F2)', () => {
    // The mirror case: `perPerson` sums `pieceCountOf` over per-person
    // Entries, so a per-person container contributes `0` to both fields —
    // it is still a line (an ordinary group in `tripContainmentView`), just
    // not one that travels.
    const state = depot(
      aTrip({ id: 't1', participants: ['p1', 'p2'] }),
      aGear({ id: 'g-crate', kind: 'per_person', container: true }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g-crate' })],
    )
    const totals = listTotals(trip(state, 't1'), state)
    expect(totals.entries).toBe(1)
    expect(totals.perPerson).toBe(0)
    expect(totals.pieces).toBe(0)
  })
})

describe('listTotals', () => {
  it('counts entries, pieces, perPerson and tripOnly over a mixed list', () => {
    const state = depot(
      aTrip({ id: 't1', participants: ['p1', 'p2'] }),
      aGear({ id: 'g-single', kind: 'single' }),
      aGear({ id: 'g-counted', kind: 'counted' }),
      aGear({ id: 'g-per-person', kind: 'per_person' }),
      [tripEntryAdded('t1', 'e-single', { from: 'depot', gearId: 'g-single' })],
      [
        tripEntryAdded('t1', 'e-counted', {
          from: 'depot',
          gearId: 'g-counted',
        }),
      ],
      [tripEntryBringCountSet('t1', 'e-counted', 3)],
      [
        tripEntryAdded('t1', 'e-per-person', {
          from: 'depot',
          gearId: 'g-per-person',
        }),
      ],
      [
        tripEntryAdded('t1', 'e-trip-only', {
          from: 'trip_only',
          name: 'Rope',
          container: false,
        }),
      ],
      // A removed Entry, to prove it is excluded from every total rather
      // than merely from the list.
      [
        tripEntryAdded('t1', 'e-removed', {
          from: 'trip_only',
          name: 'Discarded',
          container: false,
        }),
      ],
      [tripEntryRemoved('t1', 'e-removed')],
    )

    expect(listTotals(trip(state, 't1'), state)).toEqual({
      entries: 4,
      pieces: 1 + 3 + 2 + 1,
      perPerson: 2,
      tripOnly: 1,
    })
  })

  it('counts nothing for a Trip with no entries', () => {
    const state = depot(aTrip({ id: 't1' }))
    expect(listTotals(trip(state, 't1'), state)).toEqual({
      entries: 0,
      pieces: 0,
      perPerson: 0,
      tripOnly: 0,
    })
  })
})
