import { describe, expect, it } from 'vitest'

import fixture from '../fixtures/s12-notes.ops.json' with { type: 'json' }
import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'
import type { HouseholdState } from './state.ts'

/**
 * S12's half of the fixture rule
 * ([architecture §8.7](../../docs/architecture-design.md), `testing.md`'s
 * Backward-compatibility group): **capture an op fixture in the same commit
 * as the slice that introduces the op type**. S4's landed a slice late and
 * baked a drift into the snapshot as though it had always been the format;
 * this file exists so `trip.note_posted` and `trip.note_kept` cannot repeat
 * it. It carries only S12's two op types plus the Trip, Gear and
 * `trip.entry_added` ops needed to give them something to reference.
 *
 * Four Notes, each earning its place — two captured, two probes standing for
 * a peer rather than for anything this slice's own code emits:
 *
 * 1. **`n-s12-gas`** — posted *about* an Entry, then kept. The ordinary
 *    reviewed case, and the one that pins `entry_id` on the wire.
 * 2. **`n-s12-chair`** — posted about an Entry, then **discarded**. Two
 *    facts at once: a discard leaves a **present** `kept` register holding
 *    `false` (ruling I16 — a discarded Note never vanishes, and a dropped
 *    key would read identically to unreviewed), and its `entry_id` names an
 *    Entry no op in this file ever adds. The reference is to an id and
 *    survives the Entry not being there, which is I10's *a removed Entry
 *    keeps reading* in its harder form.
 * 3. **`n-s12-gloves`** — posted with **no** `entry_id` key at all, never
 *    reviewed. The Trip-wide Note and the unreviewed third state (I13) in
 *    one: `entryId` and `kept` are both absent, and absent is not `null`.
 * 4. **`n-s12-ghost`** — `trip.note_kept` with no `trip.note_posted`
 *    anywhere, from a second Device. A peer's review arriving before the
 *    post it addresses: the register is written all the same, the Note is
 *    retained holding no `text`, and the reader (`notesOf`) is what leaves
 *    it off the screen.
 */

/** The Trip every op in the fixture addresses. */
const TRIP = 't-s12-1'
/** Posted about an Entry, then kept — the ordinary case. */
const GAS = 'n-s12-gas'
/** Discarded, and about an Entry this fixture never adds. */
const CHAIR = 'n-s12-chair'
/** About the Trip, never reviewed. */
const GLOVES = 'n-s12-gloves'
/** Reviewed by a peer before its post arrived. */
const GHOST = 'n-s12-ghost'

function noteOf(state: HouseholdState, noteId: string) {
  return state.trips[TRIP]?.notes?.[noteId]
}

describe('the S12 fixture', () => {
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

  it('carries text and the entry reference through the wire format', () => {
    const note = noteOf(fold(fixture as OpEnvelope[]), GAS)

    expect(note?.text?.value).toBe(
      'Ran low on gas by day 2. Bring ×6 next time.',
    )
    expect(note?.entryId?.value).toBe('e-s12-gas')
    expect(note?.kept?.value).toBe(true)
  })

  // I16: a discard is a present register holding `false`, never a dropped
  // key — which would read identically to a Note nobody has reviewed.
  it('folds a discard as a present register, distinct from unreviewed', () => {
    const state = fold(fixture as OpEnvelope[])

    expect(noteOf(state, CHAIR)?.kept?.value).toBe(false)
    expect(Object.hasOwn(noteOf(state, CHAIR) ?? {}, 'kept')).toBe(true)
    expect(noteOf(state, GLOVES)?.kept).toBeUndefined()
  })

  // The reference is an id, and nothing in the fold resolves it. An Entry
  // this replica has never heard of is the same case as one since removed.
  it('keeps an entry reference to an Entry this replica has not folded', () => {
    const state = fold(fixture as OpEnvelope[])

    expect(state.trips[TRIP]?.entries?.['e-s12-chair']).toBeUndefined()
    expect(noteOf(state, CHAIR)?.entryId?.value).toBe('e-s12-chair')
  })

  // An omitted key is absent, not `null` — the distinction obligation 5 is
  // built on, and the one the authoring builder exists to preserve.
  it('leaves entryId absent for a Note posted about the Trip', () => {
    const note = noteOf(fold(fixture as OpEnvelope[]), GLOVES)

    expect(note?.text?.value).toBe('Warmer gloves next time.')
    expect(note?.entryId).toBeUndefined()
  })

  // Spec §2's *"folds unconditionally"*: a review naming a Note this replica
  // has never seen posted still writes its register.
  it('folds a review that arrives before its post, a forward-compatibility probe', () => {
    const note = noteOf(fold(fixture as OpEnvelope[]), GHOST)

    expect(note?.kept?.value).toBe(true)
    expect(note?.text).toBeUndefined()
  })
})
