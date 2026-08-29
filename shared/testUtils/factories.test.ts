import { describe, expect, it } from 'vitest'

import { aGear, anOp, aTrip, hlcAt } from './factories.ts'

const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'

describe('aGear', () => {
  it('defaults to a single, non-container piece of gear with a name', () => {
    const specs = aGear()
    const recorded = specs.find((spec) => spec.type === 'gear.recorded')
    expect(recorded?.payload['container']).toBe(false)
    expect(recorded?.payload['kind']).toBe('single')
    expect(typeof recorded?.payload['name']).toBe('string')
  })

  it('overrides exactly the fields given and no others', () => {
    const specs = aGear({ kind: 'counted' })
    const recorded = specs.find((spec) => spec.type === 'gear.recorded')
    // The field under test changed…
    expect(recorded?.payload['kind']).toBe('counted')
    // …and nothing else did: the defaults are untouched.
    expect(recorded?.payload['container']).toBe(false)
    expect(typeof recorded?.payload['name']).toBe('string')
  })
})

describe('anOp', () => {
  it('produces an envelope that round-trips through JSON unchanged', () => {
    const spec = aGear().find((s) => s.type === 'gear.recorded')!
    const envelope = anOp(spec, {
      hlc: hlcAt(1),
      deviceId: DEVICE,
      householdId: HOUSEHOLD,
      id: '00000000-0000-7000-8000-00000000002a',
    })
    const roundTripped = JSON.parse(JSON.stringify(envelope))
    expect(roundTripped).toEqual(envelope)
  })
})

/**
 * The first factory that returns **more than one** op, because a Trip's shape
 * is spread across four op types (spec §1.3–§1.5). What is worth guarding is
 * exactly the conditional emission: an override that is not given must not
 * put an op in the log, or every test built on this factory would silently
 * assert a written register where it meant an absent one.
 */
describe('aTrip', () => {
  it('emits trip.created alone when nothing is overridden', () => {
    // No phase op: the `draft` register is `trip.created`'s own write, so
    // emitting one here would make the seeded and the moved cases
    // indistinguishable.
    expect(aTrip().map((spec) => spec.type)).toEqual(['trip.created'])
  })

  it('emits a phase move whenever phase is given, draft included', () => {
    // An explicit move to `draft` is a different fact about the log from
    // never having left it, and both are reachable.
    expect(aTrip({ phase: 'draft' }).map((spec) => spec.type)).toEqual([
      'trip.created',
      'trip.phase_moved',
    ])
  })

  it('omits an absent date key from the payload and keeps an explicit null', () => {
    const dates = aTrip({ end: null }).find(
      (spec) => spec.type === 'trip.dates_set',
    )
    expect(Object.hasOwn(dates?.payload ?? {}, 'start')).toBe(false)
    expect(dates?.payload['end']).toBeNull()
  })

  it('emits one participant op per Person, in the order given', () => {
    const specs = aTrip({ id: 't1', participants: ['els', 'mark'] })
    expect(
      specs
        .filter((spec) => spec.type === 'trip.participant_added')
        .map((spec) => spec.payload['person_id']),
    ).toEqual(['els', 'mark'])
  })
})
