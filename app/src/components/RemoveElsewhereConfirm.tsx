import { entryLabel, tripEntryRemoved } from '@foerier/shared'
import { Confirm } from '@foerier/ui'

import { useDepot } from '../depot/store'
import { tripChip, tripNameOrUnnamed } from '../depot/trips'
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
 */
export interface RemoveElsewhereConfirmProps {
  /** The Trip this confirm's own write lands against — not the screen behind it. */
  readonly otherTripId: string
  readonly entryId: string
  readonly onClose: () => void
}

export function RemoveElsewhereConfirm({
  otherTripId,
  entryId,
  onClose,
}: RemoveElsewhereConfirmProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)

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
  const entry = otherTrip?.entries?.[entryId]
  if (otherTrip === undefined || entry === undefined) return null

  const gearName = entryLabel(entry, state)
  const name = tripNameOrUnnamed(otherTrip)
  // `tripChip` is the one function that composes phase + `DAY N` — the same
  // string the trip screen's own chip and `TripCard` draw, so the other
  // Trip's state reads identically wherever it appears.
  const chip = tripChip(otherTrip, Date.now())

  // `Confirm.Action` is `DialogPrimitive.Close` underneath (Radix's own
  // `AlertDialogAction`), so clicking it already triggers `onClose` through
  // `onOpenChange` — calling it again here would close twice. Only the emit
  // is this handler's job.
  function confirmRemove() {
    emit(tripEntryRemoved(otherTripId, entryId))
  }

  return (
    <Confirm
      variant="sheet"
      title={`Remove from ${name}?`}
      description={
        // Two `<span>`s, not two `<p>`s: `AlertDialog.Description` is itself
        // a `<p>` (Radix's `Primitive.p`), and a `<p>` cannot nest another.
        // The body carries no class of its own — `.descriptionSheet` already
        // gives it the right quiet, non-attention treatment, and `.context`'s
        // own `display: block` is what forces the line break after it.
        <>
          <span>
            {gearName} comes off the {name} gear list. The gear itself does not
            move.
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
              Remove entry
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
