import { compareStamps, type Stamp } from '../hlc.ts'
import { stampOf, type Register } from '../registers.ts'
import type { DepotState, GearState } from '../state.ts'
import { foldText } from '../text.ts'
import { tagsOf, visibleGear } from './depot.ts'
import { entriesOf } from './entry.ts'
import { ownerOf, personLabel } from './owner.ts'
import {
  isClosed,
  tripLabel,
  UNNAMED_TRIP_GLYPH,
  visibleTrips,
} from './trip.ts'

/**
 * **The slicing engine** — story 13's "narrow, sort, and group lists by at
 * least: Tag, Person, Ownership, Kind, Packing status, Container, and Trip
 * membership", built **once**, here.
 *
 * [Architecture §8.5](../../docs/architecture-design.md) is the constraint
 * that shapes this file. Story 13's core lands at S3 carrying the only two
 * dimensions that exist — Tag and Kind — and four later slices each extend
 * *this* engine with the dimension they introduce, as part of their own
 * definition of done rather than as a follow-up:
 *
 * | Dimension | Arrives with |
 * | --- | --- |
 * | Tag; Kind | S3 |
 * | Ownership; Person | **S4** |
 * | Trip membership | S7 |
 * | Packing status; Container | S9 |
 * | Outcome | S10 |
 *
 * S8 (per-person Pieces) adds no row: its first draft's `PIECES BY PERSON`
 * dimension was overturned before it landed — the rung contradicted the
 * two-worlds rule (Pieces exist only in trip contexts), and story 13's own
 * criterion list never named it. See
 * [architecture §12.14](../../docs/architecture-design.md#1214-consequences-of-s8-per-person-pieces).
 *
 * So a dimension is a **row in a table**, never a branch in a predicate. That
 * is the whole design, and story 34 (a saved slice, Later) attaching with no
 * structural change is the test that it was built at the right altitude.
 */

/**
 * Every dimension a list can be narrowed by. Widened, never restructured, by
 * each slice in the table above.
 */
export type DimensionId = 'tag' | 'kind' | 'ownership' | 'person' | 'trip'

/** Components §04's three keys at S3. `newest` is by when gear was recorded. */
export type SortKey = 'name-asc' | 'name-desc' | 'newest'

/**
 * `NONE · KIND · OWNER`, and **never TAG** — deliberate, and a domain fact
 * rather than a UI preference: tags are multi-valued, so a three-tag piece of
 * gear would land in three groups and the groups would not partition the
 * list. Slicing by tag is the filter's job.
 *
 * Since S4 that rule is **structural rather than prose beside a branch**: a
 * grouping needs a {@link Grouping.keyOf} — "the one bucket this gear falls
 * into" — and Tag has none, so Tag simply has no row in
 * {@link GROUPING_TABLE}.
 */
export type GroupKey = 'none' | 'kind' | 'owner'

export interface Dimension {
  id: DimensionId
  /** The chip's label: `TAG`, `KIND`, `OWNERSHIP`, `PERSON`. */
  label: string
  /**
   * `multi` keeps its ghost add-chip while active, because several values
   * AND together; `single` hides its ghost, because one value is all there
   * can be (Components §04).
   */
  arity: 'single' | 'multi'
  /**
   * The values this gear carries in this dimension. Empty is legal and
   * ordinary — untagged gear carries no tags.
   *
   * `state` is handed in as well as `gear` because dimensions arriving later
   * need it: S7's Trip membership is a cross-aggregate question. Costing it
   * now saves the table being reshaped by the first dimension that asks.
   */
  valuesOf(gear: GearState, state: DepotState): readonly string[]
  /**
   * How one value is drawn. Sentence case and the `#` a tag chip draws but
   * never stores; CAPS is a CSS transform where a surface wants it, matching
   * how the rest of this codebase renders label text.
   *
   * **`state` is here because a value is not always self-describing.** S3
   * anticipated exactly this — its note on `valuesOf` above once read "S4's
   * Ownership resolves a `personId` to a Person" — and put the parameter one
   * function too early. The anticipation was right and the placement was off
   * by one: `valuesOf` returns the id, and it is `format` that has to turn it
   * into a name.
   */
  format(value: string, state: DepotState): string
  /**
   * A value that sorts before every other value whatever its count — the
   * boards' Loose-first rule. `Grouping.pinned`'s field (below), same name
   * and the same reason: `NOT_IN_ANY_TRIP` is not a fact about gear the way
   * a Trip id is, it is this dimension's one reserved word, and filing it by
   * count would let a busy Trip outrank it.
   */
  pinned?: string
}

/** `SINGLE · PER-PERSON · COUNTED` — the **glossary Kind**, never the
 * containment trait (`ITEM`/`CONTAINER`), which is a meta-line word only. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  single: 'Single',
  per_person: 'Per-person',
  counted: 'Counted',
}

/** The two halves of the domain's "personal to one person, **or** shared". */
const OWNERSHIP_LABELS: Readonly<Record<string, string>> = {
  shared: 'Shared',
  personal: 'Personal',
}

/**
 * `NOT IN ANY TRIP`'s raw filter value — a reserved plain word, the shape
 * {@link DIMENSION_TABLE}'s `ownership` row already uses for its two values.
 * Trip ids come from `systemIdSource` (a canonical UUID), so there is no
 * collision to guard against.
 */
const NOT_IN_ANY_TRIP = 'none'

/**
 * The gear→trips index, memoised on the folded state.
 *
 * `valuesOf` is called once per Gear per active dimension on the Depot
 * list — the app's most-visited screen — and every dimension before this one
 * answers from the Gear's own registers in constant time. Trip membership
 * does not: answering per Gear means scanning every Trip's Entries, an
 * O(gear × entries) cost this screen cannot absorb per render.
 *
 * `DepotState` is immutable and its identity changes on exactly the folds
 * that could change this answer — the reducer returns the same object when a
 * write loses — so the key is exact rather than approximate, and a
 * `WeakMap` lets superseded states be collected. No signature changes: S3
 * passed `state` into `valuesOf` so the table would not be reshaped by the
 * first dimension that needed it, and this is that dimension.
 */
const TRIP_MEMBERSHIP = new WeakMap<
  DepotState,
  Map<string, readonly string[]>
>()

/** Builds (once per state) or returns the cached gear→trips index. */
function tripMembershipOf(state: DepotState): Map<string, readonly string[]> {
  const cached = TRIP_MEMBERSHIP.get(state)
  if (cached !== undefined) return cached

  const index = new Map<string, string[]>()
  for (const trip of visibleTrips(state)) {
    // A Draft speaks for gear as surely as a Pack-out does — membership is
    // every *non-closed* Trip, not every *active* one. Closed Trips are
    // history: including them would leave NOT IN ANY TRIP permanently empty
    // for any household with a past.
    if (isClosed(trip)) continue
    for (const entry of entriesOf(trip, state)) {
      const source = entry.source?.value
      if (source === undefined || source.from !== 'depot') continue
      const trips = index.get(source.gearId)
      if (trips === undefined) index.set(source.gearId, [trip.id])
      else trips.push(trip.id)
    }
  }
  TRIP_MEMBERSHIP.set(state, index)
  return index
}

const DIMENSION_TABLE: Readonly<Record<DimensionId, Dimension>> = {
  tag: {
    id: 'tag',
    label: 'TAG',
    // Several tag chips AND together, so the ghost `+ TAG` stays while one is
    // active.
    arity: 'multi',
    valuesOf: (gear) => tagsOf(gear),
    format: (value) => `#${value}`,
  },
  kind: {
    id: 'kind',
    label: 'KIND',
    arity: 'single',
    valuesOf: (gear) => {
      const kind = gear.kind?.value
      return kind === undefined ? [] : [kind]
    },
    // An unrecognised kind is drawn exactly as it arrived (§5.3 obligation
    // 4 stores it verbatim) — inventing a casing for it would be coercion.
    format: (value) => KIND_LABELS[value] ?? value,
  },
  /**
   * **Personal or Shared** — the coarse projection of the one `owner`
   * register, and the only dimension whose `valuesOf` returns exactly one
   * value for every piece of gear in the depot. An absent register reads
   * shared (`selectors/owner.ts`), which is what makes this dimension agree
   * with the label the row beside it draws.
   */
  ownership: {
    id: 'ownership',
    label: 'OWNERSHIP',
    arity: 'single',
    valuesOf: (gear) => [
      ownerOf(gear).type === 'shared' ? 'shared' : 'personal',
    ],
    format: (value) => OWNERSHIP_LABELS[value] ?? value,
  },
  /**
   * **Whose** — the fine projection of the same register.
   *
   * Shared gear carries no value at all rather than a sentinel, so it simply
   * never matches; and a Person who owns nothing never reaches the picker,
   * because {@link dimensionValues} derives the vocabulary from the visible
   * depot rather than from any declared list.
   *
   * Two dimensions over one register is the boards' decision, not the
   * register's: Components §04 draws `PERSON · S4` and `OWNERSHIP · S4` as
   * two dashed ghosts, and story 13's criterion names them separately. A
   * single merged `OWNER` dimension would have expressed both of story 4's
   * narrowings with one chip and could not have expressed the third
   * (*all* personal gear, whoever's). The cost of two is that
   * `OWNERSHIP: SHARED` + `PERSON: ELS` is reachable and always empty —
   * see {@link passesFilters}.
   */
  person: {
    id: 'person',
    label: 'PERSON',
    arity: 'single',
    valuesOf: (gear) => {
      const owner = ownerOf(gear)
      return owner.type === 'person' ? [owner.personId] : []
    },
    format: (value, state) => personLabel(state, value),
  },
  /**
   * **Which Trip(s) claim this gear** — the first cross-aggregate dimension
   * (`tripMembershipOf`'s memo exists because of it) and the first whose
   * vocabulary includes a sentinel rather than leaving unmatched gear silent
   * the way Person does for shared gear.
   *
   * `NOT IN ANY TRIP` and a named Trip id never both appear in one
   * `valuesOf` answer — a piece of gear either carries at least one
   * non-closed Trip or it carries the sentinel alone — but the pair is still
   * reachable as two separately *selected* filter values, and that pair is
   * reachable and always empty, exactly `OWNERSHIP: SHARED` + `PERSON: ELS`
   * is (S4, `passesFilters`). Not guarded, for the same reason: one filter
   * rule, and `0 OF N` is the honest answer.
   *
   * `pinned` is what makes {@link dimensionValues} draw the sentinel first
   * regardless of its count — plain count-descending would not: a real
   * Trip's `systemIdSource` id is hex, and every hex digit sorts *before*
   * the letter `n`, so a tied or busier Trip would otherwise outrank the
   * literal string `'none'`.
   */
  trip: {
    id: 'trip',
    label: 'TRIP',
    // Several Trip chips AND together, so the ghost `+ TRIP` stays while one
    // is active — Tag's arity, not Kind's.
    arity: 'multi',
    valuesOf: (gear, state) => {
      const trips = tripMembershipOf(state).get(gear.id)
      return trips === undefined || trips.length === 0
        ? [NOT_IN_ANY_TRIP]
        : trips
    },
    // Checked first: `NOT_IN_ANY_TRIP` is a reserved word, not a Trip id, so
    // it must never reach `state.trips` lookup. A Trip id this replica has
    // not folded yet (a peer's `trip.entry_added` arriving before its
    // `trip.created`) falls back to `tripLabel`'s own glyph — the same `—`
    // `dimension('person')` draws for a Person whose op has not arrived.
    format: (value, state) => {
      if (value === NOT_IN_ANY_TRIP) return 'NOT IN ANY TRIP'
      const trip = state.trips[value]
      return trip === undefined ? UNNAMED_TRIP_GLYPH : tripLabel(trip)
    },
    pinned: NOT_IN_ANY_TRIP,
  },
}

export function dimension(id: DimensionId): Dimension {
  return DIMENSION_TABLE[id]
}

export const DIMENSIONS: readonly Dimension[] = Object.values(DIMENSION_TABLE)

/** One value a dimension offers, and how much visible gear carries it. */
export interface DimensionValue {
  value: string
  count: number
}

/**
 * What a dimension can be narrowed **by**, right now — derived from the
 * visible depot rather than declared anywhere.
 *
 * For Tag that is the literal design rule: **there is no Tag entity**, the
 * vocabulary is whatever is currently applied, and there is no rename
 * (`docs/design/README.md` §4a). For Kind it happens to be the same
 * mechanism, and gives the tolerant reader's unrecognised values somewhere to
 * appear for free.
 *
 * **Count descending, then value ascending.** Descending-count because the
 * most-used value is the one most likely to be wanted, and it is the order
 * both boards draw (`#winter 23 · #cooking 14 · #sleep 9`). The
 * `#cook-set` / `#cooking` pair is what settles it as count-first rather than
 * alphabetical: `cook-set` sorts *before* `cooking`, yet is drawn second.
 * The ascending tiebreak makes the order **total**, which is what stops two
 * devices with identical state drawing the picker differently.
 *
 * Retired gear contributes nothing, for the same reason it contributes
 * nothing to {@link depotCounts}: this is the vocabulary for slicing the
 * *visible* depot. A non-conforming tag is offered exactly as it was folded —
 * the register key is the literal string that arrived (§5), and hiding it
 * would leave a Quartermaster unable to remove the tag they can plainly see
 * on the gear.
 *
 * **A dimension's `pinned` value sorts first, whatever its count** — the
 * boards' Loose-first rule, and {@link Dimension.pinned}'s whole reason to
 * exist. `trip` pins `NOT_IN_ANY_TRIP`: it is not a fact about gear the way
 * a Trip id is, it is that dimension's one reserved word, and it needs a
 * fixed position because a real Trip's `systemIdSource` id (hex) sorts
 * *before* the literal string `'none'` — the generic ascending tiebreak
 * alone would put a tied or busier Trip ahead of the sentinel. No dimension
 * without a `pinned` value is affected: the check is on the *value*
 * `dimension(id).pinned` names, never on `id` itself, which is what keeps a
 * sixth dimension's row an addition rather than a new branch here.
 */
export function dimensionValues(
  state: DepotState,
  id: DimensionId,
): readonly DimensionValue[] {
  const of = dimension(id)
  const counts = new Map<string, number>()
  for (const gear of visibleGear(state)) {
    for (const value of of.valuesOf(gear, state)) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  const values = [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count
      if (a.value === b.value) return 0
      return a.value < b.value ? -1 : 1
    })
  if (of.pinned === undefined) return values
  const pinnedIndex = values.findIndex((v) => v.value === of.pinned)
  if (pinnedIndex <= 0) return values
  const pinned = values[pinnedIndex]!
  return [
    pinned,
    ...values.slice(0, pinnedIndex),
    ...values.slice(pinnedIndex + 1),
  ]
}

/** One narrowing, as a screen holds it. */
export interface SliceSpec {
  search: string
  /** Selected values per dimension. An absent or empty list does not narrow. */
  filters: Partial<Record<DimensionId, readonly string[]>>
  sort: SortKey
  group: GroupKey
}

/**
 * The resting state: nothing narrowed, `NAME A→Z`, ungrouped.
 *
 * Sort and group persist per device; filters and search reset on a fresh
 * start (`docs/design/README.md` §3), so this is what a screen starts from
 * and what `CLEAR (n)` returns the filters to.
 */
export const EMPTY_SLICE: SliceSpec = {
  search: '',
  filters: {},
  sort: 'name-asc',
  group: 'none',
}

export interface SliceGroup {
  /** The dimension value this group holds; `''` when grouping is off. */
  key: string
  /** The group header's text; `''` when grouping is off. */
  label: string
  gear: readonly GearState[]
}

export interface SliceResult {
  /** Empty when nothing survived — one group, unlabelled, when ungrouped. */
  groups: readonly SliceGroup[]
  /** The `9` in `9 OF 128`: what survived search and filters. */
  shown: number
  /** The `128`: every visible piece of gear, however narrow the slice. */
  total: number
  /** What `CLEAR (n)` counts — selected values, plus a typed search. */
  active: number
}

/** Every register a gear carries, tags included. */
function registersOf(gear: GearState): Register<unknown>[] {
  const own = [
    gear.name,
    gear.container,
    gear.kind,
    gear.residence,
    gear.ownedCount,
    gear.owner,
    gear.retired,
  ].filter((register) => register !== undefined)
  return [...own, ...Object.values(gear.tags ?? {})]
}

/**
 * When this gear was recorded — the earliest `(hlc, deviceId)` any of its
 * registers carries, which is the clock of the op that first addressed it.
 *
 * **There is no `createdAt`**, and deliberately so. Three options were
 * weighed:
 *
 * 1. A `recordedAt` register seeded by `gear.recorded` — rejected: it
 *    duplicates a fact the envelope already carries, and it would be absent
 *    on every piece of gear recorded before S3, so the sort would be wrong
 *    for the only depot that exists.
 * 2. `gear.container`'s stamp — it is the one register with no mutation op
 *    (`sync-protocol.md` §4.3), so its clock *is* the recording clock.
 *    Rejected: it is absent whenever a tolerant read dropped the field, and
 *    it silently ties the sort to an omission the catalogue records as
 *    deliberate.
 * 3. This.
 *
 * It needs no new field, no new op and no migration; it is correct for gear
 * recorded before this slice; it is **identical on every replica**, because
 * the registers are; and a later edit can never lower it, because a register
 * only ever accepts a strictly later write. Tag registers count like any
 * other — excluding them would make the answer depend on which dimensions
 * happened to exist when the gear was recorded.
 */
export function recordedAt(gear: GearState): Stamp {
  let earliest: Stamp | undefined
  for (const register of registersOf(gear)) {
    const stamp = stampOf(register)
    if (earliest === undefined || compareStamps(stamp, earliest) < 0) {
      earliest = stamp
    }
  }
  // Only reachable for a `GearState` with no registers at all, which the
  // reducer cannot produce — every handler writes one before creating the
  // entity. The zero stamp keeps the sort total rather than throwing.
  return earliest ?? { hlc: '', deviceId: '' }
}

function nameOf(gear: GearState): string {
  return gear.name?.value ?? ''
}

/**
 * **One rule, and deliberately the only one: every selected value must be
 * carried.** That is the board's `SEARCH + FILTERS COMBINE WITH AND`, stated
 * once, and it has three consequences worth naming:
 *
 * - **Several tag chips AND together** — `#winter` + `#sleep` returns gear
 *   carrying both, which is what Components §04 specifies.
 * - **A single-arity dimension degenerates to equality**, because one
 *   selected value being carried *is* `kind === value`. No special case.
 * - **A dimension with nothing selected is skipped**, rather than made into
 *   a predicate matching everything.
 * - **Two dimensions over one register can contradict, and nothing here
 *   stops them.** `OWNERSHIP: SHARED` plus `PERSON: ELS` is reachable and
 *   structurally empty — S4 added both because the boards drew both. That is
 *   the same shape as `KIND: COUNTED` plus a tag no counted gear carries: the
 *   count line reads `0 OF 128`, which is the honest answer, and `CLEAR (2)`
 *   is story 13's undo one tap away. The only fix would be a second
 *   combinator *between* dimensions, and there is deliberately exactly one
 *   rule in this function.
 */
function passesFilters(
  gear: GearState,
  state: DepotState,
  filters: SliceSpec['filters'],
): boolean {
  for (const [id, selected] of Object.entries(filters)) {
    if (selected === undefined || selected.length === 0) continue
    const carried = new Set(dimension(id as DimensionId).valuesOf(gear, state))
    for (const value of selected) {
      if (!carried.has(value)) return false
    }
  }
  return true
}

function sortGear(
  gear: readonly GearState[],
  sort: SortKey,
): readonly GearState[] {
  // `visibleGear` already sorts by name, ascending and totally.
  if (sort === 'name-asc') return gear
  // The exact reverse of a total order is a total order — including the id
  // tiebreak, which reverses with it. `Z→A` all the way down.
  if (sort === 'name-desc') return [...gear].reverse()
  return [...gear].sort((a, b) => {
    const byStamp = compareStamps(recordedAt(b), recordedAt(a))
    if (byStamp !== 0) return byStamp
    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  })
}

/** The group gear with no value in the grouping falls into — reachable for
 * `kind` only, and there only from a peer on a different build. Sorted last
 * rather than by its label, which is a dash and would sort somewhere
 * arbitrary. `owner` never produces it: an absent register reads shared.
 *
 * Exported for `GearListSection` (S7): its own "Kind this replica cannot
 * resolve" bucket borrows this glyph rather than a second hardcoded `'—'`,
 * so the two ungrouped-tail treatments in this codebase read as one
 * decision rather than two coincidentally identical strings. */
export const UNGROUPED_LABEL = '—'

/**
 * **A grouping is a row in a table too** — but a *different* table from
 * {@link Dimension}, and the difference is load-bearing.
 *
 * A dimension answers *which values does this gear carry*, and is allowed to
 * answer "several" (Tag) or "none" (Person, for shared gear). A grouping
 * answers *which single bucket does this gear fall into*, which is a
 * partition.
 *
 * S4's `owner` is why the two tables are not one. It groups by the `owner`
 * **register**, which neither of S4's filter dimensions does alone: grouping
 * by `person` would file every shared piece of gear into the `—` bucket, and
 * grouping by `ownership` would give two coarse groups and never name a
 * Person. The partition the boards' segmented control wants is the
 * register's.
 */
interface Grouping {
  id: Exclude<GroupKey, 'none'>
  /** The segmented control's label: `KIND`, `OWNER`. */
  label: string
  /** This gear's single bucket, or `undefined` for the `—` bucket. */
  keyOf(gear: GearState, state: DepotState): string | undefined
  /** The group header's text. */
  format(key: string, state: DepotState): string
  /**
   * A key that sorts before every other group whatever its label.
   *
   * `owner` pins `shared`, because `Shared` is not a name: filing it between
   * `Mark` and `Zoe` reads as a bug rather than as an ordering. Same
   * reasoning that pins `Loose` to the top of the Home picker's rows — the
   * pseudo-value meaning "belongs to no one in particular" is the list's
   * spine, not an entry in it. The order stays **total**, which is what stops
   * two devices with identical state drawing the list differently.
   */
  pinned?: string
}

const GROUPING_TABLE: Readonly<Record<Exclude<GroupKey, 'none'>, Grouping>> = {
  kind: {
    id: 'kind',
    label: 'KIND',
    keyOf: (gear) => gear.kind?.value,
    format: (key, state) => dimension('kind').format(key, state),
  },
  owner: {
    id: 'owner',
    label: 'OWNER',
    // Never `undefined`: an absent register reads shared, so every piece of
    // gear has a bucket and the `—` group is unreachable here.
    keyOf: (gear) => {
      const owner = ownerOf(gear)
      return owner.type === 'shared' ? 'shared' : owner.personId
    },
    format: (key, state) =>
      key === 'shared' ? 'Shared' : personLabel(state, key),
    pinned: 'shared',
  },
}

/** What `GROUP BY` offers, in the order the segmented control draws them. */
export const GROUP_KEYS: readonly GroupKey[] = ['none', 'kind', 'owner']

/** The segmented control's label for one key. `NONE` has no table row. */
export function groupLabel(key: GroupKey): string {
  return key === 'none' ? 'NONE' : GROUPING_TABLE[key].label
}

function groupGear(
  gear: readonly GearState[],
  state: DepotState,
  group: GroupKey,
): readonly SliceGroup[] {
  if (gear.length === 0) return []
  if (group === 'none') return [{ key: '', label: '', gear }]

  const of = GROUPING_TABLE[group]
  const buckets = new Map<string, GearState[]>()
  const ungrouped: GearState[] = []
  for (const item of gear) {
    const key = of.keyOf(item, state)
    if (key === undefined) {
      ungrouped.push(item)
      continue
    }
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [item])
    else bucket.push(item)
  }

  const groups = [...buckets]
    .map(([key, items]) => ({
      key,
      label: of.format(key, state),
      gear: items,
    }))
    // The pinned key first; then alphabetically by **label** — for Kind that
    // is `Counted · Per-person · Single`, which is what the board's grouped
    // frame draws and is not the enum's order. Case-insensitive so an
    // unrecognised lowercase value files sensibly rather than after every
    // recognised one.
    .sort((a, b) => {
      if (a.key === of.pinned) return b.key === of.pinned ? 0 : -1
      if (b.key === of.pinned) return 1
      const al = a.label.toLowerCase()
      const bl = b.label.toLowerCase()
      if (al !== bl) return al < bl ? -1 : 1
      return a.key < b.key ? -1 : 1
    })

  return ungrouped.length === 0
    ? groups
    : [...groups, { key: '', label: UNGROUPED_LABEL, gear: ungrouped }]
}

/**
 * Narrow, sort, group — in that order, because sorting what was thrown away
 * is waste and grouping what was not yet sorted loses the order inside each
 * group.
 *
 * Pure, and a fold of local state like every other selector here: there is
 * nothing for the network to be in the way of.
 */
export function sliceDepot(state: DepotState, spec: SliceSpec): SliceResult {
  const all = visibleGear(state)
  // The same fold `selectors/find.ts` applies to a query — two search fields
  // in one app disagreeing about whether `Ölzeug` matches `olzeug` is a bug
  // waiting to be filed.
  const needle = foldText(spec.search.trim())

  const shown = all
    .filter((gear) => needle === '' || foldText(nameOf(gear)).includes(needle))
    .filter((gear) => passesFilters(gear, state, spec.filters))

  const selectedValues = Object.values(spec.filters).reduce(
    (sum, values) => sum + (values?.length ?? 0),
    0,
  )

  return {
    groups: groupGear(sortGear(shown, spec.sort), state, spec.group),
    shown: shown.length,
    total: all.length,
    // `CLEAR (n)` "stays visible while **anything** narrows" (Components
    // §04), so a typed search counts alongside the chips — and CLEAR returns
    // both to `EMPTY_SLICE`.
    active: selectedValues + (needle === '' ? 0 : 1),
  }
}
