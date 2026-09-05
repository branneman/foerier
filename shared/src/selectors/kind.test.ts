import { describe, expect, it } from 'vitest'

import { aGear, anOp, hlcAt } from '../../testUtils/index.ts'
import type { OpSpec } from '../authoring.ts'
import { emptyState, fold } from '../reduce.ts'
import type { DepotState } from '../state.ts'
import { isCounted, isPerPerson, kindOf } from './kind.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

function depot(...specs: readonly OpSpec[][]): DepotState {
  return fold(
    specs
      .flat()
      .map((spec, i) => anOp(spec, { hlc: hlcAt(i + 1), deviceId: DEV_A })),
    emptyState(),
  )
}

/**
 * A `gear.recorded` with no `kind` field at all — reachable only through a
 * malformed op or a peer on an older build, since `gearRecorded` in
 * `authoring.ts` requires `kind`; the reducer's `writeIfPresent` leaves the
 * register unwritten rather than defaulting it either way. The same shape
 * `entry.test.ts` already uses for this case.
 */
function bareGear(id: string): OpSpec[] {
  return [
    {
      aggregate: 'gear',
      aggregate_id: id,
      type: 'gear.recorded',
      payload: { name: 'Mystery', container: false },
    },
  ]
}

describe('kindOf', () => {
  it('reads a written register exactly as written', () => {
    const state = depot(aGear({ id: 'g1', kind: 'counted' }))
    expect(kindOf(state.gear['g1']!)).toBe('counted')
  })

  it('reads an unrecognised Kind verbatim, never coerced', () => {
    const state = depot(aGear({ id: 'g1', kind: 'sled' }))
    expect(kindOf(state.gear['g1']!)).toBe('sled')
  })

  it('reads an absent register as undefined — no Kind, never Single', () => {
    const state = depot(bareGear('g1'))
    expect(kindOf(state.gear['g1']!)).toBeUndefined()
  })
})

describe('isCounted', () => {
  it('is true for Counted and false for every other stated Kind', () => {
    const state = depot(
      aGear({ id: 'counted', kind: 'counted' }),
      aGear({ id: 'single', kind: 'single' }),
      aGear({ id: 'per', kind: 'per_person' }),
      aGear({ id: 'sled', kind: 'sled' }),
    )
    expect(isCounted(state.gear['counted'])).toBe(true)
    expect(isCounted(state.gear['single'])).toBe(false)
    expect(isCounted(state.gear['per'])).toBe(false)
    expect(isCounted(state.gear['sled'])).toBe(false)
  })

  it('is false for an absent register and for a Gear this replica lacks', () => {
    const state = depot(bareGear('g1'))
    expect(isCounted(state.gear['g1'])).toBe(false)
    expect(isCounted(state.gear['ghost'])).toBe(false)
  })
})

describe('isPerPerson', () => {
  it('is true for per-person alone', () => {
    const state = depot(
      aGear({ id: 'per', kind: 'per_person' }),
      aGear({ id: 'single', kind: 'single' }),
      bareGear('bare'),
    )
    expect(isPerPerson(state.gear['per'])).toBe(true)
    expect(isPerPerson(state.gear['single'])).toBe(false)
    expect(isPerPerson(state.gear['bare'])).toBe(false)
    expect(isPerPerson(state.gear['ghost'])).toBe(false)
  })
})
