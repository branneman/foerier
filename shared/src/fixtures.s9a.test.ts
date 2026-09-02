import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/s9a-packing.ops.json' with { type: 'json' }
import type { DepotState, EntryState } from './state.ts'
import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

/**
 * S9a's half of the fixture rule
 * ([architecture §8.7](../../docs/architecture-design.md), `testing.md`'s
 * Backward-compatibility group): **capture an op fixture in the same slice
 * that introduces the op type** — the discipline S4's fixture debt (paid a
 * slice late, in `fixtures.s4.test.ts`) exists to warn against.
 *
 * S9a introduces the five packing ops, so this file pins their wire format
 * and their effect on folded state, replayed through the current reducer on
 * every push to `main`. It carries **only** those five plus the Trip-root,
 * participant, Person and Entry ops needed to give them something to
 * reference — the earlier fixtures keep their own op types.
 *
 * Two ops are **forward-compatibility probes**, standing for a peer this
 * build has never met rather than for anything a screen in this slice
 * authors:
 *
 * 1. **`e-s9a-probe`'s `trip.entry_status_set{status: "in_the_shed"}`.**
 *    `tripEntryStatusSet`'s own parameter type is `StatusValue`, which stays
 *    open past its three known members (§1.4) — so nothing stops the
 *    *builder* from being called with an arbitrary string. What no *screen*
 *    in this slice offers is a control that would ever pass one: the pill
 *    this slice draws cycles the three known values only. This op stands for
 *    story 20's future per-trip editable statuses, or a foreign client,
 *    landing on a replica that has never heard the spelling — folded and
 *    drawn verbatim, never coerced, exactly as an unrecognised `PhaseValue`
 *    already is.
 * 2. **`e-s9a-crate-b`'s trip-only container**
 *    (`{"from": "trip_only", "name": "Crate B", "container": true}`). No
 *    screen this task builds (the write side only) offers a control for
 *    naming a trip-only container; whether a later task in this same slice
 *    adds one is outside this file's knowledge. Captured now regardless,
 *    since `trip.entry_added` is S7's op and its shape is already frozen —
 *    this fixture simply exercises a source shape the S7 fixture's own
 *    `e-s7-trip-only-container` probe already pins, so it plays no further
 *    part below beyond existing in the fold.
 *
 * The rest are captured, not probed: a screen offering the Piece status
 * sheet, the Pack picker and the container's rail could author every other
 * op here, including the nested containment chain and the ▲ case.
 */

/** The Trip every op in the fixture addresses. */
const TRIP = 't-s9a-1'
/** Loose, at the top of the chain. */
const DUFFEL = 'e-s9a-duffel'
/** Inside the duffel; itself staged `car`. */
const CRATE = 'e-s9a-crate'
/** Inside the crate; carries no `status` register at all — the ▲ case. */
const STOVE = 'e-s9a-stove'
/** Counted, with a Bring-count and an explicit `status`. */
const COUNTED = 'e-s9a-counted'
/** Per-person: one Piece removed, two carrying different statuses. */
const HEADLAMP = 'e-s9a-headlamp'
/** The unrecognised-status probe. */
const PROBE_ENTRY = 'e-s9a-probe'
const MARK = 'p-s9a-1'
const ELS = 'p-s9a-2'
const KIM = 'p-s9a-3'

function entryOf(state: DepotState, entryId: string): EntryState | undefined {
  return state.trips[TRIP]?.entries?.[entryId]
}

describe('the S9a fixture', () => {
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

  it('folds the unrecognised status verbatim and never coerces it', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, PROBE_ENTRY)?.status?.value).toBe('in_the_shed')
  })

  it('folds a stage on the container and a status on its contents', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, CRATE)?.stage?.value).toBe('car')
    expect(entryOf(state, CRATE)?.status).toBeUndefined()
    expect(entryOf(state, STOVE)?.residence?.value).toEqual({
      in: 'container',
      entryId: CRATE,
    })
  })

  it('keeps the removed Piece tombstoned while its siblings carry statuses', () => {
    const state = fold(fixture as OpEnvelope[])
    const pieces = entryOf(state, HEADLAMP)?.pieces
    expect(pieces?.[KIM]?.removed?.value).toBe(true)
    expect(pieces?.[MARK]?.status?.value).toBe('packed')
    expect(pieces?.[ELS]?.status?.value).toBe('not_packed')
  })

  it('folds a three-deep nesting chain: leaf in crate, crate in duffel, duffel loose', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, DUFFEL)?.residence?.value).toEqual({ in: 'loose' })
    expect(entryOf(state, CRATE)?.residence?.value).toEqual({
      in: 'container',
      entryId: DUFFEL,
    })
    expect(entryOf(state, STOVE)?.residence?.value).toEqual({
      in: 'container',
      entryId: CRATE,
    })
  })

  it('moves a Piece into a container independently of its Entry', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, HEADLAMP)?.pieces?.[MARK]?.residence?.value).toEqual({
      in: 'container',
      entryId: CRATE,
    })
  })

  it('folds a Bring-count and a status on the same Counted Entry', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, COUNTED)?.bringCount?.value).toBe(4)
    expect(entryOf(state, COUNTED)?.status?.value).toBe('staged')
  })
})
