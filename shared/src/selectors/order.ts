/**
 * **The one comparator two lists have to share.**
 *
 * It lived inside `depot.ts` until S6 gave the Trips list the same problem the
 * depot has had since S2 — `Object.keys` returns the order *this replica*
 * happened to receive ops in, so two devices holding identical state would
 * draw the same list differently. The sort is not cosmetic; it is what makes
 * the display converge.
 *
 * Lifted here rather than copied, because a second copy of a total-order
 * comparator is exactly how two devices start drawing lists differently again:
 * the divergence would then be one edit away and invisible in review. It stays
 * internal to `shared/src/selectors/` — no `index.ts` export — because it
 * orders *entities*, and a call site outside this folder wanting one already
 * has a selector that returns the list sorted.
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
export function byNameThenId(
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
