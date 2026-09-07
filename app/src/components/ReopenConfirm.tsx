import {
  consumedReductions,
  ownedCountOf,
  isActivePhase,
  postedOf,
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
 * back — that is a separate route, not this one. A re-close is free
 * regardless of how many times a Trip is reopened and closed: `closeTrip`
 * reads what this Trip has already posted (`postedOf`, `selectors/unpack.ts`)
 * and only ever applies the positive remainder, `delta = owed − posted`
 * (spec §2.3), so a second close after a reopen writes nothing further to
 * the Depot. Handing the units back is `restoreConsumption`'s job (spec
 * §3) — the offer `OutcomeSheet` raises the moment an outcome change makes
 * `owed < posted`, never this confirm and never the reopen itself.
 * **The disclosure block reads {@link postedOf}, not `consumedReductions`,
 * wherever the register exists.** What the line claims is what the close
 * *applied*, and that is precisely what the posting register records (spec
 * §2.1); `consumedReductions` answers what the Trip currently *owes*, which
 * a declined restoration or a lowered Consumed-count moves away from it.
 * `consumedReductions` stays as the fallback for a Trip closed before that
 * register existed — the same *register when present, reconstruction when
 * absent* rule `reopenTrip` applies — and is still never re-derived from
 * `outcomeOf` and a Kind check, which would state the fact on Trips whose
 * close owes the Depot nothing (a container, a Single, an unsynced Gear).
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
  // **The number is the register when there is one, and a reconstruction
  // only when there is not** — the identical rule `reopenTrip`'s own
  // back-fill applies (spec §5.2), and for the identical reason: presence,
  // never value. `postedOf` is *"the running total this Trip has posted
  // against that Gear's owned count"* (spec §2.1) — what the close actually
  // applied — so it is the answer to the question this line asks. Two ways
  // it beats `consumedReductions`, both reachable in four taps:
  //
  // - **A declined offer empties the reconstruction and not the fact.**
  //   Reopen, move an outcome off `consumed`, decline the restoration
  //   (G1's own default — counts stay lowered), re-close: `owed` is now `0`
  //   and `consumedReductions` is empty, so the block *disappeared* on the
  //   very Trip where it is most true. The posting is still ×2.
  // - **A partly-lowered Consumed-count under-states the arrow.** `owed`
  //   ×2 against a posting of ×4 drew an arrow two units wide for a count
  //   the Depot is four short of.
  //
  // A posting present at `0` is a Gear whose units have already been handed
  // back (spec §3), so it owes no line at all — which falls out of the
  // filter below rather than needing a clause of its own.
  //
  // **The fallback is still a reconstruction, and still carries its
  // caveat.** A Trip closed by a pre-S11 build has no `postings` register
  // at render time — `reopenTrip` back-fills one, but only *after* this
  // confirm is accepted — so those Gears read `consumedReductions`
  // computed now, legitimate because ruling G6 freezes a closed Trip's
  // outcomes and false the moment a peer on another build changes one
  // anyway (spec §5.3, recorded in `docs/technical-debt.md`).
  //
  // The arrow's right-hand side is the count **now**, from the fold; its
  // left-hand side is that plus what this Trip lowered it by. A
  // Quartermaster who corrected the count by hand since the close makes
  // that sum state a number that was never on the shelf — unavoidable on
  // either path, since the pre-close value exists only in the log.
  const lowered = new Map<string, number>()
  for (const gearId of Object.keys(trip.postings ?? {})) {
    lowered.set(gearId, postedOf(trip, gearId))
  }
  for (const [gearId, owed] of consumedReductions(trip, state)) {
    if (!lowered.has(gearId)) lowered.set(gearId, owed)
  }

  // **S11's last mono block (spec §6).** `standingLostOf` — never
  // `unaccountedOf`, see this module's own docblock — gathers this Trip's
  // own Entries and Pieces whose `lost` outcome still stands. The count is
  // units, matching every other count on this sheet (G3: absent at zero).
  // The comma divides the gear name from the Person **inside** one segment
  // (`HEADLAMP, K`); `·` divides segments, so multiple items are joined by
  // `·` and `▲ LOST` is stated **once**, trailing the whole block, rather
  // than once per item — `standingLostOf` only ever returns `lost`
  // standings, so the mark is a property of the block, not of each row, and
  // repeating it per item would flatten the grammar's two levels (a reviewed
  // finding: joining whole `NAME · ▲ LOST` segments with the same `·` used
  // between items gives a reader no way to see where one item ends and the
  // next begins). A single item therefore reads identically to before —
  // `1 STILL UNACCOUNTED — HEADLAMP, K · ▲ LOST` — because one name joined
  // with nothing is just that name, and the trailing `▲ LOST` still applies.
  const standingLost = standingLostOf(trip, state)
  const unaccountedUnits = standingLost.reduce(
    (total, item) => total + item.units,
    0,
  )
  const unaccountedNames = standingLost
    .map((item) => {
      const person =
        item.personId === null
          ? ''
          : `, ${personNameOrUnnamed(state, item.personId)}`
      return `${item.gearName.toUpperCase()}${person}`
    })
    .sort()

  // One entry per Gear this Trip's close lowered, in the Depot's own name
  // order so two Trips' sheets read alike.
  const reductionLines = [...lowered]
    .flatMap(([gearId, units]) => {
      if (units <= 0) return []
      const gear = state.gear[gearId]
      if (gear === undefined) return []
      const owned = ownedCountOf(gear)
      if (owned === null) return []
      const name = gear.name?.value ?? ''
      return [`${name.toUpperCase()} ×${owned + units} → ×${owned}`]
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
      {unaccountedNames.length > 0 && (
        <p className={styles['unaccounted']} data-testid="reopen-unaccounted">
          {`${unaccountedUnits} STILL UNACCOUNTED — ${[...unaccountedNames, '▲ LOST'].join(' · ')}`}
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
