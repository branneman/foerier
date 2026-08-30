import { describe, expect, it } from 'vitest'

import { aGear, anOp, aPerson, hlcAt } from '../../testUtils/index.ts'
import { personRenamed, type OpSpec } from '../authoring.ts'
import { emptyState, fold } from '../reduce.ts'
import type { DepotState } from '../state.ts'
import { ownerInitial, ownerLabel, ownerOf, personLabel } from './owner.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

function depot(...specs: readonly OpSpec[][]): DepotState {
  return fold(
    specs
      .flat()
      .map((spec, i) => anOp(spec, { hlc: hlcAt(i + 1), deviceId: DEV_A })),
    emptyState(),
  )
}

describe('ownerOf', () => {
  it('reads an absent register as shared', () => {
    const state = depot(aGear({ id: 'g1' }))
    expect(ownerOf(state.gear['g1']!)).toEqual({ type: 'shared' })
  })

  it('reads a written register exactly as written', () => {
    const state = depot(
      aGear({ id: 'g1', owner: { type: 'person', personId: 'p1' } }),
    )
    expect(ownerOf(state.gear['g1']!)).toEqual({
      type: 'person',
      personId: 'p1',
    })
  })
})

describe('ownerLabel', () => {
  it('reads SHARED for an absent register', () => {
    const state = depot(aGear({ id: 'g1' }))
    expect(ownerLabel(state, state.gear['g1']!)).toBe('SHARED')
  })

  it('reads SHARED for an explicit shared owner', () => {
    // The pair that matters: the fold keeps these two apart, and this is the
    // one place they are deliberately brought together.
    const state = depot(aGear({ id: 'g1', owner: { type: 'shared' } }))
    expect(ownerLabel(state, state.gear['g1']!)).toBe('SHARED')
  })

  it('reads PERSONAL plus the initial for a personal owner', () => {
    const state = depot(
      aPerson({ id: 'p1', name: 'Els' }),
      aGear({ id: 'g1', owner: { type: 'person', personId: 'p1' } }),
    )
    expect(ownerLabel(state, state.gear['g1']!)).toBe('PERSONAL E')
  })

  it('reads PERSONAL alone for a Person whose op has not arrived', () => {
    // Reachable in ordinary use: a gear op naming a Person whose own
    // `person.recorded` is still queued on another device.
    const state = depot(
      aGear({ id: 'g1', owner: { type: 'person', personId: 'ghost' } }),
    )
    expect(ownerLabel(state, state.gear['g1']!)).toBe('PERSONAL')
  })

  it('reads PERSONAL alone for a Person whose name was cleared', () => {
    const state = depot(
      aPerson({ id: 'p1', name: 'Els' }),
      [personRenamed('p1', null)],
      aGear({ id: 'g1', owner: { type: 'person', personId: 'p1' } }),
    )
    expect(ownerLabel(state, state.gear['g1']!)).toBe('PERSONAL')
  })
})

describe('ownerInitial', () => {
  it('reads undefined for shared gear — no letter to draw at all', () => {
    const state = depot(aGear({ id: 'g1' }))
    expect(ownerInitial(state, state.gear['g1']!)).toBeUndefined()
  })

  it('reads undefined for an explicit shared owner too', () => {
    const state = depot(aGear({ id: 'g1', owner: { type: 'shared' } }))
    expect(ownerInitial(state, state.gear['g1']!)).toBeUndefined()
  })

  it('reads the bare initial for a personal owner, with no PERSONAL beside it', () => {
    const state = depot(
      aPerson({ id: 'p1', name: 'Els' }),
      aGear({ id: 'g1', owner: { type: 'person', personId: 'p1' } }),
    )
    expect(ownerInitial(state, state.gear['g1']!)).toBe('E')
  })

  it('reads undefined for a Person whose op has not arrived', () => {
    const state = depot(
      aGear({ id: 'g1', owner: { type: 'person', personId: 'ghost' } }),
    )
    expect(ownerInitial(state, state.gear['g1']!)).toBeUndefined()
  })

  it('reads undefined for a Person whose name was cleared', () => {
    const state = depot(
      aPerson({ id: 'p1', name: 'Els' }),
      [personRenamed('p1', null)],
      aGear({ id: 'g1', owner: { type: 'person', personId: 'p1' } }),
    )
    expect(ownerInitial(state, state.gear['g1']!)).toBeUndefined()
  })
})

describe('personLabel', () => {
  it('reads the name as recorded, not upper-cased', () => {
    const state = depot(aPerson({ id: 'p1', name: 'Els' }))
    expect(personLabel(state, 'p1')).toBe('Els')
  })

  it('reads an em dash for a Person no op has named', () => {
    const state = depot(aGear({ id: 'g1' }))
    expect(personLabel(state, 'ghost')).toBe('—')
  })

  it('reads an em dash for a name that is only whitespace', () => {
    const state = depot(aPerson({ id: 'p1', name: '   ' }))
    expect(personLabel(state, 'p1')).toBe('—')
  })
})
