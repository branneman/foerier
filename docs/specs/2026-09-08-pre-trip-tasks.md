# S13 — Pre-trip tasks

**Story 15.** Ops: `trip.task_added`, `trip.task_ticked` — both already in the
catalogue ([sync §4.4](../sync-protocol.md)). No endpoint, no migration, no
route, no sheet, no `ui/` change, no slicing dimension. Design authority:
`docs/design/README.md` **§5l**, rulings **I1–I8** (the shared shell, already
landed) and **I21–I27** (this slice), drawn on
`docs/design/S12 + S13 Round - Notes and Tasks.dc.html`.

**This slice is built in parallel with S12** (story 12, trip notes), in a
second worktree branched from the same commit. Architecture
[§8.6](../architecture-design.md#86-what-can-be-built-in-parallel) grants that
on one condition — *the shell is settled first* — and that shell landed on
`main` as `6e72cd3` before either branch existed. From that commit the two
slices share no file that either one writes to: `tasks.<id>` and `notes.<id>`
are disjoint registers ([sync §3.7](../sync-protocol.md)), the panels are
separate components, and `Trip.tsx` sees one added line from each.

Story 15 is tagged *"deliberately the last MVP story; first to move to Later"*.
Ruling **I8** measured its cost and kept it — roughly 48px per task above the
gear list on the phone at Draft, bounded — and ruling **I2** is why that
decision stays cheap: because a missing panel draws nothing, the shell does not
change if story 15 ever does move.

## Decisions at a glance

| # | Decision | Ruling |
|---|---|---|
| 1 | `TASKS` sits between the over-claim band and `GEAR LIST`, first of two | I1 |
| 2 | The composer is the checklist's end-of-list row, not a screen or a sheet | I21 |
| 3 | The whole row ticks; the square is a readout, never a second target | I22 |
| 4 | The glyph is a square — never `○ ◐ ●`, never `▲`, no status colour | I23 |
| 5 | Insertion order; a ticked row does not sink | I24 |
| 6 | Live at every phase, closed Trips included | I25 |
| 7 | The band reads `3/7 TICKED`; no bar | I26 |
| 8 | Empty is the band and the composer row; `0 TASKS.` is not written | I27 |
| 9 | Ordering is by the `text` register's stamp, id as tie-break | code (see §2) |
| 10 | `writeTask` is the sixth entity writer; the generic one stays owed | code (see §1) |

---

## 1. The register and the two ops

[Sync §3.7](../sync-protocol.md) has always carried the row; `TripState`'s own
docblock has named it since S7 (*"entries, the first of the three remaining
nested maps — pieces, tasks, notes — belong to S8 onward, and a slice adds its
own row rather than pre-declaring everyone else's"*). This slice adds it.

| Entity path | Registers |
| --- | --- |
| `tasks.<task_id>` | `text`, `ticked` |

```
trip.task_added   { task_id, text }          creates the Pre-trip task, unticked
trip.task_ticked  { task_id, ticked: bool }  sets `ticked`; one op for both directions
```

**A map of entities, not of registers** — `entries`' shape, not
`participants`'. Two registers on one entity is the whole of the argument: a
set whose member carries only presence cannot hold both a sentence and a
checkbox.

**`text` is written unconditionally by `trip.task_added`.** That makes it the
op's `trip.created`-shaped seed and it is the reason `writeTask` needs no
sixth-writer special case: `writeEntry` carries one because `trip.entry_added`
has no unconditional field, so identity alone cannot tell *existed, untouched*
from *just created, untouched* apart. A posted Task always writes at least one
register, so identity is never ambiguous here.

**Both ops fold unconditionally.** `trip.task_ticked` may arrive before the
`trip.task_added` that creates the Task — a peer ticking on another Device
while the add is still queued — and `writeTask` creates the entity for any Task
op, so a Task can hold a `ticked` register and no `text`. That is a reader's
problem, not the fold's; §2 says what it draws. No reducer gate: this is
[`patterns.md`](../patterns.md) §1.3 for the umpteenth time, and it is *not*
the cross-aggregate case `bringCount` and `stage` argue — nothing about a Task
lives on another aggregate. The reason here is plain arrival order.

### 1.1 `writeTask` is the sixth entity writer, and the generic one stays owed

`writeEntry`'s docblock says, in as many words:

> The generic `writeEntity` that would collapse all five is still not taken
> […] This is the fifth instance; a sixth should re-open the argument.

The trigger fires here — and it fires **twice at once**, because S12's
`writeNote` is the seventh, landing in a parallel worktree in the same week.
That is precisely why neither slice may take it. The refactor rewrites five
call sites in `reduce.ts`, the one file in the one package the whole
correctness argument rests on, and whichever branch took it would hand the
other a rebase across every line it also adds — the collision
[§8.6](../architecture-design.md#86-what-can-be-built-in-parallel) promised
these two slices would not have.

So `writeTask` is written in `writeEntry`'s shape, the argument is recorded as
re-opened rather than settled, and the consolidation is logged in
[`technical-debt.md`](../technical-debt.md). **S14 is the slice that should take
it**: its template copy reads every one of these maps, so it is the first slice
with a reason to be in all seven writers at once.

### 1.2 Authoring and the fixture

Two builders in `shared/src/authoring.ts`, `tripTaskAdded(tripId, taskId, text)`
and `tripTaskTicked(tripId, taskId, ticked)` — pure payload constructors, as
every builder is. No op type string enters `app/src` ([`patterns.md`](../patterns.md)
§2.1); the task id is minted at the call site with `systemIdSource.next()`.

Fixture: `shared/fixtures/s13-tasks.ops.json` + `shared/src/fixtures.s13.test.ts`,
captured **in this slice** and not a slice late. S4's debt and the lesson
[`testing.md`](../testing.md) took from it: a spec sentence saying a standing
rule applies produces no artefact, and no tier notices its absence.

## 2. The selector — `shared/src/selectors/task.ts`

- **`tasksOf(trip): TaskView[]`** — every folded Task in **insertion order**
  (I24), which §2.1 defines. A Task with no `text` register is folded,
  retained, and **excluded from the list and from both counts** — S7's
  sourceless Entry and S12's textless Note, one aggregate row over: an entity
  nobody can draw a default for is not a line anybody can draw.
- **`taskTickedOf(task): boolean`** — an absent `ticked` register reads
  `false`, and only this function says so ([`patterns.md`](../patterns.md)
  §1.2, `ownerOf`'s rule again). Deliberately **not** S12's three-state
  `noteKeptOf`: a Note has an *unreviewed* state because the review is a step
  the Quartermaster performs; a Task has no third thing to be. Absent and an
  explicit `false` stay different facts about the log and every reader treats
  them alike.
- **`taskCounts(trip): { total, ticked }`** — the band's readout. `total`
  counts the drawable Tasks, `ticked` those `taskTickedOf` answers `true` for.

### 2.1 Insertion order means the creating stamp, not the key order

I24 rules *insertion order; ticked rows do not sink*, citing A8: sorting by
state moves rows under the thumb as they are tapped. The second half is a
straightforward refusal — nothing sorts on `ticked`. The first half is where
the ruling's wording and the fold disagree, and the fold wins:

**`tasks` is a `Record`, and its key order is arrival order.** Two Devices that
receive the same two `trip.task_added` ops in opposite order insert the two
keys in opposite order, so an implementation reading `Object.keys` prints two
different checklists from identical registers. That is exactly the failure the
convergence tier exists to catch, and it has no symptom on one Device.

So `tasksOf` orders by the **`text` register's own stamp**, ties broken by task
id — S12's `notesOf` ordering, spelled the same way for the same reason, and
the trip containment view's sorted-id determinism one level up
([sync §3.6](../sync-protocol.md)). *Insertion order* is then true in the only
sense a replicated log can mean it: the order the tasks were written in, as the
log records it, and the same on every Device.

A tick therefore never moves a row: `trip.task_ticked` writes `ticked` and
never touches `text`, so the stamp the ordering reads is the one the add wrote
and nothing later can disturb it. I24's second half falls out of the ordering
rather than needing a clause of its own.

## 3. The `TASKS` panel — `app/src/components/TasksPanel.tsx`

Props-in ([`patterns.md`](../patterns.md) §5.2): the panel takes its Tasks,
its counts and two callbacks. Its store read would not be load-bearing —
`Trip.tsx` already holds the fold — so it does not take one.

### 3.1 The band

The `GEAR LIST` band's anatomy in **every** state, empty included (I6): label
`TASKS` left, count `3/7 TICKED` right, and **no trailing link** — the composer
is the end-of-list row, so there is nothing for a link to lead to. That absence
is I2's own shape one component over: a slot with nothing to put in it draws
nothing rather than a disabled affordance ([`patterns.md`](../patterns.md)
§3.7).

The fraction is legal at `0/7` — a fraction is not a zero segment, so ruling G3
does not reach it — and the **whole segment is absent at `total === 0`** (I3),
which is what makes the empty panel §3.4's band-and-composer and nothing else.
`TICKED` is the glossary's own word and the register's. No bar (I26): F4's bar
measures sixty-one Pieces, and seven rows are their own bar.

**The band is spelled here, and that is now the third copy.** The board's §08
lists *"the band component with its count slot and trailing link"* among what
the shell commit lands, and the shell that landed (`6e72cd3`) is `TripPanels`
alone; S12's spec has `NotesPanel` spelling the idiom itself. So `Trip.tsx`'s
`gearListBand`, `NotesPanel`'s and this one are three hand-spelled copies of
one anatomy, and [`patterns.md`](../patterns.md) §5.5's *a second caller is the
bar for moving into `ui/`* is met by two callers who could not coordinate.
Extracting it now would mean landing a shared component onto `main` mid-flight
and asking the S12 worktree to adopt it — the coordination §8.6's float exists
to avoid. Logged in [`technical-debt.md`](../technical-debt.md) instead, with
the note that the extraction should take all three copies, not two.

### 3.2 The row

**The whole row is the target and the square is the readout** (I22) — not a
second target beside it. Rows are ≥48px, so they need no hit extension and get
no `::after`; the square is 18px and is *inside* the button, which is the whole
reason it can be that size at all (ruling O's rule 1: a drawn size is the
painted size, and 48 floors the hit area of things that are targets).

One op per tap, both directions (`trip.task_ticked` with the flipped value).
[`patterns.md`](../patterns.md) §2.3 is satisfied by construction rather than
by a guard: a tap always flips, so there is no such thing here as an op equal
to the current value. The one place a needless write is reachable in this slice
is the composer, and §4 gates it.

**The glyph is a square** (I23): 18px, radius 3 (the badge radius), 1.5px
border. Ticked draws a ✓ in ink inside it and takes the row's text to muted;
unticked is the empty square with the text in ink. Never `○ ◐ ●`, which is
packing progress, and never `▲`, which is attention — reusing either is S5's
trap, the one where an encoding inherited as meaningless becomes load-bearing
the moment a slice gives it meaning. **No status colour at all**, so the
parchment theme has nothing to collapse.

The board's `#0F130F` and `#47523F` are not new colours: they are already
`--color-well` and `--color-rule-control` in `ui/styles/tokens.css`. The panel
consumes the semantic tokens and spells no hex
([`patterns.md`](../patterns.md) §6.2).

**Accessible name: `Charge the devices, ticked` / `Charge the devices, not
ticked`** — the board's own strings. A plain `<button>`, deliberately **not**
`role="checkbox"`: a checkbox carries `aria-checked`, and a name that also
states the value would announce the state twice. The state is in the name
because the board put it there, and one channel is the whole point.

### 3.3 Order and phase

Rows draw in `tasksOf`'s order and a tick never moves one (§2.1). The panel's
anatomy **never changes with phase**, closed Trips included (I25) — see §5.

### 3.4 Empty

Band + composer row, and nothing else (I27). **`0 TASKS.` is not written**: the
composer on screen *is* the empty state, which is where this panel departs from
`NotesPanel`'s `0 NOTES.` and from the gear region's `0 ENTRIES.` — both of
those have their composer elsewhere and so need a line to stand in for it. With
`total === 0` the band's count segment is absent too (§3.1), so the empty panel
is the word `TASKS` over one dashed row.

## 4. The composer — the checklist's end-of-list row

The trip-only Entry's dashed row, one panel down, reused whole (I21):

```
+ TASK — NOT GEAR. GEAR GOES ON THE GEAR LIST.
```

Verb, then the permanent fact. Tap turns it into a 48px well on
`--color-well` with an amber focus ring and **no placeholder** — the hint
carries what a placeholder would, and it stays visible while typing:

```
RETURN ADDS AND KEEPS TYPING · EMPTY ADDS NOTHING
```

under the well, while focused, and only then.

**Return commits one `trip.task_added` and keeps focus** — Add gear's
type → return → type batch loop. The well clears and stays open; the new row
appears above it. **Blur with text commits** (the Stepper's rule, §5b K).
**Empty commits nothing** and the dashed row returns. One line; a long task
wraps and the row grows.

**No optimistic set**, and this is the interesting half. `emit` is
durable-first, so the folded answer arrives a queue-turn after the tap
([`patterns.md`](../patterns.md) §2.2) — and unlike `DepotPicker`'s
`IN LIST ✓`, nothing here needs to be in front of that queue: the list is
*above* the well, focus never leaves, and the next keystroke goes into an empty
field either way. A union of local ids would buy a frame nobody is looking at
and add a second source for a fact the fold already holds.

**Escape discards the draft and returns to the dashed row.** No board reaches
it. §5b K rules Escape as *restore the committed value* for a typed Bring-count,
and a composer has no committed value to restore, so discarding the draft is
that rule read onto a field whose committed state is *not open*. This is a
code-authored decision and goes into `design/README.md` when the slice lands,
per S9 round 4's lesson — a dated spec is invisible to the next design round.

**Whitespace is empty**, as it is for S12's `Post note` gate: a well holding
three spaces commits nothing, on Return and on blur alike. The trimmed string
is what the payload carries.

## 5. Phase, and the closed Trip

Live at every phase, **closed included** (I25) — ruling I17's test, applied a
panel over:

- Invariant **19** and ruling **G6** freeze a closed Trip's *outcomes*. A Task
  is not an outcome and writes nothing to the Depot.
- Invariant **16** locks no register on a phase move; it governs which phases
  are Active, and nothing more.
- Invariant **18** is the close gate's, and its purpose is the Depot. A Task,
  like a Note (I15), writes nothing there — so tasks do not join the gate
  either, and the close card's summary, button and hints are unchanged.
- **`Pre-trip` names when a task is *for*, not when its register may be
  written.** A task ticked after the fact, or added on a closed Trip for the
  next one, is a correction of the record.

So F5's `record` prop does not reach this panel, and §3.8's *a screen that may
no longer be written keeps its anatomy and drops its controls* has nothing to
do here: the controls stay.

## 6. What this slice does not do

- **No op is added and nothing is escalated to the domain.** Both ops were
  catalogued at planning time. Unlike S11, the domain had nowhere left to be
  asked.
- **No remove and no edit**, and nothing on screen says so.
  [Sync §9](../sync-protocol.md)'s open-questions entry already records the
  gap: neither story 15 nor [domain §9](../domain-model.md) provides for
  removing a Pre-trip task; it is a
  plausible hole and a cheap additive op, and it goes through the
  [requirements process](../../CLAUDE.md) before it gets an op type. Not
  smuggled in here. A missing op is a fact for the docs, not release meta-text
  for a Quartermaster mid-sitting — S7's un-renameable Entry, restated.
- **No sixth line on the Trips card** (I5). The card's five elements are full
  and the NEXT line carries the obligation.
- **No `ui/` change.** Nothing here has a second caller — and the one thing
  that does, the panel band, is §3.1's recorded debt rather than this slice's
  extraction.
- **No slicing dimension.** Story 13 completed at S9b
  ([§8.5](../architecture-design.md#85-where-story-13-attaches) as corrected),
  and a Task is not a property of a piece of Gear.
- **No template copy.** Story 15's second criterion — *a Trip Started from a
  past Trip takes over its task list, unticked* — is **S14's**, delivered by
  the template batch materialising one `trip.task_added` per Task and simply
  not writing `ticked` ([sync §4.5](../sync-protocol.md)). S13 owes S14 one
  sentence and states it here so S14 does not re-derive it: **every drawable
  Task is copied, ticked or not**, and a textless Task is not drawable and so
  is not copied.

## 7. Tests

- **Tier 1, `shared/`** — the reducer folds both ops; a `task_ticked` landing
  before its `task_added`; a Task with no `text` excluded from `tasksOf` and
  from both counts; `taskTickedOf` on an absent register, an explicit `false`
  and an explicit `true`; `taskCounts` at `0/N` and at `N/N`; ordering by the
  creating stamp with a tie broken by id; a tick not moving a row.
- **Tier 2, convergence** — two Devices adding **different** Tasks offline,
  both surviving (§8.6's own case for these two slices being disjoint); one
  Device ticking while another unticks the **same** Task, resolving by plain
  LWW to the same answer on both; and **the ordering property** — two replicas
  receiving the same two adds in **opposite order** print the identical list.
  That last one is what pins §2.1, and it is the only tier that can fail on it.
- **Tier 3, `app/`** — the panel's two row states and its empty state; the
  band's count reading `0/7` and vanishing at N = 0; Return committing and
  keeping focus; blur with text committing; an empty well and a
  whitespace-only well committing nothing; Escape discarding; one op per tap in
  both directions; a ticked row staying where it was written; the accessible
  name in both states; every control live on a closed Trip.
- **Fixture** — `s13-tasks.ops.json`, both op types, captured in this slice.

## 8. Documentation owed

[`sync-protocol.md`](../sync-protocol.md) §3.7's Trip register map (mark the
`tasks` row built) and its §4.4 catalogue rows;
[`architecture-design.md`](../architecture-design.md) §12's new consequences
section and §8's S13 entry; [`technical-debt.md`](../technical-debt.md) — the
seventh entity writer and the third band copy;
[`patterns.md`](../patterns.md) if the end-of-list composer turns out to be a
new shape rather than an instance of an existing one; `CLAUDE.md`'s status
section.

`design/README.md` **is not rewritten** — §5l is the shipped authority. What
goes there is anything this slice's code decides that no ruling reached (§2.1's
ordering and §4's Escape, at least), and it goes there rather than only into
this file. That is S9 round 4's lesson: a dated spec is invisible to the next
design round.
