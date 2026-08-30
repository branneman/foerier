import {
  entryLabel,
  tripEntryRemoved,
  tripLabel,
  UNNAMED_TRIP,
} from '@foerier/shared'
import { Confirm } from '@foerier/ui'

import { useDepot } from '../depot/store'
import { tripChip } from '../depot/trips'
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
 * **An unnamed other Trip reads `Unnamed trip`** in the title and body —
 * `tripLabel`'s `—` is right in a list column and wrong in a sentence, the
 * same split `UNNAMED_PERSON`/`UNNAMED_TRIP` carry throughout `OverClaimBand`
 * (spec §4.5).
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
  // Unreachable from `OverClaimBand`'s own `REMOVE ON` route — an `OverClaim`
  // only ever names a Trip and an Entry both already in this replica's fold —
  // but the type is `TripState | undefined`, and rendering nothing beats
  // stating facts about data that is not there.
  if (otherTrip === undefined) return null

  const entry = otherTrip.entries?.[entryId]
  const gearName = entry === undefined ? '' : entryLabel(entry, state)
  const label = tripLabel(otherTrip)
  const name = label === '—' ? UNNAMED_TRIP : label
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
      title={`Remove from ${name}?`}
      description={
        // Two `<span>`s, not two `<p>`s: `AlertDialog.Description` is itself
        // a `<p>` (Radix's `Primitive.p`), and a `<p>` cannot nest another.
        <>
          <span className={styles['body']}>
            {gearName} comes off the {name} gear list. The gear itself does not
            move.
          </span>
          <span
            className={styles['context']}
            data-testid="remove-elsewhere-context"
          >
            ▸ {name} · {chip}
          </span>
        </>
      }
      onClose={onClose}
      actions={
        <>
          <Confirm.Cancel>
            <button type="button" className={styles['ghost']}>
              Cancel
            </button>
          </Confirm.Cancel>
          <Confirm.Action>
            <button
              type="button"
              className={styles['primary']}
              onClick={confirmRemove}
            >
              Remove entry
            </button>
          </Confirm.Action>
        </>
      }
    />
  )
}
