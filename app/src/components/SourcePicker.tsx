import {
  listTotals,
  noteCounts,
  sourceTrips,
  taskCounts,
  tripNameOrUnnamed,
  type HouseholdState,
  type TripState,
} from '@foerier/shared'
import { Sheet } from '@foerier/ui'

import { useHousehold } from '../household/store'
import { tripStartMonth } from '../household/trips'
import styles from './SourcePicker.module.css'

/**
 * **Which past Trip this one starts from** — ruling J9, and the Home picker's
 * *pick mode* transplanted: bare rows, single select, the selection closes
 * the sheet, and **the scrim dismisses**, because this is a selection and not
 * a decision.
 *
 * ## A `Sheet` at every width, and that is a recorded shortfall
 *
 * From Split up the app's standing pattern is a popover — and the popover
 * primitive is **unbuilt, with six waiting callers and no board drawing one**
 * (`technical-debt.md`). S14 does not draw the seventh: the sheet is the
 * picker at 900 and 1024 too, unchanged but for the shell's gutter, and it
 * converts with the other six when a round finally draws one. Building it
 * here would mean taking six visual decisions against nothing.
 *
 * ## The first row is the clear
 *
 * `Nothing — start empty` / `A BLANK GEAR LIST` / `● NOW` when it is the
 * standing choice. The Home picker's `The trip`-first precedent: a pseudo-
 * value belongs at the top of a single-select list, and it doubles as the way
 * back out of a choice — which is why the field row carries no `✕`.
 *
 * ## The meta names only what carries over, and never PIECES
 *
 * `JUL 2025 · 35 ENTRIES · 7 TASKS · 4 NOTES`, each segment absent at zero
 * (G3), `NO DATES` in the month slot. **No Piece count, ever**: Participants
 * do not copy, so every per-person Entry lands on the new Trip with no Pieces
 * at all — a Piece count here would name a number the copy cannot have. That
 * is the same fact J10's second field line discloses in words, and this line
 * refuses to contradict it in figures.
 *
 * ## Every visible Trip, closed and active and Draft alike
 *
 * Ruling J8, on S7's `TRIP`-dimension precedent and because copying only
 * *reads* the source. There is no world chip and no phase chip on a row: the
 * phase does not bear on whether a list is worth copying.
 */
export function SourcePicker({
  selected,
  onSelect,
  onClose,
}: {
  /** The chosen source, or `null` for a blank list. */
  selected: string | null
  /** `null` is the first row — the clear. The caller closes the sheet. */
  onSelect: (tripId: string | null) => void
  onClose: () => void
}) {
  const state = useHousehold((depot) => depot.state)
  const trips = sourceTrips(state)

  return (
    <Sheet title="Start from" onClose={onClose} desktopCard>
      <ul className={styles['rows']}>
        <li>
          <button
            type="button"
            className={styles['row']}
            data-testid="source-row"
            aria-pressed={selected === null}
            onClick={() => onSelect(null)}
          >
            <span className={styles['body']}>
              <span className={styles['name']} data-testid="source-name">
                Nothing — start empty
              </span>
              <span className={styles['meta']}>A BLANK GEAR LIST</span>
            </span>
            {selected === null && <span className={styles['now']}>● NOW</span>}
          </button>
        </li>

        {trips.map((trip) => (
          <li key={trip.id}>
            <button
              type="button"
              className={styles['row']}
              data-testid="source-row"
              aria-pressed={selected === trip.id}
              onClick={() => onSelect(trip.id)}
            >
              <span className={styles['body']}>
                {/* The prose sentinel: a row's name is a name slot, and this
                    sheet's own title is a sentence about it. */}
                <span className={styles['name']} data-testid="source-name">
                  {tripNameOrUnnamed(trip)}
                </span>
                <span className={styles['meta']} data-testid="source-meta">
                  {sourceMeta(trip, state)}
                </span>
              </span>
              {selected === trip.id && (
                <span className={styles['now']}>● NOW</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

/**
 * `JUL 2025 · 35 ENTRIES · 7 TASKS · 4 NOTES` — what would come across, and
 * nothing else.
 *
 * The month slot is `NO DATES` rather than absent, because a row with no
 * leading segment would start mid-line and the dateless case is common
 * (dates are optional on every Trip). Every *other* segment is absent at
 * zero, G3's rule, so a Trip with no notes simply does not mention notes.
 */
function sourceMeta(trip: TripState, state: HouseholdState): string {
  const list = listTotals(trip, state)
  const tasks = taskCounts(trip)
  const notes = noteCounts(trip)

  const segments = [tripStartMonth(trip) ?? 'NO DATES']
  if (list.entries > 0) segments.push(`${list.entries} ENTRIES`)
  if (tasks.total > 0) segments.push(`${tasks.total} TASKS`)
  if (notes.total > 0) segments.push(`${notes.total} NOTES`)
  return segments.join(' · ')
}
