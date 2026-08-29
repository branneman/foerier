import {
  participantIds,
  personLabel,
  type DepotState,
  type TripState,
} from '@foerier/shared'

import { sortedPeople, type PersonRow } from './people'

/**
 * **The Trip's People, in the order a screen draws them** — `people.ts`'s
 * companion, and the only place the Trip's membership meets the household's
 * roster.
 *
 * It lives in `app/` rather than beside `participantIds` in `shared/` because
 * the order it produces is a *display* order, and display order is decided by
 * `sortedPeople` — an `app/` module. `shared/` keeps the replica-identical
 * one.
 */

/**
 * The People on `trip`, as `PersonRow`s the trip card and the participant
 * picker can draw directly.
 *
 * ## The order comes from `sortedPeople`, not from `participantIds`
 *
 * `participantIds` sorts by **id**, which is total, replica-identical and
 * meaningless to read — it is the order the fold has to agree on, not the one
 * a person scans. The display order is by label, and it is taken from
 * `sortedPeople(state)` rather than re-sorted here, because the People screen
 * and the owner picker already share that list: if the trip's circles sorted
 * one way and the picker's rows another, "the third one down" would mean two
 * different People (spec §3.3).
 *
 * ## A Participant whose Person has not folded is still listed
 *
 * `participantIds` names person ids; `sortedPeople` lists only People whose
 * `person.recorded` has folded. The two disagree whenever a
 * `trip.participant_added` overtakes the `person.recorded` it names — a
 * `trip.*` op authored on a phone that already knew the Person, pulled by a
 * device that does not yet. Filtering `sortedPeople` alone would make that
 * Participant **vanish**, and vanishing is the one behaviour a membership list
 * must never have: the count would drop, a removal would look like it had
 * already happened, and nothing on screen would say why.
 *
 * So the unfolded ones are appended after the folded ones, in
 * `participantIds`' own id order — there is no label to sort them among the
 * rest by — and labelled `—`, which costs no new code because `personLabel`
 * already reads an unknown id that way and draws every other unnamed Person
 * identically. The row is honest and the next pull fills the name in.
 */
export function tripParticipants(
  state: DepotState,
  trip: TripState,
): readonly PersonRow[] {
  const ids = participantIds(trip)
  if (ids.length === 0) return []

  const onTrip = new Set(ids)
  const folded = sortedPeople(state).filter((person) => onTrip.has(person.id))

  const drawn = new Set(folded.map((person) => person.id))
  const unfolded = ids
    .filter((id) => !drawn.has(id))
    .map((id) => ({ id, label: personLabel(state, id) }))

  return [...folded, ...unfolded]
}
