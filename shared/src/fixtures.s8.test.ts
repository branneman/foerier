import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/s8-pieces.ops.json' with { type: 'json' }
import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

/**
 * S8's half of the fixture rule
 * ([architecture §8.7](../../docs/architecture-design.md), `testing.md`'s
 * Backward-compatibility group): **capture an op fixture in the same slice
 * that introduces the op type** — the discipline S4's fixture debt (paid a
 * slice late, in `fixtures.s4.test.ts`) exists to warn against.
 *
 * S8 introduces `trip.piece_removed` and `trip.piece_restored`, so this file
 * pins their wire format and their effect on folded state, replayed through
 * the current reducer on every push to `main`. It carries **only** those two
 * plus the Trip-root, participant and Entry ops needed to give them something
 * to reference — the earlier fixtures keep their own op types.
 *
 * Two probes are the point of the file. Both are **authorable by our own
 * builders** — `tripPieceRemoved` takes any Trip id, Entry id and Person id
 * it is handed, with no gate checking either against the Trip's own state —
 * so what makes them worth capturing is not that a builder refuses them: it
 * is that **no screen can produce them**. Each stands in for a peer whose ops
 * arrived out of order, which is the ordinary case here, not the exceptional
 * one:
 *
 * 1. **`p-s8-3`'s `trip.piece_removed`** names a Person who is never a
 *    Participant of `t-s8-1` anywhere in this file. No screen offers a
 *    tombstone control for a circle it never draws, so this stands for a
 *    `trip.participant_removed` that reached this replica first, or a
 *    `trip.piece_removed` whose matching `trip.participant_added` is still
 *    queued on another device. `piecesOf` (`selectors/piece.ts`) derives a
 *    Piece from the roster and subtracts tombstones — invariant 10 falls out
 *    of that derivation rather than being enforced by the reducer — so this
 *    tombstone is folded and retained exactly like any other, and simply
 *    plays no part in `p-s8-3`'s Pieces, because `p-s8-3` has none to
 *    subtract from.
 * 2. **`e-s8-orphan`'s `trip.piece_removed`** names an Entry with no
 *    `trip.entry_added` anywhere in this file. `writePiece` is nested inside
 *    `writeEntry`, which creates the stub Entry regardless of which op
 *    reaches it first (`e-s7-out-of-order`'s doc in `fixtures.s7.test.ts`
 *    pins the same behaviour for `trip.entry_removed`) — so this produces a
 *    real, folded Entry with a `pieces` register and **no `source`**.
 *    `entriesOf` excludes a sourceless Entry from every list, count and
 *    claim while retaining it in the fold (`selectors/entry.ts`'s doc); this
 *    probe pins that a Piece op alone is enough to create one.
 */

/** The Trip every op in the fixture addresses. */
const TRIP = 't-s8-1'
/** The per-person Entry, referencing recorded gear. */
const PER_PERSON_ENTRY = 'e-s8-per-person'
/** The Entry named only by a Piece op — no `trip.entry_added` anywhere. */
const ORPHAN_ENTRY = 'e-s8-orphan'
/** A Participant of `t-s8-1` whose Piece is tombstoned. */
const PARTICIPANT_REMOVED = 'p-s8-1'
/** A Participant of `t-s8-1` whose Piece is explicitly restored. */
const PARTICIPANT_RESTORED = 'p-s8-2'
/** Never a Participant of `t-s8-1` — probe 1. */
const NON_PARTICIPANT = 'p-s8-3'

describe('the S8 fixture', () => {
  it('folds to exactly the state it folded to when captured', () => {
    expect(fold(fixture as OpEnvelope[])).toMatchSnapshot()
  })

  it('never mutates the fixture it was given', () => {
    const before = JSON.stringify(fixture)
    fold(fixture as OpEnvelope[])
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('folds every op it carries', () => {
    expect(fold(fixture as OpEnvelope[]).unfolded.count).toBe(0)
  })

  it('tombstones a Piece with removed: true, a real value not a dropped key', () => {
    const entry = fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[
      PER_PERSON_ENTRY
    ]
    expect(entry?.pieces?.[PARTICIPANT_REMOVED]?.removed?.value).toBe(true)
  })

  it('restores a different Person’s Piece with removed: false', () => {
    const entry = fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[
      PER_PERSON_ENTRY
    ]
    expect(entry?.pieces?.[PARTICIPANT_RESTORED]?.removed?.value).toBe(false)
  })

  it('folds a piece_removed naming a non-Participant, inert but retained', () => {
    const entry = fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[
      PER_PERSON_ENTRY
    ]
    expect(entry?.pieces?.[NON_PARTICIPANT]?.removed?.value).toBe(true)
  })

  it('creates a sourceless Entry from a Piece op alone, with no trip.entry_added', () => {
    const entry = fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[
      ORPHAN_ENTRY
    ]
    expect(entry).toBeDefined()
    expect(entry?.source).toBeUndefined()
    expect(entry?.pieces?.[PARTICIPANT_REMOVED]?.removed?.value).toBe(true)
  })
})
