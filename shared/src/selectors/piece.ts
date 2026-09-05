import type { EntryState, TripState } from '../state.ts'
import { participantIds } from './trip.ts'

/**
 * **A Piece's existence, stated once** — beside `entry.ts` and `claim.ts`, and
 * the same shape of problem: a fact several surfaces must agree on, computed
 * here rather than at each of them.
 *
 * A Piece is **derived, never enumerated** (`sync-protocol.md` §4.4): the
 * Trip's Participants minus those explicitly tombstoned. `trip.entry_added`
 * lists no Pieces and there is no `piece_added` op, which is what keeps "add a
 * Participant later and they get a Piece" true **with no backfill op**.
 *
 * This is `ownerOf`'s rule and `phaseOf`'s rule for a third time, and it earns
 * the same defence: a call site re-deriving it will drift, and the symptom is a
 * row whose `×N` disagrees with the circles beside it.
 *
 * Two rules follow that a reader must not re-decide:
 *
 * - **A tombstone outlives its Participant.** Remove Kim's Piece, drop Kim
 *   from the Trip, add her back: the Piece is still out. Clearing it on re-add
 *   would be a cascade, and §3.5 is categorical that a tombstone never
 *   cascades.
 * - **A tombstone for a non-Participant is inert**, not an error. Starting
 *   from Participants and subtracting is *how* invariant 10 is honoured, so
 *   there is no gate to write.
 *
 * **Order here is by id** — `participantIds`' own total, replica-identical
 * order — and it is deliberately **not** the drawn order. Surfaces order by
 * Person label through `tripParticipants`, and ruling E then sorts excluded
 * circles to the front; both live at the cluster, not here.
 *
 * Takes no `HouseholdState`: unlike `entryKind` or `bringCountOf` this asks
 * nothing of another aggregate.
 */
export interface PieceInclusion {
  readonly personId: string
  readonly included: boolean
}

/** Every Participant, and whether their Piece is included. */
export function pieceInclusion(
  entry: EntryState,
  trip: TripState,
): readonly PieceInclusion[] {
  return participantIds(trip).map((personId) => ({
    personId,
    included: entry.pieces?.[personId]?.removed?.value !== true,
  }))
}

/** The Participants whose Piece is included — the count and the claim. */
export function piecesOf(
  entry: EntryState,
  trip: TripState,
): readonly string[] {
  return pieceInclusion(entry, trip)
    .filter((piece) => piece.included)
    .map((piece) => piece.personId)
}
