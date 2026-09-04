# S9b — Whereabouts Reaches the Depot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap S9a left — a household can pack a Trip and the Depot does not say so. `whereabouts()` gains its `'trip'` slice and the quantity split, and the Depot column, gear detail's card and `PIECES` group, Find's per-person card and story 13's `CONTAINER` dimension follow.

**Architecture:** One selector rewritten (`selectors/whereabouts.ts`) and two rows added to an existing table (`selectors/slice.ts`); four screens read them. **No op types, no endpoints, no migration, no reducer change, no fixture** — the read side of a seam whose write side shipped as S9a.

**Tech Stack:** TypeScript · React 19 · wouter · Zustand · CSS Modules · Radix (`ui/`'s `Sheet`, `Confirm`) · Vitest · Testing Library

**Spec:** [`docs/specs/2026-09-04-whereabouts-reaches-the-depot.md`](2026-09-04-whereabouts-reaches-the-depot.md) — read it alongside this plan. Where they disagree, **the spec wins**; where the spec and `docs/design/README.md` §5e/§5f disagree, **the boards win**.

## Global Constraints

- **This slice's whole risk is two surfaces disagreeing, not convergence** (spec §1). Every rule below is stated in exactly one function and **read** from there. If you find yourself writing `?? 'not_packed'`, `?? 1`, `kind === 'counted'` or a residence resolution in a screen, stop — the function already exists.
- **Relative imports in `shared/` need an explicit `.ts` extension.** `app/` and `ui/` are the exception — Vite resolves, so no extension there.
- **Ops mirror the wire — `snake_case`.** Folded state, selectors and React props are ordinary `camelCase`. **This slice authors no op**, so it crosses that boundary nowhere.
- **Never re-derive an absent-register default.** `ownerOf` (shared), `phaseOf` (draft), `statusOf` (not_packed), `stageOf` (home), `entryResidenceOf` (loose, `null` for per-person), `bringCountOf` (`null` off-Counted). This slice adds `ownedCountOf` (`null` off-Counted) and must add no other.
- **A residence pointer is resolved once, by `TripContainmentView.resolveResidence`** — never by re-testing "removed, sourceless, not-a-container, cycle" at a call site. The symptom of a copy is an item landing in no group and a partition silently ceasing to sum.
- **The container check comes first, before Kind** — `packingItems` and `statusOf` both do this, and `container` and `kind` are orthogonal registers (S9a found a Counted container is authorable). But **counts follow Kind, never the container trait**: `claim.ts`'s permanent divergence from `pieceCountOf` is the precedent, and whereabouts counts depot supply rather than packing pieces.
- **Whereabouts reads Active Trips only; the `TRIP` dimension reads every non-closed one.** They are different questions (spec §2.2) and a test pins the pair. Never unify them.
- **`isActive` is the only definition of active-ness.** Never inline the three-phase test.
- **An unrecognised stage or status is stored verbatim, never coerced** — `stageLabel` and `statusLabel` already answer for one.
- **Never print a slice number in user-facing copy.** `S9b`-style scope tags live on the boards and in comments, never on screen.
- **Vocabulary is law.** Whereabouts · Home slot · Trip · Participant · Piece · Container · Loose. **`Loose` is a root with no home set** — D4 exists because this bucket is wider than that, so the `CONTAINER` sentinel is never called Loose.
- **A media query decides which elements _exist_; a container query decides how what exists _lays out_** ([frontend-design §3.2](../frontend-design.md)).
- **Tier 0 runs on every commit** (pre-commit: `tsc --noEmit` across workspaces, ESLint, Prettier). A commit that fails it is not a commit.
- **Commands.** The workspaces have no `test` script of their own; the root runs Vitest projects. Use `npx vitest run --project shared`, `--project app`, `--project ui`, `npm test` (all four), `npm run typecheck`, `npm run lint`, `npm run format:check`.

---

## File Structure

**`shared/` — the selectors**

| Path | Responsibility |
| --- | --- |
| `shared/src/selectors/depot.ts` | Modify: add `ownedCountOf` |
| `shared/src/selectors/claim.ts` | Modify: one line — `supply` reads `ownedCountOf` |
| `shared/src/selectors/whereabouts.ts` | **Rewrite**: the union, the memo, the five exported functions |
| `shared/src/selectors/whereabouts.test.ts` | **Rewrite**: the slice's whole Tier 1 risk |
| `shared/src/selectors/slice.ts` | Modify: `container` dimension row, `container` grouping row, `GROUP_KEYS`, the ancestors memo |
| `shared/src/selectors/slice.test.ts` | Modify: the sixth dimension and the fourth grouping |
| `shared/src/index.ts` | Modify: export the new types and functions |

**`app/` — the screens**

| Path | Responsibility |
| --- | --- |
| `app/src/components/WhereaboutsCard.tsx` (+ `.module.css`) | Modify: label per slice, three footer states, composite key |
| `app/src/screens/GearDetail.tsx` (+ `.module.css`) | Modify: the card's props, `COUNT`'s trip chips, the new `PIECES` group |
| `app/src/screens/Find.tsx` (+ `.module.css`) | Modify: `PlainRow`, `CountedCard`; **create** `PerPersonCard` in-file |
| `app/src/screens/Depot.tsx` (+ `.module.css`) | Modify: `Row`'s whereabouts + tone; `Group`'s header meta line |
| `app/src/components/SliceBar.tsx` | Modify: the hint's second clause while `group === 'container'` |
| `app/src/screens/*.test.tsx` | Modify: the four suites above |

**Docs**

| Path | Responsibility |
| --- | --- |
| `docs/architecture-design.md` | §12.16 (new); §8.3's S9b entry marked landed; §8.5's `Container` row |
| `docs/technical-debt.md` | Delete two entries, open one |
| `docs/design/README.md` | §1's code-authored lines, if §6.1's three decisions want one |
| `CLAUDE.md` | Status |

**Dependency order.** Task 1 → Task 2 → {Task 4, Task 5, Task 6}. Task 3 is independent of 1 and 2 and may run alongside them; Task 6 needs **both** 2 and 3. Task 7 is last.

---

## Task 1: `ownedCountOf`, and what the debt entry got wrong

**Files:**

- Modify: `shared/src/selectors/depot.ts`, `shared/src/selectors/claim.ts`, `shared/src/index.ts`
- Test: `shared/src/selectors/depot.test.ts`

**Interfaces:**

- Produces: `ownedCountOf(gear: GearState): number | null` — `null` unless `kind === 'counted'`, else the register's value or **1**.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests** in `depot.test.ts`, in the file's existing style: a Counted gear with a register reads it; a Counted gear **without** one reads `1`; a Single and a Per-person gear read `null`; a gear with an unrecognised `kind` reads `null`; a gear whose `ownedCount` survives a `kind_set` back to `single` reads `null` (the register outlives the Kind — per-field LWW cascades nothing).
- [ ] **Step 2: Run them** — `npx vitest run --project shared` — and watch them fail on the missing export.
- [ ] **Step 3: Implement** in `depot.ts`, beside `visibleGear`. It is the **fifth instance of a shape this codebase already has four of** — `bringCountOf`, `statusOf`, `stageOf` and `entryResidenceOf` each answer `null` for the Kind or trait whose fact this is not — and the docstring says so, and says why the default is `1` (invariant 6 confines owned-count to Counted; a Counted gear nobody counted owns one).
- [ ] **Step 4: Rewrite `claim.ts:260`'s `supply`** to `ownedCountOf(gear) ?? 1`, where the fallback now means *the Gear has not reached this replica*, not *no count was recorded*. Keep fix round F6's note about `supply` — it is still true and is the reason step 5 exists.
- [ ] **Step 5: Change no `app/` site, and say why in a comment.** `Depot.tsx`'s `qtyFor`, `GearDetail.tsx`'s `metaLine` and `OverClaimBand`'s F6 guard test `ownedCount !== undefined`, which asks **did somebody record a count** — a different question, and `claim.ts` states in as many words that a surface must read the register itself before printing `OWNED ×N`. `GearDetail.tsx:135`'s `?? 1` is a third question (what an edit sheet prefills) and is left alone.
- [ ] **Step 6:** export from `index.ts`; `npx vitest run --project shared` and `npm run typecheck` green; commit.

**Verification:** `claim.test.ts` passes untouched — the supply arithmetic is byte-identical in behaviour. No `app/` file changed.

---

## Task 2: `selectors/whereabouts.ts` — the trip slice and the split

**Files:**

- Rewrite: `shared/src/selectors/whereabouts.ts`, `shared/src/selectors/whereabouts.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**

- Consumes: `ownedCountOf` (Task 1); `containmentView`, `homePath`, `PathSegment`; `visibleTrips`, `isActive`, `tripLabel`; `entriesOf`, `entryKind`, `isContainerEntry`, `bringCountOf`; `piecesOf`; `tripContainmentView`, `entryResidenceOf`, `stageOf`, `overClaims`.
- Produces, all exported: the types `TripContainerRead`, `WhereaboutsSlice`, `Whereabouts`, `PersonWhereabouts`, `WhereaboutsDensity = 'full' | 'column' | 'chip'`, and the functions
  - `whereabouts(state, gearId, view?): Whereabouts`
  - `whereaboutsText(slice: WhereaboutsSlice, density: WhereaboutsDensity): string`
  - `rowWhereabouts(w: Whereabouts): { text: string; tone: 'home' | 'trip' | 'attention' }`
  - `sliceCountLabel(slice: WhereaboutsSlice): string | null`
  - `whereaboutsByPerson(state, gearId, view?): ReadonlyMap<string, PersonWhereabouts>`

  Exact type bodies are in **spec §2.1 and §3.4** — copy them, docstrings and all.

- [ ] **Step 1: Write the failing tests**, the list in spec §5.1 taken literally. Reuse `shared/testUtils/factories.ts` (`aTrip`, and the S7/S8/S9a entry factories) and the file's existing fold helper. Cover at minimum:
  - **Active only:** a Draft's and a Closed Trip's arrangements produce no slice; one `trip.phase_moved` into `pack_out` and the same arrangement counts.
  - **The pair that must not be unified:** one state where `dimension('trip').valuesOf` names the Trip and `whereabouts` does not, asserted together in one test with a comment naming spec §2.2.
  - **The unit that splits (D1):** Counted → `count` both sides, home = owned − Σ bring; Per-person → home `count` `null`, trip `pieceCount` = included Pieces; **Single → both `null` on both slices, and the home slice still present**.
  - **One slice per Trip (D2):** two Entries on one Trip naming one Gear → one slice; a per-person Entry with Pieces in two containers → `container` `{of:'mixed'}`; residences sharing a container but disagreeing on chain-root stage → container named, `stage` `null`, and **no second `MIXED`**.
  - **The stage is the chain root's (D3):** stove in Crate B (`home`) inside Duffel (`car`) → `container` Crate B, `stage` `'car'`; a Gear that **is** the loose trip container → `container` `null`, `stage` its own; the same Gear nested → reads like anything else inside.
  - **Unresolvable residences:** a pointer at a removed / non-container / unfolded Entry reads loose, through the view.
  - **`rowWhereabouts`' four arms**, tone included.
  - **Over-claim (D8):** home count floors at `×0` rather than going negative; trip counts stay honest; `overClaimed` is `true`; the row read swaps to `attention`.
  - **`whereaboutsByPerson` (D6):** keys are the claiming Trips' Participants and the **union** across two; a Person who is not a Participant is **absent**; a Participant with a **removed** Piece is present and reads home; each Participant's slice carries **their own Piece's** residence, not the Entry-wide reconciliation; `contestedTripIds` fills only when two claiming Trips both include them.
  - **The memo is keyed on identity:** folding an op that changes the answer changes it.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: The memo.** `const TRIP_SLICES = new WeakMap<DepotState, { byGear: Map<string, TripSliceFacts[]>; overClaimed: ReadonlySet<string> }>()`, built by one pass over `visibleTrips(state).filter(isActive)` — one `tripContainmentView` per Trip, `overClaims(state)` read **once** into the set. Model the docstring on `slice.ts`'s `tripMembershipOf`, which states the whole argument; spec §3.5 says this is its second instance.
- [ ] **Step 4: Gather and reconcile**, per Trip per Gear. Residences: a **container** Entry contributes its own (check `isContainerEntry` first); a **per-person** Entry contributes one per included Piece (`piecesOf`); everything else contributes `entryResidenceOf`. All through `view.resolveResidence`. Then, **each segment on its own** (D2): `container` = the immediate holders — one → name it, several → `{of:'mixed'}`, none → `null`; `stage` = each residence's **chain-root** stage (D3) — all equal → that value, else `null`. Counts follow **Kind**: Counted sums `bringCountOf`, per-person counts included Pieces, Single is `null` both.
- [ ] **Step 5: `whereabouts()`** — home slice first (`homePath`, count per §2.4 floored at 0), then the memo's trip slices sorted by `tripName` then `tripId`, plus `overClaimed`.
- [ ] **Step 6: The three formatters** — `whereaboutsText` (spec §3.2's table; `{of:'mixed'}` → `MIXED`, `null` → `LOOSE`), `rowWhereabouts` (spec §3.3's four arms), `sliceCountLabel` (D1's rule, reading which of `count`/`pieceCount` is non-null — never the Kind again).
- [ ] **Step 7: `whereaboutsByPerson`** per spec §3.4. Build each Participant's slice from **their own Piece's** residence.
- [ ] **Step 8:** export everything from `index.ts`; delete the old docstring's *"S9a writes the fact and S9b reads it"* promise, which this task makes true; `npx vitest run --project shared` and `npm run typecheck` green; commit.

**Verification:** every listed test passes; `slice.test.ts`, `claim.test.ts` and `packing*.test.ts` pass untouched.

---

## Task 3: `CONTAINER` — the sixth dimension and the fourth grouping

**Files:**

- Modify: `shared/src/selectors/slice.ts`, `shared/src/selectors/slice.test.ts`, `shared/src/index.ts`

**Interfaces:**

- Consumes: `containmentView`, `HolderRef` (`containment.ts`); `visibleGear`.
- Produces: `DimensionId` gains `'container'`; `GroupKey` gains `'container'`; `GROUP_KEYS` becomes `['none', 'kind', 'owner', 'container']`. No signature changes anywhere — `Dimension` and `Grouping` already take `(gear, state)`.

- [ ] **Step 1: Write the failing tests** in `slice.test.ts`: gear inside `Crate B` inside `Shelf L-Top` carries **both** as values (the filter reaches any depth) but groups under **`Crate B`** only (D5); gear residing directly in a Place carries the sentinel; loose gear carries the sentinel; the sentinel sorts **first** in `dimensionValues` whatever its count; `format` renders `Not in a container` for the sentinel and the gear's name otherwise, `—` for a container this replica has not folded; grouping is a **partition** — every visible Gear in exactly one bucket and the bucket sizes summing to `visibleGear(state).length`; a retired container still holds nothing (`containmentView` reason 2 already reads its contents loose).
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: The ancestors memo.** `const CONTAINER_ANCESTORS = new WeakMap<DepotState, Map<string, readonly string[]>>()`, each Gear's **container** ancestors outermost-first, built from one `containmentView(state)`. Its docstring gives spec §3.5's reason — `valuesOf` gets no view, and a per-row `containmentView` is O(n² log n) on the app's most-visited screen — and names the rejected alternative (memoising `containmentView` itself) with its reason.
- [ ] **Step 4: The dimension row.** `const NOT_IN_A_CONTAINER = 'none'` beside `NOT_IN_ANY_TRIP`, with a comment that reserved words are per-dimension so the shared spelling is not a collision. `arity: 'single'`, `label: 'CONTAINER'`, `valuesOf` = the memo's ancestors or `[NOT_IN_A_CONTAINER]`, `format` = `'Not in a container'` or the gear's name (sentence case — CAPS is the chip's CSS transform, exactly as `KIND_LABELS` relies on), `pinned: NOT_IN_A_CONTAINER`. **The sentinel is checked before `state.gear` is indexed**, the `trip` row's own rule.
- [ ] **Step 5: The grouping row.** `keyOf` = `view.holderOf(gear.id)` when it is `{kind:'gear'}`, else the sentinel — the **immediate** container, which is the only thing a partition can be. `format` uses the identical words as the dimension (D4: one bucket, one name). `pinned: NOT_IN_A_CONTAINER`. Add `'container'` to `GROUP_KEYS`.
- [ ] **Step 6:** widen the two exported unions; `npx vitest run --project shared` and `npm run typecheck` green; commit.

**Verification:** `SliceBar`, `ValueMenu` and `SortGroupSheet` compile and behave with **no edit** — that is spec §4.4's altitude claim, and it is what this task proves. Their existing tests pass untouched.

---

## Task 4: Gear detail — the card, the chips, the `PIECES` group

**Files:**

- Modify: `app/src/components/WhereaboutsCard.tsx` (+ `.module.css`, `.test.tsx`), `app/src/screens/GearDetail.tsx` (+ `.module.css`, `.test.tsx`)

**Interfaces:**

- Consumes: Task 2's `whereabouts`, `whereaboutsText`, `sliceCountLabel`, `whereaboutsByPerson`, `Whereabouts`, `WhereaboutsSlice`; `sortedPeople` (`app/src/depot/people.ts`); `ui/`'s `PersonCircle` at `size={22}`.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing component tests.** `WhereaboutsCard`: a home-only card; a card with **two** trip slices (the case `key={slice.kind}` collided on — assert both rows render, by their trip names); the label per slice (`⌂ HOME SLOT` vs `▸ ON TRIP — ALPS 2026`); the value line (`DUFFEL 90 L · CAR`, `LOOSE`, `MIXED`); **the three footer states** — ordinary, the Single form with the first clause dropped, and the ▲ over-claim form with `RESOLVE`. `GearDetail`: `COUNT`'s trip chips; the `PIECES` group present for per-person gear with a Piece out and **absent** otherwise; a contested Participant's chip reading `M ▲ 2 TRIPS` **with no link**; no `COUNT` and no `PIECES` on a Single.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: `WhereaboutsCard`.** Take `slices` and the two facts the footer needs (`overClaimed`, and whether the gear splits at all). Key rows by `` `${slice.kind}:${slice.kind === 'trip' ? slice.tripId : ''}` ``. Delete the JSDoc paragraph that logs the collision — **this component closes it**, and a docstring describing a fixed defect is worse than none. The ▲ footer's two numbers are **Counted-only** (spec §6.1); every other Kind reads `▲ CLAIMED BY N TRIPS`.
- [ ] **Step 4: `GearDetail`.** `chipLabel` grows a trip arm (`×1 ▸ ALPS 2026`); home chips first. The `PIECES` group is a new block after `COUNT`, per-person only, rendering `whereaboutsByPerson` in `sortedPeople` order with `whereaboutsText(slice, 'chip')`. `RESOLVE` on the footer routes to the first claiming Trip by name A→Z (D7), accessible name `Resolve on <trip>`.
- [ ] **Step 5:** CSS for the `PIECES` group follows the `COUNT` group's blocks; the ▲ footer uses the attention token the card's own stylesheet already reaches for elsewhere in the app — **no new colour literal**.
- [ ] **Step 6:** `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** every existing `GearDetail.test.tsx` assertion still passes or is updated **with** the change and never around it — an assertion loosened to accommodate a regression is the failure S9a §11.5 records.

---

## Task 5: Find — the plain row, the counted card, the per-person card

**Files:**

- Modify: `app/src/screens/Find.tsx` (+ `.module.css`, `.test.tsx`)

**Interfaces:**

- Consumes: Task 2's `whereabouts`, `whereaboutsText`, `rowWhereabouts`, `whereaboutsByPerson`; `sortedPeople`, `personInitial`; `ui/`'s `PersonCircle` at `size={28}`, `GearRow`.
- Produces: nothing other tasks consume. `PerPersonCard` stays **in-file** — a Find-local card, deliberately not a `ui/` composite (spec §7).

- [ ] **Step 1: Write the failing tests.** A single gear on a Trip: the plain row's whereabouts slot reads `▸ ALPS 2026 · CAR` with the trip tone while the meta keeps `⌂ ATTIC ▸ CRATE B` (D9). A counted gear split home/trip: one row per slice at full density. A per-person gear with a Piece out: the card renders, one row per **Participant**, a removed Piece reading the home path with **no mention of the removal** (B5). The same gear with nothing out: **no card**, a plain row. A contested Participant: `▲ CLAIMED BY 2 TRIPS` + a `RESOLVE` link whose href is the first claiming Trip by name and whose accessible name is `Resolve on <trip>`.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: `PlainRow`** takes `rowWhereabouts` — the same call `Depot.tsx` makes, so the two rows cannot drift.
- [ ] **Step 4: `CountedCard`**'s rows call `whereaboutsText(slice, 'full')`; its `key` takes the same composite Task 4 uses.
- [ ] **Step 5: `PerPersonCard`**, new: header row (name, `PER-PERSON · ×N`, scope tag), then one row per Participant — 28px circle, `whereaboutsText(slice, 'full')`, trailing mini chip — mounted only while at least one Piece is on an active Trip.
- [ ] **Step 6: Delete the header docblock's two stale paragraphs** — the `per_person` *"waits for Pieces, rather than being approximated"* seam and the *"amber trip slice … deliberately not placeholder'd"* note. **Both become false in this task**, and S9a's §3.6 obligation is that a promise turned falsehood is deleted rather than left to read as a lie.
- [ ] **Step 7:** `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** Find's existing search, count-line and RECENT tests pass untouched — this task adds row shapes and removes none.

---

## Task 6: The Depot — the column, the tone, the grouped headers

**Files:**

- Modify: `app/src/screens/Depot.tsx` (+ `.module.css`, `.test.tsx`), `app/src/components/SliceBar.tsx` (+ `.test.tsx`)

**Interfaces:**

- Consumes: Task 2's `whereabouts` + `rowWhereabouts`; Task 3's `container` dimension and grouping; `homePath` for the header meta.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing tests.** The row's whereabouts prop and **tone** asserted on the rendered element, not on the string handed in (`screenBand.test.tsx`'s lesson about one-sided assertions): `⌂ HOME` home-toned; `▸ ALPS 2026 · CAR` trip-toned; `▸ 2 TRIPS` for two active slices; `▲ 2 TRIPS` attention-toned when over-claimed. The `HOME` column and the 2-line meta keep the **home** path in every one of those states (D9). Grouped by container: flat headers, the sentinel first reading `Not in a container` with **no** meta line, every other header carrying the container's own home path as its meta, counts summing to the shown list. The hint's second clause present while grouped by container and **absent** otherwise.
- [ ] **Step 2: Run them** and watch them fail.
- [ ] **Step 3: `Row`** — delete the `whereabouts="⌂ HOME"` literal and its now-false comment; spread `rowWhereabouts(whereabouts(state, gear.id, view))` into the `whereabouts` and `tone` props. Change nothing else about the row.
- [ ] **Step 4: `Group`** — when `spec.group === 'container'` and `group.key` is a gear id, render the container's own `homePath` as a muted meta line beneath the header name. The sentinel and the ungrouped bucket render none. **Derive it from `group.key`** rather than widening `SliceGroup`: the screen already holds the view, and a shape change would reach every grouping.
- [ ] **Step 5: `SliceBar`** — the arrange row's hint gains `GROUPS FILE EACH GEAR UNDER THE CONTAINER IT IS IN` while `spec.group === 'container'`. **This is the one component D5 makes spec §4.4's "changes no component" untrue about**; note it in the code and carry it to Task 7.
- [ ] **Step 6:** `npx vitest run --project app` and `npm run typecheck` green; commit.

**Verification:** the Depot's existing slice-bar, sort, group and search tests pass untouched. `npm test` green across all four projects.

---

## Task 7: The docs, and the debt

**Files:**

- Modify: `docs/architecture-design.md`, `docs/technical-debt.md`, `docs/specs/2026-09-04-whereabouts-reaches-the-depot.md`, `CLAUDE.md`
- Possibly modify: `docs/design/README.md` §1

- [ ] **Step 1: `architecture-design.md`** — a new **§12.16, Consequences of S9b**, in §12.15's voice: what the second cross-aggregate memo cost, why whereabouts and `TRIP` membership answer differently, what D1's *unit that splits* rule replaced, and that `attention` arrived a slice early. Mark §8.3's S9b entry **landed**; check §8.5's `Container (home) | S9b` row still reads true.
- [ ] **Step 2: `technical-debt.md`** — delete the `WhereaboutsCard` collision entry and the owned-count entry, **and say in the deletion what the second one had wrong** (`d43f64d`'s finding: two sites, not five, and the three `app/` gates ask a different question). Open the memoised-`containmentView` entry with its anchor, per spec §7.
- [ ] **Step 3: The spec's own record.** Append **§9, What changed during implementation**, following `the-gear-list.md` §11 and `packing-and-the-journey.md` §11: **nothing above the line is edited.** At minimum it carries §4.4's "changes no component" being untrue of `SliceBar` after D5's hint, plus whatever tasks 1–6 found.
- [ ] **Step 4: `design/README.md` §1** — a code-authored line for any of §6.1's three decisions the next round should meet where it looks, in the shape §1's existing code-authored lines take.
- [ ] **Step 5: `CLAUDE.md`** — the status section gains S9b beside S9a, in the voice of the S9a paragraph above it, with the three or four things worth knowing before touching whereabouts.
- [ ] **Step 6:** `npm test` and `npm run typecheck` and `npm run lint` and `npm run format:check` all green; commit.

**Verification:** no doc claims S9b is unbuilt; no doc still promises a fact this slice now delivers; `grep -rn "S9b" docs/` reads true everywhere.

---

## Self-review notes

- **Spec coverage.** §2.1–§2.5 → Task 2. §2.6 and §7's debt → Tasks 1, 7. §3.1–§3.5 → Tasks 2, 3. §4.1 → Task 6. §4.2 → Task 4. §4.3 → Task 5. §4.4 → Tasks 3, 6. §5.1 → Tasks 1–3. §5.3 → Tasks 4–6. §5.4 → nothing to build, by design. §6.1's three decisions → Tasks 2 and 4, recorded in Task 7.
- **One spec sentence is already known false** and is Task 7's to record rather than Task 6's to hide: §4.4 says `SliceBar` changes not at all, and D5's conditional hint clause is one edit. The dimension and grouping tables really do change no component; the hint is not one of them.
- **Names used before they are defined:** none. `TripSliceFacts` is Task 2-internal; every cross-task name is in an Interfaces block.
