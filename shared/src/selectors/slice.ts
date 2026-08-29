import { compareStamps, type Stamp } from '../hlc.ts'
import { stampOf, type Register } from '../registers.ts'
import type { DepotState, GearState } from '../state.ts'
import { foldText } from '../text.ts'
import { tagsOf, visibleGear } from './depot.ts'
import { ownerOf, personLabel } from './owner.ts'

/**
 * **The slicing engine** — story 13's "narrow, sort, and group lists by at
 * least: Tag, Person, Ownership, Kind, Packing status, Container, and Trip
 * membership", built **once**, here.
 *
 * [Architecture §8.5](../../docs/architecture-design.md) is the constraint
 * that shapes this file. Story 13's core lands at S3 carrying the only two
 * dimensions that exist — Tag and Kind — and five later slices each extend
 * *this* engine with the dimension they introduce, as part of their own
 * definition of done rather than as a follow-up:
 *
 * | Dimension | Arrives with |
 * | --- | --- |
 * | Tag; Kind | S3 |
 * | Ownership; Person | **S4** |
 * | Trip membership | S7 |
 * | Per-Person grouping of Pieces | S8 |
 * | Packing status; Container | S9 |
 * | Outcome | S10 |
 *
 * So a dimension is a **row in a table**, never a branch in a predicate. That
 * is the whole design, and story 34 (a saved slice, Later) attaching with no
 * structural change is the test that it was built at the right altitude.
 */

/**
 * Every dimension a list can be narrowed by. Widened, never restructured, by
 * each slice in the table above.
 */
export type DimensionId = 'tag' | 'kind' | 'ownership' | 'person'

/** Components §04's three keys at S3. `newest` is by when gear was recorded. */
export type SortKey = 'name-asc' | 'name-desc' | 'newest'

/**
 * `NONE · KIND`, and **never TAG** — deliberate, and a domain fact rather
 * than a UI preference: tags are multi-valued, so a three-tag piece of gear
 * would land in three groups and the groups would not partition the list.
 * Slicing by tag is the filter's job.
 */
export type GroupKey = 'none' | 'kind'

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
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count
      if (a.value === b.value) return 0
      return a.value < b.value ? -1 : 1
    })
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

/** The group gear with no `kind` register falls into. Reachable only from a
 * peer on a different build; sorted last rather than by its label, which is
 * a dash and would sort somewhere arbitrary. */
const UNGROUPED_LABEL = '—'

function groupGear(
  gear: readonly GearState[],
  state: DepotState,
  group: GroupKey,
): readonly SliceGroup[] {
  if (gear.length === 0) return []
  if (group === 'none') return [{ key: '', label: '', gear }]

  const buckets = new Map<string, GearState[]>()
  const unkinded: GearState[] = []
  for (const item of gear) {
    const kind = item.kind?.value
    if (kind === undefined) {
      unkinded.push(item)
      continue
    }
    const bucket = buckets.get(kind)
    if (bucket === undefined) buckets.set(kind, [item])
    else bucket.push(item)
  }

  const format = dimension('kind').format
  const groups = [...buckets]
    .map(([key, items]) => ({ key, label: format(key, state), gear: items }))
    // Alphabetically by **label** — `Counted · Per-person · Single` — which
    // is what the board's grouped frame draws, and is not the enum's order.
    // Case-insensitive so an unrecognised lowercase kind files sensibly
    // rather than after every recognised one.
    .sort((a, b) => {
      const al = a.label.toLowerCase()
      const bl = b.label.toLowerCase()
      if (al !== bl) return al < bl ? -1 : 1
      return a.key < b.key ? -1 : 1
    })

  return unkinded.length === 0
    ? groups
    : [...groups, { key: '', label: UNGROUPED_LABEL, gear: unkinded }]
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
