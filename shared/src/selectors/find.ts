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
 * Characters Unicode gives **no** canonical decomposition to, so
 * `normalize('NFD')` leaves them untouched and the combining-mark strip below
 * never sees them: `ø`, `æ`, `œ`, `ß`, `ł`, `đ` are letters in their own
 * right, not a base letter plus a mark. Mapped to their ASCII transliteration
 * *before* NFD runs, so the two mechanisms compose into one fold.
 *
 * Deliberately a short, explicit list, not a complete transliteration table:
 * it covers the Scandinavian and German letters this household's gear is
 * likely to carry (`Norrøna`, `Skøyter`, `Straße`), not every script. Extend
 * it if a real piece of gear needs a character it does not cover.
 *
 * Preferred over `Intl.Collator` with `sensitivity: 'base'` — the other tool
 * that folds `ø`-like letters — because a collator's answer for them is
 * **locale-dependent**: the same query would match differently depending on
 * the runtime's locale, which is both surprising and untestable without
 * pinning one. An explicit map is predictable and testable everywhere.
 */
const NON_DECOMPOSING: Readonly<Record<string, string>> = {
  ø: 'o',
  Ø: 'o',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
  ß: 'ss',
  ł: 'l',
  Ł: 'l',
  đ: 'd',
  Đ: 'd',
}

const NON_DECOMPOSING_PATTERN = new RegExp(
  `[${Object.keys(NON_DECOMPOSING).join('')}]`,
  'g',
)

/**
 * Case- and diacritic-insensitive fold, for **substring** matching: the
 * {@link NON_DECOMPOSING} map runs first, then `normalize('NFD')` decomposes
 * every *canonically* accented character into a base letter plus a combining
 * mark, the marks are stripped, and the result is lowercased — so `'Ölzeug'`
 * and `'olzeug'` fold to the same string and a plain `.includes()` finds one
 * inside the other.
 *
 * `localeCompare` with `sensitivity: 'base'` was the other option the task
 * named, but it only judges whether two *whole* strings are equivalent; it
 * has no substring form. Since "find gear by typing part of its name" is
 * exactly a substring question, folding both sides into one comparable string
 * and using `.includes()` is the direct fit.
 */
function fold(value: string): string {
  return value
    .replace(NON_DECOMPOSING_PATTERN, (ch) => NON_DECOMPOSING[ch] ?? ch)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Same *cascade* as `depot.ts`'s private `byNameThenId` — name, then raw
 * name, then id, each only a tiebreak for the level above — kept local
 * because it compares gear for this module's own use, not raw entities for
 * every caller. The **primary key deliberately differs**: this folds
 * diacritics (`fold`, above), where `byNameThenId` only lowercases. A
 * diacritic-insensitive search needs `'Ölzeug'` and `'Olzeug'` to file
 * adjacently; the plain Depot list has no such requirement. So `findGear`'s
 * order can legitimately differ from the Depot list's for names that carry
 * marks or the non-decomposing letters above.
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
