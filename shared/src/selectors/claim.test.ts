import { describe, expect, it } from 'vitest'

import { aGear, aTrip, depot } from '../../testUtils/index.ts'
import {
  gearKindSet,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripPieceRemoved,
  type OpSpec,
} from '../authoring.ts'
import type { DepotState } from '../state.ts'
import { overClaims, overClaimsFor, overClaimsIfActive } from './claim.ts'

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

  it('reports the shared Person when two Entries for the same Gear sit on the same Trip', () => {
    // Two offline Devices both add the headlamp to Alps, producing two
    // trip.entry_added ops with different entry ids on the *same* Trip.
    // A Person cannot bring two of their one headlamp regardless of which
    // Trip(s) the claims sit on — contestedPersonIds counts claims per
    // Person, not distinct Trips, and must still name p1 here even though
    // there is only ever one Trip in play.
    const state = depot(
      aGear({ id: 'g1', kind: 'per_person' }),
      aTrip({ id: 't1', phase: 'pack_out', participants: ['p1'] }),
      [
        tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' }),
        tripEntryAdded('t1', 'e2', { from: 'depot', gearId: 'g1' }),
      ],
    )

    const result = overClaims(state)

    expect(result).toHaveLength(1)
    expect(result[0]!.contestedPersonIds).toEqual(['p1'])
    expect(result[0]!.supply).toBe(1)
    expect(result[0]!.claimed).toBe(2)
  })
})

describe('an unrecognised Kind holds no claim', () => {
  it('does not report an over-claim for a Kind this build has never heard of', () => {
    // Forward compat: a future Kind arrives verbatim (state.ts's KindValue
    // is `(string & {})`-open) and this file has no supply rule for it.
    // Diverges from pieceCountOf, which counts an unrecognised Kind as 1
    // piece — counting what is on the list is a weaker claim than asserting
    // a conflict this build has no rule for.
    const state = depot(
      aGear({ id: 'g1', kind: 'something-later' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'on_trip' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    expect(overClaims(state)).toEqual([])
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

  it('reports a clash a closed Trip would cause on reopening', () => {
    // Reopening is one of domain §5.2's three guarded moments, and
    // ReopenConfirm is a shipped caller — overClaimsIfActive must answer
    // this hypothetical for a closed Trip exactly as it does for a Draft.
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'closed' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    expect(overClaims(state)).toEqual([])

    const result = overClaimsIfActive(state, 't2')

    expect(result).toHaveLength(1)
    expect(result[0]!.claims.map((c) => c.tripId).sort()).toEqual(['t1', 't2'])
  })
})

describe('claim order is asserted, never masked by sorting the result', () => {
  it('lists claims by Trip id regardless of the order the Trips were created in', () => {
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't3', phase: 'pack_out' }),
      [tripEntryAdded('t3', 'e3', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't1', phase: 'on_trip' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'unpack' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
    )

    const result = overClaims(state)

    expect(result).toHaveLength(1)
    expect(result[0]!.claims.map((c) => c.tripId)).toEqual(['t1', 't2', 't3'])
  })

  it('lists contestedPersonIds in order, not insertion order', () => {
    // p2 is inserted into the internal map before p1 (t1's claim names only
    // p2; t2's claim, read in participant-id order, names p1 then p2), so an
    // un-sorted result would read ['p2', 'p1'].
    const state = depot(
      aGear({ id: 'g1', kind: 'per_person' }),
      aTrip({ id: 't1', phase: 'pack_out', participants: ['p2'] }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'on_trip', participants: ['p1', 'p2'] }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't3', phase: 'unpack', participants: ['p1'] }),
      [tripEntryAdded('t3', 'e3', { from: 'depot', gearId: 'g1' })],
    )

    const result = overClaims(state)

    expect(result).toHaveLength(1)
    expect(result[0]!.contestedPersonIds).toEqual(['p1', 'p2'])
  })
})

describe('sourceless entries hold no claim', () => {
  it('ignores an Entry whose trip.entry_added has not arrived', () => {
    // trip.entry_bring_count_set arrives before trip.entry_added — Task 1's
    // out-of-order case. writeEntry creates the Entry with no `source`, and
    // entriesOf excludes it. A second active Trip genuinely holds g1, on a
    // *proper* depot Entry of its own — if the sourceless Entry on t1 were
    // ever counted as a claim (e.g. by reading `state.trips` directly
    // instead of `entriesOf`), this pair would wrongly read as an
    // over-claim; it must instead read as exactly one real claim.
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
    expect(overClaimsFor(state, 't2')).toEqual([])
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

describe('per-person claims read Pieces', () => {
  // Spec §4.6's canonical case. Alps and Vosges both list the per-person
  // GEAR. Mark is on both Trips; Els is only on Alps and Kim only on
  // Vosges — so Mark is the entire conflict, and Els's and Kim's claims are
  // each held once and are legitimate (domain §5.2 permits two active Trips
  // claiming the same per-person gear for *different* people).
  const GEAR = 'g1'
  const ALPS = 't-alps'
  const ALPS_ENTRY = 'e-alps'
  const VOSGES = 't-vosges'
  const VOSGES_ENTRY = 'e-vosges'
  const MARK = 'p-mark'
  const ELS = 'p-els'
  const KIM = 'p-kim'

  function twoTripFold(...extra: readonly OpSpec[]): DepotState {
    return depot(
      aGear({ id: GEAR, kind: 'per_person' }),
      aTrip({ id: ALPS, phase: 'pack_out', participants: [MARK, ELS] }),
      [tripEntryAdded(ALPS, ALPS_ENTRY, { from: 'depot', gearId: GEAR })],
      aTrip({ id: VOSGES, phase: 'on_trip', participants: [MARK, KIM] }),
      [tripEntryAdded(VOSGES, VOSGES_ENTRY, { from: 'depot', gearId: GEAR })],
      extra,
    )
  }

  it('names the included Pieces, not the roster', () => {
    const state = twoTripFold()

    const [conflict] = overClaims(state)

    expect(conflict?.contestedPersonIds).toEqual([MARK])
  })

  it("settles when the contested Person's Piece comes off one Trip", () => {
    const state = twoTripFold(tripPieceRemoved(ALPS, ALPS_ENTRY, MARK))

    expect(overClaims(state)).toEqual([])
  })

  it("does not settle when an uncontested Person's Piece comes off", () => {
    const state = twoTripFold(tripPieceRemoved(ALPS, ALPS_ENTRY, ELS))

    expect(overClaims(state)).toHaveLength(1)
  })

  it('holds no claim at all when every Piece is removed', () => {
    // Alps's roster is only Mark and Els — removing both empties its
    // claim entirely. Vosges still claims normally, but a claim naming
    // nobody is not a claim, so there is nothing left to over-claim.
    const state = twoTripFold(
      tripPieceRemoved(ALPS, ALPS_ENTRY, MARK),
      tripPieceRemoved(ALPS, ALPS_ENTRY, ELS),
    )

    expect(overClaims(state)).toEqual([])
  })
})
