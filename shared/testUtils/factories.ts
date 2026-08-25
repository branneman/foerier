import { gearRecorded, placeRecorded, type OpSpec } from '../src/authoring.ts'
import { formatHlc } from '../src/hlc.ts'
import type { OpEnvelope } from '../src/ops.ts'
import type { KindValue, Residence } from '../src/state.ts'

/**
 * Factories return op **specs**, not folded entities (see this module's
 * header note in `index.ts`). A test that wants a Place or a piece of Gear
 * in a state folds the ops these produce, exercising the real reducer path
 * rather than a shortcut around it. Overrides are the state-side camelCase
 * names; every builder call still goes through `authoring.ts`, never a
 * hand-shaped payload, so the factory cannot drift from the wire format.
 */

const DEFAULT_HLC_MS = 1_700_000_000_000

let idCounter = 0

/** A fresh, canonical-shaped id, distinct per call (`countingIdSource`'s shape). */
function freshId(prefix: string): string {
  const suffix = (idCounter++).toString(16).padStart(12, '0')
  return `${prefix}-0000-7000-8000-${suffix}`
}

const DEFAULT_HOUSEHOLD_ID = 'ffffffff-0000-7000-8000-000000000000'

/** `hlc` at logical `counter`, all at the same default millisecond unless `ms` is given. */
export function hlcAt(counter: number, ms: number = DEFAULT_HLC_MS): string {
  return formatHlc({ ms, counter })
}

/**
 * The ops that record one Place: just `place.recorded`. Overrides name only
 * the field under test; everything else defaults.
 */
export function aPlace(
  overrides: Partial<{ id: string; name: string }> = {},
): OpSpec[] {
  const id = overrides.id ?? freshId('10000000')
  const name = overrides.name ?? 'Attic'
  return [placeRecorded(id, name)]
}

/**
 * The ops that record one piece of Gear: just `gear.recorded`. Defaults to a
 * single, non-container piece of gear with a name; `residence` and
 * `ownedCount` are left absent by default, matching `gear.recorded`'s own
 * optional fields (`sync-protocol.md` §4.3).
 */
export function aGear(
  overrides: Partial<{
    id: string
    name: string
    container: boolean
    kind: KindValue
    residence: Residence
    ownedCount: number
  }> = {},
): OpSpec[] {
  const id = overrides.id ?? freshId('20000000')
  return [
    gearRecorded(id, {
      name: overrides.name ?? 'Tent',
      container: overrides.container ?? false,
      kind: overrides.kind ?? 'single',
      ...(overrides.residence === undefined
        ? {}
        : { residence: overrides.residence }),
      ...(overrides.ownedCount === undefined
        ? {}
        : { owned_count: overrides.ownedCount }),
    }),
  ]
}

/**
 * Completes an {@link OpSpec} into an {@link OpEnvelope}, the same shape
 * `authorOp` produces but with every envelope field a test can pin
 * explicitly — `hlc` and `deviceId` are required, `householdId` and `id`
 * default to fixed, canonical-shaped values when omitted.
 */
export function anOp(
  spec: OpSpec,
  at: { hlc: string; deviceId: string; householdId?: string; id?: string },
): OpEnvelope {
  return {
    id: at.id ?? freshId('30000000'),
    household_id: at.householdId ?? DEFAULT_HOUSEHOLD_ID,
    aggregate: spec.aggregate,
    aggregate_id: spec.aggregate_id,
    type: spec.type,
    hlc: at.hlc,
    device_id: at.deviceId,
    payload: spec.payload,
  }
}
