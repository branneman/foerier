# S7 — The gear list · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Trip gets a real gear list — pick Gear from the Depot, add trip-only Entries, set Bring-counts, and see an over-claim between two Active Trips surfaced rather than blocked.

**Architecture:** Three new op types fold into the Trip's first nested entity map (`TripState.entries`). Two new `shared/` selector modules — `entry.ts` (the list and its counts) and `claim.ts` (the over-claim, a pure function of the fold). Three routes: `/trips/:id` edits in place below Split and reads above it, `/trips/:id/add` is the depot picker below Split, `/trips/:id/list` is the two-pane builder at Split and up. No server change, no migration.

**Tech Stack:** TypeScript monorepo — `shared` (op log, reducer, selectors), `ui` (presentational components), `app` (React + wouter + Zustand). Vitest across four projects; RTL in jsdom for screens.

**Spec:** [`docs/specs/2026-08-29-the-gear-list.md`](2026-08-29-the-gear-list.md) — read it. The boards it argues from are `Screens B` §02, §02A, §02B and **§02C**, plus `docs/design/README.md` §5.

---

## Global Constraints

Copied verbatim from the spec and the repo's standing rules. Every task's requirements implicitly include this section.

- **Ops mirror the wire — `snake_case`, never transformed.** Folded state and UI props are ordinary `camelCase`. Wire `gear_id` → state `gearId`.
- **Relative imports in `shared/` and `api/` carry an explicit `.ts` extension. `app/` and `ui/` do not** (Vite resolves).
- **`null` clears a nullable register; an absent field leaves it alone.** [sync §1.3](../sync-protocol.md) is the authority.
- **Tolerant reader, always.** Unknown fields, unknown enum values and whole unknown op types are retained and ignored, never rejected. Never mutate a stored op.
- **A media query decides which panes or elements *exist*; a container query decides how what exists *lays out*.**
- **The count nouns:** `ENTRIES` counts the list · `PIECES` counts the things · `GEAR` counts the depot. Closed ledger rows keep `PIECES`.
- **Voice: strict ledger.** Terse, factual, numeric; mono CAPS for labels; sentence case for UI text. No exclamation marks, no cheerleading.
- **Exact UI strings are given per task and are not to be improved.** They come from the boards.
- **Every register write goes through `writeRegister` / `writeIfPresent` / `writeNullableIfPresent`.** Never assign a register directly.
- **Identity checks:** every entity writer returns the *same object* when no register changed, so `fold` stays cheap. Follow `writeTrip` (`shared/src/reduce.ts:117`).
- **One question, one function.** No call site re-derives what a selector already answers — three S6 reviews caught exactly this.
- **Never renumber user stories. Never create a merge commit.**
- **Commit at the end of every task.** Pre-commit runs typecheck + eslint + prettier; all must pass.
- **Run `npm test` (or the named project) before committing.** A task is not done with a red suite.

---

## File Structure

**`shared/`**
- `src/state.ts` — add `EntrySource`, `EntryState`, `TripState.entries`
- `src/payloads.ts` — add `readSource`
- `src/reduce.ts` — add `writeEntry` + three handlers + dispatch rows
- `src/authoring.ts` — add three op builders
- `src/selectors/entry.ts` — **new**: the list, the labels, the counts
- `src/selectors/claim.ts` — **new**: claims and over-claims
- `src/selectors/trip.ts` — add `isClosed`, `UNNAMED_TRIP`
- `src/selectors/slice.ts` — add the `trip` dimension + its `WeakMap` index
- `src/index.ts` — export the new surface
- `fixtures/s7-entries.ops.json` + `src/fixtures.s7.test.ts` — **new**

**`ui/`**
- `src/Stepper.tsx` + `src/Stepper.module.css` + `src/Stepper.test.tsx` — **new**
- `src/index.ts` — export it

**`app/`**
- `src/components/EntryRow.tsx` + `.module.css` — **new**
- `src/components/OverClaimBand.tsx` + `.module.css` — **new**
- `src/components/TripOnlySheet.tsx` — **new**
- `src/components/RemoveElsewhereConfirm.tsx` — **new**
- `src/components/GearListSection.tsx` — **new**, the shared group/row body used by the trip screen and the builder
- `src/screens/DepotPicker.tsx` + `.module.css` — **new**, `/trips/:id/add` and the builder's left pane
- `src/screens/GearListBuilder.tsx` + `.module.css` — **new**, `/trips/:id/list`
- `src/screens/Trip.tsx` — the gear-list region, the band, the noun
- `src/screens/Trips.tsx`, `src/components/TripCard.tsx` — `BUILD LIST ›`, the count as a prop, the noun
- `src/screens/AddGear.tsx`, `src/screens/GearDetail.tsx` — fold their hand-rolled steppers into `ui/Stepper`
- `src/components/PhaseSheet.tsx`, `src/components/ReopenConfirm.tsx` — the over-claim previews
- `src/App.tsx` — three routes, two width guards
- `src/shell/screenBand.test.tsx` — the two new screens

---

## Task Dependency Order

```
T1 ops ──► T2 entry selectors ──► T3 claim selectors ──► T4 convergence
                │                        │
                │                        ├──► T5 trip dimension
                │                        │
                ├──► T8 EntryRow + GearListSection
                │         │
T6 ui/Stepper ──┘         ├──► T9 Trip screen (both modes + band)
                          │         │
T7 OverClaimBand ─────────┘         ├──► T10 DepotPicker + /add route
                                    ├──► T11 GearListBuilder + /list route
                                    ├──► T12 TripOnlySheet + RemoveElsewhereConfirm
                                    ├──► T13 Trips list + TripCard
                                    └──► T14 over-claim previews
                                              │
                                              └──► T15 docs
```

---

### Task 1: The three ops — state, reader, reducer, authoring, fixture

**Files:**
- Modify: `shared/src/state.ts`
- Modify: `shared/src/payloads.ts`
- Modify: `shared/src/reduce.ts`
- Modify: `shared/src/authoring.ts`
- Modify: `shared/src/index.ts`
- Create: `shared/fixtures/s7-entries.ops.json`
- Create: `shared/src/fixtures.s7.test.ts`
- Test: `shared/src/reduce.entries.test.ts` (new)

**Interfaces:**
- Consumes: `writeTrip` (`reduce.ts:117`), `writeRegister` (`registers.ts:30`), `writeIfPresent`/`writeNullableIfPresent` (`reduce.ts:137,179`), `readString`/`readCount`/`readBoolean` (`payloads.ts`), `Register<T>`, `Stamp`.
- Produces:
  - `EntrySource = { from: 'depot'; gearId: string } | { from: 'trip_only'; name: string | null; container: boolean }`
  - `EntryState { id: string; source?: Register<EntrySource>; bringCount?: Register<number>; removed?: Register<boolean> }`
  - `TripState.entries?: Readonly<Record<string, EntryState>>`
  - `readSource(payload: Record<string, unknown>, key: string): Read<EntrySource>`
  - `tripEntryAdded(tripId: string, entryId: string, source: EntrySource): OpSpec`
  - `tripEntryRemoved(tripId: string, entryId: string): OpSpec`
  - `tripEntryBringCountSet(tripId: string, entryId: string, count: number): OpSpec`

- [ ] **Step 1: Add the state types**

In `shared/src/state.ts`, beside `Residence` and `Owner`:

```ts
/**
 * Where an Entry's identity comes from ([sync §3.7](../../docs/sync-protocol.md)).
 *
 * One register holds the whole union, so the discriminant is **closed** —
 * unlike `KindValue` and `PhaseValue` it is not widened with `(string & {})`,
 * because `readSource` reads an unrecognised `from` as `absent` and it never
 * reaches state. The tolerance lives at the boundary; the type stays
 * exhaustive.
 */
export type EntrySource =
  | { from: 'depot'; gearId: string }
  | { from: 'trip_only'; name: string | null; container: boolean }

/**
 * One line on a Trip's gear list.
 *
 * S7 declares three of the eight registers [sync §3.7] names. `status`,
 * `residence` and `stage` are S9's; `outcome` and `consumedCount` are S10's;
 * the `pieces` map is S8's. A register nobody writes is a field every reader
 * must have an opinion about, so each arrives with the slice that writes it.
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
}
```

And on `TripState`, replacing the first of its four reservations:

```ts
  /**
   * The gear list, keyed by entry id. A map of **entities**, not of registers
   * — deliberately not `participants`' shape, which is a set whose member
   * carries only presence.
   */
  readonly entries?: Readonly<Record<string, EntryState>>
```

- [ ] **Step 2: Write the failing reader test**

Create `shared/src/reduce.entries.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fold } from './reduce.ts'
import type { OpEnvelope } from './ops.ts'

function op(
  type: string,
  payload: Record<string, unknown>,
  hlc = '0000000000001-0000-a',
): OpEnvelope {
  return {
    id: `${type}-${hlc}`,
    household_id: 'h1',
    aggregate: 'trip',
    aggregate_id: 't1',
    type,
    hlc,
    device_id: 'd1',
    payload,
  }
}

describe('trip.entry_added', () => {
  it('folds a depot source, mapping gear_id to gearId', () => {
    const state = fold([
      op('trip.entry_added', {
        entry_id: 'e1',
        source: { from: 'depot', gear_id: 'g1' },
      }),
    ])
    expect(state.trips['t1']?.entries?.['e1']?.source?.value).toEqual({
      from: 'depot',
      gearId: 'g1',
    })
  })

  it('folds a trip-only source with its name and containment trait', () => {
    const state = fold([
      op('trip.entry_added', {
        entry_id: 'e1',
        source: { from: 'trip_only', name: 'Passports, all', container: false },
      }),
    ])
    expect(state.trips['t1']?.entries?.['e1']?.source?.value).toEqual({
      from: 'trip_only',
      name: 'Passports, all',
      container: false,
    })
  })

  it('creates the Entry but writes no source when `from` is unrecognised', () => {
    const state = fold([
      op('trip.entry_added', {
        entry_id: 'e1',
        source: { from: 'elsewhere', gear_id: 'g1' },
      }),
    ])
    const entry = state.trips['t1']?.entries?.['e1']
    expect(entry).toBeDefined()
    expect(entry?.source).toBeUndefined()
  })

  it('creates the Trip and the Entry when the creation has not arrived', () => {
    const state = fold([
      op('trip.entry_added', {
        entry_id: 'e1',
        source: { from: 'depot', gear_id: 'g1' },
      }),
    ])
    expect(state.trips['t1']).toBeDefined()
    expect(state.trips['t1']?.phase).toBeUndefined()
  })
})

describe('trip.entry_bring_count_set', () => {
  it('folds a count for any Entry — the Kind is on another aggregate', () => {
    const state = fold([
      op('trip.entry_bring_count_set', { entry_id: 'e1', count: 4 }),
    ])
    expect(state.trips['t1']?.entries?.['e1']?.bringCount?.value).toBe(4)
  })

  it('ignores a negative or non-integer count', () => {
    const state = fold([
      op('trip.entry_bring_count_set', { entry_id: 'e1', count: -1 }),
      op('trip.entry_bring_count_set', { entry_id: 'e2', count: 1.5 }),
    ])
    expect(state.trips['t1']?.entries?.['e1']?.bringCount).toBeUndefined()
    expect(state.trips['t1']?.entries?.['e2']?.bringCount).toBeUndefined()
  })
})

describe('trip.entry_removed', () => {
  it('sets the tombstone', () => {
    const state = fold([op('trip.entry_removed', { entry_id: 'e1' })])
    expect(state.trips['t1']?.entries?.['e1']?.removed?.value).toBe(true)
  })

  it('resolves add-versus-remove on one register by plain LWW', () => {
    const added = op(
      'trip.entry_added',
      { entry_id: 'e1', source: { from: 'depot', gear_id: 'g1' } },
      '0000000000002-0000-a',
    )
    const removed = op(
      'trip.entry_removed',
      { entry_id: 'e1' },
      '0000000000001-0000-a',
    )
    // The remove is strictly earlier, so it does not win by being a delete.
    const state = fold([added, removed])
    expect(state.trips['t1']?.entries?.['e1']?.removed?.value).toBe(true)
    expect(state.trips['t1']?.entries?.['e1']?.source?.value).toBeDefined()
  })
})

describe('the fold is order-independent', () => {
  it('reaches the same state from either op order', () => {
    const a = op(
      'trip.entry_added',
      { entry_id: 'e1', source: { from: 'depot', gear_id: 'g1' } },
      '0000000000002-0000-a',
    )
    const b = op(
      'trip.entry_bring_count_set',
      { entry_id: 'e1', count: 3 },
      '0000000000001-0000-a',
    )
    expect(fold([a, b])).toEqual(fold([b, a]))
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test --workspace @foerier/shared -- reduce.entries`
Expected: FAIL — the ops are unknown, so `entries` is undefined and every assertion misses.

- [ ] **Step 4: Add `readSource` to `shared/src/payloads.ts`**

Place it after `readOwner`, following its shape exactly:

```ts
/**
 * Reads an Entry's `source` ([sync §4.4](../../docs/sync-protocol.md)).
 *
 * The wire's `gear_id` becomes `gearId`, the same split `readOwner` already
 * has over `person_id`. An unrecognised `from`, a depot source with no
 * `gear_id`, or a trip-only source with a non-boolean `container` all read
 * `absent`: the op still folds and the Entry is still created, it simply
 * carries no source. Never rejected — §5.3's tolerant reader is absolute.
 */
export function readSource(
  payload: Record<string, unknown>,
  key: string,
): Read<EntrySource> {
  const value = raw(payload, key)
  if (value === undefined) return { kind: 'absent' }
  if (value === null) return { kind: 'null' }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'absent' }
  }
  const source = value as Record<string, unknown>
  if (source['from'] === 'depot') {
    const gearId = source['gear_id']
    if (typeof gearId !== 'string' || gearId === '') return { kind: 'absent' }
    return { kind: 'value', value: { from: 'depot', gearId } }
  }
  if (source['from'] === 'trip_only') {
    const name = source['name']
    const container = source['container']
    if (typeof container !== 'boolean') return { kind: 'absent' }
    if (name !== null && typeof name !== 'string') return { kind: 'absent' }
    return { kind: 'value', value: { from: 'trip_only', name, container } }
  }
  return { kind: 'absent' }
}
```

Import `EntrySource` from `./state.ts` at the top of the file.

- [ ] **Step 5: Add `writeEntry` and the three handlers to `shared/src/reduce.ts`**

`writeEntry` goes directly after `writeTrip`:

```ts
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
 */
function writeEntry(
  state: HouseholdState,
  tripId: string,
  entryId: string,
  stamp: Stamp,
  update: (entry: EntryState, stamp: Stamp) => EntryState,
): HouseholdState {
  return writeTrip(state, tripId, stamp, (trip, st) => {
    const current = trip.entries?.[entryId] ?? { id: entryId }
    const updated = update(current, st)
    if (updated === current) return trip
    return { ...trip, entries: { ...trip.entries, [entryId]: updated } }
  })
}
```

The three handlers, placed with the other Trip handlers:

```ts
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
  return writeEntry(state, op.aggregate_id, entryId.value, stamp, (entry, st) => {
    const source = writeIfPresent(
      entry.source,
      readSource(op.payload, 'source'),
      st,
    )
    if (source === entry.source) return entry
    return { ...entry, ...(source === undefined ? {} : { source }) }
  })
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
  return writeEntry(state, op.aggregate_id, entryId.value, stamp, (entry, st) => {
    const next = writeRegister(entry.removed, true, st)
    return next === entry.removed ? entry : { ...entry, removed: next }
  })
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
  return writeEntry(state, op.aggregate_id, entryId.value, stamp, (entry, st) => {
    const next = writeRegister(entry.bringCount, count.value, st)
    return next === entry.bringCount ? entry : { ...entry, bringCount: next }
  })
}
```

Add three rows to the `handlers` dispatch table:

```ts
  'trip.entry_added': tripEntryAdded,
  'trip.entry_removed': tripEntryRemoved,
  'trip.entry_bring_count_set': tripEntryBringCountSet,
```

Import `readSource` and `EntryState` at the top.

- [ ] **Step 6: Run the test and watch it pass**

Run: `npm test --workspace @foerier/shared -- reduce.entries`
Expected: PASS, all cases.

- [ ] **Step 7: Add the three authoring builders**

In `shared/src/authoring.ts`, after the participant builders:

```ts
/**
 * `sync-protocol.md` §4.4: creates the Entry. A depot Entry **references**
 * gear by identity and copies nothing (invariant 8); a trip-only Entry
 * carries its own name and containment trait.
 *
 * The payload's `gear_id` is the wire's name for the `gearId` the state
 * holds, the same split `gear.owned_count_set{count}` has over `ownedCount`.
 */
export function tripEntryAdded(
  tripId: string,
  entryId: string,
  source: EntrySource,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.entry_added',
    payload: {
      entry_id: entryId,
      source:
        source.from === 'depot'
          ? { from: 'depot', gear_id: source.gearId }
          : {
              from: 'trip_only',
              name: source.name,
              container: source.container,
            },
    },
  }
}

/** §4.4: the tombstone. Also how an over-claim is settled (§3.6). */
export function tripEntryRemoved(tripId: string, entryId: string): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.entry_removed',
    payload: { entry_id: entryId },
  }
}

/**
 * §4.4: sets `bringCount`, absolutely. Counted Entries only — an authoring
 * rule this builder's callers honour and the reducer does not enforce.
 */
export function tripEntryBringCountSet(
  tripId: string,
  entryId: string,
  count: number,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.entry_bring_count_set',
    payload: { entry_id: entryId, count },
  }
}
```

Export all three plus `EntrySource` and `EntryState` from `shared/src/index.ts`.

- [ ] **Step 8: Capture the fixture**

Create `shared/fixtures/s7-entries.ops.json`. It is a `StoredOp[]` — every record carries `seq` and `received_at` — and it must contain these probes, several of which no builder can author:

1. `trip.created` for `t-s7-1` (so the Trip has a name and phase).
2. `trip.participant_added` × 2.
3. `trip.entry_added` with a **depot** source.
4. `trip.entry_added` with a **trip-only** source, `name: null`.
5. `trip.entry_added` with a **malformed** source, `from: "elsewhere"` — folds to a sourceless Entry.
6. `trip.entry_bring_count_set` on a **per-person** Entry — invariant 6 says it should not exist; the reader folds it anyway, and this pins that.
7. `trip.entry_removed` with a **lower `seq`** than its own `trip.entry_added` — the out-of-order case.
8. `gear.recorded` ops for the referenced gear, so the fixture's fold has something to reference.

Follow `shared/fixtures/s6-trips.ops.json` for the record shape and the HLC format exactly.

- [ ] **Step 9: Write the fixture test**

Create `shared/src/fixtures.s7.test.ts`, following `fixtures.s6.test.ts`'s three-test shape:

```ts
import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/s7-entries.ops.json' with { type: 'json' }
import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

/** The Trip every entry op in the fixture addresses. */
const TRIP = 't-s7-1'
/** The depot Entry, referencing recorded gear. */
const DEPOT_ENTRY = 'e-s7-depot'
/** The trip-only Entry, whose `name` is an explicit `null`. */
const TRIP_ONLY_ENTRY = 'e-s7-trip-only'
/** The Entry whose `source.from` this build has never heard of. */
const MALFORMED_ENTRY = 'e-s7-malformed'
/** The per-person Entry carrying a Bring-count invariant 6 forbids. */
const PER_PERSON_ENTRY = 'e-s7-per-person'

describe('the S7 fixture', () => {
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

  it('maps the wire gear_id onto a gearId register', () => {
    const entry = fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[DEPOT_ENTRY]
    expect(entry?.source?.value).toEqual({ from: 'depot', gearId: 'g-s7-tent' })
  })

  it('keeps an explicit null name on a trip-only source', () => {
    const entry =
      fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[TRIP_ONLY_ENTRY]
    expect(entry?.source?.value).toEqual({
      from: 'trip_only',
      name: null,
      container: false,
    })
  })

  it('retains a malformed source as an Entry with no source register', () => {
    const entry =
      fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[MALFORMED_ENTRY]
    expect(entry).toBeDefined()
    expect(entry?.source).toBeUndefined()
  })

  it('folds a Bring-count on a per-person Entry — invariant 6 is the authoring screen’s job', () => {
    const entry =
      fold(fixture as OpEnvelope[]).trips[TRIP]?.entries?.[PER_PERSON_ENTRY]
    expect(entry?.bringCount?.value).toBe(2)
  })
})
```

- [ ] **Step 10: Confirm the S2 fixture's unknown-type probe still holds**

Run: `npm test --workspace @foerier/shared -- fixtures`
Expected: PASS, **including** `shared/src/fixtures.test.ts:52`'s
`state.unfolded.types['trip.entry_status_set']` assertion. That op is S9's and S7 must **not** fold it. If it fails, this task reached past its three op types.

- [ ] **Step 11: Run the whole shared suite and commit**

Run: `npm test --workspace @foerier/shared`
Expected: PASS.

```bash
git add shared/
git commit -m "Fold the gear list's three ops into the Trip's first nested map"
```

---

### Task 2: `selectors/entry.ts` — the list and its counts

**Files:**
- Create: `shared/src/selectors/entry.ts`
- Create: `shared/src/selectors/entry.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `EntryState`, `EntrySource`, `TripState`, `HouseholdState`, `KindValue` (Task 1 + existing); `participantIds` (`selectors/trip.ts:272`); `byNameThenId` (`selectors/order.ts:31`).
- Produces:
  - `entriesOf(trip: TripState, state: HouseholdState): readonly EntryState[]` — takes `state` because it sorts by `entryLabel`, which resolves a depot Entry's name through the Depot
  - `entryLabel(entry: EntryState, state: HouseholdState): string`
  - `entryKind(entry: EntryState, state: HouseholdState): KindValue | 'trip_only'`
  - `bringCountOf(entry: EntryState, state: HouseholdState): number | null`
  - `pieceCountOf(entry: EntryState, trip: TripState, state: HouseholdState): number`
  - `listTotals(trip: TripState, state: HouseholdState): ListTotals`
  - `interface ListTotals { entries: number; pieces: number; perPerson: number; tripOnly: number }`

- [ ] **Step 1: Write the failing tests**

Create `shared/src/selectors/entry.test.ts`. Use `aGear`/`aTrip` from `shared/testUtils` and `fold` to build state; here is the full set of assertions required:

```ts
import { describe, expect, it } from 'vitest'
import {
  bringCountOf,
  entriesOf,
  entryKind,
  entryLabel,
  listTotals,
  pieceCountOf,
} from './entry.ts'

// Build a Trip with two Participants and a mixed list. Use the factories in
// `shared/testUtils/factories.ts` plus `fold`; see `trip.test.ts` for the
// established arrangement.

describe('entriesOf', () => {
  it('excludes a tombstoned Entry', () => {/* remove e1, expect it absent */})
  it('excludes a sourceless Entry but keeps it in the fold', () => {
    // A `trip.entry_bring_count_set` with no preceding `trip.entry_added`.
    // `entriesOf` omits it; `state.trips[t].entries[e]` is still defined.
  })
  it('includes it the moment its trip.entry_added lands', () => {})
  it('orders totally and identically from two op orders', () => {})
})

describe('entryLabel', () => {
  it('reads the referenced Gear’s name through the Depot', () => {
    // Rename the Gear with `gear.renamed` and assert the label changes with
    // **no Trip op at all** — invariant 8's single-sourcing.
  })
  it('reads a trip-only Entry’s own name, which no Gear rename touches', () => {})
  it('falls back as tripLabel does when the name is unset', () => {})
})

describe('bringCountOf', () => {
  it('reads 1 for a Counted Entry with no register', () => {})
  it('reads the register for a Counted Entry that has one', () => {})
  it('reads null for Single, per-person and trip-only Entries', () => {})
  it('reads null after the Kind changes to single, leaving the register in state', () => {
    // The register must still be present on EntryState — not cleared.
  })
})

describe('pieceCountOf', () => {
  it('is 1 for a Single depot Entry', () => {})
  it('is the Bring-count for a Counted Entry, and 1 when absent', () => {})
  it('is the Participant count for a per-person Entry', () => {})
  it('is 1 for a trip-only Entry', () => {})
  it('is 1 for Gear whose Kind is unrecognised', () => {})
})

describe('listTotals', () => {
  it('counts entries, pieces, perPerson and tripOnly over a mixed list', () => {})
  it('counts nothing for a Trip with no entries', () => {})
})
```

Fill each body with a concrete arrangement and assertion — an empty test body is a plan failure, not a test.

- [ ] **Step 2: Run and watch it fail**

Run: `npm test --workspace @foerier/shared -- selectors/entry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `shared/src/selectors/entry.ts`**

```ts
import type {
  HouseholdState,
  EntryState,
  KindValue,
  TripState,
} from '../state.ts'
import { byNameThenId } from './order.ts'
import { participantIds } from './trip.ts'

/** What the builder's footer and the section band count. */
export interface ListTotals {
  /** Lines on the list. */
  readonly entries: number
  /** Physical things: a Bring-count, a Participant count, or one. */
  readonly pieces: number
  /** The pieces contributed by per-person Entries. */
  readonly perPerson: number
  /** Trip-only Entries — one piece each, so this counts both. */
  readonly tripOnly: number
}

/**
 * The Entries a reader may see.
 *
 * **An Entry with no `source` is folded, retained, and not drawn.** Unlike
 * `phase` (which reads `draft`) and `owner` (which reads `SHARED`) there is
 * nothing to default a source to: an Entry naming neither a piece of Gear nor
 * a trip-only name is not a line anybody can draw. It is reachable because
 * `trip.entry_removed` and `trip.entry_bring_count_set` both create the Entry
 * on sight. It is excluded from the list, from every count, and from every
 * claim — the conservative direction, since a claim a reader cannot see is a
 * claim they cannot settle. Nothing is discarded: the moment the
 * `trip.entry_added` arrives the Entry appears.
 *
 * This is the only place that rule is stated.
 */
export function entriesOf(
  trip: TripState,
  state: HouseholdState,
): readonly EntryState[] {
  return Object.values(trip.entries ?? {})
    .filter(
      (entry) => entry.source !== undefined && entry.removed?.value !== true,
    )
    .sort((a, b) => {
      const byLabel = entryLabel(a, state).localeCompare(entryLabel(b, state))
      return byLabel !== 0 ? byLabel : a.id.localeCompare(b.id)
    })
}
```

**Why it takes `state`:** `byNameThenId` (`selectors/order.ts:31`) sorts on a `name` register, which `EntryState` does not have — a depot Entry's name lives on the Gear it references. Sorting by `entryLabel` then `id` gives a **total** order that two replicas compute identically, which is what makes the drawn list convergent. This is the signature every later task consumes.

The remaining functions:

```ts
/** The Gear's name for a depot Entry, the source's own for a trip-only one. */
export function entryLabel(entry: EntryState, state: HouseholdState): string
/** The Kind that governs the row, or `'trip_only'` for an Entry with no Gear. */
export function entryKind(entry: EntryState, state: HouseholdState): KindValue | 'trip_only'
/** The Bring-count, or `null` for every Entry that is not a Counted depot Entry. */
export function bringCountOf(entry: EntryState, state: HouseholdState): number | null
/** How many things this Entry is. */
export function pieceCountOf(entry: EntryState, trip: TripState, state: HouseholdState): number
/** The four numbers the footer and the section band draw. */
export function listTotals(trip: TripState, state: HouseholdState): ListTotals
```

`bringCountOf` returns `null` unless `entry.source?.value.from === 'depot'` **and** the referenced Gear's `kind?.value === 'counted'`; when it is Counted, `entry.bringCount?.value ?? 1`. This is the **fourth** site gating on `kind === 'counted'` (`shared/src/selectors/depot.ts:107`, `shared/src/selectors/whereabouts.ts:62`, `app/src/screens/GearDetail.tsx:78` are the other three), and the reason the question moves behind one function.

`pieceCountOf` follows the spec's table: Single → 1; Counted → `bringCountOf`; per-person → `participantIds(trip).length`; trip-only → 1; unrecognised Kind → 1.

- [ ] **Step 4: Run and watch it pass**

Run: `npm test --workspace @foerier/shared -- selectors/entry`
Expected: PASS.

- [ ] **Step 5: Export and commit**

Add every name above to `shared/src/index.ts`.

Run: `npm test --workspace @foerier/shared`

```bash
git add shared/
git commit -m "Read the gear list through one selector per question"
```

---

### Task 3: `selectors/claim.ts` — the over-claim

**Files:**
- Create: `shared/src/selectors/claim.ts`
- Create: `shared/src/selectors/claim.test.ts`
- Modify: `shared/src/selectors/trip.ts` — add `isClosed`, `UNNAMED_TRIP`
- Modify: `shared/src/selectors/trip.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `entriesOf`, `entryKind`, `bringCountOf` (Task 2); `isActive` (`selectors/trip.ts:221`); `participantIds`.
- Produces:
  - `interface Claim { tripId: string; entryId: string; count: number; personIds?: readonly string[] }`
  - `interface OverClaim { gearId: string; kind: KindValue; claims: readonly Claim[]; supply: number; claimed: number; contestedPersonIds: readonly string[] }`
  - `overClaims(state: HouseholdState): readonly OverClaim[]`
  - `overClaimsFor(state: HouseholdState, tripId: string): readonly OverClaim[]`
  - `overClaimsIfActive(state: HouseholdState, tripId: string): readonly OverClaim[]`
  - `isClosed(trip: TripState): boolean`
  - `UNNAMED_TRIP = 'Unnamed trip'`

- [ ] **Step 1: Add `isClosed` and `UNNAMED_TRIP` to `selectors/trip.ts`**

```ts
/**
 * Whether a Trip is filed away.
 *
 * Beside `isActive` and answering a different question: `isActive` names the
 * three phases whose packing has effect, and this names the one whose list is
 * history. An **unrecognised** phase is not closed, for the same reason it is
 * not active — an old build never over-states what a Trip is doing.
 *
 * The Trip-membership dimension needs this and cannot use `isActive`: a Draft
 * speaks for gear as surely as a Pack-out does.
 */
export function isClosed(trip: TripState): boolean {
  return phaseOf(trip) === 'closed'
}

/**
 * How a Trip with no name reads **in a sentence**.
 *
 * `tripLabel` returns `—`, which is right in a list column and wrong in the
 * over-claim band's prose. The same split `UNNAMED_PERSON` already carries;
 * `tripLabel` is deliberately unchanged.
 */
export const UNNAMED_TRIP = 'Unnamed trip'
```

- [ ] **Step 2: Write the failing claim tests**

Create `shared/src/selectors/claim.test.ts` with concrete arrangements for each:

```ts
describe('Single gear', () => {
  it('reports an over-claim when two active Trips hold it', () => {})
  it('reports nothing when only one active Trip holds it', () => {})
  it('ignores a stray owned_count on Single gear — supply is one', () => {
    // A Gear whose Kind was edited from counted to single keeps its
    // ownedCount register. It must NOT raise Single's supply above one.
  })
})

describe('Counted gear', () => {
  it('reports an over-claim when bring-counts sum past owned_count', () => {})
  it('reads an absent owned_count as 1', () => {})
  it('reports nothing when the sum equals owned_count', () => {})
})

describe('Per-person gear', () => {
  it('reports NOTHING for two active Trips claiming it for disjoint People', () => {
    // Story 6 calls this legitimate. Comparing counts instead of people is
    // the bug this test exists to catch.
  })
  it('reports exactly the shared Person when Participant sets overlap', () => {})
})

describe('only active Trips claim', () => {
  it('reports nothing for a Draft', () => {})
  it('reports nothing for a closed Trip', () => {})
})

describe('overClaimsIfActive', () => {
  it('reports a clash a Draft would cause on activation', () => {})
  it('reports nothing for the same Draft through overClaims', () => {})
})

describe('sourceless entries hold no claim', () => {
  it('ignores an Entry whose trip.entry_added has not arrived', () => {})
})
```

- [ ] **Step 3: Run and watch it fail**

Run: `npm test --workspace @foerier/shared -- selectors/claim`

- [ ] **Step 4: Implement `claim.ts`**

Three branches, per domain §5.2, calling `isActive` and never re-deriving it:

- **Single** — supply 1. More than one active Trip with an unresolved Entry is an over-claim. **Do not consult `ownedCount`.**
- **Counted** — `sum(bringCountOf) > (ownedCount ?? 1)`.
- **Per-person** — supply is one *per Person*. Only a `personId` present in **two** active Trips' Participant sets for that Gear is contested. `Claim.personIds` carries the set.

At the top of the file, a comment naming S10's insertion point:

```ts
/**
 * A claim is held by an **unresolved** Entry — one with no unpack outcome.
 * Outcomes are S10's, so at S7 every non-removed Entry on an active Trip is
 * unresolved and this file reads them all.
 *
 * **S10's gate goes here**, inside this file and nowhere else. A speculative
 * `isResolved` returning `false` today would be a function no caller could
 * make true, and a fifth thing about outcomes to keep in agreement before
 * outcomes exist.
 */
```

- [ ] **Step 5: Run, pass, export, commit**

Run: `npm test --workspace @foerier/shared`

```bash
git add shared/
git commit -m "Surface the over-claim as a selector, never as a guard"
```

---

### Task 4: Tier 2 — the convergence tests

**Files:**
- Modify: `shared/src/convergence.test.ts`

**Interfaces:**
- Consumes: the three builders (Task 1), `overClaims` (Task 3), `createReplica`/`exchange` (`shared/testUtils/replica.ts`).

This is §8.3's named requirement: *the over-claim is surfaced identically on every replica and resolved only by `trip.entry_removed`; nothing recorded is discarded.*

- [ ] **Step 1: Add the three builders to the op generator**

`convergence.test.ts`'s generator enumerates every builder; add `tripEntryAdded`, `tripEntryRemoved`, `tripEntryBringCountSet` so the property-based pass exercises them.

- [ ] **Step 2: Write the six scenario tests**

```ts
it('surfaces the same over-claim on both replicas after a partition', () => {
  // A and B partitioned. Each adds the SAME Single gear to a DIFFERENT
  // active Trip. After exchange: both hold both Entries, and
  // overClaims(A.state) deep-equals overClaims(B.state), non-empty.
})

it('clears the over-claim on both replicas when one removes an entry', () => {
  // Then A emits tripEntryRemoved. After exchange both agree it is gone,
  // and the OTHER Trip's Entry is untouched.
})

it('resolves two Bring-count edits by plain LWW, keeping the loser in the log', () => {})

it('converges when a bring-count and a removal precede the entry_added', () => {})

it('resolves a concurrent add and remove on one register by LWW', () => {
  // Delete does NOT automatically win — sync §3.5.
})

it('reports no over-claim for per-person gear taken for disjoint People', () => {})
```

- [ ] **Step 3: Run and commit**

Run: `npm test --workspace @foerier/shared -- convergence`

```bash
git add shared/
git commit -m "Prove the over-claim converges and settles by removal alone"
```

---

### Task 5: The `TRIP` dimension and its index

**Files:**
- Modify: `shared/src/selectors/slice.ts`
- Modify: `shared/src/selectors/slice.test.ts`

**Interfaces:**
- Consumes: `entriesOf` (Task 2), `isClosed`, `tripLabel` (Task 3), `visibleTrips`.
- Produces: `DimensionId` widened with `'trip'`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("dimension('trip')", () => {
  it('lists every non-closed Trip that carries the gear', () => {})
  it('excludes closed Trips, so their gear can read NOT IN ANY TRIP', () => {})
  it('returns the sentinel for gear no Trip lists', () => {})
  it('formats the sentinel as NOT IN ANY TRIP and a trip as its label', () => {})
  it('orders the sentinel first', () => {})
  it('returns 0 of N for the sentinel plus a named Trip', () => {})
  it('is multi arity, so two Trips AND together', () => {})
})
```

- [ ] **Step 2: Add the row**

Widen `DimensionId` to `'tag' | 'kind' | 'ownership' | 'person' | 'trip'` and add the table row: `label: 'TRIP'`, `arity: 'multi'`, `valuesOf` returning trip ids or `['none']`, `format` checking the sentinel **first** and otherwise returning `tripLabel`.

- [ ] **Step 3: Add the memo**

`valuesOf` is called once per Gear per active dimension, and this is the first dimension whose answer is cross-aggregate — answering per Gear means scanning every Trip's Entries, which is O(gear × entries) on the app's most-visited screen.

```ts
/**
 * The gear→trips index, memoised on the folded state.
 *
 * `HouseholdState` is immutable and its identity changes on exactly the folds
 * that could change this answer — the reducer returns the same object when a
 * write loses — so the key is exact rather than approximate, and a `WeakMap`
 * lets superseded states be collected. No signature changes: S3 passed
 * `state` into `valuesOf` so the table would not be reshaped by the first
 * dimension that needed it, and this is that dimension.
 */
const TRIP_MEMBERSHIP = new WeakMap<HouseholdState, Map<string, readonly string[]>>()
```

Build the whole index on first ask for a given state: iterate `visibleTrips(state)`, skip `isClosed`, and for each `entriesOf` push the trip id under each depot Entry's `gearId`.

- [ ] **Step 4: Run and commit**

Run: `npm test --workspace @foerier/shared`

```bash
git add shared/
git commit -m "Add Trip membership as a row, and the index the first cross-aggregate dimension needs"
```

---

### Task 6: `ui/Stepper`, and its three callers

**Files:**
- Create: `ui/src/Stepper.tsx`, `ui/src/Stepper.module.css`, `ui/src/Stepper.test.tsx`
- Modify: `ui/src/index.ts`
- Modify: `app/src/screens/AddGear.tsx` (+ its `.module.css`)
- Modify: `app/src/screens/GearDetail.tsx` (+ its `.module.css`)

**Interfaces:**
- Produces: `Stepper` with props `{ value: number; min?: number; onChange: (next: number) => void; size?: 'default' | 'dense'; label: string }`

`ui/` **never imports the store or a router.** Props in, callbacks out.

- [ ] **Step 1: Write the failing component tests**

```tsx
it('renders the value between a decrement and an increment', () => {})
it('calls onChange with value + 1 on increment', () => {})
it('calls onChange with value - 1 on decrement', () => {})
it('does not go below min, and min defaults to 0', () => {})
it('disables decrement at min', () => {})
it('labels both controls for assistive technology using the `label` prop', () => {})
it('renders the dense size with a hit area of at least 44px', () => {
  // Assert the shape: the dense class is applied and the stylesheet
  // declares the padded hit area. jsdom computes no layout, so assert the
  // class/stylesheet the way S6 pinned the container-query fold.
})
```

- [ ] **Step 2: Implement it**

Two sizes: **h48 default** (`Components` §01's standalone control) and **in-row h32 dense**, the dense one padding its hit area to **≥44px** beyond the painted box. `min` defaults to `0`: a Bring-count of zero is expressible on the wire and is **not** the same as removing the Entry — invariant 11's whole point. It claims nothing, lists nothing, and the row stays.

- [ ] **Step 3: Fold in the two existing callers**

`AddGear` and `GearDetail` each hand-roll a stepper for **Owned-count**. Replace both with `<Stepper size="default" …/>`. Their existing tests must keep passing unchanged — if a test breaks, the conversion changed behaviour and that is a defect, not a test to update.

- [ ] **Step 4: Run and commit**

Run: `npm test --workspace @foerier/ui && npm test --workspace @foerier/app -- AddGear GearDetail`

```bash
git add ui/ app/
git commit -m "Give the stepper one home and three callers"
```

---

### Task 7: `OverClaimBand`

**Files:**
- Create: `app/src/components/OverClaimBand.tsx`, `.module.css`, `.test.tsx`

**Interfaces:**
- Consumes: `OverClaim`, `Claim` (Task 3), `UNNAMED_TRIP`, `tripLabel`.
- Produces: `OverClaimBand` with props `{ tripId: string; overClaims: readonly OverClaim[]; onRemoveHere: (entryId: string) => void; onRemoveThere: (tripId: string, entryId: string) => void; onBringFewer: (entryId: string, count: number) => void }`

**Exact copy — from `Screens B` §02B and §02C. Do not improve it.**

| Case | Attention line |
| --- | --- |
| One other Trip | `▲ 1 entry is already claimed by Alps 2026.` |
| One other Trip, plural entries | `▲ 2 entries are already claimed by Alps 2026.` |
| Two or more Trips | `▲ 5 entries are claimed by 2 other trips.` — **no `already`** |
| Unnamed, one Trip | `▲ 1 entry is already claimed by an unnamed trip.` |

Row facts: `SINGLE · STILL OUT` when one Trip is involved; `SINGLE · STILL OUT · ALPS 2026` when two or more, each row carrying its own. Counted: `×2 LISTED · ×1 OUT · OWNED ×2`.
Settle routes, accent mono: `REMOVE HERE` · `REMOVE ON ALPS` · `BRING ×1 HERE`. Unnamed: `REMOVE ON UNNAMED TRIP`.
Rows cap at **three**, then one **quiet** (muted, not accent) `+ N MORE` row that **expands in place — never an inner scroll**.

- [ ] **Step 1: Write the failing tests**

One test per row of the copy table above, plus:

```tsx
it('caps at three rows and offers + N MORE', () => {})
it('expands in place when + N MORE is clicked, with no scroll container', () => {})
it('renders an unnamed Trip as "Unnamed trip" in a row', () => {})
it('renders no ▲ beside the unnamed name — the data is right', () => {})
it('renders nothing at all when there are no over-claims', () => {})
```

- [ ] **Step 2: Implement, run, commit**

Run: `npm test --workspace @foerier/app -- OverClaimBand`

```bash
git add app/
git commit -m "Draw the over-claim as a standing band, with the line the count earns"
```

---

### Task 8: `EntryRow` and `GearListSection`

**Files:**
- Create: `app/src/components/EntryRow.tsx`, `.module.css`, `.test.tsx`
- Create: `app/src/components/GearListSection.tsx`, `.module.css`, `.test.tsx`

**Interfaces:**
- Consumes: `entriesOf`, `entryLabel`, `entryKind`, `bringCountOf`, `pieceCountOf`, `listTotals` (Task 2); `Stepper` (Task 6).
- Produces:
  - `EntryRow` props `{ label: string; kind: KindValue | 'trip_only'; bringCount: number | null; pieceCount: number; editable: boolean; onBringCountChange: (next: number) => void; onRemove: () => void }`
  - `GearListSection` props `{ trip: TripState; editable: boolean; onBringCountChange; onRemove }`

**Group order and headers, verbatim:** `SINGLE` · `COUNTED` · `PER-PERSON` · `TRIP-ONLY`, each with `N PIECE` / `N PIECES` — **pluralised**, so format the count and noun together. Each group is **omitted when empty**. `TRIP-ONLY` is keyed on the source, not a Kind.

**Row anatomy by Kind:** Counted → `− ×N +` dense `Stepper`; per-person → `×N` mono, **no circles** (they are S8's, and their dashed state is `trip.piece_removed`); Single → nothing; trip-only → the amber `TRIP-ONLY` badge. Every row ends in `✕` **when `editable`**.

**`editable: false`** is the Split-and-up read mode: no `✕`, no stepper, and the trailing column reads `×4` for a Counted Entry and `—` for everything else.

- [ ] **Step 1: Write the failing tests, covering both `editable` values**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Run and commit**

Run: `npm test --workspace @foerier/app -- EntryRow GearListSection`

```bash
git add app/
git commit -m "Group the list by Kind, and let the row read or edit"
```

---

### Task 9: The trip screen — both modes, the band, the noun

**Files:**
- Modify: `app/src/screens/Trip.tsx`, `app/src/screens/Trip.module.css`
- Modify: `app/src/screens/Trip.test.tsx`

**Interfaces:**
- Consumes: `GearListSection` (Task 8), `OverClaimBand` (Task 7), `overClaimsFor` (Task 3), `listTotals` (Task 2), `useMediaQuery`, `SPLIT`.

`app/src/screens/Trip.tsx:505` currently reads `0 GEAR LISTED.` and is the hole this task fills.

**Order below the S6 header, at every width:**

1. **The over-claim band**, when `overClaimsFor(state, tripId)` is non-empty. It sits **between the trip header and the `GEAR LIST` band** — it annotates the list without blocking it — and is **never dismissible**.
2. **The `GEAR LIST` section band** — `GEAR LIST` left (mono, the group bands' own typography, so it reads as their parent), `N ENTRIES · N PIECES` right, and **from Split up** a trailing `EDIT LIST ›`.
3. **`GearListSection`** with `editable={!isSplitOrWider}`.
4. **Below Split only:** the dashed `+ TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE` row, then, after a flex spacer, the pinned full-width primary `+ Add from the depot`.

**The empty state keeps its second string and loses its first to the noun ruling:**
`0 ENTRIES.` + `The gear list is built from the depot.` — with the add affordances beneath it below Split.

**The pinned primary is a flex child, not a fixed FAB.** An element declaring a query container is the containing block for its `position: fixed` descendants — that shipped Depot's FAB broken from S3. Introduce no new fixed element here.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders 0 ENTRIES. and the domain fact when the list is empty', () => {})
it('renders the section band with N ENTRIES · N PIECES', () => {})
it('renders the four groups with pluralised piece counts, omitting empty ones', () => {})
it('below Split: renders steppers, the remove control, the dashed row and the pinned button', () => {})
it('from Split up: renders none of those, and renders EDIT LIST ›', () => {})
it('renders the over-claim band between the header and the section band', () => {})
it('renders no band when the fold reports no conflict', () => {})
it('emits trip.entry_removed on the remove control without confirming', () => {})
it('emits nothing when the stepper is set to its current value', () => {})
```

Fill each body with a concrete arrangement and assertion — an empty test body is a plan failure.

- [ ] **Step 2: Run, implement, run**

Run: `npm test --workspace @foerier/app -- Trip`

- [ ] **Step 3: Correct the stale comment**

`app/src/screens/Trip.tsx:141` reads *"`DepotView` is the only two-pane view in `App.tsx`"*. Task 11 makes that false. Reword it now: `splitPane: false` because the trip screen is not a pane of a list that is also on screen — and note the builder is its own route.

- [ ] **Step 4: Commit**

```bash
git add app/
git commit -m "Fill the trip screen's hole, and let it edit below Split and read above"
```

---

### Task 10: `DepotPicker` and the `/trips/:id/add` route

**Files:**
- Create: `app/src/screens/DepotPicker.tsx`, `.module.css`, `.test.tsx`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Consumes: `visibleGear`, `homePath`, `sliceDepot`, `useScreenHeader`, `SPLIT`; `entriesOf` (Task 2).
- Produces: `DepotPicker` props `{ tripId: string; variant: 'screen' | 'pane' }` — the same component is the route below Split and the builder's left pane at Split and up.

**A screen, not a sheet.** `README.md` §3b's argument, every clause of which transfers: the OS keyboard owns the lower half for a whole sitting, and `IN LIST ✓` keeps the row visible after the add, so the sitting is a batch loop. The Home picker — the counter-precedent — closes on selection, which is exactly what this must not do.

**Anatomy, verbatim:** header `‹ VOSGES — OCT` (the Trip's own label, upper-cased) and the sync line; title `Add from the depot`; a focused search field, placeholder `Search the depot…`; ghost chips `+ TAG` `+ KIND` `+ TRIP`; rows carrying the name, the home path and a trailing `+ ADD` or `IN LIST ✓`; footer hint `ADDING LISTS IT — GEAR DOES NOT MOVE UNTIL PACK-OUT`.

**Three rules:**
- `IN LIST ✓`'s grammar is deliberately the Participants picker's `PARTICIPANT ✓`. Keep them isomorphic.
- **Retired Gear is not offered** — read `visibleGear`.
- The meta slot carries the **home path**. `Components` §03's "no whereabouts" is confirmed narrowly: no world chip, no status. The home path is residence, not world.

**No claim read, and no flash on add.** A claim is a relationship between two Trips; the picker speaks for one, and the band appearing is the signal.

**Empty and unmatched states fall back to `Components` §07 verbatim:** `Empty depot.` / `+ Add gear`, and `No matches.` / `N FILTERS ACTIVE` / `Clear filters`. **No skeleton** — the data is local.

**The `+ TRIP` chip renders in the `'screen'` variant only.** The boards draw three chips at 393 and two at 900 with no rule stated either way; follow each board at its own width. The divergence is recorded in the spec's §4.3.

- [ ] **Step 1: Write the failing tests**

```tsx
it('marks an already-listed Gear IN LIST ✓ and mutes the row', () => {})
it('offers + ADD for a Gear not on the list', () => {})
it('excludes retired Gear', () => {})
it('adds without navigating away, and the row becomes IN LIST ✓', () => {})
it('shows no claim read on any row', () => {})
it('renders Empty depot. when the household has no gear', () => {})
it('renders No matches. when the search excludes everything', () => {})
it('renders the + TRIP chip in the screen variant and not in the pane variant', () => {})
```

- [ ] **Step 2: Implement the component**

- [ ] **Step 3: Add the route with its width guard**

In `App.tsx`, following the existing `isDesktop ? <X/> : <Redirect/>` shape at lines 403 and 417, but on Split:

```tsx
<Route path="/trips/:id/add">
  {(params) =>
    isSplitOrWider ? (
      <Redirect to={`/trips/${params.id}/list`} />
    ) : (
      <DepotPicker tripId={params.id} variant="screen" />
    )
  }
</Route>
```

- [ ] **Step 4: Run and commit**

Run: `npm test --workspace @foerier/app -- DepotPicker App`

```bash
git add app/
git commit -m "Make the depot picker a screen below Split, on Add gear's argument"
```

---

### Task 11: `GearListBuilder` and the `/trips/:id/list` route

**Files:**
- Create: `app/src/screens/GearListBuilder.tsx`, `.module.css`, `.test.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/shell/screenBand.test.tsx`

**Interfaces:**
- Consumes: `DepotPicker` with `variant="pane"` (Task 10), `GearListSection` (Task 8), `listTotals` (Task 2), `useScreenHeader`.

**Two panes, and a media query** — the panes exist or they do not, and rendering both to hide one would put every Entry in the accessibility tree twice. `440px | 1fr` at Desktop; `minmax(308px, 40%) | 1fr` at Split (308px is the pane `GearRow` already folds inside).

**Right pane, top to bottom:** the band row (back link + sync); a title row `<Trip> — gear list` with `Start pack-out` **for a Draft only**; the groups and rows, `editable`; the dashed trip-only row; and a **footer totals bar** — `N ENTRIES · N PIECES · N PER-PERSON · N TRIP-ONLY`.

**There is no `GEAR LIST` section band inside the builder.** It starts at the group bands and carries totals in the footer; the band belongs to the trip screen, where it is also `EDIT LIST ›`'s home.

**One builder, two doors, and the back link follows the door.** `BUILD LIST ›` on the Trips card gives `‹ TRIPS`; `EDIT LIST ›` on the trip screen's band gives `‹ VOSGES — OCT`. This is `InviteIssued`'s one-screen-three-doors shape (S5). Carry the door in route state or a query param; where it points is the screen's own decision, and whether it is drawn is `useScreenHeader`'s.

**`Start pack-out` renders for a Draft only** and on the phone not at all — the phase chip already opens SET PHASE, and a second control for one register is two ways to do one thing. It is over-claim moment #2 and opens the sheet Task 14 builds.

**Weight is not built.** `EST 48.2 KG` is story 16, `LATER`; the boards draw the MVP variant of both header and footer beside the frame.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders both panes at Split and at Desktop', () => {})
it('renders the footer totals bar and no GEAR LIST section band', () => {})
it('renders Start pack-out for a Draft and for no other phase', () => {})
it('renders the trips back link when entered from the card', () => {})
it('renders the trip-name back link when entered from the section band', () => {})
it('draws no EST … KG anywhere', () => {})
```

- [ ] **Step 2: Implement, and add the route with its guard**

```tsx
<Route path="/trips/:id/list">
  {(params) =>
    isSplitOrWider ? (
      <GearListBuilder tripId={params.id} />
    ) : (
      <Redirect to={`/trips/${params.id}`} />
    )
  }
</Route>
```

- [ ] **Step 3: Extend `screenBand.test.tsx` with both new screens**

**Not optional tidiness.** A per-screen suite renders its screen alone, so an absence assertion there proves one side of a two-sided fact — which is how the header rule "shipped inverted and passed review". `screenBand.test.tsx` renders a screen **inside `AppShell`** and counts one visible `SYNCED` at phone width, at Split and at Desktop. Add `DepotPicker` and `GearListBuilder`.

Both answer **`splitPane: false`**: the builder is two panes of *itself*, not a detail pane of a list also on screen. `GearDetail` answers `true` because the Depot list sits beside it and `Depot split` draws no back link at all, whereas the builder's own back link is drawn at every width it exists at.

`useScreenHeader`'s reach was "all eight"; it is now ten.

- [ ] **Step 4: Run and commit**

Run: `npm test --workspace @foerier/app`

```bash
git add app/
git commit -m "Give the builder its own route, two panes and two doors"
```

---

### Task 12: The trip-only sheet and the cross-trip confirm

**Files:**
- Create: `app/src/components/TripOnlySheet.tsx`, `.test.tsx`
- Create: `app/src/components/RemoveElsewhereConfirm.tsx`, `.test.tsx`
- Modify: `app/src/screens/Trip.tsx`, `app/src/screens/GearListBuilder.tsx` — mount them

**Interfaces:**
- Consumes: `Sheet`, `Confirm` from `ui/`; `tripEntryAdded`, `tripEntryRemoved` (Task 1); `phaseLabel`, `phaseDay` (`selectors/trip.ts`).

Both primitives are **mounted-is-open**: a caller writes `{open && <Sheet …/>}`, and mount is what resets draft state. There is no `open` prop.

**`TripOnlySheet`, in Add gear's order, verbatim:** title `Trip-only entry`; eyebrow `NAME` over a focused field; eyebrow `RECORDED AS` over an `ITEM · CONTAINER` segmented control with the hint `CONTAINERS HOLD OTHER GEAR · FIXED WHEN RECORDED`; a full-width `Add entry` **gated on the name**; and a centred mono fact line `NOT KEPT IN THE DEPOT · CLEARED AT CLOSE`.

The trait sits **last, beside the CTA** — the rarest decision and the only irreversible one. It emits **one** `trip.entry_added` carrying both fields.

**No tag chip and no tag picker ever mounts** (invariant 9). **Un-renameability stays unsaid** — correcting a typo is remove + re-add, and stating a missing op at creation is release meta-text.

**`RemoveElsewhereConfirm`, verbatim:**
- Title `Remove from Alps 2026?`
- Body `Tent, tunnel 4p comes off the Alps 2026 gear list. The gear itself does not move.`
- Mono context line naming the other Trip's state: `▸ ALPS 2026 · ON TRIP · DAY 12`
- Accent primary `Remove entry` — nothing is destroyed — and ghost `Cancel`.

The Trip's own remove control **never confirms**: one op, gear untouched, re-adding two taps. `REMOVE ON ALPS` does, because it is the first write against an aggregate the screen is not showing and its undo is a navigation away.

- [ ] **Step 1: Write the failing tests**

```tsx
it('gates Add entry on a non-empty name', () => {})
it('emits one trip.entry_added carrying name and container', () => {})
it('mounts no tag chip and no tag picker', () => {})
it('says nothing about renaming', () => {})
it('resets its draft on remount', () => {})

it('names the other Trip in the confirm title and body', () => {})
it('renders the other Trip’s phase and day in the context line', () => {})
it('emits trip.entry_removed against the OTHER Trip’s aggregate', () => {})
it('emits nothing on Cancel', () => {})
```

- [ ] **Step 2: Implement, run, commit**

Run: `npm test --workspace @foerier/app -- TripOnlySheet RemoveElsewhereConfirm`

```bash
git add app/
git commit -m "Add a trip-only entry, and confirm only the write the screen cannot show"
```

---

### Task 13: The Trips list catches up

**Files:**
- Modify: `app/src/components/TripCard.tsx`, `.test.tsx`
- Modify: `app/src/screens/Trips.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `listTotals` (Task 2).
- Produces: `TripCardProps` gains `entryCount: number`.

**Three changes and one non-change:**

1. **`BUILD LIST ›`** lands on the Draft card — the rule S6 stated and this slice discharges: *a board's CTA copy lands on the slice that builds the board's destination*. Below Split it navigates to `/trips/:id`; from Split up to `/trips/:id/list`. `Continue pack-out` still does **not** land — that is S9's.
2. **`· 0 GEAR LISTED` at `TripCard.tsx:161` becomes `· N ENTRIES`**, a real count.
3. **Closed ledger rows keep `PIECES`** — they count what went. Do not touch them.
4. **`TripCard` does not move to `ui/`** — S7 gives it no second caller.

**Pass the count as a prop from `Trips.tsx`; do not add a `listTotals` call inside `TripCard`.** The component already reads the store at `TripCard.tsx:90` and §5 forbids that in `ui/`; deepening the read makes the eventual move harder. This does **not** pay that debt — Participants still come from the store at line 93 — it keeps it from growing, which is all a slice changing one string here should do.

**Do not touch the NEXT line.** Both redrawn strings and its move onto Draft cards already landed on main. **The progress line is not S7's**, and when S9 brings it, it goes **below** the NEXT line, not above.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders · N ENTRIES from the prop, not from a store read', () => {})
it('renders BUILD LIST › on a Draft card', () => {})
it('renders no Continue pack-out on an active card', () => {})
it('keeps PIECES on closed ledger rows', () => {})
it('targets /trips/:id below Split and /trips/:id/list above it', () => {})
```

- [ ] **Step 2: Implement, run, commit**

Run: `npm test --workspace @foerier/app -- Trips TripCard`

```bash
git add app/
git commit -m "Land BUILD LIST, and make the card's count true and its noun right"
```

---

### Task 14: The over-claim previews

**Files:**
- Modify: `app/src/components/PhaseSheet.tsx`, `.test.tsx`
- Modify: `app/src/components/ReopenConfirm.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `overClaimsIfActive` (Task 3); the conflict-row rendering from `OverClaimBand` (Task 7), extracted for reuse rather than duplicated.

**The two §02B sheets are previews of the band.** They stay at their moments — a phase move still confirms — and render the same block.

- **Draft → Pack-out** in `PhaseSheet`: when `overClaimsIfActive(state, tripId)` is non-empty, render the attention line and conflict rows above the body, verbatim: `Starting warns, never blocks. Nothing is removed unless you choose it.` The primary stays **filled accent** (`Start pack-out`) — **never a filled red button** — with a ghost `Cancel`.
- **Reopening** in `ReopenConfirm`: the over-claim block returns. Its **other** deferred block, `1 ENTRY STILL OPEN — HEADLAMP, K · ▲ LOST`, needs outcomes and stays **S11's** — do not build it.

**Adding to an Active Trip is never gated.** There is no third sheet: the add lands as a local op and the band appears. A pre-add confirm would contradict "never a block", and a modal answerable only on the Device that happens to hold both Trips' recent ops is a guard that works by luck.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders the over-claim block when a Draft would clash on activation', () => {})
it('renders no block when it would not', () => {})
it('keeps Start pack-out filled accent, never red', () => {})
it('still moves the phase when the primary is pressed', () => {})
it('renders the over-claim block in the reopen confirm', () => {})
it('renders no ENTRY STILL OPEN block — that needs outcomes', () => {})
```

- [ ] **Step 2: Implement, run, commit**

Run: `npm test --workspace @foerier/app -- PhaseSheet ReopenConfirm`

```bash
git add app/
git commit -m "Preview the band at the two moments the domain names"
```

---

### Task 15: The doc amendments

**Files:**
- Modify: `docs/sync-protocol.md` §4.4
- Modify: `docs/architecture-design.md` — new §12.13; §8.3's S7 entry; §8.5's table row
- Modify: `docs/frontend-design.md` §3.1, §3.3, §5
- Modify: `docs/technical-debt.md`
- Modify: `docs/testing.md`
- Modify: `CLAUDE.md`

Every change is enumerated in the spec's §10. In addition:

- **`sync-protocol.md` §4.4** — that `trip.entry_bring_count_set`'s "Counted entries only" is an **authoring** rule and the reader folds it regardless (the `TagString` split restated for a second op); that `source` is one register and a trip-only Entry therefore has no rename; the payload key `gear_id` against a `gearId` register.
- **`frontend-design.md` §3.3** — "all eight" becomes **ten**, and the sentence naming `People` and `Devices` as the only width-guarded routes gains the two new ones.
- **`frontend-design.md` §5** — `Stepper` built, two sizes.
- **`technical-debt.md`** — the two entries resting on *"the app has exactly one two-pane view"* are reworded; the `TripCard` entry is **unchanged**, because S7 held that debt level rather than paying it.
- **`testing.md`** — the backward-compatibility fixture list gains `s7-entries`.
- **`CLAUDE.md`** — S7 landed, and what is worth knowing before touching Entries, claims or the builder.

- [ ] **Step 1: Make every edit above**

- [ ] **Step 2: Verify no doc claims something the code no longer does**

Run: `grep -rn "only two-pane view" docs/ app/src/` and `grep -rn "all eight" docs/`
Expected: no hit that is still false.

- [ ] **Step 3: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "Record what S7 settled, and amend the docs it made stale"
```

---

## Self-Review

**Spec coverage.** §1 → T1. §2 → T1. §3.1 → T2. §3.2–3.5 → T3, T4. §3.6–3.7 → T5. §4.1 → T10, T11. §4.2 → T9. §4.3 → T10. §4.4 → T11. §4.5 → T7, T9, T14. §4.6 → T12. §4.7 → T12. §4.8 → T6. §4.9 → T13. §4.10 → T5. §4.11 → T11. §5.1 → T1–T3, T5. §5.2 → T4. §5.3 → T7–T14. §5.4 → T1. §7 → T13, T9, T15. §10 → T15. **No gaps.**

**Type consistency.** `bringCountOf` returns `number | null` in every task that names it. `EntrySource` is `gearId` in state and `gear_id` on the wire, consistently. `pieceCountOf` takes `(entry, trip, state)` in T2, T8 and nowhere else disagrees.

**`entriesOf` takes two arguments** — `(trip, state)` — in T2's Interfaces block, its implementation, and every task that consumes it (T3, T5, T8, T10). An earlier draft of this plan stated the one-argument form and asked the implementer to correct it mid-task; that was a plan defect and is fixed rather than documented.

**Batching note for the executor.** T2 and T3 are both single-file `shared/` selector modules with the same shape, and T13's edits are two small files. They are kept separate because each carries its own test cycle and a reviewer could reject one while approving its neighbour. T1 is deliberately large — the ops, the reducer and the fixture must land in one commit, because [the fixture rule](../testing.md) requires a fixture captured in the same commit as the op types it pins.
