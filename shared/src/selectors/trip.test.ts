import { describe, expect, it } from 'vitest'

import { anOp, aTrip, hlcAt } from '../../testUtils/index.ts'
import {
  tripParticipantAdded,
  tripParticipantRemoved,
  tripRenamed,
  type OpSpec,
} from '../authoring.ts'
import { emptyState, fold } from '../reduce.ts'
import type { DepotState, TripState } from '../state.ts'
import {
  isActive,
  isKnownPhase,
  participantIds,
  phaseDay,
  phaseLabel,
  phaseName,
  phaseNext,
  phaseOf,
  PHASES,
  tripLabel,
  tripSections,
  visibleTrips,
} from './trip.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

/** The factories' own default millisecond, so `hlcAt` here matches theirs. */
const DEFAULT_MS = 1_700_000_000_000

/**
 * Folds op specs through the real reducer, stamping each with an increasing
 * clock at `ms`. Every fixture in this file goes through the fold rather than
 * hand-shaping a `TripState`, so a selector can never pass against a state the
 * reducer could not produce.
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

function trip(state: DepotState, id: string): TripState {
  return state.trips[id]!
}

/** Ids in section order — what two replicas have to agree on, exactly. */
function ids(trips: readonly TripState[]): readonly string[] {
  return trips.map((t) => t.id)
}

describe('PHASES', () => {
  it('lists the five phases in the order the sheet draws', () => {
    expect(PHASES.map((phase) => phase.id)).toEqual([
      'draft',
      'pack_out',
      'on_trip',
      'unpack',
      'closed',
    ])
  })

  it('marks exactly invariant 17s three phases active', () => {
    expect(
      PHASES.filter((phase) => phase.active).map((phase) => phase.id),
    ).toEqual(['pack_out', 'on_trip', 'unpack'])
  })

  it('states the next step for every phase but closed', () => {
    // The boards' table verbatim (`Screens B` 02A, README §5), which the
    // design round redrew two rows of: `PACK IT` → `PACK THE LIST`, and
    // `MARK UNPACK WHEN YOU ARE BACK` → `SET UNPACK WHEN BACK`. Spec §6.2
    // holds the superseded pair and is a dated record, not the authority.
    expect(
      Object.fromEntries(PHASES.map((phase) => [phase.id, phase.next])),
    ).toEqual({
      draft: 'NEXT — BUILD THE GEAR LIST',
      pack_out: 'NEXT — PACK THE LIST',
      on_trip: 'NEXT — SET UNPACK WHEN BACK',
      unpack: 'NEXT — RESOLVE EVERY ENTRY, THEN CLOSE',
      closed: null,
    })
  })
})

describe('phaseOf', () => {
  it('reads an absent register as draft', () => {
    // Reachable, and not only in a test: a Trip addressed by a participant op
    // whose `trip.created` is still queued on another device exists with no
    // phase register at all (spec §3.2).
    const state = depot([tripParticipantAdded('t1', 'p1')])
    expect(trip(state, 't1').phase).toBeUndefined()
    expect(phaseOf(trip(state, 't1'))).toBe('draft')
  })

  it('reads the seeded register as draft', () => {
    // The pair that matters: the fold keeps absent and an explicit `draft`
    // apart, and this is the one place they are deliberately brought together.
    const state = depot(aTrip({ id: 't1' }))
    expect(trip(state, 't1').phase?.value).toBe('draft')
    expect(phaseOf(trip(state, 't1'))).toBe('draft')
  })

  it('reads a moved register exactly as written', () => {
    const state = depot(aTrip({ id: 't1', phase: 'on_trip' }))
    expect(phaseOf(trip(state, 't1'))).toBe('on_trip')
  })

  it('reads an unrecognised phase verbatim', () => {
    const state = depot(aTrip({ id: 't1', phase: 'something-later' }))
    expect(phaseOf(trip(state, 't1'))).toBe('something-later')
  })
})

describe('phaseLabel', () => {
  it('labels the five known phases', () => {
    expect(PHASES.map((phase) => phaseLabel(phase.id))).toEqual([
      'DRAFT',
      'PACK-OUT',
      'ON TRIP',
      'UNPACK',
      'CLOSED',
    ])
  })

  it('draws an unrecognised phase exactly as it arrived', () => {
    expect(phaseLabel('something-later')).toBe('something-later')
  })
})

describe('phaseName', () => {
  it('names the five known phases for a sentence', () => {
    // Not a casing of `label`: no transform turns `PACK-OUT` into `Pack-out`
    // and `ON TRIP` into `On trip` without knowing which words a phase name
    // is made of, which is what the table knows and a screen does not.
    expect(PHASES.map((phase) => phaseName(phase.id))).toEqual([
      'Draft',
      'Pack-out',
      'On trip',
      'Unpack',
      'Closed',
    ])
  })

  it('names an unrecognised phase exactly as it arrived', () => {
    expect(phaseName('something-later')).toBe('something-later')
  })
})

describe('isKnownPhase', () => {
  it('recognises every row of the table and nothing else', () => {
    expect(PHASES.map((phase) => isKnownPhase(phase.id))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
    expect(isKnownPhase('something-later')).toBe(false)
  })
})

describe('phaseNext', () => {
  it.each([
    ['draft', 'NEXT — BUILD THE GEAR LIST'],
    ['pack_out', 'NEXT — PACK THE LIST'],
    ['on_trip', 'NEXT — SET UNPACK WHEN BACK'],
    ['unpack', 'NEXT — RESOLVE EVERY ENTRY, THEN CLOSE'],
  ])('states the drawn line for %s', (phase, line) => {
    expect(phaseNext(trip(depot(aTrip({ id: 't1', phase })), 't1'))).toBe(line)
  })

  it('states nothing for closed, which has nothing next', () => {
    const state = depot(aTrip({ id: 't1', phase: 'closed' }))
    expect(phaseNext(trip(state, 't1'))).toBeNull()
  })

  it('states nothing for an unrecognised phase', () => {
    // §3.4's fourth bullet: the next thing to do is a fact of the phase table
    // and there is no row. The chip beside the line still draws the raw
    // value — only the next-step line goes away.
    const state = depot(aTrip({ id: 't1', phase: 'something-later' }))
    expect(phaseNext(trip(state, 't1'))).toBeNull()
    expect(phaseLabel(phaseOf(trip(state, 't1')))).toBe('something-later')
  })

  it('states the draft line for an absent register', () => {
    // Through `phaseOf`, so the absent case answers like the draft it reads
    // as rather than like a phase with no row.
    const state = depot([tripParticipantAdded('t1', 'p1')])
    expect(phaseNext(trip(state, 't1'))).toBe('NEXT — BUILD THE GEAR LIST')
  })
})

describe('isActive', () => {
  it.each(['pack_out', 'on_trip', 'unpack'])('is true for %s', (phase) => {
    expect(isActive(trip(depot(aTrip({ id: 't1', phase })), 't1'))).toBe(true)
  })

  it.each(['draft', 'closed', 'something-later'])(
    'is false for %s',
    (phase) => {
      expect(isActive(trip(depot(aTrip({ id: 't1', phase })), 't1'))).toBe(
        false,
      )
    },
  )

  it('is false for an absent register, which reads draft', () => {
    const state = depot([tripParticipantAdded('t1', 'p1')])
    expect(isActive(trip(state, 't1'))).toBe(false)
  })
})

describe('tripLabel', () => {
  it('reads the name as recorded, not upper-cased', () => {
    const state = depot(aTrip({ id: 't1', name: 'Ardennes' }))
    expect(tripLabel(trip(state, 't1'))).toBe('Ardennes')
  })

  it('reads an absent register as a dash', () => {
    const state = depot([tripParticipantAdded('t1', 'p1')])
    expect(tripLabel(trip(state, 't1'))).toBe('—')
  })

  it('reads a cleared name as a dash', () => {
    const state = depot(aTrip({ id: 't1' }), [tripRenamed('t1', null)])
    expect(tripLabel(trip(state, 't1'))).toBe('—')
  })
})

describe('participantIds', () => {
  it('is empty when no participant op has addressed the Trip', () => {
    const state = depot(aTrip({ id: 't1' }))
    expect(participantIds(trip(state, 't1'))).toEqual([])
  })

  it('returns only the registers holding true', () => {
    const state = depot(aTrip({ id: 't1', participants: ['p1', 'p2'] }), [
      tripParticipantRemoved('t1', 'p2'),
    ])
    // The removed register is still in the fold, carrying `false` and a clock
    // (`sync-protocol.md` §3.4); not showing it is this selector's job.
    expect(trip(state, 't1').participants?.['p2']?.value).toBe(false)
    expect(participantIds(trip(state, 't1'))).toEqual(['p1'])
  })

  it('sorts by id, so two devices list the same roster', () => {
    const forward = depot(aTrip({ id: 't1', participants: ['p1', 'p2'] }))
    const reversed = depot(aTrip({ id: 't1', participants: ['p2', 'p1'] }))
    expect(participantIds(trip(forward, 't1'))).toEqual(['p1', 'p2'])
    expect(participantIds(trip(reversed, 't1'))).toEqual(['p1', 'p2'])
  })
})

describe('visibleTrips', () => {
  it('sorts by name then id, so two replicas draw one list', () => {
    const state = depot(
      aTrip({ id: 't2', name: 'Bravo' }),
      aTrip({ id: 't1', name: 'alpha' }),
    )
    // Case-insensitive: `alpha` files with `Alpha`, not after `Bravo`.
    expect(ids(visibleTrips(state))).toEqual(['t1', 't2'])
  })

  it('excludes a Trip whose deleted register holds true', () => {
    // S14 authors `trip.deleted`; at S6 there is no builder and **no
    // handler**, so an op of that type folds as unfolded and would write
    // nothing. The fixture therefore writes the register the way S14's
    // handler will — the selector has to honour it now, because every later
    // surface counts through this function (spec §2's table).
    const state = depot(aTrip({ id: 't1' }), aTrip({ id: 't2' }))
    const withDeleted: DepotState = {
      ...state,
      trips: {
        ...state.trips,
        t2: {
          ...trip(state, 't2'),
          deleted: { value: true, hlc: hlcAt(9), deviceId: DEV_A },
        },
      },
    }
    expect(ids(visibleTrips(withDeleted))).toEqual(['t1'])
  })
})

describe('tripSections', () => {
  it('files each phase in its own section', () => {
    const state = depot(
      aTrip({ id: 'draft' }),
      aTrip({ id: 'pack', phase: 'pack_out' }),
      aTrip({ id: 'on', phase: 'on_trip' }),
      aTrip({ id: 'unpack', phase: 'unpack' }),
      aTrip({ id: 'closed', phase: 'closed' }),
    )
    const sections = tripSections(state)
    // Membership only — the ordering assertions are their own tests below.
    expect([...ids(sections.active)].sort()).toEqual(['on', 'pack', 'unpack'])
    expect(ids(sections.planned)).toEqual(['draft'])
    expect(ids(sections.closed)).toEqual(['closed'])
  })

  it('files an unrecognised phase under planned, never active', () => {
    // Spec §3.4: an unknown phase cannot give a Trip's arrangement effect
    // (invariant 17 names three), and calling it a draft would state
    // something false — so the section is named for the class.
    const state = depot(aTrip({ id: 't1', phase: 'something-later' }))
    const sections = tripSections(state)
    expect(ids(sections.planned)).toEqual(['t1'])
    expect(sections.active).toEqual([])
    expect(sections.closed).toEqual([])
  })

  it('excludes a deleted Trip from every section', () => {
    const state = depot(aTrip({ id: 't1' }))
    const withDeleted: DepotState = {
      ...state,
      trips: {
        t1: {
          ...trip(state, 't1'),
          deleted: { value: true, hlc: hlcAt(9), deviceId: DEV_A },
        },
      },
    }
    const sections = tripSections(withDeleted)
    expect(sections.planned).toEqual([])
    expect(sections.active).toEqual([])
    expect(sections.closed).toEqual([])
  })

  it('orders active by start date ascending, undated last', () => {
    const state = depot(
      aTrip({ id: 'none', phase: 'unpack' }),
      aTrip({ id: 'sep', phase: 'on_trip', start: '2026-09-01' }),
      aTrip({ id: 'aug', phase: 'pack_out', start: '2026-08-01' }),
    )
    expect(ids(tripSections(state).active)).toEqual(['aug', 'sep', 'none'])
  })

  it('orders planned by start date ascending, undated last', () => {
    const state = depot(
      aTrip({ id: 'none' }),
      aTrip({ id: 'sep', start: '2026-09-01' }),
      aTrip({ id: 'aug', phase: 'something-later', start: '2026-08-01' }),
    )
    expect(ids(tripSections(state).planned)).toEqual(['aug', 'sep', 'none'])
  })

  it('orders closed by start date descending, undated still last', () => {
    // The two sections answer opposite questions — what is coming wants the
    // soonest first, what happened wants the most recent — but undated is
    // last in both, because burying the dated ones would be meaningless here
    // and wrong forward (spec §3.5).
    const state = depot(
      aTrip({ id: 'none', phase: 'closed' }),
      aTrip({ id: 'aug', phase: 'closed', start: '2026-08-01' }),
      aTrip({ id: 'sep', phase: 'closed', start: '2026-09-01' }),
    )
    expect(ids(tripSections(state).closed)).toEqual(['sep', 'aug', 'none'])
  })

  it('reads a cleared start date as undated', () => {
    const state = depot(
      aTrip({ id: 'cleared', start: null }),
      aTrip({ id: 'aug', start: '2026-08-01' }),
    )
    expect(ids(tripSections(state).planned)).toEqual(['aug', 'cleared'])
  })

  it('breaks a date tie by name, case-insensitively, then by id', () => {
    const state = depot(
      aTrip({ id: 't3', name: 'Bravo', start: '2026-08-01' }),
      aTrip({ id: 't2', name: 'alpha', start: '2026-08-01' }),
      aTrip({ id: 't1', name: 'alpha', start: '2026-08-01' }),
    )
    expect(ids(tripSections(state).planned)).toEqual(['t1', 't2', 't3'])
  })

  it('breaks a same-spelling-different-case tie before reaching the id', () => {
    // `byNameThenId`'s middle branch, and the only one nothing else covers.
    // Two names that lower-case identically are *not* the same name, and the
    // id must not be what separates them: the ids here run the other way, so
    // a comparator that fell straight from the case-insensitive compare to
    // the id would answer `['t1', 't2']`. Code-point order puts `Alpha`
    // first, and — the point of the branch — puts it first on every device,
    // because `toLowerCase` collapsed a difference the display still shows.
    const state = depot(
      aTrip({ id: 't2', name: 'Alpha', start: '2026-08-01' }),
      aTrip({ id: 't1', name: 'alpha', start: '2026-08-01' }),
    )
    expect(ids(tripSections(state).planned)).toEqual(['t2', 't1'])
  })

  it('breaks an undated tie the same way', () => {
    const state = depot(
      aTrip({ id: 't2', name: 'Bravo', phase: 'closed' }),
      aTrip({ id: 't1', name: 'alpha', phase: 'closed' }),
    )
    expect(ids(tripSections(state).closed)).toEqual(['t1', 't2'])
  })

  it('draws the same three sections whatever order the ops arrived in', () => {
    // The test that matters. Every other assertion here is about one
    // replica; this one is the reason the selector sorts at all — two devices
    // holding identical state must not draw the Trips list differently.
    const specs = [
      aTrip({ id: 't1', name: 'alpha', phase: 'closed', start: '2026-08-01' }),
      aTrip({ id: 't2', name: 'alpha', phase: 'closed', start: '2026-08-01' }),
      aTrip({ id: 't3', name: 'Bravo', phase: 'pack_out' }),
      aTrip({ id: 't4', name: 'Bravo', phase: 'on_trip', start: '2026-07-01' }),
      aTrip({ id: 't5', name: 'delta', phase: 'something-later' }),
      aTrip({ id: 't6', name: 'echo', start: '2026-09-01' }),
    ]
    const ops = specs
      .flat()
      .map((spec, i) => anOp(spec, { hlc: hlcAt(i + 1), deviceId: DEV_A }))
    const forward = tripSections(fold(ops, emptyState()))
    const backward = tripSections(fold([...ops].reverse(), emptyState()))
    expect(ids(backward.active)).toEqual(ids(forward.active))
    expect(ids(backward.planned)).toEqual(ids(forward.planned))
    expect(ids(backward.closed)).toEqual(ids(forward.closed))
    // …and pin the order itself, so a comparator that became non-total in
    // both directions at once cannot pass by agreeing with itself.
    expect(ids(forward.active)).toEqual(['t4', 't3'])
    expect(ids(forward.planned)).toEqual(['t6', 't5'])
    expect(ids(forward.closed)).toEqual(['t1', 't2'])
  })
})

describe('phaseDay', () => {
  /** Local wall-clock, because the count is in local calendar days. */
  function localMs(
    y: number,
    m: number,
    d: number,
    h: number,
    min = 0,
  ): number {
    return new Date(y, m - 1, d, h, min).getTime()
  }

  function movedAt(ms: number): TripState {
    return trip(foldAt(ms, [aTrip({ id: 't1', phase: 'pack_out' })]), 't1')
  }

  it('reads DAY 1 on the day of the change, 23 hours later', () => {
    const moved = movedAt(localMs(2026, 8, 29, 0, 30))
    expect(phaseDay(moved, localMs(2026, 8, 29, 23, 30))).toBe(1)
  })

  it('reads DAY 2 at local midnight, 2 hours later', () => {
    // The whole point of counting calendar days: DAY 2 arrives at midnight,
    // not 24 hours after the tap (spec §3.6).
    const moved = movedAt(localMs(2026, 8, 29, 22, 0))
    expect(phaseDay(moved, localMs(2026, 8, 30, 0, 30))).toBe(2)
  })

  it('counts across a month boundary', () => {
    const moved = movedAt(localMs(2026, 8, 30, 12, 0))
    expect(phaseDay(moved, localMs(2026, 9, 2, 12, 0))).toBe(4)
  })

  it('reads null when no op has ever addressed the phase', () => {
    const state = depot([tripParticipantAdded('t1', 'p1')])
    expect(phaseDay(trip(state, 't1'), DEFAULT_MS)).toBeNull()
  })

  it('reads null when the register carries an unparseable clock', () => {
    // A tolerant reader folds whatever arrived; the day count is the one
    // thing that has to parse it, and it declines rather than guesses.
    const state = fold(
      aTrip({ id: 't1' }).map((spec) =>
        anOp(spec, { hlc: 'not-an-hlc', deviceId: DEV_A }),
      ),
      emptyState(),
    )
    expect(phaseDay(trip(state, 't1'), DEFAULT_MS)).toBeNull()
  })

  it('never reads below DAY 1, however skewed the authoring clock', () => {
    const moved = movedAt(localMs(2026, 9, 5, 12, 0))
    expect(phaseDay(moved, localMs(2026, 8, 29, 12, 0))).toBe(1)
  })
})
