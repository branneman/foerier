# S12 — Trip notes: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> to implement this plan task by task. Steps use `- [ ]` for tracking.

**Goal:** A Quartermaster can jot a Note against a Trip — optionally about one
Entry — read it on the trip screen, and keep or discard it at the unpack pass.

**Architecture:** Two catalogued ops fold to `notes.<note_id>`, the Trip's
third nested entity map. Every question a surface asks is answered once in
`shared/src/selectors/note.ts`, including the one place in this codebase where
an absent register is a **third state** rather than a default: `kept` reads
`true | false | undefined`, and the surfaces draw three things.

**Tech Stack:** TypeScript, Vitest, React 19, Radix (`ui/`'s `Sheet`).

**Spec:** [`docs/specs/2026-09-08-trip-notes.md`](2026-09-08-trip-notes.md) —
read it before starting. This plan argues from it and does not repeat its
reasoning.

**Design authority:** `docs/design/README.md` §5l, rulings **I9–I20**. §5l is
where a decision this code takes that no ruling reached must be written down —
not only here. A dated spec is invisible to the next design round (S9 round 4).

## Global constraints

- **Relative imports in `shared/` carry an explicit `.ts` extension.** `app/`
  does not (Vite resolves).
- **Op payloads mirror the wire — `snake_case`, never transformed.** Folded
  state, selectors and props are camelCase.
- **Reader gates, never reducer gates.** Both handlers fold unconditionally;
  `notesOf` and `noteKeptOf` decide what is drawn.
- **A needless write is never free** (`patterns.md` §2.3). It is *visible* in
  this slice: a reviewed row offers the other route only, so `KEEP` on a kept
  Note is unreachable rather than merely discouraged.
- **Every function gets a docblock carrying the *why*.** This codebase's
  docblocks are the record; cite spec sections and ruling ids (I9–I20) by name.
- **`ui/` is not touched.** Nothing here has a second caller (`patterns.md`
  §5.5).
- Run `npm run typecheck && npm run lint` before every commit (the pre-commit
  hook runs them anyway; failing fast is cheaper).
- Commit messages end with:
  `Claude-Session: https://claude.ai/code/session_012Trw9SWY3g3qJ3EHXZ2gyY`

---

## File map

| File | Task | Responsibility |
| --- | --- | --- |
| `shared/src/state.ts` | 1 | `NoteState`; `notes` on `TripState` |
| `shared/src/reduce.ts` | 1 | `writeNote`; two handlers; two table rows |
| `shared/src/authoring.ts` | 1 | `tripNotePosted`, `tripNoteKept` |
| `shared/fixtures/s12-notes.ops.json` | 1 | the wire snapshot |
| `shared/src/fixtures.s12.test.ts` | 1 | replays it through the reducer |
| `shared/src/selectors/note.ts` | 2 | `notesOf`, `noteKeptOf`, `noteCounts` |
| `shared/src/index.ts` | 1, 2 | exports |
| `shared/src/convergence.test.ts` | 3 | Tier 2 |
| `app/src/components/NotesPanel.tsx` (+ `.module.css`) | 4 | the trip screen's panel |
| `app/src/screens/Trip.tsx` | 4 | one child inside `TripPanels` |
| `app/src/screens/NoteComposer.tsx` (+ `.module.css`) | 5 | `/trips/:id/note` |
| `app/src/components/AboutPicker.tsx` (+ `.module.css`) | 5 | the `ABOUT` sheet |
| `app/src/App.tsx` | 5 | the route |
| `app/src/screens/Unpack.tsx` (+ `.module.css`) | 6 | the review card |

**Already landed** (commit `6e72cd3`, on `main`): `TripPanels` and its slot in
`Trip.tsx`. Task 4 adds a child; it does not build the row.

---

## Task 1 — the ops: register, payload builders, reducer, fixture

**Files:**
- Modify: `shared/src/state.ts` (add `NoteState`; add `notes` to `TripState`)
- Modify: `shared/src/reduce.ts` (`writeNote`, two handlers, two table rows)
- Modify: `shared/src/authoring.ts` (two builders)
- Modify: `shared/src/index.ts` (export the two builders and `NoteState`)
- Create: `shared/fixtures/s12-notes.ops.json`
- Create: `shared/src/fixtures.s12.test.ts`
- Test: `shared/src/reduce.notes.test.ts`, `shared/src/authoring.test.ts`

**Interfaces produced:**

```ts
export interface NoteState {
  id: string
  text?: Register<string>
  entryId?: Register<string>
  kept?: Register<boolean>
}
// on TripState:
readonly notes?: Readonly<Record<string, NoteState>>

export function tripNotePosted(
  tripId: string,
  noteId: string,
  text: string,
  entryId?: string,
): OpSpec
export function tripNoteKept(
  tripId: string,
  noteId: string,
  kept: boolean,
): OpSpec
```

- [ ] **Step 1: Write the failing reducer tests**

Create `shared/src/reduce.notes.test.ts`. Model it on
`reduce.pieces.test.ts` — same helpers, same shape.

```ts
it('creates the Note and seeds text', () => {
  const state = fold([op(tripNotePosted(TRIP, 'n1', 'Ran low on gas.'))])

  expect(state.trips[TRIP]?.notes?.['n1']?.text?.value).toBe('Ran low on gas.')
  expect(state.trips[TRIP]?.notes?.['n1']?.entryId).toBeUndefined()
})

it('carries entry_id when the Note is about one Entry', () => {
  const state = fold([op(tripNotePosted(TRIP, 'n1', 'Useless on gravel.', 'e1'))])

  expect(state.trips[TRIP]?.notes?.['n1']?.entryId?.value).toBe('e1')
})

it('leaves entry_id alone on an explicit null', () => {
  // Spec §2: the register is not nullable, so sync §1.3's "null clears" does
  // not reach it. No op in the catalogue detaches a Note from its Entry, and
  // honouring a peer's null would be inventing the clear the round declined.
  const state = fold([
    op(tripNotePosted(TRIP, 'n1', 'Useless on gravel.', 'e1')),
    raw(TRIP, 'trip.note_posted', { note_id: 'n1', text: 'x', entry_id: null }),
  ])

  expect(state.trips[TRIP]?.notes?.['n1']?.entryId?.value).toBe('e1')
})

it('folds note_kept arriving before the note it addresses', () => {
  // Spec §2: writeNote creates the entity for any Note op, so a peer
  // reviewing while the post is still queued leaves a Note with kept and no
  // text. That is a reader's problem (§3), not the fold's.
  const state = fold([op(tripNoteKept(TRIP, 'n1', true))])

  expect(state.trips[TRIP]?.notes?.['n1']?.kept?.value).toBe(true)
  expect(state.trips[TRIP]?.notes?.['n1']?.text).toBeUndefined()
})

it('takes the later kept and returns identity for a losing write', () => {
  const before = fold([op(tripNoteKept(TRIP, 'n1', true))])
  const after = applyOp(before, earlierOp(tripNoteKept(TRIP, 'n1', false)))

  expect(after).toBe(before)
})

it('drops an op with no note_id', () => {
  const state = fold([raw(TRIP, 'trip.note_posted', { text: 'orphan' })])

  expect(state.trips[TRIP]?.notes).toBeUndefined()
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/reduce.notes.test.ts --root shared`
Expected: FAIL — `tripNotePosted` is not exported.

- [ ] **Step 3: Add `NoteState` and the `notes` map**

In `state.ts`, beside `postings` and `entries`. `TripState`'s own docblock
already promises this row ("*pieces, tasks, notes — belong to S8 onward, and a
slice adds its own row rather than pre-declaring everyone else's*"); the
docblock on `notes` says which slice took it and why `entryId` is not nullable.

```ts
export interface NoteState {
  id: string
  text?: Register<string>
  entryId?: Register<string>
  kept?: Register<boolean>
}
```

- [ ] **Step 4: Add `writeNote` and the two handlers**

`writeNote` is `writeEntry`'s twin one map over — nested in `writeTrip`, same
identity guard, and the guard matters for the same reason (a losing write must
return the identical object or `slice.ts`'s `WeakMap` memo is invalidated by an
op that changed nothing).

```ts
function writeNote(
  state: HouseholdState,
  tripId: string,
  noteId: string,
  stamp: Stamp,
  update: (note: NoteState, stamp: Stamp) => NoteState,
): HouseholdState {
  return writeTrip(state, tripId, stamp, (trip, st) => {
    const existing = trip.notes?.[noteId]
    const current = existing ?? { id: noteId }
    const updated = update(current, st)
    if (updated === current && existing !== undefined) return trip
    return { ...trip, notes: { ...trip.notes, [noteId]: updated } }
  })
}

const tripNotePosted: Handler = (state, op, stamp) => {
  const noteId = readString(op.payload, 'note_id')
  if (noteId.kind !== 'value') return state
  return writeNote(state, op.aggregate_id, noteId.value, stamp, (note, st) => {
    const text = writeIfPresent(note.text, readString(op.payload, 'text'), st)
    const entryId = writeIfPresent(
      note.entryId,
      readString(op.payload, 'entry_id'),
      st,
    )
    if (text === note.text && entryId === note.entryId) return note
    return { ...note, ...(text && { text }), ...(entryId && { entryId }) }
  })
}

const tripNoteKept: Handler = (state, op, stamp) => {
  const noteId = readString(op.payload, 'note_id')
  if (noteId.kind !== 'value') return state
  const kept = readBoolean(op.payload, 'kept')
  if (kept.kind !== 'value') return state
  return writeNote(state, op.aggregate_id, noteId.value, stamp, (note, st) => {
    const next = writeRegister(note.kept, kept.value, st)
    if (next === note.kept) return note
    return { ...note, kept: next }
  })
}
```

Register both in the `handlers` table, at the end, under an `// S12 (§4.4)`
comment naming the register row.

- [ ] **Step 5: Add the two authoring builders**

In `authoring.ts`, after `tripConsumptionPosted`. `entry_id` is **omitted**
when the Note is about the Trip — never sent as `null`, because authoring is
the strict half (`payloads.ts`'s own header) and a `null` would mean *clear*,
which no reader here honours.

```ts
/** §4.4: creates the Note. `entry_id` is omitted for a Note about the Trip. */
export function tripNotePosted(
  tripId: string,
  noteId: string,
  text: string,
  entryId?: string,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.note_posted',
    payload: { note_id: noteId, text, ...(entryId && { entry_id: entryId }) },
  }
}

/** §4.4: `true` keeps as reference, `false` discards. One op, both ways (I14). */
export function tripNoteKept(
  tripId: string,
  noteId: string,
  kept: boolean,
): OpSpec {
  return {
    aggregate: 'trip',
    aggregate_id: tripId,
    type: 'trip.note_kept',
    payload: { note_id: noteId, kept },
  }
}
```

Add the matching cases to `authoring.test.ts` (payload shape, and that a
Trip-wide Note carries **no** `entry_id` key at all — `expect('entry_id' in
payload).toBe(false)`, not `toBeUndefined()`).

- [ ] **Step 6: Run the reducer tests**

Run: `npx vitest run src/reduce.notes.test.ts src/authoring.test.ts --root shared`
Expected: PASS.

- [ ] **Step 7: Capture the fixture**

Create `shared/fixtures/s12-notes.ops.json` and
`shared/src/fixtures.s12.test.ts`, modelled on `fixtures.s11.test.ts` — the
header explains why the fixture is captured **in this commit** rather than a
slice late (S4's debt; `testing.md`'s Backward-compatibility group). Carry only
S12's two op types plus the `trip.created`, `gear.recorded` and
`trip.entry_added` ops needed to give them something to reference.

Four Notes, each earning its place:

1. `n-s12-gas` — `trip.note_posted{text, entry_id}` then
   `trip.note_kept{kept: true}`. The ordinary reviewed case.
2. `n-s12-chair` — posted about an Entry, then `kept: false`. Proves a
   discarded Note keeps a **present** register rather than a dropped key (I16).
3. `n-s12-gloves` — posted with **no** `entry_id`, never reviewed. The
   unreviewed third state (I13) and the Trip-wide Note in one.
4. `n-s12-ghost` — `trip.note_kept{kept: true}` with no `note_posted` anywhere
   in the file. The forward-compatibility probe: a peer's review arriving
   first, folded and retained, read back verbatim.

- [ ] **Step 8: Run the fixture test and the whole `shared` suite**

Run: `npx vitest run --root shared`
Expected: PASS, including every existing fixture (they pin op types this task
does not touch).

- [ ] **Step 9: Commit**

```
git add shared/src/state.ts shared/src/reduce.ts shared/src/authoring.ts \
  shared/src/index.ts shared/src/reduce.notes.test.ts \
  shared/src/authoring.test.ts shared/src/fixtures.s12.test.ts \
  shared/fixtures/s12-notes.ops.json
git commit
```

---

## Task 2 — the selectors: `notesOf`, `noteKeptOf`, `noteCounts`

**Files:**
- Create: `shared/src/selectors/note.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/selectors/note.test.ts`

**Interfaces consumed:** `NoteState`, `TripState` (Task 1).

**Interfaces produced:**

```ts
export interface NoteView {
  id: string
  text: string
  entryId: string | undefined
  /** Epoch ms from the posting op's own HLC, or `undefined` if unparseable. */
  postedAtMs: number | undefined
  kept: boolean | undefined
}
export function notesOf(trip: TripState | undefined): readonly NoteView[]
export function noteKeptOf(note: NoteState): boolean | undefined
export function noteCounts(trip: TripState | undefined): {
  total: number
  toReview: number
}
```

- [ ] **Step 1: Write the failing selector tests**

```ts
it('lists notes oldest first', () => {
  // I11. The order is the posting stamp's, so two replicas holding the same
  // ops draw the same list — `Object.keys` would draw arrival order.
  const trip = tripWith([
    note('n2', 'second', { hlc: '2026-08-16T08:12:00.000Z-0000' }),
    note('n1', 'first', { hlc: '2026-08-15T19:40:00.000Z-0000' }),
  ])

  expect(notesOf(trip).map((n) => n.id)).toEqual(['n1', 'n2'])
})

it('excludes a Note with no text from the list and both counts', () => {
  // Spec §3: S7's sourceless Entry, one map over. A peer's `note_kept` can
  // arrive first, and an entity nobody can draw a default for is not a line
  // anybody can draw.
  const trip = tripWith([keptOnly('n-ghost', true)])

  expect(notesOf(trip)).toEqual([])
  expect(noteCounts(trip)).toEqual({ total: 0, toReview: 0 })
})

it('answers three states for kept', () => {
  expect(noteKeptOf(noteState({ kept: true }))).toBe(true)
  expect(noteKeptOf(noteState({ kept: false }))).toBe(false)
  expect(noteKeptOf(noteState({}))).toBeUndefined()
})

it('counts every Note and only the unreviewed as to-review', () => {
  // I16: a discarded Note is still counted. I13: absent kept is unreviewed.
  const trip = tripWith([
    note('n1', 'kept', { kept: true }),
    note('n2', 'discarded', { kept: false }),
    note('n3', 'unreviewed'),
  ])

  expect(noteCounts(trip)).toEqual({ total: 3, toReview: 1 })
})

it('is empty for a Trip this replica has not folded', () => {
  expect(notesOf(undefined)).toEqual([])
  expect(noteCounts(undefined)).toEqual({ total: 0, toReview: 0 })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/selectors/note.test.ts --root shared`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `note.ts`**

The module header states the two things a call site would otherwise re-derive:
that `kept` is the codebase's one **third-state** read (I13, `kindOf`'s shape —
not `ownerOf`'s default), and that a Note with no `text` is folded, retained
and drawn nowhere.

Ordering is `compareStamps` on the `text` register's stamp, id last so the
order is total by construction:

```ts
function byPostedThenId(a: NoteView, b: NoteView): number
```

Keep the comparator **in this file**: `order.ts` is where a comparator moves
when it has a second caller (`patterns.md` §5.5), and this one has one.

`postedAtMs` comes from `parseHlc(register.hlc)?.ms` — the op envelope's own
clock (I11). `undefined` when the HLC will not parse, so the surface drops the
timestamp segment rather than drawing `Invalid Date`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/selectors/note.test.ts --root shared`
Expected: PASS.

- [ ] **Step 5: Export from `index.ts` and commit**

Export `notesOf`, `noteKeptOf`, `noteCounts` and `type NoteView`.

Run: `npm run typecheck` then commit.

---

## Task 3 — convergence (Tier 2)

**Files:**
- Modify: `shared/src/convergence.test.ts`

The signature tier (`testing.md`): two Devices, disjoint op logs, folded in
both orders, asserted identical.

- [ ] **Step 1: Add the two cases**

Use the file's existing `replica`/`exchange`/`clock` helpers — read a
neighbouring case first; the shape below is the one at
`convergence.test.ts:~2580`.

```ts
it('keeps both Notes when two Devices post offline', () => {
  // Two note ids are two entity paths, so nothing contends and both survive
  // in either fold order — architecture §8.6's own argument for why S12 and
  // S13 could be built at once, proved one slice down.
  clock.advance(1000)
  const gas = a.emit(tripNotePosted(trip, 'n-gas', 'Ran low on gas.', entry))
  clock.advance(1000)
  const gloves = b.emit(tripNotePosted(trip, 'n-gloves', 'Warmer gloves.'))
  exchange(a, b)

  expect(a.state()).toEqual(b.state())
  for (const r of [a, b]) {
    const notes = r.state().trips[trip]!.notes!
    expect(notes['n-gas']!.text).toEqual({
      value: 'Ran low on gas.',
      hlc: gas.hlc,
      deviceId: gas.device_id,
    })
    expect(notes['n-gloves']!.text!.value).toBe('Warmer gloves.')
    expect(notes['n-gas']!.entryId!.value).toBe(entry)
    // The Trip-wide Note never acquires one: authoring omits the key, so
    // there is no `null` for a reader to mistake for a clear (spec §2).
    expect(notes['n-gloves']!.entryId).toBeUndefined()
  }
})

it('resolves keep against discard by plain LWW, identically on both', () => {
  // One register, two writers, and the only contended path this slice has.
  // The later stamp wins outright; the loser's op stays in the log and
  // changes nothing, which is what makes the discard reversible by a later
  // KEEP rather than by anything special-cased (I14).
  a.emit(tripNotePosted(trip, 'n-chair', 'Useless on gravel.'))
  exchange(a, b)
  clock.advance(1000)
  const kept = a.emit(tripNoteKept(trip, 'n-chair', true))
  clock.advance(1000)
  const discarded = b.emit(tripNoteKept(trip, 'n-chair', false))
  exchange(a, b)

  expect(a.state()).toEqual(b.state())
  for (const r of [a, b]) {
    expect(r.state().trips[trip]!.notes!['n-chair']!.kept).toEqual({
      value: false,
      hlc: discarded.hlc,
      deviceId: discarded.device_id,
    })
  }
  expect(kept.hlc < discarded.hlc).toBe(true)
})
```

- [ ] **Step 2: Run, and run both fold orders**

Run: `npx vitest run src/convergence.test.ts --root shared`
Expected: PASS.

- [ ] **Step 3: Commit**

---

## Task 4 — the `NOTES` panel on the trip screen

**Files:**
- Create: `app/src/components/NotesPanel.tsx`, `NotesPanel.module.css`
- Modify: `app/src/screens/Trip.tsx` (one child inside `TripPanels`)
- Test: `app/src/components/NotesPanel.test.tsx`

**Interfaces consumed:** `notesOf`, `noteCounts`, `NoteView` (Task 2).

Ruling I6: the band is drawn in **every** state, empty included. Ruling I3:
`4 NOTES`, count absent at zero. I18: `0 NOTES.` + *Notes are reviewed at the
unpack pass.* I11: text in ink, whole and unclamped, over mono 11 muted meta
`2026-08-15 19:40 · ABOUT: GAS CANISTER 450`, **no byline**. I4: the `+ NOTE`
link is live at every width.

- [ ] **Step 1: Write the failing component tests**

Cover: the band and its count; the count absent at zero; the empty state's two
lines; a row's meta with and without `ABOUT:`; the entry reference still
reading after the Entry is removed (I10); `+ NOTE` present at every width; and
**the panel drawn whole on a closed Trip, `+ NOTE` included** (I17 — the test
that fails the day somebody reaches for F5's `record` prop by analogy).

A discarded Note takes the RETIRED grammar here too, not only on F5 (I16):
struck and muted, still counted in `N NOTES`, still on screen. Assert the class
rather than the colour — `drawnSizes.test.ts`'s reason applies (no CSS is
processed in a Vitest run).

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement the panel**

Read the fold through `useHousehold` — this component's read *is* load-bearing
(`patterns.md` §5.2), so it is not props-in. The Entry's name comes from the
store the way `OverClaimBand` reads Gear and Trip names, not threaded through
as a second data shape.

- [ ] **Step 4: Add it as `TripPanels`' child in `Trip.tsx`**

Replace the `{/* S12 · NOTES */}` marker. Leave the `{/* S13 · TASKS */}`
marker exactly where it is — S13's branch is adding its own line above yours.

- [ ] **Step 5: Run the app suite for the trip screen**

Run: `npx vitest run src/components/NotesPanel.test.tsx src/screens/Trip.test.tsx --root app`
Expected: PASS.

- [ ] **Step 6: Commit**

---

## Task 5 — `/trips/:id/note`: the composer and the `ABOUT` picker

**Files:**
- Create: `app/src/screens/NoteComposer.tsx`, `NoteComposer.module.css`
- Create: `app/src/components/AboutPicker.tsx`, `AboutPicker.module.css`
- Modify: `app/src/App.tsx` (route), `app/src/shell/screenBand.test.tsx`
- Test: `app/src/screens/NoteComposer.test.tsx`, `app/src/components/AboutPicker.test.tsx`

Ruling I9: a **screen**, not a sheet, because the picker must stack on it.
`useScreenHeader({ splitPane: false, atDesktopSidebarCarriesDestination: false })`
— `GearListBuilder`'s trip door is the precedent, and `screenBand.test.tsx` is
where the two-sided fact is proved (the per-screen suite renders without the
shell, so its absence assertions prove one side only).

- [ ] **Step 1: Write the failing tests**

Cover: `Post note` disabled on empty **and on whitespace**; return inserts a
newline rather than posting; the emitted op's payload (`entry_id` present after
a pick, the key **absent** after `The trip`); the picker's `● NOW` on the
current value; scrim dismiss (`patterns.md` §4.2); navigation back to the
caller after Post.

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement the composer**

The picker is pure selection and the composer decides (`patterns.md` §4.3):
`AboutPicker` takes `value`, `entries` and `onSelect`, holds no store read of
its own beyond names, and emits nothing.

- [ ] **Step 4: Implement the `ABOUT` picker sheet**

`ui/`'s `Sheet` (a picker dismisses on the scrim), Home picker anatomy:
`The trip` first with meta `NOT ABOUT ONE ENTRY` and `● NOW` on the current
value, then the Trip's Entries A→Z (`byNameThenId`'s order via `entriesOf`),
fact line `ONE ENTRY ON THIS TRIP, OR THE TRIP`.

- [ ] **Step 5: Add the route and the screen-band case**

`<Route path="/trips/:id/note">` in `App.tsx`, beside `/trips/:id/add`. Add
`NoteComposer` to `screenBand.test.tsx`'s table.

- [ ] **Step 6: Run the app suite**
- [ ] **Step 7: Commit**

---

## Task 6 — the review card on F5

**Files:**
- Modify: `app/src/screens/Unpack.tsx`, `Unpack.module.css`
- Test: `app/src/screens/Unpack.test.tsx`

I14: a card **after the groups and directly above the close card**, so the
close card stays the list's last card (F11). I20: it renders wherever F5 has a
list, and is withheld only in F19's `0 ENTRIES.` branch. I15: the gate,
summary, button and both hints are **untouched**. I17: F5's `record` prop is
invariant 19's and does not reach the card.

- [ ] **Step 1: Write the failing tests**

Cover, in this order — the last three are the ones most likely to regress:
the card sits between the last group and the close card; `3 NOTES · 2 TO
REVIEW` with the second segment **absent** at zero; an unreviewed row offering
both routes and a reviewed row offering only the other one (I14); the close
button's gating unchanged with two notes unreviewed (I15); the card **absent**
in the empty branch (I20); every control still live on a closed Trip (I17).

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement the card**

Insert immediately before the `closeCard` section (`Unpack.tsx:~1628`) and
inside the non-empty branch only. `+ NOTE` routes to the same
`/trips/:id/note`, which returns here (I20).

- [ ] **Step 4: Run the full app suite**

Run: `npx vitest run --root app`
Expected: PASS — including `Unpack.test.tsx`'s existing close-gate assertions,
which must not have moved.

- [ ] **Step 5: Commit**

---

## Task 7 — the docs the slice owes

**Files:**
- Modify: `docs/sync-protocol.md` (§3.7's `notes` row; §4.4's two rows)
- Modify: `docs/architecture-design.md` (§8's S12 entry; a new §12 consequences
  section)
- Modify: `CLAUDE.md` (status section)
- Modify: `docs/design/README.md` **only** if this slice's code took a decision
  no ruling reached — and then in §5l, not in a spec
- Modify: `docs/patterns.md` if the third-state selector or the composer screen
  is a new shape rather than an instance of an existing one
- Modify: `docs/specs/2026-09-08-trip-notes.md` — add a **§11, what changed
  during implementation**, rather than editing the sections it corrects
  (`trips-and-phases.md` §10's precedent)

- [ ] **Step 1: Write them**
- [ ] **Step 2: Commit**

---

## Definition of done

- [ ] `npm test` passes on the branch, then on the ff-merged local `main`
      before any push.
- [ ] Every I9–I20 ruling is either implemented or named in the spec's §11 with
      the reason it was not.
- [ ] No string on any surface names a missing op (I12).
- [ ] `git log --oneline main..HEAD` reads as the order the work landed.
