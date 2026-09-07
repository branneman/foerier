import {
  gearOwnedCountSet,
  gearRehomed,
  tripConsumptionPosted,
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
  postedOf,
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
 * **`reopenTrip` and `restoreConsumption` are a third and fourth function
 * here, and only one of them is one of sync §4.5's gestures.**
 * `restoreConsumption` emits `gear.owned_count_set` (Gear) beside
 * `trip.consumption_posted` (Trip), so it crosses an aggregate boundary as
 * plainly as {@link closeTrip} does and is one of §4.5's four. `reopenTrip`
 * writes only the Trip — back-filled postings and the phase move — so it
 * stays outside that set. What puts *both* in this file is the other half
 * of §4.5's shape: each *decides* by reading the Gear aggregate
 * (`consumedReductions` → `ownedCountOf`'s own subject, `postedOf` beside
 * it), which is the property that keeps both out of `authoring.ts` and puts
 * them here: this file is where an op's payload stops being a pure function
 * of its arguments. As of S11 (spec §2, §5.2) `reopenTrip` no longer decides
 * *whether* to emit anything — every closed Trip may reopen — it decides
 * *how much of its own close to back-fill a posting for*, which is still a
 * read of the Gear aggregate and still belongs here. `reopenTrip` is the
 * symmetric door to {@link closeTrip}; `restoreConsumption` is the third
 * function the offer needs (spec §3) so a second caller cannot emit half of
 * it, the same reason `closeTrip` itself is spelled once.
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
 * header argues against. **S11 renames what that Map holds `owed` rather
 * than `consumed`**: it is what this Trip owes the Depot in total, not a
 * delta from any earlier close — the same number `owedOf` (`unpack.ts`)
 * hands the restoration offer (spec §3), asked once here per Gear rather
 * than through that thin wrapper.
 *
 * **S11 (spec §2.2, §2.3): a Gear's reduction fires only on a positive
 * `delta = owed − postedOf(trip, gearId)`, and every reduction is paired
 * with the posting that records what it applied.** `postedOf` (`unpack.ts`) is this Trip's own
 * running total already applied against this Gear's owned count — `0` for a
 * Gear this Trip has never posted, since {@link postedOf}'s own doc is the
 * one place that reads an absent register that way. `delta <= 0` means
 * nothing: either this Trip has already posted everything it owes for this
 * Gear (an ordinary re-close, `delta = 0`, §2.2's middle row), or it has
 * posted *more* than it currently owes (a lowered Consumed-count that the
 * restoration offer, not this function, is the one to reconcile — §2.2's
 * bottom row, {@link restoreConsumption}). Either way this function writes
 * nothing for that Gear and moves to the next.
 *
 * **The reduction goes before its own posting, inside the same iteration,
 * for the identical reason `trip.phase_moved` goes last.** `emit` appends
 * one op at a time (`store.ts`), so this function's own ops are not atomic
 * and a Device can die between any two of them. A posting recorded *without*
 * its reduction would make every later close read `postedOf` as already
 * satisfied and skip a reduction that never actually landed — a silent
 * under-count, R28's own false-negative failure mode arriving through a
 * different door (the posting register, rather than a stamp comparison).
 * The reverse order — reduction first — leaves the pre-existing behaviour
 * exactly as it was before this register existed: a Device dying between
 * the two ops leaves an under-posted Gear that a retried close still finds
 * `delta > 0` for, and reduces (and posts) correctly on the retry.
 *
 * **Floored at `0`, and the posting is floored with it.** `applied =
 * min(delta, owned)` is what the reduction can actually take — a Trip cannot
 * reduce a Gear's owned count below nothing — and the posting records
 * `posted + applied`, the running total this Trip has **applied** to the
 * Depot (spec §2.1's own words). The two must be floored together, because
 * over-claim is a supported state in this app (S7 surfaces it and never
 * blocks it) and `owed` can therefore exceed what the Depot has: owned ×1
 * with ×5 consumed reduces to `0` and posts `1`, never `5`. Posting the
 * unfloored `owed` made {@link restoreConsumption} hand back four units the
 * Depot never lost — `owned + (posted − owed)` = `0 + (5 − 0)` = `5` on a
 * Gear the household owned one of. Note the consequence for the restoration:
 * once the offer has restored, the posting it writes (`owed`) is again
 * exactly what stays applied, so the two arithmetics compose.
 *
 * **A Gear the Depot has nothing left to give writes nothing — unless this
 * close is not yet on the record for it.** `applied === 0` with a posting
 * register already present is the re-close after a declined offer (owed ×5,
 * posted ×1, owned ×0): a `gear.owned_count_set(0)` over `0` and a posting
 * of the value it already holds are both needless writes, and a needless
 * write moves the stamp LWW compares (`patterns.md` §2.3). With **no**
 * register present it still posts — `0` — because absence is what
 * {@link reopenTrip}'s back-fill reads as *this close was never recorded*,
 * and it would then fabricate a posting of the full `owed` for a close that
 * applied nothing, re-opening the same over-credit through the back-fill
 * door. Recording the `0` is the fact, and it is cheap.
 *
 * **A `consumed` Entry whose Gear is not Counted contributes nothing.**
 * {@link consumedCountOf} answers `null` for anything that is not a Counted
 * depot Entry (a container, a Single, a trip-only Entry, an unsynced Gear),
 * and this function skips exactly what that `null` already excludes rather
 * than re-deriving the gate.
 *
 * **`trip.phase_moved` still goes last**, unconditionally, once the guard
 * above has let this function run at all — every reduction/posting pair and
 * the phase move are independent writes on independent aggregates, and
 * phase-last fails better within a *single* close: a Device dying mid-batch,
 * before the fold has ever seen `closed`, leaves a Trip still in `unpack`
 * with whatever prefix of the reductions already applied rather than a
 * closed Trip whose Depot never moved.
 *
 * **This does not close the crash-mid-batch debt, and does not pretend
 * to — that needs atomicity, which this slice does not add.** The early
 * return above closes the no-crash double-tap and the already-synced
 * two-replica path (a stale peer's still-live close card, or a second
 * Device that already folded this Trip's `closed` phase before it next
 * reads state) — and, as of S11, the close-reopen-close path too, since a
 * reopen through this build always leaves a posting behind (see
 * {@link reopenTrip}). What it does **not** close is a Device dying *between
 * the reduction and its own posting*, inside a single close's batch: the
 * reduction op lands durably, the posting does not, and `postedOf` on retry
 * still reads the pre-close value, so the retry recomputes `delta` as if
 * nothing had happened and reduces the Gear a second time. That is a
 * narrower window than the one this register closes — one op wide, not a
 * whole phase move away — but it is not zero, and fixing it needs the
 * reduction and its posting to land as one atomic write. That is a
 * store-level change (`emit` appends ops one at a time, `store.ts`) with no
 * relation to reopening, and is out of scope here. Tracked in
 * `docs/technical-debt.md`'s existing entry, which this slice's own docs
 * task owes a rewrite: what is missing is atomicity now, not a fact — the
 * fact is exactly what `postings` records.
 *
 * **The second path that used to sit beside it — close, reopen, close — is
 * closed at both ends, and neither end alone is enough.** This function
 * still cannot tell a reopened Trip from one that was never closed — both
 * fold to `unpack` — so it does not try to: what makes the re-close correct
 * is that `postedOf` (read via `delta`, above) tells the truth about what a
 * *previous* close already applied, whichever build performed it.
 * {@link reopenTrip} is the half that makes that true on a Trip closed
 * before this register existed — it back-fills a posting for every Gear its
 * own close already reduced (spec §5.2) — and this function's `delta`
 * arithmetic is the half that then reads it: without the back-fill,
 * `postedOf` would still read `0` for such a Trip and this loop would
 * reduce it again; without this loop reading `postedOf` at all, the
 * back-filled posting would be recorded and read by nobody, and the second
 * close would reduce exactly as before. Neither function closes the path by
 * itself.
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
  for (const [gearId, owed] of consumedReductions(trip, state)) {
    // §2.2's table: `delta <= 0` is nobody's move here — either an ordinary
    // re-close that owes nothing new, or a lowered Consumed-count that only
    // the restoration offer may reconcile (`restoreConsumption`, below).
    const posted = postedOf(trip, gearId)
    const delta = owed - posted
    if (delta <= 0) continue
    const gear = state.gear[gearId]
    const owned = gear === undefined ? 0 : (ownedCountOf(gear) ?? 0)
    // What the reduction can actually take, which is what the posting must
    // record — see this function's docblock: the floor is on the *pair*,
    // not on the owned-count write alone.
    const applied = Math.min(delta, owned)
    // Nothing left to take, and this close is already on the record for
    // this Gear: no write at all (`patterns.md` §2.3).
    if (applied === 0 && trip.postings?.[gearId] !== undefined) continue
    // The reduction before its own posting — see this function's docblock
    // for why the order is a decision, not an accident.
    if (applied > 0) ops.push(gearOwnedCountSet(gearId, owned - applied))
    ops.push(tripConsumptionPosted(trip.id, gearId, posted + applied))
  }
  ops.push(tripPhaseMoved(trip.id, 'closed'))
  return ops
}

/**
 * **The reopen** — the gesture behind the closed ledger row's `REOPEN` and
 * `PhaseSheet`'s rows out of `closed`: it moves a closed Trip back to a live
 * phase, first recording what that Trip's own close already applied so a
 * later re-close cannot apply it again.
 *
 * **It lives here rather than at the two screens for {@link closeTrip}'s own
 * reason**, restated on the way out: spell the composition once, call it
 * twice, and a screen can never emit half of it.
 *
 * **§5.1 — there is no gate any more.** S10's `reopenBlocked` withheld the
 * route entirely for a Trip whose close had lowered an owned count; S11
 * (spec §2) makes the *close* correct instead, by having it read what this
 * Trip has already posted (`postedOf`) before it ever reduces again. Once
 * the close is correct on any fold, there is nothing left for a reopen gate
 * to prevent — see {@link closeTrip}'s own docblock for the arithmetic. So
 * this function returns `[]` for exactly one reason now: the Trip named is
 * not closed, and there is nothing to reopen.
 *
 * **§5.2 — the back-fill.** A closed Trip in a real household today may have
 * been closed by a build with no posting op at all: its `postings` map is
 * empty and its `owed` is non-zero, indistinguishable from *nothing was ever
 * posted*. Reopening such a Trip without recording what its close already
 * did would hand the broken route straight back — the very four-tap defect
 * S11 exists to close. So before moving the phase, this function walks
 * {@link consumedReductions} exactly as {@link closeTrip} does and posts,
 * per Gear, what that selector says this Trip owes — **not** what it should
 * owe from here on, since a closed Trip owes nothing further; the posting is
 * a record of what already happened, not a new instruction.
 *
 * **The back-fill is legitimate because of ruling G6, not because of a
 * guess.** G6 makes F5 on a closed Trip a *record*: every write there is
 * withheld, so a closed Trip's outcomes are frozen by the time this function
 * ever runs against it, and `consumedReductions` computed *now* is exactly
 * what that earlier close applied — a reconstruction from a fact that cannot
 * have moved, the same standing `ReopenConfirm`'s own `×6` caveat
 * (`app/src/components/ReopenConfirm.tsx`) already carries. **The
 * reconstruction posts `owed`, which is right unless that pre-S11 close was
 * itself floored** — a close of ×5 against a Depot holding ×1 applied ×1 and
 * this back-fill records ×5, since the pre-close owned count exists only in
 * the log and no register survives to say otherwise. A close performed by
 * *this* build never needs the reconstruction: it always leaves a posting
 * behind, `0` included, precisely so the presence check below can tell the
 * two apart. **What it cannot see** (spec §5.3): a peer on a
 * **pre-gate** build — S10-era, before `reopenBlocked` ever shipped — that
 * reopened this same Trip with a bare `trip.phase_moved` and no posting,
 * and whose reopen this build never witnessed. Such a Trip can still arrive
 * here having already been reopened-and-reclosed once outside this
 * arithmetic's view; that residue is recorded in `docs/technical-debt.md`
 * as a shrinking cross-version case rather than fixed, because the only
 * evidence of it is an op that build never wrote.
 *
 * **The presence check reads the register's own presence, deliberately not
 * `postedOf(trip, gearId) > 0`.** A posting explicitly restored to `0` by
 * the offer (spec §3) is a Gear whose close *was* recorded and whose units
 * this Trip has already handed back — back-filling it here would fabricate
 * a posting nobody made and, worse, would silently re-post units the offer
 * had just given back. `postedOf`'s own `0`-reads-as-absent rule is right
 * for the close's `delta` arithmetic and wrong for this one question; this
 * is the one place in the codebase the two intentionally read the register
 * differently, and each reads it the way its own question requires.
 *
 * **Deliberately per Gear, not *is the whole map empty*.** A Trip closed by
 * this build, then given a `consumed` outcome on a second Gear by a peer
 * that writes outcomes without honouring G6, has a *partial* postings map —
 * some Gears posted, one not. The narrower per-Gear check back-fills only
 * what is actually missing rather than either skipping a Gear that needs it
 * or re-posting one that does not.
 *
 * **The `to` phase is the caller's**, not this function's: the closed ledger
 * row targets `unpack` and `PhaseSheet` offers all four other rows, because
 * invariant 16 makes every move expressible in either direction and the
 * sheet's own footnote promises any row is tappable. **Where is the
 * caller's — there is no *whether* left for this function to decide.** (It
 * still refuses only a Trip that is not closed at all; that is not a
 * *whether* about reopening, it is the question not arising.)
 */
export function reopenTrip(
  trip: TripState,
  to: PhaseKey,
  state: HouseholdState,
): readonly OpSpec[] {
  if (!isClosed(trip)) return []
  const ops: OpSpec[] = []
  for (const [gearId, owed] of consumedReductions(trip, state)) {
    // Presence, not `postedOf(...) > 0` — see this function's docblock for
    // why a posting restored to `0` must not be back-filled.
    if (trip.postings?.[gearId] !== undefined) continue
    ops.push(tripConsumptionPosted(trip.id, gearId, owed))
  }
  ops.push(tripPhaseMoved(trip.id, to))
  return ops
}

/**
 * **The restoration offer** (spec §3) — the third function `OutcomeSheet`
 * needs so a second caller cannot emit half of it, the same reason
 * {@link closeTrip} itself is spelled once rather than pasted at both its
 * screens. Story 11's own sentence: *"Changing away from `consumed`
 * **offers** to put the Owned-count back and waits for me to confirm — it
 * never silently rewrites a count I may have already corrected by hand."*
 *
 * **The trigger is the caller's, not this function's.** `OutcomeSheet`
 * raises the confirm whenever a change it just emitted makes `owed < posted`
 * for a Gear — §2.2's negative-delta row, the one row {@link closeTrip}
 * itself refuses to write. This function does not ask that question; it is
 * hydration and payload construction only, called once the caller has
 * already decided to offer.
 *
 * **The target is computed from the count *now*, not reset to what this
 * Trip once posted.** `owned + (posted − owed)` — the Depot's *current*
 * owned count, raised by exactly what this Trip is giving back
 * (`postedOf(trip, gearId) − owed`), landing on a number that accounts for
 * any hand-correction made to the Depot since the close, independent of
 * this Trip's own history. Resetting to a number this Trip once posted would
 * silently discard a correction a Quartermaster made for an unrelated
 * reason, which is precisely what story 11's sentence above refuses.
 *
 * **Posting after restoring**, mirroring {@link closeTrip}'s own reduction-
 * before-posting order for the identical reason: `emit` appends one op at a
 * time, so a Device can die between these two. Posting *first* would lower
 * `postedOf` to `owed` while the Depot's owned count has not yet moved — a
 * Device dying right there leaves the register already at its final,
 * lowered value with the restoration itself never applied. A later close
 * then reads `delta = owed − postedOf = 0`, skips the Gear, and the units
 * this offer meant to give back are silently never given back at all.
 * Restoring first avoids that: a Device dying between the two ops leaves
 * `postedOf` at its old, still-too-high value, so `delta` stays `≤ 0` and no
 * close wrongly reduces the Gear again — the register is stale, not wrong,
 * until a retry of this same offer completes the posting.
 *
 * **It posts `owed`, and that is the applied total once this restoration
 * lands.** {@link closeTrip} records what it *applied* rather than what was
 * owed (its own docblock argues the floor), so `posted` on the way in is
 * already the true applied figure; handing back `posted − owed` leaves
 * exactly `owed` applied, and the running total is absolute, so writing it
 * is the whole of the bookkeeping. The two arithmetics compose over any
 * number of close/reopen rounds, including a close the Depot could only
 * partly satisfy.
 *
 * **`owed` is the caller's own read**, not re-derived here — `OutcomeSheet`
 * already has it from the outcome change it just emitted (or from
 * {@link owedOf}, `unpack.ts`), and this function trusts it rather than
 * asking `consumedReductions` a second time, since by the time this offer
 * fires the fold the caller read it from may already differ from the one
 * passed in as `state` for the owned-count lookup.
 */
export function restoreConsumption(
  trip: TripState,
  gearId: string,
  owed: number,
  state: HouseholdState,
): readonly OpSpec[] {
  const gear = state.gear[gearId]
  const owned = gear === undefined ? 0 : (ownedCountOf(gear) ?? 0)
  const posted = postedOf(trip, gearId)
  return [
    gearOwnedCountSet(gearId, owned + (posted - owed)),
    tripConsumptionPosted(trip.id, gearId, owed),
  ]
}
