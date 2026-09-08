import {
  listTotals,
  noteCounts,
  taskCounts,
  tripNameOrUnnamed,
  unpackTotals,
  type HouseholdState,
  type TripState,
} from '@foerier/shared'
import { Confirm } from '@foerier/ui'

import styles from './DeleteTripConfirm.module.css'

/**
 * **Deleting a Trip is a decision**, so it goes through `Confirm` rather than
 * `Sheet`: the scrim does not dismiss it. Rulings J2 and J3.
 *
 * ## Four conditional lines, in the trip screen's own order
 *
 * `7 TASKS` · `4 NOTES` · `35 ENTRIES · 59 PIECES` · `56 OUTCOMES · 1 LOST`.
 * The first three are the order that screen stacks them in — TASKS, NOTES,
 * GEAR LIST — so a reader who just scrolled past them meets them again the
 * way round they were. Outcomes go **last** because they are the one
 * register the trip screen does not carry: they belong to F5, and a reader
 * arriving from `/trips/:id` has not seen them on this visit.
 *
 * Every segment is **absent at zero** (ruling G3), which means an empty
 * Draft gets **no block at all** and a shorter sheet. Two fillers were drawn
 * and refused: `0 ENTRIES · 0 TASKS · 0 NOTES` writes three zero segments
 * four rounds after G3 ruled a zero segment absent, and `NOTHING RECORDED
 * YET` occupies the slot those three vacated while saying less than the
 * title already does. A delete confirm does not need a block; it needs a
 * true answer, and that sentence is the same at every size of Trip.
 *
 * `N NOTES` counts **discarded** notes too — ruling I16, a discarded Note
 * never vanishes — which is why it reads `noteCounts(...).total` rather than
 * filtering.
 *
 * ## The answer is in ink and the depot line is muted
 *
 * `Confirm`'s two prose slots, which is exactly the split ruling H9 added
 * them for: `description` is the answer — the one sentence saying what will
 * happen — and `note` is the explainer beneath it. Before H9 both rendered
 * muted and a confirm's answer sat demoted under the question it answers.
 *
 * **`Permanent. No route puts a trip back.`** is the literal truth of the
 * catalogue: `trip.deleted` has no partner, no `trip.restored` exists, and
 * this sentence must not hint that one might. **`The depot is untouched. An
 * entry lists gear; it never holds it.`** is the fact a Quartermaster
 * actually needs before pressing: invariant 8 — an Entry *references* gear
 * and copies nothing — said in words rather than by number.
 *
 * ## No `▲`, and no filled red button
 *
 * The glyph is the attention class generally, but the rule §12 states for a
 * *confirm* is narrower: only an action that can discard **unsynced** work
 * carries one, and sign-out-this-device is the single place in the app that
 * qualifies. A tombstone is an ordinary op that syncs like any other. The
 * primary is bordered-attention, never filled — the `SIGN OUT` / `REMOVE`
 * treatment — where `ReopenConfirm`'s accent primary is for a confirm that
 * throws nothing away.
 */
export function DeleteTripConfirm({
  trip,
  state,
  onCancel,
  onConfirm,
}: {
  trip: TripState
  state: HouseholdState
  onCancel: () => void
  onConfirm: () => void
}) {
  const tasks = taskCounts(trip)
  const notes = noteCounts(trip)
  const list = listTotals(trip, state)
  const unpack = unpackTotals(trip, state)

  // Each line is built and then dropped if it has nothing to say, rather
  // than each *segment* being conditional inside a template: a segment that
  // can vanish from the middle of a line is how `· ·` gets shipped.
  const facts: string[] = []
  if (tasks.total > 0) facts.push(`${tasks.total} TASKS`)
  if (notes.total > 0) facts.push(`${notes.total} NOTES`)
  if (list.entries > 0) {
    facts.push(
      list.pieces > 0
        ? `${list.entries} ENTRIES · ${list.pieces} PIECES`
        : `${list.entries} ENTRIES`,
    )
  }
  const resolved = unpack.resolved
  if (resolved > 0) {
    facts.push(
      unpack.lost > 0
        ? `${resolved} OUTCOMES · ${unpack.lost} LOST`
        : `${resolved} OUTCOMES`,
    )
  }

  return (
    <Confirm
      variant="sheet"
      // The prose sentinel: a title is a sentence, so a nameless Trip reads
      // `Delete Unnamed trip?` and never `Delete —?` (§5c).
      title={`Delete ${tripNameOrUnnamed(trip)}?`}
      description="Permanent. No route puts a trip back."
      note="The depot is untouched. An entry lists gear; it never holds it."
      onClose={onCancel}
      actions={
        <>
          <Confirm.Action>
            <button
              type="button"
              className={styles['primary']}
              onClick={onConfirm}
            >
              Delete trip
            </button>
          </Confirm.Action>
          <Confirm.Cancel>
            <button type="button" className={styles['cancel']}>
              Cancel
            </button>
          </Confirm.Cancel>
        </>
      }
    >
      {facts.length > 0 && (
        <div className={styles['facts']}>
          {facts.map((line) => (
            <span
              key={line}
              className={styles['fact']}
              data-testid="delete-fact"
            >
              {line}
            </span>
          ))}
        </div>
      )}
    </Confirm>
  )
}
