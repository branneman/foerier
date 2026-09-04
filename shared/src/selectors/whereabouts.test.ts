import { describe, expect, it } from 'vitest'

import {
  aGear,
  anOp,
  aPerson,
  aPlace,
  aTrip,
  hlcAt,
} from '../../testUtils/index.ts'
import {
  gearKindSet,
  gearRehomed,
  placeRemoved,
  tripContainerStageSet,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripEntryRemoved,
  tripPhaseMoved,
  tripPieceMoved,
  tripPieceRemoved,
  type OpSpec,
} from '../authoring.ts'
import type { OpEnvelope } from '../ops.ts'
import { fold } from '../reduce.ts'
import type { DepotState } from '../state.ts'
import { dimension } from './slice.ts'
import {
  rowWhereabouts,
  sliceCountLabel,
  whereabouts,
  whereaboutsByPerson,
  whereaboutsText,
  type WhereaboutsSlice,
} from './whereabouts.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

function at(specs: readonly OpSpec[], counter: number): OpEnvelope[] {
  return specs.map((s) => anOp(s, { hlc: hlcAt(counter), deviceId: DEV_A }))
}

function one(spec: OpSpec, counter: number): OpEnvelope {
  return anOp(spec, { hlc: hlcAt(counter), deviceId: DEV_A })
}

/** Stamps each spec with its own increasing clock, in authoring order. */
function log(specs: readonly OpSpec[], from = 0): OpEnvelope[] {
  return specs.map((spec, index) =>
    anOp(spec, { hlc: hlcAt(from + index + 1), deviceId: DEV_A }),
  )
}

/** The trip slices of one Gear's answer, in the order `whereabouts` returns them. */
function tripSlices(
  state: DepotState,
  gearId: string,
): readonly Extract<WhereaboutsSlice, { kind: 'trip' }>[] {
  return whereabouts(state, gearId).slices.filter(
    (slice): slice is Extract<WhereaboutsSlice, { kind: 'trip' }> =>
      slice.kind === 'trip',
  )
}

function homeSlice(
  state: DepotState,
  gearId: string,
): Extract<WhereaboutsSlice, { kind: 'home' }> {
  const slice = whereabouts(state, gearId).slices[0]
  if (slice === undefined || slice.kind !== 'home') {
    throw new Error('the first slice is always the home slice')
  }
  return slice
}

describe('whereabouts — the home slice', () => {
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
      overClaimed: false,
      slices: [
        {
          kind: 'home',
          path: [
            { kind: 'place', id: 'attic', name: 'Attic' },
            { kind: 'gear', id: 'shelf', name: 'Shelf L-Top' },
            { kind: 'gear', id: 'crate', name: 'Crate B' },
          ],
          count: null,
        },
      ],
    })
  })

  it('reports no count at all for single and per-person gear (D1)', () => {
    const ops = [
      ...at(aGear({ id: 'tent', name: 'Tent', kind: 'single' }), 1),
      ...at(aGear({ id: 'mug', name: 'Mug', kind: 'per_person' }), 2),
    ]
    const state = fold(ops)

    expect(homeSlice(state, 'tent').count).toBeNull()
    expect(homeSlice(state, 'mug').count).toBeNull()
  })

  it('reports the owned-count for counted gear', () => {
    const ops = [
      ...at(
        aGear({ id: 'peg', name: 'Tent peg', kind: 'counted', ownedCount: 6 }),
        1,
      ),
    ]
    const state = fold(ops)

    expect(homeSlice(state, 'peg').count).toBe(6)
  })

  it('reports no count once counted gear is edited back to single', () => {
    // `gear.kind_set` touches only the `kind` register — per-field LWW
    // cascades nothing (§5.3 obligation 4) — so `ownedCount` still reads `6`
    // underneath. `ownedCountOf` is the one gate; reading the register here
    // would report `×6 THERE` for a Gear whose fact line says `ITEM · SHARED`.
    const ops = [
      ...at(
        aGear({ id: 'mug', name: 'Mug', kind: 'counted', ownedCount: 6 }),
        1,
      ),
      one(gearKindSet('mug', 'single'), 2),
    ]
    const state = fold(ops)

    expect(state.gear['mug']?.ownedCount?.value).toBe(6)
    expect(homeSlice(state, 'mug').count).toBeNull()
  })

  it('reports an empty path for loose gear', () => {
    const ops = [...at(aGear({ id: 'axe', name: 'Axe' }), 1)]
    const state = fold(ops)

    expect(whereabouts(state, 'axe')).toEqual({
      gearId: 'axe',
      overClaimed: false,
      slices: [{ kind: 'home', path: [], count: null }],
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
      overClaimed: false,
      slices: [{ kind: 'home', path: [], count: null }],
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

const TRIP = 't-alps'
const OTHER = 't-vosges'

/** One Gear, one Trip, one Entry — the smallest arrangement with a trip slice. */
function arrangement(phase: 'draft' | 'pack_out' | 'closed'): OpSpec[] {
  return [
    ...aGear({ id: 'g-tent', name: 'Tent' }),
    ...aTrip({ id: TRIP, name: 'Alps 2026', phase }),
    tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
  ]
}

describe('whereabouts — active Trips only (§2.2)', () => {
  it("does not consult a Draft's arrangement", () => {
    const state = fold(log(arrangement('draft')))
    expect(tripSlices(state, 'g-tent')).toEqual([])
  })

  it("does not consult a Closed Trip's arrangement", () => {
    const state = fold(log(arrangement('closed')))
    expect(tripSlices(state, 'g-tent')).toEqual([])
  })

  it('counts the same arrangement after one trip.phase_moved into pack_out', () => {
    const specs = arrangement('draft')
    const base = fold(log(specs))
    const state = fold(
      log([tripPhaseMoved(TRIP, 'pack_out')], specs.length),
      base,
    )

    expect(tripSlices(state, 'g-tent')).toEqual([
      {
        kind: 'trip',
        tripId: TRIP,
        tripName: 'Alps 2026',
        container: null,
        stage: null,
        count: null,
        pieceCount: null,
      },
    ])
  })

  it('disagrees with the TRIP dimension about a Draft, and must keep doing so (§2.2)', () => {
    // Membership is a property of a **list**; whereabouts is a claim about
    // where a thing physically is. A Draft's gear list speaks for the Gear
    // (`TRIP: ALPS 2026`) and has moved nothing (`⌂ HOME`). Both are right,
    // and the symptom of somebody unifying the two rules is a Depot claiming
    // that a Trip nobody has started has taken the tent.
    const state = fold(log(arrangement('draft')))
    const gear = state.gear['g-tent']
    if (gear === undefined) throw new Error('gear')

    expect(dimension('trip').valuesOf(gear, state)).toEqual([TRIP])
    expect(tripSlices(state, 'g-tent')).toEqual([])
    expect(rowWhereabouts(whereabouts(state, 'g-tent'))).toEqual({
      text: '⌂ HOME',
      tone: 'home',
    })
  })
})

describe('whereabouts — the unit that splits (D1)', () => {
  it('splits a Counted gear: home is owned minus every Bring-count', () => {
    const state = fold(
      log([
        ...aGear({ id: 'g-peg', name: 'Peg', kind: 'counted', ownedCount: 6 }),
        ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
        tripEntryAdded(TRIP, 'e-peg', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(TRIP, 'e-peg', 4),
      ]),
    )

    expect(homeSlice(state, 'g-peg').count).toBe(2)
    const [slice] = tripSlices(state, 'g-peg')
    expect(slice?.count).toBe(4)
    expect(slice?.pieceCount).toBeNull()
  })

  it('splits per-person gear over Pieces, with no count on either side', () => {
    const state = fold(
      log([
        ...aPerson({ id: 'p-mark', name: 'Mark' }),
        ...aPerson({ id: 'p-kim', name: 'Kim' }),
        ...aPerson({ id: 'p-ana', name: 'Ana' }),
        ...aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
        ...aTrip({
          id: TRIP,
          name: 'Alps 2026',
          phase: 'pack_out',
          participants: ['p-mark', 'p-kim', 'p-ana'],
        }),
        tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: 'g-lamp' }),
        tripPieceRemoved(TRIP, 'e-lamp', 'p-kim'),
      ]),
    )

    expect(homeSlice(state, 'g-lamp').count).toBeNull()
    const [slice] = tripSlices(state, 'g-lamp')
    expect(slice?.count).toBeNull()
    expect(slice?.pieceCount).toBe(2)
  })

  it('gives a Single gear no count on either slice, and keeps its home row', () => {
    const state = fold(log(arrangement('pack_out')))

    const answer = whereabouts(state, 'g-tent')
    expect(answer.slices).toHaveLength(2)
    expect(answer.slices[0]).toEqual({ kind: 'home', path: [], count: null })
    const [slice] = tripSlices(state, 'g-tent')
    expect(slice?.count).toBeNull()
    expect(slice?.pieceCount).toBeNull()
  })
})

describe('whereabouts — one slice per Trip, segment by segment (D2)', () => {
  it('collapses two Entries on one Trip naming one Gear into one slice', () => {
    const state = fold(
      log([
        ...aGear({ id: 'g-peg', name: 'Peg', kind: 'counted', ownedCount: 9 }),
        ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
        tripEntryAdded(TRIP, 'e-a', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(TRIP, 'e-a', 2),
        tripEntryAdded(TRIP, 'e-b', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(TRIP, 'e-b', 3),
      ]),
    )

    const slices = tripSlices(state, 'g-peg')
    expect(slices).toHaveLength(1)
    expect(slices[0]?.count).toBe(5)
    expect(homeSlice(state, 'g-peg').count).toBe(4)
  })

  it('reads a per-person Entry whose Pieces are apart as MIXED, and never twice', () => {
    const state = fold(
      log([
        ...aPerson({ id: 'p-mark', name: 'Mark' }),
        ...aPerson({ id: 'p-kim', name: 'Kim' }),
        ...aGear({ id: 'g-duffel', name: 'Duffel 90 L', container: true }),
        ...aGear({ id: 'g-crate', name: 'Crate B', container: true }),
        ...aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
        ...aTrip({
          id: TRIP,
          name: 'Alps 2026',
          phase: 'pack_out',
          participants: ['p-mark', 'p-kim'],
        }),
        tripEntryAdded(TRIP, 'e-duffel', {
          from: 'depot',
          gearId: 'g-duffel',
        }),
        tripContainerStageSet(TRIP, 'e-duffel', 'car'),
        tripEntryAdded(TRIP, 'e-crate', { from: 'depot', gearId: 'g-crate' }),
        tripContainerStageSet(TRIP, 'e-crate', 'car'),
        tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: 'g-lamp' }),
        tripPieceMoved(TRIP, 'e-lamp', 'p-mark', {
          in: 'container',
          entryId: 'e-duffel',
        }),
        tripPieceMoved(TRIP, 'e-lamp', 'p-kim', {
          in: 'container',
          entryId: 'e-crate',
        }),
      ]),
    )

    const [slice] = tripSlices(state, 'g-lamp')
    expect(slice?.container).toEqual({ of: 'mixed' })
    // Both crates are loose but staged in the car, so the stage still
    // agrees — the two segments resolve on their own.
    expect(slice?.stage).toBe('car')
    expect(whereaboutsText(slice as WhereaboutsSlice, 'full')).toBe(
      '▸ Alps 2026 · MIXED · CAR',
    )
  })

  it('reads MIXED with its stage when two containers share a chain root', () => {
    // Two Pieces in two different containers, both riding in the duffel. The
    // container segment disagrees; the stage segment does not, because both
    // chains root at the same container.
    const state = fold(
      log([
        ...aPerson({ id: 'p-mark', name: 'Mark' }),
        ...aPerson({ id: 'p-kim', name: 'Kim' }),
        ...aGear({ id: 'g-duffel', name: 'Duffel 90 L', container: true }),
        ...aGear({ id: 'g-crate', name: 'Crate B', container: true }),
        ...aGear({ id: 'g-sack', name: 'Stuff sack', container: true }),
        ...aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
        ...aTrip({
          id: TRIP,
          name: 'Alps 2026',
          phase: 'pack_out',
          participants: ['p-mark', 'p-kim'],
        }),
        tripEntryAdded(TRIP, 'e-duffel', {
          from: 'depot',
          gearId: 'g-duffel',
        }),
        tripContainerStageSet(TRIP, 'e-duffel', 'car'),
        tripEntryAdded(TRIP, 'e-crate', { from: 'depot', gearId: 'g-crate' }),
        tripEntryMoved(TRIP, 'e-crate', {
          in: 'container',
          entryId: 'e-duffel',
        }),
        tripEntryAdded(TRIP, 'e-sack', { from: 'depot', gearId: 'g-sack' }),
        tripEntryMoved(TRIP, 'e-sack', {
          in: 'container',
          entryId: 'e-duffel',
        }),
        tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: 'g-lamp' }),
        tripPieceMoved(TRIP, 'e-lamp', 'p-mark', {
          in: 'container',
          entryId: 'e-crate',
        }),
        tripPieceMoved(TRIP, 'e-lamp', 'p-kim', {
          in: 'container',
          entryId: 'e-sack',
        }),
      ]),
    )

    const [slice] = tripSlices(state, 'g-lamp')
    expect(slice?.container).toEqual({ of: 'mixed' })
    expect(slice?.stage).toBe('car')
    expect(whereaboutsText(slice as WhereaboutsSlice, 'full')).toBe(
      '▸ Alps 2026 · MIXED · CAR',
    )
  })

  it('drops a disagreeing stage without ever drawing a second MIXED', () => {
    // The same two containers, now rooted apart: the crate rides in the car,
    // the stuff sack stands loose at `home`. Both segments disagree, and the
    // stage one **drops** rather than repeating `MIXED`.
    const state = fold(
      log([
        ...aPerson({ id: 'p-mark', name: 'Mark' }),
        ...aPerson({ id: 'p-kim', name: 'Kim' }),
        ...aGear({ id: 'g-crate', name: 'Crate B', container: true }),
        ...aGear({ id: 'g-sack', name: 'Stuff sack', container: true }),
        ...aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
        ...aTrip({
          id: TRIP,
          name: 'Alps 2026',
          phase: 'pack_out',
          participants: ['p-mark', 'p-kim'],
        }),
        tripEntryAdded(TRIP, 'e-crate', { from: 'depot', gearId: 'g-crate' }),
        tripContainerStageSet(TRIP, 'e-crate', 'car'),
        tripEntryAdded(TRIP, 'e-sack', { from: 'depot', gearId: 'g-sack' }),
        // No `trip.container_stage_set` on the sack: an absent stage reads
        // `home`, which is a stage and not the absence of one.
        tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: 'g-lamp' }),
        tripPieceMoved(TRIP, 'e-lamp', 'p-mark', {
          in: 'container',
          entryId: 'e-crate',
        }),
        tripPieceMoved(TRIP, 'e-lamp', 'p-kim', {
          in: 'container',
          entryId: 'e-sack',
        }),
      ]),
    )

    const [slice] = tripSlices(state, 'g-lamp')
    expect(slice?.container).toEqual({ of: 'mixed' })
    expect(slice?.stage).toBeNull()
    expect(whereaboutsText(slice as WhereaboutsSlice, 'full')).toBe(
      '▸ Alps 2026 · MIXED',
    )
  })

  it('reads MIXED when one Piece is held and another is loose', () => {
    // A **loose** residence is a residence, and `sameTripResidence` is what
    // says so — the same test `PackingRow` already draws `▸ MIXED` from on
    // F4 for this exact arrangement (D2: `MIXED` is *already the app's word
    // for this fact*). Naming the crate here would have gear detail and F4
    // state two different things about one set.
    const state = fold(
      log([
        ...aPerson({ id: 'p-mark', name: 'Mark' }),
        ...aPerson({ id: 'p-kim', name: 'Kim' }),
        ...aGear({ id: 'g-crate', name: 'Crate B', container: true }),
        ...aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
        ...aTrip({
          id: TRIP,
          name: 'Alps 2026',
          phase: 'pack_out',
          participants: ['p-mark', 'p-kim'],
        }),
        tripEntryAdded(TRIP, 'e-crate', { from: 'depot', gearId: 'g-crate' }),
        tripContainerStageSet(TRIP, 'e-crate', 'car'),
        tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: 'g-lamp' }),
        tripPieceMoved(TRIP, 'e-lamp', 'p-mark', {
          in: 'container',
          entryId: 'e-crate',
        }),
      ]),
    )

    const [slice] = tripSlices(state, 'g-lamp')
    expect(slice?.container).toEqual({ of: 'mixed' })
    expect(slice?.stage).toBeNull()
  })

  it('reads all-loose residences as no container and no stage', () => {
    const state = fold(log(arrangement('pack_out')))
    const [slice] = tripSlices(state, 'g-tent')

    expect(slice?.container).toBeNull()
    expect(slice?.stage).toBeNull()
    expect(whereaboutsText(slice as WhereaboutsSlice, 'full')).toBe(
      '▸ Alps 2026 · LOOSE',
    )
  })
})

/**
 * A stove in `Crate B` (rail `HOME`) inside `Duffel 90 L` (rail `CAR`) —
 * D3's own worked example, plus the container-Gear cases beside it.
 */
const NESTED: readonly OpSpec[] = [
  ...aGear({ id: 'g-duffel', name: 'Duffel 90 L', container: true }),
  ...aGear({ id: 'g-crate', name: 'Crate B', container: true }),
  ...aGear({ id: 'g-stove', name: 'Stove' }),
  ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
  tripEntryAdded(TRIP, 'e-duffel', { from: 'depot', gearId: 'g-duffel' }),
  tripContainerStageSet(TRIP, 'e-duffel', 'car'),
  tripEntryAdded(TRIP, 'e-crate', { from: 'depot', gearId: 'g-crate' }),
  tripEntryMoved(TRIP, 'e-crate', { in: 'container', entryId: 'e-duffel' }),
  // No `trip.container_stage_set` on the crate: an absent `stage` reads
  // `home` — and it is the *root's* stage that the slice reports.
  tripEntryAdded(TRIP, 'e-stove', { from: 'depot', gearId: 'g-stove' }),
  tripEntryMoved(TRIP, 'e-stove', { in: 'container', entryId: 'e-crate' }),
]

describe('whereabouts — the stage is the chain root’s (D3)', () => {
  it('reads CRATE B · CAR for a stove in a home crate inside a car duffel', () => {
    const state = fold(log(NESTED))
    const [slice] = tripSlices(state, 'g-stove')

    expect(slice?.container).toEqual({
      of: 'one',
      entryId: 'e-crate',
      name: 'Crate B',
    })
    expect(slice?.stage).toBe('car')
    expect(whereaboutsText(slice as WhereaboutsSlice, 'full')).toBe(
      '▸ Alps 2026 · Crate B · CAR',
    )
  })

  it('gives a Gear that is itself the loose trip container no container and its own stage', () => {
    const state = fold(log(NESTED))
    const [slice] = tripSlices(state, 'g-duffel')

    expect(slice?.container).toBeNull()
    expect(slice?.stage).toBe('car')
  })

  it('reads a nested container Gear like anything else inside', () => {
    const state = fold(log(NESTED))
    const [crate] = tripSlices(state, 'g-crate')
    const [stove] = tripSlices(state, 'g-stove')

    // The crate is a container with its own `home` stage; nested, it reports
    // its holder and the *root's* stage, exactly as the stove beside it does.
    expect(crate?.container).toEqual({
      of: 'one',
      entryId: 'e-duffel',
      name: 'Duffel 90 L',
    })
    expect(crate?.stage).toBe('car')
    expect(crate?.stage).toBe(stove?.stage)
  })
})

describe('whereabouts — a container Entry’s residence is its own (the container check first)', () => {
  /**
   * A **per-person container**: `container` and `kind` are orthogonal
   * registers on the Gear, so a family stuff-sack recorded per-person and
   * carrying the containment trait is authorable — the shape S9a found for
   * the Counted container.
   *
   * **This fixture pins `view.holderOf(entry.id)` and not
   * `entryResidenceOf`.** That gate answers `null` for a per-person Entry
   * (§5e C0: for per-person gear *where it is* is only ever a per-Piece
   * fact), which is right for a thing that travels and wrong for a
   * container: a container is one thing wherever it rides, its own residence
   * is an Entry-level fact whatever its Kind, and reading it through the gate
   * would draw this sack **loose** while F4 draws it in the duffel, in the
   * car. Every other container in this file is Single or Counted, where the
   * two functions agree — so without this case, swapping `holderOf` back for
   * `entryResidenceOf` passes the whole suite.
   */
  const perPersonContainer: readonly OpSpec[] = [
    ...aPerson({ id: 'p-mark', name: 'Mark' }),
    ...aPerson({ id: 'p-kim', name: 'Kim' }),
    ...aGear({ id: 'g-duffel', name: 'Duffel 90 L', container: true }),
    ...aGear({
      id: 'g-sack',
      name: 'Stuff sack',
      container: true,
      kind: 'per_person',
    }),
    ...aTrip({
      id: TRIP,
      name: 'Alps 2026',
      phase: 'pack_out',
      participants: ['p-mark', 'p-kim'],
    }),
    tripEntryAdded(TRIP, 'e-duffel', { from: 'depot', gearId: 'g-duffel' }),
    tripContainerStageSet(TRIP, 'e-duffel', 'car'),
    tripEntryAdded(TRIP, 'e-sack', { from: 'depot', gearId: 'g-sack' }),
    tripEntryMoved(TRIP, 'e-sack', { in: 'container', entryId: 'e-duffel' }),
    tripContainerStageSet(TRIP, 'e-sack', 'staging'),
  ]

  it('reports a per-person container’s own residence and its own stage', () => {
    const state = fold(log(perPersonContainer))
    const [slice] = tripSlices(state, 'g-sack')

    // Its own single residence — the duffel — and not `LOOSE`, which is what
    // `entryResidenceOf`'s per-person `null` would have produced.
    expect(slice?.container).toEqual({
      of: 'one',
      entryId: 'e-duffel',
      name: 'Duffel 90 L',
    })
    // Its own stage: the chain starts at the sack itself because the sack is
    // a container, and the root of `[sack, duffel]` is the duffel — `car`,
    // never the sack's own `staging`, which is D3 holding for this Kind too.
    expect(slice?.stage).toBe('car')
    expect(whereaboutsText(slice as WhereaboutsSlice, 'full')).toBe(
      '▸ Alps 2026 · Duffel 90 L · CAR',
    )
    // Counts still follow **Kind**, never the container trait: two included
    // Pieces, no quantity.
    expect(slice?.pieceCount).toBe(2)
    expect(slice?.count).toBeNull()
  })

  it('gives every Participant that same container read, not a per-Piece one', () => {
    const state = fold(log(perPersonContainer))
    const byPerson = whereaboutsByPerson(state, 'g-sack')

    // A container is one thing wherever it rides, so there is no per-Piece
    // residence to refine it with: both Participants read the Entry's own.
    for (const personId of ['p-mark', 'p-kim']) {
      expect(byPerson.get(personId)?.slice).toEqual({
        kind: 'trip',
        tripId: TRIP,
        tripName: 'Alps 2026',
        container: { of: 'one', entryId: 'e-duffel', name: 'Duffel 90 L' },
        stage: 'car',
        count: null,
        pieceCount: 1,
      })
    }
  })
})

describe('whereabouts — unresolvable residences read loose', () => {
  const base: readonly OpSpec[] = [
    ...aGear({ id: 'g-crate', name: 'Crate B', container: true }),
    ...aGear({ id: 'g-tent', name: 'Tent' }),
    ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
    tripEntryAdded(TRIP, 'e-crate', { from: 'depot', gearId: 'g-crate' }),
    tripContainerStageSet(TRIP, 'e-crate', 'car'),
    tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
  ]

  it('reads a pointer at a removed Entry as loose', () => {
    const state = fold(
      log([
        ...base,
        tripEntryMoved(TRIP, 'e-tent', {
          in: 'container',
          entryId: 'e-crate',
        }),
        tripEntryRemoved(TRIP, 'e-crate'),
      ]),
    )

    const [slice] = tripSlices(state, 'g-tent')
    expect(slice?.container).toBeNull()
    expect(slice?.stage).toBeNull()
  })

  it('reads a pointer at a non-container Entry as loose', () => {
    const state = fold(
      log([
        ...base,
        ...aGear({ id: 'g-rope', name: 'Rope' }),
        tripEntryAdded(TRIP, 'e-rope', { from: 'depot', gearId: 'g-rope' }),
        tripEntryMoved(TRIP, 'e-tent', { in: 'container', entryId: 'e-rope' }),
      ]),
    )

    const [slice] = tripSlices(state, 'g-tent')
    expect(slice?.container).toBeNull()
  })

  it('reads a pointer at an Entry this replica has not folded as loose', () => {
    const state = fold(
      log([
        ...base,
        tripEntryMoved(TRIP, 'e-tent', { in: 'container', entryId: 'e-ghost' }),
      ]),
    )

    const [slice] = tripSlices(state, 'g-tent')
    expect(slice?.container).toBeNull()
  })
})

describe('whereaboutsText — B1’s ladder (§3.2)', () => {
  const home: WhereaboutsSlice = {
    kind: 'home',
    path: [
      { kind: 'place', id: 'hal', name: 'Hal' },
      { kind: 'gear', id: 'lade', name: 'Lade 2' },
    ],
    count: null,
  }
  const trip: WhereaboutsSlice = {
    kind: 'trip',
    tripId: TRIP,
    tripName: 'Alps 2026',
    container: { of: 'one', entryId: 'e-duffel', name: 'Duffel 90 L' },
    stage: 'car',
    count: null,
    pieceCount: 2,
  }

  it('draws the trip slice at three densities', () => {
    expect(whereaboutsText(trip, 'full')).toBe(
      '▸ Alps 2026 · Duffel 90 L · CAR',
    )
    expect(whereaboutsText(trip, 'column')).toBe('▸ Alps 2026 · CAR')
    expect(whereaboutsText(trip, 'chip')).toBe('▸ Alps 2026')
  })

  it('draws the home slice as the path, except at column density', () => {
    expect(whereaboutsText(home, 'full')).toBe('⌂ Hal ▸ Lade 2')
    expect(whereaboutsText(home, 'column')).toBe('⌂ HOME')
    expect(whereaboutsText(home, 'chip')).toBe('⌂ Hal ▸ Lade 2')
  })

  it('draws a home slice with no path as LOOSE', () => {
    expect(whereaboutsText({ ...home, path: [] }, 'full')).toBe('⌂ LOOSE')
    expect(whereaboutsText({ ...home, path: [] }, 'chip')).toBe('⌂ LOOSE')
    expect(whereaboutsText({ ...home, path: [] }, 'column')).toBe('⌂ HOME')
  })

  it('draws MIXED and LOOSE in the container segment', () => {
    expect(
      whereaboutsText({ ...trip, container: { of: 'mixed' } }, 'full'),
    ).toBe('▸ Alps 2026 · MIXED · CAR')
    expect(whereaboutsText({ ...trip, container: null }, 'full')).toBe(
      '▸ Alps 2026 · LOOSE · CAR',
    )
  })

  it('renders an unrecognised stage verbatim', () => {
    expect(whereaboutsText({ ...trip, stage: 'in_the_shed' }, 'column')).toBe(
      '▸ Alps 2026 · in_the_shed',
    )
  })
})

describe('sliceCountLabel — D1’s rule', () => {
  it('names the unit that splits, and nothing when none does', () => {
    expect(sliceCountLabel({ kind: 'home', path: [], count: 2 })).toBe(
      '×2 THERE',
    )
    expect(sliceCountLabel({ kind: 'home', path: [], count: null })).toBeNull()

    const trip = {
      kind: 'trip',
      tripId: TRIP,
      tripName: 'Alps 2026',
      container: null,
      stage: null,
    } as const
    expect(sliceCountLabel({ ...trip, count: 1, pieceCount: null })).toBe(
      '×1 OUT',
    )
    expect(sliceCountLabel({ ...trip, count: null, pieceCount: 2 })).toBe(
      '2 PIECES OUT',
    )
    expect(sliceCountLabel({ ...trip, count: null, pieceCount: 1 })).toBe(
      '1 PIECE OUT',
    )
    expect(
      sliceCountLabel({ ...trip, count: null, pieceCount: null }),
    ).toBeNull()
  })
})

describe('rowWhereabouts — B2’s single-slot read (§3.3)', () => {
  it('reads ⌂ HOME with the home tone when no Trip claims the gear', () => {
    const state = fold(log(arrangement('draft')))
    expect(rowWhereabouts(whereabouts(state, 'g-tent'))).toEqual({
      text: '⌂ HOME',
      tone: 'home',
    })
  })

  it('reads the one trip slice at column density, with the trip tone', () => {
    const state = fold(log(NESTED))
    expect(rowWhereabouts(whereabouts(state, 'g-stove'))).toEqual({
      text: '▸ Alps 2026 · CAR',
      tone: 'trip',
    })
  })

  it('reads ▸ N TRIPS once two Trips claim the gear', () => {
    const state = fold(
      log([
        ...aGear({ id: 'g-peg', name: 'Peg', kind: 'counted', ownedCount: 9 }),
        ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
        ...aTrip({ id: OTHER, name: 'Vosges', phase: 'on_trip' }),
        tripEntryAdded(TRIP, 'e-a', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(TRIP, 'e-a', 2),
        tripEntryAdded(OTHER, 'e-b', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(OTHER, 'e-b', 2),
      ]),
    )

    expect(rowWhereabouts(whereabouts(state, 'g-peg'))).toEqual({
      text: '▸ 2 TRIPS',
      tone: 'trip',
    })
    // Home first, then trip slices by name A→Z.
    expect(tripSlices(state, 'g-peg').map((slice) => slice.tripName)).toEqual([
      'Alps 2026',
      'Vosges',
    ])
  })
})

describe('whereabouts — the over-claim is a Whereabouts fact (D8)', () => {
  /** ×2 owned, ×2 claimed on each of two active Trips. */
  const overClaimed: readonly OpSpec[] = [
    ...aGear({ id: 'g-peg', name: 'Peg', kind: 'counted', ownedCount: 2 }),
    ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
    ...aTrip({ id: OTHER, name: 'Vosges', phase: 'on_trip' }),
    tripEntryAdded(TRIP, 'e-a', { from: 'depot', gearId: 'g-peg' }),
    tripEntryBringCountSet(TRIP, 'e-a', 2),
    tripEntryAdded(OTHER, 'e-b', { from: 'depot', gearId: 'g-peg' }),
    tripEntryBringCountSet(OTHER, 'e-b', 2),
  ]

  it('floors the home count at zero rather than going negative', () => {
    const state = fold(log(overClaimed))
    expect(homeSlice(state, 'g-peg').count).toBe(0)
  })

  it('keeps the trip counts honest and rides overClaimed on the answer', () => {
    const state = fold(log(overClaimed))
    const answer = whereabouts(state, 'g-peg')

    expect(answer.overClaimed).toBe(true)
    expect(tripSlices(state, 'g-peg').map((slice) => slice.count)).toEqual([
      2, 2,
    ])
  })

  it('swaps the glyph and the tone on the one-slot read', () => {
    const state = fold(log(overClaimed))
    expect(rowWhereabouts(whereabouts(state, 'g-peg'))).toEqual({
      text: '▲ 2 TRIPS',
      tone: 'attention',
    })
  })

  it('swaps the glyph for a one-Trip over-claim too (§6.1)', () => {
    const state = fold(
      log([
        ...aGear({ id: 'g-peg', name: 'Peg', kind: 'counted', ownedCount: 2 }),
        ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
        tripEntryAdded(TRIP, 'e-a', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(TRIP, 'e-a', 4),
      ]),
    )

    expect(whereabouts(state, 'g-peg').overClaimed).toBe(true)
    expect(rowWhereabouts(whereabouts(state, 'g-peg'))).toEqual({
      text: '▲ Alps 2026',
      tone: 'attention',
    })
  })

  it('reports no over-claim when the supply covers the claims', () => {
    const state = fold(
      log([
        ...aGear({ id: 'g-peg', name: 'Peg', kind: 'counted', ownedCount: 6 }),
        ...aTrip({ id: TRIP, name: 'Alps 2026', phase: 'pack_out' }),
        tripEntryAdded(TRIP, 'e-a', { from: 'depot', gearId: 'g-peg' }),
        tripEntryBringCountSet(TRIP, 'e-a', 4),
      ]),
    )

    expect(whereabouts(state, 'g-peg').overClaimed).toBe(false)
  })
})

const MARK = 'p-mark'
const KIM = 'p-kim'
const ANA = 'p-ana'
const ELS = 'p-els'

describe('whereaboutsByPerson — one answer per Participant (D6)', () => {
  /**
   * Alps carries Mark, Kim and Ana; Kim's Piece is removed and Mark's rides
   * in the duffel. Els is recorded but is on no Trip.
   */
  const perPerson: readonly OpSpec[] = [
    ...aPerson({ id: MARK, name: 'Mark' }),
    ...aPerson({ id: KIM, name: 'Kim' }),
    ...aPerson({ id: ANA, name: 'Ana' }),
    ...aPerson({ id: ELS, name: 'Els' }),
    ...aPlace({ id: 'hal', name: 'Hal' }),
    ...aGear({ id: 'g-duffel', name: 'Duffel 90 L', container: true }),
    ...aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
    gearRehomed('g-lamp', { in: 'place', id: 'hal' }),
    ...aTrip({
      id: TRIP,
      name: 'Alps 2026',
      phase: 'pack_out',
      participants: [MARK, KIM, ANA],
    }),
    tripEntryAdded(TRIP, 'e-duffel', { from: 'depot', gearId: 'g-duffel' }),
    tripContainerStageSet(TRIP, 'e-duffel', 'car'),
    tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: 'g-lamp' }),
    tripPieceRemoved(TRIP, 'e-lamp', KIM),
    tripPieceMoved(TRIP, 'e-lamp', MARK, {
      in: 'container',
      entryId: 'e-duffel',
    }),
  ]

  it("keys on the claiming Trip's Participants, and nobody else", () => {
    const state = fold(log(perPerson))
    const byPerson = whereaboutsByPerson(state, 'g-lamp')

    expect([...byPerson.keys()].sort()).toEqual([ANA, KIM, MARK].sort())
    expect(byPerson.has(ELS)).toBe(false)
  })

  it('carries each Participant’s own Piece residence, not the Entry-wide read', () => {
    const state = fold(log(perPerson))
    const byPerson = whereaboutsByPerson(state, 'g-lamp')

    // The Entry-wide reconciliation is `MIXED` — Mark's Piece rides in the
    // duffel and Ana's is loose, and a loose residence is a residence.
    // Neither Person reads that; each reads their own Piece's.
    expect(tripSlices(state, 'g-lamp')[0]).toMatchObject({
      container: { of: 'mixed' },
      stage: null,
    })

    expect(byPerson.get(MARK)?.slice).toEqual({
      kind: 'trip',
      tripId: TRIP,
      tripName: 'Alps 2026',
      container: { of: 'one', entryId: 'e-duffel', name: 'Duffel 90 L' },
      stage: 'car',
      count: null,
      pieceCount: 1,
    })
    expect(byPerson.get(ANA)?.slice).toEqual({
      kind: 'trip',
      tripId: TRIP,
      tripName: 'Alps 2026',
      container: null,
      stage: null,
      count: null,
      pieceCount: 1,
    })
  })

  it('reads a Participant with a removed Piece as home, saying nothing of the removal (B5)', () => {
    const state = fold(log(perPerson))
    const kim = whereaboutsByPerson(state, 'g-lamp').get(KIM)

    expect(kim?.slice).toEqual({
      kind: 'home',
      path: [{ kind: 'place', id: 'hal', name: 'Hal' }],
      count: null,
    })
    expect(kim?.contestedTripIds).toEqual([])
  })

  it('unions both Participant sets when two Trips claim, and names the contested', () => {
    const state = fold(
      log([
        ...perPerson,
        ...aTrip({
          id: OTHER,
          name: 'Vosges',
          phase: 'on_trip',
          participants: [MARK, ELS],
        }),
        tripEntryAdded(OTHER, 'e-lamp-2', {
          from: 'depot',
          gearId: 'g-lamp',
        }),
      ]),
    )
    const byPerson = whereaboutsByPerson(state, 'g-lamp')

    expect([...byPerson.keys()].sort()).toEqual([ANA, ELS, KIM, MARK].sort())
    // Mark's Piece is on both — the over-claim that D7's `RESOLVE` settles.
    expect(byPerson.get(MARK)?.contestedTripIds).toEqual([TRIP, OTHER])
    // Els is a Participant of Vosges only, so her one Piece is not contested.
    expect(byPerson.get(ELS)?.contestedTripIds).toEqual([])
    expect(byPerson.get(ELS)?.slice.kind).toBe('trip')
    // Kim is a Participant of Alps only and her Piece there is removed.
    expect(byPerson.get(KIM)?.slice.kind).toBe('home')
  })

  it('reads every Participant as home for a Gear with no Pieces', () => {
    const state = fold(
      log([
        ...aPerson({ id: MARK, name: 'Mark' }),
        ...aGear({ id: 'g-tent', name: 'Tent' }),
        ...aTrip({
          id: TRIP,
          name: 'Alps 2026',
          phase: 'pack_out',
          participants: [MARK],
        }),
        tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: 'g-tent' }),
      ]),
    )

    expect(whereaboutsByPerson(state, 'g-tent').get(MARK)?.slice.kind).toBe(
      'home',
    )
  })
})

describe('whereabouts — the memo is keyed on the fold’s identity', () => {
  it('changes its answer when an op that changes it is folded', () => {
    const specs = arrangement('pack_out')
    const base = fold(log(specs))
    expect(tripSlices(base, 'g-tent')).toHaveLength(1)

    const removed = fold(
      log([tripEntryRemoved(TRIP, 'e-tent')], specs.length),
      base,
    )
    expect(tripSlices(removed, 'g-tent')).toHaveLength(0)
    // The earlier state is untouched — the cache is keyed on identity, not
    // on content, and `DepotState` is immutable.
    expect(tripSlices(base, 'g-tent')).toHaveLength(1)
  })

  it('returns the same answer twice for one state', () => {
    const state = fold(log(NESTED))
    expect(whereabouts(state, 'g-stove')).toEqual(whereabouts(state, 'g-stove'))
  })
})
