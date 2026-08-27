import { describe, expect, it } from 'vitest'

import { aGear, anOp, hlcAt } from '../../testUtils/index.ts'
import {
  gearRetired,
  gearTagApplied,
  gearTagRemoved,
  type OpSpec,
} from '../authoring.ts'
import type { OpEnvelope } from '../ops.ts'
import { fold } from '../reduce.ts'
import type { DepotState } from '../state.ts'
import { normalizeTag, type TagString } from '../tags.ts'
import {
  dimension,
  EMPTY_SLICE,
  recordedAt,
  sliceDepot,
  type SliceSpec,
} from './slice.ts'

/**
 * **The slicing engine** — story 13's "filter, sort, and group any list from
 * many angles", built once at S3 carrying the two dimensions that exist
 * (Tag and Kind) and extended by five later slices
 * ([architecture §8.5](../../docs/architecture-design.md)).
 *
 * Everything here folds real ops through the real reducer. The engine is a
 * pure function of folded state, so there is nothing to fake.
 */

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

function at(specs: readonly OpSpec[], counter: number): OpEnvelope[] {
  return specs.map((s) => anOp(s, { hlc: hlcAt(counter), deviceId: DEV_A }))
}

function one(spec: OpSpec, counter: number): OpEnvelope {
  return anOp(spec, { hlc: hlcAt(counter), deviceId: DEV_A })
}

function aTag(raw: string): TagString {
  const tag = normalizeTag(raw)
  if (tag === null) throw new Error(`not a tag: ${raw}`)
  return tag
}

/** `EMPTY_SLICE` with only what the test is about spelled out. */
function slice(overrides: Partial<SliceSpec> = {}): SliceSpec {
  return { ...EMPTY_SLICE, ...overrides }
}

/** Every gear the result holds, in the order it holds it, across groups. */
function shownIds(state: DepotState, spec: SliceSpec): string[] {
  return sliceDepot(state, spec).groups.flatMap((group) =>
    group.gear.map((gear) => gear.id),
  )
}

/**
 * Four pieces of gear that between them exercise both dimensions:
 *
 * | id | name | kind | tags | recorded |
 * | --- | --- | --- | --- | --- |
 * | `g-pot` | Pot set | single | cooking | 1st |
 * | `g-axe` | Axe | single | — | 2nd |
 * | `g-bag` | Sleeping bag | counted | winter, sleep | 3rd |
 * | `g-mug` | Mug | per_person | cooking, winter | 4th |
 *
 * **The recording order is deliberately not the alphabetical order, nor its
 * reverse.** With four pieces of gear recorded A→Z, `NEWEST FIRST` and
 * `NAME Z→A` produce the same list and the sort tests below would pass
 * without the sort ever being consulted.
 */
function aDepot(): DepotState {
  return fold([
    ...at(aGear({ id: 'g-pot', name: 'Pot set', kind: 'single' }), 1),
    ...at(aGear({ id: 'g-axe', name: 'Axe', kind: 'single' }), 2),
    ...at(aGear({ id: 'g-bag', name: 'Sleeping bag', kind: 'counted' }), 3),
    ...at(aGear({ id: 'g-mug', name: 'Mug', kind: 'per_person' }), 4),
    one(gearTagApplied('g-bag', aTag('winter')), 5),
    one(gearTagApplied('g-bag', aTag('sleep')), 6),
    one(gearTagApplied('g-pot', aTag('cooking')), 7),
    one(gearTagApplied('g-mug', aTag('cooking')), 8),
    one(gearTagApplied('g-mug', aTag('winter')), 9),
  ])
}

describe('sliceDepot — the resting state', () => {
  it('returns the whole visible depot in one group, sorted by name', () => {
    const result = sliceDepot(aDepot(), EMPTY_SLICE)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.gear.map((g) => g.id)).toEqual([
      'g-axe',
      'g-mug',
      'g-pot',
      'g-bag',
    ])
  })

  // `9 OF 128` — one count line, always both numbers, so a screen never has
  // to decide which read it is showing.
  it('reports shown and total, which agree when nothing narrows', () => {
    const result = sliceDepot(aDepot(), EMPTY_SLICE)
    expect(result.shown).toBe(4)
    expect(result.total).toBe(4)
  })

  it('counts retired gear in neither', () => {
    const state = fold([
      ...at(aGear({ id: 'g1', name: 'Tent' }), 1),
      ...at(aGear({ id: 'g2', name: 'Old tent' }), 2),
      one(gearRetired('g2'), 3),
    ])
    const result = sliceDepot(state, EMPTY_SLICE)
    expect(result.shown).toBe(1)
    expect(result.total).toBe(1)
  })

  it('reports nothing active, so CLEAR has nothing to offer', () => {
    expect(sliceDepot(aDepot(), EMPTY_SLICE).active).toBe(0)
  })
})

describe('sliceDepot — one dimension at a time', () => {
  it('narrows by tag', () => {
    const spec = slice({ filters: { tag: ['winter'] } })
    expect(shownIds(aDepot(), spec)).toEqual(['g-mug', 'g-bag'])
  })

  it('narrows by kind', () => {
    const spec = slice({ filters: { kind: ['single'] } })
    expect(shownIds(aDepot(), spec)).toEqual(['g-axe', 'g-pot'])
  })

  it('leaves total at the whole depot while shown narrows', () => {
    const result = sliceDepot(aDepot(), slice({ filters: { tag: ['winter'] } }))
    expect(result.shown).toBe(2)
    expect(result.total).toBe(4)
  })

  it('skips a dimension whose value list is empty rather than matching none', () => {
    expect(shownIds(aDepot(), slice({ filters: { tag: [] } }))).toHaveLength(4)
  })

  it('answers empty for a tag nothing carries', () => {
    const spec = slice({ filters: { tag: ['nonesuch'] } })
    const result = sliceDepot(aDepot(), spec)
    expect(result.shown).toBe(0)
    expect(result.groups.flatMap((g) => g.gear)).toEqual([])
  })

  it('stops offering gear whose tag was removed', () => {
    const state = fold([
      ...at(aGear({ id: 'g1', name: 'Tent' }), 1),
      one(gearTagApplied('g1', aTag('winter')), 2),
      one(gearTagRemoved('g1', aTag('winter')), 3),
    ])
    const spec = slice({ filters: { tag: ['winter'] } })
    expect(sliceDepot(state, spec).shown).toBe(0)
  })
})

/**
 * **One rule: every selected value must be carried.** That is the board's
 * `SEARCH + FILTERS COMBINE WITH AND`, and it is deliberately the only
 * combinator — a single-arity dimension degenerates to equality for free.
 */
describe('sliceDepot — combining', () => {
  it('ANDs several tags rather than unioning them', () => {
    const spec = slice({ filters: { tag: ['winter', 'cooking'] } })
    // Only the mug carries both; the bag carries winter alone.
    expect(shownIds(aDepot(), spec)).toEqual(['g-mug'])
  })

  it('ANDs across dimensions', () => {
    const spec = slice({ filters: { tag: ['cooking'], kind: ['single'] } })
    expect(shownIds(aDepot(), spec)).toEqual(['g-pot'])
  })

  it('ANDs search with the filters', () => {
    const spec = slice({ search: 'set', filters: { tag: ['cooking'] } })
    expect(shownIds(aDepot(), spec)).toEqual(['g-pot'])
  })

  it('narrows by search alone, on a substring anywhere in the name', () => {
    // `g` matches Sleeping bag and Mug — neither at the start of the name.
    expect(shownIds(aDepot(), slice({ search: 'g' }))).toEqual([
      'g-mug',
      'g-bag',
    ])
  })

  // The same fold `selectors/find.ts` applies, and for the same reason: two
  // search fields in one app disagreeing about `ö` is a bug waiting to be
  // filed.
  it('folds case and diacritics in the search, as Find does', () => {
    const state = fold(at(aGear({ id: 'g1', name: 'Ölzeug' }), 1))
    expect(shownIds(state, slice({ search: 'olz' }))).toEqual(['g1'])
  })

  it('ignores a search that is only whitespace', () => {
    expect(shownIds(aDepot(), slice({ search: '   ' }))).toHaveLength(4)
  })
})

/**
 * `CLEAR (n)` is story 13's "can be undone" criterion, and Components §04
 * says it "stays visible while **anything** narrows" — so a typed search
 * counts alongside the chips.
 */
describe('sliceDepot — the active count behind CLEAR (n)', () => {
  it('counts one per selected value', () => {
    const spec = slice({
      filters: { tag: ['winter', 'sleep'], kind: ['single'] },
    })
    expect(sliceDepot(aDepot(), spec).active).toBe(3)
  })

  it('counts a typed search as one more thing narrowing', () => {
    const spec = slice({ search: 'pot', filters: { tag: ['cooking'] } })
    expect(sliceDepot(aDepot(), spec).active).toBe(2)
  })

  it('does not count a whitespace-only search', () => {
    expect(sliceDepot(aDepot(), slice({ search: '  ' })).active).toBe(0)
  })
})

describe('sliceDepot — sorting', () => {
  it('sorts A→Z by default', () => {
    expect(shownIds(aDepot(), slice({ sort: 'name-asc' }))).toEqual([
      'g-axe',
      'g-mug',
      'g-pot',
      'g-bag',
    ])
  })

  it('sorts Z→A as the exact reverse', () => {
    expect(shownIds(aDepot(), slice({ sort: 'name-desc' }))).toEqual([
      'g-bag',
      'g-pot',
      'g-mug',
      'g-axe',
    ])
  })

  // Distinct from both name orders by construction — see `aDepot`.
  it('sorts newest first by when the gear was recorded', () => {
    expect(shownIds(aDepot(), slice({ sort: 'newest' }))).toEqual([
      'g-mug',
      'g-bag',
      'g-axe',
      'g-pot',
    ])
  })

  it('sorts within a narrowed list, not before it', () => {
    const spec = slice({ filters: { kind: ['single'] }, sort: 'name-desc' })
    expect(shownIds(aDepot(), spec)).toEqual(['g-pot', 'g-axe'])
  })
})

/**
 * `NEWEST FIRST` has no field to read: `GearState` carries no `createdAt` and
 * no op supplies one. It is derived as the **earliest stamp any of the
 * gear's registers carries** — which is the clock of the op that first
 * addressed it.
 */
describe('recordedAt', () => {
  it('is the stamp of the op that first addressed the gear', () => {
    const state = fold(at(aGear({ id: 'g1', name: 'Tent' }), 7))
    expect(recordedAt(state.gear['g1']!).hlc).toBe(hlcAt(7))
  })

  // The property that makes the sort stable in use: a register only ever
  // accepts a strictly later write, so nothing a Quartermaster does later can
  // move a gear back up a NEWEST FIRST list.
  it('is not moved by a later edit', () => {
    const before = fold(at(aGear({ id: 'g1', name: 'Tent' }), 7))
    const after = fold([one(gearTagApplied('g1', aTag('winter')), 99)], before)
    expect(recordedAt(after.gear['g1']!)).toEqual(
      recordedAt(before.gear['g1']!),
    )
  })

  // Tag registers count like any other. Excluding them would make the answer
  // depend on which dimensions happened to exist when the gear was recorded.
  it('reads a tag register when it is the earliest thing there is', () => {
    const state = fold([one(gearTagApplied('g1', aTag('winter')), 3)])
    expect(recordedAt(state.gear['g1']!).hlc).toBe(hlcAt(3))
  })
})

/**
 * `GROUP BY` offers `NONE · KIND` and **never offers TAG** — deliberate, and
 * a domain fact rather than a UI preference: tags are multi-valued, so a
 * three-tag piece of gear would land in three groups and the groups would not
 * partition the list.
 */
describe('sliceDepot — grouping', () => {
  it('returns one unlabelled group when grouping is off', () => {
    const result = sliceDepot(aDepot(), slice({ group: 'none' }))
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.key).toBe('')
    expect(result.groups[0]?.label).toBe('')
  })

  // Alphabetical by label — `Counted · Per-person · Single` — which is what
  // the board's grouped frame draws, and is *not* the enum's own order.
  it('groups by kind, alphabetically by label', () => {
    const result = sliceDepot(aDepot(), slice({ group: 'kind' }))
    expect(result.groups.map((g) => g.label)).toEqual([
      'Counted',
      'Per-person',
      'Single',
    ])
    expect(result.groups.map((g) => g.gear.length)).toEqual([1, 1, 2])
  })

  it('keeps the sort order inside each group', () => {
    const spec = slice({ group: 'kind', sort: 'name-desc' })
    const single = sliceDepot(aDepot(), spec).groups.find(
      (g) => g.key === 'single',
    )
    expect(single?.gear.map((g) => g.id)).toEqual(['g-pot', 'g-axe'])
  })

  it('groups only what survived the narrowing', () => {
    const spec = slice({ filters: { tag: ['cooking'] }, group: 'kind' })
    const result = sliceDepot(aDepot(), spec)
    expect(result.groups.map((g) => g.label)).toEqual(['Per-person', 'Single'])
  })

  /**
   * Reachable only from a peer on a different build — `sync-protocol.md`
   * §5.3 obligation 4 stores an unrecognised enum value verbatim — and
   * therefore exactly what must not crash or be coerced.
   */
  it('gives an unrecognised kind its own group, labelled as it arrived', () => {
    const state = fold([
      ...at(aGear({ id: 'g1', name: 'Sled', kind: 'sled' }), 1),
      ...at(aGear({ id: 'g2', name: 'Tent', kind: 'single' }), 2),
    ])
    const result = sliceDepot(state, slice({ group: 'kind' }))
    expect(result.groups.map((g) => g.label)).toEqual(['Single', 'sled'])
  })

  it('groups gear with no kind register last, under a dash', () => {
    const state = fold([
      anOp(
        {
          aggregate: 'gear',
          aggregate_id: 'g1',
          type: 'gear.renamed',
          payload: { name: 'Mystery' },
        },
        { hlc: hlcAt(1), deviceId: DEV_A },
      ),
      ...at(aGear({ id: 'g2', name: 'Tent', kind: 'single' }), 2),
    ])
    const result = sliceDepot(state, slice({ group: 'kind' }))
    expect(result.groups.map((g) => g.label)).toEqual(['Single', '—'])
  })

  it('returns no groups at all when nothing survived', () => {
    const spec = slice({ filters: { tag: ['nonesuch'] }, group: 'kind' })
    expect(sliceDepot(aDepot(), spec).groups).toEqual([])
  })
})

/**
 * The dimension table is what makes §8.5 affordable: S4, S7, S8, S9 and S10
 * each add a **row**, not a branch. These pin the two rows that exist.
 */
describe('the dimension table', () => {
  it('draws a tag with the # that is never stored', () => {
    expect(dimension('tag').format('winter')).toBe('#winter')
  })

  it('draws a kind with the glossary Kind, never the containment trait', () => {
    expect(dimension('kind').format('single')).toBe('Single')
    expect(dimension('kind').format('per_person')).toBe('Per-person')
    expect(dimension('kind').format('counted')).toBe('Counted')
  })

  it('draws an unrecognised kind exactly as it arrived', () => {
    expect(dimension('kind').format('sled')).toBe('sled')
  })

  /**
   * Arity drives the ghost add-chip: a single-valued dimension hides its
   * ghost while active, and TAG keeps its because several tags AND together
   * (Components §04).
   */
  it('marks tag multi-valued and kind single-valued', () => {
    expect(dimension('tag').arity).toBe('multi')
    expect(dimension('kind').arity).toBe('single')
  })

  it('labels each dimension as its chip draws it', () => {
    expect(dimension('tag').label).toBe('TAG')
    expect(dimension('kind').label).toBe('KIND')
  })
})
