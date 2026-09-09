import { describe, expect, it } from 'vitest'

import type { Stamp } from '../hlc.ts'
import { hlcAt } from '../../testUtils/index.ts'
import { byNameThenId, byStampThenId } from './order.ts'

/**
 * The two comparators every list in the app is drawn through. What they are
 * for is **convergence**, not neatness: `Object.keys` returns the order this
 * replica happened to receive ops in, so an unsorted list is one two Devices
 * draw differently with no symptom on either. Both are therefore **total** —
 * ties broken on id — because a comparator that returns 0 for two distinct
 * rows leaves their order to the engine's sort, which is not a promise.
 */

function stamp(counter: number, deviceId = 'device-a'): Stamp {
  return { hlc: hlcAt(counter), deviceId }
}

describe('byNameThenId', () => {
  it('files case-insensitively, so `axe` sits with `Axe` and not after `Zebra`', () => {
    const rows = [
      { id: '1', name: { value: 'Zebra blanket' } },
      { id: '2', name: { value: 'axe' } },
      { id: '3', name: { value: 'Axe' } },
    ]

    expect([...rows].sort(byNameThenId).map((row) => row.id)).toEqual([
      // `Axe` before `axe`: equal lowercased, so the raw name breaks it, and
      // the order is the same on every device either way.
      '3',
      '2',
      '1',
    ])
  })

  it('reads an absent or null name as empty rather than throwing', () => {
    const rows = [
      { id: 'b', name: { value: null } },
      { id: 'a' },
      { id: 'c', name: { value: 'Tent' } },
    ]

    expect([...rows].sort(byNameThenId).map((row) => row.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('byStampThenId', () => {
  it('orders by the creating register’s stamp, oldest first', () => {
    // Ids run **against** the stamps deliberately: with `a` newest, an
    // implementation that compared nothing and fell straight through to the
    // id tiebreak would produce the opposite order rather than this one — the
    // false pass a same-direction fixture would have hidden.
    const rows = [
      { id: 'a', stamp: stamp(3) },
      { id: 'c', stamp: stamp(1) },
      { id: 'b', stamp: stamp(2) },
    ]

    expect([...rows].sort(byStampThenId).map((row) => row.id)).toEqual([
      'c',
      'b',
      'a',
    ])
  })

  it('breaks a tie on id, so two rows never swap between renders', () => {
    // Unreachable in practice — `compareStamps` already tiebreaks on
    // `deviceId`, and two ops from one Device cannot share an HLC. The arm
    // exists so the order is total by inspection rather than by an argument
    // about the clock.
    const one = stamp(1)
    const rows = [
      { id: 'b', stamp: one },
      { id: 'a', stamp: one },
    ]

    expect([...rows].sort(byStampThenId).map((row) => row.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('falls to the id when a stamp is missing, rather than placing it', () => {
    const rows = [
      { id: 'b', stamp: undefined },
      { id: 'a', stamp: stamp(9) },
    ]

    // A caller reaching this has an entity whose creating register has not
    // arrived — which every caller excludes from its list anyway. The arm is
    // here to keep the comparator total, not to sort such a row anywhere.
    expect([...rows].sort(byStampThenId).map((row) => row.id)).toEqual([
      'a',
      'b',
    ])
  })
})
