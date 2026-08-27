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
  looseGear,
  placeGearCounts,
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

/**
 * The Depot desktop sidebar's `PLACES` list (`docs/design/README.md` §2), and
 * Components §05's rule for what its number means: **count = everything
 * beneath**, at any depth, not the direct children.
 */
describe('placeGearCounts', () => {
  const nested = () =>
    fold([
      ...at(aPlace({ id: 'attic', name: 'Attic' }), 1),
      ...at(aPlace({ id: 'kelder', name: 'Kelder' }), 2),
      ...at(aPlace({ id: 'garage', name: 'Garage' }), 3),
      ...at(
        aGear({
          id: 'crate',
          name: 'Crate B',
          container: true,
          residence: { in: 'place', id: 'attic' },
        }),
        4,
      ),
      ...at(
        aGear({
          id: 'sack',
          name: 'Stuff sack',
          container: true,
          residence: { in: 'gear', id: 'crate' },
        }),
        5,
      ),
      ...at(
        aGear({
          id: 'tent',
          name: 'Tent',
          residence: { in: 'gear', id: 'sack' },
        }),
        6,
      ),
      ...at(
        aGear({
          id: 'axe',
          name: 'Axe',
          residence: { in: 'place', id: 'kelder' },
        }),
        7,
      ),
    ])

  it('counts everything beneath a place, at any depth', () => {
    const counts = placeGearCounts(nested())
    // Attic holds the crate, the sack inside it, and the tent inside that.
    expect(counts.map((entry) => [entry.place.id, entry.count])).toEqual([
      ['attic', 3],
      ['garage', 0],
      ['kelder', 1],
    ])
  })

  it('counts an empty place as zero rather than omitting it', () => {
    const counts = placeGearCounts(nested())
    expect(counts.find((entry) => entry.place.id === 'garage')?.count).toBe(0)
  })

  it('omits a removed place', () => {
    const state = fold([
      ...at(aPlace({ id: 'attic', name: 'Attic' }), 1),
      ...at(aPlace({ id: 'shed', name: 'Shed' }), 2),
      one(placeRemoved('shed'), 3),
    ])
    expect(placeGearCounts(state).map((entry) => entry.place.id)).toEqual([
      'attic',
    ])
  })

  // Retired gear counts for nothing here either — the sidebar counts what a
  // Quartermaster would find if they walked to the place.
  it('does not count retired gear', () => {
    const state = fold([
      ...at(aPlace({ id: 'attic', name: 'Attic' }), 1),
      ...at(
        aGear({
          id: 'g1',
          name: 'Tent',
          residence: { in: 'place', id: 'attic' },
        }),
        2,
      ),
      ...at(
        aGear({
          id: 'g2',
          name: 'Old tent',
          residence: { in: 'place', id: 'attic' },
        }),
        3,
      ),
      one(gearRetired('g2'), 4),
    ])
    expect(placeGearCounts(state)[0]?.count).toBe(1)
  })
})
