import type { DepotState } from '../state.ts'
import {
  containmentView,
  homePath,
  type ContainmentView,
  type PathSegment,
} from './containment.ts'

/**
 * One fact about where a piece of gear sits, from one of the sources
 * whereabouts reconciles (domain §4). Still only `'home'`.
 *
 * **S9a writes the fact and S9b reads it.** Stories 9 and 10 landed with
 * S9a, so a trip's packing arrangement *does* now hold a residence of its
 * own — `trip.entry_moved` and `trip.piece_moved` write it, and
 * `selectors/tripContainment.ts` resolves it into a tree. What is missing is
 * only the read on this side: the `'trip'` slice arrives with **S9b**,
 * together with the quantity split. Until then this union stays one member
 * wide, and the Depot answers `⌂ HAL ▸ LADE 2` for a headlamp that is in the
 * duffel, in the car.
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
 * - the trip clause (stories 9/10, **written by S9a and read by S9b**) adds a
 *   `'trip'` slice alongside `'home'` while an active trip's entry is
 *   unresolved;
 * - the quantity-split clause (story 11) lets counted and per-person gear
 *   carry both a `'home'` slice **and** a `'trip'` slice simultaneously —
 *   "×2 in Crate B, ×2 on Alps 2026" — because the home slot is kept while
 *   units are out (domain §6). Neither extension changes this shape; each
 *   only adds a slice kind.
 *
 * Through S9a — the trip residences exist, but nothing here reads them
 * yet — this always returns exactly one `'home'` slice.
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
