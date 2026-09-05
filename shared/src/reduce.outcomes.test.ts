import { describe, expect, it } from 'vitest'

import { anOp, hlcAt } from '../testUtils/index.ts'
import {
  tripConsumedCountSet,
  tripEntryAdded,
  tripOutcomeSet,
  type OpSpec,
} from './authoring.ts'
import { emptyState, fold } from './reduce.ts'
import { entriesOf } from './selectors/entry.ts'
import type { HouseholdState } from './state.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'
const DEFAULT_MS = 1_700_000_000_000

const TRIP = '66666666-0000-7000-8000-000000000001'
const ENTRY = '77777777-0000-7000-8000-000000000001'
const KIM = '88888888-0000-7000-8000-000000000001'
const GEAR = '99999999-0000-7000-8000-000000000001'

function foldOf(...specs: readonly OpSpec[]): HouseholdState {
  return fold(
    specs.map((spec, i) =>
      anOp(spec, { hlc: hlcAt(i + 1, DEFAULT_MS), deviceId: DEV_A }),
    ),
    emptyState(),
  )
}

describe('trip.outcome_set', () => {
  it('writes the Entry when person_id is absent', () => {
    const state = foldOf(tripOutcomeSet(TRIP, ENTRY, 'back'))
    const entry = state.trips[TRIP]?.entries?.[ENTRY]
    expect(entry?.outcome?.value).toBe('back')
    expect(entry?.pieces).toBeUndefined()
  })

  it('writes one Piece when person_id is present, leaving the Entry outcome absent', () => {
    const state = foldOf(tripOutcomeSet(TRIP, ENTRY, 'consumed', KIM))
    const entry = state.trips[TRIP]?.entries?.[ENTRY]
    expect(entry?.pieces?.[KIM]?.outcome?.value).toBe('consumed')
    expect(entry?.outcome).toBeUndefined()
  })

  // spec §1.2: an absent register and one holding an explicit `null` are
  // different facts about the log, and only `outcomeOf` treats them alike.
  it('folds an explicit null as a clearing write, distinct from a field the op never named', () => {
    const cleared = foldOf(
      tripOutcomeSet(TRIP, ENTRY, 'back'),
      tripOutcomeSet(TRIP, ENTRY, null),
    )
    const clearedEntry = cleared.trips[TRIP]?.entries?.[ENTRY]
    // The register exists and holds `null` — not an absent register.
    expect(clearedEntry?.outcome).toBeDefined()
    expect(clearedEntry?.outcome?.value).toBeNull()

    // An op naming `entry_id` but never `outcome` leaves the register
    // exactly as it was — the absent-field half of the same pair.
    const untouched = foldOf(tripOutcomeSet(TRIP, ENTRY, 'back'), {
      aggregate: 'trip',
      aggregate_id: TRIP,
      type: 'trip.outcome_set',
      payload: { entry_id: ENTRY },
    })
    expect(untouched.trips[TRIP]?.entries?.[ENTRY]?.outcome?.value).toBe('back')
  })

  it('folds an unrecognised outcome verbatim', () => {
    const state = foldOf(tripOutcomeSet(TRIP, ENTRY, 'mislaid'))
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.outcome?.value).toBe('mislaid')
    expect(state.unfolded.count).toBe(0)
  })

  it('lands on the Entry when person_id is present but not a string', () => {
    const state = foldOf({
      aggregate: 'trip',
      aggregate_id: TRIP,
      type: 'trip.outcome_set',
      payload: { entry_id: ENTRY, outcome: 'lost', person_id: 42 },
    } as unknown as OpSpec)
    const entry = state.trips[TRIP]?.entries?.[ENTRY]
    expect(entry?.outcome?.value).toBe('lost')
    expect(entry?.pieces).toBeUndefined()
  })

  it('returns the identical object when a write to the Entry outcome loses LWW', () => {
    const seeded = fold([
      anOp(tripOutcomeSet(TRIP, ENTRY, 'back'), {
        hlc: hlcAt(5, DEFAULT_MS),
        deviceId: DEV_A,
      }),
    ])
    const stale = fold(
      [
        anOp(tripOutcomeSet(TRIP, ENTRY, 'lost'), {
          hlc: hlcAt(1, DEFAULT_MS),
          deviceId: DEV_A,
        }),
      ],
      seeded,
    )
    // `slice.ts`'s WeakMap memo is keyed on the fold's own immutable
    // identity, so a losing write must not return a merely-equal copy.
    expect(stale).toBe(seeded)
  })

  it('returns the identical object when a write to a Piece outcome loses LWW', () => {
    const seeded = fold([
      anOp(tripOutcomeSet(TRIP, ENTRY, 'back', KIM), {
        hlc: hlcAt(5, DEFAULT_MS),
        deviceId: DEV_A,
      }),
    ])
    const stale = fold(
      [
        anOp(tripOutcomeSet(TRIP, ENTRY, 'lost', KIM), {
          hlc: hlcAt(1, DEFAULT_MS),
          deviceId: DEV_A,
        }),
      ],
      seeded,
    )
    expect(stale).toBe(seeded)
  })
})

describe('trip.consumed_count_set', () => {
  it('folds a count on any Entry — the Kind lives on the Gear aggregate', () => {
    const state = foldOf(tripConsumedCountSet(TRIP, ENTRY, 3))
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.consumedCount?.value).toBe(3)
  })

  it('ignores a negative or non-integer count', () => {
    const state = foldOf(
      {
        aggregate: 'trip',
        aggregate_id: TRIP,
        type: 'trip.consumed_count_set',
        payload: { entry_id: ENTRY, count: -1 },
      } as unknown as OpSpec,
      {
        aggregate: 'trip',
        aggregate_id: TRIP,
        type: 'trip.consumed_count_set',
        payload: { entry_id: 'e2', count: 1.5 },
      } as unknown as OpSpec,
    )
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.consumedCount).toBeUndefined()
    expect(state.trips[TRIP]?.entries?.['e2']?.consumedCount).toBeUndefined()
  })

  it('returns the identical object when a write loses LWW', () => {
    const seeded = fold([
      anOp(tripConsumedCountSet(TRIP, ENTRY, 3), {
        hlc: hlcAt(5, DEFAULT_MS),
        deviceId: DEV_A,
      }),
    ])
    const stale = fold(
      [
        anOp(tripConsumedCountSet(TRIP, ENTRY, 1), {
          hlc: hlcAt(1, DEFAULT_MS),
          deviceId: DEV_A,
        }),
      ],
      seeded,
    )
    expect(stale).toBe(seeded)
  })
})

describe('both S10 ops arriving before trip.entry_added', () => {
  it('create a bare Entry that entriesOf still excludes, for lack of a source', () => {
    const state = foldOf(
      tripOutcomeSet(TRIP, ENTRY, 'lost'),
      tripConsumedCountSet(TRIP, ENTRY, 2),
    )
    const trip = state.trips[TRIP]
    expect(trip).toBeDefined()
    const entry = trip?.entries?.[ENTRY]
    expect(entry?.source).toBeUndefined()
    expect(entry?.outcome?.value).toBe('lost')
    expect(entry?.consumedCount?.value).toBe(2)
    expect(entriesOf(trip!, state)).toHaveLength(0)

    // Confirmed once the source arrives, so the fixture above is not
    // accidentally testing a broken `entriesOf` instead.
    const withSource = foldOf(
      tripOutcomeSet(TRIP, ENTRY, 'lost'),
      tripConsumedCountSet(TRIP, ENTRY, 2),
      tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR }),
    )
    expect(entriesOf(withSource.trips[TRIP]!, withSource)).toHaveLength(1)
  })
})
