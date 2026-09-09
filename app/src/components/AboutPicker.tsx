import { entriesOf, entryLabel } from '@foerier/shared'
import { Sheet } from '@foerier/ui'

import { useHousehold } from '../household/store'
import styles from './AboutPicker.module.css'

/**
 * **The `ABOUT` picker** — design `README.md` §5l I10,
 * `docs/specs/2026-09-08-trip-notes.md` §5. What one Note is *about*: one
 * Entry on this Trip, or the Trip itself.
 *
 * The Home picker's anatomy, borrowed whole: the "no particular one" row
 * **first** with its own meta line, the real rows after it, `● NOW` on the
 * current value, and a fact line closing the sheet. `Loose` teaches the
 * glossary word there; `The trip` states the default here.
 *
 * **A picker, not a decision** (`patterns.md` §4.2, §4.3). The scrim
 * dismisses, a selection closes, and this component **emits nothing** — the
 * composer holds the choice and the single `trip.note_posted` carries it.
 * That matters more here than it usually does: `entry_id` is written once, at
 * post, and no op in the catalogue addresses it again (I10), so a picker that
 * authored on tap would be authoring the only write a Note's reference will
 * ever get, from a screen the Quartermaster has not finished.
 *
 * The Entries are `entriesOf`'s own list — A→Z, tombstones and sourceless
 * Entries already excluded — so this sheet cannot offer a line the gear list
 * itself would not draw.
 */
export function AboutPicker({
  tripId,
  value,
  onSelect,
  onClose,
}: {
  tripId: string
  /** The Entry currently chosen, or `undefined` for the Trip. */
  value: string | undefined
  onSelect: (entryId: string | undefined) => void
  onClose: () => void
}) {
  const state = useHousehold((depot) => depot.state)
  const trip = state.trips[tripId]
  const entries = trip === undefined ? [] : entriesOf(trip, state)

  const nowMark = <span className={styles['now']}>● NOW</span>

  return (
    <Sheet title="About" onClose={onClose}>
      <ul className={styles['rows']}>
        <li>
          <button
            type="button"
            className={styles['row']}
            onClick={() => {
              onSelect(undefined)
              onClose()
            }}
          >
            <span className={styles['rowText']}>
              <span className={styles['rowName']}>The trip</span>
              {/* The default said in words, as `Loose`'s `NO RESIDENCE — THE
                  DEFAULT` is: a Note about the Trip is the ordinary case, not
                  a failure to choose. */}
              <span className={styles['rowMeta']}>NOT ABOUT ONE ENTRY</span>
            </span>
            {value === undefined && nowMark}
          </button>
        </li>

        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={styles['row']}
              onClick={() => {
                onSelect(entry.id)
                onClose()
              }}
            >
              <span className={styles['rowText']}>
                <span className={styles['rowName']}>
                  {entryLabel(entry, state)}
                </span>
              </span>
              {value === entry.id && nowMark}
            </button>
          </li>
        ))}
      </ul>

      <p className={styles['fact']}>ONE ENTRY ON THIS TRIP, OR THE TRIP</p>
    </Sheet>
  )
}
