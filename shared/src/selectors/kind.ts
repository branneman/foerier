import type { GearState, KindValue } from '../state.ts'

/**
 * **Kind on the way out** — the one module that decides what a `kind`
 * register *reads* as, and the one place the Counted and per-person gates are
 * spelled.
 *
 * The register is `KindValue` (`sync-protocol.md` §4.3), deliberately open
 * past its three known members, and it is **optional**: `gear.recorded`'s
 * `kind` is a field the reducer's `writeIfPresent` leaves unwritten when it
 * did not arrive, so a peer on an older build — or a malformed op — leaves a
 * Gear with no Kind at all.
 *
 * ## An absent register reads *no Kind*, and that is not a default
 *
 * Every other row of `patterns.md` §1.2 names a value an absent register
 * reads as. This one deliberately names none, and joins the Entry's `source`
 * as the second register with **no** default:
 *
 * - Reading it as `'single'` would assert a Kind nobody stated, and
 *   `claim.ts` branches on exactly this value — an unstated Kind misread as
 *   Single would raise an over-claim the reader cannot settle, the argument
 *   `entryKind` already makes one file over for the same value.
 * - Reading it as Counted would put a `×1` on gear nobody counted.
 *
 * So the reading is *"there is no Kind here"*, stated once, and each surface
 * decides what it draws for that — the KIND dimension carries no value and
 * the KIND grouping files it under `—`; the COUNT group does not render; the
 * Depot's KIND column stays empty. What none of them may do is invent one.
 *
 * ## What this function does **not** answer
 *
 * *"What Kind governs this Entry's row"* is `entryKind`
 * (`selectors/entry.ts`), which has two answers this one cannot give:
 * `'trip_only'` for an Entry naming no Gear, and `undefined` for a depot
 * Entry whose **Gear has not reached this replica**. That second `undefined`
 * is a different fact from this module's — a cross-aggregate sync race, the
 * ordinary case, not a Gear that arrived without a Kind — and the two stay
 * distinguishable because `kindOf` takes a `GearState` and cannot be asked
 * about a Gear that is not there.
 *
 * The **gates** below take `GearState | undefined` for exactly that reason:
 * *"is this Gear Counted"* has one honest answer for a Gear this replica
 * lacks — **no** — the conservative direction `isContainerEntry` already
 * takes, and forcing every call site to write its own `gear === undefined`
 * arm is how a fourth spelling of the gate gets born.
 */

/**
 * The Gear's Kind, or `undefined` when no `kind` register has been written.
 *
 * An **unrecognised** Kind comes back verbatim — obligation 4
 * (`sync-protocol.md` §5.3): a value this build does not know is still a
 * value somebody stated, and coercing it here would lose the one fact the
 * register carries.
 */
export function kindOf(gear: GearState): KindValue | undefined {
  return gear.kind?.value
}

/**
 * Is this Gear **Counted**? The gate `ownedCountOf`, `bringCountOf`,
 * `whereabouts`, the Depot's QTY column, gear detail's COUNT group, Find's
 * counted card and the picker's row suffix all ask, stated once so the
 * nineteenth call site cannot spell it differently from the first.
 *
 * `false` for a Gear this replica has not folded and for one carrying no
 * `kind` register — see this module's header for why that is the honest
 * direction rather than a shrug.
 */
export function isCounted(gear: GearState | undefined): boolean {
  return gear !== undefined && kindOf(gear) === 'counted'
}

/**
 * Is this Gear **per-person**? The Pieces half of the same gate — gear
 * detail's PIECES group, Find's per-person card, the picker's `PER-PERSON`
 * suffix.
 *
 * The *Entry-level* question is `entryKind(entry, state) === 'per_person'`
 * (`packing.ts`, `PackingRow.tsx`), which is a different one: it also has to
 * answer for a trip-only Entry, which names no Gear at all.
 */
export function isPerPerson(gear: GearState | undefined): boolean {
  return gear !== undefined && kindOf(gear) === 'per_person'
}
