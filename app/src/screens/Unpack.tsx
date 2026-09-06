import {
  bringCountOf,
  containmentView,
  countOfUnpack,
  entriesOf,
  entryKind,
  entryLabel,
  isContainerEntry,
  ownerLabel,
  personBuckets,
  personNameOrUnnamed,
  returnPathOf,
  subtreeOf,
  tripContainmentView,
  tripLabel,
  unpackDestinationOf,
  unpackItems,
  unpackTotals,
  visiblePlaces,
  type ContainmentView,
  type EntryState,
  type GearState,
  type HouseholdState,
  type OutcomeValue,
  type TripContainmentView,
  type TripState,
  type UnpackCount,
  type UnpackItem,
} from '@foerier/shared'
import {
  PersonCircle,
  SegmentedControl,
  type PersonClusterEntry,
  type SegmentedOption,
} from '@foerier/ui'
import { useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'wouter'

import { circleToneForOutcome, OutcomeSheet } from '../components/OutcomeSheet'
import { UnpackRow } from '../components/UnpackRow'
import { personInitial } from '../household/people'
import { useHousehold } from '../household/store'
import {
  openLabel,
  peopleOn,
  resolvedLabel,
  resolvedPercent,
  tripParticipants,
} from '../household/trips'
import { ScreenBand } from '../shell/ScreenBand'
import { useScreenHeader } from '../shell/useMediaQuery'
import styles from './Unpack.module.css'

/** `unpackTotals`' zero — the fold has nothing to fold before a Trip is
 * resolved, so the pre-guard memo below has an answer to hand back that is
 * not `unpackTotals` called on `undefined`. Never drawn: the guard below
 * returns before this value would reach the JSX. */
const EMPTY_COUNT: UnpackCount = {
  resolved: 0,
  total: 0,
  open: 0,
  back: 0,
  consumed: 0,
  lost: 0,
}

/** Task 14 wires the Home picker onto this target; every mode's rows exist
 * before that sheet does, so the callback is a stated no-op rather than an
 * invented behaviour. `onOutcome` is Task 12's own — see {@link Unpack}'s
 * `openOutcome`. */
function noop(): void {
  // Wired by Task 14 (`onReHome`).
}

/** One row this task draws — `UnpackRow`'s props, minus the callbacks. */
interface UnpackRowData {
  readonly entryId: string
  readonly name: string
  readonly meta: string
  /** `null` for a cluster row — unread there (`UnpackRow`'s own docstring):
   * a per-person Entry's outcome is per-Piece, and `cluster`'s own tones and
   * `resolved`/`total` are what state it, `visibleRows`' own open filter
   * included. */
  readonly outcome: OutcomeValue | null
  readonly tripOnly?: boolean
  /** Task 13's 34px cluster, for a per-person, non-container Entry —
   * DESTINATION and ALL mode's own right-slot (F7); PERSON mode never sets
   * this, since its own Piece rows carry their own pill. */
  readonly cluster?: {
    readonly people: readonly PersonClusterEntry[]
    readonly resolved: number
    readonly total: number
  }
}

/** One of F3's groups — a room, `Loose`, or the closing `Trip-only` group;
 * also PERSON mode's own groups (a Person, or the closing `Shared`), which
 * share this exact shape (`docs/design/README.md` §7, ruling F4). */
interface UnpackGroup {
  readonly key: string
  readonly name: string
  readonly subtitle?: string
  readonly muted?: boolean
  /** `4/5` for a room or `Loose`; `7/9 · 2 OPEN` for a PERSON-mode group
   * (F4); a plain count for `Trip-only`, which has no outcomes to fraction. */
  readonly countLabel: string
  /** `Trip-only`'s count is history, not arithmetic — one step fainter than
   * a room's or `Loose`'s `resolved/units` (`Unpack.module.css`'s
   * `.groupCountFaint`). */
  readonly countFaint?: boolean
  /**
   * PERSON mode's own header shape (§03's excerpt): the name sits beside a
   * 28px circle rather than alone. `true` for every PERSON-mode group,
   * `Shared` included — `Packing.tsx`'s own `.personLine` precedent, where
   * `Shared` still takes the wrapper and simply draws no circle inside it.
   * Absent for DESTINATION's groups, which keep their plain name span.
   */
  readonly isPersonGroup?: boolean
  /** The circle itself — absent for `Shared`, which is an attribution's
   * absence rather than a Person (`ownerLabel`'s own word for it). */
  readonly circle?: ReactNode
  readonly rows: readonly UnpackRowData[]
}

const NO_GROUPS: readonly UnpackGroup[] = []

/** DESTINATION · PERSON · ALL — F4's segmented control, `useState` rather
 * than a route param (F4's own answer one slice earlier, `Packing.tsx`'s
 * `PackingMode`). */
type UnpackMode = 'destination' | 'person' | 'all'

const MODES: readonly SegmentedOption<UnpackMode>[] = [
  { value: 'destination', label: 'DESTINATION' },
  { value: 'person', label: 'PERSON' },
  { value: 'all', label: 'ALL' },
]

/** The screen's one hint (spec §4.2, ruling F4/F5) — the whole of its
 * instruction, read once above the groups rather than at their foot. */
const HINT = 'TAP PILL = OUTCOME · TAP CIRCLES = PER PERSON · TAP ROW = RE-HOME'

/** `Shared`'s own meta in PERSON mode — `Packing.tsx`'s `NOT_ATTRIBUTED`
 * verbatim: the identical fact (A7's rule 3, drawn last) on a sibling
 * screen, not a fresh string. */
const NOT_ATTRIBUTED = 'NOT ATTRIBUTED TO A PERSON'

/**
 * The return path meta, in every form DESTINATION mode draws (spec §4.3,
 * ruling F6) — **the caller's job, not `UnpackRow`'s**, so the row stays a
 * component that draws what it is handed rather than a second place these
 * four forms could drift from `unpackItems`' own fields.
 *
 * `destination` decides how much of {@link returnPathOf}'s path is worth
 * repeating: a room's own name is already the group header, so only what
 * sits *inside* it is drawn; the `Loose` bucket states nothing above the
 * row, so a gear resting in a loose container draws its whole path. **Passed
 * in by the caller, not re-derived here** — `destinationGroups` already
 * calls `unpackDestinationOf` once to decide which bucket this Entry falls
 * into, and a second call here over the same {@link ContainmentView} would
 * be exactly the re-derivation this file's own convention forbids, not just
 * a redundant walk.
 *
 * The suffix is one of three, in F1/F9's own precedence: a container's `N
 * INSIDE` first (a container never carries a plain quantity — F1), then a
 * consumed Counted's split (`item.consumed` is non-null only there), then a
 * Counted Entry's plain quantity — gated on {@link bringCountOf}, never on
 * `entryKind(entry, state) === 'counted'`, which is exactly the re-derivation
 * this file's own convention forbids. A Single, an unrecognised Kind and an
 * unsynced Gear all answer `null` there and draw no suffix at all.
 */
function returnPathMeta(
  entry: EntryState,
  state: HouseholdState,
  view: ContainmentView,
  tripView: TripContainmentView,
  container: boolean,
  item: Extract<UnpackItem, { kind: 'entry' }>,
  destination: string | null,
): string {
  const path = returnPathOf(entry, state, view)
  const visible = destination === null ? path : path.slice(1)
  const pathText = visible.map((segment) => segment.name).join(' ▸ ')

  const suffix: string[] = []
  if (container) {
    // **Code-authored, no board draws it, unpinned by a ruling.** An empty
    // container reads `0 INSIDE` — nothing named this case, and nothing
    // forbids it either. `Unpack.test.tsx` pins it as it behaves today
    // rather than inventing a fallback string.
    suffix.push(`${subtreeOf(tripView, entry.id).size} INSIDE`)
  } else if (item.outcome === 'consumed' && item.consumed !== null) {
    // **Code-authored, no board draws it, unpinned by a ruling.**
    // `consumedCountOf` reads an absent register as the **whole**
    // Bring-count (F9: the stepper opens there because "all of it used up
    // is the ordinary case"), so tapping `CONSUMED` and never touching the
    // stepper reads `×N CONSUMED · ×0 BACK` — the **default** rendering,
    // not an edge case. F18 drops a sibling meta's zero segment the other
    // way; `Unpack.test.tsx` pins this one as it behaves today.
    suffix.push(`×${item.consumed} CONSUMED`)
    suffix.push(`×${item.units - item.consumed} BACK`)
  } else if (bringCountOf(entry, state) !== null) {
    suffix.push(`×${item.units}`)
  }

  if (pathText === '') return suffix.join(' · ')
  return [`→ ${pathText}`, ...suffix].join(' · ')
}

/**
 * Task 13's own row — a per-person, non-container Entry's 34px cluster
 * (F7). `pieceItems` is {@link unpackItems}' own piece fan-out for this one
 * Entry, never re-walked from `piecesOf` here: `countOfUnpack`'s
 * `resolved`/`total` and each circle's tone both read the identical items,
 * so the cluster's own accessible name and `PER-PERSON · N/M`'s digits can
 * never disagree about the same Entry.
 *
 * Display order is `tripParticipants`' — `PieceStatusSheet`'s and
 * `PackingRow`'s own rule, restated: a roster is read by name, and
 * `piecesOf`'s id order is only for the fold to agree on.
 */
function personPieceCluster(
  pieceItems: readonly Extract<UnpackItem, { kind: 'piece' }>[],
  trip: TripState,
  state: HouseholdState,
): NonNullable<UnpackRowData['cluster']> {
  const { resolved, total } = countOfUnpack(pieceItems)
  const byPerson = new Map(
    pieceItems.map((item) => [item.personId, item.outcome]),
  )
  const people: PersonClusterEntry[] = tripParticipants(state, trip)
    .filter((person) => byPerson.has(person.id))
    .map((person) => ({
      key: person.id,
      label: personInitial(person.label),
      tone: circleToneForOutcome(byPerson.get(person.id) ?? null),
    }))
  return { people, resolved, total }
}

/**
 * DESTINATION's own suffix for a per-person row — `returnPathMeta`'s
 * path-first grammar, restated: the room header already states the path's
 * root, so only what sits inside it is drawn, and `PER-PERSON · N/M` closes
 * the line exactly where `returnPathMeta`'s own suffixes do (board §01:
 * `→ LADE 2 · PER-PERSON · 3/3`).
 */
function personPieceMeta(
  entry: EntryState,
  state: HouseholdState,
  view: ContainmentView,
  destination: string | null,
  resolved: number,
  total: number,
): string {
  const path = returnPathOf(entry, state, view)
  const visible = destination === null ? path : path.slice(1)
  const pathText = visible.map((segment) => segment.name).join(' ▸ ')
  const suffix = `PER-PERSON · ${resolved}/${total}`
  if (pathText === '') return suffix
  return [`→ ${pathText}`, suffix].join(' · ')
}

/** ALL mode's header-less twin (ruling I1) — suffix first, path last, since
 * no group header states *where* for ALL's own flat list. */
function personPieceHeaderlessMeta(
  entry: EntryState,
  state: HouseholdState,
  view: ContainmentView,
  resolved: number,
  total: number,
): string {
  const path = returnPathOf(entry, state, view)
  const pathText = path.map((segment) => segment.name).join(' ▸ ')
  const suffix = `PER-PERSON · ${resolved}/${total}`
  if (pathText === '') return suffix
  return [suffix, `→ ${pathText}`].join(' · ')
}

/**
 * DESTINATION mode's groups (F3, spec §4.3) — one `containmentView` and one
 * `tripContainmentView`, each built exactly once and handed down to every
 * group, never rebuilt per group (`containerTotals`'s own rule, restated for
 * this screen). Rooms come from {@link visiblePlaces} — the depot's own
 * A→Z-by-name order, converged the identical way across every replica —
 * filtered to the ones this Trip's gear actually returns to; `Loose` and
 * `Trip-only` close the list (F3).
 *
 * **A per-person, non-container Entry draws Task 13's own row** — the 34px
 * cluster, in `rowsFor`'s own branch below. Its units count toward the
 * group's own `resolved/total` header exactly as every other row's do,
 * read from {@link unpackItems} directly rather than from the rows this
 * function renders — `countLabelFor`'s own rule, unchanged by this branch's
 * arrival. An Entry with zero included Pieces (no Participants, or every
 * Piece tombstoned) draws no row at all: there is no roster to open a
 * cluster onto, the identical shape a `kind === 'entry'` row with no item
 * takes two lines below.
 */
function destinationGroups(
  trip: TripState,
  state: HouseholdState,
  view: ContainmentView,
  tripView: TripContainmentView,
): readonly UnpackGroup[] {
  const items = unpackItems(trip, state)
  const itemsByEntry = new Map<string, UnpackItem[]>()
  for (const item of items) {
    const list = itemsByEntry.get(item.entryId)
    if (list === undefined) itemsByEntry.set(item.entryId, [item])
    else list.push(item)
  }

  const entries = entriesOf(trip, state)
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))

  const byPlace = new Map<string, string[]>()
  const looseIds: string[] = []
  const tripOnlyIds: string[] = []

  for (const entry of entries) {
    const kind = entryKind(entry, state)
    if (kind === 'trip_only') {
      tripOnlyIds.push(entry.id)
      continue
    }
    const source = entry.source?.value
    if (source === undefined || source.from !== 'depot') continue

    const destination = unpackDestinationOf(source.gearId, state, view)
    if (destination === null) {
      looseIds.push(entry.id)
      continue
    }
    const list = byPlace.get(destination)
    if (list === undefined) byPlace.set(destination, [entry.id])
    else list.push(entry.id)
  }

  /**
   * `destination` is one value for the whole call — every Entry a single
   * `rowsFor` call draws shares the bucket it was sorted into above, so it
   * is the caller's fact to pass down, not each row's to re-derive.
   */
  function rowsFor(
    entryIds: readonly string[],
    destination: string | null,
  ): UnpackRowData[] {
    const rows: UnpackRowData[] = []
    for (const entryId of entryIds) {
      const entry = entryById.get(entryId)
      if (entry === undefined) continue
      const kind = entryKind(entry, state)
      const container = isContainerEntry(entry, state)

      if (kind === 'per_person' && !container) {
        const entryItems = itemsByEntry.get(entryId) ?? []
        const pieceItems = entryItems.filter(
          (candidate): candidate is Extract<UnpackItem, { kind: 'piece' }> =>
            candidate.kind === 'piece',
        )
        // No included Piece — no roster to open a cluster onto.
        if (pieceItems.length === 0) continue
        const cluster = personPieceCluster(pieceItems, trip, state)
        rows.push({
          entryId,
          name: entryLabel(entry, state),
          meta: personPieceMeta(
            entry,
            state,
            view,
            destination,
            cluster.resolved,
            cluster.total,
          ),
          // Unread by `UnpackRow` once `cluster` is given — see its own
          // docstring — but the field is not optional on `UnpackRowData`.
          outcome: null,
          cluster,
        })
        continue
      }

      const entryItems = itemsByEntry.get(entryId) ?? []
      const item = entryItems.find(
        (candidate): candidate is Extract<UnpackItem, { kind: 'entry' }> =>
          candidate.kind === 'entry',
      )
      if (item === undefined) continue

      rows.push({
        entryId,
        name: entryLabel(entry, state),
        meta: returnPathMeta(
          entry,
          state,
          view,
          tripView,
          container,
          item,
          destination,
        ),
        outcome: item.outcome,
      })
    }
    return rows
  }

  function countLabelFor(entryIds: readonly string[]): string {
    const groupItems = entryIds.flatMap((id) => itemsByEntry.get(id) ?? [])
    const { resolved, total } = countOfUnpack(groupItems)
    return `${resolved}/${total}`
  }

  const groups: UnpackGroup[] = []

  for (const place of visiblePlaces(state)) {
    const entryIds = byPlace.get(place.id)
    if (entryIds === undefined || entryIds.length === 0) continue
    groups.push({
      key: place.id,
      name: place.name?.value ?? '',
      countLabel: countLabelFor(entryIds),
      rows: rowsFor(entryIds, place.id),
    })
  }

  if (looseIds.length > 0) {
    groups.push({
      key: 'loose',
      name: 'Loose',
      subtitle: 'NO HOME SLOT',
      muted: true,
      countLabel: countLabelFor(looseIds),
      rows: rowsFor(looseIds, null),
    })
  }

  if (tripOnlyIds.length > 0) {
    groups.push({
      key: 'trip-only',
      name: 'Trip-only',
      subtitle: 'TAKES NO OUTCOME · CLEARED AT CLOSE',
      muted: true,
      countLabel: String(tripOnlyIds.length),
      countFaint: true,
      rows: tripOnlyIds.map((entryId) => {
        const entry = entryById.get(entryId)
        return {
          entryId,
          name: entry === undefined ? '' : entryLabel(entry, state),
          meta: 'NOT IN DEPOT',
          outcome: null,
          tripOnly: true,
        }
      }),
    })
  }

  return groups
}

/**
 * The depot Gear a **depot** Entry names, or `undefined` for a trip-only
 * Entry, an Entry whose Gear has not reached this replica, or one this
 * function is never asked about (a container's own containing Gear is a
 * different question, `containment.ts`'s). One place rather than the two
 * {@link personGroups} would otherwise repeat — its own ownership segment
 * and `headerlessMeta`'s both need the identical Gear.
 */
function depotGearOf(
  entry: EntryState,
  state: HouseholdState,
): GearState | undefined {
  const source = entry.source?.value
  if (source === undefined || source.from !== 'depot') return undefined
  return state.gear[source.gearId]
}

/**
 * The meta grammar for a **header-less** row — PERSON mode's entry-kind
 * rows and every ALL-mode row (spec §3.4, board §03's excerpt) — `[prefix ·]
 * [suffix] · → PATH`, suffix **before** the path (ruling I1).
 *
 * **This is deliberately not `returnPathMeta`, and the two must not be
 * confused for one another.** DESTINATION's row sits under a room header
 * that already states the path's root segment, so `returnPathMeta` reads
 * `→ PATH · suffix` — path first, because the header already trimmed it and
 * the suffix is the row's own closing fact. Neither PERSON's entry rows nor
 * ALL's rows sit under a header that states anything about *where*, so
 * board §03's own drawn row (`PERSONAL · K · ×1 · → KEES'S ROOM ▸ KAST`) puts
 * the suffix first and the path last — *what happened to the units* before
 * *where it ends up*. F4/spec §3.4 state the same order for ALL
 * (*"meta ending in the return path"*), and it is the only row order this
 * codebase draws outside DESTINATION.
 *
 * **The unit count is unconditional** — `×1` on a Single, unlike
 * `returnPathMeta`'s gate on {@link bringCountOf}. Board §03's own evidenced
 * row is a plain Single reading `×1`, so the header-less grammar states a
 * quantity for everything that is not a container or a consumed split,
 * `PackingRow`'s identical `PERSONAL E · ×1` convention for PERSON/ALL mode
 * one screen over. A container or a consumed split is not on any board here
 * — both reuse F1's `N INSIDE` / F9's split, the one already pinned by
 * `returnPathMeta`'s own tests, restated here in this order rather than
 * called there and re-ordered, since `returnPathMeta` would still put the
 * path first.
 *
 * `prefix` is `personEntryMeta`'s own ownership segment for PERSON mode, or
 * `null` for ALL, which states no ownership at all — ALL is a lookup view
 * over every Entry regardless of whose it is, and drawing an ownership
 * segment nobody asked for there is exactly the arithmetic-nobody-asked-for
 * this codebase already refuses elsewhere.
 */
function headerlessMeta(
  entry: EntryState,
  state: HouseholdState,
  view: ContainmentView,
  tripView: TripContainmentView,
  container: boolean,
  item: Extract<UnpackItem, { kind: 'entry' }>,
  prefix: string | null,
): string {
  const suffix: string[] = []
  if (container) {
    suffix.push(`${subtreeOf(tripView, entry.id).size} INSIDE`)
  } else if (item.outcome === 'consumed' && item.consumed !== null) {
    suffix.push(`×${item.consumed} CONSUMED`)
    suffix.push(`×${item.units - item.consumed} BACK`)
  } else {
    suffix.push(`×${item.units}`)
  }

  const path = returnPathOf(entry, state, view)
  const pathText = path.map((segment) => segment.name).join(' ▸ ')

  const parts: string[] = []
  if (prefix !== null) parts.push(prefix)
  parts.push(...suffix)
  if (pathText !== '') parts.push(`→ ${pathText}`)
  return parts.join(' · ')
}

/**
 * PERSON mode's own ownership segment for an entry-kind row — this
 * codebase's own `PERSONAL K` spelling (`ownerLabel`'s, not the board's
 * `PERSONAL · K`; `owner.ts`'s own note says every screen inherits the
 * function rather than re-deciding it), prefixed onto
 * {@link headerlessMeta}'s grammar. `null` for a Piece row, which has no
 * owner register of its own — only its Entry does — and whose *whose it is*
 * is already stated by the group it sits in, never restated in its meta.
 */
function personEntryMeta(
  entry: EntryState,
  state: HouseholdState,
  view: ContainmentView,
  tripView: TripContainmentView,
  container: boolean,
  item: Extract<UnpackItem, { kind: 'entry' }>,
): string {
  const gear = depotGearOf(entry, state)
  const ownerText = gear === undefined ? 'SHARED' : ownerLabel(state, gear)
  return headerlessMeta(
    entry,
    state,
    view,
    tripView,
    container,
    item,
    ownerText,
  )
}

/**
 * PERSON mode's groups (F4, ruling A7 — *whose it is*, spec §3.4) —
 * {@link personBuckets} (`packing.ts`, ruling R19), parameterised over
 * {@link unpackItems} rather than `packing.ts`'s own `packingItems`. That
 * split is what makes the rule total here: `packingItems` excludes every
 * container (ruling A5 — a container can never be "packed"), while F1 gives
 * a container an *outcome*, so `unpackItems` does not exclude it — a
 * personally-owned container routed through `personPartition`'s own
 * `PackingItem` buckets would never appear in any of them. `personBuckets`
 * itself needed no change to make this true: its rule-2 `owners` map is
 * built from {@link entriesOf}, not from the item list it is handed, so
 * every depot Entry — container included — was already in it.
 *
 * `Shared` is drawn **last** — `Packing.tsx`'s own `personGroups` order,
 * transplanted (`peopleOn`'s label order, with `Shared` appended rather than
 * sorted among the People).
 *
 * A Piece row's name gains the board's `— KEES'S PIECE` suffix
 * (`PackingRow`'s identical convention, `personNameOrUnnamed` never
 * re-derived) and its meta is the **full** return path alone, through
 * {@link headerlessMeta} with no prefix and no suffix computed at all — a
 * Piece is always exactly one unit, so board §03 states nothing beyond
 * *where*. An entry-kind row's meta is {@link personEntryMeta}'s.
 *
 * **A trip-only Entry appears in no PERSON-mode group at all** —
 * code-authored, awaiting a board. `unpackItems` already excludes it
 * (invariant 18) before this function ever sees it, so nothing here decides
 * to drop it; the omission is a *spine* fact, not a partition one, and
 * `personBuckets` widening under ruling R19 does not touch it either way.
 * F4's own board draws a trip-only Entry under `Shared` in PERSON mode, one
 * tap away on the very same Trip DESTINATION mode already shows it on —
 * ruling R20 keeps today's behaviour rather than inventing the placement and
 * the slot treatment (a pill? `CLEARS AT CLOSE` text? Task 13's cluster
 * slot is for a per-person row, which this is not) no board has drawn, and
 * this file's own test pins it so a later task cannot change it silently.
 */
function personGroups(
  trip: TripState,
  state: HouseholdState,
  view: ContainmentView,
  tripView: TripContainmentView,
): readonly UnpackGroup[] {
  const items = unpackItems(trip, state)
  const entries = entriesOf(trip, state)
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))

  function rowFor(item: UnpackItem): UnpackRowData | undefined {
    const entry = entryById.get(item.entryId)
    if (entry === undefined) return undefined

    if (item.kind === 'piece') {
      const path = returnPathOf(entry, state, view)
      const pathText = path.map((segment) => segment.name).join(' ▸ ')
      return {
        // Composite, and deliberately not the bare Entry id: two Pieces of
        // one per-person Entry draw two rows here, and each needs both a
        // unique React key and a unique `UnpackRow` test id — `PackingRow`'s
        // own `${entryId}:${personId}` key, carried into the DOM id too.
        // `onReHome` still reads neither (Task 14). `onOutcome` is wired
        // (Task 13): `Unpack`'s own `openOutcome` takes the part of this key
        // before its first `:`, opens the real Entry it names, and mounts
        // `OutcomeSheet` in its roster variant — spec §4.5's "a Piece row in
        // this mode carries its own pill" is a display fact about *this*
        // row, not a narrower target for the tap, so every Piece's pill on
        // one Entry opens the identical roster, `EVERYONE` selected exactly
        // as the cluster's own tap would leave it.
        entryId: `${item.entryId}:${item.personId}`,
        name: `${entryLabel(entry, state)} — ${personNameOrUnnamed(
          state,
          item.personId,
        ).toUpperCase()}'S PIECE`,
        meta: pathText === '' ? '' : `→ ${pathText}`,
        outcome: item.outcome,
      }
    }

    const container = isContainerEntry(entry, state)
    return {
      entryId: item.entryId,
      name: entryLabel(entry, state),
      meta: personEntryMeta(entry, state, view, tripView, container, item),
      outcome: item.outcome,
    }
  }

  function rowsFor(bucketItems: readonly UnpackItem[]): UnpackRowData[] {
    const rows: UnpackRowData[] = []
    for (const item of bucketItems) {
      const row = rowFor(item)
      if (row !== undefined) rows.push(row)
    }
    return rows
  }

  const buckets = personBuckets(trip, state, items)
  const byPersonId = new Map<string, readonly UnpackItem[]>()
  let sharedItems: readonly UnpackItem[] = []
  for (const bucket of buckets) {
    if (bucket.key.kind === 'shared') sharedItems = bucket.items
    else byPersonId.set(bucket.key.personId, bucket.items)
  }

  const groups: UnpackGroup[] = []

  for (const person of peopleOn(state, [...byPersonId.keys()])) {
    const bucketItems = byPersonId.get(person.id) ?? []
    const { resolved, total, open } = countOfUnpack(bucketItems)
    groups.push({
      key: person.id,
      name: person.label,
      countLabel: `${resolved}/${total} · ${open} OPEN`,
      isPersonGroup: true,
      // `tone` is a constant `control`, **not** `Packing.tsx`'s
      // `done ? 'filled' : 'control'` — no board here draws a "done" state
      // for a PERSON group, and copying that encoding without one would be
      // inventing a fact `§03`'s excerpt never states. Only the `.personLine`
      // / `.circle` **CSS** is a verbatim port (`Unpack.module.css`); this
      // JS decision is not, and the gap is worth a board's ruling one day.
      circle: (
        <PersonCircle
          size={28}
          tone="control"
          label={personInitial(person.label)}
        />
      ),
      rows: rowsFor(bucketItems),
    })
  }

  if (sharedItems.length > 0) {
    const { resolved, total, open } = countOfUnpack(sharedItems)
    groups.push({
      key: 'shared',
      name: 'Shared',
      // Undrawn: no board frame here states `Shared`'s own meta line or its
      // muted name — carried forward from `Packing.tsx`'s `NOT_ATTRIBUTED`
      // and `.looseName` for the identical fact (A7 rule 3), and awaiting a
      // frame of its own.
      subtitle: NOT_ATTRIBUTED,
      countLabel: `${resolved}/${total} · ${open} OPEN`,
      isPersonGroup: true,
      rows: rowsFor(sharedItems),
    })
  }

  return groups
}

/**
 * ALL mode's rows (spec §3.4: *"flat, A→Z, with the return path as the
 * meta's last segment"*, ruling F4) — {@link entriesOf}'s own order, which
 * **is** A→Z (`order.ts`'s `byNameThenId`), with no grouping and so no
 * ownership segment: {@link headerlessMeta} states the whole meta with
 * `prefix: null`, the same header-less grammar PERSON's entry rows use
 * (ruling I1) — suffix before path, unit count unconditional.
 *
 * A per-person, non-container Entry draws Task 13's own row — the 34px
 * cluster, `destinationGroups`' identical branch over the header-less
 * grammar (suffix first, path last). A trip-only Entry draws its ordinary
 * `NOT IN DEPOT` / `CLEARS AT CLOSE` row, exactly as DESTINATION's closing
 * group draws it, but interleaved in name order rather than set apart: ALL
 * has no groups to set it apart *in*.
 */
function allRows(
  trip: TripState,
  state: HouseholdState,
  view: ContainmentView,
  tripView: TripContainmentView,
): readonly UnpackRowData[] {
  const itemByEntry = new Map<string, Extract<UnpackItem, { kind: 'entry' }>>()
  const pieceItemsByEntry = new Map<
    string,
    Extract<UnpackItem, { kind: 'piece' }>[]
  >()
  for (const item of unpackItems(trip, state)) {
    if (item.kind === 'entry') {
      itemByEntry.set(item.entryId, item)
      continue
    }
    const list = pieceItemsByEntry.get(item.entryId)
    if (list === undefined) pieceItemsByEntry.set(item.entryId, [item])
    else list.push(item)
  }

  const rows: UnpackRowData[] = []
  for (const entry of entriesOf(trip, state)) {
    const kind = entryKind(entry, state)
    if (kind === 'trip_only') {
      rows.push({
        entryId: entry.id,
        name: entryLabel(entry, state),
        meta: 'NOT IN DEPOT',
        outcome: null,
        tripOnly: true,
      })
      continue
    }

    const container = isContainerEntry(entry, state)

    if (kind === 'per_person' && !container) {
      const pieceItems = pieceItemsByEntry.get(entry.id) ?? []
      if (pieceItems.length === 0) continue
      const cluster = personPieceCluster(pieceItems, trip, state)
      rows.push({
        entryId: entry.id,
        name: entryLabel(entry, state),
        meta: personPieceHeaderlessMeta(
          entry,
          state,
          view,
          cluster.resolved,
          cluster.total,
        ),
        outcome: null,
        cluster,
      })
      continue
    }

    const item = itemByEntry.get(entry.id)
    if (item === undefined) continue
    rows.push({
      entryId: entry.id,
      name: entryLabel(entry, state),
      meta: headerlessMeta(entry, state, view, tripView, container, item, null),
      outcome: item.outcome,
    })
  }
  return rows
}

/**
 * The `○ OPEN` filter, over one group's rows — a trip-only row is dropped
 * along with a resolved one: it takes no outcome at all (invariant 18) and
 * is never part of {@link unpackTotals}' own arithmetic, so it cannot be
 * *open* in the sense the filter states. Applied identically in DESTINATION
 * and PERSON mode, the two modes with groups; ALL mode's own flat list uses
 * it too, over a bare row array rather than a group's.
 *
 * **A cluster row is open when it is not fully resolved over its Pieces**,
 * never `row.outcome === null` — that field is unread for a cluster row (see
 * `UnpackRowData.outcome`'s own docstring), and Task 13 is what closes the
 * gap the screen's own hint used to name: DESTINATION and ALL now agree
 * with PERSON that a per-person Entry's own open work keeps it visible.
 */
function visibleRows(
  rows: readonly UnpackRowData[],
  openOnly: boolean,
): readonly UnpackRowData[] {
  return openOnly
    ? rows.filter((row) => {
        if (row.tripOnly === true) return false
        if (row.cluster !== undefined) {
          return row.cluster.resolved < row.cluster.total
        }
        return row.outcome === null
      })
    : rows
}

/**
 * One of F3/F4's groups, drawn — DESTINATION's and PERSON's shared shape.
 * **A group whose every row the filter drops renders no header at all**
 * (this task's own rule): a header naming zero rows beneath it is the
 * identical dead-arithmetic the empty screen already refuses, one level
 * down.
 */
function GroupSection({
  group,
  openOnly,
  onOutcome,
}: {
  group: UnpackGroup
  openOnly: boolean
  /** The real Entry id, never a PERSON-mode Piece row's composite key —
   * {@link Unpack}'s `openOutcome` is what tells the two apart. */
  onOutcome: (entryId: string) => void
}) {
  const rows = visibleRows(group.rows, openOnly)
  // A group with **no rows to begin with** (every per-person Entry in it has
  // zero included Pieces — no roster to open a cluster onto) still renders
  // its header — Task 10's own `Hal 0/1` case, pinned by its own test. Only
  // a group the filter itself emptied is withheld.
  if (group.rows.length > 0 && rows.length === 0) return null

  const headingId = `unpack-group-${group.key}`

  return (
    <section className={styles['group']} aria-labelledby={headingId}>
      <div className={styles['groupHeader']} data-testid="unpack-group-header">
        <div className={styles['headerMain']}>
          {group.isPersonGroup === true ? (
            <span className={styles['personLine']}>
              {/* `Shared` draws the wrapper and no circle inside it —
                  `Packing.tsx`'s own `.personLine` precedent: an
                  attribution's absence is not a Person to draw a ring for. */}
              {group.circle !== undefined && (
                <span aria-hidden="true" className={styles['circle']}>
                  {group.circle}
                </span>
              )}
              {/* `mutedName` on `Shared` (no circle) — undrawn, carried
                  forward from `Packing.tsx`'s `.looseName` for the identical
                  fact and awaiting a frame of its own, exactly as
                  `NOT_ATTRIBUTED` is above. */}
              <span
                id={headingId}
                className={`${styles['groupName']} ${
                  group.circle === undefined ? styles['mutedName'] : ''
                }`}
                data-testid="unpack-group-name"
              >
                {group.name}
              </span>
            </span>
          ) : (
            <span
              id={headingId}
              className={`${styles['groupName']} ${
                group.muted === true ? styles['mutedName'] : ''
              }`}
              data-testid="unpack-group-name"
            >
              {group.name}
            </span>
          )}
          {group.subtitle !== undefined && (
            <span className={styles['groupMeta']}>{group.subtitle}</span>
          )}
        </div>
        <span
          className={`${styles['groupCount']} ${
            group.countFaint === true ? styles['groupCountFaint'] : ''
          }`}
        >
          {group.countLabel}
        </span>
      </div>

      <ul className={styles['rows']}>
        {rows.map((row) => (
          <li key={row.entryId}>
            <UnpackRow
              entryId={row.entryId}
              name={row.name}
              meta={row.meta}
              outcome={row.outcome}
              onOutcome={() => onOutcome(row.entryId)}
              onReHome={noop}
              // `exactOptionalPropertyTypes`: an *omitted* prop and one
              // present-and-`undefined` are different types, exactly
              // `PersonCluster`'s own `tone`-spread note.
              {...(row.cluster === undefined ? {} : { cluster: row.cluster })}
              tripOnly={row.tripOnly ?? false}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * **F5 — Unpack's shell, and Task 10's DESTINATION mode** (`docs/design/
 * README.md` §7, spec `docs/specs/2026-09-05-unpack-resolve-and-close.md`
 * §4.1–§4.3). This task adds the groups, `UnpackRow` and the four outcome
 * pills over the shell Task 9 built. The segmented control, the `○ OPEN`
 * filter, the hint, the three sheets, the over-claim band and the close card
 * are every one of them a later task's scope and deliberately absent here —
 * PERSON and ALL mode are Task 11's, so this always renders DESTINATION.
 *
 * ## Its own route at every width, and reachable at every phase
 *
 * `Packing.tsx`'s own reasoning, restated for F5's route: F5 has no detail
 * pane to unlock at a wider viewport, and a phase locks nothing (invariant
 * 16), so hiding this route at any phase would be the soft lock the phase
 * model forbids.
 *
 * ## Every hook above the `No such trip.` guard
 *
 * `Packing.tsx`'s and `Trip.tsx`'s rule, for the identical reason (S7 review
 * F2): a control reachable against an unknown `tripId` would author an op
 * materialising a Trip no delete op can remove before S14.
 *
 * ## The back link survives Desktop
 *
 * `useScreenHeader({ splitPane: false, atDesktopSidebarCarriesDestination:
 * false })` — `Packing`'s own answer and the same reason: the 216px sidebar
 * names the Trips list, not this Trip, so the destination this screen's back
 * link points at is never already on the page.
 */
export function Unpack() {
  const params = useParams<{ id: string }>()
  const tripId = params.id
  const state = useHousehold((depot) => depot.state)
  const sync = useHousehold((depot) => depot.sync)
  const header = useScreenHeader({
    splitPane: false,
    // See the docstring: the sidebar carries `TRIPS`, never one Trip's name,
    // so this screen's own back link is owed at Desktop too.
    atDesktopSidebarCarriesDestination: false,
  })

  // The two controls' own state, `Packing.tsx`'s `mode`/`leftOnly` twins:
  // `mode` chooses which of the three partitions draws, `openOnly` filters
  // `outcome === null` in all three. `useState`, not a route param — F4's
  // own answer one slice earlier.
  const [mode, setMode] = useState<UnpackMode>('destination')
  const [openOnly, setOpenOnly] = useState(false)

  // The outcome sheet's own open state (Task 12) — `ui/`'s primitives have
  // no `open` prop, so `null` is closed and a real Entry id is open, and
  // mount is what resets the sheet exactly as `PhaseSheet`'s own `reopenTo`/
  // `activating` do. Holds the **real** Entry id only.
  const [outcomeEntryId, setOutcomeEntryId] = useState<string | null>(null)

  const trip = tripId === undefined ? undefined : state.trips[tripId]

  /**
   * **Task 13's own closer.** A DESTINATION/ALL row hands its own real
   * Entry id, unchanged. A PERSON-mode Piece row hands its composite
   * `${entryId}:${personId}` key instead — {@link personGroups}' own `rowFor`
   * mints it because two Pieces of one per-person Entry need two distinct
   * React keys and `UnpackRow` test ids in that mode — and this function is
   * the one place that key is ever read: it takes the part before the first
   * `:` (a UUID never contains one) and opens the identical Entry the
   * cluster would, in its roster variant, regardless of which Piece's own
   * pill was tapped. Spec §4.5's own sentence is why that is right rather
   * than a narrower "just this Piece" sheet: *"In PERSON mode a Piece row
   * carries its own pill … so the cluster is DESTINATION and ALL mode's"* —
   * a display fact about the row, not a different target for the tap. The
   * `personId` half of the key is intentionally discarded here: the roster
   * always opens with `EVERYONE` selected, never narrowed to the Piece whose
   * pill happened to be tapped.
   */
  function openOutcome(rowKey: string): void {
    const separator = rowKey.indexOf(':')
    const entryId = separator === -1 ? rowKey : rowKey.slice(0, separator)
    if (trip?.entries?.[entryId] === undefined) return
    setOutcomeEntryId(entryId)
  }

  const totals = useMemo<UnpackCount>(
    () => (trip === undefined ? EMPTY_COUNT : unpackTotals(trip, state)),
    [trip, state],
  )

  // One view of each kind, built once per fold and handed down to every
  // group — never one per group (`containerTotals`'s own rule).
  const view = useMemo<ContainmentView>(() => containmentView(state), [state])
  const tripView = useMemo<TripContainmentView | undefined>(
    () => (trip === undefined ? undefined : tripContainmentView(trip, state)),
    [trip, state],
  )

  // All three modes' groups/rows, folded once — `Packing.tsx`'s
  // `packingView` precedent: switching modes is a tap on a segmented
  // control and must not pay for a re-derivation.
  const destinationRows = useMemo<readonly UnpackGroup[]>(
    () =>
      trip === undefined || tripView === undefined
        ? NO_GROUPS
        : destinationGroups(trip, state, view, tripView),
    [trip, state, view, tripView],
  )
  const personRows = useMemo<readonly UnpackGroup[]>(
    () =>
      trip === undefined || tripView === undefined
        ? NO_GROUPS
        : personGroups(trip, state, view, tripView),
    [trip, state, view, tripView],
  )
  const allEntryRows = useMemo<readonly UnpackRowData[]>(
    () =>
      trip === undefined || tripView === undefined
        ? []
        : allRows(trip, state, view, tripView),
    [trip, state, view, tripView],
  )

  if (tripId === undefined || trip === undefined) {
    return (
      <div className={styles['screen']}>
        <p className={styles['missing']}>No such trip.</p>
      </div>
    )
  }

  // `entriesOf` counts lines, which is what `0 ENTRIES.` says — F19's empty
  // register, `Packing.tsx`'s own reasoning transplanted: a Trip holding only
  // a trip-only Entry has a real `0/0` in `totals` and is not an empty list.
  const empty = entriesOf(trip, state).length === 0

  // The sheet's own Entry, re-read from `trip` fresh on every render — never
  // cached across a tap, so a second render after an op lands hands the
  // sheet the Entry it just wrote (`OutcomeSheet`'s own docstring on why
  // `PhaseSheet`'s "close after every write" is not this sheet's model).
  const outcomeEntry =
    outcomeEntryId === null ? undefined : trip.entries?.[outcomeEntryId]

  // The caller's own fact (`OutcomeSheet`'s own docstring on `roster`): a
  // per-person, non-container Entry always opens the roster variant,
  // whichever of the cluster (DESTINATION/ALL) or PERSON mode's own pill
  // opened it — `openOutcome` resolves both to this one real Entry id.
  const outcomeIsRoster =
    outcomeEntry !== undefined &&
    entryKind(outcomeEntry, state) === 'per_person' &&
    !isContainerEntry(outcomeEntry, state)

  return (
    <div className={styles['screen']}>
      <ScreenBand
        header={header}
        back={{ href: `/trips/${tripId}`, label: tripLabel(trip) }}
        sync={sync}
        syncTestId="unpack-sync"
      />

      <h1 className={styles['title']}>Unpack</h1>

      {empty ? (
        // F19, `Packing.tsx`'s empty region word for word: a domain fact, not
        // a promise. The count line and the bar are absent, not zeroed — a
        // later task's controls, hint and close card go with them, for the
        // identical dead-affordance reason F4 already argues.
        <section className={styles['empty']}>
          <p className={styles['emptyCount']}>0 ENTRIES.</p>
          <p className={styles['emptySource']}>
            The gear list is built from the depot.
          </p>
        </section>
      ) : (
        <>
          <div className={styles['counts']}>
            {/* Composed by `resolvedLabel`/`openLabel` (`household/trips.ts`)
                rather than here, for `packedLabel`'s own reason: a later task
                reuses these two, and two spellings of `● 56/62 RESOLVED`
                is exactly the drift this codebase refuses. */}
            <span className={styles['resolved']}>{resolvedLabel(totals)}</span>
            <span className={styles['open']}>{openLabel(totals)}</span>
          </div>

          {/* `aria-hidden`, because the line immediately above states the
              identical fact in words and in the ledger's own vocabulary —
              `Packing.tsx`'s own reason for withholding a `progressbar`
              role here. */}
          <div
            className={styles['bar']}
            data-testid="unpack-bar"
            aria-hidden="true"
          >
            <div
              className={styles['fill']}
              style={{ inlineSize: `${resolvedPercent(totals)}%` }}
            />
          </div>

          <div className={styles['controls']} data-testid="unpack-controls">
            <fieldset className={styles['segmentedField']}>
              {/* No visible label on the board — `Packing.tsx`'s own
                  recipe: named for assistive technology alone. */}
              <legend className="visually-hidden">Group by</legend>
              <SegmentedControl
                name="unpack-mode"
                options={MODES}
                value={mode}
                onChange={setMode}
                size="dense"
              />
            </fieldset>

            {/* `○ OPEN`, never `OPEN ONLY` — F4 dropped *only*, a filter
                pill already being one. `Packing.tsx`'s `○ LEFT` grammar,
                one word changed. */}
            <button
              type="button"
              className={styles['filter']}
              // A distinct test id, not just its accessible name: this
              // screen's own outcome pill also reads `○ OPEN` (F6's own word
              // for the unresolved state), so a name-based query would match
              // both.
              data-testid="unpack-open-filter"
              aria-pressed={openOnly}
              onClick={() => setOpenOnly(!openOnly)}
            >
              ○ OPEN{openOnly && <span aria-hidden="true"> ✕</span>}
            </button>
          </div>

          <p className={styles['hint']}>{HINT}</p>

          {/* F19: with `○ OPEN` on and nothing left open, the list reads one
              line rather than a wall of collapsed, header-less groups —
              gated on `totals.open`, `unpackTotals`' own count over
              `unpackItems` directly, rather than a per-mode recount of
              whatever rows that mode happens to draw. Every mode now agrees:
              DESTINATION and ALL's own cluster rows read `open` as "not
              fully resolved over its Pieces" (`visibleRows`' own rule), the
              identical fact `totals.open` sums, so this gate never disagrees
              with what the three modes draw beneath it. */}
          {openOnly && totals.open === 0 ? (
            <p
              className={styles['nothingOpen']}
              data-testid="unpack-nothing-open"
            >
              NOTHING OPEN.
            </p>
          ) : mode === 'all' ? (
            <ul className={styles['rows']} data-testid="unpack-groups">
              {visibleRows(allEntryRows, openOnly).map((row) => (
                <li key={row.entryId}>
                  <UnpackRow
                    entryId={row.entryId}
                    name={row.name}
                    meta={row.meta}
                    outcome={row.outcome}
                    onOutcome={() => openOutcome(row.entryId)}
                    onReHome={noop}
                    {...(row.cluster === undefined
                      ? {}
                      : { cluster: row.cluster })}
                    tripOnly={row.tripOnly ?? false}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles['groups']} data-testid="unpack-groups">
              {(mode === 'person' ? personRows : destinationRows).map(
                (group) => (
                  <GroupSection
                    key={group.key}
                    group={group}
                    openOnly={openOnly}
                    onOutcome={openOutcome}
                  />
                ),
              )}
            </div>
          )}
        </>
      )}

      {outcomeEntry !== undefined && (
        <OutcomeSheet
          trip={trip}
          entry={outcomeEntry}
          view={view}
          onClose={() => setOutcomeEntryId(null)}
          roster={outcomeIsRoster}
        />
      )}
    </div>
  )
}
