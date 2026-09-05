# S9a — Packing and the Journey · implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Quartermaster pack a Trip — mark every Entry and every Piece
`not packed` / `staged` / `packed`, put things into trip containers, and move a
container and everything inside it along its journey `⌂ HOME → STAGING → CAR →
PACKED` — from one screen, offline, one-handed. Stories **9** and **10**, whole.

**Architecture:** Five catalogued ops write five registers across two entity
paths (`entries.<id>` and `entries.<id>.pieces.<person_id>`). The two domain
tracks — *where* (`residence`) and *how far along* (`status` / `stage`) — are
**separate registers**, so no merge can make them agree and invariant 12 is
honoured structurally rather than enforced. `shared/src/selectors/packing.ts`
holds two tables (`STATUSES`, `STAGES`) in `trip.ts`'s `PHASES` shape and every
question with one function beside it; `shared/src/selectors/tripContainment.ts`
is `containment.ts`'s twin over `TripResidence`, restating sync §3.6's cycle
break for the trip world. The UI is one new route, `/trips/:id/packing` (F4),
with two sheets and one confirm; the Trip screen and the Trips card each gain a
door to it.

**Tech Stack:** TypeScript, React 18, Vite, wouter, Vitest + Testing Library,
Radix (via `ui/Sheet` and `ui/Confirm`), CSS Modules. **No server, no schema, no
endpoint, no migration.**

**Spec:** [`docs/specs/2026-09-01-packing-and-the-journey.md`](2026-09-01-packing-and-the-journey.md)
— read it alongside this plan. **Design authority is
[`docs/design/README.md`](../design/README.md) §1 (F4 anatomy), §5 (the trip
card) and §5e (the twenty rulings)**, plus the board
`S9 Round - Packing and the Journey.dc.html`. Where the spec and §5e disagree,
**§5e wins and the spec is wrong** — the spec says so itself.

## Global Constraints

- **Relative imports in `shared/` carry an explicit `.ts` extension.** `app/`
  and `ui/` carry none (Vite resolves). Never mix.
- **Ops mirror the wire: `snake_case` payload keys, never transformed.** Folded
  state and props are camelCase. The reducer is the only place the two meet.
  This slice's one split is `entry_id` → `entryId` inside `TripResidence`.
- **`null` clears a nullable register; an absent field leaves it alone**
  (sync §1.3). No register in this slice is nullable, so every reader here
  treats `null` and malformed alike — `absent`.
- **`npm ci` has been run in this worktree.** If `@foerier/shared` resolves
  oddly, run `npm run check:workspaces` — it names the fix.
- **Every task ends green.** `npx vitest run` must pass **in full**, not just
  the new file. Pre-commit runs Tier 0 (`tsc` across all workspaces, ESLint,
  Prettier) and rejects a commit failing any of them.
- **Copy is verbatim from §1 and §5e.** Do not improve, shorten, or re-case a
  drawn string. The complete set this slice introduces:
  `Pack-out` · `● 48/61 PIECES` · `13 LEFT` · `CONTAINER` `PERSON` `ALL` ·
  `○ LEFT` · `TAP PILL = NEXT STATE · TAP CIRCLES = PER PERSON · TAP ROW = WHERE IT GOES` ·
  `NOT PACKED` `STAGED` `PACKED` · `⌂ HOME` `STAGING` `CAR` `PACKED` ·
  `Loose` · `NOT IN A CONTAINER` · `A CONTAINER ON THE GEAR LIST BECOMES A GROUP HERE.` ·
  `TRIP-ONLY` · `NOT IN DEPOT` · `Shared` · `NOT ATTRIBUTED TO A PERSON` ·
  `▲ IN CAR · 3 INSIDE NOT PACKED` · `▲ PACKED · 3 INSIDE NOT PACKED` ·
  `PACKING STATUS · 1 OF 3 PACKED` · `MOVE` · `SET EVERYONE` ·
  `WHERE IT GOES ON THIS TRIP` · `A TRIP CONTAINER IS AN ENTRY ON THE GEAR LIST.` ·
  `CRATE B AND EVERYTHING INSIDE IT ARE NOT OFFERED.` ·
  `MOVING CRATE B · 5 INSIDE RIDE ALONG` · `● NOW` ·
  `No containers on this trip yet.` / `Add a container to the gear list to pack into it.` ·
  `Move Crate B into Duffel 90 L?` / `Crate B and everything inside it move on the trip. Nothing at home moves.` /
  `5 INSIDE RIDE ALONG · STATUS UNCHANGED` / `Move` / `Cancel` ·
  `0 ENTRIES.` / `The gear list is built from the depot.` ·
  `Continue pack-out` · `PACKING ›` · `▸ MIXED` · `▸ LOOSE`.
- **A drawn size is the painted size** (ruling O). 48 floors the **hit area**
  via a non-painting `::after`, clamped at the owning row's bounds. Never add
  `min-height` to make a control reachable. `app/src/screens/drawnSizes.test.ts`
  is the net.
- **Circles are never individual tap targets** (ruling B, reaffirmed at 34px by
  ruling A1). The cluster **and its count** are one control. This is the rule
  most likely to be violated by an implementer working from intuition.
- **`@container`, never a media query, for how a component lays out**; a media
  query decides only what *exists* (frontend-design §3.2). F4 has **no pane** at
  any width, so it needs no media query of its own beyond `useScreenHeader`.
- **Battery discipline:** commit at every task boundary. The session may be
  suspended between tasks and resumed later.

---

## File structure

**Created**

| Path | Responsibility |
| --- | --- |
| `shared/src/selectors/packing.ts` | `STATUSES` · `STAGES` tables, the eight reads, the counts, the person partition, the disagreement threshold |
| `shared/src/selectors/packing.test.ts` | Tier 1 for the tables and the reads (Task 2) |
| `shared/src/selectors/packing.counts.test.ts` | Tier 1 for the counts, the partition and the threshold (Task 5) |
| `shared/src/selectors/tripContainment.ts` | The Trip's containment view over `TripResidence` |
| `shared/src/selectors/tripContainment.test.ts` | Tier 1 for the four loose-reasons, the cycle break, sorted-id determinism |
| `shared/src/reduce.packing.test.ts` | Tier 1 for the five handlers |
| `shared/fixtures/s9a-packing.ops.json` | Wire-format fixture for the five op types |
| `shared/src/fixtures.s9a.test.ts` | Replays it through the current reducer |
| `app/src/components/PackPicker.tsx` + `.module.css` + `.test.tsx` | Ruling A2's picker, the Home picker's twin |
| `app/src/components/ContainerMoveConfirm.tsx` + `.test.tsx` | Ruling A2b's one confirm |
| `app/src/components/PieceStatusSheet.tsx` + `.module.css` + `.test.tsx` | Ruling A1's sheet |
| `app/src/components/JourneyRail.tsx` + `.module.css` | Ruling A15's direct-set rail |
| `app/src/components/PackingRow.tsx` + `.module.css` | The two-target row (ruling A2) |
| `app/src/screens/Packing.tsx` + `.module.css` + `.test.tsx` | F4 |

**Modified** — `shared/src/state.ts` · `payloads.ts` · `reduce.ts` ·
`authoring.ts` · `index.ts` · `selectors/entry.ts` (+ its test) ·
`selectors/whereabouts.ts` (docstring only) · `reduce.test.ts` ·
`fixtures.test.ts` (+ its snapshot) · `convergence.test.ts` ·
`ui/src/PersonCircle.tsx` (+ css, test) · `app/src/App.tsx` ·
`app/src/components/TripCard.tsx` (+ css, test) · `app/src/screens/Trip.tsx`
(+ css, test) · `app/src/screens/Trips.tsx` (+ test) ·
`app/src/screens/drawnSizes.test.ts` · `app/src/shell/screenBand.test.tsx` ·
plus the docs named in Task 13.

---

## Task 1: The five ops — state, payloads, reducer, authoring, fixture

The whole write side, in one reviewable unit, because **the wire format freezes
here** and spec §5.4 puts the fixture in the same commit as the ops. Read
spec §1 and §2 first.

**This task also fixes two tests that become false the moment the reducer folds
`trip.entry_status_set`.** `shared/fixtures/s2-depot.ops.json` carries one as an
**unknown-type probe** (op id `…001c`, `seq: 28`), and two suites assert it stays
unfolded. Neither is a bug in this slice — it is the tolerant reader's promise
kept, a later build folding an op an earlier one retained — but a task that
leaves them red does not end green.

**Files:**
- Modify: `shared/src/state.ts` (three new types; five new registers; delete two now-false docstring sentences)
- Modify: `shared/src/payloads.ts` (add `readTripResidence`)
- Modify: `shared/src/reduce.ts` (five handlers, five dispatch rows, one comment)
- Modify: `shared/src/authoring.ts` (five builders)
- Modify: `shared/src/index.ts` (export the three types, `readTripResidence`, the five builders)
- Modify: `shared/src/reduce.test.ts:242` (the unknown-op probe name)
- Modify: `shared/src/fixtures.test.ts:46-53` (the S2 probe now folds)
- Modify: `shared/src/__snapshots__/fixtures.test.ts.snap` (regenerated, reviewed by eye)
- Test: `shared/src/reduce.packing.test.ts` (create)
- Create: `shared/fixtures/s9a-packing.ops.json`
- Test: `shared/src/fixtures.s9a.test.ts` (create)

**Interfaces:**
- Consumes: `writeEntry(state, tripId, entryId, stamp, update)`,
  `writePiece(state, tripId, entryId, personId, stamp, update)`,
  `writeRegister(register, value, stamp)`, `readString`, `readOpen` — all
  already in `reduce.ts` / `registers.ts` / `payloads.ts`.
- Produces, and every later task depends on these exact names:
  - `type StatusValue = 'not_packed' | 'staged' | 'packed' | (string & {})`
  - `type StageValue = 'home' | 'staging' | 'car' | 'packed' | (string & {})`
  - `type TripResidence = { in: 'container'; entryId: string } | { in: 'loose' }`
  - `EntryState.status?: Register<StatusValue>`, `.residence?: Register<TripResidence>`, `.stage?: Register<StageValue>`
  - `PieceState.status?: Register<StatusValue>`, `.residence?: Register<TripResidence>`
  - `readTripResidence(p: Record<string, unknown>, key: string): Read<TripResidence>`
  - `tripEntryStatusSet(tripId: string, entryId: string, status: StatusValue): OpSpec`
  - `tripPieceStatusSet(tripId: string, entryId: string, personId: string, status: StatusValue): OpSpec`
  - `tripEntryMoved(tripId: string, entryId: string, residence: TripResidence): OpSpec`
  - `tripPieceMoved(tripId: string, entryId: string, personId: string, residence: TripResidence): OpSpec`
  - `tripContainerStageSet(tripId: string, entryId: string, stage: StageValue): OpSpec`

- [ ] **Step 1: Add the three types and the five registers to `shared/src/state.ts`**

Add after `EntrySource`, which they sit beside as the Trip's other value types:

```ts
/**
 * Deliberately open past the three known members, exactly as {@link KindValue}
 * and {@link PhaseValue} are and for the identical reason: an unknown enum
 * value is stored verbatim and never coerced (`sync-protocol.md` §5.3,
 * obligation 4). It is what makes story 20's per-trip editable statuses widen
 * the set with **no migration and no lattice** — §3.3 removed the rank
 * function from the merge, so an unrecognised value is simply a value.
 *
 * What the app then *does* with one is `selectors/packing.ts`'s answer, not
 * this type's: drawn verbatim, not packed, not counted toward the numerator,
 * cycling to `not_packed` — the only answer that is not an invention.
 */
export type StatusValue = 'not_packed' | 'staged' | 'packed' | (string & {})

/** Open past its four known members, for {@link StatusValue}'s reason. */
export type StageValue = 'home' | 'staging' | 'car' | 'packed' | (string & {})

/**
 * Where a thing rides **on this Trip** (`sync-protocol.md` §3.7).
 *
 * **Not {@link Residence}**, and deliberately a second type rather than a
 * widening of that one: different members, and the container is keyed by
 * `entryId` rather than `id`. A trip residence assigned to `gear.residence`
 * would be the bug invariant 13 exists to forbid, and two types the compiler
 * keeps apart is the whole of the defence.
 *
 * **Closed**, like {@link EntrySource} and unlike the two enums above:
 * `readTripResidence` reads an unrecognised `in` as `absent`, so it never
 * reaches state. The tolerance lives at the boundary; the type stays
 * exhaustive.
 */
export type TripResidence =
  | { in: 'container'; entryId: string }
  | { in: 'loose' }
```

Replace `PieceState`'s docstring paragraph — the sentence naming S9 is now
false, exactly as S8 was obliged to delete S7's *"Pieces are exactly
Participants until S8"* — and add the two registers:

```ts
/**
 * One Participant's copy of a per-person Entry
 * (`sync-protocol.md` §3.7).
 *
 * S9a declares three of §3.7's four registers. `outcome` is S10's, and
 * nobody else's. A register nobody writes is a field every reader must have
 * an opinion about, so each arrives with the slice that writes it —
 * `EntryState`'s own rule, one level deeper.
 *
 * `status` and `residence` are declared with **identical types** to the
 * Entry's. A Piece is a thing that travels exactly as an Entry is; nothing
 * about the two registers differs but the entity path they hang on.
 */
export interface PieceState {
  /** The Person id. The map key and this field are the same value. */
  readonly id: string
  /** Tombstone. `trip.piece_restored` clears it, if strictly later. */
  readonly removed?: Register<boolean>
  /**
   * *How far along* — the second of domain §7's two tracks. **An absent
   * register reads `not_packed`, and only `selectors/packing.ts`'s
   * `pieceStatusOf` says so.** The fold conflates nothing: absent and an
   * explicit `"not_packed"` stay different facts about the log.
   */
  readonly status?: Register<StatusValue>
  /**
   * *Where* — the first track. One Piece may ride in the duffel while another
   * of the same Entry is loose, which is why this hangs here and not only on
   * the Entry.
   */
  readonly residence?: Register<TripResidence>
}
```

Replace `EntryState`'s docstring paragraph and add the three registers:

```ts
/**
 * One line on a Trip's gear list.
 *
 * S9a declares six of the eight registers [sync §3.7] names. `outcome` and
 * `consumedCount` are S10's, and nobody else's. A register nobody writes is a
 * field every reader must have an opinion about, so each arrives with the
 * slice that writes it.
 */
export interface EntryState {
  readonly id: string
  /** One register, not three — the whole union is written as a unit. */
  readonly source?: Register<EntrySource>
  /**
   * Folded for **any** Entry; meaningful on Counted depot Entries only.
   * The Kind lives on another aggregate, so the reducer cannot gate it and
   * must not try — see `bringCountOf`.
   */
  readonly bringCount?: Register<number>
  /** Tombstone. No restore op exists in the MVP. */
  readonly removed?: Register<boolean>
  readonly pieces?: Readonly<Record<string, PieceState>>
  /**
   * *How far along*, for an Entry that is **not** a container. An absent
   * register reads `not_packed` (`packing.ts`'s `statusOf`).
   *
   * Folded **unconditionally**, for `bringCount`'s reason one register over:
   * the containment trait lives on the **Gear** aggregate, so a reducer that
   * resolved it before writing would make the fold order-dependent on whether
   * `gear.recorded` had arrived. Sync §3.7's *never both on one entry* is an
   * **authoring rule**, and the gate lives on the way out.
   */
  readonly status?: Register<StatusValue>
  /** *Where*, on this Trip. Never the home residence (invariant 13). */
  readonly residence?: Register<TripResidence>
  /**
   * *How far along*, for an Entry that **is** a container — a journey
   * *instead of* a status. An absent register reads `home` (`stageOf`).
   * Folded unconditionally, for `status`'s reason directly above.
   *
   * **One op moves everything inside it** (story 10): containment is a
   * pointer held by the contained thing, so the contents' whereabouts follows
   * with no fan-out and no cross-entity write. Their statuses are
   * deliberately untouched (invariant 12).
   */
  readonly stage?: Register<StageValue>
}
```

- [ ] **Step 2: Write the failing reducer test**

Create `shared/src/reduce.packing.test.ts`. Model the prologue on
`shared/src/reduce.pieces.test.ts` — read that file first and copy its
envelope helper rather than inventing a new one.

```ts
import { describe, expect, it } from 'vitest'

import {
  tripContainerStageSet,
  tripEntryMoved,
  tripEntryStatusSet,
  tripPieceMoved,
  tripPieceStatusSet,
  type OpSpec,
} from './authoring.ts'
import { emptyState, fold } from './reduce.ts'
import type { HouseholdState } from './state.ts'

const TRIP = '66666666-0000-7000-8000-000000000001'
const ENTRY = '77777777-0000-7000-8000-000000000001'
const CRATE = '77777777-0000-7000-8000-000000000002'
const MARK = '88888888-0000-7000-8000-000000000001'
const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

/** Copy `reduce.pieces.test.ts`'s own envelope helper verbatim. */
function anOp(spec: OpSpec, hlc: string, deviceId = DEV_A) {
  /* … as in reduce.pieces.test.ts … */
}

function foldOf(...ops: readonly ReturnType<typeof anOp>[]): HouseholdState {
  return fold(ops, emptyState())
}

describe('the five packing ops', () => {
  it('sets an Entry status on the Entry, and nothing else', () => {
    const state = foldOf(
      anOp(tripEntryStatusSet(TRIP, ENTRY, 'packed'), '2026-09-01T10:00:00.000Z-0000'),
    )
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.status?.value).toBe('packed')
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.residence).toBeUndefined()
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.stage).toBeUndefined()
  })

  it('sets a Piece status on the Piece, not on its Entry', () => {
    const state = foldOf(
      anOp(tripPieceStatusSet(TRIP, ENTRY, MARK, 'staged'), '2026-09-01T10:00:00.000Z-0000'),
    )
    const entry = state.trips[TRIP]?.entries?.[ENTRY]
    expect(entry?.pieces?.[MARK]?.status?.value).toBe('staged')
    expect(entry?.status).toBeUndefined()
  })

  it('folds a trip residence, mapping entry_id to entryId', () => {
    const state = foldOf(
      anOp(
        tripEntryMoved(TRIP, ENTRY, { in: 'container', entryId: CRATE }),
        '2026-09-01T10:00:00.000Z-0000',
      ),
    )
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.residence?.value).toEqual({
      in: 'container',
      entryId: CRATE,
    })
  })

  it('folds a loose trip residence', () => {
    const state = foldOf(
      anOp(tripEntryMoved(TRIP, ENTRY, { in: 'loose' }), '2026-09-01T10:00:00.000Z-0000'),
    )
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.residence?.value).toEqual({ in: 'loose' })
  })

  it('folds a Piece residence on the Piece', () => {
    const state = foldOf(
      anOp(
        tripPieceMoved(TRIP, ENTRY, MARK, { in: 'container', entryId: CRATE }),
        '2026-09-01T10:00:00.000Z-0000',
      ),
    )
    expect(
      state.trips[TRIP]?.entries?.[ENTRY]?.pieces?.[MARK]?.residence?.value,
    ).toEqual({ in: 'container', entryId: CRATE })
  })

  it('folds a container stage', () => {
    const state = foldOf(
      anOp(tripContainerStageSet(TRIP, CRATE, 'car'), '2026-09-01T10:00:00.000Z-0000'),
    )
    expect(state.trips[TRIP]?.entries?.[CRATE]?.stage?.value).toBe('car')
  })

  it('stores an unrecognised status verbatim and never coerces it', () => {
    const state = foldOf(
      anOp(tripEntryStatusSet(TRIP, ENTRY, 'in_the_shed'), '2026-09-01T10:00:00.000Z-0000'),
    )
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.status?.value).toBe('in_the_shed')
  })

  it('returns the identical object when a write loses LWW', () => {
    const seeded = foldOf(
      anOp(tripEntryStatusSet(TRIP, ENTRY, 'packed'), '2026-09-01T10:00:05.000Z-0000'),
    )
    const stale = fold(
      [anOp(tripEntryStatusSet(TRIP, ENTRY, 'staged'), '2026-09-01T10:00:01.000Z-0000')],
      seeded,
    )
    // Not merely equal — the same object. `slice.ts`'s WeakMap memo is keyed
    // on the fold's own immutable identity and depends on this.
    expect(stale).toBe(seeded)
  })

  it('reads an unrecognised residence shape as absent, leaving the register alone', () => {
    const seeded = foldOf(
      anOp(tripEntryMoved(TRIP, ENTRY, { in: 'loose' }), '2026-09-01T10:00:00.000Z-0000'),
    )
    const raw = {
      ...anOp(tripEntryMoved(TRIP, ENTRY, { in: 'loose' }), '2026-09-01T10:00:05.000Z-0000'),
      payload: { entry_id: ENTRY, residence: { in: 'elsewhere', entry_id: CRATE } },
    }
    const after = fold([raw], seeded)
    // Tolerant: the op folds, the Entry survives, the register is untouched.
    expect(after.trips[TRIP]?.entries?.[ENTRY]?.residence?.value).toEqual({ in: 'loose' })
    expect(after.unfolded.count).toBe(0)
  })

  it('folds a status and a stage on the same Entry — the reducer never gates', () => {
    // Sync §3.7's `never both` is an authoring rule; a peer on another build
    // may write one, and the reader must not reject it (spec §1.3).
    const state = foldOf(
      anOp(tripEntryStatusSet(TRIP, CRATE, 'packed'), '2026-09-01T10:00:00.000Z-0000'),
      anOp(tripContainerStageSet(TRIP, CRATE, 'car'), '2026-09-01T10:00:01.000Z-0000'),
    )
    expect(state.trips[TRIP]?.entries?.[CRATE]?.status?.value).toBe('packed')
    expect(state.trips[TRIP]?.entries?.[CRATE]?.stage?.value).toBe('car')
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run shared/src/reduce.packing.test.ts`
Expected: FAIL — `tripEntryStatusSet` is not exported from `./authoring.ts`.

- [ ] **Step 4: Add `readTripResidence` to `shared/src/payloads.ts`**

Beside `readResidence`, importing `TripResidence` from `./state.ts`:

```ts
/**
 * Reads a **trip** residence ([sync §4.4](../../docs/sync-protocol.md)).
 *
 * Not `readResidence`: different members, and the container is keyed
 * `entry_id` rather than `id`. The wire's `entry_id` becomes `entryId`, the
 * same split `readOwner` already has over `person_id` and `readSource` over
 * `gear_id`. An unrecognised `in`, or a container with no `entry_id`, reads
 * `absent` — the register is left exactly as it was, the op is retained, and
 * nothing is rejected.
 */
export function readTripResidence(
  p: Record<string, unknown>,
  key: string,
): Read<TripResidence> {
  return refine(p, key, (v) => {
    if (!isRecord(v)) return undefined
    if (v['in'] === 'loose') return { in: 'loose' }
    if (v['in'] === 'container') {
      const entryId = v['entry_id']
      return typeof entryId === 'string' && entryId !== ''
        ? { in: 'container', entryId }
        : undefined
    }
    return undefined
  })
}
```

- [ ] **Step 5: Add the five handlers to `shared/src/reduce.ts`**

Place them after `tripPieceWritten`. Import `readTripResidence`.
`trip.entry_status_set` and `trip.container_stage_set` differ only in which
register they write, so they share a factory — the shape `gearTagWritten` and
`tripParticipantWritten` already use in this file.

```ts
/**
 * `trip.entry_status_set` / `trip.container_stage_set` (`sync-protocol.md`
 * §4.4). Two ops, one shape: read `entry_id`, write one open-enum register on
 * the Entry by plain LWW (§3.3).
 *
 * **Neither is gated on the Gear's containment trait, and neither may be.**
 * The trait lives on another aggregate with no ordering against the Trip's, so
 * a gate here would make the fold order-dependent on whether `gear.recorded`
 * had arrived. §3.7's *never both on one entry* is an authoring rule and the
 * gate lives on the way out, in `selectors/packing.ts` — the same split
 * `bringCount` takes for invariant 6 and `tags` for `TagString`.
 */
const tripEntryOpenEnum =
  (field: 'status' | 'stage'): Handler =>
  (state, op, stamp) => {
    const entryId = readString(op.payload, 'entry_id')
    if (entryId.kind !== 'value') return state
    const value = readOpen(op.payload, field)
    if (value.kind !== 'value') return state
    return writeEntry(state, op.aggregate_id, entryId.value, stamp, (entry, st) => {
      const next = writeRegister(entry[field], value.value, st)
      return next === entry[field] ? entry : { ...entry, [field]: next }
    })
  }

/** `trip.piece_status_set` (§4.4) — the Entry's `status`, one path deeper. */
const tripPieceStatusSet: Handler = (state, op, stamp) => {
  const entryId = readString(op.payload, 'entry_id')
  if (entryId.kind !== 'value') return state
  const personId = readString(op.payload, 'person_id')
  if (personId.kind !== 'value') return state
  const status = readOpen(op.payload, 'status')
  if (status.kind !== 'value') return state
  return writePiece(
    state,
    op.aggregate_id,
    entryId.value,
    personId.value,
    stamp,
    (piece, st) => {
      const next = writeRegister(piece.status, status.value, st)
      return next === piece.status ? piece : { ...piece, status: next }
    },
  )
}

/**
 * `trip.entry_moved` (§4.4): the Entry's **trip** residence.
 *
 * Never its home (invariant 13) and never its status (invariant 12) — two
 * registers the merge can never make agree, which is what makes the duffel in
 * the car with an unpacked stove inside it a *reportable* disagreement rather
 * than a forbidden state.
 *
 * Moving a container writes **this one register on the container** and nothing
 * else: containment is a pointer held by the contained thing, so the contents
 * follow with no fan-out (story 10, spec §1.5).
 */
const tripEntryMoved: Handler = (state, op, stamp) => {
  const entryId = readString(op.payload, 'entry_id')
  if (entryId.kind !== 'value') return state
  const residence = readTripResidence(op.payload, 'residence')
  if (residence.kind !== 'value') return state
  return writeEntry(state, op.aggregate_id, entryId.value, stamp, (entry, st) => {
    const next = writeRegister(entry.residence, residence.value, st)
    return next === entry.residence ? entry : { ...entry, residence: next }
  })
}

/** `trip.piece_moved` (§4.4) — {@link tripEntryMoved}, one path deeper. */
const tripPieceMoved: Handler = (state, op, stamp) => {
  const entryId = readString(op.payload, 'entry_id')
  if (entryId.kind !== 'value') return state
  const personId = readString(op.payload, 'person_id')
  if (personId.kind !== 'value') return state
  const residence = readTripResidence(op.payload, 'residence')
  if (residence.kind !== 'value') return state
  return writePiece(
    state,
    op.aggregate_id,
    entryId.value,
    personId.value,
    stamp,
    (piece, st) => {
      const next = writeRegister(piece.residence, residence.value, st)
      return next === piece.residence ? piece : { ...piece, residence: next }
    },
  )
}
```

Then the dispatch rows. **Replace** the S7 comment's last sentence
(`trip.entry_status_set` stays unfolded until S9) — it is now false:

```ts
  // S7 (§4.4): the gear list, keyed by entry id — the first of the Trip's
  // nested maps.
  'trip.entry_added': tripEntryAdded,
  'trip.entry_removed': tripEntryRemoved,
  'trip.entry_bring_count_set': tripEntryBringCountSet,
  // S8 (§4.4): one Piece per Participant, keyed by person id on the Entry —
  // present and absent, not create and delete, exactly the participant and
  // tag pairs above.
  'trip.piece_removed': tripPieceWritten(true),
  'trip.piece_restored': tripPieceWritten(false),
  // S9a (§4.4): the two tracks — *where* and *how far along* — as five
  // registers over two entity paths. Separate registers is what makes
  // invariant 12 structural rather than enforced: no merge can make them
  // agree, so the disagreement survives to be reported.
  'trip.entry_status_set': tripEntryOpenEnum('status'),
  'trip.container_stage_set': tripEntryOpenEnum('stage'),
  'trip.piece_status_set': tripPieceStatusSet,
  'trip.entry_moved': tripEntryMoved,
  'trip.piece_moved': tripPieceMoved,
```

- [ ] **Step 6: Add the five builders to `shared/src/authoring.ts`**

After `tripPieceRestored`, in the file's existing style — a plain object, no
clock, no id (`authorOp` supplies both):

```ts
/** camelCase in, `snake_case` out — `authoring.ts` is the strict half. */
function wireResidence(residence: TripResidence): Record<string, unknown> {
  return residence.in === 'loose'
    ? { in: 'loose' }
    : { in: 'container', entry_id: residence.entryId }
}

/** §4.4. `status` is an open enum; the builder does not narrow it. */
export function tripEntryStatusSet(
  tripId: string,
  entryId: string,
  status: StatusValue,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.entry_status_set',
    payload: { entry_id: entryId, status },
  }
}

/** §4.4: {@link tripEntryStatusSet} for one Participant's Piece. */
export function tripPieceStatusSet(
  tripId: string,
  entryId: string,
  personId: string,
  status: StatusValue,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.piece_status_set',
    payload: { entry_id: entryId, person_id: personId, status },
  }
}

/**
 * §4.4: the Entry's **trip** residence. The payload is `snake_case` on the
 * wire, so `entryId` is written back out as `entry_id` — the one place this
 * slice performs its camel/snake split on the way out.
 */
export function tripEntryMoved(
  tripId: string,
  entryId: string,
  residence: TripResidence,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.entry_moved',
    payload: { entry_id: entryId, residence: wireResidence(residence) },
  }
}

/** §4.4: {@link tripEntryMoved} for one Participant's Piece. */
export function tripPieceMoved(
  tripId: string,
  entryId: string,
  personId: string,
  residence: TripResidence,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.piece_moved',
    payload: {
      entry_id: entryId,
      person_id: personId,
      residence: wireResidence(residence),
    },
  }
}

/** §4.4. One op moves the container and everything inside it (story 10). */
export function tripContainerStageSet(
  tripId: string,
  entryId: string,
  stage: StageValue,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.container_stage_set',
    payload: { entry_id: entryId, stage },
  }
}
```

- [ ] **Step 7: Export everything from `shared/src/index.ts`**

Add `StageValue`, `StatusValue`, `TripResidence` to the `state.ts` type block;
`readTripResidence` to the `payloads.ts` block; and the five builders to the
`authoring.ts` block. All three blocks are alphabetical — keep them so.

- [ ] **Step 8: Run the reducer test to verify it passes**

Run: `npx vitest run shared/src/reduce.packing.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 9: Fix the two now-false unknown-op assertions**

`shared/src/reduce.test.ts:242` uses `trip.entry_status_set` as a synthetic
unknown type. It is known now. Swap it for **S10's**, which stays unknown
through this slice:

```ts
  it('retains an unknown op type without folding it and without rejecting it', () => {
    const state = fold([
      unknownOp('trip.entry_outcome_set'),
      unknownOp('gear.weighed'),
    ])
    expect(state.unfolded).toEqual({
      count: 2,
      types: { 'trip.entry_outcome_set': 1, 'gear.weighed': 1 },
    })
```

`shared/src/fixtures.test.ts:46-53` asserts the **S2 fixture's own probe** stays
unfolded. **Do not edit the fixture** — testing.md is categorical that a slice
adds a fixture rather than editing a captured one, and the op is a genuine
record of what an S2-era log held. Replace the test with what is now true,
which is the stronger fact:

```ts
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
```

Also amend `fixtures.test.ts`'s file header where it says the probe "stays
unknown through S6": say instead that S9a is where it stopped being one.

- [ ] **Step 10: Regenerate the S2 snapshot and read the diff**

Run: `npx vitest run shared/src/fixtures.test.ts -u`
Then: `git diff shared/src/__snapshots__/fixtures.test.ts.snap`

Expected diff, and **nothing else**: `unfolded` drops from `{count: 1, types:
{'trip.entry_status_set': 1}}` to `{count: 0, types: {}}`, and a `trips` entry
appears holding one Trip with one Entry carrying a `status` register.
**If any other line moves, stop** — that is an existing op type's effect on
folded state drifting, which is exactly what §5.4 froze.

- [ ] **Step 11: Write the S9a fixture**

Create `shared/fixtures/s9a-packing.ops.json`. Hand-write it in the S8
fixture's envelope shape (`id`, `household_id`, `aggregate`, `aggregate_id`,
`type`, `hlc`, `device_id`, `payload`, `seq`, `received_at`) — read
`shared/fixtures/s8-pieces.ops.json` for the exact field order and id
conventions, and keep `seq` gapless from 1.

It must carry, per spec §5.4:

1. **All five op types**, at least once each.
2. A **nested container three deep** — crate → duffel → loose, via two
   `trip.entry_moved` ops on the containers plus one on a leaf inside the crate.
3. A **trip-only container** (`trip.entry_added` with
   `source: {"from": "trip_only", "name": "Crate B", "container": true}`).
4. A **Counted Entry with a Bring-count** (`trip.entry_bring_count_set`).
5. A **per-person Entry with one Piece removed** and the other two at
   different statuses (`trip.piece_removed` + two `trip.piece_status_set`).
6. A **container in `car` with unpacked contents** — the ▲ case: one
   `trip.container_stage_set` to `car`, and a content Entry left with no
   `status` register at all, so the ▲ threshold reads it through the absent
   default rather than an explicit write.
7. An **unrecognised status from a peer on a later build**
   (`{"entry_id": "…", "status": "in_the_shed"}`), which no builder can author.

Plus the scaffolding those reference: `gear.recorded` for each depot Entry (one
with `container: true`, one `kind: "counted"`, one `kind: "per_person"`),
`person.recorded` ×3, `trip.created`, three `trip.participant_added`, and the
`trip.entry_added` ops.

- [ ] **Step 12: Write the fixture test**

Create `shared/src/fixtures.s9a.test.ts`, modelled on `fixtures.s8.test.ts`.
Its header states which ops are **forward-compatibility probes** rather than
captured output — item 7, and item 3's trip-only container if no screen in this
slice authors one. Assert the snapshot, plus the three facts a snapshot alone
would not make legible:

```ts
  it('folds the unrecognised status verbatim and never coerces it', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, PROBE_ENTRY)?.status?.value).toBe('in_the_shed')
  })

  it('folds a stage on the container and a status on its contents', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(entryOf(state, CRATE)?.stage?.value).toBe('car')
    expect(entryOf(state, CRATE)?.status).toBeUndefined()
    expect(entryOf(state, STOVE)?.residence?.value).toEqual({
      in: 'container',
      entryId: CRATE,
    })
  })

  it('keeps the removed Piece tombstoned while its siblings carry statuses', () => {
    const state = fold(fixture as OpEnvelope[])
    const pieces = entryOf(state, HEADLAMP)?.pieces
    expect(pieces?.[KIM]?.removed?.value).toBe(true)
    expect(pieces?.[MARK]?.status?.value).toBe('packed')
    expect(pieces?.[ELS]?.status?.value).toBe('not_packed')
  })
```

- [ ] **Step 13: Run the whole suite**

Run: `npx vitest run`
Expected: PASS in full. If `convergence.test.ts` or any `app/` suite moved,
stop and read why — nothing in this task should have reached them.

- [ ] **Step 14: Commit**

Stage `shared/src/state.ts`, `payloads.ts`, `reduce.ts`, `authoring.ts`,
`index.ts`, `reduce.packing.test.ts`, `reduce.test.ts`, `fixtures.test.ts`,
`__snapshots__/fixtures.test.ts.snap`, `shared/fixtures/s9a-packing.ops.json`
and `shared/src/fixtures.s9a.test.ts`, then commit with this message:

```
Fold S9a's five packing ops, and discharge the S2 fixture's probe

The two tracks domain §7 names become five registers over two entity paths:
status and residence on both the Entry and the Piece, stage on the Entry
alone. Separate registers is what makes invariant 12 structural — no merge
can make where and how-far-along agree, so the duffel in the car with an
unpacked stove inside it survives every exchange as a reportable fact.

Neither open-enum handler gates on the containment trait, and neither may:
the trait lives on the Gear aggregate with no ordering against the Trip's, so
a gate here would make the fold order-dependent on whether gear.recorded had
arrived. Sync §3.7's never-both is an authoring rule; the gate is on the way
out, in packing.ts.

The S2 fixture has carried a trip.entry_status_set since S2a as an
unknown-type probe. It folds now, so the assertion that it stays unknown is
replaced by the other end of the same promise: the op sat verbatim in a log
across seven slices and a later build read it, with nothing discarded and
nothing re-sent. The fixture itself is untouched — a slice adds one rather
than editing a captured one.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 2: `packing.ts` — two tables, and every question with a function beside it

Spec §3.1. This is `trip.ts`'s `PHASES` pattern applied a second time, and the
reason it is a table rather than branches is **story 20**: per-trip editable
statuses must widen an existing mechanism, not rewrite hard-coded cases.

**Files:**
- Create: `shared/src/selectors/packing.ts`
- Create: `shared/src/selectors/packing.test.ts`
- Modify: `shared/src/selectors/entry.ts` (add `isContainerEntry`)
- Modify: `shared/src/index.ts` (export the new surface)

**Interfaces:**
- Consumes: `EntryState`, `PieceState`, `StatusValue`, `StageValue`,
  `TripState`, `HouseholdState` (Task 1); `entryKind` (`selectors/entry.ts`).
- Produces:
  - `isContainerEntry(entry: EntryState, state: HouseholdState): boolean` — in `entry.ts`
  - `type StatusKey = 'not_packed' | 'staged' | 'packed'`
  - `type StageKey = 'home' | 'staging' | 'car' | 'packed'`
  - `interface PackingStatus { id: StatusKey; label: string; glyph: string; packed: boolean }`
  - `interface JourneyStage { id: StageKey; label: string; disagreementLabel: string | null }`
  - `const STATUSES: readonly PackingStatus[]`, `const STAGES: readonly JourneyStage[]`
  - `statusOf(entry: EntryState, state: HouseholdState): StatusValue | null`
  - `pieceStatusOf(piece: PieceState | undefined, entry: EntryState, state: HouseholdState): StatusValue | null`
  - `stageOf(entry: EntryState, state: HouseholdState): StageValue | null`
  - `statusLabel(status: StatusValue): string`, `statusGlyph(status: StatusValue): string`
  - `stageLabel(stage: StageValue): string`, `stageDisagreementLabel(stage: StageValue): string | null`
  - `nextStatus(status: StatusValue): StatusValue`
  - `isPacked(status: StatusValue): boolean`
  - `isKnownStatus(status: StatusValue): boolean`, `isKnownStage(stage: StageValue): boolean`

- [ ] **Step 1: Add `isContainerEntry` to `shared/src/selectors/entry.ts`**

Beside `entryKind`, which is where "what does this Entry's Gear say" already
lives. `entriesOf`, `entryKind`, `bringCountOf` and `piecesOf` are **not**
touched (spec §3.6) — this is a new function beside them.

```ts
/**
 * Does this Entry carry a **journey** rather than a status?
 *
 * A depot Entry is a container when its Gear's `container` register says so;
 * a trip-only Entry when its own `source.container` does. Nothing else is,
 * including — deliberately — **a depot Entry whose Gear has not reached this
 * replica** (spec §1.3). `entryKind` already reads that case as the ordinary
 * cross-aggregate race rather than an error, and the conservative direction
 * is the same one `pieceCountOf` takes: the Entry carries a status, counts as
 * a piece, and starts carrying a journey the moment the Gear arrives.
 * Asserting a journey for gear nobody has described would draw a rail with no
 * container under it.
 *
 * This is the one place the question is answered. `statusOf`, `stageOf`,
 * `pieceCountOf` and `tripContainmentView` all read it, and a call site
 * re-deriving `state.gear[…]?.container?.value === true` will miss the
 * trip-only half.
 */
export function isContainerEntry(
  entry: EntryState,
  state: HouseholdState,
): boolean {
  const source = entry.source?.value
  if (source === undefined) return false
  if (source.from === 'trip_only') return source.container
  return state.gear[source.gearId]?.container?.value === true
}
```

- [ ] **Step 2: Write the failing test**

Create `shared/src/selectors/packing.test.ts`. Build states with the Task 1
builders through the same envelope helper `reduce.packing.test.ts` uses.

```ts
describe('the two tables', () => {
  it('lists three statuses and four stages, in drawn order', () => {
    expect(STATUSES.map((s) => s.id)).toEqual(['not_packed', 'staged', 'packed'])
    expect(STAGES.map((s) => s.id)).toEqual(['home', 'staging', 'car', 'packed'])
  })

  it('draws the labels the boards draw', () => {
    expect(STATUSES.map((s) => s.label)).toEqual(['NOT PACKED', 'STAGED', 'PACKED'])
    expect(STAGES.map((s) => s.label)).toEqual(['⌂ HOME', 'STAGING', 'CAR', 'PACKED'])
  })

  it('gives only car and packed a disagreement phrase — staging IS the act', () => {
    expect(stageDisagreementLabel('home')).toBeNull()
    expect(stageDisagreementLabel('staging')).toBeNull()
    expect(stageDisagreementLabel('car')).toBe('IN CAR')
    expect(stageDisagreementLabel('packed')).toBe('PACKED')
  })
})

describe('the absent reads', () => {
  it('reads an Entry with no status register as not_packed', () => {
    // Reachable in ordinary use, not only in a fixture: no op writes the
    // register at `trip.entry_added`, so every Entry begins with neither.
    expect(statusOf(anEntry(), state)).toBe('not_packed')
  })

  it('reads a container with no stage register as home', () => {
    expect(stageOf(aContainer(), state)).toBe('home')
  })

  it('reads a Piece with no status register as not_packed', () => {
    expect(pieceStatusOf(undefined, aPerPersonEntry(), state)).toBe('not_packed')
  })
})

describe('stage xor status is a reader gate, not a reducer gate', () => {
  it('answers null from statusOf for a container, whatever the register holds', () => {
    // A peer on another build may write one; the reader must not reject it.
    const state = foldOf(
      containerGear(CRATE_GEAR),
      entryAdded(CRATE, CRATE_GEAR),
      anOp(tripEntryStatusSet(TRIP, CRATE, 'packed'), at(1)),
    )
    expect(statusOf(entry(state, CRATE), state)).toBeNull()
  })

  it('answers null from stageOf for a non-container, whatever the register holds', () => {
    expect(stageOf(entry(state, STOVE), state)).toBeNull()
  })

  it('treats a depot Entry whose Gear has not synced as not a container', () => {
    // The Entry names a gear id no `gear.recorded` has arrived for.
    expect(statusOf(entry(state, ORPHAN), state)).toBe('not_packed')
    expect(stageOf(entry(state, ORPHAN), state)).toBeNull()
  })

  it('gains a rail the moment that Gear arrives', () => {
    const after = fold([containerGear(ORPHAN_GEAR)], state)
    expect(stageOf(entry(after, ORPHAN), after)).toBe('home')
    expect(statusOf(entry(after, ORPHAN), after)).toBeNull()
  })
})

describe('an unrecognised status', () => {
  it('is drawn verbatim', () => {
    expect(statusLabel('in_the_shed')).toBe('in_the_shed')
  })
  it('is not packed', () => {
    expect(isPacked('in_the_shed')).toBe(false)
  })
  it('cycles to not_packed — the only answer that is not an invention', () => {
    expect(nextStatus('in_the_shed')).toBe('not_packed')
  })
  it('is not known', () => {
    expect(isKnownStatus('in_the_shed')).toBe(false)
    expect(isKnownStage('in_the_shed')).toBe(false)
  })
})

describe('nextStatus', () => {
  it('cycles not_packed to staged to packed and back', () => {
    expect(nextStatus('not_packed')).toBe('staged')
    expect(nextStatus('staged')).toBe('packed')
    expect(nextStatus('packed')).toBe('not_packed')
  })
})

describe('isPacked is the only definition of packed-ness', () => {
  it('does not count staged', () => {
    // The board's `48/61` with `13 LEFT` and the `○ LEFT` pill all read this
    // one predicate; S10's close gate will too.
    expect(isPacked('staged')).toBe(false)
    expect(isPacked('packed')).toBe(true)
    expect(isPacked('not_packed')).toBe(false)
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run shared/src/selectors/packing.test.ts`
Expected: FAIL — no such module.

- [ ] **Step 4: Write `shared/src/selectors/packing.ts`**

```ts
import type {
  HouseholdState,
  EntryState,
  PieceState,
  StageValue,
  StatusValue,
} from '../state.ts'
import { isContainerEntry } from './entry.ts'

/**
 * **Packing's read side** — beside `trip.ts` and `owner.ts`, and the same
 * shape of problem solved the same way: a handful of facts several surfaces
 * must agree on, stated once here rather than at each of them.
 *
 * Three of those facts outlive this slice, which is why they are functions
 * and not idioms:
 *
 * - **An absent `status` register reads `not_packed`; an absent `stage` reads
 *   `home`**, and only {@link statusOf} / {@link pieceStatusOf} /
 *   {@link stageOf} say so. This is `ownerOf`'s rule and `phaseOf`'s rule for
 *   a fourth and fifth time. The fold conflates nothing — absent and an
 *   explicit `"not_packed"` stay different facts about the log — but every
 *   reader treats them alike, and saying so exactly once is what stops the
 *   row, the group count, the progress line and the ▲ line drifting apart.
 *   The symptom of a call site re-deriving it is a row drawn `NOT PACKED`
 *   while the group header counts it packed.
 * - **{@link isPacked} is the only definition of packed-ness in the
 *   codebase** — {@link isActive}'s sibling and for its reason. The
 *   numerator, `N LEFT`, the `○ LEFT` filter and S10's close gate must never
 *   disagree about what counts. `staged` is **not** packed.
 * - **`stage` xor `status` is a gate on the way out, never in the reducer**
 *   (spec §1.3). The containment trait lives on the Gear aggregate, so a
 *   reducer resolving it would make the fold order-dependent on whether
 *   `gear.recorded` had arrived. Both registers fold unconditionally; these
 *   two functions decide which one a reader may see.
 *
 * **There is deliberately no `nextStage`.** Ruling A15 makes the rail a
 * direct set, so a "next" would be a function with no caller and an idiom the
 * design round retired.
 */

/** The three statuses this build knows, as a **closed** union — deliberately
 * narrower than {@link StatusValue}, exactly as `PhaseKey` is narrower than
 * `PhaseValue`. A key is a row in {@link STATUSES}; a value is whatever
 * arrived, and asking it a question has to go through a lookup that can
 * miss. */
export type StatusKey = 'not_packed' | 'staged' | 'packed'
export type StageKey = 'home' | 'staging' | 'car' | 'packed'

export interface PackingStatus {
  id: StatusKey
  /** `NOT PACKED` · `STAGED` · `PACKED`. */
  label: string
  /** `○` · `◐` · `●` — the pill, the `SET EVERYONE` chips and the count line
   * all draw it, so it is a column of the table rather than a switch at three
   * call sites. */
  glyph: string
  /** What {@link isPacked} reads. Exactly one row carries `true`. */
  packed: boolean
}

export interface JourneyStage {
  id: StageKey
  /** `⌂ HOME` · `STAGING` · `CAR` · `PACKED`. */
  label: string
  /**
   * The ▲ line's own word for this stage — `IN CAR`, `PACKED` — or `null`
   * where the line never fires.
   *
   * **One field, not a boolean plus a string**, so ruling A6's "fires at
   * `car` and `packed` only" cannot drift from the phrasing it fires with.
   * It is a second string rather than a transform of {@link label} for
   * `Phase.name`'s reason: `CAR` becomes `IN CAR` and `PACKED` stays
   * `PACKED`, and no function gets both right without knowing what kind of
   * word each is — which is what the table knows and a screen does not.
   *
   * `staging` is `null` because **staging *is* the act of packing**: unpacked
   * contents on the staging floor are the work, not a contradiction.
   */
  disagreementLabel: string | null
}

/** In the pill's cycle order, which the `SET EVERYONE` chips also draw. */
export const STATUSES: readonly PackingStatus[] = [
  { id: 'not_packed', label: 'NOT PACKED', glyph: '○', packed: false },
  { id: 'staged', label: 'STAGED', glyph: '◐', packed: false },
  { id: 'packed', label: 'PACKED', glyph: '●', packed: true },
]

/** In the rail's drawn order — the sequence a container usually runs, though
 * ruling A15 makes every chip a direct set in either direction. */
export const STAGES: readonly JourneyStage[] = [
  { id: 'home', label: '⌂ HOME', disagreementLabel: null },
  { id: 'staging', label: 'STAGING', disagreementLabel: null },
  { id: 'car', label: 'CAR', disagreementLabel: 'IN CAR' },
  { id: 'packed', label: 'PACKED', disagreementLabel: 'PACKED' },
]

/**
 * The rows, or `undefined` for a value this build has never heard of.
 *
 * **Private on purpose**, for the reason `phaseRow` gives and three S6
 * reviews caught: every question the tables answer has a named function
 * beside it, so no caller has to remember what a missing row means. A
 * question wanting a row exports a named function beside these rather than
 * the lookup.
 */
function statusRow(status: StatusValue): PackingStatus | undefined {
  return STATUSES.find((row) => row.id === status)
}

function stageRow(stage: StageValue): JourneyStage | undefined {
  return STAGES.find((row) => row.id === stage)
}

/**
 * The Entry's status, or `null` for a **container** — which carries a journey
 * *instead of* a status (sync §3.7) and can therefore never be marked packed.
 *
 * `null` is returned whatever the register holds: a peer on another build may
 * have written one, and the tolerant reader folds it rather than rejecting
 * it. This is the gate spec §1.3 keeps out of the reducer.
 */
export function statusOf(
  entry: EntryState,
  state: HouseholdState,
): StatusValue | null {
  if (isContainerEntry(entry, state)) return null
  return entry.status?.value ?? 'not_packed'
}

/**
 * One Piece's status. `piece` may be `undefined` — a Piece is **derived**
 * (`piece.ts`), so a Participant who has never been addressed by a Piece op
 * has no `PieceState` at all and must still answer `not_packed`.
 */
export function pieceStatusOf(
  piece: PieceState | undefined,
  entry: EntryState,
  state: HouseholdState,
): StatusValue | null {
  if (isContainerEntry(entry, state)) return null
  return piece?.status?.value ?? 'not_packed'
}

/** The container's journey stage, or `null` for a non-container. */
export function stageOf(
  entry: EntryState,
  state: HouseholdState,
): StageValue | null {
  if (!isContainerEntry(entry, state)) return null
  return entry.stage?.value ?? 'home'
}

/** How a status is drawn. An unrecognised value renders **verbatim** —
 * `trip.ts`'s answer for an unrecognised phase, and §5.3 obligation 4's. */
export function statusLabel(status: StatusValue): string {
  return statusRow(status)?.label ?? status
}

/** The pill's glyph. An unrecognised value draws `○` — it is not packed, and
 * the pill must still paint something. */
export function statusGlyph(status: StatusValue): string {
  return statusRow(status)?.glyph ?? '○'
}

export function stageLabel(stage: StageValue): string {
  return stageRow(stage)?.label ?? stage
}

/** Ruling A6's threshold, half of it: which stages the ▲ line fires at, and
 * what it calls them. `null` for `home`, `staging` and anything unrecognised
 * — a build that cannot name a stage cannot claim a disagreement about it. */
export function stageDisagreementLabel(stage: StageValue): string | null {
  return stageRow(stage)?.disagreementLabel ?? null
}

/**
 * The pill's cycle: `not_packed → staged → packed → not_packed`.
 *
 * An unrecognised value cycles to `not_packed` — **the only answer that is
 * not an invention**. Guessing a position in a sequence this build does not
 * hold would author a status on the strength of a spelling.
 */
export function nextStatus(status: StatusValue): StatusValue {
  const index = STATUSES.findIndex((row) => row.id === status)
  if (index === -1) return 'not_packed'
  return (STATUSES[(index + 1) % STATUSES.length] as PackingStatus).id
}

/**
 * **The only definition of packed-ness in the codebase.** The numerator,
 * `N LEFT`, the `○ LEFT` filter, every group count and S10's close gate read
 * this and nothing else. An unrecognised status is not packed.
 */
export function isPacked(status: StatusValue): boolean {
  return statusRow(status)?.packed === true
}

export function isKnownStatus(status: StatusValue): boolean {
  return statusRow(status) !== undefined
}

export function isKnownStage(stage: StageValue): boolean {
  return stageRow(stage) !== undefined
}
```

- [ ] **Step 5: Export from `shared/src/index.ts` and run the test**

Add a `selectors/packing.ts` block alongside the existing selector blocks.

Run: `npx vitest run shared/src/selectors/packing.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and commit**

Run: `npx vitest run` — PASS in full.

Stage `shared/src/selectors/packing.ts`, `packing.test.ts`,
`shared/src/selectors/entry.ts`, `shared/src/index.ts`, then commit:

```
State the packing statuses and the journey stages as two tables

trip.ts's PHASES pattern, applied a second time and for its reason: story 20
makes these editable per trip, so they must already be seed values of a
mechanism rather than hard-coded branches. Each row carries its own label,
and the stage row carries the ▲ line's phrasing as one field rather than a
boolean beside a string, so ruling A6's "fires at car and packed only" cannot
drift from the words it fires with.

The row lookups stay private. Every question has a named function beside it,
which is the fix three S6 reviews caught the absence of: no call site decides
for itself what a missing row means.

statusOf and stageOf are where sync §3.7's never-both is enforced — on the
way out, never in the reducer, because the containment trait lives on the
Gear aggregate and a reducer resolving it would make the fold order-dependent
on whether gear.recorded had arrived. isContainerEntry is the one place that
question is answered, and it reads a not-yet-synced Gear as not a container:
asserting a journey for gear nobody has described would draw a rail with no
container under it.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 3: `tripContainment.ts` — the Trip's own tree

Spec §3.2. `containment.ts`'s twin over `TripResidence`. **A second file, not a
parameter on the first**: the two worlds resolve against different things — one
against Places and Gear, the other against Entries — and a shared implementation
would take a strategy object for every line of it.

**Read `shared/src/selectors/containment.ts` in full before writing this.** The
traversal, the `parentOf` functional-graph argument, the `seen` guard and
`lowestEdgeOf` are all transplanted, and the two must not drift.

**Files:**
- Create: `shared/src/selectors/tripContainment.ts`
- Create: `shared/src/selectors/tripContainment.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `compareStamps` (`../hlc.ts`), `stampOf` (`../registers.ts`),
  `entriesOf` and `isContainerEntry` (`./entry.ts`), `TripResidence`.
- Produces:
  - `type TripHolderRef = { kind: 'container'; entryId: string } | { kind: 'loose' }`
  - `interface TripContainmentView { holderOf(entryId: string): TripHolderRef; childrenOf(ref: TripHolderRef): readonly string[]; brokenEdges: ReadonlySet<string> }`
  - `tripContainmentView(trip: TripState, state: HouseholdState): TripContainmentView`
  - `tripPath(trip: TripState, state: HouseholdState, entryId: string, view?: TripContainmentView): readonly TripPathSegment[]` where `TripPathSegment = { entryId: string; name: string }`, outermost first — the Pack picker's skipped-ancestry line and ALL mode's residence segment both read it.

- [ ] **Step 1: Write the failing test**

Create `shared/src/selectors/tripContainment.test.ts`.

```ts
describe('the four loose-reasons', () => {
  it('reads a pointer at an Entry this replica has not folded as loose', () => {
    const state = foldOf(entryAdded(STOVE, STOVE_GEAR), movedInto(STOVE, 'never-arrived'))
    expect(view(state).holderOf(STOVE)).toEqual({ kind: 'loose' })
  })

  it('reads a pointer at a removed Entry as loose', () => {
    // `trip.entry_removed` has no restore, so this is permanent rather than
    // recoverable — but it still reads loose rather than vanishing.
    const state = foldOf(/* … crate added, stove moved in, crate removed … */)
    expect(view(state).holderOf(STOVE)).toEqual({ kind: 'loose' })
  })

  it('reads a pointer at a sourceless Entry as loose', () => {
    // Already excluded from `entriesOf`; a pointer into something the reader
    // cannot see is a pointer nobody can settle.
  })

  it('reads a pointer at a non-container Entry as loose', () => {
    const state = foldOf(/* … stove moved into the headlamp … */)
    expect(view(state).holderOf(STOVE)).toEqual({ kind: 'loose' })
  })
})

describe('the cycle break', () => {
  it('breaks the edge with the lowest (hlc, device_id), identically on both replicas', () => {
    // Two Devices, apart: A puts X into Y, B puts Y into X. Per-field LWW
    // cannot prevent it — the two ops write two different registers.
    const ab = foldOf(intoY_at(10, DEV_A), intoX_at(20, DEV_B))
    const ba = foldOf(intoX_at(20, DEV_B), intoY_at(10, DEV_A))
    expect([...view(ab).brokenEdges]).toEqual([X])
    expect([...view(ba).brokenEdges]).toEqual([X])
  })

  it('uses the entry id as a canonical final tiebreak on equal stamps', () => { /* … */ })

  it('catches a self-reference as a one-node cycle', () => { /* … */ })
})

describe('replica determinism', () => {
  it('traverses sorted entry ids, so two arrival orders give one tree', () => {
    // `Object.keys` is insertion order, which two replicas that received the
    // same ops in a different order do not share. The convergence tier
    // cannot see this: it compares folded state, and this runs downstream.
    expect(childrenOfIn(orderOne)).toEqual(childrenOfIn(orderTwo))
  })

  it('returns childrenOf sorted by entry id', () => { /* … */ })
})

describe('a container move moves its contents through the pointer', () => {
  it('leaves every content status untouched (invariant 12)', () => {
    const before = foldOf(/* crate in loose, stove inside it, stove not_packed */)
    const after = fold([anOp(tripContainerStageSet(TRIP, CRATE, 'car'), at(9))], before)
    // The stove's holder did not change; the holder's stage did.
    expect(view(after).holderOf(STOVE)).toEqual({ kind: 'container', entryId: CRATE })
    expect(statusOf(entry(after, STOVE), after)).toBe('not_packed')
  })

  it('carries a nested subtree with one op', () => {
    // duffel → crate → stove: moving the duffel moves all three, and the
    // reducer wrote exactly one register.
  })
})

describe('tripPath', () => {
  it('lists ancestors outermost first, the gear itself not a segment', () => {
    expect(tripPath(trip, state, STOVE).map((s) => s.name)).toEqual(['Duffel 90 L', 'Crate B'])
  })
  it('gives a loose Entry an empty path', () => { /* … */ })
  it('terminates on an inconsistent view rather than looping', () => { /* … */ })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run shared/src/selectors/tripContainment.test.ts` — FAIL, no module.

- [ ] **Step 3: Write `shared/src/selectors/tripContainment.ts`**

Transplant `containment.ts` structurally. The four differences, and only these:

1. The universe is `entriesOf(trip, state)` — already sorted by label, so
   **re-sort the ids** for the traversal; `entriesOf`'s order is a *drawn*
   order and label-sorted ids are not id-sorted ids.
2. `resolvePointer` reads `entry.residence?.value` and resolves against the
   Trip's own `entries` map: reason 1 is *not in `entriesOf`* (which covers
   the missing, removed and sourceless cases at once), reason 3 is
   `!isContainerEntry`.
3. `lowestEdgeOf` reads `trip.entries?.[id]?.residence` instead of
   `state.gear[id]?.residence`.
4. There is **no Place**, so `TripHolderRef` has two members rather than three
   and `childrenOf` needs one bucket key shape (`container:<id>`) plus loose.

The header states what this file owes `containment.ts`:

```ts
/**
 * The **Trip's** containment tree — `containment.ts`'s twin over
 * {@link TripResidence}, and a second file rather than a parameter on that
 * one because the two worlds resolve against different things: one against
 * Places and Gear, the other against Entries. A shared implementation would
 * take a strategy object for every line of it.
 *
 * **The duplication is deliberate, and the two must not drift.** The half
 * that would be silent if they did is the cycle break: sync §3.6's rule,
 * verbatim — within a cycle, the edge whose `residence` register carries the
 * **lowest `(hlc, device_id)`** is reported loose, with the entry id as a
 * canonical final tiebreak. Every replica holds identical registers, so every
 * replica breaks the same edge; the fold stays untouched and every device
 * draws the same tree.
 *
 * Four reasons a pointer reads **loose**, the first three of them different
 * spellings of *the reader cannot see what it names*:
 *
 * 1. It names an Entry this replica has not folded.
 * 2. It names a **removed** Entry or a **sourceless** one — both already
 *    excluded by `entriesOf`, and a pointer into something the reader cannot
 *    see is a pointer nobody can settle.
 * 3. It names an Entry that is **not a container** (`isContainerEntry`).
 * 4. It is part of a **cycle** and was the edge broken.
 *
 * One difference from the home tree worth stating: **`trip.entry_removed` has
 * no restore**, so a pointer into a removed container is permanent rather
 * than recoverable. It still reads loose rather than vanishing — nothing is
 * deleted, and the Entry re-added under a new id is a different Entry.
 *
 * **Every iteration over entry ids is sorted**, for `containment.ts`'s own
 * stated reason: `Object.keys` returns insertion order, which two replicas
 * that received the same ops in a different order do not share, and a
 * traversal driven by it is replica-dependent in a way the convergence tier
 * **cannot see**, because it compares folded state and this runs downstream
 * of the fold. Note that `entriesOf`'s order is by *label* and is not that
 * order — sort the ids here.
 */
```

- [ ] **Step 4: Run the test — PASS. Then the whole suite.**

Run: `npx vitest run shared/src/selectors/tripContainment.test.ts`, then
`npx vitest run`.

- [ ] **Step 5: Commit**

```
Give the Trip its own containment tree

containment.ts's twin over TripResidence, and a second file rather than a
parameter on that one: the two worlds resolve against different things — one
against Places and Gear, the other against Entries — and a shared
implementation would take a strategy object for every line.

The duplication is deliberate and logged as debt. The half that would be
silent if the two drifted is the cycle break, so it is sync §3.6's rule
verbatim: the edge whose residence register carries the lowest
(hlc, device_id) reads loose, entry id as the canonical final tiebreak. Two
devices apart can author a cycle that per-field LWW cannot prevent, because
the two ops write two different registers.

The traversal iterates sorted entry ids and not entriesOf's order, which is
by label. Object.keys is insertion order, and a traversal driven by it
diverges between replicas that received the same ops in a different order —
a failure the convergence tier cannot see, since it compares folded state and
this runs downstream of the fold.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 4: A container is not a piece — `pieceCountOf` narrows

Spec §3.3, ruling A5. **The one change this slice makes to shipped behaviour**,
so it is its own reviewable unit: a reviewer could sanely accept the counts in
Task 5 and reject this.

Sync §3.7's *never both on one entry* means a container carries a journey
**instead of** a status, so it can never be marked packed — and a denominator
holding things that can never be counted makes `61` unreachable. That is
invariant 18's own shape, one slice early.

**Files:**
- Modify: `shared/src/selectors/entry.ts` (`pieceCountOf`, and `listTotals` follows for free)
- Modify: `shared/src/selectors/entry.test.ts`

**Interfaces:**
- Consumes: `isContainerEntry` (Task 2).
- Produces: no new export. `pieceCountOf(entry, trip, state)` returns `0` for a
  container Entry; `listTotals(trip, state).pieces` follows.

- [ ] **Step 1: Write the failing test**

Add to `shared/src/selectors/entry.test.ts`:

```ts
describe('a container is not a piece (ruling A5)', () => {
  it('counts a depot container Entry as zero pieces', () => {
    expect(pieceCountOf(entry(state, CRATE), trip, state)).toBe(0)
  })

  it('counts a trip-only container Entry as zero pieces', () => {
    expect(pieceCountOf(entry(state, CRATE_B), trip, state)).toBe(0)
  })

  it('still lists a container and still counts it as an ENTRY', () => {
    // ENTRIES counts the list, PIECES counts what travels (ruling D). A5 is
    // that sentence read carefully — `entriesOf` is untouched.
    expect(entriesOf(trip, state).map((e) => e.id)).toContain(CRATE)
    expect(listTotals(trip, state).entries).toBe(3)
  })

  it('leaves a container out of listTotals.pieces', () => {
    // Two non-container Entries at one piece each, one container.
    expect(listTotals(trip, state).pieces).toBe(2)
  })

  it('counts a not-yet-synced Gear as one piece, not zero', () => {
    // `isContainerEntry` reads it as not-a-container — the conservative
    // direction, matching `entryKind`'s `undefined` and `pieceCountOf`'s own
    // default.
    expect(pieceCountOf(entry(state, ORPHAN), trip, state)).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run shared/src/selectors/entry.test.ts` — FAIL, `0` received `1`.

- [ ] **Step 3: Narrow `pieceCountOf`**

```ts
/**
 * How many things this Entry is — the spec's table, followed exactly:
 *
 * | Entry | Pieces |
 * | --- | --- |
 * | **Container Entry (depot or trip-only)** | **`0`** — ruling A5 |
 * | Single depot Entry | `1` |
 * | Counted depot Entry | {@link bringCountOf}, absent reads `1` |
 * | Per-person depot Entry | {@link piecesOf}`(entry, trip).length` |
 * | Trip-only Entry | `1` — no Kind to be Counted by |
 * | Gear with an unrecognised Kind | `1` — the conservative direction |
 * | Depot Entry whose Gear is not yet synced | `1` — {@link entryKind} reads `undefined`, defaulted exactly like an unrecognised Kind |
 *
 * **The container row is ruling A5, and it narrows ruling L rather than
 * breaking it.** *PIECES is the trip arithmetic only* stands; A5 states what
 * that arithmetic counts — things that carry a status. A container carries a
 * journey *instead of* a status (sync §3.7), so it can never be marked
 * packed, and a denominator holding things that can never be counted makes
 * `61` unreachable. That is invariant 18's own shape one slice early:
 * trip-only Entries are excluded from S10's open count because they take no
 * outcome.
 *
 * **{@link entriesOf} is untouched.** A container is still a line on the gear
 * list, still counted by `N ENTRIES`, still removable with its `✕` —
 * *ENTRIES counts the list, PIECES counts what travels* (ruling D).
 *
 * **Claims are untouched.** `claim.ts` reads this function's *rule* rather
 * than the function, and its own `claimFor` gives a Single container Entry a
 * count of `1` — correctly: two active Trips cannot both take the one duffel,
 * and a supply rule is not a packing arithmetic.
 */
export function pieceCountOf(
  entry: EntryState,
  trip: TripState,
  state: HouseholdState,
): number {
  if (isContainerEntry(entry, state)) return 0
  switch (entryKind(entry, state)) {
    case 'counted':
      return bringCountOf(entry, state) ?? 1
    case 'per_person':
      return piecesOf(entry, trip).length
    default:
      return 1
  }
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`

**Expect `app/` failures and read each one.** `GearListSection`, `Trip` and
`GearListBuilder` all draw `N PIECES` from `listTotals`, so any fixture in
those suites holding a container Entry will move by design. Update the
expected number where the fixture holds a container; **do not** update one
where it does not, because that is a different bug.

Also check `shared/src/selectors/claim.test.ts` did **not** move. If it did,
`claim.ts` is reading `pieceCountOf` rather than its rule and the spec's
"claims are untouched" is wrong — stop and report.

- [ ] **Step 5: Commit**

```
Stop counting containers as pieces

Ruling A5, and the one change this slice makes to shipped behaviour. Sync
§3.7 gives a container a journey instead of a status, so it can never be
marked packed — and a denominator holding things that can never be counted
makes 61 unreachable. Invariant 18's own shape, one slice early.

This narrows ruling L rather than breaking it: PIECES is still the trip
arithmetic only, and A5 states what that arithmetic counts — things that
carry a status. entriesOf is untouched, so a container is still a line, still
an ENTRY, still removable. ENTRIES counts the list; PIECES counts what
travels.

No number on any existing board changes, because no drawn gear list holds a
container Entry. The numbers that move are on a real household's Trip, and
they move to the truth.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 5: The counts, the person partition, and the disagreement threshold

Spec §3.4 and §3.5. Four count lines, **one predicate** (`isPacked`), and every
one of them excludes containers.

**The spine is one derivation.** A packing *item* is either a whole Entry
(Single, Counted, trip-only) or **one Piece** of a per-person Entry — that is
the unit the totals sum, the container groups filter, the person partition
buckets, and the `○ LEFT` pill tests. Deriving it once is what makes the four
agree; deriving it four times is the drift `packing.ts`'s header warns about.

**One decision the spec does not take, and this task takes it.** A Piece with
**no `residence` register of its own falls back to its Entry's**, then to
`loose`. `trip.entry_moved` on a per-person Entry is a legitimate op — *the
whole headlamp set goes in the duffel* — and the Piece ops are the refinement;
reading an absent Piece residence as `loose` would silently discard that. It
degrades to `loose` when the Entry has no residence either, and it conflates
nothing: the two registers stay distinct facts about the log. **Record it in the
slice's own "what changed during implementation" section at Task 13**, the
precedent `the-gear-list.md` §11 sets.

**Files:**
- Modify: `shared/src/selectors/packing.ts` (append; the header gains a paragraph)
- Create: `shared/src/selectors/packing.counts.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `statusOf`, `pieceStatusOf`, `stageOf`, `isPacked`,
  `stageDisagreementLabel` (Task 2); `entriesOf`, `entryKind`, `bringCountOf`,
  `isContainerEntry` (Tasks 2 and 4); `piecesOf`, `pieceInclusion`
  (`selectors/piece.ts`); `ownerOf` (`selectors/owner.ts`);
  `tripContainmentView` (Task 3).
- Produces:
  - `type PackingItem = { kind: 'entry'; entryId: string; units: number; status: StatusValue; residence: TripResidence } | { kind: 'piece'; entryId: string; personId: string; units: 1; status: StatusValue; residence: TripResidence }`
  - `packingItems(trip: TripState, state: HouseholdState): readonly PackingItem[]`
  - `interface PackingCount { readonly packed: number; readonly total: number; readonly left: number }`
  - `packingTotals(trip: TripState, state: HouseholdState): PackingCount`
  - `countOf(items: readonly PackingItem[]): PackingCount`
  - `containerTotals(trip, state, entryId, view?): PackingCount`
  - `type PersonBucketKey = { kind: 'person'; personId: string } | { kind: 'shared' }`
  - `interface PersonBucket { readonly key: PersonBucketKey; readonly items: readonly PackingItem[]; readonly count: PackingCount }`
  - `personPartition(trip, state): readonly PersonBucket[]`
  - `interface Disagreement { readonly entryId: string; readonly label: string; readonly notPacked: number }`
  - `disagreements(trip, state, view?): readonly Disagreement[]`

- [ ] **Step 1: Write the failing test**

Create `shared/src/selectors/packing.counts.test.ts`. Build one Trip that
exercises every branch and assert against it — the fixture the whole file
shares:

```ts
/**
 * One Trip, holding every branch the four counts have to agree about:
 * a Counted Entry with a Bring-count of 3, a per-person Entry with one of
 * three Pieces removed, a Single Entry owned by a **non-Participant**, a
 * Shared Single, a container in `car` with an unpacked Single inside it, and
 * a nested container two deep.
 */
```

```ts
describe('packingItems is the spine', () => {
  it('gives a Counted Entry one item carrying its whole Bring-count', () => {
    const item = itemFor(STOVE)
    expect(item?.kind).toBe('entry')
    expect(item?.units).toBe(3)
  })

  it('gives a per-person Entry one item per INCLUDED Piece', () => {
    // Three Participants, Kim's Piece removed: two items, one unit each.
    const items = itemsFor(HEADLAMP)
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.units === 1)).toBe(true)
    expect(items.map((i) => i.personId)).not.toContain(KIM)
  })

  it('gives a container no item at all', () => {
    expect(itemsFor(CRATE)).toEqual([])
  })

  it('gives a sourceless Entry no item — entriesOf already excludes it', () => {
    expect(itemsFor(ORPHANED)).toEqual([])
  })

  it('falls a Piece with no residence back to its Entry residence', () => {
    // A decision the spec does not take. `trip.entry_moved` on a per-person
    // Entry is legitimate — the whole headlamp set goes in the duffel — and
    // the Piece ops refine it; reading absent as loose would discard that.
    const state = fold([anOp(tripEntryMoved(TRIP, HEADLAMP, inCrate), at(9))], base)
    expect(itemsFor(HEADLAMP, state).every((i) => sameRes(i.residence, inCrate))).toBe(true)
  })

  it('lets a Piece residence override its Entry residence', () => { /* … */ })
  it('falls back to loose when neither register is set', () => { /* … */ })
})

describe('packingTotals', () => {
  it('counts packed, total and left over every item', () => {
    expect(packingTotals(trip, state)).toEqual({ packed: 4, total: 9, left: 5 })
  })

  it('does not count staged as packed', () => { /* the `48/61` predicate */ })

  it('excludes containers from the denominator', () => {
    // Two containers on this Trip and neither reaches `total`.
    expect(packingTotals(trip, state).total).toBe(9)
  })

  it('counts an unrecognised status as not packed', () => { /* … */ })
})

describe('a container group counts its subtree at any depth', () => {
  it("includes a nested container's contents in its ancestor's count", () => {
    // The duffel's twelve include the stuff sack's four. A nested group's own
    // rows are counted twice on screen — once in its header and once in its
    // ancestor's — which is what "everything in the duffel" means to a
    // household carrying it.
    expect(containerTotals(trip, state, DUFFEL)).toEqual({ packed: 2, total: 4, left: 2 })
    expect(containerTotals(trip, state, STUFFSACK)).toEqual({ packed: 1, total: 2, left: 1 })
  })

  it('counts a Counted Entry inside it by its whole Bring-count', () => { /* … */ })
  it('counts the container itself as nothing', () => { /* … */ })
})

describe('the person partition is total (ruling A7)', () => {
  it('puts each included Piece in its own Participant bucket', () => { /* … */ })

  it("puts Personal gear in its owner's bucket, participant or not", () => {
    // The header answers *whose it is*, and Els's jacket carried by Mark is
    // honest. *Whose body it goes with* is story 23, Later.
    expect(bucketFor(ELS).items.map((i) => i.entryId)).toContain(JACKET)
    expect(participantIds(trip)).not.toContain(ELS)
  })

  it('puts everything else in Shared', () => { /* … */ })

  it('lands every non-container item in exactly one bucket', () => {
    const partitioned = personPartition(trip, state).flatMap((b) => b.items)
    expect(partitioned).toHaveLength(packingItems(trip, state).length)
  })

  it('sums to packingTotals — the assertion the drawn frame would have failed', () => {
    // `9/13 + 12/12 + 6/9 + 21/27 = 48/61`. The drawn PERSON frame was a
    // complete partition that only carry-assignment (story 23) could produce.
    const buckets = personPartition(trip, state)
    const packed = buckets.reduce((n, b) => n + b.count.packed, 0)
    const total = buckets.reduce((n, b) => n + b.count.total, 0)
    expect({ packed, total }).toEqual({
      packed: packingTotals(trip, state).packed,
      total: packingTotals(trip, state).total,
    })
  })

  it('returns buckets in person-id order with shared distinguished, not drawn order', () => {
    // `piecesOf`'s own rule: the drawn order is `sortedPeople`'s and lives at
    // the screen, and `Shared` goes last there (ruling A3's argument, and a
    // deliberate divergence from GROUP BY OWNER, which pins shared first).
  })
})

describe('the disagreement threshold (ruling A6)', () => {
  it('fires at car', () => {
    expect(disagreements(trip, state)).toContainEqual({
      entryId: CRATE, label: 'IN CAR', notPacked: 3,
    })
  })

  it('fires at packed', () => { /* label `PACKED` */ })

  it('does not fire at home', () => { /* … */ })

  it('does not fire at staging — staging IS the act of packing', () => {
    // Counting `staged` would fire on nearly every container in the car and
    // the ▲ would stop meaning anything.
  })

  it('counts not-packed only, never staged', () => { /* … */ })

  it('counts contents at any depth', () => { /* the nested case, story 10's own */ })

  it('does not fire on a container whose contents are all packed', () => { /* … */ })

  it('says nothing about a stage this build cannot name', () => {
    // `stageDisagreementLabel` is null for an unrecognised value: a build that
    // cannot name a stage cannot claim a disagreement about it.
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run shared/src/selectors/packing.counts.test.ts` — FAIL.

- [ ] **Step 3: Append the implementation to `shared/src/selectors/packing.ts`**

```ts
/**
 * One thing that carries a status: a whole Entry, or **one Piece** of a
 * per-person Entry.
 *
 * This is the spine the four count lines share — the trip total, a container
 * group's count, a person group's count and the `○ LEFT` filter. Deriving it
 * once is what makes them agree; deriving it four times is exactly the drift
 * this file's header warns about.
 *
 * `units` is what the item contributes to a denominator: a **Counted** Entry
 * contributes its whole Bring-count (ruling A13 — one register, one pill, one
 * tap moving the count by two), everything else contributes one.
 *
 * **Containers produce no item**, and neither do sourceless or removed
 * Entries — `entriesOf` has already excluded the latter two.
 */
export type PackingItem =
  | {
      kind: 'entry'
      entryId: string
      units: number
      status: StatusValue
      residence: TripResidence
    }
  | {
      kind: 'piece'
      entryId: string
      personId: string
      units: 1
      status: StatusValue
      residence: TripResidence
    }

const LOOSE: TripResidence = Object.freeze({ in: 'loose' })

/**
 * Every item on the Trip, in `entriesOf` order with a per-person Entry's
 * Pieces in `piecesOf` order.
 *
 * **A Piece with no `residence` register of its own reads its Entry's**, then
 * `loose`. `trip.entry_moved` on a per-person Entry is a legitimate op — the
 * whole headlamp set goes in the duffel — and the Piece ops are the
 * refinement, so reading absent as `loose` would silently discard it. The two
 * registers stay distinct facts about the log; only the read is layered.
 * This is a decision the spec did not take (spec §11).
 */
export function packingItems(
  trip: TripState,
  state: HouseholdState,
): readonly PackingItem[] {
  const items: PackingItem[] = []
  for (const entry of entriesOf(trip, state)) {
    if (isContainerEntry(entry, state)) continue
    const entryResidence = entry.residence?.value ?? LOOSE
    if (entryKind(entry, state) === 'per_person') {
      for (const personId of piecesOf(entry, trip)) {
        const piece = entry.pieces?.[personId]
        items.push({
          kind: 'piece',
          entryId: entry.id,
          personId,
          units: 1,
          status: pieceStatusOf(piece, entry, state) ?? 'not_packed',
          residence: piece?.residence?.value ?? entryResidence,
        })
      }
      continue
    }
    items.push({
      kind: 'entry',
      entryId: entry.id,
      units:
        entryKind(entry, state) === 'counted'
          ? (bringCountOf(entry, state) ?? 1)
          : 1,
      status: statusOf(entry, state) ?? 'not_packed',
      residence: entryResidence,
    })
  }
  return items
}

/** `● 48/61 PIECES` and `13 LEFT`. */
export interface PackingCount {
  readonly packed: number
  readonly total: number
  readonly left: number
}

/** The one arithmetic, over any selection of items. `left` is `total −
 * packed` and not a third sum, so the two can never disagree. */
export function countOf(items: readonly PackingItem[]): PackingCount {
  let packed = 0
  let total = 0
  for (const item of items) {
    total += item.units
    if (isPacked(item.status)) packed += item.units
  }
  return { packed, total, left: total - packed }
}

export function packingTotals(
  trip: TripState,
  state: HouseholdState,
): PackingCount {
  return countOf(packingItems(trip, state))
}

/**
 * A container group's `9/12` — **its contents at any depth**. The duffel's
 * twelve include the stuff sack's four, so a nested group's own rows are
 * counted twice on screen: once in its header and once in its ancestor's.
 * That is what "everything in the duffel" means to a household carrying it.
 */
export function containerTotals(
  trip: TripState,
  state: HouseholdState,
  entryId: string,
  view: TripContainmentView = tripContainmentView(trip, state),
): PackingCount {
  const subtree = new Set<string>()
  const stack = [entryId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) continue
    for (const childId of view.childrenOf({ kind: 'container', entryId: current })) {
      if (subtree.has(childId)) continue
      subtree.add(childId)
      stack.push(childId)
    }
  }
  return countOf(
    packingItems(trip, state).filter((item) => subtree.has(item.entryId)),
  )
}
```

Then the partition and the threshold:

```ts
export type PersonBucketKey =
  | { kind: 'person'; personId: string }
  | { kind: 'shared' }

export interface PersonBucket {
  readonly key: PersonBucketKey
  readonly items: readonly PackingItem[]
  readonly count: PackingCount
}

/**
 * Ruling A7's partition: **PERSON mode means *whose it is***, which ownership
 * answers. *Whose body it goes with* is story 23, Later, and the app holds no
 * such fact — which is precisely what made the drawn frame's complete
 * partition unbuildable.
 *
 * Every item falls in exactly one bucket, tested in this order:
 *
 * 1. a **Piece** goes to its own Participant's bucket;
 * 2. otherwise the Entry's `ownerOf` — a Person's bucket, **including a
 *    Person who is not a Participant**, because the header answers whose it
 *    is and Els's jacket carried by Mark is honest;
 * 3. otherwise `Shared`.
 *
 * The partition is **total**, so the arithmetic closes on facts the MVP
 * holds: the buckets sum to {@link packingTotals} exactly, and the test that
 * asserts it is the one that would have caught the drawn frame.
 *
 * **Order here is by person id**, `Shared` distinguished by its key rather
 * than its position — `piecesOf`'s own rule, and deliberately not the drawn
 * order. Surfaces order by Person label through `sortedPeople` and put
 * `Shared` **last** (a deliberate divergence from the Depot's `GROUP BY
 * OWNER`, whose grouping table pins `shared` first: `Shared` is the
 * everything-else bucket and on a real Trip the biggest one, so first
 * position pushes every person header off-screen). That belongs at the
 * screen, not here.
 */
export function personPartition(
  trip: TripState,
  state: HouseholdState,
): readonly PersonBucket[] { /* … */ }

export interface Disagreement {
  readonly entryId: string
  /** `IN CAR` · `PACKED` — the stage's own word, from the table. */
  readonly label: string
  readonly notPacked: number
}

/**
 * Ruling A6, the rule the two drawn frames encode and neither states:
 *
 * ```
 * disagreeing(entry) = stageDisagreementLabel(stageOf(entry)) !== null
 *                      ∧ count of not-packed contents, at any depth, > 0
 * ```
 *
 * `car` and `packed` only — **staging *is* the act of packing**, so unpacked
 * contents on the staging floor are the work, not a contradiction.
 * `not packed` only — counting `staged` would fire on nearly every container
 * in the car and the ▲ would stop meaning anything.
 *
 * A **pure function of the fold**, like `overClaims` and unlike anything with
 * an op: every replica computes the identical set, and it goes away when a
 * Quartermaster packs the contents or moves the container back — both
 * ordinary ops, nothing discarded (invariant 12).
 */
export function disagreements(
  trip: TripState,
  state: HouseholdState,
  view: TripContainmentView = tripContainmentView(trip, state),
): readonly Disagreement[] { /* … */ }
```

- [ ] **Step 4: Run the test — PASS. Then the whole suite.**

Run: `npx vitest run shared/src/selectors/packing.counts.test.ts`, then
`npx vitest run`.

- [ ] **Step 5: Commit**

```
Derive the packing arithmetic once, and partition PERSON mode by ownership

Four count lines share one spine: a packing item is a whole Entry or one
Piece of a per-person Entry, and the trip total, a container group's count, a
person group's count and the ○ LEFT filter all read the same list through the
same isPacked. Deriving it four times is the drift packing.ts's header warns
about. `left` is total − packed rather than a third sum, so the two cannot
disagree.

PERSON mode means whose it is, not whose body it goes with — ruling A7. The
drawn frame's arithmetic was a complete partition, which only carry
assignment (story 23, Later) could produce, and the app holds no such fact.
Ownership partitions too, on facts the MVP has, once Shared is a group: a
Piece to its Participant, Personal gear to its owner participant or not, and
everything else to Shared. The test that sums the buckets to packingTotals is
the one that would have caught the drawn frame.

A Piece with no residence register reads its Entry's, then loose. The spec
does not take this decision: trip.entry_moved on a per-person Entry is a
legitimate op, and reading absent as loose would silently discard it.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 6: Tier 2 — the convergence properties

Spec §5.2. These are the slice's headline claims, and each exists because the
opposite is the tempting thing to build.

**Files:**
- Modify: `shared/src/convergence.test.ts`

**Interfaces:** consumes Tasks 1, 2, 3 and 5. Produces nothing.

**Read `shared/src/convergence.test.ts`'s existing helpers first** — it already
has the two-replica exchange harness, and every test below is a new case in it,
never a new harness.

- [ ] **Step 1: Write the five failing cases**

```ts
it('keeps residence and status apart, so no merge can make them agree', () => {
  // The slice's headline property, and invariant 12 honoured structurally
  // rather than enforced. Device A moves the stove into the duffel; Device B
  // marks it not_packed. Both apply, in either exchange order, and the
  // disagreement survives.
})

it('lets a backwards status move win on its clock', () => {
  // Device A sets `packed` at HLC 100, Device B sets `staged` at HLC 200:
  // the result is `staged` on both replicas. Sync §3.3's dropped
  // furthest-stage rule, asserted rather than assumed — this test exists
  // because the rule is the tempting one to reintroduce.
})

it('breaks a trip-side containment cycle identically on both replicas', () => {
  // A moves crate X into Y, B moves Y into X. Exchange in both orders; both
  // replicas report the same broken edge. Per-field LWW cannot prevent the
  // cycle: the two ops write two different registers.
})

it('survives a container stage_set concurrent with a content entry_moved', () => {
  // Different registers on different entity paths, so both survive and the
  // contents leave with the new holder.
})

it("resolves SET EVERYONE's batch per Piece, not all-or-nothing", () => {
  // The batch is N independent ops, so a concurrent single-Piece write on
  // another Device resolves by plain LWW on that one register.
})
```

- [ ] **Step 2: Run, confirm they fail for the right reason, then make them pass**

Run: `npx vitest run shared/src/convergence.test.ts`

These should mostly pass on the strength of Tasks 1–5 alone — the reducer is
already right. **A case that passes on the first run is still worth having**;
what would make one fail is a handler that reads a register it does not write,
which is the mistake they exist to catch.

- [ ] **Step 3: Run the whole suite and commit**

```
Assert the five convergence properties S9a's registers promise

Each exists because the opposite is the tempting thing to build. The headline
one is that residence and status are separate registers, so no merge can make
them agree — the duffel in the car with an unpacked stove inside it survives
every exchange, in either order, which is invariant 12 honoured structurally.

The backwards-status case is sync §3.3's dropped furthest-stage rule,
asserted rather than assumed: packed at HLC 100 loses to staged at HLC 200 on
both replicas. That rule is the one a future reader is most likely to
reintroduce, and this is what would stop them.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 7: The Pack picker, and the one confirm

Spec §4.5 and §4.6, ruling A2 and A2b. **The Home picker's twin, and not the
Home picker.** Read `app/src/components/HomePicker.tsx` in full first — most of
this is that file with two capabilities removed and one pointer type changed.

**Files:**
- Create: `app/src/components/PackPicker.tsx` + `.module.css` + `.test.tsx`
- Create: `app/src/components/ContainerMoveConfirm.tsx` + `.test.tsx`

**Interfaces:**
- Consumes: `tripContainmentView`, `tripPath`, `stageOf`, `stageLabel`,
  `entryLabel`, `entriesOf`, `isContainerEntry`, `TripResidence`; `ui/Sheet`,
  `ui/Confirm`; `useHousehold`.
- Produces:
  - `interface PackPickerProps { tripId: string; onClose(): void; onSelect(residence: TripResidence): void; title: string; excludeEntryId?: string; current?: TripResidence; moving?: { name: string; insideCount: number } }`
  - `interface ContainerMoveConfirmProps { movingName: string; destinationName: string; insideCount: number; onConfirm(): void; onCancel(): void }`

**What it borrows from the Home picker, verbatim:**
- `Loose` **first**, meta `NOT IN A CONTAINER`. (Note: **first here, last on the
  screen** — ruling A3 is about the *screen's groups*, not the picker's rows. A
  picker lists destinations; the screen lists work. Do not "fix" this.)
- Nesting indented **16px per level, capped at two** levels; deeper rows carry
  their skipped ancestry as a meta line. `INDENT_CAP = 2`.
- `● NOW` on the current residence.
- The moved Entry and its **whole subtree absent at any depth**, with the footer
  `CRATE B AND EVERYTHING INSIDE IT ARE NOT OFFERED.` — **this is invariant 3
  for the trip world, and it is what stops a cycle being authored on one Device
  at all.** `tripContainmentView`'s break handles the cycles two Devices author
  while apart, which no picker can prevent.
- The context line `MOVING CRATE B · 5 INSIDE RIDE ALONG`.
- Selection moves and closes.
- **Mounted is open** — no `open` prop. The caller writes
  `{picker && <PackPicker …/>}`, and mount is what resets the drafts.

**What it does not borrow, and why:**
- **Places.** The trip world has none, and offering one would break the
  two-worlds rule.
- **Creation.** A trip container is an Entry on the gear list, which the fact
  line says: `A TRIP CONTAINER IS AN ENTRY ON THE GEAR LIST.`
- **EDIT mode**, rename and remove — all three were Places-and-Gear
  capabilities.

**One difference in the row anatomy:** each row's right-hand mono is **that
container's stage** (`stageLabel(stageOf(…))`), taking the slot the Home picker
gives `● NOW` — one row cannot carry two right-hand reads, and where the gear
stands outranks how far its holder has travelled. `● NOW` still marks the
current row; put it where the Home picker's own `● NOW` marker sits relative to
the name, not in the right-hand slot.

**Copy, verbatim:** title = the gear name; fact `WHERE IT GOES ON THIS TRIP`;
empty state = `Loose` alone at `● NOW` above `No containers on this trip yet.` /
`Add a container to the gear list to pack into it.` — **a quiet line and no
button**, since the fix is one back-tap and a CTA here would name the gear list
from inside a picker.

- [ ] **Step 1: Write the failing `PackPicker` test**

Create `app/src/components/PackPicker.test.tsx`, modelled on
`HomePicker.test.tsx`'s harness (a seeded store + `render`).

```tsx
it('lists Loose first, then the trip containers', async () => { /* … */ })
it('offers no Places, at any depth', async () => {
  // The two-worlds rule. A Place recorded in the depot must not appear.
})
it('offers no way to create a container', async () => {
  expect(screen.queryByText(/\+ NEW/i)).not.toBeInTheDocument()
  expect(
    screen.getByText('A TRIP CONTAINER IS AN ENTRY ON THE GEAR LIST.'),
  ).toBeInTheDocument()
})
it('marks the current residence ● NOW', async () => { /* … */ })
it("draws each container's own stage in the right-hand slot", async () => {
  expect(within(rowFor('Crate B')).getByText('CAR')).toBeInTheDocument()
})
it('omits the moved Entry and its whole subtree, at any depth', async () => {
  // Invariant 3 for the trip world.
  expect(screen.queryByText('Crate B')).not.toBeInTheDocument()
  expect(screen.queryByText('Stuff sack')).not.toBeInTheDocument()
  expect(
    screen.getByText('CRATE B AND EVERYTHING INSIDE IT ARE NOT OFFERED.'),
  ).toBeInTheDocument()
})
it('states the ride-along in the context line', async () => {
  expect(screen.getByText('MOVING CRATE B · 5 INSIDE RIDE ALONG')).toBeInTheDocument()
})
it('indents nesting 16px per level, capped at two, with skipped ancestry', async () => { /* … */ })
it('selects and closes on a tap', async () => { /* onSelect + onClose both called */ })
it('draws the empty state with a quiet line and no button', async () => {
  expect(screen.getByText('No containers on this trip yet.')).toBeInTheDocument()
  expect(screen.getByText('Add a container to the gear list to pack into it.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run app/src/components/PackPicker.test.tsx`

- [ ] **Step 3: Write `PackPicker.tsx` + `.module.css`**

Copy `HomePicker.module.css`'s row, indent, meta and `● NOW` rules; delete every
rule belonging to EDIT, rename, create and remove. **Every control keeps its
drawn size and its clamped `::after`** (ruling O) — do not add a `min-height`
floor.

- [ ] **Step 4: Write the failing `ContainerMoveConfirm` test**

```tsx
it('states the destination in the title and the ride-along in the fact', async () => {
  expect(screen.getByText('Move Crate B into Duffel 90 L?')).toBeInTheDocument()
  expect(
    screen.getByText('Crate B and everything inside it move on the trip. Nothing at home moves.'),
  ).toBeInTheDocument()
  expect(screen.getByText('5 INSIDE RIDE ALONG · STATUS UNCHANGED')).toBeInTheDocument()
})

it('offers accent Move and ghost Cancel, and Cancel writes nothing', async () => {
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onConfirm).not.toHaveBeenCalled()
})

it('does not dismiss on the scrim — a decision is not a picker', async () => {
  // `ui/Confirm` withholds it (Radix AlertDialog's default); Escape closes.
})
```

The second sentence — `Nothing at home moves.` — is **load-bearing and not
reassurance**: it is invariant 13, and it is the one thing a Quartermaster who
has used the Home picker's identically-shaped sheet might reasonably fear.
Assert it by exact text so nobody trims it.

- [ ] **Step 5: Write `ContainerMoveConfirm.tsx` over `ui/Confirm`**

- [ ] **Step 6: Run both suites, then the whole suite. Commit.**

```
Build the Pack picker as the Home picker's twin, minus two capabilities

Ruling A2. Loose first, nesting indented 16px per level capped at two, ● NOW
on the current residence, the moved Entry and its whole subtree absent at any
depth — that exclusion is invariant 3 for the trip world, and it is what
stops a cycle being authored on one Device at all. tripContainmentView's
break handles the cycles two Devices author while apart, which no picker can
prevent.

Two capabilities do not come across. Places, because the trip world has none
and offering one would break the two-worlds rule. Creation, because a trip
container is an Entry on the gear list, which the fact line says. Each row's
right-hand mono is that container's stage rather than ● NOW: one row cannot
carry two right-hand reads, and where the gear stands outranks how far its
holder has travelled.

Ruling A2b's one confirm comes with it. Its second sentence is invariant 13,
not reassurance — a Quartermaster who has used the Home picker's
identically-shaped sheet has every reason to fear the opposite.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 8: The Piece status sheet

Spec §4.4, ruling A1. **The cluster and its count are one control** — ruling B
holds unchanged at 34px, because circles on a 39px pitch put a 44px target over
a neighbour, B's own arithmetic one size up, on the screen used with cold hands.

**`LONG-PRESS` retires**: no keyboard equivalent, no second instance anywhere in
the app, no discoverable affordance. `P` opens the sheet at the keyboard, as it
opens the Piece picker in the builder.

**Files:**
- Create: `app/src/components/PieceStatusSheet.tsx` + `.module.css` + `.test.tsx`

**Interfaces:**
- Consumes: `pieceStatusOf`, `nextStatus`, `statusGlyph`, `statusLabel`,
  `STATUSES`, `isPacked` (Tasks 2 and 5); `piecesOf`, `pieceInclusion`;
  `tripParticipants` (`app/src/household/trips.ts`, for drawn order);
  `ui/PersonCircle` at **30** (ruling K: the row's height sets the circle);
  `ui/Sheet`.
- Produces:
  - `interface PieceStatusSheetProps { tripId: string; entryId: string; onClose(): void; onOpenPieceMove(personId: string): void }`

**Anatomy, verbatim:**
- Title = the gear name.
- Mono fact `PACKING STATUS · 1 OF 3 PACKED` — **the ledger states, it does not
  ask.**
- Rows 48px, **30px circles**, each `● Mark · ▸ DUFFEL 90 L` with a trailing
  accent `MOVE`.
- **Tap a row = next state for that Person, one op per tap** — the tag-chip
  rule, and the same commit model the S8 Piece picker already uses.
- The trailing `MOVE` is where a **single Piece's** residence is set
  (`trip.piece_moved`) — which is why a per-person row's body opens *this* sheet
  rather than the Pack picker: one Piece may ride in the duffel while another is
  loose. It calls `onOpenPieceMove`; the screen owns the `PackPicker` mount.
- At the foot, **`SET EVERYONE`** over three 44px chips in the status pill's own
  grammar — `○ NOT PACKED` `◐ STAGED` `● PACKED`. **Three chips and not one
  control**, because one control cannot name a next state when the people
  disagree. It writes **N ops in one batch**, backwards included, and there is
  **no confirm**: nothing is destroyed and a second tap on another chip reverses
  the whole set.
- Accessible name `Packing status — Headlamp, 1 of 3 packed`.
- **Sheet below Split, popover from Split up** — `ui/Popover` is still not
  built, so this lands with `Sheet`'s `desktopCard` standing in, **S8's own
  precedent**, and becomes the primitive's third waiting caller.
- Rows list **only included Pieces** (`piecesOf`), in `tripParticipants` order.

- [ ] **Step 1: Write the failing test**

```tsx
it('is a dialog named by the gear and its count', async () => {
  expect(screen.getByRole('dialog', { name: 'Packing status — Headlamp, 1 of 3 packed' }))
})

it('states the count as a fact, never as a question', async () => {
  expect(screen.getByText('PACKING STATUS · 1 OF 3 PACKED')).toBeInTheDocument()
})

it('lists only included Pieces, in People-screen order', async () => {
  // Kim's Piece is removed: two rows, not three.
})

it("emits one op per row tap, moving that Person's status one step", async () => {
  await user.click(screen.getByRole('button', { name: /Mark/ }))
  expect(emitted).toEqual([
    expect.objectContaining({
      type: 'trip.piece_status_set',
      payload: { entry_id: HEADLAMP, person_id: MARK, status: 'staged' },
    }),
  ])
})

it("draws each row's own trip residence", async () => {
  expect(within(rowFor('Mark')).getByText('▸ DUFFEL 90 L')).toBeInTheDocument()
})

it('opens the Pack picker for one Piece from the trailing MOVE', async () => {
  await user.click(within(rowFor('Mark')).getByRole('button', { name: /MOVE/ }))
  expect(onOpenPieceMove).toHaveBeenCalledWith(MARK)
})

it('writes N ops from one SET EVERYONE chip, with no confirm', async () => {
  await user.click(screen.getByRole('button', { name: '● PACKED' }))
  expect(emitted).toHaveLength(2) // two included Pieces
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

it('writes backwards from SET EVERYONE too', async () => {
  // A second tap on another chip reverses the whole set — which is why it
  // needs no confirm.
})

it('offers no long-press affordance anywhere', async () => {
  expect(screen.queryByText(/LONG-PRESS/i)).not.toBeInTheDocument()
})

it('draws 30px circles, never an individual tap target', async () => {
  // Ruling B / K. The circles inside this sheet are decoration on a 48px
  // row; the row is the control.
  for (const circle of screen.getAllByTestId('person-circle')) {
    expect(circle.closest('button')).toBe(rowButtonFor(circle))
  }
})
```

- [ ] **Step 2: Run it, confirm it fails, write the component, run it green.**

- [ ] **Step 3: Whole suite, then commit.**

```
Open per-person packing from one control, and retire the long-press

Ruling A1. The cluster and its count open a sheet together: ruling B holds
unchanged at 34px, because circles on a 39px pitch put a 44px target over a
neighbour — B's own arithmetic one size up, on the screen used with cold
hands. The long-press goes for three reasons that are not about size: no
keyboard equivalent, no second instance anywhere in the app, no discoverable
affordance.

SET EVERYONE is three chips and not one control, because one control cannot
name a next state when the people disagree. It writes N ops in one batch,
backwards included, and needs no confirm: nothing is destroyed, and a second
tap on another chip reverses the whole set.

The trailing MOVE is why a per-person row's body opens this sheet rather than
the Pack picker — one Piece may ride in the duffel while another is loose,
and only this row can say which.

Popover is still not built, so this lands as a Sheet with desktopCard
standing in, S8's own precedent, and becomes the primitive's third waiting
caller.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 9: F4 — the route, the screen shell, and the empty state

Spec §4.1, §4.2 (head) and §4.8. Everything above the groups, plus the route
itself, so the screen is reachable and testable before a single group renders.

**Files:**
- Create: `app/src/screens/Packing.tsx` + `.module.css` + `.test.tsx`
- Modify: `app/src/App.tsx` (one route)
- Modify: `ui/src/PersonCircle.tsx` + `.module.css` + `.test.tsx` (sizes 28, 34)

**Interfaces:**
- Consumes: `useScreenHeader`, `useHousehold`, `tripLabel`, `packingTotals`,
  `entriesOf`.
- Produces: `export function Packing()` — reads `useParams<{ id: string }>()`
  exactly as `Trip` does.

**Rules this task settles:**

- **`/trips/:id/packing`, its own route at every width — not a pane.** Nothing
  about it is width-gated, so it needs **none** of the `isSplitOrWider ?
  <X/> : <Redirect/>` shape `/trips/:id/add` and `/trips/:id/list` carry.
  Place it **after** `/trips/:id` in the `<Switch>` — wouter renders the first
  match and `path="/trips/:id"` does not match a two-segment tail, but keeping
  the specific routes together is the file's existing habit.
- **It renders at every phase, Draft included.** A phase locks nothing
  (invariant 16, story 32), and hiding a route is a soft lock the phase model
  forbids. The title is `Pack-out` at every phase: it names the activity, and
  the phase itself is already stated on the card and the trip screen by a chip
  that is the control for changing it.
- **The `No such trip.` guard, with every hook above it** — `Trip.tsx`'s and
  `GearListBuilder.tsx`'s rule (S7 review F2), for the identical reason: a
  control reachable against an unknown `tripId` would author an op that
  materialises a Trip no delete op can remove before S14.
- **`useScreenHeader({ splitPane: false, atDesktopSidebarCarriesDestination:
  false })`.** The flag has existed since S7; F4 needs **no new rule**. It is
  the eleventh caller. The back link is `‹ {tripLabel(trip)}` and survives
  Desktop because the 216px sidebar carries `TRIPS`, not `Alps 2026`. This is
  the first screen where the flag's *reason* is the only reason — say so in the
  docstring, because a reader meeting F4 first will otherwise read it as an
  exception.
- **The over-claim band does not render here.** It is a property of the **gear
  list**, and F4 is not the gear list. Do not add it.

**Anatomy, top to bottom:** header band → title `Pack-out` → `● 48/61 PIECES` /
`13 LEFT` and the 6px bar (radius 3) → the segmented `CONTAINER · PERSON · ALL`
(40px) and the `○ LEFT` pill (40px) → **the screen's one hint**,
`TAP PILL = NEXT STATE · TAP CIRCLES = PER PERSON · TAP ROW = WHERE IT GOES` →
the groups (Tasks 10 and 11).

**Empty list:** `0 ENTRIES.` and `The gear list is built from the depot.` — the
trip screen's permanent fact, word for word. **The count line and the bar are
absent, not zeroed**: `● 0/0 PIECES` states an arithmetic nobody asked for.

**Drawn and not built (ruling A9):** `UNDO` and the pinned footer bar. With no
action left, the bar retires — a read does not spend the thumb zone — and the
hint moves **under the controls row**, read once at the start rather than at the
foot of sixty-one rows. This is the **third** instance of the §3b/§3c
precedent, and the strongest: this screen holds the app's most tapped writes, so
a reversal that quietly weakens with time is worst on it, and story 36 forbids
exactly that.

- [ ] **Step 1: Widen `ui/PersonCircle` to 28 and 34**

`size` becomes `22 | 24 | 28 | 30 | 34`. Add `.size28` and `.size34` beside the
three existing rules in `PersonCircle.module.css`, matching their shape exactly.
**28 is the person group header's; 34 is the row cluster's** (Task 10 and 11).
Add one case to `PersonCircle.test.tsx`'s size table.

`PersonCluster`'s `size` prop is already `PersonCircleProps['size']`, so it
widens for free.

- [ ] **Step 2: Write the failing screen test**

```tsx
it('draws the title Pack-out at every phase, Draft included', async () => { /* … */ })
it('is reachable at every phase — a phase locks nothing', async () => { /* … */ })
it('says No such trip. for an unknown id, and authors nothing', async () => { /* … */ })
it('draws the count line, the LEFT read and the bar', async () => {
  expect(screen.getByText('● 4/9 PIECES')).toBeInTheDocument()
  expect(screen.getByText('5 LEFT')).toBeInTheDocument()
})
it('draws the hint under the controls row, not at the foot', async () => {
  expect(
    screen.getByText('TAP PILL = NEXT STATE · TAP CIRCLES = PER PERSON · TAP ROW = WHERE IT GOES'),
  ).toBeInTheDocument()
})
it('draws no pinned footer bar and no UNDO', async () => {
  expect(screen.queryByRole('button', { name: /UNDO/i })).not.toBeInTheDocument()
})
it('draws no over-claim band — that belongs to the gear list', async () => { /* … */ })
it('withholds the count line and the bar entirely on an empty list', async () => {
  expect(screen.getByText('0 ENTRIES.')).toBeInTheDocument()
  expect(screen.getByText('The gear list is built from the depot.')).toBeInTheDocument()
  expect(screen.queryByText(/PIECES/)).not.toBeInTheDocument()
  expect(screen.queryByTestId('packing-bar')).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Run it, confirm it fails, write `Packing.tsx` + the route, run it green.**

- [ ] **Step 4: Whole suite, then commit.**

```
Give packing its own route, reachable at every phase

/trips/:id/packing is its own route at every width, not a pane — a packing
row has no detail, its two acts being a pill and a sheet, so nothing here is
width-gated and none of /trips/:id/add's redirect shape applies.

It renders at every phase, Draft included. A phase locks nothing (invariant
16), and hiding a route is a soft lock the phase model forbids — the same
reasoning that keeps every editing capability available in every phase. The
title is Pack-out at every phase because it names the activity; the phase
itself is already stated by a chip that is the control for changing it.

The back link survives Desktop, the first screen where it does, and that
needs no new rule: useScreenHeader has carried
atDesktopSidebarCarriesDestination since S7, and the 216px sidebar carries
TRIPS, not Alps 2026. Stated in the docstring because a reader meeting F4
first will otherwise read it as an exception.

Ruling A9: UNDO is drawn and not built, the pinned footer retires with it,
and the hint moves under the controls where it is read once at the start
rather than at the foot of sixty-one rows.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 10: CONTAINER mode — the row, the rail, the groups, the ▲ line

Spec §4.2 (CONTAINER), §4.3 and §4.7. The screen's spine.

**Files:**
- Create: `app/src/components/PackingRow.tsx` + `.module.css`
- Create: `app/src/components/JourneyRail.tsx` + `.module.css`
- Modify: `app/src/screens/Packing.tsx` + `.module.css` + `.test.tsx`

**Interfaces:**
- Consumes: `packingItems`, `containerTotals`, `disagreements`,
  `tripContainmentView`, `statusOf`, `pieceStatusOf`, `nextStatus`,
  `statusGlyph`, `stageOf`, `stageLabel`, `STAGES`, `entryLabel`, `entryKind`,
  `bringCountOf`, `pieceInclusion`, `ownerLabel`; `PackPicker`,
  `ContainerMoveConfirm`, `PieceStatusSheet` (Tasks 7 and 8);
  `ui/PersonCluster` at **34**.
- Produces:
  - `interface PackingRowProps { tripId: string; entryId: string; personId?: string; onOpenPicker(): void; onOpenPieceSheet(): void }`
  - `interface JourneyRailProps { current: StageValue; onSet(stage: StageValue): void; label: string }`

### The row has two targets, and they are the domain's two tracks

Ruling A2. **Right edge, ≥44px** = *how far along*: the status pill, tapping
through `○ → ◐ → ●`, or — on a per-person row — the **34px circle cluster and
its `1/3` as one control**. **Row body** = *where*: it opens the Pack picker
(or, on a per-person row, the Piece status sheet — §4.4's own reason).

Both targets grow the standing clamped `::after` (ruling O), and **the clamp is
what keeps them from overlapping each other** on a ≥64px row. Rows are ≥64.

Meta line: `SHARED · ×1`, `PER-PERSON · 1/3`. Trip-only items get the amber
bordered `TRIP-ONLY` tag (radius 3) and meta `NOT IN DEPOT`.

**A container Entry has no status pill anywhere**, and `statusOf` returning
`null` is what the row reads — never `entryKind`, never the register.

### The rail is a direct set

Ruling A15. **A chip sets that stage** — backwards included, so tapping
`⌂ HOME` on a container in the car sends it home, which plain LWW makes correct
and sync §3.3 makes deliberate. **Tapping the current stage writes nothing**,
`SET PHASE`'s own rule and for a reason that survives translation: a redundant
write moves the stamp LWW compares. The current chip **stays undimmed**; dim
means future. **A rail tap never confirms**: it writes one register and rewrites
nobody else's, the contents' whereabouts following a pointer.

Painted at its drawn size, **hit 48 through a clamped `::after`** clamped at the
header row — the phase chip's answer (§5c O).

### The groups

- One group per trip container: header carrying its name (16/600), its mono
  count `9/12` (**contents at any depth** — `containerTotals`), its journey rail
  and, conditionally, its ▲ line.
- **Nested containers are indented groups**, rendered **immediately after their
  parent's own rows**, indent 16px per level **capped at two levels below the
  top container**, deeper headers carrying their skipped ancestry as a meta line
  — the Home picker's rule verbatim (ruling A4). **A rail inside a rail is
  correct**: the rail is that container's own journey, and story 10's
  disagreement case is exactly the nested one.
- A **trip-only container** is an ordinary group plus the amber `TRIP-ONLY` tag
  on its header (ruling A14). Nothing about a journey depends on a depot record.
- The list **ends with `Loose`** (ruling A3) — the container header's anatomy
  **minus the rail**, since nothing loose has a journey: name `Loose` in
  ink/muted, meta `NOT IN A CONTAINER`, right count. **Last, not first**: on day
  one everything is loose, so a first-position group of sixty-one rows pushes
  every rail — the screen's spine — permanently off-screen. A picker lists
  destinations; this lists work.
- An **empty `Loose` group draws nothing.**
- A Trip with **no containers at all** draws that one group holding everything,
  and below the last row the permanent fact
  `A CONTAINER ON THE GEAR LIST BECOMES A GROUP HERE.`

### The ▲ line

`▲ IN CAR · 3 INSIDE NOT PACKED`, `▲ PACKED · 3 INSIDE NOT PACKED` — the stage's
own word, from `disagreements()`. **Pinned at `N=1` per ruling M.** The `▲`
glyph goes in **its own element** with the attention class, exactly as the trip
card's date warning does: a single text node would force the class onto the
whole line or onto none of it.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('the row', () => {
  it('cycles the pill one step per tap, one op each', async () => {
    await user.click(within(rowFor('Stove')).getByRole('button', { name: /NOT PACKED/ }))
    expect(emitted).toEqual([
      expect.objectContaining({
        type: 'trip.entry_status_set',
        payload: { entry_id: STOVE, status: 'staged' },
      }),
    ])
  })

  it('opens the Pack picker from the row body', async () => { /* … */ })

  it('opens the Piece status sheet from a per-person cluster, not the picker', async () => {
    // The cluster AND its count are one control (ruling B at 34px).
  })

  it('gives no individual circle its own tap target', async () => {
    for (const circle of within(rowFor('Headlamp')).getAllByTestId('person-circle')) {
      expect(circle.closest('button')).toBe(clusterControlFor('Headlamp'))
    }
  })

  it('draws no status pill on a container Entry', async () => {
    expect(within(headerFor('Crate B')).queryByRole('button', { name: /PACKED/ }))
      .not.toBeInTheDocument()
  })

  it('draws one pill for a Counted Entry, whatever its Bring-count', async () => {
    // Ruling A13: one register, no per-unit identity, so one tap moves the
    // count by two — correct, and needing no UI.
  })

  it('tags a trip-only item amber and meta NOT IN DEPOT', async () => { /* … */ })
})

describe('the rail', () => {
  it('sets the tapped stage, backwards included', async () => {
    await user.click(within(headerFor('Crate B')).getByRole('button', { name: '⌂ HOME' }))
    expect(emitted).toEqual([
      expect.objectContaining({
        type: 'trip.container_stage_set',
        payload: { entry_id: CRATE, stage: 'home' },
      }),
    ])
  })

  it('writes nothing when the current stage is tapped', async () => {
    // SET PHASE's own rule: a redundant write moves the stamp LWW compares,
    // and at S6 that was visible in DAY N. Here it is invisible and still
    // wrong.
    await user.click(within(headerFor('Crate B')).getByRole('button', { name: 'CAR' }))
    expect(emitted).toEqual([])
  })

  it('never confirms', async () => {
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('leaves the current chip undimmed — dim means future', async () => { /* … */ })
})

describe('the groups', () => {
  it('draws one group per container, counting its subtree at any depth', async () => { /* … */ })
  it('renders a nested group immediately after its parent rows, indented', async () => { /* … */ })
  it('caps the indent at two levels and states the skipped ancestry', async () => { /* … */ })
  it('gives a nested container its own rail', async () => {
    // A rail inside a rail is correct — story 10's disagreement case is the
    // nested one.
  })
  it('tags a trip-only container and otherwise draws an ordinary group', async () => { /* … */ })
  it('puts Loose last and draws it without a rail', async () => {
    const headers = screen.getAllByTestId('packing-group-header')
    expect(headers[headers.length - 1]).toHaveTextContent('Loose')
    expect(within(headers[headers.length - 1]).queryByRole('button', { name: 'CAR' }))
      .not.toBeInTheDocument()
  })
  it('draws nothing for an empty Loose group', async () => { /* … */ })
  it('states the permanent fact when a Trip has no containers', async () => {
    expect(
      screen.getByText('A CONTAINER ON THE GEAR LIST BECOMES A GROUP HERE.'),
    ).toBeInTheDocument()
  })
})

describe('the ▲ disagreement line', () => {
  it('appears at car with unpacked contents', async () => {
    expect(screen.getByText(/IN CAR · 3 INSIDE NOT PACKED/)).toBeInTheDocument()
  })
  it('appears at packed', async () => { /* … */ })
  it('does not appear at home or staging', async () => { /* … */ })
  it('pins at N=1', async () => {
    expect(screen.getByText(/IN CAR · 1 INSIDE NOT PACKED/)).toBeInTheDocument()
  })
  it('carries the ▲ in its own attention element', async () => { /* … */ })
})
```

- [ ] **Step 2–4: Run red, implement, run green, run the whole suite, commit.**

```
Draw packing by container: two targets, a direct-set rail, Loose last

Ruling A2 gives the row the domain's two tracks. The right edge is how far
along — the pill, or the 34px cluster and its count as one control — and the
row body is where. The row body was free precisely because the pill already
owns the thumb side, and ruling O's clamped ::after is what keeps the two
from overlapping on a 64px row.

Ruling A15 makes the rail a direct set, not an advance: any chip sets that
stage, backwards included, which plain LWW makes correct and sync §3.3 makes
deliberate. Tapping the current stage writes nothing — SET PHASE's rule,
because a redundant write moves the stamp LWW compares. At S6 that was
visible in DAY N; here it is invisible and still wrong.

Loose goes last (ruling A3) against the Home picker's Loose-first, because on
day one everything is loose and a first-position group of sixty-one rows
pushes every rail — the screen's spine — permanently off-screen. A picker
lists destinations; this lists work.

The ▲ line fires at car and packed only, counting not-packed only, at any
depth (ruling A6). Staging IS the act of packing, so unpacked contents there
are the work; counting staged would fire on nearly every container in the car
and the ▲ would stop meaning anything.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 11: PERSON mode, ALL mode, and the `○ LEFT` filter

Spec §4.2 (PERSON, ALL). The two remaining modes, plus the one filter, plus
wiring the segmented control Task 9 drew.

**Files:**
- Modify: `app/src/screens/Packing.tsx` + `.module.css` + `.test.tsx`

**Interfaces:**
- Consumes: `personPartition` (Task 5), `sortedPeople` (`app/src/household/people.ts`),
  `personLabel`, `personNameOrUnnamed`, `UNNAMED_PERSON_GLYPH`, `isPacked`,
  `tripPath` (Task 3); `ui/PersonCircle` at **28**.
- Produces: no new exported surface.

### PERSON — *whose it is*, not whose body it goes with

Ruling A7. The partition comes from `personPartition` and is **not re-derived
here**; this task decides only the **drawn order**, which `shared/` deliberately
does not: **People in `sortedPeople` order, then `Shared` last.**

That is a deliberate divergence from the Depot's `GROUP BY OWNER`, whose
grouping table pins `shared` **first**. `Shared` is the everything-else bucket
and on a real Trip the biggest one, so first position pushes every person header
off-screen. **The two surfaces answer differently on purpose** — the Depot files
gear, F4 lists work — and this is recorded rather than reconciled.

- Person group headers: **28px circle** + name + right `9/13 · 4 LEFT`.
- `Shared` group: name in ink/muted, meta `NOT ATTRIBUTED TO A PERSON`.
- An **all-done person reads `● 12/12` with its rows collapsed** and the header
  tappable to expand. **The word `COLLAPSED` is dropped**, being about the widget
  rather than the ledger.
- A Piece's row **names its owner inline** — `Headlamp — ELS'S PIECE`.
- **The `PARTICIPANT` tag is dropped** (ruling A7b, overturned): its only
  possible fact is *holds no Login*, which S5 ruled must be **withdrawn** rather
  than guessed when the read fails — a screen used in a cold garage cannot rest
  on a network call. It would not mean "does not pack" even when loaded, and it
  is no longer what the group says.

### ALL — flat, name A→Z

Ruling A8. Every Entry and Piece, **flat, no headers, name A→Z**. The grouped
modes answer *where is it going* and *whose is it*; ALL exists for *is this one
thing packed*, which is a lookup — and **sorting by status would move rows under
the thumb as they are tapped.**

Each meta line **ends in its trip residence, amber** — `▸ DUFFEL 90 L`,
`▸ LOOSE`, and `▸ MIXED` where a per-person row's Pieces sit in different
containers. **No container rows**: ALL lists what carries a status, and a
container's name still appears as its contents' residence segment, so nothing
is hidden.

Use `byNameThenId`'s comparator through the existing `entriesOf` order rather
than a new `localeCompare` — `order.ts`'s header explains why a second
comparator reintroduces cross-device divergence.

### The `○ LEFT` filter

`!isPacked` and nothing else. Selected state: `bg #35523F` + `✕`. It applies in
**all three modes**, and a group whose items all filter out draws nothing.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('PERSON mode', () => {
  it('orders People by the People screen, with Shared last', async () => {
    const headers = screen.getAllByTestId('packing-group-header').map((h) => h.textContent)
    expect(headers[headers.length - 1]).toMatch(/^Shared/)
  })

  it('buckets a Piece to its Participant', async () => { /* … */ })

  it("buckets Personal gear to its owner, participant or not", async () => {
    // The header answers whose it is. Els's jacket carried by Mark is honest.
  })

  it('sums the group counts to the trip total', async () => { /* … */ })

  it('collapses an all-done person and says nothing about the widget', async () => {
    expect(within(headerFor('Kim')).getByText('● 12/12')).toBeInTheDocument()
    expect(screen.queryByText(/COLLAPSED/)).not.toBeInTheDocument()
  })

  it("names a Piece row's owner inline", async () => {
    expect(screen.getByText("Headlamp — ELS'S PIECE")).toBeInTheDocument()
  })

  it('draws no PARTICIPANT tag anywhere', async () => {
    expect(screen.queryByText('PARTICIPANT')).not.toBeInTheDocument()
  })
})

describe('ALL mode', () => {
  it('sorts by name A→Z, never by status', async () => { /* … */ })
  it('draws no group headers', async () => { /* … */ })
  it('draws no container rows', async () => { /* … */ })
  it("ends each meta line in the item's trip residence", async () => {
    expect(within(rowFor('Stove')).getByText('▸ DUFFEL 90 L')).toBeInTheDocument()
    expect(within(rowFor('Map')).getByText('▸ LOOSE')).toBeInTheDocument()
  })
  it('reads ▸ MIXED where a per-person row\'s Pieces differ', async () => { /* … */ })
})

describe('the ○ LEFT filter', () => {
  it('hides packed items and nothing else', async () => { /* … */ })
  it('applies in all three modes', async () => { /* … */ })
  it('leaves a fully-packed group drawing nothing', async () => { /* … */ })
})
```

- [ ] **Step 2–4: Run red, implement, run green, whole suite, commit.**

```
Group packing by person and by nothing at all

Ruling A7: PERSON mode means whose it is, which ownership answers — whose
body it goes with is story 23, Later, and the app holds no such fact. That is
what made the drawn frame's complete partition unbuildable, and the
arithmetic now closes on facts the MVP has once Shared is a group.

Shared goes last, a deliberate divergence from GROUP BY OWNER, whose grouping
table pins shared first. Shared is the everything-else bucket and on a real
Trip the biggest one, so first position pushes every person header
off-screen. The two surfaces answer differently on purpose: the Depot files
gear, F4 lists work.

The PARTICIPANT tag is dropped (A7b, overturned). Its only possible fact is
holds no Login, which S5 ruled must be withdrawn rather than guessed when the
read fails — a screen used in a cold garage cannot rest on a network call.

ALL is flat and A→Z (A8). The grouped modes answer where is it going and
whose is it; ALL serves the lookup, and sorting by status would move rows
under the thumb as they are tapped.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 12: Widths, the band, and the drawn sizes

Spec §4.8 and §5.3's two suites no other tier can own.

**Files:**
- Modify: `app/src/screens/Packing.module.css`
- Modify: `app/src/shell/screenBand.test.tsx`
- Modify: `app/src/screens/drawnSizes.test.ts`

**Interfaces:** consumes Tasks 9–11. Produces nothing.

### Widths (ruling A10)

**One capped 560px column, centred, from Roomy up, and no pane.** 560 is the 393
row's content plus the room ALL mode's residence segment needs; past it the pill
drifts an arm's length from the name it belongs to.

- Gutters **20 at Roomy, 24 from Split**.
- Nothing else changes with width: segmented control 40px, filter pill 40px,
  rows ≥64, pill ≥44, circles 34 and 28, and **the rail keeps its own line at
  every width**.
- Title takes the DISPLAY scale's **34 at Desktop**.
- Group cards gain the **12px radius border from Roomy up**, where the list
  stops being edge-to-edge.
- **`container-type` on `.screen` makes it the containing block for any
  `position: fixed` descendant.** F4 has no FAB, so nothing is at risk — but do
  not add one later without reading the design-round note that caught this on
  Depot and Trips.

### `screenBand.test.tsx` — F4 rendered **inside `AppShell`**

**This is the suite that catches the inversion.** A per-screen suite renders the
screen alone, so its absence assertion proves one side of a two-sided fact — and
**F4 is the first screen whose Desktop answer is *drawn***, which is exactly the
case that would ship inverted unnoticed. Add `Packing` to the imports and:

```tsx
it('states SYNCED once on a phone, in the shell header', async () => { /* … */ })
it('states SYNCED once at Split, in the screen', async () => { /* … */ })
it('states SYNCED once at Desktop, in the sidebar', async () => { /* … */ })
it('keeps its back link at Desktop — the sidebar carries TRIPS, not the Trip', async () => {
  setViewport(DESKTOP)
  // The eleventh caller, and the first where
  // `atDesktopSidebarCarriesDestination: false` is the *only* reason the
  // link survives.
  expect(screen.getByRole('link', { name: '‹ Alps 2026' })).toBeInTheDocument()
})
```

### `drawnSizes.test.ts` — F4's controls

Ruling O's net, and the **only** technique that sees CSS under `css: false`.
Add one `it` per control this screen introduces, each asserting the drawn size,
the absence of the retired `FLOOR` regex, `position: relative`, and a
`::after` rule:

- the **status pill** (≥44, so it states its own explicit 44 and needs the
  `::after` only to reach 48),
- the **rail chip** (drawn small, `::after` clamped at the header row —
  **vertical growth only**, because the row's gap is all that separates it from
  its neighbour),
- the **segmented control** (40),
- the **filter pill** (40),
- the **sheet row** (48) and the **`SET EVERYONE` chips** (44).

- [ ] **Step 1–3: Write the two suites red, add the CSS, run green, whole suite, commit.**

```
Cap the packing column at 560, and pin what only two suites can see

Ruling A10: one capped 560px column from Roomy up and no pane. A packing row
has no detail — its two acts are a pill and a sheet — and 560 is the 393
row's content plus the room ALL mode's residence segment needs. Past it the
pill drifts an arm's length from the name it belongs to.

screenBand renders F4 inside AppShell and counts, because a per-screen suite
renders the screen alone and its absence assertion proves one side of a
two-sided fact. F4 is the first screen whose Desktop back link is drawn,
which is exactly the case that would ship inverted unnoticed — the S6 round
shipped this rule inverted and review caught it.

drawnSizes parses the stylesheet text, the one technique that sees CSS under
css: false. The rail chip's ::after grows vertically only: what a hit area
may grow into is a fact about the owning row, and the row's gap is all that
separates the chip from its neighbour.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 13: The two doors — the card's CTA and progress line, and `PACKING ›`

Spec §4.9, ruling A11. **S9a draws exactly one CTA.**

**Files:**
- Modify: `app/src/components/TripCard.tsx` + `.module.css` + `.test.tsx`
- Modify: `app/src/screens/Trips.tsx` + `.test.tsx`
- Modify: `app/src/screens/Trip.tsx` + `.module.css` + `.test.tsx`

**Interfaces:**
- Consumes: `phaseOf`, `packingTotals`, `tripLabel`.
- Produces: `TripCardProps` gains
  `progress?: PackingCount` — *"the caller's own read, not this component's"*,
  the precedent `entryCount` already sets and for its stated reason: a second
  store read here would **deepen** the §4.1 debt rather than merely carry it.

### The CTA

- **`Continue pack-out` on the active card at Pack-out, and nowhere else.**
  Full-width 48px accent.
- **At On trip the slot stays empty.** The CTA names the current phase verb,
  whose control is the phase chip the card already carries, and
  `Continue unpack` would name **F5, a screen that does not exist**. Unpack's
  CTA is S10's to draw.
- **Draft keeps `BUILD LIST ›`. Closed keeps its row.**

**Do not add a `packingHref` prop.** `buildListHref` is a prop because it is
width-dependent (`/trips/:id` below Split, `/trips/:id/list?from=trips` above);
`/trips/:id/packing` is **the same route at every width**, so the component
builds it inline and `@container, never a media query` stays true with one
exception fewer, not one more. Say so in the docstring beside `buildListHref`'s
own note.

### The progress line

**Returns *below* the NEXT line** — §5's order: the permanent obligation above
the arithmetic, the arithmetic above the action. **This is the thing S7 and S9
were most likely to get backwards**; §12.11 said "above" until the S6 design
round, and the board says `NEXT LINE SITS ABOVE THE PROGRESS LINE.` in as many
words.

`● 48/61 PIECES` · `13 LEFT` + the 6px bar, **on Active cards only**. A Draft's
`● 0/59 PIECES` would state progress against an arrangement **invariant 17 makes
inert**, and the dashed card's own `DRAFT · 14 ENTRIES` is the count that
matters there. Closed rows keep `JUL 2025 · 54 PIECES · 1 LOST` — a bar over
settled history measures nothing.

**The five-element card is now full, and this slice is what fills it.**

### The second door

`PACKING ›`, in the `GEAR LIST` band's **trailing slot beside `EDIT LIST ›`**,
gap 14 (the settle-routes row's grammar), **at every width and at every phase**.
Accessible name `Open packing for Alps 2026` — the `Build list for …` pattern,
with the `›` kept out of it (ruling D).

Note the asymmetry with `EDIT LIST ›`, which is **withheld** below Split
(`!editable`): `PACKING ›` is not, because F4 is its own route at every width.

**One consequence the round did not name, recorded rather than papered over:**
the band renders only when the Trip has Entries — `Trip.tsx` draws the
`0 ENTRIES.` region instead — so **a Trip with an empty gear list has no drawn
door to F4**. That is the right answer rather than a gap: a route to a screen
that can only say `0 ENTRIES.` is a door to an empty room, which is exactly what
the empty region's own rule forbids (*never a dead affordance*). F4's empty
state still has to exist, for the reader already standing there when another
Device removes the last Entry, and for a direct link. **Flag it for the next
round** in Task 14's doc pass.

- [ ] **Step 1: Write the failing tests**

`TripCard.test.tsx` — note the existing test at line 313,
`carries no Continue pack-out and no BUILD LIST — S9s CTA, not built yet`,
**is now false and must be replaced**, not left beside its successor:

```tsx
it('draws Continue pack-out on an active card at Pack-out', async () => {
  expect(screen.getByRole('link', { name: /Continue pack-out/ })).toHaveAttribute(
    'href',
    `/trips/${id}/packing`,
  )
})

it('draws no CTA at On trip — the phase chip is the control for that verb', async () => {
  expect(screen.queryByRole('link', { name: /Continue/ })).not.toBeInTheDocument()
})

it('draws no CTA at Unpack — S10 draws that one', async () => { /* … */ })

it('keeps BUILD LIST › on a planned card', async () => { /* unchanged */ })

it('puts the progress line BELOW the NEXT line', async () => {
  const next = screen.getByTestId('trip-next')
  const progress = screen.getByTestId('trip-progress')
  expect(next.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy()
})

it('draws the progress line on active cards only', async () => {
  // A Draft's `● 0/59 PIECES` states progress against an arrangement
  // invariant 17 makes inert.
  expect(screen.queryByTestId('trip-progress')).not.toBeInTheDocument()
})
```

`Trip.test.tsx`:

```tsx
it('draws PACKING › in the gear list band at every phase', async () => {
  expect(
    screen.getByRole('link', { name: 'Open packing for Alps 2026' }),
  ).toHaveAttribute('href', `/trips/${id}/packing`)
})

it('draws PACKING › below Split, where EDIT LIST › is withheld', async () => {
  expect(screen.getByRole('link', { name: /Open packing/ })).toBeInTheDocument()
  expect(screen.queryByText('EDIT LIST ›')).not.toBeInTheDocument()
})

it('keeps the › out of the accessible name', async () => { /* ruling D */ })

it('draws no door at all when the gear list is empty', async () => {
  // Recorded, not a gap: a route to a screen that can only say `0 ENTRIES.`
  // is a door to an empty room.
  expect(screen.getByText('0 ENTRIES.')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Open packing/ })).not.toBeInTheDocument()
})
```

- [ ] **Step 2–4: Run red, implement, run green, whole suite, commit.**

```
Open the two doors to packing, and fill the card's fifth element

Ruling A11. Continue pack-out lands on the active card at Pack-out and
nowhere else: at On trip the slot stays empty, because the CTA names the
current phase verb whose control is the chip already on the card, and
Continue unpack would name F5, a screen that does not exist. Unpack's CTA is
S10's to draw.

The progress line returns BELOW the NEXT line — §5's order, the permanent
obligation above the arithmetic and the arithmetic above the action — and on
Active cards only. A Draft's ● 0/59 PIECES would state progress against an
arrangement invariant 17 makes inert.

No packingHref prop: buildListHref is a prop because it is width-dependent,
and /trips/:id/packing is the same route everywhere, so the component builds
it inline and @container-never-a-media-query stays true with one exception
fewer.

One consequence the round did not name: the GEAR LIST band renders only when
the Trip has Entries, so a Trip with an empty gear list has no drawn door to
F4. That is the right answer — a route to a screen that can only say
0 ENTRIES. is the dead affordance the empty region's own rule forbids — but
it is recorded and flagged for the next round rather than papered over.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Task 14: The doc amendments

Spec §7 and §9. **Every one of these is a document that would otherwise be
wrong**, not housekeeping.

**Files:**
- Modify: `docs/sync-protocol.md` §4.4
- Modify: `docs/architecture-design.md` §8.3, §8.5, and a new §12.15
- Modify: `docs/technical-debt.md`
- Modify: `docs/specs/2026-09-01-packing-and-the-journey.md` (a new §11)
- Modify: `docs/design/README.md` (one code-authored line, §1)
- Modify: `CLAUDE.md`

- [ ] **Step 1: `sync-protocol.md` §4.4**

The Packing table's five rows are **already written** and need no change. Add
the note that `status` and `stage` are **open enums whose authoring rule is not
a reader gate**, beside the identical notes `TagString` and `bring_count`
already carry.

- [ ] **Step 2: `architecture-design.md` §8.3**

**S9 splits into S9a and S9b**, on the seam §8.4 already uses. S9a's entry loses
its **story-3 and story-13 clauses to S9b**.

- [ ] **Step 3: `architecture-design.md` §8.5**

The dimension table's `Packing status; Container | S9` row becomes
`Container (home) | S9b`, and **`Packing status` leaves the table** with a
sentence naming ruling B4. Story 13 is then complete at S10 having been touched
by **five** slices, one of which contributed a capability rather than a
dimension.

- [ ] **Step 4: `architecture-design.md` §12.15 — S9a's consequences**

Written **after** the slice lands, not before. It must carry, at minimum:
- the five registers and the two tracks;
- `stage` xor `status` as a reader gate, and why it can never be a reducer gate;
- the two absent reads and their one home;
- ruling A5 narrowing ruling L, and that `pieceCountOf` moved shipped numbers;
- the second containment view and its non-drift obligation;
- ruling A7's partition and the story-23 arithmetic that made the frame
  unbuildable;
- ruling A15's direct-set rail, and that a redundant write moves the stamp;
- the trip card's five elements now full, and NEXT-above-progress;
- what S9b still owes (the cost stated plainly: **between S9a and S9b a
  household can pack a Trip and the Depot will not say so** — Find answers
  `⌂ HAL ▸ LADE 2` for a headlamp that is in the duffel, in the car).

- [ ] **Step 5: `docs/technical-debt.md` — one line each, with a grep anchor**

**Opens two:**
1. **A second containment view, and no shared shape.** `tripContainment.ts`
   restates `containment.ts`'s traversal, its sorted-id determinism and §3.6's
   cycle break over a different pointer type. The duplication is deliberate —
   a shared implementation would take a strategy object for every line — **but
   the two must not drift, and the break rule is the half that would be silent
   if they did.**
2. **`useScreenHeader`'s tenth and eleventh callers disagree about the same
   question.** F4 passes `atDesktopSidebarCarriesDestination: false` and keeps
   `‹ ALPS 2026` at Desktop; `GearListBuilder`'s **default** door points at the
   same kind of destination — one specific Trip, which no sidebar row carries —
   and the round did not look at it. **Either the builder is drawn wrong at
   Desktop or F4 is**, and the boards draw the builder at 1024 with *no sidebar
   at all*, which is why the question has never been forced.

**Closes nothing outright.** The `WhereaboutsCard` collision entry is **S9b's**
to close and stays open through S9a — correct, since this slice creates the
facts that make it reachable.

- [ ] **Step 6: The spec's own §11 — what changed during implementation**

The precedent `the-gear-list.md` §11 sets and this repo's own S4-fixture lesson
names: **a dated spec is left as it was written, and what changed lives in its
own new section, never edited back into the sections it corrects.**

Carry at least:
- **A Piece with no `residence` register reads its Entry's, then loose**
  (Task 5) — a decision the spec did not take.
- **`isContainerEntry` landed in `entry.ts`, not `packing.ts`**, because three
  files need it and `entry.ts` is where "what does this Entry's Gear say"
  already lives — spec §3.6 said `entry.ts` was untouched, and it means the four
  named functions.
- **`PersonCircle` widened to 28 and 34** (spec §4 named the sizes, §3.6's
  "untouched" list did not mention `ui/`).
- **A Trip with an empty gear list has no drawn door to F4** (Task 13), flagged
  for the next round.
- Anything else a task discovered. **Write it here, not into the sections above
  it.**

- [ ] **Step 7: `docs/design/README.md` — one code-authored line**

§1's F4 entry gains the empty-list door consequence, marked as code-authored so
it survives the next regeneration. **`docs/design/README.md` has two writers**
(the boards and code); a code-authored annotation must be written so a
designer re-seeding from the repo copy keeps it.

Do **not** touch `S9 Round - Packing and the Journey.dc.html` — that is the
designer's file.

- [ ] **Step 8: `CLAUDE.md` — the status section**

Add S9a's entry after S8's, in the house shape: what landed, the ops, the files,
and **the three-to-six things worth knowing before touching this area**. The
strongest candidates:
- `stage` xor `status` is a reader gate, and the third time this codebase has
  had to say so.
- A container is not a piece, and A5 moved shipped numbers.
- The rail is a direct set, and tapping the current stage writes nothing.
- PERSON mode means *whose it is*; the drawn frame's arithmetic needed story 23.
- Two containment views that must not drift.
- **S9b is owed, and what it costs meanwhile.**

Note the S9a/S9b split explicitly, as CLAUDE.md already does for S2a/S2b.

- [ ] **Step 9: Verify and commit**

Run: `npm run format:check` and `npx prettier --check docs/**/*.md`
Run: `npx vitest run` — PASS in full.

```
Amend the docs S9a made wrong, and open the two debts it takes on

Every one of these is a document that would otherwise be false. §8.3 draws S9
as one slice and it is two. §8.5 assigns Packing status to the Depot's slice
bar and ruling B4 retired it outright, so the row leaves the table and
Container moves to S9b as the home container. §4.4's Packing rows gain the
note that their two open enums carry an authoring rule and not a reader gate,
beside the identical notes TagString and bring_count already have.

Two debts open. The trip's containment view restates the home one's traversal
over a different pointer type: deliberate, because a shared implementation
would take a strategy object for every line, but the cycle break is the half
that would be silent if the two drifted. And useScreenHeader's tenth and
eleventh callers now disagree about the same question — either the builder is
drawn wrong at Desktop or F4 is, and the boards draw the builder at 1024 with
no sidebar at all, which is why it has never been forced.

The spec keeps its date and gains a §11 rather than being edited: what
changed during implementation lives in its own section, never back in the
sections it corrects.

Claude-Session: https://claude.ai/code/session_01Rf8aLEoBEoG2EA8Ayr9MRR
```

---

## Self-review — spec coverage

| Spec section | Task |
| --- | --- |
| §1 five ops, §1.1 register map, §1.5 one op not N | 1 |
| §1.2 two tracks, two registers, one row | 1, 10 |
| §1.3 `stage` xor `status` is an authoring rule | 1 (reducer), 2 (gate) |
| §1.4 two absent reads, both enums open | 1, 2 |
| §2 state shape | 1 |
| §3.1 two tables, eight functions, no `nextStage` | 2 |
| §3.2 the trip's containment view, §3.6's cycle break | 3 |
| §3.3 a container is not a piece | 4 |
| §3.4 the counts and the person partition | 5, 11 (drawn order) |
| §3.5 the disagreement threshold | 5, 10 (drawn) |
| §3.6 what is untouched (`whereabouts`, `slice.ts`, `claim.ts`) | 4 (verified), 14 (docstring) |
| §4.1 one route, every phase | 9 |
| §4.2 the screen top to bottom, three modes, empty list | 9, 10, 11 |
| §4.3 the row's two targets | 10 |
| §4.4 the Piece status sheet | 8 |
| §4.5 the Pack picker | 7 |
| §4.6 which move confirms | 7 (confirm), 10 (rail never) |
| §4.7 the rail | 10 |
| §4.8 widths, the back link at Desktop | 9 (flag), 12 (CSS + band) |
| §4.9 the way in | 13 |
| §4.10 drawn and not built | 9 |
| §5.1 Tier 1 | 1, 2, 3, 4, 5 |
| §5.2 Tier 2 convergence | 6 |
| §5.3 Tier 3 component, and the two suites no other tier can own | 7, 8, 10, 11, 12, 13 |
| §5.4 the fixture rule | 1 |
| §6 what the round ruled | referenced throughout |
| §7 doc amendments | 14 |
| §8 what S9a does not build | not built, by omission; §12.15 records it |
| §9 technical debt | 14 |

**Three things a fresh implementer will get wrong unless they read this twice:**

1. **`Loose` is *first* in the Pack picker and *last* on the screen.** Ruling A3
   is about the screen's groups. Both are correct; neither is a bug to fix.
2. **The progress line goes *below* the NEXT line.** §12.11 said "above" until
   the S6 design round corrected it.
3. **The reducer never gates `status` against `stage`.** Every instinct says add
   the check; adding it makes the fold order-dependent on another aggregate's
   arrival and is the exact mistake §1.3 exists to prevent.
