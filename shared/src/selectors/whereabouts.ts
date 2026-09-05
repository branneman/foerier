import type {
  HouseholdState,
  StageValue,
  StatusValue,
  TripResidence,
  TripState,
} from '../state.ts'
import {
  containmentView,
  homePath,
  type ContainmentView,
  type PathSegment,
} from './containment.ts'
import { overClaims } from './claim.ts'
import { ownedCountOf } from './depot.ts'
import {
  bringCountOf,
  entriesOf,
  entryKind,
  entryLabel,
  isContainerEntry,
} from './entry.ts'
import { byNameThenId } from './order.ts'
import {
  entryResidenceOf,
  pieceStatusOf,
  sameTripResidence,
  stageOf,
  stageWord,
  TRIP_LOOSE,
} from './packing.ts'
import { piecesOf } from './piece.ts'
import { isActive, participantIds, tripLabel, visibleTrips } from './trip.ts'
import {
  tripContainmentView,
  tripPath,
  type TripContainmentView,
} from './tripContainment.ts'

/**
 * **Where a piece of gear is, right now** — story 3, domain §4. Derived on
 * demand, never stored: nothing here is written back by any op.
 *
 * S9a wrote the facts and **S9b reads them**. A Trip's packing arrangement
 * holds residences of its own (`trip.entry_moved`, `trip.piece_moved`) and
 * its containers hold journey stages (`trip.container_stage_set`); this file
 * is where they reach the depot, so the Depot no longer answers
 * `⌂ HAL ▸ LADE 2` for a headlamp that is in the duffel, in the car.
 *
 * **The whole risk of this file is two surfaces disagreeing**, not
 * convergence: every answer here is a pure function of `HouseholdState`, so every
 * replica computes the same one by construction. What can go wrong is the
 * Depot column saying `⌂ HOME` while gear detail says `▸ ALPS 2026`, which is
 * why each rule below is stated in exactly one place and read from there —
 * and why nothing in this file re-derives a default another selector owns
 * (`ownedCountOf`, `bringCountOf`, `entryResidenceOf`, `stageOf`,
 * `isActive`, `isContainerEntry`, `entryKind`, `piecesOf`).
 */

/**
 * D2: one, several, or none — each segment of a slice resolves on its own.
 */
export type TripContainerRead =
  { of: 'one'; entryId: string; name: string } | { of: 'mixed' } | null

export type WhereaboutsSlice =
  | {
      kind: 'home'
      path: PathSegment[]
      /** Units at home. `null` wherever no quantity splits — per-person gear
       *  has no owned-count (invariant 6), and Single gear has no quantity at
       *  all (D1). Floored at zero when over-claimed (D8). */
      count: number | null
    }
  | {
      kind: 'trip'
      tripId: string
      /** `tripLabel` — never abbreviated (§5b G); truncated by CSS only. */
      tripName: string
      /** The **immediate** holder, `MIXED` when the slice's residences
       *  disagree, `null` when loose. Never a breadcrumb — S9a §11.2's
       *  Piece-status-sheet rule (D2, D3). */
      container: TripContainerRead
      /** The **root** of the containment chain (D3), or `null` when nothing
       *  carries one or the slice's residences disagree about it. */
      stage: StageValue | null
      /** Units out on this Trip; `null` for per-person and Single (D1). */
      count: number | null
      /** Pieces of this Gear out on this Trip — `2 PIECES OUT`. */
      pieceCount: number | null
    }

export interface Whereabouts {
  gearId: string
  slices: WhereaboutsSlice[]
  /** D8 — claims exceed supply, so *where* has no single answer. Computed in
   *  the same pass as the slices, never by a caller. */
  overClaimed: boolean
}

/**
 * B1's segment ladder, from the right: `full` draws all four segments,
 * `column` drops the container, `chip` drops the stage as well.
 *
 * **The home row's two forms answer a different question from the trip
 * row's**, which is why `chip` is not simply one rung below `column`. B1's
 * ladder is about a *trip* string running out of width; home's forms answer
 * *does this surface state the home path in a neighbouring slot*. The Depot
 * table has a `HOME` column and the 2-line row has its meta line, so `column`
 * says the word; Find's card row and a `PIECES` chip have no such neighbour,
 * so they say the path.
 */
export type WhereaboutsDensity = 'full' | 'column' | 'chip'

export interface PersonWhereabouts {
  personId: string
  /** This Person's own answer — a trip slice while their Piece is out on an
   *  active Trip, otherwise the Gear's home slice. A **removed** Piece falls
   *  through to home with nothing said about the removal (B5). */
  slice: WhereaboutsSlice
  /** This Piece's own packing status (`pieceStatusOf`) — `null` exactly when
   *  `slice` is the home answer, whether because this Person's Piece was
   *  never included or was tombstoned (B5): a Piece at home has no packing
   *  status, because it is not on a trip to be packed for. Read from the
   *  same walk that resolves `slice`'s residence, never a second one — this
   *  file's own two-surfaces-disagree risk applied to itself. */
  status: StatusValue | null
  /** The Trips whose Pieces both name this Person — `▲ CLAIMED BY 2 TRIPS`.
   *  Empty in every ordinary case: a Piece belongs to at most one active
   *  Trip (domain §5.2), so this is only reachable once an over-claim has
   *  arrived through sync. */
  contestedTripIds: readonly string[]
}

/** The `▸` of the trip world and the `⌂` of the home world (Components §11). */
const TRIP_GLYPH = '▸'
const HOME_GLYPH = '⌂'

/** The glyph that replaces either of the two above when the answer is
 *  contested — D8's swap, and the reason it is a *replacement* rather than a
 *  prefix: the glyph names the world, and an over-claim means *where* has no
 *  world to name. */
const ATTENTION_GLYPH = '▲'

/** `WhereaboutsCard.pathText`'s and `GearDetail.chipLocation`'s own fallback
 *  for gear residing in no Place and no container — the ubiquitous-language
 *  term, **exported** so the card and the column read the one spelling
 *  rather than each declaring their own (finding 3 of the S9b review: a
 *  private copy in each of two `app/` files is exactly the two-surfaces
 *  divergence this file's own header warns against). */
export const LOOSE_TEXT = 'LOOSE'

/** The word F4's ALL mode already uses for this exact fact (D2), exported
 *  for the same reason as {@link LOOSE_TEXT}. */
export const MIXED_TEXT = 'MIXED'

/**
 * The two segments a slice's residences reconcile into, before either is
 * paired with a count. Held together because they are computed from one walk
 * and read as one pair, and **kept apart as two fields** because D2 makes
 * each resolve on its own: a disagreeing stage drops, and never draws a
 * second `MIXED`.
 */
interface SegmentRead {
  container: TripContainerRead
  stage: StageValue | null
}

/**
 * One residence, before the slice's residences are reconciled with each
 * other: the **effective** pointer (already resolved through
 * {@link TripContainmentView}) alongside the pair it reads as.
 *
 * The raw pointer is carried because the container segment is decided by
 * {@link sameTripResidence} over these, not by comparing holder ids — a
 * **loose** residence is a residence, and `PackingRow` already draws
 * `▸ MIXED` on F4 the moment one Piece is loose and another is in the crate.
 * Deciding it any other way here would have gear detail read
 * `▸ ALPS 2026 · CRATE B` for the set F4 calls `▸ MIXED`, which is precisely
 * the two-surfaces-disagree failure this slice's whole risk is (§1).
 */
interface ResidenceRead extends SegmentRead {
  residence: TripResidence
}

/**
 * One active Trip's whole hold on one piece of Gear: the reconciled slice
 * (D2), the counts (D1), and the per-Person residences {@link
 * whereaboutsByPerson} hands back one at a time.
 */
interface TripSliceFacts extends SegmentRead {
  tripId: string
  tripName: string
  count: number | null
  pieceCount: number | null
  /** D6's keys — this Trip's Participants, whether or not their Piece is
   *  included, so a Participant whose Piece was removed still reads home on
   *  the card rather than vanishing from it (B5). */
  participantIds: readonly string[]
  /** The Participants whose Piece is **included**, each with their own
   *  segment read. A Person's answer is where *their* Piece is, never the
   *  Entry-wide reconciliation above. */
  pieces: ReadonlyMap<string, SegmentRead>
  /** Each included Piece's own packing status (`pieceStatusOf`), gathered in
   *  the same walk as `pieces` above rather than a second one — Find's
   *  per-person row status and `pieces`' own residence must never disagree
   *  about which Entry they came from. */
  pieceStatus: ReadonlyMap<string, StatusValue | null>
}

/**
 * The gear→trip-slices index and the over-claimed gear ids, memoised on the
 * folded state.
 *
 * `whereabouts` is called **once per row** on the Depot's 128-row list and
 * once per match on Find, on every keystroke. Answering the trip question per
 * Gear means scanning every active Trip's Entries — an O(gear × entries) cost
 * that screen cannot absorb per render. That is S7's exact problem one
 * dimension later, and it takes S7's exact answer: `slice.ts`'s
 * `tripMembershipOf` states the whole argument and this is its second
 * instance, the one [architecture §12.13] predicted when it wrote *"the next
 * cross-aggregate dimension should expect to need the same memo, not a new
 * mechanism"*.
 *
 * `HouseholdState` is immutable and its identity changes on exactly the folds
 * that could change the answer — the reducer returns the same object when a
 * write loses — so the key is exact rather than approximate, and a `WeakMap`
 * lets superseded states be collected.
 *
 * **`overClaims` is folded into the same pass**, and read exactly once.
 * It is itself a scan of every active Trip's Entries, so calling it per row
 * would double the cost this memo exists to remove.
 */
const TRIP_SLICES = new WeakMap<
  HouseholdState,
  {
    byGear: Map<string, readonly TripSliceFacts[]>
    overClaimed: ReadonlySet<string>
  }
>()

/**
 * What one Entry contributes to its Gear's slice, before the Trip's Entries
 * are reconciled with each other.
 *
 * `residences` are **already resolved** through {@link TripContainmentView}:
 * a residence register is a raw pointer and can name an Entry this replica
 * has not folded, has seen removed, or that is not a container at all, and
 * resolving those four reasons exactly once — in the view, never at a call
 * site — is what keeps this file's answer identical to F4's.
 */
interface EntryContribution {
  /** One per thing this Entry places: one for a whole Entry, one per included
   *  Piece for a per-person Entry. */
  residences: readonly ResidenceRead[]
  /** Counted only (D1). */
  count: number | null
  /** Per-person only (D1). */
  pieceCount: number | null
  /** The included Pieces and where each sits — empty unless this Entry has
   *  Pieces at all. */
  pieces: ReadonlyMap<string, ResidenceRead>
  /** Each included Piece's own packing status, from `pieceStatusOf` in the
   *  same per-Piece loop that resolves `pieces` above — never a second walk
   *  of this Entry. Empty wherever `pieces` is. */
  pieceStatus: ReadonlyMap<string, StatusValue | null>
}

/**
 * The stage of the **root** of the chain a thing rides in (D3): the container
 * is *what it is in*, the stage is *where that is*, because a container
 * carries its contents — story 10 whole.
 *
 * `start` is the entry the chain begins at: **the item itself** when the item
 * is a container Entry, otherwise its immediate holder. `null` — a loose
 * non-container — has no chain and therefore no stage, which is a different
 * fact from a stage of `home` and is kept different.
 *
 * The walk is `tripPath`, which the Pack picker and ALL mode already share,
 * so there is no rank function, no second traversal and no new register.
 */
function chainRootStage(
  trip: TripState,
  state: HouseholdState,
  view: TripContainmentView,
  start: string | null,
): StageValue | null {
  if (start === null) return null
  const ancestors = tripPath(trip, state, start, view)
  const rootId = ancestors[0]?.entryId ?? start
  const root = trip.entries?.[rootId]
  return root === undefined ? null : stageOf(root, state)
}

/**
 * One residence, read as the pair D2 draws: the **immediate** holder and the
 * **root's** stage.
 *
 * `self` is the Entry's own id when the thing being placed is a container
 * Entry, and `null` otherwise — the one place D3's *a container's chain
 * starts at itself* is stated. A loose container therefore reports no holder
 * and its own stage; nested, it reports its holder and the root's, which is
 * exactly how anything else inside reads.
 */
function segmentOf(
  trip: TripState,
  state: HouseholdState,
  view: TripContainmentView,
  holderEntryId: string | null,
  self: string | null,
): ResidenceRead {
  // `holder === undefined` is a **defensive** re-test, not a live rule:
  // every `holderEntryId` this function is ever called with came out of
  // `TripContainmentView.resolveResidence`, which returns a container id
  // only from `visible` and a holder id only from `holders` — both subsets
  // of `trip.entries` — so `holder` is unreachable here. Kept as a guard
  // rather than a non-null assertion; do not take it for a rule to copy.
  const holder =
    holderEntryId === null ? undefined : trip.entries?.[holderEntryId]
  return {
    residence:
      holderEntryId === null || holder === undefined
        ? TRIP_LOOSE
        : { in: 'container', entryId: holderEntryId },
    container:
      holderEntryId === null || holder === undefined
        ? null
        : {
            of: 'one',
            entryId: holderEntryId,
            name: entryLabel(holder, state),
          },
    stage: chainRootStage(trip, state, view, self ?? holderEntryId),
  }
}

/**
 * What one Entry places, and how many of the Gear it holds.
 *
 * **The container check comes first, before Kind** — `packingItems` and
 * `statusOf` both do this, and for their reason: `container` and `kind` are
 * orthogonal registers on the Gear, so a per-person container is authorable
 * and its *where* is an Entry-level fact whatever its Kind. Its own resolved
 * holder comes from `view.holderOf`, the tree's own answer, rather than from
 * `entryResidenceOf` — which answers `null` for a per-person Entry and would
 * put a per-person duffel loose while F4 draws it in the car.
 *
 * **But the counts follow Kind, never the container trait.** That is
 * `claim.ts`'s permanent divergence from `pieceCountOf`, and for its reason:
 * whereabouts counts **depot supply out on a Trip**, not packing pieces, and
 * a container is as much out on the Trip as anything inside it.
 */
function contributionOf(
  trip: TripState,
  state: HouseholdState,
  view: TripContainmentView,
  entry: { id: string },
): EntryContribution {
  const entity = trip.entries?.[entry.id]
  if (entity === undefined) {
    return {
      residences: [],
      count: null,
      pieceCount: null,
      pieces: new Map(),
      pieceStatus: new Map(),
    }
  }

  const kind = entryKind(entity, state)
  const count = kind === 'counted' ? bringCountOf(entity, state) : null
  const included = kind === 'per_person' ? piecesOf(entity, trip) : []
  const pieceCount = kind === 'per_person' ? included.length : null

  if (isContainerEntry(entity, state)) {
    const holder = view.holderOf(entity.id)
    const segment = segmentOf(
      trip,
      state,
      view,
      holder.kind === 'container' ? holder.entryId : null,
      entity.id,
    )
    // A container is one thing wherever it rides, so every Piece of a
    // per-person container rides with it — there is no per-Piece residence
    // to refine it with. `pieceStatusOf` is still called per Person rather
    // than hardcoded `null` — it already answers `null` for any container
    // (`statusOf`'s own gate), and calling it here rather than assuming its
    // answer is what keeps this the *only* place that decides.
    return {
      residences: [segment],
      count,
      pieceCount,
      pieces: new Map(included.map((personId) => [personId, segment])),
      pieceStatus: new Map(
        included.map((personId) => [
          personId,
          pieceStatusOf(entity.pieces?.[personId], entity, state),
        ]),
      ),
    }
  }

  if (kind === 'per_person') {
    const pieces = new Map<string, ResidenceRead>()
    const pieceStatus = new Map<string, StatusValue | null>()
    for (const personId of included) {
      // A Piece with no `residence` of its own reads **loose**, never its
      // Entry's (§5e C0) — for per-person gear *where it is* is only ever a
      // per-Piece fact, and `entryResidenceOf` answers `null` for this Kind
      // precisely so nothing falls back to it.
      const holder = view.resolveResidence(
        entity.pieces?.[personId]?.residence?.value,
      )
      pieces.set(
        personId,
        segmentOf(
          trip,
          state,
          view,
          holder.kind === 'container' ? holder.entryId : null,
          null,
        ),
      )
      // Read in the same per-Piece loop that resolves `pieces` above, off
      // the same `entity.pieces?.[personId]` this Entry already holds —
      // never a second walk of the Trip's Entries to find it again.
      pieceStatus.set(
        personId,
        pieceStatusOf(entity.pieces?.[personId], entity, state),
      )
    }
    return {
      residences: [...pieces.values()],
      count,
      pieceCount,
      pieces,
      pieceStatus,
    }
  }

  const holder = view.resolveResidence(entryResidenceOf(entity, state))
  return {
    residences: [
      segmentOf(
        trip,
        state,
        view,
        holder.kind === 'container' ? holder.entryId : null,
        null,
      ),
    ],
    count,
    pieceCount,
    pieces: new Map(),
    pieceStatus: new Map(),
  }
}

/**
 * D2's reconciliation: **each segment on its own**, never one is-it-mixed
 * question governing both.
 *
 * - `container` — **one residence for everybody, or `MIXED`.** The test is
 *   {@link sameTripResidence}, the app's own, so a slice reads `MIXED`
 *   exactly when `PackingRow` draws `▸ MIXED` for the same set on F4 — a
 *   loose residence beside a held one included, since loose *is* a
 *   residence. When they agree the shared residence names itself, which is
 *   `null` when that residence is loose ("none (all loose) → `null`").
 * - `stage` — every residence's chain-root stage, compared **by value**. Two
 *   residences under two different roots that both read `car` agree, and the
 *   slice reads `car` (`▸ ALPS 2026 · MIXED · CAR`); disagreement drops the
 *   segment and **never draws a second `MIXED`**.
 *
 * The two segments therefore disagree in exactly one direction: `MIXED` with
 * a stage, and `MIXED` with none. *One container with no stage* is
 * unreachable by construction — one residence for everybody is one chain root
 * is one stage — and that is a property of the rules rather than a case with
 * no test.
 */
function reconcile(residences: readonly ResidenceRead[]): SegmentRead {
  const first = residences[0]
  const shared =
    first !== undefined &&
    residences.every((read) =>
      sameTripResidence(first.residence, read.residence),
    )
  const container: TripContainerRead =
    first === undefined ? null : shared ? first.container : { of: 'mixed' }

  const stages = new Set<StageValue | null>(
    residences.map((residence) => residence.stage),
  )
  const stage = stages.size === 1 ? ([...stages][0] ?? null) : null

  return { container, stage }
}

/**
 * Home first, then trip slices **by trip name A→Z with the trip id as a total
 * tiebreak** — `design/README.md` §4's standing order, and the one D7's
 * `RESOLVE` destination reads off.
 *
 * It is `order.ts`'s {@link byNameThenId} behind a one-line adapter and not a
 * comparator of its own: that file exists because *"a second copy of a
 * total-order comparator is exactly how two devices start drawing lists
 * differently again"*, and a copy that agrees today is still one edit from
 * diverging invisibly.
 *
 * The adapter shape is what the borrowing costs. `byNameThenId` sorts a
 * `{id, name: {value}}` **register-shaped** entity, and a `TripSliceFacts`
 * holds neither — its `tripName` is already `tripLabel`'s resolved answer.
 * Feeding the label rather than the raw register is deliberate, and is
 * `sortedPeople`'s stated rule: sort by the label a row actually draws, or a
 * nameless Trip files under an empty string while the reader sees a word.
 */
function compareTripFacts(a: TripSliceFacts, b: TripSliceFacts): number {
  return byNameThenId(
    { id: a.tripId, name: { value: a.tripName } },
    { id: b.tripId, name: { value: b.tripName } },
  )
}

/** Builds (once per state) or returns the cached gear→trip-slices index. */
function tripSlicesOf(state: HouseholdState): {
  byGear: Map<string, readonly TripSliceFacts[]>
  overClaimed: ReadonlySet<string>
} {
  const cached = TRIP_SLICES.get(state)
  if (cached !== undefined) return cached

  const byGear = new Map<string, TripSliceFacts[]>()

  // Domain §4: *"Only an active trip's packing arrangement has effect. A
  // draft trip's arrangement is not yet real and a closed trip's is no longer
  // real, so neither is consulted."* `isActive` is the only definition of
  // active-ness in the codebase.
  //
  // **This is deliberately not the rule `slice.ts`'s `trip` dimension uses**,
  // which includes every *non-closed* Trip. Membership is a property of a
  // list; whereabouts is a claim about where a thing physically is, and a
  // Draft gear list has not moved anything. A Gear on a Draft reads
  // `TRIP: ALPS 2026` in the slice bar and `⌂ HOME` in the column beside it,
  // and both are right. Never unify the two.
  for (const trip of visibleTrips(state).filter(isActive)) {
    const view = tripContainmentView(trip, state)
    const tripName = tripLabel(trip)
    const participants = participantIds(trip)

    // Gathered per Gear, because a Trip may list one Gear twice — nothing in
    // the catalogue forbids it, and `claimsByGear` already accumulates rather
    // than assuming one.
    const gathered = new Map<
      string,
      {
        residences: ResidenceRead[]
        count: number | null
        pieceCount: number | null
        pieces: Map<string, ResidenceRead>
        pieceStatus: Map<string, StatusValue | null>
      }
    >()

    for (const entry of entriesOf(trip, state)) {
      const source = entry.source?.value
      // A trip-only Entry names no Gear and can appear in no depot answer.
      if (source === undefined || source.from !== 'depot') continue

      const contribution = contributionOf(trip, state, view, entry)
      const bucket = gathered.get(source.gearId) ?? {
        residences: [],
        count: null,
        pieceCount: null,
        pieces: new Map<string, ResidenceRead>(),
        pieceStatus: new Map<string, StatusValue | null>(),
      }
      bucket.residences.push(...contribution.residences)
      if (contribution.count !== null) {
        bucket.count = (bucket.count ?? 0) + contribution.count
      }
      if (contribution.pieceCount !== null) {
        bucket.pieceCount = (bucket.pieceCount ?? 0) + contribution.pieceCount
      }
      for (const [personId, segment] of contribution.pieces) {
        bucket.pieces.set(personId, segment)
      }
      for (const [personId, status] of contribution.pieceStatus) {
        bucket.pieceStatus.set(personId, status)
      }
      gathered.set(source.gearId, bucket)
    }

    for (const [gearId, bucket] of gathered) {
      const facts: TripSliceFacts = {
        tripId: trip.id,
        tripName,
        ...reconcile(bucket.residences),
        count: bucket.count,
        pieceCount: bucket.pieceCount,
        participantIds: participants,
        pieces: bucket.pieces,
        pieceStatus: bucket.pieceStatus,
      }
      const list = byGear.get(gearId)
      if (list === undefined) byGear.set(gearId, [facts])
      else list.push(facts)
    }
  }

  for (const list of byGear.values()) list.sort(compareTripFacts)

  const overClaimed = new Set(
    overClaims(state).map((overClaim) => overClaim.gearId),
  )

  const built = { byGear, overClaimed }
  TRIP_SLICES.set(state, built)
  return built
}

/** The trip slice a caller sees, built from the facts the memo holds. */
function sliceOf(facts: TripSliceFacts): WhereaboutsSlice {
  return {
    kind: 'trip',
    tripId: facts.tripId,
    tripName: facts.tripName,
    container: facts.container,
    stage: facts.stage,
    count: facts.count,
    pieceCount: facts.pieceCount,
  }
}

/**
 * The whole answer: the home slice, one slice per active claiming Trip, and
 * whether the claims exceed the supply.
 *
 * **Home is always the first slice, and there is always exactly one.** The
 * domain states the fact (*"the home residence is never vacated by a trip"*)
 * and D1 gives it teeth: a Single gear out on a Trip keeps its home row,
 * because dropping it would delete the path you need to put the thing back,
 * exactly while it is away.
 *
 * The home **count** is `ownedCountOf(gear)` minus every Bring-count out,
 * floored at zero (D8: *a negative count of things on a shelf is not a fact
 * about the shelf; it is a fact about the claims*). `ownedCountOf` already
 * answers `null` for anything that is not Counted, so per-person's *no
 * owned-count* (invariant 6) and Single's *no quantity at all* (D1) fall out
 * of that one gate rather than a second Kind test here.
 *
 * `view` is the **home** containment view; pass one when you already have it,
 * because building it is O(depot log depot) and a list screen wants one, not
 * one per row. The Trip's own views are built inside the memo.
 */
export function whereabouts(
  state: HouseholdState,
  gearId: string,
  view: ContainmentView = containmentView(state),
): Whereabouts {
  const gear = state.gear[gearId]
  const { byGear, overClaimed } = tripSlicesOf(state)
  const facts = byGear.get(gearId) ?? []

  const owned = gear === undefined ? null : ownedCountOf(gear)
  const out = facts.reduce((sum, fact) => sum + (fact.count ?? 0), 0)
  const count = owned === null ? null : Math.max(0, owned - out)

  return {
    gearId,
    slices: [
      { kind: 'home', path: homePath(state, gearId, view), count },
      ...facts.map(sliceOf),
    ],
    overClaimed: overClaimed.has(gearId),
  }
}

/** The container segment's word: the holder's name, `MIXED` when the slice's
 *  residences disagree, `LOOSE` when nothing holds it. **Exported** —
 *  `WhereaboutsCard.tsx` read a byte-identical private copy of this until
 *  the S9b review's finding 3; both now call this one. */
export function containerText(container: TripContainerRead): string {
  if (container === null) return LOOSE_TEXT
  return container.of === 'mixed' ? MIXED_TEXT : container.name
}

/**
 * B1's segment ladder — `▸ WORLD · TRIP NAME · CONTAINER · STAGE`, dropped
 * from the right, rightmost-but-one first.
 *
 * | Density | Trip slice | Home slice |
 * | --- | --- | --- |
 * | `full` | `▸ ALPS 2026 · DUFFEL 90 L · CAR` | `⌂ HAL ▸ LADE 2` |
 * | `column` | `▸ ALPS 2026 · CAR` | `⌂ HOME` |
 * | `chip` | `▸ ALPS 2026` | `⌂ HAL ▸ LADE 2` |
 *
 * A stage is drawn through `stageWord` and **never `stageLabel`**: `label` is
 * the *rail's* text and carries the home mark (`⌂ HOME`), which would put a
 * home-world glyph inside a trip-world line — `docs/design/README.md` §2
 * makes `⌂` the home mark and `▸` the trip mark app-wide, and B1's segment
 * order exists to say this line is a trip statement. Both functions render an
 * unrecognised stage **verbatim** rather than coercing it (§5.3 obligation 4).
 *
 * **Gear detail calls none of these three densities** — its card carries all
 * four segments across two lines and composes them from the slice itself.
 */
export function whereaboutsText(
  slice: WhereaboutsSlice,
  density: WhereaboutsDensity,
): string {
  if (slice.kind === 'home') {
    if (density === 'column') return `${HOME_GLYPH} HOME`
    const path = slice.path.map((segment) => segment.name).join(' ▸ ')
    return `${HOME_GLYPH} ${path === '' ? LOOSE_TEXT : path}`
  }

  const segments = [slice.tripName]
  if (density === 'full') segments.push(containerText(slice.container))
  if (density !== 'chip' && slice.stage !== null) {
    segments.push(stageWord(slice.stage))
  }
  return `${TRIP_GLYPH} ${segments.join(' · ')}`
}

/**
 * B2's single-slot read, for a list row: the text **and** `GearRow`'s tone.
 *
 * ```
 * 0 trip slices → ⌂ HOME                              tone home
 * 1 trip slice  → whereaboutsText(slice, 'column')    tone trip
 * 2 or more     → ▸ N TRIPS  (stage dropped)          tone trip
 * overClaimed   → the same word, glyph ▲              tone attention
 * ```
 *
 * One function rather than a formatter over one slice, because the rule reads
 * the **whole** answer and no single slice can answer it. It returns the tone
 * as well, so no caller decides for itself which world it is looking at.
 *
 * **D8's swap is a glyph swap and nothing else** (§6.1): the glyph names the
 * world and the word is B2's read unchanged, so a Counted Gear owned `×2`
 * with one Trip bringing `×4` reads `▲ ALPS 2026 · CAR` — an over-claim with
 * a single claim, which D8's own `▲ 2 TRIPS` example does not cover.
 *
 * `GearRow.tone` has carried `'home' | 'trip' | 'attention'` since S2b, which
 * wrote that the third arm *"arrives with story 11's `lost` outcome"*. D8
 * gets there one slice earlier.
 */
export function rowWhereabouts(w: Whereabouts): {
  text: string
  tone: 'home' | 'trip' | 'attention'
} {
  const trips = w.slices.filter((slice) => slice.kind === 'trip')
  const first = trips[0]

  const text =
    first === undefined
      ? `${HOME_GLYPH} HOME`
      : trips.length === 1
        ? whereaboutsText(first, 'column')
        : `${TRIP_GLYPH} ${trips.length} TRIPS`

  if (!w.overClaimed) {
    return { text, tone: first === undefined ? 'home' : 'trip' }
  }
  return {
    text: `${ATTENTION_GLYPH}${text.slice(1)}`,
    tone: 'attention',
  }
}

/**
 * `×2 THERE` · `×1 OUT` · `2 PIECES OUT` · `null` — D1's rule, *the
 * right-hand read names the unit that splits*.
 *
 * It needs only the slice, because the rule is already encoded in **which of
 * `count` and `pieceCount` is non-null**: the Kind is read once, where the
 * slice is built. Re-reading it here would be the second spelling this file
 * exists to avoid.
 *
 * `×0 THERE` stays legitimate on Counted gear — D8's case — and unreachable
 * on Single, which has no quantity to state.
 */
export function sliceCountLabel(slice: WhereaboutsSlice): string | null {
  if (slice.kind === 'home') {
    return slice.count === null ? null : `×${slice.count} THERE`
  }
  if (slice.count !== null) return `×${slice.count} OUT`
  if (slice.pieceCount === null) return null
  // `1 PIECE` / `2 PIECES` — `GearListSection`'s own noun rule, one file over.
  return `${slice.pieceCount} ${slice.pieceCount === 1 ? 'PIECE' : 'PIECES'} OUT`
}

/**
 * One answer per **Participant of the claiming Trip(s)** — D6 — for gear
 * detail's `PIECES` group and Find's per-person card.
 *
 * **The keys are Participants, not every recorded Person.** A Person not on
 * the Trip has the home answer the card's home row already states once, and
 * drawing it again per Person re-makes B3's identical-circles fault on the
 * surface B3 built. A Participant whose Piece was **removed** stays in the
 * map and reads home (B5), which is why the strictest reading — only the
 * differing — was also refused.
 *
 * **Each Participant's slice carries their own Piece's residence**, resolved
 * per Piece, and never the Entry-wide reconciliation {@link whereabouts}
 * computes: a Person's answer is where *their* Piece is, so an Entry reading
 * `MIXED` still gives Mark `DUFFEL 90 L · CAR` and Ana `LOOSE`.
 *
 * **A Map keyed by id, and not an ordered list, on purpose.** The order both
 * callers draw is People-screen order, which lives in `app/src/household/people.ts`'s
 * `sortedPeople` and exists there because *"the People screen and the owner
 * picker are two views of one list"*. Returning a second ordering from
 * `shared/` would make three.
 */
export function whereaboutsByPerson(
  state: HouseholdState,
  gearId: string,
  view: ContainmentView = containmentView(state),
): ReadonlyMap<string, PersonWhereabouts> {
  const answer = whereabouts(state, gearId, view)
  const home = answer.slices[0]
  const facts = tripSlicesOf(state).byGear.get(gearId) ?? []

  const byPerson = new Map<string, PersonWhereabouts>()
  for (const fact of facts) {
    for (const personId of fact.participantIds) {
      if (byPerson.has(personId)) continue
      // `facts` is already sorted by trip name A→Z, so the first Trip
      // claiming this Person's Piece is D7's `RESOLVE` destination and is
      // also the slice they read.
      const claiming = facts.filter((candidate) =>
        candidate.pieces.has(personId),
      )
      const first = claiming[0]
      const segment = first?.pieces.get(personId)
      const included = first !== undefined && segment !== undefined
      byPerson.set(personId, {
        personId,
        slice: included
          ? {
              kind: 'trip',
              tripId: first.tripId,
              tripName: first.tripName,
              container: segment.container,
              stage: segment.stage,
              // A Person's slice speaks for **their one Piece**: per-person
              // gear has no owned-count (invariant 6) and one Person brings
              // one.
              count: null,
              pieceCount: 1,
            }
          : // `home` is `undefined` only if `whereabouts` returned no
            // slices at all, which it never does.
            (home ?? { kind: 'home', path: [], count: null }),
        // `null` exactly when the slice above is home — a Piece at home has
        // no packing status, whether because it was never included or was
        // tombstoned (B5). Read off the same `first`/`pieces` walk above,
        // never a second lookup: `pieceStatus` was gathered in the identical
        // per-Piece loop that resolved `pieces`.
        status: included ? (first.pieceStatus.get(personId) ?? null) : null,
        contestedTripIds:
          claiming.length >= 2 ? claiming.map((trip) => trip.tripId) : [],
      })
    }
  }
  return byPerson
}
