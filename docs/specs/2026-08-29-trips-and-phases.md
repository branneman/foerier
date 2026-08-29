# S6 — Trips and phases

The implementation design for [architecture §8.3](../architecture-design.md#83-the-slices)'s
**S6**: six op types, the fourth aggregate reaching the fold, three screens, and
the phase control that moves **both directions with the next thing to do
stated**. It delivers story **5** and advances story **32** (the phase machine).

This is a **feature spec**: it is retired once the slice has shipped. It settles
what the durable docs left to the implementer and records the decisions taken
before any code was written. It does **not** revisit anything above it — the op
envelope, the HLC, per-field LWW, the op catalogue and the evolution rules are
settled in [`sync-protocol.md`](../sync-protocol.md), and every ambiguity here is
resolved by reading that document, not this one.

**The boards win.** Where this spec and `docs/design/*.dc.html` disagree, the
boards are right and this spec is wrong. `Screens B` §02 carries the Trips list,
the phase model, the SET PHASE excerpt and the no-dates card variant; `Screens B`
§02B carries the reopen confirm; `Screens A` §04 carries `Trips roomy — cards
2-up`; `User Flows` F3 carries the New Trip flow. `docs/design/README.md` §5 and
§5a are the written handoff.

**A later board round applied that rule to this spec, after the slice had
shipped.** `Screens B` **02A** redrew every S6 surface and reversed several
decisions §4 and §6 record. Those sections are left exactly as written — they
are the record of the design that was taken, and rewriting them would erase the
fact that the boards changed their mind rather than that the implementer got it
wrong. [§10](#10-what-changed-during-implementation) names every one, and
`docs/design/README.md` §5 plus `Screens B` 02A are the shipped authority.

S6 is the **first Trip slice**, so it is the slice that decides how the Trip
aggregate is shaped in `shared/` — and eight later slices (S7 · S8 · S9 · S10 ·
S11 · S12 · S13 · S14) extend what it lays down. Where a decision here is
load-bearing for them, it says so.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types | **6** — `trip.created`, `trip.renamed`, `trip.dates_set`, `trip.phase_moved`, `trip.participant_added`, `trip.participant_removed` |
| Endpoints | **None.** S6 is client-side plus six op types |
| `trip.created` / `trip.renamed` payload | Settled as **`{name: string｜null}`** — the question [sync §4.4](../sync-protocol.md) left open, closed the way S4 closed `person.renamed` |
| Dates on the wire | **`start` / `end`** in the payload, **`startDate` / `endDate`** in state — the register map's names, not the payload's, exactly as `gear.owned_count_set` already splits |
| A date is read **tolerantly** | `readString`, verbatim. No `YYYY-MM-DD` gate ([§1.4](#14-a-date-is-a-string-and-the-reader-does-not-check-it)) |
| Absent `phase` register | Reads **`draft`**. Stated once, in `shared/src/selectors/trip.ts`, and read through one function everywhere |
| An unrecognised phase | **Not active**, files under `PLANNED`, drawn verbatim, states no next step ([§3.4](#34-an-unrecognised-phase-is-not-a-draft)) |
| `phase = "draft"` | Written by the **reducer** at `trip.created`, not carried in the payload |
| `from_trip_id` | **Folded, unused.** S14 gives it a reader; S6 owes the fixture that pins it |
| Trip sections | **`ACTIVE` · `PLANNED` · `CLOSED`**, each totally ordered ([§3.5](#35-three-sections-two-date-orders)) |
| `DAY N` | The **`phase` register's own stamp**, in local calendar days. No new field, no new op ([§3.6](#36-day-n-comes-from-the-register-that-already-carries-it)) |
| Routes | **`/trips`, `/trips/new`, `/trips/:id`** — three, and `/trips/:id` is the header S7 builds under |
| The card's CTA | Names **the destination that exists** — `OPEN ›` at S6, not `Continue pack-out` ([§6.1](#61-the-cta-names-the-destination-that-exists)) |
| The progress line | Falls through to a **next-step line**; there are no Entries to count ([§6.2](#62-the-progress-line-falls-through-to-a-next-step-line)) |
| Entering `closed` | **Unguarded**, per §8.3. Nothing can be open until S10 |
| Leaving `closed` | **Confirmed at S6** — invariant 19 is the domain's, not story 11b's. S11 fills the sheet's body ([§6.3](#63-the-reopen-confirm-ships-now-with-an-empty-body)) |
| Sidebar count | Every **non-deleted** Trip — the size of the list the destination opens |
| `shared/` slicing engine | **Untouched.** Trip membership is S7's row in the dimension table |
| S4's missing fixture | **Paid here** ([§5.5](#55-s4s-fixture-debt-paid-here)) |

---

## 1. Six ops, and the two questions they close

### 1.1 The register map is the contract

[Sync §3.7](../sync-protocol.md) already draws where the field-granularity
boundary sits inside the coarse Trip aggregate. S6 builds the **root** row and
the **participants** row of that table and nothing else:

| Entity path | Registers | Built by |
| --- | --- | --- |
| *(root)* | `name`, `phase`, `start_date`, `end_date`, `from_trip_id`, `deleted` | **S6** (`deleted` is S14's op; the register is not written here) |
| `participants.<person_id>` | present / absent | **S6** |
| `entries.<entry_id>` | … | S7 · S9 · S10 |
| `entries.<entry_id>.pieces.<person_id>` | … | S8 · S9 · S10 |
| `tasks.<task_id>` | `text`, `ticked` | S13 |
| `notes.<note_id>` | `text`, `entry_id`, `kept` | S12 |

So `TripState` gains the root registers and a `participants` map, and gains
nothing else. The four nested maps are S7's onward; a slice adds its own row
rather than pre-declaring everyone else's.

### 1.2 `trip.created` and `trip.renamed` settle `name`

[Sync §4.3](../sync-protocol.md)'s note lists the five `name` rows settled so
far — `place.recorded`, `place.renamed`, `gear.recorded`, `gear.renamed`,
`person.recorded` — and S4 closed the sixth, `person.renamed`, with the general
argument rather than a new rule. The two Trip rows are the seventh and eighth,
and §4.4 types them `{name}`.

S6 settles both as **`{name: string｜null}`**, folded through
`writeNullableIfPresent`. There is again no carve-out to argue about:
[§1.3](../sync-protocol.md) states the absent-versus-null distinction generally,
`TripState.name` is `Register<string | null>` like every other name register, and
the reducer's rule — *a register whose declared type includes `null` takes an
explicit `null` as a clear* — already covers it.

`trip.created` and `trip.renamed` become **one handler under two keys**, the
pairing `place.recorded`/`place.renamed` and `person.recorded`/`person.renamed`
already have — except that `trip.created` writes a second register (§1.3), so the
shape is `gearRecorded`'s rather than `setPlaceName`'s.

The **authoring** builders keep a `string` parameter, exactly as
`personRecorded` does: no screen can author a Trip with no name, and the nullable
type exists for a *reader* meeting an op some other build emitted.

### 1.3 `phase = "draft"` is the reducer's, not the payload's

§4.4 says `trip.created` "creates the Trip; seeds `name`, `phase = "draft"`, and
the template provenance" — and its payload is `{name, from_trip_id?}`. The phase
is therefore **written by the handler**, stamped with `trip.created`'s own clock,
and is not a field on the wire. Three properties follow, and all three are worth
having:

- A `trip.phase_moved` that arrives **before** its `trip.created` wins, because
  its clock is strictly later. The trip is `pack_out` and then stays `pack_out`
  when the creation is finally delivered. Out-of-authoring-order delivery is
  §8.2's stated case and this is it, resolved by the ordinary rule.
- A re-delivered `trip.created` (our own op returning through pull, §8.3) writes
  an identical value on an identical stamp and loses on `<= 0`. Idempotent
  without a special case.
- Nothing in the payload can carry a phase, so no client can create a Trip
  already `closed`. Not a guard — an absence.

`from_trip_id` **is** folded, into `TripState.fromTripId`, and nothing at S6
reads it. That is deliberate: S6 owns `trip.created`, §5.4's frozen list makes
its payload shape permanent, and S6's fixture is what pins it — a field the
reducer silently dropped is a field the fixture could not prove. The builder does
not accept it (there is no caller until S14), so the fixture carries a
hand-written probe op, exactly as S3's fixture carries tags no builder of ours
can author.

### 1.4 A date is a string, and the reader does not check it

`trip.dates_set {start?: date｜null, end?: date｜null}` is the first op in the
catalogue whose payload is nullable **by the catalogue's own hand** rather than
by a slice settling it, and the reducer has been waiting for it by name —
`writeNullableIfPresent`'s doc comment says so:

> `trip.dates_set`'s `start`/`end`, a later slice's `date｜null`, is exactly this
> shape.

Two independent registers, each following the absent-versus-null rule
separately: `{start: "2026-08-14"}` moves the start and leaves the end alone;
`{end: null}` clears the end and leaves the start alone. The screen therefore
emits only what changed, and clearing is `null`, never omission.

**The payload keys are `start` and `end`; the registers are `startDate` and
`endDate`.** The catalogue names the payload for the field it sets without
repeating the register — the same split `gear.owned_count_set{count}` already
has, and for the same reason. Named here so nobody "fixes" it later.

**No format gate.** A `readDate` that refined to `YYYY-MM-DD` and reported
anything else `absent` would be a reader rejecting a quartermaster's work to
enforce a spelling, which is the thing [§5.3](../sync-protocol.md) forbids and
§4.3's `TagString` note argues at length. So dates go through `readString`, are
stored verbatim, and are **drawn verbatim**. Two consequences, both acceptable:
a malformed date is visible rather than silently dropped, and the date sort
(§3.5) is lexicographic — which is exactly correct for `YYYY-MM-DD` and remains
*total* for anything else.

There is likewise **no end-before-start guard**. The domain gives no invariant
for it, story 5 asks for none, and the two dates are independent registers that
two devices may legitimately write concurrently — a guard would have to decide
which of two valid writes to discard.

### 1.5 Participants are per-person-id registers

[Sync §3.4](../sync-protocol.md) puts trip participants in the same row as gear
tags: **not one register holding an array**, but one register per member. The
handler is therefore `gearTagWritten`'s, with `person_id` for `tag` and
`participants` for `tags` — the same function shape under two keys, `true` for
`trip.participant_added` and `false` for `trip.participant_removed`.

The whole concurrency story is again the register key rather than the code: two
devices adding *different* Participants address different registers and both
survive; an add racing a remove of the *same* Participant is one register
resolving by plain LWW. `false` is a real value carrying a real clock, not a
deleted key — dropping the key would let a concurrent re-add win by arrival
order.

This is what makes S8's "add a Participant later and they get a Piece **with no
backfill op**" work: Pieces are derived from this map, so the map has to be a
map.

---

## 2. State shape

`shared/src/state.ts` gains one interface and one field:

```ts
export type PhaseValue =
  | 'draft' | 'pack_out' | 'on_trip' | 'unpack' | 'closed'
  | (string & {})

export interface TripState {
  id: string
  name?: Register<string | null>
  /** Seeded `draft` by `trip.created` (§1.3); moved by `trip.phase_moved`. */
  phase?: Register<PhaseValue>
  /** `YYYY-MM-DD` by convention, verbatim in fact (§1.4). */
  startDate?: Register<string | null>
  endDate?: Register<string | null>
  /** Template provenance. Folded at S6, read at S14 (§1.3). */
  fromTripId?: Register<string>
  /** S14's `trip.deleted`. Declared, never written here. */
  deleted?: Register<boolean>
  /** Per-person-id registers (`sync-protocol.md` §3.4), like `GearState.tags`. */
  participants?: Readonly<Record<string, Register<boolean>>>
}

export interface DepotState {
  readonly places: …
  readonly gear: …
  readonly people: …
  readonly trips: Readonly<Record<string, TripState>>
  readonly unfolded: UnfoldedOps
}
```

`PhaseValue` is **open past its five members**, exactly as `KindValue` is, and
for the identical reason: §5.3 obligation 4 stores an unrecognised enum value
verbatim, and a closed union would make the tolerant reader impossible to write
without a cast. §3.4 says what the app then does with one.

`declared, never written` for `deleted` is a real choice and not laziness: it
costs one optional field, it keeps `TripState` matching §3.7's row, and the
alternative is S14 editing a type three slices' worth of code already reads.

**`DepotState` is now the fold of everything, not just the depot.** The name
stays. Renaming it reaches `DepotStoreState`, `DepotProvider`, `useDepot`,
`DepotView` and every screen in three workspaces, and S5 is in flight across
those same files. Recorded as a misnomer, not fixed here.

The reducer gains a `writeTrip`, which is `writePlace`/`writeGear`/`writePerson`
copied a fourth time. Four copies of a six-line function is the point at which a
generic `writeEntity<K>` starts to look right; it is **not** taken, because the
generic version needs the map key and the entity type as parameters and reads
worse than the thing it replaces, and because each copy is read far more often
than it is written.

---

## 3. Selectors

One new file, `shared/src/selectors/trip.ts`, beside `owner.ts` and
`whereabouts.ts` — the same shape of problem (a fact several surfaces must agree
on) solved the same way.

### 3.1 The phase table

A phase is **a row in a table**, the pattern S3 established for dimensions and S4
extended to groupings:

```ts
interface Phase {
  id: PhaseKey                 // 'draft' | 'pack_out' | 'on_trip' | 'unpack' | 'closed'
  label: string                // 'DRAFT' · 'PACK-OUT' · 'ON TRIP' · 'UNPACK' · 'CLOSED'
  /** Invariant 17: only these three give a Trip's arrangement effect. */
  active: boolean
  /** The next thing to do, stated (§8.3's UI requirement). `null` when closed. */
  next: string | null
}
export const PHASES: readonly Phase[]   // in order, and the SET PHASE sheet's rows
```

The order in `PHASES` is `draft → pack_out → on_trip → unpack → closed` and is
the order the sheet draws. It is **not** a transition graph: invariant 16 says
any move in either direction is expressible, so there is nothing to encode
beyond the sequence itself.

### 3.2 `phaseOf` — and an absent register reads `draft`

```ts
export function phaseOf(trip: TripState): PhaseValue
```

An absent `phase` register reads **`draft`**. This is S4's `ownerOf` rule
transplanted: the fold conflates nothing — absent and an explicit `"draft"` stay
different facts about the log — but every reader treats them alike, and saying
so **once** is what stops the list, the chip and the sections drifting apart.

It is reachable: a trip whose `trip.phase_moved` was delivered but whose
`trip.created` was not exists with a phase; a trip addressed only by
`trip.participant_added` exists with none. `writeTrip` creates the entity for any
trip op, out of authoring order, exactly as the other three maps do.

`isActive(trip)` is `PHASES` lookup + `.active`, and is the **only** definition
of active-ness in the codebase. S7's claim selector, S9's whereabouts and S10's
close gate all call this one function.

### 3.3 The list selectors, and why they sort

`depot.ts`'s rule applies unchanged and is worth restating, because it is the
reason these functions exist at all:

> `Object.keys` returns insertion order, which is the order this replica happened
> to receive ops in — two devices holding identical state would list the same
> depot differently. The sort is not cosmetic; it is what makes the display
> converge.

```ts
export function visibleTrips(state): readonly TripState[]     // non-deleted, total order
export function tripSections(state): TripSections             // { active, planned, closed }
export function tripLabel(trip): string                       // the name, or '—'
export function participantIds(trip): readonly string[]       // present registers, sorted
```

`participantIds` sorts by **id**, which is total and replica-identical; the
*display* order is by person label, and the screen gets it by filtering
`sortedPeople(state)` — the list the People screen and the owner picker already
share, so "the third one down" means one Person everywhere.

### 3.4 An unrecognised phase is not a draft

A peer on a later build can fold a phase this build has never heard of. It must
go somewhere, and every available answer is a small lie except one:

- **Not active.** Invariant 17 enumerates exactly three active phases by name; a
  value that is not one of them cannot give a Trip's arrangement effect. This is
  the conservative direction — an unknown phase holds no claims and reports no
  whereabouts, so an old build never *over*-states what a Trip is doing.
- **Filed under `PLANNED`, not `DRAFTS`.** The section holding non-active,
  non-closed Trips is therefore named for the class rather than for `draft`,
  because calling an unrecognised phase a draft states something false. `draft`
  is simply its most common member.
- **Drawn verbatim in the chip**, the way an unrecognised `kind` is
  (`dimension('kind').format` returns the raw value). Inventing a casing for it
  would be coercion.
- **States no next step.** The next thing to do is a fact of the phase table, and
  there is no row.

### 3.5 Three sections, two date orders

| Section | Members | Order |
| --- | --- | --- |
| `ACTIVE` | `pack_out`, `on_trip`, `unpack` | start date **ascending**, undated last |
| `PLANNED` | `draft` + anything unrecognised | start date **ascending**, undated last |
| `CLOSED` | `closed` | start date **descending**, undated last |

Ascending forward and descending back, because the two sections answer opposite
questions: *what is coming* wants the soonest first, *what happened* wants the
most recent first. Undated stays last in both — a Draft usually has no dates
(story 5), and burying the dated ones under them would be wrong in the forward
sections and meaningless in the closed one.

Both orders break ties by **name (case-insensitively, then exactly), then id**,
which is `byNameThenId`'s rule and makes each section **total**. Two devices with
identical state draw the same list; that is the whole requirement, and it is why
the tiebreak chain runs all the way down to the id.

The boards draw one active card, but nothing constrains the count to one:
over-claim is guarded, not prevented (§5.2), so two active Trips are a reachable
and legitimate state. The section renders N cards.

### 3.6 `DAY N` comes from the register that already carries it

The board's phase chip reads `PACK-OUT · DAY 2`, and says where the count comes
from: *"the day count runs from the phase change, not from dates."*

That moment is already recorded — it is the **`phase` register's own stamp**. No
new field, no new op, no migration, and it is identical on every replica because
the register is. This is `recordedAt`'s trick from S3, applied to one register
instead of the earliest of many.

```ts
export function phaseDay(trip: TripState, now: number): number | null
```

Local **calendar** days, not elapsed milliseconds: `DAY 2` should arrive at
midnight, not 24 hours after the tap. `DAY 1` is the day of the change, which is
what the board's `PACK-OUT · DAY 1` on a same-day card shows. `null` when the
register is absent, and the chip then draws the label alone.

The HLC's physical component is the authoring device's wall clock, bounded by
`DRIFT_BOUND_MS` (five minutes). For a day count that is far inside tolerance,
and the failure mode of a badly-skewed peer is a chip reading `DAY 2` on the
first day — visible, harmless, and not worth a second field to prevent.

The count is drawn for **active** phases only. A Draft has not started anything,
and a closed Trip's card is a ledger row carrying its dates.

### 3.7 The slicing engine is untouched

`slice.ts` gets no new row. Trip membership ("Gear not in any Trip") is
[§8.5](../architecture-design.md#85-where-story-13-attaches)'s **S7** dimension,
because it needs Entries — a Trip with Participants and no gear list says nothing
about any piece of gear. The Trips list itself carries no slice bar; the boards
draw none, and three sections of at most a few dozen rows do not need one.

---

## 4. Screens

### 4.1 `/trips` — the Trips list

`Screens B` §02's phone frame, and `Screens A` §04's `Trips roomy — cards 2-up`.

- Title `Trips`; `+ NEW` to `/trips/new`.

**The section names are the selector's, not the screen's.** The board draws a
header for `CLOSED` alone — the active card and the draft card sit under the
title with nothing between them, because a header over a single card is noise.
`ACTIVE` and `PLANNED` are how §3.5 partitions; only `CLOSED` is drawn.

- **`ACTIVE`** — one card per active Trip: name with the `▸` glyph, the phase
  chip (`PACK-OUT · DAY 2`), the dates line (mono, **dropped entirely** when
  there are none — the board draws that variant), participant circles, the
  next-step line (§6.2), and the full-width CTA (§6.1).
- **`PLANNED`** — dashed-border cards: name, `DRAFT · 0 GEAR LISTED`, `OPEN ›`.
  The `0` is a fact at S6 and stays true until S7 gives it something to count.
- **`CLOSED`** — ledger rows: muted name, mono meta (`JUL 2025` from the start
  date, drawn from the dates that exist), and `REOPEN`, which opens §6.3's
  confirm. The board's `54 PIECES · 1 LOST` waits on S7 and S10.
- Empty: `No trips.` — the line `/trips` draws today, kept.

The card is **`app/src/components/TripCard.tsx`**, not `ui/`. `GearRow` earned
its place in `ui/` by having two callers in two screens; `TripCard` has one. It
goes to `ui/` when S7 or S9 gives it a second.

The 2-up fold at Roomy is a **container query** on the card's own grid —
[frontend-design §3.2](../frontend-design.md), and the board says it in as many
words: *"Same components as 393 — `@container` picks the layout, not the
viewport."* Nothing about the card's contents changes, so nothing here is a media
query.

**No two-pane view.** `DepotView`'s split is the Depot's; the board's 1024 Trips
frame is the **gear list builder**, which is S7's whole screen. `/trips/:id` is
its own view at every width, and S7 is what turns it into two panes.

### 4.2 `/trips/new` — F3's first step

`User Flows` F3: *Trips → `+ NEW` → name · dates · participants → gear list
builder*. A screen and not a sheet, following `/add`: F3 is labelled *"desk work,
dense picker, keyboard-friendly"*, and Add gear settled that shape already.

Rows, in the order the ledger line is written: **`NAME`** (required) ·
**`DATES`** (two optional native date fields) · **`PARTICIPANTS`** (§4.4's
picker) · the primary `Create trip`.

Creating emits, in one authoring burst on the store's single queue:

1. `trip.created{name}`
2. `trip.dates_set{start?, end?}` — **only if a date was entered**. Not
   `{start: null, end: null}`: writing a clear over a register nothing has ever
   written is a needless op that moves a stamp.
3. one `trip.participant_added{person_id}` per Participant.

Several ops in one gesture is ordinary ([§4.5](../sync-protocol.md) names three
of them), and needs no transaction: every op merges independently.

Then navigate to `/trips/:id`, which is where F3's arrow points.

**The template branch of F3 (`? BLANK OR TEMPLATE`) is not built.** It is
`trip.created{from_trip_id}` and the materialised copy, which is S14.

### 4.3 `/trips/:id` — the trip screen

The header the `Gear list builder` board draws, built now, with the two panes
below it left to S7 — Find's `S8 · PIECES` pattern, and the People screen's
missing login half: *an element designed final that falls through to a simpler
variant until its slice lands.*

- `‹ TRIPS` back link; the Trip name as the title; `EDIT` toggle.
- Dates and participant circles beneath it — the board's own meta row.
- The **phase chip**, opening §4.5's SET PHASE sheet. The same chip the card
  carries, the same sheet.
- The next-step line (§6.2).
- The gear-list region: **`0 GEAR LISTED.`** and no add affordance. Honest, board
  copy, and no meta-text about a future release.

`EDIT` mode carries **rename**, **dates** and **participants** — story 5's
"and change that later", all three of them. It is the People screen's quiet mono
toggle, which is the Home picker's settled vocabulary (`design/README.md` §3c).
There is no `DELETE`: `trip.deleted` is S14's.

Each edit emits its own op when it changes and nothing when it does not — gear
detail's Edit sheet discipline, and the reason it matters is the same: a needless
write moves a stamp, and at S6 a moved `phase` stamp changes what `DAY N` reads.

### 4.4 The participant picker

`app/src/components/ParticipantPicker.tsx` — a `Sheet`, multi-select where the
owner picker is single-select, and otherwise its twin:

- One row per Person, in `sortedPeople` order, `aria-pressed` for chosen.
- A dashed **`+ New person`**, authoring `person.recorded` and selecting what it
  created — the Home picker's rule, inherited through `OwnerPicker`. Without it,
  discovering mid-flow that a Participant was never recorded is a dead end in
  the middle of the one screen designed to be finished in one sitting.
- **No confirm on removal.** The tag picker's rule: cheap and instantly
  reversible. Removing a Participant at S6 removes nothing else — S8's Pieces do
  not exist yet, and when they do, invariant 10 makes them derived rather than
  cascaded.

On `/trips/:id` a toggle emits immediately. On `/trips/new` there is no Trip to
address, so the selection is draft state and the ops are emitted with
`trip.created` (§4.2).

### 4.5 The SET PHASE sheet

`app/src/components/PhaseSheet.tsx`, opened from the phase chip on both surfaces.
The board's excerpt, exactly: five rows in `PHASES` order, the current one marked
**`● NOW`**, **any row tappable, backwards included**, and the footnote *"NO DATE
OR COUNT EVER MOVES A PHASE."*

Two special cases, and only two:

- **Entering `closed` is unguarded.** §8.3 says so explicitly, and it is honest
  rather than provisional: the close gate counts open outcomes (invariant 18),
  and until S10 nothing can be open. S10 adds the gate; S6 does not stub one.
- **Leaving `closed` confirms.** §6.3.

When the current phase is unrecognised (§3.4), no row is marked and a mono line
states the value verbatim above the rows. The five known rows stay tappable, so
a Trip is never stranded in a phase this build cannot leave.

---

## 5. Tests

### 5.1 Tier 1 — unit

- Each of the six ops as a register write: LWW by `(hlc, deviceId)`, a lost write
  propagating identity, an unknown field ignored and the op retained.
- `trip.created` seeding `phase = "draft"` with its **own** stamp; a
  `trip.phase_moved` at a higher clock arriving first and **surviving** the
  creation; a re-delivered `trip.created` changing nothing.
- `trip.created{from_trip_id}` folding into `fromTripId`.
- `trip.renamed` with a string, with an explicit `null` (clears), and absent
  (leaves alone) — §1.2's three cases.
- `trip.dates_set` writing `start` and `end` **independently**: one field present
  leaves the other register untouched; `null` clears one and not the other; a
  non-conforming date string stored verbatim (§1.4).
- Participants: two adds of different People unioning; add-vs-remove of the same
  Person resolving by plain LWW; a removal folding to `false` rather than a
  dropped key.
- `phaseOf` on an absent register reading `draft`; `isActive` across all five
  phases and one unrecognised one.
- `tripSections` — membership, both date orders, undated last, and **totality**:
  the same state fed in two insertion orders produces the identical list.
- `phaseDay`: `DAY 1` on the day of the change, `DAY 2` after local midnight,
  `null` on an absent register.

### 5.2 Tier 2 — convergence

§8.3's two named scenarios, plus one that comes free:

- **Concurrent phase moves resolve by plain LWW** — two devices moving one Trip
  to different phases converge to the same phase on both, whichever order the
  ops arrive in.
- **A Participant added on one Device and removed on another** — one register,
  plain LWW, and the loser's write is not resurrected by a later unrelated op.
- A `trip.renamed` racing a `trip.dates_set`: different registers, both survive
  in either delivery order. Free, and it proves the root's registers do not
  interfere.

### 5.3 Tier 3 — component

F3 (the New Trip screen: required name, optional dates, participants, the three
ops it emits); the Trips list's three sections and the empty state; the SET PHASE
sheet moving **backwards**; the reopen confirm; the participant picker from both
callers, including `+ New person`; the trip screen's EDIT mode emitting only what
changed.

### 5.4 The fixture rule

`shared/fixtures/s6-trips.ops.json` + `shared/src/fixtures.s6.test.ts`, captured
**in this slice**, per [§8.7](../architecture-design.md#87-what-every-slice-must-preserve-not-deliver)
and `testing.md`'s backward-compatibility group. It carries all six op types, a
`from_trip_id` probe (§1.3), an unrecognised phase probe (§3.4), a
non-conforming date probe (§1.4), and a `null` name — the last four
**un-authorable by our own builders**, standing in for a client on a different
build, exactly as S3's foreign-tag ops do.

### 5.5 S4's fixture debt, paid here

There is no `s4-*.ops.json`. §8.7 obliges **every slice from S2 onwards** to
capture fixtures for the op types in its §8.3 entry, and S4's spec §5.4 said "the
fixture rule from S3's spec §9.4 applies unchanged" without a file landing. So
`person.renamed` and `gear.ownership_set` — two op types whose wire format §5.4
has already frozen — are pinned by nothing.

S6 pays it: `shared/fixtures/s4-ownership.ops.json` +
`shared/src/fixtures.s4.test.ts`, captured from the current reducer. This is
weaker than a fixture captured at S4 (the format has had one slice to drift in,
and nothing would now catch it), and it is recorded as such — but it is strictly
better than the third slice from now discovering the same gap with three slices
of drift instead of one. Scoped to two op types and one test file; it changes no
behaviour.

### 5.6 Unchanged

**No Tier 2s and no Tier 4** — S6 adds no endpoint, and the server has no op
vocabulary. Tier 0 stays green across all workspaces; the golden-path Tier 5
stays green, and gains nothing: §8.3 gives the trip half of the golden path to
S10, where it is completable for the first time.

`App.test.tsx`'s *"gives Trips no count, because there are no trips yet"* and its
comment inverts — Trips get a count at S6, and that is the assertion that
changes.

---

## 6. Departures from the boards

Recorded here and in `docs/design/README.md`, following the precedent S3 set with
Add gear's `UNDO` and S4 with the `OWNER` row.

> **Superseded in part.** The `Screens B` **02A** design round, taken after S6
> shipped, overturned [§6.1](#61-the-cta-names-the-destination-that-exists)'s
> `OPEN ›` and half of [§6.2](#62-the-progress-line-falls-through-to-a-next-step-line)
> — the two NEXT strings, where the line is drawn, and which way the progress
> line returns. **Read `docs/design/README.md` §5 and `Screens B` 02A for what
> ships**; these sections stay as drawn, and
> [§10](#10-what-changed-during-implementation) lists the differences. The
> *rules* under both survive intact: a board's CTA copy still lands on the slice
> that builds its destination, and the next-step line is still what §8.3's
> "with the next thing to do stated" buys.

### 6.1 The CTA names the destination that exists

The board's active card carries `Continue pack-out`, and its draft card carries
`BUILD LIST ›`. **Neither destination exists at S6**: the gear list builder is
S7, the packing view is S9.

The repo's own rule decides it — *"an affordance that leads nowhere is worse than
a missing one"*, stated when the `ACCOUNT` row was held back until the Account
screen existed, and again on the People row. A button reading `Continue pack-out`
that lands on a screen with no gear list is worse than that: it does not lead
nowhere, it leads somewhere and lies about it.

So at S6 both read **`OPEN ›`** and go to `/trips/:id`, which is real. S7 gives
the planned card `BUILD LIST ›`, S9 gives the active card its phase verb. The
rule generalises, and is the reason this is a departure worth writing down rather
than a placeholder: **the CTA names the destination that exists**, and it becomes
the board's copy on the slice that builds the board's destination.

### 6.2 The progress line falls through to a next-step line

The board's active card draws `● 48/61 PIECES · 13 LEFT` and a progress bar.
There are no Entries and no Pieces at S6, so the line has nothing to count and a
`0/0` bar would state a fact about a list nobody has built.

In its place, the card and the trip screen draw the phase's **next step** — which
is §8.3's actual requirement for this slice, *"the phase control, moving both
directions, **with the next thing to do stated**"*:

| Phase | Line |
| --- | --- |
| `draft` | `NEXT — BUILD THE GEAR LIST` |
| `pack_out` | `NEXT — PACK IT` |
| `on_trip` | `NEXT — MARK UNPACK WHEN YOU ARE BACK` |
| `unpack` | `NEXT — RESOLVE EVERY ENTRY, THEN CLOSE` |
| `closed` | *(none)* |

Ledger voice: terse, factual, mono caps, no cheerleading. The line is a fact of
the phase table (§3.1), so it stays correct as later slices build the things it
names, and the progress line returns above it at S7/S9 rather than replacing it.

### 6.3 The reopen confirm ships now, with an empty body

`Screens B` §02B draws the reopen confirm with content S6 cannot produce: `1
ENTRY STILL OPEN — HEADLAMP, K · ▲ LOST` is S10's outcomes, and the over-claim
block is S7's Entries. §8.3 gives the **reopen clause** to S11.

The **confirmation itself** is neither's: invariant 19 is a domain rule —
*leaving `closed` is a deliberate, confirmed act, the same weight as deleting a
trip* — and S6 is the slice that makes leaving `closed` possible. Shipping the
move without the confirm would violate an invariant for five slices.

So S6 ships `ui/`'s `Confirm` with the board's title and its second line, both of
which are true today and stay true:

> **`Reopen Tessin 2025?`**
> `It returns to Unpack exactly as it stood. Closing cleared nothing.`

and none of the mono blocks. Primary stays accent, per the board — nothing was
thrown away. S11 fills the body; S6 does not stub it, and does not fake a count.

This is the Radix conversion's rule paying out: *a picker dismisses on the scrim;
a decision does not.* `Confirm` withholds scrim-dismiss, which is right for the
one backward move that makes settled history live again.

### 6.4 A third route

The boards draw a Trips list and a gear list builder. S6 adds **`/trips/new`**
between them, because F3 draws it (*Name · dates · participants* is its own step,
before the builder) and because the builder is S7's. That is less a departure
than a flow the boards render as one 1024 frame and the app renders as two
screens below Desktop — but it is a route the boards do not name, so it is
recorded.

---

## 7. What S6 leaves for later, on purpose

Written down so the next slice inherits a **stated obligation** rather than a gap
somebody has to notice.

**For S7** (`trip.entry_added`, `trip.entry_removed`,
`trip.entry_bring_count_set`):

1. `TripState` gains `entries` — §1.1's third row. S6 built the root and the
   participants and deliberately declared neither of the nested maps.
2. `/trips/:id` becomes the two-pane builder. Its header, the phase chip and the
   participant circles are already there; the `0 GEAR LISTED.` region is the
   hole.
3. The planned card's CTA becomes `BUILD LIST ›` (§6.1), and the active card's
   progress line returns above the next-step line (§6.2).
4. **Trip membership** joins the dimension table (§3.7) — `dimension('trip')`,
   the row §8.5 books for S7.
5. The over-claim surface, at all three of §5.2's moments — including the one S6
   makes reachable, `draft → pack_out` in the SET PHASE sheet.

**For S10**: the close gate on `unpack → closed`, and the closed row's
`54 PIECES · 1 LOST`.

**For S11**: §6.3's confirm body — the open-entry block and the over-claim block.

**For S14**: `trip.deleted` and its confirm; `from_trip_id`'s reader (§1.3); the
`? BLANK OR TEMPLATE` branch of F3 (§4.2).

---

## 8. What this slice deliberately does not build

- **Entries, Pieces, packing, journeys, outcomes, notes, tasks, templates,
  deletion.** Eight later slices, all of them named above.
- **The claim selector and the over-claim surface.** They need Entries; a Trip
  with Participants claims nothing.
- **Trip whereabouts.** Story 3's trip half is S9's; `whereabouts.ts` is
  untouched, and an active Trip at S6 still reports nothing, because it holds
  nothing.
- **A Trip-membership dimension** — S7's row (§3.7).
- **Renaming `DepotState`** — §2.
- **A phase transition graph.** Invariant 16 makes every move legal; encoding a
  graph would be building the thing the invariant forbids.

---

## 9. Doc amendments

| Doc | Change |
| --- | --- |
| [`sync-protocol.md`](../sync-protocol.md) §4.4 | `trip.created` and `trip.renamed` typed `{name: string｜null}`; §4.3's "settled at S4" note gains the two Trip rows; a note that `trip.created`'s `phase = "draft"` is the reducer's write, not a payload field, and that `trip.dates_set`'s payload keys are `start`/`end` against `start_date`/`end_date` registers |
| [`architecture-design.md`](../architecture-design.md) | §12.11, consequences of S6; §8.3's S6 entry marked landed |
| [`design/README.md`](../design/README.md) | Following the §3b/§3c precedent, each departure is appended to the section for the screen it changes: **§5** takes [§6.1](#61-the-cta-names-the-destination-that-exists)'s CTA rule, [§6.2](#62-the-progress-line-falls-through-to-a-next-step-line)'s next-step line and [§6.4](#64-a-third-route)'s route; **§5a** takes [§6.3](#63-the-reopen-confirm-ships-now-with-an-empty-body)'s confirm |
| [`testing.md`](../testing.md) | The backward-compatibility group's fixture list gains `s4-ownership` and `s6-trips` ([§5.4](#54-the-fixture-rule), [§5.5](#55-s4s-fixture-debt-paid-here)) |
| `CLAUDE.md` | Status: S6 landed, and the things worth knowing before touching Trips or phases |

---

## 10. What changed during implementation

§6 records the design that was taken, and is left as it was written. Three
things moved while the code was built, and a fourth moved after the slice had
shipped. All four are amended here rather than back into §6.

**§6.2 — only the active card draws the next-step line.** The planned card keeps
the board's three lines (name, `DRAFT · 0 GEAR LISTED`, the CTA). `NEXT — BUILD
THE GEAR LIST` beneath `DRAFT · 0 GEAR LISTED` says the same thing twice, on the
one card the board deliberately keeps slight. §8.3's *"with the next thing to do
stated"* is satisfied by the active card and by the trip screen, which draws the
line for every phase — so nothing is lost except a restatement.

**§6.3 — the reopen confirm's second line is parameterised by the target
phase.** The board's `It returns to Unpack exactly as it stood.` was hard-coded
against a SET PHASE sheet that offers all four other rows: for three of them the
sentence is simply false, and narrowing the sheet to `unpack` would have been
the worse fix, because invariant 16 makes every move expressible in either
direction and the board's own footnote says any row is tappable. The line now
names the row that was tapped. The word comes from a new `name` field on the
phase row (`Draft` · `Pack-out` · `On trip` · `Unpack` · `Closed`) rather than
from a casing transform of `label`, because no transform gets both `Pack-out`
and `On trip` right without knowing which words a phase name is made of — which
is what the table knows and a screen does not. The closed ledger row's `REOPEN`
targets `unpack` specifically, so that surface still renders the board's
sentence verbatim. `isKnownPhase` and `phaseNext` joined the module for the same
reason one function further out: every question the table answers has a named
accessor beside it, so no call site has to remember what a missing row means.

**§4.1 — the 2-up fold's container is the list item, not the card.** An element
is never its own query container, so `container-type: inline-size` on the card
with `@container` rules matching the card itself resolved against the next
container out — the screen — and flipped the layout at the wrong width while the
genuine descendants stayed unapplied. The list item declares the container and
the card declares none, which is `GearRow`'s arrangement with the pane the Depot
hands it, and the card renders stacked with no container at all (§3.2's
fail-open). Neither half is observable from a render, because jsdom evaluates no
container query, so both are pinned by assertions on the stylesheets.

**After shipping: the `Screens B` 02A design round superseded §4.1, §4.3, §6.1
and half of §6.2.** A board round taken against every S6 surface reversed
five things this spec settles, and `docs/design/README.md` §5 plus `Screens B`
02A are the authority for all of them:

- **`OPEN ›` is retired** (§6.1, and the glance table's CTA row). No card carries
  a button or a verb link; the interim affordance is the closed row's own `›` at
  the card's trailing edge, and the whole card is tappable. §6.1's *rule* is
  untouched — `BUILD LIST ›` still arrives with the builder and `Continue
  pack-out` with the packing view.
- **Two of §6.2's table rows were redrawn.** `NEXT — PACK IT` became `NEXT —
  PACK THE LIST`, and `NEXT — MARK UNPACK WHEN YOU ARE BACK` became `NEXT — SET
  UNPACK WHEN BACK`, which names the control the reader actually taps rather
  than describing an outcome. `shared/src/selectors/trip.ts` holds the shipped
  five.
- **The line goes on every non-closed card, drafts included**, reversing this
  section's own first amendment. The redundancy that argument rested on is an
  accident of the count being zero and dies at `DRAFT · 14 GEAR LISTED`.
- **The line belongs to the card and not to the trip screen** (§4.3's fourth
  bullet). A next-step line is a list-scanning affordance; on the trip screen
  the chip states the phase and the empty region states the task.
- **It is permanent, and the progress line returns *below* it**, not above —
  §6.2's last sentence has it the wrong way round, and `NEXT LINE SITS ABOVE THE
  PROGRESS LINE.` is drawn on the board's full-weight card variant.

One further reversal belongs to §4 rather than §6 and is listed here for the
same reason: **Participants left EDIT for the resting screen** (§4.3's `EDIT`
paragraph). They are gear detail's tag chips now — circles plus a dashed `+`
ghost, writes landing at once, removal never confirming — and EDIT is left
holding name and dates under one commit model, with the disclosure line that
had been holding the two models together deleted rather than reworded.

The round also **added** two things §1.4 leaves open rather than settles.
`SEP 02 → AUG 14 · ▲ ENDS BEFORE IT STARTS` reports a reversed range and
suppresses the day count while it is reversed — §1.4 rules out the *guard*, and
this is the ledger saying so instead — and EDIT states a stored date it cannot
draw: `▲ STORED AS "aug sometime" — PICKING A DATE REPLACES IT`, which is what
"drawn verbatim" costs on a screen whose control is the OS `date` picker.
