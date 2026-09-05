import { describe, expect, it } from 'vitest'

import {
  aGear,
  anOp,
  aPerson,
  aTrip,
  DEV_A,
  hlcAt,
  stamp,
} from '../../testUtils/index.ts'
import {
  gearRetired,
  gearTagApplied,
  gearTagRemoved,
  tripEntryAdded,
  tripEntryRemoved,
  type OpSpec,
} from '../authoring.ts'
import type { OpEnvelope } from '../ops.ts'
import { fold } from '../reduce.ts'
import type { DepotState } from '../state.ts'
import { normalizeTag, type TagString } from '../tags.ts'
import {
  dimension,
  dimensionValues,
  EMPTY_SLICE,
  GROUP_KEYS,
  groupLabel,
  recordedAt,
  sliceDepot,
  type SliceSpec,
} from './slice.ts'

/**
 * **The slicing engine** — story 13's "filter, sort, and group any list from
 * many angles", built once at S3 carrying the two dimensions that exist
 * (Tag and Kind) and extended by four later slices
 * ([architecture §8.5](../../docs/architecture-design.md)).
 *
 * Everything here folds real ops through the real reducer. The engine is a
 * pure function of folded state, so there is nothing to fake.
 */

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
    ...stamp(aGear({ id: 'g-pot', name: 'Pot set', kind: 'single' }), {
      start: 1,
    }),
    ...stamp(aGear({ id: 'g-axe', name: 'Axe', kind: 'single' }), { start: 2 }),
    ...stamp(aGear({ id: 'g-bag', name: 'Sleeping bag', kind: 'counted' }), {
      start: 3,
    }),
    ...stamp(aGear({ id: 'g-mug', name: 'Mug', kind: 'per_person' }), {
      start: 4,
    }),
    one(gearTagApplied('g-bag', aTag('winter')), 5),
    one(gearTagApplied('g-bag', aTag('sleep')), 6),
    one(gearTagApplied('g-pot', aTag('cooking')), 7),
    one(gearTagApplied('g-mug', aTag('cooking')), 8),
    one(gearTagApplied('g-mug', aTag('winter')), 9),
  ])
}

/**
 * A household with two People and four pieces of gear, two of them owned.
 *
 * `g-tent` carries **no `owner` register at all** while `g-stove` carries an
 * explicit `{type:'shared'}` — the pair that keeps every ownership assertion
 * below honest, because the fold keeps those two facts apart and only
 * `selectors/owner.ts` brings them together.
 *
 * | id | name | owner |
 * | --- | --- | --- |
 * | `g-tent` | Tent | *(absent)* |
 * | `g-stove` | Stove | shared, explicitly |
 * | `g-jacket` | Down jacket | Els |
 * | `g-boots` | Winter boots | Mark |
 */
function anOwnedDepot(): DepotState {
  return fold([
    ...stamp(aPerson({ id: 'els', name: 'Els' }), { start: 1 }),
    ...stamp(aPerson({ id: 'mark', name: 'Mark' }), { start: 2 }),
    ...stamp(aGear({ id: 'g-tent', name: 'Tent' }), { start: 3 }),
    ...stamp(
      aGear({ id: 'g-stove', name: 'Stove', owner: { type: 'shared' } }),
      { start: 4 },
    ),
    ...stamp(
      aGear({
        id: 'g-jacket',
        name: 'Down jacket',
        owner: { type: 'person', personId: 'els' },
      }),
      { start: 5 },
    ),
    ...stamp(
      aGear({
        id: 'g-boots',
        name: 'Winter boots',
        owner: { type: 'person', personId: 'mark' },
      }),
      { start: 6 },
    ),
  ])
}

/**
 * Four pieces of gear and three Trips, arranged so every case the `trip`
 * dimension has to answer is exercised: a piece on two non-closed Trips, a
 * piece on one, a piece on a **closed** Trip only, and a piece on none at
 * all.
 *
 * | id | name | in |
 * | --- | --- | --- |
 * | `g-tent` | Tent | Vosges (draft), Alps (pack-out) |
 * | `g-stove` | Stove | Alps (pack-out) only |
 * | `g-boots` | Boots | Old trip — **closed**, so this reads `NOT IN ANY TRIP` |
 * | `g-axe` | Axe | no Trip at all |
 *
 * Trip ids are hand-named (`t-vosges` etc.) rather than `systemIdSource`
 * hex, because these fixtures are about membership and exclusion, not about
 * the sentinel's pinned position — that gets its own fixture below, with a
 * real hex id, because a hand-named id would not exercise the tiebreak the
 * pin exists for.
 */
function aTrippedDepot(): DepotState {
  return fold([
    ...stamp(aGear({ id: 'g-tent', name: 'Tent' }), { start: 1 }),
    ...stamp(aGear({ id: 'g-stove', name: 'Stove' }), { start: 2 }),
    ...stamp(aGear({ id: 'g-boots', name: 'Boots' }), { start: 3 }),
    ...stamp(aGear({ id: 'g-axe', name: 'Axe' }), { start: 4 }),
    ...stamp(aTrip({ id: 't-vosges', name: 'Vosges' }), { start: 10 }),
    ...stamp(aTrip({ id: 't-alps', name: 'Alps', phase: 'pack_out' }), {
      start: 20,
    }),
    ...stamp(aTrip({ id: 't-old', name: 'Old trip', phase: 'closed' }), {
      start: 30,
    }),
    one(
      tripEntryAdded('t-vosges', 'e1', { from: 'depot', gearId: 'g-tent' }),
      40,
    ),
    one(
      tripEntryAdded('t-alps', 'e2', { from: 'depot', gearId: 'g-tent' }),
      41,
    ),
    one(
      tripEntryAdded('t-alps', 'e3', { from: 'depot', gearId: 'g-stove' }),
      42,
    ),
    one(
      tripEntryAdded('t-old', 'e4', { from: 'depot', gearId: 'g-boots' }),
      43,
    ),
  ])
}

describe("dimension('trip')", () => {
  it('lists every non-closed Trip that carries the gear, in `visibleTrips` order', () => {
    // `Alps` sorts before `Vosges` — the same `byNameThenId` total order
    // `visibleTrips` already uses, which is what makes the answer replica-
    // identical rather than an artefact of iteration order.
    const state = aTrippedDepot()
    expect(dimension('trip').valuesOf(state.gear['g-tent']!, state)).toEqual([
      't-alps',
      't-vosges',
    ])
  })

  it('excludes closed Trips, so their gear reads NOT IN ANY TRIP', () => {
    const state = aTrippedDepot()
    expect(dimension('trip').valuesOf(state.gear['g-boots']!, state)).toEqual([
      'none',
    ])
  })

  it('returns the sentinel for gear no Trip lists at all', () => {
    const state = aTrippedDepot()
    expect(dimension('trip').valuesOf(state.gear['g-axe']!, state)).toEqual([
      'none',
    ])
  })

  it('formats the sentinel as NOT IN ANY TRIP and a Trip id as its label', () => {
    const state = aTrippedDepot()
    expect(dimension('trip').format('none', state)).toBe('NOT IN ANY TRIP')
    expect(dimension('trip').format('t-vosges', state)).toBe('Vosges')
  })

  it('falls back to an em dash for a Trip id this replica has not folded', () => {
    // The `dimension('person')` precedent for an id whose op has not
    // arrived — never throws, draws the same glyph an unnamed Trip does.
    expect(dimension('trip').format('ghost-trip', aTrippedDepot())).toBe('—')
  })

  it('is multi arity, so two Trips AND together', () => {
    expect(dimension('trip').arity).toBe('multi')
    // `g-tent` is on both; `g-stove` only on Alps — ANDing the two narrows
    // to the piece that carries both.
    expect(
      shownIds(
        aTrippedDepot(),
        slice({ filters: { trip: ['t-vosges', 't-alps'] } }),
      ),
    ).toEqual(['g-tent'])
  })

  it('returns 0 of N for the sentinel plus a named Trip — S4’s contradictory pair, again', () => {
    // `NOT IN ANY TRIP` and a Trip's id can never both be *carried* by one
    // piece of gear, but nothing stops both being *selected*, and the engine
    // has exactly one filter rule: every selected value must be carried.
    // `OWNERSHIP: SHARED` + `PERSON: ELS` is the S4 instance of the same
    // shape; this is not guarded either.
    const result = sliceDepot(
      aTrippedDepot(),
      slice({ filters: { trip: ['none', 't-vosges'] } }),
    )
    expect(result.shown).toBe(0)
    expect(result.total).toBe(4)
    expect(result.active).toBe(2)
    expect(result.groups).toEqual([])
  })

  it('orders the sentinel first even when a tie would otherwise put a real Trip id ahead of it', () => {
    // `systemIdSource` ids are canonical UUIDs — hex and hyphens — and every
    // hex digit sorts *before* the letter `n`. So a plain count-desc,
    // value-asc rule would put a tied (or heavier) Trip ahead of the literal
    // string `'none'`. `aTrip()`'s default id is exactly such a hex id,
    // deliberately not overridden here.
    const tripSpecs = aTrip({ name: 'Alps' })
    const tripId = tripSpecs[0]!.aggregate_id
    const state = fold([
      ...stamp(aGear({ id: 'g1', name: 'Axe' }), { start: 1 }),
      ...stamp(aGear({ id: 'g2', name: 'Boots' }), { start: 2 }),
      ...stamp(aGear({ id: 'g3', name: 'Crampons' }), { start: 3 }),
      ...stamp(aGear({ id: 'g4', name: 'Tent' }), { start: 4 }),
      ...stamp(tripSpecs, { start: 5 }),
      one(tripEntryAdded(tripId, 'e1', { from: 'depot', gearId: 'g3' }), 6),
      one(tripEntryAdded(tripId, 'e2', { from: 'depot', gearId: 'g4' }), 7),
    ])
    // `g1`, `g2` carry no Trip → sentinel count 2, tying the Trip's own
    // count of 2 (`g3`, `g4`). The pin must hold on the tie, not just when
    // the sentinel happens to have the higher count.
    expect(dimensionValues(state, 'trip')).toEqual([
      { value: 'none', count: 2 },
      { value: tripId, count: 2 },
    ])
  })
})

describe('the Trip-membership index', () => {
  it('is memoised: two calls against the same state return the same array', () => {
    const state = aTrippedDepot()
    const first = dimension('trip').valuesOf(state.gear['g-tent']!, state)
    const second = dimension('trip').valuesOf(state.gear['g-tent']!, state)
    // If the index were rebuilt on every call, `.get('g-tent')` would return
    // a freshly-allocated array each time — equal in content, but a
    // different object. Reference equality is only possible if the second
    // call found the first call's map already cached rather than rebuilding
    // it from every Trip's Entries again.
    expect(first).toBe(second)
  })

  it('rebuilds when the fold produces a new state, and answers the new fact', () => {
    const before = aTrippedDepot()
    const beforeTent = dimension('trip').valuesOf(
      before.gear['g-tent']!,
      before,
    )
    expect(beforeTent).toEqual(['t-alps', 't-vosges'])

    // Removing Vosges's Entry folds to a *new* `DepotState` object — the
    // memo's key changes, so this is not the same cache entry as `before`'s.
    const after = fold([one(tripEntryRemoved('t-vosges', 'e1'), 50)], before)
    expect(after).not.toBe(before)
    const afterTent = dimension('trip').valuesOf(after.gear['g-tent']!, after)
    expect(afterTent).toEqual(['t-alps'])
    // `before`'s own answer is untouched — the memo never overwrites a
    // superseded state's entry in place.
    expect(dimension('trip').valuesOf(before.gear['g-tent']!, before)).toEqual([
      't-alps',
      't-vosges',
    ])
  })
})

describe('the ownership dimension', () => {
  it('reads gear with no owner register as shared', () => {
    const state = anOwnedDepot()
    expect(
      dimension('ownership').valuesOf(state.gear['g-tent']!, state),
    ).toEqual(['shared'])
  })

  it('reads an explicit shared owner identically', () => {
    const state = anOwnedDepot()
    expect(
      dimension('ownership').valuesOf(state.gear['g-stove']!, state),
    ).toEqual(['shared'])
  })

  it('reads gear with a personal owner as personal', () => {
    const state = anOwnedDepot()
    expect(
      dimension('ownership').valuesOf(state.gear['g-jacket']!, state),
    ).toEqual(['personal'])
  })

  it('offers both values with their counts, most-used first', () => {
    // A two-two tie, so the ascending-value tiebreak decides and `personal`
    // comes first. That the tie is broken *at all* is the point: the order
    // has to be total, or two devices with identical state draw the picker
    // differently.
    expect(dimensionValues(anOwnedDepot(), 'ownership')).toEqual([
      { value: 'personal', count: 2 },
      { value: 'shared', count: 2 },
    ])
  })

  it('puts the more-used value first when there is no tie', () => {
    const state = fold([
      ...stamp(aPerson({ id: 'els', name: 'Els' }), { start: 1 }),
      ...stamp(aGear({ id: 'g1', name: 'Tent' }), { start: 2 }),
      ...stamp(aGear({ id: 'g2', name: 'Stove' }), { start: 3 }),
      ...stamp(
        aGear({
          id: 'g3',
          name: 'Down jacket',
          owner: { type: 'person', personId: 'els' },
        }),
        { start: 4 },
      ),
    ])
    expect(dimensionValues(state, 'ownership')).toEqual([
      { value: 'shared', count: 2 },
      { value: 'personal', count: 1 },
    ])
  })

  it('draws its two values in sentence case', () => {
    const state = anOwnedDepot()
    expect(dimension('ownership').format('shared', state)).toBe('Shared')
    expect(dimension('ownership').format('personal', state)).toBe('Personal')
  })
})

describe('the person dimension', () => {
  it('carries no value for shared gear, rather than a sentinel', () => {
    const state = anOwnedDepot()
    expect(dimension('person').valuesOf(state.gear['g-tent']!, state)).toEqual(
      [],
    )
    expect(dimension('person').valuesOf(state.gear['g-stove']!, state)).toEqual(
      [],
    )
  })

  it('carries the person id for personal gear', () => {
    const state = anOwnedDepot()
    expect(
      dimension('person').valuesOf(state.gear['g-jacket']!, state),
    ).toEqual(['els'])
  })

  it('formats a person id as the recorded name', () => {
    const state = anOwnedDepot()
    expect(dimension('person').format('els', state)).toBe('Els')
  })

  it('formats a Person whose op has not arrived as an em dash', () => {
    const state = anOwnedDepot()
    expect(dimension('person').format('ghost', state)).toBe('—')
  })

  it('omits a Person who owns nothing, because the vocabulary is derived', () => {
    // Not a declared list anywhere: `dimensionValues` reads the visible depot,
    // the same rule that lets an unrecognised Kind appear and that makes the
    // Tag vocabulary work with no Tag entity. Narrowing to someone who owns
    // nothing would return zero, so they are not offered.
    const state = fold([
      ...stamp(aPerson({ id: 'els', name: 'Els' }), { start: 1 }),
      ...stamp(aPerson({ id: 'kees', name: 'Kees' }), { start: 2 }),
      ...stamp(
        aGear({
          id: 'g1',
          name: 'Down jacket',
          owner: { type: 'person', personId: 'els' },
        }),
        { start: 3 },
      ),
    ])
    expect(dimensionValues(state, 'person')).toEqual([
      { value: 'els', count: 1 },
    ])
  })

  it('counts nothing from retired gear', () => {
    const state = fold([
      ...stamp(aPerson({ id: 'els', name: 'Els' }), { start: 1 }),
      ...stamp(
        aGear({
          id: 'g1',
          name: 'Down jacket',
          owner: { type: 'person', personId: 'els' },
        }),
        { start: 2 },
      ),
      one(gearRetired('g1'), 3),
    ])
    expect(dimensionValues(state, 'person')).toEqual([])
  })
})

describe("story 4's two narrowings", () => {
  it('narrows to one Person’s Personal gear', () => {
    expect(
      shownIds(anOwnedDepot(), slice({ filters: { person: ['els'] } })),
    ).toEqual(['g-jacket'])
  })

  it('narrows to Shared gear only, including gear with no owner register', () => {
    // The acceptance criterion, and the reason `ownerOf` is a selector rather
    // than a rendering detail: `g-tent` has no register and must survive.
    expect(
      shownIds(anOwnedDepot(), slice({ filters: { ownership: ['shared'] } })),
    ).toEqual(['g-stove', 'g-tent'])
  })

  it('narrows to all Personal gear, whoever’s — the query one dimension could not express', () => {
    // Still `NAME A→Z`: "Down jacket" before "Winter boots". Narrowing never
    // re-sorts the list under the reader.
    expect(
      shownIds(anOwnedDepot(), slice({ filters: { ownership: ['personal'] } })),
    ).toEqual(['g-jacket', 'g-boots'])
  })

  it('ANDs ownership with another dimension', () => {
    const state = fold([
      ...stamp(aPerson({ id: 'els', name: 'Els' }), { start: 1 }),
      ...stamp(
        aGear({
          id: 'g1',
          name: 'Down jacket',
          kind: 'single',
          owner: { type: 'person', personId: 'els' },
        }),
        { start: 2 },
      ),
      ...stamp(
        aGear({
          id: 'g2',
          name: 'Socks',
          kind: 'counted',
          owner: { type: 'person', personId: 'els' },
        }),
        { start: 3 },
      ),
    ])
    expect(
      shownIds(
        state,
        slice({ filters: { person: ['els'], kind: ['counted'] } }),
      ),
    ).toEqual(['g2'])
  })

  it('returns nothing for the structurally contradictory pair, and still counts it', () => {
    // `OWNERSHIP: SHARED` + `PERSON: ELS` is reachable and always empty.
    // Deliberately not guarded: the engine has exactly one filter rule, an
    // empty slice is the honest answer, and `CLEAR (2)` is one tap away.
    const result = sliceDepot(
      anOwnedDepot(),
      slice({ filters: { ownership: ['shared'], person: ['els'] } }),
    )
    expect(result.shown).toBe(0)
    expect(result.total).toBe(4)
    expect(result.active).toBe(2)
    expect(result.groups).toEqual([])
  })
})

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
      ...stamp(aGear({ id: 'g1', name: 'Tent' }), { start: 1 }),
      ...stamp(aGear({ id: 'g2', name: 'Old tent' }), { start: 2 }),
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
      ...stamp(aGear({ id: 'g1', name: 'Tent' }), { start: 1 }),
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
    const state = fold(stamp(aGear({ id: 'g1', name: 'Ölzeug' }), { start: 1 }))
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
    const state = fold(stamp(aGear({ id: 'g1', name: 'Tent' }), { start: 7 }))
    expect(recordedAt(state.gear['g1']!).hlc).toBe(hlcAt(7))
  })

  // The property that makes the sort stable in use: a register only ever
  // accepts a strictly later write, so nothing a Quartermaster does later can
  // move a gear back up a NEWEST FIRST list.
  it('is not moved by a later edit', () => {
    const before = fold(stamp(aGear({ id: 'g1', name: 'Tent' }), { start: 7 }))
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
 * `GROUP BY` offers `NONE · KIND · OWNER` and **never offers TAG** —
 * deliberate, and a domain fact rather than a UI preference: tags are
 * multi-valued, so a three-tag piece of gear would land in three groups and
 * the groups would not partition the list.
 *
 * Since S4 that is structural rather than prose beside a branch: a grouping
 * needs a `keyOf` — "the one bucket this gear falls into" — and Tag has none,
 * so Tag has no row in `GROUPING_TABLE`.
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
      ...stamp(aGear({ id: 'g1', name: 'Sled', kind: 'sled' }), { start: 1 }),
      ...stamp(aGear({ id: 'g2', name: 'Tent', kind: 'single' }), { start: 2 }),
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
      ...stamp(aGear({ id: 'g2', name: 'Tent', kind: 'single' }), { start: 2 }),
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
 * **Grouping by owner groups by the register**, which is a thing neither of
 * S4's two filter dimensions does alone — grouping by `person` would file
 * every shared piece of gear into the `—` bucket, and grouping by `ownership`
 * would give two coarse groups and never name a Person. That is why grouping
 * has its own table rather than borrowing the dimension table's rows.
 */
describe('sliceDepot — grouping by owner', () => {
  it('files shared gear together, whether the register is written or absent', () => {
    const result = sliceDepot(anOwnedDepot(), slice({ group: 'owner' }))
    const shared = result.groups.find((g) => g.key === 'shared')
    expect(shared?.gear.map((g) => g.id)).toEqual(['g-stove', 'g-tent'])
  })

  it('puts Shared first and then people alphabetically', () => {
    // Not plain alphabetical: `Shared` is not a name, and filing it between
    // `Mark` and `Zoe` reads as a bug. The same reasoning pins `Loose` to the
    // top of the Home picker.
    const result = sliceDepot(anOwnedDepot(), slice({ group: 'owner' }))
    expect(result.groups.map((g) => g.label)).toEqual(['Shared', 'Els', 'Mark'])
  })

  it('labels a person group with the recorded name', () => {
    const result = sliceDepot(anOwnedDepot(), slice({ group: 'owner' }))
    expect(result.groups.find((g) => g.key === 'els')?.label).toBe('Els')
  })

  it('never produces the dash bucket, because absence means shared', () => {
    const result = sliceDepot(anOwnedDepot(), slice({ group: 'owner' }))
    expect(result.groups.some((g) => g.key === '')).toBe(false)
  })

  it('keeps the sort order inside each group', () => {
    const state = fold([
      ...stamp(aPerson({ id: 'els', name: 'Els' }), { start: 1 }),
      ...stamp(
        aGear({
          id: 'g-a',
          name: 'Anorak',
          owner: { type: 'person', personId: 'els' },
        }),
        { start: 2 },
      ),
      ...stamp(
        aGear({
          id: 'g-z',
          name: 'Zip-off trousers',
          owner: { type: 'person', personId: 'els' },
        }),
        { start: 3 },
      ),
    ])
    const result = sliceDepot(
      state,
      slice({ group: 'owner', sort: 'name-desc' }),
    )
    expect(result.groups[0]?.gear.map((g) => g.id)).toEqual(['g-z', 'g-a'])
  })

  it('groups only what survived the narrowing', () => {
    const result = sliceDepot(
      anOwnedDepot(),
      slice({ group: 'owner', filters: { ownership: ['personal'] } }),
    )
    expect(result.groups.map((g) => g.label)).toEqual(['Els', 'Mark'])
  })

  it('labels a Person whose op has not arrived as a dash, in its own group', () => {
    const state = fold([
      ...stamp(aGear({ id: 'g1', name: 'Tent' }), { start: 1 }),
      ...stamp(
        aGear({
          id: 'g2',
          name: 'Down jacket',
          owner: { type: 'person', personId: 'ghost' },
        }),
        { start: 2 },
      ),
    ])
    const result = sliceDepot(state, slice({ group: 'owner' }))
    // Shared pinned first; the unnamed Person's group is a real group with a
    // real key, not the ungrouped bucket — which is why its `—` sorts by
    // label like any other name rather than being forced last.
    expect(result.groups.map((g) => g.key)).toEqual(['shared', 'ghost'])
    expect(result.groups.map((g) => g.label)).toEqual(['Shared', '—'])
  })
})

describe('the grouping table', () => {
  it('names every key GROUP BY offers, in the order it draws them', () => {
    expect(GROUP_KEYS.map(groupLabel)).toEqual(['NONE', 'KIND', 'OWNER'])
  })

  it('never offers TAG, because a multi-valued dimension cannot partition', () => {
    expect(GROUP_KEYS).not.toContain('tag')
  })
})

/**
 * The dimension table is what makes §8.5 affordable: S7, S8, S9 and S10 each
 * add a **row**, not a branch — as S4 just did, twice. These pin the four
 * rows that exist.
 *
 * `format` takes the depot as well as the value, because a value is not
 * always self-describing: `PERSON` carries ids and draws names. Tag, Kind and
 * Ownership ignore it, and are handed one anyway rather than the table
 * carrying two shapes of formatter.
 */
describe('the dimension table', () => {
  const anywhere = aDepot()

  it('draws a tag with the # that is never stored', () => {
    expect(dimension('tag').format('winter', anywhere)).toBe('#winter')
  })

  it('draws a kind with the glossary Kind, never the containment trait', () => {
    expect(dimension('kind').format('single', anywhere)).toBe('Single')
    expect(dimension('kind').format('per_person', anywhere)).toBe('Per-person')
    expect(dimension('kind').format('counted', anywhere)).toBe('Counted')
  })

  it('draws an unrecognised kind exactly as it arrived', () => {
    expect(dimension('kind').format('sled', anywhere)).toBe('sled')
  })

  it('draws an unrecognised ownership value exactly as it arrived', () => {
    expect(dimension('ownership').format('borrowed', anywhere)).toBe('borrowed')
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

describe('dimensionValues', () => {
  /**
   * Count descending, then tag ascending — the order both pickers draw
   * (`#winter 23 · #cooking 14 · #sleep 9`). The `cook-set` / `cooking` pair
   * is what settles it as count-first rather than alphabetical: `cook-set`
   * sorts *before* `cooking`, yet the board draws it second.
   */
  it('orders by count descending, then tag ascending', () => {
    const state = fold([
      ...stamp(aGear({ id: 'g1', name: 'Pot set' }), { start: 1 }),
      ...stamp(aGear({ id: 'g2', name: 'Pan' }), { start: 2 }),
      ...stamp(aGear({ id: 'g3', name: 'Kettle' }), { start: 3 }),
      one(gearTagApplied('g1', aTag('cooking')), 4),
      one(gearTagApplied('g2', aTag('cooking')), 5),
      one(gearTagApplied('g3', aTag('cooking')), 6),
      one(gearTagApplied('g1', aTag('cook-set')), 7),
      one(gearTagApplied('g2', aTag('cook-set')), 8),
      one(gearTagApplied('g3', aTag('winter')), 9),
      one(gearTagApplied('g1', aTag('alpine')), 10),
    ])
    expect(dimensionValues(state, 'tag')).toEqual([
      { value: 'cooking', count: 3 },
      { value: 'cook-set', count: 2 },
      { value: 'alpine', count: 1 },
      { value: 'winter', count: 1 },
    ])
  })

  it('drops a tag once nothing carries it any more', () => {
    const state = fold([
      ...stamp(aGear({ id: 'g1', name: 'Pot set' }), { start: 1 }),
      one(gearTagApplied('g1', aTag('winter')), 2),
      one(gearTagRemoved('g1', aTag('winter')), 3),
    ])
    // The register survives holding `false`; the vocabulary does not — there
    // is no Tag entity, so a tag exists exactly as long as something wears it.
    expect(state.gear['g1']?.tags?.['winter']?.value).toBe(false)
    expect(dimensionValues(state, 'tag')).toEqual([])
  })

  // Retired gear contributes nothing, for the same reason it contributes
  // nothing to `depotCounts`: the picker offers a vocabulary for slicing the
  // *visible* depot.
  it('does not count retired gear', () => {
    const state = fold([
      ...stamp(aGear({ id: 'g1', name: 'Pot set' }), { start: 1 }),
      ...stamp(aGear({ id: 'g2', name: 'Old pan' }), { start: 2 }),
      one(gearTagApplied('g1', aTag('cooking')), 3),
      one(gearTagApplied('g2', aTag('cooking')), 4),
      one(gearRetired('g2'), 5),
    ])
    expect(dimensionValues(state, 'tag')).toEqual([
      { value: 'cooking', count: 1 },
    ])
  })

  // §5's tolerant reader again: a tag a foreign build authored is part of the
  // vocabulary exactly as it arrived, because the register is.
  it('offers a non-conforming tag exactly as it was folded', () => {
    const state = fold([
      ...stamp(aGear({ id: 'g1', name: 'Pot set' }), { start: 1 }),
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
    expect(dimensionValues(state, 'tag')).toEqual([
      { value: 'Cooking', count: 1 },
      { value: 'cooking', count: 1 },
    ])
  })

  /**
   * The reason this is per-dimension rather than tag-only: the `+ KIND`
   * ghost chip needs the same list, and so will every dimension S4 through
   * S10 adds. A dimension is a row in a table; its vocabulary comes from the
   * same place.
   */
  it('derives a single-valued dimension the same way', () => {
    expect(dimensionValues(aDepot(), 'kind')).toEqual([
      { value: 'single', count: 2 },
      { value: 'counted', count: 1 },
      { value: 'per_person', count: 1 },
    ])
  })

  // Which is also how an unrecognised kind reaches the chip menu at all —
  // it is in the depot, so it is offered, without any list of known values
  // to be added to.
  it('offers an unrecognised value because it is derived, not declared', () => {
    const state = fold(
      stamp(aGear({ id: 'g1', name: 'Sled', kind: 'sled' }), { start: 1 }),
    )
    expect(dimensionValues(state, 'kind')).toEqual([
      { value: 'sled', count: 1 },
    ])
  })
})
