import { compareStamps, type Stamp } from '../hlc.ts'
import { stampOf } from '../registers.ts'
import type { DepotState, GearState, Residence } from '../state.ts'

/**
 * The containment tree is **emergent** ([domain §3](../../../docs/domain-model.md)):
 * nothing stores it. Each piece of gear names the one location it resides in,
 * and this selector computes the tree those pointers describe.
 *
 * Computing it is not a formality, because a residence pointer does not always
 * lead where it says. Four reasons, all of them this selector's job — the
 * reducer never walks the tree and nothing is ever cascaded
 * (`sync-protocol.md` §3.5, invariant 4):
 *
 * 1. The Place it names is missing or `removed` → **loose**.
 * 2. The Gear it names is missing or `retired` → **loose**.
 * 3. The Gear it names is **not a container** → **loose** (invariant 2: only
 *    container-gear and places may be resided in).
 * 4. The edge is part of a **cycle** and was the one broken → **loose**.
 *
 * In every case the residence register keeps pointing at the holder it named.
 * Nothing is deleted, so restoring the Place or the Container restores the
 * arrangement exactly.
 *
 * **Note `kind`, not `in`.** A {@link HolderRef} is the resolved holder — what
 * the pointer turned out to mean. A `Residence` is the raw pointer as written.
 * They are deliberately different types so the two cannot be confused at a
 * call site.
 */
export type HolderRef =
  | { kind: 'place'; id: string }
  | { kind: 'gear'; id: string }
  | { kind: 'loose' }

export interface ContainmentView {
  /** The **effective** holder: the pointer, after all four reasons are applied. */
  holderOf(gearId: string): HolderRef
  /**
   * The gear ids whose effective holder is `ref`, **sorted by id**. Ids, not
   * entities: a caller that wants them in name order has the state in hand and
   * the `depot.ts` comparator to do it with. Retired gear is included — being
   * retired changes whether a thing may *hold* something (reason 2), not
   * whether it is itself somewhere.
   */
  childrenOf(ref: HolderRef): readonly string[]
  /**
   * The gear ids reading loose because reason 4 applied — a cycle broke at
   * *their* edge. Reasons 1–3 are not breaks; they are pointers into a
   * tombstone, and they are not listed here.
   */
  brokenEdges: ReadonlySet<string>
}

/**
 * One shared instance: it carries no id, so there is nothing to distinguish,
 * and freezing it keeps the singleton safe to hand out from every view.
 */
const LOOSE: HolderRef = Object.freeze({ kind: 'loose' })

function isRetired(gear: GearState): boolean {
  return gear.retired?.value === true
}

function isContainer(gear: GearState): boolean {
  return gear.container?.value === true
}

const LOOSE_RESIDENCE: Residence = Object.freeze({ in: 'loose' })

/**
 * The gear's home residence **as written** — an absent residence reads
 * loose, and only this function says so.
 *
 * `ownerOf`'s rule (`selectors/owner.ts`) for the residence register: gear
 * recorded with no home carries no `residence` at all, and the fold keeps it
 * that way because absent and `{in:'loose'}` are different facts about the
 * op log even where they are the same fact about the gear. The equivalence
 * is stated once, here, on the way out — `holderOf` resolves through it, so
 * `looseGear` already lists such gear, and a picker that marks `● NOW` or a
 * caller that suppresses a redundant `gear.rehomed` must read the same
 * answer rather than re-derive it from `gear.residence?.value`.
 *
 * **Not the resolved holder.** A pointer at a removed Place or a retired
 * container reads back exactly as written; the four reasons it might
 * nonetheless *be* loose are `holderOf`'s, and only that view answers them.
 */
export function residenceOf(gear: GearState): Residence {
  return gear.residence?.value ?? LOOSE_RESIDENCE
}

/**
 * Reasons 1–3, in one pass: the pointer as written, resolved against the state
 * it points into, with no knowledge of cycles yet.
 */
function resolvePointer(state: DepotState, gear: GearState): HolderRef {
  const residence = residenceOf(gear)
  if (residence.in === 'loose') return LOOSE

  if (residence.in === 'place') {
    const place = state.places[residence.id]
    // Reason 1.
    if (place === undefined || place.removed?.value === true) return LOOSE
    return { kind: 'place', id: residence.id }
  }

  const holder = state.gear[residence.id]
  // Reasons 2 and 3. A self-reference survives this and is caught as a
  // one-node cycle below, which is the right place for it.
  if (holder === undefined || isRetired(holder) || !isContainer(holder)) {
    return LOOSE
  }
  return { kind: 'gear', id: residence.id }
}

/**
 * Which of a cycle's edges to break (`sync-protocol.md` §3.6): the one whose
 * residence register carries the **lowest `(hlc, device_id)`**. Every replica
 * holds identical registers, so every replica breaks the same edge — the fold
 * stays untouched and every device displays the same tree.
 *
 * The id is a final tiebreak, and it is defence-in-depth rather than the
 * source of that agreement. `compareStamps` calls two edges equal when both
 * hlc and device id match, which a well-behaved device never produces (its HLC
 * is strictly monotonic) but a hand-rolled log, or one restored behind its own
 * clock, can. **Replica agreement comes from the sorted traversal below, not
 * from this line**: `parentOf` reads only resolved holders, so the cycle array
 * handed in here is a pure function of state *values* and is identical on
 * every replica — "first one seen wins" would already agree everywhere. What
 * the tiebreak buys is that the choice among equal stamps is **canonical (the
 * lowest id)** instead of traversal-derived, so it stays put if the traversal
 * is ever restructured.
 */
function lowestEdgeOf(
  state: DepotState,
  cycle: readonly string[],
): string | undefined {
  let best: { id: string; stamp: Stamp } | undefined
  for (const id of cycle) {
    const residence = state.gear[id]?.residence
    // A node is only on a cycle because it has a gear edge, and an edge is
    // only ever read off a residence register — so this skip is a narrowing,
    // not a case.
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
 * Builds the containment view. Pure, and memoised only within this one call —
 * nothing is cached across calls in module state.
 *
 * **Every iteration over gear ids is sorted.** `Object.keys` returns insertion
 * order, which differs between two replicas that received the same ops in a
 * different order, and a traversal driven by it is therefore replica-dependent.
 * Sorting costs a `sort` on a list the size of the depot and removes the
 * failure mode outright — a failure mode the convergence tier cannot see,
 * because it compares folded state and this runs downstream of the fold.
 */
export function containmentView(state: DepotState): ContainmentView {
  const gearIds = Object.keys(state.gear).sort()

  // Reasons 1–3.
  const holders = new Map<string, HolderRef>()
  for (const id of gearIds) {
    const gear = state.gear[id]
    holders.set(id, gear === undefined ? LOOSE : resolvePointer(state, gear))
  }

  /**
   * The gear-to-gear edge out of `id`, or `undefined` when it holds no such
   * edge. Every gear has at most one residence, so this graph has out-degree
   * ≤ 1 — a *functional* graph. That is why cycles here are necessarily
   * vertex-disjoint (two cycles sharing a node would give that node two
   * out-edges) and why one linear walk per node finds all of them.
   */
  const parentOf = (id: string): string | undefined => {
    const holder = holders.get(id)
    return holder?.kind === 'gear' ? holder.id : undefined
  }

  // Reason 4. Each node is walked at most once overall — the `seen` guard is
  // what bounds the work at O(V) and what makes the walk terminate on a cycle
  // instead of looping in it.
  const brokenEdges = new Set<string>()
  const seen = new Set<string>()
  for (const start of gearIds) {
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
    const entry = path.indexOf(cursor)
    if (entry === -1) continue

    const broken = lowestEdgeOf(state, path.slice(entry))
    if (broken === undefined) continue
    brokenEdges.add(broken)
    holders.set(broken, LOOSE)
  }

  const children = new Map<string, string[]>()
  const looseChildren: string[] = []
  // `gearIds` is sorted, so each bucket is filled in sorted order and needs no
  // sort of its own.
  for (const id of gearIds) {
    const holder = holders.get(id) ?? LOOSE
    if (holder.kind === 'loose') {
      looseChildren.push(id)
      continue
    }
    const key = `${holder.kind}:${holder.id}`
    const bucket = children.get(key)
    if (bucket === undefined) children.set(key, [id])
    else bucket.push(id)
  }

  return {
    holderOf: (gearId) => holders.get(gearId) ?? LOOSE,
    childrenOf: (ref) =>
      ref.kind === 'loose'
        ? looseChildren
        : (children.get(`${ref.kind}:${ref.id}`) ?? []),
    brokenEdges,
  }
}

export interface PathSegment {
  kind: 'place' | 'gear'
  id: string
  name: string
}

/** The display name of a register that may be absent or hold `null`. */
function nameOf(entity: { name?: { value: string | null } }): string {
  return entity.name?.value ?? ''
}

/**
 * The breadcrumb of where a piece of gear lives: its ancestors, **outermost
 * first** (`ATTIC ▸ SHELF L-TOP ▸ CRATE B`). The gear itself is not a segment,
 * which is why loose gear yields `[]` rather than a one-segment path.
 *
 * Pass `view` when you already have one — building it is O(depot) and a list
 * screen wants one view, not one per row.
 *
 * A segment whose entity has no name carries `''`. The id is in the segment
 * either way, so the caller chooses its own placeholder rather than being
 * handed a uuid to render.
 *
 * **Terminates on every input.** The effective holder graph is acyclic by
 * construction, every cycle having had an edge broken; the `visited` guard
 * makes that independent of the passed-in `view`, so even an inconsistent one
 * stops rather than looping.
 */
export function homePath(
  state: DepotState,
  gearId: string,
  view: ContainmentView = containmentView(state),
): PathSegment[] {
  const segments: PathSegment[] = []
  const visited = new Set<string>([gearId])
  let holder = view.holderOf(gearId)

  while (holder.kind !== 'loose') {
    if (holder.kind === 'place') {
      const place = state.places[holder.id]
      if (place !== undefined) {
        segments.push({ kind: 'place', id: place.id, name: nameOf(place) })
      }
      break
    }
    if (visited.has(holder.id)) break
    visited.add(holder.id)
    const gear = state.gear[holder.id]
    if (gear === undefined) break
    segments.push({ kind: 'gear', id: gear.id, name: nameOf(gear) })
    holder = view.holderOf(gear.id)
  }

  return segments.reverse()
}
