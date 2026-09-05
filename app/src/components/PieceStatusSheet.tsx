import {
  entryLabel,
  isContainerEntry,
  isPacked,
  nextStatus,
  packingItems,
  statusGlyph,
  statusLabel,
  STATUSES,
  tripPieceStatusSet,
  UNNAMED_PERSON_GLYPH,
  type HouseholdState,
  type EntryState,
  type StatusValue,
  type TripResidence,
  type TripState,
} from '@foerier/shared'
import { PersonCircle, Sheet, StatusPill } from '@foerier/ui'
import { useMemo } from 'react'

import { useHousehold } from '../household/store'
import { tripParticipants } from '../household/trips'
import styles from './PieceStatusSheet.module.css'

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
 * board draws four slots per row — circle, name-over-residence, a
 * right-aligned status word, and `MOVE` — and this component draws all
 * four: the status glyph and label are no longer glued to the name (review
 * F2/F11), so a screen reader hears the Person, where they ride, and how far
 * along they are as three distinct facts rather than one run-on string.
 *
 * ## The circle's fill is this sheet's to decide, not `ui/`'s
 *
 * {@link toneForStatus} maps a Piece's status to `PersonCircle`'s `tone` —
 * `filled` for packed, `half` for staged, the pre-existing `control` for
 * everything else (bordered, the board's "not packed" colour, unchanged).
 * `ui/PersonCircle` names these two by their **paint**, not by
 * `packed`/`staged`, exactly as `dashed`'s "not bringing one" is S8's
 * meaning and not the primitive's — see that file's own docblock.
 *
 * ## `MOVE` is a sibling control, never a nested one
 *
 * Two buttons per row — the body (status) and the trailing `MOVE`
 * (residence) — because a `<button>` cannot contain a second one. `MOVE`
 * calls {@link PieceStatusSheetProps.onOpenPieceMove} and mounts nothing:
 * the screen owns the `PackPicker` for that one Piece.
 *
 * ## Status and residence come from `packingItems`, not a second derivation
 *
 * `shared/src/selectors/packing.ts` already computes, for exactly this set
 * of Pieces, `status: pieceStatusOf(...) ?? 'not_packed'` — with an explicit
 * "never null here" guard against a container Entry's `null` status — and
 * each Piece's **effective** residence, resolved through the Trip's
 * containment view. **A Piece with no residence register of its own reads
 * `loose`** (§5e C0): for per-person gear *where it is* is only ever a
 * per-Piece fact, so there is no Entry-level residence to fall back to —
 * `entryResidenceOf` answers `null` for that Kind and neither that selector
 * nor this sheet asks it for one. (S9a's layered read, Piece-then-Entry, is
 * what C0 overturned; its spec is a dated record and is not edited.)
 * Restating either read here would be the `ownerOf`/`isActive` drift this
 * repo keeps catching: if either is ever ruled on again, the packing
 * screen's rows and this sheet's rows would silently disagree about the
 * same Piece. So this component filters {@link packingItems} to this
 * Entry's `kind === 'piece'` rows and resolves only the **label** — the one
 * thing packing.ts has no reason to know — locally.
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
 * `packingItems` already excludes a tombstoned Piece — S8's own rule, read
 * once rather than re-checked here — and {@link tripParticipants} decides
 * the display order.
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
  residenceLabel: string
}

/**
 * `PersonCircle`'s tone for a Piece's own status — presentational, not
 * domain: `filled` and `half` are named for their paint, and this is the
 * one place in the app allowed to say what `packed`/`staged` look like. An
 * unrecognised status (the open-enum case `isKnownStatus` names elsewhere)
 * draws `control`, the same bordered default `not_packed` draws — there is
 * no fill to invent for a status this build has never heard of.
 *
 * **Exported so that it stays one place.** `PackingRow`'s 34px cluster
 * paints the same three fills for the same three statuses, and a second
 * copy would drift the way `ownerOf` and `phaseOf` keep warning about: the
 * symptom is a circle drawn half-filled on the row and solid in the sheet
 * that row opens, for one Piece, at the same instant.
 */
export function toneForStatus(
  status: StatusValue,
): 'control' | 'filled' | 'half' {
  if (isPacked(status)) return 'filled'
  if (status === 'staged') return 'half'
  return 'control'
}

/**
 * `ui/StatusPill`'s tone for the same status — a **different question about
 * the same value**, and the reason it sits here rather than in `PackingRow`
 * beside its one caller: `toneForStatus` above answers *what fill does this
 * circle take*, this answers *what tint does this pill take*, and the two
 * must gain an arm together the day a fourth status arrives. §1.4's rule,
 * with the pair kept adjacent so neither can be updated alone.
 *
 * Presentational again — `not-packed` is `StatusPill`'s word for its dimmed
 * paint, not a claim about the domain — and an unrecognised status takes it
 * too: the pill still reads the status's own word beside a neutral tint,
 * which is the honest paint for something this build cannot name.
 */
export function pillToneForStatus(
  status: StatusValue,
): 'not-packed' | 'staged' | 'packed' {
  if (isPacked(status)) return 'packed'
  if (status === 'staged') return 'staged'
  return 'not-packed'
}

/**
 * The residence half of a `PackingItem`, rendered — `▸ Duffel 90 L` in its
 * **recorded** case (drawn in caps by `.residence`'s own `text-transform`,
 * `PackPicker`'s convention — F6), or the literal `▸ LOOSE`. `LOOSE` never
 * stands alone as a world (`docs/design/README.md` §101), which is why the
 * loose branch carries the same `▸` every other branch does rather than a
 * bare word.
 *
 * **Names the immediate container only, by design — not a breadcrumb.**
 * `▸ Duffel 90 L` is the board's own row anatomy (§1: `● Mark · ▸ DUFFEL
 * 90 L`), the same single-name form ALL mode's meta line uses for a trip
 * residence. A nested `▸ Crate B ▸ Duffel 90 L` would be a different read
 * from the one drawn, so do not "improve" this into `tripPath`'s ancestry.
 *
 * **Exported for {@link toneForStatus}'s reason.** A per-Piece packing row
 * draws the identical segment, and two copies of "what does an absent
 * container read as" is exactly the drift this file's own header warns
 * about one paragraph up.
 */
export function residenceLabel(
  trip: TripState,
  state: HouseholdState,
  residence: TripResidence,
): string {
  if (residence.in === 'loose') return '▸ LOOSE'
  const container = trip.entries?.[residence.entryId]
  if (container === undefined || !isContainerEntry(container, state)) {
    return '▸ LOOSE'
  }
  return `▸ ${entryLabel(container, state)}`
}

export function PieceStatusSheet({
  tripId,
  entryId,
  onClose,
  onOpenPieceMove,
}: PieceStatusSheetProps) {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)

  const trip: TripState | undefined = state.trips[tripId]
  const entry: EntryState | undefined = trip?.entries?.[entryId]

  // Derived from `state`, `trip` and `entryId` alone — `entry` is looked up
  // from `trip.entries` and never varies independently of it, so the
  // dependency list names exactly what can change.
  const rows = useMemo<readonly StatusRow[]>(() => {
    if (trip === undefined || entry === undefined) return []
    const byPerson = new Map<
      string,
      { status: StatusValue; residence: TripResidence }
    >()
    for (const item of packingItems(trip, state)) {
      if (item.kind !== 'piece' || item.entryId !== entryId) continue
      byPerson.set(item.personId, {
        status: item.status,
        residence: item.residence,
      })
    }
    // `flatMap` rather than `.filter(...).map(...)`: the lookup and the
    // inclusion test are the same map access, so doing both in one pass
    // means the `undefined` case a separate filter-then-map would leave for
    // `map` to explain away never arises in the first place — an empty
    // array skips the row, a one-element array keeps it, and there is no
    // branch left to fill with a fallback (or a cast) that can never run.
    return tripParticipants(state, trip).flatMap((person) => {
      const item = byPerson.get(person.id)
      if (item === undefined) return []
      return [
        {
          personId: person.id,
          label: person.label,
          status: item.status,
          residenceLabel: residenceLabel(trip, state, item.residence),
        },
      ]
    })
  }, [state, trip, entry, entryId])

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
                  tone={toneForStatus(row.status)}
                />
              </span>
              <span className={styles['nameStack']}>
                <span className={styles['name']}>{row.label}</span>
                <span className={styles['residence']}>
                  {row.residenceLabel}
                </span>
              </span>
              <span className={styles['statusWord']}>
                {statusGlyph(row.status)} {statusLabel(row.status)}
              </span>
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
            /* `plain`, not the row tone: three tinted buttons here would
               compete with the tinted pills on the rows behind them, which
               is why the board draws these neutral. */
            <StatusPill
              key={option.id}
              glyph={option.glyph}
              label={option.label}
              size="action"
              onClick={() => setEveryone(option.id)}
            />
          ))}
        </div>
      </div>

      <p className={styles['hint']}>
        TAP A ROW = NEXT STATE FOR THAT PERSON · ONE OP PER TAP
      </p>

      <Sheet.Close>
        <button type="button" className={styles['close']}>
          Close
        </button>
      </Sheet.Close>
    </Sheet>
  )
}
