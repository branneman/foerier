import { describe, expect, it } from 'vitest'

import { aTrip, depot, foldAt, stamp } from '../../testUtils/index.ts'
import { tripNoteKept, tripNotePosted } from '../authoring.ts'
import { fold } from '../reduce.ts'
import type { HouseholdState, NoteState, TripState } from '../state.ts'
import { noteCounts, noteKeptOf, notesOf } from './note.ts'

const TRIP = 't1'
const ENTRY = 'e1'

const POSTED_MS = 1_700_000_000_000
const REVIEWED_MS = 1_800_000_000_000

function trip(state: HouseholdState): TripState {
  return state.trips[TRIP]!
}

const AT = { hlc: '2026-09-08T09:00:00.000Z-0000', deviceId: 'd1' }

function noteState(overrides: Partial<NoteState> = {}): NoteState {
  return { id: 'n1', ...overrides }
}

describe('notesOf', () => {
  it('lists notes oldest first', () => {
    // I11. The order is the posting stamp's, never `Object.keys`' — which
    // returns the order *this replica* happened to receive ops in, so two
    // devices holding identical state would draw the list differently.
    const state = depot(aTrip({ id: TRIP }), [
      tripNotePosted(TRIP, 'n-second', 'second'),
      tripNotePosted(TRIP, 'n-first', 'first'),
    ])

    expect(notesOf(trip(state)).map((note) => note.text)).toEqual([
      'second',
      'first',
    ])
  })

  it('reads the posting op’s own clock, and a later review does not move it', () => {
    // I11: the meta line's timestamp is when the Note was written down.
    // Keeping or discarding it months later must not restamp it.
    const posted = foldAt(POSTED_MS, [
      aTrip({ id: TRIP }),
      [tripNotePosted(TRIP, 'n1', 'Ran low on gas.')],
    ])
    const reviewed = fold(
      stamp([tripNoteKept(TRIP, 'n1', true)], { ms: REVIEWED_MS }),
      posted,
    )

    expect(notesOf(trip(posted))[0]?.postedAtMs).toBe(POSTED_MS)
    expect(notesOf(trip(reviewed))[0]?.postedAtMs).toBe(POSTED_MS)
    expect(notesOf(trip(reviewed))[0]?.kept).toBe(true)
  })

  it('carries the entry reference when there is one, and undefined when not', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripNotePosted(TRIP, 'n1', 'About the chair.', ENTRY),
      tripNotePosted(TRIP, 'n2', 'About the trip.'),
    ])
    const [first, second] = notesOf(trip(state))

    expect(first?.entryId).toBe(ENTRY)
    expect(second?.entryId).toBeUndefined()
  })

  it('excludes a Note with no text from the list', () => {
    // Spec §3: S7's sourceless Entry, one map over. A peer's review can
    // arrive before the post it addresses, and an entity nobody can draw a
    // default for is not a line anybody can draw.
    const state = depot(aTrip({ id: TRIP }), [
      tripNoteKept(TRIP, 'n-ghost', true),
      tripNotePosted(TRIP, 'n1', 'Real.'),
    ])

    expect(notesOf(trip(state)).map((note) => note.id)).toEqual(['n1'])
  })

  it('is empty for a Trip this replica has not folded', () => {
    expect(notesOf(undefined)).toEqual([])
  })
})

describe('noteKeptOf', () => {
  // I13, and the reason this answers three things rather than defaulting:
  // absent is *unreviewed*, a state the surfaces draw. `phase` reads `draft`
  // when absent and `owner` reads `SHARED`; this one reads neither.
  it('answers kept, discarded and unreviewed', () => {
    expect(noteKeptOf(noteState({ kept: { value: true, ...AT } }))).toBe(true)
    expect(noteKeptOf(noteState({ kept: { value: false, ...AT } }))).toBe(false)
    expect(noteKeptOf(noteState())).toBeUndefined()
  })
})

describe('noteCounts', () => {
  it('counts every Note, and only the unreviewed as to-review', () => {
    // I16: a discarded Note is still counted — it never vanishes.
    const state = depot(aTrip({ id: TRIP }), [
      tripNotePosted(TRIP, 'n1', 'kept'),
      tripNoteKept(TRIP, 'n1', true),
      tripNotePosted(TRIP, 'n2', 'discarded'),
      tripNoteKept(TRIP, 'n2', false),
      tripNotePosted(TRIP, 'n3', 'unreviewed'),
    ])

    expect(noteCounts(trip(state))).toEqual({ total: 3, toReview: 1 })
  })

  it('ignores a Note with no text, exactly as the list does', () => {
    // The count and the list must never disagree: a band reading `2 NOTES`
    // over one row is the bug this asserts against.
    const state = depot(aTrip({ id: TRIP }), [
      tripNoteKept(TRIP, 'n-ghost', true),
      tripNotePosted(TRIP, 'n1', 'Real.'),
    ])

    expect(noteCounts(trip(state))).toEqual({ total: 1, toReview: 1 })
    expect(notesOf(trip(state))).toHaveLength(1)
  })

  it('is zero for a Trip this replica has not folded', () => {
    expect(noteCounts(undefined)).toEqual({ total: 0, toReview: 0 })
  })
})
