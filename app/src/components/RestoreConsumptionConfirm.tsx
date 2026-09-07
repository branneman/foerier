import {
  ownedCountOf,
  postedOf,
  tripNameOrUnnamed,
  type TripState,
} from '@foerier/shared'
import { Confirm } from '@foerier/ui'

import { useHousehold } from '../household/store'
import styles from './RestoreConsumptionConfirm.module.css'

/**
 * **The restoration offer** (spec §3) — the confirm `OutcomeSheet` raises
 * the moment an outcome change it just emitted makes `owed < posted` for a
 * Gear. Built on `ui/`'s `Confirm`, modelled on {@link ReopenConfirm}'s own
 * shape: `variant="sheet"`, mounted **is** open (no `open` prop),
 * `Confirm.Action` above `Confirm.Cancel` in the DOM (Radix gives initial
 * focus to `Cancel` wherever it sits, so this is a DOM-order decision, not a
 * visual one), and `.primary` grown `flex: 1` to match.
 *
 * **It is a `Confirm`, not a `Sheet` — ruling G15.** *"The confirm is owed
 * where the act cannot be seen on the screen that made it"* — the Depot's
 * owned count is not on F5, so restoring it needs a moment that states the
 * consequence before it happens, the same weight `ReopenConfirm` gives
 * leaving `closed`. The primary stays **accent**, not the attention colour a
 * destructive confirm carries: nothing is thrown away here either, a count
 * is being given back.
 *
 * **`Leave it` is truthful because the outcome change already stands.** The
 * caller (`OutcomeSheet`'s `choose` / `handleConsumedChange`) emits the
 * outcome or Consumed-count op *before* raising this offer — spec §3's own
 * ordering — so declining changes nothing about what was just recorded. The
 * posting is not lowered either way: G1's `OWNED COUNTS LOWERED AT CLOSE
 * STAY LOWERED` is the default this confirm's `Cancel` falls back to, and a
 * later re-raise of the Consumed-count posts only the difference (spec §3).
 *
 * **The target is read fresh from the fold, never derived from {@link
 * RestoreConsumptionConfirmProps.owed} alone.** `owed` is the caller's own
 * read of the change it just made — this component reads {@link postedOf}
 * and the Gear's *current* owned count itself, so a hand-correction to the
 * Depot since the close is disclosed honestly rather than papered over by a
 * number computed before this offer mounted. `restoreConsumption`
 * (`gestures.ts`) performs the identical read at the moment `Put it back` is
 * actually taken, so the two can never disagree about what confirming will
 * do.
 *
 * **The fact line sits in `children`, above the body — `ReopenConfirm`'s own
 * precedent, not the board's drawn order.** `Confirm`'s layout is title,
 * `children`, then `description`, and `children` cannot render on both
 * sides of it — reusing the one slot every other `Confirm` attention block
 * already uses beats inventing a second one for this sheet alone.
 */
export interface RestoreConsumptionConfirmProps {
  trip: TripState
  gearId: string
  /** What this Gear's outcome now owes the Depot — the caller's own read,
   * taken *after* the change that triggered this offer. */
  owed: number
  onCancel: () => void
  onConfirm: () => void
}

export function RestoreConsumptionConfirm({
  trip,
  gearId,
  owed,
  onCancel,
  onConfirm,
}: RestoreConsumptionConfirmProps) {
  const state = useHousehold((depot) => depot.state)
  const gear = state.gear[gearId]
  const name = gear?.name?.value ?? ''
  const posted = postedOf(trip, gearId)
  const ownedNow = gear === undefined ? 0 : (ownedCountOf(gear) ?? 0)
  const delta = posted - owed
  const target = ownedNow + delta

  return (
    <Confirm
      variant="sheet"
      title={`Put ×${delta} back on ${name}?`}
      description={`${tripNameOrUnnamed(trip)} lowered the owned count when it closed. It goes back to what it was before that close.`}
      onClose={onCancel}
      actions={
        <>
          <Confirm.Action>
            <button
              type="button"
              className={styles['primary']}
              onClick={onConfirm}
            >
              Put it back
            </button>
          </Confirm.Action>
          <Confirm.Cancel>
            <button type="button" className={styles['ghost']}>
              Leave it
            </button>
          </Confirm.Cancel>
        </>
      }
    >
      <p className={styles['fact']}>
        {`${name.toUpperCase()} ×${ownedNow} → ×${target}`}
      </p>
    </Confirm>
  )
}
