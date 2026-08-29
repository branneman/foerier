import { describe, expect, it } from 'vitest'

import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

import fixture from '../fixtures/s4-ownership.ops.json' with { type: 'json' }

/**
 * **Captured one slice late, and that is a weakness worth stating plainly.**
 *
 * [Architecture §8.7](../../docs/architecture-design.md) and `testing.md`'s
 * backward-compatibility group oblige every slice from S2 onwards to capture
 * an op fixture for the op types in its §8.3 entry, in the slice that
 * introduces them. S4 did not: its spec §5.4 said "the fixture rule from S3's
 * spec §9.4 applies unchanged" and no file landed, so `person.renamed` and
 * `gear.ownership_set` — two op types whose wire format §5.4 froze the moment
 * S4 shipped — have been pinned by nothing since.
 *
 * S6 pays the debt (its spec §5.5). The catch is that a fixture is only a
 * capture of the format *as it was when captured*: this one is folded by the
 * S6 reducer, so a format drift between S4 and here is baked into the
 * snapshot as if it had always been the format, and nothing in the repo could
 * now tell the difference. A same-slice capture has no such window. One slice
 * of window is nevertheless strictly better than what the third slice from
 * now would have found — the same gap with three slices of drift in it — and
 * that is the whole argument for paying it here rather than perfectly.
 *
 * Unlike S2's and S6's `null` names, the `null` here is **authorable by our
 * own builder**: S4 settled `person.renamed` as `{name: string | null}` and
 * `personRenamed`'s parameter says so, because the People screen's rename
 * field can legitimately be emptied. Nothing in this file is a
 * forward-compatibility probe.
 *
 * The file carries **only** the two S4 op types, which is why no Person here
 * is `person.recorded` and no Gear is `gear.recorded`: those belong to the S2
 * fixture, a slice adds its own rather than editing a captured one, and the
 * fold creates an entity on first sight of any op naming it. The Gear below
 * therefore exists with an `owner` register and no name at all — a real
 * out-of-authoring-order state (§8.2), not an artefact of the fixture.
 */

/** Renamed to a real name — the ordinary path. */
const RENAMED_PERSON = '33333333-0000-7000-8000-000000000001'
/** Renamed to an explicit `null`, which clears the register. */
const NULLED_NAME_PERSON = '33333333-0000-7000-8000-000000000002'
/** Shared → personal → shared, then a lower-clocked personal set that loses. */
const RETURNED_GEAR = '44444444-0000-7000-8000-000000000001'
/** Set personal once and left there. */
const PERSONAL_GEAR = '44444444-0000-7000-8000-000000000002'

describe('the S4 ownership fixture', () => {
  // §5.4's frozen list is a test, not a convention, only because this snapshot
  // is committed and replayed on every push to `main`. A future slice that
  // changes what `gear.ownership_set` does to folded state fails here first —
  // which, until now, nothing would have.
  it('folds the S4 fixture to exactly the state it folded to when captured', () => {
    expect(fold(fixture as OpEnvelope[])).toMatchSnapshot()
  })

  it('never mutates the fixture it was given', () => {
    const before = JSON.stringify(fixture)
    fold(fixture as OpEnvelope[])
    expect(JSON.stringify(fixture)).toBe(before)
  })

  // The wire is `{type: "person", person_id}` and the register holds
  // `{type: "person", personId}` — one of the two places the reducer boundary
  // performs the snake_case → camelCase mapping, and the half of the S4 wire
  // format a hand-written payload is the only way to pin.
  it('folds a personal owner into the camelCase register the state declares', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state.gear[PERSONAL_GEAR]?.owner?.value).toEqual({
      type: 'person',
      personId: NULLED_NAME_PERSON,
    })
  })

  /**
   * Shared → personal → shared. The register ends holding `{type: "shared"}`
   * **explicitly**, carrying the clock of the op that returned it to the pool
   * — it is not erased back to absent. That distinction is the one
   * `selectors/owner.ts` deliberately reads away (absent and `shared` both
   * display as SHARED) and the fold just as deliberately keeps: only an
   * explicit write can beat a later personal write on the clock.
   */
  it('keeps a return to the shared pool as a write, not an erasure', () => {
    const owner = fold(fixture as OpEnvelope[]).gear[RETURNED_GEAR]?.owner
    expect(owner?.value).toEqual({ type: 'shared' })
    expect(owner?.hlc).toBe('2026-08-28T09:12:00.000Z-0000')
    expect(owner?.deviceId).toBe('bbbbbbbb-0000-7000-8000-000000000001')
  })

  // Arrival order is not merge order (§8.2). The last op in the file would
  // make this Gear personal if position decided anything; it carries the
  // lowest clock of the four writes to that register, so it loses.
  it('lets a lower-clocked ownership set that arrives last still lose', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state.gear[RETURNED_GEAR]?.owner?.value).toEqual({ type: 'shared' })
  })

  // Nothing here is unfoldable, and saying so is what catches a typo'd `type`:
  // an op named `gear.ownership-set` would fold into nothing at all, leave
  // every register assertion below reading an absent value, and be invisible
  // in the snapshot except as a count nobody checked.
  it('folds every op in the fixture', () => {
    expect(fold(fixture as OpEnvelope[]).unfolded.count).toBe(0)
  })

  it('renames a Person the fixture never recorded', () => {
    // `writePerson` creates the entity on first sight of any person op, so a
    // rename arriving before its `person.recorded` is a Person with a name
    // and nothing else — the general rule, pinned here on the one op type S4
    // added to that aggregate.
    const state = fold(fixture as OpEnvelope[])
    expect(state.people[RENAMED_PERSON]?.id).toBe(RENAMED_PERSON)
    expect(state.people[RENAMED_PERSON]?.name?.value).toBe('Maren Bakker')
  })

  // `PersonState.name` is `Register<string | null>` like every other name
  // register, so §1.3's null-clears rule applies with no carve-out — the sixth
  // `name` row, settled at S4 by the general argument and pinned only now.
  it('clears a Person name given an explicit null', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state.people[NULLED_NAME_PERSON]?.name?.value).toBeNull()
  })
})
