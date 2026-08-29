# S7 — The gear list

The implementation design for [architecture §8.3](../architecture-design.md#83-the-slices)'s
**S7**: three op types, the Trip's first nested entity map, the builder, and the
**over-claim surfaced rather than prevented**. It delivers story **6** and
advances story **7** (Bring-count), story **32** (the overlap guard) and story
**13** (the Trip-membership dimension).

This is a **feature spec**: it is retired once the slice has shipped. It settles
what the durable docs left to the implementer and records the decisions taken
before any code was written. It does **not** revisit anything above it — the op
envelope, the HLC, per-field LWW, the op catalogue and the evolution rules are
settled in [`sync-protocol.md`](../sync-protocol.md), and every ambiguity here is
resolved by reading that document, not this one.

**The boards win.** Where this spec and `docs/design/*.dc.html` disagree, the
boards are right and this spec is wrong — except where a board disagrees with a
**domain invariant**, which outranks it, and where a board draws a surface a
later slice's ops are required to fill. Both cases occur in this slice and both
are named in [§6](#6-departures-from-the-boards). `Screens B` §02 carries the
Trips list and the `Gear list builder`; §02A carries the S6 ship state the
builder replaces; §02B carries the over-claim and reopen sheets; `Components`
§01 carries the bring-count stepper, §03 the builder row's anatomy and §04 the
`TRIP · S7` ghost chip; `User Flows` F3 carries the flow.
`docs/design/README.md` §5 and §5a are the written handoff.

S7 is the slice that gives the Trip a **nested entity map** for the first time,
and four later slices (S8 · S9 · S10 · S14) write into the one it declares.
Where a decision here is load-bearing for them, it says so.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types | **3** — `trip.entry_added`, `trip.entry_removed`, `trip.entry_bring_count_set` |
| Endpoints | **None.** `api/src/sync/envelope.ts` already accepts an unknown `type` verbatim; S7 is client-side plus three op types |
| Migration | **None** |
| `source` | **One register** holding a discriminated union, per [sync §3.7](../sync-protocol.md). Wire `gear_id` → state `gearId`, the `readOwner` precedent ([§1.2](#12-source-is-one-register-and-a-trip-only-entry-cannot-be-renamed)) |
| Renaming a trip-only Entry | **Not expressible**, and deliberately so — the catalogue defines three gear-list ops and none of them is a rename ([§1.2](#12-source-is-one-register-and-a-trip-only-entry-cannot-be-renamed)) |
| An Entry with no `source` | **Folded and retained; not drawn and not counted.** There is no defaultable value, so unlike `phase` it gets no fallback ([§1.3](#13-an-entry-with-no-source-is-folded-retained-and-not-drawn)) |
| `bring_count` on a non-Counted Entry | **Folded** — the reducer knows no Kind. Invariant 6 is honoured by the *authoring* screen, the `TagString` split ([§1.4](#14-bring-count-is-folded-for-any-entry-and-offered-on-one-kind)) |
| Over-claim | A **selector over the fold**, no op, no flag. Resolved only by `trip.entry_removed` or a lower Bring-count ([§3.2](#32-the-claim-selector-reads-once-per-kind)) |
| Per-person claims at S7 | Derived from **Participants**, because Pieces *are* Participants until S8 tombstones some ([§3.3](#33-per-person-claims-are-participants-until-s8-subtracts)) |
| "Unresolved" | Every non-removed Entry, until S10 gives outcomes something to say. The gate goes **inside the claim selector**, nowhere else ([§3.4](#34-unresolved-has-nothing-to-gate-on-until-s10)) |
| The over-claim's shape | **One persistent band** on the trip screen, because the over-claim is a property of the fold. The two drawn sheets are previews of it ([§4.6](#46-the-over-claim-is-a-property-of-the-fold-so-the-surface-is-persistent)) |
| Trip membership dimension | `dimension('trip')`, label **`TRIP`**, arity **`multi`**, sentinel value `none` → `NOT IN ANY TRIP`. Membership is every **non-closed** Trip ([§3.6](#36-trip-membership-joins-the-dimension-table)) |
| The first cross-aggregate dimension | Needs an index `valuesOf` has nowhere to cache; a `WeakMap` keyed on `DepotState` ([§3.7](#37-the-first-cross-aggregate-dimension-needs-an-index)) |
| The builder below Desktop | **Undrawn by the boards.** Two panes at Split and up; below it the picker is a **screen**, `/trips/:id/add`, on Add gear's own reasoning ([§4.2](#42-the-board-draws-1024-and-s7-owes-the-other-four-modes)) |
| `ui/Stepper` | **Built**, and Add gear + gear detail's Owned-count converted to it. Three callers, one control ([§4.5](#45-the-bring-count-stepper-becomes-uistepper)) |
| Per-person inclusion circles | **Deferred to S8.** Three identical solid circles encode nothing until one can be dashed ([§6.2](#62-the-per-person-inclusion-circles-wait-for-the-op-that-gives-them-meaning)) |
| The suggestion band | **Deferred to S14.** It is `from_trip_id`'s reader ([§6.3](#63-the-suggestion-band-is-s14s)) |
| Grouping the trip's list | **By Kind**, plus `TRIP-ONLY` as a fourth group. The board's `SLEEP` header is story 13's engine on a list that is not the Depot ([§6.4](#64-the-lists-groups-are-kinds-and-the-boards-sleep-header-is-not-s7s)) |
| The Trips list | `BUILD LIST ›` lands, `N GEAR LISTED` becomes true, and the NEXT line's three redraws land with it ([§4.7](#47-the-trips-list-catches-up-with-the-board)) |
| `TripCard` moving to `ui/` | **No.** S7 gives it no second caller |
| Fixture | `shared/fixtures/s7-entries.ops.json` + `shared/src/fixtures.s7.test.ts`, captured in the same commit ([§5.4](#54-the-fixture-rule)) |

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
Five questions the catalogue leaves open are closed below.

### 1.1 The register map is the contract

[Sync §3.7](../sync-protocol.md) already states the shape S6 declined to build:

| Entity path | Registers |
| --- | --- |
| `entries.<entry_id>` | `source`, `bring_count`, `status`, `residence`, `stage`, `outcome`, `consumed_count`, `removed` |
| `entries.<entry_id>.pieces.<person_id>` | `status`, `residence`, `outcome`, `removed` |

S7 declares **three of the eight** — `source`, `bringCount`, `removed` — and
declares the `pieces` map not at all. S6 set the precedent by declaring the Trip
root's registers and none of the four nested maps, and the reason is the same:
a register nobody writes is a field every reader has to have an opinion about.
S9 adds `status`, `residence` and `stage`; S10 adds `outcome` and
`consumedCount`; S8 adds `pieces`.

`writeEntry` follows `writeTrip` (`shared/src/reduce.ts:117`) exactly — nested
one level deeper, and with the same identity check at each level so a lost write
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
the Trip so created has a `name` register nobody wrote and — per
[§12.11](../architecture-design.md#1211-consequences-of-s6-trips-and-phases) —
no `phase` register either, so it reads `draft`. That is the out-of-order case
S6 already handles and S7 must not special-case.

The generic `writeEntity` that would collapse `writePlace`, `writeGear`,
`writePerson`, `writeTrip` and `writeEntry` into one is **still not taken**, for
the reason recorded at `shared/src/reduce.ts:106-116`. `writeEntry` is the fifth
instance of the shape and the first at two levels; if a sixth arrives the
argument should be re-opened, and this sentence is the marker.

### 1.2 `source` is one register, and a trip-only Entry cannot be renamed

§3.7 lists `source` as **one** register, not three, so the whole discriminated
union is written and compared as a unit:

```ts
export type EntrySource =
  | { from: 'depot'; gearId: string }
  | { from: 'trip_only'; name: string | null; container: boolean }
```

Wire `gear_id` becomes `gearId` in state, the split `readOwner`
(`shared/src/payloads.ts:98`) already has over `person_id` → `personId`. `S7`
adds `readSource` beside it — the third discriminated-object reader after
`readResidence` and `readOwner`, and the first that reads a `string | null`
inside one. A payload whose `from` is neither `depot` nor `trip_only`, or whose
`gear_id` is missing, reads `absent` and writes nothing: the op still folds, the
Entry is still created by [§1.1](#11-the-register-map-is-the-contract)'s implicit
creation, and the result is [§1.3](#13-an-entry-with-no-source-is-folded-retained-and-not-drawn)'s
sourceless Entry. It is never rejected.

**A trip-only Entry therefore cannot be renamed.** The catalogue defines three
gear-list ops and none of them is `trip.entry_renamed`; a rename would have to
rewrite the whole `source` register, carrying `container` along with it, and
two Devices renaming concurrently would each clobber the other's trait. This is
recorded as a **deliberate omission** rather than smuggled in, on the precedent
of the containment trait's own missing mutation op
([sync §4.3](../sync-protocol.md)): if it turns out to be real, it is a new,
additive op type and the register map grows a `name` beside `source` rather than
the union growing a writer. Until then the builder's trip-only row offers
**remove and re-add**, which is one op each and loses nothing, because a
trip-only Entry references nothing and carries no history a Depot record would.

### 1.3 An Entry with no `source` is folded, retained, and not drawn

S6 settled that an absent `phase` register reads `draft`, and S4 that an absent
`owner` reads `SHARED`. **`source` gets no such rule**, because there is nothing
to default it to: an Entry that names neither a piece of Gear nor a trip-only
name is not a line anybody can draw. It is reachable exactly the way S6's
phaseless Trip is — `trip.entry_bring_count_set` and `trip.entry_removed` both
create the Entry on sight, so either arriving before its `trip.entry_added`
leaves an Entry with a Bring-count or a tombstone and no source.

So the rule, stated once in `shared/src/selectors/entry.ts` and read through one
function everywhere:

> **`entriesOf(trip)` returns Entries that carry a `source` and are not
> tombstoned.** A sourceless Entry is retained in the fold, excluded from the
> list, excluded from every count, and holds no claim.

Nothing is discarded and nothing is guessed: the moment the `trip.entry_added`
arrives the Entry appears, in the position its own clock earns it. Excluding it
from **claims** as well as from the list is the conservative direction and
matches S6's treatment of an unrecognised phase — an old build never over-states
what a Trip is doing, and a claim the user cannot see is a claim they cannot
settle.

### 1.4 Bring-count is folded for any Entry, and offered on one Kind

Domain invariant 6 says bring-count exists **only** for counted entries. The
reducer cannot enforce it and must not try: `trip.entry_bring_count_set` carries
`{entry_id, count}` and nothing else, the Entry's Kind lives on a *different
aggregate* (`GearState.kind`), and a trip-only Entry has no Kind at all. Resolving
the Kind inside the reducer would make the fold order-dependent — the same
`trip.entry_bring_count_set` would write or not write depending on whether the
`gear.kind_set` had arrived — which is precisely what per-field LWW exists to
avoid.

This is the `TagString` split, transplanted:

- **The authoring screen is the whole of the defence.** The stepper is offered on
  an Entry whose `source.from === 'depot'` and whose Gear's `kind` reads
  `counted`, and nowhere else.
- **The reader is entirely tolerant.** `bringCount` folds for any Entry, exactly
  as received, and `readCount` (`shared/src/payloads.ts:70`) already rejects
  non-integers and negatives by reading them `absent`.

The consequence worth naming: a Gear whose Kind is changed from `counted` to
`single` leaves a `bringCount` register on every Entry that referenced it. That
register is **not cleared** — clearing it would be a write nobody asked for, and
S4's rule that a needless write moves `recordedAt` applies. Every reader gates
on the Kind instead, which is the same three-site rule `ownedCount` already
carries (`shared/src/selectors/depot.ts:104`,
`shared/src/selectors/whereabouts.ts:56`, `app/src/screens/GearDetail.tsx:77`).
S7 adds the fourth site and, because there are now four, moves the question
behind one function: **`bringCountOf(entry, state): number | null`** in
`shared/src/selectors/entry.ts`, returning `null` for every Entry that is not a
Counted depot Entry. The claim selector, the row, the group counts and the
footer totals all call it.

**An absent `bringCount` on a Counted Entry reads `1`.** Adding Counted gear to
a Trip without touching the stepper means bringing one, and writing a register
to say so would move nothing and cost an op. `bringCountOf` is the only place
that says this.

### 1.5 `trip.entry_removed` is the only resolution, and it is not a cascade

[Sync §3.5](../sync-protocol.md) makes the tombstone an ordinary LWW field with
no restore op defined in the MVP, and §3.6 makes `trip.entry_removed` the way an
over-claim is settled. Two things follow that the implementation must not
improve on:

- **Removing an Entry writes one register on one Entry.** It does not touch the
  Depot (invariant 8), does not touch the other Trip in an over-claim, and does
  not cascade to the Entry's Pieces when S8 gives it some — a tombstone never
  cascades, and `entriesOf` filtering the Entry out is what makes its Pieces
  unreachable without a second write.
- **Re-adding is a new Entry with a new id**, not a restore. There is no
  `trip.entry_restored`, so a Quartermaster who removes and re-adds the same
  Gear gets a fresh Entry — and, at S9 and S10, none of the old one's packing
  state. That is the honest outcome of the catalogue as frozen and is stated
  here so nobody later reads the missing restore as an oversight.

---

## 2. State shape

`shared/src/state.ts` gains one interface and one field, and the `TripState`
docstring at `state.ts:95-99` — which reserves the four nested maps — loses its
first reservation.

```ts
/**
 * One line on a Trip's gear list ([sync §3.7]).
 *
 * S7 declares three of the eight registers §3.7 names. `status`, `residence`
 * and `stage` are S9's; `outcome` and `consumedCount` are S10's; the `pieces`
 * map is S8's. A register nobody writes is a field every reader must have an
 * opinion about, so each arrives with the slice that writes it.
 */
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

`entries` is a `Record` of entities, not of registers — this is the first map of
its kind in the codebase, and it is deliberately *not* the shape `participants`
and `tags` use. Those are **sets**, whose member carries only presence; an Entry
is an **entity** with registers of its own. The two shapes look alike and mean
different things, and conflating them is how a `bring_count` would end up with
nowhere to live.

`EntrySource` is exported from `shared/src/state.ts` beside `Residence` and
`Owner`, and, like `KindValue` and `PhaseValue`, its `from` discriminant is
**not** widened with `(string & {})`: an unrecognised `from` never reaches state
because `readSource` reads it `absent` ([§1.2](#12-source-is-one-register-and-a-trip-only-entry-cannot-be-renamed)).
The tolerance lives at the boundary, and the state type stays closed so a `switch`
over it is exhaustive.

---

## 3. Selectors

A new file, `shared/src/selectors/entry.ts`, and edits to two existing ones
(`trip.ts`, `slice.ts`). Every question below gets **exactly one** function, and
no call site re-derives one — the discipline S6 paid for three times over
([§12.11](../architecture-design.md#1211-consequences-of-s6-trips-and-phases)).

### 3.1 `entriesOf`, and what a "piece" counts

```ts
entriesOf(trip: TripState): readonly EntryState[]
entryLabel(entry: EntryState, state: DepotState): string
entryKind(entry: EntryState, state: DepotState): KindValue | 'trip_only'
bringCountOf(entry: EntryState, state: DepotState): number | null
pieceCountOf(entry: EntryState, trip: TripState, state: DepotState): number
listTotals(trip: TripState, state: DepotState): ListTotals
```

`entriesOf` applies [§1.3](#13-an-entry-with-no-source-is-folded-retained-and-not-drawn)'s
rule and sorts by `byNameThenId` over `entryLabel`, so two replicas draw the same
order. `entryLabel` reads the referenced Gear's `name` through the Depot for a
depot Entry — **invariant 8's single-sourcing is this one line** — and the
`source`'s own `name` for a trip-only one, falling back to `'—'` the way
`tripLabel` does.

`pieceCountOf` is the arithmetic the footer and every group header need, and it
is the one place the three Kinds diverge:

| Entry | Pieces |
| --- | --- |
| Single depot Entry | `1` |
| Counted depot Entry | `bringCountOf(entry, state)` — an absent register reads `1` |
| Per-person depot Entry | `participantIds(trip).length` — the starting default, and **all** of it until S8 |
| Trip-only Entry | `1` ([§6.1](#61-a-trip-only-entry-has-no-kind-so-passports-3-is-not-built)) |
| Gear with an unrecognised Kind | `1` — the conservative direction, and the same choice `whereabouts.ts:56` already makes |

`listTotals` returns `{ gear, pieces, perPerson, tripOnly }`, which is the
footer's `34 GEAR · 61 PIECES · 18 PER-PERSON · 3 TRIP-ONLY` and nothing else.
`gear` counts Entries; `pieces` sums `pieceCountOf`; `perPerson` sums it over
per-person Entries only; `tripOnly` counts trip-only Entries. The card's
`N GEAR LISTED` reads `gear`; the trip screen's `N PIECES LISTED` reads `pieces`.
Both strings are drawn, on two surfaces, and they are not the same number by
design.

### 3.2 The claim selector reads once per kind

Domain §5.2's supply rule is three sentences, and the selector is three
branches. It lives in `shared/src/selectors/claim.ts` and calls `isActive`
(`shared/src/selectors/trip.ts:216`) — **the only definition of active-ness in
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
  /** Every active Trip's claim on this Gear, the subject Trip included. */
  readonly claims: readonly Claim[]
  /** `ownedCount` for Counted; 1 for Single; the contested people otherwise. */
  readonly supply: number
  readonly claimed: number
  readonly contestedPersonIds: readonly string[]
}

overClaims(state: DepotState): readonly OverClaim[]
overClaimsFor(state: DepotState, tripId: string): readonly OverClaim[]
overClaimsIfActive(state: DepotState, tripId: string): readonly OverClaim[]
```

- **Single** — supply is one. More than one active Trip holding an unresolved
  Entry for that Gear is an over-claim. `ownedCount` is *not* consulted: invariant
  6 confines it to Counted gear, and a Single gear with a stray `owned_count`
  register from an edited Kind must not quietly raise its own supply.
- **Counted** — `sum(bringCountOf) > ownedCount`. An absent `ownedCount` reads
  `1`, the same default `whereabouts.ts` uses, so a Counted gear nobody gave a
  count behaves as one thing rather than as unlimited supply.
- **Per-person** — supply is one *per Person*. Two active Trips claiming the
  same Gear for disjoint Participants is **legitimate and common**, and the
  selector must not report it; only a Person appearing in both Trips'
  Participant sets for that Gear is contested. `contestedPersonIds` is what the
  surface names.

`overClaimsIfActive` is the third function only because the domain guards at
three moments and two of them ask a hypothetical: *would* activating this Draft
over-claim. It folds the subject Trip in as though active and otherwise defers to
`overClaims`. Having it as its own function is what stops the SET PHASE sheet
re-deriving activeness inline — the exact failure three S6 reviews caught.

### 3.3 Per-person claims are Participants until S8 subtracts

A per-person Entry's claim is one unit per **Piece**, and Pieces are
"derived from the trip's participants, minus those explicitly tombstoned"
([sync §4.4](../sync-protocol.md)). S8 introduces the tombstones. **At S7 there
are none**, so Pieces are exactly Participants and the per-person claim is fully
computable now — which is why §8.3 asks for the claim selector "across the three
Kinds" in a slice that builds no Pieces.

The shape this leaves S8 is the point: `personIds` on a `Claim` is already the
set the selector reasons over, so S8's `trip.piece_removed` becomes a
**subtraction from a set that exists** rather than a new branch. Written down
because the tempting S7 shortcut — a per-person claim of "the participant count"
as a bare number — would compare counts instead of people, and would report
two Trips taking one headlamp each for two different People as an over-claim.
That is the one thing story 6 explicitly says is legitimate.

### 3.4 "Unresolved" has nothing to gate on until S10

A claim is held by an **unresolved** Entry — one with no unpack outcome. At S7
no Entry can have an outcome, so every non-removed Entry on an active Trip is
unresolved, and the selector reads them all.

The gate is not written as a function that always returns `false`. It is
recorded as a **one-line insertion point inside `claim.ts`**, because that file
is the only reader of the notion and S10 is the slice that gives it content.
Adding `isResolved(entry) => false` now would be a speculative function with no
caller able to make it true, and the codebase would gain a fifth thing about
outcomes to keep in agreement before outcomes exist. The insertion point is
named in the docstring so S10 does not have to find it.

### 3.5 The over-claim view is a pure function of the fold

`overClaims(state)` reads registers only. It takes no argument saying which
Device did what, keeps no flag, and writes nothing. Two consequences that the
Tier 2 assertion in §8.3 is precisely about:

- **Every replica computes the identical set**, because every replica holds
  identical registers. This is the containment-cycle argument
  ([sync §3.6](../sync-protocol.md)) applied to the second condition the reducer
  must not resolve.
- **It disappears only when a Quartermaster removes an Entry or lowers a
  Bring-count**, and both are ordinary ops that merge like any other. Nothing is
  discarded to resolve it, which is story 6's closing sentence.

### 3.6 Trip membership joins the dimension table

`DimensionId` widens to `'tag' | 'kind' | 'ownership' | 'person' | 'trip'` and
the table gains a row — the shape §8.5 books for S7 and the fifth dimension the
table carries.

| Property | Value | Why |
| --- | --- | --- |
| `label` | `TRIP` | `Components` §04 draws the ghost as `TRIP · S7`, not `TRIP MEMBERSHIP` |
| `arity` | `multi` | Tag's arity, not Kind's. A gear genuinely carries several Trips, and multi is what keeps the `+ TRIP` ghost chip while one is selected |
| `valuesOf` | the ids of every **non-closed** Trip listing this gear, or `['none']` | below |
| `format` | the Trip's `tripLabel`, and `NOT IN ANY TRIP` for `none` | the sentinel is checked first |

**Membership means every non-closed Trip, not every active one.** Story 13's own
example is "everything not in any Trip", which is a *planning* question — what
have I not yet spoken for — and a Draft speaks for gear as surely as a Pack-out
does. Closed Trips are excluded because their lists are history: a Gear that
went to Scotland in 2024 is not thereby spoken for, and including closed Trips
would make the sentinel value permanently empty for any household with a past.
This needs a predicate `isActive` cannot give, so `shared/src/selectors/trip.ts`
gains **`isClosed(trip)`** beside it — one function, one question, and an
unrecognised phase is **not** closed, the same conservative direction that makes
it not active.

The sentinel is the literal string `none`. Trip ids come from
`systemIdSource`, so there is no collision, and a reserved plain-word value is
the shape `dimension('ownership')` already uses with `shared` and `personal`.

**A contradictory pair is reachable and is not guarded**, exactly as at S4:
selecting `NOT IN ANY TRIP` together with a named Trip returns `0 OF N`. The
engine has one filter rule, a second combinator between dimensions is what S3
refused to build, and `0 OF N` is the honest answer.

### 3.7 The first cross-aggregate dimension needs an index

`sliceDepot` calls `valuesOf(gear, state)` once per Gear per active dimension.
Every dimension before this one answers from the Gear's own registers in
constant time. Trip membership does not: answering it per Gear means scanning
every Trip's Entries, which makes the Depot list **O(gear × entries)** on the
app's most-visited screen.

S3 passed `state` into `valuesOf` so the table "would not be reshaped by the
first dimension that needs it" — that settled the *signature*, and left the
*cost* to whichever slice arrived first. This is it.

The fix is a memo, not a reshape: a module-level
`WeakMap<DepotState, Map<string, readonly string[]>>` inside `slice.ts`, built on
first ask and keyed on the folded state itself. `DepotState` is immutable and
its identity changes on exactly the folds that could change the answer
(`shared/src/reduce.ts` returns the same object when a write loses), so the key
is exact rather than approximate, and a `WeakMap` lets superseded states be
collected. No API changes, no reshape, and the row stays a row.

---

## 4. Screens

### 4.1 `/trips/:id` — the builder

S6 built the header — title, `EDIT`, phase chip with `DAY N`, dates,
Participants — and left `app/src/screens/Trip.tsx:376-378` as a hole reading
`0 GEAR LISTED.` S7 fills it, and touches the header exactly twice: the piece
count joins it, and a Draft gains `Start pack-out`.

The gear-list region, top to bottom:

1. **The over-claim band**, when `overClaimsFor` returns anything
   ([§4.6](#46-the-over-claim-is-a-property-of-the-fold-so-the-surface-is-persistent)).
2. **Groups**, by Kind, with the board's mono headers and piece counts:
   `SINGLE` · `COUNTED` · `PER-PERSON` · `TRIP-ONLY`, each with `N PIECES`, each
   omitted when empty ([§6.4](#64-the-lists-groups-are-kinds-and-the-boards-sleep-header-is-not-s7s)).
3. **Entry rows.** Name, then the trailing controls the Kind earns: a
   `− ×N +` stepper on a Counted Entry, `×N` alone on a per-person one, nothing
   on a Single one, and the amber `TRIP-ONLY` badge on a trip-only one. Every
   row ends in `✕`.
4. **The dashed add row**, verbatim:
   `+ TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE`.
5. **The footer totals bar** — `34 GEAR` · `61 PIECES` · `18 PER-PERSON` ·
   `3 TRIP-ONLY`, the MVP variant the board draws under the frame. `EST … KG` is
   story 16 and is not built.

**The empty state keeps both of S6's strings and gains the affordances the S6
board promised it would**: `0 GEAR LISTED.` and
`The gear list is built from the depot.` stay exactly as they are — a permanent
domain fact, not release meta-text — with the depot-picker affordance and the
trip-only add row beneath them.

`✕` **does not confirm.** Removal is one op, the gear is untouched, and re-adding
is two taps — the same reasoning that leaves tag-chip removal unconfirmed
(`docs/design/README.md` §4). It is not the Home picker's `MOVE`, where a
mis-tapped destination in a nested picker is unrecoverable.

### 4.2 The board draws 1024, and S7 owes the other four modes

`Screens B`'s `Gear list builder` frame is `width:1024px` and **there is no
phone, Roomy or Split counterpart anywhere in `docs/design/`**. The two-pane
`440px | 1fr` grid is the Desktop drawing, and
[frontend-design §3.1](../frontend-design.md) unlocks two panes at **Split
(52em)**, not at Desktop. So S7 decides four of the five modes, and the decision
is a **media** query, not a container one: the panes either exist or they do not,
and rendering both and hiding one would put every Entry in the accessibility
tree twice ([frontend-design §3.2](../frontend-design.md)).

- **Split and Desktop (≥ 52em)** — two panes. `440px | 1fr` at Desktop; at Split
  the left pane takes the same 440px only where the shell affords it, and
  otherwise the grid falls to `minmax(308px, 40%) | 1fr` — 308px being the pane
  width S3 already builds `GearRow` to fold inside.
- **Compact, Comfortable, Roomy (< 52em)** — one column. The trip's list is the
  screen; the depot picker is a **route**, `/trips/:id/add`
  ([§4.3](#43-tripsidadd--the-depot-picker-is-a-screen-not-a-sheet)).

The rows inside either arrangement fold on a `@container` query, so the picker
row and the Entry row are correct in a 308px Split pane and a wide Desktop
column without either knowing the viewport.

### 4.3 `/trips/:id/add` — the depot picker is a screen, not a sheet

Below Split the picker gets its own route, on the argument `docs/design/README.md`
§3b already made for Add gear and won: *a screen, not a sheet — the OS keyboard
owns the lower half for a whole sitting.* Every clause transfers. The picker
opens with a search field, so the keyboard is up immediately; `IN LIST ✓` means
the row stays visible after the add, so the sitting is a batch loop rather than
a single pick; and the Home picker's sheet — the counter-precedent — closes on
selection, which is exactly what this must not do.

The screen is the board's left pane, unchanged: eyebrow `FROM THE DEPOT`, the
search field, the filter chips, 40px rows carrying the name and the home path,
and the pane footer `ADDING LISTS IT — GEAR DOES NOT MOVE UNTIL PACK-OUT`. At
Split and up the same component renders as the left pane and the route
redirects to `/trips/:id`, so there is one picker and one set of tests.

Three details the boards fix:

- **`+ ADD` / `IN LIST ✓`**, the second exactly as drawn — mono, packed-green,
  the row muted. Its grammar is deliberately the Participants picker's
  `PARTICIPANT ✓`, and `docs/design/README.md` §5 says so; the two multi-select
  affirmations stay isomorphic.
- **Retired Gear is not offered.** The picker reads `visibleGear`, which excludes
  it. Story 2 makes retiring a soft delete so past Trips keep their history, not
  so retired gear can join new ones.
- **The picker's meta slot carries the home path** (`GARAGE ▸ SHELF 1`), as
  drawn. `Components` §03's "no whereabouts" reads narrowly and correctly: the
  builder row shows no **world** — no `⌂ HOME` / `▸ ON TRIP` chip, no packing
  status — while the home *path* is the meta line, which is the distinction
  `docs/design/README.md`'s whereabouts-words rule already draws.

An empty or unmatched picker reuses `Components` §07's generic empties —
`Empty depot.` / `+ Add gear` and `No matches.` / `Clear filters` — because the
board draws no builder-specific one and inventing a fourth empty voice would be
the departure.

### 4.4 The trip-only Entry

The dashed row opens a small `Sheet` — a decision, not a sitting, so §3b's
screen argument does not transfer — carrying a name field and the
`ITEM · CONTAINER` segmented control Add gear uses, in Add gear's order: name
first, trait last, beside the CTA, because it is the rarest decision and, per
[§1.2](#12-source-is-one-register-and-a-trip-only-entry-cannot-be-renamed), the
only irreversible one here too. It emits one `trip.entry_added` carrying both.

**No tag picker ever mounts on it** — invariant 9, and `Screens B` §01B states
the rule "now, because the trip-side screens reuse this exact chip and picker
from S7 on". S7 is that slice, and it reuses the chip nowhere: a trip-only Entry
is not a Gear aggregate and has no tag register to write.

**No Kind control, and so no stepper** ([§6.1](#61-a-trip-only-entry-has-no-kind-so-passports-3-is-not-built)).

### 4.5 The bring-count stepper becomes `ui/Stepper`

[Frontend-design §5](../frontend-design.md) lists `Stepper` among the unbuilt
primitives; `Components` §01 draws it as `BRING-COUNT STEPPER · 48PX TARGETS ·
LIVE`; and Add gear and gear detail have each hand-rolled one for Owned-count
already. S7 builds it in `ui/` and **converts both existing call sites**, giving
it three.

This is a deliberate widening of the slice and the reason is the codebase's own
standard: `ui/src/GearRow.tsx` and `app/src/components/TripCard.tsx` both carry
a note saying a component moves to `ui/` when a second caller arrives, and
leaving two hand-rolled spellings of one control beside a third in `ui/` is the
drift this repo documents against everywhere else. The conversion is small,
covered by the existing Add gear and gear detail tests, and is the last moment it
is cheap.

The two heights the boards draw are both correct and both kept: `Components`'
48px is the standalone control (Add gear's Owned-count, and the picker screen at
Compact), and the builder's in-row 32px is the dense variant. One `size` prop,
`'default' | 'dense'`, and the 48px minimum touch target is preserved at
`'dense'` by padding the hit area beyond the painted box rather than by shrinking
it.

`Stepper` takes `{ value, min, onChange, size?, label }`, holds no state, and —
like every `ui/` component — imports neither the store nor the router. `min` is
`0`, per `trip.entry_bring_count_set{count: int ≥ 0}`: a Bring-count of zero is
expressible on the wire, and it is **not** the same as removing the Entry, which
is invariant 11's whole point. It claims nothing and lists nothing, and the row
stays.

### 4.6 The over-claim is a property of the fold, so the surface is persistent

The domain names three moments to guard, and story 6 adds a fourth condition
that is not a moment at all: an over-claim that **arrives through sync**, when
nobody is doing anything. A surface built only as two modal sheets cannot report
that one, and §8.3's Tier 2 requires it be "surfaced identically on every
replica".

So the primary surface is **a persistent attention band** on `/trips/:id`,
rendered whenever `overClaimsFor` returns anything, carrying the board's own
anatomy: the mono attention line `▲ 2 entries are already claimed by Alps 2026.`,
then one row per conflict with the name, the mono fact, and the settle routes in
accent. It is a pure render of [§3.5](#35-the-over-claim-view-is-a-pure-function-of-the-fold),
so it appears the moment the conflicting op lands and disappears the moment
somebody settles it — on every Device, with no notification machinery and
nothing to dismiss.

The three drawn moments are then **previews of that band**, not separate
mechanisms:

| Moment | Surface | Op |
| --- | --- | --- |
| Adding to an **active** Trip's list | the add lands; the band appears | `trip.entry_added` |
| Draft → Pack-out | `Start pack-out — Vosges?` sheet, `overClaimsIfActive` | `trip.phase_moved` |
| Reopening a closed Trip | the `▲` block returns to S6's `ReopenConfirm` | `trip.phase_moved` |

The verbatim copy is the board's and is not paraphrased: the attention line, the
per-conflict facts `SINGLE · STILL OUT` and `×2 LISTED · ×1 OUT · OWNED ×2`, the
settle routes `REMOVE HERE` · `REMOVE ON ALPS` · `BRING ×1 HERE`, and the body
`Starting warns, never blocks. Nothing is removed unless you choose it.` The
primary stays **filled accent** and the treatment is attention colour and `▲`
only — *never a filled red button, never a block, never discarded work.*

**Adding to an active Trip is never gated.** The board's own decision card puts
the check at "adding gear to an active trip's list", and reading that as a
pre-add confirm would be the one thing the same card forbids two lines later.
Offline-first settles it independently: the add is a local op, and a modal that
could be answered "no" only on the Device that happens to hold both Trips'
recent ops would be a guard that works by luck.

`REMOVE ON ALPS` emits a `trip.entry_removed` against a **different aggregate**
than the screen. That is ordinary — it is one op in one push batch, exactly as
[sync §4.5](../sync-protocol.md)'s gestures are — but it is the first time a
screen authors against a Trip it is not showing, and the confirm-free rule of
[§4.1](#41-tripsid--the-builder) does **not** extend to it: removing something
from a Trip the reader is not looking at gets a `Confirm`, because the
undo is a navigation away.

S6's `ReopenConfirm` gains only the over-claim block. Its other deferred block,
`1 ENTRY STILL OPEN — HEADLAMP, K · ▲ LOST`, needs outcomes and stays S11's, as
S6's §6.3 said.

### 4.7 The Trips list catches up with the board

Three strings and one count come true in this slice, and one of them is only
possible now.

- **`BUILD LIST ›`** lands on the Draft card, per the rule S6 stated and this
  slice discharges: *a board's CTA copy lands on the slice that builds the
  board's destination.* `Continue pack-out` still does not, and stays absent
  until S9.
- **`N GEAR LISTED`** becomes `listTotals().gear` in both places it is currently
  hardcoded — `app/src/components/TripCard.tsx:133` and
  `app/src/screens/Trip.tsx:377`.
- **The progress line returns above the next-step line**, per S6 §6.2, which said
  S7 and S9 return it "above it rather than in place of it". At S7 the
  denominator exists but the numerator does not — packed counts are S9 — so
  what returns is the board's Draft-card form, `N GEAR LISTED`, and the
  `● 48/61 PIECES` bar waits for the slice that can count the 48. The next-step
  line stays where it is.
- **The NEXT line moves onto Draft cards**, and its two redrawn strings land:
  `NEXT — PACK IT` → **`NEXT — PACK THE LIST`** and
  `NEXT — MARK UNPACK WHEN YOU ARE BACK` → **`NEXT — SET UNPACK WHEN BACK`**
  (`shared/src/selectors/trip.ts:97,104`).

The last is S7's rather than a stray correction, and the board says why: the line
was shipped active-only because on a Draft it would restate `DRAFT · 0 GEAR
LISTED`, and *"the redundancy argument dies at `DRAFT · 14 GEAR LISTED`"* — which
becomes possible in exactly this slice. `TripCard.tsx:88-93`'s comment records
the old reasoning and is replaced with the new.

### 4.8 The Depot's slice bar gains `TRIP`

`Components` §04's dashed `TRIP · S7` becomes a live chip. No new control, no new
layout: `SliceBar` is driven off `DIMENSIONS` and picks the row up for free, at
all five layout modes, and `ValueMenu` renders the values. S4 extended the table
by adding two rows and widening `format`; S7 adds one row and changes no
signature at all, which is the test §8.5 set for the engine.

---

## 5. Tests

### 5.1 Tier 1 — unit

In `shared/src/selectors/entry.test.ts`, `claim.test.ts`, and additions to
`trip.test.ts` and `slice.test.ts`.

- **`entriesOf`** — a tombstoned Entry is excluded; a **sourceless** Entry is
  excluded, retained in the fold, and appears the moment its `trip.entry_added`
  lands; ordering is total and identical from two op orders.
- **The reference is a reference** — renaming Gear in the Depot changes
  `entryLabel` with no Trip op at all (invariant 8), and a trip-only Entry's
  label survives a Gear rename because it names nothing.
- **`pieceCountOf` across the three Kinds**, plus the trip-only and
  unrecognised-Kind rows of [§3.1](#31-entriesof-and-what-a-piece-counts)'s table.
- **`bringCountOf`** — absent reads `1` on a Counted Entry; `null` on Single,
  per-person and trip-only Entries; a `bringCount` register surviving a Kind
  change to `single` reads `null` and is **not** cleared from state.
- **The claim selector across the three Kinds** (§8.3's own words) — Single
  exclusive; Counted summing past `ownedCount`, and an absent `ownedCount`
  reading `1`; **per-person for two disjoint Participants reporting nothing**,
  and for one shared Participant reporting exactly that Person.
- **Only active Trips claim** — a Draft and a closed Trip hold nothing
  (invariant 17), through `isActive` and no second definition.
- **`overClaimsIfActive`** — a Draft that would clash on activation reports it;
  the same Draft reports nothing through `overClaims`.
- **`isClosed`** — an unrecognised phase is not closed, as it is not active.
- **`dimension('trip')`** — membership over non-closed Trips; the `none`
  sentinel for unlisted Gear; the contradictory pair returning zero.

### 5.2 Tier 2 — convergence

The signature tier, and §8.3 asks for something specific here: *the over-claim is
surfaced identically on every replica and resolved only by
`trip.entry_removed`; nothing recorded is discarded.*

- Two replicas, partitioned, each add the same Single Gear to a **different**
  active Trip. After exchange, **both** hold both Entries and **both** compute
  the identical `overClaims` — the state the domain forbids is reached, retained,
  and reported, not merged away.
- The same, resolved: one replica emits `trip.entry_removed`; after exchange both
  replicas agree the over-claim is gone and the *other* Trip's Entry is
  **untouched**.
- Two Bring-count edits on one Entry resolve by plain LWW, and the loser's op is
  still in the log.
- `trip.entry_bring_count_set` and `trip.entry_removed` arriving **before** the
  `trip.entry_added` that creates the Entry — the fold is order-independent, and
  the sourceless intermediate state converges to the same final state.
- A `trip.entry_added` and a `trip.entry_removed` for the same Entry, concurrent:
  one register, plain LWW, and delete does not automatically win
  ([sync §3.5](../sync-protocol.md)).
- Per-person: two active Trips claiming one Gear for disjoint Participants
  converge with **no** over-claim reported on either replica.

`shared/src/convergence.test.ts`'s generator gains the three builders.

### 5.3 Tier 3 — component

- The builder renders groups, rows, the trip-only badge and the footer totals
  from a folded state; the empty state keeps both S6 strings and gains the
  affordances.
- The stepper emits `trip.entry_bring_count_set` with an absolute count, and
  emits **nothing** when the value is unchanged — S6's "a needless write" rule,
  which here moves no visible `DAY N` but still costs an op and a sync.
- `✕` emits `trip.entry_removed` and does not confirm; `REMOVE ON ALPS` confirms.
- The picker marks an already-listed Gear `IN LIST ✓`, excludes retired Gear, and
  adds without navigating away.
- The over-claim band renders from the fold with no interaction at all, and the
  activation sheet renders the same conflicts through `overClaimsIfActive`.
- The Trips list draws `BUILD LIST ›` on a Draft, a true `N GEAR LISTED`, and the
  NEXT line on a Draft card with its two redrawn strings.
- `ui/src/Stepper.test.tsx` — both sizes, the `min` floor, and the 48px target at
  `'dense'`.

### 5.4 The fixture rule

`shared/fixtures/s7-entries.ops.json` and `shared/src/fixtures.s7.test.ts`,
captured **in the same commit as the slice**, per
[§8.7](../architecture-design.md#87-what-every-slice-must-preserve-not-deliver)
and the lesson S6 paid for S4. The three-test shape is `fixtures.s6.test.ts`'s:
the snapshot, the never-mutates assertion, then the probes.

Probes the fixture must carry, several of which no builder can author:

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
in the S2 fixture as an unknown-type probe. S7 must **not** fold
`trip.entry_status_set`, and that test failing would mean the slice reached past
its three op types.

### 5.5 Unchanged

No endpoint, no table, no migration, so **no Tier 2s and no Tier 4 work**, and
the multi-household isolation test is untouched because S7 adds no read or write
path to the server. Tier 5 gains nothing: the golden path completes at S10, and
until S9 a Trip with a list cannot be packed.

---

## 6. Departures from the boards

Five, and each is recorded rather than quietly taken. Three are deferrals of
surfaces whose ops belong to later slices; one is a conflict between a board and
a domain invariant, which the invariant wins; one is a surface the boards never
drew.

### 6.1 A trip-only Entry has no Kind, so `Passports ×3` is not built

The builder draws a `TRIP-ONLY` group containing `Passports · ×3`, and the
footer counts `3 TRIP-ONLY`. A quantity of three on a trip-only Entry has no
expression in the model as it stands: a Bring-count exists only for a **Counted
entry** (invariant 6), Kind is intrinsic to *depot* Gear (domain §6), and a
trip-only Entry references no Gear and so has no Kind at all.

So S7 builds trip-only Entries at one piece each, and `3 TRIP-ONLY` counts three
trip-only Entries. Three passports are three Entries, or one Entry named for the
set.

Taken this way because the alternatives are worse in a way the repo has already
ruled on. Folding a Bring-count onto a Kind-less Entry and drawing a stepper for
it would violate invariant 6 in the UI — the reducer's tolerance
([§1.4](#14-bring-count-is-folded-for-any-entry-and-offered-on-one-kind)) is a
tolerant-reader obligation, never a licence for an authoring screen. And giving
trip-only Entries a Kind of their own is a change to the three Kinds, which the
stories' own open question 3 rules out by name.

If the need is real, the additive home is a quantity on the `trip_only` source
beside `container` — a new op type, decided by the boards, not smuggled in by an
implementer. **This is a question back to the boards, not a settled departure.**

### 6.2 The per-person inclusion circles wait for the op that gives them meaning

The board draws a per-person Entry as 24px circles per Participant, one of them
dashed and dimmed to mean *not included*, annotated `AVATARS HERE = WHO GETS ONE,
NOT STATUS`. The dashed state **is** `trip.piece_removed`, which is S8's op.

At S7 no circle can be dashed, so the row would draw three identical solid
circles that state only what the Trip header's own Participant circles already
state, four lines above. S7 ships `×N` — a real fact, the starting default, and
the number the footer's `18 PER-PERSON` is built from — and S8 adds the circles
with the encoding that makes them worth the space.

This is S5's lesson taken early rather than late: *an encoding inherited as
"meaningless for now" becomes load-bearing the moment a slice gives it meaning.*
The cheapest time to not have shipped a meaningless encoding is before shipping
it.

`P per-person` leaves the keyboard hints for the same reason; S7 draws
`↑↓ ROW · ENTER ADD/REMOVE · T TRIP-ONLY`.

### 6.3 The suggestion band is S14's

`VOSGES 2025 LIST · 24 MATCH THIS DEPOT · ADD ALL / DISMISS` is a template
offer. It reads a past Trip's list and expands into the batch
[sync §4.5](../sync-protocol.md) describes, which is `from_trip_id`'s reader —
folded and unused since S6, and booked to **S14** by both S6 §7 and §8.3. Not
built, and named here so it is not mistaken for an oversight when the builder
ships without it.

### 6.4 The list's groups are Kinds, and the board's `SLEEP` header is not S7's

`docs/design/README.md` §5 says the right pane "groups by kind with mono headers
+ piece counts", and the drawn headers are `SLEEP`, `PER-PERSON`, `TRIP-ONLY` —
three different axes, of which only the last two are Kinds. `SLEEP` reads as a
tag, and grouping a Trip's list by tag is **story 13's engine applied to a list
that is not the Depot**: `sliceDepot` takes `DepotState` and returns
`GearState[]`, and Entries are neither.

Generalising the engine over Entries is real work, is in none of §8.5's rows,
and would arrive with no slice owning it. S7 groups by Kind —
the README's own sentence — with `TRIP-ONLY` as a fourth group keyed on the
source rather than a Kind, since a trip-only Entry has none
([§6.1](#61-a-trip-only-entry-has-no-kind-so-passports-3-is-not-built)).

### 6.5 The builder below Desktop is designed here, not transcribed

[§4.2](#42-the-board-draws-1024-and-s7-owes-the-other-four-modes) and
[§4.3](#43-tripsidadd--the-depot-picker-is-a-screen-not-a-sheet) decide four of
the five layout modes from prose and precedent, because the boards draw the
builder at 1024 and nowhere else. This is the largest undrawn surface any slice
has faced so far, and the decisions — the Split fold, the picker as a route, the
generic empties — are the ones most likely to be overturned by a design round.
Flagged as such rather than presented as settled.

---

## 7. What S7 leaves for later, on purpose

**For S8** (`trip.piece_removed`, `trip.piece_restored`): the `pieces` map
(§1.1); the inclusion circles and their dashed state
([§6.2](#62-the-per-person-inclusion-circles-wait-for-the-op-that-gives-them-meaning));
`P` in the keyboard hints; and the **subtraction** from `Claim.personIds`
([§3.3](#33-per-person-claims-are-participants-until-s8-subtracts)) — a set the
claim selector already computes, so S8 changes one expression rather than adding
a branch.

**For S9**: `status`, `residence` and `stage` on the Entry; `Continue pack-out`
on the active card; the `● 48/61 PIECES` progress bar, whose denominator S7
delivers and whose numerator S9 does; trip whereabouts.

**For S10**: `outcome` and `consumedCount`; the close gate; and
[§3.4](#34-unresolved-has-nothing-to-gate-on-until-s10)'s named insertion point
in `claim.ts`, where the outcome gate goes.

**For S11**: `ReopenConfirm`'s remaining block, `1 ENTRY STILL OPEN — …`.

**For S14**: `trip.deleted`; the suggestion band
([§6.3](#63-the-suggestion-band-is-s14s)); `from_trip_id`'s reader.

**For the boards**: [§6.1](#61-a-trip-only-entry-has-no-kind-so-passports-3-is-not-built)'s
`Passports ×3`, and [§6.5](#65-the-builder-below-desktop-is-designed-here-not-transcribed)'s
four undrawn layout modes.

---

## 8. What this slice deliberately does not build

- **Pieces, packing statuses, journeys, outcomes, notes, tasks, templates, trip
  deletion.** Six later slices, all named above.
- **A `trip.entry_renamed`**, and any other op not in §4.4's three
  ([§1.2](#12-source-is-one-register-and-a-trip-only-entry-cannot-be-renamed)).
- **A restore for `trip.entry_removed`.** The catalogue defines none; adding one
  later is additive ([§1.5](#15-tripentry_removed-is-the-only-resolution-and-it-is-not-a-cascade)).
- **Any server change.** No endpoint, no table, no migration.
- **Any guard that blocks an over-claim**, on any Device, at any moment. Warns
  and allows, everywhere.
- **The slicing engine over a Trip's list**
  ([§6.4](#64-the-lists-groups-are-kinds-and-the-boards-sleep-header-is-not-s7s)).
- **Weight totals** — `EST 48.2 KG`, story 16, `LATER`, with the MVP variant
  drawn beside it on the board.
- **Renaming `DepotState`.** Its deferral expired when S5 landed, and it is now
  a self-contained job for whichever slice wants it. S7 does not want it: this
  slice already reaches `TripState`, `slice.ts` and three screens, and the rename
  reaches every screen in three workspaces.

---

## 9. Doc amendments

| Doc | Change |
| --- | --- |
| [`sync-protocol.md`](../sync-protocol.md) §4.4 | A note that `trip.entry_bring_count_set`'s "Counted entries only" is an **authoring** rule and the reader folds it regardless ([§1.4](#14-bring-count-is-folded-for-any-entry-and-offered-on-one-kind)), the `TagString` split restated for a second op; a note that `source` is one register and that a trip-only Entry therefore has no rename ([§1.2](#12-source-is-one-register-and-a-trip-only-entry-cannot-be-renamed)); the payload key `gear_id` against a `gearId` register, the third instance of §4.4's own naming split |
| [`architecture-design.md`](../architecture-design.md) | §12.13, consequences of S7; §8.3's S7 entry marked landed; §8.5's table row for Trip membership marked delivered |
| [`frontend-design.md`](../frontend-design.md) | §5's primitive list: `Stepper` built, with its two sizes ([§4.5](#45-the-bring-count-stepper-becomes-uistepper)); §3.1 gains the builder's Split-and-up two-pane rule ([§4.2](#42-the-board-draws-1024-and-s7-owes-the-other-four-modes)) |
| [`design/README.md`](../design/README.md) | Per the §3b/§3c precedent, each departure appends to the section for the screen it changes: **§5** takes [§4.2](#42-the-board-draws-1024-and-s7-owes-the-other-four-modes)/[§4.3](#43-tripsidadd--the-depot-picker-is-a-screen-not-a-sheet)'s layout ladder, [§6.1](#61-a-trip-only-entry-has-no-kind-so-passports-3-is-not-built)'s trip-only quantity question, [§6.2](#62-the-per-person-inclusion-circles-wait-for-the-op-that-gives-them-meaning)'s circles, [§6.3](#63-the-suggestion-band-is-s14s)'s band and [§6.4](#64-the-lists-groups-are-kinds-and-the-boards-sleep-header-is-not-s7s)'s grouping; **§5a** takes [§4.6](#46-the-over-claim-is-a-property-of-the-fold-so-the-surface-is-persistent)'s persistent band and the `REMOVE ON ALPS` confirm |
| [`testing.md`](../testing.md) | The backward-compatibility group's fixture list gains `s7-entries` |
| `CLAUDE.md` | Status: S7 landed, and the things worth knowing before touching Entries, claims or the builder |
