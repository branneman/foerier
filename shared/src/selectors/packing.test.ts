import { describe, expect, it } from 'vitest'

import { anOp, aGear, hlcAt } from '../../testUtils/index.ts'
import {
  tripContainerStageSet,
  tripEntryAdded,
  tripEntryStatusSet,
  type OpSpec,
} from '../authoring.ts'
import { emptyState, fold } from '../reduce.ts'
import type { DepotState, EntryState } from '../state.ts'
import {
  isKnownStage,
  isKnownStatus,
  isPacked,
  nextStatus,
  pieceStatusOf,
  STAGES,
  stageDisagreementLabel,
  stageOf,
  STATUSES,
  statusLabel,
  statusOf,
} from './packing.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

/** The factories' own default millisecond, so `hlcAt` here matches theirs. */
const DEFAULT_MS = 1_700_000_000_000

const TRIP = 't1'

const CRATE_GEAR = 'g-crate'
const CRATE = 'e-crate'
const STOVE_GEAR = 'g-stove'
const STOVE = 'e-stove'
const PERSON_ENTRY_GEAR = 'g-person'
const PERSON_ENTRY = 'e-person'
const ORPHAN_GEAR = 'g-orphan'
const ORPHAN = 'e-orphan'

/**
 * Folds op specs through the real reducer, stamping each with an increasing
 * clock. Every fixture in this file goes through the fold rather than
 * hand-shaping a `TripState`, so a selector can never pass against a state
 * the reducer could not produce.
 */
function foldAt(ms: number, specs: readonly (readonly OpSpec[])[]): DepotState {
  return fold(
    specs
      .flat()
      .map((spec, i) => anOp(spec, { hlc: hlcAt(i + 1, ms), deviceId: DEV_A })),
    emptyState(),
  )
}

function depot(...specs: readonly (readonly OpSpec[])[]): DepotState {
  return foldAt(DEFAULT_MS, specs)
}

/**
 * Continues a fold from an existing state, stamped strictly after everything
 * already in it — for the tests that ask "what if a peer also wrote the
 * register a gate is about to hide".
 */
function foldMore(state: DepotState, ...specs: readonly OpSpec[]): DepotState {
  return fold(
    specs.map((spec, i) =>
      anOp(spec, { hlc: hlcAt(1000 + i, DEFAULT_MS), deviceId: DEV_A }),
    ),
    state,
  )
}

function entry(state: DepotState, id: string): EntryState {
  return state.trips[TRIP]!.entries![id]!
}

/**
 * A base fold: a container Entry (`CRATE`), a non-container Entry (`STOVE`),
 * a per-person Entry (`PERSON_ENTRY`), and a depot Entry (`ORPHAN`) whose
 * Gear has never been recorded on this replica.
 */
const state = depot(
  aGear({ id: CRATE_GEAR, container: true }),
  aGear({ id: STOVE_GEAR, container: false }),
  aGear({ id: PERSON_ENTRY_GEAR, container: false, kind: 'per_person' }),
  [tripEntryAdded(TRIP, CRATE, { from: 'depot', gearId: CRATE_GEAR })],
  [tripEntryAdded(TRIP, STOVE, { from: 'depot', gearId: STOVE_GEAR })],
  [
    tripEntryAdded(TRIP, PERSON_ENTRY, {
      from: 'depot',
      gearId: PERSON_ENTRY_GEAR,
    }),
  ],
  [tripEntryAdded(TRIP, ORPHAN, { from: 'depot', gearId: ORPHAN_GEAR })],
)

function anEntry(): EntryState {
  return entry(state, STOVE)
}

function aContainer(): EntryState {
  return entry(state, CRATE)
}

function aPerPersonEntry(): EntryState {
  return entry(state, PERSON_ENTRY)
}

describe('the two tables', () => {
  it('lists three statuses and four stages, in drawn order', () => {
    expect(STATUSES.map((s) => s.id)).toEqual([
      'not_packed',
      'staged',
      'packed',
    ])
    expect(STAGES.map((s) => s.id)).toEqual([
      'home',
      'staging',
      'car',
      'packed',
    ])
  })

  it('draws the labels the boards draw', () => {
    expect(STATUSES.map((s) => s.label)).toEqual([
      'NOT PACKED',
      'STAGED',
      'PACKED',
    ])
    expect(STAGES.map((s) => s.label)).toEqual([
      '⌂ HOME',
      'STAGING',
      'CAR',
      'PACKED',
    ])
  })

  it('gives only car and packed a disagreement phrase — staging IS the act', () => {
    expect(stageDisagreementLabel('home')).toBeNull()
    expect(stageDisagreementLabel('staging')).toBeNull()
    expect(stageDisagreementLabel('car')).toBe('IN CAR')
    expect(stageDisagreementLabel('packed')).toBe('PACKED')
  })
})

describe('the absent reads', () => {
  it('reads an Entry with no status register as not_packed', () => {
    // Reachable in ordinary use, not only in a fixture: no op writes the
    // register at `trip.entry_added`, so every Entry begins with neither.
    expect(statusOf(anEntry(), state)).toBe('not_packed')
  })

  it('reads a container with no stage register as home', () => {
    expect(stageOf(aContainer(), state)).toBe('home')
  })

  it('reads a Piece with no status register as not_packed', () => {
    expect(pieceStatusOf(undefined, aPerPersonEntry(), state)).toBe(
      'not_packed',
    )
  })
})

describe('stage xor status is a reader gate, not a reducer gate', () => {
  it('answers null from statusOf for a container, whatever the register holds', () => {
    // A peer on another build may write one; the reader must not reject it.
    const withStatus = foldMore(
      state,
      tripEntryStatusSet(TRIP, CRATE, 'packed'),
    )
    expect(statusOf(entry(withStatus, CRATE), withStatus)).toBeNull()
  })

  it('answers null from stageOf for a non-container, whatever the register holds', () => {
    const withStage = foldMore(state, tripContainerStageSet(TRIP, STOVE, 'car'))
    expect(stageOf(entry(withStage, STOVE), withStage)).toBeNull()
  })

  it('treats a depot Entry whose Gear has not synced as not a container', () => {
    // The Entry names a gear id no `gear.recorded` has arrived for.
    expect(statusOf(entry(state, ORPHAN), state)).toBe('not_packed')
    expect(stageOf(entry(state, ORPHAN), state)).toBeNull()
  })

  it('gains a rail the moment that Gear arrives', () => {
    const after = foldMore(
      state,
      ...aGear({ id: ORPHAN_GEAR, container: true }),
    )
    expect(stageOf(entry(after, ORPHAN), after)).toBe('home')
    expect(statusOf(entry(after, ORPHAN), after)).toBeNull()
  })
})

describe('an unrecognised status', () => {
  it('is drawn verbatim', () => {
    expect(statusLabel('in_the_shed')).toBe('in_the_shed')
  })
  it('is not packed', () => {
    expect(isPacked('in_the_shed')).toBe(false)
  })
  it('cycles to not_packed — the only answer that is not an invention', () => {
    expect(nextStatus('in_the_shed')).toBe('not_packed')
  })
  it('is not known', () => {
    expect(isKnownStatus('in_the_shed')).toBe(false)
    expect(isKnownStage('in_the_shed')).toBe(false)
  })
})

describe('nextStatus', () => {
  it('cycles not_packed to staged to packed and back', () => {
    expect(nextStatus('not_packed')).toBe('staged')
    expect(nextStatus('staged')).toBe('packed')
    expect(nextStatus('packed')).toBe('not_packed')
  })
})

describe('isPacked is the only definition of packed-ness', () => {
  it('does not count staged', () => {
    // The board's `48/61` with `13 LEFT` and the `○ LEFT` pill all read this
    // one predicate; S10's close gate will too.
    expect(isPacked('staged')).toBe(false)
    expect(isPacked('packed')).toBe(true)
    expect(isPacked('not_packed')).toBe(false)
  })
})
