import type { Aggregate, OpEnvelope } from './ops.ts'
import type { HlcClock } from './hlc.ts'
import type { IdSource } from './boundaries.ts'
import type { KindValue, Owner, PhaseValue, Residence } from './state.ts'
import type { TagString } from './tags.ts'

/**
 * The **strict** half of the reader (`docs/sync-protocol.md` §5.3). Its
 * counterpart is `payloads.ts`, which is tolerant: foerier is strict about
 * what it emits and liberal in what it accepts. This is the only place an op
 * payload is ever constructed, so the app cannot author a malformed one.
 *
 * Every builder returns an {@link OpSpec} — the `type`-specific part of an op
 * — and {@link authorOp} completes it into an {@link OpEnvelope} by stamping
 * the envelope fields the app never gets to choose per-op: `id` and `hlc` are
 * minted fresh every time, `household_id` and `device_id` come from the
 * session, not the call site.
 */

/** The `type`-specific half of an op, before {@link authorOp} completes it. */
export interface OpSpec {
  aggregate: Aggregate
  aggregate_id: string
  type: string
  payload: Record<string, unknown>
}

/**
 * The session an op is authored under: fixed for as long as a device stays
 * signed in, and never something an individual builder call supplies.
 */
export interface OpAuthor {
  household_id: string
  device_id: string
  ids: IdSource
  hlc: HlcClock
}

/**
 * Completes an {@link OpSpec} into an {@link OpEnvelope}. `id` is stamped
 * from the `IdSource` and `hlc` from the `HlcClock`, in that order, and
 * neither is ever regenerated once stamped — the builder never mints either
 * itself.
 */
export function authorOp(author: OpAuthor, spec: OpSpec): OpEnvelope {
  return {
    id: author.ids.next(),
    household_id: author.household_id,
    aggregate: spec.aggregate,
    aggregate_id: spec.aggregate_id,
    type: spec.type,
    hlc: author.hlc.issue(),
    device_id: author.device_id,
    payload: spec.payload,
  }
}

/**
 * The outbound mirror of `payloads.ts`'s `readOwner`:
 * `{ type: 'person', personId }` → `{ type: 'person', person_id: personId }`.
 * `{ type: 'shared' }` needs no translation.
 */
function wireOwner(owner: Owner): Record<string, unknown> {
  if (owner.type === 'shared') return { type: 'shared' }
  return { type: 'person', person_id: owner.personId }
}

/** `sync-protocol.md` §4.1: creates the Place; seeds `name`. */
export function placeRecorded(id: string, name: string): OpSpec {
  return {
    aggregate: 'place',
    aggregate_id: id,
    type: 'place.recorded',
    payload: { name },
  }
}

/** `sync-protocol.md` §4.1: sets `name`. */
export function placeRenamed(id: string, name: string): OpSpec {
  return {
    aggregate: 'place',
    aggregate_id: id,
    type: 'place.renamed',
    payload: { name },
  }
}

/**
 * `sync-protocol.md` §4.1: sets the tombstone. Payload is `{}` — present and
 * empty, never absent, never `null` (§1.1).
 */
export function placeRemoved(id: string): OpSpec {
  return {
    aggregate: 'place',
    aggregate_id: id,
    type: 'place.removed',
    payload: {},
  }
}

/**
 * `sync-protocol.md` §4.3: creates the Gear and seeds each **present** field
 * as its own register. `residence`, `owner` and `owned_count` are optional —
 * an absent field is omitted from the payload, never written as `undefined`
 * or `null` (§1.3).
 */
export function gearRecorded(
  id: string,
  fields: {
    name: string
    container: boolean
    kind: KindValue
    residence?: Residence
    owner?: Owner
    owned_count?: number
  },
): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.recorded',
    payload: {
      name: fields.name,
      container: fields.container,
      kind: fields.kind,
      ...(fields.residence === undefined
        ? {}
        : { residence: fields.residence }),
      ...(fields.owner === undefined ? {} : { owner: wireOwner(fields.owner) }),
      ...(fields.owned_count === undefined
        ? {}
        : { owned_count: fields.owned_count }),
    },
  }
}

/** `sync-protocol.md` §4.3: sets `name`. */
export function gearRenamed(id: string, name: string): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.renamed',
    payload: { name },
  }
}

/** `sync-protocol.md` §4.3: sets the **home** residence. A trip never touches it. */
export function gearRehomed(id: string, residence: Residence): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.rehomed',
    payload: { residence },
  }
}

/** `sync-protocol.md` §4.3: sets `kind`. One register, one value (invariant 5). */
export function gearKindSet(id: string, kind: KindValue): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.kind_set',
    payload: { kind },
  }
}

/**
 * `sync-protocol.md` §4.3: sets `owned_count`, absolutely — never a delta.
 * The payload field is `count`, not `owned_count`; the catalogue names it
 * that way to keep the op self-describing without repeating the register it
 * writes.
 */
export function gearOwnedCountSet(id: string, count: number): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.owned_count_set',
    payload: { count },
  }
}

/**
 * `sync-protocol.md` §4.3: sets `owner`.
 *
 * The cheapest op in the catalogue after the tag pair — {@link wireOwner}
 * already existed, because `gear.recorded` may carry `owner?` and S2 wired the
 * camelCase-to-wire mapping for it.
 */
export function gearOwnershipSet(id: string, owner: Owner): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.ownership_set',
    payload: { owner: wireOwner(owner) },
  }
}

/**
 * `sync-protocol.md` §4.3: sets the per-tag register to **present** (§3.4).
 *
 * The parameter is a {@link TagString}, not a `string`, and that is the
 * design's spelling defence made structural: there is no Tag entity and no
 * rename op, so the picker is the only place a spelling is ever decided, and
 * `normalizeTag` is the only way to make one. The `#` every screen draws is
 * never stored.
 */
export function gearTagApplied(id: string, tag: TagString): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.tag_applied',
    payload: { tag },
  }
}

/**
 * `sync-protocol.md` §4.3: sets the per-tag register to **absent** (§3.4).
 *
 * Not a delete — one register, written `false`, carrying a clock like any
 * other write. That is what lets a concurrent re-apply win on merit rather
 * than on which device happened to sync first, and what makes an apply/remove
 * race resolve by plain LWW instead of by arrival order.
 */
export function gearTagRemoved(id: string, tag: TagString): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.tag_removed',
    payload: { tag },
  }
}

/**
 * `sync-protocol.md` §4.3: sets the tombstone. Payload is `{}` — present and
 * empty, never absent, never `null` (§1.1).
 */
export function gearRetired(id: string): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.retired',
    payload: {},
  }
}

/**
 * `sync-protocol.md` §4.3: clears the tombstone if strictly later. Payload is
 * `{}` — present and empty, never absent, never `null` (§1.1).
 */
export function gearRestored(id: string): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.restored',
    payload: {},
  }
}

/** `sync-protocol.md` §4.2: creates the Person; seeds `name`. */
export function personRecorded(id: string, name: string): OpSpec {
  return {
    aggregate: 'person',
    aggregate_id: id,
    type: 'person.recorded',
    payload: { name },
  }
}

/**
 * `sync-protocol.md` §4.2: sets `name`.
 *
 * **`string | null`, settled by this slice.** §4.2 typed the row `{name}` and
 * said in as many words that the slice which folds it settles the question.
 * `PersonState.name` is `Register<string | null>`, so an explicit `null` is a
 * clear like any other write and an absent field leaves the register alone
 * (§1.3). No carve-out: this is the rule the six other name registers already
 * follow.
 *
 * {@link personRecorded} above keeps its `string` parameter. Its only callers
 * — the join screen and the People screen's `+ NEW PERSON` — have a name in
 * hand, and a Person recorded with no name is not a state any screen can
 * author.
 */
export function personRenamed(id: string, name: string | null): OpSpec {
  return {
    aggregate: 'person',
    aggregate_id: id,
    type: 'person.renamed',
    payload: { name },
  }
}

/**
 * `sync-protocol.md` §4.4: creates the Trip; seeds `name`.
 *
 * It does **not** seed the phase — `trip.created`'s payload is
 * `{name, from_trip_id?}` and carries no phase field at all, so the reducer
 * writes `draft` itself on this op's own clock (spec §1.3). Three properties
 * fall out of that and none of them needs a special case: a
 * `trip.phase_moved` delivered first wins on its own strictly-later stamp, a
 * re-delivered creation is idempotent, and no client can author a Trip that
 * arrives already `closed`.
 *
 * `from_trip_id` has no parameter here, deliberately: nothing before S14
 * copies a Trip from a template, and a builder parameter with no caller is a
 * shape frozen by §5.4 on a guess. The reducer folds the field regardless
 * (`TripState.fromTripId`), and the fixture pins it with a hand-written op.
 *
 * `name` is a `string`, though {@link tripRenamed} and the reader both accept
 * `null`: no screen can author a Trip with no name — F3 step 1 requires
 * one — and the nullable type exists for a *reader* meeting an op some other
 * build emitted (spec §1.2). {@link personRecorded} draws the same line for
 * the same reason.
 */
export function tripCreated(id: string, name: string): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: id,
    type: 'trip.created',
    payload: { name },
  }
}

/**
 * `sync-protocol.md` §4.4: sets `name`.
 *
 * **`string | null`, settled by this slice** — the seventh and eighth `name`
 * rows, closed exactly as S4 closed the sixth (§4.2's `person.renamed`) and
 * from the same general rule rather than a new one: `TripState.name` is
 * `Register<string | null>`, so an explicit `null` clears and an absent field
 * leaves the register alone (§1.3).
 */
export function tripRenamed(id: string, name: string | null): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: id,
    type: 'trip.renamed',
    payload: { name },
  }
}

/**
 * `sync-protocol.md` §4.4: emits `start` and/or `end`, which write the
 * `startDate` and `endDate` registers — two independent registers, each
 * following the absent-versus-null rule separately (§1.3).
 *
 * A key the caller omits is **omitted from the payload entirely**
 * ({@link gearRecorded}'s spread idiom), never emitted as `undefined` or
 * coerced to `null`: omitting leaves that date alone, and `null` clears it.
 * The screen therefore emits only what changed, which is what stops one
 * device's date edit from reverting the other's.
 *
 * The two names differ on purpose — the same split `gear.owned_count_set`
 * already has over an `ownedCount` register (spec §1.4) — and are named at
 * both ends here so nobody "fixes" one to match the other. A date is emitted
 * as written and read back verbatim; there is no `YYYY-MM-DD` gate on either
 * side.
 */
export function tripDatesSet(
  id: string,
  dates: { start?: string | null; end?: string | null },
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: id,
    type: 'trip.dates_set',
    payload: {
      ...(dates.start === undefined ? {} : { start: dates.start }),
      ...(dates.end === undefined ? {} : { end: dates.end }),
    },
  }
}

/**
 * `sync-protocol.md` §4.4: moves the phase. One register, one value, so
 * exclusivity is structural and there is nothing to guard — and invariant 16
 * makes every move expressible in **either** direction, so this builder
 * encodes no transition graph. Entering `closed` is unguarded until S10 has
 * something that could be open; leaving it is confirmed on the screen, never
 * in the op.
 */
export function tripPhaseMoved(id: string, phase: PhaseValue): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: id,
    type: 'trip.phase_moved',
    payload: { phase },
  }
}

/**
 * `sync-protocol.md` §4.4: sets the per-person register to **present**
 * (§3.4), the same shape {@link gearTagApplied} has on tags.
 */
export function tripParticipantAdded(id: string, personId: string): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: id,
    type: 'trip.participant_added',
    payload: { person_id: personId },
  }
}

/**
 * `sync-protocol.md` §4.4: sets the per-person register to **absent** (§3.4).
 *
 * Not a delete — one register, written `false`, carrying a clock like any
 * other write, so a concurrent re-add wins on merit rather than on which
 * device happened to sync first.
 */
export function tripParticipantRemoved(id: string, personId: string): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: id,
    type: 'trip.participant_removed',
    payload: { person_id: personId },
  }
}
