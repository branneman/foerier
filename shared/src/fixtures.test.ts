import { describe, expect, it } from 'vitest'

import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

import fixture from '../fixtures/s2-depot.ops.json' with { type: 'json' }

/**
 * `docs/testing.md` frames this fixture as ops "captured from a previous app
 * version" — true of every op here except the two `{name: null}` ones below.
 * `authoring.ts` types every builder's `name` as `string`, so no foerier
 * client, past or present, can author a `null` name; these two are
 * **forward-compatibility probes**, standing in for a foreign or future
 * client that legitimately sends one (`sync-protocol.md` §1.3 permits it —
 * see `reduce.ts`'s `writeNullableIfPresent`). Do not read them as evidence
 * some old build once emitted a null name.
 *
 * The ids the fixture exists to pull apart (§1.3; obligation 5 is only the
 * absent-leaves-it-alone half — §1.3 is the authority for the null-clears
 * half too): `gear.renamed` carries an explicit `null` on one Gear — a write
 * that clears the register — and `gear.rehomed` simply omits `residence` on
 * another, which must leave the register untouched. `NULLED_NAME_PLACE` pins
 * the same clear on `place.renamed`, alongside `NULLED_NAME_GEAR` — the two
 * must behave identically, since both `PlaceState.name` and `GearState.name`
 * are `Register<string | null>` and the rule is uniform across every
 * nullable register, not per op (the ruling that corrected `setPlaceName`,
 * which used to collapse Place's `null` into absent). Named here rather than
 * re-derived from the fixture, so a future edit to the id scheme cannot
 * silently point these at the wrong entity.
 */
const NULLED_NAME_PLACE = '22222222-0000-7000-8000-000000000001'
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

  // Obligation 1: an unknown `type` (`trip.entry_status_set`, a real
  // catalogue entry — S9's — this build has never heard of) is retained and
  // counted, never rejected and never folded. It stays unknown through S6,
  // which folds the Trip *root* and none of the four nested maps.
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

  // The null-clears-a-name rule is uniform, not per aggregate: Place's
  // `place.renamed{name: null}` clears its register exactly as Gear's
  // `gear.renamed{name: null}` does above — pinning the fix that corrected
  // `setPlaceName`'s earlier, inconsistent collapse of `null` into absent.
  it('clears a Place name the same way it clears a Gear name', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state.places[NULLED_NAME_PLACE]?.name?.value).toBeNull()
  })
})
