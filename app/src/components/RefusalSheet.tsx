import { Sheet } from '@foerier/ui'

import { refusalCause, type Refusal } from '../household/refusal'
import { useHousehold } from '../household/store'
import styles from './RefusalSheet.module.css'

/**
 * **What this Device could not save** (`docs/design/README.md` §5n K24b).
 *
 * ## A `Sheet`, not a `Confirm`
 *
 * Nothing is being decided. The sheet states what was lost and offers the one
 * act that applies, which is closing it — `Confirm` would put a decision's
 * ceremony around a fact, and its `Cancel` would name a choice the reader does
 * not have.
 *
 * ## No `Try again`, and that is the honest half
 *
 * The refused payload is **not kept**: `emit` authors an op, offers it to the
 * log, and lets it go. A retry button would be a door to a room that no
 * longer exists — it could only re-run a gesture whose inputs are gone, or
 * lie. The note says the recovery instead, in the reader's own terms: *do it
 * again to record it.*
 *
 * ## The marker clears on `Close`
 *
 * Acknowledgement is the clearing act. A marker that cleared itself — on a
 * timer, or on the next accepted write, which is what the store used to do —
 * would be a fact nobody read, which is the whole defect this surface exists
 * to close.
 *
 * ## One line per refusal, and a batch is one line
 *
 * `emitAll` refuses a gesture **whole**, so a fourteen-op close is one thing
 * the Quartermaster did and one line here — naming the act, not the ops. The
 * count rides that line (`— 14 OPS, NONE SAVED`) so the line never
 * understates what went down with it.
 */

export interface RefusalSheetProps {
  onClose: () => void
}

/** `14:32` in the reader's own zone — `format.ts`'s rule, to the minute. */
function atMinute(at: number): string {
  const when = new Date(at)
  return `${String(when.getHours()).padStart(2, '0')}:${String(
    when.getMinutes(),
  ).padStart(2, '0')}`
}

/**
 * `1 WRITE REFUSED · 14:32`. The count is always drawn, `1` included (§5b M),
 * and the time is the **latest** refusal's: the fact line answers *what just
 * happened*, and each line below carries its own subject.
 */
function factLine(refusals: readonly Refusal[]): string {
  const latest = refusals[refusals.length - 1]
  const noun = refusals.length === 1 ? 'WRITE' : 'WRITES'
  const when = latest === undefined ? '' : ` · ${atMinute(latest.at)}`
  return `${refusals.length} ${noun} REFUSED${when}`
}

/** `GAS CANISTER 450 — TOO LARGE TO SAVE`, or a gesture's own one-liner. */
function refusalLine(refusal: Refusal): string {
  const cause =
    refusal.ops > 1
      ? `${refusal.ops} OPS, NONE SAVED`
      : refusalCause(refusal.reason)
  return `${refusal.subject.toUpperCase()} — ${cause}`
}

export function RefusalSheet({ onClose }: RefusalSheetProps) {
  const refusals = useHousehold((depot) => depot.refusals)
  const acknowledge = useHousehold((depot) => depot.acknowledgeRefusals)

  function close() {
    acknowledge()
    onClose()
  }

  return (
    <Sheet
      title="Not saved"
      onClose={close}
      description={<p className={styles['fact']}>{factLine(refusals)}</p>}
    >
      {/* H9's two registers: the answer in ink, the explainer muted. */}
      <p className={styles['answer']}>
        This device could not save it. Nothing was sent to the household.
      </p>
      <p className={styles['note']}>Do it again to record it.</p>

      <ul className={styles['lines']}>
        {refusals.map((refusal) => (
          <li key={refusal.id} className={styles['line']}>
            {refusalLine(refusal)}
          </li>
        ))}
      </ul>

      {/* Ghost, and the only control: see the header on why there is no
          `Try again` beside it. */}
      <Sheet.Close>
        <button type="button" className={styles['close']}>
          Close
        </button>
      </Sheet.Close>
    </Sheet>
  )
}
