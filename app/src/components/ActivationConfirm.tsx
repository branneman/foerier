import {
  tripEntryBringCountSet,
  tripEntryRemoved,
  type TripState,
} from '@foerier/shared'
import { Confirm } from '@foerier/ui'
import { useState } from 'react'

import { useDepot } from '../depot/store'
import { tripNameOrUnnamed } from '../depot/trips'
import styles from './ActivationConfirm.module.css'
import { OverClaimGroups, type OverClaimGroup } from './OverClaimBand'
import { RemoveElsewhereConfirm } from './RemoveElsewhereConfirm'

/**
 * **The `Start pack-out` preview** — spec §4.5's second sheet, `Screens
 * B:829-865`'s "Start pack-out — over-claim" frame. Its own module because
 * it now has two callers, `PhaseSheet` (the SET PHASE sheet's PACK-OUT row,
 * from a Draft) and `GearListBuilder` (the builder's own header/title-row
 * button, Split and up) — `ReopenConfirm`'s own rule: a second copy of a
 * confirmation is how two copies of its copy drift apart.
 *
 * **`groups` arrives pre-filtered, not raw `overClaims`.** Task 14's review
 * (F1) found that gating on the unfiltered `overClaimsIfActive` renders a
 * sheet with an attention line stating a count and no rows beneath it, for a
 * Draft that shares no Gear with the conflict at all —
 * `overClaimsIfActive` is deliberately not scoped to one Trip
 * (`OverClaimBand`'s own docstring), so **both** the decision to open this
 * sheet and the block it draws have to be asked of the same, already-filtered
 * `overClaimGroups(overClaimsIfActive(state, tripId), tripId, state)` — computed
 * once by the caller, exactly as `OverClaimBand` computes it to decide
 * whether to render at all.
 *
 * Anatomy is `Confirm`'s `SignOutThisDeviceSheet` shape: the ▲ block goes in
 * `children`, rendered between the title and `description`, which is exactly
 * "above the body" (spec's own words). `OverClaimGroups` (`OverClaimBand.tsx`)
 * is the one place that pairs a line with its rows, so the copy and the row
 * rules are read from one place rather than re-derived here.
 *
 * **The title reads `tripNameOrUnnamed`, not `tripLabel`.** `tripLabel`
 * returns the bare `—` glyph, which under this title's own `Start pack-out —
 * {name}?` template would draw `Start pack-out — —?` for a Trip with no name
 * yet — reachable the same way `RemoveElsewhereConfirm`'s nameless-Trip case
 * is, an Entry op arriving before its `trip.created`. `tripNameOrUnnamed` is
 * the one substitution this codebase already shares for exactly this
 * (`depot/trips.ts`).
 *
 * **The settle routes render as alternatives, not nested** (Task 14 review
 * F4). `REMOVE ON <trip>` used to mount `RemoveElsewhereConfirm` *inside*
 * this `Confirm`, which — reached from `PhaseSheet`'s own `Sheet` — stacked
 * three Radix overlays: three compounding 62%-alpha scrims (≈94.5% dim where
 * the board draws one), and two pixel-identical bottom sheets with no offset,
 * so a reader could not tell a second one had opened at all. Rendering
 * `removingElsewhere !== null ? <RemoveElsewhereConfirm …/> : <Confirm …/>`
 * keeps the nesting at two deep — the existing S6 precedent
 * (`PhaseSheet` → `ReopenConfirm`) — since the two dialogs are visually
 * identical bottom sheets and swapping one for the other reads as the same
 * sheet's own content changing, not as a new layer opening. `PhaseSheet`
 * still owns `activating`, so declining `RemoveElsewhereConfirm` (its
 * `onClose`) restores this sheet exactly where it was.
 *
 * **The settle routes emit immediately, inside a cancellable confirm.**
 * `REMOVE HERE`/`BRING ×N HERE` write the moment they're tapped, so tapping
 * one and then this sheet's own `Cancel` leaves the Entry gone (or the
 * bring-count lowered) while the phase itself never moves. The tag-chip rule
 * — one op, no confirm, re-adding is two taps — holds for the standing band
 * these routes were built for; it does not extend cleanly to a route drawn
 * *inside* a decision the Quartermaster can still back out of. Recorded
 * rather than fixed (Task 14 review, "record, do not build"): Story 36
 * (Undo) is `Later`, and a confirm nested inside this confirm is exactly the
 * kind of extra modal the boards never draw for a settle route.
 */
export interface ActivationConfirmProps {
  readonly trip: TripState
  readonly groups: readonly OverClaimGroup[]
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function ActivationConfirm({
  trip,
  groups,
  onCancel,
  onConfirm,
}: ActivationConfirmProps) {
  const emit = useDepot((depot) => depot.emit)

  // The Entry a `REMOVE ON <trip>` is waiting to confirm, and `null` when
  // nothing is — the same shape `Trip.tsx` keeps for its own standing band.
  const [removingElsewhere, setRemovingElsewhere] = useState<{
    otherTripId: string
    entryId: string
  } | null>(null)

  function handleRemoveHere(entryId: string) {
    emit(tripEntryRemoved(trip.id, entryId))
  }

  function handleBringFewer(entryId: string, count: number) {
    emit(tripEntryBringCountSet(trip.id, entryId, count))
  }

  function handleRemoveThere(otherTripId: string, entryId: string) {
    setRemovingElsewhere({ otherTripId, entryId })
  }

  // Alternatives, not nested (F4) — see this file's own docstring.
  //
  // Fix round F10. `RemoveElsewhereConfirm` returns `null` when its own
  // `otherTrip` or `entry` lookup misses, which would blank this whole
  // sheet while `removingElsewhere` stays set — the button that opened it
  // gone, with no way back. Unreachable at S7: `trip.entry_removed` sets
  // the `removed` register (`writeEntry` in `shared/reduce.ts`) and never
  // drops the key from `entries`, and no op deletes a Trip, so neither
  // lookup can miss for an `otherTripId`/`entryId` pair this sheet itself
  // just read off a live `OverClaim`. It would go live the day either
  // changes — a Trip-delete op, or an Entry actually pruned rather than
  // tombstoned.
  if (removingElsewhere !== null) {
    return (
      <RemoveElsewhereConfirm
        otherTripId={removingElsewhere.otherTripId}
        entryId={removingElsewhere.entryId}
        onClose={() => setRemovingElsewhere(null)}
      />
    )
  }

  return (
    <Confirm
      variant="sheet"
      title={`Start pack-out — ${tripNameOrUnnamed(trip)}?`}
      description="Starting warns, never blocks. Nothing is removed unless you choose it."
      onClose={onCancel}
      actions={
        <>
          <Confirm.Action>
            <button
              type="button"
              className={styles['primary']}
              onClick={onConfirm}
            >
              Start pack-out
            </button>
          </Confirm.Action>
          <Confirm.Cancel>
            <button type="button" className={styles['ghost']}>
              Cancel
            </button>
          </Confirm.Cancel>
        </>
      }
    >
      <OverClaimGroups
        tripId={trip.id}
        groups={groups}
        onRemoveHere={handleRemoveHere}
        onRemoveThere={handleRemoveThere}
        onBringFewer={handleBringFewer}
      />
    </Confirm>
  )
}
