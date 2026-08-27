import type { Stamp } from './hlc.ts'
import type { OpEnvelope } from './ops.ts'
import {
  readBoolean,
  readCount,
  readOpen,
  readOwner,
  readResidence,
  readString,
  type Read,
} from './payloads.ts'
import { writeRegister, type Register } from './registers.ts'
import type { DepotState, GearState, PersonState, PlaceState } from './state.ts'

/**
 * The fold's starting point (`sync-protocol.md` §8.4): no places, no gear, no
 * people, and nothing unfolded.
 */
export function emptyState(): DepotState {
  return {
    places: {},
    gear: {},
    people: {},
    unfolded: { count: 0, types: {} },
  }
}

/**
 * §5.3 obligation 1: an unknown `type` is retained, not rejected. Counted
 * here so it is observable, not just silently tolerated.
 */
function noteUnfolded(state: DepotState, type: string): DepotState {
  return {
    ...state,
    unfolded: {
      count: state.unfolded.count + 1,
      types: {
        ...state.unfolded.types,
        [type]: (state.unfolded.types[type] ?? 0) + 1,
      },
    },
  }
}

/**
 * Reads or creates the `PlaceState` at `id`, applies `update`, and copies
 * only what changed: the entity, the `places` map, and the top-level state.
 * Returns `state` unchanged — the identical object — when `update` returns
 * the identical `PlaceState` it was given, which is what a lost LWW write
 * does (`writeRegister`'s contract, propagated). Task 6 reuses this shape for
 * `gear`.
 */
function writePlace(
  state: DepotState,
  id: string,
  stamp: Stamp,
  update: (place: PlaceState, stamp: Stamp) => PlaceState,
): DepotState {
  const current = state.places[id] ?? { id }
  const updated = update(current, stamp)
  if (updated === current) return state
  return { ...state, places: { ...state.places, [id]: updated } }
}

/**
 * The `writePlace` shape, reused for `gear` (Task 6). Reads or creates the
 * `GearState` at `id`, applies `update`, and copies only what changed.
 */
function writeGear(
  state: DepotState,
  id: string,
  stamp: Stamp,
  update: (gear: GearState, stamp: Stamp) => GearState,
): DepotState {
  const current = state.gear[id] ?? { id }
  const updated = update(current, stamp)
  if (updated === current) return state
  return { ...state, gear: { ...state.gear, [id]: updated } }
}

/**
 * The `writePlace`/`writeGear` shape, reused for `people` (Task 7). Reads or
 * creates the `PersonState` at `id`, applies `update`, and copies only what
 * changed.
 */
function writePerson(
  state: DepotState,
  id: string,
  stamp: Stamp,
  update: (person: PersonState, stamp: Stamp) => PersonState,
): DepotState {
  const current = state.people[id] ?? { id }
  const updated = update(current, stamp)
  if (updated === current) return state
  return { ...state, people: { ...state.people, [id]: updated } }
}

/**
 * Writes `read`'s value into `current` via `writeRegister` only when `read`
 * actually carries a value — an absent (or malformed) field leaves `current`
 * untouched, propagating its identity so a caller can tell nothing changed.
 * This is what lets `gear.recorded` seed only the fields its payload
 * actually carries (§4.3), including falsy ones: `container: false` and
 * `owned_count: 0` are `{ kind: 'value' }`, not `{ kind: 'absent' }`.
 */
function writeIfPresent<T>(
  current: Register<T> | undefined,
  read: Read<T>,
  stamp: Stamp,
): Register<T> | undefined {
  if (read.kind !== 'value') return current
  return writeRegister(current, read.value, stamp)
}

/**
 * The `writeIfPresent` counterpart for a register whose **declared type
 * includes `null`** — named for that, not for `name`, so it generalises for
 * free the next time a nullable, non-`name` register shows up (`trip.
 * dates_set`'s `start`/`end`, a later slice's `date｜null`, is exactly this
 * shape). `PlaceState.name`, `GearState.name` and `PersonState.name` —
 * `Register<string | null>` (`state.ts`, Task 3) — are the only registers on
 * that side of the line today.
 *
 * The rule, uniform across every register in this reducer: **a register
 * whose declared type includes `null` takes an explicit `null` as a clear; a
 * register whose type does not treats a `null` payload as malformed and
 * ignores it.** §1.3 is the authority for this — it states the
 * absent-versus-null distinction generally, with no per-field carve-out.
 * §5.3 obligation 5 is *not* the authority: its text runs one way only
 * (treating an *absent* field as an explicit clear), so citing it to justify
 * collapsing `null` into absent — the reverse direction — was an
 * overstatement (`sync-protocol.md` §4.3's note records the correction).
 *
 * Every op that writes a `name` register — `place.recorded`/
 * `place.renamed`, `gear.recorded`/`gear.renamed`, `person.recorded` — goes
 * through this function rather than `writeIfPresent`, so the three behave
 * identically wherever they are written. (An earlier version of this file
 * had `setPlaceName` collapse `null` into absent, reasoning from §4.1's
 * payload shape rather than from the state type; that made an explicit
 * clear fold identically to an absent field, exactly the conflation
 * obligation 5's own direction forbids. Corrected once, here, rather than
 * per op.)
 */
function writeNullableIfPresent<T>(
  current: Register<T | null> | undefined,
  read: Read<T>,
  stamp: Stamp,
): Register<T | null> | undefined {
  if (read.kind === 'absent') return current
  const value = read.kind === 'null' ? null : read.value
  return writeRegister(current, value, stamp)
}

type Handler = (state: DepotState, op: OpEnvelope, stamp: Stamp) => DepotState

/**
 * `place.recorded` and `place.renamed` both just set `name` (`sync-protocol.md`
 * §4.1) — the entity itself is created by `writePlace` either way, out of
 * authoring order or not (§8.2).
 */
const setPlaceName: Handler = (state, op, stamp) =>
  writePlace(state, op.aggregate_id, stamp, (place, st) => {
    // `PlaceState.name` is `Register<string | null>` (Task 3), so a `null`
    // payload is a clear, not malformed input — `writeNullableIfPresent`'s rule.
    const next = writeNullableIfPresent(
      place.name,
      readString(op.payload, 'name'),
      st,
    )
    // `writeRegister` (inside `writeNullableIfPresent`) returns the identical
    // register on a lost write or an absent field; a spread here would still
    // fabricate a new `place` object, so the identity must be checked before
    // copying, not after. `next` is only ever `undefined` when it equals
    // `place.name` (both absent) — that branch is caught above, so the
    // second check is for the type checker, not runtime, under
    // `exactOptionalPropertyTypes`.
    if (next === place.name) return place
    return next === undefined ? place : { ...place, name: next }
  })

/**
 * `gear.recorded` (`sync-protocol.md` §4.3): creates the Gear and seeds each
 * **present** field as its own register, all stamped with this op's clock.
 * An absent field leaves its register absent — it is not defaulted. A second
 * `gear.recorded` for the same id (there is no other op for `container`) is
 * just an ordinary LWW write on each register it carries; nothing here
 * special-cases a repeat.
 */
const gearRecorded: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const name = writeNullableIfPresent(
      gear.name,
      readString(op.payload, 'name'),
      st,
    )
    const container = writeIfPresent(
      gear.container,
      readBoolean(op.payload, 'container'),
      st,
    )
    // An unrecognised `kind` is stored verbatim (§5.3 obligation 4) — hence
    // `readOpen`, not a closed enum reader.
    const kind = writeIfPresent(gear.kind, readOpen(op.payload, 'kind'), st)
    const residence = writeIfPresent(
      gear.residence,
      readResidence(op.payload, 'residence'),
      st,
    )
    const owner = writeIfPresent(gear.owner, readOwner(op.payload, 'owner'), st)
    const ownedCount = writeIfPresent(
      gear.ownedCount,
      readCount(op.payload, 'owned_count'),
      st,
    )
    if (
      name === gear.name &&
      container === gear.container &&
      kind === gear.kind &&
      residence === gear.residence &&
      owner === gear.owner &&
      ownedCount === gear.ownedCount
    ) {
      return gear
    }
    return {
      ...gear,
      ...(name === undefined ? {} : { name }),
      ...(container === undefined ? {} : { container }),
      ...(kind === undefined ? {} : { kind }),
      ...(residence === undefined ? {} : { residence }),
      ...(owner === undefined ? {} : { owner }),
      ...(ownedCount === undefined ? {} : { ownedCount }),
    }
  })

/** `gear.renamed` (§4.3): sets `name`, via `writeNullableIfPresent`'s rule. */
const gearRenamed: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const next = writeNullableIfPresent(
      gear.name,
      readString(op.payload, 'name'),
      st,
    )
    if (next === gear.name) return gear
    return next === undefined ? gear : { ...gear, name: next }
  })

/** `gear.rehomed` (§4.3): sets the **home** residence. A trip never touches it. */
const gearRehomed: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const residence = readResidence(op.payload, 'residence')
    if (residence.kind !== 'value') return gear
    const next = writeRegister(gear.residence, residence.value, st)
    return next === gear.residence ? gear : { ...gear, residence: next }
  })

/**
 * `gear.kind_set` (§4.3): sets `kind`. Exclusivity is structural — one
 * register, one value (domain invariant 5) — so there is nothing to guard.
 * An unrecognised value is stored verbatim (§5.3 obligation 4).
 */
const gearKindSet: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const kind = readOpen(op.payload, 'kind')
    if (kind.kind !== 'value') return gear
    const next = writeRegister(gear.kind, kind.value, st)
    return next === gear.kind ? gear : { ...gear, kind: next }
  })

/**
 * `gear.owned_count_set` (§4.3): sets `ownedCount` **absolutely**, never a
 * delta — a counter would be hazardous under replay and under two devices
 * closing the same trip. The payload key is `count`, not `owned_count`.
 */
const gearOwnedCountSet: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const count = readCount(op.payload, 'count')
    if (count.kind !== 'value') return gear
    const next = writeRegister(gear.ownedCount, count.value, st)
    return next === gear.ownedCount ? gear : { ...gear, ownedCount: next }
  })

/**
 * `gear.tag_applied` / `gear.tag_removed` (`sync-protocol.md` §4.3), which
 * are the same handler with a different value — an ordinary LWW pair on one
 * **per-tag** register (§3.4).
 *
 * The whole concurrency story is the register key, not the code here. Two
 * devices applying *different* tags address different registers, so neither
 * write is contested and both survive: the union is not computed, it is the
 * absence of a conflict. Apply and remove of the *same* tag address one
 * register and resolve by `writeRegister` like every other field.
 *
 * `readString`, deliberately, and no normalisation: §5's tolerant reader
 * outranks §4.3's `TagString` rule, so the key is the literal string that
 * arrived. `tags.ts` applies the rule on the way out, which is the only place
 * a spelling is ever decided.
 */
const gearTagWritten =
  (present: boolean): Handler =>
  (state, op, stamp) =>
    writeGear(state, op.aggregate_id, stamp, (gear, st) => {
      const tag = readString(op.payload, 'tag')
      if (tag.kind !== 'value') return gear
      const current = gear.tags?.[tag.value]
      const next = writeRegister(current, present, st)
      // Identity propagated, same as every other handler: a lost write must
      // not fabricate a new `gear` and invalidate a memo downstream.
      if (next === current) return gear
      return { ...gear, tags: { ...gear.tags, [tag.value]: next } }
    })

/**
 * `person.recorded` (`sync-protocol.md` §4.2): creates the Person and seeds
 * `name`. Only this op is in scope for this slice — `person.renamed` stays
 * unfolded (§5.3 obligation 1) until a later slice gives it a People list to
 * land on.
 */
const personRecorded: Handler = (state, op, stamp) =>
  writePerson(state, op.aggregate_id, stamp, (person, st) => {
    const next = writeNullableIfPresent(
      person.name,
      readString(op.payload, 'name'),
      st,
    )
    if (next === person.name) return person
    return next === undefined ? person : { ...person, name: next }
  })

/**
 * The op-type dispatch table (`sync-protocol.md` §4.1, §4.3). A `Record`, not
 * a `switch`, so "is this type known?" is a lookup — the same question the
 * tolerant reader asks. Task 7 extends this table with Person.
 */
const handlers: Record<string, Handler> = {
  'place.recorded': setPlaceName,
  'place.renamed': setPlaceName,
  // A tombstone is an ordinary LWW field; an edit never writes it (§3.5).
  'place.removed': (state, op, stamp) =>
    writePlace(state, op.aggregate_id, stamp, (place, st) => {
      const next = writeRegister(place.removed, true, st)
      return next === place.removed ? place : { ...place, removed: next }
    }),
  'gear.recorded': gearRecorded,
  'gear.renamed': gearRenamed,
  'gear.rehomed': gearRehomed,
  'gear.kind_set': gearKindSet,
  'gear.owned_count_set': gearOwnedCountSet,
  // Per-tag registers (§3.4). Present and absent, not create and delete.
  'gear.tag_applied': gearTagWritten(true),
  'gear.tag_removed': gearTagWritten(false),
  // `gear.retired` / `gear.restored` are an ordinary LWW pair on `retired`
  // (§3.5); an edit never writes it, so a retire that a later edit races
  // still leaves the gear retired.
  'gear.retired': (state, op, stamp) =>
    writeGear(state, op.aggregate_id, stamp, (gear, st) => {
      const next = writeRegister(gear.retired, true, st)
      return next === gear.retired ? gear : { ...gear, retired: next }
    }),
  'gear.restored': (state, op, stamp) =>
    writeGear(state, op.aggregate_id, stamp, (gear, st) => {
      const next = writeRegister(gear.retired, false, st)
      return next === gear.retired ? gear : { ...gear, retired: next }
    }),
  'person.recorded': personRecorded,
}

/**
 * Applies one op to `state` and returns the next state. Pure, with structural
 * sharing: only the touched entity, the map holding it, and the top-level
 * `DepotState` are copied. An unknown `type` is retained via `noteUnfolded`
 * rather than folded or rejected.
 */
export function applyOp(state: DepotState, op: OpEnvelope): DepotState {
  const handler = handlers[op.type]
  if (handler === undefined) return noteUnfolded(state, op.type)
  return handler(state, op, { hlc: op.hlc, deviceId: op.device_id })
}

/**
 * Folds a whole op log onto `from` (default: `emptyState()`). Order-
 * independent by construction (§3.2, §8.2): each register only ever accepts
 * a strictly later write, so folding the complete local log reproduces the
 * current state exactly (§8.4) — which is what makes a snapshot safely
 * discardable.
 */
export function fold(
  ops: Iterable<OpEnvelope>,
  from: DepotState = emptyState(),
): DepotState {
  let state = from
  for (const op of ops) {
    state = applyOp(state, op)
  }
  return state
}
