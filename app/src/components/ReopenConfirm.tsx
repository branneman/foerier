import {
  overClaimsIfActive,
  phaseName,
  tripEntryBringCountSet,
  tripEntryRemoved,
  tripLabel,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { Confirm } from '@foerier/ui'
import { useState } from 'react'

import { useDepot } from '../depot/store'
import { ConflictRows, overClaimGroups } from './OverClaimBand'
import { RemoveElsewhereConfirm } from './RemoveElsewhereConfirm'
import styles from './ReopenConfirm.module.css'

/**
 * **Reopening a closed Trip is a decision**, so it goes through `Confirm`
 * rather than `Sheet`: the scrim does not dismiss it, which is the right
 * default for the one backward move that makes settled history live again.
 *
 * The confirmation is S6's even though the boards draw it beside things S6
 * cannot produce. Invariant 19 is a **domain** rule — leaving `closed` is a
 * deliberate, confirmed act, the same weight as deleting a trip — and S6 is
 * the slice that makes leaving `closed` possible at all; shipping the move
 * without the confirm would leave an invariant violated for five slices
 * (spec §6.3).
 *
 * What ships now is the board's title, its second line, and — Task 14 — the
 * over-claim block. `1 ENTRY STILL OPEN — HEADLAMP, K · ▲ LOST` is the one
 * mono block still missing: it needs **S10**'s outcomes, and architecture
 * §8.3 gives **S11** the reopen clause that fills it in. Neither block is
 * faked and neither is stubbed — an empty body states nothing false, while a
 * hard-coded count would.
 *
 * **The over-claim block sits in `children`, above the body line**, exactly
 * where `ActivationConfirm` (`PhaseSheet.tsx`) puts its own — `Confirm`'s own
 * layout, title then `children` then `description`, and the house rule
 * `SignOutThisDeviceSheet` already set: a ▲ block states a condition, the
 * body line beneath it is reassurance, and the two are different registers.
 * The board's own mockup draws the still-open block (S10's, not this one)
 * *after* the body line, but `children` cannot render on both sides of
 * `description` — reusing the one slot every other `Confirm` attention block
 * already uses beats inventing a second one for this sheet alone.
 * `overClaimsIfActive` asks the same hypothetical `ActivationConfirm` does —
 * "what if `trip` were active right now" — computed here rather than
 * threaded through both callers (`PhaseSheet` and `Trips.tsx`), since this
 * component already reads the store for nothing else and neither caller
 * otherwise needs the answer.
 *
 * ## Its own module, because there are two surfaces and one sentence
 *
 * The SET PHASE sheet reaches it by tapping a row while the Trip is closed;
 * the Trips list reaches it by the `REOPEN` on a closed ledger row (spec
 * §4.1). Both draw the same decision, and a second copy of a confirmation is
 * how two copies of its copy drift apart — the argument `phaseName` already
 * makes one level down, where the *word* lives in the phase table rather than
 * at a screen.
 *
 * **The line names the phase the move goes to**, which is the one place this
 * departs from the board's drawn sentence. The board draws the reopen from a
 * closed ledger row, which targets `unpack` and reads *"It returns to Unpack
 * …"* — and from that surface the sentence is still word for word the board's,
 * because {@link to} is `unpack`. The sheet offers all four other rows, because
 * invariant 16 makes every move expressible in either direction and the boards'
 * own footnote says any row is tappable, so from *there* the copy generalises
 * rather than the behaviour narrowing.
 *
 * The primary stays **accent** rather than the attention colour a destructive
 * confirm carries: nothing was thrown away. The body says so.
 *
 * **`variant="sheet"`, not the card default** — the same mismatch Task 12
 * fixed in `RemoveElsewhereConfirm`, caught here on the same terms: the board
 * (`Screens B:868-892`) draws a bottom sheet with a grabber, and the card
 * variant's `.descriptionCard` draws the whole body in attention-amber mono,
 * which reads as a second alarm sitting under a block that may itself be
 * amber. `Confirm.Action` sits above `Confirm.Cancel` in the DOM — the boards'
 * own order, `Devices.tsx`'s settled comment: Radix gives initial focus to
 * `Cancel` wherever it sits, so this is a DOM-order decision, not a visual
 * one — and `.primary` grows `flex: 1` to match.
 */
export interface ReopenConfirmProps {
  trip: TripState
  /** The phase the Trip is being reopened into — never `closed`. */
  to: PhaseKey
  onCancel: () => void
  onConfirm: () => void
}

export function ReopenConfirm({
  trip,
  to,
  onCancel,
  onConfirm,
}: ReopenConfirmProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)

  // See `ActivationConfirm`'s own field of the same name (`PhaseSheet.tsx`).
  const [removingElsewhere, setRemovingElsewhere] = useState<{
    otherTripId: string
    entryId: string
  } | null>(null)

  const overClaims = overClaimsIfActive(state, trip.id)
  const groups = overClaimGroups(overClaims, trip.id, state)

  function handleRemoveHere(entryId: string) {
    emit(tripEntryRemoved(trip.id, entryId))
  }

  function handleBringFewer(entryId: string, count: number) {
    emit(tripEntryBringCountSet(trip.id, entryId, count))
  }

  function handleRemoveThere(otherTripId: string, entryId: string) {
    setRemovingElsewhere({ otherTripId, entryId })
  }

  return (
    <>
      <Confirm
        variant="sheet"
        // `tripLabel` is the one place a Trip's name is decided, so a Trip
        // whose `trip.created` has not arrived reads `Reopen —?` rather than
        // `Reopen ?`.
        title={`Reopen ${tripLabel(trip)}?`}
        description={`It returns to ${phaseName(to)} exactly as it stood. Closing cleared nothing.`}
        onClose={onCancel}
        actions={
          <>
            <Confirm.Action>
              <button
                type="button"
                className={styles['primary']}
                onClick={onConfirm}
              >
                Reopen
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
        {groups.map((group) => (
          <div key={group.line} className={styles['segment']}>
            <p
              className={styles['attention']}
              data-testid="over-claim-attention"
            >
              {group.line}
            </p>
            <ConflictRows
              tripId={trip.id}
              overClaims={group.overClaims}
              onRemoveHere={handleRemoveHere}
              onRemoveThere={handleRemoveThere}
              onBringFewer={handleBringFewer}
            />
          </div>
        ))}
      </Confirm>

      {removingElsewhere !== null && (
        <RemoveElsewhereConfirm
          otherTripId={removingElsewhere.otherTripId}
          entryId={removingElsewhere.entryId}
          onClose={() => setRemovingElsewhere(null)}
        />
      )}
    </>
  )
}
