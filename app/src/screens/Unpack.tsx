import {
  bringCountOf,
  closeTrip,
  containmentView,
  countOfUnpack,
  entriesOf,
  entryKind,
  entryLabel,
  homeRidesAlongCount,
  insideCountOf,
  isClosed,
  isContainerEntry,
  overClaimsFor,
  ownerLabel,
  personBuckets,
  personNameOrUnnamed,
  reHomeOnTheSpot,
  rehomedSinceOutcome,
  residenceOf,
  type Residence,
  returnPathOf,
  tripContainmentView,
  tripLabel,
  tripStandingOf,
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

import { HomeMoveConfirm } from '../components/HomeMoveConfirm'
import { HomePicker } from '../components/HomePicker'
import { NotesReviewCard } from '../components/NotesReviewCard'
import { overClaimGroups, OverClaimGroups } from '../components/OverClaimBand'
// The standing band's own card paint (`.band`) — this screen renders it
// facts-only, through `OverClaimGroups` directly rather than `OverClaimBand`
// (whose `settle` prop is mandatory), so the surface it belongs on has to be
// imported alongside it. `ValueMenu.tsx`'s own precedent for reusing a
// sibling component's module CSS by name.
import bandStyles from '../components/OverClaimBand.module.css'
import { circleToneForOutcome, OutcomeSheet } from '../components/OutcomeSheet'
import { UnpackRow } from '../components/UnpackRow'
import { personInitial } from '../household/people'
import { homeLabel } from '../household/gear'
import { useFoldSettled, useHousehold } from '../household/store'
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
import { PRINT_HIDDEN } from '../print'

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
  /** DESTINATION mode's own `RE-HOMED` segment (Task 14, spec §4.6) —
   * {@link rehomedFor}'s answer, unset (falsy) everywhere else. */
  readonly rehomed?: boolean
  /** M3 — {@link canReHomeFor}'s answer; `undefined` reads `true`
   * (`UnpackRow`'s own default), so a trip-only row need not set it. */
  readonly canReHome?: boolean
  /** The depot Gear this row names — §5i G6's record body routes there.
   * `undefined` for a trip-only row and for one whose Gear this replica has
   * not folded, both of which name no screen to go to. */
  readonly gearId?: string
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

/** The hint a **closed** Trip draws instead (§5i G6) — one gesture is left,
 * and it leads to the screen the Depot acts live on. */
const HINT_CLOSED = 'CLOSED · TAP ROW = GEAR DETAIL'

/** `Shared`'s own meta in PERSON mode — `Packing.tsx`'s `NOT_ATTRIBUTED`
 * verbatim: the identical fact (A7's rule 3, drawn last) on a sibling
 * screen, not a fresh string. */
const NOT_ATTRIBUTED = 'NOT ATTRIBUTED TO A PERSON'

/**
 * The close card's two hints (spec §4.7, `docs/design/README.md` §7/§5h,
 * board `S10 Round - Unpack Resolve and Close.dc.html` §01/§05, verbatim) —
 * gated while `open > 0`, and the finished-screen form once `open = 0`. Not
 * composed from a template: both are drawn strings in full, and the task
 * brief that owns this card says so — "do not invent copy".
 */
const CLOSE_HINT_GATED =
  'BACK WRITES HOME AT THE TAP. CLOSE WHEN OPEN = 0 — LOST IS ALWAYS AN ANSWER.'
const CLOSE_HINT_READY =
  'CLOSE WRITES THE CONSUMED REDUCTION. THE ARRANGEMENT AND EVERY OUTCOME ARE KEPT. LOST KEEPS ITS HOME SLOT.'

/** And the closed form (§5i G6). The button is withheld beside it, so this
 * is the card's whole instruction: what the screen now is, and the one
 * route to changing any of it. **No `Reopen` control here** — the ledger
 * row and SET PHASE already hold that door, and F13's rule against a third
 * door for one register applies to leaving `closed` as it did to entering
 * it. **Unconditional again as of S11** (spec §5.1): every closed Trip
 * reopens, so this is the whole of the hint on every one of them —
 * S10's `reopenBlocked`-gated sibling, `CLOSED · OUTCOMES ARE HISTORY. NO
 * REOPEN — COUNTS LOWERED AT CLOSE.`, retires with the gate. */
const CLOSE_HINT_CLOSED = 'CLOSED · OUTCOMES ARE HISTORY. REOPEN TO CHANGE ONE.'

/**
 * The depot Gear id a row's body routes to in §5i G6's record mode.
 * `undefined` for a trip-only Entry (it names no Gear) and for one whose
 * Gear has not reached this replica — the same two cases {@link depotGearOf}
 * already answers `undefined` for, asked one step earlier because a route
 * needs the id and not the entity.
 */
function depotGearIdOf(entry: EntryState): string | undefined {
  const source = entry.source?.value
  if (source === undefined || source.from !== 'depot') return undefined
  return source.gearId
}

/** {@link depotGearIdOf} as a spreadable prop — `exactOptionalPropertyTypes`
 *  forbids writing `gearId: undefined` on an optional field, and every row
 *  builder wants the same one line. */
function gearIdProp(entry: EntryState): { gearId?: string } {
  const gearId = depotGearIdOf(entry)
  return gearId === undefined ? {} : { gearId }
}

/**
 * §5i G6's `record` prop, spread onto every `UnpackRow` — present exactly
 * while the Trip is closed, and carrying the Depot screen this row's body
 * goes to. Composed once here so the two render sites cannot draw a closed
 * Trip differently from each other, which is the whole failure mode a
 * two-site screen has.
 */
function recordProp(
  closed: boolean,
  row: UnpackRowData,
): { record?: { href: string | undefined } } {
  if (!closed) return {}
  return {
    record: {
      href: row.gearId === undefined ? undefined : `/gear/${row.gearId}`,
    },
  }
}

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
 * consumed Counted's split (`item.consumed` is non-null only there) — both
 * of them {@link sharedMetaSuffix}'s, spelled once for both grammars — then
 * a Counted Entry's plain quantity, gated on {@link bringCountOf}, never on
 * `entryKind(entry, state) === 'counted'`, which is exactly the
 * re-derivation this file's own convention forbids. A Single, an
 * unrecognised Kind and an unsynced Gear all answer `null` there and draw
 * no suffix at all.
 *
 * **The `RE-HOMED` segment is not part of this string** (Task 14, spec
 * §4.6) — it is `UnpackRow`'s own muted segment (board §7: *"muted, so the
 * row says why it sits under a room it did not leave from"*), which needs
 * its own tone and must not be swallowed by `UnpackRow`'s plain-text `meta`
 * prop. {@link rehomedFor} computes the boolean this function's own callers
 * pass down beside this string, never folded into it.
 */
/**
 * The two suffix segments {@link returnPathMeta} and {@link headerlessMeta}
 * are required to spell **identically** — F1's `N INSIDE` and F9's consumed
 * split — stated once here because the two callers differ only in the
 * *order* they place them against the return path, never in their content.
 *
 * They were restated in both files' own bodies until §5i G3 moved both
 * strings and only one copy followed: PERSON and ALL mode went on drawing
 * `×0 BACK` and `0 INSIDE` for a whole commit, invisible because no test
 * reached the header-less grammar's zero cases. `headerlessMeta`'s own
 * docstring had *said* the two arms are shared; saying it is not the same
 * as making it so.
 *
 * `null` means neither shared arm applies and the caller decides its own
 * plain quantity — the one thing the two grammars genuinely disagree
 * about, and the reason this returns a list rather than a string.
 */
function sharedMetaSuffix(
  trip: TripState,
  state: HouseholdState,
  entry: EntryState,
  tripView: TripContainmentView,
  container: boolean,
  item: Extract<UnpackItem, { kind: 'entry' }>,
): readonly string[] | null {
  if (container) {
    // **G2: `INSIDE` is the lid-open count** — {@link insideCountOf}'s
    // direct children over the **trip** tree, a nested container counting
    // one — and it carries the trip world's `▸` because the return path
    // beside it is home and the two must not read as one world. `RIDE
    // ALONG`, one tap away in the picker, is the other question: what moves,
    // at any depth.
    //
    // **G3: an empty container reads its return path alone** — a zero count
    // segment is absent, not written, and an empty crate takes its outcome
    // like a tarp.
    const inside = insideCountOf(trip, state, entry.id, tripView)
    return inside > 0 ? [`▸ ${inside} INSIDE`] : []
  }

  if (item.outcome === 'consumed' && item.consumed !== null) {
    // **G3: the split segment says *the rest came back*, so with nothing
    // back there is no rest.** `consumedCountOf` reads an absent register
    // as the **whole** Bring-count (F9: the stepper opens there because
    // "all of it used up is the ordinary case"), so tapping `CONSUMED` and
    // never touching the stepper is the **ordinary** case, not an edge one
    // — which is exactly why it may not draw a `×0 BACK` nobody asked for.
    const back = item.units - item.consumed
    const parts = [`×${item.consumed} CONSUMED`]
    if (back > 0) parts.push(`×${back} BACK`)
    return parts
  }

  return null
}

function returnPathMeta(
  trip: TripState,
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

  const shared = sharedMetaSuffix(trip, state, entry, tripView, container, item)
  const suffix =
    shared ?? (bringCountOf(entry, state) !== null ? [`×${item.units}`] : [])

  if (pathText === '') return suffix.join(' · ')
  return [`→ ${pathText}`, ...suffix].join(' · ')
}

/**
 * Whether a row's `RE-HOMED` segment draws (Task 14, spec §4.6) —
 * {@link rehomedSinceOutcome}'s own one comparison, never re-derived here,
 * over {@link depotGearOf}'s Gear for this Entry. DESTINATION mode's own
 * scope: no board draws the segment for PERSON or ALL mode's rows, so
 * neither computes it (`UnpackRowData.rehomed` defaults to `false` there).
 */
function rehomedFor(entry: EntryState, state: HouseholdState): boolean {
  return rehomedSinceOutcome(entry, depotGearOf(entry, state))
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
          canReHome: canReHomeFor(entry, state),
          ...gearIdProp(entry),
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
          trip,
          entry,
          state,
          view,
          tripView,
          container,
          item,
          destination,
        ),
        outcome: item.outcome,
        rehomed: rehomedFor(entry, state),
        canReHome: canReHomeFor(entry, state),
        ...gearIdProp(entry),
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
 * **M3** — whether this row's body may open the re-home picker at all. A
 * depot Entry whose Gear has not yet reached this replica has nothing for
 * `HomePicker` to read a residence from (`trip.entry_added` and
 * `gear.recorded` are different aggregates with no ordering between them —
 * a pull can deliver the Entry first), so its body would otherwise be a
 * dead tap: no sheet, no message, until the Gear arrives. `true` for a
 * trip-only Entry too — moot there, since `tripOnly` already withholds the
 * body regardless.
 */
function canReHomeFor(entry: EntryState, state: HouseholdState): boolean {
  const source = entry.source?.value
  if (source === undefined || source.from !== 'depot') return true
  return state.gear[source.gearId] !== undefined
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
 * — both are {@link sharedMetaSuffix}'s, called rather than restated,
 * because the only thing this grammar changes about them is where they sit
 * relative to the path.
 *
 * `prefix` is `personEntryMeta`'s own ownership segment for PERSON mode, or
 * `null` for ALL, which states no ownership at all — ALL is a lookup view
 * over every Entry regardless of whose it is, and drawing an ownership
 * segment nobody asked for there is exactly the arithmetic-nobody-asked-for
 * this codebase already refuses elsewhere.
 */
function headerlessMeta(
  trip: TripState,
  entry: EntryState,
  state: HouseholdState,
  view: ContainmentView,
  tripView: TripContainmentView,
  container: boolean,
  item: Extract<UnpackItem, { kind: 'entry' }>,
  prefix: string | null,
): string {
  const suffix = sharedMetaSuffix(
    trip,
    state,
    entry,
    tripView,
    container,
    item,
  ) ?? [`×${item.units}`]

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
  trip: TripState,
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
    trip,
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
 * **A trip-only Entry sits at `Shared`'s tail** (§5i G9, overturning R20).
 * PERSON partitions by *whose it is*, and a trip-only Entry is attributed to
 * nobody — which is `Shared`'s own definition, and the answer F4 gives one
 * tap away on the same Trip. It takes DESTINATION's row anatomy verbatim
 * (`TRIP-ONLY` tag, meta `NOT IN DEPOT`, faint `CLEARS AT CLOSE` in the
 * slot), so nothing new holds text: that slot is an Entry row's, never a
 * cluster's.
 *
 * `unpackItems` still excludes it (invariant 18 — it takes no outcome), so
 * it reaches no bucket and it is appended **after** the bucket's own rows
 * rather than partitioned into them. `Shared`'s header count therefore
 * excludes it, as every count on this screen does.
 *
 * The ruling's closing sentence — *a trip-only per-person Entry's Pieces go
 * to their Participants with the same slot* — describes a shape the op
 * catalogue cannot make: a trip-only source carries a name and a container
 * flag and no Kind, so `entryKind` answers `trip_only` before any Kind
 * question is asked, and there is no such Entry to place. Recorded rather
 * than built as an unreachable branch.
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
        canReHome: canReHomeFor(entry, state),
        ...gearIdProp(entry),
      }
    }

    const container = isContainerEntry(entry, state)
    return {
      entryId: item.entryId,
      name: entryLabel(entry, state),
      meta: personEntryMeta(
        trip,
        entry,
        state,
        view,
        tripView,
        container,
        item,
      ),
      outcome: item.outcome,
      canReHome: canReHomeFor(entry, state),
      ...gearIdProp(entry),
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

  // §5i G9: the trip-only rows, at `Shared`'s tail, in DESTINATION's own
  // anatomy. They reach no bucket — `unpackItems` excludes them — so they
  // are appended after the bucket's rows and counted by nothing.
  const tripOnlyRows: UnpackRowData[] = entries
    .filter((entry) => entryKind(entry, state) === 'trip_only')
    .map((entry) => ({
      entryId: entry.id,
      name: entryLabel(entry, state),
      meta: 'NOT IN DEPOT',
      outcome: null,
      tripOnly: true,
    }))

  if (sharedItems.length > 0 || tripOnlyRows.length > 0) {
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
      rows: [...rowsFor(sharedItems), ...tripOnlyRows],
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
        canReHome: canReHomeFor(entry, state),
        ...gearIdProp(entry),
      })
      continue
    }

    const item = itemByEntry.get(entry.id)
    if (item === undefined) continue
    rows.push({
      entryId: entry.id,
      name: entryLabel(entry, state),
      meta: headerlessMeta(
        trip,
        entry,
        state,
        view,
        tripView,
        container,
        item,
        null,
      ),
      outcome: item.outcome,
      canReHome: canReHomeFor(entry, state),
      ...gearIdProp(entry),
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
  closed,
  onOutcome,
  onReHome,
}: {
  group: UnpackGroup
  openOnly: boolean
  /** §5i G6 — a closed Trip draws every row as a record. */
  closed: boolean
  /** The real Entry id, never a PERSON-mode Piece row's composite key —
   * {@link Unpack}'s `openOutcome` is what tells the two apart. */
  onOutcome: (entryId: string) => void
  /** Task 14's row-body target — {@link Unpack}'s `openReHome`, the identical
   * key-splitting `onOutcome` already does. */
  onReHome: (entryId: string) => void
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
              onReHome={() => onReHome(row.entryId)}
              {...recordProp(closed, row)}
              // `exactOptionalPropertyTypes`: an *omitted* prop and one
              // present-and-`undefined` are different types, exactly
              // `PersonCluster`'s own `tone`-spread note.
              {...(row.cluster === undefined ? {} : { cluster: row.cluster })}
              tripOnly={row.tripOnly ?? false}
              rehomed={row.rehomed ?? false}
              canReHome={row.canReHome ?? true}
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
 * filter, the hint, the three sheets and the close card are every one of
 * them a later task's scope and deliberately absent here — PERSON and ALL
 * mode are Task 11's, so this always renders DESTINATION. **Task 16 has
 * since added the over-claim band** (see its own comment at the render
 * site, between the count block and the controls).
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
 * `useScreenHeader({ splitPane: false, back: `/trips/${tripId}` })` —
 * `Packing`'s own answer and the same reason: the 216px sidebar names the
 * Trips list, not this Trip, so the destination this screen's back link
 * points at is never already on the page, and since §5n K27 handing in that
 * destination is the whole of how the hook is told.
 */

/**
 * F8's own context line (`docs/design/README.md` §7/§5h, spec §4.6, board
 * `S10 Round - Unpack Resolve and Close.dc.html` §02/§07): `RE-HOMING Tent,
 * 3p · PICKING A HOME MARKS IT BACK` — the recorded name, kept in its
 * **recorded case**: `.context`'s own `text-transform: uppercase`
 * (`HomePicker.module.css`) is what paints it in caps, exactly as the
 * shipped `MOVING {name} · …` line already leaves `moving.name` untouched
 * (`HomePicker.test.tsx` pins the identical rule for `PackPicker`). This is
 * the caller's own sentence and nothing else — no ride-along clause: a
 * container being re-homed gets that from `HomePicker`'s own `moving` prop,
 * which appends it once rather than here a second time (this file's own
 * `<HomePicker>` call below decides whether to pass `moving` at all).
 */
function reHomeContext(name: string): { act: string; consequence: string } {
  return {
    act: `RE-HOMING ${name}`,
    consequence: 'PICKING A HOME MARKS IT BACK',
  }
}

/** {@link Unpack}'s own outcome-sheet target — R23's own shape. `personId`
 * is absent for the cluster (DESTINATION/ALL) and present for a PERSON-mode
 * Piece row, carrying which Piece's own pill opened the sheet. */
interface OutcomeTarget {
  readonly entryId: string
  readonly personId?: string
}

export function Unpack() {
  const params = useParams<{ id: string }>()
  const tripId = params.id
  const state = useHousehold((depot) => depot.state)
  const sync = useHousehold((depot) => depot.sync)
  const emitAll = useHousehold((depot) => depot.emitAll)
  const settled = useFoldSettled()
  // The sidebar carries `TRIPS`, never one Trip's name, so this screen's
  // own back link is owed at Desktop too — and the destination is what says
  // so now (§5n K27), not a boolean this screen answers about itself.
  const header = useScreenHeader({
    splitPane: false,
    back: `/trips/${tripId}`,
  })

  // The two controls' own state, `Packing.tsx`'s `mode`/`leftOnly` twins:
  // `mode` chooses which of the three partitions draws, `openOnly` filters
  // `outcome === null` in all three. `useState`, not a route param — F4's
  // own answer one slice earlier.
  const [mode, setMode] = useState<UnpackMode>('destination')
  const [openOnly, setOpenOnly] = useState(false)

  // The outcome sheet's own open state (Task 12) — `ui/`'s primitives have
  // no `open` prop, so `null` is closed and a real target is open, and
  // mount is what resets the sheet exactly as `PhaseSheet`'s own `reopenTo`/
  // `activating` do. Holds the **real** Entry id, plus — R23's own field —
  // the Piece that opened it, when one did.
  const [outcomeTarget, setOutcomeTarget] = useState<OutcomeTarget | null>(null)

  // Task 14's own target — F8's row body. Holds the **real** Entry id only:
  // unlike `OutcomeTarget`, there is no `personId` to carry, because
  // `reHomeOnTheSpot` re-homes the whole Entry's Gear regardless of which
  // row's body opened the picker (its own fan-out is what marks every
  // unresolved included Piece back, not only the one the tap named).
  const [reHomeEntryId, setReHomeEntryId] = useState<string | null>(null)

  /**
   * The home a container's re-home has picked, waiting on its confirm (§5i
   * G15) — this screen's confirm, not the picker's (`patterns.md` §4.3).
   * The sheet stays open behind it, so Cancel returns to the list the pick
   * was made from.
   */
  const [pendingReHome, setPendingReHome] = useState<Residence | null>(null)

  const trip = tripId === undefined ? undefined : state.trips[tripId]

  /**
   * **Task 13's own closer, R23's own fix.** A DESTINATION/ALL row hands its
   * own real Entry id, unchanged — no colon, `personId` stays `undefined`.
   * A PERSON-mode Piece row hands its composite `${entryId}:${personId}` key
   * instead — {@link personGroups}' own `rowFor` mints it because two Pieces
   * of one per-person Entry need two distinct React keys and `UnpackRow`
   * test ids in that mode — and this function is the one place that key is
   * ever read: it splits on the first `:` (a UUID never contains one) and
   * opens the Entry it names, carrying the Piece's own `personId` forward
   * this time.
   *
   * **R23 overturns Task 13's first cut, which discarded `personId` here.**
   * Spec §4.5 and board §03 both read *"a Piece row carries its own pill —
   * one Piece, one outcome"* — a fact about the tap's own scope, not only
   * the row's display slot, and discarding it made every Piece's own pill
   * on one Entry open the identical roster with every Piece selected. Two
   * Quartermasters working the same Trip from different rooms would then
   * have one's `● BACK` on a single Piece silently carry every other
   * Piece's outcome along with it — including one a peer had set `lost`
   * from an offline Device, on a strictly later, wrongly-authored stamp.
   * `OutcomeSheet`'s own `personId` prop is what seeds the selection to
   * `{personId}` alone instead of `EVERYONE`; the cluster's own real
   * Entry id carries no `personId` at all, so it is untouched by this fix.
   */
  function openOutcome(rowKey: string): void {
    const separator = rowKey.indexOf(':')
    const entryId = separator === -1 ? rowKey : rowKey.slice(0, separator)
    if (trip?.entries?.[entryId] === undefined) return
    setOutcomeTarget(
      separator === -1
        ? { entryId }
        : { entryId, personId: rowKey.slice(separator + 1) },
    )
  }

  /**
   * Task 14's own closer — {@link openOutcome}'s identical key-splitting,
   * over a target with no `personId`: whichever row's body opened the
   * picker (the cluster, a plain entry row, or a PERSON-mode Piece row's
   * composite key), the same real Entry is what gets re-homed.
   */
  function openReHome(rowKey: string): void {
    const separator = rowKey.indexOf(':')
    const entryId = separator === -1 ? rowKey : rowKey.slice(0, separator)
    if (trip?.entries?.[entryId] === undefined) return
    setReHomeEntryId(entryId)
  }

  const totals = useMemo<UnpackCount>(
    () => (trip === undefined ? EMPTY_COUNT : unpackTotals(trip, state)),
    [trip, state],
  )

  // §5i G6: a closed Trip's F5 is a **record**. Invariant 19 sends a change
  // to a closed Trip's outcomes through reopen, and a live pill on a closed
  // row is that change without the ceremony — so the reads all stay (count
  // line, bar, controls, filter) and the writes all go. Read once here and
  // handed down, never re-derived per row: the hint, every row's slot, and
  // the close card have to agree about one fact, and `isClosed` is the only
  // definition of it in the codebase.
  //
  // Invariant 16 is not contradicted, and F4 stays live at every phase: a
  // phase locks no *packing* status. Invariant 19 is the specific rule for
  // outcomes, and it is the one that reaches here.
  const closed = trip !== undefined && isClosed(trip)

  // One view of each kind, handed down to every group — never one per group
  // (`containerTotals`'s own rule). The home view is memoised on the fold by
  // `containment.ts` itself; this line only names it.
  const view: ContainmentView = containmentView(state)
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

  // **A deleted Trip is not a Trip this screen may draw** (S14). `trip.deleted`
  // writes a register on an entity the fold *keeps*, so `state.trips[id]` stays
  // defined after a delete and a guard testing `undefined` alone goes on
  // drawing. `tripStandingOf` is the one place that question is asked
  // (`selectors/trip.ts`), and the tombstone falls into the state this screen
  // already has rather than restating J5's two sentences: those are the trip
  // screen's, drawn for the route somebody is most likely to be standing on
  // when a peer deletes, and a sub-route of a Trip that is gone has nothing
  // more to add.
  if (
    tripId === undefined ||
    trip === undefined ||
    tripStandingOf(state, tripId) !== 'live'
  ) {
    return (
      <div className={styles['screen']}>
        {/* Withheld until the fold has settled (§5n K25): one queue turn
            after a local write, an absence says only that this Device has
            not caught up. `TripNotHere` draws the two sentences that pull
            apart; a sub-route has one line for both standings, so the line
            waits. */}
        {settled && <p className={styles['missing']}>No such trip.</p>}
      </div>
    )
  }

  // `entriesOf` counts lines, which is what `0 ENTRIES.` says — F19's empty
  // register, `Packing.tsx`'s own reasoning transplanted: a Trip holding only
  // a trip-only Entry has a real `0/0` in `totals` and is not an empty list.
  const empty = entriesOf(trip, state).length === 0

  // **F15 — the standing band, facts-only.** `overClaimsFor` is `Trip.tsx`'s
  // own read, never the unscoped `overClaimsIfActive`: F5 asks about *this*
  // Trip's own claims, not a hypothetical. The gate is `overClaimGroups`'
  // own filtered result, never the raw `overClaims.length` (`patterns.md`
  // §1.6) — not because the unfiltered array could name a Trip other than
  // `tripId` here (`overClaimsFor` already scopes to it, unlike its
  // `IfActive` sibling), but because `overClaimGroups` is the exact value
  // this render needs regardless, and gating on it keeps this call site in
  // step with `OverClaimBand`'s own internal shape rather than a second,
  // parallel check over the raw array with no rendering purpose of its own.
  const overClaims = overClaimsFor(state, tripId)
  const claimGroups = overClaimGroups(overClaims, tripId, state)

  // The sheet's own Entry, re-read from `trip` fresh on every render — never
  // cached across a tap, so a second render after an op lands hands the
  // sheet the Entry it just wrote (`OutcomeSheet`'s own docstring on why
  // `PhaseSheet`'s "close after every write" is not this sheet's model).
  const outcomeEntry =
    outcomeTarget === null ? undefined : trip.entries?.[outcomeTarget.entryId]

  // The caller's own fact (`OutcomeSheet`'s own docstring on `roster`): a
  // per-person, non-container Entry always opens the roster variant,
  // whichever of the cluster (DESTINATION/ALL) or PERSON mode's own pill
  // opened it — `openOutcome` resolves both to this one real Entry id.
  const outcomeIsRoster =
    outcomeEntry !== undefined &&
    entryKind(outcomeEntry, state) === 'per_person' &&
    !isContainerEntry(outcomeEntry, state)

  // Task 14's own picker target — the Entry the tapped row named, re-read
  // fresh exactly as `outcomeEntry` is, plus the depot Gear it names: a
  // trip-only Entry (no `source`, or a trip-only one) has no Gear to
  // re-home, so the picker below never mounts for one — matched by
  // `UnpackRow`'s own row body, which draws no button at all there.
  const reHomeEntry =
    reHomeEntryId === null ? undefined : trip.entries?.[reHomeEntryId]
  const reHomeGearId = ((): string | undefined => {
    if (reHomeEntry === undefined) return undefined
    const source = reHomeEntry.source?.value
    return source !== undefined && source.from === 'depot'
      ? source.gearId
      : undefined
  })()
  const reHomeGear =
    reHomeGearId === undefined ? undefined : state.gear[reHomeGearId]
  // The depot's own physical subtree — GearDetail's own MOVE computation.
  // Read once and handed to `moving` alone (never `context`): a container
  // is what carries this fact at all (spec §4.6 — a plain gear has no
  // subtree to exclude or count, and the board's own non-container example
  // shows no ride-along line), so `moving` is only ever passed for one.
  //
  // **G2: what moves, at any depth** — `homeRidesAlongCount`, never
  // `childrenOf(…).length`, which counted the lid-open row and named it
  // after the move.
  const reHomeRidesAlong =
    reHomeGearId === undefined
      ? 0
      : homeRidesAlongCount(reHomeGearId, state, view)
  const reHomeIsContainer =
    reHomeEntry !== undefined && isContainerEntry(reHomeEntry, state)

  /**
   * The re-home write — the gesture, not re-derived here (`gestures.ts`'s
   * own three rules: the outcome write suppressed only when already `back`,
   * the rehome unconditional, a non-container per-person Entry fanned out
   * per Piece). One durable write, for the reason every gesture takes one: a
   * per-person container fans out to a `gear.rehomed` plus an outcome per
   * Piece, and a Device dying part-way leaves some Pieces marked back and
   * the gear re-homed for none of them.
   *
   * Both paths end here — a plain row writes on the pick, a container's on
   * its confirm — so the two cannot come apart.
   */
  function reHome(residence: Residence): void {
    if (
      trip === undefined ||
      reHomeEntry === undefined ||
      reHomeGearId === undefined
    ) {
      return
    }
    emitAll(
      reHomeOnTheSpot(trip, reHomeEntry, reHomeGearId, residence, state),
      `RE-HOME · ${entryLabel(reHomeEntry, state)}`,
    )
    setPendingReHome(null)
    setReHomeEntryId(null)
  }

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
            {/* A distinct test id, not just its accessible text: the close
                card's own summary line (this task) also ends in `N OPEN`, on
                a Trip where the two numbers coincide — the `○ OPEN` filter
                pill's own reason above, restated for this second collision. */}
            <span className={styles['open']} data-testid="unpack-open-count">
              {openLabel(totals)}
            </span>
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

          {/*
           * F15 — the over-claim band, between the count block and the
           * controls (spec §4.9, `docs/design/README.md` §7/§5h): a
           * property of the gear list, and F5 is a third view of it. Never
           * dismissible — rendering nothing is the only way it goes away,
           * which is why this reads `claimGroups.length` rather than a
           * `useState` a Quartermaster could close. `OverClaimGroups` gets
           * no `settle` at all: `REMOVE HERE` and `BRING ×N HERE` edit the
           * list, and F5 is not the list editor (§5b I, `patterns.md` §4.4)
           * — its absence is the read-only mode, not a degraded one, and the
           * row's own fact line says so (`SINGLE · STILL OPEN HERE`,
           * `OverClaimGroupsProps.resolvableHere`'s own word-swap).
           */}
          {claimGroups.length > 0 && (
            <section
              className={bandStyles['band']}
              data-testid="over-claim-band"
            >
              <OverClaimGroups
                tripId={tripId}
                groups={claimGroups}
                // The row's own pill is right below, in the very same
                // list — see `OverClaimGroupsProps.resolvableHere`.
                resolvableHere
              />
            </section>
          )}

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
              {...PRINT_HIDDEN}
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

          <p className={styles['hint']}>{closed ? HINT_CLOSED : HINT}</p>

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
                    onReHome={() => openReHome(row.entryId)}
                    {...recordProp(closed, row)}
                    {...(row.cluster === undefined
                      ? {}
                      : { cluster: row.cluster })}
                    tripOnly={row.tripOnly ?? false}
                    canReHome={row.canReHome ?? true}
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
                    closed={closed}
                    onOutcome={openOutcome}
                    onReHome={openReHome}
                  />
                ),
              )}
            </div>
          )}

          {/* S12's review card (§5l I14, I20): after the groups and
              **directly above** the close card, which stays the list's last
              card (F11). It renders on every F5 that has a list — gated, at
              `open = 0`, and on a closed Trip — and is absent from the empty
              branch above with everything else F19 withholds. It takes no
              `closed`/`record` prop on purpose: invariant 19 freezes
              outcomes, and a Note is not one (I17). */}
          <NotesReviewCard tripId={trip.id} />

          {/*
           * The close card (F11, spec §4.7) — the list's last card at every
           * width, a sibling of the groups region above rather than a docked
           * footer: `.screen`'s own flex column carries the gap, exactly as
           * it does between every other element on this screen. A docked
           * footer would spend the thumb zone on a control disabled for most
           * of the pass, and a right-hand column needs a pane F5 lacks.
           *
           * **The gate is a real `disabled` attribute** (this task's own
           * requirement) — `aria-disabled` alone would still let a keyboard
           * user fire the click handler past invariant 18's gate, which has
           * no override (F10 — no confirm stands between the tap and the
           * write).
           *
           * The tap emits `closeTrip`'s own ops, in the order it returns
           * them — never re-derived here: the reduction-then-phase-move
           * order, the per-Gear summing and the floor at zero are every one
           * of them `gestures.ts`'s own rule, not this screen's.
           *
           * **A Trip already `isClosed` withholds the button and its hint,
           * never a `Close trip` shown live** (ruling R27 Layer A) — the
           * one thing `open = 0` alone cannot tell apart from "just
           * finished" is "already closed", and offering a live button there
           * is a second, redundant door onto a gesture that has nothing
           * left to do (`gestures.ts`'s own guard, R27 Layer B). No drawn
           * frame shows F5 on a closed Trip, so the design round still owes
           * this a picture; meanwhile `patterns.md` §3.7's *withheld, not
           * greyed* is the standing rule — the summary line is a fact about
           * a closed Trip regardless (`53 BACK · … · 0 OPEN` stays true),
           * so only the control and its instructional hint go, never the
           * ledger line above them.
           */}
          <section
            className={styles['closeCard']}
            data-testid="unpack-close-card"
          >
            <p
              className={styles['closeSummary']}
              data-testid="unpack-close-summary"
            >
              {`${totals.back} BACK · ${totals.consumed} CONSUMED · ${totals.lost} LOST · `}
              <span className={styles['closeSummaryOpen']}>
                {openLabel(totals)}
              </span>
            </p>
            {isClosed(trip) ? (
              // §5i G6: the button is withheld (not greyed) and the hint
              // states what the screen now is and the one route to
              // changing it. The summary above stays — every word of it is
              // still true of a closed Trip. Unconditional as of S11: every
              // closed Trip's route back is the same one, `REOPEN TO
              // CHANGE ONE`.
              <p className={styles['closeHint']}>{CLOSE_HINT_CLOSED}</p>
            ) : (
              <>
                <button
                  type="button"
                  className={styles['closeButton']}
                  disabled={totals.open > 0}
                  onClick={() => {
                    // One durable write for the whole gesture: the
                    // Consumed reduction and the posting that records it are
                    // a pair, and a Device dying between them leaves a
                    // lowered owned-count nothing says was lowered.
                    emitAll(
                      closeTrip(trip, state),
                      `CLOSE TRIP · ${tripLabel(trip)}`,
                    )
                  }}
                >
                  {totals.open > 0
                    ? `Close trip — ${totals.open} open`
                    : 'Close trip'}
                </button>
                <p className={styles['closeHint']}>
                  {totals.open > 0 ? CLOSE_HINT_GATED : CLOSE_HINT_READY}
                </p>
              </>
            )}
          </section>
        </>
      )}

      {outcomeEntry !== undefined && (
        <OutcomeSheet
          trip={trip}
          entry={outcomeEntry}
          view={view}
          onClose={() => setOutcomeTarget(null)}
          roster={outcomeIsRoster}
          // R23: the Piece whose own pill opened this sheet, when one did —
          // `exactOptionalPropertyTypes`'s omit-vs-`undefined` rule, spread
          // rather than passed as `personId={outcomeTarget?.personId}`.
          {...(outcomeTarget?.personId === undefined
            ? {}
            : { personId: outcomeTarget.personId })}
        />
      )}

      {reHomeEntry !== undefined &&
        reHomeGearId !== undefined &&
        reHomeGear !== undefined && (
          <HomePicker
            onClose={() => setReHomeEntryId(null)}
            onPicked={(residence) => {
              // A container's re-home confirms first (§5i G15) — this
              // screen's confirm, with the picker still open behind it so
              // Cancel returns to the list. A plain row writes on the pick.
              if (reHomeIsContainer) {
                setPendingReHome(residence)
                return
              }
              reHome(residence)
            }}
            excludeGearId={reHomeGearId}
            current={residenceOf(reHomeGear)}
            context={reHomeContext(entryLabel(reHomeEntry, state))}
            // Only a container needs MOVE's own exclusion, footer and
            // ride-along line (spec §4.6). A container is also the one shape
            // here that **confirms** — §5i G15 finishes §1's rule (the
            // confirm is owed where the act cannot be seen on the screen
            // that made it) for this route — but that confirm is this
            // screen's now (`HomeMoveConfirm`, below), not something the
            // sheet is asked to raise. The row itself jumps, which is why a
            // **plain** row raises nothing; a container's re-home rewrites
            // every home path beneath it, and those rows are elsewhere on F5
            // and may be filtered out under `○ OPEN`.
            {...(reHomeIsContainer
              ? {
                  moving: {
                    name: entryLabel(reHomeEntry, state),
                    ridesAlong: reHomeRidesAlong,
                  },
                }
              : {})}
          />
        )}

      {reHomeEntry !== undefined && pendingReHome !== null && (
        <HomeMoveConfirm
          variant="re-home"
          movingName={entryLabel(reHomeEntry, state)}
          // Derived from the residence rather than reported back by the
          // picker — `homeLabel` draws the same words the row did, which is
          // what let the sheet lose its own copy of this confirm.
          destinationName={homeLabel(state.places, state.gear, pendingReHome)}
          ridesAlong={reHomeRidesAlong}
          onCancel={() => setPendingReHome(null)}
          onConfirm={() => reHome(pendingReHome)}
        />
      )}
    </div>
  )
}
