import type { Aggregate, OpEnvelope } from './ops.ts'
import type { HlcClock } from './hlc.ts'
import type { IdSource } from './boundaries.ts'
import type { KindValue, Owner, Residence } from './state.ts'
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
