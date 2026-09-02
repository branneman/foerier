import { describe, expect, it } from 'vitest'

import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

import fixture from '../fixtures/s2-depot.ops.json' with { type: 'json' }

/**
 * `docs/testing.md` frames this fixture as ops "captured from a previous app
 * version" — true of every op here except the two `{name: null}` ones below.
 * `authoring.ts` types the `name` of `gearRenamed` and `placeRenamed` — the
 * two builders these probes are on — as `string`, so no foerier client, past
 * or present, can author a `null` through either; these two are
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

  // Obligation 1 **discharged.** `trip.entry_status_set` was captured at S2a
  // as an unknown-type probe: a real catalogue entry that build had never
  // heard of, retained and counted rather than rejected. S9a folds it, and
  // this assertion is the other end of that promise — the op sat verbatim in
  // a log across seven slices and a later build read it. Nothing was
  // discarded, and nothing had to be re-sent.
  it('folds the op it retained as unknown when it was captured', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state.unfolded.types['trip.entry_status_set']).toBeUndefined()
    expect(state.unfolded.count).toBe(0)
    const entry =
      state.trips['66666666-0000-7000-8000-000000000001']?.entries?.[
        '77777777-0000-7000-8000-000000000001'
      ]
    expect(entry?.status?.value).toBe('packed')
    // No `trip.entry_added` accompanies it, so the Entry is sourceless —
    // folded, retained, and excluded from every list by `entriesOf`.
    expect(entry?.source).toBeUndefined()
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
