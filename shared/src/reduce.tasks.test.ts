import { describe, expect, it } from 'vitest'
import { fold } from './reduce.ts'
import type { OpEnvelope } from './ops.ts'

/**
 * S13, spec §1. The `tasks.<task_id>` row of sync §3.7 — the sixth entity
 * writer, and the second of the Trip's three nested maps to be built.
 */
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

describe('trip.task_added', () => {
  it('creates the Pre-trip task and seeds its text', () => {
    const state = fold([
      op('trip.task_added', { task_id: 'k1', text: 'Charge the devices' }),
    ])
    expect(state.trips['t1']?.tasks?.['k1']?.text?.value).toBe(
      'Charge the devices',
    )
  })

  it('leaves `ticked` unwritten — a new task is unticked by absence', () => {
    const state = fold([
      op('trip.task_added', { task_id: 'k1', text: 'Charge the devices' }),
    ])
    expect(state.trips['t1']?.tasks?.['k1']?.ticked).toBeUndefined()
  })

  it('creates the Trip, as any Trip op does', () => {
    const state = fold([op('trip.task_added', { task_id: 'k1', text: 'Go' })])
    expect(state.trips['t1']).toBeDefined()
  })

  it('writes nothing at all when `task_id` is missing', () => {
    const state = fold([op('trip.task_added', { text: 'Charge the devices' })])
    expect(state.trips['t1']).toBeUndefined()
  })

  it('writes no text when `text` is missing, leaving a task no reader draws', () => {
    const state = fold([op('trip.task_added', { task_id: 'k1' })])
    expect(state.trips['t1']?.tasks?.['k1']).toBeUndefined()
  })
})

describe('trip.task_ticked', () => {
  it('sets `ticked` true', () => {
    const state = fold([
      op('trip.task_added', { task_id: 'k1', text: 'Go' }),
      op('trip.task_ticked', { task_id: 'k1', ticked: true }, '2'),
    ])
    expect(state.trips['t1']?.tasks?.['k1']?.ticked?.value).toBe(true)
  })

  it('sets `ticked` false — one op for both directions', () => {
    const state = fold([
      op('trip.task_added', { task_id: 'k1', text: 'Go' }),
      op('trip.task_ticked', { task_id: 'k1', ticked: true }, '2'),
      op('trip.task_ticked', { task_id: 'k1', ticked: false }, '3'),
    ])
    expect(state.trips['t1']?.tasks?.['k1']?.ticked?.value).toBe(false)
  })

  it('resolves two contested writes by plain LWW, not by arrival order', () => {
    const later = fold([
      op('trip.task_added', { task_id: 'k1', text: 'Go' }),
      op('trip.task_ticked', { task_id: 'k1', ticked: false }, '9'),
      op('trip.task_ticked', { task_id: 'k1', ticked: true }, '3'),
    ])
    expect(later.trips['t1']?.tasks?.['k1']?.ticked?.value).toBe(false)
  })

  it('folds ahead of the add that creates the task — spec §1', () => {
    const state = fold([
      op('trip.task_ticked', { task_id: 'k1', ticked: true }),
      op('trip.task_added', { task_id: 'k1', text: 'Go' }, '2'),
    ])
    const task = state.trips['t1']?.tasks?.['k1']
    expect(task?.ticked?.value).toBe(true)
    expect(task?.text?.value).toBe('Go')
  })

  it('creates a task holding `ticked` and no text when the add never comes', () => {
    const state = fold([
      op('trip.task_ticked', { task_id: 'k1', ticked: true }),
    ])
    const task = state.trips['t1']?.tasks?.['k1']
    expect(task?.ticked?.value).toBe(true)
    expect(task?.text).toBeUndefined()
  })

  it('writes nothing when `ticked` is not a boolean', () => {
    const state = fold([
      op('trip.task_added', { task_id: 'k1', text: 'Go' }),
      op('trip.task_ticked', { task_id: 'k1', ticked: 'yes' }, '2'),
    ])
    expect(state.trips['t1']?.tasks?.['k1']?.ticked).toBeUndefined()
  })

  it('writes nothing at all when `task_id` is missing', () => {
    const state = fold([op('trip.task_ticked', { ticked: true })])
    expect(state.trips['t1']).toBeUndefined()
  })
})

describe('the tasks map', () => {
  it('holds two tasks addressed separately, neither contesting the other', () => {
    const state = fold([
      op('trip.task_added', { task_id: 'k1', text: 'Charge the devices' }),
      op('trip.task_added', { task_id: 'k2', text: 'Buy the vignette' }, '2'),
    ])
    expect(Object.keys(state.trips['t1']?.tasks ?? {})).toHaveLength(2)
  })

  it('returns the identical state object when a losing write changes nothing', () => {
    const first = fold([
      op('trip.task_added', { task_id: 'k1', text: 'Go' }, '5'),
    ])
    const second = fold(
      [op('trip.task_added', { task_id: 'k1', text: 'Stop' }, '2')],
      first,
    )
    expect(second).toBe(first)
  })
})
