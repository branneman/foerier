import { describe, expect, it } from 'vitest'

import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

import fixture from '../fixtures/s6-trips.ops.json' with { type: 'json' }

/**
 * S6's half of the fixture rule
 * ([architecture §8.7](../../docs/architecture-design.md), `testing.md`'s
 * Backward-compatibility group): **capture an op fixture in the same slice
 * that introduces the op type.** This one is captured on time — see
 * `fixtures.s4.test.ts` for what a slice's worth of delay costs.
 *
 * S6 introduces the six Trip root ops, so this file pins their wire format and
 * their effect on folded state, replayed through the current reducer on every
 * push to `main`. It carries **only** those six: the earlier fixtures keep
 * their own op types, because a slice adds a fixture rather than editing a
 * captured one. That is also why no Person here is `person.recorded` — the
 * participant registers below are keyed by ids this file never records, which
 * is correct rather than sloppy. A participant register is a person id, not a
 * foreign key, and the fold has never validated one.
 *
 * **Four ops here are un-authorable by our own builders**, exactly as S3's
 * foreign tags are. They stand in for a client on a different build, and none
 * of them is evidence that some old build of ours emitted one:
 *
 * 1. **`trip.created{from_trip_id}`** — `tripCreated` has no such parameter
 *    and will not until S14 copies a Trip from a template (spec §1.3). The
 *    reducer folds the field regardless, and §5.4 freezes the payload shape
 *    the moment this slice ships, so a fixture is the only thing that can
 *    prove a field nothing yet reads is carried at all.
 * 2. **`trip.phase_moved{phase: "shakedown"}`** — `PhaseValue` is open past
 *    its five members (§5.3 obligation 4), but `tripPhaseMoved`'s callers only
 *    ever pass one of the five. A sixth can only come from a later build.
 * 3. **`trip.dates_set{start: "next weekend"}`** — there is deliberately no
 *    format gate on either side (§1.4), so a peer on a build with a different
 *    date convention is exactly what this stands for. Our own screens emit
 *    `YYYY-MM-DD` from a date input.
 * 4. **`trip.renamed{name: null}`** — the builders type `name` as `string`,
 *    because no screen can author a Trip with no name; the nullable register
 *    exists for a *reader* meeting an op some other build emitted (§1.2).
 */

/** The ordinary path: created, dated, crewed, renamed, moved, then re-dated. */
const ORDINARY_TRIP = '99999999-0000-7000-8000-000000000001'
/** Carries three of the four probes: `from_trip_id`, a null name, a foreign
 * phase and a date that is not one. */
const FOREIGN_TRIP = '99999999-0000-7000-8000-000000000002'
/** Closed, then moved to `draft` by a *lower* clock arriving later in the file. */
const LATE_LOSER_TRIP = '99999999-0000-7000-8000-000000000003'

const KEPT_PARTICIPANT = '33333333-0000-7000-8000-000000000001'
const DROPPED_PARTICIPANT = '33333333-0000-7000-8000-000000000002'

describe('the S6 trip fixture', () => {
  // §5.4's frozen list is a test, not a convention, only because this snapshot
  // is committed and replayed. A future slice that changes what any of the six
  // ops does to folded state fails here first.
  it('folds the S6 fixture to exactly the state it folded to when captured', () => {
    expect(fold(fixture as OpEnvelope[])).toMatchSnapshot()
  })

  it('never mutates the fixture it was given', () => {
    const before = JSON.stringify(fixture)
    fold(fixture as OpEnvelope[])
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('folds the ordinary path into a named, dated, moved Trip', () => {
    const trip = fold(fixture as OpEnvelope[]).trips[ORDINARY_TRIP]
    expect(trip?.name?.value).toBe('Ardennes, August')
    expect(trip?.phase?.value).toBe('pack_out')
    expect(trip?.startDate?.value).toBe('2026-08-14')
  })

  // Two independent registers (§1.4): the second `trip.dates_set` carries
  // `end: null` and no `start` at all, so it clears one and leaves the other
  // holding the *first* op's stamp. This is the pair the wire format cannot
  // express twice — a payload that omitted the key and one that sent `null`
  // would be indistinguishable if the reader collapsed them.
  it('clears the end date without touching the start it omitted', () => {
    const trip = fold(fixture as OpEnvelope[]).trips[ORDINARY_TRIP]
    expect(trip?.endDate?.value).toBeNull()
    expect(trip?.startDate?.hlc).toBe('2026-08-29T09:01:00.000Z-0000')
  })

  // `sync-protocol.md` §3.4: one register per person id, and a removal folds
  // to `false` rather than a dropped key — a value with a clock, which is what
  // lets a concurrent re-add win on merit instead of on arrival order.
  it('folds participants into per-person registers, removal included', () => {
    const trip = fold(fixture as OpEnvelope[]).trips[ORDINARY_TRIP]
    expect(trip?.participants?.[KEPT_PARTICIPANT]?.value).toBe(true)
    expect(trip?.participants?.[DROPPED_PARTICIPANT]?.value).toBe(false)
    expect(Object.keys(trip?.participants ?? {})).toHaveLength(2)
  })

  /** Probe 1. Folded at S6, read by nobody until S14 (§1.3). */
  it('folds a from_trip_id no builder of ours can author', () => {
    const trip = fold(fixture as OpEnvelope[]).trips[FOREIGN_TRIP]
    expect(trip?.fromTripId?.value).toBe(ORDINARY_TRIP)
    // The Trip the ordinary path built is the template, and nothing about it
    // changed by being one: provenance is a register on the copy.
    expect(
      Object.hasOwn(
        fold(fixture as OpEnvelope[]).trips[ORDINARY_TRIP]!,
        'fromTripId',
      ),
    ).toBe(false)
  })

  /** Probe 2. §5.3 obligation 4, the rule `gear.kind_set` already follows. */
  it('stores a phase this build does not recognise verbatim', () => {
    const trip = fold(fixture as OpEnvelope[]).trips[FOREIGN_TRIP]
    expect(trip?.phase?.value).toBe('shakedown')
  })

  /** Probe 3. No format gate, on either side (§1.4). */
  it('stores a date that is not a date verbatim', () => {
    const trip = fold(fixture as OpEnvelope[]).trips[FOREIGN_TRIP]
    expect(trip?.startDate?.value).toBe('next weekend')
  })

  /** Probe 4. The seventh and eighth `name` rows, settled by §1.3's general
   * rule rather than a carve-out. */
  it('clears a Trip name given an explicit null', () => {
    const trip = fold(fixture as OpEnvelope[]).trips[FOREIGN_TRIP]
    expect(trip?.name?.value).toBeNull()
  })

  // Arrival order is not merge order (§8.2). The move to `draft` sits last in
  // the file and carries the lower clock, so it loses — which is what makes
  // this fixture a proof that the fold is order-independent rather than
  // last-write-wins-by-position.
  it('lets a lower-clocked phase move that arrives later still lose', () => {
    const trip = fold(fixture as OpEnvelope[]).trips[LATE_LOSER_TRIP]
    expect(trip?.phase?.value).toBe('closed')
    expect(trip?.phase?.hlc).toBe('2026-08-29T09:30:00.000Z-0000')
  })

  // Nothing here is unfoldable: every op is one of the six this slice builds,
  // and the probes are ordinary ops carrying values a later build would send.
  // A probe that landed in `unfolded` would be proving nothing about the fold.
  it('folds every op in the fixture', () => {
    expect(fold(fixture as OpEnvelope[]).unfolded.count).toBe(0)
  })
})
