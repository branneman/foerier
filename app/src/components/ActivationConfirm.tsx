import {
  phaseName,
  tripNameOrUnnamed,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { Confirm } from '@foerier/ui'

import styles from './ActivationConfirm.module.css'
import { OverClaimGroups, type OverClaimGroup } from './OverClaimBand'

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
 * **This sheet carries no settle routes at all** (amendment ruling I). It
 * renders the conflict block facts-only — attention line and conflict rows —
 * by passing `OverClaimGroups` no `settle`, and the whole row of routes is
 * absent rather than disabled: a disabled control would still state that the
 * action belongs here, and it does not.
 *
 * The reason is the one S7 recorded and did not fix. `REMOVE HERE` and
 * `BRING ×N HERE` write the moment they are tapped, so tapping one and then
 * this sheet's own `Cancel` left the Entry gone — or the Bring-count lowered
 * — while the phase never moved. **A control that emits inside a cancellable
 * confirm makes `Cancel` state something false.** The tag-chip rule (one op,
 * no confirm, re-adding is two taps) holds for the standing band these routes
 * were built for; it never extended to a route drawn *inside* a decision the
 * Quartermaster can still back out of.
 *
 * Two things fall out of the routes leaving. `RemoveElsewhereConfirm` is no
 * longer mounted here, which retires the whole three-overlay problem Task 14
 * review F4 worked around: `REMOVE ON <trip>` reached from `PhaseSheet`'s own
 * `Sheet` used to stack three Radix overlays — three compounding 62%-alpha
 * scrims, ≈94.5% dim where the board draws one, and two pixel-identical
 * bottom sheets with no offset, so a reader could not tell a second had
 * opened. And the standing band on the trip screen is now **the only surface
 * that settles**, which is what this sheet's body says in as many words.
 */
export interface ActivationConfirmProps {
  readonly trip: TripState
  /**
   * The phase this would move to. Ruling J widened the preview from
   * `draft → pack_out` alone to any transition entering Active, so the sheet
   * can no longer assume which phase it is naming.
   */
  readonly to: PhaseKey
  readonly groups: readonly OverClaimGroup[]
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function ActivationConfirm({
  trip,
  to,
  groups,
  onCancel,
  onConfirm,
}: ActivationConfirmProps) {
  return (
    <Confirm
      variant="sheet"
      title={`${activationVerb(to)} — ${tripNameOrUnnamed(trip)}?`}
      description="Starting warns, never blocks. Nothing changes here — the settle routes are on the trip screen."
      onClose={onCancel}
      actions={
        <>
          <Confirm.Action>
            <button
              type="button"
              className={styles['primary']}
              onClick={onConfirm}
            >
              {activationVerb(to)}
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
      {/* Facts only — no `settle` (ruling I). */}
      <OverClaimGroups tripId={trip.id} groups={groups} />
    </Confirm>
  )
}

/**
 * How a transition into `to` is named, in the title and on the primary alike —
 * one function so the two can never drift, and the sheet never asks a reader
 * to confirm one phrase by pressing another.
 *
 * Ruling J: the name comes from **the phase row's own `name` field**, with no
 * casing transform — the same rule the reopen body follows. `pack_out` is the
 * one exception, and it is drawn rather than reasoned: the boards render
 * `Start pack-out — Vosges?`, including on the frame this very round redrew
 * for ruling I, so the established phrase stands where a board still draws it.
 * Everything else takes `phaseName` as written: `On trip — Vosges?`,
 * `Unpack — Vosges?`.
 */
function activationVerb(to: PhaseKey): string {
  return to === 'pack_out' ? 'Start pack-out' : phaseName(to)
}
