import { compareStamps, type Stamp } from '../hlc.ts'
import { stampOf, type Register } from '../registers.ts'
import type {
  EntryState,
  GearState,
  HouseholdState,
  OutcomeValue,
  PieceState,
  TripState,
} from '../state.ts'
import {
  containmentView,
  homePath,
  type ContainmentView,
  type PathSegment,
} from './containment.ts'
import {
  bringCountOf,
  entriesOf,
  entryKind,
  isContainerEntry,
  pieceCountOf,
} from './entry.ts'
import { piecesOf } from './piece.ts'
import { tripLabel, visibleTrips } from './trip.ts'

/**
 * **Unpack's read side** — beside `packing.ts` and `trip.ts`, and the same
 * shape of problem solved the same way: a handful of facts several surfaces
 * (F5's list, its groups, the close card, the trip card's progress line) must
 * agree on, stated once here rather than at each of them.
 *
 * **The spine is {@link unpackItems}, and it is deliberately not
 * `packingItems` — spec §3.1 argues the difference in full.** A container
 * Entry produces an item here (F1: `outcome` is a third register and a
 * container has it, unlike a `status` it can never carry); a trip-only Entry
 * produces none (invariant 18: it never entered the Depot and takes no
 * outcome). `docs/design/README.md` §7 states the whole rule as the shipped
 * authority: *"the denominator is every **depot** Entry's units, containers
 * included (F1) … trip-only Entries take no outcome and are excluded."*
 * Everything else — a Single, a Counted Entry's whole Bring-count, a
 * per-person Entry fanned out over its included Pieces — matches
 * `packingItems` exactly and reads `pieceCountOf`, which **is** the units
 * table, rather than restating it.
 *
 * Three facts here outlive this slice, which is why they are functions and
 * not idioms:
 *
 * - **An absent `outcome` register reads open, and so does one holding an
 *   explicit `null`.** Only {@link outcomeOf} and {@link pieceOutcomeOf} say
 *   so — `ownerOf`'s rule for a sixth and seventh time. The fold conflates
 *   nothing: absent and an explicit `null` stay different facts about the
 *   log (one was never addressed, the other was explicitly cleared), but
 *   every reader treats them alike.
 * - **An unrecognised outcome counts as resolved, into none of the three
 *   named buckets** — spec §3.2's argument, restated at {@link countOfUnpack}.
 * - **`consumedCountOf` is a THIRD gate reading an absent register as
 *   something other than the register's own literal absence, beyond the two
 *   the slice's own constraints named.** See its own docstring for the
 *   ruling and the reason.
 */

/**
 * The Entry's outcome, or `null` for open — absent and an explicit `null`
 * both read this way; see this file's header for the rule and why.
 */
export function outcomeOf(entry: EntryState): OutcomeValue | null {
  return entry.outcome?.value ?? null
}

/**
 * One Piece's outcome, or `null` for open — {@link outcomeOf}'s twin over the
 * other entity path.
 *
 * `piece` may be `undefined`: a Piece is **derived** (`piece.ts`), so a
 * Participant no `trip.outcome_set{person_id}` has ever addressed has no
 * `PieceState` at all, and must still answer open rather than throw.
 */
export function pieceOutcomeOf(
  piece: PieceState | undefined,
): OutcomeValue | null {
  return piece?.outcome?.value ?? null
}

/**
 * The Consumed-count, or `null` for anything that is not a Counted depot
 * Entry — a container included, whatever its Kind (see below).
 *
 * **This is a THIRD absent-register default this slice adds, not the two its
 * own constraints announced, and it is recorded here because a call site
 * that inherited "exactly two" would misread the intent.** An absent
 * `consumedCount` register reads the Entry's own **Bring-count**, never `1`
 * and never `null` — `ownerOf`'s rule, `phaseOf`'s, `statusOf`'s, `stageOf`'s,
 * `bringCountOf`'s and `ownedCountOf`'s: another register reading its own
 * absence as something other than the literal gap (this file's header
 * already numbers the running count for `outcomeOf`/`pieceOutcomeOf`).
 *
 * The reason is F9's own ruling: the outcome sheet's stepper opens at the
 * Bring-count, because *all of it used up is the ordinary case*, and the
 * sheet writes **one op per tap** — tapping `CONSUMED` alone authors an
 * outcome and no `trip.consumed_count_set` at all. Reading the absent case as
 * `1` would make the close card and the sheet state two different numbers for
 * the Entry that tap just resolved; reading it as `null` would drop the
 * Entry's whole Bring-count out of `resolved` the moment `CONSUMED` is tapped
 * and before any stepper is ever touched. Only "the whole Bring-count" keeps
 * every surface reading the identical number as the tap that produced it.
 *
 * **The gate is a container's, checked before the Kind's.** `bringCountOf`
 * itself does not exclude a container Entry — a Counted container's
 * Bring-count register is real and `EntryRow`'s own `×N` reads it — but
 * `consumedCountOf` must, because a container's `unpackItems` unit is a fixed
 * `1` (spec §3.1) and there is no notion of "half of one container came
 * back". Reusing {@link bringCountOf} here would silently answer a question
 * about pieces for a thing this slice counts as one.
 *
 * **The clamp is a read, never a write.** A peer on another build may author
 * `consumed_count_set{0}` or `{99}`; the tolerant reader forbids rewriting
 * what arrived, so this floors and ceilings the *answer* and leaves the
 * register exactly as folded.
 */
export function consumedCountOf(
  entry: EntryState,
  state: HouseholdState,
): number | null {
  if (isContainerEntry(entry, state)) return null
  const bringCount = bringCountOf(entry, state)
  if (bringCount === null) return null
  const raw = entry.consumedCount?.value ?? bringCount
  return Math.min(Math.max(raw, 1), bringCount)
}

/**
 * One row of {@link OUTCOMES} — `PHASES` / `STATUSES` / `STAGES`'s shape a
 * fourth time: a fact is a row in a table, stated once, rather than a switch
 * repeated at every call site that wants to draw it.
 */
export interface UnpackOutcome {
  id: 'back' | 'consumed' | 'lost'
  /** `BACK` · `CONSUMED` · `LOST` — the pill's word. */
  label: string
  /** `●` · `` · `▲` — `▲` is LOST alone (F6). */
  glyph: string
}

/** In the outcome sheet's chip order. */
export const OUTCOMES: readonly UnpackOutcome[] = [
  { id: 'back', label: 'BACK', glyph: '●' },
  { id: 'consumed', label: 'CONSUMED', glyph: '' },
  { id: 'lost', label: 'LOST', glyph: '▲' },
]

/**
 * The row for a known outcome, or `undefined` — **private**, `phaseRow` and
 * `statusRow`'s reason: every question the table answers has a named function
 * beside it ({@link outcomeLabel}, {@link outcomeGlyph}, {@link isKnownOutcome}),
 * so no caller has to remember what a missing row means.
 */
function outcomeRow(outcome: OutcomeValue): UnpackOutcome | undefined {
  return OUTCOMES.find((row) => row.id === outcome)
}

/**
 * How an outcome is drawn in words. `null` is `'OPEN'` — **open is not a
 * row**, because it is the absence of one, and this is the one place that is
 * stated. An unrecognised outcome draws **verbatim**, `statusLabel`'s own
 * answer to the identical question one register over (§5.3 obligation 4: a
 * value some build wrote deliberately is not this build's to rename).
 */
export function outcomeLabel(outcome: OutcomeValue | null): string {
  if (outcome === null) return 'OPEN'
  return outcomeRow(outcome)?.label ?? outcome
}

/**
 * The pill's glyph. `null` (open) is `'○'`. An unrecognised outcome draws
 * **no** glyph at all — deliberately not `statusGlyph`'s `'○'` fallback,
 * which would misdraw an outcome this build cannot name as though it were
 * still open.
 */
export function outcomeGlyph(outcome: OutcomeValue | null): string {
  if (outcome === null) return '○'
  return outcomeRow(outcome)?.glyph ?? ''
}

/** Whether this build has a row for `outcome` at all. */
export function isKnownOutcome(outcome: OutcomeValue): boolean {
  return outcomeRow(outcome) !== undefined
}

/**
 * One thing that carries an outcome: a whole Entry, or **one Piece** of a
 * per-person Entry — `PackingItem`'s shape, over a different register.
 *
 * `units` is what the item contributes to a denominator, read from
 * {@link pieceCountOf} **except** for a container, which this file's own
 * header explains. `consumed` is {@link consumedCountOf}'s answer, carried on
 * the item so {@link countOfUnpack} need not re-derive the gate; it is always
 * `null` on a `'piece'` item, because `consumedCount` hangs on the Entry and
 * per-person gear has no count at all (invariant 6).
 */
export type UnpackItem =
  | {
      kind: 'entry'
      entryId: string
      units: number
      outcome: OutcomeValue | null
      consumed: number | null
    }
  | {
      kind: 'piece'
      entryId: string
      personId: string
      units: 1
      outcome: OutcomeValue | null
      consumed: null
    }

/**
 * Every item on the Trip that takes an outcome, in {@link entriesOf} order
 * with a per-person Entry's Pieces in {@link piecesOf} order —
 * `packingItems`' walk, with the two changes spec §3.1 rules:
 *
 * - **A trip-only Entry is skipped, container or not.** It never entered the
 *   Depot and takes no outcome (invariant 18) — checked first, so a trip-only
 *   *container* (an improvised crate) is excluded exactly like a trip-only
 *   Single, rather than falling into the container branch below.
 *   `docs/design/README.md` §7: *"the denominator is every **depot** Entry's
 *   units, containers included (F1) … trip-only Entries take no outcome and
 *   are excluded."* The check order below is load-bearing and is pinned by
 *   `unpack.test.ts`'s check-order tests, not by any arithmetic: get it wrong
 *   and a Trip becomes permanently uncloseable while the rest of the suite
 *   stays green (no test otherwise builds a trip-only container or a
 *   per-person container).
 * - **A depot container Entry produces an item, `units: 1`.** Ruling A5
 *   excluded a container from `packingItems` because a container carries a
 *   journey *instead of* a status and can never be marked packed; that
 *   argument does not transfer here, because `outcome` is a third register
 *   and a container has it as plainly as any other Entry. `units` is a flat
 *   `1` — {@link pieceCountOf} is **not** consulted, because it answers a
 *   different question (packing arithmetic) and answers a container `0`.
 *
 * Everything else matches `packingItems`: a per-person Entry fans out one
 * item per **included** Piece ({@link piecesOf} — a tombstoned Piece takes no
 * outcome and produces no item; a Participant added after the Entry gets an
 * open item with no backfill op, neither restated here); a Counted Entry
 * carries its whole Bring-count as `units`; a Single, an unsynced Gear and an
 * unrecognised Kind all carry `1`.
 */
export function unpackItems(
  trip: TripState,
  state: HouseholdState,
): readonly UnpackItem[] {
  const items: UnpackItem[] = []
  for (const entry of entriesOf(trip, state)) {
    const kind = entryKind(entry, state)
    // Invariant 18, checked BEFORE container-ness: a trip-only Entry takes no
    // outcome whatever it is otherwise, and is still drawn (Task 10), just
    // not counted here. This order is pinned by a dedicated test, not by any
    // total: this function's own docstring explains why a swap is invisible
    // to every other assertion in this file.
    if (kind === 'trip_only') continue

    // Container-ness checked BEFORE the per-person fan-out, for the same
    // reason: a per-person depot container is one physical thing with one
    // Entry-level outcome, not three Pieces to resolve individually.
    const container = isContainerEntry(entry, state)
    if (kind === 'per_person' && !container) {
      for (const personId of piecesOf(entry, trip)) {
        items.push({
          kind: 'piece',
          entryId: entry.id,
          personId,
          units: 1,
          outcome: pieceOutcomeOf(entry.pieces?.[personId]),
          consumed: null,
        })
      }
      continue
    }

    items.push({
      kind: 'entry',
      entryId: entry.id,
      // F1: a container's unit is a flat `1`, never `pieceCountOf` — see this
      // function's own docstring.
      units: container ? 1 : pieceCountOf(entry, trip, state),
      outcome: outcomeOf(entry),
      consumed: consumedCountOf(entry, state),
    })
  }
  return items
}

/** `● 56/62 RESOLVED` and `6 OPEN`. */
export interface UnpackCount {
  readonly resolved: number
  readonly total: number
  readonly open: number
  readonly back: number
  readonly consumed: number
  readonly lost: number
}

/**
 * The one arithmetic, over any selection of items — `countOf`'s shape, over a
 * different register.
 *
 * **`open` is `total − resolved` and never a third sum** — `countOf`'s rule
 * verbatim: two independent sums can disagree, a subtraction cannot.
 *
 * **The numerator is `resolved`, not `back`** (F2): a bar counting `BACK`
 * alone could never fill on a Trip with one `lost` item, measuring a distance
 * the Quartermaster cannot close. The gate is invariant 18's `open = 0`, not
 * "everything came back".
 *
 * **A `consumed` Counted Entry splits.** The domain's own sentence is *"the
 * rest came back"*, so an Entry resolved `consumed` contributes
 * {@link consumedCountOf}'s answer to `consumed` and the remainder of its
 * units to `back` — and its **whole** `units` to `resolved`, because the
 * *decision* is whole even though the Depot consequence is partial. A
 * `'piece'` item and any `'entry'` item {@link consumedCountOf} answers
 * `null` for (a Single, an unrecognised Kind, an unsynced Gear, a container)
 * has no count of its own to split by, so all of it counts as consumed —
 * `item.consumed ?? item.units`.
 *
 * **An unrecognised outcome counts as resolved, into none of the three named
 * buckets.** It is a value some build wrote deliberately; treating it as
 * *open* would leave a Trip a peer had finished permanently uncloseable on
 * this build, gated by a pill this build cannot draw. So `back + consumed +
 * lost` may sum to **less than** `resolved` — the close card renders the
 * segments it has, exactly as `nextStatus`'s cycle prefers the visible
 * failure over the silent one.
 */
export function countOfUnpack(items: readonly UnpackItem[]): UnpackCount {
  let total = 0
  let resolved = 0
  let back = 0
  let consumed = 0
  let lost = 0
  for (const item of items) {
    total += item.units
    const { outcome } = item
    if (outcome === null) continue
    resolved += item.units
    if (outcome === 'back') {
      back += item.units
    } else if (outcome === 'consumed') {
      const consumedUnits = item.consumed ?? item.units
      consumed += consumedUnits
      back += item.units - consumedUnits
    } else if (outcome === 'lost') {
      lost += item.units
    }
    // An unrecognised outcome falls through every branch above: it is
    // counted into `resolved` and nowhere else, on purpose (this function's
    // own docstring).
  }
  return { resolved, total, open: total - resolved, back, consumed, lost }
}

/** The Trip's own `● 56/62 RESOLVED · 6 OPEN`, over {@link unpackItems}. */
export function unpackTotals(
  trip: TripState,
  state: HouseholdState,
): UnpackCount {
  return countOfUnpack(unpackItems(trip, state))
}

/**
 * F5's grouping (spec §3.4) — the Place at the **root** of a piece of gear's
 * home path, `null` for the `Loose` bucket.
 *
 * **This is a second partition over the containment tree, not a reuse of
 * `slice.ts`'s `container` dimension (D5), and the two must not be
 * reconciled.** D5 files by the **immediate** holder — a gear nested inside
 * Crate B, itself in the Attic, is filed under Crate B, because D5 answers
 * *where is this filed*. F5 answers a different question, *where does my
 * body go*: unpacking is walking the house once and emptying as you go, and
 * the room you walk to is the only fact that answers it, so this function
 * reads {@link homePath}'s **first** segment rather than its last, and the
 * container the gear actually sits in stays in the row's meta
 * ({@link returnPathOf}) rather than in the grouping. Both questions are
 * right about the identical tree; merging them would answer neither
 * correctly for anything nested more than one level deep.
 *
 * **`null` is the `Loose` bucket, and the word is a deliberate reversal of
 * D4's refusal on the Depot's own sentinel.** D4 declined `Loose` for the
 * Depot's "not in a container" bucket because that bucket also held gear
 * standing on the Attic floor — which has a home and is not lost, so calling
 * it Loose would have been a lie. This bucket is a different, narrower fact:
 * it is exactly the gear with **no Place at all** at the root of its home
 * path — never rehomed, rehomed to `loose` outright, resting in a container
 * that is itself loose, or pointed at a Place `homePath` cannot resolve
 * (removed, or broken by a cycle: {@link homePath}'s own four reasons,
 * re-read here rather than re-tested). That is precisely what the glossary's
 * **Loose** means, so D4's guard permits the word here — the guard is against
 * the word standing for the wrong fact, not against the word itself.
 *
 * Pass `view` when a screen already has one — {@link homePath}'s reason and
 * `containerTotals`'s (`packing.ts`): building it is O(depot), and F5 groups
 * every row on the screen, so a caller wants one view for the whole list, not
 * one per row.
 */
export function unpackDestinationOf(
  gearId: string,
  state: HouseholdState,
  view: ContainmentView = containmentView(state),
): string | null {
  const segments = homePath(state, gearId, view)
  return segments[0]?.kind === 'place' ? segments[0].id : null
}

/**
 * The full home path for a row's meta — {@link homePath}'s own answer,
 * outermost first, for a **depot** Entry only.
 *
 * A trip-only Entry names no Gear, so it has no home path to draw: it is not
 * grouped by {@link unpackDestinationOf} at all, drawn instead in its own
 * closing group after `Loose` (spec §3.4), and this function answers `[]`
 * for one rather than throwing — the same shape {@link entryKind}'s
 * `'trip_only'` case takes throughout this file.
 *
 * `view` is the same optional parameter {@link unpackDestinationOf} takes,
 * for the identical reason — a screen builds one view for the whole list.
 */
export function returnPathOf(
  entry: EntryState,
  state: HouseholdState,
  view: ContainmentView = containmentView(state),
): readonly PathSegment[] {
  const source = entry.source?.value
  if (source === undefined || source.from !== 'depot') return []
  return homePath(state, source.gearId, view)
}

/**
 * Spec §3.5's one comparison, stated **once**, here — the codebase's first
 * cross-aggregate stamp comparison. Legitimate for the reason every derived
 * answer here is: every replica holds identical registers with identical
 * stamps, so every replica computes the identical standing.
 *
 * A Gear with no `residence` register at all compares as **earlier than
 * everything**, handled as its own branch rather than a sentinel stamp, so
 * "nothing to compare against" reads as a stated fact rather than an
 * implementation trick — a `lost` outcome stands until somebody re-homes.
 *
 * `whereabouts.ts`'s own walk imports this rather than re-deriving the
 * direction of the comparison; do not write a second copy.
 */
export function outcomeStands(
  outcome: Register<OutcomeValue | null>,
  gear: GearState | undefined,
): boolean {
  const residence = gear?.residence
  if (residence === undefined) return true
  return compareStamps(stampOf(outcome), stampOf(residence)) > 0
}

/** The unaccounted standing for one Gear — {@link unaccountedOf}'s answer. */
export interface Unaccounted {
  /** The Trip of the **latest** live `lost` outcome. */
  readonly tripId: string
  readonly tripName: string
  /** Single → 1; Counted → Σ Bring-counts; per-person → `personIds.length`. */
  readonly units: number
  /** Per-person only; empty otherwise. */
  readonly personIds: readonly string[]
}

/**
 * The per-Gear accumulator {@link accumulateUnaccounted} folds into and
 * {@link finalizeUnaccounted} reads back out — **exported** because
 * `whereabouts.ts`'s own walk builds the identical standing in the same pass
 * as its `TRIP_SLICES` memo (patterns.md §1.7) rather than calling
 * {@link unaccountedOf} a second time over every visible Trip, and it must
 * accumulate the *identical* way rather than a second, drifting copy.
 */
export interface UnaccountedAccumulator {
  tripId: string
  tripName: string
  latest: Stamp
  units: number
  personIds: Set<string>
}

/**
 * Folds one live `lost` outcome into the per-Gear accumulator — the
 * accumulation glue {@link unaccountedOf} and `whereabouts.ts`'s own walk
 * both call, so the arithmetic ("the units sum, the latest stamp names the
 * Trip") is stated once.
 */
export function accumulateUnaccounted(
  byGear: Map<string, UnaccountedAccumulator>,
  gearId: string,
  tripId: string,
  tripName: string,
  stamp: Stamp,
  units: number,
  personId: string | undefined,
): void {
  const existing = byGear.get(gearId)
  if (existing === undefined) {
    byGear.set(gearId, {
      tripId,
      tripName,
      latest: stamp,
      units,
      personIds: personId === undefined ? new Set() : new Set([personId]),
    })
    return
  }
  existing.units += units
  if (personId !== undefined) existing.personIds.add(personId)
  if (compareStamps(stamp, existing.latest) > 0) {
    existing.tripId = tripId
    existing.tripName = tripName
    existing.latest = stamp
  }
}

/** {@link UnaccountedAccumulator} → {@link Unaccounted}, the public shape. */
export function finalizeUnaccounted(
  byGear: ReadonlyMap<string, UnaccountedAccumulator>,
): ReadonlyMap<string, Unaccounted> {
  const result = new Map<string, Unaccounted>()
  for (const [gearId, acc] of byGear) {
    result.set(gearId, {
      tripId: acc.tripId,
      tripName: acc.tripName,
      units: acc.personIds.size > 0 ? acc.personIds.size : acc.units,
      personIds: [...acc.personIds],
    })
  }
  return result
}

/**
 * **The unaccounted standing** — story 3, spec §3.5. Gear whose last unpack
 * outcome was `lost` reads as unaccounted for, naming the Trip it was last
 * seen on, until a later fact settles it. Story 11: a `lost` outcome writes
 * **nothing** to the Depot — this is entirely derived, never stored.
 *
 * Walks **every** {@link visibleTrips}, closed included — a closed Trip's
 * outcomes are exactly the history this standing reads, unlike
 * `whereabouts.ts`'s *active Trips only* rule for a live slice, which stays
 * unchanged and stated in exactly one place (spec §3.5).
 *
 * **Three consequences, spec §3.5, stated here because a call site would
 * otherwise re-derive them:**
 *
 * - **A re-home settles the whole standing for that Gear, not one unit of
 *   it.** There is no way to say *one of the two turned up*, because there
 *   is no per-unit identity to say it about — domain §6 refuses to give
 *   counted units one, deliberately.
 * - **Two Trips can both hold a live lost outcome for one Gear.** The units
 *   sum, and the **latest** such outcome names the Trip.
 * - **A later `back` on another Entry does not settle an earlier `lost`.**
 *   They are different units. What settles a lost outcome is a
 *   `gear.rehomed` with a later stamp, or that Entry's own outcome changing.
 *
 * **Ruling R10/R11's family, restated for this standing.** A non-container
 * Per-person Entry's Pieces are the unit — its own Entry-level `outcome` is
 * fold-but-ignore, and a lost Piece produces a per-Person standing. A
 * per-person **container** Entry's Entry is the unit — its Pieces' outcomes
 * (if any exist off-label) are fold-but-ignore, and its own lost outcome
 * produces a **whole-Entry** standing, `personIds` empty, exactly as
 * {@link unpackItems} puts that Entry's outcome on the Entry itself only
 * when it is a container (container checked before the per-person fan-out,
 * here too). Everything else's units read {@link pieceCountOf}, container
 * overridden to `1` — {@link unpackItems}'s own rule, restated rather than
 * called, so this stays a single walk over {@link entriesOf} instead of a
 * second one nested inside a call to it.
 */
export function unaccountedOf(
  state: HouseholdState,
): ReadonlyMap<string, Unaccounted> {
  const byGear = new Map<string, UnaccountedAccumulator>()

  for (const trip of visibleTrips(state)) {
    const tripName = tripLabel(trip)
    for (const entry of entriesOf(trip, state)) {
      const source = entry.source?.value
      // Invariant 18: a trip-only Entry names no Gear and takes no outcome.
      if (source === undefined || source.from !== 'depot') continue

      const gearId = source.gearId
      const gear = state.gear[gearId]
      const kind = entryKind(entry, state)
      const container = isContainerEntry(entry, state)

      if (kind === 'per_person' && !container) {
        for (const personId of piecesOf(entry, trip)) {
          const register = entry.pieces?.[personId]?.outcome
          if (register?.value !== 'lost') continue
          if (!outcomeStands(register, gear)) continue
          accumulateUnaccounted(
            byGear,
            gearId,
            trip.id,
            tripName,
            stampOf(register),
            1,
            personId,
          )
        }
        continue
      }

      const register = entry.outcome
      if (register?.value !== 'lost') continue
      if (!outcomeStands(register, gear)) continue
      const units = container ? 1 : pieceCountOf(entry, trip, state)
      accumulateUnaccounted(
        byGear,
        gearId,
        trip.id,
        tripName,
        stampOf(register),
        units,
        undefined,
      )
    }
  }

  return finalizeUnaccounted(byGear)
}
