# S14 — Trip history and templates

**Story 14, and story 15's second acceptance criterion.** One new op type,
`trip.deleted`, the last of the MVP catalogue's thirty-nine to be introduced
([sync §4.4](../sync-protocol.md)). No endpoint, no migration, no `ui/`
change, no slicing dimension, and **no op for the template copy at all** —
it materialises at creation into a batch of ops that have existed since S6,
S7, S12 and S13. Design authority: `docs/design/README.md` **§5m**, rulings
**J1–J20**, drawn on
`docs/design/S14 Round - Trip History and Templates.dc.html`.

**This is the last slice of the MVP.** Everything §8's plan asked for lands
here, and the two properties the plan attaches to this slice — *the copy takes
gear list, Bring-counts, tasks and kept Notes*, and *statuses, journeys,
outcomes, Consumed-counts and dates start fresh by simply not being written* —
are the whole of its arithmetic.

**Story 14's first criterion is already met and this slice does not build for
it.** *Past Trips remain browsable with their final decisions* is the closed
ledger section (S6), the trip screen at every phase, and F5 frozen as a record
(ruling G6). The round drew no history screen and no fourth destination, and
§5m says so in its opening paragraph. The one place S14 enumerates a closed
Trip's contents is the delete confirm's fact block.

## Decisions at a glance

| # | Decision | Ruling |
|---|---|---|
| 1 | `DELETE TRIP` at the foot of `/trips/:id`, every phase, and nowhere else | J1, J6 |
| 2 | The confirm's fact block is four conditional lines; an empty Draft gets none | J2 |
| 3 | `Permanent. No route puts a trip back.` in ink; the depot line muted | J3 |
| 4 | `/trips` afterwards, no toast, and the standing UNDO rule gains an exception | J4 |
| 5 | A Trip the fold cannot show renders in place, in two states, never a redirect | J5 |
| 6 | One screen, two doors; the second is the trip screen's own footer | J7 |
| 7 | Every visible Trip is a source — closed, active and Draft alike | J8 |
| 8 | The source picker is a `Sheet` at every width; the popover gains a seventh caller | J9 |
| 9 | `START FROM` states both halves: what comes across, what starts fresh | J10 |
| 10 | The name does not prefill | J11 |
| 11 | `START FROM` is the first row, above `NAME`; the caret still lands in `NAME` | J13 |
| 12 | Trip-only Entries copy, and `CLEARED AT CLOSE` keeps its wording | J14 |
| 13 | Retired gear copies unfiltered; nothing is filtered, so nothing is counted | J15 |
| 14 | A copied Note arrives unreviewed, on the copy's own clock, subject re-pointed | J16 |
| 15 | Provenance is a header fact; the suggestion band and its three strings retire | J18, J20 |
| 16 | A source that cannot be named withdraws the line | J19 |
| 17 | Newest-first is the Trip's own **UUIDv7 id**, not a register stamp | code (§4) |
| 18 | A Bring-count copies from the **register**, never from `bringCountOf`'s read | code (§3.4) |
| 19 | The copy cannot over-claim, by construction rather than by a guard | code (§3.6) |

---

## 1. The op, and the register that has been waiting for it

### 1.1 `trip.deleted` is `gear.retired`'s shape with no restore

`{}` — no payload fields at all. The reducer writes `deleted = true`
unconditionally, which is `gear.retired`'s handler transplanted:

```ts
'trip.deleted': (state, op, stamp) =>
  writeTrip(state, op.aggregate_id, stamp, (trip, st) => {
    const next = writeRegister(trip.deleted, true, st)
    return next === trip.deleted ? trip : { ...trip, deleted: next }
  }),
```

**It is deliberately not a pair.** `gear.retired` / `gear.restored` are an
ordinary LWW pair over one register ([sync §3.5](../sync-protocol.md)); the
catalogue defines **one** Trip tombstone op and no partner, and that absence
is what J3's answer line states to a human: `Permanent. No route puts a trip
back.` The register is nonetheless a `Register<boolean>` rather than a
presence flag, exactly as declared at S6 — so a later slice that ever wants a
restore adds an op type and writes `false`, without touching the fold's shape.
Nothing in S14 anticipates that, and the confirm must not hint at it.

**The tombstone is already wired everywhere but the op.** `visibleTrips`
(`shared/src/selectors/trip.ts`) has filtered `deleted?.value !== true` since
S6, and it is the one enumeration every reader goes through: `tripSections`,
`claim.ts`, `whereabouts.ts`, `unpack.ts`'s two walks, `slice.ts`'s `TRIP`
dimension and `App.tsx`'s nav count. So a delete removes the Trip from the
list, from every claim, from whereabouts, from the slice bar and from the
count with no new code — which is why §5m's own sentence is *the round
designs the act; the consequences were wired before it*, and why J4 can say
`/trips` is already right without a refresh.

### 1.2 `trip.created` gains `from_trip_id` at the builder, and only there

`reduce.ts` has folded `from_trip_id` into `TripState.fromTripId` since S6
(that slice's spec §1.3, and its fixture carries a hand-shaped probe for it,
because no builder could author one). What is missing is the authoring half:

```ts
export function tripCreated(id: string, name: string, fromTripId?: string): OpSpec
```

with the spread idiom that **omits an absent key** rather than sending `null`
— `gearRecorded`'s discipline, and here it is load-bearing twice over.
`TripState.fromTripId` is `Register<string>` and not nullable, so a `null`
would be authoring an instruction no reader honours
([sync §1.3](../sync-protocol.md)), and there is no op that detaches a Trip
from its source.

That is the whole of the change to `authoring.ts` besides the new
`tripDeleted(id)`. **No other builder moves**, which is the fact that makes
the copy cheap: `trip.entry_added`, `trip.entry_bring_count_set`,
`trip.task_added` and `trip.note_posted` are called exactly as any screen
calls them.

### 1.3 The fixture

`s14-templates.ops.json` + `shared/src/fixtures.s14.test.ts`, captured **in
this commit** — [sync §5.4](../sync-protocol.md)'s rule, and S4's lesson
about what happens when a slice says a standing rule applies and lands no
file.

It carries `trip.deleted`, a `trip.created` **with** `from_trip_id` (now
authorable, unlike S6's hand-shaped probe — the fixture should keep both, and
say in its header that the two are the same wire shape from two different
eras), and one full template batch: a `trip.created{from_trip_id}` followed by
its entries, one Bring-count, two tasks and two notes, one of them carrying a
re-pointed `entry_id` and one carrying none.

Two probes no builder of ours can author, documented in the test header the
way `fixtures.s3.test.ts` documents its foreign tags:

- a `trip.deleted` carrying a **payload field** (`{reason: "duplicate"}`),
  which obligation 2 says is ignored for the fold and retained verbatim;
- a `trip.created{from_trip_id}` naming a Trip **that is not in the log**,
  which is J19's withdrawal case as it actually arrives.

---

## 2. Three standings of a Trip id, and the screen that says which (J5)

`Trip.tsx` currently answers one question and draws one string:

```
if (tripId === undefined || trip === undefined) → `No such trip.`
```

A tombstoned Trip does not reach it at all — `state.trips[id]` is *defined*,
so today the screen would render a deleted Trip in full. J5 splits the
question in three, and the fold already holds the distinction:

| `state.trips[id]` | `deleted` | Standing | What the screen draws |
|---|---|---|---|
| defined | not `true` | **live** | the Trip |
| defined | `true` | **tombstoned** | `TRIP DELETED` + `It was deleted on this or another device. The depot is untouched.` |
| `undefined` | — | **not folded here** | `TRIP NOT ON THIS DEVICE` + `It may not have synced here yet. This clears itself.` |

Both non-live states draw a mono head, one sentence, and a bordered 48
`Open trips` — §5's own empty-region grammar — with **no title, no phase
chip, no panels and no footer**, because there is no Trip to carry them.
Neither
takes amber and neither takes `▲`: §5b F's rule is that a sync race is not an
error, and the second state clears itself.

**There is no redirect, and that is the ruling's whole point.** A screen that
teleports when a peer's op lands reads as a defect and hides the reason. The
route the Quartermaster is standing on keeps rendering and says what happened.

**This is the one S14 surface whose element set differs by width.** At 393 the
band's back link is drawn and `Open trips` is a second route; at Desktop
§5b's own gate withholds the back link — the sidebar draws `TRIPS`, and its
count has already dropped through the same selector that emptied the screen —
so `Open trips` is the only way out and earns its place. 540 and 900 take the
393 anatomy.

I lean on one small piece of care here: the predicate belongs in one exported
function in `shared/src/selectors/trip.ts` — `tripStandingOf(state, id)`
returning `'live' | 'deleted' | 'unknown'` — and not in `Trip.tsx`'s render.
`visibleTrips` already spells `deleted?.value !== true` and a second spelling
at a screen is precisely how the Depot's `ownerOf` rule was nearly lost twice.

---

## 3. The template copy — `startTripFrom`

### 3.1 It goes in `gestures.ts`, though it crosses no aggregate boundary

`authoring.ts` is a shelf of **pure payload constructors** that read no fold.
A template copy is several of those builders composed with a *read* of the
fold, deciding which ops one user action emits and in what order — which is
`gestures.ts`'s own stated criterion, and the criterion rather than the
aggregate count is what decides. `reopenTrip` is already in that file on
exactly this ground: it writes only the Trip and is not one of
[sync §4.5](../sync-protocol.md)'s cross-aggregate four. `startTripFrom` is
the second such function, and §4.5's fourth named gesture besides.

The module's header says *"three gestures"* and then that `reopenTrip` and
`restoreConsumption` are a third and fourth; it wants one more sentence, not a
rewrite.

### 3.2 What it reads, and what it writes

```ts
export function startTripFrom(
  newTripId: string,
  name: string,
  source: TripState,
  state: HouseholdState,
  ids: IdSource,
): readonly OpSpec[]
```

| Source of the fact | Op emitted | Notes |
|---|---|---|
| — | `trip.created{name, from_trip_id: source.id}` | the name is the screen's, never the source's (J11) |
| `entriesOf(source, state)` | `trip.entry_added` per Entry, a **fresh** id | `source` copied verbatim, depot and trip-only alike |
| the Entry's `bringCount` register | `trip.entry_bring_count_set` | §3.4 — the register, not the read |
| `tasksOf(source)` | `trip.task_added{text}` | never a `trip.task_ticked`; unticked **by absence** |
| `notesOf(source)`, `kept !== false` | `trip.note_posted{text, entry_id?}` | I13; the subject re-pointed, §3.3 |

And, said as plainly as the round says it, **what is not emitted**:
`trip.dates_set`, `trip.participant_added`, and every one of the eleven
packing, journey, outcome, consumed-count and posting ops. *Start fresh* is
not a value written anywhere; it is the absence of an op, which is what makes
the whole feature cost nothing in the reducer.

`entriesOf` and `tasksOf` and `notesOf` are the **readers**, deliberately, and
not `Object.values(source.entries)`. Each already carries the exclusion its map
needs — a sourceless Entry and a tombstoned one, a Task with no text, a Note
with no text — so the copy inherits every one of those gates rather than
restating four of them. A restated gate is what ruling G3 caught three times in
one round.

### 3.3 The Entry-id map, and the Note whose subject is gone (J16)

The batch mints a new id per Entry, so a copied Note's `entry_id` must be
re-pointed or dropped. Both are one pass:

1. build `Map<sourceEntryId, newEntryId>` while emitting the entry ops;
2. for each copied Note, `map.get(note.entryId)` — present, pass it as
   `entry_id`; **absent, omit the key entirely.**

Absent covers the case the board draws: `Gas canister 450` was removed from
the source list *after* the note about it was posted, so it is not in
`entriesOf` and there is no id to point at. The copy is posted **about the
Trip**, the `ABOUT` segment simply drops, and the source's own note keeps
reading (I10). The prose is the thing worth keeping; dropping a note to
protect a pointer loses the note to protect the footnote.

Two things the copy does **not** carry, and both are drawn on the board's §08
as a source/copy pair:

- **no `kept`.** `kept` is the verdict of the *source* Trip's unpack pass, so
  the copy draws plain — I13's unreviewed arm, which is exactly why S12 made
  absence a third state rather than a default.
- **not the source's clock.** `NoteView.postedAtMs` is read off the posting
  op's own HLC, so every copied Note shows the moment the batch wrote it. Two
  notes copied together share one timestamp; that is a fact about the copy,
  not a defect, and the ledger states its own clock rather than borrowing
  2025's.

### 3.4 A Bring-count copies from the register, never from `bringCountOf`

`bringCountOf` returns `entry.bringCount?.value ?? 1` for a Counted depot
Entry — an **absent** count reads `1`. Copying through the read would
therefore author `count: 1` for every Counted Entry whose count nobody ever
set: a needless write ([patterns §2.3](../patterns.md)) that changes nothing a
reader sees, on a batch that already runs to hundreds of ops.

So the rule is: emit a Bring-count **only when the source Entry carries the
register**, and only when `bringCountOf(entry, state) !== null` — the second
half being the authoring gate invariant 6 puts on the caller rather than on
the reducer. An Entry whose gear has since stopped being Counted shows no
Bring-count on the source list either, so copying none is what *takes over its
Bring-counts* means.

### 3.5 The order inside the batch, and what a partial one leaves

`emit` appends one op at a time (`store.ts`), so a copy is N durable appends
and **not atomic** — which is true of all of §4.5's gestures, and why that
section says the order inside each is chosen for what a partial batch leaves
behind.

The order is the table's, top to bottom: `trip.created` first, then entries
with their counts, then tasks, then notes. A Device dying part-way leaves a
**named Trip with a prefix of its list** — a legitimate, visible, recoverable
state, and one this very slice gives the Quartermaster a route out of, since
`DELETE TRIP` now exists. The reverse order would leave entry ops against a
Trip with no name; `writeTrip` would create the entity for them, so nothing
would be corrupt, but the Trips list would carry an unnamed Trip nobody
recognises.

**Nothing chunks and nothing caps.** [Sync §6.1](../sync-protocol.md)'s 500-op
push limit is the *outbox*'s business — it chunks and flushes in authoring
order — and every op merges independently against its own register, so a copy
split across two pushes is not a state anyone can observe. §4.5's arithmetic
puts a template batch at ~100 ops; a 200-entry source would run to ~400 and
still spend fewer than the cap.

### 3.6 The copy cannot over-claim, by construction

A new Trip is created in `draft`, and `claim.ts` reads **active** Trips only
(invariant 17, through `isActive`). So a template copy of a fifty-entry list
creates exactly zero claims, and there is no over-claim to guard, preview or
confirm at creation — no `ActivationConfirm`, no band, nothing.

This is worth stating because the *next* moment is guarded and already built:
the copy's first move into an Active phase runs `overClaimsIfActive` through
`PhaseSheet`'s existing preview, which is where a fifty-entry duplicate of a
list another Trip is currently packing would surface. S14 adds nothing there
and must not.

---

## 4. The source list, and the clock the fold does not have (J8)

J8 rules the picker's order **`trip.created`'s clock, newest first** — *the
one clock every Trip has, dates being optional, and one every replica agrees
on*. The intent is exactly right and the literal reading is not available:
**no register's stamp is `trip.created`'s clock.** `trip.created` seeds two
registers, and both of them move afterwards — `name` on a `trip.renamed`,
`phase` on every `trip.phase_moved`. Ordering by either would re-sort the
picker when somebody renamed a Trip or moved its phase, which is not what the
ruling asks for and is a live symptom rather than a theoretical one.

This is I24's shape a slice later, and it takes the same treatment: **where a
board's words imply a mechanism the fold cannot provide, the slice owes the
round the corrected reading, not the literal one.**

The corrected reading is the Trip's **own id**. Entity ids come from
`systemIdSource`, which is `uuid`'s **v7** — a 48-bit big-endian millisecond
timestamp in the most significant bits, and the canonical hex string preserves
that order lexicographically. So descending id is newest-created first, total,
replica-identical, and costs no register read at all.

It is also **more** faithful to J8's words than any stamp would be: the id is
minted in the same tick as `trip.created` on the authoring Device, whereas an
HLC may have been advanced by a peer's clock before that op was written
(§2.5's `max`). And it has no missing case — `writeTrip` creates the entity
for *any* Trip op, so a Trip that exists only because a `trip.renamed`
overtook its creation still has a v7 id and still sorts.

Two properties to write into the selector's own docblock, because both are the
kind of thing a later reader re-derives wrongly:

- **Skew does not matter, agreement does.** Two Devices with skewed wall
  clocks mint ids whose order is not true creation order — but it is the
  *same* order on every replica, which is the only thing a replicated list
  needs. This is the same bargain `notesOf` already takes with HLC stamps.
- **A foreign id still sorts.** An id that did not come from `systemIdSource`
  — a peer on another build, a hand-shaped fixture — orders arbitrarily but
  deterministically, and no reader breaks.

The rejected alternative is the minimum stamp across the Trip's registers. It
is sound (a min cannot move once the earliest op has folded, and every replica
holds identical stamps) but it costs a scan per Trip per render, and it is a
*proxy* for the id's own timestamp rather than the thing itself.

`sourceTrips(state)` is therefore `visibleTrips(state)` sorted by id
descending, and it lives in `trip.ts` beside `visibleTrips` and
`tripSections`. Every visible Trip is offered — closed, active and Draft alike
(J8, on S7's `TRIP`-dimension precedent, and because copying only *reads* the
source). Story 14's *a past one* is read as the motivating case; conflict 4
records that and routes the wording to requirements rather than resolving it
silently.

---

## 5. `/trips/new` gains `START FROM`, first (J10–J13)

**The row order changes and the focus does not.** `START FROM` sits above
`NAME`, which is §5's ledger-line order gaining its one stated exception — it
is the row answered before the Trip is conceived, and it changes what every
row below it means — while the caret still lands in `NAME` on mount.

| State | Value | Field line(s), field-level mono |
|---|---|---|
| unchosen | muted `NONE ›` | `A PAST TRIP'S LIST, TASKS AND NOTES CAN COME ACROSS` |
| chosen | the Trip's name in ink, `›` | `COMES ACROSS · 35 ENTRIES · BRING-COUNTS · 7 TASKS, UNTICKED · 4 NOTES` <br> `STARTS FRESH · PACKING · JOURNEYS · OUTCOMES · DATES · PARTICIPANTS` |

The anatomy is Add gear's `HOME` row: 48px bordered, mono label, value right
with a `›`. The second chosen line is where **`PARTICIPANTS` is disclosed
before the Trip exists**, which is J17's answer to the inert-rows problem and
the reason no per-row explanation is drawn later.

**The row is absent in a household with no other Trip** — not disabled, not
drawn over an empty picker. The withdrawal rule, and the same answer §1 gives
an empty gear list's withheld `PACKING ›`.

**The picker is a `Sheet` at every width** (J9): the Home picker's pick mode —
bare rows, single select, selection closes, **scrim dismisses**, because it is
a selection and not a decision. Title `Start from`. Its first row is
`Nothing — start empty` / `A BLANK GEAR LIST` / `● NOW`, and that row **is**
the clear; there is no `✕` on the field row. Rows carry the name (prose
sentinel `Unnamed trip`) over a mono meta of **only what carries over** —
`JUL 2025 · 35 ENTRIES · 7 TASKS · 4 NOTES`, each segment absent at zero,
`NO DATES` in the month slot. **`PIECES` is never on that line**, because
Participants do not copy and a Piece count would name a number the copy cannot
have. Footer fact: `ANY TRIP · PACKING, DATES AND PARTICIPANTS DO NOT COME
ACROSS`.

From Split up the app's standing pattern is a popover, and the popover
primitive is unbuilt with six waiting callers and no board. **S14 does not
draw the seventh**: the sheet is the picker at 900 and 1024 too, and it
converts with the other six when a round finally draws one. The
`technical-debt.md` entry gains a seventh caller, not a new argument.

**The name does not prefill** (J11), and the losing candidate is drawn beside
it. A prefilled `Vosges 2025` ungates the CTA, so the fastest path through the
screen creates a second Trip with an identical name — in the household that
keeps recurring Trip types, which is the household this slice is for. There is
no rename op for a duplicate to be repaired by, and the duplicate lands in the
very picker this round makes load-bearing.

`Create trip` and `NAME IS THE ONLY REQUIRED INPUT` are unchanged (J12), and
the back link follows the route in: `‹ VOSGES 2025` when the second door was
used, `‹ TRIPS` from the list.

---

## 6. The trip screen: a header fact and a footer (J1–J3, J7, J18–J20)

### 6.1 Provenance is one line in the header block

Beneath the dates: mono 11 muted `STARTED FROM VOSGES 2025`, every width,
**not dismissible and not a route**. It is `from_trip_id`'s one reader, folded
and unread since S6.

- Folded but unnamed takes the prose sentinel, `STARTED FROM UNNAMED TRIP`,
  CSS-uppercased as `REMOVE ON ALPS 2026` is — a name slot takes the name
  sentinel.
- Tombstoned, or not folded on this Device: **the whole line goes** (J19).
  Never `STARTED FROM —`. The register keeps folding in every case; the
  *surface* is what withdraws. This is S5's ring rule, and the fixture's
  second probe is exactly this arrival.

**It is a property of the Trip, not of the gear list** (J20), so it renders in
the header block and **not** in the builder's right pane — which has no header
block and edits the one register provenance is not about. §5b H, the
over-claim band's *property of the list, not of a route*, is deliberately not
extended by analogy: a claim is a fact about listed gear, and this is not.

### 6.2 The suggestion band retires, and three strings with it

`VOSGES 2025 LIST · 24 MATCH THIS DEPOT`, `ADD ALL` and `DISMISS` leave
`Screens B`'s 1024 builder. They cannot ship beside a copy that materialises
at creation: by the time that pane renders, all 24 Entries are already on the
list, so `ADD ALL` has nothing to add and `DISMISS` nothing to decline. The
count string goes for a second, independent reason — J15 filters nothing, so
there is no non-matching remainder to count. **No replacement band at any
width**; the pane opens on its group headers.

The one honest cost: S7's spec sentence handing the band to S14 as
*`from_trip_id`'s reader* is discharged by the header line instead. The spec
is dated and stays as written; this is the record of what changed.

### 6.3 The footer: two controls, opposite registers, destructive last

At the screen's foot, **after** the phone's add affordances, under a 1px rule:

1. accent mono `START A NEW TRIP FROM THIS ›` — accessible name
   `Start a new trip from Vosges 2026`, routing to `/trips/new` with the
   source pre-chosen (filled and clearable on arrival), on **any** Trip at
   every phase;
2. attention mono `DELETE TRIP` — accessible name `Delete Vosges 2026`,
   **always the screen's last element, at every width**.

Both are standalone controls and therefore drawn ≥48 with no hit extension
(§5b O). Neither folds, re-docks or becomes a button in a pane mode: unlike
`+ NEW`, neither accompanies the tab bar, so there is nothing for a pane mode
to re-dock. The footer sits after the add affordances rather than between the
panels, because **a destructive control never interrupts a list**.

`DELETE TRIP` carries **no `▲`**. The glyph is the attention class generally,
but the rule §12 states for a *confirm* is narrower: only an action that can
discard **unsynced** work carries one, and sign-out-this-device is the single
place in the app that qualifies. A tombstone is an ordinary op that syncs.

`/trips/:id` is the only door (J6). The closed ledger row keeps `REOPEN`
alone: a destructive control at the end of that row would sit a thumb-width
from the one control that brings a Trip back.

### 6.4 The confirm

`ui/Confirm`, H3's one shape — title, then the conditional mono block between
title and answer (bare 12px lines, 10 apart, no box), then the answer, then
the note.

```
Delete Tessin 2025?                    (prose sentinel: Delete Unnamed trip?)

7 TASKS
4 NOTES
35 ENTRIES · 59 PIECES
56 OUTCOMES · 1 LOST

Permanent. No route puts a trip back.
The depot is untouched. An entry lists gear; it never holds it.

[ Delete trip ]  [ Cancel ]
```

Four lines in the **trip screen's own order**, outcomes last because outcomes
are the one register that screen does not carry — they are F5's. Every segment
is **absent at zero** (G3), `N NOTES` counts discarded ones (I16), and **an
empty Draft gets no block at all**: the sheet is simply shorter, and both
fillers were drawn and refused (`0 ENTRIES · 0 TASKS · 0 NOTES` writes three
zero segments four rounds after G3; `NOTHING RECORDED YET` says less than the
title already does).

The answer is ink, the depot line is muted — `Confirm`'s `description` and
`note` props, which is precisely the split S11's H9 added them for. The
primary is §12's **bordered-attention** 48 (never a filled red button; the
reopen confirm's accent primary is for a confirm that throws nothing away),
Cancel is ghost, the **scrim withholds dismissal** because this is a decision,
and Escape closes.

`Are you sure?`, `▲ 35 entries will be lost` and `Trip deleted. UNDO` are all
named on the board as **not written, deliberately**.

### 6.5 Afterwards, and the UNDO rule's exception (J4)

`navigate('/trips')`, no toast, and the list is already correct through
`visibleTrips` — as are whereabouts, claims, the `TRIP` dimension and the nav
count.

**The standing interaction rule *"UNDO appears after every change"* gains its
first stated exception**, and this round is where it was found. No op restores
a Trip, so an UNDO would offer a route the catalogue does not hold — the exact
failure the withdrawal rule exists to prevent. The exception is *a confirmed
destructive act carries no UNDO, because its undo is the Cancel, taken before
instead of after*, which is also why invariant 15 asks for a confirm at all.
`trip.deleted` is the only such act in the MVP. The rule now lives amended in
`design/README.md`'s Interactions section.

---

## 7. What the copy does not take, and the first impression that follows (J17)

Participants do not copy. Story 14 and [domain §9](../domain-model.md) both
enumerate what carries over and Participants are in neither, and §4.5's batch
has no `trip.participant_added`. Dates do not copy either, and the domain says
so in as many words.

So a Trip started from a hüttentour list lands with **every per-person Entry
inert**: line kept, **no control at all**, meta `PER-PERSON · NO PIECES`. That
is ruling E9 unaltered, doing S14's work with no new code and no new string —
zero circles are not a control, and the sheet the body would open would open
on nobody.

**The trip screen adds nothing to explain it.** The participant `+` ghost the
rows are waiting for is one scroll up in the same header block, and the
disclosure was already made at J10's second line, before the Trip existed — *a
fact belongs at the decision, not in an explainer after it*. A per-row
`ADD PARTICIPANTS ›` settle route was drawn and refused: N identical routes to
one control on one screen, against a ruling that says such a row renders no
control.

**Conflict 3 is left open on purpose.** The exclusion is an enumeration in a
story rather than a reasoned rule, so overturning it is a story change through
the [requirements process](../../CLAUDE.md), not a frame and not a spec. The
round's recommendation stands as written: if the household hits this in use,
the question to put to requirements is whether story 14's list should gain
Participants — not whether the design should paper over it.

Two smaller things the round settled and this slice therefore does not touch:

- **`NOT KEPT IN THE DEPOT · CLEARED AT CLOSE` keeps its wording** (J14). The
  phrase is about *this* Entry on *this* Trip and stays true; the copy is a
  new Entry, minted by the batch, on a Trip that has not closed. The reading
  that makes it false treats the name as an identity, which is the one thing a
  trip-only Entry does not have — invariant 9 forbids two Trips *referencing*
  one, not two Trips each holding their own.
- **Retired gear copies unfiltered** (J15), and the new list draws the
  `RETIRED 2025 · KEPT IN LEDGER` treatment it already owns. Filtering would
  decide silently, on the Quartermaster's behalf, that a retired tent is not
  being replaced before the trip.

---

## 8. What this slice deliberately does not build

- **No history screen and no fourth destination.** Story 14's first criterion
  is met by surfaces that already exist (§5m's opening).
- **No restore for a deleted Trip**, and no hint of one in the copy.
- **No `trip.entry_*` rename, no Note edit, no Task removal.** Sync §9's two
  named requirements gaps stay gaps and stay routed to the requirements
  process.
- **No popover.** The seventh waiting caller is recorded, not drawn (J9).
- **The three consolidations `technical-debt.md` named this slice for** —
  the generic `writeEntity`, the stamp comparator's lift into `order.ts`, and
  the `GEAR LIST` band component. Declined deliberately, to keep the MVP's
  last slice to its own scope; both index entries have already been corrected
  to name the trigger rather than this slice.
- **No change to F5.** A copied Trip has no outcomes and a deleted Trip has no
  screen, so §7's surfaces gain nothing.
- **No change to `TripCard` or the closed ledger row.** I5 upheld: no sixth
  line, and a Trip's origin does not belong in the list that chooses between
  Trips.

---

## 9. Tests

**Tier 1 — the fold and the selectors.**

- `trip.deleted` sets the tombstone; a re-delivered one is idempotent; a
  `trip.deleted` that **precedes** the `trip.created` it names still tombstones
  (the registers are independent and `writeTrip` creates the entity for any
  Trip op) — the mirror of S6's out-of-order `phase_moved`.
- `visibleTrips` and every one of its readers drop a tombstoned Trip; the
  `TRIP` dimension, whereabouts and claims are asserted directly rather than
  through the list, because those are the three that would be silently wrong.
- `tripStandingOf` over all three standings.
- `sourceTrips` — newest-created first by id, a foreign id still sorted, and
  the order **unchanged** across a rename and a phase move. That last one is
  the assertion §4 exists for: it fails against every register-stamp ordering.
- `startTripFrom` as a table: what is emitted, and — asserted explicitly —
  that **no** dates, participant, status, stage, outcome, consumed-count or
  posting op appears in the batch. Plus the Bring-count rule (§3.4: register
  present *and* the read non-null), the tasks arriving unticked by absence,
  the kept/unreviewed/discarded three-way on notes, and the entry-id remap
  with its dropped-segment case.
- Applying the batch to empty state and folding it produces a Trip whose
  `entriesOf` / `tasksOf` / `notesOf` match the source's, and whose packing,
  outcome and date reads are all the *absent* answers.

**Tier 2 — convergence.** The generator's completeness guard now requires
`trip.deleted` the moment the reducer folds it, so the arm lands in the same
commit as the handler — S13's inheritance, and no longer a schedule a slice
can choose. `trip.deleted` is a **root** register, so it joins the root arm;
it earns no arm of its own, because only a genuinely new entity-path *depth*
does (S13's dilution lesson, measured).

The property worth having beyond convergence: a template batch interleaved
arbitrarily with late ops for the **source** Trip converges to a copy that
does not mutate — which is §4.5's determinism argument stated as a test, and
the reason the copy is materialised at all.

**Tier 3 — the screens.** The delete control and its confirm at a loaded Trip
and at an empty Draft (the block's presence and absence); both non-live
standings, including that Desktop draws no back link and 393 draws two routes;
`START FROM` present, absent in a one-Trip household, and its two field-line
states; the picker's first row clearing a choice; the provenance line in all
three of its states, withdrawal included; and the builder pane asserting the
band's **absence**, which is the only way a retired string stays retired.

**Backward compatibility.** `fixtures.s14.test.ts` (§1.3).

---

## 10. Documentation owed

- **`docs/architecture-design.md`** — §12.22, the consequences of S14;
  §8.3's landed list gains S14 and the MVP is complete; §8.5's story-13 note
  and §8.1's `12 → 14` / `15 → 14` edges are discharged rather than changed.
- **`docs/sync-protocol.md`** — §4.4's `trip.deleted` row loses its
  *"waits for S14"* framing; §4.5's fourth gesture gains the sentence about
  the Entry-id map, which the protocol currently does not mention.
- **`docs/design/README.md`** — a code-authored block under §5m for whatever
  S14's code decides that J1–J20 do not reach, written **when the slice
  lands**. S9 round 4's lesson: a dated spec is invisible to the next design
  round, so the two findings in this document that no ruling reaches — the
  UUIDv7 ordering (§4) and the Bring-count register rule (§3.4) — belong
  there and not only here.
- **`docs/patterns.md`** — §2.3's needless-write catalogue gains the
  Bring-count case, which is the rule met inside a batch rather than at a tap.
- **`docs/technical-debt.md`** — the popover entry gains its seventh caller.
- **`CLAUDE.md`** — the S14 paragraph, and the status line that has said
  *"only S14 is left of the MVP"* since S13.

---

## 11. What moved while it was being built

The house convention since `trips-and-phases.md` §10: this document is left as
it was written, and what changed lives here rather than being edited back into
the sections it corrects. Everything below is also in `design/README.md` §5m's
code-authored block or in [§12.22](../architecture-design.md), because a dated
spec is invisible to the next design round (S9 round 4's lesson).

**1. The suggestion-band absence test should not be written, and was not.**
§9 asks for a Tier 3 assertion that the builder pane draws no
`VOSGES 2025 LIST · 24 MATCH THIS DEPOT`. The band was drawn at S7 and
**never built** — no string in `app/` or `ui/` has ever matched it — so there
is nothing to regress and the test would assert that we never built
something. §6.2's retirement was documentation from the start. The general
form: *a board drawn and never built leaves no code to delete, and a slice
retiring it owes the boards an edit rather than the suite a guard.*

**2. `N OUTCOMES` counts units, not lines.** §6.4 draws the fact block
without saying what its fourth line counts. `unpackTotals(...).resolved` is
F5's own arithmetic, so a Trip of two Entries whose Counted headlamp is ×3
reads `4 OUTCOMES`, not `2`. The two numbers standing beside each other in
that block deliberately count different things, which is why one says
ENTRIES and the other OUTCOMES. My first test asserted `2` and the code was
right.

**3. The carry line and the delete confirm count notes differently, and both
are correct.** §5's `COMES ACROSS · … · 4 NOTES` names what the copy will
take — kept *and* unreviewed, never discarded — while §6.4's `4 NOTES`
counts every Note the Trip holds, discarded ones included, because a
discarded Note never vanishes from its own Trip (I16). This is the one place
in the app where those two numbers legitimately differ on the same Trip.
Neither should be "fixed" to match the other.

**4. `START FROM`'s unchosen value is muted; the Participants row's `None` is
ink.** §5's table says *muted `NONE` unchosen* and does not say why the row
directly below it differs. An empty Participants list is a *state of the
Trip* the ledger states; an unchosen source is a decision not yet taken.
Muted says *nothing here yet*, ink says *this is the value*.

**5. The `START FROM` row's presence test is `sourceTrips`, not the raw
map.** §5 says the row is absent in a household with no other Trip. Written
as `Object.keys(state.trips).length > 0` that is wrong: the map holds
tombstones, so a household whose only Trip has been deleted draws a row
opening a picker containing nothing but its own clear row — the dead
affordance J13's withdrawal exists to prevent. It reads the same list the
picker draws, so the row and its contents cannot disagree. Caught by a test.

**6. `Trip.tsx` was already rendering deleted Trips, which §2 predicted and
understated.** The spec says the screen "would render a deleted Trip in
full"; the failing test printed that Trip's own date range before the fix
landed. Worth recording as a defect this slice closed rather than as a
consequence it introduced — the tombstone has been authorable only since
task 1, but the guard has been wrong since S6.

**7. `unpackTotals` is a fifth reader the delete confirm needs**, alongside
`taskCounts`, `noteCounts` and `listTotals`. §6.4 names the four lines and
not the four selectors; all four already existed and none needed widening.
