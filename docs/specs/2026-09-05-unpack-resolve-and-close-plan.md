# S10 — Unpack: Resolve and Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Trip can be unpacked and closed honestly, so the Depot stops drifting after every Trip. An outcome on every Entry and every Piece, the Consumed-count and its Owned-count reduction at the close, `lost` as a read-side standing, the claim released mid-pass, and the close gated on nothing being open.

**Architecture:** Two op types and two registers in `shared/` (`reduce.ts`, `state.ts`, `authoring.ts`), one new selector module (`selectors/unpack.ts`) and one new gesture module (`gestures.ts`); gates added **inside** `claim.ts` and `whereabouts.ts` rather than beside them. One new screen (F5, `/trips/:id/unpack`) with three sheets, plus six surfaces downstream. **No endpoint, no migration, and not a line of `slice.ts`.**

**Tech Stack:** TypeScript · React 19 · wouter · Zustand · CSS Modules · Radix (`ui/`'s `Sheet`, `Confirm`) · Vitest · Testing Library · Playwright

**Spec:** [`docs/specs/2026-09-05-unpack-resolve-and-close.md`](2026-09-05-unpack-resolve-and-close.md) — read it alongside this plan. Where they disagree, **the spec wins**; where the spec and `docs/design/README.md` §5h/§7 disagree, **the boards win**.

## Global Constraints

- **`docs/design/README.md` §5h (F1–F20) and its rewritten §7 are the shipped authority.** Every copy string in this plan is quoted from them. The round board `docs/design/S10 Round - Unpack Resolve and Close.dc.html` §07 lists **every string this round introduces or retires** — check a string against it before inventing one.
- **Relative imports in `shared/` need an explicit `.ts` extension.** `app/` and `ui/` are the exception — Vite resolves, so no extension there.
- **Ops mirror the wire — `snake_case`.** Folded state, selectors and React props are ordinary `camelCase`. `reduce.ts` and `authoring.ts` are the only places the two meet.
- **`null` clears a nullable register; an absent field leaves it alone.** [sync §1.3](../sync-protocol.md) is the authority, **not** §5.3 obligation 5, whose text runs one way only. `outcome` is the third register on that side of the line.
- **Never re-derive an absent-register default.** Existing: `ownerOf` (shared), `phaseOf` (draft), `statusOf`/`pieceStatusOf` (not_packed), `stageOf` (home), `entryResidenceOf` (loose; `null` for per-person), `bringCountOf` (`null` off-Counted), `ownedCountOf` (`null` off-Counted), `residenceOf` (loose). **This slice adds exactly two** — `outcomeOf` and `pieceOutcomeOf`, both reading absent *and* `null` as **open** — and must add no others. `patterns.md` §1.2 gains the row.
- **A reader gate, never a reducer gate.** `consumed_count` folds on any Entry; `consumedCountOf` gates on Kind. A reducer branch reading `state.gear[…]` to decide whether to write a Trip register is the bug this rule exists to prevent (`patterns.md` §1.3).
- **A needless write is never free** (`patterns.md` §2.3) — with **one** stated exception this slice introduces: the settle route's `● NOW — FOUND HERE` (Task 17). Everywhere else, tapping the current value writes nothing, and a sheet emits one op per thing that actually changed.
- **`isActive` is the only definition of active-ness; `isPacked` the only definition of packed-ness.** This slice adds `isResolved`'s equivalent as `outcomeOf(...) !== null` inside `unpack.ts` and `claim.ts` reads it from there. Never inline the three-phase test, and never test an outcome string at a screen.
- **An unrecognised enum value is stored verbatim and never coerced** ([sync §5.3](../sync-protocol.md) obligation 4). `OutcomeValue` is open past its three members, exactly as `KindValue`, `PhaseValue`, `StatusValue` and `StageValue` are. An unrecognised outcome **counts as resolved** (spec §3.2) and into none of the three named buckets.
- **Never print a slice number in user-facing copy.** `S10`/`F12`-style tags live on the boards and in comments, never on screen.
- **Vocabulary is law.** Outcome · **open** (never "out") · back · consumed · lost · Unaccounted · Loose · Return path · Piece · Participant · Bring-count · Owned-count · Consumed-count.
- **A media query decides which elements _exist_; a container query decides how what exists _lays out_** ([frontend-design §3.2](../frontend-design.md)). `container-type` makes an element the containing block for its `position: fixed` descendants — F5 has no FAB, so this bites only if one is added.
- **A drawn size is the painted size; 48 floors the hit area** (`patterns.md` §6.5). New controls: 44px chips, a 34px cluster, 48px roster rows. `app/src/screens/drawnSizes.test.ts` is the net.
- **A flex `gap` is not a character** (`patterns.md` §6.6). Adjacent spans that read as one sentence carry an explicit `{' '}`, and the assertion reads the **parent's** text content.
- **Every CSS module is one `@layer components { … }` block.** No `!important`, no `:global`, no `composes`.
- **Tier 0 runs on every commit** (pre-commit: `check:workspaces`, `tsc --noEmit` across workspaces, ESLint, Prettier). A commit that fails it is not a commit.
- **Commands.** `npx vitest run --project shared` · `--project app` · `--project ui`; `npm test` (all); `npm run typecheck`; `npm run lint`; `npm run format:check`. E2E: `npx playwright test`.
- **Commit per task.** This branch keeps its history — past ~1000 lines the branch *is* the reviewable unit and squashing destroys the record (`CLAUDE.md`). Message body says *why*, not *what*.

---

## File Structure

**`shared/` — the log, the selectors, the gestures**

| Path | Responsibility |
| --- | --- |
| `shared/src/state.ts` | Modify: `OutcomeValue`; `outcome` on `PieceState`; `outcome` + `consumedCount` on `EntryState` |
| `shared/src/reduce.ts` | Modify: two handlers, registered in the handler table |
| `shared/src/reduce.outcomes.test.ts` | **Create**: the two ops' fold behaviour |
| `shared/src/authoring.ts` | Modify: `tripOutcomeSet`, `tripConsumedCountSet` |
| `shared/src/gestures.ts` | **Create**: `reHomeOnTheSpot`, `closeTrip` — sync §4.5's two S10 gestures |
| `shared/src/gestures.test.ts` | **Create** |
| `shared/src/selectors/unpack.ts` | **Create**: the outcome reads, the spine, the counts, the destination grouping, the unaccounted index |
| `shared/src/selectors/unpack.test.ts` | **Create**: this slice's Tier 1 core |
| `shared/src/selectors/claim.ts` | Modify: the resolved gate, inside this file only |
| `shared/src/selectors/claim.test.ts` | Modify: mid-pass release |
| `shared/src/selectors/whereabouts.ts` | Modify: resolved Entries drop out; the `unaccounted` standing; the home count subtraction; `rowWhereabouts` |
| `shared/src/selectors/whereabouts.test.ts` | Modify |
| `shared/fixtures/s10-unpack.ops.json` | **Create** |
| `shared/src/fixtures.s10.test.ts` | **Create** |
| `shared/src/index.ts` | Modify: export everything new |

**`app/` — F5 and its sheets**

| Path | Responsibility |
| --- | --- |
| `app/src/screens/Unpack.tsx` (+ `.module.css`, `.test.tsx`) | **Create**: F5 |
| `app/src/components/UnpackRow.tsx` (+ `.module.css`, `.test.tsx`) | **Create**: one row, three targets |
| `app/src/components/OutcomeSheet.tsx` (+ `.module.css`, `.test.tsx`) | **Create**: the outcome sheet, its stepper, and its roster variant |
| `app/src/App.tsx` | Modify: `<Route path="/trips/:id/unpack">` |
| `app/src/household/trips.ts` | Modify: `resolvedLabel`, `openLabel`, `resolvedPercent`, `progressFor` |

**`app/` — the six surfaces downstream**

| Path | Responsibility |
| --- | --- |
| `app/src/components/PhaseSheet.tsx` (+ `.module.css`, `.test.tsx`) | Modify: the `CLOSED` row's `6 OPEN ›` and its routing tap |
| `app/src/components/TripCard.tsx` (+ `.test.tsx`) | Modify: `Continue unpack`; the progress line's two readings |
| `app/src/screens/Trips.tsx` (+ `.module.css`, `.test.tsx`) | Modify: which totals it computes; `ClosedRow`'s `1 LOST` in two tones |
| `app/src/screens/Trip.tsx` (+ `.module.css`, `.test.tsx`) | Modify: the band's `UNPACK ›` and its Compact wrap |
| `app/src/components/WhereaboutsCard.tsx` (+ `.module.css`, `.test.tsx`) | Modify: the standing — glyph, count, footer, `RESOLVE` |
| `app/src/screens/GearDetail.tsx` (+ `.module.css`, `.test.tsx`) | Modify: the settle route into `HomePicker` |
| `app/src/screens/Depot.tsx` (+ `.test.tsx`) | Modify: nothing but its assertions — `rowWhereabouts` carries the change |
| `app/src/screens/Find.tsx` (+ `.test.tsx`) | Modify: the per-person row's live `▲ LAST SEEN` |
| `app/src/components/HomePicker.tsx` (+ `.test.tsx`) | Modify: `context` line; `● NOW` tappable under one flag |
| `app/src/shell/screenBand.test.tsx` | Modify: F5 is the twelfth screen |
| `app/src/screens/drawnSizes.test.ts` | Modify: the chips, the cluster, the roster rows |

**Tests and docs**

| Path | Responsibility |
| --- | --- |
| `test/e2e/depot.spec.ts` | Modify: the golden path's sixth leg |
| `docs/architecture-design.md` | Modify: §8.5 (F17), §8.3, new §12.17 |
| `docs/sync-protocol.md` | Modify: §4.4's reader-gate note |
| `docs/patterns.md` | Modify: §1.2, §1.3, §2.3 |
| `docs/technical-debt.md` | Modify: `Popover`'s callers, four → six |
| `docs/testing.md` | Modify: the golden path completes |
| `CLAUDE.md` | Modify: S10's paragraph |

---

## Task 1: The two ops — state, reducer, builders

**Files:**

- Modify: `shared/src/state.ts`, `shared/src/reduce.ts`, `shared/src/authoring.ts`, `shared/src/index.ts`
- Test: `shared/src/reduce.outcomes.test.ts` (**create**)

**Interfaces:**

- Produces:
  - `type OutcomeValue = 'back' | 'consumed' | 'lost' | (string & {})`
  - `EntryState.outcome?: Register<OutcomeValue | null>`, `EntryState.consumedCount?: Register<number>`
  - `PieceState.outcome?: Register<OutcomeValue | null>`
  - `tripOutcomeSet(tripId: string, entryId: string, outcome: OutcomeValue | null, personId?: string): OpSpec`
  - `tripConsumedCountSet(tripId: string, entryId: string, count: number): OpSpec`
- Consumes: `writeEntry`, `writePiece`, `writeNullableIfPresent`, `writeIfPresent`, `readString`, `readOpen`, `readCount` — all already in `reduce.ts`/`payloads.ts`. **Add no new payload reader.**

- [ ] **Step 1: Write the failing tests** in `reduce.outcomes.test.ts`, in `reduce.packing.test.ts`'s style (`aGear`/`aTrip`/`anOp`/`stamp` from `shared/testUtils`). Cover:
  - `trip.outcome_set` **without** `person_id` writes `entry.outcome`; **with** one writes `entry.pieces[personId].outcome` and leaves `entry.outcome` absent.
  - `outcome: null` writes a register holding `null` — **not** an absent register — and an **absent** `outcome` field leaves the register exactly as it was. This is the obligation-5 pair on the first nullable enum; assert both directions in one test naming spec §1.2.
  - `outcome: "mislaid"` folds verbatim.
  - A `person_id` that is present but not a string (e.g. `42`) lands on the **Entry** — `readString` reads it absent, which is the conservative direction (spec §1.3).
  - `trip.consumed_count_set` writes `consumedCount` on a Single Entry too (the reducer does not gate — spec §1.4), and rejects a negative or non-integer `count` as malformed (`readCount`).
  - Plain LWW both ways on both registers; a losing write returns the **identical** `HouseholdState` object (`expect(after).toBe(before)`).
  - Both ops arriving **before** their `trip.entry_added` create a bare Entry that `entriesOf` still excludes (no `source`).
- [ ] **Step 2: Run them** — `npx vitest run --project shared` — and watch them fail on the missing exports.
- [ ] **Step 3: `state.ts`.** Add `OutcomeValue` beside `StatusValue`, with `StatusValue`'s own docstring argument for the open union. Add the three fields, each with the docstring the spec's §2 gives; delete the "S10's, and nobody else's" promises the two interfaces carry, which this task makes true.
- [ ] **Step 4: `reduce.ts`.** Two handlers beside `tripPieceStatusSet`:

```ts
/**
 * `trip.outcome_set` (`sync-protocol.md` §4.4): the unpack outcome, on the
 * Entry or — when `person_id` is present — on one Piece.
 *
 * **The first op whose entity path a payload field chooses.** A `person_id`
 * that is present but unreadable reads `absent` and the outcome lands on the
 * Entry, which is the conservative direction: the tolerant reader's own
 * answer is that a field it cannot read was not there (spec §1.3).
 *
 * `writeNullableIfPresent`, not `writeIfPresent`: the register's declared
 * type includes `null`, so an explicit `null` **clears it back to open** and
 * an absent field leaves it alone (§1.3, not §5.3 obligation 5).
 */
const tripOutcomeSet: Handler = (state, op, stamp) => {
  const entryId = readString(op.payload, 'entry_id')
  if (entryId.kind !== 'value') return state
  const outcome = readOpen(op.payload, 'outcome')
  if (outcome.kind === 'absent') return state
  const personId = readString(op.payload, 'person_id')

  const write = (
    current: Register<OutcomeValue | null> | undefined,
    st: Stamp,
  ) => writeNullableIfPresent<OutcomeValue>(current, outcome, st)

  if (personId.kind === 'value') {
    return writePiece(
      state, op.aggregate_id, entryId.value, personId.value, stamp,
      (piece, st) => {
        const next = write(piece.outcome, st)
        return next === piece.outcome ? piece : { ...piece, outcome: next }
      },
    )
  }
  return writeEntry(state, op.aggregate_id, entryId.value, stamp, (entry, st) => {
    const next = write(entry.outcome, st)
    return next === entry.outcome ? entry : { ...entry, outcome: next }
  })
}

/**
 * `trip.consumed_count_set` (§4.4): sets `consumedCount` absolutely.
 *
 * The catalogue's *"on a counted Entry resolved as `consumed`"* is an
 * **authoring** rule on both halves — the Kind lives on the Gear aggregate
 * and the outcome is a second register — so this folds on any Entry and
 * `consumedCountOf` gates on the way out, exactly as `bringCountOf` does one
 * register over.
 */
const tripConsumedCountSet: Handler = (state, op, stamp) => {
  const entryId = readString(op.payload, 'entry_id')
  if (entryId.kind !== 'value') return state
  const count = readCount(op.payload, 'count')
  if (count.kind !== 'value') return state
  return writeEntry(state, op.aggregate_id, entryId.value, stamp, (entry, st) => {
    const next = writeRegister(entry.consumedCount, count.value, st)
    return next === entry.consumedCount ? entry : { ...entry, consumedCount: next }
  })
}
```

  Register both in the handler table beside the other Trip ops.

- [ ] **Step 5: `authoring.ts`.** Two builders beside `tripPieceStatusSet`. `tripOutcomeSet` takes `personId` **last and optional**, and omits the key entirely when absent (never `person_id: undefined`, which JSON would drop but which `exactOptionalPropertyTypes` will not let you write anyway):

```ts
export function tripOutcomeSet(
  tripId: string,
  entryId: string,
  outcome: OutcomeValue | null,
  personId?: string,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.outcome_set',
    payload: {
      entry_id: entryId,
      outcome,
      ...(personId === undefined ? {} : { person_id: personId }),
    },
  }
}
```

- [ ] **Step 6:** export `OutcomeValue` and both builders from `index.ts`; `npx vitest run --project shared` and `npm run typecheck` green; commit.

**Verification:** every listed test passes; `reduce.test.ts`, `reduce.entries.test.ts`, `reduce.pieces.test.ts` and `reduce.packing.test.ts` pass untouched; `fixtures.test.ts`'s `unfolded.count` assertions are unchanged (no existing fixture carries these types).

---

## Task 2: `selectors/unpack.ts` — the outcome reads and the spine

**Files:**

- Create: `shared/src/selectors/unpack.ts`, `shared/src/selectors/unpack.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**

- Consumes: `entriesOf`, `entryKind`, `isContainerEntry`, `bringCountOf`, `pieceCountOf` (`entry.ts`); `piecesOf` (`piece.ts`).
- Produces:
  - `outcomeOf(entry: EntryState): OutcomeValue | null`
  - `pieceOutcomeOf(piece: PieceState | undefined): OutcomeValue | null`
  - `consumedCountOf(entry: EntryState, state: HouseholdState): number | null`
  - `isKnownOutcome(outcome: OutcomeValue): boolean`
  - `outcomeLabel(outcome: OutcomeValue | null): string` · `outcomeGlyph(outcome: OutcomeValue | null): string`
  - `OUTCOMES: readonly UnpackOutcome[]`
  - `type UnpackItem` · `unpackItems(trip, state): readonly UnpackItem[]`
  - `type UnpackCount` · `countOfUnpack(items): UnpackCount` · `unpackTotals(trip, state): UnpackCount`

- [ ] **Step 1: Write the failing tests** in `unpack.test.ts`, modelled on `packing.counts.test.ts` (same imports, same `depot()` helper). Cover:
  - **Open ≡ no outcome:** an absent register and a register holding `null` both read `null` from `outcomeOf`; an explicit `'back'` reads `'back'`.
  - `pieceOutcomeOf(undefined)` is `null` — a Piece no op has addressed.
  - **`consumedCountOf`'s gate:** `null` for Single, per-person, trip-only, container, unrecognised-Kind and not-yet-synced Gear; the value for a Counted depot Entry.
  - **Its clamp:** a register holding `0` reads `1`; one holding `99` against a Bring-count of `4` reads `4`; **the register itself is unchanged** (assert `entry.consumedCount?.value` still `99`).
  - **The spine (F1):** on one Trip carrying a Single Entry, a Counted Entry ×4, a per-person Entry with 3 included Pieces, a **depot container** Entry and a **trip-only** Entry — `unpackItems` yields `1 + 1 + 3 + 1 = 6` items and `unpackTotals(...).total` is `1 + 4 + 3 + 1 = 9`, while `packingTotals(...).total` is `1 + 4 + 3 + 0 + 1 = 9` — assert **both** in one test, naming spec §3.1, and add a second Trip shaped so the two totals genuinely differ (two containers, one trip-only: `packing = 61`, `unpack = 62`, F1's own arithmetic).
  - A sourceless and a removed Entry produce no item (`entriesOf` already excludes them).
  - A **tombstoned** Piece produces no item; a Participant added after the Entry gets an open item with no backfill op.
  - **The counts (F2):** `resolved` counts every item with an outcome; `open = total − resolved` and is never summed independently; a `consumed` Counted Entry ×4 with `consumedCount ×2` contributes `2` to `consumed`, `2` to `back` and `4` to `resolved`; the four named buckets plus `open` sum to `total`.
  - A **`consumed` Counted Entry with no `consumedCount` register** contributes its whole Bring-count to `consumed` and `0` to `back` — the clamp's floor read through: all of it used up is the ordinary case (F9), so the absent register reads the Bring-count, **not** `1`.
  - **An unrecognised outcome counts as resolved** and into none of `back`/`consumed`/`lost`; assert that the three named buckets can therefore sum to less than `resolved`, with the comment spec §3.2 gives.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: The outcome table**, `PHASES`/`STATUSES`'s shape a fourth time — one row per known outcome, `outcomeRow` **unexported** so no call site decides what a missing row means (`patterns.md` §1.4):

```ts
export interface UnpackOutcome {
  id: 'back' | 'consumed' | 'lost'
  /** `BACK` · `CONSUMED` · `LOST` — the pill's word. */
  label: string
  /** `●` · `` · `▲` — `▲` is LOST alone (F6). */
  glyph: string
}

export const OUTCOMES: readonly UnpackOutcome[] = [
  { id: 'back', label: 'BACK', glyph: '●' },
  { id: 'consumed', label: 'CONSUMED', glyph: '' },
  { id: 'lost', label: 'LOST', glyph: '▲' },
]
```

  `outcomeLabel(null)` is `'OPEN'` and `outcomeGlyph(null)` is `'○'` — **open is not a row**, because it is the absence of one, and this is the one place that is stated. An unrecognised outcome draws verbatim with no glyph, `statusLabel`'s own answer.

- [ ] **Step 4: The three reads.** `outcomeOf(entry)` is `entry.outcome?.value ?? null` — and the docstring carries the whole rule: *absent and `null` are different facts about the log and both read **open**; only this function and `pieceOutcomeOf` say so.* `consumedCountOf` gates on `isCounted` + a depot source (copy `bringCountOf`'s gate exactly, then clamp against `bringCountOf(entry, state) ?? 1`).
- [ ] **Step 5: The spine.** `UnpackItem` and `unpackItems` per spec §3.1 — the loop is `packingItems`' with **two changes**, each carrying its ruling in a comment: a container Entry is **not** skipped and contributes `units: 1` (F1; do not call `pieceCountOf`, which answers `0` for a different question), and a trip-only Entry **is** skipped (invariant 18; it is still drawn, by Task 10). Everything else reads `pieceCountOf`, which **is** the units table.
- [ ] **Step 6: The counts.** `UnpackCount` and `countOfUnpack` per spec §3.2. `open` is `total − resolved`, **never a third sum** — `countOf`'s own rule, and say so. The consumed split reads `consumedCountOf` and adds the remainder to `back`.
- [ ] **Step 7:** export everything from `index.ts`; `npx vitest run --project shared` and `npm run typecheck` green; commit.

**Verification:** every listed test passes; `packing*.test.ts`, `entry.test.ts` and `claim.test.ts` pass untouched — this task adds a spine beside `packingItems` and changes neither.

---

## Task 3: The destination grouping

**Files:**

- Modify: `shared/src/selectors/unpack.ts`, `shared/src/selectors/unpack.test.ts`, `shared/src/index.ts`

**Interfaces:**

- Consumes: `containmentView`, `homePath`, `PathSegment` (`containment.ts`); Task 2's `unpackItems`.
- Produces:
  - `unpackDestinationOf(gearId: string, state: HouseholdState, view?: ContainmentView): string | null` — the **Place id** at the root of the home path, `null` for the `Loose` bucket.
  - `returnPathOf(entry: EntryState, state: HouseholdState, view?: ContainmentView): readonly PathSegment[]` — the full home path, outermost first, for the row's meta.

- [ ] **Step 1: Write the failing tests.** Gear in Crate B in the Attic → the Attic's Place id; gear directly in the Attic → the same; gear loose → `null`; gear in a container that is itself loose → `null` (**there is no Place at the root**, which is exactly what the `Loose` bucket means); gear at a **removed** Place → `null`, through the view's own resolution and not a second test of `removed`; a trip-only Entry is never asked (it is grouped by Task 10, not by this function). `returnPathOf` returns the segments `homePath` returns, and returns them **for a depot Entry only**.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement**, both over `homePath`, both taking an optional `view` for `containerTotals`' reason — *a screen builds one view, not one per group*. `unpackDestinationOf` is `segments[0]?.kind === 'place' ? segments[0].id : null`; the docstring states F3's argument in full: this is **not** D5's partition (`slice.ts`'s `container` grouping files by the immediate holder), because F5 answers *where does my body go* and D5 answers *where is it filed*, and both are right. It also states why the sentinel may be called **`Loose`** here when D4 refused the word on the Depot: this bucket is exactly gear with no Place at its root, which is what the glossary's Loose means.
- [ ] **Step 4:** export both; `npx vitest run --project shared` and `npm run typecheck` green; commit.

**Verification:** the new tests pass; `containment.test.ts` and `slice.test.ts` pass untouched.

---

## Task 4: The claim gate, inside `claim.ts`

**Files:**

- Modify: `shared/src/selectors/claim.ts`, `shared/src/selectors/claim.test.ts`

**Interfaces:**

- Consumes: `outcomeOf`, `pieceOutcomeOf` (Task 2).
- Produces: no new export. **The whole point of this task is that it adds no surface** — `claim.ts`'s header has said since S7 that S10's gate goes inside this file and nowhere else.

- [ ] **Step 1: Write the failing tests** in `claim.test.ts`:
  - One Single Gear on two Active Trips over-claims; **resolving either Entry** (`back`, `consumed` **or** `lost` — all three release) makes `overClaims(state)` empty. Assert all three outcomes in one parameterised test.
  - A resolved Entry contributes nothing to `claimed`: a Counted Gear owned ×2 with one Trip bringing ×4, resolved, reports no over-claim.
  - **Per-person releases per Person:** one per-person Gear on two Trips both including Mark over-claims; resolving **Mark's Piece on one Trip** clears it while Els's Pieces, untouched on both, still do not conflict.
  - An outcome of `null` (cleared back to open) **re-creates** the claim — the register holding `null` is not a resolution.
  - An **unrecognised** outcome releases the claim, consistent with spec §3.2's *counts as resolved*: a Trip a peer finished must not hold this build's supply hostage.
  - A resolved Entry on a **Draft** Trip changes nothing (it held no claim to release).
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement — two edits, both inside `claim.ts`.** In `claimsByGear`'s loop, `if (outcomeOf(entry) !== null) continue` immediately after the `entriesOf` iteration begins. In `claimFor`'s per-person branch, filter `piecesOf(entry, trip)` down to the Pieces whose `pieceOutcomeOf(entry.pieces?.[personId])` is `null`. The existing *"a claim naming nobody is not a claim"* guard in `claimsByGear` then handles a fully-resolved per-person Entry with no further code — check that it does before adding anything.
- [ ] **Step 4: Correct the header in place.** The sentence *"Outcomes are S10's, so at S7 every non-removed Entry on an active Trip is unresolved and this file reads them all"* is now false; replace it with what the file does, keeping the *S10's gate goes here* instruction as the reason it is here. Do **not** delete the instruction — it is why the next reader will not put a copy somewhere else.
- [ ] **Step 5:** `npx vitest run --project shared` and `npm run typecheck` green; commit.

**Verification:** every existing `claim.test.ts` test passes unchanged (none of them records an outcome, so none of them changes); `OverClaimBand.test.tsx` and `Packing.test.tsx` pass untouched.

---

## Task 5: Whereabouts — resolved Entries hand the gear home

**Files:**

- Modify: `shared/src/selectors/whereabouts.ts`, `shared/src/selectors/whereabouts.test.ts`

**Interfaces:**

- Consumes: `outcomeOf`, `pieceOutcomeOf` (Task 2).
- Produces: no signature change. `whereabouts()` and `whereaboutsByPerson()` simply stop seeing resolved Entries and Pieces.

- [ ] **Step 1: Write the failing tests.** A Gear on a Pack-out Trip reads a trip slice; recording `back` on its Entry makes it read `⌂ HOME` **with the Trip still Active** — assert the phase is still `pack_out` in the same test, because that is the whole of *mid-pass*. Repeat for `consumed` and `lost` (all three release the trip slice; `lost`'s own standing is Task 6, and this test asserts only that the trip slice is gone). For per-person: resolving **one** Piece drops that Person from `whereaboutsByPerson`'s trip answer while the others stay out. For Counted: resolving the Entry removes its `×N OUT` and returns those units to the home count.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement.** One `continue` in the `TRIP_SLICES` gather loop for a resolved Entry, and one filter in its per-Piece branch — the same two places Task 4 edited one file over, and the comment says so: *the claim and the whereabouts release together, because they are the same fact read twice.*
- [ ] **Step 4:** `npx vitest run --project shared` green; commit.

**Verification:** every existing `whereabouts.test.ts` test passes unchanged; `Depot.test.tsx`, `Find.test.tsx` and `GearDetail.test.tsx` pass untouched.

---

## Task 6: The unaccounted standing

**Files:**

- Modify: `shared/src/selectors/unpack.ts`, `shared/src/selectors/whereabouts.ts`, both test files, `shared/src/index.ts`

**Interfaces:**

- Consumes: `compareStamps` (`hlc.ts`), `stampOf` (`registers.ts`), `visibleTrips`, `tripLabel`, `bringCountOf`, `entryKind`, `piecesOf`.
- Produces:

```ts
export interface Unaccounted {
  /** The Trip of the **latest** live `lost` outcome. */
  readonly tripId: string
  readonly tripName: string
  /** Single → 1; Counted → Σ Bring-counts; per-person → `personIds.length`. */
  readonly units: number
  /** Per-person only; empty otherwise. */
  readonly personIds: readonly string[]
}

export function unaccountedOf(
  state: HouseholdState,
): ReadonlyMap<string, Unaccounted>
```

  and, on `whereabouts.ts`'s existing interface, `Whereabouts.unaccounted: Unaccounted | null`.

- [ ] **Step 1: Write the failing tests** in `unpack.test.ts`:
  - A `lost` outcome on a **closed** Trip still produces a standing — closed Trips are exactly the history this reads, and `isActive` must **not** be applied here. Assert it in one test naming spec §3.5.
  - **The stamp comparison, both directions:** a `gear.rehomed` stamped *after* the `lost` outcome clears the standing; one stamped *before* does not. Build these with `stamp(specs, { start })` so the counters are explicit.
  - **A re-home writing the _same_ residence clears it** — the settle route's whole mechanism (F16), and the test that stops somebody "optimising" the same-value write away.
  - A Gear with **no `residence` register at all** keeps a live standing (nothing to compare against reads as earlier than everything).
  - `units`: Single → `1`; Counted → the sum of two Trips' Bring-counts, both live; per-person → `personIds` for the lost Pieces only.
  - **The named Trip is the latest live lost outcome's**, not the first found and not the alphabetically first.
  - A later `back` on a **different** Entry settles nothing (different units, spec §3.5).
  - `back` and `consumed` produce no standing at all.
  - Then, in `whereabouts.test.ts`: `Whereabouts.unaccounted` is populated; the **home slice's count subtracts the units** and floors at zero (owned ×3, one lost → `×2 THERE`); `rowWhereabouts` reads `▲ TESSIN 2025` for Single and `▲ ×1 TESSIN 2025` for Counted, tone `attention`; **over-claimed and unaccounted at once reads `▲ 2 TRIPS`** — the active fact wins (F16(2)).
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: `unaccountedOf`.** Walk **every** `visibleTrips(state)` Trip and every Entry with a depot source. For each Entry (and each Piece) whose outcome is `'lost'`, compare `stampOf(register)` against `stampOf(gear.residence)` — where an absent `gear.residence` compares as earlier — and keep it only if the outcome is strictly later. Accumulate per Gear id: sum `units`, union `personIds`, and keep the `tripId`/`tripName` of the **latest** kept stamp. The docstring carries spec §3.5's three consequences verbatim: a re-home settles the whole standing; two Trips can both hold one; a later `back` on another Entry settles nothing.
- [ ] **Step 4: Fold it into the same pass.** `whereabouts.ts`'s `TRIP_SLICES` memo widens from `visibleTrips(state).filter(isActive)` to `visibleTrips(state)`, with `isActive(trip)` moving **inside** the loop as the gate on contributing a *slice*, and the standing accumulating regardless. The memo's value gains `unaccounted: ReadonlyMap<string, Unaccounted>`. `patterns.md` §1.7's second rule is the reason and the comment says so; the *active Trips only* rule for slices stays stated in exactly one place, now one line lower.
- [ ] **Step 5: The three reads.** `Whereabouts.unaccounted`; the home slice's count subtracting `units` and flooring at zero, beside D8's existing floor and sharing its comment; `rowWhereabouts` gaining the standing — glyph `▲`, word from B2's read, and **`overClaimed` checked first** so the active fact wins.
- [ ] **Step 6:** export `Unaccounted` and `unaccountedOf`; `npx vitest run --project shared` and `npm run typecheck` green; commit.

**Verification:** the `TRIP_SLICES` memo still returns identical answers for every existing `whereabouts.test.ts` case; `Depot.test.tsx` and `Find.test.tsx` still pass (their fixtures record no outcome).

---

## Task 7: `gestures.ts` — the two multi-op gestures

**Files:**

- Create: `shared/src/gestures.ts`, `shared/src/gestures.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**

- Consumes: `authoring.ts`'s `tripOutcomeSet`, `gearRehomed`, `gearOwnedCountSet`, `tripPhaseMoved`; `outcomeOf`, `consumedCountOf`, `unpackItems` (Task 2); `entriesOf`, `entryKind`; `ownedCountOf`; `sameResidence` (`containment.ts`).
- Produces:

```ts
export function reHomeOnTheSpot(
  trip: TripState,
  entry: EntryState,
  gearId: string,
  residence: Residence,
  state: HouseholdState,
): readonly OpSpec[]

export function closeTrip(
  trip: TripState,
  state: HouseholdState,
): readonly OpSpec[]
```

- [ ] **Step 1: Write the failing tests** in `gestures.test.ts`:
  - `reHomeOnTheSpot` on an **open** Entry emits `[trip.outcome_set{back}, gear.rehomed]`, in that order.
  - On an Entry already `back`, it emits **only** `gear.rehomed` — §2.3.
  - With a residence **equal** to the current home, it still emits `gear.rehomed` — F16's settling write, and the test carries the comment saying this is the rule's one exception, not a miss.
  - On an Entry that is `lost`, it emits both (the found-it path).
  - `closeTrip` on a Trip with no consumed Counted Entries emits exactly `[trip.phase_moved{closed}]`.
  - With one consumed Counted Entry (owned ×6, consumed ×2) it emits `[gear.owned_count_set{count: 4}, trip.phase_moved{closed}]` — **the reduction first, the phase last**, and the test says why: a Device dying mid-batch leaves a Trip still in `unpack` with its reduction applied rather than a closed Trip whose Depot never moved.
  - Two Entries naming the **same** Gear, consumed ×2 and ×1, against owned ×6 → **one** `gear.owned_count_set{count: 3}`.
  - A reduction that would go negative floors at `0`.
  - A `consumed` Entry whose Gear is **not** Counted contributes nothing (`consumedCountOf` is `null`).
  - Calling it **twice** against the same fold produces the identical ops — the idempotence that makes two Devices closing safe, asserted here so Tier 2 has a unit-level companion.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement.** The module docstring states why the file exists: `authoring.ts` is a shelf of pure payload constructors and sees no fold; sync §4.5 names three gestures and two are S10's; each has two callers, which is the drift risk this codebase keeps answering the same way. `closeTrip` accumulates `Map<gearId, consumedUnits>` over `entriesOf`, reads `ownedCountOf(gear) ?? 0` for the base, and emits `Math.max(0, owned - consumed)`.
- [ ] **Step 4:** export both; `npx vitest run --project shared` and `npm run typecheck` green; commit.

**Verification:** the new tests pass; nothing else changes.

---

## Task 7a: Tier 2 — convergence

**Files:** Modify `shared/src/convergence.test.ts`

**Interfaces:** consumes `createReplica`, `exchange` (`shared/testUtils/replica.ts`); `closeTrip` (Task 7); `overClaims`, `whereabouts`, `unaccountedOf`.

- [ ] **Step 1: Write the failing tests**, beside the existing convergence properties and in their style:
  - **Two Devices closing the same Trip must not double-apply the Consumed reduction.** Each replica computes `closeTrip` against its own fold, both emit, then `exchange` — the owned count converges on **one** reduced value, not a doubled one. This is the named obligation and the whole reason `gear.owned_count_set` is absolute; the test says so.
  - The same, with the two replicas' folds **differing** (one has an extra `trip.consumed_count_set` the other has not seen): the later stamp wins and both converge on it, with **no** arithmetic applied twice.
  - An outcome and a `gear.rehomed` racing: `unaccountedOf` reports the identical standing on both replicas whichever clock is later.
  - `trip.outcome_set` on an Entry and on one of its **Pieces**, concurrently: different registers, both survive.
  - A Participant added on one replica while their Piece is resolved on the other.
  - **Nothing recorded is discarded when a claim releases** — resolving one side of an over-claim leaves **both** Entries in both folds, and `overClaims` is empty on both. One slice on from S7's own version of this assertion.
- [ ] **Step 2: Run them** — `npx vitest run --project shared` — and watch them fail.
- [ ] **Step 3: Add the frozen-list assertions** for the two new op types, wherever `convergence.test.ts` or `boundaries.test.ts` already keeps §5.4's — what may never change about an existing op type is a Tier 2 assertion, not a convention.
- [ ] **Step 4:** `npx vitest run --project shared` green; commit.

**Verification:** every existing convergence property passes untouched.

---

## Task 8: The fixture

**Files:**

- Create: `shared/fixtures/s10-unpack.ops.json`, `shared/src/fixtures.s10.test.ts`

**Interfaces:** consumes `fold` and the JSON. Produces nothing.

- [ ] **Step 1: Write the fixture JSON**, modelled on `shared/fixtures/s9a-packing.ops.json` — same `household_id`, a fresh `t-s10-1` Trip, ids prefixed `s10`, HLCs stepping from `2026-09-05T09:00:00.000Z-0000`. It carries the two new op types plus the minimum earlier ops needed to give them something to reference. It **must** include, each for a stated reason in the test's docstring:
  - an Entry with `outcome: "back"`, one with `"lost"`, one with `"consumed"` **plus** a `trip.consumed_count_set`;
  - an Entry whose outcome was set and then **cleared with `null`** — the register holds `null`, which is the one shape no other fixture can pin;
  - a **Piece-level** `trip.outcome_set` carrying `person_id`, beside a sibling Piece with none;
  - a **depot container** Entry with an outcome (F1's row, in the format it shipped);
  - a **forward-compatibility probe**: `outcome: "mislaid"`, standing for a peer on a later build, folded verbatim and never coerced;
  - a `trip.consumed_count_set` on a **Single** Entry — the reader-gate probe, folded because the reducer does not gate (spec §1.4).
- [ ] **Step 2: Write `fixtures.s10.test.ts`**, modelled on `fixtures.s9a.test.ts` exactly: the snapshot test, the never-mutates test, the `unfolded.count === 0` test, and one named assertion per bullet above. The docstring states the fixture rule and names S4's debt as the thing it exists to avoid.
- [ ] **Step 3: Run** `npx vitest run --project shared` — the snapshot is written on the first run; **read it** before committing and confirm the `outcome` register holding `null` appears as `null` and not as an absent key.
- [ ] **Step 4:** `npm run typecheck` green; commit both files plus the snapshot.

**Verification:** `npx vitest run --project shared` green from a cold snapshot directory; `fixtures.test.ts` and the five earlier fixture suites pass untouched.

---

## Task 9: F5's shell — route, band, count line, empty state

**Files:**

- Create: `app/src/screens/Unpack.tsx`, `app/src/screens/Unpack.module.css`, `app/src/screens/Unpack.test.tsx`
- Modify: `app/src/App.tsx`, `app/src/household/trips.ts`, `app/src/shell/screenBand.test.tsx`

**Interfaces:**

- Consumes: `unpackTotals` (Task 2); `useHousehold`, `useScreenHeader`, `ScreenBand`, `tripLabel`.
- Produces: `Unpack` (default screen export); and in `trips.ts`:
  - `resolvedLabel(count: UnpackCount): string` → `● 56/62 RESOLVED`
  - `openLabel(count: UnpackCount): string` → `6 OPEN`
  - `resolvedPercent(count: UnpackCount): number`

- [ ] **Step 1: Write the failing tests** in `Unpack.test.tsx`, copying `Packing.test.tsx`'s `renderPacking` harness verbatim as `renderUnpack` (real store, real reducer, seeded by emitting real ops, `authored()` handle subtracting the seed). Cover:
  - The band: `‹ ALPS 2026` and the sync line, both present below Desktop.
  - Title `Unpack`; count line `● 56/62 RESOLVED` and `6 OPEN`; the bar's width.
  - **The empty screen (F19):** a Trip with no Entries renders `0 ENTRIES.` and `The gear list is built from the depot.` and **no** count line, controls, hint or close card — assert all four absences by name.
  - An unknown `tripId` renders `No such trip.` and **authors nothing** (`authored()` is empty) — every hook above the guard, `patterns.md` §3.4.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: `trips.ts`'s three helpers**, beside `packedLabel`/`leftLabel`/`packedPercent` and sharing their shape. They are display derivations over a `shared/` answer and hold no rule of their own (`patterns.md` §1.8).
- [ ] **Step 4: The screen skeleton.** Every hook first, then the guard. `useScreenHeader({ splitPane: false, atDesktopSidebarCarriesDestination: false })` — `Packing`'s own answer, and the comment says why: the Desktop sidebar names the Trips list, not this Trip. `useMemo(() => unpackTotals(trip, state), [trip, state])`.
- [ ] **Step 5: The route** in `App.tsx`, beside `/trips/:id/packing`, ungated by width — F5 is its own route at every width, never a pane.
- [ ] **Step 6: `screenBand.test.tsx`** gains F5 as the **twelfth** screen, rendered *inside* `AppShell` so both sides of the two-sided fact are proved.
- [ ] **Step 7:** `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** the four listed tests pass; every other `app` suite passes untouched.

---

## Task 10: DESTINATION mode — groups, rows, pills

**Files:**

- Create: `app/src/components/UnpackRow.tsx`, `.module.css`, `.test.tsx`
- Modify: `app/src/screens/Unpack.tsx`, `.module.css`, `.test.tsx`; `app/src/screens/drawnSizes.test.ts`

**Interfaces:**

- Consumes: `unpackItems`, `unpackDestinationOf`, `returnPathOf`, `outcomeOf`, `consumedCountOf`, `outcomeLabel`, `outcomeGlyph`, `bringCountOf`, `entryKind`, `isContainerEntry`, `subtreeOf`; `ui/StatusPill`.
- Produces: `UnpackRow` with props `{ entryId, name, meta, outcome, units, onOutcome, onReHome, cluster?, tripOnly? }` — **paint names, caller owns meaning** (`patterns.md` §5.3).

- [ ] **Step 1: Write the failing tests.** Groups in F3's order: rooms A→Z by Place name, then **`Loose`** (muted, meta `NO HOME SLOT`), then **`Trip-only`** (meta `TAKES NO OUTCOME · CLEARED AT CLOSE`). Headers read `resolved/units` (`Attic 4/5`); the trip-only header reads a plain count (`2`). Rows: name, the return path meta in each of its four forms (`→ SHELF L-TOP ▸ CRATE B · ×2`, a container's `→ SHELF L-TOP · 12 INSIDE`, a consumed Counted's `→ BAK 3 · ×2 CONSUMED · ×2 BACK`, a re-homed row's `→ CRATE B · RE-HOMED` — the last is Task 14's, so assert it there and leave a passing placeholder-free test here for the other three). Pills: `● BACK`, `○ OPEN`, `CONSUMED`, `▲ LOST`. A **trip-only** row's right slot is faint mono `CLEARS AT CLOSE` and is **not a button** — assert `queryByRole('button')` within the row is null; its meta reads `NOT IN DEPOT`. A container row draws **no rail**. And the `patterns.md` §6.6 assertion: read the row's **parent** text content to pin the glued spelling of name-plus-badge.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: `UnpackRow`.** One `container-type: inline-size` **on the list item, never the component** (§6.4). The pill is a `<button>` at 44px minimum; `PackingRow.module.css`'s `.body` is the worked example for the hit extension clamped at the row's bounds (§6.5). `▲` is `LOST` alone.
- [ ] **Step 4: The grouping in `Unpack.tsx`.** One `containmentView(state)` and one `tripContainmentView(trip, state)`, both `useMemo`'d on `state`, handed **down** to every group — never one per group (`containerTotals`' own rule). Group by `unpackDestinationOf`; the container-count meta reads `subtreeOf(...).size`.
- [ ] **Step 5: `drawnSizes.test.ts`** gains the pill's 44px paint and its clamped `::after`.
- [ ] **Step 6:** `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** every listed test passes; `Packing.test.tsx` passes untouched.

---

## Task 11: The controls, the filter, and PERSON + ALL

**Files:** Modify `app/src/screens/Unpack.tsx`, `.module.css`, `.test.tsx`

**Interfaces:** consumes `ui/SegmentedControl`, `personPartition` (`packing.ts`), `ui/PersonCircle`. Produces no new export.

- [ ] **Step 1: Write the failing tests.** The segmented control reads `DESTINATION · PERSON · ALL` and defaults to `DESTINATION`. The `○ OPEN` filter pill (**not** `OPEN ONLY` — F4 dropped *only*) hides resolved rows, gains a `✕` when active, and — with nothing open — leaves the list reading `NOTHING OPEN.` (F19). The hint reads `TAP PILL = OUTCOME · TAP CIRCLES = PER PERSON · TAP ROW = RE-HOME`. **PERSON** mode partitions by `personPartition` (A7 — a Piece to its Participant, Personal gear to its owner, the rest to `Shared`, drawn **last**), its headers read `7/9 · 2 OPEN`, and **a Piece row there carries its own pill** rather than a cluster. **ALL** is flat, A→Z, with the return path as the meta's last segment and no headers at all. A group whose every row is filtered out does not render its header.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement.** The mode is `useState`, not a route param — F4's own answer. `personPartition` is **read, not restated**; if you find yourself writing `ownerOf` or a Participant test here, stop.
- [ ] **Step 4:** `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** the listed tests pass; DESTINATION's tests from Task 10 still pass.

---

## Task 12: The outcome sheet, and its stepper

**Files:**

- Create: `app/src/components/OutcomeSheet.tsx`, `.module.css`, `.test.tsx`
- Modify: `app/src/screens/Unpack.tsx`, `.test.tsx`; `app/src/screens/drawnSizes.test.ts`

**Interfaces:**

- Consumes: `ui/Sheet` (with `description` and `desktopCard`), `ui/Stepper`, `tripOutcomeSet`, `tripConsumedCountSet`, `outcomeOf`, `consumedCountOf`, `bringCountOf`, `isContainerEntry`, `subtreeOf`.
- Produces: `OutcomeSheet` with props `{ trip, entry, onClose }`. **Mounted is open** — the caller writes `{open && <OutcomeSheet …/>}` (`patterns.md` §4.1).

- [ ] **Step 1: Write the failing tests.** Title = the gear name; the fact line `OUTCOME · ×4 BROUGHT · → BAK 3` is passed as `description` (§4.5). Four 44px chips in `OUTCOMES` order plus `OPEN`; the current outcome is raised and focus-ringed. **A tap writes one op and the sheet stays open** — assert the sheet is still on screen after the tap, and that tapping the **current** outcome writes nothing (§2.3). On a Counted Entry, `CONSUMED` reveals a `Stepper` **only while `CONSUMED` is the outcome**; it opens at the Bring-count, floors at `×1`, ceilings at the Bring-count, and draws `×2 BACK` beside it; the fact reads `THE REST CAME BACK. OWNED ×6 → ×4 AT CLOSE.`. Per-person and Single gear grow **no** stepper. A container's fact adds `CONTAINER · 12 INSIDE · ITS CONTENTS KEEP THEIR OWN OUTCOMES.` and **no op touches its contents** (assert `authored()` holds exactly one op). The footer reads `ONE OP PER TAP. LOST KEEPS THE HOME SLOT AND STAYS SEARCHABLE.`. The stepper **commits on blur or Enter, never per keystroke** — `2` → `10` authors one op, not two (`ui/Stepper`'s own contract; type into it and assert `authored()`).
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement.** `Sheet` below Split, `desktopCard` from Split up — the popover approximation, since `ui/Popover` is unbuilt and this is its **fifth** waiting caller. The stepper's value is `consumedCountOf(entry, state)`; it is `Stepper`'s **third** caller.
- [ ] **Step 4:** wire the pill's `onOutcome` in `Unpack.tsx` to mount it; `drawnSizes.test.ts` gains the chips' 44px; `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** the listed tests pass; `Stepper.test.tsx` and `Sheet.test.tsx` pass untouched.

---

## Task 13: The roster variant

**Files:** Modify `app/src/components/OutcomeSheet.tsx`, `.module.css`, `.test.tsx`; `app/src/screens/Unpack.tsx`, `.test.tsx`; `app/src/screens/drawnSizes.test.ts`

**Interfaces:** consumes `piecesOf`, `pieceOutcomeOf`, `ui/PersonCircle`, `ui/PersonCluster`, `personLabel`, `personNameOrUnnamed`. Produces `OutcomeSheet`'s optional `roster: true` shape — one component with a variant, **not a second sheet** (F7).

- [ ] **Step 1: Write the failing tests.** The 34px cluster on a per-person row opens the sheet; the cluster and its `×N` are **one control** with one accessible name (`patterns.md` §5.4) and its count reads **resolved over Pieces** (`3/3`). Circle tones, three values (F7): **filled** = resolved (`back` *or* `consumed`), **bordered** = open, **attention ring** = `lost` — assert a `consumed` Piece draws **filled**, same as `back`, and the sheet is what states the difference. The roster sits **above** the verbs; rows are 48px with 30px circles; `EVERYONE` is selected on open and the chip restores it; a row toggles into the selection with `SELECTED ✓`. A chip applies to the selection and writes **one op per Piece that changes** — with two of three already `back`, tapping `BACK` under `EVERYONE` writes **one** op (§5g E10). The fact reads `OUTCOME · 2 OF 3 RESOLVED · → LADE 2`; the footer `EVERYONE IS SELECTED ON OPEN. TAP A ROW TO NARROW. ONE OP PER PIECE THAT CHANGES.`. **No stepper** in this variant at any Kind.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement.** `PersonCircle` takes a **`tone`**, never a `state` — S5's login ring, S8's inclusion, S9's packing fill and now S10's resolution are four meanings for one border and the caller owns which applies (`patterns.md` §5.3). Selection is local `useState`; **mount is the reset**.
- [ ] **Step 4:** `drawnSizes.test.ts` gains the 34px cluster and 48px roster rows; `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** the listed tests pass; `PersonCircle.test.tsx`, `PersonCluster.test.tsx` and `PieceStatusSheet.test.tsx` pass untouched.

---

## Task 14: Re-home on the spot

**Files:** Modify `app/src/components/HomePicker.tsx`, `.test.tsx`; `app/src/screens/Unpack.tsx`, `.module.css`, `.test.tsx`

**Interfaces:** consumes `reHomeOnTheSpot` (Task 7), `residenceOf`, `sameResidence`. `HomePicker` gains two optional props: `context?: string` (the line above the list) and `allowCurrent?: boolean` (whether `● NOW` is tappable — default `false`, its behaviour today).

- [ ] **Step 1: Write the failing tests.** Tapping the **row body** opens `HomePicker` in MOVE mode with the context line `RE-HOMING TENT, 3P · PICKING A HOME MARKS IT BACK`. Picking a new home emits **exactly two** ops, `trip.outcome_set{outcome:'back'}` then `gear.rehomed` (assert order). On an Entry already `back` it emits **one**, the `gear.rehomed`. **No confirm** stands between the pick and the write (A2b) — assert no dialog appears. A **container** being re-homed carries its `N INSIDE RIDE ALONG` line and its subtree is excluded from the destinations. Afterwards the row's meta reads `→ CRATE B · RE-HOMED` — and the segment's rule is **one comparison**: it draws while the Gear's `residence` stamp is at or after this Entry's `outcome` stamp (spec §4.6). Assert the over-inclusive case the spec names — a Gear re-homed from elsewhere *after* being marked back also draws it — so the behaviour is pinned rather than discovered.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement.** The gesture is `reHomeOnTheSpot`'s, **not** re-derived here — the screen maps its `OpSpec[]` through `emit`. `HomePicker` stays a **pure picker**: it reports the pick and holds no rule; the caller suppresses, decides and closes (`patterns.md` §4.3). `allowCurrent` changes only whether the `● NOW` row is disabled; the mark itself is unchanged.
- [ ] **Step 4:** `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** the listed tests pass; `HomePicker.test.tsx`'s existing cases pass unchanged (both new props default to today's behaviour); `GearDetail.test.tsx` passes untouched.

---

## Task 15: The close card and the close batch

**Files:** Modify `app/src/screens/Unpack.tsx`, `.module.css`, `.test.tsx`

**Interfaces:** consumes `closeTrip` (Task 7), `unpackTotals`. Produces no new export.

- [ ] **Step 1: Write the failing tests.** The card is **the list's last card** at every width (F11) — assert it is a sibling of the groups inside the scrolling column, not a docked footer. Summary mono `53 BACK · 2 CONSUMED · 1 LOST · 6 OPEN`. The button reads `Close trip — 6 open` and is **disabled** while `open > 0`; at `open = 0` it reads `Close trip` and is live. **No confirm** (F10) — assert no dialog. The hint reads `BACK WRITES HOME AT THE TAP. CLOSE WHEN OPEN = 0 — LOST IS ALWAYS AN ANSWER.` and, at `open = 0`, `CLOSE WRITES THE CONSUMED REDUCTION. THE ARRANGEMENT AND EVERY OUTCOME ARE KEPT. LOST KEEPS ITS HOME SLOT.`. The tap emits `closeTrip`'s ops in order — **reductions first, `trip.phase_moved{closed}` last**. Tapping it on a Trip with a consumed Counted Entry moves the Gear's owned count once, and a **second** render + tap against the already-closed Trip is a no-op the button no longer offers. **The empty screen draws no card at all** (F19).
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement.** The gated button is a real `disabled` attribute, not a styled div — `aria-disabled` alone would let a keyboard user fire it past the gate.
- [ ] **Step 4:** `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** the listed tests pass; the finished-screen assertions from Task 11 still pass.

---

## Task 16: The over-claim band on F5, and the widths

**Files:** Modify `app/src/screens/Unpack.tsx`, `.module.css`, `.test.tsx`

**Interfaces:** consumes `OverClaimBand`'s exported `OverClaimGroups` and `overClaimGroups`. Produces no new export.

- [ ] **Step 1: Write the failing tests.** The band renders **between the count block and the controls** (F15) when the fold says conflict, and is **facts-only** — `SettleRoutes` is omitted, so no `REMOVE HERE` or `BRING ×N HERE` appears (`patterns.md` §4.4; its absence *is* read-only). Its fact line reads `SINGLE · STILL OPEN HERE`. **Resolving the row makes the band disappear** — the ordinary way an over-claim ends here, and the test that proves Task 4's gate reaches this screen. It is never dismissible. Then the widths (F11): from Roomy up the column caps at **560px** and is centred; the back link **survives Desktop**; the sync line is drawn at **Split alone**; group cards are bordered with 12 between from Roomy up and 0 below.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement.** The band gates on `overClaimGroups(...)` and never on the raw selector (`patterns.md` §1.6). The 560 cap is a **container** decision on the column, and the mode-existence decisions are the media query's — §6.4, and a comment saying which is which.
- [ ] **Step 4:** `npx vitest run --project app`, `npm run typecheck`, `npm run lint` green; commit.

**Verification:** the listed tests pass; `OverClaimBand.test.tsx` passes untouched.

---

## Task 17: Gear detail — the standing and its settle route

**Files:** Modify `app/src/components/WhereaboutsCard.tsx`, `.module.css`, `.test.tsx`; `app/src/screens/GearDetail.tsx`, `.module.css`, `.test.tsx`

**Interfaces:** `WhereaboutsCardProps` gains `unaccounted?: WhereaboutsCardUnaccounted | undefined` — `{ tripName: string; units: number | null; ownedCount: number | null; onResolve: () => void }`, beside the existing `overClaim` and shaped like it.

- [ ] **Step 1: Write the failing tests.** The standing is **not a row** (F16(3)): the **home row's** glyph turns `▲`, its count reads `owned − out − unaccounted` (so `×2 THERE` for owned ×3 with one lost), and the footer reads `▲ ×1 LAST SEEN: TESSIN 2025 · OWNED ×3` with a `RESOLVE` action. A **Single** gear reads `▲ LAST SEEN: TESSIN 2025` with **no counts**. `RESOLVE` opens `HomePicker` with context `RESOLVING HEADLAMP · LAST SEEN: TESSIN 2025`, and **its `● NOW — FOUND HERE` row is tappable** — tapping it emits a `gear.rehomed` carrying the **unchanged** residence, and the standing clears. That last assertion carries the comment: this is `patterns.md` §2.3's one stated exception, because the write is a new assertion about *now*, not a restatement of a value.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement.** The card composes; `GearDetail` reads `whereabouts(state, gearId).unaccounted` and passes it down — the component reads no store (`patterns.md` §5.2). Reuse Task 14's `HomePicker` props (`context`, `allowCurrent`) rather than adding a third.
- [ ] **Step 4: Retire the drawn row variant.** Delete the `▲ UNACCOUNTED` / `LAST SEEN:` **row** form if any scaffolding for it exists, and leave a comment naming F16(3) and its reason — *a row claims a place, and unaccounted is the absence of one*.
- [ ] **Step 5:** `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** the listed tests pass; `WhereaboutsCard.test.tsx`'s existing over-claim cases pass unchanged.

---

## Task 18: The Depot column, and Find

**Files:** Modify `app/src/screens/Depot.test.tsx`, `app/src/screens/Find.tsx`, `app/src/screens/Find.test.tsx`

**Interfaces:** consumes `rowWhereabouts` (Task 6). **The Depot needs no source change** — the column already reads `rowWhereabouts`, which now carries the standing. Prove that with a test rather than assuming it.

- [ ] **Step 1: Write the failing tests.** Depot: an unaccounted Gear's `WHEREABOUTS` column reads `▲ ×1 TESSIN 2025` in the `attention` tone, and its 2-line row reads the same with the **home path unchanged** in the meta (D9). Over-claimed **and** unaccounted at once reads `▲ 2 TRIPS` — the active fact wins (F16(2)). Find: the per-person card row reads `▲ LAST SEEN: TESSIN 2025` with a `RESOLVE` link routing to **gear detail** (`/gear/<id>`), **not** to the closed Trip; a **contested** Piece keeps D7's route to the claiming Trip. Assert both in one file so the two doors are visibly two.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement.** In `Find.tsx`, the trailing slot's precedence is unchanged and gains one arm — `RESOLVE` for contested (D7), then the standing's `RESOLVE`, then the Piece's packing status, then `⌂ HOME`. Delete the standing comment *"**Still left to S10:** the `▲ LAST SEEN` unaccounted read has no unpack outcome yet to draw from"*, which this task makes false.
- [ ] **Step 4:** `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** the listed tests pass; every other `Depot.test.tsx` and `Find.test.tsx` case passes unchanged.

---

## Task 19: The three doors

**Files:** Modify `app/src/components/PhaseSheet.tsx`, `.module.css`, `.test.tsx`; `app/src/components/TripCard.tsx`, `.test.tsx`; `app/src/screens/Trips.tsx`, `.module.css`, `.test.tsx`; `app/src/screens/Trip.tsx`, `.module.css`, `.test.tsx`; `app/src/household/trips.ts`

**Interfaces:** `TripCardProps.progress` changes from `PackingCount | undefined` to

```ts
/** The paint, not the arithmetic — the caller decides which reading applies
 *  (`patterns.md` §5.3). `packingProgress` at Pack-out and On trip,
 *  `unpackProgress` at Unpack (F13). */
export interface ProgressLine {
  readonly main: string      // `● 56/62 RESOLVED`
  readonly trailing: string  // `6 OPEN`
  readonly percent: number
}
```

  with `packingProgress(count: PackingCount): ProgressLine` and `unpackProgress(count: UnpackCount): ProgressLine` in `trips.ts`.

- [ ] **Step 1: Write the failing tests.**
  - **`PhaseSheet` (F12):** while `open > 0` the `CLOSED` row draws right mono `6 OPEN ›`, stays **tappable**, and the tap **routes to `/trips/<id>/unpack`** without emitting anything (`authored()` empty). At `open = 0` the slot is empty and the tap emits `trip.phase_moved{closed}` **plus the close batch** — the same `closeTrip` gesture the card uses, not a bare phase move. Assert no disabled row exists anywhere in the sheet (D7).
  - **`TripCard` (F13):** at Unpack the CTA reads `Continue unpack` and routes to `/trips/<id>/unpack`; the progress line reads `● 56/62 RESOLVED` / `6 OPEN`; at Pack-out it still reads `● 48/61 PIECES` / `13 LEFT`; the CTA **does not** become `Close trip` at `open = 0`.
  - **`ClosedRow` (F18):** meta reads `JUL 2025 · 54 PIECES · 1 LOST`; `1 LOST` is **attention** while any is still unaccounted and **muted** once every one has been re-homed; zero lost **drops the segment** as the date does; `N CONSUMED` never appears.
  - **`Trip.tsx` (F14):** the band's trailing slot carries `UNPACK ›` beside `PACKING ›` at every width and **every phase, Draft included**; accessible name `Open unpack for Alps 2026`; at Compact the routes wrap to a second right-aligned line; **an empty gear list draws neither door**.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: Implement `PhaseSheet`.** The `CLOSED` row's two behaviours read `unpackTotals(trip, state).open`; the routing arm uses the router's `Link`/`navigate` and the setting arm calls `closeTrip`. Rewrite the header's standing comment about `closed` being unguarded — this task discharges it, and the replacement says what the gate now is and where the second copy of it lives (Task 15).
- [ ] **Step 4: Implement `TripCard` + `Trips.tsx`.** `Trips.tsx` picks which totals to compute from `phaseOf(trip)` and hands down a `ProgressLine`; the card draws and asks nothing. Keep A11's *Active cards only* rule stated at both ends.
- [ ] **Step 5: Implement `Trip.tsx`.** The second door beside `PACKING ›`, same gate (the band renders only for a non-empty list), no width gate and **no phase swap** — the comment names F14 and says swapping is the soft lock the band already refuses.
- [ ] **Step 6:** `npx vitest run --project app`, `npm run typecheck`, `npm run lint` green; commit.

**Verification:** every listed test passes; `PhaseSheet.test.tsx`'s existing cases pass with only the `CLOSED`-row ones changed; `ReopenConfirm.test.tsx` passes **untouched** — reopen is S11 and this task must not reach it.

---

## Task 20: The golden path's sixth leg

**Files:** Modify `test/e2e/depot.spec.ts`

**Interfaces:** consumes the shipped UI only. No `goto` may stand in for a control.

- [ ] **Step 1: Extend the existing `@production` golden-path spec** after its *pack an item* step: open the Trip, tap the phase chip → `SET PHASE` → `UNPACK`, then take the trip card's `Continue unpack` (or the band's `UNPACK ›` from the trip screen it is already on). Resolve the one packed Entry `BACK` through the pill's outcome sheet. Assert the count line reaches `0 OPEN` and the button reads `Close trip`. Tap it.
- [ ] **Step 2: Assert the close.** The Trips list draws the Trip as a closed ledger row, and the gear's Whereabouts reads home again — check it in **Find**, which is the screen the journey already knows how to drive.
- [ ] **Step 3: Run it** — `npx playwright test test/e2e/depot.spec.ts` against the local stack.
- [ ] **Step 4: Confirm the leg is `@production`-safe** — it mints no Invite, proves no joining, and signs no Device out, so it stays inside `depot.spec.ts`'s existing tag.
- [ ] **Step 5:** commit.

**Verification:** `npx playwright test` green locally; the spec still carries `@production`.

---

## Task 21: The docs

**Files:** Modify `docs/architecture-design.md`, `docs/sync-protocol.md`, `docs/patterns.md`, `docs/technical-debt.md`, `docs/testing.md`, `CLAUDE.md`

- [ ] **Step 1: `architecture-design.md` §8.5 — F17.** Delete the `| Outcome | S10 |` row. Rewrite *"**Only `Outcome` is left**, so story 13 completes at S10 as planned"* and the closing *"complete at S10, having been touched by **five** slices — S3, S4, S7, S9, S10"*: story 13 completed at **S9b**, touched by **four** — S3, S4, S7, S9. State F17's argument in one sentence and name the capability it declines to build (spec §3.7), so the next reader meets the decision rather than a silent absence.
- [ ] **Step 2: `architecture-design.md` §8.3** — S10's entry gains *Landed*, its spec link and a §12.17 pointer, exactly as S9a's and S9b's do. Its `Ops (2 new)` line is already correct; leave it.
- [ ] **Step 3: `architecture-design.md` §12.17**, modelled on §12.15/§12.16: the consequences worth knowing before touching outcomes — F1's separate spine, F2's resolved numerator, the claim gate living inside `claim.ts`, the cross-aggregate stamp comparison and its three consequences, F17's overturn, and §2.3's one exception.
- [ ] **Step 4: `sync-protocol.md` §4.4** — the reader-gate note gains `consumed_count` beside `TagString` and `bring_count`, and one line saying `trip.outcome_set` is the first op whose entity path a payload field chooses.
- [ ] **Step 5: `patterns.md`** — §1.2's table gains `Entry / Piece outcome | open | outcomeOf, pieceOutcomeOf — unpack.ts`; §1.3's instance list gains `consumed_count`; §2.3 gains its **one stated exception**, `● NOW — FOUND HERE`, with the reason (the write is a new assertion about *now*).
- [ ] **Step 6: `technical-debt.md`** — `ui/Popover`'s entry goes from four waiting callers to **six**, naming the outcome sheet and its roster variant. Verify the entry's verbatim anchor still appears: `grep -rF "The rejected alternative was memoising" docs shared/src ui/src app/src api/src --exclude=technical-debt.md` and the equivalent for the Popover anchor.
- [ ] **Step 7: `testing.md`** — the golden path is complete; delete *"**Today it runs the first five** … *Close the trip* awaits S10"* and say what it runs now. Leave the standing sentence about a slice adding its leg in the same slice — it is why Task 20 exists.
- [ ] **Step 8: `CLAUDE.md`** — S10's paragraph in the house style, plus the things worth knowing before touching outcomes: F1's separate spine and why A5 does not extend; the absent-and-`null`-both-read-open rule; the claim gate's single home; the stamp comparison and its three consequences; F17's overturn and that story 13 completed at S9b; and §2.3's one exception.
- [ ] **Step 9:** `npm run format:check` green; commit.

**Verification:** `grep -n "Outcome" docs/architecture-design.md` shows no surviving dimension-table row; `npm test` green across all four projects.

---

## Self-review notes

**Spec coverage.** §1.1–§1.5 → Tasks 1, 7. §2 → Task 1. §3.1–§3.2 → Task 2. §3.4 → Task 3. §3.3 → Task 4. §3.5–§3.6 → Tasks 5, 6. §3.7 (no `slice.ts`) → asserted by omission and by Task 21's §8.5 edit. §4.1 → Tasks 9, 19. §4.2 → Tasks 9, 10, 11. §4.3 → Task 10. §4.4 → Task 12. §4.5 → Task 13. §4.6 → Tasks 14, 17. §4.7 → Task 15. §4.8 → Task 19. §4.9 → Task 16. §4.10 → Task 16. §4.11 → Tasks 17, 18, 19. §5.1 → Tasks 1–7. §5.2 → **see the gap below.** §5.3 → Tasks 9–19. §5.4 → Task 8. §5.5 → Task 20. §6 → Task 21.

**One gap found and closed:** spec §5.2's Tier 2 convergence obligations had no task on the first pass. They are not a tail on another task — *two Devices closing the same Trip* is the named obligation the whole absolute-count design exists for — so they became **Task 7a**, placed immediately after Task 7 because they test `closeTrip`'s output through two replicas.

**Type consistency checked.** `outcomeOf`/`pieceOutcomeOf` (never `isResolved` as an export — Task 4 calls them directly); `unpackItems`/`unpackTotals`/`countOfUnpack` (deliberately not `countOf`, which is `packing.ts`'s and is imported into the same files); `unpackDestinationOf`/`returnPathOf`; `reHomeOnTheSpot`/`closeTrip`; `Unaccounted`/`unaccountedOf`; `ProgressLine`/`packingProgress`/`unpackProgress`. `UnpackCount`'s fields (`resolved`, `total`, `open`, `back`, `consumed`, `lost`) are the same names Tasks 9, 15 and 19 read.

**No placeholders.** Every copy string is quoted from `docs/design/README.md` §7 or the round board's §07 string list; every signature above appears in a task that defines it.
