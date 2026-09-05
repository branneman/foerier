import {
  containerTotals,
  countOf,
  disagreements,
  entriesOf,
  entryLabel,
  entryResidenceOf,
  isContainerEntry,
  isPacked,
  packingItems,
  personPartition,
  ridesAlongCount,
  sameTripResidence,
  stageOf,
  statusGlyph,
  tripContainmentView,
  tripContainerStageSet,
  tripEntryMoved,
  tripLabel,
  tripPath,
  tripPieceMoved,
  TRIP_LOOSE,
  type DepotState,
  type Disagreement,
  type EntryState,
  type PackingCount,
  type PackingItem,
  type PersonBucket,
  type StageValue,
  type TripContainmentView,
  type TripHolderRef,
  type TripResidence,
  type TripState,
} from '@foerier/shared'
import {
  PersonCircle,
  SegmentedControl,
  type SegmentedOption,
} from '@foerier/ui'
import { useMemo, useState } from 'react'
import { useParams } from 'wouter'

import { ContainerMoveConfirm } from '../components/ContainerMoveConfirm'
import { JourneyRail } from '../components/JourneyRail'
import { PackingRow } from '../components/PackingRow'
import { PackPicker } from '../components/PackPicker'
import { PieceStatusSheet } from '../components/PieceStatusSheet'
import { useDepot } from '../depot/store'
import { personInitial } from '../depot/people'
import { leftLabel, packedLabel, packedPercent, peopleOn } from '../depot/trips'
import { ScreenBand } from '../shell/ScreenBand'
import { useScreenHeader } from '../shell/useMediaQuery'
import styles from './Packing.module.css'

/**
 * How the list is partitioned: by the container it rides in, by whose it is,
 * or not at all. CONTAINER is the resting mode — the journey rail is the
 * screen's spine, and it lives on a container's own group header.
 */
type PackingMode = 'container' | 'person' | 'all'

const MODES: readonly SegmentedOption<PackingMode>[] = [
  { value: 'container', label: 'CONTAINER' },
  { value: 'person', label: 'PERSON' },
  { value: 'all', label: 'ALL' },
]

/** The screen's one hint (ruling A9), and the whole of its instruction. */
const HINT =
  'TAP PILL = NEXT STATE · TAP CIRCLES = PER PERSON · TAP ROW = WHERE IT GOES'

/** Where a gear list's groups come from, stated once and permanently for a
 * Trip that has none — a domain fact, not a promise, in the `0 ENTRIES.`
 * register. */
const NO_CONTAINERS = 'A CONTAINER ON THE GEAR LIST BECOMES A GROUP HERE.'

/** Indent 16px per level, capped at **two** levels below the top container —
 * the Home picker's constant and its reason, verbatim (ruling A4): a deep
 * row runs out of row, so past the cap the header states its own ancestry
 * instead. */
const INDENT_CAP = 2

/** `Shared`'s own meta — what the group is, said once, in the register
 * `NOT IN A CONTAINER` uses one mode over. */
const NOT_ATTRIBUTED = 'NOT ATTRIBUTED TO A PERSON'

/** The `Loose` group's key, in {@link PackingGroup.key} and in the index
 * `containerView` files items under — one spelling, so the two cannot drift. */
const LOOSE_KEY = 'loose'

/**
 * One row of one CONTAINER-mode group.
 *
 * **A row is no longer just an Entry id** (ruling C1). A per-person Entry
 * draws one row per group holding at least one of its Pieces, so the same
 * `entryId` can appear in several groups and each row has to say *which*
 * Pieces it is drawing.
 */
interface PackingGroupRow {
  readonly entryId: string
  /** The Entry's Pieces in **this** group, in {@link packingItems} order.
   * Absent for every other Kind, where the row is its whole Entry. */
  readonly personIds?: readonly string[]
  /**
   * Whether anything **this row draws** is unpacked — the `○ LEFT` filter,
   * scoped exactly as the row is.
   *
   * It cannot be an Entry-level fact any more: a Headlamp whose Piece in the
   * duffel is packed and whose two loose Pieces are not has one row that the
   * filter drops and one it keeps, and `entriesWithLeft` — which ALL mode
   * still uses, because there the row *is* the whole Entry — would keep both.
   */
  readonly hasLeft: boolean
}

/**
 * One group of CONTAINER mode: a trip container, or the `Loose` group that
 * closes the list.
 */
interface PackingGroup {
  readonly key: string
  /** `null` for `Loose`, which is a holder and not an Entry. */
  readonly entryId: string | null
  readonly name: string
  /** Ruling A14's amber tag on a trip-only container's header. */
  readonly tripOnly: boolean
  /** Levels below the top container. The indent is capped; this is not. */
  readonly depth: number
  /** The ancestry the cap hid, `CRATE B ▸ STUFF SACK`, or `''`. */
  readonly ancestry: string
  /** `null` for `Loose` — **nothing loose has a journey**, which is the one
   * thing that group's header lacks (ruling A3). */
  readonly stage: StageValue | null
  /** `9/12` — a container's contents **at any depth**, `Loose`'s own rows. */
  readonly count: PackingCount
  /** This group's own rows, in `entriesOf` order. Nested containers are not
   * rows: they are the groups that follow immediately (ruling A4). */
  readonly rows: readonly PackingGroupRow[]
  /** Entries inside at any depth — the move context's `N INSIDE RIDE ALONG`. */
  readonly insideCount: number
}

interface ContainerView {
  readonly groups: readonly PackingGroup[]
  /** Whether the Trip holds any container at all — what {@link NO_CONTAINERS}
   * is gated on. */
  readonly hasContainer: boolean
  readonly disagreementOf: ReadonlyMap<string, Disagreement>
}

/**
 * One group of PERSON mode: a Person, or the `Shared` group that closes the
 * list.
 */
interface PersonGroup {
  readonly key: string
  /** `null` for `Shared`, which is the absence of an attribution rather than
   * a Person — `ownerLabel`'s own word for an absent ownership register. */
  readonly personId: string | null
  /** `personLabel`'s — the recorded name, or `—`. */
  readonly name: string
  /** `9/13 · 4 LEFT`, or `● 12/12` when nothing is left. */
  readonly count: PackingCount
  /** This group's items, in {@link packingItems} order. */
  readonly items: readonly PackingItem[]
}

/**
 * Everything all three modes draw, folded once.
 *
 * One memo rather than three, keyed on the fold: switching modes is a tap on
 * a segmented control and must not pay for a re-derivation, and the three
 * shapes share {@link packingItems} underneath anyway.
 */
interface PackingView {
  /**
   * The whole Trip's items, built once beside the containment view that
   * resolved them and handed to every reader on the screen that wants one —
   * the row cluster, the Pack picker's `● NOW`. A second
   * `packingItems(trip, state)` call anywhere here builds a second
   * containment view with it (the parameter defaults), which is the
   * N × O(entries) `containerTotals`' docstring asks callers not to pay.
   */
  readonly items: readonly PackingItem[]
  readonly container: ContainerView
  readonly person: readonly PersonGroup[]
  /** ALL mode's rows — every non-container Entry in {@link entriesOf} order,
   * which **is** name A→Z. */
  readonly allEntryIds: readonly string[]
  /** Entry ids holding at least one item the `○ LEFT` filter keeps. */
  readonly entriesWithLeft: ReadonlySet<string>
}

const EMPTY_VIEW: PackingView = {
  items: [],
  container: { groups: [], hasContainer: false, disagreementOf: new Map() },
  person: [],
  allEntryIds: [],
  entriesWithLeft: new Set(),
}

/**
 * CONTAINER mode's whole shape, in one pass over the fold.
 *
 * **Nested containers are indented groups rendered immediately after their
 * parent's own rows** (ruling A4), so the reader walks the physical nesting;
 * the traversal is depth-first for exactly that reason. Order at every level
 * is {@link entriesOf}' — `childrenOf` sorts by id, which is the order a
 * *tree walk* must agree on across replicas and meaningless to read, so the
 * drawn order is re-imposed by filtering the drawn list rather than sorting
 * the walk's.
 *
 * `view` and `items` are built **once** — by {@link packingView}, which is
 * the screen's single memo over the fold — and threaded through here into
 * {@link containerTotals} and {@link disagreements}: each is O(entries) to
 * build, and this screen draws one group per container, so letting them
 * default would pay N × O(entries) on the list the app is used on most —
 * `containerTotals`' own docstring asks for exactly this. They are
 * parameters rather than locals so that the one pair the screen holds is
 * the pair every count, row and residence on it is computed from: a view
 * built here and items built elsewhere would be two reads of the same fold
 * with nothing making them agree.
 *
 * ## The tree comes from the view; the rows come from the items
 *
 * **`childrenOf` builds the CONTAINER TREE and nothing else** — which
 * container nests inside which, an Entry-level fact the view is right about.
 * It is **not** what places a row. `tripContainmentView` is deliberately
 * ungated (it resolves *structure*, and gating a whole Kind inside pointer
 * resolution would conflate two jobs), so it still resolves a per-person
 * Entry's own `residence` register — the register ruling C0 retires — and
 * `childrenOf` will happily list such an Entry under a container holding
 * none of its Pieces. Placing rows from it would put the ignored fact
 * straight back on the screen, which is the exact fault this round exists to
 * remove.
 *
 * So row membership is each **item's own** effective residence
 * ({@link packingItems}), filed under the holder it names. That is the same
 * membership {@link containerTotals} counts by, which is what makes a header
 * agree with the rows drawn beneath it.
 */
function containerView(
  trip: TripState,
  state: DepotState,
  view: TripContainmentView,
  items: readonly PackingItem[],
): ContainerView {
  const entries = entriesOf(trip, state)

  /** `holder`'s children in the **drawn** order. The container tree only —
   * see the docstring. */
  function childrenInOrder(holder: TripHolderRef): readonly EntryState[] {
    const ids = new Set(view.childrenOf(holder))
    return entries.filter((entry) => ids.has(entry.id))
  }

  /** The key a group is filed under. `'loose'` can never collide with a
   * `container:` key whatever an Entry id turns out to be. */
  const holderKey = (residence: TripResidence): string =>
    residence.in === 'loose' ? LOOSE_KEY : `container:${residence.entryId}`

  /** Every item, filed under the group it sits in and then under its Entry:
   * `holder → entryId → the items of that Entry that are there`. One pass,
   * read once per group. */
  const byHolder = new Map<string, Map<string, PackingItem[]>>()

  function bucketFor(key: string): Map<string, PackingItem[]> {
    const existing = byHolder.get(key)
    if (existing !== undefined) return existing
    const created = new Map<string, PackingItem[]>()
    byHolder.set(key, created)
    return created
  }

  for (const item of items) {
    const bucket = bucketFor(holderKey(item.residence))
    const own = bucket.get(item.entryId)
    if (own === undefined) bucket.set(item.entryId, [item])
    else own.push(item)
  }

  /**
   * **A non-container Entry that yields no item at all is a per-person Entry
   * with no Pieces** — no Participant yet, or every Piece tombstoned; every
   * other Kind yields exactly one. C1 draws a row per group holding one of
   * its Pieces and there are none, but the Entry is still a line on the gear
   * list, and a line that draws in no group would vanish from the mode the
   * screen rests in while ALL mode still lists it.
   *
   * `Loose` is where it goes: `Loose` means `NOT IN A CONTAINER` (C4), and a
   * set with no Pieces is in none. That is also S9a's read for the ordinary
   * case — an absent Entry residence — and C0's for the case where a peer
   * wrote it one.
   */
  const withItems = new Set(items.map((item) => item.entryId))
  for (const entry of entries) {
    if (isContainerEntry(entry, state)) continue
    if (withItems.has(entry.id)) continue
    bucketFor(LOOSE_KEY).set(entry.id, [])
  }

  /** One group's rows, in `entriesOf` order — the drawn order, re-imposed on
   * the item list exactly as `childrenInOrder` re-imposes it on the walk. */
  function rowsIn(key: string): readonly PackingGroupRow[] {
    const bucket = byHolder.get(key)
    if (bucket === undefined) return []
    return entries.flatMap((entry) => {
      const own = bucket.get(entry.id)
      if (own === undefined) return []
      const personIds = own.flatMap((item) =>
        item.kind === 'piece' ? [item.personId] : [],
      )
      const hasLeft = own.some((item) => !isPacked(item.status))
      // `personIds` is omitted rather than passed empty for a whole-Entry
      // row: under `exactOptionalPropertyTypes` an absent optional and one
      // present-and-`undefined` are different types, and absent is the fact
      // — *this row is its whole Entry*.
      return [
        personIds.length === 0
          ? { entryId: entry.id, hasLeft }
          : { entryId: entry.id, personIds, hasLeft },
      ]
    })
  }

  const groups: PackingGroup[] = []
  let hasContainer = false
  /**
   * **The termination guard, and this walk is the one that had none** (review
   * F5). `subtreeOf`, `tripPath` and `PackPicker`'s exclusion each carry the
   * same `visited` set and each say in as many words that it "makes
   * termination independent of the view it is handed". This walk relied on
   * `tripContainmentView` having already broken every cycle — true today, and
   * exactly the assumption those three refuse to make. It is also the only
   * one of the four written as **recursion**, so the failure mode is a stack
   * overflow rather than a hang: a blank screen, not a slow one.
   */
  const visited = new Set<string>()

  function pushContainersUnder(holder: TripHolderRef, depth: number): void {
    for (const entry of childrenInOrder(holder)) {
      if (!isContainerEntry(entry, state)) continue
      if (visited.has(entry.id)) continue
      visited.add(entry.id)
      // `stageOf` answers `null` for a non-container and nothing else, and
      // the line above filtered to containers — so there is deliberately no
      // `stage === null` arm here. `PackingGroup.stage` is `StageValue |
      // null` because `Loose` has no journey at all, and that is the only
      // way `null` ever reaches it. (`PackPicker` carries such an arm and
      // needs it: `stageLabel` there demands a non-null argument.)
      const stage = stageOf(entry, state)

      hasContainer = true
      const source = entry.source?.value
      groups.push({
        key: entry.id,
        entryId: entry.id,
        name: entryLabel(entry, state),
        tripOnly: source !== undefined && source.from === 'trip_only',
        depth,
        // Past the cap the indent stops saying where the group sits, so the
        // header says it itself — `tripPath`'s outermost-first segments, the
        // one place the trip world's breadcrumb is derived.
        //
        // **Left as a third copy of `PackPicker`'s identical expression**
        // (review F4), deliberately: it is three chained calls with no rule
        // of its own to get wrong, the rule that *could* drift lives in
        // `tripPath` and is already shared, and a named helper would have to
        // sit in `shared/` — where `INDENT_CAP` is a *drawing* decision that
        // does not belong.
        ancestry:
          depth > INDENT_CAP
            ? tripPath(trip, state, entry.id, view)
                .map((segment) => segment.name)
                .join(' ▸ ')
            : '',
        stage,
        count: containerTotals(trip, state, entry.id, view, items),
        // From the items, never from `childrenOf` — see the docstring. A
        // nested container produces no item at all (`packingItems` skips
        // containers), so the `!isContainerEntry` filter the id list used to
        // need is gone with it: a group's rows are its contents, and its
        // nested containers are the groups that follow.
        rows: rowsIn(`container:${entry.id}`),
        // `ridesAlongCount`, which reads the **items'** effective residences
        // and adds the nested containers ruling A5 leaves out of the units.
        // It used to be `subtreeOf(view, entry.id).size` — the Entry tree,
        // built from raw residence registers — and a per-person Entry whose
        // fold-but-ignore register named this container was counted as riding
        // along while its Pieces sat elsewhere and its row was drawn in
        // another group. See the selector for the whole argument.
        insideCount: ridesAlongCount(trip, state, entry.id, view, items),
      })

      pushContainersUnder({ kind: 'container', entryId: entry.id }, depth + 1)
    }
  }

  pushContainersUnder({ kind: 'loose' }, 0)

  // **`Loose` last** (ruling A3), and drawing nothing when it is empty. On
  // day one everything is loose, so a first-position group of sixty-one rows
  // would push every journey rail — the screen's spine — permanently
  // off-screen. The Pack picker puts `Loose` first and is equally right: a
  // picker lists destinations, this lists work.
  const looseRows = rowsIn(LOOSE_KEY)

  if (looseRows.length > 0) {
    groups.push({
      key: LOOSE_KEY,
      entryId: null,
      name: 'Loose',
      tripOnly: false,
      depth: 0,
      ancestry: '',
      stage: null,
      // Its own items and no subtree: everything inside a container is
      // counted by that container's own header. **The filter is the item's
      // own residence** (ruling C5), the same membership `rowsIn` files by
      // and `containerTotals` counts by — filing by the Entry's holder
      // instead would count a Piece here that is drawn in a bag.
      count: countOf(items.filter((item) => item.residence.in === 'loose')),
      rows: looseRows,
      insideCount: 0,
    })
  }

  return {
    groups,
    hasContainer,
    disagreementOf: new Map(
      disagreements(trip, state, view).map((row) => [row.entryId, row]),
    ),
  }
}

/**
 * PERSON mode's groups, in the **drawn** order.
 *
 * The partition itself is {@link personPartition}'s and is not re-derived
 * here (ruling A7): a Piece goes to its Participant, Personal gear to its
 * owner whether or not they travel, everything else to `Shared`. It is
 * already proved total and proved to sum to `packingTotals` (no longer
 * imported here — this screen spells that arithmetic `countOf(view.items)`,
 * over the list it already holds; see the `totals` line below).
 *
 * **What this function decides is the order, which `shared/` deliberately
 * does not.** `personPartition` returns buckets in person-id order — total
 * and replica-identical, and meaningless to read. The drawn order is
 * {@link peopleOn}'s, which is `sortedPeople`'s People-screen order with a
 * Person whose `person.recorded` has not folded appended rather than dropped
 * (`depot/trips.ts`'s rule, reused rather than restated — a bucket vanishing
 * because a name has not arrived would take that Person's work off the
 * screen).
 *
 * **`Shared` goes last**, and that is a deliberate divergence from the
 * Depot's `GROUP BY OWNER`, whose grouping table pins `shared` **first**.
 * `Shared` is the everything-else bucket and on a real Trip the biggest one,
 * so first position pushes every person header off-screen. The two surfaces
 * answer differently on purpose: the Depot files gear, F4 lists work — the
 * `Loose`-last argument (ruling A3) for the second time on this screen.
 */
function personGroups(trip: TripState, state: DepotState): PersonGroup[] {
  const buckets = personPartition(trip, state)

  const byPerson = new Map<string, PersonBucket>()
  let sharedBucket: PersonBucket | undefined
  for (const bucket of buckets) {
    if (bucket.key.kind === 'shared') sharedBucket = bucket
    else byPerson.set(bucket.key.personId, bucket)
  }

  // `peopleOn` reorders the ids it is handed and adds none, so the empty
  // arm is `Map.get`'s narrowing rather than a case — `PackingRow`'s own
  // `flatMap` over `tripParticipants`, for the same reason.
  const groups: PersonGroup[] = peopleOn(state, [...byPerson.keys()]).flatMap(
    (person) => {
      const bucket = byPerson.get(person.id)
      if (bucket === undefined) return []
      return [
        {
          key: person.id,
          personId: person.id,
          name: person.label,
          count: bucket.count,
          items: bucket.items,
        },
      ]
    },
  )

  if (sharedBucket !== undefined) {
    groups.push({
      key: 'shared',
      personId: null,
      name: 'Shared',
      count: sharedBucket.count,
      items: sharedBucket.items,
    })
  }

  return groups
}

/**
 * Everything the screen draws, from one fold.
 *
 * ALL mode's rows are {@link entriesOf}' order minus the containers — which
 * **is** name A→Z, because `entriesOf` sorts through `byNameThenId`
 * (`selectors/order.ts`), the one comparator every list in this codebase
 * shares. A `localeCompare` here would resolve against the host's locale and
 * ICU data, so two Devices holding identical state would draw the list in
 * different orders; that is the divergence `order.ts`'s own header exists to
 * refuse, and the reason ALL borrows an existing order rather than sorting.
 *
 * **Containers draw no row** (ruling A8): ALL lists what carries a status,
 * and a container's name still appears as its contents' residence segment,
 * so nothing is hidden.
 *
 * `entriesWithLeft` is the `○ LEFT` filter, over items rather than rows — the
 * filter is `!isPacked` and nothing else, and a row survives while any of the
 * items it draws does. For a single or counted Entry that is its own status;
 * for a per-person Entry drawn as one clustered row it is any unpacked Piece,
 * since a row showing `1/3` still holds two pieces of work.
 *
 * **The containment view and the items are built once here and threaded to
 * every reader on this screen that can take one.** Both are O(entries) and
 * both default to building themselves when a caller omits them, so every read
 * that let them default paid for another pair — one per container group, one
 * per per-person row. They are built together, from the same `trip` and
 * `state` this one memo is keyed on, and threaded down; that is also what
 * makes them consistent, since a view resolved from one fold and items
 * resolved from a later one would place rows the counts disagree with.
 *
 * **Two readers still build their own, because their signatures take
 * neither**, and widening them is a `shared/` change this round does not
 * make: {@link personPartition} (through `personGroups`) takes no `view` and
 * no `items`, so PERSON mode's buckets cost a second view and a second list;
 * {@link disagreements} takes the `view` — `containerView` threads it — but
 * has no `items` parameter, so it builds a third list. Two views and three
 * lists per fold, then, all of them inside this one memo. That is the number
 * to beat if a later round widens those two, and it is emphatically not
 * "one": a docblock claiming otherwise is the kind of freshly-written,
 * subtly-wrong sentence this file's convention exists to keep out.
 */
function packingView(trip: TripState, state: DepotState): PackingView {
  const containment = tripContainmentView(trip, state)
  const items = packingItems(trip, state, containment)

  const entriesWithLeft = new Set<string>()
  for (const item of items) {
    if (!isPacked(item.status)) entriesWithLeft.add(item.entryId)
  }

  return {
    items,
    container: containerView(trip, state, containment, items),
    person: personGroups(trip, state),
    allEntryIds: entriesOf(trip, state)
      .filter((entry) => !isContainerEntry(entry, state))
      .map((entry) => entry.id),
    entriesWithLeft,
  }
}

/**
 * What the Pack picker is open for. The three arms are the three things that
 * can be moved on this screen, and they differ in exactly the two ways
 * ruling A2b cares about: whether the act can be seen where it was made (a
 * container's cannot, so it confirms) and which op says it.
 */
type PickerTarget =
  | { kind: 'entry'; entryId: string }
  | {
      kind: 'container'
      entryId: string
      name: string
      insideCount: number
    }
  | { kind: 'piece'; entryId: string; personId: string }

/** A container move, waiting on its confirm (ruling A2b). */
interface PendingMove {
  entryId: string
  movingName: string
  destinationName: string
  insideCount: number
  residence: TripResidence
}

/**
 * **F4 — the screen the app lives on** (`docs/design/README.md` §1, spec
 * `docs/specs/2026-09-01-packing-and-the-journey.md` §4.1, §4.2, §4.3 and
 * §4.7). The band, the title, the arithmetic, the two controls, the one hint
 * — and all three modes beneath them.
 *
 * ## Three modes over one fold, and each answers a different question
 *
 * **CONTAINER** answers *where is it going*, **PERSON** *whose is it*
 * (ruling A7 — ownership, not whose body it goes with, which is story 23 and
 * a fact the app does not hold), **ALL** *is this one thing packed*. That
 * last is a lookup, which is why ALL is flat and sorted by **name** and never
 * by status: sorting by status would move rows under the thumb as they are
 * tapped (ruling A8).
 *
 * Two of the three end their rows' meta lines in the trip residence, amber,
 * because neither draws a header that says where — `PackingRow`'s
 * `showResidence`, and its docstring carries the `▸ MIXED` rule.
 *
 * ## The `○ LEFT` filter is `!isPacked` and nothing else
 *
 * It applies in all three modes, and **a group whose items all filter out
 * draws nothing**. It filters the *view* and never the arithmetic: the count
 * line and every group count state the pack-out's own numbers, which do not
 * move when a control that narrows a list is tapped.
 *
 * Story 13's own worked example — *all of our kid's gear that is still
 * unpacked* — is this pill plus PERSON mode, which is the whole of ruling
 * B4's argument that `STATUS` never belonged on the Depot's slice bar.
 *
 * ## Its own route at every width, and not a pane
 *
 * `/trips/:id/packing` is width-gated by nothing, so `App.tsx` needs none of
 * the `isSplitOrWider ? <X/> : <Redirect/>` shape `/trips/:id/add` and
 * `/trips/:id/list` carry. **A packing row has no detail** — its two acts are
 * a pill and a sheet (ruling A2) — so there is no second pane for a wider
 * viewport to unlock, and ruling A10 caps the one column at 560 instead.
 *
 * ## It renders at every phase, Draft included
 *
 * A phase locks nothing (invariant 16, story 32), and **hiding a route is a
 * soft lock** the phase model forbids — the same reasoning that keeps every
 * editing capability available in every phase. The title is `Pack-out` at
 * every phase because it names the **activity**; the phase itself is already
 * stated on the card and the trip screen by a chip that is the control for
 * changing it, and a second copy of that fact here would be one nothing on
 * this screen can change.
 *
 * ## Every hook above the `No such trip.` guard
 *
 * `Trip.tsx`'s and `GearListBuilder.tsx`'s rule (S7 review F2), for the
 * identical reason: a control reachable against an unknown `tripId` would
 * author an op materialising a Trip that no delete op can remove before S14.
 * A Trip the fold has never seen is also a different fact from one that
 * exists and carries nothing — `state.trips[id]` is `undefined` for the
 * first and an entity with no registers for the second, which draws as an
 * ordinary unnamed Trip.
 *
 * ## The back link survives Desktop — and that is the flag's own reason
 *
 * `useScreenHeader({ splitPane: false, atDesktopSidebarCarriesDestination:
 * false })`, the **eleventh** caller. The flag has existed since S7, added
 * for `GearListBuilder`'s "trip" door, and **F4 needs no new rule**: the
 * 216px sidebar carries `TRIPS`, not `Alps 2026`, so the destination this
 * screen's link points at is not on the page and the link is owed at every
 * width.
 *
 * Worth stating outright, because this is the first screen where the flag's
 * *reason* is the **only** reason it applies — the builder passes it for one
 * of two doors and withholds it for the other, so a reader meeting F4 first
 * will otherwise read a Desktop back link as an exception to §3.3 rather
 * than as §3.3 answering the question it was written to answer. The sync
 * line is the ordinary rule: Split alone, where `AppShell` puts only a bare
 * 6px dot in the rail.
 *
 * ## The group header is the container's *where* target
 *
 * **A decision no board draws, and it is forced rather than invented.** A
 * container Entry never appears as a row anywhere on this screen — in
 * CONTAINER mode it is a group, PERSON mode's partition excludes it
 * (`packingItems` skips containers) and ALL mode draws no container rows at
 * all (ruling A8) — yet ruling A2b rules on a container *move*, the Pack
 * picker carries `excludeEntryId` and the `MOVING CRATE B · 5 INSIDE RIDE
 * ALONG` context line for one, and `ContainerMoveConfirm` exists to state
 * it. The group header is the only surface left, and it takes the row's own
 * two-track shape: **body = where** (this picker), **rail = how far along**.
 *
 * It is drawn ≥48 rather than at the board's ~22px text height, because the
 * board draws no control there at all: ruling O's standalone rule applies —
 * "a standalone control is simply drawn ≥48" — and the rail's own clamped
 * `::after` then meets it edge to edge instead of overlapping it.
 *
 * ## A move is suppressed when it changes nothing
 *
 * `PackPicker` reports a tap on its `● NOW` row like any other and says in
 * its own docblock that the caller must drop it. This is that caller: a
 * selection equal to the residence passed as `current` authors **no** op, in
 * all three arms of {@link PickerTarget}, for the journey rail's own reason
 * — a redundant write moves the stamp LWW compares and can beat a genuine
 * concurrent write from another Device.
 *
 * ## `Move` fires both callbacks, so cancel does not reopen anything
 *
 * `Confirm.Action` closes the dialog as well as running its `onClick`, and
 * Radix reports that close through `onOpenChange` — which is
 * `ContainerMoveConfirm`'s `onCancel`. So a successful `Move` calls
 * `onConfirm` **and then** `onCancel`, pinned by that component's own test.
 * Both handlers here therefore do the same one thing to the pending move —
 * clear it — and `onCancel` reopens nothing. Reopening the picker on cancel
 * would reopen it after every successful move too.
 *
 * ## What this screen does not draw
 *
 * **No over-claim band.** It is a property of the *gear list* — the trip
 * screen and the builder's right pane — and F4 is not the gear list. Two
 * Trips claiming one Piece is a fact about membership; this screen asks how
 * far along one Trip's own pack-out is.
 *
 * **No pinned footer bar and no `UNDO`** (ruling A9). `UNDO` is drawn and
 * not built — the third instance of the §3b/§3c precedent and the strongest,
 * because this screen holds the app's most tapped writes, so a reversal that
 * quietly weakens with time is worst on it and story 36 forbids exactly
 * that. With no action left the bar retires on the builder's own argument (a
 * read does not spend the thumb zone), and **the hint moves under the
 * controls row**, read once at the start rather than at the foot of
 * sixty-one rows.
 */
export function Packing() {
  const params = useParams<{ id: string }>()
  const tripId = params.id
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  const header = useScreenHeader({
    splitPane: false,
    // See the docstring: the sidebar carries `TRIPS`, never one Trip's name,
    // so this screen's own back link is owed at Desktop too.
    atDesktopSidebarCarriesDestination: false,
  })

  // The two controls' own state. `mode` chooses the partition; `leftOnly`
  // filters `!isPacked`, in all three modes.
  const [mode, setMode] = useState<PackingMode>('container')
  const [leftOnly, setLeftOnly] = useState(false)

  /**
   * Person groups the reader has opened by hand.
   *
   * **The collapse is derived, and this set is the override.** A group with
   * nothing left is drawn collapsed (ruling A7's `● 12/12`), which is a fact
   * about the ledger and not a widget's memory — so packing a group's last
   * item collapses it without anybody storing that, and unpacking anything
   * inside it opens it again. This holds only the deliberate exception: the
   * header tapped to look inside a finished group.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const toggleExpanded = (key: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  // The three overlays this screen owns. `PackPicker` and `PieceStatusSheet`
  // can be open together — the sheet's trailing `MOVE` opens the picker for
  // one Piece over it, and closing the picker returns to the sheet.
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [sheetEntryId, setSheetEntryId] = useState<string | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)

  const trip = tripId === undefined ? undefined : state.trips[tripId]

  const view = useMemo<PackingView>(
    () => (trip === undefined ? EMPTY_VIEW : packingView(trip, state)),
    [trip, state],
  )

  if (tripId === undefined || trip === undefined) {
    return (
      <div className={styles['screen']}>
        <p className={styles['missing']}>No such trip.</p>
      </div>
    )
  }

  // `entriesOf` counts **lines**, which is what `0 ENTRIES.` says — not
  // `packingTotals`, which counts things that travel. The two differ on a
  // Trip holding only containers: ruling A5 excludes a container from PIECES
  // so the denominator stays reachable, so such a Trip has one Entry and no
  // pieces, and it is a list with something on it rather than an empty one.
  const empty = entriesOf(trip, state).length === 0
  // `countOf(view.items)` **is** `packingTotals` — that selector is exactly
  // `countOf(packingItems(trip, state))` — spelled over the memo's own list
  // rather than through the wrapper, which would rebuild the view and the
  // items on every render. This line sits outside the memo, so it was the one
  // build an interaction paid for: opening the Pack picker, opening the Piece
  // sheet or arming a confirm re-renders on a fold that has not moved, and
  // each of those re-renders was a full view-plus-items build for a total
  // that cannot have changed. No signature widened: `countOf` is exported for
  // this, and the arithmetic stays the one in `packing.ts`.
  const totals = countOf(view.items)

  /** Where the thing the picker is open for rides **now** — the `● NOW`
   * mark, and the value a selection is compared against before anything is
   * authored. */
  // Arrow functions, not declarations: a hoisted `function` can in
  // principle be called before the `No such trip.` guard above, so
  // TypeScript declines to carry `trip`'s narrowing into one. These are
  // created after it and read the narrowed `TripState`.
  const currentResidenceOf = (target: PickerTarget): TripResidence => {
    if (target.kind !== 'piece') {
      // **Through `entryResidenceOf`, never the register** (ruling C0). The
      // two `??`s answer two different questions and both are reachable: the
      // Entry is `undefined` when another Device removed it between opening
      // the picker and this render (`PackingRow` guards the same way), and
      // the gate is `null` for a per-person Entry, whose *where* is only ever
      // a per-Piece fact — so there is no `● NOW` to mark and `Loose` is the
      // honest one. No shipped control opens an `entry` picker on that Kind
      // today (a per-person row's body opens the sheet in every mode), and
      // reading the retired register here would state a place C0 says does
      // not exist the moment one did.
      const entry = trip.entries?.[target.entryId]
      if (entry === undefined) return TRIP_LOOSE
      return entryResidenceOf(entry, state) ?? TRIP_LOOSE
    }
    // A Piece's residence is a per-Piece fact and nothing else (ruling C0) —
    // `packingItems`' read, taken from there rather than restated so the
    // picker's `● NOW` cannot disagree with the sheet's `▸ DUFFEL 90 L`.
    // From the memo's own list rather than a fresh call: the same items the
    // rows behind the picker were drawn from, and no second containment view.
    for (const item of view.items) {
      if (item.kind !== 'piece') continue
      if (item.entryId !== target.entryId) continue
      if (item.personId !== target.personId) continue
      return item.residence
    }
    return TRIP_LOOSE
  }

  /** The destination's own name, for the confirm's title. A pointer this
   * replica cannot resolve reads `Loose`, which is what
   * `tripContainmentView` will make of it too. */
  const nameOfResidence = (residence: TripResidence): string => {
    if (residence.in === 'loose') return 'Loose'
    const container = trip.entries?.[residence.entryId]
    return container === undefined ? 'Loose' : entryLabel(container, state)
  }

  const selectResidence = (
    target: PickerTarget,
    residence: TripResidence,
  ): void => {
    // The suppression `PackPicker` hands its caller — see the docstring.
    if (sameTripResidence(currentResidenceOf(target), residence)) return

    if (target.kind === 'container') {
      // Ruling A2b: the ride-along is elsewhere on the screen and may be
      // filtered out of view, so this one act states itself first.
      setPendingMove({
        entryId: target.entryId,
        movingName: target.name,
        destinationName: nameOfResidence(residence),
        insideCount: target.insideCount,
        residence,
      })
      return
    }

    if (target.kind === 'piece') {
      emit(tripPieceMoved(tripId, target.entryId, target.personId, residence))
      return
    }

    emit(tripEntryMoved(tripId, target.entryId, residence))
  }

  const pickerEntry =
    picker === null ? undefined : trip.entries?.[picker.entryId]

  /**
   * The `○ LEFT` filter, over Entry rows: `!isPacked` and nothing else
   * (ruling B4's own worked example, *all of our kid's gear that is still
   * unpacked*, is this plus PERSON mode).
   *
   * The **counts are not filtered**. `9/13 · 4 LEFT` and `● 4/9 PIECES` state
   * the Trip's arithmetic, and a header whose denominator moved as a filter
   * was tapped would be answering a question about the view rather than about
   * the pack-out.
   */
  const visibleRows = (entryIds: readonly string[]): readonly string[] =>
    leftOnly
      ? entryIds.filter((entryId) => view.entriesWithLeft.has(entryId))
      : entryIds

  /**
   * The same filter over CONTAINER mode's rows, where a row is an Entry
   * **narrowed to one group's Pieces** (ruling C1) and so carries its own
   * answer. A Headlamp packed in the duffel and unpacked loose keeps its
   * `Loose` row and drops its duffel one; `entriesWithLeft`, which is an
   * Entry-level fact, would keep both.
   */
  const visibleGroupRows = (
    rows: readonly PackingGroupRow[],
  ): readonly PackingGroupRow[] =>
    leftOnly ? rows.filter((row) => row.hasLeft) : rows

  /** The same filter over PERSON mode's items, where the row **is** the item:
   * one Piece can be packed while its siblings in other groups are not. */
  const visibleItems = (
    items: readonly PackingItem[],
  ): readonly PackingItem[] =>
    leftOnly ? items.filter((item) => !isPacked(item.status)) : items

  /** One row per item, for PERSON mode. A `piece` item draws that Piece
   * alone; anything else draws its whole Entry. */
  const rowFor = (item: PackingItem) => (
    <li
      key={
        item.kind === 'piece'
          ? `${item.entryId}:${item.personId}`
          : item.entryId
      }
    >
      <PackingRow
        tripId={tripId}
        entryId={item.entryId}
        tripItems={view.items}
        showResidence
        onOpenPicker={() =>
          setPicker(
            item.kind === 'piece'
              ? {
                  kind: 'piece',
                  entryId: item.entryId,
                  personId: item.personId,
                }
              : { kind: 'entry', entryId: item.entryId },
          )
        }
        onOpenPieceSheet={() => setSheetEntryId(item.entryId)}
        {...(item.kind === 'piece' ? { personId: item.personId } : {})}
      />
    </li>
  )

  return (
    <div className={styles['screen']}>
      <ScreenBand
        header={header}
        back={{ href: `/trips/${tripId}`, label: tripLabel(trip) }}
        sync={sync}
        syncTestId="packing-sync"
      />

      <h1 className={styles['title']}>Pack-out</h1>

      {empty ? (
        /*
         * The trip screen's permanent fact, word for word: a domain fact and
         * not a promise — it is where a gear list comes from, true before
         * this slice and after it.
         *
         * **The count line and the bar are absent, not zeroed** — `● 0/0
         * PIECES` states an arithmetic nobody asked for. The controls and the
         * hint go with them, on the same argument carried one step: a
         * segmented control partitions a list, the pill filters one, and the
         * hint names three gestures on rows. With no rows all three are dead
         * affordances, which is exactly what spec §4.9 forbids when it argues
         * the `GEAR LIST` band draws no door to a screen that can only say
         * `0 ENTRIES.`. `Trip.tsx` takes the same shape — its empty region
         * replaces the `GEAR LIST` band, not merely the rows under it.
         */
        <section className={styles['empty']}>
          <p className={styles['emptyCount']}>0 ENTRIES.</p>
          <p className={styles['emptySource']}>
            The gear list is built from the depot.
          </p>
        </section>
      ) : (
        <>
          <div className={styles['counts']}>
            {/* Composed by `packedLabel`/`leftLabel` (`depot/trips.ts`)
                rather than here, because the active trip card draws this same
                line and the two have to read identically — `tripChip`'s own
                arrangement one screen along. The glyph is the packed marker
                from the one status table and not a literal, which is half of
                what those two exist to keep true. */}
            <span className={styles['packed']}>{packedLabel(totals)}</span>
            <span className={styles['left']}>{leftLabel(totals)}</span>
          </div>

          {/* `aria-hidden`, because the line immediately above states the
              identical fact in words and in the ledger's own vocabulary. A
              `role="progressbar"` here would announce a third reading of one
              number — `FirstSync`'s bar earns its role by being the only
              statement of a percentage nothing else says. */}
          <div
            className={styles['bar']}
            data-testid="packing-bar"
            aria-hidden="true"
          >
            <div
              className={styles['fill']}
              style={{ inlineSize: `${packedPercent(totals)}%` }}
            />
          </div>

          <div className={styles['controls']} data-testid="packing-controls">
            <fieldset className={styles['segmentedField']}>
              {/* No visible label on the board, so the group is named for
                  assistive technology alone — `ui/styles/utilities.css`'s own
                  recipe (`frontend-design.md` §4.1) rather than a fifth
                  hand-rolled copy of it. */}
              <legend className="visually-hidden">Group by</legend>
              {/* `ui/SegmentedControl`, dense. This screen's own copy was the one of
                  the three that had already worked out the clipping trap and
                  the vertical-only extension, so the primitive inherited its
                  rules wholesale and nothing here is drawn differently. The
                  fieldset and legend stay: they are what the screen knows and
                  the primitive does not. */}
              <SegmentedControl
                name="packing-mode"
                options={MODES}
                value={mode}
                onChange={setMode}
                size="dense"
              />
            </fieldset>

            <button
              type="button"
              className={styles['filter']}
              aria-pressed={leftOnly}
              onClick={() => setLeftOnly(!leftOnly)}
            >
              ○ LEFT{leftOnly && <span aria-hidden="true"> ✕</span>}
            </button>
          </div>

          <p className={styles['hint']}>{HINT}</p>

          {mode === 'container' && (
            <div className={styles['groups']} data-testid="packing-groups">
              {view.container.groups.map((group) => {
                const rows = visibleGroupRows(group.rows)
                // **A group whose items all filter out draws nothing** — and
                // the emptiness has to be *caused* by the filter, which is
                // why `group.rows.length > 0` is a separate conjunct and
                // not a tidier `rows.length === 0` alone.
                //
                // A container produces no item of its own, so **a container
                // whose only children are nested containers arrives here
                // with no rows at all**. Nothing filtered out of it;
                // dropping it would take its journey rail and its ▲ line off
                // the screen the moment `○ LEFT` was pressed, and orphan
                // every nested group beneath it. The rail is that
                // container's own journey, not its contents'.
                if (leftOnly && group.rows.length > 0 && rows.length === 0)
                  return null

                const headingId = `packing-group-${tripId}-${group.key}`
                // `null` is `Loose` — a holder, not an Entry. Read once into
                // a local so every branch below narrows on the same fact.
                const containerId = group.entryId
                const disagreement =
                  containerId === null
                    ? undefined
                    : view.container.disagreementOf.get(containerId)

                return (
                  <section
                    key={group.key}
                    className={styles['group']}
                    // The indent the cap allows, as a step rather than a
                    // pixel count — the stylesheet turns it into the 16px
                    // per level the Home picker's rule sets.
                    data-indent={String(Math.min(group.depth, INDENT_CAP))}
                    aria-labelledby={headingId}
                  >
                    <div
                      className={styles['groupHeader']}
                      data-testid="packing-group-header"
                    >
                      {containerId === null ? (
                        /* `Loose` is a holder, not an Entry: there is
                           nothing to move and nothing to open a picker
                           onto, so its header is text. */
                        <div className={styles['headerBody']}>
                          <span className={styles['headerMain']}>
                            <span
                              id={headingId}
                              className={`${styles['groupName']} ${styles['looseName']}`}
                              data-testid="packing-group-name"
                            >
                              {group.name}
                            </span>
                            <span className={styles['groupMeta']}>
                              NOT IN A CONTAINER
                            </span>
                          </span>
                          <span className={styles['groupCount']}>
                            {group.count.packed}/{group.count.total}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles['headerBody']}
                          data-testid="packing-group-move"
                          onClick={() =>
                            setPicker({
                              kind: 'container',
                              entryId: containerId,
                              name: group.name,
                              insideCount: group.insideCount,
                            })
                          }
                        >
                          <span className={styles['headerMain']}>
                            <span className={styles['headerNameLine']}>
                              <span
                                id={headingId}
                                className={styles['groupName']}
                                data-testid="packing-group-name"
                              >
                                {group.name}
                              </span>
                              {/* Ruling A14: a trip-only container is an
                                  ordinary group plus this tag — the row
                                  treatment promoted to the header. */}
                              {/* `{' '}` for `PackingRow`'s reason: the
                                  flex `gap` in `.headerNameLine` separates
                                  the two spans on screen but not in the
                                  header button's accessible name, which
                                  would otherwise read
                                  `Crate, borrowedTRIP-ONLY`. */}
                              {group.tripOnly && (
                                <>
                                  {' '}
                                  <span className={styles['badge']}>
                                    TRIP-ONLY
                                  </span>
                                </>
                              )}
                            </span>
                            {group.ancestry !== '' && (
                              <span className={styles['groupMeta']}>
                                {group.ancestry}
                              </span>
                            )}
                          </span>
                          <span className={styles['groupCount']}>
                            {group.count.packed}/{group.count.total}
                          </span>
                        </button>
                      )}

                      {/* A rail inside a rail is correct: the rail is that
                          container's own journey, and story 10's
                          disagreement case is exactly the nested one. */}
                      {group.stage !== null && containerId !== null && (
                        <JourneyRail
                          current={group.stage}
                          label={`Journey — ${group.name}`}
                          onSet={(stage) =>
                            emit(
                              tripContainerStageSet(tripId, containerId, stage),
                            )
                          }
                        />
                      )}

                      {disagreement !== undefined && (
                        <p
                          className={styles['disagreement']}
                          data-testid="packing-disagreement"
                        >
                          {/* The `▲` in its own element — the trip card's
                              date warning verbatim: a single text node would
                              force the attention class onto the whole line
                              or onto none of it, and the `▲` is the system's
                              attention mark while the sentence beside it is
                              the ledger stating a count. */}
                          <span className={styles['attention']}>▲</span>{' '}
                          {disagreement.label} · {disagreement.notPacked} INSIDE
                          NOT PACKED
                        </p>
                      )}
                    </div>

                    <ul className={styles['rows']}>
                      {rows.map((row) => (
                        // The Entry id keys the row: C1 draws **one** row per
                        // Entry per group, so it is unique within this list
                        // even where the same Entry is drawn in three groups.
                        <li key={row.entryId}>
                          <PackingRow
                            tripId={tripId}
                            entryId={row.entryId}
                            tripItems={view.items}
                            // Spread rather than passed: under
                            // `exactOptionalPropertyTypes` an absent optional
                            // and one present-and-`undefined` are different
                            // types, and absent is the fact — *this row is
                            // its whole Entry*.
                            {...(row.personIds === undefined
                              ? {}
                              : { scopedPersonIds: row.personIds })}
                            onOpenPicker={() =>
                              setPicker({
                                kind: 'entry',
                                entryId: row.entryId,
                              })
                            }
                            // Ruling C3: **the Entry's** sheet, from every row
                            // C1 draws — one sheet per Entry, never one per
                            // row, so the split is seen whole and mended at
                            // `MOVE`. The scoping stops at the row.
                            onOpenPieceSheet={() =>
                              setSheetEntryId(row.entryId)
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}

              {/* A Trip with no containers draws the one `Loose` group
                  holding everything, and below the last row the permanent
                  fact — where a group comes from, said once. */}
              {!view.container.hasContainer && (
                <p className={styles['fact']}>{NO_CONTAINERS}</p>
              )}
            </div>
          )}

          {mode === 'person' && (
            <div className={styles['groups']} data-testid="packing-groups">
              {view.person.map((group) => {
                const items = visibleItems(group.items)
                if (leftOnly && items.length === 0) return null

                // Ruling A7: an all-done person reads `● 12/12` with its rows
                // collapsed, the header tappable to expand. **The word
                // `COLLAPSED` is dropped** — a group with no rows under it is
                // self-evident, and the word is about the widget rather than
                // the ledger.
                const done = group.count.left === 0
                const open = !done || expanded.has(group.key)
                const headingId = `packing-group-${tripId}-${group.key}`

                const count = done
                  ? `${statusGlyph('packed')} ${group.count.packed}/${group.count.total}`
                  : `${group.count.packed}/${group.count.total} · ${group.count.left} LEFT`

                const heading = (
                  <>
                    <span className={styles['headerMain']}>
                      <span className={styles['personLine']}>
                        {/* 28px — group-header density (§5d K). `Shared` is
                            not a Person and draws none: a circle there would
                            claim an attribution the group exists to say is
                            absent. */}
                        {group.personId !== null && (
                          <span aria-hidden="true" className={styles['circle']}>
                            {/* `tone` is the group's own one fact: `filled`
                                where nothing is left, `control` otherwise —
                                the `●` in `● 12/12` said a second way, never
                                colour alone. It is deliberately **not** the
                                three-way `toneForStatus` a row's circle
                                takes: a group has no status, and borrowing
                                that vocabulary would invent one. */}
                            <PersonCircle
                              size={28}
                              tone={done ? 'filled' : 'control'}
                              label={personInitial(group.name)}
                            />
                          </span>
                        )}
                        <span
                          id={headingId}
                          className={`${styles['groupName']} ${
                            group.personId === null ? styles['looseName'] : ''
                          }`}
                          data-testid="packing-group-name"
                        >
                          {group.name}
                        </span>
                      </span>
                      {group.personId === null && (
                        <span className={styles['groupMeta']}>
                          {NOT_ATTRIBUTED}
                        </span>
                      )}
                    </span>
                    <span
                      className={`${styles['groupCount']} ${
                        done ? styles['countDone'] : ''
                      }`}
                    >
                      {count}
                    </span>
                  </>
                )

                return (
                  <section
                    key={group.key}
                    className={styles['group']}
                    aria-labelledby={headingId}
                  >
                    <div
                      className={styles['groupHeader']}
                      data-testid="packing-group-header"
                    >
                      {/* The header is a control **only where it has
                          something to do**: a group with work left is
                          already showing it, and a button that expands what
                          is expanded is the dead affordance the empty state
                          refuses one screen up. `Loose`'s text header, one
                          mode over, is the same rule. */}
                      {done ? (
                        <button
                          type="button"
                          className={styles['headerBody']}
                          data-testid="packing-group-expand"
                          aria-expanded={open}
                          onClick={() => toggleExpanded(group.key)}
                        >
                          {heading}
                        </button>
                      ) : (
                        <div className={styles['headerBody']}>{heading}</div>
                      )}
                    </div>

                    {open && (
                      <ul className={styles['rows']}>{items.map(rowFor)}</ul>
                    )}
                  </section>
                )
              })}
            </div>
          )}

          {mode === 'all' && (
            <ul className={styles['rows']} data-testid="packing-groups">
              {visibleRows(view.allEntryIds).map((entryId) => (
                <li key={entryId}>
                  <PackingRow
                    tripId={tripId}
                    entryId={entryId}
                    tripItems={view.items}
                    showResidence
                    onOpenPicker={() => setPicker({ kind: 'entry', entryId })}
                    onOpenPieceSheet={() => setSheetEntryId(entryId)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {sheetEntryId !== null && (
        <PieceStatusSheet
          tripId={tripId}
          entryId={sheetEntryId}
          onClose={() => setSheetEntryId(null)}
          onOpenPieceMove={(personId) =>
            setPicker({ kind: 'piece', entryId: sheetEntryId, personId })
          }
        />
      )}

      {/* The Entry lookup is the mount condition rather than a fallback
          title: an Entry another Device removed between opening the picker
          and this render has no name to draw, and a sheet titled with a
          UUID would be worse than no sheet. */}
      {pickerEntry !== undefined && picker !== null && (
        <PackPicker
          tripId={tripId}
          title={entryLabel(pickerEntry, state)}
          current={currentResidenceOf(picker)}
          onClose={() => setPicker(null)}
          onSelect={(residence) => selectResidence(picker, residence)}
          {...(picker.kind === 'container'
            ? {
                excludeEntryId: picker.entryId,
                moving: {
                  name: picker.name,
                  insideCount: picker.insideCount,
                },
              }
            : {})}
        />
      )}

      {pendingMove !== null && (
        <ContainerMoveConfirm
          movingName={pendingMove.movingName}
          destinationName={pendingMove.destinationName}
          insideCount={pendingMove.insideCount}
          onConfirm={() => {
            emit(
              tripEntryMoved(
                tripId,
                pendingMove.entryId,
                pendingMove.residence,
              ),
            )
            setPendingMove(null)
          }}
          // `Move` fires this too — see the docstring. It clears and
          // reopens nothing, which is the whole of the handling.
          onCancel={() => setPendingMove(null)}
        />
      )}
    </div>
  )
}
