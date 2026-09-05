# S8 — Per-person Pieces · implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a per-person Entry's Pieces individually removable and
restorable, so a Trip can carry the headlamp for two of its three Participants
and every count, claim and total agrees.

**Architecture:** Two catalogued ops write one `removed` register on a new
`entries.<id>.pieces.<person_id>` entity. Pieces are **derived** — the Trip's
Participants minus the tombstoned — stated in exactly one selector
(`shared/src/selectors/piece.ts`), which `pieceCountOf` and the claim selector
then read. The UI gains a `ui/PersonCircle` primitive, a `ui/PersonCluster` that
caps at four painted slots, a Piece picker sheet, and Piece-level settle routes
on the over-claim band.

**Tech Stack:** TypeScript, React 18, Vite, Vitest + Testing Library, Radix
(via `ui/Sheet`), CSS Modules. No server, no schema, no endpoint.

**Spec:** [`docs/specs/2026-08-31-per-person-pieces.md`](2026-08-31-per-person-pieces.md)
— read it alongside this plan. Design authority is
[`docs/design/README.md`](../design/README.md) **§5d** (rulings A–I) and
`Screens B` **§02D**; where the spec and §5d disagree, §5d wins.

## Global Constraints

- **Relative imports in `shared/` carry an explicit `.ts` extension.** `app/`
  and `ui/` carry none (Vite resolves). Never mix.
- **Ops mirror the wire: `snake_case` payload keys, never transformed.** Folded
  state and props are camelCase. The reducer is the only place the two meet.
- **`npm ci` has been run in this worktree.** If `@foerier/shared` resolves
  oddly, run `npm run check:workspaces` — it names the fix.
- **Every task ends green.** `npx vitest run` must pass in full, not just the
  new file. Pre-commit runs Tier 0 (`tsc` across all workspaces, ESLint,
  Prettier) and will reject a commit that fails any of them.
- **Copy is verbatim from §5d.** Do not improve, shorten, or re-case a drawn
  string. `WHO BRINGS ONE · 2 OF 3`, `BRINGS ONE ✓`, `NO PARTICIPANTS`,
  `REMOVE MARK'S PIECE HERE`, `REMOVE MARK'S PIECE ON VOSGES`,
  `Remove Mark's piece from Vosges?`, `Remove piece`.
- **A drawn size is the painted size** (ruling O). 48 floors the **hit area**
  via a non-painting `::after`, clamped at the owning row's bounds. Never add
  `min-height` to make a control reachable.
- **Circles are never individual tap targets** (ruling B). This is the one rule
  most likely to be violated by an implementer working from intuition.
- **Battery discipline:** commit at every task boundary. The session may be
  suspended between tasks and resumed later.

---

## File structure

**Created**

| Path | Responsibility |
| --- | --- |
| `shared/src/selectors/piece.ts` | The one derivation: `pieceInclusion`, `piecesOf` |
| `shared/src/selectors/piece.test.ts` | Tier 1 for the above |
| `shared/src/reduce.pieces.test.ts` | Tier 1 for `writePiece` and the two handlers |
| `shared/fixtures/s8-pieces.ops.json` | Wire-format fixture for the two op types |
| `shared/src/fixtures.s8.test.ts` | Replays it through the current reducer |
| `ui/src/PersonCircle.tsx` + `.module.css` + `.test.tsx` | The primitive (5 existing copies fold in) |
| `ui/src/PersonCluster.tsx` + `.module.css` + `.test.tsx` | Ruling E: four slots, `+N`, dashed-first |
| `app/src/components/PiecePicker.tsx` + `.module.css` + `.test.tsx` | Ruling C's sheet |

**Modified** — `shared/src/state.ts` · `reduce.ts` · `authoring.ts` ·
`index.ts` · `selectors/entry.ts` · `selectors/claim.ts` (+ its test) ·
`ui/src/index.ts` · `app/src/components/EntryRow.tsx` (+ css, test) ·
`GearListSection.tsx` · `OverClaimBand.tsx` (+ css, test) ·
`RemoveElsewhereConfirm.tsx` (+ test) · `TripCard.tsx` ·
`app/src/screens/Trip.tsx` · `GearListBuilder.tsx` · `People.tsx` ·
`app/src/components/ParticipantPicker.tsx` · `app/src/screens/drawnSizes.test.ts` ·
`shared/src/convergence.test.ts` · plus the docs named in Task 11.

---

## Task 1: The two ops — state, reducer, authoring

**Files:**
- Modify: `shared/src/state.ts` (add `PieceState`, `EntryState.pieces`)
- Modify: `shared/src/reduce.ts` (add `writePiece`, two handlers, two dispatch rows)
- Modify: `shared/src/authoring.ts` (add two builders)
- Modify: `shared/src/index.ts` (export the type and the two builders)
- Test: `shared/src/reduce.pieces.test.ts` (create)

**Interfaces:**
- Consumes: `writeEntry`, `writeRegister`, `readString` (all already in `reduce.ts`).
- Produces: `PieceState`; `EntryState.pieces?: Readonly<Record<string, PieceState>>`;
  `tripPieceRemoved(tripId, entryId, personId): OpSpec`;
  `tripPieceRestored(tripId, entryId, personId): OpSpec`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/reduce.pieces.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { anOp, aTrip, hlcAt } from '../testUtils/index.ts'
import {
  tripPieceRemoved,
  tripPieceRestored,
  tripEntryAdded,
  type OpSpec,
} from './authoring.ts'
import { emptyState, fold } from './reduce.ts'
import type { HouseholdState } from './state.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'
const DEFAULT_MS = 1_700_000_000_000

function depot(...specs: readonly (readonly OpSpec[])[]): HouseholdState {
  return fold(
    specs
      .flat()
      .map((spec, i) =>
        anOp(spec, { hlc: hlcAt(i + 1, DEFAULT_MS), deviceId: DEV_A }),
      ),
    emptyState(),
  )
}

const TRIP = '50000000-0000-7000-8000-000000000001'
const ENTRY = 'e0000000-0000-7000-8000-000000000001'
const GEAR = 'a0000000-0000-7000-8000-000000000001'
const KIM = 'c0000000-0000-7000-8000-000000000003'

describe('trip.piece_removed / trip.piece_restored', () => {
  it('writes a tombstone on one Piece', () => {
    const state = depot(
      aTrip({ id: TRIP }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
    )
    expect(
      state.trips[TRIP]?.entries?.[ENTRY]?.pieces?.[KIM]?.removed?.value,
    ).toBe(true)
  })

  it('restores only when strictly later', () => {
    const later = depot(
      aTrip({ id: TRIP }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
      [tripPieceRestored(TRIP, ENTRY, KIM)],
    )
    expect(
      later.trips[TRIP]?.entries?.[ENTRY]?.pieces?.[KIM]?.removed?.value,
    ).toBe(false)
  })

  it('creates the Entry on sight when the piece op arrives first', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripPieceRemoved(TRIP, ENTRY, KIM),
    ])
    const entry = state.trips[TRIP]?.entries?.[ENTRY]
    expect(entry?.source).toBeUndefined()
    expect(entry?.pieces?.[KIM]?.removed?.value).toBe(true)
  })

  it('ignores a payload with no person_id, writing nothing', () => {
    const state = depot(
      aTrip({ id: TRIP }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [
        {
          type: 'trip.piece_removed',
          aggregate: 'trip',
          aggregate_id: TRIP,
          payload: { entry_id: ENTRY },
        } as unknown as OpSpec,
      ],
    )
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.pieces).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run shared/src/reduce.pieces.test.ts`
Expected: FAIL — `tripPieceRemoved` is not exported from `./authoring.ts`.

- [ ] **Step 3: Add `PieceState` and the `pieces` map**

In `shared/src/state.ts`, above `EntryState`:

```ts
/**
 * One Participant's copy of a per-person Entry
 * (`sync-protocol.md` §3.7).
 *
 * S8 declares **one** of §3.7's four registers. `status` and `residence` are
 * S9's (`trip.piece_status_set`, `trip.piece_moved`); `outcome` is S10's. A
 * register nobody writes is a field every reader must have an opinion about,
 * so each arrives with the slice that writes it — `EntryState`'s own rule,
 * one level deeper.
 */
export interface PieceState {
  /** The Person id. The map key and this field are the same value. */
  readonly id: string
  /** Tombstone. `trip.piece_restored` clears it, if strictly later. */
  readonly removed?: Register<boolean>
}
```

and inside `EntryState`, after `removed`:

```ts
  /**
   * Per-Person entities, keyed by Person id — a map of **entities**, like
   * `entries` and unlike `participants`, whose members carry only presence.
   *
   * A key here is a Piece some op has *addressed*, which is a different fact
   * from a Piece **existing**: existence is the Trip's Participants minus
   * these tombstones, and `selectors/piece.ts` is the only place that says
   * so.
   */
  readonly pieces?: Readonly<Record<string, PieceState>>
```

Delete `EntryState`'s stale sentence `the \`pieces\` map is S8's` from its
docstring's register inventory, leaving the S9/S10 clauses intact.

- [ ] **Step 4: Add `writePiece` and the handlers**

In `shared/src/reduce.ts`, directly beneath `writeEntry`:

```ts
/**
 * Nested inside {@link writeEntry} exactly as that is nested inside
 * `writeTrip` — the third level of one pattern, not a new one.
 *
 * The identity guard is the same and matters for the same reason: a losing
 * write must return the identical object so `slice.ts`'s `WeakMap` memo is
 * not invalidated by an op that changed nothing.
 */
function writePiece(
  state: HouseholdState,
  tripId: string,
  entryId: string,
  personId: string,
  stamp: Stamp,
  update: (piece: PieceState, stamp: Stamp) => PieceState,
): HouseholdState {
  return writeEntry(state, tripId, entryId, stamp, (entry, st) => {
    const existing = entry.pieces?.[personId]
    const current = existing ?? { id: personId }
    const updated = update(current, st)
    if (updated === current && existing !== undefined) return entry
    return { ...entry, pieces: { ...entry.pieces, [personId]: updated } }
  })
}
```

and beside the entry handlers:

```ts
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
```

Add to the `handlers` record, beneath `'trip.entry_bring_count_set'`:

```ts
  'trip.piece_removed': tripPieceWritten(true),
  'trip.piece_restored': tripPieceWritten(false),
```

Add `PieceState` to `reduce.ts`'s existing `import type { … } from './state.ts'`.

- [ ] **Step 5: Add the two authoring builders**

In `shared/src/authoring.ts`, after `tripEntryBringCountSet`:

```ts
/**
 * §4.4: tombstones one Participant's Piece. *This is* "that Person isn't
 * bringing one" (invariant 10) — there is no "not coming" status anywhere
 * (invariant 11).
 */
export function tripPieceRemoved(
  tripId: string,
  entryId: string,
  personId: string,
): OpSpec {
  return {
    type: 'trip.piece_removed',
    aggregate: 'trip',
    aggregate_id: tripId,
    payload: { entry_id: entryId, person_id: personId },
  }
}

/** §4.4: clears {@link tripPieceRemoved}'s tombstone, if strictly later. */
export function tripPieceRestored(
  tripId: string,
  entryId: string,
  personId: string,
): OpSpec {
  return {
    type: 'trip.piece_restored',
    aggregate: 'trip',
    aggregate_id: tripId,
    payload: { entry_id: entryId, person_id: personId },
  }
}
```

> **Check the `OpSpec` shape against `tripEntryRemoved` directly above and
> match it exactly** — if that function spells the aggregate id field
> differently, follow it rather than this snippet.

- [ ] **Step 6: Export from `shared/src/index.ts`**

Add `PieceState` to the `export type { … } from './state.ts'` block, and
`tripPieceRemoved`, `tripPieceRestored` to the `export { … } from
'./authoring.ts'` block. Both lists are alphabetical — keep them so.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run shared/`
Expected: PASS, including the four new cases.

- [ ] **Step 8: Commit**

```bash
git add shared/src/state.ts shared/src/reduce.ts shared/src/authoring.ts \
        shared/src/index.ts shared/src/reduce.pieces.test.ts
git commit -m "Fold a Piece, one register deep"
```

---

## Task 2: The one derivation — `piece.ts`

**Files:**
- Create: `shared/src/selectors/piece.ts`, `shared/src/selectors/piece.test.ts`
- Modify: `shared/src/selectors/entry.ts` (`pieceCountOf`), `shared/src/index.ts`

**Interfaces:**
- Consumes: `participantIds(trip)` from `./trip.ts`; `EntryState`, `TripState`.
- Produces: `pieceInclusion(entry, trip): readonly PieceInclusion[]` where
  `PieceInclusion = { readonly personId: string; readonly included: boolean }`;
  `piecesOf(entry, trip): readonly string[]`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/selectors/piece.test.ts`. Use `entry.test.ts`'s `foldAt`
idiom verbatim (copy its `foldAt`/`depot`/`trip` helpers from the top of that
file — a sixth copy of the stamper, which Task 11 records against the standing
debt entry rather than paying here).

```ts
const MARK = 'c0000000-0000-7000-8000-000000000001'
const ELS = 'c0000000-0000-7000-8000-000000000002'
const KIM = 'c0000000-0000-7000-8000-000000000003'

describe('piecesOf', () => {
  it('is every Participant when no piece op has been authored', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK, ELS, KIM] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
    )
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual([MARK, ELS, KIM].sort())
  })

  it('subtracts a tombstoned Piece', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK, ELS, KIM] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
    )
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual([MARK, ELS].sort())
  })

  it('gives a late Participant a Piece with no backfill op', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripParticipantAdded(TRIP, ELS)],
    )
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual([MARK, ELS].sort())
  })

  it('keeps a tombstone across a Participant removal and re-add', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK, KIM] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
      [tripParticipantRemoved(TRIP, KIM)],
      [tripParticipantAdded(TRIP, KIM)],
    )
    // A tombstone never cascades (sync §3.5). Re-asserting "Kim is on the
    // trip" was never a statement about "Kim brings her own headlamp".
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual([MARK])
  })

  it('ignores a tombstone for a Person who is not a Participant', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
    )
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual([MARK])
  })

  it('is empty for a Trip with no Participants', () => {
    const state = depot(aTrip({ id: TRIP }), [
      tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR }),
    ])
    expect(piecesOf(entryOf(state), trip(state, TRIP))).toEqual([])
  })
})

describe('pieceInclusion', () => {
  it('reports every Participant, included or not', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK, KIM] }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
    )
    expect(pieceInclusion(entryOf(state), trip(state, TRIP))).toEqual(
      [
        { personId: MARK, included: true },
        { personId: KIM, included: false },
      ].sort((a, b) => (a.personId < b.personId ? -1 : 1)),
    )
  })
})

describe('pieceCountOf', () => {
  it('counts included Pieces, not Participants', () => {
    const state = depot(
      aTrip({ id: TRIP, participants: [MARK, ELS, KIM] }),
      aGear({ id: GEAR, kind: 'per_person' }),
      [tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR })],
      [tripPieceRemoved(TRIP, ENTRY, KIM)],
    )
    expect(pieceCountOf(entryOf(state), trip(state, TRIP), state)).toBe(2)
  })
})
```

`entryOf(state)` is a one-line local helper: `state.trips[TRIP]!.entries![ENTRY]!`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run shared/src/selectors/piece.test.ts`
Expected: FAIL — no module `./piece.ts`.

- [ ] **Step 3: Write `piece.ts`**

```ts
import type { EntryState, TripState } from '../state.ts'
import { participantIds } from './trip.ts'

/**
 * **A Piece's existence, stated once** — beside `entry.ts` and `claim.ts`, and
 * the same shape of problem: a fact several surfaces must agree on, computed
 * here rather than at each of them.
 *
 * A Piece is **derived, never enumerated** (`sync-protocol.md` §4.4): the
 * Trip's Participants minus those explicitly tombstoned. `trip.entry_added`
 * lists no Pieces and there is no `piece_added` op, which is what keeps "add a
 * Participant later and they get a Piece" true **with no backfill op**.
 *
 * This is `ownerOf`'s rule and `phaseOf`'s rule for a third time, and it earns
 * the same defence: a call site re-deriving it will drift, and the symptom is a
 * row whose `×N` disagrees with the circles beside it.
 *
 * Two rules follow that a reader must not re-decide:
 *
 * - **A tombstone outlives its Participant.** Remove Kim's Piece, drop Kim
 *   from the Trip, add her back: the Piece is still out. Clearing it on re-add
 *   would be a cascade, and §3.5 is categorical that a tombstone never
 *   cascades.
 * - **A tombstone for a non-Participant is inert**, not an error. Starting
 *   from Participants and subtracting is *how* invariant 10 is honoured, so
 *   there is no gate to write.
 *
 * **Order here is by id** — `participantIds`' own total, replica-identical
 * order — and it is deliberately **not** the drawn order. Surfaces order by
 * Person label through `tripParticipants`, and ruling E then sorts excluded
 * circles to the front; both live at the cluster, not here.
 *
 * Takes no `HouseholdState`: unlike `entryKind` or `bringCountOf` this asks
 * nothing of another aggregate.
 */
export interface PieceInclusion {
  readonly personId: string
  readonly included: boolean
}

/** Every Participant, and whether their Piece is included. */
export function pieceInclusion(
  entry: EntryState,
  trip: TripState,
): readonly PieceInclusion[] {
  return participantIds(trip).map((personId) => ({
    personId,
    included: entry.pieces?.[personId]?.removed?.value !== true,
  }))
}

/** The Participants whose Piece is included — the count and the claim. */
export function piecesOf(
  entry: EntryState,
  trip: TripState,
): readonly string[] {
  return pieceInclusion(entry, trip)
    .filter((piece) => piece.included)
    .map((piece) => piece.personId)
}
```

- [ ] **Step 4: Point `pieceCountOf` at it**

In `shared/src/selectors/entry.ts`, change the `per_person` case from
`participantIds(trip).length` to `piecesOf(entry, trip).length`, import
`piecesOf` from `./piece.ts`, and **delete** the docstring paragraph beginning
*"Per-person is Participants and **all** of it until S8 tombstones some
Pieces"*, replacing the table row's cell with
`` {@link piecesOf}`(entry, trip).length` ``. Drop the now-unused
`participantIds` import if nothing else in the file uses it.

- [ ] **Step 5: Export from `shared/src/index.ts`**

`export type { PieceInclusion } from './selectors/piece.ts'` and
`export { pieceInclusion, piecesOf } from './selectors/piece.ts'`, in the
existing alphabetical selector blocks.

- [ ] **Step 6: Run the full shared suite**

Run: `npx vitest run shared/`
Expected: PASS. `entry.test.ts`'s existing `pieceCountOf` cases still pass —
with no piece ops authored, `piecesOf` returns every Participant.

- [ ] **Step 7: Commit**

```bash
git add shared/src/selectors/piece.ts shared/src/selectors/piece.test.ts \
        shared/src/selectors/entry.ts shared/src/index.ts
git commit -m "Derive a Piece from the roster, in one place"
```

---

## Task 3: Claims read Pieces

**Files:**
- Modify: `shared/src/selectors/claim.ts` (`claimFor`, `claimsByGear`)
- Test: `shared/src/selectors/claim.test.ts`

**Interfaces:**
- Consumes: `piecesOf` (Task 2).
- Produces: no new exports. `Claim.personIds` changes meaning from "the Trip's
  Participants" to "the Entry's included Pieces".

- [ ] **Step 1: Write the failing tests**

Append to `shared/src/selectors/claim.test.ts`:

```ts
describe('per-person claims read Pieces', () => {
  it('names the included Pieces, not the roster', () => {
    // Alps and Vosges both list the per-person headlamp. Mark is on both;
    // Els is only on Alps and Kim only on Vosges, so Mark is the entire
    // conflict — domain §5.2 permits two active Trips claiming the same
    // per-person gear for *different* people.
    const state = /* Alps: Mark+Els, Vosges: Mark+Kim, both pack_out, both
                     listing GEAR (kind per_person) */
    const [conflict] = overClaims(state)
    expect(conflict?.contestedPersonIds).toEqual([MARK])
  })

  it("settles when the contested Person's Piece comes off one Trip", () => {
    // …the same fold plus tripPieceRemoved(ALPS, ALPS_ENTRY, MARK)
    expect(overClaims(state)).toEqual([])
  })

  it("does not settle when an uncontested Person's Piece comes off", () => {
    // …the same fold plus tripPieceRemoved(ALPS, ALPS_ENTRY, ELS)
    expect(overClaims(state)).toHaveLength(1)
  })

  it('holds no claim at all when every Piece is removed', () => {
    // Alps lists it with all three Pieces removed; Vosges lists it normally.
    // A claim naming nobody is not a claim, so nothing is over-claimed and
    // no settle route can point at the emptied Entry.
    expect(overClaims(state)).toEqual([])
  })
})
```

Fill each `state` using the file's existing `depot(...)` helper — follow the
neighbouring per-person tests for the exact `aGear({ kind: 'per_person' })` and
two-Trip fold shape.

- [ ] **Step 2: Run and watch two of the four fail**

Run: `npx vitest run shared/src/selectors/claim.test.ts`
Expected: the "settles when the contested Person's Piece comes off" and "holds
no claim at all" cases FAIL — `claimFor` still reads the roster.

- [ ] **Step 3: Point `claimFor` at Pieces**

In `claimFor`'s per-person branch:

```ts
  // Pieces, not Participants: removing a Piece releases that Person's claim,
  // which is what makes domain §5.2's per-person rule settleable at the
  // granularity it is stated in.
  const personIds = piecesOf(entry, trip)
  return {
    tripId: trip.id,
    entryId: entry.id,
    count: personIds.length,
    personIds,
  }
```

Import `piecesOf` from `./piece.ts`. In `Claim.personIds`' docstring, **delete**
*"and is the full Participant set of the claiming Trip — Pieces are exactly
Participants until S8 tombstones some (spec §3.3)"*, and say instead that it is
the Entry's included Pieces.

- [ ] **Step 4: Skip a claim that names nobody**

In `claimsByGear`, after computing the claim:

```ts
      const claim = claimFor(kind, trip, entry, state)
      // A claim naming nobody is not a claim. Reachable when every Piece of a
      // per-person Entry has been removed: it raises no false conflict either
      // way (it adds 0 to `claimed`), but left in `claims` it would give
      // `ConflictRow` a settle route pointing at an Entry that is not part of
      // the problem. `entriesOf`'s rule one step on — a claim the reader
      // cannot see is a claim they cannot settle.
      if (claim.personIds !== undefined && claim.personIds.length === 0) continue
      bucket.claims.push(claim)
```

Keep the existing `bucket` lookup and `byGear.set` around it.

- [ ] **Step 5: Run the full shared suite**

Run: `npx vitest run shared/`
Expected: PASS, all four new cases included.

- [ ] **Step 6: Commit**

```bash
git add shared/src/selectors/claim.ts shared/src/selectors/claim.test.ts
git commit -m "Let a claim name Pieces, so it can be settled at one"
```

---

## Task 4: The fixture

**Files:**
- Create: `shared/fixtures/s8-pieces.ops.json`, `shared/src/fixtures.s8.test.ts`
- Create (generated): `shared/src/__snapshots__/fixtures.s8.test.ts.snap`

- [ ] **Step 1: Write the fixture**

Model it on `shared/fixtures/s7-entries.ops.json` — same envelope shape, same
household and device ids, increasing HLCs. It must carry: a `trip.created`, two
`trip.participant_added`, a `gear.recorded` with `kind: "per_person"`, a
`trip.entry_added` referencing it, one `trip.piece_removed`, one
`trip.piece_restored` for a **different** Person, plus the **two probes**:

- a `trip.piece_removed` naming a Person who is not a Participant;
- a `trip.piece_removed` whose `entry_id` names an Entry with no
  `trip.entry_added` anywhere in the file.

- [ ] **Step 2: Write the replay test**

Create `shared/src/fixtures.s8.test.ts`, modelled on `fixtures.s7.test.ts`
including its header. State in that header that S8 introduces the two Piece op
types and that this file pins their wire format and folded effect; and that the
two probes are **unreachable from any screen** though the builders can author
them — each stands in for a peer whose ops arrived out of order.

- [ ] **Step 3: Run to generate the snapshot**

Run: `npx vitest run shared/src/fixtures.s8.test.ts`
Expected: PASS, writing a new snapshot file.

- [ ] **Step 4: Read the snapshot before trusting it**

Open `shared/src/__snapshots__/fixtures.s8.test.ts.snap` and confirm by eye:
the removed Piece carries `removed: true`, the restored one `false`, the
non-Participant probe **is** in `pieces` (folded and retained) and the orphan
probe produced a **sourceless** Entry. A snapshot accepted without reading is
a snapshot of a bug.

- [ ] **Step 5: Commit**

```bash
git add shared/fixtures/s8-pieces.ops.json shared/src/fixtures.s8.test.ts \
        shared/src/__snapshots__/fixtures.s8.test.ts.snap
git commit -m "Pin the Piece ops' wire format in the slice that adds them"
```

---

## Task 5: `ui/PersonCircle`, and the five copies

**Files:**
- Create: `ui/src/PersonCircle.tsx`, `.module.css`, `.test.tsx`
- Modify: `ui/src/index.ts`; `app/src/components/TripCard.tsx`,
  `ParticipantPicker.tsx`; `app/src/screens/Trip.tsx`, `GearListBuilder.tsx`,
  `People.tsx` (and each one's `.module.css`, removing the now-dead `.circle`)

**Interfaces:**
- Produces: `PersonCircle` with
  `{ label?: string | undefined; size: 22 | 24 | 30; tone?: 'control' | 'accent' | 'dashed' | 'none' }`.

- [ ] **Step 1: Write the failing test**

`ui/src/PersonCircle.test.tsx`:

```tsx
it('draws the label it is given', () => {
  render(<PersonCircle label="M" size={22} />)
  expect(screen.getByText('M')).toBeInTheDocument()
})

it('draws an empty circle for a Person with no folded name', () => {
  const { container } = render(<PersonCircle size={22} />)
  expect(container.firstChild).toHaveTextContent('')
})

it('renders an overflow slot from a +N label', () => {
  render(<PersonCircle label="+3" size={22} tone="control" />)
  expect(screen.getByText('+3')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch it fail** — `npx vitest run ui/src/PersonCircle.test.tsx`

- [ ] **Step 3: Write the component**

Props exactly as in the spec's §4.9. The docstring must carry the **why** of
the `tone` prop:

> Three slices want this one border to mean three different things — S5's login
> ring, S8's inclusion, S9's packing fills — so the prop is a **tone**, not a
> semantic state. A `ui/` primitive renders a tone and the **caller** owns the
> meaning, exactly as `Chip` does. `none` is a transparent border holding the
> layout, which is S5's **withdrawal**: the ring *is* the claim "login state is
> known", so when it cannot be known the ring goes rather than turning a third
> colour.

and the **why** of `label` over `initial`:

> Named `label` rather than `initial` because ruling E's overflow slot is this
> same circle with `+3` in it, not a variant of it.

Sizes are the numbers 22 · 24 · 30 (a `sm|md|lg` scale runs out at S9's 28 and
34). `undefined` draws empty, never a placeholder letter.

- [ ] **Step 4: Fold in the five callers**

Each caller keeps its own `role="img"` / `aria-label` on the **cluster** and
passes `aria-hidden` circles as before — do not move that to the primitive.
Mapping:

| Caller | Props |
| --- | --- |
| `TripCard`, `Trip` header, `GearListBuilder` header | `size={22}`, default tone |
| `ParticipantPicker` | `size={30}`, default tone |
| `People` | `size={30}`, `tone={login === 'yes' ? 'accent' : login === 'no' ? 'control' : 'none'}` |

Each caller's `UNNAMED_PERSON_GLYPH` comparison collapses to passing
`label={undefined}`. Delete each module's now-dead `.circle` rule.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: PASS. `People.test.tsx`'s login-ring assertions are the ones most
likely to break — they may query the old class name. Update the query, never
the assertion's meaning.

- [ ] **Step 6: Commit**

```bash
git add ui/src/PersonCircle.tsx ui/src/PersonCircle.module.css \
        ui/src/PersonCircle.test.tsx ui/src/index.ts app/src
git commit -m "Give the person circle one home, and a tone rather than a meaning"
```

---

## Task 6: `ui/PersonCluster` — ruling E

**Files:**
- Create: `ui/src/PersonCluster.tsx`, `.module.css`, `.test.tsx`
- Modify: `ui/src/index.ts`; the three display clusters (`TripCard`, `Trip`
  header, `GearListBuilder` header)

**Interfaces:**
- Consumes: `PersonCircle` (Task 5).
- Produces: `PersonCluster` with
  `{ people: readonly { key: string; label?: string | undefined; tone?: Tone }[]; size: 22 | 24 | 30; label: string }`
  where `label` is the cluster's accessible name.

- [ ] **Step 1: Write the failing test**

```tsx
const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => ({ key: l, label: l }))

it('draws four or fewer whole', () => {
  render(<PersonCluster people={six.slice(0, 4)} size={22} label="Participants" />)
  expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
})

it('draws three circles and a +N from five', () => {
  render(<PersonCluster people={six} size={22} label="Participants" />)
  expect(screen.getByText('+3')).toBeInTheDocument()
  expect(screen.queryByText('D')).not.toBeInTheDocument()
})

it('sorts excluded circles to the front so the exception is never hidden', () => {
  const people = [
    ...six.slice(0, 5).map((p) => ({ ...p })),
    { key: 'Z', label: 'Z', tone: 'dashed' as const },
  ]
  render(<PersonCluster people={people} size={24} label="Who brings one" />)
  // Z is last in input order but excluded, so it survives truncation.
  expect(screen.getByText('Z')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write the component**

Ruling E, in one place: partition `people` into `tone === 'dashed'` first then
the rest, **each keeping the order it arrived in**; if the result is ≤4 render
all of them; otherwise render the first three plus a `PersonCircle` whose
`label` is `` `+${people.length - 3}` `` and whose tone is `control`. Never
shrink below `size`, never wrap, never inner-scroll.

The docstring carries the reason: *inclusion is the default, exclusion is the
signal, so the exception is never the circle hidden behind `+N`* — and that
`×N` beside the cluster is the exact count, so truncation loses no fact.

- [ ] **Step 4: Fold in the three display clusters**

They pass no tones, so for them the rule reduces to four-slots-then-`+N` — a
behaviour they have silently needed since S6. Keep each caller's existing
`aria-label` text by passing it as `label`.

- [ ] **Step 5: Run the whole suite** — `npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add ui/src app/src
git commit -m "Cap a cluster at four slots, and never hide the exception"
```

---

## Task 7: The Piece picker — ruling C

**Files:**
- Create: `app/src/components/PiecePicker.tsx`, `.module.css`, `.test.tsx`

**Interfaces:**
- Consumes: `pieceInclusion` (Task 2), `PersonCircle` (Task 5),
  `ui/Sheet`, `tripParticipants` (`app/src/household/trips.ts`), `useHousehold`.
- Produces: `PiecePicker` with
  `{ trip: TripState; entry: EntryState; onClose: () => void }`.

- [ ] **Step 1: Write the failing test**

```tsx
it('states rather than asks', () => {
  renderPicker(/* 3 participants, Kim's Piece removed */)
  expect(screen.getByText('Headlamp')).toBeInTheDocument()
  expect(screen.getByText('WHO BRINGS ONE · 2 OF 3')).toBeInTheDocument()
})

it('emits one op per tap, in both directions', async () => {
  const { emitted } = renderPicker(/* … */)
  await user.click(screen.getByRole('button', { name: /Kim/ }))
  expect(emitted).toHaveLength(1)
  expect(emitted[0]?.type).toBe('trip.piece_restored')
  await user.click(screen.getByRole('button', { name: /Mark/ }))
  expect(emitted[1]?.type).toBe('trip.piece_removed')
})

it('offers no all/none control', () => {
  renderPicker(/* … */)
  expect(screen.queryByRole('button', { name: /all/i })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Build it**

A `ui/Sheet` with `desktopCard` — ruling C puts it in a popover from Split up,
`ui/Popover` is unbuilt, and `desktopCard` is the standing approximation §4a's
tag picker has used since S3. Title is **the gear name** (`entryLabel`). Beneath
it the mono fact `WHO BRINGS ONE · {included} OF {total}`. One row per
Participant in `tripParticipants` order: `PersonCircle` (tone `control` when
included, `dashed` when not) + name + `BRINGS ONE ✓` when included. Rows are
≥48px and are buttons; tap emits `tripPieceRestored` or `tripPieceRemoved`
immediately — **one op per tap, nothing commits at close**. A ghost `Close`.

No all/none affordance: *a roster is a handful of rows, and S9's long-press is
a status gesture, not this one.*

- [ ] **Step 4: Run** — `npx vitest run app/src/components/PiecePicker.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add app/src/components/PiecePicker.tsx app/src/components/PiecePicker.module.css \
        app/src/components/PiecePicker.test.tsx
git commit -m "Ask who brings one in rows, because circles cannot be tapped"
```

---

## Task 8: The row — rulings A, B, C's empty case, D

**Files:**
- Modify: `app/src/components/EntryRow.tsx`, `.module.css`, `.test.tsx`
- Modify: `app/src/components/GearListSection.tsx` (pass the data through)
- Modify: `app/src/screens/drawnSizes.test.ts`

**Interfaces:**
- Consumes: `PersonCluster` (Task 6), `PiecePicker` (Task 7),
  `pieceInclusion` (Task 2).
- Produces: `EntryRowProps` gains
  `pieces: readonly { personId: string; label: string; included: boolean }[]`
  and `onOpenPiecePicker: () => void`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('draws the cluster and ×N in both modes', () => { /* editable and !editable */ })

it('makes the cluster and ×N one control, never the circles', async () => {
  renderRow({ editable: true, pieces: three })
  const control = screen.getByRole('button', {
    name: 'Who brings one — Headlamp, 2 of 3 bring one',
  })
  expect(control).toBeInTheDocument()
  // The circles inside are not targets.
  expect(within(control).queryAllByRole('button')).toHaveLength(0)
})

it('is inert above Split', () => {
  renderRow({ editable: false, pieces: three })
  expect(screen.queryByRole('button', { name: /Who brings one/ })).not.toBeInTheDocument()
})

it('reads NO PARTICIPANTS with an empty roster, and mounts no control', () => {
  renderRow({ editable: true, pieces: [] })
  expect(screen.getByText('NO PARTICIPANTS')).toBeInTheDocument()
  expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×0')
  expect(screen.queryByRole('button', { name: /Who brings one/ })).not.toBeInTheDocument()
})

it('says ×0 silently when every Piece is removed', () => {
  renderRow({ editable: true, pieces: threeAllExcluded })
  expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×0')
  expect(screen.queryByText(/nobody/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement the trailing slot**

In `trailing()`, the `per_person` case now returns the cluster **and** `×N`
together, wrapped in a `<button>` when `editable` and a `<span>` when not.
Ruling A's amendment to 02C's trailing-column rule: `×N` for Counted,
**cluster + `×N`** for per-person, `—` for everything else.

With **no** Participants: no cluster, no control, the mono `NO PARTICIPANTS`
beside `×0`. This is a domain fact — Pieces derive from Participants — not an
empty state.

`EntryRow`'s docstring gains ruling B's argument in short, because it is the
rule an implementer will otherwise undo:

> **Circles are never individual targets.** 44px hit areas on 32px centres is
> ruling O's own counter-example — the tap for Els lands on Mark and removes
> the wrong Person's Piece — clamped targets reach only ~32px, and spacing to
> clear 44 costs ~132px of a 393 row. So the cluster and `×N` are one control.

- [ ] **Step 4: CSS — paint 24, floor the hit area at 48**

The circles paint at 24 in **both** modes (ruling A: 24 holds at TABLE-44,
display needs no target's air, **no extra dimming** — dim already means
excluded). The **control** carries the non-painting `::after` growing to the
row's 48, clamped within the row so it cannot overlap the `✕`.

- [ ] **Step 5: Extend `drawnSizes.test.ts`**

Add a case asserting the cluster's circles keep an explicit 24px paint and that
the control declares a clamped `::after`. Follow the file's existing
stylesheet-text technique — `css: false` makes `toHaveStyle` pass
unconditionally, so reading the CSS is the only thing that sees it.

- [ ] **Step 6: Wire `GearListSection`**

It already resolves `entryLabel`/`entryKind`/`bringCountOf`/`pieceCountOf`
against the fold; add `pieceInclusion` mapped to `{personId, label, included}`
via `personLabel`, and hold the "which Entry's picker is open" state so the row
can open `PiecePicker`.

- [ ] **Step 7: Run the whole suite** — `npx vitest run`

- [ ] **Step 8: Commit**

```bash
git add app/src ui/src
git commit -m "Draw who brings one on the row, and make the cluster the control"
```

---

## Task 9: The band and the confirm — rulings F and G

**Files:**
- Modify: `app/src/components/OverClaimBand.tsx`, `.module.css`, `.test.tsx`
- Modify: `app/src/components/RemoveElsewhereConfirm.tsx`, `.test.tsx`
- Modify: `app/src/screens/Trip.tsx`, `GearListBuilder.tsx` (wire two callbacks)

**Interfaces:**
- Produces: `SettleRoutes` gains
  `onRemovePieceHere(entryId, personId)` and
  `onRemovePieceThere(tripId, entryId, personId)`.
  `RemoveElsewhereConfirmProps` gains `personId?: string | undefined`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('names the other Trip on a per-person row with only one other Trip', () => {
  // Ruling F's correction: this line class counts claims and cannot name the
  // trip, so the row fact must — always, not only from two other Trips.
  expect(screen.getByTestId('over-claim-fact')).toHaveTextContent(
    'PER-PERSON · CONTESTED MARK · VOSGES',
  )
})

it('offers a route per contested Person per side', () => {
  expect(screen.getByRole('button', { name: "REMOVE MARK'S PIECE HERE" })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: "REMOVE MARK'S PIECE ON VOSGES" })).toBeInTheDocument()
})

it('falls back to REMOVE HERE when the contested Person is the only Piece', () => {
  // F9's rule: removing the Piece and removing the Entry are then the same
  // act, and REMOVE HERE is the honest label.
  expect(screen.getByRole('button', { name: 'REMOVE HERE' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /PIECE HERE/ })).not.toBeInTheDocument()
})

it('renders no routes at all in the facts-only mode', () => { /* no `settle` prop */ })
```

and in `RemoveElsewhereConfirm.test.tsx`:

```tsx
it('states what the op does, not what the actor meant', () => {
  renderConfirm({ personId: MARK })
  expect(screen.getByText("Remove Mark's piece from Vosges?")).toBeInTheDocument()
  expect(
    screen.getByText(
      "Mark's piece comes off the Vosges gear list. The entry stays for everyone else; the gear itself does not move.",
    ),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove piece' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Widen `SettleRoutes` and the per-person branch**

Two callbacks added to the interface, which stays **grouped all-or-nothing** —
so `ActivationConfirm` and `ReopenConfirm` need no change: they pass no
`settle` and gain two routes they do not render.

In `ConflictRow`, the per-person branch renders one route per
`contestedPersonIds` entry per side, with F9's fallback to `REMOVE HERE` when
that Person is the Entry's only included Piece. Names are CSS-uppercased and
never truncated (ruling G); the unnamed sentinel composes as
`REMOVE UNNAMED PERSON'S PIECE …`.

In `rowFact`, force `nameRow` for the per-person line class rather than
inheriting the multi-Trip heuristic.

CSS: from two contested People the routes stack **one wrapped row per person,
gap 6**, so one Person's routes stay adjacent.

- [ ] **Step 4: Add the confirm's Piece variant**

`personId?: string`. When present: title `Remove {name}'s piece from {trip}?`,
body `{name}'s piece comes off the {trip} gear list. The entry stays for
everyone else; the gear itself does not move.`, primary `Remove piece`, and the
emit is `tripPieceRemoved`. Anatomy untouched. Extend the
already-vanished guard: the Person may have left the other Trip's roster while
the sheet was open, which leaves the body's subject as absent as a removed
Entry does.

- [ ] **Step 5: Run the whole suite** — `npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add app/src
git commit -m "Settle a per-person clash on the Piece that caused it"
```

---

## Task 10: Convergence — Tier 2

**Files:**
- Modify: `shared/src/convergence.test.ts`

- [ ] **Step 1: Write the three properties**

Use the file's existing `createReplica` / `exchange` helpers.

```ts
it('converges a piece removal against a restore, in either delivery order', () => {
  // An ordinary LWW pair: the later stamp wins, and the delete does NOT win
  // by being a delete.
})

it('keeps both a Participant added and a Piece removed concurrently', () => {
  // Different registers on different entity paths, so neither is contested.
})

it('unions two Devices removing different Pieces of one Entry', () => {
  // The per-key register property, one level deeper than S3's tagging test.
})
```

- [ ] **Step 2: Run** — `npx vitest run shared/src/convergence.test.ts`

- [ ] **Step 3: Commit**

```bash
git add shared/src/convergence.test.ts
git commit -m "Prove the Piece pair converges from either side"
```

---

## Task 11: The docs

**Files:** `docs/architecture-design.md` · `docs/technical-debt.md` ·
`docs/specs/2026-08-29-the-gear-list.md` · `CLAUDE.md`

- [ ] **Step 1: `architecture-design.md`**

- **§12.14** — consequences of S8, in §12's landing order. Cover: the derived
  Piece and its two tombstone rules; claims reading Pieces; ruling H retiring
  the ladder rung, with the lesson that **a slice number on a board is a claim
  that has to survive the standing rules, not a licence that overrides them**;
  ruling B's cluster-as-control; ruling E's four slots.
- **§8.3's S8 entry** — mark landed, point at the spec and §12.14, and correct
  its *"the per-Person packed view"* bullet: that view is S9's, and S8 delivers
  the Piece it needs.
- **§8.3's S9 entry** — add **Find's per-person answer card**, beside the
  existing "trip residence" bullet, as work S8 held back and S9 inherits
  (`Screens B` 03 is restaged `S8 · PIECES` → `S9`).
- **§8.5** — **delete** the `Per-Person grouping of Pieces | S8` table row
  (ruling H), and change *"touched by **six** slices"* to **five** (S3, S4, S7,
  S9, S10). Mirror the same deletion in `slice.ts`'s copy of that table.

- [ ] **Step 2: `technical-debt.md`**

- The `ui/Popover` entry gains a **second waiting caller**, the Piece picker's
  Split-and-up popover. Anchor unchanged, so edit rather than replace.
- The `foldAt` entry's count moves from *"the fifth hand-rolled
  clock-stamper"* to the sixth — `piece.test.ts` adds one. Recorded rather than
  paid, per the slice precedent.

- [ ] **Step 3: `2026-08-29-the-gear-list.md` §12**

One line: S8 falsified its §3.3 (per-person claims are Participants). **Do not
edit §3.3 itself** — a dated spec is left as written and corrected in its own
trailing section.

- [ ] **Step 4: `CLAUDE.md`**

Add S8's paragraph in the running slice narrative, after S7's, in the same
voice: what landed, and the three or four things worth knowing before touching
Pieces.

- [ ] **Step 5: Verify no stale forward references survive**

```bash
grep -rn "until S8\|S8 derives\|pieces\` map is S8\|PIECES BY PERSON" \
  shared/src app/src ui/src docs --include=*.ts --include=*.tsx --include=*.md \
  | grep -v "docs/specs/2026-08-31" | grep -v "docs/design"
```
Expected: no hits outside the S8 spec and the design bundle. Every hit is a
comment written to be deleted by this slice.

- [ ] **Step 6: Full verification**

```bash
npx vitest run && npm run typecheck && npm run lint && npm run format:check
```
Expected: all green, 1663 + the new tests passing.

- [ ] **Step 7: Commit**

```bash
git add docs CLAUDE.md shared/src/selectors/slice.ts
git commit -m "Record what S8 settled, and retire the rung it did not build"
```

---

## Self-review notes

**Spec coverage.** §1 → Tasks 1–2 · §2 → Task 1 · §3.1–3.2 → Task 2 ·
§3.3–3.4 → Task 3 · §3.5 → Task 11 (a deletion, not a build) · §4.1–4.2, 4.5 →
Task 8 · §4.3 → Task 7 · §4.4 → Tasks 7–8 (no confirm to build) · §4.6–4.7 →
Task 9 · §4.8 → Task 6 · §4.9 → Task 5 · §5.1 → Tasks 1–3 · §5.2 → Task 10 ·
§5.3 → Tasks 5–9 · §5.4 → Task 4 · §7 → Task 11.

**Deliberately deferred, with the spec's §8 as authority:** `ui/Popover`
(approximated by `Sheet`'s `desktopCard`), ruling B's `P` keybinding (the
keyboard surface ships whole or not at all), and the `foldAt` extraction.

**Known ordering constraint:** Task 8 needs 6 and 7; Task 9 needs 2 and 3.
Tasks 1–4 are a clean `shared/`-only run and can land before any UI work
starts, which makes them the right place to stop if the session is
interrupted.
