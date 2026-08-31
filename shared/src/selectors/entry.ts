import type { DepotState, EntryState, KindValue, TripState } from '../state.ts'
import { byNameThenId } from './order.ts'
import { piecesOf } from './piece.ts'

/**
 * **The gear list's read side** — beside `owner.ts` and `trip.ts`, and the
 * same shape of problem solved the same way: a handful of facts several
 * surfaces (the builder, the trip screen, the claim selector) must agree on,
 * stated once here rather than at each of them.
 *
 * `bringCountOf` is one of several sites gating on `kind === 'counted'`
 * (`selectors/depot.ts`, `selectors/whereabouts.ts`,
 * `app/src/screens/GearDetail.tsx` among them) — the reason the question
 * moves behind one function instead of yet another copy of the gate.
 */

/** What the builder's footer and the section band count. */
export interface ListTotals {
  /** Lines on the list. */
  readonly entries: number
  /** Physical things: a Bring-count, a Participant count, or one. */
  readonly pieces: number
  /** The pieces contributed by per-person Entries. */
  readonly perPerson: number
  /** Trip-only Entries — one piece each, so this counts both. */
  readonly tripOnly: number
}

/**
 * The Entries a reader may see.
 *
 * **An Entry with no `source` is folded, retained, and not drawn.** Unlike
 * `phase` (which reads `draft`) and `owner` (which reads `SHARED`) there is
 * nothing to default a source to: an Entry naming neither a piece of Gear nor
 * a trip-only name is not a line anybody can draw. It is reachable because
 * `trip.entry_removed` and `trip.entry_bring_count_set` both create the Entry
 * on sight. It is excluded from the list, from every count, and from every
 * claim — the conservative direction, since a claim a reader cannot see is a
 * claim they cannot settle. Nothing is discarded: the moment the
 * `trip.entry_added` arrives the Entry appears.
 *
 * This is the only place that rule is stated.
 *
 * Sorted by {@link entryLabel} then `id`, via `byNameThenId`
 * (`selectors/order.ts`) — the one comparator every list in this codebase
 * shares, so two replicas holding identical state draw the same order. Its
 * case-insensitive, code-point comparison is what a bare `localeCompare`
 * is not: `localeCompare` resolves against the host's default locale and
 * ICU collation data, so two devices can order the same two labels
 * differently — exactly the divergence `order.ts`'s own header warns a
 * second comparator would reintroduce.
 *
 * `byNameThenId` sorts on a `name` register `EntryState` does not have —
 * a depot Entry's name lives on the Gear it references — so each Entry is
 * adapted to the `{id, name}` shape it takes, with {@link entryLabel} as
 * the borrowed `name`. This is why this function takes `state` at all.
 */
export function entriesOf(
  trip: TripState,
  state: DepotState,
): readonly EntryState[] {
  return Object.values(trip.entries ?? {})
    .filter(
      (entry) => entry.source !== undefined && entry.removed?.value !== true,
    )
    .sort((a, b) =>
      byNameThenId(
        { id: a.id, name: { value: entryLabel(a, state) } },
        { id: b.id, name: { value: entryLabel(b, state) } },
      ),
    )
}

/**
 * The Gear's name for a depot Entry, the source's own name for a trip-only
 * one — invariant 8's single-sourcing is this one line: a depot Entry is
 * renamed by renaming the Gear, with no Entry-side op at all.
 *
 * Falls back to `tripLabel`'s glyph (`—`) whenever there is no name to draw:
 * an unset or blank trip-only name, or a depot Entry whose referenced Gear is
 * unnamed, retired, or not yet in the fold (an id a peer's `trip.entry_added`
 * named before this replica received that Gear's `gear.recorded`). A
 * sourceless Entry — excluded from every list by {@link entriesOf} — also
 * falls back here rather than throwing, since this function has to answer
 * something for any `EntryState` it is handed.
 */
export function entryLabel(entry: EntryState, state: DepotState): string {
  const source = entry.source?.value
  const name =
    source === undefined
      ? ''
      : source.from === 'depot'
        ? (state.gear[source.gearId]?.name?.value ?? '')
        : (source.name ?? '')
  return name.trim() === '' ? '—' : name
}

/**
 * The Kind that governs the row, `'trip_only'` for an Entry with no Gear at
 * all, or `undefined` for a depot Entry whose Gear this function cannot read
 * a Kind from.
 *
 * `'trip_only'` covers exactly the two cases with no Gear to name: no
 * `source` at all, and a trip-only `source`.
 *
 * `undefined` covers a depot `source` whose Gear either has not reached this
 * replica's fold yet, or has but carries no `kind` register of its own.
 * **This is not a malformed op** — `trip.entry_added` and `gear.recorded`
 * are different aggregates with no ordering between them, so a Gear
 * genuinely not-yet-synced is the ordinary case, not the exceptional one.
 * Reading it as `'single'` would assert a Kind nobody has stated, and one
 * task over the claim selector branches on exactly this value: an unsynced
 * Gear misread as `'single'` would raise an over-claim the reader cannot
 * settle, naming a row this build still draws as `—`.
 *
 * `pieceCountOf` is this function's one caller for the branch; nothing else
 * should re-derive "does this Entry have a Gear, and what Kind is it".
 */
export function entryKind(
  entry: EntryState,
  state: DepotState,
): KindValue | 'trip_only' | undefined {
  const source = entry.source?.value
  if (source === undefined || source.from === 'trip_only') return 'trip_only'
  return state.gear[source.gearId]?.kind?.value
}

/**
 * The Bring-count, or `null` for every Entry that is not a Counted depot
 * Entry.
 *
 * Domain invariant 6 confines a bring-count to Counted gear, but the payload
 * carries only `{entry_id, count}` and the Kind lives on a **different**
 * aggregate — the reducer cannot gate on it without making the fold
 * order-dependent on whether `gear.kind_set` had arrived, so `bringCount`
 * folds for any Entry (`state.ts`'s own note on the register). The gate lives
 * here instead, on the way out — one of several sites asking "is this Gear
 * Counted", stated once so the next one never re-derives it.
 *
 * **An absent register on a Counted Entry reads `1`.** Adding Counted gear
 * without touching the stepper means bringing one, and writing a register to
 * say so would cost an op and move nothing.
 *
 * A Gear whose Kind changes away from `counted` leaves any `bringCount`
 * register on its Entries exactly as it was — clearing it is a write nobody
 * asked for, and per-field LWW cascades nothing. This function is what stops
 * that stale register from being read: it answers `null` the moment the Kind
 * no longer says Counted, whatever the register still holds.
 */
export function bringCountOf(
  entry: EntryState,
  state: DepotState,
): number | null {
  const source = entry.source?.value
  if (source === undefined || source.from !== 'depot') return null
  if (state.gear[source.gearId]?.kind?.value !== 'counted') return null
  return entry.bringCount?.value ?? 1
}

/**
 * How many things this Entry is — the spec's table, followed exactly:
 *
 * | Entry | Pieces |
 * | --- | --- |
 * | Single depot Entry | `1` |
 * | Counted depot Entry | {@link bringCountOf}, absent reads `1` |
 * | Per-person depot Entry | {@link piecesOf}`(entry, trip).length` |
 * | Trip-only Entry | `1` — no Kind to be Counted by |
 * | Gear with an unrecognised Kind | `1` — the conservative direction |
 * | Depot Entry whose Gear is not yet synced | `1` — {@link entryKind} reads `undefined`, defaulted exactly like an unrecognised Kind |
 */
export function pieceCountOf(
  entry: EntryState,
  trip: TripState,
  state: DepotState,
): number {
  switch (entryKind(entry, state)) {
    case 'counted':
      return bringCountOf(entry, state) ?? 1
    case 'per_person':
      return piecesOf(entry, trip).length
    default:
      return 1
  }
}

/**
 * The four numbers the builder's footer and the section band draw:
 * `4 ENTRIES · 6 PIECES · 2 PER-PERSON · 1 TRIP-ONLY`.
 *
 * The field names are the boards' nouns: `entries` counts lines,
 * `pieces` sums {@link pieceCountOf} over every visible Entry, `perPerson`
 * sums it over per-person Entries only, `tripOnly` counts trip-only Entries
 * (each worth one piece, so it is a subset of `pieces` rather than a fifth
 * number). Formatting the count with its noun — `1 PIECE` vs `2 PIECES` — is
 * the screens' job, not this one's: this returns numbers.
 */
export function listTotals(trip: TripState, state: DepotState): ListTotals {
  const entries = entriesOf(trip, state)
  let pieces = 0
  let perPerson = 0
  let tripOnly = 0
  for (const entry of entries) {
    const count = pieceCountOf(entry, trip, state)
    pieces += count
    const kind = entryKind(entry, state)
    if (kind === 'per_person') perPerson += count
    if (kind === 'trip_only') tripOnly += 1
  }
  return { entries: entries.length, pieces, perPerson, tripOnly }
}
