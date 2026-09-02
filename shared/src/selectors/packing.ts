import type {
  DepotState,
  EntryState,
  PieceState,
  StageValue,
  StatusValue,
} from '../state.ts'
import { isContainerEntry } from './entry.ts'

/**
 * **Packing's read side** — beside `trip.ts` and `owner.ts`, and the same
 * shape of problem solved the same way: a handful of facts several surfaces
 * must agree on, stated once here rather than at each of them.
 *
 * Three of those facts outlive this slice, which is why they are functions
 * and not idioms:
 *
 * - **An absent `status` register reads `not_packed`; an absent `stage` reads
 *   `home`**, and only {@link statusOf} / {@link pieceStatusOf} /
 *   {@link stageOf} say so. This is `ownerOf`'s rule and `phaseOf`'s rule for
 *   a fourth and fifth time. The fold conflates nothing — absent and an
 *   explicit `"not_packed"` stay different facts about the log — but every
 *   reader treats them alike, and saying so exactly once is what stops the
 *   row, the group count, the progress line and the ▲ line drifting apart.
 *   The symptom of a call site re-deriving it is a row drawn `NOT PACKED`
 *   while the group header counts it packed.
 * - **{@link isPacked} is the only definition of packed-ness in the
 *   codebase** — {@link isActive}'s sibling and for its reason. The
 *   numerator, `N LEFT`, the `○ LEFT` filter and S10's close gate must never
 *   disagree about what counts. `staged` is **not** packed.
 * - **`stage` xor `status` is a gate on the way out, never in the reducer**
 *   (spec §1.3). The containment trait lives on the Gear aggregate, so a
 *   reducer resolving it would make the fold order-dependent on whether
 *   `gear.recorded` had arrived. Both registers fold unconditionally; these
 *   two functions decide which one a reader may see.
 *
 * **There is deliberately no `nextStage`.** Ruling A15 makes the rail a
 * direct set, so a "next" would be a function with no caller and an idiom the
 * design round retired.
 */

/** The three statuses this build knows, as a **closed** union — deliberately
 * narrower than {@link StatusValue}, exactly as `PhaseKey` is narrower than
 * `PhaseValue`. A key is a row in {@link STATUSES}; a value is whatever
 * arrived, and asking it a question has to go through a lookup that can
 * miss. */
export type StatusKey = 'not_packed' | 'staged' | 'packed'
export type StageKey = 'home' | 'staging' | 'car' | 'packed'

export interface PackingStatus {
  id: StatusKey
  /** `NOT PACKED` · `STAGED` · `PACKED`. */
  label: string
  /** `○` · `◐` · `●` — the pill, the `SET EVERYONE` chips and the count line
   * all draw it, so it is a column of the table rather than a switch at three
   * call sites. */
  glyph: string
  /** What {@link isPacked} reads. Exactly one row carries `true`. */
  packed: boolean
}

export interface JourneyStage {
  id: StageKey
  /** `⌂ HOME` · `STAGING` · `CAR` · `PACKED`. */
  label: string
  /**
   * The ▲ line's own word for this stage — `IN CAR`, `PACKED` — or `null`
   * where the line never fires.
   *
   * **One field, not a boolean plus a string**, so ruling A6's "fires at
   * `car` and `packed` only" cannot drift from the phrasing it fires with.
   * It is a second string rather than a transform of {@link label} for
   * `Phase.name`'s reason: `CAR` becomes `IN CAR` and `PACKED` stays
   * `PACKED`, and no function gets both right without knowing what kind of
   * word each is — which is what the table knows and a screen does not.
   *
   * `staging` is `null` because **staging *is* the act of packing**: unpacked
   * contents on the staging floor are the work, not a contradiction.
   */
  disagreementLabel: string | null
}

/** In the pill's cycle order, which the `SET EVERYONE` chips also draw. */
export const STATUSES: readonly PackingStatus[] = [
  { id: 'not_packed', label: 'NOT PACKED', glyph: '○', packed: false },
  { id: 'staged', label: 'STAGED', glyph: '◐', packed: false },
  { id: 'packed', label: 'PACKED', glyph: '●', packed: true },
]

/** In the rail's drawn order — the sequence a container usually runs, though
 * ruling A15 makes every chip a direct set in either direction. */
export const STAGES: readonly JourneyStage[] = [
  { id: 'home', label: '⌂ HOME', disagreementLabel: null },
  { id: 'staging', label: 'STAGING', disagreementLabel: null },
  { id: 'car', label: 'CAR', disagreementLabel: 'IN CAR' },
  { id: 'packed', label: 'PACKED', disagreementLabel: 'PACKED' },
]

/**
 * The rows, or `undefined` for a value this build has never heard of.
 *
 * **Private on purpose**, for the reason `phaseRow` gives and three S6
 * reviews caught: every question the tables answer has a named function
 * beside it, so no caller has to remember what a missing row means. A
 * question wanting a row exports a named function beside these rather than
 * the lookup.
 */
function statusRow(status: StatusValue): PackingStatus | undefined {
  return STATUSES.find((row) => row.id === status)
}

function stageRow(stage: StageValue): JourneyStage | undefined {
  return STAGES.find((row) => row.id === stage)
}

/**
 * The Entry's status, or `null` for a **container** — which carries a journey
 * *instead of* a status (sync §3.7) and can therefore never be marked packed.
 *
 * `null` is returned whatever the register holds: a peer on another build may
 * have written one, and the tolerant reader folds it rather than rejecting
 * it. This is the gate spec §1.3 keeps out of the reducer.
 */
export function statusOf(
  entry: EntryState,
  state: DepotState,
): StatusValue | null {
  if (isContainerEntry(entry, state)) return null
  return entry.status?.value ?? 'not_packed'
}

/**
 * One Piece's status. `piece` may be `undefined` — a Piece is **derived**
 * (`piece.ts`), so a Participant who has never been addressed by a Piece op
 * has no `PieceState` at all and must still answer `not_packed`.
 */
export function pieceStatusOf(
  piece: PieceState | undefined,
  entry: EntryState,
  state: DepotState,
): StatusValue | null {
  if (isContainerEntry(entry, state)) return null
  return piece?.status?.value ?? 'not_packed'
}

/** The container's journey stage, or `null` for a non-container. */
export function stageOf(
  entry: EntryState,
  state: DepotState,
): StageValue | null {
  if (!isContainerEntry(entry, state)) return null
  return entry.stage?.value ?? 'home'
}

/** How a status is drawn. An unrecognised value renders **verbatim** —
 * `trip.ts`'s answer for an unrecognised phase, and §5.3 obligation 4's. */
export function statusLabel(status: StatusValue): string {
  return statusRow(status)?.label ?? status
}

/** The pill's glyph. An unrecognised value draws `○` — it is not packed, and
 * the pill must still paint something. */
export function statusGlyph(status: StatusValue): string {
  return statusRow(status)?.glyph ?? '○'
}

export function stageLabel(stage: StageValue): string {
  return stageRow(stage)?.label ?? stage
}

/** Ruling A6's threshold, half of it: which stages the ▲ line fires at, and
 * what it calls them. `null` for `home`, `staging` and anything unrecognised
 * — a build that cannot name a stage cannot claim a disagreement about it. */
export function stageDisagreementLabel(stage: StageValue): string | null {
  return stageRow(stage)?.disagreementLabel ?? null
}

/**
 * The pill's cycle: `not_packed → staged → packed → not_packed`.
 *
 * An unrecognised value cycles to `not_packed` — **the only answer that is
 * not an invention**. Guessing a position in a sequence this build does not
 * hold would author a status on the strength of a spelling.
 */
export function nextStatus(status: StatusValue): StatusValue {
  const index = STATUSES.findIndex((row) => row.id === status)
  if (index === -1) return 'not_packed'
  return STATUSES[(index + 1) % STATUSES.length]?.id ?? 'not_packed'
}

/**
 * **The only definition of packed-ness in the codebase.** The numerator,
 * `N LEFT`, the `○ LEFT` filter, every group count and S10's close gate read
 * this and nothing else. An unrecognised status is not packed.
 */
export function isPacked(status: StatusValue): boolean {
  return statusRow(status)?.packed === true
}

export function isKnownStatus(status: StatusValue): boolean {
  return statusRow(status) !== undefined
}

export function isKnownStage(stage: StageValue): boolean {
  return stageRow(stage) !== undefined
}
