import type {
  EntryState,
  HouseholdState,
  OutcomeValue,
  PieceState,
  TripState,
} from '../state.ts'
import {
  bringCountOf,
  entriesOf,
  entryKind,
  isContainerEntry,
  pieceCountOf,
} from './entry.ts'
import { piecesOf } from './piece.ts'

/**
 * **Unpack's read side** — beside `packing.ts` and `trip.ts`, and the same
 * shape of problem solved the same way: a handful of facts several surfaces
 * (F5's list, its groups, the close card, the trip card's progress line) must
 * agree on, stated once here rather than at each of them.
 *
 * **The spine is {@link unpackItems}, and it is deliberately not
 * {@link packingItems} — spec §3.1 argues the difference in full.** A
 * container Entry produces an item here (F1: `outcome` is a third register
 * and a container has it, unlike a `status` it can never carry); a trip-only
 * Entry produces none (invariant 18: it never entered the Depot and takes no
 * outcome). Everything else — a Single, a Counted Entry's whole Bring-count, a
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
 * The Entry's outcome, or `null` for **open** — the absence of a resolution,
 * whether that is because no `trip.outcome_set` has ever addressed this Entry
 * or because one explicitly cleared it back with `outcome: null`.
 *
 * Both are read alike, and this — with {@link pieceOutcomeOf} — is the **one**
 * place that is stated (`ownerOf`'s rule, `phaseOf`'s, `statusOf`'s and
 * `stageOf`'s, for a sixth and seventh time). The fold conflates nothing:
 * `entry.outcome` being absent and `entry.outcome.value` being `null` are
 * different facts about the op log, but no reader downstream of this function
 * may tell them apart.
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
 * `bringCountOf`'s and `ownedCountOf`'s, for a **third** register reading its
 * own absence as something other than the literal gap.
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
    // Invariant 18, checked before container-ness: a trip-only Entry takes
    // no outcome whatever it is otherwise, and is still drawn (Task 10), just
    // not counted here.
    if (kind === 'trip_only') continue

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
