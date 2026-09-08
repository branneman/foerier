import { entryLabel, type NoteView } from '@foerier/shared'

import { formatDateTime } from '../format'
import { useHousehold } from '../household/store'
import styles from './NoteRow.module.css'

/**
 * The two writes F5's review card offers, **grouped rather than two optional
 * callbacks** — `OverClaimBand`'s `SettleRoutes` precedent, and for its
 * reason: the type system then enforces all-or-nothing, and **the absence of
 * this prop *is* the read-only rendering**, not a degraded one.
 *
 * A row never offers both at once. Ruling I14: a reviewed row shows the other
 * route only, so `KEEP` on a kept Note is unreachable rather than merely
 * discouraged — `patterns.md` §2.3's needless write, made impossible instead
 * of documented.
 */
export interface NoteReviewRoutes {
  onKeep: (noteId: string) => void
  onDiscard: (noteId: string) => void
}

/**
 * **One Note, wherever a Note is drawn** — the trip screen's panel (S12 spec
 * §4) and F5's review card (§6). One component because the anatomy is one
 * anatomy: ruling I11 states it once, and two copies would be two places for
 * `· KEPT` to be spelled differently.
 *
 * **No byline.** The envelope carries a `device_id` and a Device is not a
 * Person, so a name here would be the `API FIELD` rule broken — copy blocked
 * on a field that does not exist is omitted, never faked.
 *
 * **A discarded Note is struck and stays** (I16). Still counted, still on
 * screen, on a closed Trip included; what `false` costs it is S14's template
 * copy, not its place in the record. The strike is on the text alone —
 * striking a meta line that reads `· DISCARDED` would strike the word
 * explaining the strike.
 */
export function NoteRow({
  note,
  tripId,
  review,
}: {
  note: NoteView
  tripId: string
  review?: NoteReviewRoutes
}) {
  const state = useHousehold((depot) => depot.state)

  // I10: the reference reads on the Note alone, and a removed Entry keeps
  // reading — the pointer is an id, and the Entry's tombstone says nothing
  // about a sentence somebody wrote. An Entry this replica has not folded at
  // all takes the same path, since `entryLabel` needs one to name.
  const entry =
    note.entryId === undefined
      ? undefined
      : state.trips[tripId]?.entries?.[note.entryId]
  const about =
    entry === undefined ? undefined : entryLabel(entry, state).toUpperCase()

  const meta = [
    note.postedAtMs === undefined
      ? undefined
      : formatDateTime(new Date(note.postedAtMs)),
    about === undefined ? undefined : `ABOUT: ${about}`,
    note.kept === true ? 'KEPT' : undefined,
    note.kept === false ? 'DISCARDED' : undefined,
  ]
    .filter((segment) => segment !== undefined)
    .join(' · ')

  return (
    <li
      className={
        // `patterns.md` §6.7: a modifier class for a boolean, `data-*` only
        // for an enumeration. `kept` is a triple in the selector but two
        // renderings here — struck, or not — so the class is the honest
        // encoding.
        note.kept === false
          ? `${styles['note']} ${styles['discarded']}`
          : styles['note']
      }
    >
      <p className={styles['text']}>{note.text}</p>
      <p className={styles['meta']}>{meta}</p>
      {review !== undefined && (
        <p className={styles['routes']}>
          {/* I14: the route that would rewrite the value this Note already
              holds is not drawn. An unreviewed Note has neither value yet, so
              it gets both. */}
          {note.kept !== true && (
            <button
              type="button"
              className={styles['route']}
              onClick={() => review.onKeep(note.id)}
            >
              KEEP
            </button>
          )}
          {note.kept !== false && (
            <button
              type="button"
              className={styles['route']}
              onClick={() => review.onDiscard(note.id)}
            >
              DISCARD
            </button>
          )}
        </p>
      )}
    </li>
  )
}
