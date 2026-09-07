# S11 — Reopen: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> to implement this plan task by task. Steps use `- [ ]` for tracking.

**Goal:** Make a re-close subtract nothing twice, and hand the reopen route back.

**Architecture:** One new op type, `trip.consumption_posted`, folding to an
absolute per-gear register on the Trip root. Every decision then reduces to one
number, `owed − posted`: positive is the close's reduction, zero is what makes a
re-close free, negative is the restoration offer. `reopenBlocked` is deleted and
`reopenTrip` back-fills a pre-S11 close so historical Trips reopen too.

**Tech Stack:** TypeScript, Vitest, React 19, Radix (`ui/`'s `Confirm`).

**Spec:** [`docs/specs/2026-09-07-reopen.md`](2026-09-07-reopen.md) — read it
before starting. This plan argues from it and does not repeat its reasoning.

## Global constraints

- **Relative imports in `shared/` carry an explicit `.ts` extension.** `app/`
  does not (Vite resolves).
- **Op payloads mirror the wire — `snake_case`, never transformed.** Folded
  state and props are camelCase.
- **A needless write is never free** (`patterns.md` §2.3): a redundant op moves
  the stamp LWW compares and can silently beat a peer's genuine write.
- **Reader gates, never reducer gates.** The reducer folds
  `trip.consumption_posted` unconditionally; `postedOf` and its callers decide.
- **Every function gets a docblock carrying the *why*.** This codebase's
  docblocks are the record; a task that ships behaviour with no reasoning is
  incomplete. Cite spec sections and ruling ids (G1, G6, G7, R28, R36) by name.
- Run `npm run typecheck && npm run lint` before every commit (the pre-commit
  hook runs them anyway; failing fast is cheaper).
- Commit messages end with:
  `Claude-Session: https://claude.ai/code/session_012Trw9SWY3g3qJ3EHXZ2gyY`

---

## File map

| File | Responsibility |
| --- | --- |
| `shared/src/state.ts` | `TripState.postings?: Readonly<Record<string, Register<number>>>` |
| `shared/src/authoring.ts` | `tripConsumptionPosted(tripId, gearId, units)` |
| `shared/src/reduce.ts` | the `trip.consumption_posted` handler, in `handlers` |
| `shared/src/selectors/unpack.ts` | `postedOf`, `owedOf`, `standingLostOf` |
| `shared/src/gestures.ts` | `closeTrip` grows; `reopenTrip` back-fills; `restoreConsumption` is new; `reopenBlocked` deleted |
| `shared/src/index.ts` | export the new names, drop `reopenBlocked` |
| `shared/fixtures/s11-reopen.ops.json` + `shared/src/fixtures.s11.test.ts` | the format frozen in this commit |
| `app/src/components/RestoreConsumptionConfirm.tsx` (+ `.module.css`, `.test.tsx`) | the offer |
| `app/src/components/OutcomeSheet.tsx` | raises the offer |
| `app/src/components/ReopenConfirm.tsx` | the `STILL UNACCOUNTED` block; unreachable-comment removed |
| `app/src/components/PhaseSheet.tsx`, `app/src/screens/Trips.tsx`, `app/src/screens/Unpack.tsx` | the gate's three strings retire |
| `docs/` | §9 of the spec, one task |

---

## Task 1 — the op: register, payload builder, reducer, fixture

**Files:**
- Modify: `shared/src/state.ts` (`TripState`), `shared/src/authoring.ts`,
  `shared/src/reduce.ts`, `shared/src/index.ts`
- Create: `shared/fixtures/s11-reopen.ops.json`,
  `shared/src/fixtures.s11.test.ts`
- Test: `shared/src/reduce.outcomes.test.ts` (append a `describe`),
  `shared/src/authoring.test.ts`

**Produces:**
```ts
// state.ts, on TripState, beside `participants`
postings?: Readonly<Record<string, Register<number>>>
// authoring.ts
function tripConsumptionPosted(tripId: string, gearId: string, units: number): OpSpec
//   → { aggregate: 'trip', aggregate_id: tripId,
//       type: 'trip.consumption_posted', payload: { gear_id, units } }
```

- [ ] **Step 1: failing reducer tests.** Append to
  `shared/src/reduce.outcomes.test.ts`. Model them on the existing
  `trip.consumed_count_set` describe in that file for op-envelope construction.
  Four cases, all of which must hold *unconditionally* — this is the reader-gate
  rule:
  - folds when `state.gear[gear_id]` has never arrived;
  - folds on a Trip in `closed`, and on one in `draft`;
  - folds on a Gear whose Kind is `single` (not Counted);
  - two `trip.consumption_posted` for the **same** gear resolve by LWW (later
    HLC wins), and for **different** gear both survive — the `participants`
    property one level up.

- [ ] **Step 2: run them, confirm they fail.** `npm test -w @foerier/shared -- reduce.outcomes`
  Expected: the ops are counted in `unfolded`, not folded.

- [ ] **Step 3: implement.** In `state.ts` add the field to `TripState` with a
  docblock: per-gear registers rather than one register holding a map, for
  sync §3.4's reason (two Devices posting different Gear both survive); `units`
  is **absolute**, `gear.owned_count_set`'s own contract one register over.
  In `authoring.ts` add the builder beside `tripConsumedCountSet`. In
  `reduce.ts` add the handler — `tripParticipantWritten`'s exact shape, but with
  `readCount(op.payload, 'units')` and `readString(op.payload, 'gear_id')`,
  both bailing on a non-`value` kind, and propagating identity when
  `writeRegister` returns the register it was given. Register it in `handlers`
  under an `// S11 (§4.4):` comment. Export the builder from `index.ts`.

- [ ] **Step 4: run.** Same command; expect PASS. Then `npm run typecheck`.

- [ ] **Step 5: the fixture.** Write `shared/fixtures/s11-reopen.ops.json`
  following `s10-unpack.ops.json`'s envelope shape exactly (`id`,
  `household_id`, `aggregate`, `aggregate_id`, `type`, `hlc`, `device_id`,
  `payload`, `seq`, `received_at`; ids `s11`-prefixed, HLCs `2026-09-07T…`).
  It carries **only** S11's op type plus the Gear, Trip and `trip.entry_added`
  ops that give it something to reference. Include three shapes:
  1. an ordinary posting, `{gear_id, units: 4}`;
  2. a posting explicitly restored to `{units: 0}` — §5.2 turns on the register
     being *present* at zero, so the fixture must prove `0` folds and is not
     conflated with absence;
  3. a **forward-compatibility probe**: a posting naming a `gear_id` no
     `gear.recorded` in the file ever creates, standing for a peer whose Gear
     op has not arrived. Folded, retained, read back.
  Then `shared/src/fixtures.s11.test.ts`, modelled on `fixtures.s10.test.ts`:
  a header explaining the same-commit rule and what each op above stands for,
  then `fold` the file and assert each register. Run
  `npm test -w @foerier/shared -- fixtures.s11`.

- [ ] **Step 6: commit.**
```
git add shared/src/state.ts shared/src/authoring.ts shared/src/reduce.ts shared/src/index.ts shared/src/reduce.outcomes.test.ts shared/src/authoring.test.ts shared/fixtures/s11-reopen.ops.json shared/src/fixtures.s11.test.ts
git commit
```
Message: `The posting is a register, so "applies once" can be recorded`.

---

## Task 2 — the selectors: `postedOf`, `owedOf`, `standingLostOf`

**Files:**
- Modify: `shared/src/selectors/unpack.ts`, `shared/src/index.ts`
- Test: `shared/src/selectors/unpack.test.ts`

**Consumes:** `TripState.postings` (Task 1).

**Produces:**
```ts
function postedOf(trip: TripState, gearId: string): number
function owedOf(trip: TripState, gearId: string, state: HouseholdState): number
interface StandingLost { readonly entryId: string; readonly personId: string | null
                         readonly gearName: string; readonly units: number }
function standingLostOf(trip: TripState, state: HouseholdState): readonly StandingLost[]
```

- [ ] **Step 1: failing tests** in `shared/src/selectors/unpack.test.ts`:
  - `postedOf` reads an **absent** register as `0`, and an explicit `0` as `0` —
    two different facts about the log, one answer (`ownerOf`'s rule);
  - `owedOf` is `consumedReductions(...).get(gearId) ?? 0`, so it is `0` for a
    container, a Single, a trip-only Entry and an unsynced Gear;
  - `standingLostOf` returns an Entry whose `lost` outcome still stands, and
    **omits** one settled by a later `gear.rehomed` (build the state so the
    residence stamp is later than the outcome stamp);
  - `standingLostOf` returns per-Piece standings with their `personId`, and an
    Entry-level one with `personId: null`;
  - a Trip with everything `back` returns `[]`.

- [ ] **Step 2: run, confirm failure.** `npm test -w @foerier/shared -- selectors/unpack`

- [ ] **Step 3: implement** in `unpack.ts`, each with a docblock:
  - `postedOf` — the absent-reads-`0` rule stated here and **only** here; name
    the symptom when a call site re-derives it (a Trip that owes nothing being
    reduced again).
  - `owedOf` — a thin read over `consumedReductions`, which is never
    re-derived; it exists so `closeTrip` and the offer name the same question.
  - `standingLostOf` — walk `entriesOf`, and for each `lost` outcome ask
    `outcomeStands` (the one definition, never re-derived). For a non-container
    per-person Entry walk `piecesOf` and ask `pieceOutcomeOf` + `outcomeStands`
    per Piece — ruling R10's family, the same order `unpackItems` checks it in
    (container before per-person). Units follow `pieceCountOf`/`bringCountOf`
    exactly as `unpackItems` does. State in the docblock why this is **not**
    `unaccountedOf`: that selector is keyed by Gear across the household and
    names the *latest* Trip holding a live `lost`, so on a Gear lost twice it
    would name someone else's Trip inside this Trip's own sheet.
  Export all three from `index.ts`.

- [ ] **Step 4: run.** Expect PASS. `npm run typecheck`.

- [ ] **Step 5: commit** — `Three reads: what was posted, what is owed, what still stands`.

---

## Task 3 — the gestures: close, reopen, restore; the gate deleted

**Files:**
- Modify: `shared/src/gestures.ts`, `shared/src/index.ts`
- Test: `shared/src/gestures.test.ts`

**Consumes:** Task 1's builder, Task 2's `postedOf` / `owedOf`.

**Produces:**
```ts
function restoreConsumption(trip: TripState, gearId: string,
                            owed: number, state: HouseholdState): readonly OpSpec[]
// reopenTrip keeps its (trip, to, state) signature; reopenBlocked is DELETED
```

- [ ] **Step 1: failing tests** in `shared/src/gestures.test.ts`. Delete the
  `reopenBlocked` describe outright — not `.skip` — and add:
  - **the four-tap path, end to end:** fold a Trip with a `consumed` Counted
    Entry (owned 6, consumed 4) → apply `closeTrip`'s ops → assert owned 4 and
    `postings[gear] === 4` → apply `reopenTrip(trip, 'unpack', state)` → apply
    `closeTrip` again → **assert owned is still 4 and no `gear.owned_count_set`
    was emitted by the second close.** This one assertion is the slice.
  - `closeTrip` called twice against the *same, unchanged* state is
    byte-identical (S10's assertion — it must survive).
  - the close emits `gear.owned_count_set` **before** its `trip.consumption_posted`
    for that gear, and `trip.phase_moved` last.
  - a negative delta (posted 4, owed 2) makes the close emit neither op for that
    gear.
  - a Trip listing one Gear on **two** Entries emits **one** posting summing both.
  - `reopenTrip` back-fills a gear with no posting register, **skips** one whose
    register is present at `0`, emits nothing on a Trip owing nothing, and puts
    `trip.phase_moved` last.
  - `restoreConsumption` computes its target from the count **now**: with
    posted 4, owed 0 and a hand-corrected owned of 5, it emits
    `gear.owned_count_set(9)` and `trip.consumption_posted(gear, 0)`, in that
    order.

- [ ] **Step 2: run, confirm failure.** `npm test -w @foerier/shared -- gestures`

- [ ] **Step 3: implement.** `closeTrip`'s two early returns are untouched;
  inside its loop, `delta = owed − postedOf(...)`, `continue` on `delta <= 0`,
  emit the reduction then the posting. `reopenTrip` loses its `reopenBlocked`
  call and gains the back-fill loop from spec §5.2 — the presence check reads
  `trip.postings?.[gearId] !== undefined`, deliberately **not** `postedOf(...) > 0`,
  because a posting restored to `0` is a close that *was* recorded. Add
  `restoreConsumption`. Delete `reopenBlocked` and its `index.ts` export.

  Docblocks carry the reasoning the spec argues: why the reduction precedes its
  posting (a posting without its reduction makes every later close skip one that
  never landed — R28's failure mode by another door); why the crash-mid-batch
  debt is **not** closed here (it needs atomicity, not a fact); why the
  back-fill is legitimate (G6 freezes a closed Trip's outcomes, so
  `consumedReductions` now is what that close applied) and what it cannot see
  (§5.3's pre-gate peer). `reopenTrip`'s *"decides whether, never where"*
  becomes *"where is the caller's"* — there is no whether left.

- [ ] **Step 4: run.** Expect PASS. Then the whole shared suite:
  `npm test -w @foerier/shared`. `app/` will not compile yet (three call sites
  still import `reopenBlocked`) — that is Task 5; do not fix it here.

- [ ] **Step 5: commit** — `owed minus posted, so a second close writes nothing`.

---

## Task 4 — convergence (Tier 2)

**Files:** Modify `shared/src/convergence.test.ts`

**Consumes:** Tasks 1–3.

- [ ] **Step 1: write the tests.** Follow the file's existing two-replica
  helpers. Three properties:
  - **two Devices close, reopen and re-close the same Trip and converge on one
    owned count**, asserted in **both** interleavings of the two op streams.
    This is why `units` is absolute and is the property the slice exists for.
  - **a reopened Trip's retained packing arrangement comes back into effect on
    every replica** — statuses, residences, stages and outcomes identical
    before the close and after the reopen, with no op having written them
    (§8.4: it returns for free because active-ness derives from `phase`).
  - a posting racing a hand `gear.owned_count_set`: different aggregates,
    neither can make the other disappear.

- [ ] **Step 2: run.** `npm test -w @foerier/shared -- convergence` — expect PASS
  immediately (Tasks 1–3 implement the behaviour; this tier proves it). If any
  fails, the defect is in Task 3, not here: fix it there.

- [ ] **Step 3: commit** — `Two devices, four taps, one owned count`.

---

## Task 5 — hand the route back

**Files:**
- Modify: `app/src/screens/Trips.tsx`, `app/src/components/PhaseSheet.tsx`,
  `app/src/screens/Unpack.tsx`, `app/src/components/ReopenConfirm.tsx`
- Test: the `.test.tsx` beside each

**Consumes:** Task 2's `standingLostOf`, Task 3's `reopenTrip`.

- [ ] **Step 1: failing tests.** In each screen's suite:
  - `Trips.test.tsx` — a closed Trip whose close lowered a count renders
    `REOPEN` and **no** `NO REOPEN — COUNTS LOWERED AT CLOSE`.
  - `PhaseSheet.test.tsx` — such a Trip draws **four** rows out of `closed`, and
    the footnote reads `ANY ROW TAPPABLE, BACKWARDS INCLUDED. NO DATE OR COUNT EVER MOVES A PHASE.`
  - `Unpack.test.tsx` — the closed hint reads
    `CLOSED · OUTCOMES ARE HISTORY. REOPEN TO CHANGE ONE.` on every closed Trip.
  - `ReopenConfirm.test.tsx` — a Trip with one standing `lost` Piece renders
    `1 STILL UNACCOUNTED — HEADLAMP, K · ▲ LOST`; a Trip with none renders no
    such block (G3: a zero segment draws nothing); the three conditional blocks
    appear in the order **unaccounted → reduction lines → over-claim**.
  - `ReopenConfirm.test.tsx` — G1's reduction line renders (it is reachable now,
    which no test could assert before).

- [ ] **Step 2: run, confirm failure.** `npm test -w @foerier/app -- Trips PhaseSheet Unpack ReopenConfirm`

- [ ] **Step 3: implement.** Delete every `reopenBlocked` import and branch, and
  the three constants/strings the spec §5.1 table names — including
  `CLOSE_HINT_CLOSED_NO_REOPEN` and its docblock, and `PhaseSheet`'s one-row
  branch and swapped footnote. In `ReopenConfirm`, add the `STILL UNACCOUNTED`
  block above the reduction lines inside the existing `children` slot, remove
  the comment declaring G1's line unreachable (keep the `×6`-is-a-reconstruction
  caveat and give it §5.2's sibling), and replace the S6-era docblock paragraph
  saying the block "needs S10 … architecture §8.3 gives S11" with what it now
  states and why `unaccountedOf` was not used.

- [ ] **Step 4: run.** Expect PASS, then `npm test -w @foerier/app`.

- [ ] **Step 5: commit** — `Retire the gate's three sentences; the route is back`.

---

## Task 6 — the restoration offer

**Files:**
- Create: `app/src/components/RestoreConsumptionConfirm.tsx`,
  `.module.css`, `.test.tsx`
- Modify: `app/src/components/OutcomeSheet.tsx` (+ its test)

**Consumes:** Task 2's `owedOf`/`postedOf`, Task 3's `restoreConsumption`.

**Produces:**
```ts
interface RestoreConsumptionConfirmProps {
  trip: TripState; gearId: string; owed: number
  onCancel: () => void; onConfirm: () => void
}
```

- [ ] **Step 1: failing tests.**
  - `RestoreConsumptionConfirm.test.tsx` — renders
    `Put ×4 back on Gas canister 450?`, the body
    `Alps 2026 lowered the owned count when it closed. It goes back to what it was before that close.`,
    and the mono fact `GAS CANISTER 450 ×2 → ×6`; the actions read
    `Put it back` and `Leave it`; it is a `Confirm` (the scrim does not dismiss
    it), Escape does.
  - `OutcomeSheet.test.tsx` — on a reopened Trip with posted 4:
    tapping `BACK` emits the `trip.outcome_set` **and** raises the offer;
    confirming emits `gear.owned_count_set` + `trip.consumption_posted`;
    **declining leaves the outcome change standing** and emits neither.
  - `OutcomeSheet.test.tsx` — lowering the Consumed-count from `×4` to `×2`
    raises the offer for `×2` (one predicate, both cases).
  - `OutcomeSheet.test.tsx` — on a Trip **never closed** (posted `0`) no tap
    raises the offer, and on a **closed** Trip the controls are already
    withheld, so none can.

- [ ] **Step 2: run, confirm failure.** `npm test -w @foerier/app -- OutcomeSheet RestoreConsumptionConfirm`

- [ ] **Step 3: implement.** Build `RestoreConsumptionConfirm` on `ui/`'s
  `Confirm` with `variant="sheet"`, modelled on `ReopenConfirm` (mounted **is**
  open — no `open` prop; `Confirm.Action` above `Confirm.Cancel` in the DOM;
  the primary stays accent, nothing was thrown away). In `OutcomeSheet`,
  `choose` and `handleConsumedChange` each emit their op, then compute the new
  `owed` and open the offer when `owed < postedOf(trip, gearId)`. Docblock: the
  trigger is one predicate covering both changes, it is self-limiting to
  reopened Trips because `posted` is `0` otherwise, the offer is a `Confirm`
  because of G15 (*the confirm is owed where the act cannot be seen on the
  screen that made it* — the owned count is not on F5), and declining is a
  decision that stands, which is G1's `COUNTS LOWERED AT CLOSE STAY LOWERED`
  as the default.

- [ ] **Step 4: run.** Expect PASS, then the full suite: `npm test`.

- [ ] **Step 5: commit** — `Changing away from consumed offers the count back, and waits`.

---

## Task 7 — the docs the slice owes

**Files:** `docs/sync-protocol.md`, `docs/domain-model.md`,
`docs/ubiquitous-language.md`, `docs/architecture-design.md`,
`docs/design/README.md`, `docs/technical-debt.md`, `docs/patterns.md`,
`docs/specs/2026-09-07-reopen.md`, `CLAUDE.md`

- [ ] **Step 1: write them.** Spec §9 is the checklist and each bullet there
  names its own edit; work it top to bottom. Four carry judgement rather than
  transcription:
  - **architecture §8.4** — correct the falsified sentence *in place* with the
    reason it was wrong (the plan never drew `close → reopen → close`), and do
    **not** delete it; §8.3's S11 entry reads **Ops: 1**, and its 38 becomes 39
    in both places it appears.
  - **`design/README.md` §5k** — new, listing every decision this code took
    that no board reached: the offer's trigger and its copy, the block's
    `STILL UNACCOUNTED` reading against the board's drawn `STILL OPEN` and why,
    the three blocks' order. Mark §5j discharged and point it here.
  - **`technical-debt.md`** — **delete** the reopen entry; **rewrite** the
    crash-mid-batch entry (the register now exists; what is missing is
    atomicity); **add** a smaller entry for §5.3's pre-gate residue.
  - **spec §11**, new — what moved during implementation, following
    `the-gear-list.md` §11's precedent: the dated spec is left as written and
    corrections live in their own section.
  Add the S11 paragraph to `CLAUDE.md`'s status section in the voice of the
  ones above it.

- [ ] **Step 2: verify.** `npm run format:check` (the docs are Prettier-checked)
  and grep the repo for `reopenBlocked` — zero hits outside git history.

- [ ] **Step 3: commit** — `Write down that the posting is a domain fact, not a patch`.

---

## Definition of done

- `npm test` green across all workspaces; `npm run typecheck && npm run lint` clean.
- `git grep reopenBlocked` returns nothing.
- The four-tap path is a passing assertion (Task 3) **and** a convergence
  property (Task 4).
- Every one of spec §9's seven documents is edited.

Then follow CLAUDE.md's merge convention: rebase onto `main`, **leave the
worktree**, `git merge --ff-only` in the main checkout, run the full suite
there, and only then push. This slice is well under a thousand lines, but its
seven commits each carry a distinct argument — keep the history rather than
squashing.
