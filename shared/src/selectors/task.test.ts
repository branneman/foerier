import { describe, expect, it } from 'vitest'

import { aTrip, depot, DEV_A, hlcAt, anOp } from '../../testUtils/index.ts'
import { tripTaskAdded, tripTaskTicked, type OpSpec } from '../authoring.ts'
import { emptyState, fold } from '../reduce.ts'
import type { HouseholdState, TripState } from '../state.ts'
import { taskCounts, taskTickedOf, tasksOf } from './task.ts'

const TRIP = 'trip-alps'

function trip(state: HouseholdState): TripState {
  return state.trips[TRIP]!
}

function texts(state: HouseholdState): readonly string[] {
  return tasksOf(trip(state)).map((t) => t.text)
}

/**
 * The two adds, stamped in the order given — so a test can hand the same two
 * ops to two replicas in opposite arrival order and compare what they draw.
 * Counters are explicit rather than positional for exactly that reason.
 */
function foldStamped(
  entries: readonly (readonly [OpSpec, number])[],
): HouseholdState {
  return fold(
    entries.map(([spec, counter]) =>
      anOp(spec, { hlc: hlcAt(counter), deviceId: DEV_A }),
    ),
    emptyState(),
  )
}

describe('tasksOf', () => {
  it('lists every task with its text and ticked state', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripTaskAdded(TRIP, 'k1', 'Charge the devices'),
      tripTaskTicked(TRIP, 'k1', true),
    ])
    expect(tasksOf(trip(state))).toEqual([
      { id: 'k1', text: 'Charge the devices', ticked: true },
    ])
  })

  it('is empty for a Trip no task op has ever addressed', () => {
    const state = depot(aTrip({ id: TRIP }))
    expect(tasksOf(trip(state))).toEqual([])
  })

  it('excludes a task with no text — folded, retained, drawn nowhere', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripTaskAdded(TRIP, 'k1', 'Charge the devices'),
      tripTaskTicked(TRIP, 'k2', true),
    ])
    expect(texts(state)).toEqual(['Charge the devices'])
  })

  /*
   * Every ordering case below gives the **earlier** task the **later** id, so
   * the id tie-break alone produces the opposite answer. Without that, a
   * comparator that ignored the stamp entirely still passed all of these — the
   * first draft of this file did, and the sort was neutralised to prove it.
   */
  it('orders by the creating stamp, oldest first, against the ids', () => {
    const state = foldStamped([
      [tripTaskAdded(TRIP, 'k1', 'Second'), 2],
      [tripTaskAdded(TRIP, 'k9', 'First'), 1],
    ])
    expect(texts(state)).toEqual(['First', 'Second'])
  })

  it('draws the same list on two replicas that received the adds in opposite order', () => {
    const forward = foldStamped([
      [tripTaskAdded(TRIP, 'k9', 'First'), 1],
      [tripTaskAdded(TRIP, 'k1', 'Second'), 2],
    ])
    const backward = foldStamped([
      [tripTaskAdded(TRIP, 'k1', 'Second'), 2],
      [tripTaskAdded(TRIP, 'k9', 'First'), 1],
    ])
    expect(texts(forward)).toEqual(['First', 'Second'])
    expect(texts(backward)).toEqual(texts(forward))
  })

  it('breaks a stamp tie by task id, so the order stays total', () => {
    const tie = (id: string, text: string): OpSpec =>
      tripTaskAdded(TRIP, id, text)
    const forward = fold(
      [
        anOp(tie('kb', 'Bee'), { hlc: hlcAt(1), deviceId: DEV_A }),
        anOp(tie('ka', 'Ay'), { hlc: hlcAt(1), deviceId: DEV_A }),
      ],
      emptyState(),
    )
    expect(texts(forward)).toEqual(['Ay', 'Bee'])
  })

  it('does not move a row when it is ticked — the tick writes no text stamp', () => {
    const after = depot(aTrip({ id: TRIP }), [
      tripTaskAdded(TRIP, 'k9', 'First'),
      tripTaskAdded(TRIP, 'k1', 'Second'),
      tripTaskTicked(TRIP, 'k9', true),
    ])
    expect(texts(after)).toEqual(['First', 'Second'])
  })
})

describe('taskTickedOf', () => {
  it('reads an absent register as not ticked', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripTaskAdded(TRIP, 'k1', 'Charge the devices'),
    ])
    expect(taskTickedOf(trip(state).tasks!['k1']!)).toBe(false)
  })

  it('reads an explicit false as not ticked', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripTaskAdded(TRIP, 'k1', 'Charge the devices'),
      tripTaskTicked(TRIP, 'k1', false),
    ])
    expect(taskTickedOf(trip(state).tasks!['k1']!)).toBe(false)
  })

  it('reads an explicit true as ticked', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripTaskAdded(TRIP, 'k1', 'Charge the devices'),
      tripTaskTicked(TRIP, 'k1', true),
    ])
    expect(taskTickedOf(trip(state).tasks!['k1']!)).toBe(true)
  })
})

describe('taskCounts', () => {
  it('counts nothing for a Trip with no tasks', () => {
    const state = depot(aTrip({ id: TRIP }))
    expect(taskCounts(trip(state))).toEqual({ total: 0, ticked: 0 })
  })

  it('counts the unticked in the total and not in the numerator', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripTaskAdded(TRIP, 'k1', 'One'),
      tripTaskAdded(TRIP, 'k2', 'Two'),
      tripTaskAdded(TRIP, 'k3', 'Three'),
      tripTaskTicked(TRIP, 'k1', true),
    ])
    expect(taskCounts(trip(state))).toEqual({ total: 3, ticked: 1 })
  })

  it('counts every task once they are all ticked', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripTaskAdded(TRIP, 'k1', 'One'),
      tripTaskAdded(TRIP, 'k2', 'Two'),
      tripTaskTicked(TRIP, 'k1', true),
      tripTaskTicked(TRIP, 'k2', true),
    ])
    expect(taskCounts(trip(state))).toEqual({ total: 2, ticked: 2 })
  })

  it('excludes a textless task from both counts, as `tasksOf` excludes it from the list', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripTaskAdded(TRIP, 'k1', 'One'),
      tripTaskTicked(TRIP, 'k2', true),
    ])
    expect(taskCounts(trip(state))).toEqual({ total: 1, ticked: 0 })
  })
})
