import type {
  DepotState,
  EntryState,
  PieceState,
  StageValue,
  StatusValue,
  TripResidence,
  TripState,
} from '../state.ts'
import {
  entriesOf,
  entryKind,
  isContainerEntry,
  pieceCountOf,
} from './entry.ts'
import { ownerOf } from './owner.ts'
import { piecesOf } from './piece.ts'
import {
  type TripContainmentView,
  type TripHolderRef,
  tripContainmentView,
} from './tripContainment.ts'

/**
 * **Packing's read side** — beside `trip.ts` and `owner.ts`, and the same
 * shape of problem solved the same way: a handful of facts several surfaces
 * must agree on, stated once here rather than at each of them.
 *
 * **The spine is {@link packingItems}.** A packing item is a whole Entry or
 * one Piece of a per-person Entry, and the four count lines — the trip total,
 * a container group's count, a person group's count and the `○ LEFT` filter —
 * are all that one list read through that one predicate. Deriving any of them
 * separately is the drift this file exists to prevent, and the symptom is a
 * group header disagreeing with the rows drawn under it.
 *
 * Three of those facts outlive this slice, which is why they are functions
 * and not idioms:
 *
 * - **An absent `status` register reads `not_packed`; an absent `stage` reads
 *   `home`**, and only {@link statusOf} / {@link pieceStatusOf} /
 *   {@link stageOf} say so. This is `ownerOf`'s rule and `phaseOf`'s rule for
 *   a fourth and fifth time. The fold conflates nothing — absent and an
 *   explicit `"not_packed"` stay different facts about the log — but every
 *   reader treats them alike, and saying so exactly once is what stops the
 *   row, the group count, the progress line and the ▲ line drifting apart.
 *   The symptom of a call site re-deriving it is a row drawn `NOT PACKED`
 *   while the group header counts it packed.
 * - **{@link isPacked} is the only definition of packed-ness in the
 *   codebase** — {@link isActive}'s sibling and for its reason. The
 *   numerator, `N LEFT`, the `○ LEFT` filter and S10's close gate must never
 *   disagree about what counts. `staged` is **not** packed.
 * - **`stage` xor `status` is a gate on the way out, never in the reducer**
 *   (spec §1.3). The containment trait lives on the Gear aggregate, so a
 *   reducer resolving it would make the fold order-dependent on whether
 *   `gear.recorded` had arrived. Both registers fold unconditionally; these
 *   two functions decide which one a reader may see.
 *
 * **There is deliberately no `nextStage`.** Ruling A15 makes the rail a
 * direct set, so a "next" would be a function with no caller and an idiom the
 * design round retired.
 */

/** The three statuses this build knows, as a **closed** union — deliberately
 * narrower than {@link StatusValue}, exactly as `PhaseKey` is narrower than
 * `PhaseValue`. A key is a row in {@link STATUSES}; a value is whatever
 * arrived, and asking it a question has to go through a lookup that can
 * miss. */
export type StatusKey = 'not_packed' | 'staged' | 'packed'
export type StageKey = 'home' | 'staging' | 'car' | 'packed'

export interface PackingStatus {
  id: StatusKey
  /** `NOT PACKED` · `STAGED` · `PACKED`. */
  label: string
  /** `○` · `◐` · `●` — the pill, the `SET EVERYONE` chips and the count line
   * all draw it, so it is a column of the table rather than a switch at three
   * call sites. */
  glyph: string
  /** What {@link isPacked} reads. Exactly one row carries `true`. */
  packed: boolean
}

export interface JourneyStage {
  id: StageKey
  /** `⌂ HOME` · `STAGING` · `CAR` · `PACKED`. */
  label: string
  /**
   * The **trip-world** word for this stage — `HOME`, `CAR` — with no glyph
   * of any kind.
   *
   * A third string rather than a transform of {@link label}, for
   * `disagreementLabel`'s reason one column over: `label` is the *rail's*
   * drawn text and carries the home mark (`⌂ HOME`), which is right on the
   * rail and wrong everywhere the stage rides inside a **trip** statement.
   * `docs/design/README.md` §2 makes `⌂` the home mark and `▸` the trip mark
   * app-wide, so `whereaboutsText`'s `▸ ALPS 2026 · CRATE B · ⌂ HOME` would
   * put a home glyph inside a trip line — the one thing B1's segment order
   * exists to state. No function derives one string from the other without
   * knowing which kind of word each is, which is what the table knows and a
   * screen does not.
   */
  word: string
  /**
   * The ▲ line's own word for this stage — `IN CAR`, `PACKED` — or `null`
   * where the line never fires.
   *
   * **One field, not a boolean plus a string**, so ruling A6's "fires at
   * `car` and `packed` only" cannot drift from the phrasing it fires with.
   * It is a second string rather than a transform of {@link label} for
   * `Phase.name`'s reason: `CAR` becomes `IN CAR` and `PACKED` stays
   * `PACKED`, and no function gets both right without knowing what kind of
   * word each is — which is what the table knows and a screen does not.
   *
   * `staging` is `null` because **staging *is* the act of packing**: unpacked
   * contents on the staging floor are the work, not a contradiction.
   */
  disagreementLabel: string | null
}

/** In the pill's cycle order, which the `SET EVERYONE` chips also draw. */
export const STATUSES: readonly PackingStatus[] = [
  { id: 'not_packed', label: 'NOT PACKED', glyph: '○', packed: false },
  { id: 'staged', label: 'STAGED', glyph: '◐', packed: false },
  { id: 'packed', label: 'PACKED', glyph: '●', packed: true },
]

/** In the rail's drawn order — the sequence a container usually runs, though
 * ruling A15 makes every chip a direct set in either direction. */
export const STAGES: readonly JourneyStage[] = [
  { id: 'home', label: '⌂ HOME', word: 'HOME', disagreementLabel: null },
  { id: 'staging', label: 'STAGING', word: 'STAGING', disagreementLabel: null },
  { id: 'car', label: 'CAR', word: 'CAR', disagreementLabel: 'IN CAR' },
  {
    id: 'packed',
    label: 'PACKED',
    word: 'PACKED',
    disagreementLabel: 'PACKED',
  },
]

/**
 * The rows, or `undefined` for a value this build has never heard of.
 *
 * **Private on purpose**, for the reason `phaseRow` gives and three S6
 * reviews caught: every question the tables answer has a named function
 * beside it, so no caller has to remember what a missing row means. A
 * question wanting a row exports a named function beside these rather than
 * the lookup.
 */
function statusRow(status: StatusValue): PackingStatus | undefined {
  return STATUSES.find((row) => row.id === status)
}

function stageRow(stage: StageValue): JourneyStage | undefined {
  return STAGES.find((row) => row.id === stage)
}

/**
 * The Entry's status, or `null` for a **container** — which carries a journey
 * *instead of* a status (sync §3.7) and can therefore never be marked packed.
 *
 * `null` is returned whatever the register holds: a peer on another build may
 * have written one, and the tolerant reader folds it rather than rejecting
 * it. This is the gate spec §1.3 keeps out of the reducer.
 */
export function statusOf(
  entry: EntryState,
  state: DepotState,
): StatusValue | null {
  if (isContainerEntry(entry, state)) return null
  return entry.status?.value ?? 'not_packed'
}

/**
 * One Piece's status. `piece` may be `undefined` — a Piece is **derived**
 * (`piece.ts`), so a Participant who has never been addressed by a Piece op
 * has no `PieceState` at all and must still answer `not_packed`.
 */
export function pieceStatusOf(
  piece: PieceState | undefined,
  entry: EntryState,
  state: DepotState,
): StatusValue | null {
  if (isContainerEntry(entry, state)) return null
  return piece?.status?.value ?? 'not_packed'
}

/**
 * The Entry's own trip residence, or `null` for a **per-person** Entry —
 * whose *where* is only ever a per-Piece fact (§5e C0). An absent register on
 * every other Kind reads {@link TRIP_LOOSE}, which is this file's fourth
 * absent-reads rule and stated only here.
 *
 * **The third instance of a shape the codebase already had twice**, and it is
 * here for their reason: `bringCountOf` answers `null` for anything
 * non-Counted whatever the register holds, {@link statusOf} answers `null`
 * for a container whatever the register holds, and this answers `null` for a
 * per-person Entry whatever the register holds. `trip.entry_moved` on a
 * per-person Entry is **fold-but-ignore** — the reducer keeps folding it,
 * because a peer on another build may write one and
 * [sync §5.3]'s tolerant reader is absolute, and no reader consults it for
 * this Kind. Naming the gate is what stops a call site re-deriving it, and
 * the symptom of a copy is CONTAINER mode and ALL mode stating different
 * places for the same gear — the fault S9 round 2 exists to remove.
 *
 * **This overturns S9a's own decision** that a Piece with no residence reads
 * its Entry's, then loose. It reads **loose**. S9a's spec §11.2 is a dated
 * record and is not edited; the round-2 spec is where the overturn lives.
 */
export function entryResidenceOf(
  entry: EntryState,
  state: DepotState,
): TripResidence | null {
  if (entryKind(entry, state) === 'per_person') return null
  return entry.residence?.value ?? TRIP_LOOSE
}

/** The container's journey stage, or `null` for a non-container. */
export function stageOf(
  entry: EntryState,
  state: DepotState,
): StageValue | null {
  if (!isContainerEntry(entry, state)) return null
  return entry.stage?.value ?? 'home'
}

/** How a status is drawn. An unrecognised value renders **verbatim** —
 * `trip.ts`'s answer for an unrecognised phase, and §5.3 obligation 4's. */
export function statusLabel(status: StatusValue): string {
  return statusRow(status)?.label ?? status
}

/** The pill's glyph. An unrecognised value draws `○` — it is not packed, and
 * the pill must still paint something. */
export function statusGlyph(status: StatusValue): string {
  return statusRow(status)?.glyph ?? '○'
}

/** The rail's drawn text, home mark included. */
export function stageLabel(stage: StageValue): string {
  return stageRow(stage)?.label ?? stage
}

/**
 * The stage's word with no glyph — what a **trip** statement names it, and
 * what `whereaboutsText`'s stage segment draws.
 *
 * A second exported function rather than a parameter on {@link stageLabel},
 * following this file's own convention that the row lookup stays private and
 * every question the table answers has exactly one function beside it. An
 * unrecognised stage renders **verbatim**, exactly as `stageLabel` does — §5.3
 * obligation 4 stores it verbatim, and inventing a casing for it is coercion.
 */
export function stageWord(stage: StageValue): string {
  return stageRow(stage)?.word ?? stage
}

/** Ruling A6's threshold, half of it: which stages the ▲ line fires at, and
 * what it calls them. `null` for `home`, `staging` and anything unrecognised
 * — a build that cannot name a stage cannot claim a disagreement about it. */
export function stageDisagreementLabel(stage: StageValue): string | null {
  return stageRow(stage)?.disagreementLabel ?? null
}

/**
 * The pill's cycle: `not_packed → staged → packed → not_packed`.
 *
 * An unrecognised value cycles to `not_packed` — **the only answer that is
 * not an invention**. Guessing a position in a sequence this build does not
 * hold would author a status on the strength of a spelling.
 */
export function nextStatus(status: StatusValue): StatusValue {
  const index = STATUSES.findIndex((row) => row.id === status)
  if (index === -1) return 'not_packed'
  return STATUSES[(index + 1) % STATUSES.length]?.id ?? 'not_packed'
}

/**
 * **The only definition of packed-ness in the codebase.** The numerator,
 * `N LEFT`, the `○ LEFT` filter, every group count and S10's close gate read
 * this and nothing else. An unrecognised status is not packed.
 */
export function isPacked(status: StatusValue): boolean {
  return statusRow(status)?.packed === true
}

/**
 * Ruling A6's **one** carve-out, named rather than spelled inline at the one
 * place it applies: see {@link countsAsDisagreement}.
 */
const A6_CARVE_OUT: StatusKey = 'staged'

/**
 * Ruling A6's threshold, the **status** half — {@link stageDisagreementLabel}
 * is the stage half, and {@link disagreements} fires only where both say yes.
 *
 * `!isPacked` **minus one carve-out**, and each of the three parts is a
 * decision:
 *
 * - {@link isPacked} stays the only definition of packed-ness. This reads it
 *   rather than re-deriving it, so the numerator and the ▲ can never
 *   disagree about what `packed` means.
 * - **`staged` is carved out**, and it is A6's only carve-out: staging *is*
 *   the act of packing, so counting it would fire on nearly every container
 *   in the car and the ▲ would stop meaning anything.
 * - **An unrecognised status counts.** A6's carve-out is drawn against
 *   `staged` specifically, and the ruling never reached the unrecognised
 *   case, so this is decided on which way the failure points. Excluding it
 *   hides the ▲ *entirely* on a crate in the car full of gear this build
 *   cannot name — the disagreement the whole feature exists to surface,
 *   silently gone. Counting it draws `▲ IN CAR · 3 INSIDE NOT PACKED`
 *   where one of the three reads `in_the_shed`: slightly loose wording on a
 *   warning that is correctly telling the truth, and visible rather than
 *   silent. Nor is it an exotic case — an open enum is the mechanism
 *   story 20's per-trip editable statuses ship on, so the excluding version
 *   would leave every Trip using a custom status with a permanently silent
 *   ▲.
 */
export function countsAsDisagreement(status: StatusValue): boolean {
  return !isPacked(status) && status !== A6_CARVE_OUT
}

export function isKnownStatus(status: StatusValue): boolean {
  return statusRow(status) !== undefined
}

export function isKnownStage(stage: StageValue): boolean {
  return stageRow(stage) !== undefined
}

/**
 * One thing that carries a status: a whole Entry, or **one Piece** of a
 * per-person Entry.
 *
 * This is the spine the four count lines share — the trip total, a container
 * group's count, a person group's count and the `○ LEFT` filter. Deriving it
 * once is what makes them agree; deriving it four times is exactly the drift
 * this file's header warns about, and the symptom is a group header
 * disagreeing with the rows drawn under it.
 *
 * `units` is what the item contributes to a denominator: a **Counted** Entry
 * contributes its whole Bring-count (ruling A13 — one register, one pill, one
 * tap moving the count by two), everything else contributes one. That is
 * `pieceCountOf`'s table and it is **read, not restated** — summed over a
 * Trip these units are exactly `listTotals(trip, state).pieces`, which a test
 * pins, so the builder's footer and this screen's numerator cannot drift.
 * Both are the `pieces`/`perPerson` family, which counts **things that
 * travel**, and not the `entries`/`tripOnly` family, which counts lines.
 *
 * **Containers produce no item**, and neither do sourceless or removed
 * Entries — {@link entriesOf} has already excluded the latter two.
 */
export type PackingItem =
  | {
      kind: 'entry'
      entryId: string
      units: number
      status: StatusValue
      residence: TripResidence
    }
  | {
      kind: 'piece'
      entryId: string
      personId: string
      units: 1
      status: StatusValue
      residence: TripResidence
    }

/**
 * One shared instance, for `tripContainment.ts`'s own `LOOSE`'s reason: it
 * carries no id, so there is nothing to distinguish, and freezing it keeps
 * the singleton safe to hand out from every item.
 *
 * **Exported, and named for the world it belongs to.** `app/` had grown two
 * more copies of this three-word literal — F4's screen and its row, each
 * reading an absent `residence` register the same way — which is one
 * definition of *loose on a Trip* per file rather than per codebase. The
 * `TRIP_` prefix is what keeps it apart from the home world's own loose
 * holder (`containment.ts`'s `HolderRef`): the two are different shapes for
 * different aggregates, and an unqualified `LOOSE` on the index would invite
 * exactly the two-worlds confusion the domain model spends a section on.
 */
export const TRIP_LOOSE: TripResidence = Object.freeze({ in: 'loose' })

/** The module-internal spelling, unchanged at its call sites below. */
const LOOSE = TRIP_LOOSE

/**
 * Two {@link TripResidence}es naming the same place — `loose` carries no id,
 * so two loose pointers are equal by their `in` alone.
 *
 * **The one definition both worlds read.** It lived in
 * `app/src/components/PackPicker.tsx` from S9a, exported so the Pack picker's
 * `● NOW` mark and every caller suppressing a selection equal to `current`
 * could not decide *equal* differently. S9b gives it a fourth reader in
 * `shared/` — whereabouts' `container` segment, which is `MIXED` exactly when
 * a slice's residences are not all this-equal — so it moves here, beside the
 * type it compares and {@link TRIP_LOOSE}.
 *
 * That move is what keeps two surfaces from disagreeing about one word:
 * `PackingRow` already draws `▸ MIXED` on F4 the moment two Pieces differ by
 * this test, **a loose one included**, and ruling D2 adopts `MIXED` precisely
 * because it is *"already the app's word for this exact fact (F4's ALL
 * mode)"*. A second comparison in `shared/` would have let gear detail read
 * `▸ ALPS 2026 · CRATE B` for a set F4 calls `▸ MIXED`.
 */
export function sameTripResidence(
  a: TripResidence | undefined,
  b: TripResidence,
): boolean {
  if (a === undefined) return false
  if (a.in !== b.in) return false
  return a.in === 'loose' || b.in === 'loose' ? true : a.entryId === b.entryId
}

/**
 * The pointer a resolved holder is written back as. {@link TripHolderRef} and
 * {@link TripResidence} are deliberately different types — one is what a
 * pointer turned out to mean, the other the pointer as written — and this is
 * the one place the trip world crosses back, because {@link PackingItem}
 * carries a residence and every reader of one wants the resolved answer.
 */
function residenceOfHolder(holder: TripHolderRef): TripResidence {
  if (holder.kind === 'loose') return LOOSE
  return { in: 'container', entryId: holder.entryId }
}

/**
 * Every item on the Trip, in {@link entriesOf} order with a per-person
 * Entry's Pieces in {@link piecesOf} order.
 *
 * **A Piece with no `residence` register of its own reads `loose`, never its
 * Entry's** (§5e C0). For per-person gear *where it is* is only ever a
 * per-Piece fact, so there is no Entry-level residence to fall back to —
 * {@link entryResidenceOf} answers `null` for that Kind and this function
 * never asks it for one. **This overturns S9a's layered read**, which is a
 * dated record left as written; the round-2 spec is where the overturn lives.
 *
 * **The residence handed out is the EFFECTIVE one**, resolved through
 * {@link TripContainmentView}. A residence register is a raw pointer and can
 * name an Entry this replica has not folded, has seen removed, or that is not
 * a container at all — the same reasons the containment view already applies
 * to an Entry's own pointer. Unresolved, such an item lands in **no** group,
 * and the partition §5e C5 claims — top-level groups plus `Loose` summing to
 * {@link packingTotals} exactly — silently stops summing. That is the whole
 * reason this function, and not each caller, resolves them.
 *
 * `view` is optional for {@link containerTotals}' reason: a screen builds one
 * view, not one per group.
 */
export function packingItems(
  trip: TripState,
  state: DepotState,
  view: TripContainmentView = tripContainmentView(trip, state),
): readonly PackingItem[] {
  const items: PackingItem[] = []
  for (const entry of entriesOf(trip, state)) {
    if (isContainerEntry(entry, state)) continue
    if (entryKind(entry, state) === 'per_person') {
      for (const personId of piecesOf(entry, trip)) {
        const piece = entry.pieces?.[personId]
        items.push({
          kind: 'piece',
          entryId: entry.id,
          personId,
          units: 1,
          // Never `null` here: `isContainerEntry` was answered above, and it
          // is the only thing either status function returns `null` for.
          status: pieceStatusOf(piece, entry, state) ?? 'not_packed',
          residence: residenceOfHolder(
            view.resolveResidence(piece?.residence?.value),
          ),
        })
      }
      continue
    }
    items.push({
      kind: 'entry',
      entryId: entry.id,
      // `pieceCountOf` **is** the units table (`entry.ts`, "the spec's table,
      // followed exactly"), so this reads it rather than holding a second
      // copy: a ruling that moves one of its rows must not be able to leave
      // the builder's `N PIECES` and this screen's `5/13` disagreeing. Its
      // container row never arrives here — containers were skipped above —
      // and its per-person row is the branch above, which has to emit one
      // item per Piece and so cannot call it.
      units: pieceCountOf(entry, trip, state),
      // Never `null` here, for the reason the piece arm above gives:
      // `isContainerEntry` was answered above, and a container is the only
      // thing either status function returns `null` for.
      status: statusOf(entry, state) ?? 'not_packed',
      // Through {@link entryResidenceOf} rather than the register, so the one
      // Kind whose Entry-level residence is not a fact is gated in the named
      // function and nowhere else. `resolveResidence` takes its `null`
      // directly, which is why no `??` stands here.
      residence: residenceOfHolder(
        view.resolveResidence(entryResidenceOf(entry, state)),
      ),
    })
  }
  return items
}

/** `● 48/61 PIECES` and `13 LEFT`. */
export interface PackingCount {
  readonly packed: number
  readonly total: number
  readonly left: number
}

/**
 * The one arithmetic, over any selection of items. `left` is `total − packed`
 * and **not a third sum**, so the two can never disagree — two independent
 * sums can, a subtraction cannot.
 *
 * `staged` counts toward `left`: {@link isPacked} is the only definition of
 * packed-ness and it says so. That is a different question from the ▲ line's
 * (see {@link disagreements}), which counts `not packed` alone.
 */
export function countOf(items: readonly PackingItem[]): PackingCount {
  let packed = 0
  let total = 0
  for (const item of items) {
    total += item.units
    if (isPacked(item.status)) packed += item.units
  }
  return { packed, total, left: total - packed }
}

/** The Trip's own `● 5/13 PIECES · 8 LEFT`, over {@link packingItems}. */
export function packingTotals(
  trip: TripState,
  state: DepotState,
): PackingCount {
  return countOf(packingItems(trip, state))
}

/**
 * Every Entry inside `entryId` **at any depth**, the container itself
 * excluded. Ids, not entities, and over {@link TripContainmentView} rather
 * than the raw registers, so the four loose-reasons and the cycle break are
 * applied exactly once — and the `subtree` guard makes termination
 * independent of the view it is handed.
 *
 * **Exported because a screen needs the same walk for different questions.**
 * `containerTotals` answers *how far along is what is inside*; the Pack
 * picker's context line (`5 INSIDE RIDE ALONG`) and the container move's
 * confirm ask *how many things are inside*, which is `.size` of this set; and
 * `PackPicker`'s own `excludedSubtree` asks which rows invariant 3 forbids as
 * destinations, which is this set plus the moved container itself. Every one
 * of those was a hand-rolled depth-first walk over the same edges at some
 * point in S9a, and that is exactly the drift this package keeps refusing —
 * the half that would be silent if the copies diverged is the cycle break,
 * where two replicas count the same crate differently, or offer a
 * destination to one Device and hide it from another.
 */
export function subtreeOf(
  view: TripContainmentView,
  entryId: string,
): Set<string> {
  const subtree = new Set<string>()
  const stack = [entryId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) continue
    for (const childId of view.childrenOf({
      kind: 'container',
      entryId: current,
    })) {
      if (subtree.has(childId)) continue
      subtree.add(childId)
      stack.push(childId)
    }
  }
  return subtree
}

/**
 * Is this item inside `entryId`, **at any depth**?
 *
 * It reads the **item's own** effective residence, not the holder of the
 * Entry the item belongs to. For a whole-Entry item the two are the same
 * fact; for a Piece they are not, and §5e C5 rules that a Piece counts at
 * *its own* place — so a per-person Entry spanning two groups contributes to
 * both, each Piece counted once. That is what makes the top-level groups plus
 * `Loose` a **partition** of the Trip's items, summing to
 * {@link packingTotals} exactly, so `● 48/61` does not move when a Piece
 * changes bags.
 *
 * `subtree` is `entryId`'s descendants; `entryId` itself is the direct case
 * and is not in it. Stated once, because {@link containerTotals} and
 * {@link disagreements} ask the identical question about the identical list
 * and a header disagreeing with the ▲ line drawn on it is exactly the drift
 * this file exists to prevent.
 */
function isInside(
  item: PackingItem,
  entryId: string,
  subtree: ReadonlySet<string>,
): boolean {
  const { residence } = item
  if (residence.in !== 'container') return false
  return residence.entryId === entryId || subtree.has(residence.entryId)
}

/**
 * A container group's `9/12` — **its contents at any depth**. The duffel's
 * twelve include the stuff sack's four, so a nested group's own rows are
 * counted twice on screen: once in its header and once in its ancestor's.
 * That is what "everything in the duffel" means to a household carrying it.
 *
 * **It counts Pieces, apportioned** (§5e C5): the filter is each item's own
 * residence through {@link isInside}, not the holder of the Entry it belongs
 * to. S9a filtered by the Entry's holder and argued that grouping by the
 * Entry was what kept a header agreeing with its rows; round 2 overturns it,
 * because a per-person Entry has no Entry-level residence to group by
 * ({@link entryResidenceOf}) and the header and its rows then agreed with
 * each other while both were wrong about where the gear was.
 *
 * Pass `view` **and `items`** when you already have them: each is O(entries)
 * to build, and CONTAINER mode draws one group per container, so a screen
 * that lets both default pays N × O(entries) on the list the app is used on
 * most. {@link disagreements} threads one `packingItems` through its whole
 * loop for the same reason.
 */
export function containerTotals(
  trip: TripState,
  state: DepotState,
  entryId: string,
  view: TripContainmentView = tripContainmentView(trip, state),
  items: readonly PackingItem[] = packingItems(trip, state, view),
): PackingCount {
  const subtree = subtreeOf(view, entryId)
  return countOf(items.filter((item) => isInside(item, entryId, subtree)))
}

/**
 * `N INSIDE RIDE ALONG` — how many things travel with this container when a
 * `trip.entry_moved` moves it. The container-move confirm's number, and the
 * Pack picker's context line.
 *
 * **From the items, never from the Entry tree.** This was
 * `subtreeOf(view, entryId).size` until now, which counts *Entries* over the
 * trip containment view — a view built from every Entry's **raw** residence
 * register, per-person ones included. Since ruling C0 that register is
 * fold-but-ignore for a per-person Entry ({@link entryResidenceOf} gates it
 * out, `sync-protocol.md` §4.4 states it), so a peer on another build writing
 * one made the confirm name pieces the group's own rows do not draw. The
 * items already carry **effective** residences ({@link packingItems}) and
 * {@link isInside} already asks the membership question C5 requires a header
 * to agree with its rows on — so this asks the same two functions.
 *
 * **Two populations, added, and ruling A5 is why it is two.** A container is
 * not a piece: {@link pieceCountOf} gives it `0` units, so the packable total
 * a group's `9/12` states leaves every nested container out. They still ride
 * along — a crate holding one empty stuff sack is not empty — so each nested
 * container at any depth counts as one thing beside the units. Those come
 * from the container tree, and correctly: a container's own residence
 * register is the one every reader consults.
 *
 * The copy is deliberately noun-free (`5 INSIDE RIDE ALONG`), which is what
 * lets one number cover both: `PIECES` is the trip's packable arithmetic and
 * says nothing about the bag it is packed into.
 *
 * **No board reaches the arithmetic.** Every drawn `… RIDE ALONG` is a flat
 * crate of plain gear, where units, items and Entries are the same number —
 * so the Counted Entry's Bring-count and the nested container's `+1` are
 * code-authored and want a ruling.
 */
export function ridesAlongCount(
  trip: TripState,
  state: DepotState,
  entryId: string,
  view: TripContainmentView = tripContainmentView(trip, state),
  items: readonly PackingItem[] = packingItems(trip, state, view),
): number {
  const subtree = subtreeOf(view, entryId)
  const units = countOf(
    items.filter((item) => isInside(item, entryId, subtree)),
  ).total
  // Straight off the subtree ids, never `entriesOf`: that sorts the whole
  // gear list by label — a `entryLabel` gear lookup per Entry — for a filter
  // that wants no order, and `containerView` calls this once **per
  // container**. Every id in the subtree is already a visible Entry, the view
  // being built from `entriesOf`, so the map lookup needs no second gate.
  let containers = 0
  for (const id of subtree) {
    const entry = trip.entries?.[id]
    if (entry !== undefined && isContainerEntry(entry, state)) containers += 1
  }
  return units + containers
}

export type PersonBucketKey =
  { kind: 'person'; personId: string } | { kind: 'shared' }

export interface PersonBucket {
  readonly key: PersonBucketKey
  readonly items: readonly PackingItem[]
  readonly count: PackingCount
}

/**
 * Ruling A7's partition: **PERSON mode means *whose it is***, which ownership
 * answers. *Whose body it goes with* is story 23, Later, and the app holds no
 * such fact — which is precisely what made the drawn frame's complete
 * partition unbuildable.
 *
 * Every item falls in exactly one bucket, tested in this order:
 *
 * 1. a **Piece** goes to its own Participant's bucket;
 * 2. otherwise the Entry's {@link ownerOf} — a Person's bucket, **including a
 *    Person who is not a Participant**, because the header answers whose it
 *    is and Els's jacket carried by Mark is honest;
 * 3. otherwise `Shared` — which covers a Shared register, an **absent** one
 *    (`owner.ts`'s rule), a trip-only Entry with no Gear to own it, and a
 *    depot Entry whose Gear has not reached this replica.
 *
 * The partition is **total**, so the arithmetic closes on facts the MVP
 * holds: the buckets sum to {@link packingTotals} exactly, and the test that
 * asserts it is the one that would have caught the drawn frame.
 *
 * **A bucket with no items is not returned** — deliberately, the Participant
 * whose Piece was removed and who owns nothing included. PERSON mode groups
 * work, and a header reading `0/0` is the same arithmetic-nobody-asked-for
 * the screen's own empty state already refuses when it withholds
 * `● 0/0 PIECES` rather than zeroing it. A screen wanting to say *Kim has
 * nothing to pack* has `participantIds` and this list to say it from.
 *
 * **Order here is by person id**, `Shared` distinguished by its **key** and
 * not by its position — `piecesOf`'s own rule, and deliberately not the drawn
 * order. Surfaces order by Person label through `sortedPeople`, which lives
 * in `app/` and cannot be reached from here, and put `Shared` **last** (a
 * deliberate divergence from the Depot's `GROUP BY OWNER`, whose grouping
 * table pins `shared` first: `Shared` is the everything-else bucket and on a
 * real Trip the biggest one, so first position pushes every person header
 * off-screen). That belongs at the screen, not here.
 */
export function personPartition(
  trip: TripState,
  state: DepotState,
): readonly PersonBucket[] {
  // Rule 2, resolved once per Entry rather than once per item. Only Personal
  // ownership is recorded: every Entry absent from this map is rule 3.
  const owners = new Map<string, string>()
  for (const entry of entriesOf(trip, state)) {
    const source = entry.source?.value
    if (source === undefined || source.from !== 'depot') continue
    const gear = state.gear[source.gearId]
    if (gear === undefined) continue
    const owner = ownerOf(gear)
    if (owner.type === 'person') owners.set(entry.id, owner.personId)
  }

  const byPerson = new Map<string, PackingItem[]>()
  const shared: PackingItem[] = []
  for (const item of packingItems(trip, state)) {
    const personId =
      item.kind === 'piece' ? item.personId : owners.get(item.entryId)
    if (personId === undefined) {
      shared.push(item)
      continue
    }
    const bucket = byPerson.get(personId)
    if (bucket === undefined) byPerson.set(personId, [item])
    else bucket.push(item)
  }

  const buckets: PersonBucket[] = []
  for (const personId of [...byPerson.keys()].sort()) {
    const items = byPerson.get(personId) ?? []
    buckets.push({
      key: { kind: 'person', personId },
      items,
      count: countOf(items),
    })
  }
  if (shared.length > 0) {
    buckets.push({
      key: { kind: 'shared' },
      items: shared,
      count: countOf(shared),
    })
  }
  return buckets
}

export interface Disagreement {
  readonly entryId: string
  /** `IN CAR` · `PACKED` — the stage's own word, from the table. */
  readonly label: string
  readonly notPacked: number
}

/**
 * Ruling A6, the rule the two drawn frames encode and neither states:
 *
 * ```
 * disagreeing(entry) = stageDisagreementLabel(stageOf(entry)) !== null
 *                      ∧ count of not-packed contents, at any depth, > 0
 * ```
 *
 * `car` and `packed` only — **staging *is* the act of packing**, so unpacked
 * contents on the staging floor are the work, not a contradiction. Both
 * halves are read off {@link stageDisagreementLabel}, one field, so the stage
 * set and the phrasing it fires with cannot drift apart.
 *
 * The status half is {@link countsAsDisagreement}, which carries A6's own
 * carve-out and the reasoning for it — `staged` excluded, an unrecognised
 * status counted. So `notPacked` is **not** {@link PackingCount.left}, which
 * counts everything {@link isPacked} rejects: a crate holding a staged tarp
 * has `left` one higher than `notPacked`, and the two answer different
 * questions on purpose.
 *
 * The count is in `units`, so a Counted Entry contributes its whole
 * Bring-count: `▲ IN CAR · 3 INSIDE NOT PACKED` counts what travels, exactly
 * as the numerator beside it does.
 *
 * A **pure function of the fold**, like `overClaims` and unlike anything with
 * an op: every replica computes the identical set, and it goes away when a
 * Quartermaster packs the contents or moves the container back — both
 * ordinary ops, nothing discarded (invariant 12).
 *
 * In {@link entriesOf} order, which is the order the list draws its groups.
 */
export function disagreements(
  trip: TripState,
  state: DepotState,
  view: TripContainmentView = tripContainmentView(trip, state),
): readonly Disagreement[] {
  const items = packingItems(trip, state, view)
  const rows: Disagreement[] = []
  for (const entry of entriesOf(trip, state)) {
    // `null` for every non-container, so this is also the container gate —
    // stated once, in the named function, rather than re-derived here.
    const stage = stageOf(entry, state)
    if (stage === null) continue
    const label = stageDisagreementLabel(stage)
    if (label === null) continue

    const subtree = subtreeOf(view, entry.id)
    let notPacked = 0
    for (const item of items) {
      // {@link isInside}, so the ▲ line counts exactly what the header above
      // it counts. `3 INSIDE NOT PACKED` on a crate whose header says `0/0`
      // is the shape these two disagreeing takes.
      if (!isInside(item, entry.id, subtree)) continue
      if (!countsAsDisagreement(item.status)) continue
      notPacked += item.units
    }
    if (notPacked === 0) continue
    rows.push({ entryId: entry.id, label, notPacked })
  }
  return rows
}
