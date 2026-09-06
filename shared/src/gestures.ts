import {
  gearOwnedCountSet,
  gearRehomed,
  tripOutcomeSet,
  tripPhaseMoved,
  type OpSpec,
} from './authoring.ts'
import { ownedCountOf } from './selectors/depot.ts'
import { entriesOf } from './selectors/entry.ts'
import { consumedCountOf, outcomeOf } from './selectors/unpack.ts'
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
 * aggregate boundary; two are S10's, and this module is those two. Each has
 * **two callers** — `reHomeOnTheSpot`: F5's row and gear detail's `RESOLVE`;
 * `closeTrip`: F5's close card and `PhaseSheet`'s `CLOSED` row at `open = 0`
 * — which is exactly the two-surfaces-must-not-drift risk this codebase
 * keeps answering the same way (`packing.ts`'s `sameTripResidence`,
 * `claim.ts`'s gate, `phaseOf`'s table): spell the composition once here,
 * call it twice, and a screen can never emit half of it.
 */

/**
 * **Re-home on the spot** (spec §1.5, §4.6) — the gesture behind F5's row
 * body and gear detail's `RESOLVE`: picking a home for gear that is back
 * from a Trip marks it back *and* writes where it now lives, in one user
 * action across two aggregates (Trip and Gear) — invariant 8's two writes.
 *
 * **Two rules, pulling in opposite directions, and both matter:**
 *
 * - **An Entry already `back` gets no `trip.outcome_set`.** A needless write
 *   moves the stamp last-writer-wins compares, so it could beat — and
 *   silently discard — a genuine concurrent write from a Device that was
 *   offline (this codebase's standing rule, `patterns.md` §2.3). Re-homing an
 *   Entry that is already `back` (or `consumed` or `lost` — the outcome is
 *   being *found*, not necessarily re-confirmed as `back`; only the literal
 *   `back` case is exempt) still emits the outcome write, because a `lost`
 *   or `consumed` Entry re-homed on the spot is genuinely becoming `back`.
 * - **The `gear.rehomed` op is emitted regardless of whether `residence`
 *   equals the Gear's current home.** This is `patterns.md` §2.3's **one
 *   stated exception in the entire codebase**, and it is not a miss: it is
 *   what *settles* an unaccounted-for standing. `unaccountedOf`
 *   (`selectors/unpack.ts`) decides whether a `lost` outcome still stands by
 *   comparing its stamp against the Gear's `residence` register's own stamp
 *   (`outcomeStands`) — so writing the *same* home again, on a clock later
 *   than the `lost` outcome, is precisely the new fact that ends the
 *   standing. F16's settle route (`● NOW — FOUND HERE`) depends on this: it
 *   reuses this same picker with the current home made tappable, and
 *   suppressing a same-value write here would make that row silently do
 *   nothing. Do not "optimise" this write away — see this function's test
 *   file for the assertion that would catch exactly that regression.
 *
 * `entry` is read only for its own `outcome` register
 * ({@link outcomeOf} — no other register on it, and no Piece, is touched);
 * `gearId` and `residence` are supplied by the caller (the picker's own
 * selection) rather than re-derived from `entry.source`, since a caller may
 * be re-homing a container whose contents ride along without an op of their
 * own (spec §4.6). `state` is accepted for parity with {@link closeTrip}'s
 * signature — both of S10's gestures compose builders with the fold in
 * hand — but this gesture's two rules read `entry` alone; nothing here
 * consults it.
 */
export function reHomeOnTheSpot(
  trip: TripState,
  entry: EntryState,
  gearId: string,
  residence: Residence,
  state: HouseholdState,
): readonly OpSpec[] {
  void state
  const ops: OpSpec[] = []
  if (outcomeOf(entry) !== 'back') {
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
 * **The count is absolute, never a delta** — `gear.owned_count_set`'s own
 * contract ([sync §4.3](../../docs/sync-protocol.md)) — which is what makes
 * two Devices closing the same Trip safe: both compute the identical target
 * from the identical fold, so the second write is idempotent, and if the
 * folds differ the later stamp simply wins (spec §1.5, §5.2). Calling this
 * function twice against the same `state` therefore produces byte-for-byte
 * identical ops; see this function's test file for the assertion that pins
 * it.
 *
 * **Summed per Gear.** A Trip may list one Gear on two Entries (spec §1.5),
 * so this accumulates every `consumed` Counted Entry's
 * {@link consumedCountOf} into a `Map<gearId, consumedUnits>` over
 * {@link entriesOf} before reading a single base count — one
 * `gear.owned_count_set` per Gear, not one per Entry.
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
 * **`trip.phase_moved` goes last.** Both orders converge — the reduction and
 * the phase move are independent writes on independent aggregates — but this
 * one fails better: a Device dying mid-batch leaves a Trip still in `unpack`
 * with its reduction already applied, rather than a closed Trip whose Depot
 * never moved (spec §1.5, §4.7).
 */
export function closeTrip(
  trip: TripState,
  state: HouseholdState,
): readonly OpSpec[] {
  const consumedByGear = new Map<string, number>()
  for (const entry of entriesOf(trip, state)) {
    if (outcomeOf(entry) !== 'consumed') continue
    const consumed = consumedCountOf(entry, state)
    if (consumed === null) continue
    const source = entry.source?.value
    // consumedCountOf already gates this to a Counted **depot** Entry (its
    // container/Kind checks both read state.gear[source.gearId]), so a
    // non-null answer means `source` is a depot pointer — this narrows the
    // type rather than adding a second gate.
    if (source === undefined || source.from !== 'depot') continue
    consumedByGear.set(
      source.gearId,
      (consumedByGear.get(source.gearId) ?? 0) + consumed,
    )
  }

  const ops: OpSpec[] = []
  for (const [gearId, consumed] of consumedByGear) {
    const gear = state.gear[gearId]
    const owned = gear === undefined ? 0 : (ownedCountOf(gear) ?? 0)
    ops.push(gearOwnedCountSet(gearId, Math.max(0, owned - consumed)))
  }
  // Last, always — see this function's own docblock.
  ops.push(tripPhaseMoved(trip.id, 'closed'))
  return ops
}
