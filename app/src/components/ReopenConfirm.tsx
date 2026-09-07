import {
  consumedReductions,
  ownedCountOf,
  isActivePhase,
  overClaimsIfActive,
  phaseName,
  tripNameOrUnnamed,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { Confirm } from '@foerier/ui'

import { useHousehold } from '../household/store'
import { OverClaimGroups, overClaimGroups } from './OverClaimBand'
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
 * **The over-claim block only asks the hypothetical when `to` is itself an
 * active phase** (Task 14 review F2). `overClaimsIfActive` answers "what if
 * `trip` were active right now", which is true of `pack_out`/`on_trip`/
 * `unpack` and false of `draft` — invariant 17, drafts overlap freely — so a
 * reopen into `draft` (every row out of `closed` is tappable, including
 * `DRAFT`) asked it anyway and could draw `▲ 1 entry is already claimed by
 * …` for a move that creates no conflict at all. `isActivePhase` is the named
 * predicate `shared/src/selectors/trip.ts` now carries beside `isActive`,
 * precisely so this screen's copy cannot re-derive `phaseRow(...)?.active`
 * on its own and drift from it.
 *
 * **The over-claim block sits in `children`, above the body line**, exactly
 * where `ActivationConfirm` puts its own — `Confirm`'s own layout, title
 * then `children` then `description`, and the house rule
 * `SignOutThisDeviceSheet` already set: a ▲ block states a condition, the
 * body line beneath it is reassurance, and the two are different registers.
 * The board's own mockup draws the still-open block (S10's, not this one)
 * *after* the body line, but `children` cannot render on both sides of
 * `description` — reusing the one slot every other `Confirm` attention block
 * already uses beats inventing a second one for this sheet alone.
 * `overClaimGroups` is what both callers ask, computed here rather than
 * threaded through both (`PhaseSheet` and `Trips.tsx`), since this component
 * already reads the store for nothing else and neither caller otherwise
 * needs the answer. `OverClaimGroups` (`OverClaimBand.tsx`) is the one place
 * that pairs a line with its rows, so this sheet and `ActivationConfirm`
 * draw the identical block rather than each carrying its own copy of the
 * loop.
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
 * **The body's second sentence is true of the Trip and was misleading about
 * the Depot, so a Trip that owes one gains a third** (finding I2). *"Closing
 * cleared nothing"* is exactly right about the gear list — reopening returns
 * every Entry, every outcome and every Piece as they stood. It is not right
 * about the **owned counts**: closing applied each `consumed` Entry's
 * reduction (`closeTrip`, `gestures.ts`), and reopening does not offer that
 * back. Worse, closing a second time recomputes the reduction from the
 * already-reduced count and subtracts it again — `close → reopen → close` is
 * four taps on one Device, and it is tracked in `docs/technical-debt.md`
 * rather than fixed here, because telling *"the reduction never landed"*
 * apart from *"it landed and this fold reflects it"* needs a register outside
 * S10's op catalogue (ruling R28). Until then the honest thing is to say so
 * before the tap. `consumedReductions` (`selectors/unpack.ts`) is what
 * `closeTrip` itself sums, asked here for nothing but *is it empty* — never
 * re-derived from `outcomeOf` and a Kind check, which would state the
 * sentence on Trips whose close owes the Depot nothing (a container, a
 * Single, an unsynced Gear).
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
 *
 * **This sheet carries no settle routes** (amendment ruling I), for the same
 * reason `ActivationConfirm` does not: a control that emits inside a
 * cancellable confirm makes `Cancel` state something false. It passes
 * `OverClaimGroups` no `settle`, so the block is facts-only — the attention
 * line and the conflict rows — and the standing band on the trip screen is
 * the only surface that settles. `RemoveElsewhereConfirm` is no longer
 * mounted from here at all.
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
  const state = useHousehold((depot) => depot.state)

  const overClaims = isActivePhase(to) ? overClaimsIfActive(state, trip.id) : []
  const groups = overClaimGroups(overClaims, trip.id, state)

  // Finding I2 — see this module's own docblock. Empty on every Trip whose
  // close owes the Depot nothing, which is most of them.
  //
  // **Unreachable from the shipped UI as of the reopen gate, and kept
  // deliberately.** `reopenBlocked` (`gestures.ts`) withholds both doors out
  // of `closed` on exactly the Trips this block renders for — the gate and
  // this line ask the identical `consumedReductions`, so the sets are the
  // same set — which means no tap can currently open this sheet on a Trip
  // with a reduction to disclose. It stays because deleting it would
  // overturn ruling G1 in code rather than at a design round, and because
  // S11's whole job is to make a re-close subtract nothing twice and hand
  // the route back, at which point this block is the disclosure again with
  // no work to redo. Recorded in `docs/design/README.md` §5j.
  //
  // **§5i G1 moved this from prose into a fact.** The disclosure stays; its
  // register changes. `ReopenConfirm` already has a place for facts that
  // hold on *this* Trip alone — the conditional mono blocks under the body
  // — and a sentence true of some Trips belongs there rather than in body
  // prose that reads as though it were always so.
  //
  // **The `×6` is a reconstruction, not a record.** The close wrote
  // `gear.owned_count_set` absolutely, so the fold holds the reduced count
  // and nothing else; the pre-close number is `owned + consumed`, read now.
  // A Quartermaster who corrected the count by hand *since* the close makes
  // that arithmetic state a number that was never on the shelf. There is no
  // register that would answer better — the pre-close value exists only in
  // the log — and the reduction it describes is what the sheet is there to
  // disclose, so it is stated and this comment is the caveat.
  const reductions = consumedReductions(trip, state)

  // One entry per Gear the close reduced, in the Depot's own name order so
  // two Trips' sheets read alike. `owned` is the count **now**, already
  // reduced; the arrow's left-hand side is that plus what was consumed.
  const reductionLines = [...reductions]
    .flatMap(([gearId, consumed]) => {
      const gear = state.gear[gearId]
      if (gear === undefined) return []
      const owned = ownedCountOf(gear)
      if (owned === null) return []
      const name = gear.name?.value ?? ''
      return [`${name.toUpperCase()} ×${owned + consumed} → ×${owned}`]
    })
    .sort()

  return (
    <Confirm
      variant="sheet"
      // Fix round F4: `tripLabel`'s bare `—` is right in a list column and
      // wrong in a sentence — the rule `ActivationConfirm` and
      // `RemoveElsewhereConfirm` both already follow. `tripNameOrUnnamed`
      // is the one substitution (`depot/trips.ts`), so a Trip whose
      // `trip.created` has not yet arrived reads `Reopen Unnamed trip?`
      // rather than `Reopen —?`.
      title={`Reopen ${tripNameOrUnnamed(trip)}?`}
      // The body is the board's, verbatim, and stays true: the close
      // *wrote*, it cleared nothing.
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
      {reductionLines.length > 0 && (
        <p className={styles['reduction']} data-testid="reopen-reduction">
          {`OWNED COUNTS LOWERED AT CLOSE STAY LOWERED — ${reductionLines.join(' · ')}`}
        </p>
      )}

      {/* Facts only — no `settle` (ruling I). */}
      <OverClaimGroups tripId={trip.id} groups={groups} />
    </Confirm>
  )
}
