import { describe, expect, it } from 'vitest'

import { aGear, depot, stamp } from '../../testUtils/index.ts'
import {
  tripContainerStageSet,
  tripEntryAdded,
  tripEntryStatusSet,
  type OpSpec,
} from '../authoring.ts'
import { fold } from '../reduce.ts'
import type { DepotState, EntryState } from '../state.ts'
import {
  isKnownStage,
  isKnownStatus,
  isPacked,
  nextStatus,
  pieceStatusOf,
  STAGES,
  stageDisagreementLabel,
  stageLabel,
  stageOf,
  STATUSES,
  statusGlyph,
  statusLabel,
  statusOf,
} from './packing.ts'

const TRIP = 't1'

const CRATE_GEAR = 'g-crate'
const CRATE = 'e-crate'
const STOVE_GEAR = 'g-stove'
const STOVE = 'e-stove'
const PERSON_ENTRY_GEAR = 'g-person'
const PERSON_ENTRY = 'e-person'
const ORPHAN_GEAR = 'g-orphan'
const ORPHAN = 'e-orphan'
const TRIP_ONLY_CONTAINER = 'e-trip-only-container'
const TRIP_ONLY_ITEM = 'e-trip-only-item'

/**
 * Continues a fold from an existing state, stamped strictly after everything
 * already in it — for the tests that ask "what if a peer also wrote the
 * register a gate is about to hide".
 */
function foldMore(state: DepotState, ...specs: readonly OpSpec[]): DepotState {
  return fold(stamp(specs, { start: 1000 }), state)
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
  [
    tripEntryAdded(TRIP, TRIP_ONLY_CONTAINER, {
      from: 'trip_only',
      name: 'Duffel',
      container: true,
    }),
  ],
  [
    tripEntryAdded(TRIP, TRIP_ONLY_ITEM, {
      from: 'trip_only',
      name: 'Rope',
      container: false,
    }),
  ],
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

describe("isContainerEntry's trip-only half", () => {
  // Every other fixture in this file is `{from: 'depot'}`; a trip-only Entry
  // reads its own `source.container` instead of a Gear register, and that
  // branch is otherwise exercised by nothing in this suite.
  it('reads a trip-only container as a container: a journey, never a status', () => {
    const entryState = entry(state, TRIP_ONLY_CONTAINER)
    expect(stageOf(entryState, state)).toBe('home')
    expect(statusOf(entryState, state)).toBeNull()
  })

  it('reads a trip-only non-container as not a container: a status, never a journey', () => {
    const entryState = entry(state, TRIP_ONLY_ITEM)
    expect(statusOf(entryState, state)).toBe('not_packed')
    expect(stageOf(entryState, state)).toBeNull()
  })
})

describe('statusGlyph', () => {
  it("draws each row's own glyph", () => {
    expect(statusGlyph('not_packed')).toBe('○')
    expect(statusGlyph('staged')).toBe('◐')
    expect(statusGlyph('packed')).toBe('●')
  })

  it('falls back to ○ for an unrecognised status — not packed, but the pill still paints', () => {
    expect(statusGlyph('in_the_shed')).toBe('○')
  })
})

describe('stageLabel', () => {
  it("draws each row's own label", () => {
    expect(stageLabel('home')).toBe('⌂ HOME')
    expect(stageLabel('staging')).toBe('STAGING')
    expect(stageLabel('car')).toBe('CAR')
    expect(stageLabel('packed')).toBe('PACKED')
  })

  it('draws an unrecognised stage verbatim', () => {
    expect(stageLabel('in_the_garage')).toBe('in_the_garage')
  })
})

describe('isKnownStatus and isKnownStage', () => {
  it('is true for every row their own table carries', () => {
    expect(isKnownStatus('not_packed')).toBe(true)
    expect(isKnownStatus('staged')).toBe(true)
    expect(isKnownStatus('packed')).toBe(true)
    expect(isKnownStage('home')).toBe(true)
    expect(isKnownStage('staging')).toBe(true)
    expect(isKnownStage('car')).toBe(true)
    expect(isKnownStage('packed')).toBe(true)
  })
})
