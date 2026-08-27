import { describe, expect, it } from 'vitest'

import { aGear, anOp, aPlace, hlcAt } from '../../testUtils/index.ts'
import {
  gearKindSet,
  gearRehomed,
  gearRetired,
  gearTagApplied,
  gearTagRemoved,
  placeRemoved,
  type OpSpec,
} from '../authoring.ts'
import type { OpEnvelope } from '../ops.ts'
import { fold } from '../reduce.ts'
import { normalizeTag, type TagString } from '../tags.ts'
import {
  depotCounts,
  depotTags,
  looseGear,
  retiredGear,
  tagsOf,
  visibleGear,
  visiblePlaces,
} from './depot.ts'

/** The only way a `TagString` is made (`tags.ts`). */
function aTag(raw: string): TagString {
  const tag = normalizeTag(raw)
  if (tag === null) throw new Error(`not a tag: ${raw}`)
  return tag
}

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

function at(specs: readonly OpSpec[], counter: number): OpEnvelope[] {
  return specs.map((s) => anOp(s, { hlc: hlcAt(counter), deviceId: DEV_A }))
}

function one(spec: OpSpec, counter: number): OpEnvelope {
  return anOp(spec, { hlc: hlcAt(counter), deviceId: DEV_A })
}

const ids = (gear: readonly { id: string }[]) => gear.map((g) => g.id)

describe('depot selectors', () => {
  it('visibleGear excludes retired gear and sorts by name', () => {
    const ops = [
      ...at(aGear({ id: 'g-tent', name: 'Tent' }), 1),
      ...at(aGear({ id: 'g-b', name: 'Rope' }), 2),
      ...at(aGear({ id: 'g-a', name: 'Rope' }), 3),
      ...at(aGear({ id: 'g-axe', name: 'Axe' }), 4),
      ...at(aGear({ id: 'g-billy', name: 'Billy can' }), 5),
      one(gearRetired('g-billy'), 6),
    ]
    const state = fold(ops)

    // Sorted by name; the two Ropes are separated by id, the documented
    // tiebreak — never by the insertion order of the ops that recorded them.
    expect(ids(visibleGear(state))).toEqual(['g-axe', 'g-a', 'g-b', 'g-tent'])
    expect(ids(retiredGear(state))).toEqual(['g-billy'])
  })

  it('depotCounts sums ownedCount for counted gear and 1 for everything else', () => {
    const ops = [
      ...at(
        aGear({
          id: 'g-peg',
          name: 'Tent peg',
          kind: 'counted',
          ownedCount: 4,
        }),
        1,
      ),
      ...at(aGear({ id: 'g-tent', name: 'Tent', kind: 'single' }), 2),
      ...at(aGear({ id: 'g-mug', name: 'Mug', kind: 'per_person' }), 3),
      // Retired gear counts for nothing, however many pieces it once had.
      ...at(
        aGear({
          id: 'g-old',
          name: 'Old rope',
          kind: 'counted',
          ownedCount: 9,
        }),
        4,
      ),
      one(gearRetired('g-old'), 5),
    ]

    expect(depotCounts(fold(ops))).toEqual({ gear: 3, pieces: 6 })
  })

  it('depotCounts counts a piece as 1 once counted gear is edited back to single', () => {
    // Same defect as `selectors/whereabouts.ts`, and the same fix: a
    // `gear.kind_set` leaves `ownedCount` in place (per-field LWW cascades
    // nothing, §5.3 obligation 4), and both selectors must agree with
    // `GearDetail.tsx`'s `metaLine` about what a no-longer-counted item
    // counts as.
    const ops = [
      ...at(
        aGear({ id: 'g-mug', name: 'Mug', kind: 'counted', ownedCount: 6 }),
        1,
      ),
      one(gearKindSet('g-mug', 'single'), 2),
    ]
    const state = fold(ops)

    expect(state.gear['g-mug']?.ownedCount?.value).toBe(6)
    expect(depotCounts(state)).toEqual({ gear: 1, pieces: 1 })
  })

  it('looseGear reports gear whose holder is gone as well as gear recorded loose', () => {
    const ops = [
      ...at(aPlace({ id: 'attic', name: 'Attic' }), 1),
      ...at(aPlace({ id: 'shed', name: 'Shed' }), 2),
      ...at(aGear({ id: 'g-axe', name: 'Axe' }), 3),
      ...at(aGear({ id: 'g-rope', name: 'Rope' }), 4),
      ...at(aGear({ id: 'g-tent', name: 'Tent' }), 5),
      ...at(aGear({ id: 'g-old', name: 'Old sack' }), 6),
      // Explicitly loose.
      one(gearRehomed('g-rope', { in: 'loose' }), 7),
      // Its holder is gone — the Place was removed, and nothing cascaded.
      one(gearRehomed('g-axe', { in: 'place', id: 'shed' }), 8),
      one(placeRemoved('shed'), 9),
      // Still properly housed.
      one(gearRehomed('g-tent', { in: 'place', id: 'attic' }), 10),
      // Loose, but retired: not surfaced for re-homing.
      one(gearRehomed('g-old', { in: 'loose' }), 11),
      one(gearRetired('g-old'), 12),
    ]
    const state = fold(ops)

    expect(ids(looseGear(state))).toEqual(['g-axe', 'g-rope'])
    expect(ids(visiblePlaces(state))).toEqual(['attic'])
  })
})

/**
 * There is **no Tag entity** — the vocabulary is derived from whatever is
 * currently applied (`docs/design/README.md` §4a). These two selectors are
 * that derivation, and they are what both tag pickers read.
 */
describe('tagsOf', () => {
  it('reports only the tags whose register is present', () => {
    const state = fold([
      ...at(aGear({ id: 'g1', name: 'Pot set' }), 1),
      one(gearTagApplied('g1', aTag('winter')), 2),
      one(gearTagApplied('g1', aTag('cooking')), 3),
      one(gearTagRemoved('g1', aTag('winter')), 4),
    ])
    expect(tagsOf(state.gear['g1']!)).toEqual(['cooking'])
  })

  it('sorts, so two replicas draw the chips in one order', () => {
    const state = fold([
      ...at(aGear({ id: 'g1', name: 'Pot set' }), 1),
      one(gearTagApplied('g1', aTag('winter')), 2),
      one(gearTagApplied('g1', aTag('cooking')), 3),
      one(gearTagApplied('g1', aTag('3-season')), 4),
    ])
    expect(tagsOf(state.gear['g1']!)).toEqual(['3-season', 'cooking', 'winter'])
  })

  it('answers empty for gear no tag op has ever addressed', () => {
    const state = fold(at(aGear({ id: 'g1', name: 'Pot set' }), 1))
    expect(tagsOf(state.gear['g1']!)).toEqual([])
  })
})

describe('depotTags', () => {
  /**
   * Count descending, then tag ascending — the order both pickers draw
   * (`#winter 23 · #cooking 14 · #sleep 9`). The `cook-set` / `cooking` pair
   * is what settles it as count-first rather than alphabetical: `cook-set`
   * sorts *before* `cooking`, yet the board draws it second.
   */
  it('orders by count descending, then tag ascending', () => {
    const state = fold([
      ...at(aGear({ id: 'g1', name: 'Pot set' }), 1),
      ...at(aGear({ id: 'g2', name: 'Pan' }), 2),
      ...at(aGear({ id: 'g3', name: 'Kettle' }), 3),
      one(gearTagApplied('g1', aTag('cooking')), 4),
      one(gearTagApplied('g2', aTag('cooking')), 5),
      one(gearTagApplied('g3', aTag('cooking')), 6),
      one(gearTagApplied('g1', aTag('cook-set')), 7),
      one(gearTagApplied('g2', aTag('cook-set')), 8),
      one(gearTagApplied('g3', aTag('winter')), 9),
      one(gearTagApplied('g1', aTag('alpine')), 10),
    ])
    expect(depotTags(state)).toEqual([
      { tag: 'cooking', count: 3 },
      { tag: 'cook-set', count: 2 },
      { tag: 'alpine', count: 1 },
      { tag: 'winter', count: 1 },
    ])
  })

  it('drops a tag once nothing carries it any more', () => {
    const state = fold([
      ...at(aGear({ id: 'g1', name: 'Pot set' }), 1),
      one(gearTagApplied('g1', aTag('winter')), 2),
      one(gearTagRemoved('g1', aTag('winter')), 3),
    ])
    // The register survives holding `false`; the vocabulary does not — there
    // is no Tag entity, so a tag exists exactly as long as something wears it.
    expect(state.gear['g1']?.tags?.['winter']?.value).toBe(false)
    expect(depotTags(state)).toEqual([])
  })

  // Retired gear contributes nothing, for the same reason it contributes
  // nothing to `depotCounts`: the picker offers a vocabulary for slicing the
  // *visible* depot.
  it('does not count retired gear', () => {
    const state = fold([
      ...at(aGear({ id: 'g1', name: 'Pot set' }), 1),
      ...at(aGear({ id: 'g2', name: 'Old pan' }), 2),
      one(gearTagApplied('g1', aTag('cooking')), 3),
      one(gearTagApplied('g2', aTag('cooking')), 4),
      one(gearRetired('g2'), 5),
    ])
    expect(depotTags(state)).toEqual([{ tag: 'cooking', count: 1 }])
  })

  // §5's tolerant reader again: a tag a foreign build authored is part of the
  // vocabulary exactly as it arrived, because the register is.
  it('offers a non-conforming tag exactly as it was folded', () => {
    const state = fold([
      ...at(aGear({ id: 'g1', name: 'Pot set' }), 1),
      anOp(
        {
          aggregate: 'gear',
          aggregate_id: 'g1',
          type: 'gear.tag_applied',
          payload: { tag: 'Cooking' },
        },
        { hlc: hlcAt(2), deviceId: DEV_A },
      ),
      one(gearTagApplied('g1', aTag('cooking')), 3),
    ])
    expect(depotTags(state)).toEqual([
      { tag: 'Cooking', count: 1 },
      { tag: 'cooking', count: 1 },
    ])
  })
})
