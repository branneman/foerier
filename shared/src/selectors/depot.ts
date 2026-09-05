import type { DepotState, GearState, PlaceState } from '../state.ts'
import { containmentView, type ContainmentView } from './containment.ts'
import { isCounted } from './kind.ts'
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
 * The owned-count, or `null` for every Gear that is not Counted.
 *
 * **The fifth instance of a shape this codebase already has four of** —
 * `bringCountOf`, `statusOf`, `stageOf` and `entryResidenceOf`
 * (`selectors/entry.ts`, `selectors/packing.ts`) each answer `null` for the
 * Kind or trait whose fact this is not, on the way out, never in the
 * reducer. `kind` and `ownedCount` are two registers on the same Gear
 * aggregate with no ordering between them — `gear.recorded` may carry both,
 * but `gear.kind_set` and `gear.owned_count_set` can arrive in either order
 * on a later edit — so a reducer that resolved one against the other would
 * make the fold depend on which had landed first. Both fold unconditionally;
 * this function is the one place that decides which a reader may see.
 *
 * **An absent register on Counted gear reads `1`.** Invariant 6 confines
 * owned-count to Counted gear, and recording a headlamp as Counted without
 * touching the stepper means owning one — a Counted gear nobody counted
 * still owns one, `bringCountOf`'s "adding without touching the stepper
 * means bringing one" restated for the Gear's own count.
 *
 * A Gear whose Kind is edited away from `counted` leaves any `ownedCount`
 * register exactly as it was — clearing it is a write nobody asked for, and
 * per-field LWW cascades nothing. This function is what stops that stale
 * register from being read once the Kind no longer says Counted:
 * `claim.ts`'s Single branch depends on this reading `null`, so an edit from
 * Counted back to Single cannot silently raise Single's supply above one.
 *
 * **This function does not answer "did somebody record a count".** That is
 * a different question — `ownedCount !== undefined` on the raw register —
 * and exactly **one** `app/` call site still asks it: `OverClaimBand`'s
 * fix-round-F6 guard, which decides whether to print `OWNED ×N` beside a
 * conflict at all, and would otherwise state a number nobody recorded. This
 * `null` collapses "not Counted" and "no register, but Counted" into one
 * answer, which is right for `claim.ts`'s arithmetic and for every `×N` a
 * screen draws, and wrong only for that one guard.
 *
 * `Depot.tsx`'s `qtyFor` and `GearDetail.tsx`'s `metaLine` used to ask it
 * too, and each answered *nothing* where this function says `×1` — three
 * readings of one register, two of them on the same screen. They read this
 * now, so **a Counted gear nobody counted draws `×1` everywhere**.
 */
export function ownedCountOf(gear: GearState): number | null {
  if (!isCounted(gear)) return null
  return countedOwnedCount(gear)
}

/**
 * The half of {@link ownedCountOf} that is about the **register** rather than
 * the Kind: what this Gear's owned-count reads *if* it is Counted, absent or
 * not.
 *
 * One caller, and it is not a display: gear detail's edit sheet, which seeds
 * and compares its owned-count draft against the Kind the sheet is **about to
 * write**, not the one the register still holds. {@link ownedCountOf} cannot
 * answer that — flip a Single gear to Counted in the sheet and it still reads
 * `null` — and the sheet spelling `?? 1` for itself would put a second copy
 * of this rule in `app/`, where the drift would show up as an untouched Save
 * authoring a `gear.owned_count_set` that changes no number on any screen.
 * A needless write is not cosmetic: it moves the stamp LWW compares, so it
 * can beat and silently discard a genuine concurrent write from a Device
 * that was offline.
 *
 * **Not a display selector.** Anything drawing `×N` wants
 * {@link ownedCountOf}, which is gated on the Kind; this one is not, and
 * would happily state a count for a Single.
 */
export function countedOwnedCount(gear: GearState): number {
  return gear.ownedCount?.value ?? 1
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
