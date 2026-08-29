import {
  authorOp,
  createHlcClock,
  emptyState,
  fold,
  personRecorded,
  tripCreated,
  tripParticipantAdded,
  tripParticipantRemoved,
  type DepotState,
  type OpAuthor,
  type OpSpec,
  type TripState,
} from '@foerier/shared'
import { describe, expect, it } from 'vitest'

import { tripParticipants } from './trips'

/**
 * Every fixture goes through the **real** reducer, never a hand-shaped
 * `DepotState` — the rule `shared/src/selectors/trip.test.ts` follows, for the
 * same reason: a selector must never pass against a state the fold could not
 * produce, and the unfolded-Person case below is precisely a state only the
 * fold can produce.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const TRIP = 'tttttttt-0000-7000-8000-000000000001'

let nextId = 0

const ids = {
  next: () =>
    `eeeeeeee-0000-7000-8000-${(nextId++).toString(16).padStart(12, '0')}`,
}

function anAuthor(): OpAuthor {
  return {
    household_id: HOUSEHOLD,
    device_id: DEVICE,
    ids,
    hlc: createHlcClock({ now: () => 1_700_000_000_000 }),
  }
}

function depot(...specs: readonly OpSpec[]): DepotState {
  const author = anAuthor()
  return fold(
    specs.map((spec) => authorOp(author, spec)),
    emptyState(),
  )
}

function theTrip(state: DepotState): TripState {
  return state.trips[TRIP]!
}

describe('tripParticipants', () => {
  it('lists the People on a Trip in sortedPeople order, not in id order', () => {
    // The ids ascend while the names do not, so id order and display order
    // disagree — which is the point: `participantIds` sorts by id because that
    // is replica-identical, and this sorts by label because the People screen
    // and the owner picker already do.
    const state = depot(
      personRecorded('p1', 'Mark'),
      personRecorded('p2', 'Els'),
      personRecorded('p3', 'Kees'),
      tripCreated(TRIP, 'Alps 2026'),
      tripParticipantAdded(TRIP, 'p1'),
      tripParticipantAdded(TRIP, 'p3'),
    )

    // Els is recorded and is not on the Trip: the household's People are not
    // the Trip's.
    expect(tripParticipants(state, theTrip(state))).toEqual([
      { id: 'p3', label: 'Kees' },
      { id: 'p1', label: 'Mark' },
    ])
  })

  it('drops a Participant who was removed', () => {
    const state = depot(
      personRecorded('p1', 'Mark'),
      personRecorded('p2', 'Els'),
      tripCreated(TRIP, 'Alps 2026'),
      tripParticipantAdded(TRIP, 'p1'),
      tripParticipantAdded(TRIP, 'p2'),
      tripParticipantRemoved(TRIP, 'p1'),
    )

    // A removal is a register holding `false`, not an absence — this inherits
    // `participantIds`' handling of it rather than re-deriving one.
    expect(tripParticipants(state, theTrip(state))).toEqual([
      { id: 'p2', label: 'Els' },
    ])
  })

  it('still lists a Participant whose Person has not folded yet', () => {
    const state = depot(
      personRecorded('p1', 'Mark'),
      tripCreated(TRIP, 'Alps 2026'),
      tripParticipantAdded(TRIP, 'p1'),
      tripParticipantAdded(TRIP, 'zz-queued-elsewhere'),
      tripParticipantAdded(TRIP, 'ya-queued-elsewhere'),
    )

    // Reachable in ordinary use: the `person.recorded` is still in another
    // device's outbox while the `trip.participant_added` naming it has already
    // arrived. A Participant must never silently vanish, so the unfolded ones
    // are appended after the folded ones, in id order — there is no label to
    // sort them by.
    expect(tripParticipants(state, theTrip(state))).toEqual([
      { id: 'p1', label: 'Mark' },
      { id: 'ya-queued-elsewhere', label: '—' },
      { id: 'zz-queued-elsewhere', label: '—' },
    ])
  })

  it('is empty for a Trip nobody is on', () => {
    const state = depot(
      personRecorded('p1', 'Mark'),
      tripCreated(TRIP, 'Alps 2026'),
    )
    expect(tripParticipants(state, theTrip(state))).toEqual([])
  })
})
