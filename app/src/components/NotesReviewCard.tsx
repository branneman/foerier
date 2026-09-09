import { noteCounts, notesOf, tripNoteKept } from '@foerier/shared'
import { Link } from 'wouter'

import { useHousehold } from '../household/store'
import { NoteRow } from './NoteRow'
import styles from './NotesReviewCard.module.css'
import { PRINT_HIDDEN } from '../print'

/**
 * **F5's notes review card** — design `README.md` §5l I14, I15, I17, I20, and
 * `docs/specs/2026-09-08-trip-notes.md` §6. Story 12's own acceptance
 * criterion: *at the Unpack pass I review the Trip's Notes and either keep
 * them as reference or discard them.*
 *
 * A surface card **after the groups and directly above the close card**, so
 * the close card stays the list's last card (F11). It renders wherever F5 has
 * a list — gated, at `open = 0`, and on a closed Trip — and is withheld only
 * where F19 withholds everything, with the `0 ENTRIES.` empty state (I20).
 * Neither the `DESTINATION | PERSON | ALL` control nor the `○ OPEN` pill
 * touches it: those narrow the *outcome* pass, and a Note is not an outcome.
 *
 * **Notes do not join the close gate** (I15). Invariant 18 is exact — *"every
 * entry and every per-person piece"* — and its purpose is the Depot: the
 * close writes a consumed reduction and an outcome settles a claim, while a
 * Note writes nothing anywhere. So the summary line, the button's gating and
 * both hints are untouched, and a Quartermaster who closes past two
 * unreviewed Notes loses nothing a discard would have removed. What satisfies
 * the story is that the card is on the path to Close and states its own
 * count.
 *
 * **It stays live on a closed Trip** (I17), which is the one thing here most
 * likely to be broken later by analogy. F5's `record` prop is invariant 19's
 * and stops at outcomes; `patterns.md` §3.8's test is whether an invariant
 * closes the write, and none does — 19 and G6 freeze outcomes, 14 keeps notes
 * as history in as many words, 16 locks no editing capability at all, and
 * story 12 says *mid-trip or after*. So this component takes no `record` prop
 * to be wrong about.
 */
export function NotesReviewCard({ tripId }: { tripId: string }) {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)
  const trip = state.trips[tripId]
  const notes = notesOf(trip)
  const { total, toReview } = noteCounts(trip)

  return (
    <section
      className={styles['card']}
      data-testid="unpack-notes-card"
      role="group"
      aria-labelledby="unpack-notes-label"
    >
      <div className={styles['band']}>
        <span id="unpack-notes-label" className={styles['label']}>
          NOTES
        </span>
        <span className={styles['trailing']}>
          <span className={styles['count']} data-testid="unpack-notes-count">
            {total} {total === 1 ? 'NOTE' : 'NOTES'}
            {/* I14, and G3's rule: the second segment is absent at zero, and
                in ink while it stands — `6 OPEN`'s own treatment two cards
                up, because it names the work left rather than the work
                done. */}
            {toReview > 0 && (
              <>
                {' · '}
                <span className={styles['toReview']}>{toReview} TO REVIEW</span>
              </>
            )}
          </span>
          <Link
            href={`/trips/${tripId}/note`}
            className={styles['compose']}
            {...PRINT_HIDDEN}
            aria-label={`Post a note for ${trip?.name?.value ?? 'this trip'}`}
          >
            + NOTE
          </Link>
        </span>
      </div>

      {notes.length === 0 ? (
        <p className={styles['empty']}>0 NOTES.</p>
      ) : (
        <ul className={styles['notes']}>
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              tripId={tripId}
              review={{
                // One op in both directions, so a discard is reversed by an
                // ordinary later `KEEP` (I14) — there is no restore op and
                // no special case, and the row draws whichever route the
                // Note does not already hold.
                onKeep: (noteId) => emit(tripNoteKept(tripId, noteId, true)),
                onDiscard: (noteId) =>
                  emit(tripNoteKept(tripId, noteId, false)),
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
