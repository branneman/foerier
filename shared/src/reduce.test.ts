import { describe, expect, it } from 'vitest'

import { formatHlc } from './hlc.ts'
import type { Aggregate, OpEnvelope } from './ops.ts'
import { applyOp, emptyState, fold } from './reduce.ts'
import type { Residence } from './state.ts'

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const DEVICE_B = 'bbbbbbbb-0000-7000-8000-000000000002'

const at = (counter: number) => formatHlc({ ms: 1_700_000_000_000, counter })

let nextId = 0
function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

function op(
  aggregate: Aggregate,
  aggregateId: string,
  type: string,
  payload: Record<string, unknown>,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return {
    id: anId(),
    household_id: HOUSEHOLD,
    aggregate,
    aggregate_id: aggregateId,
    type,
    hlc,
    device_id: deviceId,
    payload,
  }
}

function placeOp(
  placeId: string,
  name: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('place', placeId, 'place.recorded', { name }, hlc, deviceId)
}

function placeRenameOp(
  placeId: string,
  name: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('place', placeId, 'place.renamed', { name }, hlc, deviceId)
}

function placeRemoveOp(
  placeId: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('place', placeId, 'place.removed', {}, hlc, deviceId)
}

function personOp(
  personId: string,
  name: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('person', personId, 'person.recorded', { name }, hlc, deviceId)
}

function personRenamedOp(
  personId: string,
  name: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('person', personId, 'person.renamed', { name }, hlc, deviceId)
}

function unknownOp(type: string): OpEnvelope {
  const aggregate = type.split('.')[0] as Aggregate
  return op(aggregate, 'x1', type, {}, at(1))
}

/**
 * `fields` mirrors the wire payload directly (`snake_case`, `owned_count`
 * included) — it is forwarded verbatim, not translated — so a test can
 * exercise "present but only some fields" without going through
 * `authoring.ts`'s stricter, always-complete builder.
 */
function gearRecordedOp(
  gearId: string,
  fields: {
    name?: string
    container?: boolean
    kind?: string
    residence?: Residence
    owner?: Record<string, unknown>
    owned_count?: number
  },
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('gear', gearId, 'gear.recorded', fields, hlc, deviceId)
}

function gearRenamedOp(
  gearId: string,
  name: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('gear', gearId, 'gear.renamed', { name }, hlc, deviceId)
}

function gearRehomedOp(
  gearId: string,
  residence: Residence,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('gear', gearId, 'gear.rehomed', { residence }, hlc, deviceId)
}

function gearKindSetOp(
  gearId: string,
  kind: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('gear', gearId, 'gear.kind_set', { kind }, hlc, deviceId)
}

function gearOwnedCountSetOp(
  gearId: string,
  count: number,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('gear', gearId, 'gear.owned_count_set', { count }, hlc, deviceId)
}

function gearOwnershipSetOp(
  gearId: string,
  owner: Record<string, unknown> | null,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('gear', gearId, 'gear.ownership_set', { owner }, hlc, deviceId)
}

function gearRetiredOp(
  gearId: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('gear', gearId, 'gear.retired', {}, hlc, deviceId)
}

function gearRestoredOp(
  gearId: string,
  hlc: string,
  deviceId = DEVICE,
): OpEnvelope {
  return op('gear', gearId, 'gear.restored', {}, hlc, deviceId)
}

/** Freezes an object graph so any mutation at any depth throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

describe('applyOp', () => {
  it('leaves state identical when a write loses the comparison', () => {
    const seeded = fold([placeOp('p1', 'Attic', at(5))])
    const stale = applyOp(seeded, placeRenameOp('p1', 'Loft', at(2)))
    // Not merely equal — the same object. A late-arriving older op must not
    // invalidate a memo or re-render a list.
    expect(stale).toBe(seeded)
  })

  it('retains an unknown op type without folding it and without rejecting it', () => {
    const state = fold([
      unknownOp('trip.entry_status_set'),
      unknownOp('gear.weighed'),
    ])
    expect(state.unfolded).toEqual({
      count: 2,
      types: { 'trip.entry_status_set': 1, 'gear.weighed': 1 },
    })
    // Ignore is not discard: nothing else moved, and the caller still holds the
    // ops in its log for a later build to fold (sync-protocol §5.3, obligation 1).
    expect(state.places).toEqual({})
    expect(state.gear).toEqual({})
  })

  it('does not mutate the state it is given', () => {
    const before = fold([
      placeOp('p1', 'Attic', at(1)),
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: false, kind: 'single', owned_count: 1 },
        at(1),
      ),
    ])

    // A deep freeze is the real witness. A JSON snapshot only catches a
    // mutation that changes the serialisation, and misses one to a nested
    // register object entirely. Under ES modules — always strict mode — a
    // write to a frozen object throws, so this fails on any mutation at any
    // depth. Purity is not tidiness here: Task 9's convergence tier asserts
    // that `apply` is commutative, associative and idempotent, and an impure
    // reducer would make that tier prove something weaker than it claims.
    deepFreeze(before)

    expect(() =>
      applyOp(before, placeRenameOp('p1', 'Loft', at(2))),
    ).not.toThrow()
    expect(() => applyOp(before, placeRemoveOp('p1', at(3)))).not.toThrow()
    expect(() => applyOp(before, unknownOp('gear.weighed'))).not.toThrow()
    // And a losing write, which takes the early-return path.
    expect(() =>
      applyOp(before, placeRenameOp('p1', 'Stale', at(0))),
    ).not.toThrow()
    expect(() =>
      applyOp(before, gearRecordedOp('g1', { name: 'Tarp v2' }, at(2))),
    ).not.toThrow()
    expect(() =>
      applyOp(before, gearRenamedOp('g1', 'Tarp, blue', at(2))),
    ).not.toThrow()
    expect(() =>
      applyOp(before, gearRehomedOp('g1', { in: 'loose' }, at(2))),
    ).not.toThrow()
    expect(() =>
      applyOp(before, gearKindSetOp('g1', 'counted', at(2))),
    ).not.toThrow()
    expect(() =>
      applyOp(before, gearOwnedCountSetOp('g1', 5, at(2))),
    ).not.toThrow()
    expect(() => applyOp(before, gearRetiredOp('g1', at(2)))).not.toThrow()
    expect(() => applyOp(before, gearRestoredOp('g1', at(3)))).not.toThrow()
    // And a losing gear write too.
    expect(() =>
      applyOp(before, gearRenamedOp('g1', 'Stale', at(0))),
    ).not.toThrow()
    expect(() => applyOp(before, personOp('pe1', 'Bran', at(2)))).not.toThrow()
  })

  it('emptyState has no places, no gear, no people, and nothing unfolded', () => {
    const state = emptyState()
    expect(state.places).toEqual({})
    expect(state.gear).toEqual({})
    expect(state.people).toEqual({})
    expect(state.unfolded).toEqual({ count: 0, types: {} })
  })

  it('place.recorded creates the Place and seeds its name', () => {
    const state = fold([placeOp('p1', 'Attic', at(1))])
    expect(state.places['p1']?.id).toBe('p1')
    expect(state.places['p1']?.name?.value).toBe('Attic')
  })

  it('place.renamed sets the name', () => {
    const state = fold([
      placeOp('p1', 'Attic', at(1)),
      placeRenameOp('p1', 'Loft', at(2)),
    ])
    expect(state.places['p1']?.name?.value).toBe('Loft')
  })

  it('place.renamed on a Place no op has yet created still creates the register', () => {
    const state = fold([placeRenameOp('p1', 'Loft', at(1))])
    expect(state.places['p1']?.id).toBe('p1')
    expect(state.places['p1']?.name?.value).toBe('Loft')
  })

  it('place.removed sets the tombstone', () => {
    const state = fold([
      placeOp('p1', 'Attic', at(1)),
      placeRemoveOp('p1', at(2)),
    ])
    expect(state.places['p1']?.removed?.value).toBe(true)
  })

  it('a rename after a removal leaves the Place removed and renamed', () => {
    const state = fold([
      placeOp('p1', 'Attic', at(1)),
      placeRemoveOp('p1', at(2)),
      placeRenameOp('p1', 'Loft', at(3)),
    ])
    expect(state.places['p1']?.removed?.value).toBe(true)
    expect(state.places['p1']?.name?.value).toBe('Loft')
  })

  it('ignores an unknown payload field and folds the rest', () => {
    const state = fold([
      op(
        'place',
        'p1',
        'place.recorded',
        { name: 'Attic', color: 'red' },
        at(1),
      ),
    ])
    expect(state.places['p1']?.name?.value).toBe('Attic')
  })

  it('ignores a malformed name rather than coercing it', () => {
    const before = emptyState()
    const state = applyOp(
      before,
      op('place', 'p1', 'place.recorded', { name: 42 }, at(1)),
    )
    // Nothing was actually written, so nothing is fabricated either — not
    // even an empty Place — and the identical state comes back.
    expect(state).toBe(before)
    expect(state.places['p1']).toBeUndefined()
  })

  it('folding the whole log onto empty state reproduces the state exactly', () => {
    const ops = [
      placeOp('p1', 'Attic', at(1)),
      placeRenameOp('p1', 'Loft', at(2)),
      placeOp('p2', 'Garage', at(3)),
      placeRemoveOp('p1', at(4)),
    ]
    const fromScratch = fold(ops)
    const snapshot = fold(ops.slice(0, 2))
    const resumed = fold(ops.slice(2), snapshot)
    expect(resumed).toEqual(fromScratch)
  })

  it('fold is order-independent for two ops on different registers', () => {
    const rename = placeRenameOp('p1', 'Loft', at(1))
    const remove = placeRemoveOp('p1', at(2))
    const forward = fold([rename, remove])
    const backward = fold([remove, rename])
    expect(forward).toEqual(backward)
  })

  it('leaves gear retired AND renamed when a retire races a later rename', () => {
    // sync-protocol §3.5: a tombstone is an ordinary LWW field and an edit
    // never touches it, so "delete wins" needs no special rule. Device A
    // retires at hlc 100; device B renames at hlc 200. Both apply.
    const state = fold([
      gearRecordedOp('g1', { name: 'Tarp' }, at(1)),
      gearRetiredOp('g1', at(100)),
      gearRenamedOp('g1', 'Tarp, blue', at(200)),
    ])
    expect(state.gear['g1']?.retired?.value).toBe(true)
    expect(state.gear['g1']?.name?.value).toBe('Tarp, blue')
  })

  it('gear.recorded seeds every present field as its own register', () => {
    // container: false and owned_count: 0 are deliberately chosen, not true
    // and a positive count — a falsy-value check would silently drop both.
    const state = fold([
      gearRecordedOp(
        'g1',
        {
          name: 'Tent',
          container: false,
          kind: 'single',
          residence: { in: 'place', id: 'p1' },
          owner: { type: 'shared' },
          owned_count: 0,
        },
        at(1),
      ),
    ])
    const gear = state.gear['g1']
    expect(gear?.id).toBe('g1')
    expect(gear?.name?.value).toBe('Tent')
    expect(gear?.container?.value).toBe(false)
    expect(gear?.kind?.value).toBe('single')
    expect(gear?.residence?.value).toEqual({ in: 'place', id: 'p1' })
    expect(gear?.owner?.value).toEqual({ type: 'shared' })
    expect(gear?.ownedCount?.value).toBe(0)
  })

  it('gear.recorded leaves an absent optional field absent, not defaulted', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: true, kind: 'single' },
        at(1),
      ),
    ])
    const gear = state.gear['g1']
    // `hasOwn`, not `toBeUndefined`: property access reads an absent key and
    // a key holding `undefined` identically, so `toBeUndefined` would pass
    // even if the reducer had defaulted the field. Absent is not null
    // (sync-protocol §1.3) and this is the assertion that proves it.
    expect(Object.hasOwn(gear!, 'residence')).toBe(false)
    expect(Object.hasOwn(gear!, 'owner')).toBe(false)
    expect(Object.hasOwn(gear!, 'ownedCount')).toBe(false)
  })

  it('gear.recorded stamps every seeded register with the same clock', () => {
    const hlc = at(7)
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tent', container: true, kind: 'single', owned_count: 3 },
        hlc,
      ),
    ])
    const gear = state.gear['g1']
    expect(gear?.name?.hlc).toBe(hlc)
    expect(gear?.name?.deviceId).toBe(DEVICE)
    expect(gear?.container?.hlc).toBe(hlc)
    expect(gear?.container?.deviceId).toBe(DEVICE)
    expect(gear?.kind?.hlc).toBe(hlc)
    expect(gear?.kind?.deviceId).toBe(DEVICE)
    expect(gear?.ownedCount?.hlc).toBe(hlc)
    expect(gear?.ownedCount?.deviceId).toBe(DEVICE)
  })

  it('gear.renamed sets the name', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: false, kind: 'single' },
        at(1),
      ),
      gearRenamedOp('g1', 'Tarp, blue', at(2)),
    ])
    expect(state.gear['g1']?.name?.value).toBe('Tarp, blue')
  })

  it('gear.rehomed sets the home residence and touches nothing else', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: false, kind: 'single' },
        at(1),
      ),
      gearRehomedOp('g1', { in: 'place', id: 'p1' }, at(2)),
    ])
    const gear = state.gear['g1']
    expect(gear?.residence?.value).toEqual({ in: 'place', id: 'p1' })
    expect(gear?.name?.value).toBe('Tarp')
    expect(gear?.kind?.value).toBe('single')
    expect(gear?.container?.value).toBe(false)
  })

  it('gear.kind_set replaces the kind, one register and one value', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Stove', container: false, kind: 'single' },
        at(1),
      ),
      gearKindSetOp('g1', 'counted', at(2)),
    ])
    expect(state.gear['g1']?.kind?.value).toBe('counted')
  })

  it('gear.kind_set stores an unrecognised kind verbatim', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Stove', container: false, kind: 'single' },
        at(1),
      ),
      gearKindSetOp('g1', 'weighed', at(2)),
    ])
    expect(state.gear['g1']?.kind?.value).toBe('weighed')
  })

  it('gear.owned_count_set sets the count absolutely, not by delta', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Mug', container: false, kind: 'counted', owned_count: 4 },
        at(1),
      ),
      gearOwnedCountSetOp('g1', 2, at(2)),
    ])
    expect(state.gear['g1']?.ownedCount?.value).toBe(2)
  })

  it('gear.owned_count_set applied twice with the same op is idempotent', () => {
    const setOp = gearOwnedCountSetOp('g1', 3, at(2))
    const once = fold([
      gearRecordedOp(
        'g1',
        { name: 'Mug', container: false, kind: 'counted' },
        at(1),
      ),
      setOp,
    ])
    const twice = applyOp(once, setOp)
    expect(twice).toBe(once)
    expect(twice.gear['g1']?.ownedCount?.value).toBe(3)
  })

  it('gear.ownership_set sets a personal owner', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Down jacket', container: false, kind: 'single' },
        at(1),
      ),
      gearOwnershipSetOp('g1', { type: 'person', person_id: 'pe1' }, at(2)),
    ])
    expect(state.gear['g1']?.owner?.value).toEqual({
      type: 'person',
      personId: 'pe1',
    })
  })

  it('gear.ownership_set sets shared back over a personal owner', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Down jacket', container: false, kind: 'single' },
        at(1),
      ),
      gearOwnershipSetOp('g1', { type: 'person', person_id: 'pe1' }, at(2)),
      gearOwnershipSetOp('g1', { type: 'shared' }, at(3)),
    ])
    // One register, one value — the domain's "personal to one person, *or*
    // shared" is structural, so returning gear to the pool needs no clear.
    expect(state.gear['g1']?.owner?.value).toEqual({ type: 'shared' })
  })

  it('gear.ownership_set ignores a malformed owner and returns the identical state', () => {
    const before = fold([
      gearRecordedOp(
        'g1',
        { name: 'Down jacket', container: false, kind: 'single' },
        at(1),
      ),
    ])
    const after = fold(
      [
        gearOwnershipSetOp('g1', { type: 'nonsense' }, at(2)),
        gearOwnershipSetOp('g1', { type: 'person' }, at(3)),
        gearOwnershipSetOp('g1', null, at(4)),
        op('gear', 'g1', 'gear.ownership_set', {}, at(5)),
      ],
      before,
    )
    expect(after).toBe(before)
  })

  it('gear.ownership_set returns the identical state when its write loses', () => {
    const seeded = fold([
      gearRecordedOp(
        'g1',
        { name: 'Down jacket', container: false, kind: 'single' },
        at(1),
      ),
      gearOwnershipSetOp('g1', { type: 'person', person_id: 'late' }, at(9)),
    ])
    const after = applyOp(
      seeded,
      gearOwnershipSetOp('g1', { type: 'person', person_id: 'early' }, at(5)),
    )
    expect(after).toBe(seeded)
  })

  it('gear.ownership_set never touches the tombstone', () => {
    // An edit never writes `retired` (§3.5), so re-owning retired gear leaves
    // it retired — the same property the rename and rehome tests pin.
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Down jacket', container: false, kind: 'single' },
        at(1),
      ),
      gearRetiredOp('g1', at(2)),
      gearOwnershipSetOp('g1', { type: 'person', person_id: 'pe1' }, at(3)),
    ])
    expect(state.gear['g1']?.retired?.value).toBe(true)
    expect(state.gear['g1']?.owner?.value).toEqual({
      type: 'person',
      personId: 'pe1',
    })
  })

  it('gear.retired sets the tombstone', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: false, kind: 'single' },
        at(1),
      ),
      gearRetiredOp('g1', at(2)),
    ])
    expect(state.gear['g1']?.retired?.value).toBe(true)
  })

  it('gear.restored clears the tombstone when strictly later', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: false, kind: 'single' },
        at(1),
      ),
      gearRetiredOp('g1', at(2)),
      gearRestoredOp('g1', at(3)),
    ])
    expect(state.gear['g1']?.retired?.value).toBe(false)
  })

  it('gear.restored earlier than the retirement leaves it retired', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: false, kind: 'single' },
        at(1),
      ),
      gearRetiredOp('g1', at(5)),
      gearRestoredOp('g1', at(3)),
    ])
    expect(state.gear['g1']?.retired?.value).toBe(true)
  })

  it('two concurrent rehomes resolve by plain LWW on (hlc, deviceId)', () => {
    // Same hlc on both — the tie is broken purely by device_id (§3.2), not
    // by which op happens to apply first.
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: false, kind: 'single' },
        at(1),
      ),
      gearRehomedOp('g1', { in: 'place', id: 'p1' }, at(2), DEVICE),
      gearRehomedOp('g1', { in: 'place', id: 'p2' }, at(2), DEVICE_B),
    ])
    expect(state.gear['g1']?.residence?.value).toEqual({
      in: 'place',
      id: 'p2',
    })
  })

  it('the containment trait has no mutation op, so a later gear.recorded cannot flip it', () => {
    // There is no dedicated op for `container`; a second `gear.recorded` for
    // the same id is an ordinary LWW write on each register it carries,
    // `container` included. This asserts that behaviour, not a guard against
    // it — the domain says there is nothing to guard.
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Crate', container: true, kind: 'single' },
        at(1),
      ),
      gearRecordedOp(
        'g1',
        { name: 'Crate', container: false, kind: 'single' },
        at(2),
      ),
    ])
    expect(state.gear['g1']?.container?.value).toBe(false)
  })

  it('person.recorded creates the Person and seeds the name', () => {
    const state = fold([personOp('pe1', 'Bran', at(1))])
    expect(state.people['pe1']?.id).toBe('pe1')
    expect(state.people['pe1']?.name?.value).toBe('Bran')
  })

  it('person.recorded is idempotent under replay', () => {
    const recordOp = personOp('pe1', 'Bran', at(1))
    const once = fold([recordOp])
    const twice = applyOp(once, recordOp)
    // Identity, not just equality: a replayed op must be a no-op at O(1), the
    // same guarantee `writeRegister`'s losing-write path gives every other
    // handler.
    expect(twice).toBe(once)
    expect(twice.people['pe1']?.name?.value).toBe('Bran')
  })

  it('person.renamed sets the name', () => {
    const state = fold([
      personOp('pe1', 'Els', at(1)),
      personRenamedOp('pe1', 'Elsje', at(2)),
    ])
    expect(state.people['pe1']?.name?.value).toBe('Elsje')
  })

  it('person.renamed creates the Person when it arrives out of authoring order', () => {
    // Same property `place.renamed` has: `writePerson` creates the entity
    // either way (§8.2), so a rename that overtakes its `recorded` is not a
    // dropped write.
    const state = fold([personRenamedOp('pe1', 'Els', at(2))])
    expect(state.people['pe1']?.id).toBe('pe1')
    expect(state.people['pe1']?.name?.value).toBe('Els')
  })

  it('person.renamed returns the identical state when its write loses', () => {
    const seeded = fold([
      personOp('pe1', 'Els', at(1)),
      personRenamedOp('pe1', 'Late', at(9)),
    ])
    const after = applyOp(seeded, personRenamedOp('pe1', 'Early', at(5)))
    expect(after).toBe(seeded)
  })
})

/**
 * The rule (`sync-protocol.md` §1.3, and the ruling that corrected
 * `setPlaceName` — §5.3 obligation 5 is not this rule's authority; it only
 * states the absent-as-clear direction, not this one): a register whose
 * declared type includes `null` — `PlaceState.name`, `GearState.name`,
 * `PersonState.name`, all `Register<string | null>` — takes an explicit
 * `null` as a clear; an absent field leaves it alone. Every op that writes
 * one of these three registers is exercised here, paired: the `null` case
 * proves the clear with `toBeNull()`. Three of the four omission cases prove
 * the register was never created at all, with `Object.hasOwn` — but folded
 * against an entity with no prior name, "leaves it alone" is trivially true
 * of *both* absent and null, so on its own that pairing cannot show which
 * direction is under test. `gear.renamed`'s omission case seeds a name
 * first and asserts it survives untouched, which is the direction §1.3
 * actually forbids: treating an absent field as if it were an explicit
 * clear.
 */
describe('name registers: an explicit null clears, an absent field leaves it alone', () => {
  it('place.renamed with an explicit null clears the name', () => {
    const state = fold([
      placeOp('p1', 'Attic', at(1)),
      op('place', 'p1', 'place.renamed', { name: null }, at(2)),
    ])
    expect(state.places['p1']?.name?.value).toBeNull()
  })

  it('place.renamed with name omitted never creates the register', () => {
    // No prior op wrote anything for this Place either, so this is not just
    // an absent `name` key — the identity-preserving no-op path
    // (`writePlace`) never fabricates the entity at all. `?? {}` makes the
    // assertion correct either way, matching the fixture's own pattern for
    // this exact contrast (obligation 5).
    const state = fold([op('place', 'p1', 'place.renamed', {}, at(1))])
    expect(Object.hasOwn(state.places['p1'] ?? {}, 'name')).toBe(false)
  })

  it('gear.recorded with an explicit null seeds the name register as null', () => {
    const state = fold([
      op(
        'gear',
        'g1',
        'gear.recorded',
        { name: null, container: false, kind: 'single' },
        at(1),
      ),
    ])
    expect(state.gear['g1']?.name?.value).toBeNull()
  })

  it('gear.recorded with name omitted never creates the register', () => {
    const state = fold([
      op(
        'gear',
        'g1',
        'gear.recorded',
        { container: false, kind: 'single' },
        at(1),
      ),
    ])
    expect(state.gear['g1']?.id).toBe('g1')
    expect(Object.hasOwn(state.gear['g1']!, 'name')).toBe(false)
  })

  it('gear.renamed with an explicit null clears the name', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: false, kind: 'single' },
        at(1),
      ),
      op('gear', 'g1', 'gear.renamed', { name: null }, at(2)),
    ])
    expect(state.gear['g1']?.name?.value).toBeNull()
  })

  it('gear.renamed with name omitted leaves an existing name untouched', () => {
    // Unlike the other three omission cases, this one seeds a name first
    // (via `gear.recorded`) before applying the empty `gear.renamed`. The
    // other three fold against an entity with no prior name, where "leaves
    // it alone" is trivially true of an absent field *or* a coerced clear —
    // they cannot tell the two apart. This one can: if omission were ever
    // treated as a clear, `name` would come back `null` or absent here
    // instead of the seeded value.
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: false, kind: 'single' },
        at(1),
      ),
      op('gear', 'g1', 'gear.renamed', {}, at(2)),
    ])
    expect(state.gear['g1']?.name?.value).toBe('Tarp')
  })

  it('person.recorded with an explicit null seeds the name register as null', () => {
    const state = fold([
      op('person', 'pe1', 'person.recorded', { name: null }, at(1)),
    ])
    expect(state.people['pe1']?.name?.value).toBeNull()
  })

  it('person.recorded with name omitted never creates the register', () => {
    const state = fold([op('person', 'pe1', 'person.recorded', {}, at(1))])
    expect(Object.hasOwn(state.people['pe1'] ?? {}, 'name')).toBe(false)
  })

  it('person.renamed with an explicit null clears the name', () => {
    // §4.2 typed this row `{name}` and deferred the question to the slice
    // that folds it. S4 is that slice, and this is the answer: the same rule
    // as the four other name registers, with no carve-out.
    const state = fold([
      personOp('pe1', 'Els', at(1)),
      op('person', 'pe1', 'person.renamed', { name: null }, at(2)),
    ])
    expect(state.people['pe1']?.name?.value).toBeNull()
  })

  it('person.renamed with name omitted leaves an existing name untouched', () => {
    // The direction §1.3 actually forbids, and the one `gear.renamed`'s own
    // omission case exists to pin: a seeded name, then an empty payload.
    const before = fold([personOp('pe1', 'Els', at(1))])
    const after = applyOp(
      before,
      op('person', 'pe1', 'person.renamed', {}, at(2)),
    )
    expect(after).toBe(before)
    expect(after.people['pe1']?.name?.value).toBe('Els')
  })

  // The non-nullable registers stay exactly as they were: `residence`'s type
  // has no `null` member, so a `null` payload is malformed input, not a
  // clear, and is ignored the same as an absent field (`writeIfPresent`,
  // unchanged by this ruling).
  it('gear.rehomed with an explicit null residence is ignored, not a clear', () => {
    const state = fold([
      gearRecordedOp(
        'g1',
        { name: 'Tarp', container: false, kind: 'single' },
        at(1),
      ),
      op('gear', 'g1', 'gear.rehomed', { residence: null }, at(2)),
    ])
    expect(Object.hasOwn(state.gear['g1']!, 'residence')).toBe(false)
  })
})

/**
 * `sync-protocol.md` §3.4: tags are **not** a single register holding an
 * array — that would make two quartermasters tagging concurrently clobber
 * each other. Each member is its own register, keyed
 * `(gear_id, "tags", <tag string>)`, and `gear.tag_applied` /
 * `gear.tag_removed` are an ordinary LWW pair on it.
 */
describe('gear tags', () => {
  const GEAR = 'gear-tags'

  const tagOp = (
    type: 'gear.tag_applied' | 'gear.tag_removed',
    tag: unknown,
    hlc: string,
    deviceId = DEVICE,
  ) => op('gear', GEAR, type, { tag }, hlc, deviceId)

  it('sets a per-tag register to present', () => {
    const state = fold([tagOp('gear.tag_applied', 'winter', at(1))])
    expect(state.gear[GEAR]?.tags?.['winter']?.value).toBe(true)
  })

  it('sets the register to absent rather than deleting the key', () => {
    const state = fold([
      tagOp('gear.tag_applied', 'winter', at(1)),
      tagOp('gear.tag_removed', 'winter', at(2)),
    ])
    // The key survives: a removal is a write carrying a clock, and discarding
    // it would let a concurrent re-apply win by arrival order instead of on
    // its own stamp.
    expect(Object.hasOwn(state.gear[GEAR]?.tags ?? {}, 'winter')).toBe(true)
    expect(state.gear[GEAR]?.tags?.['winter']?.value).toBe(false)
  })

  it('keeps two tags as two independent registers', () => {
    const state = fold([
      tagOp('gear.tag_applied', 'winter', at(1)),
      tagOp('gear.tag_applied', 'sleep', at(2)),
      tagOp('gear.tag_removed', 'winter', at(3)),
    ])
    expect(state.gear[GEAR]?.tags?.['winter']?.value).toBe(false)
    expect(state.gear[GEAR]?.tags?.['sleep']?.value).toBe(true)
  })

  it('lets an older op arriving late lose, whichever order it folds in', () => {
    const forwards = fold([
      tagOp('gear.tag_removed', 'winter', at(1)),
      tagOp('gear.tag_applied', 'winter', at(2)),
    ])
    const backwards = fold([
      tagOp('gear.tag_applied', 'winter', at(2)),
      tagOp('gear.tag_removed', 'winter', at(1)),
    ])
    expect(forwards.gear[GEAR]?.tags?.['winter']?.value).toBe(true)
    expect(backwards.gear[GEAR]?.tags?.['winter']?.value).toBe(true)
  })

  it('breaks an identical-clock tie by device id', () => {
    const state = fold([
      tagOp('gear.tag_applied', 'winter', at(1), DEVICE),
      tagOp('gear.tag_removed', 'winter', at(1), DEVICE_B),
    ])
    // DEVICE_B sorts after DEVICE by id, so the removal wins.
    expect(state.gear[GEAR]?.tags?.['winter']?.value).toBe(false)
  })

  it('creates the gear from a tag op alone, out of authoring order', () => {
    const state = fold([tagOp('gear.tag_applied', 'winter', at(1))])
    expect(state.gear[GEAR]?.id).toBe(GEAR)
  })

  /**
   * §5's tolerant-reader discipline **outranks** §4.3's `TagString` rule. An
   * installed PWA may hold ops queued offline against an earlier
   * normalisation, and rejecting them would discard a Quartermaster's work to
   * enforce a cosmetic rule. So the register key is the literal string that
   * arrived — never normalised, never rejected, never dropped.
   *
   * These payloads are hand-shaped precisely because `authoring.ts` cannot
   * produce them: `gearTagApplied` takes a `TagString`. This test stands in
   * for a different build, and correctly cannot reach our builders.
   */
  it('folds a non-conforming tag exactly as received', () => {
    const long = 'a'.repeat(200)
    const state = fold([
      tagOp('gear.tag_applied', 'WINTER', at(1)),
      tagOp('gear.tag_applied', 'cook set', at(2)),
      tagOp('gear.tag_applied', '#winter', at(3)),
      tagOp('gear.tag_applied', long, at(4)),
    ])
    const tags = state.gear[GEAR]?.tags ?? {}
    expect(Object.keys(tags).sort()).toEqual(
      ['WINTER', 'cook set', '#winter', long].sort(),
    )
  })

  it('treats two spellings of one intent as two registers', () => {
    const state = fold([
      tagOp('gear.tag_applied', 'cooking', at(1)),
      tagOp('gear.tag_applied', 'Cooking', at(2)),
    ])
    expect(state.gear[GEAR]?.tags?.['cooking']?.value).toBe(true)
    expect(state.gear[GEAR]?.tags?.['Cooking']?.value).toBe(true)
  })

  it('ignores an op whose tag is absent or not a string', () => {
    const before = fold([tagOp('gear.tag_applied', 'winter', at(1))])
    const after = fold(
      [
        op('gear', GEAR, 'gear.tag_applied', {}, at(2)),
        tagOp('gear.tag_applied', 42, at(3)),
        tagOp('gear.tag_applied', null, at(4)),
      ],
      before,
    )
    expect(after).toBe(before)
  })

  it('returns the identical state object when a write loses', () => {
    const before = fold([tagOp('gear.tag_applied', 'winter', at(5))])
    const after = applyOp(before, tagOp('gear.tag_removed', 'winter', at(2)))
    // Identity, not equality: a lost write must not invalidate a memo
    // downstream — the same contract `writeRegister` carries.
    expect(after).toBe(before)
  })

  it('leaves tags absent on gear no tag op has ever addressed', () => {
    const state = fold([
      op('gear', 'untagged', 'gear.recorded', { name: 'Tent' }, at(1)),
    ])
    expect(Object.hasOwn(state.gear['untagged'] ?? {}, 'tags')).toBe(false)
  })
})
