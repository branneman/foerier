import { describe, expect, it } from 'vitest'

import { anOp, aGear, aTrip, hlcAt } from '../../testUtils/index.ts'
import {
  gearKindSet,
  gearRenamed,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryRemoved,
  type OpSpec,
} from '../authoring.ts'
import { emptyState, fold } from '../reduce.ts'
import type { DepotState, EntryState, TripState } from '../state.ts'
import {
  bringCountOf,
  entriesOf,
  entryKind,
  entryLabel,
  listTotals,
  pieceCountOf,
} from './entry.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

/** The factories' own default millisecond, so `hlcAt` here matches theirs. */
const DEFAULT_MS = 1_700_000_000_000

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

function entryOf(
  state: DepotState,
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
          hlc: hlcAt(10, DEFAULT_MS),
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
