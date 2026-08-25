import { describe, expect, it } from 'vitest'

import { aGear, anOp, hlcAt } from './factories.ts'

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
