import { noteCounts, notesOf } from '@foerier/shared'
import { Link } from 'wouter'

import { useHousehold } from '../household/store'
import { NoteRow } from './NoteRow'
import styles from './NotesPanel.module.css'

/**
 * **The `NOTES` panel** — design `README.md` §5l I3, I6, I11, I16, I18, and
 * `docs/specs/2026-09-08-trip-notes.md` §4. The second of the Trip screen's
 * two panels, inside `TripPanels`; `TASKS` (S13) sits above it.
 *
 * **The band is drawn in every state, empty included** (I6). The gear list's
 * band may go empty because it carries doors; this one carries a label and a
 * composer link, so there is always something for it to say. The count is
 * absent at zero rather than reading `0 NOTES` (I3) — the empty state's own
 * line says that better, and a zero segment is absent everywhere else in this
 * app (ruling G3).
 *
 * **`+ NOTE` is live at every width** (I4). The Split read/edit split exists
 * because the builder needs a second pane; this panel has none, and the
 * laptop-after-the-trip note is story 12's own case. It carries no `›`: that
 * glyph marks a sheet, and this is a screen.
 *
 * Its read is load-bearing (`patterns.md` §5.2), so it is not props-in — and
 * the Entry a Note is *about* is named from the store the way `OverClaimBand`
 * names Gear and Trips, rather than threaded through as a second data shape.
 */
export function NotesPanel({ tripId }: { tripId: string }) {
  const state = useHousehold((depot) => depot.state)
  const trip = state.trips[tripId]
  const notes = notesOf(trip)
  const { total } = noteCounts(trip)

  return (
    <section
      className={styles['panel']}
      data-testid="notes-panel"
      role="group"
      aria-labelledby="notes-label"
    >
      <div className={styles['band']}>
        <span id="notes-label" className={styles['label']}>
          NOTES
        </span>
        <span className={styles['trailing']}>
          {/* I3: absent at zero, not `0 NOTES` — the empty state below says
              it in a sentence, and one fact stated twice in two registers is
              how the two drift. */}
          {total > 0 && (
            <span className={styles['count']} data-testid="notes-count">
              {total} {total === 1 ? 'NOTE' : 'NOTES'}
            </span>
          )}
          <Link
            href={`/trips/${tripId}/note`}
            className={styles['compose']}
            aria-label={`Post a note for ${trip?.name?.value ?? 'this trip'}`}
          >
            + NOTE
          </Link>
        </span>
      </div>

      {notes.length === 0 ? (
        // I18, and the `0 ENTRIES.` pattern: the second line is a permanent
        // domain fact — where a Note goes next — never a promise about a
        // feature, and never a dead affordance.
        <>
          <p className={styles['empty']}>0 NOTES.</p>
          <p className={styles['source']}>
            Notes are reviewed at the unpack pass.
          </p>
        </>
      ) : (
        <ul className={styles['notes']}>
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} tripId={tripId} />
          ))}
        </ul>
      )}
    </section>
  )
}
