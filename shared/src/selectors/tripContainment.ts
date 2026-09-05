import { compareStamps, type Stamp } from '../hlc.ts'
import { stampOf } from '../registers.ts'
import type {
  HouseholdState,
  EntryState,
  TripResidence,
  TripState,
} from '../state.ts'
import { entriesOf, entryLabel, isContainerEntry } from './entry.ts'

/**
 * The **Trip's** containment tree — `containment.ts`'s twin over
 * {@link TripResidence}, and a second file rather than a parameter on that
 * one because the two worlds resolve against different things: one against
 * Places and Gear, the other against Entries. A shared implementation would
 * take a strategy object for every line of it.
 *
 * **This duplication is deliberate, and non-drift is the obligation it
 * creates.** The half of that obligation which would fail silently is the
 * cycle break: sync §3.6's rule, verbatim — within a cycle, the edge whose
 * `residence` register carries the **lowest `(hlc, device_id)`** is reported
 * loose, with the entry id as a canonical final tiebreak. Every replica holds
 * identical registers, so every replica breaks the same edge; the fold stays
 * untouched and every device draws the same tree.
 *
 * Four reasons a pointer reads **loose**, the first three of them different
 * spellings of *the reader cannot see what it names*:
 *
 * 1. It names an Entry this replica has not folded.
 * 2. It names a **removed** Entry or a **sourceless** one — both already
 *    excluded by `entriesOf`, and a pointer into something the reader cannot
 *    see is a pointer nobody can settle.
 * 3. It names an Entry that is **not a container** ({@link isContainerEntry}).
 * 4. It is part of a **cycle** and was the edge broken.
 *
 * Two differences from the home tree are worth stating, because a reader
 * mapping these four reasons onto `containment.ts`'s four will otherwise hunt
 * for them:
 *
 * - **`trip.entry_removed` has no restore**, so a pointer into a removed
 *   container is permanent rather than recoverable. It still reads loose
 *   rather than vanishing — nothing is deleted, and the Entry re-added under a
 *   new id is a different Entry.
 * - **There is no trip twin of the home tree's *retired* reason, and there
 *   must not be one.** `containment.ts`'s reason 2 makes retired Gear an
 *   invalid holder; here a depot Entry whose Gear is retired still resolves as
 *   a container, because {@link isContainerEntry} reads `container` and
 *   nothing else. That is deliberate: retirement is a **home** fact — it says
 *   the household no longer keeps the thing in the depot — and it says nothing
 *   about whether the duffel already packed for Saturday still holds the
 *   stove. Spec §3.2 lists three pointer reasons and retirement is not among
 *   them. Adding the gate would silently cut live edges on a Trip mid-pack-out,
 *   so a test pins the intent.
 *
 * **Every iteration over entry ids is sorted**, for `containment.ts`'s own
 * stated reason: `Object.keys` returns insertion order, which two replicas
 * that received the same ops in a different order do not share, and a
 * traversal driven by it is replica-dependent in a way the convergence tier
 * **cannot see**, because it compares folded state and this runs downstream
 * of the fold. Note that `entriesOf`'s order is by *label* and is not that
 * order — sort the ids here.
 *
 * ---
 *
 * **Note `kind`, not `in`**, and `entryId` rather than a bare `id`: a
 * {@link TripHolderRef} is the resolved holder — what the pointer turned out
 * to mean — where a `TripResidence` is the raw pointer as written. They are
 * deliberately different types so the two cannot be confused at a call site.
 * There is **no Place member** — the trip world resolves against Entries and
 * nothing else, which is why this has two members where `HolderRef` has
 * three.
 */
export type TripHolderRef =
  { kind: 'container'; entryId: string } | { kind: 'loose' }

export interface TripContainmentView {
  /** The **effective** holder: the pointer, after all four reasons are applied. */
  holderOf(entryId: string): TripHolderRef
  /**
   * The entry ids whose effective holder is `ref`, **sorted by id**. Ids, not
   * entities, and *not* `entriesOf`'s order: that one is by label, which is
   * how a list is drawn rather than how a tree is walked. A caller that wants
   * the drawn order has the state in hand and `entriesOf` to do it with.
   */
  childrenOf(ref: TripHolderRef): readonly string[]
  /**
   * The effective holder of a **raw pointer**, whoever wrote it — an Entry's
   * `residence` register, or **one Piece's**. Reasons 1–3, applied exactly
   * once, here, so a caller resolving a pointer that is not an Entry's own
   * never re-derives them: the symptom of a copy is a Piece pointing at a
   * removed container landing in *no* group at all, which silently breaks
   * the partition §5e C5 claims.
   *
   * `null` or `undefined` — an absent register, or a Kind whose Entry-level
   * residence is not a fact at all (`entryResidenceOf`) — read **loose**.
   *
   * **Reason 4 is deliberately not applied**, and cannot be: a cycle is a
   * property of one *Entry's* own edge in the graph, not of a pointer value.
   * A Piece is a leaf — nothing can point at it — so no Piece pointer is
   * ever on a cycle, and a Piece naming a container whose own edge was
   * broken still rides in that container.
   */
  resolveResidence(residence: TripResidence | null | undefined): TripHolderRef
  /**
   * The entry ids reading loose because reason 4 applied — a cycle broke at
   * *their* edge. Reasons 1–3 are not breaks; they are pointers into
   * something the reader cannot see, and they are not listed here.
   */
  brokenEdges: ReadonlySet<string>
}

/**
 * One shared instance: it carries no id, so there is nothing to distinguish,
 * and freezing it keeps the singleton safe to hand out from every view.
 */
const LOOSE: TripHolderRef = Object.freeze({ kind: 'loose' })

/**
 * Reasons 1–3, in one pass: the pointer as written, resolved against the
 * Entries this replica may see, with no knowledge of cycles yet.
 *
 * `visible` is keyed by id and holds exactly `entriesOf`'s Entries, so a
 * lookup miss *is* reasons 1 and 2 at once — missing, removed and sourceless
 * are three ways of being invisible and one test covers them. Reason 3 is
 * {@link isContainerEntry}, which is also the only place that answers the
 * container question: re-deriving `state.gear[…]?.container === true` here
 * would miss the trip-only half and cut a live edge.
 *
 * It takes the **pointer** rather than the Entry holding it, because a Piece
 * writes the same shape of pointer and gets the same three reasons — see
 * {@link TripContainmentView.resolveResidence}, which is this function with
 * the view's own `visible` and `state` already bound.
 */
function resolvePointer(
  visible: ReadonlyMap<string, EntryState>,
  state: HouseholdState,
  residence: TripResidence | null | undefined,
): TripHolderRef {
  if (residence === undefined || residence === null) return LOOSE
  if (residence.in === 'loose') return LOOSE

  const holder = visible.get(residence.entryId)
  // Reasons 1–3. A self-reference survives this and is caught as a one-node
  // cycle below, which is the right place for it.
  if (holder === undefined || !isContainerEntry(holder, state)) return LOOSE
  return { kind: 'container', entryId: residence.entryId }
}

/**
 * Which of a cycle's edges to break (`sync-protocol.md` §3.6): the one whose
 * `residence` register carries the **lowest `(hlc, device_id)`**. Every
 * replica holds identical registers, so every replica breaks the same edge —
 * the fold stays untouched and every device displays the same tree.
 *
 * `containment.ts`'s `lowestEdgeOf` word for word, over the Trip's `entries`
 * map instead of `state.gear`, and its reasoning holds unchanged: the id is a
 * final tiebreak, and it is defence-in-depth rather than the source of that
 * agreement. `compareStamps` calls two edges equal when both hlc and device
 * id match, which a well-behaved device never produces (its HLC is strictly
 * monotonic) but a hand-rolled log, or one restored behind its own clock,
 * can. **Replica agreement comes from the sorted traversal below, not from
 * this line**: `parentOf` reads only resolved holders, so the cycle array
 * handed in here is a pure function of state *values* and is identical on
 * every replica — "first one seen wins" would already agree everywhere. What
 * the tiebreak buys is that the choice among equal stamps is **canonical (the
 * lowest id)** instead of traversal-derived, so it stays put if the traversal
 * is ever restructured.
 */
function lowestEdgeOf(
  trip: TripState,
  cycle: readonly string[],
): string | undefined {
  let best: { id: string; stamp: Stamp } | undefined
  for (const id of cycle) {
    const residence = trip.entries?.[id]?.residence
    // A node is only on a cycle because it has a container edge, and an edge
    // is only ever read off a residence register — so this skip is a
    // narrowing, not a case.
    if (residence === undefined) continue
    const stamp = stampOf(residence)
    if (best === undefined) {
      best = { id, stamp }
      continue
    }
    const order = compareStamps(stamp, best.stamp)
    if (order < 0 || (order === 0 && id < best.id)) best = { id, stamp }
  }
  return best?.id
}

/**
 * Builds the Trip's containment view. Pure, and memoised only within this one
 * call — nothing is cached across calls in module state.
 *
 * **Every iteration over entry ids is sorted**, and the ids are re-sorted out
 * of `entriesOf`'s order rather than taken from it: `entriesOf` sorts by
 * *label*, which is a drawn order, and label-sorted ids are not id-sorted
 * ids. Both `Object.keys` insertion order and label order are
 * replica-dependent inputs to a traversal, and a traversal driven by either
 * diverges between two replicas that received the same ops in a different
 * order — a failure the convergence tier cannot see, because it compares
 * folded state and this runs downstream of the fold.
 */
export function tripContainmentView(
  trip: TripState,
  state: HouseholdState,
): TripContainmentView {
  // `entriesOf`'s label sort is computed and then thrown away by the `.sort()`
  // below, and that is the right trade: this function needs *which* Entries a
  // reader may see, `entriesOf` is the one place that answers it (removed and
  // sourceless in one predicate), and re-deriving the filter here to save a
  // sort is precisely the drift this file exists to avoid.
  const visible = new Map<string, EntryState>(
    entriesOf(trip, state).map((entry): [string, EntryState] => [
      entry.id,
      entry,
    ]),
  )
  const entryIds = [...visible.keys()].sort()

  // Reasons 1–3.
  const holders = new Map<string, TripHolderRef>()
  for (const id of entryIds) {
    // The optional chain's `undefined` arm is unreachable — `entryIds` are
    // `visible`'s own keys — and exists for `Map.get`'s signature, not for a
    // real case. `containment.ts`'s equivalent *is* live, because it indexes
    // a record it did not build.
    holders.set(
      id,
      resolvePointer(visible, state, visible.get(id)?.residence?.value),
    )
  }

  /**
   * The entry-to-entry edge out of `id`, or `undefined` when it holds no such
   * edge. Every Entry has at most one residence, so this graph has out-degree
   * ≤ 1 — a *functional* graph. That is why cycles here are necessarily
   * vertex-disjoint (two cycles sharing a node would give that node two
   * out-edges) and why one linear walk per node finds all of them.
   */
  const parentOf = (id: string): string | undefined => {
    const holder = holders.get(id)
    return holder?.kind === 'container' ? holder.entryId : undefined
  }

  // Reason 4. Each node is walked at most once overall — the `seen` guard is
  // what bounds the work at O(V) and what makes the walk terminate on a cycle
  // instead of looping in it.
  const brokenEdges = new Set<string>()
  const seen = new Set<string>()
  for (const start of entryIds) {
    if (seen.has(start)) continue

    const path: string[] = []
    let cursor: string | undefined = start
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor)
      path.push(cursor)
      cursor = parentOf(cursor)
    }

    // Landing on a node of *this* walk's path is a cycle; landing on one from
    // an earlier walk, or on nothing, is not.
    if (cursor === undefined) continue
    const entered = path.indexOf(cursor)
    if (entered === -1) continue

    const broken = lowestEdgeOf(trip, path.slice(entered))
    if (broken === undefined) continue
    brokenEdges.add(broken)
    holders.set(broken, LOOSE)
  }

  const children = new Map<string, string[]>()
  const looseChildren: string[] = []
  // `entryIds` is sorted, so each bucket is filled in sorted order and needs
  // no sort of its own.
  for (const id of entryIds) {
    const holder = holders.get(id) ?? LOOSE
    if (holder.kind === 'loose') {
      looseChildren.push(id)
      continue
    }
    const key = holder.entryId
    const bucket = children.get(key)
    if (bucket === undefined) children.set(key, [id])
    else bucket.push(id)
  }

  return {
    holderOf: (entryId) => holders.get(entryId) ?? LOOSE,
    resolveResidence: (residence) => resolvePointer(visible, state, residence),
    childrenOf: (ref) =>
      ref.kind === 'loose' ? looseChildren : (children.get(ref.entryId) ?? []),
    brokenEdges,
  }
}

/**
 * One ancestor on the way out of a Trip's containers. There is no `kind`
 * field, unlike {@link PathSegment}: a trip segment is always an Entry.
 */
export interface TripPathSegment {
  entryId: string
  name: string
}

/**
 * The breadcrumb of where a thing rides on this Trip: its ancestors,
 * **outermost first** (`DUFFEL 90 L ▸ CRATE B`). The Entry itself is not a
 * segment, which is why a loose Entry yields `[]` rather than a one-segment
 * path. The Pack picker's skipped-ancestry line and ALL mode's residence
 * segment both read it.
 *
 * Pass `view` when you already have one — building it is O(entries) and a
 * list screen wants one view, not one per row.
 *
 * `name` is {@link entryLabel}'s answer and not a second derivation of it:
 * invariant 8 single-sources a depot Entry's name onto its Gear, and a
 * nameless one gets that function's `—` glyph. This differs from `homePath`,
 * which hands back `''` and lets the caller choose a placeholder, because the
 * trip world already has exactly one place that decides what an Entry is
 * called.
 *
 * **The price, and it is a constraint on every future caller:** a segment can
 * no longer distinguish a nameless container from one genuinely named `—`.
 * A caller that needs *unnamed* as a distinct state — to dim the segment, say
 * — must be given a **boolean on the segment**, decided here where the raw
 * `source` is in hand. String-comparing `'—'` at a call site would re-derive
 * the naming rule from its own output, which is exactly the drift routing the
 * name through `entryLabel` was meant to prevent.
 *
 * **Terminates on every input.** The effective holder graph is acyclic by
 * construction, every cycle having had an edge broken; the `visited` guard
 * makes that independent of the passed-in `view`, so even an inconsistent one
 * stops rather than looping.
 */
export function tripPath(
  trip: TripState,
  state: HouseholdState,
  entryId: string,
  view: TripContainmentView = tripContainmentView(trip, state),
): readonly TripPathSegment[] {
  const segments: TripPathSegment[] = []
  const visited = new Set<string>([entryId])
  let holder = view.holderOf(entryId)

  while (holder.kind !== 'loose') {
    if (visited.has(holder.entryId)) break
    visited.add(holder.entryId)
    const entry = trip.entries?.[holder.entryId]
    if (entry === undefined) break
    segments.push({ entryId: entry.id, name: entryLabel(entry, state) })
    holder = view.holderOf(entry.id)
  }

  return segments.reverse()
}
