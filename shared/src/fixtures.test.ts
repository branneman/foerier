import { describe, expect, it } from 'vitest'

import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

import fixture from '../fixtures/s2-depot.ops.json' with { type: 'json' }

/**
 * The two Gear ids the fixture exists to pull apart (`sync-protocol.md` §1.3,
 * §5.3 obligation 5): `gear.renamed` carries an explicit `null` on one — a
 * write that clears the register — and `gear.rehomed` simply omits
 * `residence` on the other, which must leave the register untouched. Named
 * here rather than re-derived from the fixture, so a future edit to the id
 * scheme cannot silently point these at the wrong entity.
 */
const NULLED_NAME_GEAR = '44444444-0000-7000-8000-000000000009'
const OMITTED_RESIDENCE_GEAR = '44444444-0000-7000-8000-00000000000a'

describe('the S2 op fixture', () => {
  // `sync-protocol.md` §5.4's frozen list is a test, not a convention, only
  // because this snapshot is committed and replayed on every push to `main`
  // (`docs/testing.md`, Backward-compatibility testing). A future slice that
  // changes an existing op type's effect on folded state fails here first.
  it('folds the S2 fixture to exactly the state it folded to when captured', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state).toMatchSnapshot()
  })

  // Obligation 1: an unknown `type` (`trip.entry_status_set`, a real S6
  // catalogue entry this build has never heard of) is retained and counted,
  // never rejected and never folded.
  it('retains the op types it cannot fold rather than rejecting them', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state.unfolded.types['trip.entry_status_set']).toBe(1)
  })

  it('never mutates the fixture it was given', () => {
    const before = JSON.stringify(fixture)
    fold(fixture as OpEnvelope[])
    expect(JSON.stringify(fixture)).toBe(before)
  })

  // Obligation 5: absent is not null. The `null` is a write that clears;
  // the omission leaves the register exactly as it was.
  it('distinguishes an explicit null from an absent field', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state.gear[NULLED_NAME_GEAR]?.name?.value).toBeNull()
    expect(
      Object.hasOwn(state.gear[OMITTED_RESIDENCE_GEAR] ?? {}, 'residence'),
    ).toBe(false)
  })
})
