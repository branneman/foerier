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
 * ## `SET EVERYONE` writes every included row, unconditionally
 *
 * Three chips, not one control — a single control cannot name a *next*
 * state when the rows disagree — and each writes **every** included Piece
 * to the tapped status, whether or not a row already holds it. That is what
 * makes "a second tap on another chip reverses the whole set" true with no
 * confirm: nothing is destroyed, a redundant write here costs nothing a
 * Quartermaster would notice, and gating on "already there" would make the
 * chip's count depend on the roster's current spread instead of just its
 * size.
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
    // Every included row, unconditionally — see the module docblock's
    // "writes every included row" note.
    for (const row of rows) {
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
