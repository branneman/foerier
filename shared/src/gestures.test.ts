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
  tripConsumptionPosted,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripOutcomeSet,
  tripPhaseMoved,
  tripPieceRemoved,
} from './authoring.ts'
import {
  closeTrip,
  reHomeOnTheSpot,
  reopenTrip,
  restoreConsumption,
} from './gestures.ts'
import { fold } from './reduce.ts'
import { ownedCountOf } from './selectors/depot.ts'
import { postedOf, unpackTotals } from './selectors/unpack.ts'
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

  it('one consumed Counted Entry (owned ×6, consumed ×2) reduces to ×4, posts ×2, phase move last', () => {
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

    // The order is the assertion: the reduction before its own posting
    // (spec §2.3 — a posting without its reduction makes a later close skip
    // a reduction that never landed), and `trip.phase_moved` last regardless
    // of how many Gears the loop above it touched.
    expect(ops).toEqual([
      gearOwnedCountSet('g-gas', 4),
      tripConsumptionPosted(TRIP, 'g-gas', 2),
      tripPhaseMoved(TRIP, 'closed'),
    ])
  })

  it('sums two consumed Entries naming the same Gear into one gear.owned_count_set and one posting', () => {
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

    // `consumedReductions` sums both Entries before this function reads a
    // single base count (its own docblock) — one posting per Gear, not one
    // per Entry, exactly as there is one `gear.owned_count_set` per Gear.
    expect(ops).toEqual([
      gearOwnedCountSet('g-gas', 3),
      tripConsumptionPosted(TRIP, 'g-gas', 3),
      tripPhaseMoved(TRIP, 'closed'),
    ])
  })

  /**
   * **The floor applies to the pair, not to the owned-count write alone.**
   * Over-claim is a supported state (S7 surfaces it and never blocks it), so
   * `owed` (×5) can exceed what the Depot holds (×1). The reduction takes
   * what there is — ×1 — and the posting records ×1, because the register is
   * *"the running total this Trip has posted against that Gear's owned
   * count"* (spec §2.1): what was **applied**, not what was declared.
   * Posting the unfloored ×5 was a live over-credit — see the restore
   * sequence at the bottom of `restoreConsumption`'s own block, which is the
   * assertion that would catch a regression to it.
   */
  it('floors the reduction AND its posting at what the Depot had to give', () => {
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
      tripConsumptionPosted(TRIP, 'g-gas', 1),
      tripPhaseMoved(TRIP, 'closed'),
    ])
  })

  /**
   * **A partly-satisfiable close posts the part it satisfied, and a later
   * close finishes the job against a hand-corrected count.** owned ×3 with
   * ×5 owed applies ×3; re-raising the Depot to ×10 and closing again
   * applies the remaining ×2 and lands the running total on ×5 — the total
   * this Trip owed, reached in two instalments and never exceeded.
   */
  it('a second close applies only the remainder once the Depot can afford it', () => {
    const ENTRY = 'e-part'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 3,
      }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, ENTRY, 5),
        tripOutcomeSet(TRIP, ENTRY, 'consumed'),
        tripConsumedCountSet(TRIP, ENTRY, 5),
      ],
    )

    const first = closeTrip(tripFrom(state, TRIP), state)
    expect(first).toEqual([
      gearOwnedCountSet('g-gas', 0),
      tripConsumptionPosted(TRIP, 'g-gas', 3),
      tripPhaseMoved(TRIP, 'closed'),
    ])
    const closed = fold(stamp(first, { start: 100 }), state)

    // Reopened, and the shelf restocked by hand — unrelated to this Trip.
    const reopened = fold(
      stamp(
        [
          ...reopenTrip(tripFrom(closed, TRIP), 'unpack', closed),
          gearOwnedCountSet('g-gas', 10),
        ],
        { start: 200 },
      ),
      closed,
    )

    const second = closeTrip(tripFrom(reopened, TRIP), reopened)
    expect(second).toEqual([
      gearOwnedCountSet('g-gas', 8),
      tripConsumptionPosted(TRIP, 'g-gas', 5),
      tripPhaseMoved(TRIP, 'closed'),
    ])
  })

  /**
   * **`applied === 0` with the close already on the record writes nothing —
   * and with no record at all writes the `0`.** The first is the re-close
   * after a declined offer: owed ×5, posted ×1, owned ×0, so a
   * `gear.owned_count_set(0)` over `0` and a posting of the value already
   * held are both needless writes (`patterns.md` §2.3). The second is a
   * close that could apply nothing at all — the `0` posting is what stops
   * {@link reopenTrip}'s back-fill later fabricating a posting of the whole
   * `owed` for it, which would re-open the over-credit through a second
   * door.
   */
  it('writes nothing when the Depot has nothing left and this close is already recorded', () => {
    const ENTRY = 'e-declined'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 0,
      }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, ENTRY, 5),
        tripOutcomeSet(TRIP, ENTRY, 'consumed'),
        tripConsumedCountSet(TRIP, ENTRY, 5),
        tripConsumptionPosted(TRIP, 'g-gas', 1),
      ],
    )
    const trip = tripFrom(state, TRIP)

    expect(postedOf(trip, 'g-gas')).toBe(1)
    expect(closeTrip(trip, state)).toEqual([tripPhaseMoved(TRIP, 'closed')])
  })

  it('posts the 0 when it could apply nothing and holds no register yet', () => {
    const ENTRY = 'e-nothing'
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 0,
      }),
      [
        tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, ENTRY, 5),
        tripOutcomeSet(TRIP, ENTRY, 'consumed'),
        tripConsumedCountSet(TRIP, ENTRY, 5),
      ],
    )
    const trip = tripFrom(state, TRIP)

    // No `gear.owned_count_set` — writing `0` over `0` moves a stamp for
    // nothing — but the posting stands, because absence is what the
    // back-fill reads as "this close was never recorded".
    expect(closeTrip(trip, state)).toEqual([
      tripConsumptionPosted(TRIP, 'g-gas', 0),
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
      tripConsumptionPosted(TRIP, 'g-gas', 2),
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

  it('a negative delta (posted 4, owed 2) makes the close emit neither op for that gear', () => {
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
        // Simulates a posting ahead of what this Trip currently owes — the
        // shape a restoration (spec §3) can leave behind once a lowered
        // Consumed-count is re-raised only part way. `owed` (2) − `posted`
        // (4) is negative, and §2.2's bottom row says the close skips it
        // silently; only the offer (`restoreConsumption`) may lower a
        // posting, and never the close.
        tripConsumptionPosted(TRIP, 'g-gas', 4),
      ],
    )
    const trip = tripFrom(state, TRIP)

    expect(postedOf(trip, 'g-gas')).toBe(4)
    expect(closeTrip(trip, state)).toEqual([tripPhaseMoved(TRIP, 'closed')])
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

  /**
   * **§5.2's whole reason for existing.** A closed Trip in a real household
   * today was closed by a build with no posting op: its `postings` map is
   * empty and its `owed` is ×2, indistinguishable from *nothing was ever
   * posted*. `reopenTrip` records what that close already did, from
   * `consumedReductions` computed **now** — legitimate because G6 makes F5
   * on a closed Trip a record: every write is withheld, so a closed Trip's
   * outcomes are frozen and this read is exactly what that close applied.
   * `g-gas`'s `ownedCount: 4` here stands in for "a pre-S11 build already
   * subtracted ×2 from ×6"; nothing in this test computes that arithmetic
   * again, because §5.2 does not — it only records that the reduction
   * already happened.
   */
  it('back-fills a gear with no posting register — a pre-S11 close', () => {
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

    expect(reopenTrip(tripFrom(state, TRIP), 'unpack', state)).toEqual([
      tripConsumptionPosted(TRIP, 'g-gas', 2),
      tripPhaseMoved(TRIP, 'unpack'),
    ])
  })

  /**
   * **The one place the presence check and `postedOf` deliberately
   * disagree** (spec §5.2). `g-rope`'s posting was explicitly restored to
   * `0` — a close that *was* recorded, and whose units this Trip already
   * handed back (§3) — so `trip.postings?.['g-rope'] !== undefined` is
   * `true` and the back-fill leaves it alone. Reading `postedOf(...) > 0`
   * instead would read `0` as "never posted" and fabricate a second posting
   * for a Gear whose close this build already knows about. `g-gas` carries
   * no register at all, so it still back-fills — proving the two Gears are
   * told apart by presence, not by value — and the phase move stays last.
   */
  it('skips a gear whose posting register is present at 0, back-fills the rest, phase move last', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes', phase: 'closed' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 4,
      }),
      aGear({
        id: 'g-rope',
        name: 'Rope',
        kind: 'counted',
        ownedCount: 9,
      }),
      [
        tripEntryAdded(TRIP, 'e-gas', { from: 'depot', gearId: 'g-gas' }),
        tripEntryBringCountSet(TRIP, 'e-gas', 4),
        tripOutcomeSet(TRIP, 'e-gas', 'consumed'),
        tripConsumedCountSet(TRIP, 'e-gas', 2),
        tripEntryAdded(TRIP, 'e-rope', { from: 'depot', gearId: 'g-rope' }),
        tripEntryBringCountSet(TRIP, 'e-rope', 3),
        tripOutcomeSet(TRIP, 'e-rope', 'consumed'),
        tripConsumedCountSet(TRIP, 'e-rope', 3),
        tripConsumptionPosted(TRIP, 'g-rope', 0),
      ],
    )

    expect(reopenTrip(tripFrom(state, TRIP), 'unpack', state)).toEqual([
      tripConsumptionPosted(TRIP, 'g-gas', 2),
      tripPhaseMoved(TRIP, 'unpack'),
    ])
  })

  /**
   * **The regression test for the live defect this slice closes**, in the
   * sequential shape R27's own test established: apply each call's ops to
   * the fold, exactly as `emit` does after a tap, and ask what the second
   * close's own op list — not just the Depot's final number — says.
   *
   * Before S11 these four taps ran `owned 6 → 4 → reopen (a bare phase
   * move, no posting) → 2`: the second close read the **already-reduced**
   * count and subtracted the Consumed-count again. `gear.owned_count_set`
   * is absolute, never a delta ([sync §4.3](../../docs/sync-protocol.md)),
   * and a reopened Trip's fold reads `unpack` exactly like a Trip that was
   * never closed, so `closeTrip`'s own `isClosed` guard cannot see this
   * path.
   *
   * After S11 the first close posts what it reduced (§2.3); the reopen's
   * back-fill has nothing to do, since this Gear already carries a
   * register; the second close computes `delta = owed (2) − posted (2) =
   * 0` and skips the Gear — no `gear.owned_count_set` at all, for this
   * Gear or any other. **This one assertion is the slice**: not that the
   * final count happens to come out right, but that the second close's own
   * op list carries no reduction to make it so.
   */
  it('close → reopen → close leaves the owned count reduced exactly once, and the second close emits no reduction', () => {
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

    // The slice's own assertion: the second close writes no reduction for
    // this Gear at all.
    expect(secondClose).toEqual([tripPhaseMoved(TRIP, 'closed')])
    // And the number that assertion protects: ×4, never ×2.
    expect(ownedCountOf(gearFrom(finalState, 'g-gas'))).toBe(4)
  })
})

describe('restoreConsumption', () => {
  const TRIP = 't-restore'

  /**
   * **The target is computed from the count now, not reset to a number
   * nobody recorded** (spec §3). Posted ×4, owed 0 (the outcome has moved
   * off `consumed`, or been cleared) — but the Depot's own owned-count has
   * since been hand-corrected to 5, independently of this Trip. The
   * restoration raises it by exactly what this Trip is giving back
   * (`posted − owed` = 4), landing on 9, and posts the new absolute target
   * (0) — never the old ×4 this Trip no longer owes.
   */
  it('computes its target from the count now: posted 4, owed 0, hand-corrected owned 5 → owned 9, posts 0, in that order', () => {
    const state = depot(
      aTrip({ id: TRIP, name: 'Ardennes', phase: 'unpack' }),
      aGear({
        id: 'g-gas',
        name: 'Gas canister',
        kind: 'counted',
        ownedCount: 5,
      }),
      [tripConsumptionPosted(TRIP, 'g-gas', 4)],
    )
    const trip = tripFrom(state, TRIP)
    expect(postedOf(trip, 'g-gas')).toBe(4)

    const ops = restoreConsumption(trip, 'g-gas', 0, state)

    expect(ops).toEqual([
      gearOwnedCountSet('g-gas', 9),
      tripConsumptionPosted(TRIP, 'g-gas', 0),
    ])
  })

  /**
   * **The over-claim sequence, end to end — the review finding this block
   * exists to pin.** Owned ×1, Bring-count ×5, all ×5 consumed: over-claim
   * is a supported state (S7 surfaces it and never blocks it), so the close
   * owes ×5 against a Depot that holds ×1. Close, reopen, tap the outcome to
   * `back`, then take the restoration offer.
   *
   * While the close posted the **unfloored** `owed`, this ran ×1 → ×0 →
   * restore ×0 + (5 − 0) = **×5** — the household ending up owning five of
   * something it owned one of, in four ordinary taps on one Device with no
   * crash: the same shape of defect S11 exists to remove, reintroduced by
   * the gesture that hands units back. Posting what was **applied** (×1)
   * makes the restoration hand back exactly ×1.
   *
   * The assertion is on the fold, not on the op list, because the op list
   * was individually defensible at every step and the number still came out
   * wrong.
   */
  it('close (floored) → reopen → restore hands back only what the close took', () => {
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

    const closed = fold(
      stamp(closeTrip(tripFrom(state, TRIP), state), { start: 100 }),
      state,
    )
    expect(ownedCountOf(gearFrom(closed, 'g-gas'))).toBe(0)
    expect(postedOf(tripFrom(closed, TRIP), 'g-gas')).toBe(1)

    const reopened = fold(
      stamp(reopenTrip(tripFrom(closed, TRIP), 'unpack', closed), {
        start: 200,
      }),
      closed,
    )

    // The outcome moves off `consumed`, which is what makes `owed` fall to
    // 0 and raises the offer (`OutcomeSheet`'s trigger, not this gesture's).
    const backed = fold(
      stamp([tripOutcomeSet(TRIP, ENTRY, 'back')], { start: 300 }),
      reopened,
    )
    const restored = fold(
      stamp(restoreConsumption(tripFrom(backed, TRIP), 'g-gas', 0, backed), {
        start: 400,
      }),
      backed,
    )

    expect(ownedCountOf(gearFrom(restored, 'g-gas'))).toBe(1)
    expect(postedOf(tripFrom(restored, TRIP), 'g-gas')).toBe(0)
  })
})
