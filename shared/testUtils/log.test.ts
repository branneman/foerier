import { describe, expect, it } from 'vitest'

import { parseHlc } from '../src/hlc.ts'
import { phaseOf } from '../src/selectors/trip.ts'
import { aGear, aTrip } from './factories.ts'
import { depot, foldAt, stamp } from './log.ts'

/**
 * The stamper the selector suites share. Its whole contract is that **each
 * spec gets its own, increasing counter**, and the reason is a bug S5 shipped
 * and caught: a helper that stamped one HLC across a multi-op factory
 * produced Draft Trips where the author had written `phase: 'pack_out'`,
 * because `trip.phase_moved` sharing `trip.created`'s exact stamp loses the
 * tie on `writeRegister`'s `<= 0` rule rather than moving the register.
 *
 * Every test here fails if that property goes, which is what makes this file
 * worth more than the five copies it replaces: the copies were correct and
 * pinned by nothing.
 */

const counters = (hlcs: readonly string[]): number[] =>
  hlcs.map((hlc) => parseHlc(hlc)!.counter)

describe('stamp', () => {
  it('gives each spec its own increasing counter', () => {
    const hlcs = stamp(aTrip({ phase: 'pack_out' })).map((op) => op.hlc)

    // Two ops, two counters — never one stamp shared across the pair.
    expect(hlcs).toHaveLength(2)
    expect(counters(hlcs)[1]).toBeGreaterThan(counters(hlcs)[0]!)
  })

  it('starts at the counter it is given', () => {
    const hlcs = stamp(aGear(), { start: 7 }).map((op) => op.hlc)

    expect(counters(hlcs)[0]).toBe(7)
  })

  it('stamps every op at the same millisecond, so only the counter orders them', () => {
    const ops = stamp(aTrip({ phase: 'pack_out' }), { ms: 1_800_000_000_000 })

    expect(ops.map((op) => parseHlc(op.hlc)!.ms)).toEqual([
      1_800_000_000_000, 1_800_000_000_000,
    ])
  })
})

describe('depot', () => {
  it('folds a multi-op factory so the later op wins its register', () => {
    // The S5 bug, as an assertion: a shared stamp folds this to `draft`.
    const state = depot(aTrip({ id: 't1', phase: 'pack_out' }))

    expect(phaseOf(state.trips['t1']!)).toBe('pack_out')
  })

  it('folds several factories in the order they are given', () => {
    const state = depot(
      aTrip({ id: 't1', name: 'first' }),
      aTrip({ id: 't1', name: 'second' }),
    )

    expect(state.trips['t1']?.name?.value).toBe('second')
  })
})

describe('foldAt', () => {
  it('folds at the millisecond it is given, so two folds can be ordered in time', () => {
    const earlier = foldAt(1_700_000_000_000, [aTrip({ id: 't1' })])
    const later = foldAt(1_800_000_000_000, [aTrip({ id: 't1' })])

    const at = (state: typeof earlier): number =>
      parseHlc(state.trips['t1']!.name!.hlc)!.ms

    expect(at(later)).toBeGreaterThan(at(earlier))
  })
})
