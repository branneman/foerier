# S14 — Trip history and templates: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:executing-plans` (this slice is sequential — see *Execution*
> below). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ship story 14 and story 15's second criterion — a Trip can be
deleted behind a confirm, and a new Trip can be started from any existing one,
taking its gear list, Bring-counts, tasks and undiscarded notes.

**Architecture:** one new op type (`trip.deleted`), one widened builder
(`trip.created` gains `from_trip_id`), three new `shared/` readers
(`tripStandingOf`, `sourceTrips`, and the `startTripFrom` gesture), and two
screens changed (`Trip.tsx` gains a provenance line, a footer and two empty
states; `NewTrip.tsx` gains a `START FROM` row and a source picker). The
template copy emits **only ops that already exist**.

**Tech stack:** TypeScript, React 18 + wouter, Vitest + Testing Library,
fast-check (Tier 2), Radix via `ui/`.

**Spec:** [`docs/specs/2026-09-08-trip-history-and-templates.md`](2026-09-08-trip-history-and-templates.md)
**Design authority:** `docs/design/README.md` §5m (J1–J20).

## Global constraints

Copied verbatim from the repo's standing rules — every task inherits them.

- **Relative imports in `shared/` carry an explicit `.ts` extension.** `app/`
  imports carry none (Vite resolves).
- **Ops mirror the wire — `snake_case`, never transformed.** Folded state and
  UI props are camelCase.
- **`null` clears a nullable register; an absent field leaves it alone.** A
  register whose declared type excludes `null` must never be sent one; **omit
  the key** ([sync §1.3](../sync-protocol.md)).
- **Never author a needless write.** An op equal to the current value moves a
  stamp LWW compares on, and can silently beat a genuine concurrent write
  ([`patterns.md`](../patterns.md) §2.3).
- **Reader gates, not reducer gates.** Anything depending on another aggregate
  (Kind, containment) is decided on the way out, never in `reduce.ts`.
- **Prose is hand-wrapped at 80 columns.** Prettier does not format Markdown
  here (`.prettierignore`), and `docs/design/` is exempt entirely.
- **Commit messages end with**
  `Claude-Session: https://claude.ai/code/session_01VRtzQQKevExYeEqSAQqL4n`.
- **Run from the worktree.** `npm ci` has already been run here.

Useful commands:

```bash
npx vitest run --root shared shared/src/reduce.test.ts     # one shared suite
npx vitest run --root app  app/src/screens/Trip.test.tsx   # one app suite
npm run typecheck                                          # whole repo
```

## Execution

**Sequential, in this one worktree.** Every `app/` surface depends on the
`shared/` foundation in tasks 1–5, and the two app tasks that could run in
parallel (`Trip.tsx` vs `NewTrip.tsx`) are not worth a second worktree —
parallel agents in one worktree collide at the pre-commit hook, which
typechecks and lints the whole tree regardless of which files each touched.

**Keep the branch's history; do not squash.** This slice will run well past a
thousand lines, which is the point at which one commit stops being reviewable
(`CLAUDE.md`'s merge convention).

## File map

| File | Change | Task |
|---|---|---|
| `shared/src/authoring.ts` | `tripDeleted`; `tripCreated` gains `fromTripId?` | 1, 2 |
| `shared/src/reduce.ts` | one handler, `'trip.deleted'` | 1 |
| `shared/src/index.ts` | export the four new symbols | 1–5 |
| `shared/src/convergence.test.ts` | one branch on `arbTripRootSpec` | 1 |
| `shared/src/selectors/trip.ts` | `tripStandingOf`, `sourceTrips` | 3, 4 |
| `shared/src/gestures.ts` | `startTripFrom` | 5 |
| `shared/fixtures/s14-templates.ops.json` + `shared/src/fixtures.s14.test.ts` | new | 6 |
| `app/src/screens/Trip.tsx` + `.module.css` | standings, provenance, footer | 7, 8, 9 |
| `app/src/components/DeleteTripConfirm.tsx` + `.module.css` | new | 9 |
| `app/src/components/SourcePicker.tsx` + `.module.css` | new | 10 |
| `app/src/screens/NewTrip.tsx` + `.module.css` | `START FROM`, the copy | 10 |
| docs | six files, plus the spec's own §11 | 11 |

**Two of the spec's sections deliberately have no task.** §7's inert
per-person rows are ruling E9 already shipped — a per-person Entry with no
Pieces draws its line, no control and `PER-PERSON · NO PIECES` today, so the
template's first impression needs no code, and the disclosure it *does* need
is J10's second field line in task 10. §6.2's band retirement is docs-only:
the suggestion band was drawn at S7 and never built (no string in `app/` or
`ui/` ever matched it), so there is nothing to remove — see task 11 step 7.

---

## Task 1: `trip.deleted` — the op, the handler, the generator arm

**Files:**
- Modify: `shared/src/authoring.ts` (beside `tripPhaseMoved`)
- Modify: `shared/src/reduce.ts` (the `handlers` table, near `'trip.created'`)
- Modify: `shared/src/index.ts`
- Modify: `shared/src/convergence.test.ts` (`arbTripRootSpec`, ~line 500)
- Test: `shared/src/reduce.test.ts`

**Interfaces:**
- Produces: `tripDeleted(id: string): OpSpec`; the `deleted` register on
  `TripState` becomes writable.

**Why the generator arm is in this task and not a later one:** the Tier 2
completeness test reads `reduce.ts`'s handler table out of its own source and
asserts the generator emits every folded type. Adding the handler without the
arm turns Tier 2 red in the same commit — S13's inheritance, and the reason
*reducer now, property later* is not a schedule a slice may choose.

- [ ] **Step 1: Write the failing reducer tests**

In `shared/src/reduce.test.ts`, beside the existing Trip tests:

```ts
it('trip.deleted sets the tombstone', () => {
  const state = fold([
    op(tripCreated('t1', 'Alps 2026'), 'd1', 1),
    op(tripDeleted('t1'), 'd1', 2),
  ])
  expect(state.trips['t1']?.deleted?.value).toBe(true)
})

it('a re-delivered trip.deleted is idempotent', () => {
  const once = fold([
    op(tripCreated('t1', 'Alps 2026'), 'd1', 1),
    op(tripDeleted('t1'), 'd1', 2),
  ])
  const twice = fold([
    op(tripCreated('t1', 'Alps 2026'), 'd1', 1),
    op(tripDeleted('t1'), 'd1', 2),
    op(tripDeleted('t1'), 'd1', 2),
  ])
  expect(twice).toEqual(once)
})

it('a trip.deleted that precedes its trip.created still tombstones', () => {
  // `writeTrip` creates the entity for any Trip op, and the two registers are
  // independent — so arrival order cannot lose the tombstone. S6's
  // out-of-order `phase_moved`, one register over.
  const state = fold([
    op(tripDeleted('t1'), 'd1', 5),
    op(tripCreated('t1', 'Alps 2026'), 'd1', 1),
  ])
  expect(state.trips['t1']?.deleted?.value).toBe(true)
  expect(state.trips['t1']?.name?.value).toBe('Alps 2026')
})
```

Match the file's existing `fold` / `op` helpers exactly — read the top of
`reduce.test.ts` first and use whatever those helpers are actually called
there rather than the shapes sketched above.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run --root shared shared/src/reduce.test.ts`
Expected: FAIL — `tripDeleted` is not exported.

- [ ] **Step 3: Add the builder**

In `shared/src/authoring.ts`, after `tripPhaseMoved`:

```ts
/**
 * `sync-protocol.md` §4.4: sets the Trip's tombstone. The payload is empty —
 * there is nothing to say beyond the fact — and the confirmation is UI's
 * (invariant 15), never the reducer's.
 *
 * **There is no partner.** `gear.retired` / `gear.restored` are an ordinary
 * LWW pair over one register (§3.5); the catalogue defines one Trip tombstone
 * op and no restore, which is what J3's answer line states to a human:
 * `Permanent. No route puts a trip back.` The register stays a
 * `Register<boolean>` rather than a presence flag, so a later slice that
 * wants a restore adds an op type and writes `false` — but nothing in S14
 * anticipates that and no surface may hint at it.
 */
export function tripDeleted(id: string): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: id,
    type: 'trip.deleted',
    payload: {},
  }
}
```

- [ ] **Step 4: Add the handler**

In `shared/src/reduce.ts`, in the `handlers` table beside the other Trip
entries, with `gear.retired`'s shape:

```ts
  // The Trip's tombstone (§4.4) — `gear.retired`'s handler transplanted, and
  // deliberately unpaired: no `trip.restored` exists. `writeTrip` creates the
  // entity for this op like any other, so a `trip.deleted` arriving before
  // its `trip.created` still tombstones and the creation still lands its name.
  'trip.deleted': (state, op, stamp) =>
    writeTrip(state, op.aggregate_id, stamp, (trip, st) => {
      const next = writeRegister(trip.deleted, true, st)
      return next === trip.deleted ? trip : { ...trip, deleted: next }
    }),
```

- [ ] **Step 5: Export it**

Add `tripDeleted` to `shared/src/index.ts` beside the other `trip*` builders,
in the same alphabetical position the file already uses.

- [ ] **Step 6: Run the reducer tests**

Run: `npx vitest run --root shared shared/src/reduce.test.ts`
Expected: PASS.

- [ ] **Step 7: Watch Tier 2 go red, then add the arm**

Run: `npx vitest run --root shared shared/src/convergence.test.ts`
Expected: FAIL on *generates every op type the reducer folds* — `trip.deleted`
is folded and not generated. **This failure is the point of the step; see it
before fixing it.**

Then add a branch to `arbTripRootSpec` (`shared/src/convergence.test.ts`,
after the `tripConsumptionPosted` branch), with the comment that says why it
is a branch and not an arm:

```ts
  // S14's one op type. `trips.<id>.deleted` is a **root** register beside
  // `name`, `phase` and `fromTripId`, so this joins the root arm as a tenth
  // branch for `trip.consumption_posted`'s and `trip.task_added`'s own
  // reason: `tripRegisterPaths` counts every path not under `entries` as a
  // root register, so a contested `deleted` lands in the column this arm
  // already feeds. A fourth arm would hand one op type a quarter of the trip
  // budget and cut entry and piece from a third each — the dilution S13
  // measured and this file's tables warn about twice.
  arbTripId.map((id) => tripDeleted(id)),
```

- [ ] **Step 8: Run the whole shared suite**

Run: `npx vitest run --root shared`
Expected: PASS, and the contest floors still met. **If any `CONTEST_FLOOR`
assertion fails, stop and report it rather than adjusting the floor** — a
tenth root branch dilutes the root arm's other nine slightly, and whether that
matters is a measured question this plan must not pre-answer.

- [ ] **Step 9: Commit**

```bash
git add shared/src/authoring.ts shared/src/reduce.ts shared/src/index.ts \
        shared/src/reduce.test.ts shared/src/convergence.test.ts
git commit
```

Message: what the op is, that it is unpaired and why, and that the generator
arm lands in the same commit as the handler because the completeness guard
requires it.

---

## Task 2: `trip.created` gains `from_trip_id`

**Files:**
- Modify: `shared/src/authoring.ts` (`tripCreated`, ~line 325)
- Test: `shared/src/authoring.test.ts`

**Interfaces:**
- Produces: `tripCreated(id: string, name: string, fromTripId?: string): OpSpec`

`reduce.ts` already folds the field into `TripState.fromTripId` (S6) — **do
not touch the reducer.**

- [ ] **Step 1: Write the failing tests**

```ts
it('tripCreated omits from_trip_id when it is not given', () => {
  expect(tripCreated('t1', 'Alps 2026').payload).toEqual({ name: 'Alps 2026' })
})

it('tripCreated carries from_trip_id when it is given', () => {
  expect(tripCreated('t2', 'Alps 2027', 't1').payload).toEqual({
    name: 'Alps 2027',
    from_trip_id: 't1',
  })
})
```

The first is the important one: an **absent key**, never `from_trip_id: null`.
`TripState.fromTripId` is `Register<string>` and not nullable, so a `null`
would author an instruction no reader in this codebase honours.

- [ ] **Step 2: Run and watch the second fail**

Run: `npx vitest run --root shared shared/src/authoring.test.ts`
Expected: FAIL — `tripCreated` takes two parameters.

- [ ] **Step 3: Widen the builder**

```ts
export function tripCreated(
  id: string,
  name: string,
  fromTripId?: string,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: id,
    type: 'trip.created',
    payload: {
      name,
      ...(fromTripId !== undefined && { from_trip_id: fromTripId }),
    },
  }
}
```

Then **rewrite the docblock's third paragraph**, which currently says
`from_trip_id` has no parameter *deliberately, because nothing before S14
copies a Trip*. It has one now; say that S14 is the caller, that the key is
omitted rather than nulled, and keep the sentence about the reducer having
folded it since S6.

- [ ] **Step 4: Run**

Run: `npx vitest run --root shared shared/src/authoring.test.ts`
Expected: PASS. The optional third parameter breaks no existing caller.

- [ ] **Step 5: Commit**

```bash
git add shared/src/authoring.ts shared/src/authoring.test.ts
git commit
```

---

## Task 3: `tripStandingOf` — the three standings

**Files:**
- Modify: `shared/src/selectors/trip.ts` (beside `visibleTrips`)
- Modify: `shared/src/index.ts`
- Test: `shared/src/selectors/trip.test.ts`

**Interfaces:**
- Produces:
  `tripStandingOf(state: HouseholdState, id: string): 'live' | 'deleted' | 'unknown'`

**Why a selector and not a screen-side check:** `visibleTrips` already spells
`deleted?.value !== true`, and a second spelling at a screen is how the
`ownerOf` rule nearly drifted twice. `Trip.tsx` today guards only on
`undefined`, so **it would render a deleted Trip in full** — this function is
that defect's fix as well as J5's foundation.

- [ ] **Step 1: Write the failing tests**

```ts
describe('tripStandingOf', () => {
  it('reads a folded, untombstoned Trip as live', () => {
    const state = fold([op(tripCreated('t1', 'Alps 2026'), 'd1', 1)])
    expect(tripStandingOf(state, 't1')).toBe('live')
  })

  it('reads a tombstoned Trip as deleted, not as unknown', () => {
    // The distinction this function exists for: the entity is still *there*.
    const state = fold([
      op(tripCreated('t1', 'Alps 2026'), 'd1', 1),
      op(tripDeleted('t1'), 'd1', 2),
    ])
    expect(state.trips['t1']).toBeDefined()
    expect(tripStandingOf(state, 't1')).toBe('deleted')
  })

  it('reads an id the fold has never seen as unknown', () => {
    expect(tripStandingOf(fold([]), 't1')).toBe('unknown')
  })

  it('agrees with visibleTrips on every Trip', () => {
    const state = fold([
      op(tripCreated('t1', 'Alps'), 'd1', 1),
      op(tripCreated('t2', 'Tessin'), 'd1', 2),
      op(tripDeleted('t2'), 'd1', 3),
    ])
    const visible = visibleTrips(state).map((trip) => trip.id)
    expect(visible).toEqual(['t1'])
    expect(tripStandingOf(state, 't2')).not.toBe('live')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run --root shared shared/src/selectors/trip.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```ts
/** What a Trip id means to this fold — {@link visibleTrips}' predicate, asked
 * about one id, with the two ways of *not* being visible told apart.
 *
 * `Trip.tsx` needs all three because J5 draws two different sentences: a
 * tombstone is a fact this Device holds (`It was deleted on this or another
 * device.`), an unfolded id is an absence that may still arrive
 * (`It may not have synced here yet. This clears itself.`).
 *
 * The tombstone test is spelled **here and in {@link visibleTrips} only**. A
 * screen that re-derived it would drift, and the symptom is the worst kind:
 * a deleted Trip rendering in full on one surface while every list agrees it
 * is gone.
 */
export function tripStandingOf(
  state: HouseholdState,
  id: string,
): 'live' | 'deleted' | 'unknown' {
  const trip = state.trips[id]
  if (trip === undefined) return 'unknown'
  return trip.deleted?.value === true ? 'deleted' : 'live'
}
```

Export from `shared/src/index.ts`.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit**

---

## Task 4: `sourceTrips` — newest-created first, by UUIDv7 id

**Files:**
- Modify: `shared/src/selectors/trip.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/selectors/trip.test.ts`

**Interfaces:**
- Produces: `sourceTrips(state: HouseholdState): readonly TripState[]`

**Read spec §4 before writing this.** J8 asks for *`trip.created`'s clock,
newest first*, and no register's stamp is that clock — `trip.created` seeds
`name` and `phase`, and a rename or a phase move each move one of them. The
corrected reading is the Trip's own **UUIDv7** id, whose canonical hex string
is lexicographically ordered by its embedded millisecond timestamp.

- [ ] **Step 1: Write the failing tests**

The third test is the one this whole task exists for.

```ts
describe('sourceTrips', () => {
  // v7 ids: the first 48 bits are a big-endian ms timestamp, so these three
  // are in creation order and sort that way as plain strings.
  const older = '01920000-0000-7000-8000-000000000001'
  const newer = '01930000-0000-7000-8000-000000000002'
  const newest = '01940000-0000-7000-8000-000000000003'

  it('orders newest-created first', () => {
    const state = fold([
      op(tripCreated(older, 'Vosges 2024'), 'd1', 1),
      op(tripCreated(newest, 'Alps 2026'), 'd1', 2),
      op(tripCreated(newer, 'Tessin 2025'), 'd1', 3),
    ])
    expect(sourceTrips(state).map((t) => t.id)).toEqual([newest, newer, older])
  })

  it('offers closed, active and draft Trips alike', () => {
    const state = fold([
      op(tripCreated(older, 'Vosges 2024'), 'd1', 1),
      op(tripPhaseMoved(older, 'closed'), 'd1', 2),
      op(tripCreated(newer, 'Alps 2026'), 'd1', 3),
      op(tripPhaseMoved(newer, 'pack_out'), 'd1', 4),
      op(tripCreated(newest, 'Draft'), 'd1', 5),
    ])
    expect(sourceTrips(state)).toHaveLength(3)
  })

  it('does not re-order when a Trip is renamed or its phase moves', () => {
    // The assertion §4 exists for: it fails against every ordering that reads
    // the `name` or `phase` register's stamp, because both of those move.
    const ops = [
      op(tripCreated(older, 'Vosges 2024'), 'd1', 1),
      op(tripCreated(newest, 'Alps 2026'), 'd1', 2),
    ]
    const before = sourceTrips(fold(ops)).map((t) => t.id)
    const after = sourceTrips(
      fold([
        ...ops,
        op(tripRenamed(older, 'Vosges 2024 — redux'), 'd1', 9),
        op(tripPhaseMoved(older, 'closed'), 'd1', 10),
      ]),
    ).map((t) => t.id)
    expect(after).toEqual(before)
  })

  it('omits a deleted Trip', () => {
    const state = fold([
      op(tripCreated(older, 'Vosges 2024'), 'd1', 1),
      op(tripDeleted(older), 'd1', 2),
    ])
    expect(sourceTrips(state)).toEqual([])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Implement**

```ts
/**
 * Every Trip that may be a template — the source picker's list, newest
 * created first.
 *
 * ## The order is the id, and that is a correction to ruling J8's wording
 *
 * J8 asks for *`trip.created`'s clock, newest first*, and the fold has no
 * such stamp: `trip.created` seeds `name` and `phase`, and **both move
 * afterwards** — `name` on a `trip.renamed`, `phase` on every
 * `trip.phase_moved`. Ordering by either would re-shuffle this list whenever
 * somebody renamed a Trip, which is a live symptom rather than a theoretical
 * one. This is I24's shape one slice later: where a board's words imply a
 * mechanism the fold cannot provide, the slice owes the corrected reading.
 *
 * Entity ids come from `systemIdSource`, which is UUID **v7** — a 48-bit
 * big-endian millisecond timestamp in the most significant bits, preserved
 * lexicographically by the canonical hex string. So descending id is
 * newest-created first: total, replica-identical, and free of any register
 * read. It is also *more* faithful to J8 than a stamp would be, because the
 * id is minted in the same tick as `trip.created` on the authoring Device,
 * while an HLC may already have been advanced by a peer's clock (§2.5's
 * `max`). And it has no missing case — `writeTrip` creates the entity for
 * any Trip op, so a Trip that exists only because a `trip.renamed` overtook
 * its creation still has a v7 id and still sorts.
 *
 * **Clock skew does not matter; agreement does.** Two Devices with skewed
 * wall clocks mint ids whose order is not true creation order, but it is the
 * *same* order on every replica, which is all a replicated list needs — the
 * same bargain `notesOf` takes with HLC stamps.
 *
 * **A foreign id still sorts.** An id from another build or a hand-shaped
 * fixture orders arbitrarily but deterministically, and no reader breaks.
 *
 * The rejected alternative is the minimum stamp across the Trip's registers:
 * sound, but a scan per Trip, and a proxy for the id's own timestamp rather
 * than the thing itself.
 *
 * Every visible Trip is offered — closed, active and Draft alike (J8, on
 * S7's `TRIP`-dimension precedent, and because copying only *reads* the
 * source). Story 14's *a past one* is read as the motivating case; the round
 * flagged the wording to requirements rather than resolving it silently.
 */
export function sourceTrips(state: HouseholdState): readonly TripState[] {
  return [...visibleTrips(state)].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}
```

Note `visibleTrips` returns a `readonly` array — copy before sorting. Export
from `shared/src/index.ts`.

- [ ] **Step 4: Run** — Expected: PASS, all four.

- [ ] **Step 5: Commit**

---

## Task 5: `startTripFrom` — the template copy

**Files:**
- Modify: `shared/src/gestures.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/gestures.test.ts`

**Interfaces:**
- Consumes: `tripCreated` (task 2), `entriesOf`, `bringCountOf`, `tasksOf`,
  `notesOf`, `IdSource`
- Produces:

```ts
export function startTripFrom(
  newTripId: string,
  name: string,
  source: TripState,
  state: HouseholdState,
  ids: IdSource,
): readonly OpSpec[]
```

**Read spec §3 in full before writing this.** The four rules that are easy to
get wrong: the Bring-count comes from the **register** and not from
`bringCountOf`'s read (§3.4); tasks are unticked **by absence** and never by
`ticked: false`; a Note carries no `kept`; a Note whose subject is not in the
batch drops its `entry_id` key entirely rather than sending `null`.

- [ ] **Step 1: Write the failing tests**

Build a source Trip with: two depot Entries (one Counted with an authored
Bring-count, one Counted **without** one), one trip-only Entry, one removed
Entry, two tasks (one ticked), and three notes (kept + about a surviving
Entry; unreviewed + about the removed Entry; discarded).

```ts
it('copies entries, tasks and undiscarded notes, and nothing else', () => {
  const specs = startTripFrom('new', 'Vosges 2026', source, state, ids)
  const types = specs.map((s) => s.type)

  expect(types[0]).toBe('trip.created')
  expect(specs[0]!.payload['from_trip_id']).toBe(source.id)
  expect(specs[0]!.payload['name']).toBe('Vosges 2026')

  // Three visible Entries; the removed one is not copied.
  expect(types.filter((t) => t === 'trip.entry_added')).toHaveLength(3)
  // Two of the three notes; the discarded one is not copied.
  expect(types.filter((t) => t === 'trip.note_posted')).toHaveLength(2)
  expect(types.filter((t) => t === 'trip.task_added')).toHaveLength(2)

  // Every op is addressed to the new Trip, not the source.
  expect(specs.every((s) => s.aggregate_id === 'new')).toBe(true)
})

it('starts everything else fresh by writing nothing', () => {
  const types = new Set(
    startTripFrom('new', 'V', source, state, ids).map((s) => s.type),
  )
  for (const absent of [
    'trip.dates_set',
    'trip.participant_added',
    'trip.entry_status_set',
    'trip.piece_status_set',
    'trip.entry_moved',
    'trip.piece_moved',
    'trip.container_stage_set',
    'trip.piece_removed',
    'trip.outcome_set',
    'trip.consumed_count_set',
    'trip.consumption_posted',
    'trip.task_ticked',
    'trip.note_kept',
  ]) {
    expect(types.has(absent)).toBe(false)
  }
})

it('copies a Bring-count only where the source authored the register', () => {
  const counts = startTripFrom('new', 'V', source, state, ids).filter(
    (s) => s.type === 'trip.entry_bring_count_set',
  )
  // The Counted Entry with no register reads `1` through `bringCountOf` and
  // must produce no op: authoring it would be a needless write, several
  // hundred at a time in the app's largest batch.
  expect(counts).toHaveLength(1)
  expect(counts[0]!.payload['count']).toBe(4)
})

it('re-points a copied note at the copied Entry', () => {
  const specs = startTripFrom('new', 'V', source, state, ids)
  const added = specs.filter((s) => s.type === 'trip.entry_added')
  const notes = specs.filter((s) => s.type === 'trip.note_posted')

  const about = notes.find((n) => n.payload['entry_id'] !== undefined)!
  const newIds = new Set(added.map((a) => a.payload['entry_id']))
  expect(newIds.has(about.payload['entry_id'])).toBe(true)
  // And it is *not* the source's own id.
  expect(about.payload['entry_id']).not.toBe(sourceEntryId)
})

it('drops the subject when the note is about an Entry the batch has not got', () => {
  const notes = startTripFrom('new', 'V', source, state, ids).filter(
    (s) => s.type === 'trip.note_posted',
  )
  const orphan = notes.find((n) => n.payload['text'] === ORPHAN_TEXT)!
  // The key is absent, not `null`: `NoteState.entryId` is not nullable, so a
  // `null` would author a clear no reader honours.
  expect('entry_id' in orphan.payload).toBe(false)
})

it('mints a fresh id per Entry and never reuses the source ids', () => {
  const added = startTripFrom('new', 'V', source, state, ids)
    .filter((s) => s.type === 'trip.entry_added')
    .map((s) => s.payload['entry_id'])
  expect(new Set(added).size).toBe(added.length)
  expect(added).not.toContain(sourceEntryId)
})

it('copies a trip-only Entry as a new Entry with its own name and trait', () => {
  const tripOnly = startTripFrom('new', 'V', source, state, ids)
    .filter((s) => s.type === 'trip.entry_added')
    .map((s) => s.payload['source'] as { from: string; name?: string })
    .find((s) => s.from === 'trip_only')
  expect(tripOnly?.name).toBe('Passports')
})

it('folds to a Trip whose list matches the source and whose packing is empty', () => {
  // The end-to-end shape: apply the batch and read the copy back.
  const after = fold([...sourceOps, ...authored(startTripFrom(...))])
  const copy = after.trips['new']!
  expect(entriesOf(copy, after).map((e) => entryLabel(e, after))).toEqual(
    entriesOf(source, state).map((e) => entryLabel(e, state)),
  )
  expect(copy.startDate).toBeUndefined()
  expect(participantIds(copy)).toEqual([])
  expect(notesOf(copy).every((n) => n.kept === undefined)).toBe(true)
  expect(tasksOf(copy).every((t) => !t.ticked)).toBe(true)
})
```

Use the file's existing helpers for building a fold and an `IdSource` stub —
read the top of `gestures.test.ts` first. A deterministic stub id source
(`let n = 0; { next: () => \`e${++n}\` }`) makes the assertions readable.

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Implement**

```ts
/**
 * **Starting a Trip from a past one** — `sync-protocol.md` §4.5's fourth
 * gesture, and S14's whole feature.
 *
 * It crosses no aggregate boundary, which is not what puts it in this file:
 * `authoring.ts` is a shelf of pure payload constructors that read no fold,
 * and this is several of those composed with a **read** of the fold, deciding
 * which ops one user action emits and in what order. `reopenTrip` is here on
 * the same ground.
 *
 * ## What it writes, and what it pointedly does not
 *
 * `trip.created{name, from_trip_id}`, then a `trip.entry_added` per visible
 * Entry with a **fresh** id, its Bring-count where the source authored one, a
 * `trip.task_added` per Task, and a `trip.note_posted` per undiscarded Note.
 *
 * Packing statuses, journeys, outcomes, consumed-counts, postings, dates and
 * Participants are **not written at all** — *start fresh* is the absence of
 * an op rather than a value, which is what makes this feature free in the
 * reducer. Participants are absent from story 14's enumeration and from
 * §4.5's batch; the consequence (every per-person Entry lands inert) is drawn
 * and disclosed at the create screen (J10, J17).
 *
 * ## The readers are the gates
 *
 * `entriesOf`, `tasksOf` and `notesOf` — never `Object.values(...)`. Each
 * already excludes what its map must not draw (a sourceless Entry, a
 * tombstoned one, a Task or Note with no text), so the copy inherits four
 * gates instead of restating them. A restated gate is what ruling G3 caught
 * three times in one round.
 *
 * ## The order is chosen for what a partial batch leaves behind
 *
 * `emit` appends one op at a time (`store.ts`), so this is N durable appends
 * and **not atomic** — true of all §4.5's gestures. `trip.created` goes
 * first, so a Device dying part-way leaves a **named Trip with a prefix of
 * its list**: visible, recoverable, and something S14 itself gives a route
 * out of, since `DELETE TRIP` now exists. The reverse would leave an unnamed
 * Trip nobody recognises.
 *
 * Nothing chunks and nothing caps: §6.1's 500-op limit is the outbox's
 * business, and every op merges independently, so a copy split across two
 * pushes is not a state anyone can observe.
 *
 * ## It cannot over-claim
 *
 * The new Trip is created in `draft` and `claim.ts` reads active Trips only
 * (invariant 17), so a fifty-entry copy creates exactly zero claims. There is
 * nothing to guard, preview or confirm here — and the *next* moment already
 * is guarded, by `PhaseSheet`'s existing `overClaimsIfActive` preview.
 */
export function startTripFrom(
  newTripId: string,
  name: string,
  source: TripState,
  state: HouseholdState,
  ids: IdSource,
): readonly OpSpec[] {
  const specs: OpSpec[] = [tripCreated(newTripId, name, source.id)]

  // Old entry id → new entry id, built while emitting and read once, by the
  // note loop below. Nothing else surfaces it.
  const entryIds = new Map<string, string>()

  for (const entry of entriesOf(source, state)) {
    const newEntryId = ids.next()
    entryIds.set(entry.id, newEntryId)

    const entrySource = entry.source?.value
    // `entriesOf` has already excluded a sourceless Entry, so this is
    // narrowing for the compiler rather than a second gate.
    if (entrySource === undefined) continue
    specs.push(tripEntryAdded(newTripId, newEntryId, entrySource))

    // **The register, not `bringCountOf`.** That reader answers `?? 1` for a
    // Counted Entry whose count nobody set, so copying through it would
    // author `count: 1` for every such Entry — a needless write
    // (`patterns.md` §2.3), several hundred at a time. The second half of the
    // condition is invariant 6's authoring gate, which the reducer does not
    // enforce and every caller must: an Entry whose Gear has stopped being
    // Counted shows no Bring-count on the source list either.
    const authored = entry.bringCount?.value
    if (authored !== undefined && bringCountOf(entry, state) !== null) {
      specs.push(tripEntryBringCountSet(newTripId, newEntryId, authored))
    }
  }

  // Unticked **by absence** — `trip.task_ticked{ticked: false}` is never
  // authored here, exactly as `tripTaskAdded`'s own docblock requires.
  for (const task of tasksOf(source)) {
    specs.push(tripTaskAdded(newTripId, ids.next(), task.text))
  }

  // A Note **not discarded** is copied — kept and unreviewed both (I13, I16).
  for (const note of notesOf(source)) {
    if (note.kept === false) continue
    // No `kept` is written: the verdict belongs to the source Trip's own
    // unpack pass, so the copy arrives unreviewed (I13's third arm). The
    // subject is re-pointed through the batch's own map; a Note about an
    // Entry the batch has not got — removed from the source after the note
    // was posted — is posted about the **Trip**, with the key omitted rather
    // than nulled, because `NoteState.entryId` is not nullable.
    const subject =
      note.entryId === undefined ? undefined : entryIds.get(note.entryId)
    specs.push(tripNotePosted(newTripId, ids.next(), note.text, subject))
  }

  return specs
}
```

`tripNotePosted`'s fourth parameter is already `entryId?: string` and already
omits the key when it is `undefined`, so passing `undefined` is correct and
needs no branch here.

- [ ] **Step 4: Run** — Expected: PASS, all eight.

- [ ] **Step 5: Update the module header**

`gestures.ts`'s header says *"three gestures"* and then names `reopenTrip` and
`restoreConsumption` as a third and fourth. Add one sentence: `startTripFrom`
is §4.5's fourth **named** gesture and this file's fifth function, and it is
here for the composition criterion rather than the aggregate count.

- [ ] **Step 6: Run the whole shared suite, then commit**

Run: `npx vitest run --root shared`

---

## Task 6: the backward-compatibility fixture

**Files:**
- Create: `shared/fixtures/s14-templates.ops.json`
- Create: `shared/src/fixtures.s14.test.ts`

Read `shared/src/fixtures.s13.test.ts` and `shared/fixtures/s13-tasks.ops.json`
first and follow their shape exactly, including the snapshot idiom.

**Capture it in this slice.** [Sync §5.4](../sync-protocol.md) is explicit,
and S4 is the counter-example: its spec said the standing rule applied, no
file landed, and two op types went a slice unpinned.

- [ ] **Step 1: Write the fixture JSON**

Hand-written, byte for byte (`shared/fixtures/` is Prettier-exempt for exactly
this reason). It must contain:

- a `trip.created` **with** `from_trip_id`;
- a full template batch — creation, three `trip.entry_added` (two depot, one
  trip-only), one `trip.entry_bring_count_set`, two `trip.task_added`, two
  `trip.note_posted` (one with a re-pointed `entry_id`, one without);
- a `trip.deleted`;
- **probe 1** — a `trip.deleted` carrying a payload field,
  `{"reason": "duplicate"}`, which obligation 2 ignores for the fold and
  retains verbatim;
- **probe 2** — a `trip.created{from_trip_id}` naming a Trip **not in the
  log**, which is J19's withdrawal case as it actually arrives.

- [ ] **Step 2: Write the test with its header**

The header must document both probes the way `fixtures.s3.test.ts` documents
its foreign tags, so nobody reads them as evidence an old build emitted them.
It must also say that the `from_trip_id` op here and S6's hand-shaped probe
are **the same wire shape from two different eras** — S6 could not author one
and S14 can.

Assert the fold: the tombstone lands, the copy's registers are what the batch
wrote, the probe-1 op folds its tombstone and ignores its extra field, and
`tripStandingOf` reads probe 2's `from_trip_id` target as `'unknown'`.

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run --root shared shared/src/fixtures.s14.test.ts`

---

## Task 7: `Trip.tsx` — the two non-live standings (J5)

**Files:**
- Modify: `app/src/screens/Trip.tsx` (the guard at ~line 325)
- Modify: `app/src/screens/Trip.module.css`
- Test: `app/src/screens/Trip.test.tsx`

Today's guard is `if (tripId === undefined || trip === undefined)` drawing
`No such trip.` — so **a deleted Trip currently renders in full.**

- [ ] **Step 1: Write the failing tests**

```tsx
it('draws the deleted state for a tombstoned Trip', () => {
  renderTripScreen({ ops: [tripCreated('t1', 'Alps'), tripDeleted('t1')] })
  expect(screen.getByText('TRIP DELETED')).toBeInTheDocument()
  expect(
    screen.getByText(
      'It was deleted on this or another device. The depot is untouched.',
    ),
  ).toBeInTheDocument()
  // No Trip to carry them.
  expect(screen.queryByTestId('gear-list')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
})

it('draws the not-here state for an id the fold has never seen', () => {
  renderTripScreen({ ops: [] })
  expect(screen.getByText('TRIP NOT ON THIS DEVICE')).toBeInTheDocument()
  expect(
    screen.getByText('It may not have synced here yet. This clears itself.'),
  ).toBeInTheDocument()
})

it('offers Open trips as a route out of both states', () => {
  renderTripScreen({ ops: [tripCreated('t1', 'Alps'), tripDeleted('t1')] })
  expect(screen.getByRole('link', { name: 'Open trips' })).toHaveAttribute(
    'href',
    '/trips',
  )
})

it('neither state carries an attention glyph', () => {
  // §5b F: a sync race is not an error. No ▲, no amber.
  renderTripScreen({ ops: [] })
  expect(screen.queryByText('▲')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

Replace the single guard with a `tripStandingOf` switch. Both non-live states
share one component — a mono head, one sentence, a bordered 48
`Open trips` — and draw **no title, no phase chip, no panels, no footer**. The
screen band above them is unchanged, so the back link still follows
`useScreenHeader`'s existing rule and is absent at Desktop, which is what
makes `Open trips` the only route out there.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit**

---

## Task 8: `Trip.tsx` — the provenance line (J18, J19, J20)

**Files:**
- Modify: `app/src/screens/Trip.tsx` (header block, beneath the dates at ~475)
- Modify: `app/src/screens/Trip.module.css`
- Test: `app/src/screens/Trip.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('names the source beneath the dates', () => {
  renderTripScreen({
    ops: [tripCreated('t0', 'Vosges 2025'), tripCreated('t1', 'Vosges 2026', 't0')],
  })
  expect(screen.getByText('STARTED FROM VOSGES 2025')).toBeInTheDocument()
})

it('takes the prose sentinel for a source that folded unnamed', () => {
  // A Trip that exists only because a later op arrived first has no name.
  renderTripScreen({
    ops: [tripPhaseMoved('t0', 'closed'), tripCreated('t1', 'V26', 't0')],
  })
  expect(screen.getByText('STARTED FROM UNNAMED TRIP')).toBeInTheDocument()
})

it('withdraws the line when the source is deleted', () => {
  renderTripScreen({
    ops: [
      tripCreated('t0', 'Vosges 2025'),
      tripDeleted('t0'),
      tripCreated('t1', 'Vosges 2026', 't0'),
    ],
  })
  expect(screen.queryByText(/^STARTED FROM/)).not.toBeInTheDocument()
})

it('withdraws the line when the source has not folded here', () => {
  renderTripScreen({ ops: [tripCreated('t1', 'Vosges 2026', 'not-here')] })
  expect(screen.queryByText(/^STARTED FROM/)).not.toBeInTheDocument()
})

it('draws no line at all for a Trip with no source', () => {
  renderTripScreen({ ops: [tripCreated('t1', 'Vosges 2026')] })
  expect(screen.queryByText(/^STARTED FROM/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

The whole rule in one expression: read `trip.fromTripId?.value`; if absent,
draw nothing; if `tripStandingOf(state, sourceId) !== 'live'`, draw nothing
(J19's withdrawal — never `STARTED FROM —`); otherwise draw
`STARTED FROM {tripNameOrUnnamed(sourceTrip)}`, CSS-uppercased.

**`tripNameOrUnnamed`, not `tripLabel`.** A name slot takes the prose
sentinel; `—` is for list columns, group headers and circles (§5c).

Mono 11, muted, beneath the dates, at every width. **Not dismissible and not
a route** — it is a fact, and the over-claim band's precedent is that another
Trip may be named as a fact without becoming a link.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit**

---

## Task 9: `Trip.tsx` — the footer and the delete confirm (J1, J2, J3, J7)

**Files:**
- Create: `app/src/components/DeleteTripConfirm.tsx` + `.module.css`
- Test: `app/src/components/DeleteTripConfirm.test.tsx`
- Modify: `app/src/screens/Trip.tsx` (after the `editable` add affordances,
  ~line 848) + `.module.css`
- Test: `app/src/screens/Trip.test.tsx`

**Interfaces:**
- Consumes: `tripDeleted` (task 1), `listTotals`, `taskCounts`, `noteCounts`,
  `unpackTotals`, `ui/Confirm`
- Produces: `<DeleteTripConfirm trip onCancel onConfirm />`

- [ ] **Step 1: Write the failing confirm tests**

```tsx
it('states the four counts in the trip screen order, outcomes last', () => {
  renderConfirm({ /* 7 tasks, 4 notes, 35 entries/59 pieces, 56 outcomes, 1 lost */ })
  const facts = screen.getAllByTestId('delete-fact').map((n) => n.textContent)
  expect(facts).toEqual([
    '7 TASKS',
    '4 NOTES',
    '35 ENTRIES · 59 PIECES',
    '56 OUTCOMES · 1 LOST',
  ])
})

it('omits a segment at zero', () => {
  renderConfirm({ /* 0 tasks, 4 notes, … */ })
  expect(screen.queryByText('0 TASKS')).not.toBeInTheDocument()
})

it('draws no fact block at all on an empty Draft', () => {
  renderConfirm({ /* nothing recorded */ })
  expect(screen.queryAllByTestId('delete-fact')).toHaveLength(0)
  // and nothing is invented to fill the slot
  expect(screen.queryByText('NOTHING RECORDED YET')).not.toBeInTheDocument()
  expect(screen.queryByText(/0 ENTRIES · 0 TASKS/)).not.toBeInTheDocument()
})

it('titles with the prose sentinel for an unnamed Trip', () => {
  renderConfirm({ name: null })
  expect(screen.getByText('Delete Unnamed trip?')).toBeInTheDocument()
})

it('answers in ink and explains in the muted note', () => {
  renderConfirm({})
  expect(screen.getByText('Permanent. No route puts a trip back.')).toBeInTheDocument()
  expect(
    screen.getByText('The depot is untouched. An entry lists gear; it never holds it.'),
  ).toBeInTheDocument()
})

it('writes none of the refused strings', () => {
  renderConfirm({})
  expect(screen.queryByText(/Are you sure/)).not.toBeInTheDocument()
  expect(screen.queryByText(/will be lost/)).not.toBeInTheDocument()
  expect(screen.queryByText('▲')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement `DeleteTripConfirm`**

`ui/Confirm` with `description` = the ink answer and `note` = the muted depot
line — that is exactly the split S11's ruling H9 added those two props for.
The four fact lines go in the `children` block, between title and description
(H3's one shape: bare 12px lines, 10 apart, no box).

Counts come from the selectors that already own them — `taskCounts`,
`noteCounts` (which counts discarded notes, I16), `listTotals`,
`unpackTotals` — never re-derived here.

The primary is bordered-attention 48 `Delete trip`, Cancel is ghost, and
`Confirm` already withholds scrim dismissal.

- [ ] **Step 4: Run the confirm tests** — Expected: PASS.

- [ ] **Step 5: Write the failing footer tests**

```tsx
it('draws both footer controls, delete last, on every phase', () => {
  renderTripScreen({ ops: [tripCreated('t1', 'Vosges 2026')] })
  const start = screen.getByRole('link', { name: 'Start a new trip from Vosges 2026' })
  const del = screen.getByRole('button', { name: 'Delete Vosges 2026' })
  expect(start.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('routes the second door to /trips/new with the source pre-chosen', () => {
  renderTripScreen({ ops: [tripCreated('t1', 'Vosges 2026')] })
  expect(
    screen.getByRole('link', { name: 'Start a new trip from Vosges 2026' }),
  ).toHaveAttribute('href', '/trips/new?from=t1')
})

it('emits trip.deleted and lands on /trips', async () => {
  const { emitted, location } = renderTripScreen({ ops: [tripCreated('t1', 'V')] })
  await user.click(screen.getByRole('button', { name: /^Delete/ }))
  await user.click(screen.getByRole('button', { name: 'Delete trip' }))
  expect(emitted.map((s) => s.type)).toEqual(['trip.deleted'])
  expect(location()).toBe('/trips')
})

it('emits nothing when the confirm is cancelled', async () => {
  const { emitted } = renderTripScreen({ ops: [tripCreated('t1', 'V')] })
  await user.click(screen.getByRole('button', { name: /^Delete/ }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(emitted).toEqual([])
})
```

- [ ] **Step 6: Implement the footer**

A `<footer>` after the `editable` add affordances and before the sheets, under
a 1px rule: the accent `START A NEW TRIP FROM THIS ›` link, then the attention
`DELETE TRIP` button. Both ≥48 drawn (standalone controls need no hit
extension, §5b O), neither folding or re-docking at any width. Delete is the
screen's **last element**.

- [ ] **Step 7: Run, then add the drawn-size guard**

`app/src/screens/drawnSizes.test.ts` parses stylesheet text — add both new
controls to whatever list it walks, so their 48 is asserted rather than
assumed.

- [ ] **Step 8: Run the app suite, then commit**

---

## Task 10: `/trips/new` — `START FROM`, the source picker, and the copy

**Files:**
- Create: `app/src/components/SourcePicker.tsx` + `.module.css`
- Test: `app/src/components/SourcePicker.test.tsx`
- Modify: `app/src/screens/NewTrip.tsx` + `.module.css`
- Test: `app/src/screens/NewTrip.test.tsx`

**Interfaces:**
- Consumes: `sourceTrips` (task 4), `startTripFrom` (task 5), `ui/Sheet`
- Produces:
  `<SourcePicker selected={string | null} onSelect={(id: string | null) => void} onClose />`

Model it on `ParticipantPicker` (rows, a `Sheet`, controlled, authors
nothing), but **single-select and closing on selection** — the Home picker's
pick mode. The scrim **does** dismiss: this is a selection, not a decision.

- [ ] **Step 1: Write the failing picker tests**

Every test below builds the same three Trips: `t-old` (`Vosges 2025`, closed,
35 entries / 7 tasks / 4 notes, started July 2025), `t-mid` (`Alps 2026`,
pack-out, 58 entries / 3 tasks / **0 notes**, August 2026) and `t-new`
(unnamed Draft, 4 entries, **no dates**), with v7 ids in that creation order.

```tsx
it('lists every visible Trip, newest created first', () => {
  renderPicker({})
  const names = screen
    .getAllByTestId('source-row')
    .map((row) => row.querySelector('[data-testid="source-name"]')?.textContent)
  // The unnamed Draft is newest, and reads through the prose sentinel.
  expect(names).toEqual(['Unnamed trip', 'Alps 2026', 'Vosges 2025'])
})

it('offers Nothing — start empty as its first row, and that row is the clear', async () => {
  const onSelect = vi.fn()
  renderPicker({ selected: 't1', onSelect })
  const rows = screen.getAllByRole('button')
  expect(rows[0]).toHaveTextContent('Nothing — start empty')
  expect(rows[0]).toHaveTextContent('A BLANK GEAR LIST')
  expect(rows[0]).toHaveTextContent('● NOW')   // it is the current choice's opposite
  await user.click(rows[0]!)
  expect(onSelect).toHaveBeenCalledWith(null)
})

it('meta names only what carries over, and never PIECES', () => {
  renderPicker({})
  expect(screen.getByText('JUL 2025 · 35 ENTRIES · 7 TASKS · 4 NOTES')).toBeInTheDocument()
  expect(screen.queryByText(/PIECES/)).not.toBeInTheDocument()
})

it('omits a zero segment and says NO DATES in the month slot', () => {
  renderPicker({})
  // `Alps 2026` has no notes, so the segment is absent rather than `0 NOTES`.
  expect(screen.getByText('AUG 2026 · 58 ENTRIES · 3 TASKS')).toBeInTheDocument()
  // The unnamed Draft has no dates, and the month slot says so.
  expect(screen.getByText('NO DATES · 4 ENTRIES')).toBeInTheDocument()
})

it('reads an unnamed Trip through the prose sentinel', () => {
  renderPicker({})
  expect(screen.getByText('Unnamed trip')).toBeInTheDocument()
})
```

**`PIECES` is never on that line** because Participants do not copy, so a
Piece count would name a number the copy cannot have.

- [ ] **Step 2: Run, watch fail, implement the picker, run again**

- [ ] **Step 3: Write the failing screen tests**

`choose(name)` below is a local helper this step writes: open the row, click
the picker row with that name. Two lines, beside `renderNewTrip`.

```tsx
it('draws START FROM above NAME and leaves the caret in NAME', () => {
  renderNewTrip({ ops: [tripCreated('t0', 'Vosges 2025')] })
  const row = screen.getByRole('button', { name: /^Start from/ })
  const name = screen.getByLabelText('Name')
  expect(row.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(name).toHaveFocus()
})

it('withholds the row entirely in a household with no other Trip', () => {
  renderNewTrip({ ops: [] })
  expect(screen.queryByRole('button', { name: /^Start from/ })).not.toBeInTheDocument()
})

it('states one hint unchosen and two lines chosen', async () => {
  renderNewTrip({ ops: [tripCreated('t0', 'Vosges 2025')] })
  expect(
    screen.getByText("A PAST TRIP'S LIST, TASKS AND NOTES CAN COME ACROSS"),
  ).toBeInTheDocument()
  await choose('Vosges 2025')
  expect(
    screen.getByText('COMES ACROSS · 35 ENTRIES · BRING-COUNTS · 7 TASKS, UNTICKED · 4 NOTES'),
  ).toBeInTheDocument()
  expect(
    screen.getByText('STARTS FRESH · PACKING · JOURNEYS · OUTCOMES · DATES · PARTICIPANTS'),
  ).toBeInTheDocument()
})

it('does not prefill the name, so the CTA stays gated', async () => {
  renderNewTrip({ ops: [tripCreated('t0', 'Vosges 2025')] })
  await choose('Vosges 2025')
  expect(screen.getByLabelText('Name')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Create trip' })).toBeDisabled()
})

it('pre-chooses the source from ?from=', () => {
  renderNewTrip({ ops: [tripCreated('t0', 'Vosges 2025')], search: '?from=t0' })
  expect(screen.getByRole('button', { name: /^Start from/ })).toHaveTextContent(
    'Vosges 2025',
  )
})

it('emits the template batch on create, and nothing else', async () => {
  const { emitted } = renderNewTrip({ ops: sourceOps, search: '?from=t0' })
  await user.type(screen.getByLabelText('Name'), 'Vosges 2026')
  await user.click(screen.getByRole('button', { name: 'Create trip' }))
  expect(emitted[0]!.type).toBe('trip.created')
  expect(emitted[0]!.payload['from_trip_id']).toBe('t0')
  expect(emitted.some((s) => s.type === 'trip.entry_added')).toBe(true)
})

it('emits the plain three-op create when no source is chosen', async () => {
  const { emitted } = renderNewTrip({ ops: [] })
  await user.type(screen.getByLabelText('Name'), 'Alps')
  await user.click(screen.getByRole('button', { name: 'Create trip' }))
  expect(emitted.map((s) => s.type)).toEqual(['trip.created'])
})
```

- [ ] **Step 4: Implement the screen**

The `START FROM` row is Add gear's `HOME` anatomy — 48px bordered, mono label,
value right with a `›`; muted `NONE` unchosen, the name in ink chosen. It goes
**first**, above `NAME`, which is §5's ledger-line order gaining its one
stated exception — and `autoFocus` stays on `NAME`.

In `submit()`, branch once: with a source, `startTripFrom(...)` and emit every
spec it returns; without one, the existing three-op path unchanged. Dates and
Participants stay authored by the screen in **both** branches — a
Quartermaster may pick dates and people on the same sitting, and the copy
simply does not supply them.

Read `?from=` with wouter's search hook and seed the choice from it, tolerating
an id that is not `'live'` by falling back to no source.

- [ ] **Step 5: Run the app suite** — Expected: PASS.

- [ ] **Step 6: Commit**

---

## Task 11: the documentation the slice owes

**Files:** `docs/architecture-design.md`, `docs/sync-protocol.md`,
`docs/design/README.md`, `docs/patterns.md`, `docs/technical-debt.md`,
`CLAUDE.md`, and a new §11 in the slice spec.

- [ ] **Step 1: `docs/architecture-design.md`**

Add **§12.22**, the consequences of S14. Update §8.3's landed list — this
completes the MVP — and note that §8.1's `12 → 14` / `15 → 14` edges are
discharged.

- [ ] **Step 2: `docs/sync-protocol.md`**

§4.4's `trip.deleted` row loses its *waits for S14* framing. §4.5's fourth
gesture gains the sentence about the **Entry-id map**, which the protocol does
not currently mention at all and which is what makes a copied Note's subject
survive.

- [ ] **Step 3: `docs/design/README.md` — a code-authored block under §5m**

The two findings no ruling reaches, recorded here and **not only** in the
slice spec, because a dated spec is invisible to the next design round (S9
round 4's lesson):

- **J8's ordering is the Trip's UUIDv7 id, not a register stamp** — with the
  one-sentence reason (no register holds `trip.created`'s clock, because both
  the registers it seeds move afterwards).
- **A Bring-count copies from the register, never from `bringCountOf`'s
  read** — with the needless-write reason.

Mark the block *"Written by code while S14 was built — keep these through the
next regeneration"*, the idiom §5f and §5l already use.

- [ ] **Step 4: `docs/patterns.md`**

§2.3's needless-write catalogue gains the Bring-count case: the rule met
**inside a batch** rather than at a tap, which is a shape the section does not
yet carry.

- [ ] **Step 5: `docs/technical-debt.md`**

The popover entry gains its seventh waiting caller (the source picker). No
other entry changes — the three consolidations were already corrected to name
the trigger rather than this slice.

- [ ] **Step 6: `CLAUDE.md`**

The S14 paragraph, and the status line that has said *"only S14 is left of the
MVP"* since S13.

- [ ] **Step 7: the slice spec's own §11**

`docs/specs/2026-09-08-trip-history-and-templates.md` gains
**§11, what moved while it was being built** — the house convention since
`trips-and-phases.md` §10: a dated spec is left as written and what changed
lives in a new section rather than being edited back into the sections it
corrects.

**One entry is already known before implementation starts.** The spec's §9
asks for a Tier 3 test *asserting the builder pane's absence of the suggestion
band*. That test should **not** be written: the band was drawn at S7 and
**never built** — no string in `app/` or `ui/` ever matched it — so there is
nothing to regress and the test would assert that we never built something.
J18's retirement is docs-only, and `design/README.md` has already been
amended. Record it in §11 rather than quietly dropping it.

- [ ] **Step 8: Run everything, then commit**

```bash
npm run typecheck && npm run lint && npx vitest run --root shared && npx vitest run --root app
```

---

## Finishing

Per `CLAUDE.md`'s merge convention, and **not from inside this worktree**:

1. `git rebase main` here;
2. leave the worktree keeping it, `git merge --ff-only` into `main` in the
   **main checkout**;
3. run the **full suite on the merged `main`** — the rebase is exactly where a
   resolution can be green in isolation and wrong once integrated;
4. `git push` from there.

Do not squash: this slice is well past the thousand lines at which the
branch's own history becomes the reviewable unit.
