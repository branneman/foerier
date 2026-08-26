import type { DepotState } from '../state.ts'
import {
  containmentView,
  homePath,
  type ContainmentView,
  type PathSegment,
} from './containment.ts'

/**
 * One fact about where a piece of gear sits, from one of the sources
 * whereabouts reconciles (domain §4). S2b has only `'home'`; `'trip'` arrives
 * with stories 9/10, once a trip's packing arrangement can hold a residence
 * of its own.
 */
export type WhereaboutsSlice = {
  kind: 'home'
  path: PathSegment[]
  count: number
}

/**
 * Where a piece of gear is, right now. **Derived on demand, never stored**
 * (story 3, domain §4) — nothing here is written back by any op.
 *
 * `slices` is a list from the start, not a single answer, because story 3's
 * later clauses need more than one slice to be true at once:
 *
 * - the trip clause (stories 9/10) adds a `'trip'` slice alongside `'home'`
 *   while an active trip's entry is unresolved;
 * - the quantity-split clause (story 11) lets counted and per-person gear
 *   carry both a `'home'` slice **and** a `'trip'` slice simultaneously —
 *   "×2 in Crate B, ×2 on Alps 2026" — because the home slot is kept while
 *   units are out (domain §6). Neither extension changes this shape; each
 *   only adds a slice kind.
 *
 * In S2b, before any trip residence exists, this always returns exactly one
 * `'home'` slice.
 *
 * **Seam, not a stub:** story 3's last clause — gear whose last unpack
 * outcome was `lost` reads as "unaccounted for" — reads an outcome that does
 * not exist until trips do (S12); it belongs here, as a further slice kind,
 * once that fact exists to read.
 */
export interface Whereabouts {
  gearId: string
  slices: WhereaboutsSlice[]
}

export function whereabouts(
  state: DepotState,
  gearId: string,
  view: ContainmentView = containmentView(state),
): Whereabouts {
  const gear = state.gear[gearId]
  // `ownedCount` is a register of its own and survives a `kind_set` to
  // `single` untouched — correctly, per-field LWW cascades nothing (§5.3
  // obligation 4). Reading it un-gated would let a Mug edited from ×6 back to
  // Single report `×6 THERE` here while `GearDetail.tsx`'s `metaLine` — which
  // does gate — renders plain `ITEM · SHARED` two lines away. The two must
  // agree, so this mirrors that gate exactly.
  const count =
    gear?.kind?.value === 'counted' ? (gear.ownedCount?.value ?? 1) : 1
  const path = homePath(state, gearId, view)
  return { gearId, slices: [{ kind: 'home', path, count }] }
}
