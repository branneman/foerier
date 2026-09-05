import { describe, expect, it } from 'vitest'

import { aGear, anOp, aTrip, hlcAt } from '../../testUtils/index.ts'
import {
  gearRetired,
  tripContainerStageSet,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripEntryRemoved,
  tripEntryStatusSet,
  type OpSpec,
} from '../authoring.ts'
import type { OpEnvelope } from '../ops.ts'
import { fold } from '../reduce.ts'
import type { HouseholdState, EntryState, TripState } from '../state.ts'
import { entriesOf, entryLabel } from './entry.ts'
import { stageOf, statusOf } from './packing.ts'
import { tripContainmentView, tripPath } from './tripContainment.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'
const DEV_B = 'bbbbbbbb-0000-7000-8000-000000000002'

const TRIP = '50000000-0000-7000-8000-0000000000ff'

/** Stamps a batch of specs with one `(hlc, deviceId)`; the shape every fixture starts from. */
function at(
  specs: readonly OpSpec[],
  counter: number,
  deviceId = DEV_A,
): OpEnvelope[] {
  return specs.map((s) => anOp(s, { hlc: hlcAt(counter), deviceId }))
}

/** One spec, stamped. */
function one(spec: OpSpec, counter: number, deviceId = DEV_A): OpEnvelope {
  return anOp(spec, { hlc: hlcAt(counter), deviceId })
}

function tripOf(state: HouseholdState): TripState {
  const trip = state.trips[TRIP]
  if (trip === undefined) throw new Error(`the fold holds no Trip ${TRIP}`)
  return trip
}

function entryOf(state: HouseholdState, entryId: string): EntryState {
  const entry = tripOf(state).entries?.[entryId]
  if (entry === undefined) throw new Error(`the fold holds no Entry ${entryId}`)
  return entry
}

function viewOf(state: HouseholdState) {
  return tripContainmentView(tripOf(state), state)
}

/** The labels `entriesOf` draws, in the order it draws them. */
function entriesOfLabels(state: HouseholdState): string[] {
  return entriesOf(tripOf(state), state).map((entry) =>
    entryLabel(entry, state),
  )
}

/** A container Entry and the Gear it references, as one stamped batch. */
function aContainerEntry(
  gearId: string,
  entryId: string,
  name: string,
  counter: number,
): OpEnvelope[] {
  return [
    ...at(aGear({ id: gearId, name, container: true }), counter),
    one(tripEntryAdded(TRIP, entryId, { from: 'depot', gearId }), counter),
  ]
}

/** A plain, non-container Entry and its Gear. */
function anEntry(
  gearId: string,
  entryId: string,
  name: string,
  counter: number,
): OpEnvelope[] {
  return [
    ...at(aGear({ id: gearId, name }), counter),
    one(tripEntryAdded(TRIP, entryId, { from: 'depot', gearId }), counter),
  ]
}

const theTrip = at(aTrip({ id: TRIP, name: 'Ardennes' }), 1)

describe('tripContainmentView', () => {
  it('holderOf reads the trip residence register for a well-formed pointer', () => {
    const ops = [
      ...theTrip,
      ...aContainerEntry('g-crate', 'e-crate', 'Crate B', 2),
      ...anEntry('g-stove', 'e-stove', 'Stove', 3),
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-crate' }), 4), // prettier-ignore
    ]

    const view = viewOf(fold(ops))

    expect(view.holderOf('e-stove')).toEqual({
      kind: 'container',
      entryId: 'e-crate',
    })
    // The container itself was never moved, so it is loose.
    expect(view.holderOf('e-crate')).toEqual({ kind: 'loose' })
    expect(view.brokenEdges.size).toBe(0)
  })

  it('an Entry never addressed by a move, and one moved to loose, both read loose', () => {
    const ops = [
      ...theTrip,
      ...anEntry('g-stove', 'e-stove', 'Stove', 2),
      ...anEntry('g-axe', 'e-axe', 'Axe', 3),
      one(tripEntryMoved(TRIP, 'e-axe', { in: 'loose' }), 4),
    ]

    const view = viewOf(fold(ops))

    expect(view.holderOf('e-stove')).toEqual({ kind: 'loose' })
    expect(view.holderOf('e-axe')).toEqual({ kind: 'loose' })
    expect(view.childrenOf({ kind: 'loose' })).toEqual(['e-axe', 'e-stove'])
  })
})

describe('the four loose-reasons', () => {
  it('reads a pointer at an Entry this replica has not folded as loose', () => {
    const ops = [
      ...theTrip,
      ...anEntry('g-stove', 'e-stove', 'Stove', 2),
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'never-arrived' }), 3), // prettier-ignore
    ]
    const state = fold(ops)

    expect(Object.hasOwn(tripOf(state).entries ?? {}, 'never-arrived')).toBe(
      false,
    )
    expect(viewOf(state).holderOf('e-stove')).toEqual({ kind: 'loose' })
    // And it is not a cycle break: reasons 1–3 are pointers into something the
    // reader cannot see, not edges the selector chose to cut.
    expect(viewOf(state).brokenEdges.has('e-stove')).toBe(false)
  })

  it('reads a pointer at a removed Entry as loose, permanently, without cascading', () => {
    // `trip.entry_removed` has no restore — unlike `place.removed` and
    // `gear.retired`, which both have one — so this is permanent rather than
    // recoverable. It still reads loose rather than vanishing.
    const ops = [
      ...theTrip,
      ...aContainerEntry('g-crate', 'e-crate', 'Crate B', 2),
      ...anEntry('g-stove', 'e-stove', 'Stove', 3),
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-crate' }), 4), // prettier-ignore
      one(tripEntryRemoved(TRIP, 'e-crate'), 5),
    ]
    const state = fold(ops)

    expect(viewOf(state).holderOf('e-stove')).toEqual({ kind: 'loose' })
    // Nothing was cascaded: the residence register still names the removed
    // Entry (§3.5, invariant 4).
    expect(entryOf(state, 'e-stove').residence?.value).toEqual({
      in: 'container',
      entryId: 'e-crate',
    })
  })

  it('reads a pointer at a sourceless Entry as loose', () => {
    // `trip.entry_bring_count_set` creates the Entry on sight, so an Entry
    // with no `source` is reachable and already excluded from `entriesOf`. A
    // pointer into something the reader cannot see is a pointer nobody can
    // settle.
    const ops = [
      ...theTrip,
      one(tripEntryBringCountSet(TRIP, 'e-ghost', 2), 2),
      ...anEntry('g-stove', 'e-stove', 'Stove', 3),
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-ghost' }), 4), // prettier-ignore
    ]
    const state = fold(ops)

    expect(entryOf(state, 'e-ghost').source).toBeUndefined()
    expect(viewOf(state).holderOf('e-stove')).toEqual({ kind: 'loose' })
    // The sourceless Entry is itself outside the tree entirely.
    expect(viewOf(state).childrenOf({ kind: 'loose' })).toEqual(['e-stove'])
  })

  it('reads a pointer at a non-container Entry as loose', () => {
    const ops = [
      ...theTrip,
      ...anEntry('g-lamp', 'e-lamp', 'Headlamp', 2),
      ...anEntry('g-stove', 'e-stove', 'Stove', 3),
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-lamp' }), 4), // prettier-ignore
    ]

    expect(viewOf(fold(ops)).holderOf('e-stove')).toEqual({ kind: 'loose' })
  })

  it('keeps resolving a pointer at a container whose Gear has been retired', () => {
    // `containment.ts`'s reason 2 makes retired Gear an invalid *home* holder.
    // There is deliberately no trip twin: retirement says the household no
    // longer keeps the thing in the depot, and says nothing about whether the
    // duffel already packed for Saturday still holds the stove. Spec §3.2
    // lists three pointer reasons and retirement is not among them, so this
    // test exists to stop a later "fix" cutting live edges mid-pack-out.
    const ops = [
      ...theTrip,
      ...aContainerEntry('g-crate', 'e-crate', 'Crate B', 2),
      ...anEntry('g-stove', 'e-stove', 'Stove', 3),
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-crate' }), 4), // prettier-ignore
      one(gearRetired('g-crate'), 5),
    ]
    const state = fold(ops)

    expect(state.gear['g-crate']?.retired?.value).toBe(true)
    expect(viewOf(state).holderOf('e-stove')).toEqual({
      kind: 'container',
      entryId: 'e-crate',
    })
    expect(viewOf(state).brokenEdges.size).toBe(0)
  })

  it("reads a pointer at a trip-only container through isContainerEntry's trip-only half", () => {
    // A trip-only Entry carries the containment trait on its own `source`, so
    // a call site re-deriving `state.gear[…]?.container === true` would read
    // this holder as a non-container and cut a live edge.
    const ops = [
      ...theTrip,
      one(tripEntryAdded(TRIP, 'e-box', { from: 'trip_only', name: 'Borrowed box', container: true }), 2), // prettier-ignore
      ...anEntry('g-stove', 'e-stove', 'Stove', 3),
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-box' }), 4), // prettier-ignore
    ]

    expect(viewOf(fold(ops)).holderOf('e-stove')).toEqual({
      kind: 'container',
      entryId: 'e-box',
    })
  })
})

describe('the cycle break', () => {
  it('breaks the edge with the lowest (hlc, device_id), identically on both replicas', () => {
    // Two Devices, apart: A puts X into Y, B puts Y into X. Per-field LWW
    // cannot prevent it — the two ops write two different registers.
    const setup = [
      ...theTrip,
      ...aContainerEntry('g-x', 'e-x', 'Crate X', 2),
      ...aContainerEntry('g-y', 'e-y', 'Crate Y', 3),
    ]
    const intoY = one(tripEntryMoved(TRIP, 'e-x', { in: 'container', entryId: 'e-y' }), 10, DEV_A) // prettier-ignore
    const intoX = one(tripEntryMoved(TRIP, 'e-y', { in: 'container', entryId: 'e-x' }), 20, DEV_B) // prettier-ignore

    const ab = viewOf(fold([...setup, intoY, intoX]))
    const ba = viewOf(fold([...setup, intoX, intoY]))

    expect([...ab.brokenEdges]).toEqual(['e-x'])
    expect([...ba.brokenEdges]).toEqual(['e-x'])
    expect(ab.holderOf('e-x')).toEqual({ kind: 'loose' })
    expect(ba.holderOf('e-x')).toEqual({ kind: 'loose' })
    expect(ab.holderOf('e-y')).toEqual({ kind: 'container', entryId: 'e-x' })
    expect(ba.holderOf('e-y')).toEqual({ kind: 'container', entryId: 'e-x' })
  })

  it('uses the entry id as a canonical final tiebreak on equal stamps', () => {
    // Three edges at one identical `(hlc, device_id)` — which a well-behaved
    // device never writes but a hand-rolled or replayed log can. The walk
    // enters the cycle at `z-2`, so "first one seen wins" would break `z-2`;
    // the canonical tiebreak breaks the lowest id instead.
    const ops = [
      ...theTrip,
      ...anEntry('g-leaf', 'a-leaf', 'Stove', 2),
      ...aContainerEntry('g-1', 'z-1', 'Crate One', 3),
      ...aContainerEntry('g-2', 'z-2', 'Crate Two', 4),
      one(tripEntryMoved(TRIP, 'a-leaf', { in: 'container', entryId: 'z-2' }), 50, DEV_B), // prettier-ignore
      one(tripEntryMoved(TRIP, 'z-2', { in: 'container', entryId: 'z-1' }), 50, DEV_B), // prettier-ignore
      one(tripEntryMoved(TRIP, 'z-1', { in: 'container', entryId: 'z-2' }), 50, DEV_B), // prettier-ignore
    ]

    const view = viewOf(fold(ops))

    expect([...view.brokenEdges]).toEqual(['z-1'])
    expect(view.holderOf('z-1')).toEqual({ kind: 'loose' })
    expect(view.holderOf('z-2')).toEqual({ kind: 'container', entryId: 'z-1' })
    expect(view.holderOf('a-leaf')).toEqual({
      kind: 'container',
      entryId: 'z-2',
    })
  })

  it('catches a self-reference as a one-node cycle', () => {
    const ops = [
      ...theTrip,
      ...aContainerEntry('g-crate', 'e-crate', 'Crate B', 2),
      one(tripEntryMoved(TRIP, 'e-crate', { in: 'container', entryId: 'e-crate' }), 3), // prettier-ignore
    ]

    const view = viewOf(fold(ops))

    expect([...view.brokenEdges]).toEqual(['e-crate'])
    expect(view.holderOf('e-crate')).toEqual({ kind: 'loose' })
  })

  it('breaks a three-node cycle at exactly one edge', () => {
    const ops = [
      ...theTrip,
      ...aContainerEntry('g-a', 'e-a', 'Crate A', 2),
      ...aContainerEntry('g-b', 'e-b', 'Crate B', 3),
      ...aContainerEntry('g-c', 'e-c', 'Crate C', 4),
      one(tripEntryMoved(TRIP, 'e-a', { in: 'container', entryId: 'e-b' }), 20), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-b', { in: 'container', entryId: 'e-c' }), 21, DEV_B), // prettier-ignore
      // The lowest-stamped edge of the three.
      one(tripEntryMoved(TRIP, 'e-c', { in: 'container', entryId: 'e-a' }), 12, DEV_B), // prettier-ignore
    ]

    const view = viewOf(fold(ops))

    expect([...view.brokenEdges]).toEqual(['e-c'])
    expect(view.holderOf('e-c')).toEqual({ kind: 'loose' })
    expect(view.holderOf('e-a')).toEqual({ kind: 'container', entryId: 'e-b' })
    expect(view.holderOf('e-b')).toEqual({ kind: 'container', entryId: 'e-c' })
  })

  it('breaks two disjoint cycles independently', () => {
    const ops = [
      ...theTrip,
      ...aContainerEntry('g-a', 'e-a', 'Crate A', 2),
      ...aContainerEntry('g-b', 'e-b', 'Crate B', 3),
      ...aContainerEntry('g-c', 'e-c', 'Crate C', 4),
      ...aContainerEntry('g-d', 'e-d', 'Crate D', 5),
      // Cycle one: a ⇄ b, lowest edge is b → a.
      one(tripEntryMoved(TRIP, 'e-a', { in: 'container', entryId: 'e-b' }), 30), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-b', { in: 'container', entryId: 'e-a' }), 20, DEV_B), // prettier-ignore
      // Cycle two: c ⇄ d, lowest edge is c → d.
      one(tripEntryMoved(TRIP, 'e-c', { in: 'container', entryId: 'e-d' }), 25), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-d', { in: 'container', entryId: 'e-c' }), 31, DEV_B), // prettier-ignore
    ]

    const view = viewOf(fold(ops))

    expect([...view.brokenEdges].sort()).toEqual(['e-b', 'e-c'])
    expect(view.holderOf('e-b')).toEqual({ kind: 'loose' })
    expect(view.holderOf('e-c')).toEqual({ kind: 'loose' })
    expect(view.holderOf('e-a')).toEqual({ kind: 'container', entryId: 'e-b' })
    expect(view.holderOf('e-d')).toEqual({ kind: 'container', entryId: 'e-c' })
  })
})

describe('replica determinism', () => {
  it('returns childrenOf sorted by entry id, not by the label order entriesOf draws', () => {
    // The ids run counter to the labels, so this pins the sort to the id
    // rather than to insertion order or to `entriesOf`'s label order.
    const ops = [
      ...theTrip,
      ...aContainerEntry('g-crate', 'e-crate', 'Crate B', 2),
      ...anEntry('g-3', 'e-1', 'Zebra blanket', 3),
      ...anEntry('g-2', 'e-2', 'Mallet', 4),
      ...anEntry('g-1', 'e-3', 'Aardvark suit', 5),
      one(tripEntryMoved(TRIP, 'e-1', { in: 'container', entryId: 'e-crate' }), 6), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-2', { in: 'container', entryId: 'e-crate' }), 7), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-3', { in: 'container', entryId: 'e-crate' }), 8), // prettier-ignore
    ]
    const state = fold(ops)

    // Precondition: the drawn order really is the other one, so the assertion
    // below is not vacuous.
    expect(entriesOfLabels(state).slice(0, 3)).toEqual([
      'Aardvark suit',
      'Crate B',
      'Mallet',
    ])

    expect(viewOf(state).childrenOf({ kind: 'container', entryId: 'e-crate' })).toEqual(['e-1', 'e-2', 'e-3']) // prettier-ignore
    expect(viewOf(state).childrenOf({ kind: 'loose' })).toEqual(['e-crate'])
  })

  it('traverses sorted entry ids, so two arrival orders give one tree', () => {
    // `Object.keys` is insertion order, which two replicas that received the
    // same ops in a different order do not share. The convergence tier cannot
    // see this: it compares folded state, and this runs downstream.
    const ops = [
      ...theTrip,
      ...aContainerEntry('g-m', 'e-m', 'Crate M', 2),
      ...aContainerEntry('g-n', 'e-n', 'Crate N', 3),
      ...aContainerEntry('g-p', 'e-p', 'Crate P', 4),
      ...aContainerEntry('g-q', 'e-q', 'Crate Q', 5),
      ...aContainerEntry('g-r', 'e-r', 'Crate R', 6),
      ...anEntry('g-loose', 'e-loose', 'Loose thing', 7),
      // An ordinary two-node cycle.
      one(tripEntryMoved(TRIP, 'e-m', { in: 'container', entryId: 'e-n' }), 40), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-n', { in: 'container', entryId: 'e-m' }), 41, DEV_B), // prettier-ignore
      // A three-node cycle whose three edges carry the *same* stamp:
      // `compareStamps` calls all three equal, so a "first one seen wins"
      // minimum would depend on where the walk entered the cycle — i.e. on
      // insertion order.
      one(tripEntryMoved(TRIP, 'e-p', { in: 'container', entryId: 'e-q' }), 50, DEV_B), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-q', { in: 'container', entryId: 'e-r' }), 50, DEV_B), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-r', { in: 'container', entryId: 'e-p' }), 50, DEV_B), // prettier-ignore
    ]

    const forwards = fold(ops)
    const backwards = fold([...ops].reverse())

    // Precondition: the fold itself is order-independent. If this fails, the
    // rest of the test is measuring the wrong thing.
    expect(backwards).toEqual(forwards)

    const a = viewOf(forwards)
    const b = viewOf(backwards)

    const ids = Object.keys(tripOf(forwards).entries ?? {}).sort()
    for (const entryId of ids) {
      expect(b.holderOf(entryId)).toEqual(a.holderOf(entryId))
      // Not just the same holder: the same *list*, in the same order. An
      // unsorted traversal agrees on the first and disagrees on the second,
      // and the second is what a device renders.
      expect(b.childrenOf({ kind: 'container', entryId })).toEqual(
        a.childrenOf({ kind: 'container', entryId }),
      )
    }
    expect(b.childrenOf({ kind: 'loose' })).toEqual(
      a.childrenOf({ kind: 'loose' }),
    )
    expect([...b.brokenEdges].sort()).toEqual([...a.brokenEdges].sort())
    // Both cycles were found and broken; the fixture is not vacuous.
    expect(a.brokenEdges.size).toBe(2)
  })
})

describe('a container move moves its contents through the pointer', () => {
  it('leaves every content status untouched (invariant 12)', () => {
    const before = fold([
      ...theTrip,
      ...aContainerEntry('g-crate', 'e-crate', 'Crate B', 2),
      ...anEntry('g-stove', 'e-stove', 'Stove', 3),
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-crate' }), 4), // prettier-ignore
      one(tripEntryStatusSet(TRIP, 'e-stove', 'not_packed'), 5),
    ])
    const after = fold(
      [one(tripContainerStageSet(TRIP, 'e-crate', 'car'), 9)],
      before,
    )

    // The stove's holder did not change; the holder's stage did.
    expect(viewOf(after).holderOf('e-stove')).toEqual({
      kind: 'container',
      entryId: 'e-crate',
    })
    expect(stageOf(entryOf(after, 'e-crate'), after)).toBe('car')
    expect(statusOf(entryOf(after, 'e-stove'), after)).toBe('not_packed')
  })

  it('carries a nested subtree with one op', () => {
    // duffel → crate → stove: moving the duffel moves all three, and the
    // reducer wrote exactly one register.
    const before = fold([
      ...theTrip,
      ...aContainerEntry('g-duffel', 'e-duffel', 'Duffel 90 L', 2),
      ...aContainerEntry('g-crate', 'e-crate', 'Crate B', 3),
      ...anEntry('g-stove', 'e-stove', 'Stove', 4),
      one(tripEntryMoved(TRIP, 'e-crate', { in: 'container', entryId: 'e-duffel' }), 5), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-crate' }), 6), // prettier-ignore
    ])
    const after = fold(
      [one(tripContainerStageSet(TRIP, 'e-duffel', 'car'), 9)],
      before,
    )

    expect(viewOf(after).holderOf('e-crate')).toEqual({
      kind: 'container',
      entryId: 'e-duffel',
    })
    expect(viewOf(after).holderOf('e-stove')).toEqual({
      kind: 'container',
      entryId: 'e-crate',
    })
    // One register written, on the duffel alone.
    expect(entryOf(after, 'e-duffel').stage?.value).toBe('car')
    expect(entryOf(after, 'e-crate').stage).toBeUndefined()
    expect(entryOf(after, 'e-stove').status).toBeUndefined()
  })
  it('carries a nested subtree with one trip.entry_moved — story 10, the headline claim', () => {
    // The block's own title: duffel → crate → stove, and the duffel moves
    // into the trailer. One op, one register, and all three things move,
    // because containment is a pointer held by the contained thing and the
    // contents already point at the duffel.
    const before = fold([
      ...theTrip,
      ...aContainerEntry('g-trailer', 'e-trailer', 'Trailer', 2),
      ...aContainerEntry('g-duffel', 'e-duffel', 'Duffel 90 L', 3),
      ...aContainerEntry('g-crate', 'e-crate', 'Crate B', 4),
      ...anEntry('g-stove', 'e-stove', 'Stove', 5),
      one(tripEntryMoved(TRIP, 'e-crate', { in: 'container', entryId: 'e-duffel' }), 6), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-crate' }), 7), // prettier-ignore
    ])

    expect(tripPath(tripOf(before), before, 'e-stove')).toEqual([
      { entryId: 'e-duffel', name: 'Duffel 90 L' },
      { entryId: 'e-crate', name: 'Crate B' },
    ])

    const after = fold(
      [one(tripEntryMoved(TRIP, 'e-duffel', { in: 'container', entryId: 'e-trailer' }), 9)], // prettier-ignore
      before,
    )

    // Every descendant gained the new ancestor, outermost first.
    expect(tripPath(tripOf(after), after, 'e-stove')).toEqual([
      { entryId: 'e-trailer', name: 'Trailer' },
      { entryId: 'e-duffel', name: 'Duffel 90 L' },
      { entryId: 'e-crate', name: 'Crate B' },
    ])
    expect(tripPath(tripOf(after), after, 'e-crate')).toEqual([
      { entryId: 'e-trailer', name: 'Trailer' },
      { entryId: 'e-duffel', name: 'Duffel 90 L' },
    ])
    // One register written, on the duffel alone — nothing fanned out.
    expect(entryOf(after, 'e-duffel').residence?.value).toEqual({
      in: 'container',
      entryId: 'e-trailer',
    })
    expect(entryOf(after, 'e-crate').residence?.value).toEqual({
      in: 'container',
      entryId: 'e-duffel',
    })
    expect(entryOf(after, 'e-stove').residence?.value).toEqual({
      in: 'container',
      entryId: 'e-crate',
    })
  })
})

describe('tripPath', () => {
  const nested = fold([
    ...theTrip,
    ...aContainerEntry('g-duffel', 'e-duffel', 'Duffel 90 L', 2),
    ...aContainerEntry('g-crate', 'e-crate', 'Crate B', 3),
    ...anEntry('g-stove', 'e-stove', 'Stove', 4),
    one(tripEntryMoved(TRIP, 'e-crate', { in: 'container', entryId: 'e-duffel' }), 5), // prettier-ignore
    one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-crate' }), 6), // prettier-ignore
  ])

  it('lists ancestors outermost first, the gear itself not a segment', () => {
    expect(tripPath(tripOf(nested), nested, 'e-stove')).toEqual([
      { entryId: 'e-duffel', name: 'Duffel 90 L' },
      { entryId: 'e-crate', name: 'Crate B' },
    ])
    expect(
      tripPath(tripOf(nested), nested, 'e-stove').map((s) => s.name),
    ).toEqual(['Duffel 90 L', 'Crate B'])
  })

  it('gives a loose Entry an empty path', () => {
    // Never addressed by a move, explicitly loose, and an id no op created:
    // all three empty.
    const state = fold([
      ...theTrip,
      ...anEntry('g-stove', 'e-stove', 'Stove', 2),
      ...anEntry('g-axe', 'e-axe', 'Axe', 3),
      one(tripEntryMoved(TRIP, 'e-axe', { in: 'loose' }), 4),
    ])

    expect(tripPath(tripOf(state), state, 'e-stove')).toEqual([])
    expect(tripPath(tripOf(state), state, 'e-axe')).toEqual([])
    expect(tripPath(tripOf(state), state, 'never-added')).toEqual([])
  })

  it('names a trip-only container by its own name, and an unnamed one by the glyph', () => {
    const state = fold([
      ...theTrip,
      one(tripEntryAdded(TRIP, 'e-box', { from: 'trip_only', name: '', container: true }), 2), // prettier-ignore
      ...anEntry('g-stove', 'e-stove', 'Stove', 3),
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-box' }), 4), // prettier-ignore
    ])

    expect(tripPath(tripOf(state), state, 'e-stove')).toEqual([
      { entryId: 'e-box', name: '—' },
    ])
  })

  it('reuses a passed-in view rather than rebuilding one', () => {
    const view = tripContainmentView(tripOf(nested), nested)

    expect(tripPath(tripOf(nested), nested, 'e-stove', view)).toEqual(
      tripPath(tripOf(nested), nested, 'e-stove'),
    )
  })

  it('terminates on an inconsistent view rather than looping', () => {
    // A hand-made view whose holders form a cycle no cycle break ever touched
    // — the guard has to be `tripPath`'s own, not a property of the view it
    // was handed.
    const looping = {
      holderOf: (entryId: string) =>
        entryId === 'e-duffel'
          ? ({ kind: 'container', entryId: 'e-crate' } as const)
          : ({ kind: 'container', entryId: 'e-duffel' } as const),
      childrenOf: () => [],
      // `tripPath` never asks; the field is here because the interface has it.
      resolveResidence: () => ({ kind: 'loose' }) as const,
      brokenEdges: new Set<string>(),
    }

    expect(tripPath(tripOf(nested), nested, 'e-stove', looping)).toEqual([
      { entryId: 'e-crate', name: 'Crate B' },
      { entryId: 'e-duffel', name: 'Duffel 90 L' },
    ])
  })

  it('stops at the broken edge of a cycle rather than looping forever', () => {
    const state = fold([
      ...theTrip,
      ...aContainerEntry('g-x', 'e-x', 'Crate X', 2),
      ...aContainerEntry('g-y', 'e-y', 'Crate Y', 3),
      ...anEntry('g-stove', 'e-stove', 'Stove', 4),
      one(tripEntryMoved(TRIP, 'e-x', { in: 'container', entryId: 'e-y' }), 10), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-y', { in: 'container', entryId: 'e-x' }), 11, DEV_B), // prettier-ignore
      one(tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-x' }), 12), // prettier-ignore
    ])

    // e-x → e-y is the lowest-stamped edge, so it is the one broken.
    expect(tripPath(tripOf(state), state, 'e-x')).toEqual([])
    expect(tripPath(tripOf(state), state, 'e-y')).toEqual([
      { entryId: 'e-x', name: 'Crate X' },
    ])
    expect(tripPath(tripOf(state), state, 'e-stove')).toEqual([
      { entryId: 'e-x', name: 'Crate X' },
    ])
  })
})
