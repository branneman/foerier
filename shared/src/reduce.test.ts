import { describe, expect, it } from 'vitest'

import { formatHlc } from './hlc.ts'
import type { Aggregate, OpEnvelope } from './ops.ts'
import { applyOp, emptyState, fold } from './reduce.ts'

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

const at = (counter: number) => formatHlc({ ms: 1_700_000_000_000, counter })

let nextId = 0
function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

function op(
  aggregate: Aggregate,
  aggregateId: string,
  type: string,
  payload: Record<string, unknown>,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return {
    id: anId(),
    household_id: HOUSEHOLD,
    aggregate,
    aggregate_id: aggregateId,
    type,
    hlc,
    device_id: deviceId,
    payload,
  }
}

function placeOp(
  placeId: string,
  name: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('place', placeId, 'place.recorded', { name }, hlc, deviceId)
}

function placeRenameOp(
  placeId: string,
  name: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('place', placeId, 'place.renamed', { name }, hlc, deviceId)
}

function placeRemoveOp(
  placeId: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('place', placeId, 'place.removed', {}, hlc, deviceId)
}

function unknownOp(type: string): OpEnvelope {
  const aggregate = type.split('.')[0] as Aggregate
  return op(aggregate, 'x1', type, {}, at(1))
}

/** Freezes an object graph so any mutation at any depth throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

describe('applyOp', () => {
  it('leaves state identical when a write loses the comparison', () => {
    const seeded = fold([placeOp('p1', 'Attic', at(5))])
    const stale = applyOp(seeded, placeRenameOp('p1', 'Loft', at(2)))
    // Not merely equal — the same object. A late-arriving older op must not
    // invalidate a memo or re-render a list.
    expect(stale).toBe(seeded)
  })

  it('retains an unknown op type without folding it and without rejecting it', () => {
    const state = fold([
      unknownOp('trip.entry_status_set'),
      unknownOp('gear.weighed'),
    ])
    expect(state.unfolded).toEqual({
      count: 2,
      types: { 'trip.entry_status_set': 1, 'gear.weighed': 1 },
    })
    // Ignore is not discard: nothing else moved, and the caller still holds the
    // ops in its log for a later build to fold (sync-protocol §5.3, obligation 1).
    expect(state.places).toEqual({})
    expect(state.gear).toEqual({})
  })

  it('does not mutate the state it is given', () => {
    const before = fold([placeOp('p1', 'Attic', at(1))])

    // A deep freeze is the real witness. A JSON snapshot only catches a
    // mutation that changes the serialisation, and misses one to a nested
    // register object entirely. Under ES modules — always strict mode — a
    // write to a frozen object throws, so this fails on any mutation at any
    // depth. Purity is not tidiness here: Task 9's convergence tier asserts
    // that `apply` is commutative, associative and idempotent, and an impure
    // reducer would make that tier prove something weaker than it claims.
    deepFreeze(before)

    expect(() =>
      applyOp(before, placeRenameOp('p1', 'Loft', at(2))),
    ).not.toThrow()
    expect(() => applyOp(before, placeRemoveOp('p1', at(3)))).not.toThrow()
    expect(() => applyOp(before, unknownOp('gear.weighed'))).not.toThrow()
    // And a losing write, which takes the early-return path.
    expect(() =>
      applyOp(before, placeRenameOp('p1', 'Stale', at(0))),
    ).not.toThrow()
  })

  it('emptyState has no places, no gear, no people, and nothing unfolded', () => {
    const state = emptyState()
    expect(state.places).toEqual({})
    expect(state.gear).toEqual({})
    expect(state.people).toEqual({})
    expect(state.unfolded).toEqual({ count: 0, types: {} })
  })

  it('place.recorded creates the Place and seeds its name', () => {
    const state = fold([placeOp('p1', 'Attic', at(1))])
    expect(state.places['p1']?.id).toBe('p1')
    expect(state.places['p1']?.name?.value).toBe('Attic')
  })

  it('place.renamed sets the name', () => {
    const state = fold([
      placeOp('p1', 'Attic', at(1)),
      placeRenameOp('p1', 'Loft', at(2)),
    ])
    expect(state.places['p1']?.name?.value).toBe('Loft')
  })

  it('place.renamed on a Place no op has yet created still creates the register', () => {
    const state = fold([placeRenameOp('p1', 'Loft', at(1))])
    expect(state.places['p1']?.id).toBe('p1')
    expect(state.places['p1']?.name?.value).toBe('Loft')
  })

  it('place.removed sets the tombstone', () => {
    const state = fold([
      placeOp('p1', 'Attic', at(1)),
      placeRemoveOp('p1', at(2)),
    ])
    expect(state.places['p1']?.removed?.value).toBe(true)
  })

  it('a rename after a removal leaves the Place removed and renamed', () => {
    const state = fold([
      placeOp('p1', 'Attic', at(1)),
      placeRemoveOp('p1', at(2)),
      placeRenameOp('p1', 'Loft', at(3)),
    ])
    expect(state.places['p1']?.removed?.value).toBe(true)
    expect(state.places['p1']?.name?.value).toBe('Loft')
  })

  it('ignores an unknown payload field and folds the rest', () => {
    const state = fold([
      op(
        'place',
        'p1',
        'place.recorded',
        { name: 'Attic', color: 'red' },
        at(1),
      ),
    ])
    expect(state.places['p1']?.name?.value).toBe('Attic')
  })

  it('ignores a malformed name rather than coercing it', () => {
    const before = emptyState()
    const state = applyOp(
      before,
      op('place', 'p1', 'place.recorded', { name: 42 }, at(1)),
    )
    // Nothing was actually written, so nothing is fabricated either — not
    // even an empty Place — and the identical state comes back.
    expect(state).toBe(before)
    expect(state.places['p1']).toBeUndefined()
  })

  it('folding the whole log onto empty state reproduces the state exactly', () => {
    const ops = [
      placeOp('p1', 'Attic', at(1)),
      placeRenameOp('p1', 'Loft', at(2)),
      placeOp('p2', 'Garage', at(3)),
      placeRemoveOp('p1', at(4)),
    ]
    const fromScratch = fold(ops)
    const snapshot = fold(ops.slice(0, 2))
    const resumed = fold(ops.slice(2), snapshot)
    expect(resumed).toEqual(fromScratch)
  })

  it('fold is order-independent for two ops on different registers', () => {
    const rename = placeRenameOp('p1', 'Loft', at(1))
    const remove = placeRemoveOp('p1', at(2))
    const forward = fold([rename, remove])
    const backward = fold([remove, rename])
    expect(forward).toEqual(backward)
  })
})
