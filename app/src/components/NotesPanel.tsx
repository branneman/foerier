import { entryLabel, noteCounts, notesOf, type NoteView } from '@foerier/shared'
import { Link } from 'wouter'

import { formatDateTime } from '../format'
import { useHousehold } from '../household/store'
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

/**
 * One Note: the text whole and unclamped in ink, over a mono meta line
 * (I11).
 *
 * **No byline.** The envelope carries a `device_id` and a Device is not a
 * Person, so a name here would be the `API FIELD` rule broken — copy blocked
 * on a field that does not exist is omitted, never faked.
 *
 * **A discarded Note is struck and stays** (I16). It is still counted in
 * `N NOTES` and still on screen; what `false` costs it is S14's template
 * copy, not its place in the record.
 */
function NoteRow({ note, tripId }: { note: NoteView; tripId: string }) {
  const state = useHousehold((depot) => depot.state)
  const entry =
    note.entryId === undefined
      ? undefined
      : state.trips[tripId]?.entries?.[note.entryId]

  // I10: the reference reads on the Note alone, and a removed Entry keeps
  // reading — the pointer is an id, and the Entry's tombstone says nothing
  // about a sentence somebody wrote. An Entry this replica has not folded at
  // all takes the same path, since `entryLabel` needs one to name.
  const about =
    note.entryId === undefined
      ? undefined
      : entry === undefined
        ? undefined
        : entryLabel(entry, state).toUpperCase()

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
      <p className={styles['meta']}>
        {[
          note.postedAtMs === undefined
            ? undefined
            : formatDateTime(new Date(note.postedAtMs)),
          about === undefined ? undefined : `ABOUT: ${about}`,
          note.kept === true ? 'KEPT' : undefined,
          note.kept === false ? 'DISCARDED' : undefined,
        ]
          .filter((segment) => segment !== undefined)
          .join(' · ')}
      </p>
    </li>
  )
}
