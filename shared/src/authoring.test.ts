import { describe, expect, it } from 'vitest'

import { countingIdSource, fakeClock } from '../testUtils/index.ts'
import {
  gearKindSet,
  gearOwnedCountSet,
  gearRecorded,
  gearRehomed,
  gearRenamed,
  gearRestored,
  gearRetired,
  personRecorded,
  placeRecorded,
  placeRemoved,
  placeRenamed,
  authorOp,
  type OpAuthor,
} from './authoring.ts'
import { createHlcClock } from './hlc.ts'

function anAuthor(overrides: Partial<OpAuthor> = {}): OpAuthor {
  return {
    household_id: 'aaaaaaaa-0000-7000-8000-000000000001',
    device_id: 'bbbbbbbb-0000-7000-8000-000000000002',
    ids: countingIdSource(),
    hlc: createHlcClock(fakeClock(0)),
    ...overrides,
  }
}

describe('gearRecorded', () => {
  it('omits an absent optional field rather than writing undefined or null', () => {
    const spec = gearRecorded('g1', {
      name: 'Tent',
      container: false,
      kind: 'single',
    })
    expect(Object.hasOwn(spec.payload, 'residence')).toBe(false)
    expect(Object.hasOwn(spec.payload, 'owner')).toBe(false)
    expect(Object.hasOwn(spec.payload, 'owned_count')).toBe(false)
    // Absent is not null: an absent field leaves the register alone, a null
    // clears it, and a builder must never blur the two (sync-protocol §1.3).
    expect(JSON.parse(JSON.stringify(spec.payload))).toEqual({
      name: 'Tent',
      container: false,
      kind: 'single',
    })
  })

  it('emits the wire`s snake_case, never state`s camelCase', () => {
    const spec = gearRecorded('g1', {
      name: 'Chair',
      container: false,
      kind: 'counted',
      owned_count: 3,
      owner: { type: 'person', personId: 'p1' },
    })
    expect(spec.payload).toEqual({
      name: 'Chair',
      container: false,
      kind: 'counted',
      owned_count: 3,
      owner: { type: 'person', person_id: 'p1' },
    })
  })
})

describe('authorOp', () => {
  it('stamps a fresh id and a fresh hlc on every op', () => {
    const author = anAuthor()
    const spec = placeRecorded('pl1', 'Garage')

    const first = authorOp(author, spec)
    const second = authorOp(author, spec)

    expect(first.id).not.toBe(second.id)
    expect(first.hlc).not.toBe(second.hlc)
  })

  it('takes household_id and device_id from the author, never from the spec', () => {
    const author = anAuthor({
      household_id: 'cccccccc-0000-7000-8000-000000000003',
      device_id: 'dddddddd-0000-7000-8000-000000000004',
    })

    const op = authorOp(author, placeRecorded('pl1', 'Garage'))

    expect(op.household_id).toBe('cccccccc-0000-7000-8000-000000000003')
    expect(op.device_id).toBe('dddddddd-0000-7000-8000-000000000004')
  })

  it('issues strictly increasing hlcs for a burst authored in one millisecond', () => {
    const author = anAuthor()
    const spec = placeRecorded('pl1', 'Garage')

    const hlcs = Array.from({ length: 5 }, () => authorOp(author, spec).hlc)

    for (let i = 1; i < hlcs.length; i++) {
      expect(hlcs[i]! > hlcs[i - 1]!).toBe(true)
    }
  })

  it('builds each of the three place ops with the aggregate set to place', () => {
    const specs = [
      placeRecorded('pl1', 'Garage'),
      placeRenamed('pl1', 'Shed'),
      placeRemoved('pl1'),
    ]
    for (const spec of specs) {
      expect(spec.aggregate).toBe('place')
    }
  })

  it('builds each of the seven gear ops with the aggregate set to gear', () => {
    const specs = [
      gearRecorded('g1', { name: 'Tent', container: true, kind: 'single' }),
      gearRenamed('g1', 'Big Tent'),
      gearRehomed('g1', { in: 'loose' }),
      gearKindSet('g1', 'counted'),
      gearOwnedCountSet('g1', 4),
      gearRetired('g1'),
      gearRestored('g1'),
    ]
    for (const spec of specs) {
      expect(spec.aggregate).toBe('gear')
    }
  })

  it('builds person.recorded with the aggregate set to person', () => {
    expect(personRecorded('p1', 'Bran').aggregate).toBe('person')
  })

  it('sets aggregate_id to the entity root for every builder', () => {
    const specs = [
      placeRecorded('pl1', 'Garage'),
      placeRenamed('pl1', 'Shed'),
      placeRemoved('pl1'),
      gearRecorded('g1', { name: 'Tent', container: true, kind: 'single' }),
      gearRenamed('g1', 'Big Tent'),
      gearRehomed('g1', { in: 'loose' }),
      gearKindSet('g1', 'counted'),
      gearOwnedCountSet('g1', 4),
      gearRetired('g1'),
      gearRestored('g1'),
      personRecorded('p1', 'Bran'),
    ]
    for (const spec of specs) {
      expect(spec.aggregate_id).toBe(
        spec.aggregate === 'person'
          ? 'p1'
          : spec.aggregate === 'place'
            ? 'pl1'
            : 'g1',
      )
    }
  })

  it('emits an empty payload object for place.removed, gear.retired and gear.restored', () => {
    expect(placeRemoved('pl1').payload).toEqual({})
    expect(gearRetired('g1').payload).toEqual({})
    expect(gearRestored('g1').payload).toEqual({})
  })
})
