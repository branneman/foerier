/**
 * One text fold, shared by everything that has to decide whether two strings
 * a human typed mean the same thing.
 *
 * Extracted from `selectors/find.ts`, which owned it alone until `tags.ts`
 * needed the identical answer: a household that owns a `Hütte` kit types
 * `hütte` into the tag picker and `Hütte` into the search field, and the two
 * surfaces disagreeing about whether `ü` is a `u` is a bug waiting to be
 * filed. `find.test.ts` covers the behaviour; this module is where it lives.
 */

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
 * `localeCompare` with `sensitivity: 'base'` was the other option considered,
 * but it only judges whether two *whole* strings are equivalent; it has no
 * substring form. Since "find gear by typing part of its name" is exactly a
 * substring question, folding both sides into one comparable string and using
 * `.includes()` is the direct fit.
 */
export function foldText(value: string): string {
  return value
    .replace(NON_DECOMPOSING_PATTERN, (ch) => NON_DECOMPOSING[ch] ?? ch)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
