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
  type OpSpec,
} from './authoring.ts'
import type { OpEnvelope } from './ops.ts'
import { containmentView } from './selectors/containment.ts'
import type { KindValue, Owner, Residence } from './state.ts'
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

/**
 * All fifteen op types this build folds (`sync-protocol.md` §4), authored
 * through the real builders — never a hand-shaped payload, so the generator
 * cannot drift from the wire format.
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

describe('convergence', () => {
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
    const unknown = PERSON_IDS[1]

    // `trip.entry_added` is in the catalogue (§4.4) but this build does not
    // fold it — the honest shape of "an op type from a newer client". It is
    // hand-shaped precisely because there is no builder for it here; the
    // builders are the types the shipped slices author.
    //
    // **This example has now moved twice**: it was `person.renamed` until S4
    // folded that row, then `trip.created` until S6 folded this whole
    // aggregate's root. The property under test never changes; only the op
    // that can still demonstrate it does, which is the standing price of
    // picking a real catalogue entry over an invented one — and still worth
    // paying, because an invented type would not prove a *newer client's* op
    // survives. S7 will move it again.
    const entryAdded: OpSpec = {
      aggregate: 'trip',
      aggregate_id: unknown,
      type: 'trip.entry_added',
      payload: {
        entry_id: GEAR_IDS[0],
        source: { from: 'depot', gear_id: GEAR_IDS[0] },
      },
    }

    a.emit(personRecorded(known, 'Bran'))
    clock.advance(1000)
    const unfoldable = b.emit(entryAdded)
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
        types: { 'trip.entry_added': 1 },
      })
      expect(r.log()).toHaveLength(2)
      expect(r.state().people[known]?.name?.value).toBe('Bran')
      // An op this build cannot fold creates nothing, in any map. Since S6
      // this is the sharper claim it used to be unable to make: the aggregate
      // the op names now *has* a map here, and `writeTrip` still never runs,
      // because dispatch is a lookup on `type` and an unknown one never
      // reaches a handler at all.
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
})
