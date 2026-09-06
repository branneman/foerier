import { describe, expect, it } from 'vitest'

import { aGear, aPerson, aPlace, aTrip, depot } from '../testUtils/index.ts'
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
import { closeTrip, reHomeOnTheSpot } from './gestures.ts'
import type { EntryState, HouseholdState, TripState } from './state.ts'

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
    // This is F16's settling write (spec §4.6): a Gear whose last-known
    // location was `lost` on some Trip settles the standing when a LATER
    // `gear.rehomed` stamp lands, even one naming the identical Place —
    // `outcomeStands` (`selectors/unpack.ts`) compares stamps, not values.
    // If this write were "optimised" away because `residence` already
    // equals `residenceOf(gear)`, the `● NOW — FOUND HERE` row a later task
    // wires to this same gesture would tap and write nothing: a silent
    // no-op standing in for a settling fact. The Entry starts already
    // `back` so the outcome write is suppressed by the OTHER rule, isolating
    // this one: the sole op below must still be the rehome.
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
      aGear({ id: 'g-open', name: 'Open gear' }),
      [
        tripEntryAdded(TRIP, 'e-back', { from: 'depot', gearId: 'g-back' }),
        tripOutcomeSet(TRIP, 'e-back', 'back'),
        tripEntryAdded(TRIP, 'e-lost', { from: 'depot', gearId: 'g-lost' }),
        tripOutcomeSet(TRIP, 'e-lost', 'lost'),
        tripEntryAdded(TRIP, 'e-open', { from: 'depot', gearId: 'g-open' }),
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

  it('emits no trip.phase_moved on a Trip already closed — I1, the needless-write rule for this register too', () => {
    // A Device that reopened this Trip (`ReopenConfirm`, since S6) authored
    // a later write to the SAME `phase` register than this closed-Trip
    // stamp. If `closeTrip` re-emitted `trip.phase_moved{closed}`
    // unconditionally, a stale peer still holding F5's close card could
    // re-author it and silently win the register back, discarding the
    // reopen. The reduction must still fire — that is the die-mid-batch
    // recovery path — only the redundant phase move is skipped.
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

    expect(ops).toEqual([gearOwnedCountSet('g-gas', 4)])
  })

  it('emits only trip.phase_moved on an already-closed Trip with nothing to reduce', () => {
    const state = depot(aTrip({ id: TRIP, name: 'Ardennes', phase: 'closed' }))
    const trip = tripFrom(state, TRIP)

    const ops = closeTrip(trip, state)

    expect(ops).toEqual([])
  })
})
