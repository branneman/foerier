import { parseHlc, type Stamp } from '../hlc.ts'
import { stampOf } from '../registers.ts'
import type { NoteState, TripState } from '../state.ts'
import { byStampThenId } from './order.ts'

/**
 * **The Trip notes' read side** (S12; `docs/design/README.md` §5l I9–I20,
 * spec §3) — beside `entry.ts` and `trip.ts`, and the same shape of problem
 * solved the same way: a handful of facts three surfaces (the trip screen's
 * panel, F5's review card, S14's template copy) must agree on, stated once
 * here rather than at each of them.
 *
 * Two things in this module are not what a reader of the other selectors
 * would expect, and both are deliberate.
 *
 * **`kept` is the codebase's one third-state read.** Everywhere else an
 * absent register has a default and exactly one function says so — `phase`
 * reads `draft` (`trip.ts`), `owner` reads `SHARED` (`owner.ts`), `status`
 * reads `not_packed` and `stage` reads `home` (`packing.ts`), `posted` reads
 * `0` (`unpack.ts`). Here absence is a **state a surface draws**: a Note
 * nobody has reviewed is neither kept nor discarded, and ruling I13 gives it
 * its own rendering. So {@link noteKeptOf} answers `boolean | undefined` —
 * `kindOf`'s shape, not `ownerOf`'s — and no call site is allowed to collapse
 * the third answer into either of the other two.
 *
 * **A Note with no `text` is folded, retained and drawn nowhere.** It is
 * reachable: `trip.note_kept` and `trip.note_posted` address different
 * registers on one entity path, so a peer's review can land before the post
 * it reviews, and `writeNote` creates the Note either way. This is S7's
 * sourceless Entry one map over, and `entriesOf`'s rule restated — an entity
 * nobody can draw a default for is excluded from the list *and* from every
 * count, so a band can never read `4 NOTES` over three rows.
 */

/** One Note, as every surface reads it. */
export interface NoteView {
  readonly id: string
  readonly text: string
  /** The Entry this Note is *about*, or `undefined` for a Note about the Trip. */
  readonly entryId: string | undefined
  /**
   * Epoch milliseconds from the **posting** op's own HLC (I11) — the moment
   * it was written down, which a later keep or discard must not move.
   * `undefined` when the HLC will not parse, so the meta line drops its
   * timestamp segment rather than drawing `Invalid Date`.
   */
  readonly postedAtMs: number | undefined
  /** `true` kept, `false` discarded, `undefined` unreviewed — {@link noteKeptOf}. */
  readonly kept: boolean | undefined
}

/**
 * Kept, discarded, or unreviewed — the module header's third-state rule, and
 * the only place it is stated.
 *
 * S14 reads it too, and reads it as a pair rather than a triple: **a Note not
 * discarded is copied** by the template, so `kept` and `undefined` travel and
 * `false` does not (I13, I16).
 */
export function noteKeptOf(note: NoteState): boolean | undefined {
  return note.kept?.value
}

/**
 * Every folded Note with text, **oldest first** (I11).
 *
 * Oldest first because a Trip's notes are a running log rather than a feed:
 * the reading order is the order they were written, and the panel is short
 * enough that newest-first would only make the sequence harder to follow.
 *
 * The order is the posting register's own stamp, not `Object.keys`, which
 * returns the order *this replica* happened to receive ops in — two Devices
 * holding identical state would draw the list differently, which is the
 * failure `order.ts`'s header describes for the depot and the Trips list.
 * The comparator is that file's {@link byStampThenId}, shared with `tasksOf`:
 * it was spelled in both files because S12 and S13 were built in parallel
 * worktrees and `order.ts` is a file only one of them could own.
 */
export function notesOf(trip: TripState | undefined): readonly NoteView[] {
  const notes = trip?.notes
  if (notes === undefined) return []

  // Sorted **before** the views are built, not after: the stamp the order
  // reads is the posting register's own, and carrying it on the row is what
  // lets this share `tasksOf`'s comparator instead of looking each Note up
  // again by id from inside the sort.
  const rows: {
    id: string
    stamp: Stamp
    text: { value: string; hlc: string }
    note: NoteState
  }[] = []
  for (const note of Object.values(notes)) {
    const text = note.text
    if (text === undefined) continue
    rows.push({ id: note.id, stamp: stampOf(text), text, note })
  }
  rows.sort(byStampThenId)

  return rows.map(({ id, text, note }) => ({
    id,
    text: text.value,
    entryId: note.entryId?.value,
    postedAtMs: parseHlc(text.hlc)?.ms,
    kept: noteKeptOf(note),
  }))
}

/**
 * What the two bands count: `4 NOTES` on the trip screen (I3) and
 * `3 NOTES · 2 TO REVIEW` on F5 (I14).
 *
 * `total` counts **every** Note the list draws, discarded ones included —
 * ruling I16, a discarded Note never vanishes. `toReview` counts only those
 * with no `kept` register at all, which is what F5's second segment names and
 * what drops to nothing once the pass is done.
 *
 * It walks the same notes {@link notesOf} does, through the same exclusion,
 * so the count and the list cannot come apart. That is deliberately not
 * `notesOf(trip).length` with a filter: the two would still agree, but the
 * band would then pay for a sort it never reads.
 */
export function noteCounts(trip: TripState | undefined): {
  total: number
  toReview: number
} {
  let total = 0
  let toReview = 0
  for (const note of Object.values(trip?.notes ?? {})) {
    if (note.text === undefined) continue
    total += 1
    if (noteKeptOf(note) === undefined) toReview += 1
  }
  return { total, toReview }
}
