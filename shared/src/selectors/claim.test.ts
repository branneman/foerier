import { describe, expect, it } from 'vitest'

import { aGear, aTrip, depot } from '../../testUtils/index.ts'
import {
  gearKindSet,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripOutcomeSet,
  tripPieceRemoved,
  type OpSpec,
} from '../authoring.ts'
import type { HouseholdState } from '../state.ts'
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

  function twoTripFold(...extra: readonly OpSpec[]): HouseholdState {
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

  it("drops a fully-resolved per-person Entry's zero-count claim from OverClaim.claims (F2)", () => {
    // Alps has only Mark as a Participant, and his Piece there is resolved
    // by outcome (not removed) — so `claimFor`'s per-Piece filter empties
    // `personIds` and `claimsByGear`'s pre-existing "a claim naming nobody
    // is not a claim" guard must drop it, exactly as it does for a
    // tombstoned Piece. Vosges and Chamonix both still claim Mark
    // unresolved: a genuine over-claim that must name only those two Trips.
    // If Alps's zero-count claim rode along in `claims`, it would offer a
    // settle route pointing at an Entry that has already resolved.
    const CHAMONIX = 't-chamonix'
    const CHAMONIX_ENTRY = 'e-chamonix'
    const state = depot(
      aGear({ id: GEAR, kind: 'per_person' }),
      aTrip({ id: ALPS, phase: 'pack_out', participants: [MARK] }),
      [
        tripEntryAdded(ALPS, ALPS_ENTRY, { from: 'depot', gearId: GEAR }),
        tripOutcomeSet(ALPS, ALPS_ENTRY, 'back', MARK),
      ],
      aTrip({ id: VOSGES, phase: 'on_trip', participants: [MARK] }),
      [tripEntryAdded(VOSGES, VOSGES_ENTRY, { from: 'depot', gearId: GEAR })],
      aTrip({ id: CHAMONIX, phase: 'unpack', participants: [MARK] }),
      [
        tripEntryAdded(CHAMONIX, CHAMONIX_ENTRY, {
          from: 'depot',
          gearId: GEAR,
        }),
      ],
    )

    const result = overClaims(state)

    expect(result).toHaveLength(1)
    expect(result[0]!.contestedPersonIds).toEqual([MARK])
    expect(result[0]!.claims.map((c) => c.tripId).sort()).toEqual([
      CHAMONIX,
      VOSGES,
    ])
  })

  it("releases exactly Mark's claim, not Els's or the whole Entry's, when his Piece on one Trip is resolved", () => {
    // A fixture distinct from `twoTripFold`, deliberately: this one needs
    // Els on BOTH Trips, untouched, so a whole-Entry release and a per-Piece
    // release produce *different* answers rather than agreeing by accident.
    //
    // Before any resolution: Mark and Els are each on both Trips, so both
    // are contested. Resolving Mark's Piece on Alps alone must drop him from
    // Alps's claim without touching Els's Piece there — leaving Els still
    // named by both Alps and Vosges, still genuinely contested, and Mark
    // named by Vosges alone.
    //
    // A whole-Entry release would instead drop Alps's *entire* claim the
    // moment any Piece on it is resolved — Els included — leaving her named
    // by Vosges only and nobody contested at all: `overClaims` would read
    // `[]`, indistinguishable from "nothing was ever wrong". Asserting
    // `contestedPersonIds === [ELS]` here is what a whole-Entry release
    // cannot produce.
    function threePersonFold(...extra: readonly OpSpec[]): HouseholdState {
      return depot(
        aGear({ id: GEAR, kind: 'per_person' }),
        aTrip({ id: ALPS, phase: 'pack_out', participants: [MARK, ELS] }),
        [tripEntryAdded(ALPS, ALPS_ENTRY, { from: 'depot', gearId: GEAR })],
        aTrip({
          id: VOSGES,
          phase: 'on_trip',
          participants: [MARK, ELS, KIM],
        }),
        [tripEntryAdded(VOSGES, VOSGES_ENTRY, { from: 'depot', gearId: GEAR })],
        extra,
      )
    }

    // Sanity: both Mark and Els are contested before anything is resolved.
    const before = overClaims(threePersonFold())
    expect(before).toHaveLength(1)
    expect(before[0]!.contestedPersonIds).toEqual([ELS, MARK])

    const state = threePersonFold(
      tripOutcomeSet(ALPS, ALPS_ENTRY, 'back', MARK),
    )

    const result = overClaims(state)
    expect(result).toHaveLength(1)
    expect(result[0]!.contestedPersonIds).toEqual([ELS])
    expect(result[0]!.claims.find((c) => c.tripId === ALPS)?.personIds).toEqual(
      [ELS],
    )
    // `piecesOf` orders by id (`participantIds`' total order), not roster
    // order — 'p-els' < 'p-kim' < 'p-mark'.
    expect(
      result[0]!.claims.find((c) => c.tripId === VOSGES)?.personIds,
    ).toEqual([ELS, KIM, MARK])
  })
})

describe('an unpack outcome releases the claim (S10, spec §3.3)', () => {
  function twoActiveTripsOnSingleGear(
    ...extra: readonly OpSpec[]
  ): HouseholdState {
    return depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'on_trip' }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' }), ...extra],
    )
  }

  it.each(['back', 'consumed', 'lost'] as const)(
    'resolving either Entry with outcome %s makes the over-claim disappear',
    (outcome) => {
      // Sanity: the pair genuinely over-claims before either is resolved —
      // otherwise the assertion below would pass for the wrong reason.
      expect(overClaims(twoActiveTripsOnSingleGear())).toHaveLength(1)

      const resolved = twoActiveTripsOnSingleGear(
        tripOutcomeSet('t2', 'e2', outcome),
      )

      expect(overClaims(resolved)).toEqual([])
    },
  )

  it("an unrecognised outcome releases the claim too — a peer on a later build must not hold this build's supply hostage", () => {
    expect(overClaims(twoActiveTripsOnSingleGear())).toHaveLength(1)

    const resolved = twoActiveTripsOnSingleGear(
      tripOutcomeSet('t2', 'e2', 'donated'),
    )

    expect(overClaims(resolved)).toEqual([])
  })

  it('a resolved Entry contributes nothing to claimed, even alone', () => {
    // Counted gear owned ×2, one Trip bringing ×4: unresolved this
    // over-claims on its own; resolved, it contributes nothing.
    const unresolved = depot(
      aGear({ id: 'g1', kind: 'counted', ownedCount: 2 }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [
        tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' }),
        tripEntryBringCountSet('t1', 'e1', 4),
      ],
    )
    expect(overClaims(unresolved)).toHaveLength(1)

    const resolved = depot(
      aGear({ id: 'g1', kind: 'counted', ownedCount: 2 }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [
        tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' }),
        tripEntryBringCountSet('t1', 'e1', 4),
        tripOutcomeSet('t1', 'e1', 'back'),
      ],
    )
    expect(overClaims(resolved)).toEqual([])
  })

  it('an outcome of null clears back to open and re-creates the claim', () => {
    // The intermediate state (resolved, no clear yet) must itself be empty —
    // otherwise the final assertion alone would not show the null clear did
    // anything, only that a resolved-then-reopened Entry over-claims, which
    // is true regardless of what "back" did.
    const resolved = twoActiveTripsOnSingleGear(
      tripOutcomeSet('t2', 'e2', 'back'),
    )
    expect(overClaims(resolved)).toEqual([])

    const reopened = twoActiveTripsOnSingleGear(
      tripOutcomeSet('t2', 'e2', 'back'),
      tripOutcomeSet('t2', 'e2', null),
    )
    expect(overClaims(reopened)).toHaveLength(1)
  })

  it('resolving an Entry on a Draft Trip changes nothing — it held no claim to release', () => {
    // A third, genuinely active pair (t1/t3) provides the conflict this test
    // checks survives untouched — a Draft holding no claim regardless of its
    // outcome is otherwise indistinguishable from "nothing here ever
    // conflicted", since t2 alone never claims anything at any phase.
    const state = depot(
      aGear({ id: 'g1', kind: 'single' }),
      aTrip({ id: 't1', phase: 'pack_out' }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't3', phase: 'on_trip' }),
      [tripEntryAdded('t3', 'e3', { from: 'depot', gearId: 'g1' })],
      aTrip({ id: 't2', phase: 'draft' }),
      [
        tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g1' }),
        tripOutcomeSet('t2', 'e2', 'back'),
      ],
    )

    const result = overClaims(state)
    expect(result).toHaveLength(1)
    expect(result[0]!.claims.map((c) => c.tripId).sort()).toEqual(['t1', 't3'])
  })
})

describe('a per-person container Entry releases via its own outcome (ruling R10)', () => {
  // The mirror case to the S10 describe block above: `unpackItems` puts the
  // outcome on a per-person *container* Entry itself (container checked
  // before the per-person fan-out there), so this file's Entry-level gate
  // must stay authoritative for it — unlike a non-container per-person
  // Entry, whose Entry-level `outcome` register is fold-but-ignore for claim
  // purposes and released only per-Piece (see `claimsByGear`'s own note).
  it("releases the whole Entry's claim when a per-person CONTAINER Entry's own outcome is recorded", () => {
    const state = depot(
      aGear({ id: 'g-crate', kind: 'per_person', container: true }),
      aTrip({ id: 't1', phase: 'pack_out', participants: ['p1', 'p2'] }),
      [tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g-crate' })],
      aTrip({ id: 't2', phase: 'on_trip', participants: ['p1', 'p3'] }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g-crate' })],
    )

    // Sanity: p1 is on both Trips, so the pair genuinely over-claims before
    // either Entry's outcome is recorded.
    expect(overClaims(state)).toHaveLength(1)

    const resolved = depot(
      aGear({ id: 'g-crate', kind: 'per_person', container: true }),
      aTrip({ id: 't1', phase: 'pack_out', participants: ['p1', 'p2'] }),
      [
        tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g-crate' }),
        // Entry-level — no `personId` — the container's own outcome, not
        // one Piece's.
        tripOutcomeSet('t1', 'e1', 'back'),
      ],
      aTrip({ id: 't2', phase: 'on_trip', participants: ['p1', 'p3'] }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g-crate' })],
    )

    // t1's whole claim is gone (both p1 and p2), leaving only t2's — a
    // build that instead treated every per-person Entry as fold-but-ignore
    // at the Entry level would leave p1 double-claimed here and fail.
    expect(overClaims(resolved)).toEqual([])
  })
})

describe("ruling R11: a per-person CONTAINER Entry's claim ignores per-Piece outcomes", () => {
  // The companion fix to the R10 describe block above, from the opposite
  // direction: R10 established that only the container's own Entry-level
  // outcome releases its claim. R11 closes the other half — a per-Piece
  // outcome (off-label: no screen in this codebase ever authors one against
  // a container Entry, since `unpackItems` checks container-ness before the
  // per-person fan-out and never produces a per-piece unpack item for one)
  // must not be read either, or `claimFor`'s old unconditional filter would
  // silently narrow, and even empty, a container's claim by a register
  // nothing else in the app treats as meaningful for it.
  it('keeps the whole claim when every included Piece carries its own outcome — only the Entry-level outcome may release a container', () => {
    const state = depot(
      aGear({ id: 'g-crate', kind: 'per_person', container: true }),
      aTrip({ id: 't1', phase: 'pack_out', participants: ['p1', 'p2'] }),
      [
        tripEntryAdded('t1', 'e1', { from: 'depot', gearId: 'g-crate' }),
        // Per-Piece — not Entry-level — outcomes on the container itself.
        tripOutcomeSet('t1', 'e1', 'back', 'p1'),
        tripOutcomeSet('t1', 'e1', 'back', 'p2'),
      ],
      aTrip({ id: 't2', phase: 'on_trip', participants: ['p1', 'p3'] }),
      [tripEntryAdded('t2', 'e2', { from: 'depot', gearId: 'g-crate' })],
    )

    // Before R11: `claimFor` filtered both p1 and p2 out of t1's claim by
    // their own (off-label) outcome, leaving `personIds: []` — which
    // `claimsByGear`'s "a claim naming nobody is not a claim" guard then
    // drops entirely, and the genuine over-claim on p1 (t1 and t2 both
    // claim him) would vanish along with it.
    const result = overClaims(state)
    expect(result).toHaveLength(1)
    expect(result[0]!.contestedPersonIds).toEqual(['p1'])
    expect(result[0]!.claims.find((c) => c.tripId === 't1')?.personIds).toEqual(
      ['p1', 'p2'],
    )
  })
})
