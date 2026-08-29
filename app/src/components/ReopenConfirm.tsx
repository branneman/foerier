import {
  phaseName,
  tripLabel,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { Confirm } from '@foerier/ui'

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
 * What ships is the board's title and its second line, both true today and
 * true afterwards. The two mono blocks under them belong to other slices:
 * `1 ENTRY STILL OPEN — HEADLAMP, K · ▲ LOST` needs **S10**'s outcomes, and
 * the over-claim block needs **S7**'s Entries; architecture §8.3 gives
 * **S11** the reopen clause that fills the body from them. Neither block is
 * faked and neither is stubbed — an empty body states nothing false, while a
 * hard-coded count would.
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
  return (
    <Confirm
      // `tripLabel` is the one place a Trip's name is decided, so a Trip whose
      // `trip.created` has not arrived reads `Reopen —?` rather than
      // `Reopen ?`.
      title={`Reopen ${tripLabel(trip)}?`}
      description={`It returns to ${phaseName(to)} exactly as it stood. Closing cleared nothing.`}
      onClose={onCancel}
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
              onClick={onConfirm}
            >
              Reopen
            </button>
          </Confirm.Action>
        </>
      }
    />
  )
}
