import { describe, expect, it } from 'vitest'

import {
  aGear,
  aPerson,
  aPlace,
  aTrip,
  depot,
  stamp,
} from '../testUtils/index.ts'
import {
  gearOwnedCountSet,
  gearRehomed,
  tripConsumedCountSet,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripOutcomeSet,
  tripPhaseMoved,
  tripPieceRemoved,
} from './authoring.ts'
import {
  closeTrip,
  reHomeOnTheSpot,
  reopenBlocked,
  reopenTrip,
} from './gestures.ts'
import { fold } from './reduce.ts'
import { ownedCountOf } from './selectors/depot.ts'
import { unpackTotals } from './selectors/unpack.ts'
import type {
  EntryState,
  GearState,
  HouseholdState,
  OutcomeValue,
  TripState,
} from './state.ts'

/**
 * Both gestures are pure functions of a fold: build one with the real
 * reducer (never a hand-shaped `HouseholdState`, `testUtils/log.ts`'s own
 * rule), pull out the `TripState`/`EntryState` under test, and assert on the
 * `OpSpec[]` the gesture returns. Neither gesture stamps an `hlc` — that is
 * `authorOp`'s job at the call site — so two `OpSpec`s are equal exactly
 * when their `aggregate`/`aggregate_id`/`type`/`payload` agree, which is
 * what `toEqual` checks.
 */

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

function gearFrom(state: HouseholdState, id: string): GearState {
  const gear = state.gear[id]
  if (gear === undefined) throw new Error(`the fold holds no Gear ${id}`)
  return gear
}

describe('reHomeOnTheSpot', () => {
  const TRIP = 't-rehome'
  const PLACE_ATTIC = 'p-attic'
  const PLACE_SHED = 'p-shed'

  it('on an open Entry emits [trip.outcome_set{back}, gear.rehomed], in that order', () => {
    const ENTRY = 'e-open'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aPlace({ id: PLACE_ATTIC, name: 'Attic' }),
      aGear({ id: 'g-open', name: 'Tent' }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-open' })],
    )
    const trip = tripFrom(state, TRIP)
    const entry = entryFrom(trip, ENTRY)
    const residence = { in: 'place' as const, id: PLACE_ATTIC }

    const ops = reHomeOnTheSpot(trip, entry, 'g-open', residence, state)

    expect(ops).toEqual([
      tripOutcomeSet(TRIP, ENTRY, 'back'),
      gearRehomed('g-open', residence),
    ])
  })

  it('on an Entry already back emits ONLY gear.rehomed — patterns.md §2.3, no needless write', () => {
    const ENTRY = 'e-back'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aPlace({ id: PLACE_ATTIC, name: 'Attic' }),
      aGear({ id: 'g-back', name: 'Tent' }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-back' }),
        tripOutcomeSet(TRIP, ENTRY, 'back'),
      ],
    )
    const trip = tripFrom(state, TRIP)
    const entry = entryFrom(trip, ENTRY)
    const residence = { in: 'place' as const, id: PLACE_ATTIC }

    const ops = reHomeOnTheSpot(trip, entry, 'g-back', residence, state)

    expect(ops).toEqual([gearRehomed('g-back', residence)])
  })

  it('on an Entry that is lost emits both — the found-it path', () => {
    const ENTRY = 'e-lost'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aPlace({ id: PLACE_ATTIC, name: 'Attic' }),
      aGear({ id: 'g-lost', name: 'Tent' }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-lost' }),
        tripOutcomeSet(TRIP, ENTRY, 'lost'),
      ],
    )
    const trip = tripFrom(state, TRIP)
    const entry = entryFrom(trip, ENTRY)
    const residence = { in: 'place' as const, id: PLACE_ATTIC }

    const ops = reHomeOnTheSpot(trip, entry, 'g-lost', residence, state)

    expect(ops).toEqual([
      tripOutcomeSet(TRIP, ENTRY, 'back'),
      gearRehomed('g-lost', residence),
    ])
  })

  it("emits gear.rehomed even when residence equals the current home — the rule's ONE stated exception", () => {
    // `rehomedSinceOutcome` (`selectors/unpack.ts`) draws the `RE-HOMED`
    // meta segment (spec §4.6) by comparing the Gear's `residence` stamp
    // against this Entry's `outcome` stamp — *the home moved at or after
    // this line was resolved*. If this write were "optimised" away because
    // `residence` already equals `residenceOf(gear)`, the ordinary case of
    // gear returning to the shelf it already nominally lived on would leave
    // the residence stamp OLDER than the outcome write this same call just
    // made, and the segment would silently fail to draw. (F16's settle
    // route, gear detail's `RESOLVE`, does NOT call this gesture — ruling
    // R30 corrected an earlier, wrong wiring — so this exception is read
    // for F5's own row alone now.) The Entry starts already `back` so the
    // outcome write is suppressed by the OTHER rule, isolating this one:
    // the sole op below must still be the rehome.
    const ENTRY = 'e-samehome'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aPlace({ id: PLACE_SHED, name: 'Shed' }),
      aGear({
        id: 'g-samehome',
        name: 'Tent',
        residence: { in: 'place', id: PLACE_SHED },
      }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-samehome' }),
        tripOutcomeSet(TRIP, ENTRY, 'back'),
      ],
    )
    const trip = tripFrom(state, TRIP)
    const entry = entryFrom(trip, ENTRY)
    // Identical to the Gear's own current residence.
    const residence = { in: 'place' as const, id: PLACE_SHED }

    const ops = reHomeOnTheSpot(trip, entry, 'g-samehome', residence, state)

    expect(ops).toEqual([gearRehomed('g-samehome', residence)])
  })

  describe('a non-container per-person Entry fans out per Piece (R10/R17)', () => {
    const PERSON_KIM = 'kim'
    const PERSON_MARK = 'mark'
    const PERSON_ELS = 'els'

    it('an unresolved Entry with 3 included Pieces emits 3 outcome ops plus one gear.rehomed', () => {
      const ENTRY = 'e-lamp'
      const state = depot(
        aTrip({
          id: TRIP,
          name: 'Ardennes',
          participants: [PERSON_KIM, PERSON_MARK, PERSON_ELS],
        }),
        aPlace({ id: PLACE_ATTIC, name: 'Attic' }),
        aPerson({ id: PERSON_KIM, name: 'Kim' }),
        aPerson({ id: PERSON_MARK, name: 'Mark' }),
        aPerson({ id: PERSON_ELS, name: 'Els' }),
        aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
        [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-lamp' })],
      )
      const trip = tripFrom(state, TRIP)
      const entry = entryFrom(trip, ENTRY)
      const residence = { in: 'place' as const, id: PLACE_ATTIC }

      const ops = reHomeOnTheSpot(trip, entry, 'g-lamp', residence, state)

      expect(ops).toEqual([
        tripOutcomeSet(TRIP, ENTRY, 'back', PERSON_ELS),
        tripOutcomeSet(TRIP, ENTRY, 'back', PERSON_KIM),
        tripOutcomeSet(TRIP, ENTRY, 'back', PERSON_MARK),
        gearRehomed('g-lamp', residence),
      ])
      // The Entry-level register itself is never touched — R10 makes it
      // read by nobody, so writing it would be a real op that settles
      // nothing.
      expect(Object.hasOwn(entry, 'outcome')).toBe(false)
    })

    it('a Piece already back is skipped — the same needless-write rule, one level down', () => {
      const ENTRY = 'e-lamp'
      const state = depot(
        aTrip({
          id: TRIP,
          name: 'Ardennes',
          participants: [PERSON_KIM, PERSON_MARK],
        }),
        aPlace({ id: PLACE_ATTIC, name: 'Attic' }),
        aPerson({ id: PERSON_KIM, name: 'Kim' }),
        aPerson({ id: PERSON_MARK, name: 'Mark' }),
        aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
        [
          tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-lamp' }),
          tripOutcomeSet(TRIP, ENTRY, 'back', PERSON_KIM),
        ],
      )
      const trip = tripFrom(state, TRIP)
      const entry = entryFrom(trip, ENTRY)
      const residence = { in: 'place' as const, id: PLACE_ATTIC }

      const ops = reHomeOnTheSpot(trip, entry, 'g-lamp', residence, state)

      expect(ops).toEqual([
        tripOutcomeSet(TRIP, ENTRY, 'back', PERSON_MARK),
        gearRehomed('g-lamp', residence),
      ])
    })

    it('a tombstoned Piece is not included and gets no op', () => {
      const ENTRY = 'e-lamp'
      const state = depot(
        aTrip({
          id: TRIP,
          name: 'Ardennes',
          participants: [PERSON_KIM, PERSON_MARK],
        }),
        aPlace({ id: PLACE_ATTIC, name: 'Attic' }),
        aPerson({ id: PERSON_KIM, name: 'Kim' }),
        aPerson({ id: PERSON_MARK, name: 'Mark' }),
        aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
        [
          tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-lamp' }),
          tripPieceRemoved(TRIP, ENTRY, PERSON_MARK),
        ],
      )
      const trip = tripFrom(state, TRIP)
      const entry = entryFrom(trip, ENTRY)
      const residence = { in: 'place' as const, id: PLACE_ATTIC }

      const ops = reHomeOnTheSpot(trip, entry, 'g-lamp', residence, state)

      expect(ops).toEqual([
        tripOutcomeSet(TRIP, ENTRY, 'back', PERSON_KIM),
        gearRehomed('g-lamp', residence),
      ])
    })

    it('a per-person CONTAINER Entry keeps the Entry-level write, not a fan-out', () => {
      const ENTRY = 'e-crate'
      const state = depot(
        aTrip({
          id: TRIP,
          name: 'Ardennes',
          participants: [PERSON_KIM, PERSON_MARK],
        }),
        aPlace({ id: PLACE_ATTIC, name: 'Attic' }),
        aPerson({ id: PERSON_KIM, name: 'Kim' }),
        aPerson({ id: PERSON_MARK, name: 'Mark' }),
        aGear({
          id: 'g-crate',
          name: 'Crate',
          kind: 'per_person',
          container: true,
        }),
        [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-crate' })],
      )
      const trip = tripFrom(state, TRIP)
      const entry = entryFrom(trip, ENTRY)
      const residence = { in: 'place' as const, id: PLACE_ATTIC }

      const ops = reHomeOnTheSpot(trip, entry, 'g-crate', residence, state)

      expect(ops).toEqual([
        tripOutcomeSet(TRIP, ENTRY, 'back'),
        gearRehomed('g-crate', residence),
      ])
    })
  })
})

describe('closeTrip', () => {
  const TRIP = 't-close'

  it('on a Trip with no consumed Counted Entries emits exactly [trip.phase_moved{closed}]', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({ id: 'g-back', name: 'Back gear' }),
      aGear({ id: 'g-lost', name: 'Lost gear' }),
      // Was an OPEN third Entry until ruling R36, which makes a Trip with any
      // open outcome return `[]` before it computes a reduction. That case
      // now has its own test at the bottom of this block; this one is about
      // "no consumed Counted Entries", so it resolves everything.
      aGear({ id: 'g-single', name: 'Single gear' }),
      [
        tripEntryAdded(TRIP, 'e-back', { from: 'depot', gearId: 'g-back' }),
        tripOutcomeSet(TRIP, 'e-back', 'back'),
        tripEntryAdded(TRIP, 'e-lost', { from: 'depot', gearId: 'g-lost' }),
        tripOutcomeSet(TRIP, 'e-lost', 'lost'),
        tripEntryAdded(TRIP, 'e-single', { from: 'depot', gearId: 'g-single' }),
        tripOutcomeSet(TRIP, 'e-single', 'consumed'),
      ],
    )
    const trip = tripFrom(state, TRIP)

    const ops = closeTrip(trip, state)

    expect(ops).toEqual([tripPhaseMoved(TRIP, 'closed')])
  })

  it('one consumed Counted Entry (owned ×6, consumed ×2) reduces to ×4, reduction before the phase move', () => {
    const ENTRY = 'e-consumed'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 6,
      }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, ENTRY, 4),
        tripOutcomeSet(TRIP, ENTRY, 'consumed'),
        tripConsumedCountSet(TRIP, ENTRY, 2),
      ],
    )
    const trip = tripFrom(state, TRIP)

    const ops = closeTrip(trip, state)

    expect(ops).toEqual([
      gearOwnedCountSet('g-gas', 4),
      tripPhaseMoved(TRIP, 'closed'),
    ])
  })

  it('sums two consumed Entries naming the same Gear into one gear.owned_count_set', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 6,
      }),
      [
        tripEntryAdded(TRIP, 'e-1', { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, 'e-1', 4),
        tripOutcomeSet(TRIP, 'e-1', 'consumed'),
        tripConsumedCountSet(TRIP, 'e-1', 2),
        tripEntryAdded(TRIP, 'e-2', { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, 'e-2', 3),
        tripOutcomeSet(TRIP, 'e-2', 'consumed'),
        tripConsumedCountSet(TRIP, 'e-2', 1),
      ],
    )
    const trip = tripFrom(state, TRIP)

    const ops = closeTrip(trip, state)

    expect(ops).toEqual([
      gearOwnedCountSet('g-gas', 3),
      tripPhaseMoved(TRIP, 'closed'),
    ])
  })

  it('floors a reduction that would go negative at 0', () => {
    const ENTRY = 'e-over'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 1,
      }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, ENTRY, 5),
        tripOutcomeSet(TRIP, ENTRY, 'consumed'),
        tripConsumedCountSet(TRIP, ENTRY, 5),
      ],
    )
    const trip = tripFrom(state, TRIP)

    const ops = closeTrip(trip, state)

    expect(ops).toEqual([
      gearOwnedCountSet('g-gas', 0),
      tripPhaseMoved(TRIP, 'closed'),
    ])
  })

  it('a consumed Entry whose Gear is not Counted contributes nothing — consumedCountOf is null', () => {
    const ENTRY = 'e-single-consumed'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({ id: 'g-single', name: 'Stove', kind: 'single' }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-single' }),
        tripOutcomeSet(TRIP, ENTRY, 'consumed'),
      ],
    )
    const trip = tripFrom(state, TRIP)

    const ops = closeTrip(trip, state)

    expect(ops).toEqual([tripPhaseMoved(TRIP, 'closed')])
  })

  it('calling it twice against the same fold produces identical ops — idempotence for concurrent closes', () => {
    const ENTRY = 'e-consumed'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 6,
      }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, ENTRY, 4),
        tripOutcomeSet(TRIP, ENTRY, 'consumed'),
        tripConsumedCountSet(TRIP, ENTRY, 2),
      ],
    )
    const trip = tripFrom(state, TRIP)

    const first = closeTrip(trip, state)
    const second = closeTrip(trip, state)

    expect(second).toEqual(first)
  })

  /**
   * **R27's own regression test — the sequential case, where the fold moves
   * between the two calls.** The test above pins idempotence *against one
   * unchanged fold*; this one is the case that broke before R27: apply the
   * first call's own ops (exactly what `emit` does after a tap), then call
   * `closeTrip` again against the fold that first close produced. Before
   * the `isClosed` guard, the second call read the Gear's already-reduced
   * owned count (3) and recomputed `3 − 2 = 1`, subtracting the
   * Consumed-count a second time with no crash and no second Device in
   * sight. After the guard, the second call sees `phase: 'closed'` and
   * returns `[]`.
   */
  it('recomputes nothing once the first close has already landed — the sequential case idempotence alone does not cover', () => {
    const ENTRY = 'e-consumed'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 5,
      }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, ENTRY, 4),
        tripOutcomeSet(TRIP, ENTRY, 'consumed'),
        tripConsumedCountSet(TRIP, ENTRY, 2),
      ],
    )
    const trip = tripFrom(state, TRIP)

    const first = closeTrip(trip, state)
    expect(first).toEqual([
      gearOwnedCountSet('g-gas', 3),
      tripPhaseMoved(TRIP, 'closed'),
    ])

    // Fold the first batch forward onto the SAME state, at a later stamp —
    // exactly what a Device's own `emit` does after the tap that produced
    // `first`.
    const closed = fold(stamp(first, { start: 100 }), state)
    const tripAfterFirstClose = tripFrom(closed, TRIP)

    const second = closeTrip(tripAfterFirstClose, closed)

    expect(second).toEqual([])
  })

  it('emits nothing on a Trip already closed, even with an unreduced Consumed Entry — R27 Layer B overturns I1', () => {
    // I1 kept the reduction firing unconditionally on an already-closed
    // Trip, reasoning that a Device dying between the reduction and the
    // phase move needed a retry to still apply it (the die-mid-batch
    // recovery path). Review showed that guard produces exactly the wrong
    // pair on the far more ordinary no-crash double tap — see the test
    // above and `gestures.ts`'s own docblock. There is no way, from this
    // fold alone, to tell "the reduction never landed" apart from "the
    // reduction landed and this fold already reflects it" — R28 records
    // that residual gap rather than papering over it with a guess.
    const ENTRY = 'e-consumed'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes', phase: 'closed' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 6,
      }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, ENTRY, 4),
        tripOutcomeSet(TRIP, ENTRY, 'consumed'),
        tripConsumedCountSet(TRIP, ENTRY, 2),
      ],
    )
    const trip = tripFrom(state, TRIP)

    const ops = closeTrip(trip, state)

    expect(ops).toEqual([])
  })

  it('emits nothing on an already-closed Trip with nothing to reduce either', () => {
    const state = depot(aTrip({ id: TRIP, name: 'Ardennes', phase: 'closed' }))
    const trip = tripFrom(state, TRIP)

    const ops = closeTrip(trip, state)

    expect(ops).toEqual([])
  })

  /**
   * **Ruling R36 — the gate that both shipped callers already apply, said
   * here too.** F5's close card and `PhaseSheet`'s `CLOSED` row each withhold
   * their control while `open > 0`, so nothing a Quartermaster can reach
   * changes; what changes is what a *third* caller inherits. Without this,
   * such a caller picks up the anti-double-reduce guard above for free and
   * silently **not** invariant 18's *"there is no override"*. A documented,
   * tested silence is not a hidden bug.
   */
  it('emits nothing while any outcome is still open — invariant 18 stated in the gesture, not only at two screens (R36)', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 6,
      }),
      aGear({ id: 'g-tent', name: 'Tent' }),
      [
        tripEntryAdded(TRIP, 'e-consumed', {
          from: 'depot',
          gearId: 'g-gas',
        }),
        tripEntryBringCountSet(TRIP, 'e-consumed', 4),
        tripOutcomeSet(TRIP, 'e-consumed', 'consumed'),
        tripConsumedCountSet(TRIP, 'e-consumed', 2),
        // Never resolved — the one open outcome that must hold the close.
        tripEntryAdded(TRIP, 'e-open', { from: 'depot', gearId: 'g-tent' }),
      ],
    )
    const trip = tripFrom(state, TRIP)

    expect(unpackTotals(trip, state).open).toBe(1)
    expect(closeTrip(trip, state)).toEqual([])
  })

  it('an outcome this build cannot name counts as resolved, so a Trip a later build finished still closes (R36 caveat 2)', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({ id: 'g-tent', name: 'Tent' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        // §5.3 obligation 4: a value some later build wrote deliberately.
        tripOutcomeSet(TRIP, 'e-tent', 'donated' as OutcomeValue),
      ],
    )
    const trip = tripFrom(state, TRIP)

    expect(unpackTotals(trip, state).open).toBe(0)
    expect(closeTrip(trip, state)).toEqual([tripPhaseMoved(TRIP, 'closed')])
  })
})

describe('reopenBlocked', () => {
  const TRIP = 't-reopen'

  it('is false on a closed Trip whose close owed the Depot nothing — the lost tent in November', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes', phase: 'closed' }),
      aGear({ id: 'g-tent', name: 'Tent' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        // `lost` writes nothing against the Depot at all (story 11), so this
        // Trip's close owed no reduction and reopening it is exact.
        tripOutcomeSet(TRIP, 'e-tent', 'lost'),
      ],
    )

    expect(reopenBlocked(tripFrom(state, TRIP), state)).toBe(false)
  })

  it('is true on a closed Trip whose close applied a reduction', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes', phase: 'closed' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 4,
      }),
      [
        tripEntryAdded(TRIP, 'e-gas', { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, 'e-gas', 4),
        tripOutcomeSet(TRIP, 'e-gas', 'consumed'),
        tripConsumedCountSet(TRIP, 'e-gas', 2),
      ],
    )

    expect(reopenBlocked(tripFrom(state, TRIP), state)).toBe(true)
  })

  /**
   * The predicate reads `consumedReductions`, which already gates a
   * `consumed` outcome to a Counted **depot** Entry — so a Trip whose only
   * consumption is on a Single owes nothing and reopens exactly. This is the
   * whole reason the gate and `ReopenConfirm`'s fact line ask that one
   * selector rather than re-deriving `outcomeOf` plus a Kind check.
   */
  it('is false when the only consumed Entry names a Gear that is not Counted', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes', phase: 'closed' }),
      aGear({ id: 'g-stove', name: 'Stove' }),
      [
        tripEntryAdded(TRIP, 'e-stove', { from: 'depot', gearId: 'g-stove' }),
        tripOutcomeSet(TRIP, 'e-stove', 'consumed'),
      ],
    )

    expect(reopenBlocked(tripFrom(state, TRIP), state)).toBe(false)
  })

  it('is false on a Trip that is not closed at all, whatever it would owe', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 4,
      }),
      [
        tripEntryAdded(TRIP, 'e-gas', { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, 'e-gas', 4),
        tripOutcomeSet(TRIP, 'e-gas', 'consumed'),
        tripConsumedCountSet(TRIP, 'e-gas', 2),
      ],
    )

    expect(reopenBlocked(tripFrom(state, TRIP), state)).toBe(false)
  })
})

describe('reopenTrip', () => {
  const TRIP = 't-reopen-gesture'

  it('emits the phase move on a closed Trip whose close owed nothing', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes', phase: 'closed' }),
      aGear({ id: 'g-tent', name: 'Tent' }),
      [
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
        tripOutcomeSet(TRIP, 'e-tent', 'lost'),
      ],
    )

    expect(reopenTrip(tripFrom(state, TRIP), 'unpack', state)).toEqual([
      tripPhaseMoved(TRIP, 'unpack'),
    ])
  })

  it('names the phase it is handed — SET PHASE offers all four rows out of closed', () => {
    const state = depot(aTrip({ id: TRIP, name: 'Ardennes', phase: 'closed' }))

    expect(reopenTrip(tripFrom(state, TRIP), 'draft', state)).toEqual([
      tripPhaseMoved(TRIP, 'draft'),
    ])
  })

  it('emits nothing on a Trip that is not closed — there is nothing to reopen', () => {
    const state = depot(aTrip({ id: TRIP, name: 'Ardennes' }))

    expect(reopenTrip(tripFrom(state, TRIP), 'unpack', state)).toEqual([])
  })

  it('emits nothing on a closed Trip whose close applied a reduction', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes', phase: 'closed' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 4,
      }),
      [
        tripEntryAdded(TRIP, 'e-gas', { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, 'e-gas', 4),
        tripOutcomeSet(TRIP, 'e-gas', 'consumed'),
        tripConsumedCountSet(TRIP, 'e-gas', 2),
      ],
    )

    expect(reopenTrip(tripFrom(state, TRIP), 'unpack', state)).toEqual([])
  })

  /**
   * **The regression test for the live defect this gate closes**, in the
   * sequential shape R27's own test established: apply each call's ops to
   * the fold, exactly as `emit` does after a tap, and ask what the **Depot**
   * reads at the end.
   *
   * Before the gate these four taps ran `owned 6 → 4 → (the reopen writes
   * nothing) → 2`: the second close read the **already-reduced** count and
   * subtracted the Consumed-count again. `gear.owned_count_set` is absolute,
   * never a delta ([sync §4.3](../../docs/sync-protocol.md)), and a reopened
   * Trip's fold reads `unpack` exactly like a Trip that was never closed, so
   * `closeTrip`'s own `isClosed` guard cannot see this path.
   *
   * After the gate the reopen emits nothing, the Trip never leaves `closed`,
   * and the second close returns `[]` through the guard that *can* see it.
   *
   * **It asserts the Depot's own count and deliberately nothing about the
   * three op lists on the way there.** Each of those is already pinned by a
   * test of its own, and asserting them here would make this test fail at
   * the *reopen* the moment the gate regressed — reporting an empty-array
   * mismatch and never reaching the `×2` this test exists to name. One test,
   * one claim: whatever route a future change takes, four taps must leave
   * the canister at ×4.
   */
  it('close → reopen → close leaves the owned count reduced exactly once', () => {
    const ENTRY = 'e-gas'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 6,
      }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, ENTRY, 4),
        tripOutcomeSet(TRIP, ENTRY, 'consumed'),
        tripConsumedCountSet(TRIP, ENTRY, 2),
      ],
    )

    const firstClose = closeTrip(tripFrom(state, TRIP), state)
    const closed = fold(stamp(firstClose, { start: 100 }), state)

    const reopen = reopenTrip(tripFrom(closed, TRIP), 'unpack', closed)
    const reopened = fold(stamp(reopen, { start: 200 }), closed)

    const secondClose = closeTrip(tripFrom(reopened, TRIP), reopened)
    const finalState = fold(stamp(secondClose, { start: 300 }), reopened)

    // The whole point: ×4, never ×2.
    expect(ownedCountOf(gearFrom(finalState, 'g-gas'))).toBe(4)
  })
})
