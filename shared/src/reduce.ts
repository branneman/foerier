import type { Stamp } from './hlc.ts'
import type { OpEnvelope } from './ops.ts'
import { readString } from './payloads.ts'
import { writeRegister } from './registers.ts'
import type { DepotState, PlaceState } from './state.ts'

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

type Handler = (state: DepotState, op: OpEnvelope, stamp: Stamp) => DepotState

/**
 * `place.recorded` and `place.renamed` both just set `name` (`sync-protocol.md`
 * §4.1) — the entity itself is created by `writePlace` either way, out of
 * authoring order or not (§8.2).
 */
const setPlaceName: Handler = (state, op, stamp) =>
  writePlace(state, op.aggregate_id, stamp, (place, st) => {
    const name = readString(op.payload, 'name')
    if (name.kind !== 'value') return place
    const next = writeRegister(place.name, name.value, st)
    // `writeRegister` returns the identical register on a lost write; a
    // spread here would still fabricate a new `place` object, so the
    // identity must be checked before copying, not after.
    return next === place.name ? place : { ...place, name: next }
  })

/**
 * The op-type dispatch table (`sync-protocol.md` §4.1). A `Record`, not a
 * `switch`, so "is this type known?" is a lookup — the same question the
 * tolerant reader asks. Tasks 6 and 7 extend this table with Gear and Person.
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
