import { readFileSync } from 'node:fs'

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  createReplica,
  exchange,
  fakeClock,
  type FakeClock,
  type Replica,
} from '../testUtils/index.ts'
import {
  gearKindSet,
  gearOwnedCountSet,
  gearOwnershipSet,
  gearRecorded,
  gearRehomed,
  gearRenamed,
  gearRestored,
  gearRetired,
  gearTagApplied,
  gearTagRemoved,
  personRecorded,
  personRenamed,
  placeRecorded,
  placeRemoved,
  placeRenamed,
  tripContainerStageSet,
  tripCreated,
  tripDatesSet,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripEntryRemoved,
  tripEntryStatusSet,
  tripParticipantAdded,
  tripParticipantRemoved,
  tripPhaseMoved,
  tripPieceMoved,
  tripPieceRemoved,
  tripPieceRestored,
  tripPieceStatusSet,
  tripRenamed,
  type OpSpec,
} from './authoring.ts'
import type { OpEnvelope } from './ops.ts'
import { overClaims, overClaimsFor } from './selectors/claim.ts'
import { containmentView } from './selectors/containment.ts'
import { entriesOf } from './selectors/entry.ts'
import {
  disagreements,
  isPacked,
  stageOf,
  statusOf,
} from './selectors/packing.ts'
import { piecesOf } from './selectors/piece.ts'
import { isActive } from './selectors/trip.ts'
import { tripContainmentView } from './selectors/tripContainment.ts'
import type {
  DepotState,
  EntrySource,
  KindValue,
  Owner,
  PhaseValue,
  Residence,
  StageValue,
  StatusValue,
  TripResidence,
} from './state.ts'
import { normalizeTag, type TagString } from './tags.ts'

/**
 * **Tier 2, the convergence tier** (`docs/testing.md`) — foerier's signature
 * tier, and the one unique to offline-first. The integration under test is
 * client ↔ client, not client ↔ server: two or more real in-memory replicas
 * sharing the real reducer, diverging offline, exchanging ops through a fake
 * transport, and converging.
 *
 * The claim is `sync-protocol.md` §3.2: because the merge is a strict-greater
 * guard over a **total** order, `apply` is commutative, associative and
 * idempotent, so divergent logs exchanged in any order fold to identical
 * state. §8.2 adds the half that is easy to lose: pull ordering by `seq` is
 * for cursor correctness only, and **no part of the merge may depend on it**.
 *
 * Everything here is real — real HLC, real log, real reducer, real selectors —
 * over a fake clock and a fake transport. No `vi.mock`, no `vi.fn()`; this
 * tier proves the *algebra*, not the wiring.
 */

const HOUSEHOLD = 'ffffffff-0000-7000-8000-000000000000'

const DEVICE_IDS = [
  'aaaaaaaa-0000-7000-8000-000000000001',
  'bbbbbbbb-0000-7000-8000-000000000002',
  'cccccccc-0000-7000-8000-000000000003',
  'dddddddd-0000-7000-8000-000000000004',
] as const

/**
 * The id pools are **small and shared across every device**, which is the
 * whole point: with five pieces of gear and three places, two devices writing
 * the *same register* is the common case rather than a rare coincidence. A
 * generator that hands every device its own fresh ids would produce a union,
 * not a merge, and the property would prove nothing.
 */
const GEAR_IDS = [
  '20000000-0000-7000-8000-000000000000',
  '20000000-0000-7000-8000-000000000001',
  '20000000-0000-7000-8000-000000000002',
  '20000000-0000-7000-8000-000000000003',
  '20000000-0000-7000-8000-000000000004',
] as const
const PLACE_IDS = [
  '10000000-0000-7000-8000-000000000000',
  '10000000-0000-7000-8000-000000000001',
  '10000000-0000-7000-8000-000000000002',
] as const
const PERSON_IDS = [
  '40000000-0000-7000-8000-000000000000',
  '40000000-0000-7000-8000-000000000001',
] as const
/**
 * **Two**, and for the same reason the pools above are small: with one Trip
 * per two devices, two devices contesting the same `phase` register — or the
 * same participant register — is the common case rather than a coincidence.
 * Two is enough because a Trip has no containment and no cross-Trip edge:
 * nothing here gets more interesting with a third.
 */
const TRIP_IDS = [
  '50000000-0000-7000-8000-000000000000',
  '50000000-0000-7000-8000-000000000001',
] as const

/**
 * S7's entries, sharing the same "small and shared" reasoning as every pool
 * above: with two Trips and three entry ids, two devices writing the same
 * `entries.<id>` register on the same Trip is meant to be more than a rare
 * coincidence. This pool alone was not enough to get there — it took
 * {@link arbTripEntrySpec} getting its own share of the trip budget rather
 * than sitting as a flat, diluted branch beside S6's six. See that
 * arbitrary's doc for the measured rate this pool and that split produce
 * together.
 */
const ENTRY_IDS = ['e1', 'e2', 'e3'] as const

/**
 * Three tags, shared across every device, for exactly the reason the id pools
 * above are small: a large vocabulary would give each device its own
 * registers, and the property would prove a **union** where it is supposed to
 * prove a **merge**. With three, two devices contesting one tag register is
 * the common case.
 */
const TAGS = ['food', 'kitchen', 'winter'] as const

/** The only way a `TagString` is made (`tags.ts`) — the picker's rule, at
 * the one place authoring applies it. */
function aTag(raw: string): TagString {
  const tag = normalizeTag(raw)
  if (tag === null) throw new Error(`not a tag: ${raw}`)
  return tag
}

const BASE_MS = 1_700_000_000_000

/**
 * Every device's clock starts at the **same** millisecond and is never
 * advanced in the property, so device A's nth op and device B's nth op carry
 * an identical `hlc` and are separated only by `device_id`. That is the
 * hardest case the merge can legitimately meet: `compareStamps` falls through
 * to its `device_id` half on nearly every contested register, rather than
 * being settled by wall clocks that happened to differ.
 */
function replicasFor(deviceCount: number): Replica[] {
  return DEVICE_IDS.slice(0, deviceCount).map((deviceId) =>
    createReplica({
      deviceId,
      householdId: HOUSEHOLD,
      clock: fakeClock(BASE_MS),
    }),
  )
}

/**
 * A pair of replicas on **one shared wall clock**, for the pinned scenarios.
 * Sharing the clock makes each `advance` a step in a story ("A retires it,
 * then B renames it") and makes the resulting stamps predictable enough to
 * assert on, rather than something the test has to reverse-engineer.
 */
function aWorld(): { clock: FakeClock; a: Replica; b: Replica } {
  const clock = fakeClock(BASE_MS)
  const of = (deviceId: string): Replica =>
    createReplica({ deviceId, householdId: HOUSEHOLD, clock })
  return { clock, a: of(DEVICE_IDS[0]), b: of(DEVICE_IDS[1]) }
}

/** FNV-1a. Only needs to spread one seed string over 32 bits. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A seeded Fisher-Yates. Seeded by a **string** so each replica can be given
 * `seed + deviceId` and get its own arrival order: if every replica received
 * the same order the property would be vacuous, which is why the property
 * counts how often the orders actually differ and asserts on it.
 */
function shuffle<T>(items: readonly T[], seed: string): T[] {
  let s = hashSeed(seed) || 1
  const nextFloat = (): number => {
    s ^= (s << 13) >>> 0
    s >>>= 0
    s ^= s >>> 17
    s ^= (s << 5) >>> 0
    s >>>= 0
    return s / 0x1_0000_0000
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextFloat() * (i + 1))
    const held = out[i]!
    out[i] = out[j]!
    out[j] = held
  }
  return out
}

const orderOf = (ops: readonly OpEnvelope[]): string =>
  ops.map((op) => op.id).join(',')

const arbGearId = fc.constantFrom(...GEAR_IDS)
const arbPlaceId = fc.constantFrom(...PLACE_IDS)
const arbPersonId = fc.constantFrom(...PERSON_IDS)
const arbName = fc.constantFrom('Tent', 'Axe', 'Crate', 'Rope')
const arbTag = fc.constantFrom(...TAGS)
/** `sled` is deliberately not one of the three known kinds: §5.3 obligation 4. */
const arbKind = fc.constantFrom<KindValue[]>(
  'single',
  'per_person',
  'counted',
  'sled',
)

/**
 * Weighted **towards gear-in-gear**, because that is the only edge a
 * containment cycle can be made of. Unweighted, a cycle turned up in 3 runs in
 * 200; with this weighting and the container bias below, 17.
 */
const arbResidence: fc.Arbitrary<Residence> = fc.oneof(
  {
    arbitrary: arbPlaceId.map((id): Residence => ({ in: 'place', id })),
    weight: 2,
  },
  {
    arbitrary: arbGearId.map((id): Residence => ({ in: 'gear', id })),
    weight: 3,
  },
  { arbitrary: fc.constant<Residence>({ in: 'loose' }), weight: 1 },
)

/**
 * `shared` or one of the two People — the whole domain of the `owner`
 * register, so two devices contesting it is the common case rather than a
 * rare one.
 */
const arbOwner: fc.Arbitrary<Owner> = fc.oneof(
  fc.constant<Owner>({ type: 'shared' }),
  arbPersonId.map((personId): Owner => ({ type: 'person', personId })),
)

const arbTripId = fc.constantFrom(...TRIP_IDS)
const arbEntryId = fc.constantFrom(...ENTRY_IDS)
const arbTripName = fc.constantFrom('Ardennes', 'Vosges', 'Sarek')
/** `shakedown` is deliberately not one of the five known phases — `arbKind`'s
 * rule a second time, and §5.3 obligation 4's whole point: an unrecognised
 * enum value has to survive the merge exactly as it arrived. */
const arbPhase = fc.constantFrom<PhaseValue[]>(
  'draft',
  'pack_out',
  'on_trip',
  'unpack',
  'closed',
  'shakedown',
)
/**
 * Two conforming dates and one that is not a date at all (§1.4: no format
 * gate, stored and compared verbatim). Three states per field — a date, an
 * explicit `null` clear, and absent — because those are the three the
 * absent-versus-null rule distinguishes, and the merge has to keep them
 * apart under every arrival order, not only under authoring order.
 */
const arbDateField = fc.option(
  fc.option(fc.constantFrom('2026-08-14', '2026-08-20', 'not-a-date'), {
    nil: null,
  }),
  { nil: undefined },
)

/**
 * A depot Entry three times as often as a trip-only one, mirroring
 * `arbResidence`'s container bias above: a depot source is what lets
 * `overClaims` (S7's whole reason for existing) find something to contest,
 * while a trip-only one still exercises the union side of `EntrySource`.
 */
const arbEntrySource: fc.Arbitrary<EntrySource> = fc.oneof(
  {
    arbitrary: arbGearId.map((gearId): EntrySource => ({
      from: 'depot',
      gearId,
    })),
    weight: 3,
  },
  {
    arbitrary: fc
      .record({
        name: fc.option(arbName, { nil: null }),
        container: fc.boolean(),
      })
      .map(({ name, container }): EntrySource => ({
        from: 'trip_only',
        name,
        container,
      })),
    weight: 1,
  },
)

/**
 * The three known statuses plus one this build cannot name — `arbKind`'s and
 * `arbPhase`'s rule a third time. {@link StatusValue} is deliberately open
 * (story 20 ships editable statuses on exactly this mechanism), so an
 * unrecognised member has to survive the merge byte for byte, and the
 * generator is the only tier that draws one at scale.
 */
const arbStatus = fc.constantFrom<StatusValue[]>(
  'not_packed',
  'staged',
  'packed',
  'soaked',
)
/** {@link StageValue}'s four known members plus one unrecognised, for
 * {@link arbStatus}'s reason. */
const arbStage = fc.constantFrom<StageValue[]>(
  'home',
  'staging',
  'car',
  'packed',
  'ferry',
)
/**
 * **Over {@link ENTRY_IDS}, not a fresh pool**, and that is the whole point:
 * a trip residence names a *container Entry on the same Trip*, so drawing the
 * target from the same three ids is what makes two devices move two things
 * into the same crate — and, since nothing stops an Entry naming itself or a
 * pair naming each other, what makes {@link tripContainmentView}'s cycle
 * break meet a real cycle rather than a hypothetical one.
 *
 * Weighted towards `container` for {@link arbResidence}'s reason: `loose` is
 * the absent-register default, so an even split would spend half the draws
 * writing the state most of the pool already holds.
 */
const arbTripResidence: fc.Arbitrary<TripResidence> = fc.oneof(
  {
    arbitrary: arbEntryId.map((entryId): TripResidence => ({
      in: 'container',
      entryId,
    })),
    weight: 3,
  },
  { arbitrary: fc.constant<TripResidence>({ in: 'loose' }), weight: 1 },
)

/**
 * S6's six op types, nested under **one** weighted branch of the outer
 * `oneof` rather than spread across six unweighted ones — so the trip share
 * is a number to set rather than a consequence of how many op types the slice
 * happened to add.
 *
 * It was first set to 4 in 19 (~21% of ops) because 1 in 16 was measured and
 * found too thin: over 200 runs it put trip ops in 6% of draws and left two
 * devices contesting one Trip register in **12** runs, against **~70** at
 * that weight (both figures from before S7 existed). **S9a re-set it to 12 in
 * 27 (~44% of ops)**, which is the whole reason the number is a knob: the
 * Trip aggregate grew from nine op types to sixteen across S7, S8 and S9a,
 * and a share that stays put while the aggregate triples is a share that
 * silently thins every register under it. See {@link arbTripEntrySpec}'s doc
 * for the measured before-and-after.
 *
 * The obvious worry — that diluting the gear ops costs the containment-cycle
 * rate `arbResidence` is tuned for — was measured at 4 and again at 12, and
 * is not real: cycles turn up in 5–15 runs per 200 with no trip ops at all,
 * 11–14 at weight 4, and **8, 10, 11** at weight 12, which is seed noise
 * throughout. (That also puts `arbResidence`'s "17" where it belongs — a
 * single measurement from a generator with fewer op types in it, not a floor
 * to defend.)
 */
const arbTripRootSpec: fc.Arbitrary<OpSpec> = fc.oneof(
  fc.tuple(arbTripId, arbTripName).map(([id, name]) => tripCreated(id, name)),
  // Nullable, so the property exercises the clear as well as the write —
  // `personRenamed`'s rule on the seventh and eighth `name` rows.
  fc
    .tuple(arbTripId, fc.option(arbTripName, { nil: null }))
    .map(([id, name]) => tripRenamed(id, name)),
  fc
    .record({ id: arbTripId, start: arbDateField, end: arbDateField })
    .map(({ id, start, end }) =>
      tripDatesSet(id, {
        ...(start === undefined ? {} : { start }),
        ...(end === undefined ? {} : { end }),
      }),
    ),
  fc.tuple(arbTripId, arbPhase).map(([id, phase]) => tripPhaseMoved(id, phase)),
  fc
    .tuple(arbTripId, arbPersonId)
    .map(([id, personId]) => tripParticipantAdded(id, personId)),
  fc
    .tuple(arbTripId, arbPersonId)
    .map(([id, personId]) => tripParticipantRemoved(id, personId)),
)

/**
 * S7's three op types (§4.4). Kept as a **second arm alongside**
 * {@link arbTripRootSpec} rather than folded in as a seventh through ninth
 * flat branch of one nine-way `oneof` — a first draft did exactly that, and
 * it was wrong. Flat inclusion cuts every branch's share from 1/6 of the trip
 * budget to 1/9 (3.51% of all ops down to 2.34%), and because a specific
 * `(tripId, entryId)` pair is a further 1-in-6 slice of *that* (`TRIP_IDS` has
 * two members, `ENTRY_IDS` three), the actual per-register contest rate fell
 * to roughly 6–7 runs in 200 — thinner than the **12** that got 1-in-16
 * rejected above, on precisely the registers this slice most needs the
 * equal-HLC/`device_id`-tiebreak coverage for (three brand-new handlers, and
 * the pinned scenarios fix arrival order by hand so they cannot substitute).
 *
 * Two arms of equal, unweighted share fixes it: `arbTripRootSpec`'s six
 * branches and this arm's three both draw the *default* `oneof` weight of 1,
 * so root and entries now split the trip budget 50/50 rather than 6-to-3 (the
 * same ratio as before — nesting at that ratio would have changed nothing).
 * The entry branches land back at the density a root branch had **before**
 * S7 existed (3.51%, one third of the trip budget's now-50% half); the root
 * branches give up half their old share to buy it (1.75% each).
 *
 * Re-measured over 200 runs at this split: two devices contesting one
 * **entry** register (any of the 18 —
 * three fields × two Trips × three entry ids) now happens in roughly
 * **19 runs in 200** (three repeated passes: 18, 19, 20) — a three-fold
 * recovery from the flat-branch draft's 6–7, and no longer thinner than the
 * rejected 1-in-16's 12. The **root** rate this costs falls with it, from the
 * pre-S7 ~70 to roughly **30 in 200** (three passes: 27, 31, 38) — well clear
 * of that same 12-run floor, so this is a real trade and not a regression
 * disguised as one.
 *
 * **S9a: a third arm, three more branches here, and the trip weight re-set.**
 * Adding {@link arbTripPieceSpec} and this arm's three Entry-level packing
 * ops at the old weight of 4 did exactly what the flat-branch draft did — the
 * entry rate fell from **22** runs in 200 to **5**, well under the 12-run
 * floor, because each branch now draws a third of what it did *and* the
 * registers it can hit doubled from 18 to 36. Raising the trip weight to 12
 * (see {@link arbTripRootSpec}) buys all of it back and more, measured over
 * three passes of 200 each:
 *
 * | contest, runs in 200 | before S9a | S9a at weight 4 | S9a at weight 12 |
 * | --- | --- | --- | --- |
 * | root register | 31, 32 | 14 | 64, 55, 49 |
 * | entry register | 11, 22 | 5 | 24, 21, 22 |
 * | piece register | **0** | 4 | 23, 23, 23 |
 *
 * The piece column is the point of the exercise: `trip.piece_removed` and
 * `trip.piece_restored` shipped at S8 and were never generated, and
 * `trip.piece_moved` had no Tier-2 coverage of any kind. A zero in a column
 * this table can print is the failure mode a docstring claiming "all
 * twenty-four op types" was hiding.
 *
 * **Every figure above is a hand-transcribed measurement, and none of it is
 * what holds the weights in place.** The suite's
 * *contests all three levels of the Trip aggregate at the charter floor* is —
 * it re-derives these three columns on every run and fails under the 12-in-200
 * floor this doc cites. Read the table as the history of how 12 was arrived
 * at; read that test for what is true now. Its own 200-run figures do not
 * reproduce reliably at 200 runs, which is the other thing the test found.
 */
const arbTripEntrySpec: fc.Arbitrary<OpSpec> = fc.oneof(
  fc
    .tuple(arbTripId, arbEntryId, arbEntrySource)
    .map(([id, entryId, source]) => tripEntryAdded(id, entryId, source)),
  fc
    .tuple(arbTripId, arbEntryId)
    .map(([id, entryId]) => tripEntryRemoved(id, entryId)),
  fc
    .tuple(arbTripId, arbEntryId, fc.nat({ max: 5 }))
    .map(([id, entryId, count]) => tripEntryBringCountSet(id, entryId, count)),
  // S9a's three Entry-level ops. They join this arm rather than forming a
  // fourth one because the arms partition by **entity path**, not by slice:
  // every branch here writes a register on `entries.<entryId>`, and the
  // contest this arm exists to provoke is two devices reaching that path.
  fc
    .tuple(arbTripId, arbEntryId, arbStatus)
    .map(([id, entryId, status]) => tripEntryStatusSet(id, entryId, status)),
  fc
    .tuple(arbTripId, arbEntryId, arbTripResidence)
    .map(([id, entryId, residence]) => tripEntryMoved(id, entryId, residence)),
  fc
    .tuple(arbTripId, arbEntryId, arbStage)
    .map(([id, entryId, stage]) => tripContainerStageSet(id, entryId, stage)),
)

/**
 * S8's two Piece ops and S9a's two, the third arm — every branch writing a
 * register on `entries.<entryId>.pieces.<personId>`, one level below
 * {@link arbTripEntrySpec}'s path.
 *
 * **A third arm rather than four more branches of the second**, for the
 * reason that arm's own doc gives about not being a flat branch: folded in,
 * the Piece registers would draw 4/10 of the entry arm's half of the trip
 * budget while the Entry registers drew 6/10, which is an accident of how
 * many op types each level happens to have rather than a decision. Three
 * equal arms make the level's share the thing that is set.
 *
 * `trip.piece_removed` and `trip.piece_restored` shipped a slice before this
 * one and were never generated at all; `trip.piece_moved` had **no Tier-2
 * coverage of any kind** until this arm existed.
 */
const arbTripPieceSpec: fc.Arbitrary<OpSpec> = fc.oneof(
  fc
    .tuple(arbTripId, arbEntryId, arbPersonId)
    .map(([id, entryId, personId]) => tripPieceRemoved(id, entryId, personId)),
  fc
    .tuple(arbTripId, arbEntryId, arbPersonId)
    .map(([id, entryId, personId]) => tripPieceRestored(id, entryId, personId)),
  fc
    .tuple(arbTripId, arbEntryId, arbPersonId, arbStatus)
    .map(([id, entryId, personId, status]) =>
      tripPieceStatusSet(id, entryId, personId, status),
    ),
  fc
    .tuple(arbTripId, arbEntryId, arbPersonId, arbTripResidence)
    .map(([id, entryId, personId, residence]) =>
      tripPieceMoved(id, entryId, personId, residence),
    ),
)

/** Equal, unweighted split — see {@link arbTripEntrySpec}'s doc for why. */
const arbTripSpec: fc.Arbitrary<OpSpec> = fc.oneof(
  arbTripRootSpec,
  arbTripEntrySpec,
  arbTripPieceSpec,
)

/**
 * **Every op type this build folds** (`sync-protocol.md` §4), authored through
 * the real builders — never a hand-shaped payload, so the generator cannot
 * drift from the wire format.
 *
 * "Every" is a claim, so it is checked rather than asserted in prose: the
 * suite below counts the distinct `type` values this arbitrary can produce
 * and compares them against `reduce.ts`'s own handler table, which is the
 * definition of *what this build folds*. An earlier version of this line
 * counted **twenty-four** by hand while the table had grown to thirty-one —
 * S8's two Piece ops and S9a's five were folded, shipped, and generated by
 * nothing.
 */
const arbSpec: fc.Arbitrary<OpSpec> = fc.oneof(
  fc.tuple(arbPlaceId, arbName).map(([id, name]) => placeRecorded(id, name)),
  fc.tuple(arbPlaceId, arbName).map(([id, name]) => placeRenamed(id, name)),
  arbPlaceId.map((id) => placeRemoved(id)),
  fc
    .record({
      id: arbGearId,
      name: arbName,
      // A gear-in-gear edge only resolves to a holder if the holder is a
      // container (reason 3), so an even split would throw most of the
      // generated edges away before they could ever form a cycle.
      container: fc.oneof(
        { arbitrary: fc.constant(true), weight: 3 },
        { arbitrary: fc.constant(false), weight: 1 },
      ),
      kind: arbKind,
      residence: fc.option(arbResidence, { nil: undefined }),
      ownedCount: fc.option(fc.nat({ max: 3 }), { nil: undefined }),
      // Optional, so the property generates gear with **no** owner register
      // as well as gear with one — the pair `selectors/owner.ts` reads alike
      // and the fold keeps apart.
      owner: fc.option(arbOwner, { nil: undefined }),
    })
    .map(({ id, name, container, kind, residence, ownedCount, owner }) =>
      gearRecorded(id, {
        name,
        container,
        kind,
        ...(residence === undefined ? {} : { residence }),
        ...(ownedCount === undefined ? {} : { owned_count: ownedCount }),
        ...(owner === undefined ? {} : { owner }),
      }),
    ),
  fc.tuple(arbGearId, arbName).map(([id, name]) => gearRenamed(id, name)),
  fc
    .tuple(arbGearId, arbResidence)
    .map(([id, residence]) => gearRehomed(id, residence)),
  fc.tuple(arbGearId, arbKind).map(([id, kind]) => gearKindSet(id, kind)),
  fc
    .tuple(arbGearId, fc.nat({ max: 3 }))
    .map(([id, count]) => gearOwnedCountSet(id, count)),
  arbGearId.map((id) => gearRetired(id)),
  arbGearId.map((id) => gearRestored(id)),
  fc.tuple(arbGearId, arbTag).map(([id, tag]) => gearTagApplied(id, aTag(tag))),
  fc.tuple(arbGearId, arbTag).map(([id, tag]) => gearTagRemoved(id, aTag(tag))),
  fc
    .tuple(arbGearId, arbOwner)
    .map(([id, owner]) => gearOwnershipSet(id, owner)),
  fc.tuple(arbPersonId, arbName).map(([id, name]) => personRecorded(id, name)),
  // Nullable, so the property exercises the clear as well as the write.
  fc
    .tuple(arbPersonId, fc.option(arbName, { nil: null }))
    .map(([id, name]) => personRenamed(id, name)),
  { arbitrary: arbTripSpec, weight: 12 },
)

/**
 * 2–4 devices × 0–15 ops each, all drawn from the shared id pools.
 *
 * `size: 'max'` on the inner array is deliberate: fast-check's default size
 * bias generates mostly *short* arrays, which halved the ops per run and with
 * them the chance of two devices contesting the same register. With it, a run
 * carries ~22 ops across the devices rather than ~14.
 */
const arbOpSets = (): fc.Arbitrary<OpSpec[][]> =>
  fc.array(fc.array(arbSpec, { maxLength: 15, size: 'max' }), {
    minLength: 2,
    maxLength: 4,
  })

/**
 * Is this node a {@link Register}? Recognised **structurally** — a `value`
 * beside an `hlc` and a `deviceId` — never from a list of field names, so a
 * slice adding a register to `TripState`, `EntryState` or `PieceState` is
 * counted by {@link tripRegisterPaths} without editing anything here. That is
 * the whole point: the counter below exists because a hand-maintained list
 * went stale, and a second hand-maintained list would go stale the same way.
 */
function isRegisterLike(node: unknown): boolean {
  return (
    typeof node === 'object' &&
    node !== null &&
    'value' in node &&
    'hlc' in node &&
    'deviceId' in node
  )
}

function collectRegisterPaths(
  node: unknown,
  path: readonly string[],
  out: string[][],
): void {
  if (isRegisterLike(node)) {
    out.push([...path])
    return
  }
  if (typeof node !== 'object' || node === null) return
  for (const [key, value] of Object.entries(node)) {
    collectRegisterPaths(value, [...path, key], out)
  }
}

/**
 * Every register **one device's own ops** wrote, inside the Trip aggregate,
 * split by the three levels the generator's three arms address:
 *
 * - **root** — `trips.<id>.<field>` and the per-participant registers
 *   `trips.<id>.participants.<personId>`; everything {@link arbTripRootSpec}
 *   can write.
 * - **entry** — `trips.<id>.entries.<entryId>.<field>`,
 *   {@link arbTripEntrySpec}'s.
 * - **piece** — `trips.<id>.entries.<entryId>.pieces.<personId>.<field>`,
 *   {@link arbTripPieceSpec}'s.
 *
 * The split is by **entity path**, which is how the arms themselves partition
 * (see `arbTripEntrySpec`'s own note) — so the three counts map one-to-one
 * onto the three weights, and a weight that stops buying contest shows up in
 * its own column.
 */
function tripRegisterPaths(state: DepotState): {
  root: ReadonlySet<string>
  entry: ReadonlySet<string>
  piece: ReadonlySet<string>
} {
  const found: string[][] = []
  collectRegisterPaths(state.trips, [], found)
  const out = {
    root: new Set<string>(),
    entry: new Set<string>(),
    piece: new Set<string>(),
  }
  for (const segments of found) {
    const joined = segments.join('.')
    if (segments[1] !== 'entries') out.root.add(joined)
    else if (segments[3] === 'pieces') out.piece.add(joined)
    else out.entry.add(joined)
  }
  return out
}

/**
 * Runs in {@link CONTEST_SAMPLE} that must contest each level, and the whole
 * point of {@link tripRegisterPaths}. `testing.md`'s Tier 2 charter states the
 * floor as **12 runs in 200** — 6% — and this is that same floor at the sample
 * size that makes it stable (see the test's own doc for why 200 is not).
 */
const CONTEST_FLOOR = 60

/**
 * Ten times the property's own 200. Generation and a local fold only — no
 * exchange, no convergence assertions — so the extra runs are cheap, and at
 * 200 the counts swing far too wide to floor: the piece level alone measured
 * anywhere from 8 to 25 across seven seeds, which is what let three
 * hand-transcribed passes of "23, 23, 23" look like a stable fact.
 */
const CONTEST_SAMPLE = 1000

describe('convergence', () => {
  /**
   * **The guard on {@link arbSpec}'s "every op type" claim**, and the reason
   * that claim is no longer a hand-counted number in a comment. From S8 until
   * this test existed the docstring said *twenty-four* while `reduce.ts`
   * folded thirty-one, so seven shipped op types — S8's two Piece ops and
   * S9a's five packing ops — were folded by the reducer, pinned by the
   * hand-built scenarios below, and generated by **nothing**. Nothing failed;
   * the sentence simply stopped being true, and no tier could tell.
   *
   * `reduce.ts`'s dispatch table is the definition of *what this build
   * folds*, and it is not exported — deliberately, since "is this type
   * known?" is the tolerant reader's question and not a caller's. So this
   * reads the table out of the module's own source, the technique
   * `drawnSizes.test.ts`, `EntryRow.test.tsx` and `OverClaimBand.test.tsx`
   * already use for facts that live in a file rather than in an export.
   */
  it('generates every op type the reducer folds', () => {
    const source = readFileSync(new URL('./reduce.ts', import.meta.url), 'utf8')
    const table =
      /const handlers: Record<string, Handler> = \{\n([\s\S]*?)\n\}/.exec(
        source,
      )?.[1]
    expect(table).toBeDefined()
    const folded = new Set(
      [...(table ?? '').matchAll(/^ {2}'([a-z_]+\.[a-z_]+)':/gm)].map(
        (match) => match[1]!,
      ),
    )

    // Seeded, so a rare branch cannot make this flaky: the thinnest branch
    // draws ~2.5% of ops, and 20 000 samples miss it with probability zero
    // for any practical purpose — but a fixed seed means the assertion is a
    // fact about the generator rather than about today's luck.
    const generated = new Set(
      fc
        .sample(arbSpec, { numRuns: 20_000, seed: 20260902 })
        .map((spec) => spec.type),
    )

    expect([...generated].sort()).toEqual([...folded].sort())
  })

  /**
   * **The counter the weight docstrings promised**, and the second half of the
   * lesson the test above is the first half of.
   *
   * `arbTripRootSpec`'s and `arbTripEntrySpec`'s docs argue the trip weight of
   * 12 from measured contest rates — "22 runs in 200 down to 5", a three-row
   * table of before/after figures, and a **12-run floor** cited four times.
   * All of it was prose. `arbTripEntrySpec` even sent the reader to
   * "`arbSpec`'s doc for the exact counter" and no counter existed there or
   * anywhere else; that doc describes the op-type test above. So the numbers
   * justifying the one tuning knob this tier has could not be re-derived, and
   * nothing failed when a slice moved them — which is exactly how the same
   * file came to claim "all twenty-four op types" while the reducer folded
   * thirty-one.
   *
   * **A run contests a level when two devices write the same register** at it
   * — the same register, not merely the same entity: `(entity_path, field)` is
   * the merge unit (§3.1), so two devices writing `status` and `residence` on
   * one Entry contest nothing and must not be counted as if they did. Each
   * replica is folded from **its own ops alone**, which is precisely the
   * pre-exchange state the property's own divergence starts from.
   *
   * Measured over seven seeds at {@link CONTEST_SAMPLE}: root 266–310, entry
   * 80–95, piece 89–122. The floor sits at {@link CONTEST_FLOOR}, roughly a
   * third of the thinnest of those — wide enough that fast-check's own
   * sampling is never what fails it, and narrow enough to catch the regression
   * it exists for. Adding a fourth arm at the wrong weight cut the entry level
   * by a factor of four last time (22 in 200 to 5); the same cut here takes
   * entry from ~90 to ~22 and fails.
   *
   * Seeded for the reason the op-type test is: an assertion about the
   * generator, not about today's luck.
   */
  it('contests all three levels of the Trip aggregate at the charter floor', () => {
    const sets = fc.sample(arbOpSets(), {
      numRuns: CONTEST_SAMPLE,
      seed: 20260904,
    })

    const contested = { root: 0, entry: 0, piece: 0 }
    for (const opsPerDevice of sets) {
      const replicas = replicasFor(opsPerDevice.length)
      opsPerDevice.forEach((specs, i) =>
        specs.forEach((spec) => replicas[i]!.emit(spec)),
      )
      const perDevice = replicas.map((r) => tripRegisterPaths(r.state()))

      for (const level of ['root', 'entry', 'piece'] as const) {
        const seen = new Set<string>()
        const shared = perDevice.some((paths) =>
          [...paths[level]].some((path) => {
            if (seen.has(path)) return true
            seen.add(path)
            return false
          }),
        )
        if (shared) contested[level] += 1
      }
    }

    // Reported together rather than as three assertions, so a failure names
    // every level at once — which of them a new arm diluted is the first
    // thing the next reader needs, and three separate `expect`s would stop at
    // the first.
    expect({
      root: contested.root >= CONTEST_FLOOR,
      entry: contested.entry >= CONTEST_FLOOR,
      piece: contested.piece >= CONTEST_FLOOR,
      counts: contested,
    }).toEqual({
      root: true,
      entry: true,
      piece: true,
      counts: contested,
    })
  })

  it('converges to identical state regardless of arrival order', () => {
    let runs = 0
    let runsWithDivergentArrival = 0

    fc.assert(
      fc.property(
        arbOpSets(),
        fc.integer(),
        fc.boolean(),
        (opsPerDevice, seed, twice) => {
          const replicas = replicasFor(opsPerDevice.length)
          opsPerDevice.forEach((specs, i) =>
            specs.forEach((spec) => replicas[i]!.emit(spec)),
          )

          // Every replica receives every op, each in its own random order.
          // This is the direct consequence of `apply` being commutative,
          // associative and idempotent (`sync-protocol.md` §3.2) — and pull
          // ordering by `seq` is for cursor correctness only, never for merge
          // correctness (§8.2).
          const all = replicas.flatMap((r) => r.log())
          const arrivals = replicas.map((r) => {
            const order = shuffle(all, `${seed}:${r.deviceId}`)
            // Idempotence is part of the property, not a separate test: in
            // half the runs the whole log is delivered a second time, in a
            // different order again.
            return twice
              ? [...order, ...shuffle(all, `${seed}:${r.deviceId}:again`)]
              : order
          })
          replicas.forEach((r, i) => r.receive(arrivals[i]!))

          runs += 1
          if (new Set(arrivals.map(orderOf)).size > 1) {
            runsWithDivergentArrival += 1
          }

          const first = replicas[0]!.state()
          for (const r of replicas.slice(1)) expect(r.state()).toEqual(first)

          // Idempotence at the log, too: a second delivery adds no entries.
          for (const r of replicas) expect(r.log()).toHaveLength(all.length)

          // Sync §3.6 puts the over-claim beside the containment cycle as the
          // two conditions the reducer must not resolve, and both are
          // computed by a selector rather than the fold. The containment half
          // gets the detailed per-node loop below because `childrenOf`'s
          // iteration order can perturb it even under identical registers;
          // `overClaims` carries no such risk (`claimsByGear` iterates the
          // already-sorted `entriesOf`, and both its own output levels sort by
          // `compareIds`) — so this is expected to pass by construction, and
          // its passing is the point: architecture §8.3's "surfaced
          // identically on every replica", checked at scale across 200
          // interleavings and 2–4 replicas, not only in the one hand-built
          // two-replica scenario above.
          const overClaimsOnFirst = overClaims(first)
          for (const r of replicas.slice(1)) {
            expect(overClaims(r.state())).toEqual(overClaimsOnFirst)
          }

          // Folded state is not enough. The cycle break lives in a SELECTOR,
          // downstream of the fold, so two replicas can hold byte-identical
          // state and still display different trees. `holderOf` and
          // `brokenEdges` are start-independent on their own — the residence
          // graph is functional, so cycles are vertex-disjoint and a minimum
          // over a total order is start-independent — but `childrenOf`'s
          // buckets are filled in iteration order, and that is what unsorted
          // iteration perturbs.
          const view = containmentView(first)
          for (const r of replicas.slice(1)) {
            const other = containmentView(r.state())
            for (const id of Object.keys(first.gear)) {
              expect(other.holderOf(id)).toEqual(view.holderOf(id))
              expect(other.childrenOf({ kind: 'gear', id })).toEqual(
                view.childrenOf({ kind: 'gear', id }),
              )
            }
            for (const id of Object.keys(first.places)) {
              expect(other.childrenOf({ kind: 'place', id })).toEqual(
                view.childrenOf({ kind: 'place', id }),
              )
            }
            expect(other.childrenOf({ kind: 'loose' })).toEqual(
              view.childrenOf({ kind: 'loose' }),
            )
            expect([...other.brokenEdges].sort()).toEqual(
              [...view.brokenEdges].sort(),
            )
          }
        },
      ),
      { numRuns: 200 },
    )

    // The property is only worth anything if the replicas genuinely saw
    // different arrival orders. Two shuffles of a two-op log coincide half the
    // time and an empty log cannot differ at all, so this is a floor, not an
    // equality — but it fails loudly if the per-replica seeding is ever lost.
    expect(runsWithDivergentArrival).toBeGreaterThan(runs / 2)
  })

  it('a delete racing an edit converges to deleted and edited on both replicas', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]

    a.emit(
      gearRecorded(gear, { name: 'Tent', container: false, kind: 'single' }),
    )
    exchange(a, b)

    // Neither device has seen the other's op when it authors its own.
    clock.advance(1000)
    a.emit(gearRetired(gear))
    clock.advance(1000)
    b.emit(gearRenamed(gear, 'Storm tent'))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    // `sync-protocol.md` §3.5: a tombstone is an ordinary LWW field and an
    // edit never writes it, so the retirement survives the *later* rename —
    // without a special rule. Both apply; both stick.
    expect(a.state().gear[gear]?.retired?.value).toBe(true)
    expect(a.state().gear[gear]?.name?.value).toBe('Storm tent')
  })

  it('two concurrent rehomes converge to the later stamp on both replicas', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]
    const attic = PLACE_IDS[0]
    const shed = PLACE_IDS[1]

    a.emit(placeRecorded(attic, 'Attic'))
    a.emit(placeRecorded(shed, 'Shed'))
    a.emit(
      gearRecorded(gear, { name: 'Tent', container: false, kind: 'single' }),
    )
    exchange(a, b)

    clock.advance(1000)
    a.emit(gearRehomed(gear, { in: 'place', id: attic }))
    clock.advance(1000)
    const later = b.emit(gearRehomed(gear, { in: 'place', id: shed }))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    // One register, plain LWW on `(hlc, device_id)` — and the register carries
    // the winning op's own stamp, not just its value.
    expect(a.state().gear[gear]?.residence).toEqual({
      value: { in: 'place', id: shed },
      hlc: later.hlc,
      deviceId: later.device_id,
    })
    expect(containmentView(b.state()).holderOf(gear)).toEqual({
      kind: 'place',
      id: shed,
    })
  })

  it('two concurrent ownership sets converge to the later stamp on both replicas', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]
    const els = PERSON_IDS[0]
    const mark = PERSON_IDS[1]

    a.emit(personRecorded(els, 'Els'))
    a.emit(personRecorded(mark, 'Mark'))
    a.emit(
      gearRecorded(gear, {
        name: 'Down jacket',
        container: false,
        kind: 'single',
      }),
    )
    exchange(a, b)

    clock.advance(1000)
    a.emit(gearOwnershipSet(gear, { type: 'person', personId: els }))
    clock.advance(1000)
    const later = b.emit(
      gearOwnershipSet(gear, { type: 'person', personId: mark }),
    )
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    // One register, plain LWW on `(hlc, device_id)` — §8.3's named scenario
    // for this slice, and it needed no merge rule of its own.
    expect(a.state().gear[gear]?.owner).toEqual({
      value: { type: 'person', personId: mark },
      hlc: later.hlc,
      deviceId: later.device_id,
    })
  })

  it('a concurrent return-to-the-pool is a write like any other, not a clear', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]
    const els = PERSON_IDS[0]

    a.emit(personRecorded(els, 'Els'))
    a.emit(
      gearRecorded(gear, {
        name: 'Down jacket',
        container: false,
        kind: 'single',
        owner: { type: 'person', personId: els },
      }),
    )
    exchange(a, b)

    // A takes it personal again; B returns it to the shared pool, later.
    clock.advance(1000)
    a.emit(gearOwnershipSet(gear, { type: 'person', personId: els }))
    clock.advance(1000)
    b.emit(gearOwnershipSet(gear, { type: 'shared' }))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    // The register holds `shared` explicitly rather than being erased, which
    // is what lets a later personal write lose to it on the clock alone.
    expect(a.state().gear[gear]?.owner?.value).toEqual({ type: 'shared' })
  })

  it('a rename racing an ownership set leaves both writes standing', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]
    const els = PERSON_IDS[0]

    a.emit(personRecorded(els, 'Els'))
    a.emit(
      gearRecorded(gear, {
        name: 'Down jacket',
        container: false,
        kind: 'single',
      }),
    )
    exchange(a, b)

    // Different aggregates, different registers: neither write is contested,
    // so the union is not computed — it is the absence of a conflict. Free to
    // assert, and it is what proves S4's two ops do not interfere.
    clock.advance(1000)
    a.emit(personRenamed(els, 'Elsje'))
    clock.advance(1000)
    b.emit(gearOwnershipSet(gear, { type: 'person', personId: els }))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    expect(a.state().people[els]?.name?.value).toBe('Elsje')
    expect(a.state().gear[gear]?.owner?.value).toEqual({
      type: 'person',
      personId: els,
    })
  })

  it('a rename racing a name clear resolves by clock, and null is the winner it can be', () => {
    const { clock, a, b } = aWorld()
    const els = PERSON_IDS[0]

    a.emit(personRecorded(els, 'Els'))
    exchange(a, b)

    clock.advance(1000)
    a.emit(personRenamed(els, 'Elsje'))
    clock.advance(1000)
    b.emit(personRenamed(els, null))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    // `null` is a value with a clock, not an absence — so the later clear
    // wins outright rather than losing to whatever was there before.
    expect(a.state().people[els]?.name?.value).toBeNull()
  })

  it('place.removed racing a rehome into that place leaves the gear loose on both', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]
    const attic = PLACE_IDS[0]

    a.emit(placeRecorded(attic, 'Attic'))
    a.emit(
      gearRecorded(gear, { name: 'Tent', container: false, kind: 'single' }),
    )
    exchange(a, b)

    clock.advance(1000)
    a.emit(placeRemoved(attic))
    clock.advance(1000)
    b.emit(gearRehomed(gear, { in: 'place', id: attic }))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    // Nothing cascades (§3.5, invariant 4): the pointer still names the
    // tombstoned place, and restoring the place would restore the arrangement.
    expect(a.state().gear[gear]?.residence?.value).toEqual({
      in: 'place',
      id: attic,
    })
    for (const r of [a, b]) {
      const view = containmentView(r.state())
      expect(view.holderOf(gear)).toEqual({ kind: 'loose' })
      expect(view.childrenOf({ kind: 'loose' })).toEqual([gear])
      // Reason 1 is a pointer into a tombstone, not a broken edge.
      expect(view.brokenEdges.has(gear)).toBe(false)
    }
  })

  it('two devices forming a containment cycle break the same edge', () => {
    const { clock, a, b } = aWorld()
    const crateX = GEAR_IDS[0]
    const crateY = GEAR_IDS[1]

    a.emit(
      gearRecorded(crateX, {
        name: 'Crate X',
        container: true,
        kind: 'single',
      }),
    )
    a.emit(
      gearRecorded(crateY, {
        name: 'Crate Y',
        container: true,
        kind: 'single',
      }),
    )
    exchange(a, b)

    // The two ops target *different aggregates*, so per-field LWW cannot
    // prevent the cycle and the fold legitimately produces one (§3.6).
    clock.advance(1000)
    a.emit(gearRehomed(crateX, { in: 'gear', id: crateY }))
    clock.advance(1000)
    b.emit(gearRehomed(crateY, { in: 'gear', id: crateX }))
    // Each replica sees the two moves in the opposite order to the other.
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      const view = containmentView(r.state())
      // The lowest `(hlc, device_id)` in the cycle is X's edge, so X's is the
      // edge reported loose — on every replica, because every replica holds
      // identical registers.
      expect([...view.brokenEdges]).toEqual([crateX])
      expect(view.holderOf(crateX)).toEqual({ kind: 'loose' })
      expect(view.holderOf(crateY)).toEqual({ kind: 'gear', id: crateX })
      expect(view.childrenOf({ kind: 'gear', id: crateX })).toEqual([crateY])
      expect(view.childrenOf({ kind: 'loose' })).toEqual([crateX])
    }
  })

  it('a replica that receives the same op twice is unchanged by the second', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]

    a.emit(
      gearRecorded(gear, { name: 'Tent', container: false, kind: 'single' }),
    )
    clock.advance(1000)
    a.emit(gearRenamed(gear, 'Storm tent'))

    const relayed = a.log()
    b.receive(relayed)
    const afterFirst = b.state()
    b.receive(relayed)

    // Identity, not equality: a re-relayed op must not even rebuild the state
    // object, or every memo downstream is invalidated for nothing (§8.3).
    expect(b.state()).toBe(afterFirst)
    expect(b.log()).toHaveLength(relayed.length)
  })

  it('a replica that receives an op it authored itself is unchanged', () => {
    const { clock, a } = aWorld()
    const gear = GEAR_IDS[0]

    a.emit(
      gearRecorded(gear, { name: 'Tent', container: false, kind: 'single' }),
    )
    clock.advance(1000)
    a.emit(gearRetired(gear))

    const before = a.state()
    // Pull returns the device's own ops (§6.4): it has already applied them
    // optimistically, and re-applying is an idempotent no-op.
    a.receive(a.log())

    expect(a.state()).toBe(before)
    expect(a.log()).toHaveLength(2)
  })

  it('an unknown op type converges as an unfolded count, not as a divergence', () => {
    const { clock, a, b } = aWorld()
    const known = PERSON_IDS[0]
    const unknown = GEAR_IDS[0]

    // An op type this build does not fold — the honest shape of "an op from a
    // peer on a much later build". Hand-shaped precisely because there is no
    // builder for it here; the builders are the types the shipped slices
    // author.
    //
    // **The example had moved twice before this one**: `person.renamed` until
    // S4 folded that row, then `trip.created` until S6 folded this aggregate's
    // root. Both churned for the same reason — both were MVP catalogue entries
    // with a slice already coming for them, so each stopped being unfoldable
    // the moment that slice landed. Picking another (`trip.entry_added`, S7;
    // `trip.consumed_count_set`, S10) only sets the next move's date.
    //
    // `gear.weighed` cannot churn. Weight is **story 16, tagged Later**
    // (`docs/user-stories.md`), and §5's Later-seams list names its op type as
    // unspecified and additive — so no slice in the MVP plan folds it, while
    // it stays every bit as realistic as a catalogue entry, which an invented
    // type would not be. The property under test never changed; this is the
    // first op that can go on demonstrating it without a standing appointment
    // to be rewritten.
    const weighed: OpSpec = {
      aggregate: 'gear',
      aggregate_id: unknown,
      type: 'gear.weighed',
      payload: { grams: 780 },
    }

    a.emit(personRecorded(known, 'Bran'))
    clock.advance(1000)
    const unfoldable = b.emit(weighed)
    exchange(a, b)

    // `noteUnfolded` is the one counter in the fold that is *not* register-
    // guarded, so its idempotence rests entirely on `op.id` dedupe: hand the
    // op again to the replica that already has it, and the count must not
    // climb.
    a.receive([unfoldable])

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      // §5.3 obligation 1: retained and counted, never rejected.
      expect(r.state().unfolded).toEqual({
        count: 1,
        types: { 'gear.weighed': 1 },
      })
      expect(r.log()).toHaveLength(2)
      expect(r.state().people[known]?.name?.value).toBe('Bran')
      // An op this build cannot fold creates nothing, in any map — and the
      // claim is at its sharpest on `gear`, the map with eleven handlers and
      // a `writeGear` that creates a Gear on first sight of any of them. It
      // still never runs, because dispatch is a lookup on `type` and an
      // unknown one never reaches a handler at all.
      expect(Object.hasOwn(r.state().people, unknown)).toBe(false)
      expect(Object.hasOwn(r.state().gear, unknown)).toBe(false)
      expect(Object.hasOwn(r.state().trips, unknown)).toBe(false)
    }
  })

  it('exchanging in three rounds converges no differently than in one', () => {
    const gear = GEAR_IDS[0]
    const attic = PLACE_IDS[0]
    // One script, replayed under two exchange schedules. The clock is shared
    // and advanced once per emit, so every op carries the same `hlc` in both
    // runs and the only difference is *when* the two logs met.
    const script: readonly (readonly [0 | 1, OpSpec])[] = [
      [
        0,
        gearRecorded(gear, { name: 'Tent', container: false, kind: 'single' }),
      ],
      [1, placeRecorded(attic, 'Attic')],
      [0, gearRehomed(gear, { in: 'place', id: attic })],
      [1, gearRenamed(gear, 'Storm tent')],
      [0, gearRetired(gear)],
      [1, gearRestored(gear)],
    ]

    const run = (exchangeAfter: readonly number[]) => {
      const { clock, a, b } = aWorld()
      const pair = [a, b] as const
      script.forEach(([device, spec], i) => {
        clock.advance(1000)
        pair[device].emit(spec)
        if (exchangeAfter.includes(i)) exchange(a, b)
      })
      exchange(a, b)
      return pair.map((r) => r.state())
    }

    const staged = run([1, 3])
    const single = run([])

    // Associativity: ((a·b)·c) = (a·(b·c)). Regrouping the exchanges cannot
    // change where the fold lands.
    expect(staged[0]).toEqual(staged[1])
    expect(single[0]).toEqual(single[1])
    expect(staged[0]).toEqual(single[0])
    expect(staged[0]?.gear[gear]?.retired?.value).toBe(false)
    expect(staged[0]?.gear[gear]?.name?.value).toBe('Storm tent')
  })

  /**
   * **S3's named scenario** (`docs/testing.md`, Tier 2): *concurrent tagging
   * must union, never clobber* — the per-element-register case
   * `sync-protocol.md` §3.4 exists for.
   *
   * The claim is structural rather than algorithmic. Had tags been one
   * register holding an array, these two writes would have contested it and
   * exactly one would have survived. Because each tag is its own register,
   * the two ops never meet, so there is nothing for LWW to decide.
   */
  it('concurrent tagging unions rather than clobbering', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]

    a.emit(
      gearRecorded(gear, { name: 'Pot set', container: false, kind: 'single' }),
    )
    exchange(a, b)

    // Neither device has seen the other's tag when it authors its own.
    clock.advance(1000)
    a.emit(gearTagApplied(gear, aTag('food')))
    clock.advance(1000)
    b.emit(gearTagApplied(gear, aTag('kitchen')))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    expect(a.state().gear[gear]?.tags?.['food']?.value).toBe(true)
    expect(a.state().gear[gear]?.tags?.['kitchen']?.value).toBe(true)

    // The reason, asserted rather than assumed: each tag carries the stamp of
    // the device that wrote it, so neither write was ever contested. If these
    // ever agreed, the two tags would be sharing one register and the union
    // above would be luck.
    const tags = a.state().gear[gear]?.tags
    expect(tags?.['food']?.deviceId).toBe(a.deviceId)
    expect(tags?.['kitchen']?.deviceId).toBe(b.deviceId)
  })

  /**
   * The other half of §3.4: apply and remove of **the same** tag *are* one
   * register, and resolve by plain LWW — no set-union rule, no add-wins bias.
   */
  it('an apply racing a remove of the same tag resolves by plain LWW', () => {
    const gear = GEAR_IDS[0]

    const race = (removeIsLater: boolean) => {
      const { clock, a, b } = aWorld()
      a.emit(
        gearRecorded(gear, {
          name: 'Pot set',
          container: false,
          kind: 'single',
        }),
      )
      a.emit(gearTagApplied(gear, aTag('food')))
      exchange(a, b)

      clock.advance(1000)
      const first = removeIsLater
        ? a.emit(gearTagApplied(gear, aTag('food')))
        : b.emit(gearTagRemoved(gear, aTag('food')))
      clock.advance(1000)
      const second = removeIsLater
        ? b.emit(gearTagRemoved(gear, aTag('food')))
        : a.emit(gearTagApplied(gear, aTag('food')))
      exchange(a, b)

      expect(a.state()).toEqual(b.state())
      expect(first.hlc < second.hlc).toBe(true)
      return a.state().gear[gear]?.tags?.['food']
    }

    // Whichever op carries the later stamp wins, and the register carries
    // that op's own stamp — proving the loser arrived and lost, rather than
    // never arriving at all.
    expect(race(true)?.value).toBe(false)
    expect(race(false)?.value).toBe(true)
  })

  /**
   * **S6's first named scenario** (§8.3, and the spec's §5.2): *concurrent
   * phase moves resolve by plain LWW.*
   *
   * As with tags, the claim is structural. The phase is **one register
   * holding one value**, so exclusivity is a property of the shape rather
   * than of a rule: there is nothing for a merge to do but pick a winner, and
   * no arrival order can leave a Trip both `on_trip` and `unpack`. Had the
   * five phases been five booleans — the obvious alternative, and the one a
   * transition graph invites — this test would be where two devices produced
   * a Trip in two phases at once and the fold had no basis to choose.
   *
   * Invariant 16 is the other half: every move is expressible in either
   * direction, so a *backwards* move is an ordinary write and loses or wins
   * on its clock like any other. That is why B's move here is the earlier
   * phase in the sequence and still wins.
   */
  it('two concurrent phase moves converge to the later stamp on both replicas', () => {
    const { clock, a, b } = aWorld()
    const trip = TRIP_IDS[0]

    const created = a.emit(tripCreated(trip, 'Ardennes'))
    exchange(a, b)

    // Neither device has seen the other's move when it authors its own.
    clock.advance(1000)
    a.emit(tripPhaseMoved(trip, 'on_trip'))
    clock.advance(1000)
    const later = b.emit(tripPhaseMoved(trip, 'pack_out'))
    // `exchange` hands each replica the pair in the opposite order to the
    // other, so both arrival orders are exercised in the one round.
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      // The register carries the winning op's own stamp, not merely its
      // value — which is what proves the loser arrived and lost rather than
      // never arriving at all.
      expect(r.state().trips[trip]?.phase).toEqual({
        value: 'pack_out',
        hlc: later.hlc,
        deviceId: later.device_id,
      })
    }
    // The `draft` the creation seeded (spec §1.3) is a third write on that one
    // register and loses to both, on nothing but its clock — the reason the
    // phase is the reducer's write rather than a payload field is that a
    // three-way race over it needs no rule of its own.
    expect(created.hlc < later.hlc).toBe(true)
    expect(a.state().trips[trip]?.name?.hlc).toBe(created.hlc)
  })

  /**
   * **S6's second named scenario**: a Participant added on one Device and
   * removed on another. `sync-protocol.md` §3.4 puts Participants in the same
   * row as gear tags — one register per person id, never one register holding
   * an array — so this is the *same* register contested twice and resolves by
   * plain LWW, with no add-wins bias.
   *
   * The second half is the one a passing LWW check would not catch: the
   * loser's write must not come back later. A handler that rebuilt the
   * participants map instead of writing one key would leave this green until
   * some unrelated op on the Trip resurrected the loser, which is why the
   * rename below is here and why the assertion is on identity.
   */
  it('a Participant added on one Device and removed on another resolves by plain LWW', () => {
    const { clock, a, b } = aWorld()
    const trip = TRIP_IDS[0]
    const els = PERSON_IDS[0]

    a.emit(personRecorded(els, 'Els'))
    a.emit(tripCreated(trip, 'Ardennes'))
    a.emit(tripParticipantAdded(trip, els))
    exchange(a, b)

    clock.advance(1000)
    a.emit(tripParticipantAdded(trip, els))
    clock.advance(1000)
    const removal = b.emit(tripParticipantRemoved(trip, els))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    // `false` is a value carrying a clock, not a deleted key. Dropping the key
    // would let A's re-add win by arrival order on the next device to sync.
    expect(a.state().trips[trip]?.participants?.[els]).toEqual({
      value: false,
      hlc: removal.hlc,
      deviceId: removal.device_id,
    })

    const settled = a.state().trips[trip]?.participants
    clock.advance(1000)
    a.emit(tripRenamed(trip, 'Ardennes, later'))
    exchange(a, b)

    // A write to a different register on the same aggregate leaves the
    // participants map **identical**, not merely equal: the rename spreads the
    // Trip and carries this map across by reference.
    expect(a.state().trips[trip]?.participants).toBe(settled)
    expect(b.state().trips[trip]?.participants?.[els]?.value).toBe(false)
    expect(a.state()).toEqual(b.state())
  })

  /**
   * The third, which comes free: different registers on the **same** root do
   * not interfere. There is no conflict to resolve, so what this proves is
   * that `trip.dates_set` — one of the two multi-register handlers — does not
   * carry a stale `name` across with the two dates it writes. A handler that
   * spread a captured Trip rather than the current one would pass every
   * single-register test and fail this.
   */
  it('a rename racing a dates set leaves all three registers standing', () => {
    const { clock, a, b } = aWorld()
    const trip = TRIP_IDS[0]

    a.emit(tripCreated(trip, 'Ardennes'))
    exchange(a, b)

    clock.advance(1000)
    const rename = a.emit(tripRenamed(trip, 'Vosges'))
    clock.advance(1000)
    const dates = b.emit(
      tripDatesSet(trip, { start: '2026-08-14', end: '2026-08-20' }),
    )
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      const t = r.state().trips[trip]
      // The rename is the *earlier* op and survives untouched, stamp and all,
      // which is the sharp form of "the later multi-register write did not
      // reach it".
      expect(t?.name?.value).toBe('Vosges')
      expect(t?.name?.hlc).toBe(rename.hlc)
      expect(t?.startDate?.value).toBe('2026-08-14')
      expect(t?.endDate?.value).toBe('2026-08-20')
      expect(t?.endDate?.hlc).toBe(dates.hlc)
      // And the phase the creation seeded is untouched by either.
      expect(t?.phase?.value).toBe('draft')
    }
  })

  /**
   * **S7's named scenario, part one** (`docs/specs/2026-08-29-the-gear-list.md`
   * §5.2, architecture §8.3): *the over-claim is surfaced identically on every
   * replica … nothing recorded is discarded.*
   *
   * The over-claim itself is not a register anything writes — it is
   * `overClaims`, a selector over two ordinary `trip.entry_added` on two
   * different Trip aggregates. Per-field LWW has no basis to prevent this: the
   * two ops never contest the same register, so the fold legitimately reaches
   * a state the domain forbids (sync §3.6), and both replicas must reach it
   * identically.
   */
  it('surfaces the same over-claim on both replicas after a partition', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]
    const tripAlps = TRIP_IDS[0]
    const tripAvores = TRIP_IDS[1]

    a.emit(
      gearRecorded(gear, { name: 'Stove', container: false, kind: 'single' }),
    )
    a.emit(tripCreated(tripAlps, 'Alps'))
    a.emit(tripPhaseMoved(tripAlps, 'pack_out'))
    a.emit(tripCreated(tripAvores, 'Avores'))
    a.emit(tripPhaseMoved(tripAvores, 'on_trip'))
    exchange(a, b)

    // Partitioned: neither device has seen the other's addition when it
    // authors its own.
    clock.advance(1000)
    a.emit(tripEntryAdded(tripAlps, 'e1', { from: 'depot', gearId: gear }))
    clock.advance(1000)
    b.emit(tripEntryAdded(tripAvores, 'e2', { from: 'depot', gearId: gear }))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    // Both Entries are retained on both replicas — the forbidden state is
    // reached and kept, not merged away.
    for (const r of [a, b]) {
      expect(r.state().trips[tripAlps]?.entries?.['e1']?.source?.value).toEqual(
        { from: 'depot', gearId: gear },
      )
      expect(
        r.state().trips[tripAvores]?.entries?.['e2']?.source?.value,
      ).toEqual({ from: 'depot', gearId: gear })
    }

    const claimsOnA = overClaims(a.state())
    const claimsOnB = overClaims(b.state())
    expect(claimsOnA).toEqual(claimsOnB)
    expect(claimsOnA).toHaveLength(1)
    expect(claimsOnA[0]).toMatchObject({
      gearId: gear,
      kind: 'single',
      supply: 1,
      claimed: 2,
    })
    expect(claimsOnA[0]!.claims.map((c) => c.tripId).sort()).toEqual(
      [tripAlps, tripAvores].sort(),
    )
  })

  /**
   * **S7's named scenario, part two.** The domain gives the over-claim
   * exactly one resolution — `trip.entry_removed` — and no other op even
   * mentions it (sync §3.6: "no op for surfacing or resolving it"). The half
   * easiest to lose: settling one Trip's claim must leave the *other* Trip's
   * Entry completely untouched, not merely equal — it is a different
   * aggregate that the removal never addresses.
   */
  it('clears the over-claim on both replicas when one removes an entry', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]
    const tripAlps = TRIP_IDS[0]
    const tripAvores = TRIP_IDS[1]

    a.emit(
      gearRecorded(gear, { name: 'Stove', container: false, kind: 'single' }),
    )
    a.emit(tripCreated(tripAlps, 'Alps'))
    a.emit(tripPhaseMoved(tripAlps, 'pack_out'))
    a.emit(tripCreated(tripAvores, 'Avores'))
    a.emit(tripPhaseMoved(tripAvores, 'on_trip'))
    a.emit(tripEntryAdded(tripAlps, 'e1', { from: 'depot', gearId: gear }))
    a.emit(tripEntryAdded(tripAvores, 'e2', { from: 'depot', gearId: gear }))
    exchange(a, b)
    expect(overClaims(a.state())).toHaveLength(1)

    // Captured per replica: identity across two different devices' own folds
    // is never guaranteed, only identity *within* one replica's fold across
    // an unrelated write. `toEqual` below covers the cross-replica claim;
    // this covers the within-replica one.
    const untouchedBefore = new Map(
      [a, b].map((r) => [r, r.state().trips[tripAvores]?.entries?.['e2']]),
    )

    clock.advance(1000)
    a.emit(tripEntryRemoved(tripAlps, 'e1'))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      expect(overClaims(r.state())).toEqual([])
      expect(r.state().trips[tripAlps]?.entries?.['e1']?.removed?.value).toBe(
        true,
      )
      // Nothing recorded is discarded: the removed Entry is retained as a
      // tombstone, not deleted from the map.
      expect(r.state().trips[tripAlps]?.entries?.['e1']?.source).toBeDefined()
      // The other Trip's aggregate was never addressed by this op, so its
      // Entry is not merely equal — it is the identical object this replica
      // already held.
      expect(r.state().trips[tripAvores]?.entries?.['e2']).toBe(
        untouchedBefore.get(r),
      )
    }
  })

  /**
   * **S7's named scenario, part three.** `bringCount` is one register per
   * Entry, so two concurrent edits contest it exactly like `owner` or
   * `residence` do — plain LWW, and the loser's op stays in the log rather
   * than being discarded (`sync-protocol.md` §2, §8.3).
   */
  it('resolves two Bring-count edits by plain LWW, keeping the loser in the log', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]
    const trip = TRIP_IDS[0]

    a.emit(
      gearRecorded(gear, { name: 'Mugs', container: false, kind: 'counted' }),
    )
    a.emit(tripCreated(trip, 'Alps'))
    a.emit(tripPhaseMoved(trip, 'pack_out'))
    a.emit(tripEntryAdded(trip, 'e1', { from: 'depot', gearId: gear }))
    exchange(a, b)

    // Neither device has seen the other's edit when it authors its own.
    clock.advance(1000)
    const loser = a.emit(tripEntryBringCountSet(trip, 'e1', 2))
    clock.advance(1000)
    const winner = b.emit(tripEntryBringCountSet(trip, 'e1', 5))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    // The register carries the winning op's own stamp, not merely its
    // value — the same proof every other LWW scenario in this file uses.
    expect(a.state().trips[trip]?.entries?.['e1']?.bringCount).toEqual({
      value: 5,
      hlc: winner.hlc,
      deviceId: winner.device_id,
    })
    // The loser's op is retained in both logs — nothing recorded is
    // discarded to resolve the conflict.
    for (const r of [a, b]) {
      expect(r.log().some((op) => op.id === loser.id)).toBe(true)
      expect(r.log().some((op) => op.id === winner.id)).toBe(true)
    }
  })

  /**
   * **S7's named scenario, part four.** `writeEntry` creates a bare,
   * sourceless Entry on first sight of *any* op naming it — `trip.entry_added`
   * is not privileged as "the" creator. So a Bring-count set and a removal
   * that arrive before the `entry_added` still fold, through a sourceless
   * intermediate `entriesOf` excludes, and the final state must not depend on
   * which of the three orders a replica happened to receive.
   */
  it('converges when a bring-count and a removal precede the entry_added', () => {
    const { clock, a } = aWorld()
    const gear = GEAR_IDS[0]
    const trip = TRIP_IDS[0]

    a.emit(
      gearRecorded(gear, { name: 'Mugs', container: false, kind: 'counted' }),
    )
    a.emit(tripCreated(trip, 'Alps'))
    a.emit(tripPhaseMoved(trip, 'pack_out'))
    clock.advance(1000)
    const bringCount = a.emit(tripEntryBringCountSet(trip, 'e1', 3))
    clock.advance(1000)
    const removed = a.emit(tripEntryRemoved(trip, 'e1'))
    clock.advance(1000)
    const added = a.emit(
      tripEntryAdded(trip, 'e1', { from: 'depot', gearId: gear }),
    )

    const setup = a.log().slice(0, 3)
    const ops = a.log()
    const forward = createReplica({
      deviceId: DEVICE_IDS[2],
      householdId: HOUSEHOLD,
      clock: fakeClock(BASE_MS),
    })
    const reversed = createReplica({
      deviceId: DEVICE_IDS[3],
      householdId: HOUSEHOLD,
      clock: fakeClock(BASE_MS),
    })

    forward.receive(setup)
    // The sourceless intermediate: with only the Bring-count set and the
    // removal delivered, the Entry exists but `entriesOf` excludes it — there
    // is nothing to default `source` to (entry.ts's own rule).
    forward.receive([bringCount, removed])
    expect(forward.state().trips[trip]?.entries?.['e1']?.source).toBeUndefined()
    expect(
      Object.values(forward.state().trips[trip]?.entries ?? {}),
    ).toHaveLength(1)

    forward.receive([added])
    reversed.receive([...ops].reverse())

    expect(forward.state()).toEqual(reversed.state())
    const settled = forward.state().trips[trip]?.entries?.['e1']
    expect(settled?.source?.value).toEqual({ from: 'depot', gearId: gear })
    expect(settled?.removed?.value).toBe(true)
    expect(settled?.bringCount?.value).toBe(3)
  })

  /**
   * **S7's named scenario, part five.** `source` and `removed` are different
   * registers on the same Entry (`state.ts`), so a concurrent add and remove
   * never contest one field the way two Bring-count edits do — this is
   * `sync-protocol.md` §3.5's tombstone rule again: a tombstone is an
   * ordinary LWW field and the op that creates the Entry never touches it.
   * Whichever of the two carries the later stamp, **both** writes stand:
   * deleting an Entry does not erase the fact that it named a piece of Gear,
   * and adding one after a removal does not resurrect it.
   */
  it('resolves a concurrent add and remove without either write being discarded', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]
    const trip = TRIP_IDS[0]

    a.emit(
      gearRecorded(gear, { name: 'Tent', container: false, kind: 'single' }),
    )
    a.emit(tripCreated(trip, 'Alps'))
    a.emit(tripPhaseMoved(trip, 'pack_out'))
    exchange(a, b)

    // Neither device has seen the other's op when it authors its own —
    // the remove is authored *before* the peer has any Entry to remove.
    clock.advance(1000)
    const removed = b.emit(tripEntryRemoved(trip, 'e1'))
    clock.advance(1000)
    const added = a.emit(
      tripEntryAdded(trip, 'e1', { from: 'depot', gearId: gear }),
    )
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      const entry = r.state().trips[trip]?.entries?.['e1']
      // Delete does not automatically win (sync §3.5): the later add's
      // `source` is not erased by the earlier remove's tombstone.
      expect(entry?.source).toEqual({
        value: { from: 'depot', gearId: gear },
        hlc: added.hlc,
        deviceId: added.device_id,
      })
      // Nor does the add undo the tombstone — both registers hold, on both
      // replicas, regardless of which order this replica received them in.
      expect(entry?.removed).toEqual({
        value: true,
        hlc: removed.hlc,
        deviceId: removed.device_id,
      })
      // The reader-visible consequence, pinned so "the add survived" is not
      // mistaken for "the Entry is back on the list": `entriesOf` excludes a
      // removed Entry regardless of what its `source` says, so it holds no
      // claim either.
      const tripState = r.state().trips[trip]
      expect(entriesOf(tripState!, r.state())).toHaveLength(0)
      expect(overClaims(r.state())).toEqual([])
    }
  })

  /**
   * **S7's named scenario, part six.** Story 6's legitimate case, proven at
   * the convergence tier rather than only at the selector unit tier
   * (`selectors/claim.test.ts`): two active Trips claiming one per-person
   * Gear for **disjoint** Participants must converge with no over-claim on
   * either replica — comparing People, never counts.
   *
   * `overClaims(state) === []` is an assertion that *nothing happened*, and
   * three unrelated regressions could each produce it for the wrong
   * reason — a Gear kind that stopped folding, an Entry that never reached
   * the other replica, or a Trip that stopped reading active — so this test
   * pins the positive facts first, then closes with a second positive
   * control: the identical fixture, with the shared Person added to the
   * second Trip too, that *does* report a claim. Without it, a selector that
   * always returned `[]` would pass this file end to end.
   */
  it('reports no over-claim for per-person gear taken for disjoint People', () => {
    const { clock, a, b } = aWorld()
    const gear = GEAR_IDS[0]
    const els = PERSON_IDS[0]
    const mark = PERSON_IDS[1]
    const tripAlps = TRIP_IDS[0]
    const tripAvores = TRIP_IDS[1]

    a.emit(personRecorded(els, 'Els'))
    a.emit(personRecorded(mark, 'Mark'))
    a.emit(
      gearRecorded(gear, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
    )
    a.emit(tripCreated(tripAlps, 'Alps'))
    a.emit(tripPhaseMoved(tripAlps, 'pack_out'))
    a.emit(tripParticipantAdded(tripAlps, els))
    a.emit(tripCreated(tripAvores, 'Avores'))
    a.emit(tripPhaseMoved(tripAvores, 'on_trip'))
    a.emit(tripParticipantAdded(tripAvores, mark))
    exchange(a, b)

    clock.advance(1000)
    a.emit(tripEntryAdded(tripAlps, 'e1', { from: 'depot', gearId: gear }))
    clock.advance(1000)
    b.emit(tripEntryAdded(tripAvores, 'e2', { from: 'depot', gearId: gear }))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      // Both Entries reached the fold, referencing the right Gear, on two
      // Trips this build actually reads as active — the premises that make
      // the empty result below mean something.
      expect(r.state().trips[tripAlps]?.entries?.['e1']?.source?.value).toEqual(
        { from: 'depot', gearId: gear },
      )
      expect(
        r.state().trips[tripAvores]?.entries?.['e2']?.source?.value,
      ).toEqual({ from: 'depot', gearId: gear })
      expect(isActive(r.state().trips[tripAlps]!)).toBe(true)
      expect(isActive(r.state().trips[tripAvores]!)).toBe(true)
      expect(overClaims(r.state())).toEqual([])
    }

    // The positive control: the same fixture, with `els` also on Avores —
    // the sets are no longer disjoint, and the selector must now find the
    // shared Person, on both replicas.
    clock.advance(1000)
    a.emit(tripParticipantAdded(tripAvores, els))
    exchange(a, b)

    for (const r of [a, b]) {
      const claims = overClaimsFor(r.state(), tripAvores)
      expect(claims).toHaveLength(1)
      expect(claims[0]!.kind).toBe('per_person')
      expect(claims[0]!.contestedPersonIds).toEqual([els])
    }
  })

  /**
   * **S8's named scenario** (§8.3): *remove-vs-restore is an ordinary LWW
   * pair.* `trip.piece_removed` and `trip.piece_restored` both write the same
   * `entries.<id>.pieces.<personId>.removed` register (spec §4.4), so this is
   * `tags.ts`'s "an apply racing a remove" test transplanted one level
   * deeper — and it earns the same defence: whichever op is later wins, on
   * its own stamp, **regardless of which of the two it is**. A delete-wins
   * special case (the ordinary bias for a tombstone) would make the `false`
   * branch below fail, because there restore is the later op and must win
   * anyway.
   */
  it('converges a piece removal against a restore, in either delivery order', () => {
    const trip = TRIP_IDS[0]
    const entry = ENTRY_IDS[0]
    const person = PERSON_IDS[0]

    const race = (restoreIsLater: boolean) => {
      const { clock, a, b } = aWorld()
      a.emit(tripCreated(trip, 'Ardennes'))
      a.emit(tripParticipantAdded(trip, person))
      a.emit(
        tripEntryAdded(trip, entry, {
          from: 'trip_only',
          name: 'Stove',
          container: false,
        }),
      )
      exchange(a, b)

      // Neither device has seen the other's op when it authors its own.
      clock.advance(1000)
      const first = restoreIsLater
        ? a.emit(tripPieceRemoved(trip, entry, person))
        : b.emit(tripPieceRestored(trip, entry, person))
      clock.advance(1000)
      const second = restoreIsLater
        ? b.emit(tripPieceRestored(trip, entry, person))
        : a.emit(tripPieceRemoved(trip, entry, person))
      // `exchange` hands each replica the pair in the opposite order to the
      // other, so both arrival orders are exercised in the one round.
      exchange(a, b)

      expect(a.state()).toEqual(b.state())
      expect(first.hlc < second.hlc).toBe(true)
      for (const r of [a, b]) {
        // The register carries the winning op's own stamp, not merely its
        // value — proof the loser arrived and lost rather than never
        // arriving at all. `value` pins *which* op won: were a delete-wins
        // special case in force, this would read `true` regardless of
        // `restoreIsLater`.
        expect(
          r.state().trips[trip]?.entries?.[entry]?.pieces?.[person]?.removed,
        ).toEqual({
          value: !restoreIsLater,
          hlc: second.hlc,
          deviceId: second.device_id,
        })
      }
      return a.state()
    }

    // Restore later: the later stamp wins, and it happens to be a restore —
    // the Piece is back on both replicas.
    const restored = race(true)
    expect(
      piecesOf(restored.trips[trip]!.entries![entry]!, restored.trips[trip]!),
    ).toEqual([person])

    // Removal later: the later stamp wins again, and this time it is a
    // removal — the Piece is out. Same rule, opposite outcome, which is what
    // proves the win is about the stamp and not about which op it is.
    const removed = race(false)
    expect(
      piecesOf(removed.trips[trip]!.entries![entry]!, removed.trips[trip]!),
    ).toEqual([])
  })

  /**
   * S8's second named scenario: **a Participant added concurrently with a
   * Piece removal survives both writes** — the same "different aggregates,
   * different registers" shape as "a rename racing an ownership set", one
   * level deeper. `participants.<personId>` and
   * `entries.<id>.pieces.<personId>.removed` are different registers on
   * different entity paths, so neither write is contested: the union is not
   * computed, it is the absence of a conflict.
   */
  it('keeps both a Participant added and a Piece removed concurrently', () => {
    const { clock, a, b } = aWorld()
    const trip = TRIP_IDS[0]
    const entry = ENTRY_IDS[0]
    const els = PERSON_IDS[0]
    const mark = PERSON_IDS[1]

    a.emit(tripCreated(trip, 'Ardennes'))
    a.emit(tripParticipantAdded(trip, els))
    a.emit(
      tripEntryAdded(trip, entry, {
        from: 'trip_only',
        name: 'Stove',
        container: false,
      }),
    )
    exchange(a, b)

    // A adds Mark as a Participant; B, on the other Device, removes Els's
    // Piece of the same Entry — neither has seen the other's op.
    clock.advance(1000)
    a.emit(tripParticipantAdded(trip, mark))
    clock.advance(1000)
    b.emit(tripPieceRemoved(trip, entry, els))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      const state = r.state()
      expect(state.trips[trip]?.participants?.[mark]?.value).toBe(true)
      expect(
        state.trips[trip]?.entries?.[entry]?.pieces?.[els]?.removed?.value,
      ).toBe(true)
      // Restated through the selector: Mark's Piece survives (added, never
      // tombstoned) and Els's does not — the two writes did not interact.
      expect(
        piecesOf(state.trips[trip]!.entries![entry]!, state.trips[trip]!),
      ).toEqual([mark])
    }
  })

  /**
   * S8's third named scenario, and the per-key register property one level
   * deeper than "concurrent tagging unions rather than clobbering": two
   * Devices tombstoning **different** Pieces of the **same** Entry address
   * different `pieces.<personId>` registers, so there is nothing for LWW to
   * decide between them — both tombstones stand, and the result is a union
   * of two writes that were never in conflict.
   */
  it('unions two Devices removing different Pieces of one Entry', () => {
    const { a, b } = aWorld()
    const trip = TRIP_IDS[0]
    const entry = ENTRY_IDS[0]
    const els = PERSON_IDS[0]
    const mark = PERSON_IDS[1]

    a.emit(tripCreated(trip, 'Ardennes'))
    a.emit(tripParticipantAdded(trip, els))
    a.emit(tripParticipantAdded(trip, mark))
    a.emit(
      tripEntryAdded(trip, entry, {
        from: 'trip_only',
        name: 'Stove',
        container: false,
      }),
    )
    exchange(a, b)

    // Neither device has seen the other's removal when it authors its own.
    a.emit(tripPieceRemoved(trip, entry, els))
    b.emit(tripPieceRemoved(trip, entry, mark))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      const state = r.state()
      expect(
        state.trips[trip]?.entries?.[entry]?.pieces?.[els]?.removed?.value,
      ).toBe(true)
      expect(
        state.trips[trip]?.entries?.[entry]?.pieces?.[mark]?.removed?.value,
      ).toBe(true)
      // Both Pieces are out — the union, not a coin-flip between them.
      expect(
        piecesOf(state.trips[trip]!.entries![entry]!, state.trips[trip]!),
      ).toEqual([])
    }
  })

  /**
   * **S9a's headline property** (`docs/sync-protocol.md` §3.7, invariant 12
   * honoured *structurally* rather than enforced): `residence` and `status`
   * are two different registers on the same Entry, so no merge can ever make
   * them agree. Device A moves the stove into the duffel; Device B marks it
   * `not_packed`. Both apply — regardless of which order the two exchange —
   * and the disagreement survives on both replicas rather than being resolved
   * away.
   *
   * The duffel is staged `car` (uncontested, by A alone, before the race) so
   * the disagreement is a real one: `packing.ts`'s `disagreements` fires on
   * `car` and `packed` only ({@link stageDisagreementLabel}), and this pins
   * that it actually does, on both replicas — not merely that the two
   * registers hold the values a reader would expect.
   */
  it('keeps residence and status apart, so no merge can make them agree', () => {
    const { clock, a, b } = aWorld()
    const trip = TRIP_IDS[0]
    const duffel = ENTRY_IDS[0]
    const stove = ENTRY_IDS[1]

    a.emit(tripCreated(trip, 'Ardennes'))
    a.emit(
      tripEntryAdded(trip, duffel, {
        from: 'trip_only',
        name: 'Duffel',
        container: true,
      }),
    )
    a.emit(
      tripEntryAdded(trip, stove, {
        from: 'trip_only',
        name: 'Stove',
        container: false,
      }),
    )
    // Uncontested — the duffel is already in the car before the race below,
    // so the disagreement this test produces is one `disagreements` actually
    // fires on (`car`, not `home`).
    a.emit(tripContainerStageSet(trip, duffel, 'car'))
    exchange(a, b)

    // Neither device has seen the other's op when it authors its own.
    clock.advance(1000)
    const notPacked = b.emit(tripEntryStatusSet(trip, stove, 'not_packed'))
    clock.advance(1000)
    a.emit(tripEntryMoved(trip, stove, { in: 'container', entryId: duffel }))
    // `exchange` hands each replica the pair in the opposite order to the
    // other, so both arrival orders are exercised in the one round.
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      const state = r.state()
      const tripState = state.trips[trip]!
      const entry = tripState.entries![stove]!
      // Two different registers, and both writes stand — the merge has no
      // basis to make them agree.
      expect(entry.residence!.value).toEqual({
        in: 'container',
        entryId: duffel,
      })
      // The whole register, not merely the value: `not_packed` is also
      // `statusOf`'s default for an absent register, so pinning only the
      // value cannot tell "B's write survived" apart from "nothing ever
      // wrote this field".
      expect(entry.status).toEqual({
        value: 'not_packed',
        hlc: notPacked.hlc,
        deviceId: notPacked.device_id,
      })
      expect(statusOf(entry, state)).toBe('not_packed')
      expect(tripContainmentView(tripState, state).holderOf(stove)).toEqual({
        kind: 'container',
        entryId: duffel,
      })

      // The disagreement this shape is meant to produce, surfaced rather
      // than prevented: the packed-for-the-car duffel holds one unpacked
      // Piece.
      expect(disagreements(tripState, state)).toEqual([
        { entryId: duffel, label: 'IN CAR', notPacked: 1 },
      ])
    }
  })

  /**
   * **Sync §3.3's dropped furthest-stage rule, asserted rather than
   * assumed.** Device A sets `packed` at HLC 100; Device B sets `staged` at
   * HLC 200 — the *backwards* move. The later write wins outright on the
   * clock alone, even though it names an earlier stage: architecture §2's
   * furthest-stage-wins override was dropped precisely because a mistaken
   * `packed` must stay correctable (story 9, story 32), and this test exists
   * because reintroducing that rule is the tempting thing a future reader
   * will do.
   */
  it('lets a backwards status move win on its clock', () => {
    const { clock, a, b } = aWorld()
    const trip = TRIP_IDS[0]
    const entry = ENTRY_IDS[0]

    a.emit(tripCreated(trip, 'Ardennes'))
    a.emit(
      tripEntryAdded(trip, entry, {
        from: 'trip_only',
        name: 'Stove',
        container: false,
      }),
    )
    exchange(a, b)

    // Neither device has seen the other's op when it authors its own.
    clock.advance(1000)
    const packed = a.emit(tripEntryStatusSet(trip, entry, 'packed'))
    clock.advance(1000)
    const staged = b.emit(tripEntryStatusSet(trip, entry, 'staged'))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      const status = r.state().trips[trip]!.entries![entry]!.status
      // The register carries the winning op's own stamp, not merely its
      // value — proof the earlier `packed` arrived and lost, rather than a
      // furthest-stage rule having quietly kept it.
      expect(status).toEqual({
        value: 'staged',
        hlc: staged.hlc,
        deviceId: staged.device_id,
      })
      expect(isPacked(status!.value)).toBe(false)
    }
    expect(packed.hlc < staged.hlc).toBe(true)
  })

  /**
   * The trip side of "two devices forming a containment cycle break the same
   * edge" above, over `tripContainmentView` instead of `containmentView`.
   * Per-field LWW cannot prevent the cycle — `trip.entry_moved` on crate X and
   * on crate Y are two ops on two different Entries' `residence` registers —
   * so the fold legitimately holds a cycle (§3.6), and the containment
   * selector must break it identically on both replicas: the edge whose
   * `residence` register carries the lowest `(hlc, device_id)`.
   */
  it('breaks a trip-side containment cycle identically on both replicas', () => {
    const { clock, a, b } = aWorld()
    const trip = TRIP_IDS[0]
    const crateX = ENTRY_IDS[0]
    const crateY = ENTRY_IDS[1]

    a.emit(tripCreated(trip, 'Ardennes'))
    a.emit(
      tripEntryAdded(trip, crateX, {
        from: 'trip_only',
        name: 'Crate X',
        container: true,
      }),
    )
    a.emit(
      tripEntryAdded(trip, crateY, {
        from: 'trip_only',
        name: 'Crate Y',
        container: true,
      }),
    )
    exchange(a, b)

    // The two ops target different Entries, so per-field LWW cannot prevent
    // the cycle and the fold legitimately produces one (§3.6).
    clock.advance(1000)
    a.emit(tripEntryMoved(trip, crateX, { in: 'container', entryId: crateY }))
    clock.advance(1000)
    b.emit(tripEntryMoved(trip, crateY, { in: 'container', entryId: crateX }))
    // Each replica sees the two moves in the opposite order to the other.
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      const state = r.state()
      const view = tripContainmentView(state.trips[trip]!, state)
      // The lowest `(hlc, device_id)` in the cycle is X's edge, so X's is the
      // edge reported loose — on every replica, because every replica holds
      // identical registers.
      expect([...view.brokenEdges]).toEqual([crateX])
      expect(view.holderOf(crateX)).toEqual({ kind: 'loose' })
      expect(view.holderOf(crateY)).toEqual({
        kind: 'container',
        entryId: crateX,
      })
      expect(view.childrenOf({ kind: 'container', entryId: crateX })).toEqual([
        crateY,
      ])
      expect(view.childrenOf({ kind: 'loose' })).toEqual([crateX])
    }
  })

  /**
   * Different registers on different entity paths: a `trip.container_stage_set`
   * on a container and a `trip.entry_moved` of one of its **contents** never
   * contest one another. Device A stages the duffel for the car; concurrently,
   * Device B moves the stove out of the duffel and into the crate. Both
   * writes stand — the duffel's stage moves regardless of what is inside it,
   * and the stove leaves with the holder Device B actually named. The
   * concurrent stage change on its old container neither blocks the move nor
   * pulls it back, which is `EntryState.stage`'s own rule: "no fan-out and no
   * cross-entity write."
   */
  it('survives a container stage_set concurrent with a content entry_moved', () => {
    const { clock, a, b } = aWorld()
    const trip = TRIP_IDS[0]
    const duffel = ENTRY_IDS[0]
    const crate = ENTRY_IDS[1]
    const stove = ENTRY_IDS[2]

    a.emit(tripCreated(trip, 'Ardennes'))
    a.emit(
      tripEntryAdded(trip, duffel, {
        from: 'trip_only',
        name: 'Duffel',
        container: true,
      }),
    )
    a.emit(
      tripEntryAdded(trip, crate, {
        from: 'trip_only',
        name: 'Crate',
        container: true,
      }),
    )
    a.emit(
      tripEntryAdded(trip, stove, {
        from: 'trip_only',
        name: 'Stove',
        container: false,
      }),
    )
    a.emit(tripEntryMoved(trip, stove, { in: 'container', entryId: duffel }))
    exchange(a, b)

    // Neither device has seen the other's op when it authors its own — B's
    // move of the stove is the earlier of the two.
    clock.advance(1000)
    b.emit(tripEntryMoved(trip, stove, { in: 'container', entryId: crate }))
    clock.advance(1000)
    a.emit(tripContainerStageSet(trip, duffel, 'car'))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      const state = r.state()
      const tripState = state.trips[trip]!
      expect(tripState.entries![duffel]!.stage!.value).toBe('car')
      expect(stageOf(tripState.entries![duffel]!, state)).toBe('car')
      // The stove left with the holder B actually named — the concurrent
      // stage change on its old container neither blocked the move nor
      // pulled it back.
      expect(tripState.entries![stove]!.residence!.value).toEqual({
        in: 'container',
        entryId: crate,
      })
      const view = tripContainmentView(tripState, state)
      expect(view.holderOf(stove)).toEqual({
        kind: 'container',
        entryId: crate,
      })
      expect(view.childrenOf({ kind: 'container', entryId: duffel })).toEqual(
        [],
      )
      expect(view.childrenOf({ kind: 'container', entryId: crate })).toEqual([
        stove,
      ])
    }
  })

  /**
   * `SET EVERYONE` (`docs/design/README.md`'s per-person Piece sheet) is N
   * independent `trip.piece_status_set` ops — one per Piece — never one
   * batch op (spec §9's own named scenario). So a concurrent single-Piece
   * write on another Device contests only the one register it addresses, and
   * resolves by plain LWW exactly as an ordinary Piece write does: the rest
   * of the batch is untouched, not rolled back with it.
   */
  it("resolves SET EVERYONE's batch per Piece, not all-or-nothing", () => {
    const { clock, a, b } = aWorld()
    const trip = TRIP_IDS[0]
    const entry = ENTRY_IDS[0]
    const els = PERSON_IDS[0]
    const mark = PERSON_IDS[1]

    a.emit(tripCreated(trip, 'Ardennes'))
    a.emit(tripParticipantAdded(trip, els))
    a.emit(tripParticipantAdded(trip, mark))
    a.emit(
      tripEntryAdded(trip, entry, {
        from: 'trip_only',
        name: 'Headlamps',
        container: false,
      }),
    )
    exchange(a, b)

    // Device A taps `SET EVERYONE → PACKED`: two independent ops, one per
    // Piece, both authored in the same gesture.
    clock.advance(1000)
    const markPacked = a.emit(tripPieceStatusSet(trip, entry, mark, 'packed'))
    const elsPacked = a.emit(tripPieceStatusSet(trip, entry, els, 'packed'))
    // Neither device has seen the other's op — Device B, concurrently, sets
    // just Els's Piece back to `staged`, later than the batch.
    clock.advance(1000)
    const elsStaged = b.emit(tripPieceStatusSet(trip, entry, els, 'staged'))
    exchange(a, b)

    expect(a.state()).toEqual(b.state())
    for (const r of [a, b]) {
      const pieces = r.state().trips[trip]!.entries![entry]!.pieces!
      // Mark's Piece is untouched by the conflict on Els's — a different
      // register, never contested, still carrying the batch's own stamp.
      expect(pieces[mark]!.status).toEqual({
        value: 'packed',
        hlc: markPacked.hlc,
        deviceId: markPacked.device_id,
      })
      // Els's Piece resolves by plain LWW between the two writes that did
      // contest it — B's later single write beats A's batch write, on the
      // clock alone.
      expect(pieces[els]!.status).toEqual({
        value: 'staged',
        hlc: elsStaged.hlc,
        deviceId: elsStaged.device_id,
      })
    }
    expect(elsPacked.hlc < elsStaged.hlc).toBe(true)
  })
})
