# S7 — The gear list

The implementation design for [architecture §8.3](../architecture-design.md#83-the-slices)'s
**S7**: three op types, the Trip's first nested entity map, three routes, and
the **over-claim surfaced rather than prevented**. It delivers story **6** and
advances story **7** (Bring-count), story **32** (the overlap guard) and story
**13** (the Trip-membership dimension).

This is a **feature spec**: it is retired once the slice has shipped. It settles
what the durable docs left to the implementer and records the decisions taken
before any code was written. It does **not** revisit anything above it — the op
envelope, the HLC, per-field LWW, the op catalogue and the evolution rules are
settled in [`sync-protocol.md`](../sync-protocol.md), and every ambiguity here is
resolved by reading that document, not this one.

**This spec was written twice.** The first draft designed eleven screens from
prose because the boards drew the builder at 1024 and nowhere else. A design
round then drew all eleven — `Screens B` **§02C**, `docs/design/README.md` §5 —
and **reversed three of its decisions and refined six more**. What follows is
the second draft, written against the boards. [§6](#6-what-the-design-round-settled)
records what moved and why, so the reasoning is not lost with the draft that
carried it.

**The boards win**, and after §02C there is very little left for them to win
against. `Screens B` §02 carries the Trips list and the 1024 builder; §02A the
S6 ship state; §02B the activation and reopen sheets; **§02C the S7 round** —
the trip screen at 393 · 540 · 1024, `Add from the depot`, the builder at 900,
the over-claim band and its five-conflict variant, the Remove-on-Alps confirm,
the trip-only sheet and the TRIP picker. `Components` §01 carries the stepper,
§03 the builder row's anatomy, §07 the generic empties.

S7 gives the Trip a **nested entity map** for the first time, and four later
slices (S8 · S9 · S10 · S14) write into the one it declares.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types | **3** — `trip.entry_added`, `trip.entry_removed`, `trip.entry_bring_count_set` |
| Endpoints · migration | **None.** `api/src/sync/envelope.ts:9` already accepts an unknown `type` verbatim |
| `source` | **One register** holding a discriminated union, per [sync §3.7](../sync-protocol.md). Wire `gear_id` → state `gearId`, the `readOwner` precedent ([§1.2](#12-source-is-one-register-and-a-trip-only-entry-cannot-be-renamed)) |
| Renaming a trip-only Entry | **Not expressible.** The catalogue defines three gear-list ops and none is a rename; the boards rule that this **stays unsaid** in the UI ([§1.2](#12-source-is-one-register-and-a-trip-only-entry-cannot-be-renamed)) |
| An Entry with no `source` | **Folded and retained; not drawn, not counted, holds no claim** ([§1.3](#13-an-entry-with-no-source-is-folded-retained-and-not-drawn)) |
| `bring_count` on a non-Counted Entry | **Folded** — the Kind lives on another aggregate. Invariant 6 is the *authoring* screen's job, the `TagString` split ([§1.4](#14-bring-count-is-folded-for-any-entry-and-offered-on-one-kind)) |
| Over-claim | A **selector over the fold**, no op, no flag ([§3.2](#32-the-claim-selector-reads-once-per-kind)) |
| Per-person claims at S7 | Derived from **Participants** — Pieces *are* Participants until S8 tombstones some ([§3.3](#33-per-person-claims-are-participants-until-s8-subtracts)) |
| **The count nouns** | **`ENTRIES` counts the list · `PIECES` counts the things · `GEAR` counts the depot.** Ruled by the boards; it **reaches back into S6's shipped strings** ([§4.9](#49-the-count-nouns-reach-back-into-s6s-shipped-strings)) |
| **Routes** | **Three.** `/trips/:id` (both widths, two modes), `/trips/:id/add` (**below Split only**), `/trips/:id/list` (**Split and up only**) ([§4.1](#41-three-routes-and-the-width-each-exists-at)) |
| Below Split | The trip screen **is** the editor; the picker is a route |
| Split and up | The trip screen **reads**; the builder route **edits**, in two panes |
| The over-claim surface | **A standing band on `/trips/:id`**, at every width, never dismissible ([§4.5](#45-the-over-claim-band)) |
| Trip membership dimension | `dimension('trip')`, label **`TRIP`**, arity **`multi`**, sentinel **first**, `NOT IN ANY TRIP`. Values are every **non-closed** Trip ([§3.6](#36-trip-membership-joins-the-dimension-table)) |
| The first cross-aggregate dimension | A `WeakMap` keyed on `DepotState` ([§3.7](#37-the-first-cross-aggregate-dimension-needs-an-index)) |
| `ui/Stepper` | **Built**, two sizes; gear detail and the gear list fold in as callers — not Add gear, whose Owned-count well must stay representable as *unset* ([§4.8](#48-uistepper--one-control-two-sizes-two-callers)) |
| Per-person rows | **`×N` alone.** Circles are S8's; the board books them under `CIRCLES — S8 · PIECES` ([§6](#6-what-the-design-round-settled)) |
| The progress line | **Not S7's, and it lands *below* the NEXT line, not above** ([§4.9](#49-the-count-nouns-reach-back-into-s6s-shipped-strings)) |
| `useScreenHeader` | **Two new callers.** `screenBand.test.tsx` extends with them ([§4.11](#411-the-header-band-gains-two-callers)) |
| Fixture | `shared/fixtures/s7-entries.ops.json` + `shared/src/fixtures.s7.test.ts`, same commit ([§5.4](#54-the-fixture-rule)) |

---

## 1. Three ops, and the five questions they close

[Sync §4.4](../sync-protocol.md) fixes the payloads and this spec does not move
them:

| Type | Payload |
| --- | --- |
| `trip.entry_added` | `{entry_id, source: {"from":"depot","gear_id":<uuid>} ｜ {"from":"trip_only","name","container":bool}}` |
| `trip.entry_removed` | `{entry_id}` |
| `trip.entry_bring_count_set` | `{entry_id, count: int ≥ 0}` |

`aggregate` is `trip` and `aggregate_id` is the Trip in all three; the Entry is
addressed by an id in the payload, exactly as a Participant is by `person_id`.

### 1.1 The register map is the contract

[Sync §3.7](../sync-protocol.md) already states the shape S6 declined to build.
S7 declares **three of the eight** Entry registers — `source`, `bringCount`,
`removed` — and the `pieces` map not at all. S6 set the precedent by declaring
the Trip root's registers and none of the four nested maps, and the reason is
the same: a register nobody writes is a field every reader has to have an
opinion about. S9 adds `status`, `residence` and `stage`; S10 adds `outcome` and
`consumedCount`; S8 adds `pieces`.

`writeEntry` follows `writeTrip` (`shared/src/reduce.ts:117`) exactly — nested
one level deeper, with the same identity check at each level so a lost write
returns the original object and `fold` stays cheap:

```ts
function writeEntry(
  state: DepotState,
  tripId: string,
  entryId: string,
  stamp: Stamp,
  update: (entry: EntryState, stamp: Stamp) => EntryState,
): DepotState
```

Entity creation stays implicit at **both** levels: a `trip.entry_added` for a
Trip whose `trip.created` has not arrived creates the Trip *and* the Entry, and
that Trip has no `phase` register, so it reads `draft`
([§12.11](../architecture-design.md#1211-consequences-of-s6-trips-and-phases)).
S6 already handles this and S7 must not special-case it.

The generic `writeEntity` collapsing all five writers is **still not taken**,
for the reason at `shared/src/reduce.ts:106-116`. `writeEntry` is the fifth
instance and the first at two levels; if a sixth arrives the argument should be
re-opened, and this sentence is the marker.

### 1.2 `source` is one register, and a trip-only Entry cannot be renamed

§3.7 lists `source` as **one** register, so the whole union is written and
compared as a unit:

```ts
export type EntrySource =
  | { from: 'depot'; gearId: string }
  | { from: 'trip_only'; name: string | null; container: boolean }
```

Wire `gear_id` becomes `gearId`, the split `readOwner`
(`shared/src/payloads.ts:98`) already has over `person_id`. S7 adds `readSource`
beside it — the third discriminated-object reader after `readResidence` and
`readOwner`. A payload whose `from` is neither `depot` nor `trip_only`, or whose
`gear_id` is missing, reads `absent` and writes nothing: the op still folds, the
Entry is still created by [§1.1](#11-the-register-map-is-the-contract)'s implicit
creation, and the result is [§1.3](#13-an-entry-with-no-source-is-folded-retained-and-not-drawn)'s
sourceless Entry. It is never rejected.

**A trip-only Entry therefore cannot be renamed.** A rename would rewrite the
whole `source` register, carrying `container` with it, and two Devices renaming
concurrently would each clobber the other's trait. Recorded as a **deliberate
omission** on the precedent of the containment trait's own missing mutation op
([sync §4.3](../sync-protocol.md)): if it turns out to be real it is a new,
additive op type, and the register map grows a `name` beside `source` rather
than the union growing a writer.

**The UI does not say so.** The boards rule it explicitly: *"Un-renameability
stays unsaid: correcting a typo is remove + re-add, two taps the ✕ already makes
cheap, and stating a missing op at creation is release meta-text — the S6
empty-state rule."*

### 1.3 An Entry with no `source` is folded, retained, and not drawn

S6 settled that an absent `phase` reads `draft`, and S4 that an absent `owner`
reads `SHARED`. **`source` gets no such rule**: an Entry naming neither a piece
of Gear nor a trip-only name is not a line anybody can draw. It is reachable
exactly as S6's phaseless Trip is — `trip.entry_bring_count_set` and
`trip.entry_removed` both create the Entry on sight.

> **`entriesOf(trip, state)` returns Entries that carry a `source` and are not
> tombstoned.** A sourceless Entry is retained in the fold, excluded from the
> list, excluded from every count, and holds no claim.

Stated once, in `shared/src/selectors/entry.ts`, and read through one function
everywhere. Nothing is discarded and nothing is guessed: the moment the
`trip.entry_added` arrives the Entry appears, in the position its own clock
earns it. Excluding it from **claims** too is the conservative direction and
matches S6's treatment of an unrecognised phase — a claim the reader cannot see
is a claim they cannot settle.

### 1.4 Bring-count is folded for any Entry, and offered on one Kind

Domain invariant 6 confines a bring-count to Counted entries. The reducer cannot
enforce it and must not try: the payload carries `{entry_id, count}` and nothing
else, the Entry's Kind lives on a **different aggregate**, and a trip-only Entry
has no Kind at all. Resolving the Kind inside the reducer would make the fold
order-dependent — the same op would write or not write depending on whether
`gear.kind_set` had arrived — which is what per-field LWW exists to avoid.

The `TagString` split, transplanted:

- **The authoring screen is the whole of the defence.** The stepper is offered
  on an Entry whose `source.from === 'depot'` and whose Gear's `kind` reads
  `counted`, and nowhere else.
- **The reader is entirely tolerant.** `bringCount` folds for any Entry, and
  `readCount` (`shared/src/payloads.ts:70`) already reads non-integers and
  negatives as `absent`.

A Gear whose Kind changes from `counted` to `single` leaves a `bringCount`
register on every Entry that referenced it. That register is **not cleared** —
clearing it is a write nobody asked for, and S4's `recordedAt` rule applies.
Readers gate on the Kind instead, which is the same rule `ownedCount` already
carries at three sites (`shared/src/selectors/depot.ts:107`,
`shared/src/selectors/whereabouts.ts:62`, `app/src/screens/GearDetail.tsx:78`).
S7 adds the fourth and so moves the question behind one function:
**`bringCountOf(entry, state): number | null`**, returning `null` for every Entry
that is not a Counted depot Entry. The claim selector, the row, the group counts
and the totals all call it.

**An absent `bringCount` on a Counted Entry reads `1`.** Adding Counted gear
without touching the stepper means bringing one, and writing a register to say
so would cost an op and move nothing. `bringCountOf` is the only place that says
this.

### 1.5 `trip.entry_removed` is the only resolution, and it is not a cascade

[Sync §3.5](../sync-protocol.md) makes the tombstone an ordinary LWW field with
no restore op in the MVP, and §3.6 makes this op the way an over-claim is
settled. Two things follow that the implementation must not improve on:

- **Removing an Entry writes one register on one Entry.** It does not touch the
  Depot (invariant 8), does not touch the other Trip in an over-claim, and does
  not cascade to the Entry's Pieces when S8 gives it some — a tombstone never
  cascades, and `entriesOf` filtering the Entry out is what makes its Pieces
  unreachable without a second write.
- **Re-adding is a new Entry with a new id**, not a restore. A Quartermaster who
  removes and re-adds the same Gear gets a fresh Entry — and, at S9 and S10,
  none of the old one's packing state. Stated so nobody later reads the missing
  restore as an oversight.

---

## 2. State shape

`shared/src/state.ts` gains one interface and one field, and `TripState`'s
docstring loses the first of its four reservations.

```ts
export interface EntryState {
  readonly id: string
  /** One register, not three — the whole union is written as a unit (§1.2). */
  readonly source?: Register<EntrySource>
  /** Folded for any Entry; meaningful on Counted depot Entries only (§1.4). */
  readonly bringCount?: Register<number>
  /** Tombstone. No restore op exists in the MVP (§1.5). */
  readonly removed?: Register<boolean>
}

export interface TripState {
  // … S6's root registers and `participants`, unchanged …
  readonly entries?: Readonly<Record<string, EntryState>>
}
```

`entries` is a `Record` of **entities**, not of registers — the first of its kind
in the codebase, and deliberately not the shape `participants` and `tags` use.
Those are **sets**, whose member carries only presence; an Entry has registers of
its own. The two look alike and mean different things, and conflating them is how
a `bringCount` would end up with nowhere to live.

`EntrySource` is exported beside `Residence` and `Owner`. Unlike `KindValue` and
`PhaseValue` its `from` discriminant is **not** widened with `(string & {})`: an
unrecognised `from` never reaches state because `readSource` reads it `absent`.
The tolerance lives at the boundary; the state type stays closed so a `switch`
over it is exhaustive.

---

## 3. Selectors

A new file, `shared/src/selectors/entry.ts`, a new `claim.ts`, and edits to
`trip.ts` and `slice.ts`. Every question gets **exactly one** function, and no
call site re-derives one — the discipline S6 paid for three times over.

### 3.1 `entriesOf`, and what each noun counts

```ts
entriesOf(trip: TripState, state: DepotState): readonly EntryState[]
entryLabel(entry: EntryState, state: DepotState): string
entryKind(entry: EntryState, state: DepotState): KindValue | 'trip_only' | undefined
bringCountOf(entry: EntryState, state: DepotState): number | null
pieceCountOf(entry: EntryState, trip: TripState, state: DepotState): number
listTotals(trip: TripState, state: DepotState): ListTotals
```

`entriesOf` takes `state` as well as `trip` — it needs `entryLabel` to sort by,
and `entryLabel` needs the Depot to read a referenced Gear's name from.
It applies [§1.3](#13-an-entry-with-no-source-is-folded-retained-and-not-drawn)'s
rule and sorts by `byNameThenId` over `entryLabel`, so two replicas draw the same
order. `entryLabel` reads the referenced Gear's `name` through the Depot for a
depot Entry — **invariant 8's single-sourcing is this one line** — and the
`source`'s own `name` for a trip-only one, falling back as `tripLabel` does.

`entryKind` returns `undefined` for a depot Entry whose Gear this replica has
not yet folded — **the ordinary cross-aggregate sync race**, not an error:
`trip.entry_added` and `gear.recorded` are different aggregates with no
ordering between them, so a Gear genuinely not-yet-synced is the expected
case. Reading it as `'single'` would assert a Kind nobody has stated, and the
claim selector branches on this value: an unsynced Gear misread as `'single'`
would raise an over-claim nobody can settle, naming a row this build still
draws as `—`.

`pieceCountOf` is where the Kinds diverge:

| Entry | Pieces |
| --- | --- |
| Single depot Entry | `1` |
| Counted depot Entry | `bringCountOf(entry, state)` — absent reads `1` |
| Per-person depot Entry | `participantIds(trip).length` — the starting default, and **all** of it until S8 |
| Trip-only Entry | `1` — a trip-only Entry has no Kind to be Counted by ([§6](#6-what-the-design-round-settled)) |
| Gear with an unrecognised Kind | `1` — the conservative direction, as `whereabouts.ts:62` already chooses |

`ListTotals` is `{ entries, pieces, perPerson, tripOnly }`, and **the field names
are the boards' nouns**: `entries` counts Entries, `pieces` sums `pieceCountOf`,
`perPerson` sums it over per-person Entries only, `tripOnly` counts trip-only
Entries. The builder's footer is `4 ENTRIES · 6 PIECES · 2 PER-PERSON ·
1 TRIP-ONLY`; the section band is `N ENTRIES · N PIECES`
([§4.9](#49-the-count-nouns-reach-back-into-s6s-shipped-strings)).

**Group headers pluralise**: the boards draw `1 PIECE` and `2 PIECES`, so the
count and its noun are formatted together, not concatenated.

### 3.2 The claim selector reads once per kind

Domain §5.2's supply rule is three sentences and the selector is three branches,
in `shared/src/selectors/claim.ts`. It calls `isActive`
(`shared/src/selectors/trip.ts:221`) — **the only definition of active-ness in
the codebase**, whose docstring already names this selector as a caller.

```ts
export interface Claim {
  readonly tripId: string
  readonly entryId: string
  /** Counted: the Bring-count. Single: 1. Per-person: the participants. */
  readonly count: number
  readonly personIds?: readonly string[]
}

export interface OverClaim {
  readonly gearId: string
  readonly kind: KindValue
  readonly claims: readonly Claim[]
  readonly supply: number
  readonly claimed: number
  readonly contestedPersonIds: readonly string[]
}

overClaims(state: DepotState): readonly OverClaim[]
overClaimsFor(state: DepotState, tripId: string): readonly OverClaim[]
overClaimsIfActive(state: DepotState, tripId: string): readonly OverClaim[]
```

- **Single** — supply is one. More than one active Trip holding an unresolved
  Entry is an over-claim. `ownedCount` is **not** consulted: invariant 6 confines
  it to Counted gear, and a Single gear carrying a stray `owned_count` from an
  edited Kind must not quietly raise its own supply.
- **Counted** — `sum(bringCountOf) > ownedCount`, an absent `ownedCount` reading
  `1` as `whereabouts.ts` already reads it.
- **Per-person** — supply is one *per Person*. Two active Trips claiming the same
  Gear for **disjoint** Participants is legitimate and common, and the selector
  must not report it; only a Person in both Participant sets is contested.
  `contestedPersonIds` is what the surface names.

`overClaimsIfActive` exists because two of the three guarded moments ask a
hypothetical — *would* activating this Draft over-claim. It folds the subject
Trip in as though active and otherwise defers to `overClaims`. Having it as its
own function is what stops the SET PHASE sheet re-deriving activeness inline.

### 3.3 Per-person claims are Participants until S8 subtracts

A per-person Entry's claim is one unit per **Piece**, and Pieces are "derived
from the trip's participants, minus those explicitly tombstoned"
([sync §4.4](../sync-protocol.md)). S8 introduces the tombstones. **At S7 there
are none**, so Pieces are exactly Participants and the per-person claim is fully
computable now — which is why §8.3 asks for the claim selector "across the three
Kinds" in a slice that builds no Pieces.

The shape this leaves S8 is the point: `personIds` is already the set the
selector reasons over, so `trip.piece_removed` becomes a **subtraction from a set
that exists** rather than a new branch. Written down because the tempting
shortcut — a per-person claim of "the participant count" as a bare number — would
compare counts instead of people, and would report two Trips taking one headlamp
each for two different People as an over-claim. That is the one thing story 6
explicitly calls legitimate.

### 3.4 "Unresolved" has nothing to gate on until S10

A claim is held by an **unresolved** Entry — one with no unpack outcome. At S7 no
Entry can have an outcome, so every non-removed Entry on an active Trip is
unresolved and the selector reads them all.

The gate is not written as a function that always returns `false`. It is a
**named insertion point inside `claim.ts`**, because that file is the only reader
of the notion and S10 is the slice that gives it content. A speculative
`isResolved` with no caller able to make it true would add a fifth thing about
outcomes to keep in agreement before outcomes exist.

### 3.5 The over-claim view is a pure function of the fold

`overClaims(state)` reads registers only: no argument saying which Device did
what, no flag, no write. Two consequences, and §8.3's Tier 2 is precisely about
them:

- **Every replica computes the identical set**, because every replica holds
  identical registers — the containment-cycle argument
  ([sync §3.6](../sync-protocol.md)) applied to the second condition the reducer
  must not resolve.
- **It disappears only when a Quartermaster removes an Entry or lowers a
  Bring-count**, both ordinary ops that merge like any other. Nothing is
  discarded to resolve it, which is story 6's closing sentence.

This property is what makes [§4.5](#45-the-over-claim-band)'s band possible.

### 3.6 Trip membership joins the dimension table

`DimensionId` widens to `'tag' | 'kind' | 'ownership' | 'person' | 'trip'`, the
row §8.5 books for S7 and the fifth dimension the table carries.

| Property | Value |
| --- | --- |
| `label` | `TRIP` — `Components` §04 draws the ghost as `TRIP · S7` |
| `arity` | `multi`, Tag's arity — trips AND together, and the `+ TRIP` ghost chip survives a selection |
| `valuesOf` | the ids of every **non-closed** Trip listing this gear, or the sentinel |
| `format` | `tripLabel`, and `NOT IN ANY TRIP` for the sentinel, **checked first** |
| order | **sentinel first**, then trips — the boards' Loose-first rule |

**Membership means every non-closed Trip, not every active one.** Story 13's
example is "everything not in any Trip", a *planning* question — a Draft speaks
for gear as surely as a Pack-out does. Closed Trips are excluded because their
lists are history: include them and the sentinel goes permanently empty for any
household with a past. This needs a predicate `isActive` cannot give, so
`shared/src/selectors/trip.ts` gains **`isClosed(trip)`** beside it — one
function, one question, and an unrecognised phase is **not** closed, the same
conservative direction that makes it not active.

The sentinel is the literal string `none`; trip ids come from `systemIdSource`,
so there is no collision, and a reserved plain-word value is the shape
`dimension('ownership')` already uses. **A contradictory pair is reachable and
not guarded**: `NOT IN ANY TRIP` + a named Trip returns `0 OF N`, exactly as
S4's `OWNERSHIP: SHARED` + `PERSON: ELS` does. The picker **picks, never
creates**.

### 3.7 The first cross-aggregate dimension needs an index

`sliceDepot` calls `valuesOf(gear, state)` once per Gear per active dimension.
Every dimension before this one answers from the Gear's own registers in constant
time. Trip membership does not: answering per Gear means scanning every Trip's
Entries, making the Depot list **O(gear × entries)** on the app's most-visited
screen.

S3 passed `state` in so the table "would not be reshaped by the first dimension
that needs it" — that settled the *signature* and left the *cost* to whoever
arrived first. This is it.

The fix is a memo, not a reshape: a module-level
`WeakMap<DepotState, Map<string, readonly string[]>>` inside `slice.ts`, built on
first ask and keyed on the folded state. `DepotState` is immutable and its
identity changes on exactly the folds that could change the answer (the reducer
returns the same object when a write loses), so the key is exact rather than
approximate, and a `WeakMap` lets superseded states be collected.

---

## 4. Screens

### 4.1 Three routes, and the width each exists at

This is the shape §02C settled, and it is **not** the one this spec's first draft
designed. The builder is **its own route**, not `/trips/:id` growing a second
pane.

| Route | Exists at | What it is |
| --- | --- | --- |
| `/trips/:id` | every width | The trip screen. **Below Split it edits in place**; from Split up it **reads** |
| `/trips/:id/add` | **below Split only** | `Add from the depot` — the picker as a full screen |
| `/trips/:id/list` | **Split and up only** | The builder: picker pane + editable list pane |

The board never spells the builder's path; `/trips/:id/list` is this spec's, and
the alternative considered was `/trips/:id/build`. `list` is chosen because the
affordances that reach it are `BUILD LIST ›` and `EDIT LIST ›` and the thing it
edits is the gear list.

**Two width-guarded routes**, following `App.tsx:403,417`'s existing
`isDesktop ? <X/> : <Redirect/>` shape with `isSplit`: `/trips/:id/add` redirects
to `/trips/:id/list` at Split and up, and `/trips/:id/list` redirects to
`/trips/:id` below it. Before S7 `People` and `Devices` were "the **only** two of
the eight whose route carries a width guard"
([frontend-design §3.3](../frontend-design.md)); S7 makes four.

**One builder, two doors, and the back link follows the door.** `BUILD LIST ›` on
the Trips card gives `‹ TRIPS`; `EDIT LIST ›` on the trip screen's section band
gives `‹ VOSGES — OCT`. This is `InviteIssued`'s one-screen-three-doors shape
(S5), and the same rule: where it points is the screen's own decision. Below
Split the card's `BUILD LIST ›` goes to `/trips/:id`, because there the trip
screen *is* where you build the list.

### 4.2 `/trips/:id` — editor below Split, reader above

S6 built the header and left `app/src/screens/Trip.tsx:505` reading
`0 GEAR LISTED.` Order below the header, at every width:

1. **The over-claim band**, when there is one ([§4.5](#45-the-over-claim-band)).
2. **The `GEAR LIST` section band** — `GEAR LIST` left, `N ENTRIES · N PIECES`
   right, and from Split up a trailing **`EDIT LIST ›`**. Its typography is the
   group bands' exactly, so it reads as their parent.
3. **Groups**, by Kind: `SINGLE` · `COUNTED` · `PER-PERSON` · `TRIP-ONLY`, each
   with `N PIECE(S)`, each omitted when empty. `TRIP-ONLY` is keyed on the source,
   not a Kind, since a trip-only Entry has none.
4. **Entry rows.**

**Below Split** the rows carry a `− ×N +` stepper on a Counted Entry, `×N` on a
per-person one, nothing on a Single one, the amber `TRIP-ONLY` badge on a
trip-only one, and every row ends in `✕`. Then the dashed
`+ TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE` row and, after a
flex spacer, the pinned full-width primary **`+ Add from the depot`**.

**From Split up the pane is read-only**: no `✕`, no steppers, no dashed row, no
pinned button, and the trailing column reads `×4` for a Counted Entry and `—` for
everything else. Editing is `EDIT LIST ›`.

**The empty state keeps its second string and loses its first to the noun
ruling**: `0 ENTRIES.` + `The gear list is built from the depot.` — with the add
affordances beneath it below Split, as the S6 board promised.

`✕` **does not confirm.** One op, the gear untouched, re-adding two taps — the
tag-chip rule, and the boards restate it.

**The pinned primary is a flex child, not a fixed FAB.** The boards draw it after
a flex spacer inside the column, and that is also what avoids the
`container-type` trap that shipped Depot's FAB broken from S3: an element
declaring a query container is the containing block for its `position: fixed`
descendants. S7 introduces no new fixed element.

### 4.3 `/trips/:id/add` — the picker as a screen, below Split

A screen and not a sheet, on the argument `README.md` §3b already won for Add
gear: *the OS keyboard owns the lower half for a whole sitting*, and `IN LIST ✓`
keeps the row visible after the add, so the sitting is a batch loop. The Home
picker — the counter-precedent — closes on selection, exactly what this must not
do.

Header `‹ VOSGES — OCT` and the sync line; title `Add from the depot`; a focused
search field, `Search the depot…`; ghost chips `+ TAG` `+ KIND` `+ TRIP`; 56px
rows carrying the name, the home path and a trailing `+ ADD` or `IN LIST ✓`
(mono, packed-green, the row muted); footer hint
`ADDING LISTS IT — GEAR DOES NOT MOVE UNTIL PACK-OUT`.

Three details the boards fix:

- **`IN LIST ✓`'s grammar is deliberately the Participants picker's
  `PARTICIPANT ✓`**, and `README.md` §5 says so; the two multi-select
  affirmations stay isomorphic.
- **Retired Gear is not offered** — the picker reads `visibleGear`. Story 2 makes
  retiring a soft delete so past Trips keep their history, not so retired gear
  can join new ones.
- **The meta slot carries the home path, then at most one suffix.** The boards
  draw `<home path>` alone for a Single, shared or uncounted Gear, and
  `<home path> · <suffix>` for the three cases with something to add: `×N` for
  Counted (the **owned** count, not a Bring-count — this picker has no Trip
  context of its own to bring one from), `PER-PERSON`, or the owner's **initial
  alone** for personal gear. Where Kind and personal ownership collide — a
  personal, Counted Gear — **Kind wins**: undrawn by the boards, and recorded
  here as the decision this spec makes rather than one they settle.
  `Components` §03's "no whereabouts" is confirmed **narrowly** by the round:
  no world chip and no status; the home path is residence, not world.

**The picker carries no claim read and the add no flash** — ruled: *"a claim is a
relationship between two trips, the picker speaks for one, and the band appearing
is the signal — a second signal would say it twice."*

Empty and unmatched states fall back to `Components` §07 verbatim: `Empty depot.`
/ `+ Add gear`, and `No matches.` / `N FILTERS ACTIVE` / `Clear filters`. **No
builder skeleton** — the data is local.

**One board inconsistency, flagged not silently resolved.** The 393 picker draws
three ghost chips (`+ TAG` `+ KIND` `+ TRIP`) and the 900 builder's picker pane
draws two (`+ TAG` `+ KIND`), with no rule stated either way. S7 follows each
board at its own width and records the divergence here; filtering a depot by trip
membership *from inside a trip's own builder* is plausibly deliberate to omit, but
the boards do not say so.

### 4.4 `/trips/:id/list` — the builder, Split and up

Two panes, and a **media** query: the panes exist or they do not, and rendering
both to hide one would put every Entry in the accessibility tree twice
([frontend-design §3.2](../frontend-design.md)). `440px | 1fr` at Desktop;
`minmax(308px, 40%) | 1fr` at Split, 308px being the pane width `GearRow` already
folds inside.

Left pane: the same picker component as [§4.3](#43-tripsidadd--the-picker-as-a-screen-below-split), eyebrow
`FROM THE DEPOT`, its search field carrying the `/` hint at this width. Right
pane, at Split: the band row (back link + sync), a title row `<Trip> — gear
list` with `Start pack-out` for a Draft, the groups and rows with their
editing affordances, the dashed trip-only row, and a **footer totals bar** —
`N ENTRIES · N PIECES · N PER-PERSON · N TRIP-ONLY`.

**At Desktop the band and title are not right-pane content.** The boards draw
them as a **full-width strip above the grid** — back link, title, Participants,
`N PIECES` and `Start pack-out` on one row, separated from the two panes by its
own rule — because a bare pane at this width has no sidebar to carry the back
link or the sync state in words, the same reason the pane band exists at Split
at all. The footer stays right-pane content **at both widths**: it is a read,
not an action, so it has no reason to leave the list it totals.

**There is no `GEAR LIST` section band inside the builder.** It starts at the
group bands and carries its totals in the footer; the section band belongs to the
trip screen, where it is also the `EDIT LIST ›` affordance's home.

**`Start pack-out` renders for a Draft only**, and on the phone not at all: the
phase chip already opens SET PHASE, and a second control for one register would
be two ways to do one thing. It is over-claim moment #2 and opens §02B's sheet.

**The gate reads the *filtered* over-claim result, not the raw one.**
`overClaimsIfActive` is deliberately unscoped to a `tripId` — it can name an
`OverClaim` between two Trips neither of which is this one — so gating the
button's decision to open a preview on the raw selector opened a confirm with
an empty block for a conflict this Trip has no part in. The same filter that
decides what the band *draws* must also decide whether there is anything to
warn about; S6's `PhaseSheet` already gates this way for its own
`draft → pack_out` moment, and this screen's gate copies it verbatim.

**Weight is not built.** `EST 48.2 KG` is story 16, `LATER`, and the boards draw
the MVP variant of both header and footer beside the frame.

### 4.5 The over-claim band

The primary surface, and the reason it is not a third modal: story 6's fourth
condition is **not a moment** — a clash arrives through sync while nobody is
doing anything, and no modal reports a state nobody triggered. Because
[§3.5](#35-the-over-claim-view-is-a-pure-function-of-the-fold) makes it a pure
function of the fold, the band is correct on every Device with no notification
machinery.

**It sits between the trip header and the `GEAR LIST` band** — it annotates the
list without blocking it — renders **wherever `/trips/:id` renders, at every
width**, and is **never dismissible**: there is nothing to dismiss, and the fold
would render it again.

Anatomy is §02B's verbatim — attention line, conflict rows, settle routes in
accent; the tint is the derived attention fill, **never a filled red anything**.
The copy varies by conflict count, and this is the part most easily got wrong:

| Case | Attention line | Row fact |
| --- | --- | --- |
| One other Trip | `▲ 1 entry is already claimed by Alps 2026.` | `SINGLE · STILL OUT` — the Trip is **not** repeated |
| Two or more Trips | `▲ 5 entries are claimed by 2 other trips.` — note **no `already`** | `SINGLE · STILL OUT · ALPS 2026` — each row carries its own |

Rows cap at **three, then one quiet `+ N MORE` row that expands in place — never
an inner scroll.** The expansion row is muted, not accent.

**An unnamed Trip reads `Unnamed trip`** — quiet, no extra `▲`, because the data
is right. Three casings occur: `Unnamed trip` in a row, `an unnamed trip`
mid-sentence (`▲ 1 entry is already claimed by an unnamed trip.`), and
`REMOVE ON UNNAMED TRIP`. `tripLabel` is **unchanged** and still returns `—`:
that glyph is right in a list column and wrong in a sentence, which is the split
`UNNAMED_PERSON` already carries. S7 adds `UNNAMED_TRIP = 'Unnamed trip'` beside
`tripLabel`, and the band derives its own casings.

**The two §02B sheets are previews of this band.** They stay at their moments —
a phase move still confirms — and render the same block.
`overClaimsIfActive` feeds `Start pack-out`; S6's `ReopenConfirm` gains the
over-claim block only, its other deferred block (`1 ENTRY STILL OPEN — …`) still
needing outcomes and so still S11's.

**Adding to an Active Trip is never gated.** The add lands as a local op and the
band appears. A pre-add confirm would contradict "never a block", and a modal
answerable only on the Device that happens to hold both Trips' recent ops is a
guard that works by luck.

### 4.6 The trip-only Entry sheet

A `Sheet` — a decision, not a sitting, so §3b's screen argument does not
transfer — in Add gear's order: title `Trip-only entry`; eyebrow `NAME` over a
focused field; eyebrow `RECORDED AS` over an `ITEM · CONTAINER` segmented
control with the hint `CONTAINERS HOLD OTHER GEAR · FIXED WHEN RECORDED`; a
full-width `Add entry` gated on the name; and a centred mono fact line
`NOT KEPT IN THE DEPOT · CLEARED AT CLOSE`, restating the launcher's promise at
the moment of commitment. The trait sits last beside the CTA because it is the
rarest decision and the only irreversible one.

It emits one `trip.entry_added` carrying both fields. **No tag chip and no tag
picker ever mounts** (invariant 9), and `Screens B` §01B stated that rule "now,
because the trip-side screens reuse this exact chip and picker from S7 on".

### 4.7 The Remove-on-Alps confirm

`REMOVE ON ALPS` emits `trip.entry_removed` against a **different aggregate** than
the screen — the first time any surface writes against something it is not
showing. That is ordinary as sync goes (one op in one push batch), but its undo
is a navigation away, so unlike `✕` it confirms, in the deliberate-act register:

- Title `Remove from Alps 2026?`
- Body `Tent, tunnel 4p comes off the Alps 2026 gear list. The gear itself does not move.`
- A mono context line naming the other Trip's state: `▸ ALPS 2026 · ON TRIP · DAY 12`
- Accent primary `Remove entry` — nothing is destroyed — and ghost `Cancel`.

### 4.8 `ui/Stepper` — one control, two sizes, two callers

[Frontend-design §5](../frontend-design.md) lists `Stepper` among the unbuilt
primitives; `Components` §01 draws it; Add gear and gear detail each hand-roll one
for Owned-count. S7 builds it in `ui/` and converts **gear detail and the gear
list**, not Add gear — a correction to this section, which had read the
round's ruling as "converts both" and named Add gear as a third caller.

**This is a spec-versus-board conflict, not a board-versus-board one.**
`docs/design/README.md` §3b already settles that Add gear's Owned-count well
"opens empty and gates the CTA — a silent ×1 is a wrong ledger line," and §5's
own account of the round never asks Add gear to give it up. `Stepper`'s
contract — `{ value, min, onChange, size?, label }` — had no channel for
*unset* at the time this section was first written, only for a numeric floor,
so folding Add gear in would have meant drawing a silent default the board
explicitly rules out. §3b and §5 were never in disagreement; it was this
section's own prop list that flattened two settled decisions into a false
"three callers."

Two sizes: **h48 default** and **in-row h32**, the dense one padding its hit area
to **≥44px** beyond the painted box — the status-pill minimum, and allowed on
touch.

`Stepper` takes `{ value, min, onChange, size?, label }`, holds no state, and
imports neither the store nor the router. `min` is `0`: a Bring-count of zero is
expressible on the wire and is **not** the same as removing the Entry, which is
invariant 11's whole point. It claims nothing, lists nothing, and the row stays.

### 4.9 The count nouns reach back into S6's shipped strings

Ruled: **`ENTRIES` counts the list, `PIECES` counts the things, `GEAR` counts the
depot.** The consequence S7 must carry is that two strings S6 shipped are wrong
under the ruling and this is the slice that corrects them, because it is the
slice that makes the count true:

- `app/src/screens/Trip.tsx:505` — `0 GEAR LISTED.` → **`0 ENTRIES.`**
- `app/src/components/TripCard.tsx:161` — `· 0 GEAR LISTED` → **`· N ENTRIES`**,
  now a real `listTotals().entries`
- Closed ledger rows **keep `PIECES`** — they count what went. This presumed a
  count was already being drawn there; none was. `ClosedRow` gains one:
  `listTotals(trip, state).pieces`, folded for real rather than presumed,
  passed as a prop the same way `TripCard`'s own `N ENTRIES` is below. `1 LOST`
  is still S10's, once outcomes exist to name it.

Three things the first draft of this spec assigned to S7 have **already landed**
and are not in scope: `NEXT — PACK THE LIST` and `NEXT — SET UNPACK WHEN BACK`
(`shared/src/selectors/trip.ts:102,109`), and the NEXT line drawing on Draft
cards (`TripCard.tsx:101`).

**The progress line is not S7's, and when it lands it goes *below* the NEXT
line.** S6's spec §6.2 said "above" and its §10 records the reversal; CLAUDE.md
names this as the thing S7 and S9 would otherwise get backwards. S7 cannot supply
it in any case — `● 48/61 PIECES` needs a numerator only packing can give, so
S7 delivers the denominator and S9 the bar.

`BUILD LIST ›` lands on the Draft card, per the rule S6 stated and this slice
discharges. `Continue pack-out` still does not, and stays absent until S9.

**`TripCard` does not move to `ui/`** — S7 gives it no second caller. It reads
the store (`TripCard.tsx:90`), which §5 forbids in `ui/`, and adding `listTotals`
to that read would deepen it. So the count is **passed as a prop** from
`Trips.tsx` instead. This does **not** pay the debt: the component still reads
the store for its Participants (`TripCard.tsx:93`), and lifting *that* is the
harder half. It keeps the read from growing, which is all a slice changing one
string on this component should do.

### 4.10 The Depot's slice bar gains `TRIP`

`Components` §04's dashed `TRIP · S7` becomes live. No new control and no new
layout: `SliceBar` is driven off `DIMENSIONS` and picks the row up at all five
layout modes, and `ValueMenu` renders the values with their counts. S4 extended
the table by adding two rows and widening `format`; S7 adds one row and changes
no signature at all, which is the test §8.5 set for the engine.

### 4.11 The header band gains two callers

[Frontend-design §3.3](../frontend-design.md) — landed after this spec's first
draft — makes `useScreenHeader` (`app/src/shell/useMediaQuery.ts:137`) the only
place the back-link and sync-line rule is spelled, and says its reach is "every
screen that draws either half of the band — **all eight**". S7 makes it **ten**:
`/trips/:id/add` and `/trips/:id/list` both ask it.

Both answer **`splitPane: false`**. The builder is two panes of *itself*, not a
detail pane of a list that is also on screen — `GearDetail` answers `true`
because the Depot list sits beside it and `Depot split` draws no `‹` at all,
whereas the builder's own back link is drawn at every width it exists at. The
comment at `app/src/screens/Trip.tsx:141` — *"`DepotView` is the only two-pane
view in `App.tsx`"* — stops being true and is corrected in this slice.

**`app/src/shell/screenBand.test.tsx` extends with both**, and this is not
optional tidiness: a per-screen suite renders its screen alone, so an absence
assertion there proves one side of a two-sided fact, which is how the rule
"shipped inverted and passed review".

---

## 5. Tests

### 5.1 Tier 1 — unit

In `shared/src/selectors/entry.test.ts`, `claim.test.ts`, and additions to
`trip.test.ts` and `slice.test.ts`.

- **`entriesOf`** — a tombstoned Entry excluded; a **sourceless** Entry excluded,
  retained in the fold, and appearing the moment its `trip.entry_added` lands;
  ordering total and identical from two op orders.
- **The reference is a reference** — renaming Gear in the Depot changes
  `entryLabel` with no Trip op at all (invariant 8); a trip-only Entry's label
  survives a Gear rename because it names nothing.
- **`pieceCountOf`** across [§3.1](#31-entriesof-and-what-each-noun-counts)'s five rows, and
  `listTotals`'s four numbers against a mixed list.
- **`bringCountOf`** — absent reads `1` on a Counted Entry; `null` on Single,
  per-person and trip-only Entries; a `bringCount` surviving a Kind change to
  `single` reads `null` and is **not** cleared from state.
- **The claim selector across the three Kinds** — Single exclusive; Counted
  summing past `ownedCount`, and an absent `ownedCount` reading `1`;
  **per-person for two disjoint Participants reporting nothing**, and for one
  shared Participant reporting exactly that Person.
- **Only active Trips claim** — a Draft and a closed Trip hold nothing
  (invariant 17), through `isActive` and no second definition.
- **`overClaimsIfActive`** — a Draft that would clash on activation reports it;
  the same Draft reports nothing through `overClaims`.
- **`isClosed`** — an unrecognised phase is not closed, as it is not active.
- **`dimension('trip')`** — membership over non-closed Trips; the sentinel for
  unlisted Gear and its first position; the contradictory pair returning zero.

### 5.2 Tier 2 — convergence

The signature tier, and §8.3 asks for something specific: *the over-claim is
surfaced identically on every replica and resolved only by `trip.entry_removed`;
nothing recorded is discarded.*

- Two replicas, partitioned, each add the same Single Gear to a **different**
  active Trip. After exchange **both** hold both Entries and **both** compute the
  identical `overClaims` — the forbidden state is reached, retained and reported,
  not merged away.
- The same, resolved: one replica emits `trip.entry_removed`; after exchange both
  agree the over-claim is gone and the *other* Trip's Entry is **untouched**.
- Two Bring-count edits on one Entry resolve by plain LWW, and the loser's op is
  still in the log.
- `trip.entry_bring_count_set` and `trip.entry_removed` arriving **before** the
  `trip.entry_added` that creates the Entry — order-independent, converging to
  the same final state through the sourceless intermediate.
- A concurrent `trip.entry_added` and `trip.entry_removed` for one Entry:
  **two** registers (`source`, `removed`), so there is nothing contested and
  no LWW race to resolve — [sync §3.5](../sync-protocol.md)'s "delete does not
  automatically win" is satisfied by a stronger route than the one this
  section originally named: a delete does not win because it never competes.
- Per-person: two active Trips claiming one Gear for **disjoint** Participants
  converge with **no** over-claim on either replica.

`shared/src/convergence.test.ts`'s generator gains the three builders.

### 5.3 Tier 3 — component

- The trip screen renders the section band's `N ENTRIES · N PIECES`, the four
  groups with pluralised piece counts, the rows, and the trip-only badge.
- **Both modes of `/trips/:id`**: below Split the steppers, `✕`, dashed row and
  pinned button are present; from Split up they are absent and `EDIT LIST ›` is
  present.
- The stepper emits `trip.entry_bring_count_set` absolutely, and emits **nothing**
  when the value is unchanged — S6's needless-write rule, which here moves no
  visible `DAY N` but still costs an op and a sync.
- `✕` emits `trip.entry_removed` without confirming; `REMOVE ON ALPS` confirms
  first and emits against the other Trip's aggregate.
- The picker marks an already-listed Gear `IN LIST ✓`, excludes retired Gear,
  adds without navigating away, and shows **no claim read**.
- The over-claim band renders from the fold with **no interaction at all**; the
  one-Trip and N-Trip attention lines; `+ N MORE` expanding in place; an unnamed
  Trip reading `Unnamed trip`.
- The Trips list draws `BUILD LIST ›` on a Draft and a true `· N ENTRIES`.
- The two new routes redirect across the Split boundary in both directions.
- `app/src/shell/screenBand.test.tsx` counts one visible `SYNCED` for both new
  screens at phone width, at Split and at Desktop
  ([§4.11](#411-the-header-band-gains-two-callers)).
- `ui/src/Stepper.test.tsx` — both sizes, the `min` floor, the ≥44px target at
  the dense size. **Not Add gear's Owned-count well** — it keeps its own
  hand-rolled stepper and its own coverage, since it is not one of `Stepper`'s
  two callers ([§4.8](#48-uistepper--one-control-two-sizes-two-callers)).

### 5.4 The fixture rule

`shared/fixtures/s7-entries.ops.json` and `shared/src/fixtures.s7.test.ts`,
captured **in the same commit as the slice**, per
[§8.7](../architecture-design.md#87-what-every-slice-must-preserve-not-deliver)
and the lesson S6 paid for S4. The three-test shape is `fixtures.s6.test.ts`'s.

Probes, several of which no builder can author:

- All three `source` shapes, including a trip-only Entry with `name: null`.
- A `trip.entry_bring_count_set` on a **per-person** Entry — invariant 6 says it
  should not exist, [§1.4](#14-bring-count-is-folded-for-any-entry-and-offered-on-one-kind)
  says the reader folds it anyway, and this is what pins that.
- A malformed `source` (`from: "elsewhere"`), folding to a sourceless Entry that
  is retained and undrawn.
- The out-of-order case: a `trip.entry_removed` with a lower `seq` than its
  `trip.entry_added`.

**One existing assertion constrains this slice.** `shared/src/fixtures.test.ts:52`
asserts `state.unfolded.types['trip.entry_status_set'] === 1` — S9's op, planted
in the S2 fixture as an unknown-type probe. S7 must **not** fold it, and that
test failing means the slice reached past its three op types.

### 5.5 Unchanged

No endpoint, table or migration, so **no Tier 2s and no Tier 4 work**, and the
multi-household isolation test is untouched because S7 adds no server path.
Tier 5 gains nothing: the golden path completes at S10.

---

## 6. What the design round settled

`Screens B` §02C answered every question this spec's first draft left open, and
`docs/design/README.md` §5 carries the written form. Recorded here because the
reasoning is worth more than the verdict.

**Three of the first draft's decisions were reversed:**

- **The builder is its own route; `/trips/:id` does not become two panes.** The
  draft had the trip screen growing a picker pane at Split. The boards draw two
  distinct frames — a read-only trip screen and a builder with its own back
  link, title and footer — and a back link *to* the screen you are on is
  impossible. [§4.1](#41-three-routes-and-the-width-each-exists-at) is rewritten
  around it.
- **The count nouns.** The draft used `GEAR` for the list. Ruled the other way,
  and it reaches back into S6's shipped strings
  ([§4.9](#49-the-count-nouns-reach-back-into-s6s-shipped-strings)).
- **The footer totals bar does not exist below Split.** The draft kept it at every
  width; the boards fold it into the `GEAR LIST` section band, because it is *"a
  read, not an action — a pinned bar would spend the thumb zone on arithmetic."*

**Six were refined rather than reversed:** the band's placement and its
one-Trip / N-Trip copy; the `+ N MORE` cap at three rows; `Unnamed trip`; the
picker as a route below Split only; `Start pack-out` absent from the phone
entirely; and `EDIT LIST ›` as the Split-and-up editing door.

**Three of the draft's calls were blessed unchanged**, and two of them were
places the draft argued against a board:

- **`Passports ×3` is withdrawn.** The draft refused it as a board losing to
  domain invariant 6 and referred it back; the round agreed and redrew the row as
  `Passports, all`, one piece. Trip-only Entries are one piece each.
- **`SLEEP` is retired.** Grouping by Kind is ruled, with `TRIP-ONLY` keyed on the
  source. Grouping a trip's list by tag is story 13's engine applied off the
  Depot — *"booked against the day a slice claims it, never shipped by
  accident."*
- **Per-person ships `×N` with no circles**, the circles booked under a
  `CIRCLES — S8 · PIECES` scope tag and `P` leaving the keyboard hints with them.

Also ruled: `BUILD LIST ›` wins over `Build gear list`; the stepper is one
component at two sizes; `Components` §03's "no whereabouts" is confirmed
narrowly; F1's stale `BRING-COUNT` node now reads `OWNED COUNT`.

**One question the boards leave open** is
[§4.3](#43-tripsidadd--the-picker-as-a-screen-below-split)'s `+ TRIP` chip,
drawn at 393 and absent at 900 with no rule either way.

---

## 7. Technical debt this slice touches

[`technical-debt.md`](../technical-debt.md) is an index, not a record, and
pointers run one way — so nothing below adds a back-reference to it. What follows
is what S7 collides with, and what it does about each.

**Held level, not paid:**

- **`TripCard` reads the store.** S7 needs a count in it and would have deepened
  that read; instead the count arrives as a prop
  ([§4.9](#49-the-count-nouns-reach-back-into-s6s-shipped-strings)). The read
  itself remains — Participants still come from the store — and the second caller
  the entry wants does not arrive either, so **the debt is unchanged** and its
  anchor still appears. Recorded because "S7 touched this component" should not
  read later as "S7 looked at this debt and left it."

**Made stale, and corrected here:**

- **"The app has exactly one two-pane view."** That premise sits under the
  two-pane-Trips and two-pane-Add-gear entries, and under the comment at
  `app/src/screens/Trip.tsx:141`. S7's builder makes it two. The comment is
  corrected in this slice; the two debt entries keep their anchors and want their
  wording revisited by whoever next reads them.
- **`useScreenHeader`'s reach is "all eight".** S7 makes it ten
  ([§4.11](#411-the-header-band-gains-two-callers)), and `People` and `Devices`
  stop being the only width-guarded routes.

**Aggravated, and named rather than fixed:**

- **Split's two panes share one scroller.** The route-change scroll reset is
  keyed on a scroll group because `DepotView`'s panes do not scroll themselves;
  the builder is a second instance of the same shape. S7 does not fix it — story
  38 is `Later` and the honest fix is panes that scroll themselves — but it
  doubles what that fix will have to cover.

**Adjacent, and deliberately untouched:**

- **`ui/Sheet` renders every title in the display face**, parked for "whichever
  slice next opens `ui/`'s overlay primitives". S7 opens `ui/` for `Stepper` and
  adds a Sheet caller — but the trip-only sheet's title is `Trip-only entry`,
  sentence case in the display face, which is what `Sheet` already does. The debt
  is not triggered and `titleTone` is not built.
- **`DepotState` is a misnomer.** Its deferral expired when S5 landed. S7 declines
  it: this slice already reaches `TripState`, `slice.ts`, three routes and four
  screens, and the rename reaches every screen in three workspaces.
- **`ui/Popover` is unbuilt with a waiting caller.** The `TRIP` picker renders
  through the existing `ValueMenu` like every other dimension, so S7 adds no
  second waiting caller.
- **`AddGear`'s CTA is not pinned to the thumb zone.** S7 touches `AddGear` only
  to fold its hand-rolled stepper into `ui/Stepper`; the CTA is untouched.

**Ruled out despite appearances:**

- **`WhereaboutsCard` collides on a second `'trip'` slice.** Its wording — *"the
  moment two active Trips both claim one piece of Gear"* — reads like S7's
  over-claim, but `whereabouts.ts` emits no `'trip'` slice kind until S9. The trap
  stays S9's and S7 leaves `whereabouts.ts` untouched.

---

## 8. What S7 leaves for later, on purpose

**For S8** (`trip.piece_removed`, `trip.piece_restored`): the `pieces` map; the
inclusion circles and their dashed state; `P` in the keyboard hints; and the
**subtraction** from `Claim.personIds`
([§3.3](#33-per-person-claims-are-participants-until-s8-subtracts)) — a set the
claim selector already computes, so S8 changes one expression rather than adding
a branch.

**For S9**: `status`, `residence` and `stage` on the Entry; `Continue pack-out`;
the `● 48/61 PIECES` bar, whose denominator S7 delivers, drawn **below** the NEXT
line; trip whereabouts, and with it `WhereaboutsCard`'s trap.

**For S10**: `outcome` and `consumedCount`; the close gate; and
[§3.4](#34-unresolved-has-nothing-to-gate-on-until-s10)'s named insertion point in
`claim.ts`.

**For S11**: `ReopenConfirm`'s remaining block, `1 ENTRY STILL OPEN — …`.

**For S14**: `trip.deleted`; the suggestion band
(`VOSGES 2025 LIST · 24 MATCH THIS DEPOT`), which is `from_trip_id`'s reader.

**Story 38 (`Later`)** — S7 adds two routes and so two more back-navigations that
a scroll restoration will one day have to honour. Not built: it is `Later`, and
promoting it quietly is what the scope tags exist to prevent.

---

## 9. What this slice deliberately does not build

- **Pieces, packing statuses, journeys, outcomes, notes, tasks, templates, trip
  deletion.** Six later slices, all named above.
- **A `trip.entry_renamed`**, or any op not in §4.4's three.
- **A restore for `trip.entry_removed`.** The catalogue defines none; adding one
  later is additive.
- **Any server change.** No endpoint, no table, no migration.
- **Any guard that blocks an over-claim**, on any Device, at any moment.
- **The slicing engine over a Trip's list** — story 13's engine off the Depot,
  booked by the boards and owned by no slice.
- **Weight totals** — `EST 48.2 KG`, story 16, `LATER`.
- **Renaming `DepotState`**, and the rest of [§7](#7-technical-debt-this-slice-touches)'s
  untouched list.
- **The whole keyboard surface** — `↑↓ ROW · ENTER ADD/REMOVE · T TRIP-ONLY`
  under the 1024 builder, the `/` focus-search hint in both pane search
  fields, and `P` (already booked to S8 with the inclusion circles). The
  boards draw all of it; no task in this slice's plan built any of it, and
  none was ever going to — a grep of the plan finds no keybinding task. Task
  11's review caught `DepotPicker.tsx`'s search placeholder pointing at "Task
  11's own keybinding" as though a later step of this same slice would still
  add the `/` hint; that promise belonged to nobody. **Ruling: S7 ships with
  no keyboard shortcuts, coherently, and the hint strip goes with them** — a
  future slice picks the whole surface up as one package, not `/` alone
  ahead of the rest.

---

## 10. Doc amendments

| Doc | Change |
| --- | --- |
| [`sync-protocol.md`](../sync-protocol.md) §4.4 | A note that `trip.entry_bring_count_set`'s "Counted entries only" is an **authoring** rule and the reader folds it regardless ([§1.4](#14-bring-count-is-folded-for-any-entry-and-offered-on-one-kind)) — the `TagString` split restated for a second op; that `source` is one register and a trip-only Entry therefore has no rename ([§1.2](#12-source-is-one-register-and-a-trip-only-entry-cannot-be-renamed)); the payload key `gear_id` against a `gearId` register |
| [`architecture-design.md`](../architecture-design.md) | §12.13, consequences of S7; §8.3's S7 entry marked landed; §8.5's Trip-membership row marked delivered |
| [`frontend-design.md`](../frontend-design.md) | §5's primitive list: `Stepper` built, two sizes; §3.3's "all eight" becomes ten and its width-guard sentence gains the two new routes; §3.1 gains the builder's Split-and-up two-pane rule |
| [`technical-debt.md`](../technical-debt.md) | The `TripCard` entry **unchanged** — S7 held that debt level rather than paying it, the store read for Participants remains ([§7](#7-technical-debt-this-slice-touches)); the two "only one two-pane view" entries reworded; the pane-local-scroller entry gains a second instance |
| [`testing.md`](../testing.md) | The backward-compatibility fixture list gains `s7-entries` |
| `CLAUDE.md` | Status: S7 landed, and what is worth knowing before touching Entries, claims or the builder |
