# S6 — Trips and Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship story 5 — a Trip exists, carries an optional pair of dates and a set of Participants, and says plainly where it stands — plus story 32's phase machine, moving **both directions**, with the next thing to do stated.

**Architecture:** Six op types and five reducer handlers in `shared/`, bringing the **fourth aggregate** into the fold; one new selector module (`selectors/trip.ts`); three new screens and three new components in `app/`. **No endpoints, no migration, no server change** — a domain slice adds no HTTP surface, and the server has no op vocabulary.

**Tech Stack:** TypeScript · React 19 · wouter · Zustand · CSS Modules · Radix (`ui/`'s `Sheet`, `Confirm`) · Vitest · Testing Library

**Spec:** [`docs/specs/2026-08-29-trips-and-phases.md`](2026-08-29-trips-and-phases.md) — read it alongside this plan. Where they disagree, **the spec wins**; where the spec and `docs/design/*.dc.html` disagree, **the boards win**.

## Global Constraints

- **Relative imports in `shared/` need an explicit `.ts` extension.** `app/` and `ui/` are the exception — Vite resolves, so no extension there.
- **Ops mirror the wire — `snake_case`, never transformed.** Folded state, selectors and React props are ordinary `camelCase`. `authoring.ts` and `payloads.ts` are the only two places the boundary is crossed.
- **`null` clears a nullable register; an absent field leaves it alone.** [sync §1.3](../sync-protocol.md) is the authority — *not* §5.3 obligation 5, which runs the other way only.
- **A register whose declared type includes `null` takes an explicit `null` as a clear; one whose type does not treats `null` as malformed and ignores it.** `TripState.name`, `.startDate` and `.endDate` are `Register<string | null>` → `writeNullableIfPresent`. `.phase`, `.fromTripId`, `.participants` are not → `writeRegister` behind a `kind !== 'value'` guard.
- **Every handler propagates identity on a lost write.** If `writeRegister` returns the register it was given, the handler returns the *identical* entity object and `writeTrip` returns the identical `DepotState`. A spread on a lost write invalidates a memo downstream for nothing.
- **An absent `phase` register reads `draft`** (spec §3.2). Read it through `phaseOf`, never by re-deriving `trip.phase?.value ?? 'draft'` at a call site. The symptom of a call site that re-derives is a Trip that appears in one section and is drawn with another section's chip.
- **`isActive` is the only definition of active-ness.** S7's claims, S9's whereabouts and S10's close gate all call it. Never inline the three-phase test.
- **A phase this build does not recognise is stored verbatim, is not active, and files under `PLANNED`** (spec §3.4). `PhaseValue` is open past its five members, like `KindValue`.
- **A media query decides which elements *exist*; a container query decides how what exists *lays out*** ([frontend-design §3.2](../frontend-design.md)). The Roomy 2-up card fold is a **container** query.
- **Tier 0 runs on every commit** (pre-commit: `tsc --noEmit` across workspaces, ESLint, Prettier). A commit that fails it is not a commit.
- **Vocabulary is law.** Trip · Phase · Participant · Draft · Pack-out · On trip · Unpack · Closed · Active · Quartermaster. Never "event", never "user", never "status" for a phase (status is packing, S9).
- **Never print a slice number in user-facing copy.** `S7`-style scope tags live on the boards and in comments, never on screen.
- **Known-flaky neighbour:** `api/test/server/sync.test.ts` fails nondeterministically in the full suite and passes alone. This slice touches no `api/` file; if it fails, re-run it alone to confirm the known flake.
- **Commands.** `npm test -w @foerier/shared`, `npm test -w @foerier/app`, `npm test` (all), `npm run typecheck`.

---

## File Structure

**`shared/` — the fold and the selectors**

| Path | Responsibility |
| --- | --- |
| `shared/src/state.ts` | Modify: `PhaseValue`, `TripState`, `DepotState.trips` |
| `shared/src/authoring.ts` | Modify: six builders — `tripCreated`, `tripRenamed`, `tripDatesSet`, `tripPhaseMoved`, `tripParticipantAdded`, `tripParticipantRemoved` |
| `shared/src/reduce.ts` | Modify: `writeTrip`; five handlers under six keys; `emptyState()` gains `trips: {}` |
| `shared/src/selectors/trip.ts` | **Create**: `PHASES`, `phaseOf`, `phaseLabel`, `isActive`, `phaseDay`, `tripLabel`, `participantIds`, `visibleTrips`, `tripSections` |
| `shared/src/index.ts` | Modify: the new exports |
| `shared/testUtils/factories.ts` | Modify: add `aTrip` |

**`shared/` tests**

| Path | Responsibility |
| --- | --- |
| `shared/src/reduce.test.ts` | Modify: the six folds |
| `shared/src/selectors/trip.test.ts` | **Create**: phases, sections, ordering, `phaseDay` |
| `shared/src/convergence.test.ts` | Modify: three Tier 2 scenarios |
| `shared/fixtures/s6-trips.ops.json` | **Create**: the S6 capture |
| `shared/src/fixtures.s6.test.ts` | **Create**: the replay |
| `shared/fixtures/s4-ownership.ops.json` | **Create**: S4's unpaid fixture (spec §5.5) |
| `shared/src/fixtures.s4.test.ts` | **Create**: its replay |

**`app/` — the screens**

| Path | Responsibility |
| --- | --- |
| `app/src/depot/trips.ts` | **Create**: `tripParticipants(state, trip)` — display order from `sortedPeople` |
| `app/src/components/PhaseSheet.tsx` (+ `.module.css`) | **Create**: SET PHASE, five rows, `● NOW`, the reopen confirm |
| `app/src/components/ParticipantPicker.tsx` (+ `.module.css`) | **Create**: the multi-select sheet, `+ New person` |
| `app/src/components/TripCard.tsx` (+ `.module.css`) | **Create**: the active / planned card, `@container` 2-up |
| `app/src/screens/Trips.tsx` (+ `.module.css`) | **Create**: the three sections |
| `app/src/screens/NewTrip.tsx` (+ `.module.css`) | **Create**: F3 step 1 |
| `app/src/screens/Trip.tsx` (+ `.module.css`) | **Create**: the trip screen, EDIT mode |
| `app/src/App.tsx` | Modify: three routes; `/trips` count in `useDestinationCounts` |
| `app/src/App.test.tsx` | Modify: the Trips-count assertion inverts |

**Docs**

| Path | Responsibility |
| --- | --- |
| `docs/sync-protocol.md` | §4.4 — the two `name` rows, the reducer-seeded phase, the `start`/`start_date` split |
| `docs/architecture-design.md` | §12.11; §8.3's S6 entry marked landed |
| `docs/design/README.md` | §5, §5a — the four departures |
| `docs/testing.md` | The fixture list gains `s4-ownership` and `s6-trips` |
| `CLAUDE.md` | Status |

---

## Task 1: The Trip enters the fold

**Files:**
- Modify: `shared/src/state.ts`, `shared/src/authoring.ts`, `shared/src/reduce.ts`, `shared/src/index.ts`, `shared/testUtils/factories.ts`
- Test: `shared/src/reduce.test.ts`

**Interfaces:**
- Produces: `PhaseValue`, `TripState`, `DepotState.trips`; the six builders; `aTrip(overrides?)`.
- Consumes: `writeNullableIfPresent`, `writeRegister`, `readString`, `readOpen` — all already in `reduce.ts` / `payloads.ts`. **No new payload reader is needed**; a date is read with `readString` (spec §1.4).

- [ ] **Step 1: Write the failing tests** in `shared/src/reduce.test.ts`, matching the file's existing `describe`/`it` style:
  - `trip.created` seeds `name` **and** `phase = 'draft'`, both stamped with that op's clock.
  - A `trip.phase_moved` at a **higher** clock, folded **before** its `trip.created`, survives the creation.
  - A re-delivered `trip.created` (identical op) changes nothing and returns the identical state object.
  - `trip.created{from_trip_id}` folds into `fromTripId`. Hand-shape this op — the builder does not accept the field.
  - `trip.renamed`: a string, an explicit `null` (clears), an absent field (leaves alone).
  - `trip.dates_set`: `{start}` alone leaves `endDate` untouched; `{end: null}` clears the end and not the start; `{start: 'not-a-date'}` is stored verbatim.
  - `trip.phase_moved`: each of the five values; an unrecognised value stored verbatim.
  - Participants: two adds of different People union; add-vs-remove of the same Person resolves by plain LWW; a removal folds to `false`, not a dropped key.
  - A lost write on any Trip register returns the identical `DepotState`.
- [ ] **Step 2: `state.ts`** — add `PhaseValue` (open, modelled exactly on `KindValue`, with its comment about obligation 4), `TripState` (spec §2, every field documented, `deleted` marked *declared, never written here*), and `trips` on `DepotState`.
- [ ] **Step 3: `authoring.ts`** — six builders. `tripCreated(id, name: string)` and `tripRenamed(id, name: string | null)`; `tripDatesSet(id, dates: {start?: string | null; end?: string | null})` omitting an absent key entirely (`gearRecorded`'s spread idiom); `tripPhaseMoved(id, phase: PhaseValue)`; `tripParticipantAdded/Removed(id, personId)` emitting `{person_id}`. Document why `tripCreated` takes `string` while the reader accepts `null` (spec §1.2).
- [ ] **Step 4: `reduce.ts`** — `emptyState()` gains `trips: {}`; `writeTrip` beside the other three (spec §2 says why it is a fourth copy and not a generic); handlers:
  - `tripCreated` — `name` via `writeNullableIfPresent`, `phase` via `writeRegister(_, 'draft', st)`, `fromTripId` via `writeIfPresent(readString(...))`. Identity check across all three before spreading.
  - `setTripName` — shared by `trip.renamed` (and reached by `trip.created` through its own handler).
  - `tripDatesSet` — two independent `writeNullableIfPresent` calls; identity check across both.
  - `tripPhaseMoved` — `readOpen('phase')`, `gearKindSet`'s shape.
  - `tripParticipantWritten(present: boolean)` — `gearTagWritten`'s shape with `person_id` / `participants`.
- [ ] **Step 5:** register all six keys in the dispatch table; export the new types and builders from `index.ts`; add `aTrip(overrides?: {id?, name?, phase?, start?, end?, participants?})` to `testUtils/factories.ts` returning `OpSpec[]` through the real builders.
- [ ] **Step 6:** `npm test -w @foerier/shared` green; `npm run typecheck` green.

**Verification:** every new test passes; no existing `shared/` test changes behaviour. `emptyState()` returning a new key is the only change visible to `store.ts`, and it needs none.

---

## Task 2: `selectors/trip.ts`

**Files:**
- Create: `shared/src/selectors/trip.ts`, `shared/src/selectors/trip.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces: `PhaseKey`, `Phase`, `PHASES`, `phaseOf`, `phaseLabel`, `isActive`, `phaseDay`, `tripLabel`, `participantIds`, `visibleTrips`, `TripSections`, `tripSections`.
- Consumes: `stampOf`, `parseHlc`, `TripState`, `DepotState`.

- [ ] **Step 1: Write the failing tests** in `trip.test.ts`:
  - `phaseOf` on an absent register reads `'draft'`; on a written register reads the value; on an unrecognised value reads it verbatim.
  - `isActive` true for exactly `pack_out`, `on_trip`, `unpack`; false for `draft`, `closed`, `'something-later'`, and an absent register.
  - `tripLabel` returns the name, `—` for absent and for `null`.
  - `participantIds` returns only `true` registers, sorted, and is stable across insertion orders.
  - `tripSections`: membership for all five phases plus an unrecognised one (→ `planned`); active and planned **ascending** by start date with undated last; closed **descending** with undated last; name then id tiebreaks; **totality** — the same ops folded in two different orders produce identical section arrays.
  - `visibleTrips` excludes a Trip whose `deleted` register is `true` (hand-shape a `trip.deleted` op; no builder exists).
  - `phaseDay`: `1` on the day of the change, `2` after local midnight, `null` on an absent register.
- [ ] **Step 2:** implement the phase table (spec §3.1) — `PHASES` in order, each row `{id, label, active, next}`. `next` is the mono next-step line from spec §6.2, `null` for `closed`.
- [ ] **Step 3:** `phaseOf` / `phaseLabel` / `isActive`. `phaseLabel` returns the table's label for a known phase and the **raw value** for an unrecognised one (`dimension('kind').format`'s rule).
- [ ] **Step 4:** `phaseDay(trip, now)` — `stampOf(trip.phase)` → `parseHlc(hlc)?.ms`, then local calendar-day difference + 1. Document the drift argument from spec §3.6.
- [ ] **Step 5:** `visibleTrips` / `tripSections`, with `depot.ts`'s `byNameThenId` tiebreak reused in spirit (a Trip has the same `{id, name?}` shape, so the comparator can be lifted or duplicated — prefer lifting a shared `byNameThenId` if it does not force an export `depot.ts` does not want).
- [ ] **Step 6:** export from `index.ts`; `npm test -w @foerier/shared` green.

**Verification:** the totality test is the one that matters — it is what stops two devices drawing the Trips list differently.

---

## Task 3: Tier 2 convergence

**Files:** Modify `shared/src/convergence.test.ts`

- [ ] **Step 1:** concurrent phase moves — two replicas move one Trip to different phases; converge to the same phase whichever order the ops arrive.
- [ ] **Step 2:** a Participant added on replica A and removed on replica B — one register, plain LWW, and the loser's write is not resurrected by a later unrelated op on the Trip.
- [ ] **Step 3:** `trip.renamed` racing `trip.dates_set` — different registers, both survive in either delivery order.
- [ ] **Step 4:** `npm test -w @foerier/shared` green.

**Verification:** each scenario uses the existing `replica.ts` harness rather than folding by hand.

---

## Task 4: Fixtures

**Files:**
- Create: `shared/fixtures/s6-trips.ops.json`, `shared/src/fixtures.s6.test.ts`
- Create: `shared/fixtures/s4-ownership.ops.json`, `shared/src/fixtures.s4.test.ts`

- [ ] **Step 1:** capture `s6-trips.ops.json` — all six op types, plus four **probes no builder of ours can author**: a `from_trip_id`, an unrecognised phase, a non-conforming date, and a `null` name. Document each probe in the test file's header exactly as `fixtures.s3.test.ts` documents its foreign tags, so nobody reads them as evidence an old build emitted them.
- [ ] **Step 2:** `fixtures.s6.test.ts` — `fixtures.s3.test.ts`'s shape: a `toMatchSnapshot()` of the fold, a "never mutates the fixture" test, and named assertions for the probes.
- [ ] **Step 3:** capture `s4-ownership.ops.json` — `person.renamed` and `gear.ownership_set` (spec §5.5), with a `null` name and a shared→personal→shared sequence.
- [ ] **Step 4:** `fixtures.s4.test.ts`, same shape. Its header records that this was captured a slice late, and why that is weaker than a same-slice capture.
- [ ] **Step 5:** `npm test -w @foerier/shared` green; commit the snapshots.

**Verification:** `shared/fixtures/` holds four files; every op type from S2, S3, S4 and S6 appears in exactly one of them.

---

## Task 5: `app/src/depot/trips.ts`

**Files:** Create `app/src/depot/trips.ts` (+ its test)

- [ ] **Step 1:** `tripParticipants(state, trip): readonly PersonRow[]` — `sortedPeople(state)` filtered to `participantIds(trip)`. Document why the display order comes from `sortedPeople` and not from `participantIds` (spec §3.3).
- [ ] **Step 2:** a test that a Participant whose Person op has not folded yet still appears, labelled `—`. (`participantIds` names person ids; `sortedPeople` only lists folded People, so this case needs a decision — **include them**, appended after the folded ones in id order, so a Participant never silently vanishes.)
- [ ] **Step 3:** `npm test -w @foerier/app` green.

---

## Task 6: `PhaseSheet` and the reopen confirm

**Files:** Create `app/src/components/PhaseSheet.tsx`, `.module.css`, `PhaseSheet.test.tsx`

**Interfaces:** `PhaseSheetProps { trip: TripState; onClose(): void }`. Emits `trip.phase_moved` through `useDepot(d => d.emit)`.

- [ ] **Step 1: Write the failing tests** — five rows in `PHASES` order; the current one marked `● NOW`; tapping a **backwards** row emits `trip.phase_moved` with that phase; `unpack → closed` emits with **no** confirm; `closed → anything` opens the confirm and emits only on confirm, not on cancel; an unrecognised current phase marks no row and states the value verbatim.
- [ ] **Step 2:** build on `ui/`'s `Sheet` (title `Set phase`, `desktopCard`), rows styled after `OwnerPicker`'s.
- [ ] **Step 3:** the reopen path uses `ui/`'s `Confirm` with spec §6.3's exact copy and **no** mono blocks. Primary accent, per the board. Leave a comment naming S11 as the slice that fills the body.
- [ ] **Step 4:** the board's footnote line, `NO DATE OR COUNT EVER MOVES A PHASE.`
- [ ] **Step 5:** `npm test -w @foerier/app` green.

**Verification:** the confirm is withheld on every move except leaving `closed`; the sheet has no `open` prop (mounted is open — the Radix conversion's rule).

---

## Task 7: `ParticipantPicker`

**Files:** Create `app/src/components/ParticipantPicker.tsx`, `.module.css`, `ParticipantPicker.test.tsx`

**Interfaces:** `ParticipantPickerProps { selected: readonly string[]; onToggle(personId: string, next: boolean): void; onClose(): void }` — the picker is **controlled and emits nothing itself**, so `/trips/new` can hold a draft selection and `/trips/:id` can emit per toggle.

- [ ] **Step 1: Write the failing tests** — rows in `sortedPeople` order, `aria-pressed` reflecting `selected`, toggling calls `onToggle` both ways, `+ New person` records a Person **and selects them**, no confirm on removal.
- [ ] **Step 2:** build it as `OwnerPicker`'s twin. `+ New person` authors `person.recorded` directly (it is a Depot fact, not a Trip one) and then calls `onToggle(id, true)`.
- [ ] **Step 3:** `npm test -w @foerier/app` green.

---

## Task 8: `TripCard`

**Files:** Create `app/src/components/TripCard.tsx`, `.module.css`, `TripCard.test.tsx`

**Interfaces:** `TripCardProps { trip: TripState; variant: 'active' | 'planned'; onOpenPhase(): void }`.

- [ ] **Step 1: Write the failing tests** — the active card draws name with `▸`, the phase chip with `DAY N`, the dates line, participant circles, the next-step line, and `OPEN ›`; **the dates row is absent entirely when there are no dates** (the board's variant); the planned card is dashed, reads `DRAFT · 0 GEAR LISTED`, and carries no day count; an unrecognised phase draws its raw value and no next-step line.
- [ ] **Step 2:** build it. The phase chip is a **button** opening `PhaseSheet` (the board: "tapping the phase chip opens a SET PHASE sheet").
- [ ] **Step 3:** participant circles reuse the People screen's initial-circle treatment: `aria-hidden` initial, empty circle when the Person has no folded name.
- [ ] **Step 4:** the Roomy 2-up fold is a **`@container`** rule in `.module.css` — never a media query. Cite [frontend-design §3.2](../frontend-design.md) in the file header.
- [ ] **Step 5:** `npm test -w @foerier/app` green.

---

## Task 9: `/trips` — the Trips list

**Files:** Create `app/src/screens/Trips.tsx`, `.module.css`, `Trips.test.tsx`

- [ ] **Step 1: Write the failing tests** — the empty state reads `No trips.`; active Trips render cards, planned Trips render dashed cards, closed Trips render ledger rows under a `CLOSED` header and **only** that header is drawn; `REOPEN` opens the confirm; `+ NEW` links to `/trips/new`; the three sections appear in order.
- [ ] **Step 2:** build it from `tripSections(state)`, memoed on the fold the way `Depot.tsx` memoes `depotCounts`.
- [ ] **Step 3:** the closed row's meta is the start date's month and year where a date exists, and nothing where it does not — never a fabricated one.
- [ ] **Step 4:** `npm test -w @foerier/app` green.

---

## Task 10: `/trips/new` — F3's first step

**Files:** Create `app/src/screens/NewTrip.tsx`, `.module.css`, `NewTrip.test.tsx`

- [ ] **Step 1: Write the failing tests** — `Create trip` is disabled until a name is typed; creating with a name alone emits **exactly one** op (`trip.created`); creating with a date emits `trip.created` + `trip.dates_set` carrying **only the fields entered**; creating with two Participants emits two `trip.participant_added`; after creating, the app is at `/trips/:id`.
- [ ] **Step 2:** build it on `AddGear`'s shape — rows `NAME` · `DATES` · `PARTICIPANTS`, primary at the bottom in the thumb zone.
- [ ] **Step 3:** dates are two native `<input type="date">`; an empty field emits **nothing**, never `null` (spec §4.2).
- [ ] **Step 4:** `npm test -w @foerier/app` green.

**Verification:** the "one op for a bare Trip" assertion is the one that matters — a needless `trip.dates_set` writing two clears is exactly the waste spec §4.2 forbids.

---

## Task 11: `/trips/:id` — the trip screen

**Files:** Create `app/src/screens/Trip.tsx`, `.module.css`, `Trip.test.tsx`

- [ ] **Step 1: Write the failing tests** — header (`‹ TRIPS`, name, dates, participant circles, phase chip, next-step line); the gear region reads `0 GEAR LISTED.` with no add affordance; `EDIT` reveals rename, dates and participants; a rename that changes nothing emits **nothing**; changing one date emits `trip.dates_set` with **one** key; toggling a Participant emits immediately; an unknown `:id` renders a not-found line rather than throwing.
- [ ] **Step 2:** build it. `EDIT` is the People screen's quiet mono toggle.
- [ ] **Step 3:** no `DELETE` — leave a comment naming S14.
- [ ] **Step 4:** `npm test -w @foerier/app` green.

---

## Task 12: Routes and the sidebar count

**Files:** Modify `app/src/App.tsx`, `app/src/App.test.tsx`

- [ ] **Step 1:** replace the `/trips` `EmptyState` with `<Trips />`; add `/trips/new` → `<NewTrip />` and `/trips/:id` → `<Trip />`. **Order matters** in wouter's `Switch`: `/trips/new` before `/trips/:id`.
- [ ] **Step 2:** `useDestinationCounts` gains `'/trips': visibleTrips(state).length`, memoed on the fold beside the gear count. Rewrite the comment — it currently explains why there is no count.
- [ ] **Step 3:** invert `App.test.tsx`'s *"gives Trips no count, because there are no trips yet"* into a test that a folded Trip shows a count, and that a **deleted** Trip does not.
- [ ] **Step 4:** `npm test -w @foerier/app` green; `npm test` green across all workspaces.

---

## Task 13: Docs

**Files:** Modify `docs/sync-protocol.md`, `docs/architecture-design.md`, `docs/design/README.md`, `docs/testing.md`, `CLAUDE.md`

- [ ] **Step 1: `sync-protocol.md` §4.4** — type `trip.created` and `trip.renamed` `{name: string｜null}`; extend §4.3's "settled at S4" note to name the two Trip rows and the slice that settled them; add the note that `phase = "draft"` is the reducer's write and not a payload field; add the `start`/`start_date` payload-versus-register note beside the existing `count`/`owned_count` one.
- [ ] **Step 2: `architecture-design.md`** — write **§12.11, consequences of S6**, in the voice of §12.10: what it settled, what it deliberately left, and the two or three things a future reader must know before touching Trips. Mark §8.3's S6 entry landed with a link to the spec.
- [ ] **Step 3: `design/README.md`** — append the four departures to **§5** (the CTA rule, the next-step line, the third route) and **§5a** (the reopen confirm's S6 body), following the §3b/§3c precedent.
- [ ] **Step 4: `docs/testing.md`** — the backward-compatibility group's fixture list gains `s4-ownership` and `s6-trips`.
- [ ] **Step 5: `CLAUDE.md`** — status: S6 landed; the things worth knowing before touching Trips or phases (the absent phase reading `draft`; `isActive` as the single definition; `DAY N` from the register stamp; the CTA-names-the-destination rule).

---

## Task 14: Full verification

- [ ] **Step 1:** `npm run typecheck` — clean across all workspaces.
- [ ] **Step 2:** `npm test` — green. Re-run `api/test/server/sync.test.ts` alone if it fails; that is the known flake.
- [ ] **Step 3:** `npm run lint` and `npm run format:check` (or whatever Tier 0 runs in this repo's pre-commit hook) — clean.
- [ ] **Step 4:** `git rebase main` (S5 will have landed), re-run Tier 0 and the full suite, and fix any conflict in `shared/src/index.ts`, `app/src/App.tsx` or `app/src/screens/People.tsx` by hand — never by taking one side wholesale.
