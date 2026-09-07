import {
  gearOwnedCountSet,
  gearRehomed,
  tripOutcomeSet,
  tripPhaseMoved,
  type OpSpec,
} from './authoring.ts'
import { ownedCountOf } from './selectors/depot.ts'
import { entryKind, isContainerEntry } from './selectors/entry.ts'
import { piecesOf } from './selectors/piece.ts'
import { isClosed, type PhaseKey } from './selectors/trip.ts'
import {
  consumedReductions,
  outcomeOf,
  pieceOutcomeOf,
  unpackTotals,
} from './selectors/unpack.ts'
import type {
  EntryState,
  HouseholdState,
  Residence,
  TripState,
} from './state.ts'

/**
 * **Cross-aggregate gestures** — beside `authoring.ts`, not inside it.
 *
 * `authoring.ts` is deliberately a shelf of **pure payload constructors**: it
 * takes no `HouseholdState` and reads no fold, so the same builder call
 * always produces the same payload. A gesture is a different kind of thing —
 * several of those builders composed with a *read* of the fold, deciding
 * which ops a single user action should emit and in what order. That read is
 * exactly what `authoring.ts` refuses to do, so the composition belongs one
 * file over rather than being inlined at a screen.
 *
 * [Sync §4.5](../../docs/sync-protocol.md) names three gestures that cross an
 * aggregate boundary; two are S10's, and this module is those two.
 * `closeTrip` has **two callers** — F5's close card and `PhaseSheet`'s
 * `CLOSED` row at `open = 0` — which is exactly the two-surfaces-must-not-
 * drift risk this codebase keeps answering the same way (`packing.ts`'s
 * `sameTripResidence`, `claim.ts`'s gate, `phaseOf`'s table): spell the
 * composition once here, call it twice, and a screen can never emit half of
 * it. `reHomeOnTheSpot` has **one** — F5's row alone. Gear detail's `RESOLVE`
 * (F16(3)'s settle route) was drawn as a second caller and then corrected
 * (ruling R30): the standing it settles is a *selector reading an outcome*
 * (`unaccountedOf`, `unpack.ts`), never a stored fact, so ending it by
 * rewriting the very outcome the selector reads is fixing the thermometer,
 * not the temperature — and doing so from a Depot screen with no reopen
 * touches a **closed** Trip's history in violation of invariant 19. RESOLVE
 * emits a bare `gear.rehomed`; `GearDetail.tsx` carries the reasoning.
 *
 * **`reopenTrip` is a third function here and is not one of sync §4.5's
 * three.** It writes a single op on a single aggregate, so it is no
 * cross-aggregate *write* — but deciding *whether* to emit it means reading
 * the Gear aggregate (`consumedReductions` → `ownedCountOf`'s own subject),
 * which is the property that keeps it out of `authoring.ts` and puts it
 * here: this file is where an op's payload stops being a pure function of
 * its arguments. It is the symmetric door to {@link closeTrip}, and the two
 * belong beside each other for the reason {@link reopenBlocked} spells out.
 */

/**
 * **Re-home on the spot** (spec §1.5, §4.6) — the gesture behind F5's row
 * body alone: picking a home for gear that is back from a Trip marks it back
 * *and* writes where it now lives, in one user action across two aggregates
 * (Trip and Gear) — invariant 8's two writes.
 *
 * **Two rules, pulling in opposite directions, and both matter:**
 *
 * - **An outcome already `back` gets no `trip.outcome_set`.** A needless
 *   write moves the stamp last-writer-wins compares, so it could beat — and
 *   silently discard — a genuine concurrent write from a Device that was
 *   offline (this codebase's standing rule, `patterns.md` §2.3). Re-homing
 *   something already resolved `consumed` or `lost` still emits the outcome
 *   write, because it is genuinely *becoming* `back` — only the literal
 *   `back` case is exempt.
 * - **The `gear.rehomed` op is emitted regardless of whether `residence`
 *   equals the Gear's current home.** This is `patterns.md` §2.3's **one
 *   stated exception in the entire codebase**, and it is not a miss: it is
 *   what makes {@link rehomedSinceOutcome}'s (`selectors/unpack.ts`) own
 *   comparison correct on *every* re-home through this row, not only the
 *   ones that happen to land on a different shelf. That comparison asks
 *   whether the Gear's `residence` stamp sits at or after this Entry's
 *   `outcome` stamp — *the home moved when, or after, this line was
 *   resolved* — to decide whether the `RE-HOMED` meta segment draws
 *   (spec §4.6). Suppressing a same-value write here would leave the
 *   residence register's stamp **older** than the outcome write this same
 *   call just made, and the segment would silently fail to draw for the
 *   ordinary case of gear returning to the shelf it already nominally lived
 *   on. Do not "optimise" this write away — see this function's test file
 *   for the assertion that would catch exactly that regression.
 *
 * **A non-container per-person Entry fans out, one `trip.outcome_set` per
 * unresolved included Piece, rather than one Entry-level write.** Ruling R10
 * (`claim.ts`'s header, restated at `unpack.ts`'s `unaccountedOf`) makes a
 * non-container per-person Entry's own Entry-level `outcome` register
 * **read by nobody** — not `unpackItems`, not `countOfUnpack`, not
 * `claimsByGear`, not `unaccountedOf`. Writing only that register would be a
 * real op that settles nothing: the row's cluster count would not move and
 * the claim would not release. So this branch reads {@link entryKind} and
 * {@link isContainerEntry} (never re-derived — always called) to detect
 * exactly the case R10 names, and then applies the identical "already
 * resolved gets no write" rule **per Piece**, via {@link pieceOutcomeOf}
 * over {@link piecesOf} (the included set — a tombstoned Piece is skipped,
 * exactly as it is everywhere else). A per-person **container** Entry keeps
 * the Entry-level write: R10/R11's family says the container check wins
 * over the per-person one, the same order {@link unpackItems} and
 * `unaccountedOf` both check it in.
 *
 * `gearId` and `residence` are supplied by the caller (the picker's own
 * selection) rather than re-derived from `entry.source`, since a caller may
 * be re-homing a container whose contents ride along without an op of their
 * own (spec §4.6).
 */
export function reHomeOnTheSpot(
  trip: TripState,
  entry: EntryState,
  gearId: string,
  residence: Residence,
  state: HouseholdState,
): readonly OpSpec[] {
  const ops: OpSpec[] = []
  const container = isContainerEntry(entry, state)
  if (entryKind(entry, state) === 'per_person' && !container) {
    for (const personId of piecesOf(entry, trip)) {
      if (pieceOutcomeOf(entry.pieces?.[personId]) !== 'back') {
        ops.push(tripOutcomeSet(trip.id, entry.id, 'back', personId))
      }
    }
  } else if (outcomeOf(entry) !== 'back') {
    ops.push(tripOutcomeSet(trip.id, entry.id, 'back'))
  }
  // Deliberately unconditional — see this function's own docblock. Never
  // gate this on whether `residence` equals the Gear's current home.
  ops.push(gearRehomed(gearId, residence))
  return ops
}

/**
 * **The close** (spec §1.5, §4.7) — the gesture behind F5's close card and
 * `PhaseSheet`'s `CLOSED` row at `open = 0`: closing a Trip applies every
 * Consumed-count reduction it owes the Depot, then moves the phase.
 *
 * **A Trip already `closed` has nothing left to close, and this function
 * says so before computing anything** ({@link isClosed}, never re-derived —
 * ruling R27 Layer B,
 * `docs/specs/2026-09-05-unpack-resolve-and-close.md` §8.1). This overturns
 * an earlier ruling (I1) that kept the reduction loop running regardless of the
 * Trip's own phase, on the theory that a Device dying between the
 * reduction and the phase move needed a retry to still apply it. Review
 * demonstrated that guard produces exactly the wrong pair on an ordinary,
 * no-crash double tap: `gear.owned_count_set` is an **absolute** target,
 * not a delta, and the reduction loop reads the Gear's **current** owned
 * count — which, once a first close has already landed, is the **reduced**
 * value. A second call recomputed `reduced − consumed` and subtracted the
 * Consumed-count a second time, silently, with no crash and no second
 * Device involved. Returning `[]` up front is the only correct answer once
 * the Trip's own `phase` register already reads `closed`: there is no
 * reduction left to compute from this fold alone (see the residual risk
 * below for the two narrower paths this guard cannot see).
 *
 * **A Trip with an open outcome is not closeable, and this function is where
 * that is said** (invariant 18; ruling R36). Both shipped callers already
 * gate on `open === 0` — F5's close card withholds its button, `PhaseSheet`
 * withholds its `CLOSED` row — and both are correct today, so this changes
 * nothing a Quartermaster can reach. What it changes is what a **third**
 * caller inherits: without it, a new surface picks up the anti-double-reduce
 * guard above for free and silently *not* the domain's *"there is no
 * override"* on closing. `unpackTotals` (`selectors/unpack.ts`) is the one
 * arithmetic, never re-derived here.
 *
 * Two caveats, because they are what make gating here safe rather than
 * merely strict:
 *
 * - **A Trip a peer on an older build already moved to `closed` with
 *   outcomes still open never reaches this gate.** {@link isClosed} is
 *   checked first and returns `[]` regardless, so this gate can never hold a
 *   Trip hostage in a state it cannot leave — the `[]` it would return is
 *   the same `[]` the phase check already returns.
 * - **An unrecognised outcome counts as *resolved*, not open** —
 *   `countOfUnpack`'s own rule (spec §3.2, §5.3 obligation 4). So a Trip a
 *   *later* build finished with an outcome this build cannot draw is closed
 *   by this build without complaint, rather than being held hostage by a
 *   pill it has no row for.
 *
 * **The count is absolute, never a delta** — `gear.owned_count_set`'s own
 * contract ([sync §4.3](../../docs/sync-protocol.md)) — which is what makes
 * two Devices closing the same Trip **from the same, still-open fold**
 * safe: both compute the identical target from the identical fold, so the
 * second write is idempotent, and if the folds differ the later stamp
 * simply wins (spec §1.5, §5.2). Calling this function twice against the
 * *same, unchanged* `state` therefore produces byte-for-byte identical
 * ops — see this function's test file for the assertion that pins it, and
 * for the **sequential** case beside it, where the fold moves between the
 * two calls: that is exactly the case the guard above exists for.
 *
 * **Summed per Gear, by `consumedReductions` (`selectors/unpack.ts`) rather
 * than by a loop here.** A Trip may list one Gear on two Entries (spec §1.5),
 * so that selector accumulates every `consumed` Counted Entry's
 * `consumedCountOf` into a `Map<gearId, consumedUnits>` before this function
 * reads a single base count — one `gear.owned_count_set` per Gear, not one
 * per Entry. It lives in `unpack.ts` because `ReopenConfirm` needs the same
 * question (*does closing this Trip owe the Depot anything*) to decide
 * whether reopening needs its extra sentence, and two hand-copied gates over
 * `consumedCountOf`'s four exclusions is exactly the drift this module's own
 * header argues against.
 *
 * **Floored at `0`.** `Math.max(0, owned - consumed)` — a Trip cannot reduce
 * a Gear's owned count below nothing.
 *
 * **A `consumed` Entry whose Gear is not Counted contributes nothing.**
 * {@link consumedCountOf} answers `null` for anything that is not a Counted
 * depot Entry (a container, a Single, a trip-only Entry, an unsynced Gear),
 * and this function skips exactly what that `null` already excludes rather
 * than re-deriving the gate.
 *
 * **`trip.phase_moved` still goes last**, unconditionally, once the guard
 * above has let this function run at all — the reduction and the phase
 * move are independent writes on independent aggregates, and phase-last
 * fails better within a *single* close: a Device dying mid-batch, before
 * the fold has ever seen `closed`, leaves a Trip still in `unpack` with its
 * reduction already applied rather than a closed Trip whose Depot never
 * moved.
 *
 * **A known, recorded residual risk — not fixed here, and deliberately not
 * patched with a third mechanism.** The early return above closes the
 * no-crash double-tap and the already-synced two-replica path (a stale
 * peer's still-live close card, or a second Device that already folded this
 * Trip's `closed` phase before it next reads state). It does **not** close
 * the **crash mid-batch, then retried** path: a Device dies after `emit`
 * durably writes the reduction op but before the phase move lands — the
 * fold still reads `unpack`, exactly as a Trip that was never closed at
 * all — and a retry recomputes the reduction from the now-already-reduced
 * count, subtracting the Consumed-count twice. That path cannot be told
 * apart from "a reduction is still pending" using only the fold this
 * function is handed.
 *
 * It would need a fact the fold as specified cannot state: whether *this
 * Gear's own reduction, for this Trip*, has already been applied — a
 * per-Trip-per-Gear "already reduced" register outside S10's op catalogue.
 * The one mechanism already precedented in this codebase for a
 * cross-aggregate "has this already happened" question — a stamp
 * comparison, `unaccountedOf`'s own shape (`selectors/unpack.ts`) — was
 * considered and rejected: it would read as a false negative exactly when a
 * Quartermaster corrects the owned count *between* declaring the
 * consumption and closing, silently skipping a reduction that was never
 * applied. A wrong "already reduced" belief is worse than the narrow, rare
 * corruption it would replace, so this is written down rather than patched.
 * Tracked in `docs/technical-debt.md`.
 *
 * **The second path that used to sit beside it — close, reopen, close —
 * is closed from the other end, at {@link reopenTrip}.** Not by a fact this
 * function gained: it still cannot tell a reopened Trip from one that was
 * never closed, because both fold to `unpack`. What changed is that this
 * build no longer *produces* such a Trip. See {@link reopenBlocked} for the
 * gate and for the cross-version case it does not reach.
 */
export function closeTrip(
  trip: TripState,
  state: HouseholdState,
): readonly OpSpec[] {
  // A closed Trip has nothing left to close — see this function's own
  // docblock for why this must be an unconditional early return rather
  // than a guard on the phase move alone.
  if (isClosed(trip)) return []

  // Ruling R36: the domain's "there is no override" on closing, stated here
  // rather than only in the two React components that draw the control.
  // See this function's docblock for the two caveats that make it safe.
  if (unpackTotals(trip, state).open > 0) return []

  const ops: OpSpec[] = []
  for (const [gearId, consumed] of consumedReductions(trip, state)) {
    const gear = state.gear[gearId]
    const owned = gear === undefined ? 0 : (ownedCountOf(gear) ?? 0)
    ops.push(gearOwnedCountSet(gearId, Math.max(0, owned - consumed)))
  }
  ops.push(tripPhaseMoved(trip.id, 'closed'))
  return ops
}

/**
 * **Whether this build may reopen this closed Trip** — `true` exactly when
 * its close applied a Consumed reduction the Depot cannot have applied
 * twice safely.
 *
 * This is a **limitation of this build, not a rule of the domain.** Story 32
 * says reopening is a deliberate, confirmed act and that the app *"never
 * refuses to reopen"*; story 11 wants the tent marked `lost` in September
 * corrected in November. Both still hold, and this predicate is `false` for
 * every Trip they describe — `lost` writes nothing against the Depot at all,
 * so a Trip whose outcomes are `back` and `lost` owes no reduction and
 * reopens exactly as drawn. What it withholds is the narrower case the
 * stories never reached: a Trip whose close **lowered an owned count**.
 *
 * **What goes wrong without it.** `gear.owned_count_set` is absolute, never
 * a delta ([sync §4.3](../../docs/sync-protocol.md)), and {@link closeTrip}
 * computes `owned − consumed` against the fold it is handed. A reopened
 * Trip folds to `unpack` exactly like a Trip that was never closed, so
 * `closeTrip`'s own `isClosed` guard cannot see it, and the second close
 * recomputes from the already-reduced count: owned 6 → close → 4 → reopen →
 * close → **2**. Four taps, one Device, no crash, nothing on screen. It is
 * the Depot corruption S10 exists to prevent, arriving through S6's own
 * shipped door.
 *
 * **Why a gate here rather than a smarter close.** Telling *"the reduction
 * never landed"* apart from *"it landed and this fold reflects it"* needs a
 * per-Trip-per-Gear "already reduced" register outside S10's op catalogue,
 * and the one precedented alternative — a cross-aggregate stamp
 * comparison — was considered and rejected (ruling R28) as a worse false
 * negative. {@link closeTrip}'s own docblock carries that argument in full.
 * A comparison against the Trip's *phase* stamp fails harder still:
 * invariant 16 lets an outcome be recorded before the move into `unpack`, so
 * on an ordinary **first** close every outcome stamp can precede the phase
 * stamp and the reduction would be skipped outright.
 *
 * **`consumedReductions` is the one question, never re-derived.** It already
 * gates a `consumed` outcome to a Counted **depot** Entry, so a container, a
 * Single, a trip-only Entry and an unsynced Gear each contribute nothing and
 * leave the Trip reopenable — and it is the identical read `closeTrip` sums
 * and `ReopenConfirm` asks for its own disclosure line, which is what keeps
 * the gate and the sentence beside it from ever disagreeing.
 *
 * **A `false` answer means reopening is exact, not merely permitted.** A
 * Trip that owes nothing can be reopened and re-closed any number of times
 * and the Depot never moves, because {@link closeTrip} emits no
 * `gear.owned_count_set` at all on such a Trip.
 *
 * **What this does not reach, stated rather than implied.** Reopening is a
 * bare `trip.phase_moved`, and an installed PWA running a build from before
 * this gate emits one with nothing to stop it. Such a Trip syncs here as an
 * ordinary `unpack` Trip and *any* build's close card will then reduce it a
 * second time. The gate turns a four-tap defect on a current build into a
 * cross-version one; only the register above removes it. Recorded in
 * `docs/technical-debt.md` and handed to S11, whose job is to make the
 * re-close correct and hand this route back.
 */
export function reopenBlocked(trip: TripState, state: HouseholdState): boolean {
  // `isClosed`, never re-derived — the only definition of closed-ness in the
  // codebase. A Trip that is not closed is not being reopened, whatever it
  // would owe, so the question does not arise.
  if (!isClosed(trip)) return false
  return consumedReductions(trip, state).size > 0
}

/**
 * **The reopen** — the gesture behind the closed ledger row's `REOPEN` and
 * `PhaseSheet`'s rows out of `closed`: it moves a closed Trip back to a live
 * phase, and refuses where doing so would let the Depot be reduced twice.
 *
 * **It lives here rather than at the two screens for {@link closeTrip}'s own
 * reason**, restated on the way out: spell the composition once, call it
 * twice, and a screen can never emit half of it. `PhaseSheet` already
 * carries the note that *"a bare `tripPhaseMoved` past this gate is exactly
 * the corruption F5's own close card exists to prevent, arriving through a
 * second door"* — about entering `closed`. This is the symmetric hole on the
 * way out, and ruling R36's argument applies unchanged: what a gate in a
 * gesture changes is not what a Quartermaster can reach today but what a
 * **third** caller inherits.
 *
 * **The `to` phase is the caller's**, not this function's: the closed ledger
 * row targets `unpack` and `PhaseSheet` offers all four other rows, because
 * invariant 16 makes every move expressible in either direction and the
 * sheet's own footnote promises any row is tappable. This gesture decides
 * *whether*, never *where*.
 *
 * **Both callers withhold their control on {@link reopenBlocked} rather than
 * tapping into this silence** (`patterns.md` §3.7 — withheld, never greyed),
 * and state the fact where the control was. A returned `[]` is therefore
 * unreachable from the shipped UI; it is here so that a third caller
 * inherits the gate rather than the emit.
 */
export function reopenTrip(
  trip: TripState,
  to: PhaseKey,
  state: HouseholdState,
): readonly OpSpec[] {
  if (!isClosed(trip)) return []
  if (reopenBlocked(trip, state)) return []
  return [tripPhaseMoved(trip.id, to)]
}
