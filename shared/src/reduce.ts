import type { Stamp } from './hlc.ts'
import type { OpEnvelope } from './ops.ts'
import {
  readBoolean,
  readCount,
  readOpen,
  readOwner,
  readResidence,
  readSource,
  readString,
  type Read,
} from './payloads.ts'
import { writeRegister, type Register } from './registers.ts'
import type {
  DepotState,
  EntryState,
  GearState,
  PersonState,
  PhaseValue,
  PieceState,
  PlaceState,
  TripState,
} from './state.ts'

/**
 * The fold's starting point (`sync-protocol.md` §8.4): no places, no gear, no
 * people, no trips, and nothing unfolded.
 */
export function emptyState(): DepotState {
  return {
    places: {},
    gear: {},
    people: {},
    trips: {},
    unfolded: { count: 0, types: {} },
  }
}

/**
 * §5.3 obligation 1: an unknown `type` is retained, not rejected. Counted
 * here so it is observable, not just silently tolerated.
 */
function noteUnfolded(state: DepotState, type: string): DepotState {
  return {
    ...state,
    unfolded: {
      count: state.unfolded.count + 1,
      types: {
        ...state.unfolded.types,
        [type]: (state.unfolded.types[type] ?? 0) + 1,
      },
    },
  }
}

/**
 * Reads or creates the `PlaceState` at `id`, applies `update`, and copies
 * only what changed: the entity, the `places` map, and the top-level state.
 * Returns `state` unchanged — the identical object — when `update` returns
 * the identical `PlaceState` it was given, which is what a lost LWW write
 * does (`writeRegister`'s contract, propagated). Task 6 reuses this shape for
 * `gear`.
 */
function writePlace(
  state: DepotState,
  id: string,
  stamp: Stamp,
  update: (place: PlaceState, stamp: Stamp) => PlaceState,
): DepotState {
  const current = state.places[id] ?? { id }
  const updated = update(current, stamp)
  if (updated === current) return state
  return { ...state, places: { ...state.places, [id]: updated } }
}

/**
 * The `writePlace` shape, reused for `gear` (Task 6). Reads or creates the
 * `GearState` at `id`, applies `update`, and copies only what changed.
 */
function writeGear(
  state: DepotState,
  id: string,
  stamp: Stamp,
  update: (gear: GearState, stamp: Stamp) => GearState,
): DepotState {
  const current = state.gear[id] ?? { id }
  const updated = update(current, stamp)
  if (updated === current) return state
  return { ...state, gear: { ...state.gear, [id]: updated } }
}

/**
 * The `writePlace`/`writeGear` shape, reused for `people` (Task 7). Reads or
 * creates the `PersonState` at `id`, applies `update`, and copies only what
 * changed.
 */
function writePerson(
  state: DepotState,
  id: string,
  stamp: Stamp,
  update: (person: PersonState, stamp: Stamp) => PersonState,
): DepotState {
  const current = state.people[id] ?? { id }
  const updated = update(current, stamp)
  if (updated === current) return state
  return { ...state, people: { ...state.people, [id]: updated } }
}

/**
 * The `writePlace`/`writeGear`/`writePerson` shape a **fourth** time, for
 * `trips` (S6). Reads or creates the `TripState` at `id`, applies `update`,
 * and copies only what changed.
 *
 * Four copies of a six-line function is the point at which a generic
 * `writeEntity<K>` starts to look right. It is deliberately **not** taken
 * (spec §2): the generic needs the map key *and* the entity type as
 * parameters, which reads worse than the thing it replaces, and each of these
 * four is read far more often than it is written.
 */
function writeTrip(
  state: DepotState,
  id: string,
  stamp: Stamp,
  update: (trip: TripState, stamp: Stamp) => TripState,
): DepotState {
  const current = state.trips[id] ?? { id }
  const updated = update(current, stamp)
  if (updated === current) return state
  return { ...state, trips: { ...state.trips, [id]: updated } }
}

/**
 * The fifth entity writer, and the first at two levels.
 *
 * Nested inside `writeTrip` so a Trip is created by an Entry op exactly as it
 * is by any other Trip op, and with the same identity check at each level: an
 * update that changes no register returns the object it was given, and the
 * `writeTrip` above it then returns the state it was given.
 *
 * The generic `writeEntity` that would collapse all five is still not taken,
 * for the reason recorded above `writeTrip`. This is the fifth instance; a
 * sixth should re-open the argument.
 *
 * One departure from the other four writers: an Entry that did **not**
 * already exist is persisted even when `update` writes no register at all —
 * a malformed `trip.entry_added` still creates a bare, sourceless Entry
 * (`tripEntryAdded`'s doc). `writeTrip`, `writeGear` et al. need no such case
 * because their sole creating op (`trip.created`, `gear.recorded`) always
 * writes at least one register unconditionally; `trip.entry_added` has no
 * such unconditional field, so identity alone cannot tell "existed, untouched"
 * from "just created, untouched" apart. An already-existing Entry that a
 * later malformed op does not change still returns `trip` unaltered, exactly
 * like every other writer here.
 */
function writeEntry(
  state: DepotState,
  tripId: string,
  entryId: string,
  stamp: Stamp,
  update: (entry: EntryState, stamp: Stamp) => EntryState,
): DepotState {
  return writeTrip(state, tripId, stamp, (trip, st) => {
    const existing = trip.entries?.[entryId]
    const current = existing ?? { id: entryId }
    const updated = update(current, st)
    if (updated === current && existing !== undefined) return trip
    return { ...trip, entries: { ...trip.entries, [entryId]: updated } }
  })
}

/**
 * Nested inside {@link writeEntry} exactly as that is nested inside
 * `writeTrip` — the third level of one pattern, not a new one.
 *
 * The identity guard is the same and matters for the same reason: a losing
 * write must return the identical object so `slice.ts`'s `WeakMap` memo is
 * not invalidated by an op that changed nothing.
 */
function writePiece(
  state: DepotState,
  tripId: string,
  entryId: string,
  personId: string,
  stamp: Stamp,
  update: (piece: PieceState, stamp: Stamp) => PieceState,
): DepotState {
  return writeEntry(state, tripId, entryId, stamp, (entry, st) => {
    const existing = entry.pieces?.[personId]
    const current = existing ?? { id: personId }
    const updated = update(current, st)
    if (updated === current && existing !== undefined) return entry
    return { ...entry, pieces: { ...entry.pieces, [personId]: updated } }
  })
}

/**
 * Writes `read`'s value into `current` via `writeRegister` only when `read`
 * actually carries a value — an absent (or malformed) field leaves `current`
 * untouched, propagating its identity so a caller can tell nothing changed.
 * This is what lets `gear.recorded` seed only the fields its payload
 * actually carries (§4.3), including falsy ones: `container: false` and
 * `owned_count: 0` are `{ kind: 'value' }`, not `{ kind: 'absent' }`.
 */
function writeIfPresent<T>(
  current: Register<T> | undefined,
  read: Read<T>,
  stamp: Stamp,
): Register<T> | undefined {
  if (read.kind !== 'value') return current
  return writeRegister(current, read.value, stamp)
}

/**
 * The `writeIfPresent` counterpart for a register whose **declared type
 * includes `null`** — named for that, not for `name`, so it generalises for
 * free the next time a nullable, non-`name` register shows up. **S6 is that
 * slice, and it needed no change here**: `trip.dates_set`'s `start`/`end`
 * were named in this comment as the anticipated case and turned out to be
 * exactly this shape, which is the whole return on naming the function for
 * the type rather than for the field. The registers on that side of the line
 * are now `PlaceState.name`, `GearState.name`, `PersonState.name`,
 * `TripState.name` and `TripState.startDate`/`endDate` — all
 * `Register<string | null>`.
 *
 * The rule, uniform across every register in this reducer: **a register
 * whose declared type includes `null` takes an explicit `null` as a clear; a
 * register whose type does not treats a `null` payload as malformed and
 * ignores it.** §1.3 is the authority for this — it states the
 * absent-versus-null distinction generally, with no per-field carve-out.
 * §5.3 obligation 5 is *not* the authority: its text runs one way only
 * (treating an *absent* field as an explicit clear), so citing it to justify
 * collapsing `null` into absent — the reverse direction — was an
 * overstatement (`sync-protocol.md` §4.3's note records the correction).
 *
 * Every op that writes a `name` register — `place.recorded`/
 * `place.renamed`, `gear.recorded`/`gear.renamed`, `person.recorded`/
 * `person.renamed`, `trip.created`/`trip.renamed` — goes through this
 * function rather than `writeIfPresent`, so all of them behave identically
 * wherever they are written. (An earlier version of this file
 * had `setPlaceName` collapse `null` into absent, reasoning from §4.1's
 * payload shape rather than from the state type; that made an explicit
 * clear fold identically to an absent field, exactly the conflation
 * obligation 5's own direction forbids. Corrected once, here, rather than
 * per op.)
 */
function writeNullableIfPresent<T>(
  current: Register<T | null> | undefined,
  read: Read<T>,
  stamp: Stamp,
): Register<T | null> | undefined {
  if (read.kind === 'absent') return current
  const value = read.kind === 'null' ? null : read.value
  return writeRegister(current, value, stamp)
}

type Handler = (state: DepotState, op: OpEnvelope, stamp: Stamp) => DepotState

/**
 * `place.recorded` and `place.renamed` both just set `name` (`sync-protocol.md`
 * §4.1) — the entity itself is created by `writePlace` either way, out of
 * authoring order or not (§8.2).
 */
const setPlaceName: Handler = (state, op, stamp) =>
  writePlace(state, op.aggregate_id, stamp, (place, st) => {
    // `PlaceState.name` is `Register<string | null>` (Task 3), so a `null`
    // payload is a clear, not malformed input — `writeNullableIfPresent`'s rule.
    const next = writeNullableIfPresent(
      place.name,
      readString(op.payload, 'name'),
      st,
    )
    // `writeRegister` (inside `writeNullableIfPresent`) returns the identical
    // register on a lost write or an absent field; a spread here would still
    // fabricate a new `place` object, so the identity must be checked before
    // copying, not after. `next` is only ever `undefined` when it equals
    // `place.name` (both absent) — that branch is caught above, so the
    // second check is for the type checker, not runtime, under
    // `exactOptionalPropertyTypes`.
    if (next === place.name) return place
    return next === undefined ? place : { ...place, name: next }
  })

/**
 * `gear.recorded` (`sync-protocol.md` §4.3): creates the Gear and seeds each
 * **present** field as its own register, all stamped with this op's clock.
 * An absent field leaves its register absent — it is not defaulted. A second
 * `gear.recorded` for the same id (there is no other op for `container`) is
 * just an ordinary LWW write on each register it carries; nothing here
 * special-cases a repeat.
 */
const gearRecorded: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const name = writeNullableIfPresent(
      gear.name,
      readString(op.payload, 'name'),
      st,
    )
    const container = writeIfPresent(
      gear.container,
      readBoolean(op.payload, 'container'),
      st,
    )
    // An unrecognised `kind` is stored verbatim (§5.3 obligation 4) — hence
    // `readOpen`, not a closed enum reader.
    const kind = writeIfPresent(gear.kind, readOpen(op.payload, 'kind'), st)
    const residence = writeIfPresent(
      gear.residence,
      readResidence(op.payload, 'residence'),
      st,
    )
    const owner = writeIfPresent(gear.owner, readOwner(op.payload, 'owner'), st)
    const ownedCount = writeIfPresent(
      gear.ownedCount,
      readCount(op.payload, 'owned_count'),
      st,
    )
    if (
      name === gear.name &&
      container === gear.container &&
      kind === gear.kind &&
      residence === gear.residence &&
      owner === gear.owner &&
      ownedCount === gear.ownedCount
    ) {
      return gear
    }
    return {
      ...gear,
      ...(name === undefined ? {} : { name }),
      ...(container === undefined ? {} : { container }),
      ...(kind === undefined ? {} : { kind }),
      ...(residence === undefined ? {} : { residence }),
      ...(owner === undefined ? {} : { owner }),
      ...(ownedCount === undefined ? {} : { ownedCount }),
    }
  })

/** `gear.renamed` (§4.3): sets `name`, via `writeNullableIfPresent`'s rule. */
const gearRenamed: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const next = writeNullableIfPresent(
      gear.name,
      readString(op.payload, 'name'),
      st,
    )
    if (next === gear.name) return gear
    return next === undefined ? gear : { ...gear, name: next }
  })

/** `gear.rehomed` (§4.3): sets the **home** residence. A trip never touches it. */
const gearRehomed: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const residence = readResidence(op.payload, 'residence')
    if (residence.kind !== 'value') return gear
    const next = writeRegister(gear.residence, residence.value, st)
    return next === gear.residence ? gear : { ...gear, residence: next }
  })

/**
 * `gear.kind_set` (§4.3): sets `kind`. Exclusivity is structural — one
 * register, one value (domain invariant 5) — so there is nothing to guard.
 * An unrecognised value is stored verbatim (§5.3 obligation 4).
 */
const gearKindSet: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const kind = readOpen(op.payload, 'kind')
    if (kind.kind !== 'value') return gear
    const next = writeRegister(gear.kind, kind.value, st)
    return next === gear.kind ? gear : { ...gear, kind: next }
  })

/**
 * `gear.owned_count_set` (§4.3): sets `ownedCount` **absolutely**, never a
 * delta — a counter would be hazardous under replay and under two devices
 * closing the same trip. The payload key is `count`, not `owned_count`.
 */
const gearOwnedCountSet: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const count = readCount(op.payload, 'count')
    if (count.kind !== 'value') return gear
    const next = writeRegister(gear.ownedCount, count.value, st)
    return next === gear.ownedCount ? gear : { ...gear, ownedCount: next }
  })

/**
 * `gear.tag_applied` / `gear.tag_removed` (`sync-protocol.md` §4.3), which
 * are the same handler with a different value — an ordinary LWW pair on one
 * **per-tag** register (§3.4).
 *
 * The whole concurrency story is the register key, not the code here. Two
 * devices applying *different* tags address different registers, so neither
 * write is contested and both survive: the union is not computed, it is the
 * absence of a conflict. Apply and remove of the *same* tag address one
 * register and resolve by `writeRegister` like every other field.
 *
 * `readString`, deliberately, and no normalisation: §5's tolerant reader
 * outranks §4.3's `TagString` rule, so the key is the literal string that
 * arrived. `tags.ts` applies the rule on the way out, which is the only place
 * a spelling is ever decided.
 */
const gearTagWritten =
  (present: boolean): Handler =>
  (state, op, stamp) =>
    writeGear(state, op.aggregate_id, stamp, (gear, st) => {
      const tag = readString(op.payload, 'tag')
      if (tag.kind !== 'value') return gear
      const current = gear.tags?.[tag.value]
      const next = writeRegister(current, present, st)
      // Identity propagated, same as every other handler: a lost write must
      // not fabricate a new `gear` and invalidate a memo downstream.
      if (next === current) return gear
      return { ...gear, tags: { ...gear.tags, [tag.value]: next } }
    })

/**
 * `person.recorded` and `person.renamed` both just set `name`
 * (`sync-protocol.md` §4.2) — the entity itself is created by `writePerson`
 * either way, out of authoring order or not (§8.2). The same shape
 * `setPlaceName` above already has, for the same reason.
 *
 * **`person.renamed` joined this handler at S4**, and settled §4.2's deferred
 * question by doing so: it was left as `{name}` "until the slice that folds it
 * settles the same question for that row", and the answer is that
 * `PersonState.name` is `Register<string | null>`, so
 * `writeNullableIfPresent`'s rule applies unchanged and an explicit `null`
 * clears. There was never a second rule to find — only a register whose type
 * had already decided.
 */
const setPersonName: Handler = (state, op, stamp) =>
  writePerson(state, op.aggregate_id, stamp, (person, st) => {
    const next = writeNullableIfPresent(
      person.name,
      readString(op.payload, 'name'),
      st,
    )
    if (next === person.name) return person
    return next === undefined ? person : { ...person, name: next }
  })

/**
 * `gear.ownership_set` (§4.3): sets `owner`. One register, one value — the
 * domain's "personal to one person, **or** shared" is structural, so there is
 * nothing to guard and returning gear to the pool is a write, not a clear.
 *
 * An **absent** register is not the same fact as `{type:'shared'}`, and this
 * handler never conflates them: it writes only what arrived. That the two
 * *read* alike is `selectors/owner.ts`'s decision, made once, on the way out.
 */
const gearOwnershipSet: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const owner = readOwner(op.payload, 'owner')
    if (owner.kind !== 'value') return gear
    const next = writeRegister(gear.owner, owner.value, st)
    return next === gear.owner ? gear : { ...gear, owner: next }
  })

/**
 * `trip.created` (`sync-protocol.md` §4.4): creates the Trip, seeds `name`,
 * seeds `phase = "draft"`, and folds the optional template provenance.
 *
 * `gearRecorded`'s shape rather than `setPlaceName`'s, because this op writes
 * more than one register — and the second one is written by **this handler**,
 * not carried in the payload (spec §1.3). §4.4's payload is
 * `{name, from_trip_id?}`; the phase is stamped with this op's own clock, and
 * three properties follow from that with no special case anywhere:
 *
 * - A `trip.phase_moved` delivered **before** its creation wins, because its
 *   clock is strictly later. §8.2's out-of-authoring-order case, resolved by
 *   the ordinary rule.
 * - A re-delivered `trip.created` (our own op returning through pull, §8.3)
 *   writes identical values on an identical stamp and loses on `<= 0`.
 *   Idempotent for free.
 * - No payload can carry a phase, so no client can create a Trip already
 *   `closed`. An absence, not a guard.
 *
 * `from_trip_id` is folded and read by nobody until S14 (spec §1.3). §5.4
 * freezes this payload the moment S6 ships, so a field the reducer dropped
 * would be a field no fixture could prove was carried — and `authoring.ts`
 * has no parameter for it, so the only writer is a hand-shaped op.
 */
const tripCreated: Handler = (state, op, stamp) =>
  writeTrip(state, op.aggregate_id, stamp, (trip, st) => {
    // `TripState.name` is `Register<string | null>` like every other name
    // register, so an explicit `null` is a clear (§1.3, `setPlaceName`'s rule).
    const name = writeNullableIfPresent(
      trip.name,
      readString(op.payload, 'name'),
      st,
    )
    const phase = writeRegister<PhaseValue>(trip.phase, 'draft', st)
    const fromTripId = writeIfPresent(
      trip.fromTripId,
      readString(op.payload, 'from_trip_id'),
      st,
    )
    // Identity across all three before the spread, not after: a wholly lost
    // write must return the identical `TripState` so `writeTrip` can return
    // the identical `DepotState`. `phase` is never `undefined` here —
    // `writeRegister` always returns a register — so only the two optional
    // reads need the `undefined` guard on the way out.
    if (
      name === trip.name &&
      phase === trip.phase &&
      fromTripId === trip.fromTripId
    ) {
      return trip
    }
    return {
      ...trip,
      ...(name === undefined ? {} : { name }),
      phase,
      ...(fromTripId === undefined ? {} : { fromTripId }),
    }
  })

/**
 * `trip.renamed` (`sync-protocol.md` §4.4): sets `name`, via
 * `writeNullableIfPresent`'s rule — the eighth `name` row, settled by this
 * slice from the general rule and not a new one (spec §1.2).
 *
 * Unlike `setPlaceName` and `setPersonName` this sits under **one** key: its
 * partner `trip.created` writes two further registers, so it needs
 * `gearRecorded`'s shape and an identity check spanning all three. The three
 * lines of name write are duplicated there rather than extracted here,
 * exactly as `gearRecorded` and `gearRenamed` already duplicate them.
 */
const setTripName: Handler = (state, op, stamp) =>
  writeTrip(state, op.aggregate_id, stamp, (trip, st) => {
    const next = writeNullableIfPresent(
      trip.name,
      readString(op.payload, 'name'),
      st,
    )
    if (next === trip.name) return trip
    return next === undefined ? trip : { ...trip, name: next }
  })

/**
 * `trip.dates_set` (`sync-protocol.md` §4.4): two **independent** registers,
 * each following the absent-versus-null rule separately (§1.3), so
 * `{start}` alone leaves the end exactly as it was and `{end: null}` clears
 * the end and only the end. That is what lets the screen emit just what
 * changed instead of re-asserting both dates on every save.
 *
 * The payload keys are `start`/`end`; the registers are `startDate`/
 * `endDate` (spec §1.4) — the split `gear.owned_count_set{count}` already
 * has, named here so nobody "fixes" it later.
 *
 * `readString`, with **no `YYYY-MM-DD` gate**: a reader that reported
 * anything else `absent` would be rejecting a quartermaster's work to enforce
 * a spelling, which is what §5.3 forbids and §4.3's `TagString` note argues
 * at length. A malformed date is stored verbatim and drawn verbatim — visible
 * rather than silently dropped — and the display sort stays lexicographic,
 * which is exactly right for `YYYY-MM-DD` and total for anything else. There
 * is likewise no end-before-start guard: the domain states no such invariant,
 * and two devices may legitimately write the two registers concurrently, so a
 * guard would have to discard one of two valid writes.
 */
const tripDatesSet: Handler = (state, op, stamp) =>
  writeTrip(state, op.aggregate_id, stamp, (trip, st) => {
    const startDate = writeNullableIfPresent(
      trip.startDate,
      readString(op.payload, 'start'),
      st,
    )
    const endDate = writeNullableIfPresent(
      trip.endDate,
      readString(op.payload, 'end'),
      st,
    )
    if (startDate === trip.startDate && endDate === trip.endDate) return trip
    return {
      ...trip,
      ...(startDate === undefined ? {} : { startDate }),
      ...(endDate === undefined ? {} : { endDate }),
    }
  })

/**
 * `trip.phase_moved` (`sync-protocol.md` §4.4): sets `phase`. `gearKindSet`'s
 * shape exactly — one register, one value, so exclusivity is structural and
 * there is nothing to guard, and invariant 16 makes every move expressible in
 * either direction, so there is no transition graph to enforce either.
 *
 * `readOpen`, not a closed enum reader: an unrecognised phase is stored
 * verbatim (§5.3 obligation 4) and `selectors/trip.ts` decides what the app
 * does with one — not active, filed under `PLANNED`, no next step.
 */
const tripPhaseMoved: Handler = (state, op, stamp) =>
  writeTrip(state, op.aggregate_id, stamp, (trip, st) => {
    const phase = readOpen(op.payload, 'phase')
    if (phase.kind !== 'value') return trip
    const next = writeRegister<PhaseValue>(trip.phase, phase.value, st)
    return next === trip.phase ? trip : { ...trip, phase: next }
  })

/**
 * `trip.participant_added` / `trip.participant_removed`
 * (`sync-protocol.md` §4.4): `gearTagWritten`'s handler with `person_id` for
 * `tag` and `participants` for `tags` — an ordinary LWW pair on one
 * **per-person** register (§3.4).
 *
 * The concurrency story is the register key, not the code. Two devices adding
 * *different* People address different registers, so neither write is
 * contested and both survive: the union is not computed, it is the absence of
 * a conflict. An add racing a remove of the *same* Person is one register
 * resolving by `writeRegister` like every other field.
 *
 * `false` is a real value carrying a real clock, never a dropped key —
 * dropping it would let a concurrent re-add win by arrival order.
 */
const tripParticipantWritten =
  (present: boolean): Handler =>
  (state, op, stamp) =>
    writeTrip(state, op.aggregate_id, stamp, (trip, st) => {
      const personId = readString(op.payload, 'person_id')
      if (personId.kind !== 'value') return trip
      const current = trip.participants?.[personId.value]
      const next = writeRegister(current, present, st)
      // Identity propagated, same as every other handler: a lost write must
      // not fabricate a new `trip` and invalidate a memo downstream.
      if (next === current) return trip
      return {
        ...trip,
        participants: { ...trip.participants, [personId.value]: next },
      }
    })

/**
 * `trip.entry_added` (§4.4): creates the Entry and seeds `source`.
 *
 * A malformed or unrecognised source writes nothing and leaves an Entry that
 * `entriesOf` excludes — retained in the fold, drawn nowhere, holding no
 * claim. There is no defaultable value for `source`, so unlike `phase` it
 * gets no fallback.
 */
const tripEntryAdded: Handler = (state, op, stamp) => {
  const entryId = readString(op.payload, 'entry_id')
  if (entryId.kind !== 'value') return state
  return writeEntry(
    state,
    op.aggregate_id,
    entryId.value,
    stamp,
    (entry, st) => {
      const source = writeIfPresent(
        entry.source,
        readSource(op.payload, 'source'),
        st,
      )
      if (source === entry.source) return entry
      return { ...entry, ...(source === undefined ? {} : { source }) }
    },
  )
}

/**
 * `trip.entry_removed` (§4.4): the tombstone, and the only way an over-claim
 * is resolved (§3.6). An ordinary LWW field — delete does not win by being a
 * delete. No restore op exists in the MVP; re-adding is a new Entry with a
 * new id.
 */
const tripEntryRemoved: Handler = (state, op, stamp) => {
  const entryId = readString(op.payload, 'entry_id')
  if (entryId.kind !== 'value') return state
  return writeEntry(
    state,
    op.aggregate_id,
    entryId.value,
    stamp,
    (entry, st) => {
      const next = writeRegister(entry.removed, true, st)
      return next === entry.removed ? entry : { ...entry, removed: next }
    },
  )
}

/**
 * `trip.entry_bring_count_set` (§4.4): sets `bringCount` absolutely.
 *
 * The catalogue's "Counted entries only" is an **authoring** rule, not a
 * reader gate: the Entry's Kind lives on the Gear aggregate, and resolving it
 * here would make the fold order-dependent on whether `gear.kind_set` had
 * arrived. Readers gate through `bringCountOf` instead.
 */
const tripEntryBringCountSet: Handler = (state, op, stamp) => {
  const entryId = readString(op.payload, 'entry_id')
  if (entryId.kind !== 'value') return state
  const count = readCount(op.payload, 'count')
  if (count.kind !== 'value') return state
  return writeEntry(
    state,
    op.aggregate_id,
    entryId.value,
    stamp,
    (entry, st) => {
      const next = writeRegister(entry.bringCount, count.value, st)
      return next === entry.bringCount ? entry : { ...entry, bringCount: next }
    },
  )
}

/**
 * `trip.piece_removed` / `trip.piece_restored` (`sync-protocol.md` §4.4): an
 * ordinary LWW pair on one register (§3.5). Delete does not win by being a
 * delete; a restore wins only by being strictly later.
 *
 * `false` is a real value carrying a real clock, never a dropped key — the
 * rule `participants` and `tags` already keep.
 */
const tripPieceWritten =
  (removed: boolean): Handler =>
  (state, op, stamp) => {
    const entryId = readString(op.payload, 'entry_id')
    if (entryId.kind !== 'value') return state
    const personId = readString(op.payload, 'person_id')
    if (personId.kind !== 'value') return state
    return writePiece(
      state,
      op.aggregate_id,
      entryId.value,
      personId.value,
      stamp,
      (piece, st) => {
        const next = writeRegister(piece.removed, removed, st)
        return next === piece.removed ? piece : { ...piece, removed: next }
      },
    )
  }

/**
 * The op-type dispatch table (`sync-protocol.md` §4.1, §4.3). A `Record`, not
 * a `switch`, so "is this type known?" is a lookup — the same question the
 * tolerant reader asks.
 */
const handlers: Record<string, Handler> = {
  'place.recorded': setPlaceName,
  'place.renamed': setPlaceName,
  // A tombstone is an ordinary LWW field; an edit never writes it (§3.5).
  'place.removed': (state, op, stamp) =>
    writePlace(state, op.aggregate_id, stamp, (place, st) => {
      const next = writeRegister(place.removed, true, st)
      return next === place.removed ? place : { ...place, removed: next }
    }),
  'gear.recorded': gearRecorded,
  'gear.renamed': gearRenamed,
  'gear.rehomed': gearRehomed,
  'gear.kind_set': gearKindSet,
  'gear.owned_count_set': gearOwnedCountSet,
  'gear.ownership_set': gearOwnershipSet,
  // Per-tag registers (§3.4). Present and absent, not create and delete.
  'gear.tag_applied': gearTagWritten(true),
  'gear.tag_removed': gearTagWritten(false),
  // `gear.retired` / `gear.restored` are an ordinary LWW pair on `retired`
  // (§3.5); an edit never writes it, so a retire that a later edit races
  // still leaves the gear retired.
  'gear.retired': (state, op, stamp) =>
    writeGear(state, op.aggregate_id, stamp, (gear, st) => {
      const next = writeRegister(gear.retired, true, st)
      return next === gear.retired ? gear : { ...gear, retired: next }
    }),
  'gear.restored': (state, op, stamp) =>
    writeGear(state, op.aggregate_id, stamp, (gear, st) => {
      const next = writeRegister(gear.retired, false, st)
      return next === gear.retired ? gear : { ...gear, retired: next }
    }),
  // Both only set `name`, so one handler serves both — the same pairing
  // `place.recorded`/`place.renamed` already has above.
  'person.recorded': setPersonName,
  'person.renamed': setPersonName,
  // The fourth aggregate (§4.4). `trip.created` is not paired with
  // `trip.renamed` under one handler the way the other two `recorded`/
  // `renamed` pairs are, because it writes two further registers of its own.
  'trip.created': tripCreated,
  'trip.renamed': setTripName,
  'trip.dates_set': tripDatesSet,
  'trip.phase_moved': tripPhaseMoved,
  // Per-person registers (§3.4). Present and absent, not create and delete —
  // exactly the tag pair above.
  'trip.participant_added': tripParticipantWritten(true),
  'trip.participant_removed': tripParticipantWritten(false),
  // S7 (§4.4): the gear list, keyed by entry id — the first of the Trip's
  // nested maps. `trip.entry_status_set` stays unfolded until S9.
  'trip.entry_added': tripEntryAdded,
  'trip.entry_removed': tripEntryRemoved,
  'trip.entry_bring_count_set': tripEntryBringCountSet,
  // S8 (§4.4): one Piece per Participant, keyed by person id on the Entry —
  // present and absent, not create and delete, exactly the participant and
  // tag pairs above.
  'trip.piece_removed': tripPieceWritten(true),
  'trip.piece_restored': tripPieceWritten(false),
}

/**
 * Applies one op to `state` and returns the next state. Pure, with structural
 * sharing: only the touched entity, the map holding it, and the top-level
 * `DepotState` are copied. An unknown `type` is retained via `noteUnfolded`
 * rather than folded or rejected.
 */
export function applyOp(state: DepotState, op: OpEnvelope): DepotState {
  const handler = handlers[op.type]
  if (handler === undefined) return noteUnfolded(state, op.type)
  return handler(state, op, { hlc: op.hlc, deviceId: op.device_id })
}

/**
 * Folds a whole op log onto `from` (default: `emptyState()`). Order-
 * independent by construction (§3.2, §8.2): each register only ever accepts
 * a strictly later write, so folding the complete local log reproduces the
 * current state exactly (§8.4) — which is what makes a snapshot safely
 * discardable.
 */
export function fold(
  ops: Iterable<OpEnvelope>,
  from: DepotState = emptyState(),
): DepotState {
  let state = from
  for (const op of ops) {
    state = applyOp(state, op)
  }
  return state
}
