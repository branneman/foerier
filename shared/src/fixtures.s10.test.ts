import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/s10-unpack.ops.json' with { type: 'json' }
import type { HouseholdState, EntryState } from './state.ts'
import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

/**
 * S10's half of the fixture rule
 * ([architecture §8.7](../../docs/architecture-design.md), `testing.md`'s
 * Backward-compatibility group): **capture an op fixture in the same commit
 * as the slice that introduces the op type**. S4's fixture landed a slice
 * late — `fixtures.s4.test.ts`'s own header says so — and the drift between
 * S4 and S6 is now baked into that snapshot as though it had always been the
 * format. This file exists so the same thing does not happen to S10: it pins
 * `trip.outcome_set` and `trip.consumed_count_set` through the reducer as it
 * actually shipped, replayed on every push to `main`.
 *
 * It carries **only** those two op types plus the Person, Trip, participant,
 * Gear and `trip.entry_added` ops needed to give them something to
 * reference — the earlier fixtures keep their own op types, and this one
 * keeps to S10's.
 *
 * Every op below is either **captured** — something a screen this slice
 * builds could actually author — or a **forward-compatibility probe**,
 * standing for a peer on a later build or a foreign client rather than for
 * anything this slice's own screens offer:
 *
 * 1. **`e-s10-boots`'s `trip.outcome_set{outcome: "mislaid"}`.** §1.2 types
 *    `OutcomeValue` as `'back' | 'consumed' | 'lost' | (string & {})` —
 *    open past its three known members, exactly as `KindValue` and
 *    `PhaseValue` already are. No sheet this slice draws offers a control
 *    that emits an outcome other than the three named ones; this op stands
 *    for a later build's fourth outcome, or a foreign client, landing on a
 *    replica that has never heard the spelling. Folded and read back
 *    verbatim, never coerced.
 * 2. **`e-s10-tarp`'s `trip.consumed_count_set{count: 2}`.** §1.4 states
 *    that a Consumed-count is a **reader gate**, not a reducer gate: the
 *    catalogue's "on a counted Entry resolved as consumed" is an authoring
 *    rule, and the Kind lives on the Gear aggregate — a different aggregate
 *    with no ordering against the Trip's, so gating in the reducer would
 *    make the fold order-dependent on arrival order. `g-s10-tarp` is
 *    recorded `kind: "single"`, and no screen in this slice would ever
 *    offer its stepper on a Single Entry. This op proves the fold happens
 *    anyway; `consumedCountOf` is what declines to use the number for
 *    anything, on the way out.
 *
 * Everything else is **captured**: a screen offering the outcome sheet, the
 * roster sheet and the Consumed-count stepper could author every other op
 * here, including the Piece-level write, the depot container's row, and the
 * null that clears a resolution back to open.
 */

/** The Trip every op in the fixture addresses. */
const TRIP = 't-s10-1'
/** Resolved `back` — the ordinary case. */
const TENT = 'e-s10-tent'
/** Resolved `lost`. */
const MAP = 'e-s10-map'
/** Counted; resolved `consumed` with an explicit Consumed-count. */
const FUEL = 'e-s10-fuel'
/** Resolved `back`, then explicitly cleared back to open with `null`. */
const TORCH = 'e-s10-torch'
/** Per-person: one Piece resolved, its sibling untouched. */
const HEADLAMP = 'e-s10-headlamp'
/** A depot container Entry (F1's row), resolved `back`. */
const CRATE = 'e-s10-crate'
/** The unrecognised-outcome probe. */
const BOOTS = 'e-s10-boots'
/** The reader-gate probe: a Consumed-count on a Single Entry. */
const TARP = 'e-s10-tarp'
const MARK = 'p-s10-1'
const ELS = 'p-s10-2'

function entryOf(
  state: HouseholdState,
  entryId: string,
): EntryState | undefined {
  return state.trips[TRIP]?.entries?.[entryId]
}

describe('the S10 fixture', () => {
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

  it('resolves an Entry back', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, TENT)?.outcome?.value).toBe('back')
  })

  it('resolves an Entry lost', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, MAP)?.outcome?.value).toBe('lost')
  })

  it('resolves an Entry consumed and folds its Consumed-count', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, FUEL)?.outcome?.value).toBe('consumed')
    expect(entryOf(state, FUEL)?.consumedCount?.value).toBe(4)
  })

  // Obligation 5's §1.3 shape, restated for the first nullable *enum*: an
  // outcome that was set and then explicitly cleared holds a register whose
  // value is `null` — a different fact from a register no op ever touched.
  // Reading it back as anything other than a present key holding `null`
  // would mean the reducer collapsed the two, which is the one shape no
  // other fixture in this repo can pin.
  it('clears a resolved outcome back to open with an explicit null, distinct from absent', () => {
    const state = fold(fixture as OpEnvelope[])
    const torch = entryOf(state, TORCH)
    expect(Object.hasOwn(torch ?? {}, 'outcome')).toBe(true)
    expect(torch?.outcome?.value).toBeNull()
    // A register nobody has ever addressed carries no key at all — the
    // Depot container's `consumedCount`, since only `trip.consumed_count_set`
    // writes it and nothing here addresses the Crate's.
    expect(Object.hasOwn(entryOf(state, CRATE) ?? {}, 'consumedCount')).toBe(
      false,
    )
  })

  it('resolves one Piece while its sibling stays untouched', () => {
    const state = fold(fixture as OpEnvelope[])
    const pieces = entryOf(state, HEADLAMP)?.pieces
    expect(pieces?.[MARK]?.outcome?.value).toBe('back')
    expect(pieces?.[ELS]).toBeUndefined()
  })

  it('resolves a depot container Entry (F1) exactly as an ordinary Entry', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, CRATE)?.outcome?.value).toBe('back')
  })

  it('folds an unrecognised outcome verbatim and never coerces it', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, BOOTS)?.outcome?.value).toBe('mislaid')
  })

  it('folds a Consumed-count on a Single Entry regardless of Kind', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state.gear['g-s10-tarp']?.kind?.value).toBe('single')
    expect(entryOf(state, TARP)?.consumedCount?.value).toBe(2)
    // No outcome was ever addressed on this Entry — absent, not `null`.
    expect(Object.hasOwn(entryOf(state, TARP) ?? {}, 'outcome')).toBe(false)
  })
})
