import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/s11-reopen.ops.json' with { type: 'json' }
import type { HouseholdState } from './state.ts'
import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

/**
 * S11's half of the fixture rule
 * ([architecture §8.7](../../docs/architecture-design.md), `testing.md`'s
 * Backward-compatibility group): **capture an op fixture in the same commit
 * as the slice that introduces the op type**. S4's fixture landed a slice
 * late — `fixtures.s4.test.ts`'s own header says so — and the drift between
 * S4 and S6 is now baked into that snapshot as though it had always been the
 * format. This file exists so the same thing does not happen to
 * `trip.consumption_posted` (spec §2.1, §4): it pins the op through the
 * reducer as it actually shipped, replayed on every push to `main`.
 *
 * It carries **only** S11's op type plus the Trip, Gear and `trip.entry_added`
 * ops needed to give it something to reference — the earlier fixtures keep
 * their own op types, and this one keeps to S11's.
 *
 * Every posting below is either **captured** — something the close
 * (spec §2.3) or the offer (spec §3) could actually author — or a
 * **forward-compatibility probe**, standing for a peer on a later build
 * rather than for anything this slice's own code emits:
 *
 * 1. **`g-s11-fuel`'s `trip.consumption_posted{units: 4}`.** The ordinary
 *    case: the close's reduction landed and posted what it took.
 * 2. **`g-s11-tent`'s `trip.consumption_posted{units: 0}`.** §2.1 says an
 *    absent register and an explicit `0` are different facts — absent means
 *    no close ever posted this Gear, `0` means a restoration (the offer,
 *    spec §3) took it back to nothing. This op proves `0` folds and leaves a
 *    **present** register, not a dropped key that would read the same as
 *    absence.
 * 3. **`g-s11-ghost`'s `trip.consumption_posted{units: 3}`.** No
 *    `gear.recorded` in this file ever creates `g-s11-ghost` — standing for a
 *    peer whose Gear op has not arrived yet. §2.1's *"folds unconditionally"*
 *    means the register is written all the same: folded, retained, read back
 *    verbatim, never gated on the Gear existing.
 */

/** The Trip every op in the fixture addresses. */
const TRIP = 't-s11-1'
/** Counted; posted the ordinary way. */
const FUEL = 'g-s11-fuel'
/** Single; posted an explicit `0` — the restoration probe. */
const TENT = 'g-s11-tent'
/** Never recorded as Gear — the forward-compatibility probe. */
const GHOST = 'g-s11-ghost'

function postingOf(state: HouseholdState, gearId: string) {
  return state.trips[TRIP]?.postings?.[gearId]
}

describe('the S11 fixture', () => {
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

  it('posts the ordinary case', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(postingOf(state, FUEL)?.value).toBe(4)
  })

  // §2.1: an explicit `0` is a present register, distinct from one no op
  // has ever addressed — the fixture's whole reason for existing.
  it('folds an explicit 0 as a present register, distinct from absent', () => {
    const state = fold(fixture as OpEnvelope[])
    const tent = postingOf(state, TENT)
    expect(tent).toBeDefined()
    expect(tent?.value).toBe(0)
    expect(Object.hasOwn(state.trips[TRIP]?.postings ?? {}, TENT)).toBe(true)

    // No op ever posted anything for the Trip's own gear that carries no
    // posting at all — the other half of the absent/present pair. There is
    // no such gear in this fixture, so the negative case is the ghost's
    // Gear-side absence, asserted separately below.
    expect(state.gear[TENT]?.kind?.value).toBe('single')
  })

  // §2.1's *"folds unconditionally"*: a posting naming a Gear this replica
  // has never heard `gear.recorded` for still folds, retained and readable.
  it('folds a posting for a Gear this replica has never recorded, a forward-compatibility probe', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state.gear[GHOST]).toBeUndefined()
    expect(postingOf(state, GHOST)?.value).toBe(3)
  })
})
