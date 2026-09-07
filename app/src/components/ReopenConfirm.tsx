import {
  consumedReductions,
  ownedCountOf,
  isActivePhase,
  overClaimsIfActive,
  personNameOrUnnamed,
  phaseName,
  standingLostOf,
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
 * What ships is the board's title, its second line, and three conditional
 * blocks stacked inside `children`, in one order (spec §6): the
 * `STILL UNACCOUNTED` block (what about this Trip is still unsettled), G1's
 * reduction lines (what the close did), then the facts-only over-claim block
 * (what reopening would collide with) — this Trip's own history first, the
 * world outside it last. None of the three is faked or stubbed — each is
 * absent entirely rather than drawn empty (G3), so an empty body states
 * nothing false.
 *
 * **`STILL UNACCOUNTED`, not the board's drawn `1 ENTRY STILL OPEN`.** Spec
 * §6 argues the wording at length: a properly closed Trip has zero *open*
 * outcomes (invariant 18 is what the close is gated on) and a `lost` Entry
 * is *resolved*, not open — the drawn `▲ LOST` cannot be produced by an open
 * count. The block states what the reason a Quartermaster reopens actually
 * is: the tent that turned up.
 *
 * **{@link standingLostOf}, not `unaccountedOf`.** `unaccountedOf` is keyed
 * by Gear across the whole household and names the *latest* Trip holding a
 * live `lost` outcome for it — reading it from inside this Trip's own sheet
 * could name a *different* Trip as the one still holding the standing, a
 * false statement on a screen that is about to say "this Trip".
 * `standingLostOf` (`selectors/unpack.ts`) answers the narrower question
 * this sheet actually asks — of what **this Trip** recorded, what is still
 * open — gathering its candidates from this Trip's own Entries while still
 * reading the household-wide settle (`outcomeStands`) to decide whether each
 * one still stands; its own docblock argues the split in full.
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
  // close owes the Depot nothing, which is most of them. Reachable for the
  // first time as of S11 (spec §5.1): every closed Trip may reopen, so
  // every Trip this block renders for can actually reach this sheet.
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
  //
  // **Its sibling (spec §5.2): a Trip closed before this register existed
  // reads a back-filled reconstruction, never a gap.** `reopenTrip`
  // (`gestures.ts`) back-fills a posting from `consumedReductions` computed
  // *now*, for the identical reason the `×6` above is one — ruling G6 makes
  // F5's outcomes frozen on a closed Trip, so recomputing the reduction
  // after the fact is a reconstruction from a fact that cannot have moved,
  // not a guess. What that reconstruction cannot see is a peer on a
  // **pre-gate** build (S10-era) that reopened and reclosed this Trip
  // outside either build's view (spec §5.3) — recorded in
  // `docs/technical-debt.md`, not fixed here.
  const reductions = consumedReductions(trip, state)

  // **S11's last mono block (spec §6).** `standingLostOf` — never
  // `unaccountedOf`, see this module's own docblock — gathers this Trip's
  // own Entries and Pieces whose `lost` outcome still stands. The count is
  // units, matching every other count on this sheet (G3: absent at zero);
  // each line's `▲ LOST` is constant across every candidate — the selector
  // only ever returns `lost` standings — so it is stated once per line, not
  // deduplicated to the block's end, mirroring `reductionLines`' own
  // self-contained-segment shape below. The comma divides the gear name
  // from the Person inside one segment; a Person renders through
  // `personNameOrUnnamed` (§5c's split — `—` is right in a list column,
  // wrong in a sentence).
  const standingLost = standingLostOf(trip, state)
  const unaccountedUnits = standingLost.reduce(
    (total, item) => total + item.units,
    0,
  )
  const unaccountedLines = standingLost
    .map((item) => {
      const person =
        item.personId === null
          ? ''
          : `, ${personNameOrUnnamed(state, item.personId)}`
      return `${item.gearName.toUpperCase()}${person} · ▲ LOST`
    })
    .sort()

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
      {unaccountedLines.length > 0 && (
        <p className={styles['unaccounted']} data-testid="reopen-unaccounted">
          {`${unaccountedUnits} STILL UNACCOUNTED — ${unaccountedLines.join(' · ')}`}
        </p>
      )}

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
