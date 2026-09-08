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
 * **`Leave it lowered` is truthful because the outcome change already
 * stands.** The caller (`OutcomeSheet`'s `choose` / `handleConsumedChange`)
 * emits the outcome or Consumed-count op *before* raising this offer —
 * spec §3's own ordering — so declining changes nothing about what was just
 * recorded, and the ghost is a second verb rather than a `Cancel`. The
 * posting is not lowered either way: G1's `OWNED COUNTS LOWERED AT CLOSE
 * STAY LOWERED` is the default this confirm's ghost falls back to, and a
 * later re-raise of the Consumed-count posts only the difference (spec §3).
 *
 * **The target is read fresh from the fold, never derived from {@link
 * RestoreConsumptionConfirmProps.owed} alone.** `owed` is the caller's own
 * read of the change it just made — this component reads {@link postedOf}
 * and the Gear's *current* owned count itself, so a hand-correction to the
 * Depot since the close is disclosed honestly rather than papered over by a
 * number computed before this offer mounted. `restoreConsumption`
 * (`gestures.ts`) performs the identical read at the moment the offer is
 * actually taken, so the two can never disagree about what confirming will
 * do.
 *
 * **The fact line sits in `children`, above the body**, which ruling H3
 * blessed as `Confirm`'s one shape — title → facts → answer — and which the
 * S11 round board §01 draws for this sheet. The body takes default ink (H9)
 * and there is no `note`: the general promise this offer keeps — *a count
 * corrected by hand is never rewritten* — is stated once, on the reopen
 * sheet's own explainer, and is not repeated here.
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
      // **Act, then the object** — 02B's title shape, and the number rides
      // in the title as it rides in the button (ruling H4).
      title={`Put ×${delta} back — ${name}?`}
      // **The body states the arithmetic it does** (ruling H5). Its first
      // draft read *"It goes back to what it was before that close"*, which
      // is false the moment a hand correction sits between the close and
      // this offer — and that case is story 11's whole reason for making
      // this a question rather than an automatic write. Two sentences: what
      // happened, then what confirming does. `posted` is what the close
      // took; `delta` is what this hands back, and the two differ whenever
      // the change was a *lowered* Consumed-count rather than an outcome
      // leaving `consumed` altogether.
      description={`Closing ${tripNameOrUnnamed(trip)} took ×${posted} off the owned count. Putting them back adds ×${delta} to the count as it stands.`}
      onClose={onCancel}
      actions={
        <>
          <Confirm.Action>
            <button
              type="button"
              className={styles['primary']}
              onClick={onConfirm}
            >
              {`Put ×${delta} back`}
            </button>
          </Confirm.Action>
          <Confirm.Cancel>
            {/* `Leave it lowered`, not `Cancel` — nothing here is
                cancelled, the outcome op is already written, and the word
                names what declining leaves behind: the count stays down and
                G1's line on the reopen sheet keeps saying so. */}
            <button type="button" className={styles['ghost']}>
              Leave it lowered
            </button>
          </Confirm.Cancel>
        </>
      }
    >
      {/* F9's own line run the other way — that sheet states `OWNED ×6 → ×2
          AT CLOSE`, this one states the count as it stands going back up. */}
      <p className={styles['fact']}>
        {`${name.toUpperCase()} · OWNED ×${ownedNow} → ×${target}`}
      </p>
    </Confirm>
  )
}
