import {
  entryLabel,
  isContainerEntry,
  isPacked,
  nextStatus,
  pieceStatusOf,
  piecesOf,
  statusGlyph,
  STATUSES,
  tripPieceStatusSet,
  UNNAMED_PERSON_GLYPH,
  type DepotState,
  type EntryState,
  type StatusValue,
  type TripResidence,
  type TripState,
} from '@foerier/shared'
import { PersonCircle, Sheet } from '@foerier/ui'
import { useMemo } from 'react'

import { useDepot } from '../depot/store'
import { tripParticipants } from '../depot/trips'
import styles from './PieceStatusSheet.module.css'

/** No pointer to a container names a place to draw — reason 1/2 of
 * `tripContainmentView`'s own four, restated for a Piece's own residence
 * pointer rather than an Entry's. */
const LOOSE: TripResidence = Object.freeze({ in: 'loose' })

/**
 * **Per-person packing, from one control** — ruling A1,
 * `docs/design/README.md` §1's "Piece status sheet" bullet.
 *
 * ## The row is the control, the circle is decoration
 *
 * Ruling B holds unchanged at 34px on the cluster that opens this sheet —
 * circles on a 39px pitch put a 44px target over a neighbour, cold-hands
 * arithmetic that gets *worse* one size down, not better. Inside the sheet
 * the same rule reads the other way: the roster is one Person per line, so
 * the 30px circle is a decoration on a 48px **row**, never a target of its
 * own. `.circleWrap` is `aria-hidden`, and every circle lives inside the row
 * button and nowhere the `MOVE` accent could be mistaken for it.
 *
 * ## Tap a row = next state, one op per tap
 *
 * The tag-chip rule, and the S8 Piece picker's own commit model: a tap emits
 * `trip.piece_status_set` immediately, there is no draft and no Save. The
 * status glyph (`● Mark`) is text, not a circle fill — `PersonCircle`'s
 * `tone` union carries no packed/staged/not-packed vocabulary, and this
 * component does not ask it to; the cycle is read aloud in the row's own
 * name instead.
 *
 * ## `MOVE` is a sibling control, never a nested one
 *
 * Two buttons per row — the body (status) and the trailing `MOVE`
 * (residence) — because a `<button>` cannot contain a second one. `MOVE`
 * calls {@link PieceStatusSheetProps.onOpenPieceMove} and mounts nothing:
 * the screen owns the `PackPicker` for that one Piece, exactly as a per-Piece
 * residence differs from its Entry's (`packing.ts`'s own "a Piece with no
 * `residence` register of its own reads its Entry's, then loose" —
 * {@link pieceResidenceLabel} is that same fallback, read directly off the
 * registers rather than through `packingItems`, which this sheet has no
 * other use for.
 *
 * ## `SET EVERYONE` writes only the rows that change
 *
 * Three chips, not one control — a single control cannot name a *next*
 * state when the rows disagree — and each writes one op per included Piece
 * **whose current status differs from the tapped one**. A row already at the
 * target is skipped, for the same reason SET PHASE emits nothing when the
 * phase tapped is the phase a Trip is already in, and the journey rail
 * (Task 10) writes nothing on the current stage: a redundant
 * `trip.piece_status_set` still carries a *later* HLC than whatever sits in
 * the register, so it can beat — and silently discard — a genuine concurrent
 * write from another Device that set the same Piece to something else. This
 * is the one surface in the app where a single tap can author that mistake
 * N times at once, which is what makes the skip matter here more than
 * anywhere it already holds.
 *
 * `N` in "N ops in one batch" is therefore the count of Pieces that
 * **change**, not the roster's size — tapping `● PACKED` when everyone is
 * already packed authors nothing, correctly, since the screen already shows
 * the state the tap asked for. The batch is still independent per-Piece ops
 * resolving by plain LWW, and a second tap on another chip still reverses
 * every row it touches, with no confirm: nothing is destroyed by the first
 * tap.
 *
 * ## Rows, and only included ones
 *
 * {@link piecesOf} decides inclusion; {@link tripParticipants} decides the
 * order. A Piece a tombstone has removed is not drawn here at all — S8's own
 * rule, unchanged.
 */
export interface PieceStatusSheetProps {
  tripId: string
  entryId: string
  onClose: () => void
  onOpenPieceMove: (personId: string) => void
}

interface StatusRow {
  personId: string
  label: string
  status: StatusValue
  residence: string
}

/**
 * One Piece's residence, read the way {@link pieceStatusOf} reads status: a
 * Piece with no `residence` register of its own falls back to its Entry's,
 * then to loose. A pointer naming an Entry this replica cannot see, or one
 * that is no longer a container, reads loose too — the same "invisible
 * reads loose" rule `tripContainmentView` states for the Entry-to-Entry
 * graph, restated here for a leaf pointer that graph never resolves.
 *
 * **Names the immediate container only, by design — not a breadcrumb.**
 * `▸ DUFFEL 90 L` is the board's own row anatomy (§1: `● Mark · ▸ DUFFEL
 * 90 L`), the same single-name form ALL mode's meta line uses for a trip
 * residence. A nested `▸ CRATE B ▸ DUFFEL 90 L` would be a different read
 * from the one drawn, so do not "improve" this into `tripPath`'s ancestry.
 */
function pieceResidenceLabel(
  trip: TripState,
  state: DepotState,
  entry: EntryState,
  personId: string,
): string {
  const residence =
    entry.pieces?.[personId]?.residence?.value ??
    entry.residence?.value ??
    LOOSE
  if (residence.in === 'loose') return 'LOOSE'
  const container = trip.entries?.[residence.entryId]
  if (container === undefined || !isContainerEntry(container, state)) {
    return 'LOOSE'
  }
  return `▸ ${entryLabel(container, state)}`
}

export function PieceStatusSheet({
  tripId,
  entryId,
  onClose,
  onOpenPieceMove,
}: PieceStatusSheetProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)

  const trip: TripState | undefined = state.trips[tripId]
  const entry: EntryState | undefined = trip?.entries?.[entryId]

  // Derived from `state`, `trip` and `entry` alone — none of the three
  // varies independently of the others, so the dependency list names
  // exactly what can change.
  const rows = useMemo<readonly StatusRow[]>(() => {
    if (trip === undefined || entry === undefined) return []
    const included = new Set(piecesOf(entry, trip))
    return tripParticipants(state, trip)
      .filter((person) => included.has(person.id))
      .map((person) => ({
        personId: person.id,
        label: person.label,
        status:
          pieceStatusOf(entry.pieces?.[person.id], entry, state) ??
          'not_packed',
        residence: pieceResidenceLabel(trip, state, entry, person.id),
      }))
  }, [state, trip, entry])

  if (trip === undefined || entry === undefined) return null

  const packedCount = rows.filter((row) => isPacked(row.status)).length
  const title = entryLabel(entry, state)

  function advance(personId: string, status: StatusValue) {
    emit(tripPieceStatusSet(tripId, entryId, personId, nextStatus(status)))
  }

  function setEveryone(status: StatusValue) {
    // Only the rows that change — see the module docblock's "writes only
    // the rows that change" note. A row already at `status` is skipped so a
    // redundant write can never beat a genuine concurrent one from another
    // Device (the SET PHASE / journey-rail rule, restated for a batch).
    for (const row of rows) {
      if (row.status === status) continue
      emit(tripPieceStatusSet(tripId, entryId, row.personId, status))
    }
  }

  return (
    <Sheet
      title={title}
      onClose={onClose}
      desktopCard
      description={
        <p className={styles['fact']}>
          PACKING STATUS · {packedCount} OF {rows.length} PACKED
        </p>
      }
    >
      <ul className={styles['rows']}>
        {rows.map((row) => (
          <li
            key={row.personId}
            className={styles['row']}
            data-testid="piece-status-row"
          >
            <button
              type="button"
              className={styles['rowButton']}
              data-testid="piece-status-row-button"
              onClick={() => advance(row.personId, row.status)}
            >
              <span className={styles['circleWrap']} aria-hidden="true">
                <PersonCircle
                  label={
                    row.label === UNNAMED_PERSON_GLYPH
                      ? undefined
                      : row.label.charAt(0).toUpperCase()
                  }
                  size={30}
                />
              </span>
              <span className={styles['statusName']}>
                {statusGlyph(row.status)} {row.label}
              </span>
              <span className={styles['residence']}>{row.residence}</span>
            </button>
            <button
              type="button"
              className={styles['move']}
              onClick={() => onOpenPieceMove(row.personId)}
            >
              MOVE
            </button>
          </li>
        ))}
      </ul>

      <div className={styles['setEveryone']}>
        <p className={styles['setEveryoneLabel']}>SET EVERYONE</p>
        <div className={styles['chips']}>
          {STATUSES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={styles['chip']}
              onClick={() => setEveryone(option.id)}
            >
              {option.glyph} {option.label}
            </button>
          ))}
        </div>
      </div>

      <Sheet.Close>
        <button type="button" className={styles['close']}>
          Close
        </button>
      </Sheet.Close>
    </Sheet>
  )
}
