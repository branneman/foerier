import { compareStamps, type Stamp } from '../hlc.ts'

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
 *
 * **Two comparators now, and the second arrived the same way the first did.**
 * `byStampThenId` was spelled twice — in `task.ts` and `note.ts` — because
 * S12 and S13 were built in parallel worktrees and this file is one only one
 * of them could own. Each said so in its own docstring and logged the lift;
 * this is it.
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

/**
 * By a creating register's own stamp, then by id — the order every nested
 * entity map is drawn in.
 *
 * **Why a stamp and not insertion order.** `entries`, `tasks` and `notes` are
 * `Record`s, and key order is the order *this replica* happened to receive ops
 * in: two Devices holding identical registers would draw two different lists,
 * with no symptom on either one. It is `byNameThenId`'s reason for existing,
 * one entity type over — and it is why ruling I24's *"insertion order"* had to
 * be read as the stamp rather than literally (`task.ts`).
 *
 * **The id is the last word, and it is what makes the order total by
 * inspection.** `compareStamps` already tiebreaks on `deviceId` and two ops
 * from one Device can never share an HLC, so a tie is unreachable in
 * practice; the id is there so nobody has to reconstruct that argument about
 * the clock to know two rows will not swap between renders.
 *
 * **An absent stamp falls straight to the id** rather than sorting first or
 * last. A caller reaching this with one has an entity whose creating register
 * has not arrived — which the callers exclude from their lists anyway, so the
 * arm exists to keep the comparator total rather than to place anything.
 */
export function byStampThenId(
  a: { id: string; stamp: Stamp | undefined },
  b: { id: string; stamp: Stamp | undefined },
): number {
  if (a.stamp !== undefined && b.stamp !== undefined) {
    const order = compareStamps(a.stamp, b.stamp)
    if (order !== 0) return order
  }
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}
