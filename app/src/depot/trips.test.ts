import {
  authorOp,
  createHlcClock,
  emptyState,
  fold,
  gearRecorded,
  personRecorded,
  tripCreated,
  tripDatesSet,
  tripEntryAdded,
  tripParticipantAdded,
  tripPhaseMoved,
  tripParticipantRemoved,
  tripPieceRemoved,
  type DepotState,
  type OpAuthor,
  type OpSpec,
  type TripState,
} from '@foerier/shared'
import { describe, expect, it } from 'vitest'

import {
  peopleOn,
  tripChip,
  tripDateRange,
  tripParticipants,
  tripPieces,
  tripStartMonth,
} from './trips'

/**
 * Every fixture goes through the **real** reducer, never a hand-shaped
 * `DepotState` — the rule `shared/src/selectors/trip.test.ts` follows, for the
 * same reason: a selector must never pass against a state the fold could not
 * produce, and the unfolded-Person case below is precisely a state only the
 * fold can produce.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const TRIP = 'tttttttt-0000-7000-8000-000000000001'

let nextId = 0

const ids = {
  next: () =>
    `eeeeeeee-0000-7000-8000-${(nextId++).toString(16).padStart(12, '0')}`,
}

function anAuthor(): OpAuthor {
  return {
    household_id: HOUSEHOLD,
    device_id: DEVICE,
    ids,
    hlc: createHlcClock({ now: () => 1_700_000_000_000 }),
  }
}

function depot(...specs: readonly OpSpec[]): DepotState {
  const author = anAuthor()
  return fold(
    specs.map((spec) => authorOp(author, spec)),
    emptyState(),
  )
}

function theTrip(state: DepotState): TripState {
  return state.trips[TRIP]!
}

describe('tripParticipants', () => {
  it('lists the People on a Trip in sortedPeople order, not in id order', () => {
    // The ids ascend while the names do not, so id order and display order
    // disagree — which is the point: `participantIds` sorts by id because that
    // is replica-identical, and this sorts by label because the People screen
    // and the owner picker already do.
    const state = depot(
      personRecorded('p1', 'Mark'),
      personRecorded('p2', 'Els'),
      personRecorded('p3', 'Kees'),
      tripCreated(TRIP, 'Alps 2026'),
      tripParticipantAdded(TRIP, 'p1'),
      tripParticipantAdded(TRIP, 'p3'),
    )

    // Els is recorded and is not on the Trip: the household's People are not
    // the Trip's.
    expect(tripParticipants(state, theTrip(state))).toEqual([
      { id: 'p3', label: 'Kees' },
      { id: 'p1', label: 'Mark' },
    ])
  })

  it('drops a Participant who was removed', () => {
    const state = depot(
      personRecorded('p1', 'Mark'),
      personRecorded('p2', 'Els'),
      tripCreated(TRIP, 'Alps 2026'),
      tripParticipantAdded(TRIP, 'p1'),
      tripParticipantAdded(TRIP, 'p2'),
      tripParticipantRemoved(TRIP, 'p1'),
    )

    // A removal is a register holding `false`, not an absence — this inherits
    // `participantIds`' handling of it rather than re-deriving one.
    expect(tripParticipants(state, theTrip(state))).toEqual([
      { id: 'p2', label: 'Els' },
    ])
  })

  it('still lists a Participant whose Person has not folded yet', () => {
    const state = depot(
      personRecorded('p1', 'Mark'),
      tripCreated(TRIP, 'Alps 2026'),
      tripParticipantAdded(TRIP, 'p1'),
      tripParticipantAdded(TRIP, 'zz-queued-elsewhere'),
      tripParticipantAdded(TRIP, 'ya-queued-elsewhere'),
    )

    // Reachable in ordinary use: the `person.recorded` is still in another
    // device's outbox while the `trip.participant_added` naming it has already
    // arrived. A Participant must never silently vanish, so the unfolded ones
    // are appended after the folded ones, in id order — there is no label to
    // sort them by.
    expect(tripParticipants(state, theTrip(state))).toEqual([
      { id: 'p1', label: 'Mark' },
      { id: 'ya-queued-elsewhere', label: '—' },
      { id: 'zz-queued-elsewhere', label: '—' },
    ])
  })

  it('is empty for a Trip nobody is on', () => {
    const state = depot(
      personRecorded('p1', 'Mark'),
      tripCreated(TRIP, 'Alps 2026'),
    )
    expect(tripParticipants(state, theTrip(state))).toEqual([])
  })
})

/**
 * Review finding F3: `EntryRow`'s trailing slot and `PiecePicker` both call
 * this — a direct test of the join itself, on top of the two components'
 * own integration coverage, because `pieceInclusion`'s id order and
 * `tripParticipants`'s display order disagreeing is exactly the drift this
 * function exists to close off in one place rather than two.
 */
describe('tripPieces', () => {
  it('joins pieceInclusion against display order, not id order', () => {
    // Ids ascend (p1, p2) while the display order does not (Ansel before
    // Zara) — the same disagreement `tripParticipants`'s own first test
    // pins, restated here so a caller reading id order by accident would
    // fail this test too.
    const state = depot(
      personRecorded('p1', 'Zara'),
      personRecorded('p2', 'Ansel'),
      tripCreated(TRIP, 'Alps 2026'),
      tripParticipantAdded(TRIP, 'p1'),
      tripParticipantAdded(TRIP, 'p2'),
      gearRecorded('g1', {
        name: 'Trekking pole',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(TRIP, 'e1', { from: 'depot', gearId: 'g1' }),
      tripPieceRemoved(TRIP, 'e1', 'p1'),
    )
    const trip = theTrip(state)
    const entry = trip.entries!['e1']!

    expect(tripPieces(state, trip, entry)).toEqual([
      { personId: 'p2', label: 'Ansel', included: true },
      { personId: 'p1', label: 'Zara', included: false },
    ])
  })

  it('is empty for a Trip nobody is on', () => {
    const state = depot(
      tripCreated(TRIP, 'Alps 2026'),
      gearRecorded('g1', {
        name: 'Trekking pole',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(TRIP, 'e1', { from: 'depot', gearId: 'g1' }),
    )
    const trip = theTrip(state)
    const entry = trip.entries!['e1']!

    expect(tripPieces(state, trip, entry)).toEqual([])
  })
})

describe('peopleOn', () => {
  /**
   * The create screen's way in — it holds a **draft** selection and has no
   * Trip to ask — and the reason "who is on this Trip" is one code path rather
   * than two. A screen that filtered `sortedPeople` itself would drop an id
   * the fold has not caught up with, and `emit` folds on the store's queue, so
   * a Person recorded from inside the picker is exactly that for a tick.
   */
  it('lists an id with no folded Person rather than dropping it', () => {
    const state = depot(personRecorded('p1', 'Mark'))

    expect(peopleOn(state, ['just-recorded', 'p1'])).toEqual([
      { id: 'p1', label: 'Mark' },
      { id: 'just-recorded', label: '—' },
    ])
  })

  it('orders the folded ones by label, whatever order it is handed', () => {
    // A draft holds ids in tap order; `participantIds` holds them in id order.
    // Neither reaches the display — `sortedPeople` decides that.
    const state = depot(
      personRecorded('p1', 'Mark'),
      personRecorded('p2', 'Els'),
    )

    expect(peopleOn(state, ['p1', 'p2'])).toEqual([
      { id: 'p2', label: 'Els' },
      { id: 'p1', label: 'Mark' },
    ])
  })

  it('is empty for an empty selection', () => {
    expect(peopleOn(depot(personRecorded('p1', 'Mark')), [])).toEqual([])
  })
})

describe('tripDateRange', () => {
  function dated(dates: { start?: string | null; end?: string | null }) {
    return theTrip(
      depot(tripCreated(TRIP, 'Alps 2026'), tripDatesSet(TRIP, dates)),
    )
  }

  it('draws the boards line, span included and inclusive of both ends', () => {
    // `AUG 14 → SEP 02 · 20 DAYS` is the board's own number: the days a Trip
    // is away, not the difference between two dates. Parts, not one string:
    // the separators and the `▲` belong to whichever surface draws them,
    // because only a surface can put the warning in its own element.
    expect(
      tripDateRange(dated({ start: '2026-08-14', end: '2026-09-02' })),
    ).toEqual({ range: 'AUG 14 → SEP 02', span: '20 DAYS', warning: null })
  })

  it('counts a one-day Trip in the singular', () => {
    expect(
      tripDateRange(dated({ start: '2026-08-14', end: '2026-08-14' })),
    ).toEqual({ range: 'AUG 14 → AUG 14', span: '1 DAY', warning: null })
  })

  it('drops the line entirely when the Trip carries no dates', () => {
    // The board's own variant — "dates are optional and a draft usually has
    // none, the meta row simply drops". `null` and absent are different facts
    // about the log and the same fact about the Trip.
    expect(
      tripDateRange(theTrip(depot(tripCreated(TRIP, 'Alps 2026')))),
    ).toBeNull()
    expect(tripDateRange(dated({ start: null, end: null }))).toBeNull()
  })

  it('keeps the arrow when only one end is known', () => {
    // The arrow is what says which end is missing. A bare `SEP 02` would read
    // as a start date, which is a fact the Trip does not hold.
    expect(tripDateRange(dated({ start: '2026-08-14' }))).toEqual({
      range: 'AUG 14 →',
      span: null,
      warning: null,
    })
    expect(tripDateRange(dated({ end: '2026-09-02' }))).toEqual({
      range: '→ SEP 02',
      span: null,
      warning: null,
    })
  })

  it('draws a date it cannot read exactly as it arrived, and counts nothing', () => {
    // The reducer gates no format (spec §1.4), so this is reachable from a
    // peer that spells dates differently. Inventing a rendering would be
    // coercion by another name, and there is no arithmetic to do.
    expect(
      tripDateRange(dated({ start: 'next summer', end: '2026-09-02' })),
    ).toEqual({ range: 'next summer → SEP 02', span: null, warning: null })
    // A calendar that does not exist misses too, rather than drawing FEB 30.
    expect(tripDateRange(dated({ start: '2026-02-30' }))).toEqual({
      range: '2026-02-30 →',
      span: null,
      warning: null,
    })
  })

  it('reports a reversed range, and suppresses the count that would be false', () => {
    // The boards' own line (`Screens B` 02A, DATES — THE OS OWNS THE INPUT):
    // there is deliberately no end-before-start guard, because two devices
    // may write the two ends concurrently and a guard would have to discard
    // one of two valid writes. So the range is reported, never prevented —
    // and the span goes, because 20 DAYS of a reversed range is a falsehood.
    //
    // The warning is its own part precisely so a surface can paint it in the
    // attention class while the range beside it stays muted meta — one string
    // could only be coloured whole or not at all. The `▲` is the surface's
    // for the same reason and so is not in here.
    expect(
      tripDateRange(dated({ start: '2026-09-02', end: '2026-08-14' })),
    ).toEqual({
      range: 'SEP 02 → AUG 14',
      span: null,
      warning: 'ENDS BEFORE IT STARTS',
    })
  })

  it('does not judge a range reversed when an end will not read as a date', () => {
    // The trap this guards: compared as bare strings, `'2026-09-02' <
    // 'next summer'`, so an ungated comparison would report a Trip starting
    // `next summer` as ending before it starts. A range with an unreadable
    // end cannot be judged at all, and the warning drives the attention class
    // — which must never be spent on a guess.
    expect(
      tripDateRange(dated({ start: 'next summer', end: '2026-09-02' }))
        ?.warning,
    ).toBeNull()
    expect(
      tripDateRange(dated({ start: '2026-09-02', end: 'next summer' })),
    ).toEqual({ range: 'SEP 02 → next summer', span: null, warning: null })
  })

  it('does not call a same-day Trip reversed', () => {
    // The boundary the comparison has to get right: equal ends are one day
    // away, not a contradiction.
    expect(
      tripDateRange(dated({ start: '2026-08-14', end: '2026-08-14' })),
    ).toEqual({ range: 'AUG 14 → AUG 14', span: '1 DAY', warning: null })
  })
})

describe('tripStartMonth', () => {
  it('reads the closed rows meta off the start date', () => {
    const state = depot(
      tripCreated(TRIP, 'Tessin 2025'),
      tripDatesSet(TRIP, { start: '2025-07-04', end: '2025-07-19' }),
    )
    expect(tripStartMonth(theTrip(state))).toBe('JUL 2025')
  })

  it('states nothing when there is no start date, and never guesses from the end', () => {
    // The board draws `JUL 2025 · 54 PIECES · 1 LOST`; the counts are S7's and
    // S10's, and a month derived from the end date would claim a month the
    // Trip never said it started in.
    const state = depot(
      tripCreated(TRIP, 'Tessin 2025'),
      tripDatesSet(TRIP, { end: '2025-07-19' }),
    )
    expect(tripStartMonth(theTrip(state))).toBeNull()
  })

  it('draws a start date it cannot read exactly as it arrived', () => {
    const state = depot(
      tripCreated(TRIP, 'Tessin 2025'),
      tripDatesSet(TRIP, { start: 'summer' }),
    )
    expect(tripStartMonth(theTrip(state))).toBe('summer')
  })
})

describe('tripChip', () => {
  /** The seed clock, and the day every `DAY N` below counts from. */
  const SEEDED_AT = 1_700_000_000_000
  const A_DAY = 24 * 60 * 60 * 1000

  it('carries the day count for an active phase', () => {
    const state = depot(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    // `DAY 1` is the day of the change, so the second calendar day is `DAY 2`.
    expect(tripChip(theTrip(state), SEEDED_AT + A_DAY)).toBe('PACK-OUT · DAY 2')
  })

  it('draws a Drafts label alone, stamp or no stamp', () => {
    // A Trip moved *to* `draft` has a phase register and a stamp, and has
    // still not started anything: the count is gated on `isActive`, never on
    // the register being present (spec §3.6).
    const moved = depot(
      tripCreated(TRIP, 'Vosges — Oct'),
      tripPhaseMoved(TRIP, 'draft'),
    )
    expect(tripChip(theTrip(moved), SEEDED_AT + 9 * A_DAY)).toBe('DRAFT')

    // And the register the reducer seeds at `trip.created` reads the same.
    const created = depot(tripCreated(TRIP, 'Vosges — Oct'))
    expect(tripChip(theTrip(created), SEEDED_AT + 9 * A_DAY)).toBe('DRAFT')
  })

  it('says nothing about a closed Trips days', () => {
    const state = depot(
      tripCreated(TRIP, 'Tessin 2025'),
      tripPhaseMoved(TRIP, 'closed'),
    )
    expect(tripChip(theTrip(state), SEEDED_AT + 400 * A_DAY)).toBe('CLOSED')
  })

  it('draws a phase this build has never heard of exactly as it arrived', () => {
    const state = depot(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'portaging'),
    )
    // Verbatim (`sync-protocol.md` §5.3, obligation 4), and no day count:
    // `isActive` calls an unrecognised phase inactive rather than guessing, so
    // an old build never over-states what a Trip is doing.
    expect(tripChip(theTrip(state), SEEDED_AT + A_DAY)).toBe('portaging')
  })
})
