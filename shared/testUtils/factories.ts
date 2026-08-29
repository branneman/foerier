import {
  gearRecorded,
  personRecorded,
  placeRecorded,
  tripCreated,
  tripDatesSet,
  tripParticipantAdded,
  tripPhaseMoved,
  type OpSpec,
} from '../src/authoring.ts'
import { formatHlc } from '../src/hlc.ts'
import type { OpEnvelope } from '../src/ops.ts'
import type { KindValue, Owner, PhaseValue, Residence } from '../src/state.ts'

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
    owner: Owner
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
      // Left absent by default like `residence` and `ownedCount`, and for a
      // sharper reason: an absent `owner` reads `SHARED`
      // (`selectors/owner.ts`), so defaulting it here would make every
      // fixture silently assert the equivalence rather than exercise it.
      ...(overrides.owner === undefined ? {} : { owner: overrides.owner }),
    }),
  ]
}

/**
 * The ops that record one Person: just `person.recorded`. A Person is an id
 * and a name and nothing else, so unlike {@link aGear} there is nothing to
 * leave deliberately absent.
 */
export function aPerson(
  overrides: Partial<{ id: string; name: string }> = {},
): OpSpec[] {
  const id = overrides.id ?? freshId('40000000')
  return [personRecorded(id, overrides.name ?? 'Els')]
}

/**
 * The ops that make one Trip. Unlike the other three factories this returns
 * **several** ops, because a Trip's shape is spread across four op types and
 * `trip.created` carries only the name — the phase is the reducer's own write
 * and the dates and Participants are separate ops (spec §1.3, §1.4, §1.5).
 * They come back in authoring order, so a caller stamping increasing clocks
 * over the flattened list gets exactly the log a screen would have written.
 *
 * `phase` emits a `trip.phase_moved` **whenever it is given**, including
 * `'draft'`: a Trip whose phase was moved to `draft` explicitly is a
 * different fact about the log from one that never left it, and a factory
 * that silently dropped the op would make the two indistinguishable in a test
 * that cares. Omit `phase` for the seeded default.
 *
 * `start` and `end` are only in the payload when given, and `null` clears —
 * {@link tripDatesSet}'s own rule, unchanged. There is deliberately no
 * default pair: story 5 says a Draft usually has no dates, and defaulting
 * them would make every fixture assert the dated case.
 */
export function aTrip(
  overrides: Partial<{
    id: string
    name: string
    phase: PhaseValue
    start: string | null
    end: string | null
    participants: readonly string[]
  }> = {},
): OpSpec[] {
  const id = overrides.id ?? freshId('50000000')
  const specs: OpSpec[] = [tripCreated(id, overrides.name ?? 'Ardennes')]
  if (overrides.phase !== undefined) {
    specs.push(tripPhaseMoved(id, overrides.phase))
  }
  if (overrides.start !== undefined || overrides.end !== undefined) {
    specs.push(
      tripDatesSet(id, {
        ...(overrides.start === undefined ? {} : { start: overrides.start }),
        ...(overrides.end === undefined ? {} : { end: overrides.end }),
      }),
    )
  }
  for (const personId of overrides.participants ?? []) {
    specs.push(tripParticipantAdded(id, personId))
  }
  return specs
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
