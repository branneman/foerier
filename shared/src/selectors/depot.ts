import type { DepotState, GearState, PlaceState } from '../state.ts'
import { containmentView, type ContainmentView } from './containment.ts'

/**
 * The depot's list-level selectors: what a Quartermaster sees when they open
 * the year-round inventory, rather than the tree `containment.ts` computes.
 *
 * **Every one of them returns a sorted list.** `Object.keys` returns insertion
 * order, which is the order this replica happened to receive ops in — two
 * devices holding identical state would list the same depot differently. The
 * sort is not cosmetic; it is what makes the display converge.
 */

/** The display name of a register that may be absent or hold `null`. */
function nameOf(entity: { name?: { value: string | null } }): string {
  return entity.name?.value ?? ''
}

/**
 * By name, then by id. Case-insensitive on the name, so `axe` files with
 * `Axe` rather than after `Zebra blanket`; `toLowerCase` is the
 * locale-*independent* one, so the order is the same on every device.
 * Comparison is by code point rather than `localeCompare` for the same
 * reason. The id is the final tiebreak, which makes the order total: two
 * things with the same name never swap places between renders.
 */
function byNameThenId(
  a: { id: string; name?: { value: string | null } },
  b: { id: string; name?: { value: string | null } },
): number {
  const an = nameOf(a)
  const bn = nameOf(b)
  const al = an.toLowerCase()
  const bl = bn.toLowerCase()
  if (al !== bl) return al < bl ? -1 : 1
  if (an !== bn) return an < bn ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** A tombstone is an ordinary LWW field (`sync-protocol.md` §3.5). */
function isRetired(gear: GearState): boolean {
  return gear.retired?.value === true
}

function allGear(state: DepotState): GearState[] {
  return Object.values(state.gear)
}

/** Everything in the depot that has not been retired, sorted for display. */
export function visibleGear(state: DepotState): readonly GearState[] {
  return allGear(state)
    .filter((gear) => !isRetired(gear))
    .sort(byNameThenId)
}

/**
 * The retired half of the same partition. Retiring is a soft delete
 * (invariant 7) — the gear is still here, and `gear.restored` brings it back.
 */
export function retiredGear(state: DepotState): readonly GearState[] {
  return allGear(state).filter(isRetired).sort(byNameThenId)
}

/**
 * Gear with nowhere to be: the surfacing invariant 4 requires. It is not the
 * same question as "was it recorded loose" — gear whose Place was removed or
 * whose Container was retired reads loose too, and so does the gear on the
 * broken side of a containment cycle. All four reasons are
 * {@link containmentView}'s, and this selector just asks it.
 *
 * Retired gear is excluded: this list exists to be re-homed, and retired gear
 * is not waiting for a home.
 */
export function looseGear(
  state: DepotState,
  view: ContainmentView = containmentView(state),
): readonly GearState[] {
  return allGear(state)
    .filter((gear) => !isRetired(gear))
    .filter((gear) => view.holderOf(gear.id).kind === 'loose')
    .sort(byNameThenId)
}

/**
 * `place.removed` has no restore op in the MVP, but it is the same LWW
 * mechanism (§3.5) — so this reads the register rather than assuming absence.
 */
export function visiblePlaces(state: DepotState): readonly PlaceState[] {
  return Object.values(state.places)
    .filter((place) => place.removed?.value !== true)
    .sort(byNameThenId)
}

/**
 * The tags currently applied to one piece of gear, sorted.
 *
 * Only registers holding `true`. A register holding `false` is a **removal**,
 * which is a write with a clock rather than an absence
 * (`sync-protocol.md` §3.4) — it stays in the fold so a concurrent re-apply
 * can win on its own stamp, and it is this selector's job not to show it.
 *
 * Sorted for the same reason every selector in this file sorts: `Object.keys`
 * returns the order *this replica* happened to receive ops in, so two devices
 * holding identical state would draw the chips differently.
 */
export function tagsOf(gear: GearState): readonly string[] {
  const tags = gear.tags
  if (tags === undefined) return []
  return Object.keys(tags)
    .filter((tag) => tags[tag]?.value === true)
    .sort()
}

/** One tag in the household's vocabulary, and how much gear wears it. */
export interface TagCount {
  tag: string
  count: number
}

/**
 * The household's whole tag vocabulary, with counts — what both tag pickers
 * offer (`docs/design/README.md` §4a).
 *
 * **There is no Tag entity**, by design: the vocabulary is derived from
 * whatever is currently applied, and there is no rename op, ever. A tag
 * therefore exists exactly as long as some visible gear wears it, and a
 * misspelling is corrected only by removing it and applying the right one.
 * That is why the counts are here at all — near-duplicates become visible at
 * the moment they would be created, which is the only defence there is.
 *
 * **Count descending, then tag ascending.** Descending-count because the most
 * used tag is the one most likely to be wanted; ascending-tag because the
 * order must be *total*, or two devices with identical state would draw the
 * picker differently.
 *
 * Retired gear contributes nothing, for the same reason it contributes
 * nothing to {@link depotCounts}: this vocabulary slices the visible depot.
 * A non-conforming tag is offered exactly as it was folded — the register key
 * is the literal string that arrived (§5), and hiding it would leave a
 * Quartermaster unable to remove the tag they can plainly see on the gear.
 */
export function depotTags(state: DepotState): readonly TagCount[] {
  const counts = new Map<string, number>()
  for (const gear of visibleGear(state)) {
    for (const tag of tagsOf(gear)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count
      if (a.tag === b.tag) return 0
      return a.tag < b.tag ? -1 : 1
    })
}

/**
 * The headline pair: how many distinct pieces of gear the household owns, and
 * how many physical things that adds up to. Only counted gear carries an
 * owned-count (invariant 6); everything else is one thing, so it counts as
 * one. Retired gear counts for neither.
 */
export function depotCounts(state: DepotState): {
  gear: number
  pieces: number
} {
  const gear = visibleGear(state)
  let pieces = 0
  for (const item of gear) {
    // `ownedCount` is its own register and outlives a `kind_set` back to
    // `single` untouched (per-field LWW cascades nothing, §5.3 obligation 4).
    // Gated the same way `GearDetail.tsx`'s `metaLine` and
    // `selectors/whereabouts.ts` are, so all three agree on what a
    // no-longer-counted item counts as.
    pieces += item.kind?.value === 'counted' ? (item.ownedCount?.value ?? 1) : 1
  }
  return { gear: gear.length, pieces }
}
