import {
  entryLabel,
  tripPieceRemoved,
  tripPieceRestored,
  UNNAMED_PERSON_GLYPH,
  type EntryState,
  type TripState,
} from '@foerier/shared'
import { PersonCircle, Popover, Sheet } from '@foerier/ui'
import type { ReactNode } from 'react'

import { useHousehold } from '../household/store'
import { tripPieces } from '../household/trips'
import { SPLIT, useMediaQuery } from '../shell/useMediaQuery'
import styles from './PiecePicker.module.css'

/**
 * **Who brings this one** — ruling C's answer to a problem ruling B creates.
 *
 * The gear-list row draws 24px inclusion circles, and the obvious move is to
 * make each one a tap target. Ruling O forbids it: three circles on a row are
 * each other's neighbours, so a clamped 44px hit area reaches only ~32px, and
 * an unclamped one on 32px centres puts a tap meant for Els on Mark — the
 * wrong Person's Piece toggled. So the circles stay **display**, and this
 * picker is the **control**: `ParticipantPicker`'s settled idiom, rows and not
 * circles, applied to a second roster.
 *
 * ## The ledger states, it does not ask
 *
 * An earlier draft titled this `Headlamp — who brings one?`; the S8 round
 * redrew it. The title is the gear's own name (`entryLabel`) and the mono
 * fact beneath it (`WHO BRINGS ONE · 2 OF 3`) is a count, not a question —
 * this component's whole copy surface follows that one ruling.
 *
 * ## It emits directly, unlike `ParticipantPicker`
 *
 * `ParticipantPicker` hands its toggle to the caller because one of its two
 * callers (`/trips/new`) has no Trip yet to address. Every Piece toggle has
 * both a Trip and an Entry — `PhaseSheet`'s shape, not that one's — so there
 * is nothing served by threading the op back up through a caller that would
 * only ever re-emit it unchanged.
 *
 * ## One op per tap, nothing commits at close
 *
 * The tag-chip rule, not the trip screen's old two-commit one: a tap emits
 * `trip.piece_restored` or `trip.piece_removed` immediately, and `Close` is a
 * plain dismissal that authors nothing. Reversing a tap is the next tap on
 * the same row, exactly as removing a Participant is (`§3.5` — a tombstone
 * never cascades, and neither does its opposite).
 *
 * ## No empty state, deliberately
 *
 * A Trip with no Participants has no Pieces to picture, so this component
 * never mounts on one — the gate is the row's, which draws `NO PARTICIPANTS`
 * + `×0` instead. Writing an empty branch here would be a
 * second copy of a decision that belongs at the one call site that can see
 * whether there is anything to open.
 *
 * ## No all/none affordance
 *
 * A roster is a handful of rows to tap through by hand; a bulk toggle is S9's
 * long-press, a status gesture this component has nothing to do with.
 */
export interface PiecePickerProps {
  trip: TripState
  entry: EntryState
  onClose: () => void
  /** The row's own cluster control, rendered by this component — a popover
   * positions against an element inside its own Radix root (§5n K17). */
  anchor: ReactNode
}

export function PiecePicker({
  trip,
  entry,
  onClose,
  anchor,
}: PiecePickerProps) {
  const isSplit = useMediaQuery(SPLIT)
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)

  // `tripPieces` (`depot/trips.ts`) is the one join this row and
  // `EntryRow`'s trailing slot both call — `pieceInclusion`'s own order is
  // by id, deliberately not the drawn one
  // (`shared/src/selectors/piece.ts`), so a second, separate re-join here
  // would risk drifting from the row's own.
  const rows = tripPieces(state, trip, entry)
  const includedCount = rows.filter((row) => row.included).length

  function toggle(personId: string, isIncluded: boolean) {
    emit(
      isIncluded
        ? tripPieceRemoved(trip.id, entry.id, personId)
        : tripPieceRestored(trip.id, entry.id, personId),
    )
  }

  /**
   * **The ghost `Close` belongs to the sheet, not to the body** (§5n K17).
   *
   * `Sheet.Close` is a Radix `Dialog.Close` and throws outside a `Dialog` —
   * which is what happens the moment a body written for a sheet is reused in
   * a popover. A popover needs no such control anyway: it dismisses on Escape
   * and on a pointer-down outside, which is the form's own convention, and a
   * button labelled `Close` inside one would be a second way to do what
   * clicking anywhere already does.
   */
  const close = (
    <Sheet.Close>
      <button type="button" className={styles['close']}>
        Close
      </button>
    </Sheet.Close>
  )

  const body = (
    <>
      <ul className={styles['rows']}>
        {rows.map((row) => (
          <li key={row.personId}>
            <button
              type="button"
              className={styles['row']}
              data-testid="piece-row"
              aria-pressed={row.included}
              onClick={() => toggle(row.personId, row.included)}
            >
              {/* `ParticipantPicker`'s wrapper: `flex` rather than an
                  unstyled `<span>`, which blockifies into a line box a few
                  px taller than the circle and off-centres it. */}
              <span className={styles['circleWrap']} aria-hidden="true">
                <PersonCircle
                  label={
                    row.label === UNNAMED_PERSON_GLYPH
                      ? undefined
                      : row.label.charAt(0).toUpperCase()
                  }
                  size={30}
                  tone={row.included ? 'control' : 'dashed'}
                />
              </span>
              <span className={styles['name']}>{row.label}</span>
              {row.included && (
                <span className={styles['marker']}>BRINGS ONE ✓</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </>
  )

  /**
   * **Sheet below Split, popover from Split up** (§5n K17). `end`, because
   * the trigger is a row's right-edge cluster (§5n K16), and `rows`, because
   * the content is a list whose rows carry their own padding.
   *
   * The fact line is the sheet's `description`; in the popover it is drawn as
   * the first thing in the body, since a popover has no description slot and
   * no title — the row it hangs from is still on screen.
   */
  return isSplit ? (
    <Popover
      anchor={anchor}
      label={`Who brings one — ${entryLabel(entry, state)}`}
      align="end"
      padding="rows"
      onClose={onClose}
    >
      <p className={styles['fact']}>
        WHO BRINGS ONE · {includedCount} OF {rows.length}
      </p>
      {body}
    </Popover>
  ) : (
    <>
      {anchor}
      <Sheet
        title={entryLabel(entry, state)}
        onClose={onClose}
        description={
          <p className={styles['fact']}>
            WHO BRINGS ONE · {includedCount} OF {rows.length}
          </p>
        }
      >
        {body}
        {close}
      </Sheet>
    </>
  )
}
