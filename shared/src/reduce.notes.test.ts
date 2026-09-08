import { describe, expect, it } from 'vitest'

import { anOp, aTrip, hlcAt } from '../testUtils/index.ts'
import {
  tripEntryAdded,
  tripNoteKept,
  tripNotePosted,
  type OpSpec,
} from './authoring.ts'
import { applyOp, emptyState, fold } from './reduce.ts'
import type { HouseholdState } from './state.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'
const DEFAULT_MS = 1_700_000_000_000

function depot(...specs: readonly (readonly OpSpec[])[]): HouseholdState {
  return fold(
    specs
      .flat()
      .map((spec, i) =>
        anOp(spec, { hlc: hlcAt(i + 1, DEFAULT_MS), deviceId: DEV_A }),
      ),
    emptyState(),
  )
}

const TRIP = '50000000-0000-7000-8000-000000000001'
const ENTRY = 'e0000000-0000-7000-8000-000000000001'
const GEAR = 'a0000000-0000-7000-8000-000000000001'
const NOTE = 'f0000000-0000-7000-8000-000000000001'

/**
 * **S12's two ops** (spec §2, `docs/design/README.md` §5l I9–I20).
 *
 * `notes.<note_id>` is the Trip's third nested entity map, and `writeNote` is
 * `writeEntry`'s twin one map over — so most of what could go wrong here is
 * already pinned by `reduce.pieces.test.ts` and `fixtures.s7`. What is new,
 * and what these cases are actually for, is the pair of readings that the rest
 * of the slice then depends on: `entry_id` is **not** a nullable register, and
 * a Note can legitimately exist holding a `kept` and no `text`.
 */
describe('trip.note_posted', () => {
  it('creates the Note and seeds its text', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripNotePosted(TRIP, NOTE, 'Ran low on gas by day 2.'),
    ])

    expect(state.trips[TRIP]?.notes?.[NOTE]?.text?.value).toBe(
      'Ran low on gas by day 2.',
    )
    expect(state.trips[TRIP]?.notes?.[NOTE]?.entryId).toBeUndefined()
  })

  it('carries entry_id when the Note is about one Entry', () => {
    const state = depot(
      aTrip({ id: TRIP }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripNotePosted(TRIP, NOTE, 'The chair was useless on gravel.', ENTRY)],
    )

    expect(state.trips[TRIP]?.notes?.[NOTE]?.entryId?.value).toBe(ENTRY)
  })

  it('creates the Trip on sight, exactly as any other Trip op does', () => {
    const state = depot([tripNotePosted(TRIP, NOTE, 'Warmer gloves.')])

    expect(state.trips[TRIP]?.notes?.[NOTE]?.text?.value).toBe('Warmer gloves.')
    expect(state.trips[TRIP]?.phase).toBeUndefined()
  })

  it('leaves entry_id alone on an explicit null', () => {
    // Spec §2. `entryId` is `Register<string>`, so sync §1.3's "null clears"
    // does not reach it: the read reports `null`, `writeIfPresent` matches no
    // branch, and the register stands. Deliberate rather than incidental —
    // no op in the catalogue detaches a Note from its Entry, so honouring
    // this would be inventing the clear ruling I10 declined.
    const state = depot(
      aTrip({ id: TRIP }),
      [tripNotePosted(TRIP, NOTE, 'About the chair.', ENTRY)],
      [
        {
          type: 'trip.note_posted',
          aggregate: 'trip',
          aggregate_id: TRIP,
          payload: { note_id: NOTE, text: 'About the chair.', entry_id: null },
        } as unknown as OpSpec,
      ],
    )

    expect(state.trips[TRIP]?.notes?.[NOTE]?.entryId?.value).toBe(ENTRY)
  })

  it('writes nothing at all with no note_id', () => {
    const state = depot(aTrip({ id: TRIP }), [
      {
        type: 'trip.note_posted',
        aggregate: 'trip',
        aggregate_id: TRIP,
        payload: { text: 'orphan' },
      } as unknown as OpSpec,
    ])

    expect(state.trips[TRIP]?.notes).toBeUndefined()
  })
})

describe('trip.note_kept', () => {
  it('keeps and discards through the one op, both directions', () => {
    const kept = depot(
      aTrip({ id: TRIP }),
      [tripNotePosted(TRIP, NOTE, 'Bring more gas.')],
      [tripNoteKept(TRIP, NOTE, true)],
    )
    const discarded = depot(
      aTrip({ id: TRIP }),
      [tripNotePosted(TRIP, NOTE, 'Bring more gas.')],
      [tripNoteKept(TRIP, NOTE, true)],
      [tripNoteKept(TRIP, NOTE, false)],
    )

    expect(kept.trips[TRIP]?.notes?.[NOTE]?.kept?.value).toBe(true)
    expect(discarded.trips[TRIP]?.notes?.[NOTE]?.kept?.value).toBe(false)
  })

  it('folds a review that arrives before the Note it addresses', () => {
    // A peer reviewing on another Device while the post is still queued.
    // `writeNote` creates the entity for any Note op, so this Note holds a
    // `kept` and no `text` — legal in the fold, drawn nowhere (spec §3).
    const state = depot(aTrip({ id: TRIP }), [tripNoteKept(TRIP, NOTE, true)])

    expect(state.trips[TRIP]?.notes?.[NOTE]?.kept?.value).toBe(true)
    expect(state.trips[TRIP]?.notes?.[NOTE]?.text).toBeUndefined()
  })

  it('returns the identical state for a losing write', () => {
    // The identity guard every writer in this file carries: a write that
    // loses on the clock must return the object it was given, or `slice.ts`'s
    // `WeakMap` memo is invalidated by an op that changed nothing.
    const before = depot(
      aTrip({ id: TRIP }),
      [tripNotePosted(TRIP, NOTE, 'Bring more gas.')],
      [tripNoteKept(TRIP, NOTE, true)],
    )
    const earlier = anOp(tripNoteKept(TRIP, NOTE, false), {
      hlc: hlcAt(0, DEFAULT_MS),
      deviceId: DEV_A,
    })

    expect(applyOp(before, earlier)).toBe(before)
  })

  it('ignores a payload with no kept flag', () => {
    const state = depot(
      aTrip({ id: TRIP }),
      [tripNotePosted(TRIP, NOTE, 'Bring more gas.')],
      [
        {
          type: 'trip.note_kept',
          aggregate: 'trip',
          aggregate_id: TRIP,
          payload: { note_id: NOTE },
        } as unknown as OpSpec,
      ],
    )

    expect(state.trips[TRIP]?.notes?.[NOTE]?.kept).toBeUndefined()
  })
})
