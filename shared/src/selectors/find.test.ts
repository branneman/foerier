import { describe, expect, it } from 'vitest'

import { aGear, aPlace, anOp, hlcAt } from '../../testUtils/index.ts'
import { gearRehomed, gearRetired, type OpSpec } from '../authoring.ts'
import type { OpEnvelope } from '../ops.ts'
import { fold } from '../reduce.ts'
import { findGear } from './find.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

function at(specs: readonly OpSpec[], counter: number): OpEnvelope[] {
  return specs.map((s) => anOp(s, { hlc: hlcAt(counter), deviceId: DEV_A }))
}

function one(spec: OpSpec, counter: number): OpEnvelope {
  return anOp(spec, { hlc: hlcAt(counter), deviceId: DEV_A })
}

const names = (matches: readonly { gear: { name?: { value: unknown } } }[]) =>
  matches.map((m) => m.gear.name?.value)

describe('findGear', () => {
  it('matches on a substring of the name', () => {
    const ops = [
      ...at(aGear({ id: 'g-tent', name: 'Camping Tent' }), 1),
      ...at(aGear({ id: 'g-axe', name: 'Axe' }), 2),
    ]
    const state = fold(ops)

    expect(names(findGear(state, 'tent'))).toEqual(['Camping Tent'])
  })

  it('matches case-insensitively', () => {
    const ops = [...at(aGear({ id: 'g-tent', name: 'Tent' }), 1)]
    const state = fold(ops)

    expect(names(findGear(state, 'TENT'))).toEqual(['Tent'])
  })

  it('matches with diacritics folded', () => {
    const ops = [...at(aGear({ id: 'g-oil', name: 'Ölzeug' }), 1)]
    const state = fold(ops)

    expect(names(findGear(state, 'olzeug'))).toEqual(['Ölzeug'])
  })

  it('excludes retired gear', () => {
    const ops = [
      ...at(aGear({ id: 'g-tent', name: 'Old Tent' }), 1),
      one(gearRetired('g-tent'), 2),
    ]
    const state = fold(ops)

    expect(findGear(state, 'tent')).toEqual([])
  })

  it('returns an empty list for an empty query', () => {
    const ops = [...at(aGear({ id: 'g-tent', name: 'Tent' }), 1)]
    const state = fold(ops)

    expect(findGear(state, '')).toEqual([])
  })

  it('sorts matches by name', () => {
    const ops = [
      ...at(aGear({ id: 'g-tent', name: 'Tent' }), 1),
      ...at(aGear({ id: 'g-tarp', name: 'Tarp' }), 2),
      ...at(aGear({ id: 'g-table', name: 'Table' }), 3),
    ]
    const state = fold(ops)

    expect(names(findGear(state, 't'))).toEqual(['Table', 'Tarp', 'Tent'])
  })

  it("carries each match's home path", () => {
    const ops = [
      ...at(aPlace({ id: 'attic', name: 'Attic' }), 1),
      ...at(aGear({ id: 'crate', name: 'Crate B', container: true }), 2),
      ...at(aGear({ id: 'tent', name: 'Tent' }), 3),
      one(gearRehomed('crate', { in: 'place', id: 'attic' }), 4),
      one(gearRehomed('tent', { in: 'gear', id: 'crate' }), 5),
    ]
    const state = fold(ops)

    const [match] = findGear(state, 'tent')
    expect(match?.path).toEqual([
      { kind: 'place', id: 'attic', name: 'Attic' },
      { kind: 'gear', id: 'crate', name: 'Crate B' },
    ])
  })
})
