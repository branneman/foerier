import { describe, expect, it } from 'vitest'

import { aGear, aPlace, anOp, hlcAt } from '../../testUtils/index.ts'
import {
  gearKindSet,
  gearRehomed,
  placeRemoved,
  type OpSpec,
} from '../authoring.ts'
import type { OpEnvelope } from '../ops.ts'
import { fold } from '../reduce.ts'
import { whereabouts } from './whereabouts.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

function at(specs: readonly OpSpec[], counter: number): OpEnvelope[] {
  return specs.map((s) => anOp(s, { hlc: hlcAt(counter), deviceId: DEV_A }))
}

function one(spec: OpSpec, counter: number): OpEnvelope {
  return anOp(spec, { hlc: hlcAt(counter), deviceId: DEV_A })
}

describe('whereabouts', () => {
  it('reports one home slice with the full path', () => {
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

    expect(whereabouts(state, 'tent')).toEqual({
      gearId: 'tent',
      slices: [
        {
          kind: 'home',
          path: [
            { kind: 'place', id: 'attic', name: 'Attic' },
            { kind: 'gear', id: 'shelf', name: 'Shelf L-Top' },
            { kind: 'gear', id: 'crate', name: 'Crate B' },
          ],
          count: 1,
        },
      ],
    })
  })

  it('reports a count of 1 for single and per-person gear', () => {
    const ops = [
      ...at(aGear({ id: 'tent', name: 'Tent', kind: 'single' }), 1),
      ...at(aGear({ id: 'mug', name: 'Mug', kind: 'per_person' }), 2),
    ]
    const state = fold(ops)

    expect(whereabouts(state, 'tent').slices[0]?.count).toBe(1)
    expect(whereabouts(state, 'mug').slices[0]?.count).toBe(1)
  })

  it('reports the owned-count for counted gear', () => {
    const ops = [
      ...at(
        aGear({ id: 'peg', name: 'Tent peg', kind: 'counted', ownedCount: 6 }),
        1,
      ),
    ]
    const state = fold(ops)

    expect(whereabouts(state, 'peg').slices[0]?.count).toBe(6)
  })

  it('reports a count of 1 once counted gear is edited back to single', () => {
    // `gear.kind_set` touches only the `kind` register — per-field LWW
    // cascades nothing (§5.3 obligation 4) — so `ownedCount` still reads `6`
    // underneath. Reading it un-gated here would report `×6 THERE` while
    // `GearDetail.tsx`'s `metaLine` (which does gate) renders plain
    // `ITEM · SHARED` two lines away on the same screen.
    const ops = [
      ...at(
        aGear({ id: 'mug', name: 'Mug', kind: 'counted', ownedCount: 6 }),
        1,
      ),
      one(gearKindSet('mug', 'single'), 2),
    ]
    const state = fold(ops)

    expect(state.gear['mug']?.ownedCount?.value).toBe(6)
    expect(whereabouts(state, 'mug').slices[0]?.count).toBe(1)
  })

  it('reports an empty path for loose gear', () => {
    const ops = [...at(aGear({ id: 'axe', name: 'Axe' }), 1)]
    const state = fold(ops)

    expect(whereabouts(state, 'axe')).toEqual({
      gearId: 'axe',
      slices: [{ kind: 'home', path: [], count: 1 }],
    })
  })

  it('reports gear at a removed Place as loose without cascading', () => {
    const ops = [
      ...at(aPlace({ id: 'shed', name: 'Shed' }), 1),
      ...at(aGear({ id: 'axe', name: 'Axe' }), 2),
      one(gearRehomed('axe', { in: 'place', id: 'shed' }), 3),
      one(placeRemoved('shed'), 4),
    ]
    const state = fold(ops)

    expect(whereabouts(state, 'axe')).toEqual({
      gearId: 'axe',
      slices: [{ kind: 'home', path: [], count: 1 }],
    })
    // Nothing was cascaded: the residence register still names the removed
    // Place (§3.5, invariant 4) — the selector reads it as loose on every
    // call rather than rewriting it.
    expect(state.gear['axe']?.residence?.value).toEqual({
      in: 'place',
      id: 'shed',
    })
  })
})
