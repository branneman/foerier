import { describe, expect, it } from 'vitest'

import { aGear, anOp, aPerson, aTrip, hlcAt } from '../../testUtils/index.ts'
import {
  type OpSpec,
  tripContainerStageSet,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripEntryRemoved,
  tripEntryStatusSet,
  tripParticipantAdded,
  tripPieceMoved,
  tripPieceRemoved,
  tripPieceRestored,
  tripPieceStatusSet,
} from '../authoring.ts'
import type { OpEnvelope } from '../ops.ts'
import { fold } from '../reduce.ts'
import type { DepotState, TripState } from '../state.ts'
import {
  entriesOf,
  isContainerEntry,
  listTotals,
  pieceCountOf,
} from './entry.ts'
import {
  containerTotals,
  countOf,
  countsAsDisagreement,
  disagreements,
  entryResidenceOf,
  isPacked,
  type PackingItem,
  packingItems,
  packingTotals,
  personPartition,
  ridesAlongCount,
  STATUSES,
  subtreeOf,
} from './packing.ts'
import { participantIds } from './trip.ts'
import { tripContainmentView } from './tripContainment.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

const TRIP = 't-alps'

/**
 * Ids sort `MARK · KIM · ANA · ELS`; the names sort `Ana · Els · Kim · Mark`.
 * The two orders are deliberately different, so a partition returned in *id*
 * order cannot pass a test that a partition returned in *label* order would
 * also pass.
 */
const MARK = 'p-1-mark'
const KIM = 'p-2-kim'
const ANA = 'p-3-ana'
const ELS = 'p-4-els'

// Containers. `entriesOf` sorts by label, so the names fix the order every
// list-shaped assertion below reads against.
const BIN = 'e-bin' // trip-only container · `staging` · one unpacked item
const BOX = 'e-box' // container · `car` · everything inside it packed
const CRATE = 'e-crate' // container · `car` · disagreeing at depth 1
const DUFFEL = 'e-duffel' // container · `packed` · disagreeing at depth 2
const SACK = 'e-sack' // container inside the duffel · `home`
const TOTE = 'e-tote' // container added and then removed — a dangling pointer

// The things that travel.
const FLAGS = 'e-flags' // trip-only single, in the bin, not packed
const HEADLAMP = 'e-lamp' // per-person, three Participants, Kim's Piece removed
const JACKET = 'e-jacket' // owned by ELS, who is **not** a Participant
const MAP = 'e-map' // owned by MARK, in the stuff sack, not packed
const MUG = 'e-mug' // shared, in the box, packed
const PAN = 'e-pan' // shared, in the crate, packed
const POT = 'e-pot' // shared, in the stuff sack, packed
const ROPE = 'e-rope' // shared, in the crate, explicitly not packed
const STOVE = 'e-stove' // counted ×3, in the crate, **no** status register
const TARP = 'e-tarp' // shared, in the crate, staged
const UNSYNCED = 'e-unsynced' // depot Entry whose Gear has never arrived
const ORPHANED = 'e-ghost' // sourceless — `entriesOf` already excludes it

/**
 * One Trip, holding every branch the four counts have to agree about: a
 * Counted Entry with a Bring-count of 3, a per-person Entry with one of three
 * Pieces removed, a Single owned by a **non-Participant**, a Single owned by a
 * Participant, three Shared Singles, a trip-only Single, a depot Entry whose
 * **Gear has never reached this replica**, a sourceless Entry, a container in
 * `car` with unpacked contents, a container in `car` with none, a trip-only
 * container in `staging`, and a container in `packed` whose only unpacked
 * content sits **two levels down**.
 *
 * Several registers are left absent on purpose — the Stove's and the Map's
 * `status`, the stuff sack's `stage`, Ana's Piece `status` — so the absent
 * reads `packing.ts` states once are exercised by the fixture rather than
 * asserted about in isolation.
 */
const BASE_SPECS: readonly OpSpec[] = [
  ...aTrip({
    id: TRIP,
    name: 'Alps 2026',
    phase: 'pack_out',
    participants: [MARK, KIM, ANA],
  }),
  ...aPerson({ id: MARK, name: 'Mark' }),
  ...aPerson({ id: KIM, name: 'Kim' }),
  ...aPerson({ id: ANA, name: 'Ana' }),
  ...aPerson({ id: ELS, name: 'Els' }),

  // ── Containers ────────────────────────────────────────────────────────────
  ...aGear({ id: 'g-box', name: 'Box', container: true }),
  tripEntryAdded(TRIP, BOX, { from: 'depot', gearId: 'g-box' }),
  tripContainerStageSet(TRIP, BOX, 'car'),

  ...aGear({ id: 'g-crate', name: 'Crate B', container: true }),
  tripEntryAdded(TRIP, CRATE, { from: 'depot', gearId: 'g-crate' }),
  tripContainerStageSet(TRIP, CRATE, 'car'),

  ...aGear({ id: 'g-duffel', name: 'Duffel 90 L', container: true }),
  tripEntryAdded(TRIP, DUFFEL, { from: 'depot', gearId: 'g-duffel' }),
  tripContainerStageSet(TRIP, DUFFEL, 'packed'),

  ...aGear({ id: 'g-sack', name: 'Stuff sack', container: true }),
  tripEntryAdded(TRIP, SACK, { from: 'depot', gearId: 'g-sack' }),
  tripEntryMoved(TRIP, SACK, { in: 'container', entryId: DUFFEL }),
  // No `trip.container_stage_set`: an absent `stage` reads `home`.

  tripEntryAdded(TRIP, BIN, {
    from: 'trip_only',
    name: 'Ammo bin',
    container: true,
  }),
  tripContainerStageSet(TRIP, BIN, 'staging'),

  // ── Things that travel ────────────────────────────────────────────────────
  ...aGear({ id: 'g-stove', name: 'Stove', kind: 'counted' }),
  tripEntryAdded(TRIP, STOVE, { from: 'depot', gearId: 'g-stove' }),
  tripEntryBringCountSet(TRIP, STOVE, 3),
  tripEntryMoved(TRIP, STOVE, { in: 'container', entryId: CRATE }),
  // No `trip.entry_status_set`: an absent `status` reads `not_packed`.

  ...aGear({ id: 'g-rope', name: 'Rope' }),
  tripEntryAdded(TRIP, ROPE, { from: 'depot', gearId: 'g-rope' }),
  tripEntryMoved(TRIP, ROPE, { in: 'container', entryId: CRATE }),
  tripEntryStatusSet(TRIP, ROPE, 'not_packed'),

  ...aGear({ id: 'g-tarp', name: 'Tarp' }),
  tripEntryAdded(TRIP, TARP, { from: 'depot', gearId: 'g-tarp' }),
  tripEntryMoved(TRIP, TARP, { in: 'container', entryId: CRATE }),
  tripEntryStatusSet(TRIP, TARP, 'staged'),

  ...aGear({ id: 'g-pan', name: 'Pan' }),
  tripEntryAdded(TRIP, PAN, { from: 'depot', gearId: 'g-pan' }),
  tripEntryMoved(TRIP, PAN, { in: 'container', entryId: CRATE }),
  tripEntryStatusSet(TRIP, PAN, 'packed'),

  ...aGear({ id: 'g-mug', name: 'Mug' }),
  tripEntryAdded(TRIP, MUG, { from: 'depot', gearId: 'g-mug' }),
  tripEntryMoved(TRIP, MUG, { in: 'container', entryId: BOX }),
  tripEntryStatusSet(TRIP, MUG, 'packed'),

  ...aGear({ id: 'g-pot', name: 'Pot' }),
  tripEntryAdded(TRIP, POT, { from: 'depot', gearId: 'g-pot' }),
  tripEntryMoved(TRIP, POT, { in: 'container', entryId: SACK }),
  tripEntryStatusSet(TRIP, POT, 'packed'),

  ...aGear({
    id: 'g-map',
    name: 'Map',
    owner: { type: 'person', personId: MARK },
  }),
  tripEntryAdded(TRIP, MAP, { from: 'depot', gearId: 'g-map' }),
  tripEntryMoved(TRIP, MAP, { in: 'container', entryId: SACK }),

  ...aGear({
    id: 'g-jacket',
    name: 'Jacket',
    owner: { type: 'person', personId: ELS },
  }),
  tripEntryAdded(TRIP, JACKET, { from: 'depot', gearId: 'g-jacket' }),
  tripEntryMoved(TRIP, JACKET, { in: 'container', entryId: DUFFEL }),
  tripEntryStatusSet(TRIP, JACKET, 'packed'),

  tripEntryAdded(TRIP, FLAGS, {
    from: 'trip_only',
    name: 'Flagging tape',
    container: false,
  }),
  tripEntryMoved(TRIP, FLAGS, { in: 'container', entryId: BIN }),

  // A depot Entry naming Gear that never lands: `entryKind` reads
  // `undefined`, `pieceCountOf` defaults it to one, and `personPartition` has
  // no owner register to read — its documented rule-3 clause.
  tripEntryAdded(TRIP, UNSYNCED, { from: 'depot', gearId: 'g-not-here' }),

  ...aGear({ id: 'g-lamp', name: 'Headlamp', kind: 'per_person' }),
  tripEntryAdded(TRIP, HEADLAMP, { from: 'depot', gearId: 'g-lamp' }),
  tripPieceRemoved(TRIP, HEADLAMP, KIM),
  tripPieceStatusSet(TRIP, HEADLAMP, MARK, 'packed'),
  // Ana's Piece carries no `status` register at all.

  // `trip.entry_bring_count_set` creates the Entry on sight, so a sourceless
  // Entry is reachable without a malformed op.
  tripEntryBringCountSet(TRIP, ORPHANED, 2),
]

/** Stamps each spec with its own increasing clock, in authoring order. */
function log(specs: readonly OpSpec[], from = 0): OpEnvelope[] {
  return specs.map((spec, index) =>
    anOp(spec, { hlc: hlcAt(from + index + 1), deviceId: DEV_A }),
  )
}

const BASE = fold(log(BASE_SPECS))

/** The fixture, plus ops stamped strictly after every one of its own. */
function withLater(...specs: readonly OpSpec[]): DepotState {
  return fold(log(specs, BASE_SPECS.length), BASE)
}

function tripOf(state: DepotState): TripState {
  const trip = state.trips[TRIP]
  if (trip === undefined) throw new Error(`the fold holds no Trip ${TRIP}`)
  return trip
}

const TRIP_STATE = tripOf(BASE)

function itemsIn(state: DepotState): readonly PackingItem[] {
  return packingItems(tripOf(state), state)
}

function itemsFor(
  entryId: string,
  state: DepotState = BASE,
): readonly PackingItem[] {
  return itemsIn(state).filter((item) => item.entryId === entryId)
}

type PieceItem = Extract<PackingItem, { kind: 'piece' }>

function isPieceItem(item: PackingItem): item is PieceItem {
  return item.kind === 'piece'
}

function piecesFor(
  entryId: string,
  state: DepotState = BASE,
): readonly PieceItem[] {
  return itemsFor(entryId, state).filter(isPieceItem)
}

function totalsIn(state: DepotState = BASE) {
  return packingTotals(tripOf(state), state)
}

function groupTotals(entryId: string, state: DepotState = BASE) {
  return containerTotals(tripOf(state), state, entryId)
}

function bucketsIn(state: DepotState = BASE) {
  return personPartition(tripOf(state), state)
}

function bucketFor(personId: string, state: DepotState = BASE) {
  const bucket = bucketsIn(state).find(
    (candidate) =>
      candidate.key.kind === 'person' && candidate.key.personId === personId,
  )
  if (bucket === undefined) throw new Error(`no bucket for ${personId}`)
  return bucket
}

function disagreementsIn(state: DepotState = BASE) {
  return disagreements(tripOf(state), state)
}

function entryOf(entryId: string, state: DepotState = BASE) {
  const entry = tripOf(state).entries?.[entryId]
  if (entry === undefined) throw new Error(`the fold holds no Entry ${entryId}`)
  return entry
}

describe('entryResidenceOf is the third reader gate (§5e C0)', () => {
  it('answers null for a per-person Entry even when a residence was folded', () => {
    // The tolerant reader's own case: a peer on another build may write
    // `trip.entry_moved` for a per-person Entry, the reducer folds it, and no
    // reader consults it for this Kind. `bringCountOf` on non-Counted gear and
    // `statusOf` on a container are the same shape.
    const state = withLater(
      tripEntryMoved(TRIP, HEADLAMP, { in: 'container', entryId: CRATE }),
    )

    expect(entryOf(HEADLAMP, state).residence?.value).toEqual({
      in: 'container',
      entryId: CRATE,
    })
    expect(entryResidenceOf(entryOf(HEADLAMP, state), state)).toBeNull()
  })

  it('answers the register for every other Kind, and loose when absent', () => {
    expect(entryResidenceOf(entryOf(POT), BASE)).toEqual({
      in: 'container',
      entryId: SACK,
    })
    // A Counted Entry, a trip-only one and a container are all readable.
    expect(entryResidenceOf(entryOf(STOVE), BASE)).toEqual({
      in: 'container',
      entryId: CRATE,
    })
    expect(entryResidenceOf(entryOf(FLAGS), BASE)).toEqual({
      in: 'container',
      entryId: BIN,
    })
    expect(entryResidenceOf(entryOf(SACK), BASE)).toEqual({
      in: 'container',
      entryId: DUFFEL,
    })
    // Absent reads loose — the fourth of this file's absent-reads rules.
    expect(entryOf(UNSYNCED).residence).toBeUndefined()
    expect(entryResidenceOf(entryOf(UNSYNCED), BASE)).toEqual({ in: 'loose' })
  })

  it('reads a depot Entry whose Gear has not arrived, rather than gating it', () => {
    // `entryKind` answers `undefined` for the ordinary cross-aggregate race,
    // and the gate is on `per_person` specifically — the conservative
    // direction `isContainerEntry` and `pieceCountOf` already take.
    expect(BASE.gear['g-not-here']).toBeUndefined()
    expect(entryResidenceOf(entryOf(UNSYNCED), BASE)).not.toBeNull()
  })
})

describe('packingItems is the spine', () => {
  it('gives a Counted Entry one item carrying its whole Bring-count', () => {
    const items = itemsFor(STOVE)

    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('entry')
    expect(items[0]?.units).toBe(3)
    // No status register at all — the absent read, exercised by the fixture.
    expect(items[0]?.status).toBe('not_packed')
  })

  it('gives a Single, a trip-only Entry and an unsynced Gear one unit each', () => {
    expect(itemsFor(ROPE).map((item) => item.units)).toEqual([1])
    expect(itemsFor(FLAGS).map((item) => item.units)).toEqual([1])
    // `entryKind` reads `undefined` for a depot Entry whose Gear has not
    // reached this replica — the ordinary cross-aggregate race, defaulted to
    // one exactly as an unrecognised Kind is.
    expect(itemsFor(UNSYNCED).map((item) => item.units)).toEqual([1])
    expect(BASE.gear['g-not-here']).toBeUndefined()
  })

  it('gives a per-person Entry with no included Pieces no item at all', () => {
    // Every Piece tombstoned. This matches `pieceCountOf`'s per-person row,
    // which is `piecesOf(...).length` and so is zero here too.
    const state = withLater(
      tripPieceRemoved(TRIP, HEADLAMP, MARK),
      tripPieceRemoved(TRIP, HEADLAMP, ANA),
    )
    const entry = tripOf(state).entries?.[HEADLAMP]
    if (entry === undefined) throw new Error('the fold holds no Headlamp')

    expect(itemsFor(HEADLAMP, state)).toEqual([])
    expect(pieceCountOf(entry, tripOf(state), state)).toBe(0)
    expect(totalsIn(state)).toEqual({ packed: 4, total: 12, left: 8 })
  })

  it('gives a per-person Entry on a Trip with no Participants no item at all', () => {
    const ops = log([
      ...aTrip({ id: 't-solo', name: 'Nobody' }),
      ...aGear({ id: 'g-solo-lamp', name: 'Headlamp', kind: 'per_person' }),
      tripEntryAdded('t-solo', 'e-solo-lamp', {
        from: 'depot',
        gearId: 'g-solo-lamp',
      }),
    ])
    const state = fold(ops)
    const trip = state.trips['t-solo']
    if (trip === undefined) throw new Error('the fold holds no Trip t-solo')

    expect(packingItems(trip, state)).toEqual([])
    expect(packingTotals(trip, state)).toEqual({
      packed: 0,
      total: 0,
      left: 0,
    })
  })

  it('gives a per-person Entry one item per INCLUDED Piece', () => {
    // Three Participants, Kim's Piece tombstoned: two items, one unit each.
    const pieces = piecesFor(HEADLAMP)

    expect(pieces).toHaveLength(2)
    expect(pieces.every((piece) => piece.units === 1)).toBe(true)
    expect(pieces.map((piece) => piece.personId)).not.toContain(KIM)
    expect(pieces.map((piece) => piece.personId)).toEqual([MARK, ANA])
    // Mark's Piece was set; Ana's carries no register and reads `not_packed`.
    expect(pieces.map((piece) => piece.status)).toEqual([
      'packed',
      'not_packed',
    ])
  })

  it('gives a container no item at all — depot or trip-only', () => {
    for (const container of [BOX, CRATE, DUFFEL, SACK, BIN]) {
      expect(itemsFor(container)).toEqual([])
    }
  })

  it('gives a sourceless Entry no item — entriesOf already excludes it', () => {
    expect(TRIP_STATE.entries?.[ORPHANED]?.source).toBeUndefined()
    expect(itemsFor(ORPHANED)).toEqual([])
  })

  it('gives a removed Entry no item', () => {
    expect(itemsFor(ROPE)).toHaveLength(1)
    expect(itemsFor(ROPE, withLater(tripEntryRemoved(TRIP, ROPE)))).toEqual([])
  })

  it('carries the Entry residence on a whole-Entry item', () => {
    expect(itemsFor(POT)[0]?.residence).toEqual({
      in: 'container',
      entryId: SACK,
    })
    expect(itemsFor(HEADLAMP)[0]?.residence).toEqual({ in: 'loose' })
  })

  it('reads a Piece with no residence as loose, never its Entry’s (§5e C0)', () => {
    // Asserted against an Entry that **has** a residence, so S9a's layered
    // read — absent Piece reads its Entry's, then loose — fails this rather
    // than passing it by coincidence. For per-person gear *where it is* is
    // only ever a per-Piece fact, so there is nothing above the Pieces to
    // fall back to.
    const state = withLater(
      tripEntryMoved(TRIP, HEADLAMP, { in: 'container', entryId: CRATE }),
    )

    const pieces = piecesFor(HEADLAMP, state)
    expect(pieces).toHaveLength(2)
    expect(pieces.every((piece) => piece.residence.in === 'loose')).toBe(true)
    // The register was genuinely folded — this is the tolerant reader's own
    // case, not an op that failed to land.
    expect(tripOf(state).entries?.[HEADLAMP]?.residence?.value).toEqual({
      in: 'container',
      entryId: CRATE,
    })
    // And no Piece residence was written by that op either.
    expect(
      tripOf(state).entries?.[HEADLAMP]?.pieces?.[MARK]?.residence,
    ).toBeUndefined()
  })

  it('reads each Piece at its own place, ignoring the Entry’s register', () => {
    const state = withLater(
      tripEntryMoved(TRIP, HEADLAMP, { in: 'container', entryId: CRATE }),
      tripPieceMoved(TRIP, HEADLAMP, ANA, {
        in: 'container',
        entryId: DUFFEL,
      }),
    )

    const byPerson = new Map(
      piecesFor(HEADLAMP, state).map((piece) => [piece.personId, piece]),
    )
    expect(byPerson.get(MARK)?.residence).toEqual({ in: 'loose' })
    expect(byPerson.get(ANA)?.residence).toEqual({
      in: 'container',
      entryId: DUFFEL,
    })
  })

  it('resolves a Piece pointer the reader cannot follow to loose', () => {
    // The three pointer reasons `tripContainmentView` already applies to an
    // Entry's own residence, now applied to a Piece's: an Entry this replica
    // has never folded, a **removed** container, and an Entry that is not a
    // container at all. Unresolved, each of these lands the Piece in no group
    // and the partition §5e C5 claims stops summing.
    const state = withLater(
      tripParticipantAdded(TRIP, ELS),
      tripPieceRestored(TRIP, HEADLAMP, KIM),
      tripEntryAdded(TRIP, TOTE, {
        from: 'trip_only',
        name: 'Tote',
        container: true,
      }),
      tripEntryRemoved(TRIP, TOTE),
      tripPieceMoved(TRIP, HEADLAMP, MARK, { in: 'container', entryId: TOTE }),
      tripPieceMoved(TRIP, HEADLAMP, KIM, {
        in: 'container',
        entryId: 'e-never-folded',
      }),
      // The Rope is an ordinary Single, not a container.
      tripPieceMoved(TRIP, HEADLAMP, ANA, { in: 'container', entryId: ROPE }),
    )

    const byPerson = new Map(
      piecesFor(HEADLAMP, state).map((piece) => [piece.personId, piece]),
    )
    expect(byPerson.get(MARK)?.residence).toEqual({ in: 'loose' })
    expect(byPerson.get(KIM)?.residence).toEqual({ in: 'loose' })
    expect(byPerson.get(ANA)?.residence).toEqual({ in: 'loose' })
    // Els's Piece never had a register at all, and reads the same way.
    expect(byPerson.get(ELS)?.residence).toEqual({ in: 'loose' })
    // The pointers were folded exactly as written — the resolution is a read.
    expect(
      tripOf(state).entries?.[HEADLAMP]?.pieces?.[MARK]?.residence?.value,
    ).toEqual({ in: 'container', entryId: TOTE })
  })

  it('reads a Piece residence even where the Entry has none', () => {
    const state = withLater(
      tripPieceMoved(TRIP, HEADLAMP, MARK, { in: 'container', entryId: BOX }),
    )

    const byPerson = new Map(
      piecesFor(HEADLAMP, state).map((piece) => [piece.personId, piece]),
    )
    expect(byPerson.get(MARK)?.residence).toEqual({
      in: 'container',
      entryId: BOX,
    })
    expect(byPerson.get(ANA)?.residence).toEqual({ in: 'loose' })
  })

  it('falls back to loose when neither register is set', () => {
    expect(
      piecesFor(HEADLAMP).every((piece) => piece.residence.in === 'loose'),
    ).toBe(true)
  })
})

describe('countOf', () => {
  it('is the one arithmetic, and left is total minus packed', () => {
    const items: PackingItem[] = [
      { kind: 'entry', entryId: 'a', units: 3, status: 'packed', residence: { in: 'loose' } }, // prettier-ignore
      { kind: 'entry', entryId: 'b', units: 2, status: 'staged', residence: { in: 'loose' } }, // prettier-ignore
    ]

    expect(countOf(items)).toEqual({ packed: 3, total: 5, left: 2 })
    expect(countOf([])).toEqual({ packed: 0, total: 0, left: 0 })
  })
})

describe('packingTotals', () => {
  it('counts packed, total and left over every item', () => {
    // 3 (stove) + 1 rope + 1 tarp + 1 pan + 1 mug + 1 pot + 1 map + 1 jacket
    // + 1 flags + 1 unsynced + 2 headlamp Pieces = 14; packed = pan, mug,
    // pot, jacket and Mark's Piece.
    expect(totalsIn()).toEqual({ packed: 5, total: 14, left: 9 })
  })

  it('reads the same list the spine hands out', () => {
    expect(totalsIn()).toEqual(countOf(itemsIn(BASE)))
  })

  it('does not count staged as packed', () => {
    expect(isPacked('staged')).toBe(false)
    // The Tarp is the Trip's one staged item; packing it moves the numerator
    // by exactly one and leaves the denominator alone.
    expect(
      totalsIn(withLater(tripEntryStatusSet(TRIP, TARP, 'packed'))),
    ).toEqual({ packed: 6, total: 14, left: 8 })
  })

  it('excludes containers from the denominator', () => {
    const containers = entriesOf(TRIP_STATE, BASE).filter((entry) =>
      isContainerEntry(entry, BASE),
    )

    expect(containers).toHaveLength(5)
    expect(itemsIn(BASE).map((item) => item.entryId)).not.toContain(CRATE)
    expect(totalsIn().total).toBe(14)
  })

  it('sums to listTotals.pieces — one units table, not two', () => {
    // `packingItems` reads `pieceCountOf` rather than restating its table, so
    // the builder footer's `N PIECES` and this screen's numerator share a
    // definition. This is what fails loudly if a later reader unshares it.
    expect(totalsIn().total).toBe(listTotals(TRIP_STATE, BASE).pieces)

    // And it keeps holding once a Bring-count moves, which is the row most
    // likely to be edited.
    const state = withLater(tripEntryBringCountSet(TRIP, STOVE, 7))
    expect(totalsIn(state).total).toBe(listTotals(tripOf(state), state).pieces)
    expect(totalsIn(state).total).toBe(18)
  })

  it('counts an unrecognised status as not packed', () => {
    const state = withLater(tripEntryStatusSet(TRIP, MUG, 'wedged'))

    expect(itemsFor(MUG, state)[0]?.status).toBe('wedged')
    expect(totalsIn(state)).toEqual({ packed: 4, total: 14, left: 10 })
  })
})

describe('a container group counts its subtree at any depth', () => {
  it("includes a nested container's contents in its ancestor's count", () => {
    // The duffel's three include the stuff sack's two. A nested group's own
    // rows are counted twice on screen — once in its header and once in its
    // ancestor's — which is what "everything in the duffel" means to a
    // household carrying it.
    expect(groupTotals(DUFFEL)).toEqual({ packed: 2, total: 3, left: 1 })
    expect(groupTotals(SACK)).toEqual({ packed: 1, total: 2, left: 1 })
  })

  it('counts a Counted Entry inside it by its whole Bring-count', () => {
    // 3 (stove) + rope + tarp + pan; only the pan is packed.
    expect(groupTotals(CRATE)).toEqual({ packed: 1, total: 6, left: 5 })
  })

  it('counts the container itself as nothing', () => {
    // The stuff sack is inside the duffel and contributes no unit of its own:
    // the duffel's total is exactly the pot, the map and the jacket.
    expect(groupTotals(DUFFEL).total).toBe(
      countOf([...itemsFor(POT), ...itemsFor(MAP), ...itemsFor(JACKET)]).total,
    )
    expect(groupTotals(BIN)).toEqual({ packed: 0, total: 1, left: 1 })
  })

  it('counts nothing for an empty container and for a non-container', () => {
    const state = withLater(tripEntryMoved(TRIP, MUG, { in: 'loose' }))

    expect(groupTotals(BOX, state)).toEqual({ packed: 0, total: 0, left: 0 })
    expect(groupTotals(ROPE)).toEqual({ packed: 0, total: 0, left: 0 })
  })

  it('agrees with the trip total once every group is added up', () => {
    // The four top-level groups plus the Loose group is the whole list, and
    // only the stuff sack's two are double-counted — through the duffel that
    // holds it, exactly as the screen draws them.
    const view = tripContainmentView(TRIP_STATE, BASE)
    const grouped =
      groupTotals(BOX).total +
      groupTotals(CRATE).total +
      groupTotals(DUFFEL).total +
      groupTotals(BIN).total
    const loose = countOf(
      itemsIn(BASE).filter(
        (item) => view.holderOf(item.entryId).kind === 'loose',
      ),
    ).total

    expect(grouped + loose).toBe(totalsIn().total)
  })

  it('reads a passed-in items list rather than rebuilding one', () => {
    // The same shape and reason as the optional `view`: CONTAINER mode draws
    // one group per container, so a screen letting both default pays
    // N × O(entries).
    const view = tripContainmentView(TRIP_STATE, BASE)
    const items = itemsIn(BASE)

    expect(containerTotals(TRIP_STATE, BASE, CRATE, view, items)).toEqual(
      groupTotals(CRATE),
    )
    // The parameter is honoured, not ignored: a narrowed list narrows the
    // count.
    expect(
      containerTotals(
        TRIP_STATE,
        BASE,
        CRATE,
        view,
        items.filter((item) => item.entryId !== STOVE),
      ),
    ).toEqual({ packed: 1, total: 3, left: 2 })
  })
})

/**
 * A per-person Entry split three ways, and **deliberately not all of its
 * pointers valid**: Mark's Piece in the crate, Ana's in the duffel, Kim's
 * pointing at a container that was added and then **removed**, and Els — a
 * Participant added here — carrying no `residence` register at all. The
 * Entry's own `residence` is written too, at `Box`, and must be ignored
 * everywhere (§5e C0).
 *
 * The dangling pointer is the point. A fixture whose pointers all resolve
 * would pass the partition assertion below against an implementation that
 * never resolves anything, and the case that silently breaks C5's exactness
 * is precisely the Piece the reader cannot follow: unresolved it lands in no
 * group, and the groups quietly stop summing to the total.
 */
const SPLIT = withLater(
  tripParticipantAdded(TRIP, ELS),
  tripPieceRestored(TRIP, HEADLAMP, KIM),
  tripEntryAdded(TRIP, TOTE, {
    from: 'trip_only',
    name: 'Tote',
    container: true,
  }),
  tripEntryRemoved(TRIP, TOTE),
  tripEntryMoved(TRIP, HEADLAMP, { in: 'container', entryId: BOX }),
  tripPieceMoved(TRIP, HEADLAMP, MARK, { in: 'container', entryId: CRATE }),
  tripPieceMoved(TRIP, HEADLAMP, ANA, { in: 'container', entryId: DUFFEL }),
  tripPieceMoved(TRIP, HEADLAMP, KIM, { in: 'container', entryId: TOTE }),
)

/** The four **top-level** containers; the stuff sack is inside the duffel. */
const TOP_LEVEL = [BIN, BOX, CRATE, DUFFEL] as const

/**
 * What C5 claims sums to the trip total: every top-level group, plus `Loose`.
 *
 * `Loose` is taken from each item's **own** residence and not from
 * `view.holderOf(item.entryId)`, because the residence is what the screen
 * draws a row under. Reading the Entry's holder here would let the old
 * arithmetic pass: a Piece counted in no group would be picked up as loose by
 * an Entry that is loose, and the sum would close over a screen that had
 * drawn the Piece in a bag.
 */
function partitionOf(state: DepotState): number {
  const trip = tripOf(state)
  const items = itemsIn(state)
  const grouped = TOP_LEVEL.reduce(
    (sum, entryId) => sum + containerTotals(trip, state, entryId).total,
    0,
  )
  const loose = countOf(
    items.filter((item) => item.residence.in === 'loose'),
  ).total
  return grouped + loose
}

describe('the container partition is exact (§5e C5)', () => {
  it('counts a Piece under the container the PIECE names, not the Entry’s', () => {
    // The Entry's own register says `Box`, and the box holds the mug alone.
    expect(entryOf(HEADLAMP, SPLIT).residence?.value).toEqual({
      in: 'container',
      entryId: BOX,
    })
    expect(groupTotals(BOX, SPLIT)).toEqual({ packed: 1, total: 1, left: 0 })
    // Mark's Piece is in the crate: 3 stove + rope + tarp + pan + 1.
    expect(groupTotals(CRATE, SPLIT).total).toBe(7)
    // Ana's is in the duffel, whose three at any depth become four.
    expect(groupTotals(DUFFEL, SPLIT).total).toBe(4)
  })

  it('counts a Piece pointing at a REMOVED container under Loose, not nowhere', () => {
    const byPerson = new Map(
      piecesFor(HEADLAMP, SPLIT).map((piece) => [piece.personId, piece]),
    )

    // The pointer is folded exactly as written; the Tote is gone.
    expect(
      tripOf(SPLIT).entries?.[HEADLAMP]?.pieces?.[KIM]?.residence?.value,
    ).toEqual({ in: 'container', entryId: TOTE })
    expect(entriesOf(tripOf(SPLIT), SPLIT).map((entry) => entry.id)).not.toContain(TOTE) // prettier-ignore
    expect(byPerson.get(KIM)?.residence).toEqual({ in: 'loose' })
    // And Els, who never wrote one at all, reads the same way.
    expect(byPerson.get(ELS)?.residence).toEqual({ in: 'loose' })
  })

  it('sums the top-level groups plus Loose to the trip total', () => {
    // 1 (box) + 7 (crate) + 4 (duffel) + 1 (bin) + 3 loose = 16.
    expect(totalsIn(SPLIT)).toEqual({ packed: 5, total: 16, left: 11 })
    expect(partitionOf(SPLIT)).toBe(16)
  })

  it('counts what rides along from the items, never from the Entry tree', () => {
    // `N INSIDE RIDE ALONG` used to be `subtreeOf(view, entryId).size`, which
    // is the **container** tree — built from every Entry's raw `residence`,
    // per-person ones included. Under C0 that register is fold-but-ignore, so
    // the confirm named pieces the group's own rows do not draw.
    const trip = tripOf(SPLIT)

    // The Box: its rows are the mug alone, and the Headlamp Entry's ignored
    // pointer used to make that two.
    const view = tripContainmentView(trip, SPLIT)
    expect(subtreeOf(view, BOX).size).toBe(2)
    expect(ridesAlongCount(trip, SPLIT, BOX)).toBe(1)

    // The Crate: four Entries by the tree, seven things by the rows — the
    // Stove's Bring-count is three and Mark's Piece is in there too.
    expect(subtreeOf(view, CRATE).size).toBe(4)
    expect(ridesAlongCount(trip, SPLIT, CRATE)).toBe(7)

    // The Duffel: four things that can be packed, plus the stuff sack, which
    // rides along and is not a piece (ruling A5).
    expect(groupTotals(DUFFEL, SPLIT).total).toBe(4)
    expect(ridesAlongCount(trip, SPLIT, DUFFEL)).toBe(5)

    // The stuff sack itself holds two and nests nothing.
    expect(ridesAlongCount(trip, SPLIT, SACK)).toBe(2)
  })

  it('does not move the trip total when a Piece changes bags', () => {
    // The assertion C5's claim rests on: `● 48/61` is a property of the
    // Trip, and moving a Piece between two bags moves both group counts and
    // neither total.
    const moved = fold(
      log(
        [tripPieceMoved(TRIP, HEADLAMP, MARK, { in: 'container', entryId: BOX })], // prettier-ignore
        BASE_SPECS.length + 100,
      ),
      SPLIT,
    )

    expect(groupTotals(CRATE, moved).total).toBe(6)
    expect(groupTotals(BOX, moved).total).toBe(2)
    expect(totalsIn(moved)).toEqual(totalsIn(SPLIT))
    expect(partitionOf(moved)).toBe(partitionOf(SPLIT))
  })
})

describe('the person partition is total (ruling A7)', () => {
  it('puts each included Piece in its own Participant bucket', () => {
    expect(bucketFor(MARK).items.map((item) => item.entryId)).toContain(
      HEADLAMP,
    )
    expect(bucketFor(ANA).items.map((item) => item.entryId)).toContain(HEADLAMP)
    // Kim's Piece is tombstoned, so she has nothing to pack and no bucket.
    expect(
      bucketsIn().some(
        (bucket) => bucket.key.kind === 'person' && bucket.key.personId === KIM,
      ),
    ).toBe(false)
  })

  it("puts Personal gear in its owner's bucket, participant or not", () => {
    // The header answers *whose it is*, and Els's jacket carried by Mark is
    // honest. *Whose body it goes with* is story 23, Later.
    expect(bucketFor(ELS).items.map((item) => item.entryId)).toContain(JACKET)
    expect(participantIds(TRIP_STATE)).not.toContain(ELS)
    // And a Participant's own Personal gear lands the same way.
    expect(bucketFor(MARK).items.map((item) => item.entryId)).toContain(MAP)
  })

  it('puts everything else in Shared', () => {
    const shared = bucketsIn().find((bucket) => bucket.key.kind === 'shared')

    expect(shared?.items.map((item) => item.entryId).sort()).toEqual(
      [FLAGS, MUG, PAN, POT, ROPE, STOVE, TARP, UNSYNCED].sort(),
    )
    // A trip-only Entry has no Gear to own it, an absent owner register reads
    // SHARED, and a depot Entry whose Gear has not reached this replica has
    // no register to read — all three land here.
    expect(shared?.count).toEqual({ packed: 3, total: 10, left: 7 })
  })

  it('lands every non-container item in exactly one bucket', () => {
    const partitioned = bucketsIn().flatMap((bucket) => bucket.items)

    expect(partitioned).toHaveLength(itemsIn(BASE).length)
    expect(new Set(partitioned).size).toBe(partitioned.length)
  })

  it('sums to packingTotals — the assertion the drawn frame would have failed', () => {
    // `1/2 (Mark) + 0/1 (Ana) + 1/1 (Els) + 3/10 (Shared) = 5/14`. The drawn
    // PERSON frame was a complete partition that only carry-assignment
    // (story 23) could produce.
    const buckets = bucketsIn()
    const packed = buckets.reduce((sum, bucket) => sum + bucket.count.packed, 0)
    const total = buckets.reduce((sum, bucket) => sum + bucket.count.total, 0)
    const left = buckets.reduce((sum, bucket) => sum + bucket.count.left, 0)

    expect(buckets.map((bucket) => bucket.count)).toEqual([
      { packed: 1, total: 2, left: 1 },
      { packed: 0, total: 1, left: 1 },
      { packed: 1, total: 1, left: 0 },
      { packed: 3, total: 10, left: 7 },
    ])
    expect({ packed, total, left }).toEqual(totalsIn())
  })

  it('returns buckets in person-id order with shared distinguished, not drawn order', () => {
    // `piecesOf`'s own rule: the drawn order is `sortedPeople`'s and lives at
    // the screen, and `Shared` goes last there (ruling A3's argument, and a
    // deliberate divergence from GROUP BY OWNER, which pins shared first).
    // Ids sort Mark · Ana · Els; their names sort Ana · Els · Mark, so this
    // cannot be passing on the drawn order by accident.
    expect(bucketsIn().map((bucket) => bucket.key)).toEqual([
      { kind: 'person', personId: MARK },
      { kind: 'person', personId: ANA },
      { kind: 'person', personId: ELS },
      { kind: 'shared' },
    ])
  })

  it('returns no bucket at all for a Trip with nothing to pack', () => {
    const empty = fold(log([...aTrip({ id: 't-empty', name: 'Nothing' })]))
    const trip = empty.trips['t-empty']
    if (trip === undefined) throw new Error('the fold holds no Trip t-empty')

    expect(personPartition(trip, empty)).toEqual([])
  })
})

describe('countsAsDisagreement is the threshold\u2019s status half', () => {
  it('counts not_packed and every status this build cannot name', () => {
    expect(countsAsDisagreement('not_packed')).toBe(true)
    expect(countsAsDisagreement('in_the_shed')).toBe(true)
  })

  it('carves out staged, and only staged, from what !isPacked would give', () => {
    expect(isPacked('staged')).toBe(false)
    expect(countsAsDisagreement('staged')).toBe(false)
    expect(
      STATUSES.filter(
        (row) => !isPacked(row.id) && !countsAsDisagreement(row.id),
      ).map((row) => row.id),
    ).toEqual(['staged'])
  })

  it('never counts a packed status, and reads isPacked rather than re-deriving it', () => {
    expect(countsAsDisagreement('packed')).toBe(false)
    expect(
      STATUSES.every(
        (row) => !(isPacked(row.id) && countsAsDisagreement(row.id)),
      ),
    ).toBe(true)
  })
})

describe('the disagreement threshold (ruling A6)', () => {
  it('fires at car', () => {
    // The stove's three and the rope's one. The pan is packed and the tarp is
    // staged, so neither is counted.
    expect(disagreementsIn()).toContainEqual({
      entryId: CRATE,
      label: 'IN CAR',
      notPacked: 4,
    })
  })

  it('fires at packed', () => {
    expect(disagreementsIn()).toContainEqual({
      entryId: DUFFEL,
      label: 'PACKED',
      notPacked: 1,
    })
  })

  it('does not fire at home', () => {
    // The stuff sack carries no `stage` register, reads `home`, and holds an
    // unpacked map one level down — every ingredient but the stage.
    expect(groupTotals(SACK).left).toBe(1)
    expect(disagreementsIn().map((row) => row.entryId)).not.toContain(SACK)
  })

  it('does not fire at staging — staging IS the act of packing', () => {
    // Counting `staged` would fire on nearly every container in the car and
    // the ▲ would stop meaning anything.
    expect(groupTotals(BIN).left).toBe(1)
    expect(disagreementsIn().map((row) => row.entryId)).not.toContain(BIN)
  })

  it('counts not-packed only, never staged', () => {
    // The crate's `left` is five and its `notPacked` is four: the staged tarp
    // is unpacked work but not a contradiction, and the two questions are
    // deliberately different.
    expect(groupTotals(CRATE).left).toBe(5)
    expect(
      disagreementsIn().find((row) => row.entryId === CRATE)?.notPacked,
    ).toBe(4)
  })

  it('counts an unrecognised status toward the line', () => {
    // A6's carve-out is drawn against `staged` specifically and the ruling
    // never reached the unrecognised case. Excluding it would hide the ▲ on a
    // crate full of gear this build cannot name — the disagreement the whole
    // feature exists to surface, silently gone — where counting it is only
    // slightly loose wording on a warning that is telling the truth.
    const state = withLater(tripEntryStatusSet(TRIP, ROPE, 'wedged'))

    expect(groupTotals(CRATE, state).left).toBe(5)
    expect(
      disagreementsIn(state).find((row) => row.entryId === CRATE)?.notPacked,
    ).toBe(4)
  })

  it('fires on a container whose ONLY unpacked content is a status this build cannot name', () => {
    // The test that would fail if `countsAsDisagreement` were ever reverted to
    // a literal `'not_packed'` comparison: the box holds exactly one item, and
    // an implementation that excluded unrecognised statuses would drop the box
    // out of the list entirely rather than merely lowering its count.
    const state = withLater(tripEntryStatusSet(TRIP, MUG, 'in_the_shed'))

    expect(itemsFor(MUG, state)).toHaveLength(1)
    expect(disagreementsIn(state)).toContainEqual({
      entryId: BOX,
      label: 'IN CAR',
      notPacked: 1,
    })
  })

  it('counts a Counted Entry with an unnamed status by its whole Bring-count', () => {
    // Story 20's per-trip editable statuses ship on this open enum, so the
    // units rule has to hold for a value this build has never heard of.
    const state = withLater(tripEntryStatusSet(TRIP, STOVE, 'in_the_shed'))

    expect(
      disagreementsIn(state).find((row) => row.entryId === CRATE)?.notPacked,
    ).toBe(4)
  })

  it('counts contents at any depth', () => {
    // The duffel's own children are the stuff sack (a container, no item) and
    // a packed jacket, so a non-recursive count would say zero and the line
    // would never fire. Its one unpacked content is the map, two levels down.
    const view = tripContainmentView(TRIP_STATE, BASE)
    expect(view.holderOf(MAP)).toEqual({ kind: 'container', entryId: SACK })
    expect(view.holderOf(SACK)).toEqual({ kind: 'container', entryId: DUFFEL })
    expect(view.holderOf(DUFFEL)).toEqual({ kind: 'loose' })

    const directChildren = view.childrenOf({
      kind: 'container',
      entryId: DUFFEL,
    })
    expect(directChildren).toEqual([JACKET, SACK])
    expect(countOf(itemsFor(JACKET)).left).toBe(0)

    expect(
      disagreementsIn().find((row) => row.entryId === DUFFEL)?.notPacked,
    ).toBe(1)
  })

  it('does not fire on a container whose contents are all packed', () => {
    // The box is in the car and holds one packed mug.
    expect(groupTotals(BOX)).toEqual({ packed: 1, total: 1, left: 0 })
    expect(disagreementsIn().map((row) => row.entryId)).not.toContain(BOX)
  })

  it('does not fire on an empty container', () => {
    const state = withLater(tripEntryMoved(TRIP, MUG, { in: 'loose' }))

    expect(disagreementsIn(state).map((row) => row.entryId)).not.toContain(BOX)
  })

  it('says nothing about a stage this build cannot name', () => {
    // `stageDisagreementLabel` is null for an unrecognised value: a build that
    // cannot name a stage cannot claim a disagreement about it.
    const state = withLater(tripContainerStageSet(TRIP, CRATE, 'quarantine'))

    expect(disagreementsIn(state).map((row) => row.entryId)).toEqual([DUFFEL])
  })

  it('lists disagreeing containers in the order the list draws them', () => {
    expect(disagreementsIn()).toEqual([
      { entryId: CRATE, label: 'IN CAR', notPacked: 4 },
      { entryId: DUFFEL, label: 'PACKED', notPacked: 1 },
    ])
  })

  it('goes away when a Quartermaster packs the contents', () => {
    const state = withLater(tripEntryStatusSet(TRIP, MAP, 'packed'))

    expect(disagreementsIn(state).map((row) => row.entryId)).not.toContain(
      DUFFEL,
    )
  })
})
