import {
  entryKind,
  entryLabel,
  isPacked,
  nextStatus,
  ownerLabel,
  packingItems,
  personNameOrUnnamed,
  pieceCountOf,
  pieceStatusOf,
  statusGlyph,
  statusLabel,
  statusOf,
  tripEntryStatusSet,
  tripPieceStatusSet,
  UNNAMED_PERSON_GLYPH,
  type StatusValue,
  type TripResidence,
} from '@foerier/shared'
import { PersonCluster } from '@foerier/ui'
import { useMemo } from 'react'

import { useDepot } from '../depot/store'
import { tripParticipants } from '../depot/trips'
import styles from './PackingRow.module.css'
import { residenceLabel, toneForStatus } from './PieceStatusSheet'

/**
 * **One line of work on F4** — ruling A2, `docs/design/README.md` §1's
 * two-targets bullet, spec §4.3.
 *
 * ## The row has exactly two targets, and they are the domain's two tracks
 *
 * **Right edge** = *how far along*: the status pill, tapping through
 * `○ → ◐ → ● → ○`, or — on a per-person row — the 34px circle cluster as
 * **one control**. **Row body** = *where*: the Pack picker, or (per-person)
 * the Piece status sheet, which is the only surface that can say that one
 * Piece rides in the duffel while another is loose.
 *
 * The row body was free *precisely because* the pill already owns the thumb
 * side, and that is also what keeps the two apart: the pill states its own
 * explicit ≥44 and the body is the rest of a ≥64px row, so ruling O's
 * clamped extensions never reach across each other. Neither this row nor any
 * ancestor of it may carry `overflow: hidden` — a clipped descendant is not
 * hit-testable, and `drawnSizes.test.ts` reads stylesheet text, so it would
 * pass over a hit area that does not exist.
 *
 * ## Circles are never individual tap targets
 *
 * Ruling B, reaffirmed at 34px by ruling A1: a 44px target on a 39px pitch
 * puts a tap meant for Els on Mark — B's own arithmetic one size up, on the
 * screen used with cold hands. So the cluster is one control, wrapped
 * `aria-hidden` inside a button that carries the whole fact as its
 * accessible name (`EntryRow`'s pattern, unchanged), and no circle is ever a
 * `<button>` of its own.
 *
 * ## A container Entry has no status pill anywhere
 *
 * Ruling A5, sync §3.7: a container carries a journey *instead of* a status.
 * The row reads that from **{@link statusOf} returning `null`** — never from
 * `entryKind`, never from the register — which is also the narrowing the
 * type demands, so the two cannot come apart. In CONTAINER mode a container
 * is a group header rather than a row, and the header draws a rail where
 * this draws a pill.
 *
 * ## One pill for a whole Bring-count
 *
 * Ruling A13: `status` is one register on the Entry and counted units have
 * no per-unit identity, so `Trekking poles ×2` carries one pill and one tap
 * moves the trip's count by two. Correct, and needing no UI.
 *
 * ## The meta line
 *
 * `SHARED · ×1` · `PERSONAL E · ×2` · `PER-PERSON · 1/3`, and `NOT IN DEPOT`
 * for a trip-only Entry, which also takes the amber `TRIP-ONLY` badge beside
 * its name — `EntryRow`'s badge, same encoding and the same place, a name
 * adjunct rather than trailing-column content.
 *
 * The ownership segment is {@link ownerLabel}'s `PERSONAL E`, not the
 * board's `PERSONAL · E`: `docs/design/README.md` §2 resolved that spelling
 * to the Depot's when S4 shipped the function, and §1's own note says S9
 * inherits it rather than re-deciding. A depot Entry whose Gear has not
 * reached this replica reads `SHARED` — `personPartition`'s rule 3 for the
 * identical state, read here rather than invented.
 *
 * ## `personId` draws one Piece, and PERSON mode is its caller
 *
 * With `personId` set the row *is* one Piece: the pill reads that Piece's
 * own status and emits `trip.piece_status_set`, the body moves that Piece
 * alone, and the name gains the board's `— ELS'S PIECE` suffix — recorded
 * case in the DOM, capped by CSS, the house rule — over a meta line that is
 * simply where the Piece rides. CONTAINER mode never passes it
 * — a per-person Entry is one row with a cluster there — so PERSON mode
 * (the next task) is the caller. What that mode adds on top is the residence
 * segment every *other* row's meta gains once no header states it; that is a
 * flag this row does not yet carry.
 */
export interface PackingRowProps {
  tripId: string
  entryId: string
  /** Set to draw one Piece of a per-person Entry rather than the Entry. */
  personId?: string
  /** The row body's *where*: the Pack picker, for this Entry or Piece. */
  onOpenPicker: () => void
  /** The per-person cluster's control, and a per-person row's own body. */
  onOpenPieceSheet: () => void
}

/** One circle's worth of a per-person row: who, and how far along. */
interface RowPiece {
  personId: string
  label: string
  status: StatusValue
}

/** `label.charAt(0).toUpperCase()`, or `undefined` for the sentinel — the
 * transform every `PersonCircle` caller in `app/` repeats rather than
 * shares; see `EntryRow.tsx`'s own copy of this note. */
function personInitial(label: string): string | undefined {
  return label === UNNAMED_PERSON_GLYPH
    ? undefined
    : label.charAt(0).toUpperCase()
}

export function PackingRow({
  tripId,
  entryId,
  personId,
  onOpenPicker,
  onOpenPieceSheet,
}: PackingRowProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)

  const trip = state.trips[tripId]
  const entry = trip?.entries?.[entryId]

  /**
   * Every Piece of this Entry, in display order — the same read
   * `PieceStatusSheet` makes, and deliberately through {@link packingItems}
   * rather than a second derivation: that selector already decides what an
   * absent Piece status and an absent Piece residence read as, and a row
   * whose circles disagreed with the sheet they open would be exactly the
   * drift `packing.ts` exists to prevent.
   *
   * Gated on the Kind rather than computed and thrown away: `packingItems`
   * is O(entries), and CONTAINER mode draws one of these per row, so the
   * ungated version would pay O(rows × entries) on the list the app is used
   * on most — `containerTotals`' own note, one level down.
   */
  const pieces = useMemo<readonly RowPiece[]>(() => {
    if (trip === undefined || entry === undefined) return []
    if (entryKind(entry, state) !== 'per_person') return []
    const byPerson = new Map<string, StatusValue>()
    for (const item of packingItems(trip, state)) {
      if (item.kind !== 'piece' || item.entryId !== entryId) continue
      byPerson.set(item.personId, item.status)
    }
    return tripParticipants(state, trip).flatMap((person) => {
      const status = byPerson.get(person.id)
      if (status === undefined) return []
      return [{ personId: person.id, label: person.label, status }]
    })
  }, [state, trip, entry, entryId])

  /** This Piece's residence, for the `personId` row's meta line. */
  const pieceResidence = useMemo<TripResidence | null>(() => {
    if (trip === undefined || personId === undefined) return null
    for (const item of packingItems(trip, state)) {
      if (item.kind !== 'piece') continue
      if (item.entryId !== entryId || item.personId !== personId) continue
      return item.residence
    }
    return null
  }, [state, trip, entryId, personId])

  // The ids are the caller's, and a row can outlive the Entry it names by a
  // fold — another Device's `trip.entry_removed`, arriving between render
  // and the next. `PieceStatusSheet` takes the same shape for the same
  // reason.
  if (trip === undefined || entry === undefined) return null

  const label = entryLabel(entry, state)
  const kind = entryKind(entry, state)
  const source = entry.source?.value
  const tripOnly = source !== undefined && source.from === 'trip_only'
  const gear =
    source !== undefined && source.from === 'depot'
      ? state.gear[source.gearId]
      : undefined

  const isPiece = personId !== undefined
  const isPerPerson = !isPiece && kind === 'per_person'

  const status = isPiece
    ? pieceStatusOf(entry.pieces?.[personId], entry, state)
    : statusOf(entry, state)

  const packedPieces = pieces.filter((piece) => isPacked(piece.status)).length

  const meta = tripOnly
    ? 'NOT IN DEPOT'
    : isPiece
      ? // A Piece's own meta is where it rides — the board's own row
        // anatomy, and the only fact a Piece has that its Entry does not.
        pieceResidence === null
        ? ''
        : residenceLabel(trip, state, pieceResidence)
      : isPerPerson
        ? `PER-PERSON · ${packedPieces}/${pieces.length}`
        : // `SHARED` for a depot Entry whose Gear has not reached this
          // replica — `personPartition`'s rule 3 for the identical state.
          `${gear === undefined ? 'SHARED' : ownerLabel(state, gear)} · ×${pieceCountOf(entry, trip, state)}`

  function advance(current: StatusValue) {
    if (personId === undefined) {
      emit(tripEntryStatusSet(tripId, entryId, nextStatus(current)))
      return
    }
    emit(tripPieceStatusSet(tripId, entryId, personId, nextStatus(current)))
  }

  const clusterName = `Packing status — ${label}, ${packedPieces} of ${pieces.length} packed`

  return (
    <div className={styles['row']} data-testid="packing-row">
      <button
        type="button"
        className={styles['body']}
        data-testid="packing-row-body"
        onClick={isPerPerson ? onOpenPieceSheet : onOpenPicker}
      >
        <span className={styles['nameLine']}>
          <span className={styles['name']} data-testid="packing-row-name">
            {label}
          </span>
          {/* Recorded case here, drawn in caps by `.piece`'s own
              `text-transform` — `PieceStatusSheet`'s `.residence`
              convention, and the house rule that CAPS is a CSS transform
              rather than a string. */}
          {isPiece && (
            <span className={styles['piece']}>
              {`— ${personNameOrUnnamed(state, personId)}'s piece`}
            </span>
          )}
          {tripOnly && <span className={styles['badge']}>TRIP-ONLY</span>}
        </span>
        {meta !== '' && (
          <span className={styles['meta']} data-testid="packing-row-meta">
            {meta}
          </span>
        )}
      </button>

      {isPerPerson ? (
        <button
          type="button"
          className={styles['cluster']}
          aria-label={clusterName}
          data-testid="packing-row-cluster"
          onClick={onOpenPieceSheet}
        >
          {/* `aria-hidden` + `display: contents`: this button already carries
              the whole fact as its own label, so `PersonCluster`'s
              `role="img"` would announce the roster a second time
              (`EntryRow`'s pattern, commit `83e2d6f`). */}
          <span aria-hidden="true" className={styles['clusterWrap']}>
            <PersonCluster
              people={pieces.map((piece) => ({
                key: piece.personId,
                label: personInitial(piece.label),
                tone: toneForStatus(piece.status),
              }))}
              size={34}
              label={clusterName}
            />
          </span>
        </button>
      ) : (
        // `null` is a container (ruling A5), and the narrowing the type
        // demands is the same one the ruling states — see the docstring.
        status !== null && (
          <button
            type="button"
            className={styles['pill']}
            data-status={status}
            data-testid="packing-status-pill"
            onClick={() => advance(status)}
          >
            {statusGlyph(status)} {statusLabel(status)}
          </button>
        )
      )}
    </div>
  )
}
