import { describe, expect, it } from 'vitest'

import { anOp, aGear, aTrip, hlcAt } from '../../testUtils/index.ts'
import {
  gearKindSet,
  tripEntryAdded,
  tripEntryBringCountSet,
  type OpSpec,
} from '../authoring.ts'
import { emptyState, fold } from '../reduce.ts'
import type { DepotState } from '../state.ts'
import { overClaims, overClaimsFor, overClaimsIfActive } from './claim.ts'

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

describe('Single gear', () => {
  it('reports an over-claim when two active Trips hold it', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'on_trip' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    const result = overClaims(state)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      gearId: 'g1',
      kind: 'single',
      supply: 1,
      claimed: 2,
      contestedPersonIds: [],
    })
    expect(result[0]!.claims.map((c) => c.tripId).sort()).toEqual(['t1', 't2'])
  })

  it('reports nothing when only one active Trip holds it', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
    )

    expect(overClaims(state)).toEqual([])
  })

  it('ignores a stray owned_count on Single gear — supply is one', () => {
    // A Gear whose Kind was edited from counted to single keeps its
    // ownedCount register. It must NOT raise Single's supply above one.
    const state = depot(
      aGear({ id: 'g1', kind: 'counted', ownedCount: 5 }),
      [gearKindSet('g1', 'single')],
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'on_trip' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't3', phase: 'unpack' }),
      [tripEntryAdded('t3', 'e3', { from: 'depot', gearId: 'g1' })],
    )

    const result = overClaims(state)

    expect(result).toHaveLength(1)
    // Three active Trips hold it: still only ever an over-claim past 1, not
    // past the stray owned_count of 5.
    expect(result[0]!.supply).toBe(1)
    expect(result[0]!.claimed).toBe(3)
  })
})

describe('Counted gear', () => {
  it('reports an over-claim when bring-counts sum past owned_count', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'counted', ownedCount: 3 }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [
        tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' }),
        tripEntryBringCountSet('t1', 'e1', 2),
      ],
      aTrip({ id: 't2', phase: 'on_trip' }),
      [
        tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' }),
        tripEntryBringCountSet('t2', 'e2', 2),
      ],
    )

    const result = overClaims(state)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      gearId: 'g1',
      kind: 'counted',
      supply: 3,
      claimed: 4,
    })
  })

  it('reads an absent owned_count as 1', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'counted' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [
        tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' }),
        tripEntryBringCountSet('t1', 'e1', 2),
      ],
    )

    const result = overClaims(state)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ supply: 1, claimed: 2 })
  })

  it('reports nothing when the sum equals owned_count', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'counted', ownedCount: 3 }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [
        tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' }),
        tripEntryBringCountSet('t1', 'e1', 1),
      ],
      aTrip({ id: 't2', phase: 'on_trip' }),
      [
        tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' }),
        tripEntryBringCountSet('t2', 'e2', 2),
      ],
    )

    expect(overClaims(state)).toEqual([])
  })
})

describe('Per-person gear', () => {
  it('reports NOTHING for two active Trips claiming it for disjoint People', () => {
    // Story 6 calls this legitimate. Comparing counts instead of people is
    // the bug this test exists to catch.
    const state = depot(
      aGear({ id: 'g1', kind: 'per_person' }),
      aTrip({ id: 't1', phase: 'pack_out', participants: ['p1', 'p2'] }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'on_trip', participants: ['p3', 'p4'] }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    expect(overClaims(state)).toEqual([])
  })

  it('reports exactly the shared Person when Participant sets overlap', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'per_person' }),
      aTrip({ id: 't1', phase: 'pack_out', participants: ['p1', 'p2'] }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'on_trip', participants: ['p2', 'p3'] }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    const result = overClaims(state)

    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe('per_person')
    expect(result[0]!.contestedPersonIds).toEqual(['p2'])
    // supply: 3 distinct People touched (p1, p2, p3); claimed: 2 + 2 = 4 —
    // p2 counted by both Trips.
    expect(result[0]!.supply).toBe(3)
    expect(result[0]!.claimed).toBe(4)
  })
})

describe('only active Trips claim', () => {
  it('reports nothing for a Draft', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'draft' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    expect(overClaims(state)).toEqual([])
  })

  it('reports nothing for a closed Trip', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'closed' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    expect(overClaims(state)).toEqual([])
  })
})

describe('overClaimsIfActive', () => {
  it('reports a clash a Draft would cause on activation', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'draft' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    const result = overClaimsIfActive(state, 't2')

    expect(result).toHaveLength(1)
    expect(result[0]!.claims.map((c) => c.tripId).sort()).toEqual(['t1', 't2'])
  })

  it('reports nothing for the same Draft through overClaims', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'draft' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    expect(overClaims(state)).toEqual([])
  })
})

describe('sourceless entries hold no claim', () => {
  it('ignores an Entry whose trip.entry_added has not arrived', () => {
    // trip.entry_bring_count_set arrives before trip.entry_added — Task 1's
    // out-of-order case. writeEntry creates the Entry with no `source`, and
    // entriesOf excludes it; the claim selector must not choke on it or
    // count it as a claim on anything.
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryBringCountSet('t1', 'e1', 3)],
      aTrip({ id: 't2', phase: 'on_trip' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    // Only one real claim on g1 (from t2) — the sourceless Entry on t1
    // names no Gear, so it cannot clash with anything.
    expect(overClaims(state)).toEqual([])
    expect(overClaimsFor(state, 't1')).toEqual([])
  })

  it('holds no claim for a depot Entry whose Gear is not yet in the fold', () => {
    // Two active Trips both reference the same not-yet-synced gearId — no
    // gear.recorded has arrived for it on this replica. entryKind reads
    // undefined, and the pair must not be reported as an over-claim: a
    // claim the reader cannot see is a claim they cannot settle.
    const state = depot(
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g-unsynced' })],
      aTrip({ id: 't2', phase: 'on_trip' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g-unsynced' })],
    )

    expect(overClaims(state)).toEqual([])
  })
})

describe('overClaimsFor', () => {
  it('returns only the over-claims naming the given Trip', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aGear({ id: 'g2', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [
        tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' }),
        tripEntryAdded('t1', 'e1b', { from: 'depot', gearId: 'g2' }),
      ],
      aTrip({ id: 't2', phase: 'on_trip' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
      aGear({ id: 'g3', kind: 'single' }),
      aTrip({ id: 't3', phase: 'unpack' }),
      [tripEntryAdded('t3', 'e3', { from: 'depot', gearId: 'g3' })],
    )

    const forT1 = overClaimsFor(state, 't1')
    expect(forT1.map((oc) => oc.gearId)).toEqual(['g1'])

    const forT3 = overClaimsFor(state, 't3')
    expect(forT3).toEqual([])
  })
})
