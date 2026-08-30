import { describe, expect, it } from 'vitest'
import { applyOp, emptyState, fold } from './reduce.ts'
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

// F2 (Task 1 review, round 1): the `entry_id` guard on all three handlers
// (`reduce.ts`'s `tripEntryAdded`, `tripEntryRemoved`, `tripEntryBringCountSet`)
// was untested — each starts `readString(op.payload, 'entry_id')`, bails
// unless `.kind === 'value'`, and none of that was pinned. A future refactor
// that collapses the four copies of this prologue (this one plus S9's
// `trip.entry_status_set`) into a helper could key a real Entry as `''`
// via something like `readString(...).value ?? ''` and nothing here would
// catch it without these tests.
describe('an unreadable entry_id leaves state untouched', () => {
  const OP_TYPES: { type: string; extra: Record<string, unknown> }[] = [
    {
      type: 'trip.entry_added',
      extra: { source: { from: 'depot', gear_id: 'g1' } },
    },
    { type: 'trip.entry_removed', extra: {} },
    { type: 'trip.entry_bring_count_set', extra: { count: 3 } },
  ]

  const BAD_ENTRY_IDS: { label: string; payload: Record<string, unknown> }[] = [
    { label: 'a missing entry_id', payload: {} },
    { label: 'an explicitly null entry_id', payload: { entry_id: null } },
    { label: 'a non-string entry_id', payload: { entry_id: 42 } },
  ]

  for (const { type, extra } of OP_TYPES) {
    describe(type, () => {
      for (const { label, payload } of BAD_ENTRY_IDS) {
        it(`returns the identical state for ${label}, creating no Entry`, () => {
          const initial = emptyState()
          const next = applyOp(initial, op(type, { ...payload, ...extra }))
          expect(next).toBe(initial)
          expect(next.trips['t1']).toBeUndefined()
        })
      }
    })
  }
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
