import { describe, expect, it } from 'vitest'
import { fold } from './reduce.ts'
import type { OpEnvelope } from './ops.ts'

function op(
  type: string,
  payload: Record<string, unknown>,
  hlc = '0000000000001-0000-a',
): OpEnvelope {
  return {
    id: `${type}-${hlc}`,
    household_id: 'h1',
    aggregate: 'trip',
    aggregate_id: 't1',
    type,
    hlc,
    device_id: 'd1',
    payload,
  }
}

describe('trip.entry_added', () => {
  it('folds a depot source, mapping gear_id to gearId', () => {
    const state = fold([
      op('trip.entry_added', {
        entry_id: 'e1',
        source: { from: 'depot', gear_id: 'g1' },
      }),
    ])
    expect(state.trips['t1']?.entries?.['e1']?.source?.value).toEqual({
      from: 'depot',
      gearId: 'g1',
    })
  })

  it('folds a trip-only source with its name and containment trait', () => {
    const state = fold([
      op('trip.entry_added', {
        entry_id: 'e1',
        source: { from: 'trip_only', name: 'Passports, all', container: false },
      }),
    ])
    expect(state.trips['t1']?.entries?.['e1']?.source?.value).toEqual({
      from: 'trip_only',
      name: 'Passports, all',
      container: false,
    })
  })

  it('creates the Entry but writes no source when `from` is unrecognised', () => {
    const state = fold([
      op('trip.entry_added', {
        entry_id: 'e1',
        source: { from: 'elsewhere', gear_id: 'g1' },
      }),
    ])
    const entry = state.trips['t1']?.entries?.['e1']
    expect(entry).toBeDefined()
    expect(entry?.source).toBeUndefined()
  })

  it('creates the Trip and the Entry when the creation has not arrived', () => {
    const state = fold([
      op('trip.entry_added', {
        entry_id: 'e1',
        source: { from: 'depot', gear_id: 'g1' },
      }),
    ])
    expect(state.trips['t1']).toBeDefined()
    expect(state.trips['t1']?.phase).toBeUndefined()
  })
})

describe('trip.entry_bring_count_set', () => {
  it('folds a count for any Entry — the Kind is on another aggregate', () => {
    const state = fold([
      op('trip.entry_bring_count_set', { entry_id: 'e1', count: 4 }),
    ])
    expect(state.trips['t1']?.entries?.['e1']?.bringCount?.value).toBe(4)
  })

  it('ignores a negative or non-integer count', () => {
    const state = fold([
      op('trip.entry_bring_count_set', { entry_id: 'e1', count: -1 }),
      op('trip.entry_bring_count_set', { entry_id: 'e2', count: 1.5 }),
    ])
    expect(state.trips['t1']?.entries?.['e1']?.bringCount).toBeUndefined()
    expect(state.trips['t1']?.entries?.['e2']?.bringCount).toBeUndefined()
  })
})

describe('trip.entry_removed', () => {
  it('sets the tombstone', () => {
    const state = fold([op('trip.entry_removed', { entry_id: 'e1' })])
    expect(state.trips['t1']?.entries?.['e1']?.removed?.value).toBe(true)
  })

  it('resolves add-versus-remove on one register by plain LWW', () => {
    const added = op(
      'trip.entry_added',
      { entry_id: 'e1', source: { from: 'depot', gear_id: 'g1' } },
      '0000000000002-0000-a',
    )
    const removed = op(
      'trip.entry_removed',
      { entry_id: 'e1' },
      '0000000000001-0000-a',
    )
    // The remove is strictly earlier, so it does not win by being a delete.
    const state = fold([added, removed])
    expect(state.trips['t1']?.entries?.['e1']?.removed?.value).toBe(true)
    expect(state.trips['t1']?.entries?.['e1']?.source?.value).toBeDefined()
  })
})

describe('the fold is order-independent', () => {
  it('reaches the same state from either op order', () => {
    const a = op(
      'trip.entry_added',
      { entry_id: 'e1', source: { from: 'depot', gear_id: 'g1' } },
      '0000000000002-0000-a',
    )
    const b = op(
      'trip.entry_bring_count_set',
      { entry_id: 'e1', count: 3 },
      '0000000000001-0000-a',
    )
    expect(fold([a, b])).toEqual(fold([b, a]))
  })
})
