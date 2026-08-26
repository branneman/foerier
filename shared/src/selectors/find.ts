import type { DepotState, GearState } from '../state.ts'
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
 * Case- and diacritic-insensitive fold, for **substring** matching:
 * `normalize('NFD')` decomposes each accented character into a base letter
 * plus a combining mark, the marks are stripped, and the result is
 * lowercased — so `'Ölzeug'` and `'olzeug'` fold to the same string and a
 * plain `.includes()` finds one inside the other.
 *
 * `localeCompare` with `sensitivity: 'base'` was the other option the task
 * named, but it only judges whether two *whole* strings are equivalent; it
 * has no substring form. Since "find gear by typing part of its name" is
 * exactly a substring question, folding both sides into one comparable string
 * and using `.includes()` is the direct fit.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * By folded name, then by id — the same tiebreak convention as `depot.ts`'s
 * `byNameThenId`, kept local because it compares `Match`es, not raw entities.
 */
function byName(a: GearState, b: GearState): number {
  const al = fold(nameOf(a))
  const bl = fold(nameOf(b))
  if (al !== bl) return al < bl ? -1 : 1
  const an = nameOf(a)
  const bn = nameOf(b)
  if (an !== bn) return an < bn ? -1 : 1
  return a.id < b.id ? -1 : 1
}

/**
 * Looks up gear by name, for the Find screen (story 3): "I can look up Gear
 * by name and see its full Home path." Matching is a substring test, folded
 * for case and diacritics (see {@link fold}). Retired gear is excluded
 * (invariant 7 — retirement is a soft-delete, and retired gear lives in
 * `retiredGear`, not here). An empty (or all-whitespace) query matches
 * nothing, rather than the whole depot.
 */
export function findGear(state: DepotState, query: string): readonly Match[] {
  const needle = fold(query.trim())
  if (needle === '') return []

  const view = containmentView(state)
  return Object.values(state.gear)
    .filter((gear) => gear.retired?.value !== true)
    .filter((gear) => fold(nameOf(gear)).includes(needle))
    .sort(byName)
    .map((gear) => ({ gear, path: homePath(state, gear.id, view) }))
}
