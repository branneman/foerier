import type { DepotState, GearState } from '../state.ts'
import { foldText } from '../text.ts'
import { containmentView, homePath, type PathSegment } from './containment.ts'

/** One piece of gear that matched, and where it lives at home. */
export interface Match {
  gear: GearState
  path: PathSegment[]
}

/** The display name of a register that may be absent or hold `null`. */
function nameOf(gear: GearState): string {
  return gear.name?.value ?? ''
}

/**
 * Same *cascade* as `depot.ts`'s private `byNameThenId` — name, then raw
 * name, then id, each only a tiebreak for the level above — kept local
 * because it compares gear for this module's own use, not raw entities for
 * every caller. The **primary key deliberately differs**: this folds
 * diacritics (`foldText`, `../text.ts`), where `byNameThenId` only
 * lowercases. A diacritic-insensitive search needs `'Ölzeug'` and `'Olzeug'`
 * to file adjacently; the plain Depot list has no such requirement. So `findGear`'s
 * order can legitimately differ from the Depot list's for names that carry
 * marks or the non-decomposing letters `../text.ts` maps.
 */
function byName(a: GearState, b: GearState): number {
  const al = foldText(nameOf(a))
  const bl = foldText(nameOf(b))
  if (al !== bl) return al < bl ? -1 : 1
  const an = nameOf(a)
  const bn = nameOf(b)
  if (an !== bn) return an < bn ? -1 : 1
  return a.id < b.id ? -1 : 1
}

/**
 * Looks up gear by name, for the Find screen (story 3): "I can look up Gear
 * by name and see its full Home path." Matching is a substring test, folded
 * for case and diacritics (see `foldText`). Retired gear is excluded
 * (invariant 7 — retirement is a soft-delete, and retired gear lives in
 * `retiredGear`, not here). An empty (or all-whitespace) query matches
 * nothing, rather than the whole depot.
 */
export function findGear(state: DepotState, query: string): readonly Match[] {
  const needle = foldText(query.trim())
  if (needle === '') return []

  const view = containmentView(state)
  return Object.values(state.gear)
    .filter((gear) => gear.retired?.value !== true)
    .filter((gear) => foldText(nameOf(gear)).includes(needle))
    .sort(byName)
    .map((gear) => ({ gear, path: homePath(state, gear.id, view) }))
}
