import type { DepotState, GearState, PlaceState } from '../state.ts'
import { containmentView, type ContainmentView } from './containment.ts'
import { byNameThenId } from './order.ts'

/**
 * The depot's list-level selectors: what a Quartermaster sees when they open
 * the year-round inventory, rather than the tree `containment.ts` computes.
 *
 * **Every one of them returns a sorted list.** `Object.keys` returns insertion
 * order, which is the order this replica happened to receive ops in — two
 * devices holding identical state would list the same depot differently. The
 * sort is not cosmetic; it is what makes the display converge.
 */

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

/**
 * How many distinct pieces of gear the household owns. Retired gear counts
 * for nothing.
 *
 * **There is deliberately no `pieces` here.** The Depot headline used to read
 * `128 GEAR · 214 PIECES`, and that second number was not a fact: it summed
 * the owned-counts of Counted gear with a **1-per-line stand-in** for
 * everything else — and invariant 6 gives per-person gear no owned-count at
 * all, so the stand-in stood in for nothing anybody had recorded. A household
 * of four reading `1` for its four headlamps is not a smaller number than the
 * truth; it is a different question's answer. The amendment round retired the
 * segment (`README` §5b, L) and the arithmetic with it, so no later caller
 * can render the sum back by reaching for a field that is simply there.
 *
 * `PIECES` is **trip arithmetic only** — `pieceCountOf` and `listTotals` in
 * `selectors/entry.ts`, where a Bring-count is a number a Quartermaster
 * actually authored. Trip surfaces are untouched by this.
 */
export function depotCounts(state: DepotState): {
  gear: number
} {
  return { gear: visibleGear(state).length }
}
