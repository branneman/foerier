import {
  bringCountOf,
  entriesOf,
  entryKind,
  entryLabel,
  pieceCountOf,
  type DepotState,
  type EntryState,
  type TripState,
} from '@foerier/shared'

import { useDepot } from '../depot/store'
import { EntryRow } from './EntryRow'
import styles from './GearListSection.module.css'

/**
 * **The gear list's body** — the groups and rows both editable `/trips/:id`
 * (below Split) and read-only `/trips/:id` (Split and up) draw, spec §4.2
 * and `docs/design/README.md` §5's S7 round. `Trip.tsx` (Task 9) hosts it
 * between the over-claim band and the `GEAR LIST` section band; the builder
 * (Task 11) hosts it as the right pane. **Neither the dashed
 * `+ TRIP-ONLY ENTRY` row nor the pinned `+ Add from the depot` primary is
 * this component's** — both are drawn by whichever screen mounts it (plan
 * `progress.md` FINDING 2), because they sit *after* the list, not inside
 * any group, and the builder's own footer/add-pane differ from the trip
 * screen's.
 *
 * Reads `state` from the store directly, `OverClaimBand`'s own precedent —
 * `entriesOf`/`entryLabel`/`entryKind`/`bringCountOf`/`pieceCountOf` all take
 * the fold as their second argument, and threading it through as a second
 * prop beside `trip` would just be this component re-exporting what the
 * store already holds.
 *
 * **Groups, in order, each omitted when empty:** `SINGLE` · `COUNTED` ·
 * `PER-PERSON` · `TRIP-ONLY`, verbatim, each with its own `N PIECE(S)` —
 * pluralised, spec §3.1. `TRIP-ONLY` is keyed on the source (an Entry whose
 * `entryKind` reads `'trip_only'`), not on any Kind value, since a trip-only
 * Entry has none.
 *
 * **A Kind this replica cannot resolve groups under `SINGLE`.** `entryKind`
 * reads `undefined` for a depot Entry whose Gear has not yet reached this
 * replica's fold — the ordinary cross-aggregate sync race (spec §3.1), not
 * an error — and can in principle read an unrecognised Kind string, since
 * `KindValue` is deliberately open. Neither is `'trip_only'`: filing either
 * one there would be wrong regardless of which of the other three groups it
 * joined instead (spec's own instruction, and `listTotals.tripOnly` would
 * disagree with the row that landed there). `SINGLE` is the group `entry.ts`
 * itself already treats both cases like — `pieceCountOf`'s default branch
 * (one piece, "the conservative direction") is exactly `single`'s branch —
 * so an unresolved row draws as inert rather than guessing at a stepper or a
 * badge nothing backs up. This mapping is `rowKind`, below, and it is the
 * **only** place that decision is made: both the grouping and the `kind`
 * prop handed to `EntryRow` come from calling it once per Entry.
 */
export interface GearListSectionProps {
  readonly trip: TripState
  readonly editable: boolean
  /** Emits `trip.entry_bring_count_set` for the named Entry. */
  readonly onBringCountChange: (entryId: string, next: number) => void
  /** Emits `trip.entry_removed` for the named Entry. */
  readonly onRemove: (entryId: string) => void
}

type GroupKey = 'single' | 'counted' | 'per_person' | 'trip_only'

const GROUPS: readonly { key: GroupKey; label: string }[] = [
  { key: 'single', label: 'SINGLE' },
  { key: 'counted', label: 'COUNTED' },
  { key: 'per_person', label: 'PER-PERSON' },
  { key: 'trip_only', label: 'TRIP-ONLY' },
]

/**
 * The one function that decides what Kind a row behaves as — see this
 * file's docstring. `counted` / `per_person` / `trip_only` pass through
 * unchanged; everything else (`single`, `undefined`, and any Kind string
 * `entry.ts`'s callers do not otherwise branch on) maps to `single`.
 */
function rowKind(entry: EntryState, state: DepotState): GroupKey {
  switch (entryKind(entry, state)) {
    case 'counted':
      return 'counted'
    case 'per_person':
      return 'per_person'
    case 'trip_only':
      return 'trip_only'
    default:
      return 'single'
  }
}

/** `1 PIECE` / `2 PIECES` — spec §3.1: the count and its noun, formatted
 * together, never concatenated separately. */
function pieceLabel(count: number): string {
  return `${count} ${count === 1 ? 'PIECE' : 'PIECES'}`
}

export function GearListSection({
  trip,
  editable,
  onBringCountChange,
  onRemove,
}: GearListSectionProps) {
  const state = useDepot((depot) => depot.state)
  const entries = entriesOf(trip, state)

  const groups = GROUPS.map((group) => {
    const groupEntries = entries.filter(
      (entry) => rowKind(entry, state) === group.key,
    )
    const pieces = groupEntries.reduce(
      (sum, entry) => sum + pieceCountOf(entry, trip, state),
      0,
    )
    return { ...group, entries: groupEntries, pieces }
  }).filter((group) => group.entries.length > 0)

  if (groups.length === 0) return null

  return (
    <div className={styles['section']} data-testid="gear-list-section">
      {groups.map((group) => (
        <div key={group.key} className={styles['group']}>
          <div className={styles['groupHeader']}>
            <span
              className={styles['groupLabel']}
              data-testid="gear-list-group-label"
            >
              {group.label}
            </span>
            <span className={styles['groupCount']}>
              {pieceLabel(group.pieces)}
            </span>
          </div>
          <ul className={styles['rows']}>
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <EntryRow
                  label={entryLabel(entry, state)}
                  kind={rowKind(entry, state)}
                  bringCount={bringCountOf(entry, state)}
                  pieceCount={pieceCountOf(entry, trip, state)}
                  editable={editable}
                  onBringCountChange={(next) =>
                    onBringCountChange(entry.id, next)
                  }
                  onRemove={() => onRemove(entry.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
