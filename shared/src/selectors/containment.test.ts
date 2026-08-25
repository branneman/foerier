import { describe, expect, it } from 'vitest'

import { aGear, anOp, aPlace, hlcAt } from '../../testUtils/index.ts'
import {
  gearRehomed,
  gearRetired,
  placeRemoved,
  type OpSpec,
} from '../authoring.ts'
import type { OpEnvelope } from '../ops.ts'
import { fold } from '../reduce.ts'
import { containmentView, homePath } from './containment.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'
const DEV_B = 'bbbbbbbb-0000-7000-8000-000000000002'

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

describe('containmentView', () => {
  it('holderOf reads the residence register for a well-formed pointer', () => {
    const ops = [
      ...at(aPlace({ id: 'attic', name: 'Attic' }), 1),
      ...at(aGear({ id: 'crate', name: 'Crate B', container: true }), 2),
      ...at(aGear({ id: 'tent', name: 'Tent' }), 3),
      one(gearRehomed('crate', { in: 'place', id: 'attic' }), 4),
      one(gearRehomed('tent', { in: 'gear', id: 'crate' }), 5),
    ]

    const view = containmentView(fold(ops))

    expect(view.holderOf('crate')).toEqual({ kind: 'place', id: 'attic' })
    expect(view.holderOf('tent')).toEqual({ kind: 'gear', id: 'crate' })
    expect(view.brokenEdges.size).toBe(0)
  })

  it('gear at a removed Place reads loose, and the Place is not cascaded', () => {
    const ops = [
      ...at(aPlace({ id: 'shed', name: 'Shed' }), 1),
      ...at(aGear({ id: 'axe', name: 'Axe' }), 2),
      one(gearRehomed('axe', { in: 'place', id: 'shed' }), 3),
      one(placeRemoved('shed'), 4),
    ]
    const state = fold(ops)

    expect(containmentView(state).holderOf('axe')).toEqual({ kind: 'loose' })

    // Nothing was cascaded: the residence register still names the removed
    // Place, so restoring it would restore the arrangement (§3.5, invariant 4).
    expect(state.gear['axe']?.residence?.value).toEqual({
      in: 'place',
      id: 'shed',
    })
    // And the break is not a cycle break.
    expect(containmentView(state).brokenEdges.has('axe')).toBe(false)
  })

  it('gear inside a retired Container reads loose', () => {
    const ops = [
      ...at(aGear({ id: 'crate', name: 'Crate B', container: true }), 1),
      ...at(aGear({ id: 'tent', name: 'Tent' }), 2),
      one(gearRehomed('tent', { in: 'gear', id: 'crate' }), 3),
      one(gearRetired('crate'), 4),
    ]
    const state = fold(ops)

    expect(containmentView(state).holderOf('tent')).toEqual({ kind: 'loose' })
    expect(state.gear['tent']?.residence?.value).toEqual({
      in: 'gear',
      id: 'crate',
    })
  })

  it('gear pointing at a non-container piece of gear reads loose', () => {
    // Invariant 2: only container-gear and places may be resided in.
    const ops = [
      ...at(aGear({ id: 'tent', name: 'Tent', container: false }), 1),
      ...at(aGear({ id: 'peg', name: 'Peg' }), 2),
      one(gearRehomed('peg', { in: 'gear', id: 'tent' }), 3),
    ]

    expect(containmentView(fold(ops)).holderOf('peg')).toEqual({
      kind: 'loose',
    })
  })

  it('gear pointing at a gear id that no op ever created reads loose', () => {
    const ops = [
      ...at(aGear({ id: 'peg', name: 'Peg' }), 1),
      one(gearRehomed('peg', { in: 'gear', id: 'never-recorded' }), 2),
    ]
    const state = fold(ops)

    expect(Object.hasOwn(state.gear, 'never-recorded')).toBe(false)
    expect(containmentView(state).holderOf('peg')).toEqual({ kind: 'loose' })
  })

  it('breaks a cycle at its lowest-stamped edge, identically on every replica', () => {
    // Device A moves crate X into Y; device B moves Y into X. The ops target
    // different aggregates, so LWW cannot prevent the cycle (sync-protocol §3.6).
    const ops = [
      ...aGear({ id: 'x', name: 'Crate X', container: true }),
      ...aGear({ id: 'y', name: 'Crate Y', container: true }),
    ].map((s) => anOp(s, { hlc: hlcAt(1), deviceId: DEV_A }))

    const xIntoY = anOp(gearRehomed('x', { in: 'gear', id: 'y' }), {
      hlc: hlcAt(10),
      deviceId: DEV_A,
    })
    const yIntoX = anOp(gearRehomed('y', { in: 'gear', id: 'x' }), {
      hlc: hlcAt(11),
      deviceId: DEV_B,
    })

    const forwards = containmentView(fold([...ops, xIntoY, yIntoX]))
    const backwards = containmentView(fold([...ops, yIntoX, xIntoY]))

    // The lower-stamped edge is x → y, so x reads loose and y still holds x's
    // former place in the tree.
    expect(forwards.holderOf('x')).toEqual({ kind: 'loose' })
    expect(forwards.brokenEdges.has('x')).toBe(true)
    expect(backwards.holderOf('x')).toEqual(forwards.holderOf('x'))
    expect(backwards.holderOf('y')).toEqual(forwards.holderOf('y'))
  })

  it('a three-node cycle breaks at exactly one edge', () => {
    const ops = [
      ...at(aGear({ id: 'a', name: 'Crate A', container: true }), 1),
      ...at(aGear({ id: 'b', name: 'Crate B', container: true }), 2),
      ...at(aGear({ id: 'c', name: 'Crate C', container: true }), 3),
      one(gearRehomed('a', { in: 'gear', id: 'b' }), 20),
      one(gearRehomed('b', { in: 'gear', id: 'c' }), 21, DEV_B),
      // The lowest-stamped edge of the three.
      one(gearRehomed('c', { in: 'gear', id: 'a' }), 12, DEV_B),
    ]

    const view = containmentView(fold(ops))

    expect([...view.brokenEdges]).toEqual(['c'])
    expect(view.holderOf('c')).toEqual({ kind: 'loose' })
    expect(view.holderOf('a')).toEqual({ kind: 'gear', id: 'b' })
    expect(view.holderOf('b')).toEqual({ kind: 'gear', id: 'c' })
  })

  it('two disjoint cycles each break independently', () => {
    const ops = [
      ...at(aGear({ id: 'a', name: 'Crate A', container: true }), 1),
      ...at(aGear({ id: 'b', name: 'Crate B', container: true }), 2),
      ...at(aGear({ id: 'c', name: 'Crate C', container: true }), 3),
      ...at(aGear({ id: 'd', name: 'Crate D', container: true }), 4),
      // Cycle one: a ⇄ b, lowest edge is b → a.
      one(gearRehomed('a', { in: 'gear', id: 'b' }), 30),
      one(gearRehomed('b', { in: 'gear', id: 'a' }), 20, DEV_B),
      // Cycle two: c ⇄ d, lowest edge is c → d.
      one(gearRehomed('c', { in: 'gear', id: 'd' }), 25),
      one(gearRehomed('d', { in: 'gear', id: 'c' }), 31, DEV_B),
    ]

    const view = containmentView(fold(ops))

    expect([...view.brokenEdges].sort()).toEqual(['b', 'c'])
    expect(view.holderOf('b')).toEqual({ kind: 'loose' })
    expect(view.holderOf('c')).toEqual({ kind: 'loose' })
    expect(view.holderOf('a')).toEqual({ kind: 'gear', id: 'b' })
    expect(view.holderOf('d')).toEqual({ kind: 'gear', id: 'c' })
  })

  it("childrenOf lists a container's contents in sorted order", () => {
    // Ids are recorded out of order and their names run counter to them, so
    // the assertion pins the sort to the id rather than to insertion order or
    // to the name (`childrenOf` returns ids; name-ordering is the caller's job,
    // where the names are in hand).
    const ops = [
      ...at(aGear({ id: 'crate', name: 'Crate B', container: true }), 1),
      ...at(aGear({ id: 'g-3', name: 'Aardvark suit' }), 2),
      ...at(aGear({ id: 'g-1', name: 'Zebra blanket' }), 3),
      ...at(aGear({ id: 'g-2', name: 'Mallet' }), 4),
      ...at(aPlace({ id: 'attic', name: 'Attic' }), 5),
      one(gearRehomed('crate', { in: 'place', id: 'attic' }), 6),
      one(gearRehomed('g-3', { in: 'gear', id: 'crate' }), 7),
      one(gearRehomed('g-1', { in: 'gear', id: 'crate' }), 8),
      one(gearRehomed('g-2', { in: 'gear', id: 'crate' }), 9),
    ]

    const view = containmentView(fold(ops))

    expect(view.childrenOf({ kind: 'gear', id: 'crate' })).toEqual([
      'g-1',
      'g-2',
      'g-3',
    ])
    expect(view.childrenOf({ kind: 'place', id: 'attic' })).toEqual(['crate'])
    expect(view.childrenOf({ kind: 'loose' })).toEqual([])
  })

  it('two replicas that received the same ops in different orders break the same edge', () => {
    // R13: the cycle break lives in a selector, downstream of the fold. Two
    // replicas can hold byte-identical folded state and still display different
    // trees if the selector's traversal order differs — and traversal order
    // follows insertion order unless the selector sorts. The convergence tier
    // asserts folded-state equality only, so this assertion has to live here.
    const ops = [
      ...at(aPlace({ id: 'attic', name: 'Attic' }), 1),
      ...at(aGear({ id: 'm', name: 'Crate M', container: true }), 2),
      ...at(aGear({ id: 'n', name: 'Crate N', container: true }), 3),
      ...at(aGear({ id: 'p', name: 'Crate P', container: true }), 4),
      ...at(aGear({ id: 'q', name: 'Crate Q', container: true }), 5),
      ...at(aGear({ id: 'r', name: 'Crate R', container: true }), 6),
      ...at(aGear({ id: 'loosey', name: 'Loose thing' }), 7),
      // An ordinary two-node cycle.
      one(gearRehomed('m', { in: 'gear', id: 'n' }), 40),
      one(gearRehomed('n', { in: 'gear', id: 'm' }), 41, DEV_B),
      // A three-node cycle whose three edges carry the *same* stamp: a
      // hand-rolled or replayed log can produce it, and `compareStamps` calls
      // all three equal, so a "first one seen wins" minimum would depend on
      // where the walk entered the cycle — i.e. on insertion order.
      one(gearRehomed('p', { in: 'gear', id: 'q' }), 50, DEV_B),
      one(gearRehomed('q', { in: 'gear', id: 'r' }), 50, DEV_B),
      one(gearRehomed('r', { in: 'gear', id: 'p' }), 50, DEV_B),
      one(gearRehomed('loosey', { in: 'place', id: 'attic' }), 8),
    ]

    const forwards = fold(ops)
    const backwards = fold([...ops].reverse())

    // Precondition: the fold itself is order-independent. If this fails, the
    // rest of the test is measuring the wrong thing.
    expect(backwards).toEqual(forwards)

    const a = containmentView(forwards)
    const b = containmentView(backwards)

    const ids = Object.keys(forwards.gear).sort()
    for (const id of ids) {
      expect(b.holderOf(id)).toEqual(a.holderOf(id))
      // Not just the same holder: the same *list*, in the same order. An
      // unsorted traversal agrees on the first and disagrees on the second,
      // and the second is what a device renders.
      expect(b.childrenOf({ kind: 'gear', id })).toEqual(
        a.childrenOf({ kind: 'gear', id }),
      )
    }
    expect(b.childrenOf({ kind: 'place', id: 'attic' })).toEqual(
      a.childrenOf({ kind: 'place', id: 'attic' }),
    )
    expect(b.childrenOf({ kind: 'loose' })).toEqual(
      a.childrenOf({ kind: 'loose' }),
    )
    expect([...b.brokenEdges].sort()).toEqual([...a.brokenEdges].sort())
    // Both cycles were found and broken; the fixture is not vacuous.
    expect(a.brokenEdges.size).toBe(2)
  })
})

describe('homePath', () => {
  it('homePath returns the segments outermost first', () => {
    const ops = [
      ...at(aPlace({ id: 'attic', name: 'Attic' }), 1),
      ...at(aGear({ id: 'shelf', name: 'Shelf L-Top', container: true }), 2),
      ...at(aGear({ id: 'crate', name: 'Crate B', container: true }), 3),
      ...at(aGear({ id: 'tent', name: 'Tent' }), 4),
      one(gearRehomed('shelf', { in: 'place', id: 'attic' }), 5),
      one(gearRehomed('crate', { in: 'gear', id: 'shelf' }), 6),
      one(gearRehomed('tent', { in: 'gear', id: 'crate' }), 7),
    ]
    const state = fold(ops)

    expect(homePath(state, 'tent')).toEqual([
      { kind: 'place', id: 'attic', name: 'Attic' },
      { kind: 'gear', id: 'shelf', name: 'Shelf L-Top' },
      { kind: 'gear', id: 'crate', name: 'Crate B' },
    ])
  })

  it('homePath returns an empty path for loose gear', () => {
    const ops = [
      ...at(aGear({ id: 'tent', name: 'Tent' }), 1),
      ...at(aGear({ id: 'axe', name: 'Axe' }), 2),
      one(gearRehomed('axe', { in: 'loose' }), 3),
    ]
    const state = fold(ops)

    // Never addressed by any rehome, and explicitly loose: both empty.
    expect(homePath(state, 'tent')).toEqual([])
    expect(homePath(state, 'axe')).toEqual([])
    // As is an id no op ever created.
    expect(homePath(state, 'never-recorded')).toEqual([])
  })

  it('homePath stops at the broken edge of a cycle rather than looping forever', () => {
    const ops = [
      ...at(aGear({ id: 'x', name: 'Crate X', container: true }), 1),
      ...at(aGear({ id: 'y', name: 'Crate Y', container: true }), 2),
      ...at(aGear({ id: 'tent', name: 'Tent' }), 3),
      one(gearRehomed('x', { in: 'gear', id: 'y' }), 10),
      one(gearRehomed('y', { in: 'gear', id: 'x' }), 11, DEV_B),
      one(gearRehomed('tent', { in: 'gear', id: 'x' }), 12),
    ]
    const state = fold(ops)

    // x → y is the lowest-stamped edge, so it is the one broken.
    expect(homePath(state, 'x')).toEqual([])
    expect(homePath(state, 'y')).toEqual([
      { kind: 'gear', id: 'x', name: 'Crate X' },
    ])
    expect(homePath(state, 'tent')).toEqual([
      { kind: 'gear', id: 'x', name: 'Crate X' },
    ])
  })
})
