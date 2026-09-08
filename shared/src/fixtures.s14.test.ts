import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/s14-templates.ops.json' with { type: 'json' }
import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'
import { entriesOf, entryLabel } from './selectors/entry.ts'
import { notesOf } from './selectors/note.ts'
import { tasksOf } from './selectors/task.ts'
import { tripStandingOf, visibleTrips } from './selectors/trip.ts'

/**
 * S14's half of the fixture rule
 * ([architecture §8.7](../../docs/architecture-design.md), `testing.md`'s
 * Backward-compatibility group): **capture an op fixture in the same commit
 * as the slice that introduces the op type**. S4's landed a slice late and
 * baked a drift into its own snapshot as though it had always been the
 * format; this file is what stops that happening to `trip.deleted` and to
 * the template batch (spec §1.3).
 *
 * It carries three Trips.
 *
 * **`t-s14-source`** is deleted, and its `trip.deleted` is the fixture's
 * **first forward-compatibility probe**: it carries a payload field,
 * `{"reason": "duplicate"}`, that no builder of ours authors and no reader
 * of ours understands. Obligation 2 (§5.3) says such a field is ignored for
 * the fold and the op is retained verbatim — so the tombstone lands and the
 * extra key changes nothing. It is written here rather than left to
 * imagination because `trip.deleted`'s payload is `{}` today, and `{}` is
 * exactly the payload a later slice is most likely to want to add a field
 * to.
 *
 * **`t-s14-copy`** is a whole template batch as `startTripFrom` emits one: a
 * `trip.created` **carrying `from_trip_id`** — now authorable, where S6's
 * own fixture had to hand-shape the identical wire shape because no builder
 * could produce it — then two depot Entries, one Bring-count, a trip-only
 * Entry, two tasks and two notes. It pins four properties of the copy at the
 * wire level, each of which is a decision rather than an accident:
 *
 * 1. one note carries a **re-pointed** `entry_id` (`e-s14-tent`, an Entry in
 *    this same batch — never the source Trip's own entry id);
 * 2. the other carries **no `entry_id` key at all**, which is what a Note
 *    about the Trip looks like on the wire, and what a copied Note whose
 *    subject did not survive is turned into;
 * 3. **no `trip.task_ticked` appears**, because tasks copy unticked *by
 *    absence*;
 * 4. **no `trip.note_kept` appears**, because a copied Note arrives
 *    unreviewed — `kept` is the source Trip's verdict (I13).
 *
 * The batch also carries **no** dates, participants, statuses, journeys,
 * outcomes or postings, and that absence is the whole of *start fresh*. A
 * future build that started writing any of them would change this snapshot.
 *
 * **`t-s14-orphan`** is the **second probe**: a `trip.created` whose
 * `from_trip_id` names a Trip that is not in this log and never will be. It
 * is ruling J19's withdrawal case exactly as it arrives from a peer — the
 * register folds, and the surface that reads it has nothing to name.
 */

const SOURCE = 't-s14-source'
const COPY = 't-s14-copy'
/** Its `from_trip_id` names a Trip no log here holds — the J19 probe. */
const ORPHAN_TRIP = 't-s14-orphan'

function folded() {
  return fold(fixture as OpEnvelope[])
}

describe('the S14 fixture', () => {
  it('folds to exactly the state it folded to when captured', () => {
    expect(folded()).toMatchSnapshot()
  })

  it('never mutates the fixture it was given', () => {
    const before = JSON.stringify(fixture)
    folded()
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('folds every op it carries', () => {
    expect(folded().unfolded.count).toBe(0)
  })

  it('tombstones the deleted Trip and keeps everything it held', () => {
    const state = folded()
    // The entity survives the tombstone — which is why a screen guarding
    // only on `undefined` would still draw it (spec §2).
    expect(state.trips[SOURCE]).toBeDefined()
    expect(state.trips[SOURCE]?.name?.value).toBe('Vosges 2025')
    expect(state.trips[SOURCE]?.deleted?.value).toBe(true)
    expect(tripStandingOf(state, SOURCE)).toBe('deleted')
    expect(visibleTrips(state).map((trip) => trip.id)).not.toContain(SOURCE)
  })

  it('folds a trip.deleted carrying an unknown payload field — a forward-compatibility probe', () => {
    // Obligation 2: ignored for the fold, retained verbatim in the log. The
    // tombstone is the whole of what this op means, extra key or not.
    const deleteOp = (fixture as OpEnvelope[]).find(
      (op) => op.type === 'trip.deleted',
    )
    expect(deleteOp?.payload).toEqual({ reason: 'duplicate' })
    expect(folded().trips[SOURCE]?.deleted?.value).toBe(true)
  })

  it('folds from_trip_id from an op a builder can now author', () => {
    // S6 pinned the identical wire shape with a hand-shaped op because
    // `authoring.ts` had no parameter for the field. It has one now, and the
    // two eras produce the same bytes — which is the point of pinning it
    // twice rather than replacing the older probe.
    expect(folded().trips[COPY]?.fromTripId?.value).toBe(SOURCE)
  })

  it('draws the copied gear list, in the reader`s own order', () => {
    const state = folded()
    const copy = state.trips[COPY]!
    expect(
      entriesOf(copy, state).map((entry) => entryLabel(entry, state)),
    ).toEqual(['Gas canister 450', 'Passports', 'Tent Arpy 3'])
    expect(copy.entries?.['e-s14-gas']?.bringCount?.value).toBe(4)
    // The other depot Entry carries no Bring-count register at all: nobody
    // authored one on the source, so nothing was copied (spec §3.4).
    expect(copy.entries?.['e-s14-tent']?.bringCount).toBeUndefined()
  })

  it('carries the tasks unticked, by absence', () => {
    const copy = folded().trips[COPY]!
    expect(tasksOf(copy).map((task) => task.text)).toEqual([
      'Book the Rothenbrunnen hut',
      'Renew the DAV cards',
    ])
    for (const task of Object.values(copy.tasks ?? {})) {
      expect(task.ticked).toBeUndefined()
    }
  })

  it('carries both notes unreviewed, one with a subject and one without', () => {
    const copy = folded().trips[COPY]!
    const notes = notesOf(copy)
    expect(notes.map((note) => note.kept)).toEqual([undefined, undefined])
    expect(notes[0]?.entryId).toBe('e-s14-tent')
    // A Note about the Trip: the key is absent on the wire, so the register
    // is absent in the fold. This is also what a copied Note whose subject
    // did not survive is turned into.
    expect(notes[1]?.entryId).toBeUndefined()
  })

  it('writes nothing for what a template starts fresh', () => {
    const copy = folded().trips[COPY]!
    expect(copy.startDate).toBeUndefined()
    expect(copy.endDate).toBeUndefined()
    expect(copy.participants).toBeUndefined()
    expect(copy.postings).toBeUndefined()
    for (const entry of Object.values(copy.entries ?? {})) {
      expect(entry.status).toBeUndefined()
      expect(entry.stage).toBeUndefined()
      expect(entry.outcome).toBeUndefined()
      expect(entry.consumedCount).toBeUndefined()
    }
  })

  it('folds a from_trip_id naming a Trip that is not here — a forward-compatibility probe', () => {
    // J19's withdrawal case as it actually arrives. The register folds and
    // keeps folding; it is the *surface* that withdraws, and it decides
    // through exactly this read.
    const state = folded()
    expect(state.trips[ORPHAN_TRIP]?.fromTripId?.value).toBe(
      't-s14-never-folded',
    )
    expect(tripStandingOf(state, 't-s14-never-folded')).toBe('unknown')
  })
})
