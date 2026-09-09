import { describe, expect, it } from 'vitest'

import { anOp, hlcAt } from '../testUtils/index.ts'
import {
  gearRenamed,
  personRenamed,
  placeRenamed,
  tripEntryStatusSet,
  tripNoteKept,
  tripPieceStatusSet,
  tripRenamed,
  tripTaskTicked,
  type OpSpec,
} from './authoring.ts'
import { fold } from './reduce.ts'

/**
 * **The identity guard, once, for all seven entity writers.**
 *
 * `reduce.ts` spelled the same six lines seven times — four top-level maps
 * (`places`, `gear`, `people`, `trips`), two nested in a Trip (`entries`,
 * `notes`, `tasks`) and one nested in an Entry (`pieces`). They share one
 * `writeEntity` now, and this is the property that made the duplication worth
 * removing rather than merely untidy: **an update that changes no register
 * must return the object it was given, all the way up to the
 * `HouseholdState`.**
 *
 * It is not a micro-optimisation. `slice.ts`'s two `WeakMap` memos and
 * `containment.ts`'s are keyed on the fold's own identity, so a losing LWW
 * write that fabricated a merely-equal state would silently throw away every
 * memo in the app — on the op that changed nothing at all.
 *
 * Each case writes a value, then folds an **earlier** write of a different
 * value on top: the second op loses LWW, so nothing changes and the fold must
 * hand back the identical object. The per-op suites already assert this for
 * the families they cover; what this file adds is the guarantee that no
 * writer is missing it, which is a claim about the set rather than about any
 * one op.
 */

const DEV = 'aaaaaaaa-0000-7000-8000-000000000001'
const TRIP = 'trip-1'
const ENTRY = 'entry-1'
const KIM = 'kim'

/** Later, then earlier — the second op is the one that must be dropped. */
function losing(winner: OpSpec, loser: OpSpec) {
  const seeded = fold([anOp(winner, { hlc: hlcAt(9), deviceId: DEV })])
  const after = fold([anOp(loser, { hlc: hlcAt(1), deviceId: DEV })], seeded)
  return { seeded, after }
}

describe('every entity writer returns the identical state on a losing write', () => {
  it.each([
    ['places', placeRenamed('p1', 'Attic'), placeRenamed('p1', 'Shed')],
    ['gear', gearRenamed('g1', 'Tent'), gearRenamed('g1', 'Tarp')],
    ['people', personRenamed('kim', 'Kim'), personRenamed('kim', 'Mark')],
    ['trips', tripRenamed(TRIP, 'Alps 2026'), tripRenamed(TRIP, 'Vosges')],
    [
      'entries',
      tripEntryStatusSet(TRIP, ENTRY, 'packed'),
      tripEntryStatusSet(TRIP, ENTRY, 'not_packed'),
    ],
    [
      'pieces',
      tripPieceStatusSet(TRIP, ENTRY, KIM, 'packed'),
      tripPieceStatusSet(TRIP, ENTRY, KIM, 'not_packed'),
    ],
    [
      'tasks',
      tripTaskTicked(TRIP, 'task-1', true),
      tripTaskTicked(TRIP, 'task-1', false),
    ],
    [
      'notes',
      tripNoteKept(TRIP, 'note-1', true),
      tripNoteKept(TRIP, 'note-1', false),
    ],
  ] as const)('%s', (_map, winner, loser) => {
    const { seeded, after } = losing(winner, loser)

    // Not `toEqual`: a merely-equal copy is exactly the failure — it passes
    // every value assertion in the suite and empties three `WeakMap`s.
    expect(after).toBe(seeded)
  })
})

/**
 * The one departure the shared writer keeps as a flag. An Entry, a Note and a
 * Piece are each created by an op that may write **no** register — a
 * malformed `trip.entry_added` still creates a bare, sourceless Entry — so
 * for those three, identity alone cannot tell *existed, untouched* from *just
 * created, untouched* apart. A Task's creating op always writes `text`, and
 * the four top-level entities' always write at least one register, so their
 * plain guard is exact.
 */
describe('a creating op that writes no register', () => {
  it('still creates the Entry', () => {
    const state = fold([
      anOp(
        {
          aggregate: 'trip',
          aggregate_id: TRIP,
          type: 'trip.entry_added',
          payload: { entry_id: ENTRY, source: { from: 'elsewhere' } },
        } as OpSpec,
        { hlc: hlcAt(1), deviceId: DEV },
      ),
    ])

    const entry = state.trips[TRIP]?.entries?.[ENTRY]
    expect(entry).toBeDefined()
    expect(entry?.source).toBeUndefined()
  })
})
