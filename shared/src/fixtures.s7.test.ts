import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/s7-entries.ops.json' with { type: 'json' }
import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

/**
 * S7's half of the fixture rule
 * ([architecture §8.7](../../docs/architecture-design.md), `testing.md`'s
 * Backward-compatibility group): **capture an op fixture in the same slice
 * that introduces the op type** — the discipline S4's fixture debt (paid a
 * slice late, in `fixtures.s4.test.ts`) exists to warn against.
 *
 * S7 introduces the three Entry ops, so this file pins their wire format and
 * their effect on folded state, replayed through the current reducer on every
 * push to `main`. It carries **only** those three plus the Trip-root and Gear
 * ops needed to give them something to reference — the earlier fixtures keep
 * their own op types.
 *
 * Two probes are un-authorable by our own builders:
 *
 * 1. **`e-s7-malformed`'s `source: { from: "elsewhere", … }`** — no builder
 *    can construct an `EntrySource` with an unrecognised `from`; it stands in
 *    for a peer on a later build with a fourth source kind this one has never
 *    heard of.
 * 2. **`e-s7-per-person`'s `trip.entry_bring_count_set`** — invariant 6 says a
 *    Bring-count exists only on a Counted depot Entry, but that is an
 *    authoring-screen rule, not a reducer gate (`bringCountOf`'s job). The
 *    underlying gear here is `per_person`, so this op stands for a foreign
 *    client, or a since-changed Kind, that violates the invariant; the reader
 *    folds it anyway.
 *
 * `e-s7-out-of-order` pins a third thing no builder call ordering can force:
 * its `trip.entry_removed` carries a **lower `seq`** than its own
 * `trip.entry_added` — the update arrives (by push order) before the create,
 * exactly the shape `TripState.phase`'s doc already describes for
 * `trip.phase_moved` arriving ahead of `trip.created`. `writeEntry` creates
 * the stub Entry regardless of which op reaches it first.
 */

/** The Trip every entry op in the fixture addresses. */
const TRIP = 't-s7-1'
/** The depot Entry, referencing recorded gear. */
const DEPOT_ENTRY = 'e-s7-depot'
/** The trip-only Entry, whose `name` is an explicit `null`. */
const TRIP_ONLY_ENTRY = 'e-s7-trip-only'
/** The Entry whose `source.from` this build has never heard of. */
const MALFORMED_ENTRY = 'e-s7-malformed'
/** The per-person Entry carrying a Bring-count invariant 6 forbids. */
const PER_PERSON_ENTRY = 'e-s7-per-person'
/** The Entry whose `trip.entry_removed` has a lower `seq` than its own `trip.entry_added`. */
const OUT_OF_ORDER_ENTRY = 'e-s7-out-of-order'

describe('the S7 fixture', () => {
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

  it('maps the wire gear_id onto a gearId register', () => {
    const entry = fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[
      DEPOT_ENTRY
    ]
    expect(entry?.source?.value).toEqual({ from: 'depot', gearId: 'g-s7-tent' })
  })

  it('keeps an explicit null name on a trip-only source', () => {
    const entry = fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[
      TRIP_ONLY_ENTRY
    ]
    expect(entry?.source?.value).toEqual({
      from: 'trip_only',
      name: null,
      container: false,
    })
  })

  it('retains a malformed source as an Entry with no source register', () => {
    const entry = fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[
      MALFORMED_ENTRY
    ]
    expect(entry).toBeDefined()
    expect(entry?.source).toBeUndefined()
  })

  it('folds a Bring-count on a per-person Entry — invariant 6 is the authoring screen’s job', () => {
    const entry = fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[
      PER_PERSON_ENTRY
    ]
    expect(entry?.bringCount?.value).toBe(2)
  })

  it('creates the Entry from whichever op reaches it first, seq order notwithstanding', () => {
    const entry = fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[
      OUT_OF_ORDER_ENTRY
    ]
    expect(entry?.removed?.value).toBe(true)
    expect(entry?.source?.value).toEqual({
      from: 'depot',
      gearId: 'g-s7-out-of-order',
    })
  })
})
