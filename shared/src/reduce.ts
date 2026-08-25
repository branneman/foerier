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
import type { DepotState, GearState, PlaceState } from './state.ts'

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

type Handler = (state: DepotState, op: OpEnvelope, stamp: Stamp) => DepotState

/**
 * `place.recorded` and `place.renamed` both just set `name` (`sync-protocol.md`
 * §4.1) — the entity itself is created by `writePlace` either way, out of
 * authoring order or not (§8.2).
 */
const setPlaceName: Handler = (state, op, stamp) =>
  writePlace(state, op.aggregate_id, stamp, (place, st) => {
    const name = readString(op.payload, 'name')
    // Absent and `null` both fall through here, and that is deliberate, not
    // an obligation-5 collapse: the catalogue types this payload's `name` as
    // a string (§4.1), so a `null` is malformed input, not a clear — there is
    // no wire shape that legitimately clears a Place's name. `PlaceState.name`
    // is `Register<string | null>` only because `Read<T>`'s `null` outcome is
    // shared machinery; nothing in this op catalogue is nullable (§5.4 also
    // forbids ever giving this field that meaning without a new op type).
    if (name.kind !== 'value') return place
    const next = writeRegister(place.name, name.value, st)
    // `writeRegister` returns the identical register on a lost write; a
    // spread here would still fabricate a new `place` object, so the
    // identity must be checked before copying, not after.
    return next === place.name ? place : { ...place, name: next }
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
    const name = writeIfPresent(gear.name, readString(op.payload, 'name'), st)
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

/** `gear.renamed` (§4.3): sets `name`. */
const gearRenamed: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const name = readString(op.payload, 'name')
    if (name.kind !== 'value') return gear
    const next = writeRegister(gear.name, name.value, st)
    return next === gear.name ? gear : { ...gear, name: next }
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
