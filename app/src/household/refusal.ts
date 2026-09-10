import type { HouseholdState, OpSpec } from '@foerier/shared'

/**
 * **What a refused write says it was about** (`docs/design/README.md` §5n
 * K24b).
 *
 * The refusal sheet draws one mono line per refusal, subject then cause —
 * `GAS CANISTER 450 — TOO LARGE TO SAVE`. The cause is the store's own
 * `reason`; the subject is this file's whole job.
 */

/**
 * Why the log has nothing. Both mean **nothing was appended** — the difference
 * is whether this build refused to author or the log refused to hold it.
 */
export type RefusalReason = 'too-large' | 'not-saved'

/** One refused write, kept until a reader acknowledges it. */
export interface Refusal {
  /** Stable for the life of the entry, so a list can key on it. */
  readonly id: string
  /** When this Device refused it — `1 WRITE REFUSED · 14:32`. */
  readonly at: number
  /** {@link refusalSubject}'s answer, resolved when the refusal happened. */
  readonly subject: string
  readonly reason: RefusalReason
  /**
   * How many ops went down with it. `1` for an ordinary `emit`; the whole
   * gesture for an `emitAll`, which refuses all-or-nothing — the sheet draws
   * a batch as **one** line naming the gesture, never fourteen naming ops.
   */
  readonly ops: number
}

const CAUSE: Record<RefusalReason, string> = {
  'too-large': 'TOO LARGE TO SAVE',
  'not-saved': 'STORAGE UNAVAILABLE',
}

/** The cause half of a refusal's line. */
export function refusalCause(reason: RefusalReason): string {
  return CAUSE[reason]
}

/**
 * **The subject is read at the moment of refusal, not at render.**
 *
 * A refusal outlives the act that caused it — it stands until someone opens
 * the sheet — and by then the fold may have moved, or the reader may have
 * navigated away from the screen that knows what they were doing. Worse, the
 * common case is a refused **create**: the entity the op addresses is not in
 * the fold at all, because the write that would have put it there is the one
 * that failed. So the subject is resolved once, here, and stored as a string.
 *
 * **One rule over all thirty-nine op types, and no per-type table.** Every
 * {@link OpSpec} carries `aggregate` and `aggregate_id`
 * (`shared/src/authoring.ts`), so the entity is always nameable in principle:
 *
 * 1. **A `name` in the payload wins.** It is the word the Quartermaster just
 *    typed, and for a refused create it is the only place that word exists.
 * 2. **Otherwise the fold**, by aggregate and id — what every other surface
 *    would have drawn for that entity.
 * 3. **Otherwise the op type**, in the sheet's own register: an entity this
 *    replica has never folded is not nameable, and `TRIP · ENTRY ADDED` is
 *    honest where a fabricated name would not be. `docs/design/README.md`
 *    §13's withdrawal rule, applied to a slot that cannot be empty — the line
 *    has a cause to carry either way.
 */
export function refusalSubject(spec: OpSpec, state: HouseholdState): string {
  const named = spec.payload['name']
  if (typeof named === 'string' && named.trim() !== '') return cap(named)

  const folded = foldedName(spec, state)
  if (folded !== null) return cap(folded)

  return spec.type.replace(/[._]/g, ' ').toUpperCase()
}

/**
 * **The subject is capped, and the `too-large` case is why.**
 *
 * One of the two ways a write is refused is the op being over §1.4's 16 KB
 * cap — and the commonest way to author one is a name that is itself
 * enormous, so the subject of a refusal is routinely the oversized thing.
 * Uncapped, the sheet draws seventeen thousand characters where it means to
 * name one row, and the store holds them until someone acknowledges it.
 *
 * 60 is longer than any gear, place, person or trip name a household types
 * and short enough to read in a mono line. The ellipsis is the character, not
 * three dots, because this is a truncation and not a pause.
 */
const SUBJECT_MAX = 60

function cap(name: string): string {
  const trimmed = name.trim()
  return trimmed.length <= SUBJECT_MAX
    ? trimmed
    : `${trimmed.slice(0, SUBJECT_MAX - 1)}…`
}

function foldedName(spec: OpSpec, state: HouseholdState): string | null {
  const id = spec.aggregate_id
  const entity =
    spec.aggregate === 'gear'
      ? state.gear[id]
      : spec.aggregate === 'place'
        ? state.places[id]
        : spec.aggregate === 'person'
          ? state.people[id]
          : state.trips[id]

  // `?? null` twice over, and both matter: the entity may not be folded here,
  // and a folded one may carry an explicit `null` name — a register a peer
  // cleared (`sync-protocol.md` §1.3). Neither is a name.
  const name = entity?.name?.value ?? null
  return name === null || name.trim() === '' ? null : name
}
