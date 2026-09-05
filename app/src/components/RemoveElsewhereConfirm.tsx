import {
  entryLabel,
  personNameOrUnnamed,
  piecesOf,
  tripEntryRemoved,
  tripNameOrUnnamed,
  tripPieceRemoved,
  visibleEntry,
} from '@foerier/shared'
import { Confirm } from '@foerier/ui'

import { useHousehold } from '../household/store'
import { tripChip } from '../household/trips'
import styles from './RemoveElsewhereConfirm.module.css'

/**
 * **The Remove-on-Alps confirm** — spec §4.7, `OverClaimBand`'s `REMOVE ON
 * <trip>` route made real. Every other settle route on the band
 * (`REMOVE HERE`, `BRING FEWER`, and the list's own `✕`) writes against the
 * Trip the screen is already showing and never confirms — the tag-chip rule:
 * one op, the gear untouched, re-adding two taps. This is the one route that
 * writes against a **different** Trip's aggregate, and its undo is a
 * navigation away rather than a second tap, so it goes through the
 * deliberate-act register instead: title, one body line, a mono context line
 * naming the other Trip's state, accent primary (nothing is destroyed), ghost
 * `Cancel`.
 *
 * **It owns its own write**, `PhaseSheet`'s shape rather than
 * `ReopenConfirm`'s. `ReopenConfirm` hands its decision back to a caller that
 * already holds the one Trip in play; here the caller (`Trip.tsx` or
 * `GearListBuilder.tsx`) is looking at a *different* Trip than the one this
 * confirm writes against, so nothing is gained by re-deriving `otherTrip` and
 * the Entry's name a second time above this component. `otherTripId` and
 * `entryId` are enough to find both in the fold.
 *
 * **It is a bottom sheet, `variant="sheet"`, not the card default** —
 * `Screens B:1117-1125` draws it bottom-anchored with a grabber, and
 * `Confirm.Action` first, `Confirm.Cancel` after (`Devices.tsx`'s own settled
 * comment: *"Action before Cancel is the boards' own order… Radix gives
 * initial focus to the Cancel wherever it sits in the DOM"*). It matters past
 * layout: the card variant's `.descriptionCard` draws its whole description
 * in amber mono, the colour `▲` owns — which would make *"the gear itself
 * does not move"*, whose entire job is to say nothing was destroyed, read as
 * a second alarm inside a band that is already amber. `.descriptionSheet`
 * carries no such colour.
 *
 * **An unnamed other Trip reads `Unnamed trip`**, via `tripNameOrUnnamed`
 * (`depot/trips.ts`) — the same substitution `OverClaimBand`'s row and settle
 * route already use, not a third private copy of it.
 *
 * **Mounted is open**, as every `ui/` primitive is: the caller writes
 * `{pending !== null && <RemoveElsewhereConfirm …/>}`, and there is no draft
 * here to reset — the confirm reads the fold fresh on every mount.
 *
 * **Ruling G's Piece variant** (S8): `personId`, present only for
 * `OverClaimBand`'s `REMOVE <name>'S PIECE ON <trip>` route, retitles the
 * sheet and swaps the emit from `trip.entry_removed` to `trip.piece_removed`
 * rather than a second component being written beside this one — the same
 * write-against-another-aggregate, deliberate-act shape either way, only the
 * *subject* changes. The body copy is **not** the spec draft's
 * `"Mark isn't bringing one on Vosges"`, which the design round overturned
 * for inferring the actor's intent (nobody here knows *why* Mark isn't
 * bringing one, only that the op removes his Piece); it follows the Entry
 * variant's own construction instead — *"X comes off the Y gear list. The
 * gear itself does not move."* — states what the op does, not a guess at
 * what it means.
 */
export interface RemoveElsewhereConfirmProps {
  /** The Trip this confirm's own write lands against — not the screen behind it. */
  readonly otherTripId: string
  readonly entryId: string
  readonly onClose: () => void
  /**
   * Present only for the Piece variant (ruling G). Absent is the Entry
   * variant, unchanged from before S8.
   */
  readonly personId?: string | undefined
}

export function RemoveElsewhereConfirm({
  otherTripId,
  entryId,
  onClose,
  personId,
}: RemoveElsewhereConfirmProps) {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)

  const otherTrip = state.trips[otherTripId]
  // Unreachable from `OverClaimBand`'s own `REMOVE ON` route when it opens —
  // an `OverClaim` only ever names a Trip and an Entry both already in this
  // replica's fold — but the type is `TripState | undefined`, and the Entry
  // can genuinely vanish out from under an *already-open* confirm: this
  // sheet stays mounted while sync runs, so a `trip.entry_removed` for the
  // same Entry arriving from another Device through `/sync/pull` folds while
  // this confirm is still up. Rendering nothing beats stating facts about
  // data that is not there — the alternative is a body sentence with no
  // subject, `" comes off the Alps 2026 gear list."`.
  //
  // **"Gone" is `visibleEntry`'s answer, not `entries[id] === undefined`.**
  // The reducer keeps a removed Entry as an entity with `removed: true`
  // (`reduce.ts`'s `writeEntry`), so after that peer's tombstone folds the
  // Entry is still *defined* — and a guard on `undefined` alone kept this
  // sheet up, with a `REMOVE` that authored a second `trip.entry_removed`:
  // a needless write, moving the stamp LWW compares for nothing. `entriesOf`
  // is the one place that says which Entries a reader may see, and
  // `visibleEntry` is that rule asked about this one.
  const entry =
    otherTrip === undefined ? undefined : visibleEntry(otherTrip, entryId)
  if (otherTrip === undefined || entry === undefined) return null

  // Ruling G's extra clause on the same guard: the Piece's Person can leave
  // the other Trip's roster — or have this very Piece removed by a peer —
  // while this sheet is still open, exactly the live race above but one
  // level deeper. `piecesOf` already derives both cases (a Participant
  // removed from the Trip, and an explicit tombstone) into one
  // included/not fact, so reading it here is `piece.ts`'s own rule, not a
  // second guard invented for this sheet. Rendering nothing leaves the
  // body's subject as absent as a removed Entry does, the same reasoning as
  // the guard above, one step further in.
  if (
    personId !== undefined &&
    !piecesOf(entry, otherTrip).includes(personId)
  ) {
    return null
  }

  const gearName = entryLabel(entry, state)
  const name = tripNameOrUnnamed(otherTrip)
  // `tripChip` is the one function that composes phase + `DAY N` — the same
  // string the trip screen's own chip and `TripCard` draw, so the other
  // Trip's state reads identically wherever it appears.
  const chip = tripChip(otherTrip, Date.now())
  const personName =
    personId === undefined ? undefined : personNameOrUnnamed(state, personId)

  // `Confirm.Action` is `DialogPrimitive.Close` underneath (Radix's own
  // `AlertDialogAction`), so clicking it already triggers `onClose` through
  // `onOpenChange` — calling it again here would close twice. Only the emit
  // is this handler's job.
  function confirmRemove() {
    if (personId !== undefined) {
      emit(tripPieceRemoved(otherTripId, entryId, personId))
    } else {
      emit(tripEntryRemoved(otherTripId, entryId))
    }
  }

  const title =
    personName === undefined
      ? `Remove from ${name}?`
      : `Remove ${personName}’s piece from ${name}?`

  return (
    <Confirm
      variant="sheet"
      title={title}
      description={
        // Two `<span>`s, not two `<p>`s: `AlertDialog.Description` is itself
        // a `<p>` (Radix's `Primitive.p`), and a `<p>` cannot nest another.
        // The body carries no class of its own — `.descriptionSheet` already
        // gives it the right quiet, non-attention treatment, and `.context`'s
        // own `display: block` is what forces the line break after it.
        <>
          <span>
            {personName === undefined ? (
              <>
                {gearName} comes off the {name} gear list. The gear itself does
                not move.
              </>
            ) : (
              <>
                {personName}’s piece comes off the {name} gear list. The entry
                stays for everyone else; the gear itself does not move.
              </>
            )}
          </span>
          <span
            className={styles['context']}
            data-testid="remove-elsewhere-context"
          >
            {/* The trip-world glyph in its own element, carrying the trip
                colour (`Screens B:1121`'s amber `▸`) rather than the muted ink
                around it — the same split every other attention/trip glyph
                in this codebase draws between the mark and its sentence. */}
            <span className={styles['glyph']}>▸</span> {name} · {chip}
          </span>
        </>
      }
      onClose={onClose}
      actions={
        <>
          {/* Action before Cancel is the boards' own order
              (`Devices.tsx`'s settled comment) — Radix gives initial focus to
              the Cancel wherever it sits in the DOM, so this is a DOM-order
              decision, not a visual one. */}
          <Confirm.Action>
            <button
              type="button"
              className={styles['primary']}
              onClick={confirmRemove}
            >
              {personName === undefined ? 'Remove entry' : 'Remove piece'}
            </button>
          </Confirm.Action>
          <Confirm.Cancel>
            <button type="button" className={styles['ghost']}>
              Cancel
            </button>
          </Confirm.Cancel>
        </>
      }
    />
  )
}
