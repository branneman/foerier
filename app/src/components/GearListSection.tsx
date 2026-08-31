import {
  bringCountOf,
  entriesOf,
  entryKind,
  entryLabel,
  pieceCountOf,
  UNGROUPED_LABEL,
  type DepotState,
  type EntryState,
  type TripState,
} from '@foerier/shared'
import { useState } from 'react'

import { useDepot } from '../depot/store'
import { tripPieces } from '../depot/trips'
import { EntryRow } from './EntryRow'
import styles from './GearListSection.module.css'
import { PiecePicker } from './PiecePicker'

/**
 * **The gear list's body** — the groups and rows both editable `/trips/:id`
 * (below Split) and read-only `/trips/:id` (Split and up) draw, spec §4.2
 * and `docs/design/README.md` §5's S7 round. `Trip.tsx` (Task 9) hosts it
 * directly beneath the `GEAR LIST` section band, which itself sits beneath
 * the over-claim band; the builder (Task 11) hosts it as the right pane.
 * **Neither the dashed
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
 * **A Kind this replica cannot resolve gets a fifth group, `UNGROUPED_LABEL`
 * (`—`), sorted last — never `SINGLE`.** `entryKind` reads `undefined` for a
 * depot Entry whose Gear has not yet reached this replica's fold — the
 * ordinary cross-aggregate sync race (spec §3.1), not an error — and can in
 * principle read an unrecognised Kind string, since `KindValue` is
 * deliberately open. Review round F2 corrected an earlier draft that mapped
 * both into `SINGLE`: `pieceCountOf`'s conservative default answers *how
 * many pieces*, which has a conservative answer, and does not transfer to
 * *what Kind*, which does not — filing an unresolved row as `SINGLE` would
 * re-state, one layer out, exactly the assertion `entryKind`'s own contract
 * declines to make. `slice.ts`'s `groupGear` is the house pattern for "a
 * grouping's tail case": it keeps an absent register's bucket
 * (`UNGROUPED_LABEL`, sorted last) separate from an unrecognised value's own
 * per-value bucket. This merges those two tail cases into **one** `—` group
 * rather than reproducing the full three-way split — no board draws a
 * per-value header, and an unrecognised Kind reaching this replica is itself
 * reachable only from a peer on a different build — and says so here rather
 * than silently: `—` on its own means "no value here", and an unrecognised
 * Kind does carry a value, so this is a smaller, named lie, not an unnoticed
 * one. `rowKind`, below, is the **only** place this decision is made: both
 * the grouping and the `kind` prop handed to `EntryRow` come from calling it
 * once per Entry.
 */
export interface GearListSectionProps {
  readonly trip: TripState
  readonly editable: boolean
  /** Emits `trip.entry_bring_count_set` for the named Entry. */
  readonly onBringCountChange: (entryId: string, next: number) => void
  /** Emits `trip.entry_removed` for the named Entry. */
  readonly onRemove: (entryId: string) => void
}

type GroupKey = 'single' | 'counted' | 'per_person' | 'trip_only' | 'ungrouped'

/** Verbatim order, `UNGROUPED_LABEL` appended last — see this file's
 * docstring on why it is a fifth group rather than folded into `SINGLE`. */
const GROUPS: readonly { key: GroupKey; label: string }[] = [
  { key: 'single', label: 'SINGLE' },
  { key: 'counted', label: 'COUNTED' },
  { key: 'per_person', label: 'PER-PERSON' },
  { key: 'trip_only', label: 'TRIP-ONLY' },
  { key: 'ungrouped', label: UNGROUPED_LABEL },
]

/**
 * The one function that decides what Kind a row behaves as — see this
 * file's docstring. `single` / `counted` / `per_person` / `trip_only` pass
 * through unchanged; everything else — `entryKind` reading `undefined`, or
 * any Kind string none of the four cases name — maps to `'ungrouped'`.
 */
function rowKind(entry: EntryState, state: DepotState): GroupKey {
  switch (entryKind(entry, state)) {
    case 'single':
      return 'single'
    case 'counted':
      return 'counted'
    case 'per_person':
      return 'per_person'
    case 'trip_only':
      return 'trip_only'
    default:
      return 'ungrouped'
  }
}

/** `1 PIECE` / `2 PIECES` — spec §3.1: the count and its noun, formatted
 * together, never concatenated separately. Exported: `Trip.tsx`'s `GEAR
 * LIST` band renders its own `N PIECES` right beside this component's group
 * headers (spec §4.2: "reads as their parent"), and two functions computing
 * the same noun from two files would let the two disagree the moment either
 * one's spelling changed — the `ownerOf`/phase-table failure mode
 * (`CLAUDE.md`), restated for a formatter instead of a fold. */
export function pieceLabel(count: number): string {
  return `${count} ${count === 1 ? 'PIECE' : 'PIECES'}`
}

/** `1 ENTRY` / `2 ENTRIES` — the `GEAR LIST` band's own noun (`Trip.tsx`) and
 * the builder's footer totals bar's first segment (`GearListBuilder.tsx`,
 * spec §4.4), moved here from `Trip.tsx` once it gained a second caller —
 * `pieceLabel`'s own precedent above, for the identical reason: two
 * functions computing "N ENTRIES" from two files would let the two disagree
 * the moment either one's spelling changed. */
export function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'ENTRY' : 'ENTRIES'}`
}

export function GearListSection({
  trip,
  editable,
  onBringCountChange,
  onRemove,
}: GearListSectionProps) {
  const state = useDepot((depot) => depot.state)
  const entries = entriesOf(trip, state)

  // Which Entry's `PiecePicker` is open, if any — held here rather than by
  // the row, because the picker itself (ruling C) needs the Entry and the
  // Trip, and `EntryRow` stays presentational (this file's own docstring).
  const [openPieceEntryId, setOpenPieceEntryId] = useState<string | null>(null)
  const openPieceEntry = entries.find((entry) => entry.id === openPieceEntryId)

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
      {groups.map((group) => {
        // Ties the header's label to its own rows for assistive tech (review
        // round F3): without it, a screen-reader user hears "list, N items"
        // with no Kind context at any width — the visible header names the
        // group, but nothing wires that name to the list beneath it. Scoped
        // by `trip.id` so two mounted sections (unlikely, but defensive)
        // never collide on the same id.
        const headingId = `gear-list-group-${trip.id}-${group.key}`
        return (
          <div
            key={group.key}
            className={styles['group']}
            role="group"
            aria-labelledby={headingId}
          >
            <div className={styles['groupHeader']}>
              <span
                id={headingId}
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
              {group.entries.map((entry) => {
                const kind = rowKind(entry, state)
                return (
                  <li key={entry.id}>
                    <EntryRow
                      label={entryLabel(entry, state)}
                      kind={kind}
                      bringCount={bringCountOf(entry, state)}
                      pieceCount={pieceCountOf(entry, trip, state)}
                      // Only a `per_person` row reads `pieces` (`EntryRow`'s
                      // own docstring) — skipped for every other Kind rather
                      // than computed and ignored. `tripPieces` is the one
                      // join `PiecePicker` also calls (`depot/trips.ts`), so
                      // the row's circles and the picker's rows can never
                      // drift from each other.
                      pieces={
                        kind === 'per_person'
                          ? tripPieces(state, trip, entry)
                          : []
                      }
                      editable={editable}
                      onBringCountChange={(next) =>
                        onBringCountChange(entry.id, next)
                      }
                      onRemove={() => onRemove(entry.id)}
                      onOpenPiecePicker={() => setOpenPieceEntryId(entry.id)}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      {openPieceEntry && (
        <PiecePicker
          trip={trip}
          entry={openPieceEntry}
          onClose={() => setOpenPieceEntryId(null)}
        />
      )}
    </div>
  )
}
