# S9a — Packing and the Journey

The implementation design for the first half of
[architecture §8.3](../architecture-design.md#83-the-slices)'s **S9**: five op
types, the two tracks becoming five registers, the Trip's own containment tree,
and **F4** — the screen `User Flows` calls *the app lives here*. It delivers
stories **9** and **10** whole, and advances **32** not at all (the phase
machine is S6's and the close gate is S10's).

This is a **feature spec**: retired once the slice has shipped. It settles what
the durable docs left to the implementer. It does **not** revisit anything above
it — the op envelope, the HLC, per-field LWW, the op catalogue and the evolution
rules are settled in [`sync-protocol.md`](../sync-protocol.md), and every
ambiguity here is resolved by reading that document, not this one.

**S9 is two slices, and this is the first.** §8.3 draws one; the design round
cut it on §8.3's own S2a/S2b seam — write side, then read side — and tagged
every ruling accordingly. **S9b** adds no op types and no endpoints:
`whereabouts()` gains its trip slice and the quantity split, and Find, gear
detail, the Depot's `WHEREABOUTS` column and story 13's `CONTAINER` dimension
follow. Nothing in S9b is in scope here, and [§8](#8-what-s9a-deliberately-does-not-build)
lists what that costs meanwhile.

**This spec was written after the design round, not before it.** S7 wrote its
spec first and had fifteen code-decided items ruled afterwards; S8 wrote a draft
and had nine ruled before any code. S9 went further: **twenty questions went to
the boards before a line of this document existed**, and came back as
`docs/design/README.md` **§5e** and `S9 Round - Packing and the Journey.dc.html`.
**The boards are the authority**; where this document and §5e disagree, §5e wins
and this document is wrong. [§6](#6-what-the-design-round-ruled) records what the
round moved, so the reasoning is not lost.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types | **5** — `trip.entry_status_set`, `trip.piece_status_set`, `trip.entry_moved`, `trip.piece_moved`, `trip.container_stage_set` |
| Endpoints · migration | **None.** A domain slice adds neither |
| Registers added | `EntryState`: `status`, `residence`, `stage`. `PieceState`: `status`, `residence`. §3.7's map is then complete but for S10's `outcome` / `consumedCount` ([§2](#2-state-shape)) |
| `status` vs `stage` | **Never both on one Entry — an authoring rule, not a reader gate.** The trait lives on another aggregate, so the reducer folds both unconditionally and the selectors decide ([§1.3](#13-stage-xor-status-is-an-authoring-rule)) |
| An absent `status` | Reads `not_packed`; an absent `stage` reads `home`. Stated once each, in `selectors/packing.ts` ([§1.4](#14-two-more-absent-reads-and-where-they-are-stated)) |
| Both enums | **Open** past their known members, exactly as `KindValue` and `PhaseValue` are — which is what makes story 20's widening need no rank function and no migration ([sync §3.3](../sync-protocol.md)) |
| Moving a container | **One op, not N.** Containment is a pointer held by the contained thing; contents' statuses are deliberately untouched (invariant 12) |
| The trip's tree | A second containment view over `TripResidence`, with §3.6's cycle break restated for the trip world ([§3.2](#32-the-trips-own-containment-view)) |
| A container is not a piece | No status pill anywhere; **excluded from `PIECES` and from `N LEFT`**. Narrows ruling L rather than breaking it — `pieceCountOf` returns `0` for a container Entry ([§3.3](#33-a-container-is-not-a-piece)) — ruling **A5** |
| The row's two targets | Right edge = *how far along* (the pill, or the cluster as one control); row body = *where* (the Pack picker). The domain's two tracks — ruling **A2** |
| Per-person status | The cluster + its count is **one control** opening the Piece status sheet; ruling B holds at 34px. **`LONG-PRESS` retires** — ruling **A1** ([§4.4](#44-the-piece-status-sheet)) |
| Which move confirms | **The confirm is owed where the act cannot be seen on the screen that made it.** Plain move no; container move yes; rail tap never — ruling **A2b** |
| The rail | A **direct set**, not an advance — `SET PHASE`'s answer verbatim, current chip writes nothing — ruling **A15** |
| `Loose` group | Last, not first: a picker lists destinations, this lists work — ruling **A3** |
| Nesting | Indented groups, the Home picker's cap and ancestry rule, each keeping its own rail — ruling **A4** |
| The ▲ threshold | `car` and `packed` only, counting `not packed` only, at any depth — ruling **A6** |
| PERSON mode | Means **whose it is**, not whose body it goes with (story 23, Later). Ownership partitions; `Shared` is the fourth group — ruling **A7**. The `PARTICIPANT` tag is **dropped** — ruling **A7b** |
| ALL mode | Flat, name A→Z, trip residence as the meta line's last segment, no container rows — ruling **A8** |
| `UNDO` and the footer | Drawn but not built; the pinned bar retires with it, the hint moves under the controls — ruling **A9** |
| Widths | One capped **560px** column from Roomy up, **no pane**; the back link survives Desktop through `useScreenHeader`'s *existing* S7 flag — ruling **A10** |
| The way in | `Continue pack-out` at Pack-out **only**, `PACKING ›` in the `GEAR LIST` band at every phase, progress line on Active cards only — ruling **A11** |
| The pack-out banner | **Deferred**, blocker named: a banner must name one trip and §5 refuses to rank them — ruling **A12** |
| Route | `/trips/:id/packing`, its own route at every width, **reachable at every phase** — a phase locks nothing, and hiding a route is a soft lock |
| Fixture | `shared/fixtures/s9a-packing.ops.json` + `shared/src/fixtures.s9a.test.ts`, same commit ([§5.4](#54-the-fixture-rule)) |

---

## 1. Five ops, and what they close

| Type | Payload | Effect on folded state |
| --- | --- | --- |
| `trip.entry_status_set` | `{entry_id, status}` | Sets the Entry's `status`. Plain LWW ([§3.3](../sync-protocol.md)) |
| `trip.piece_status_set` | `{entry_id, person_id, status}` | The same, for one Piece |
| `trip.entry_moved` | `{entry_id, residence: TripResidence}` | Sets the Entry's **trip** residence. Never its home (invariant 13), never its status (invariant 12) |
| `trip.piece_moved` | `{entry_id, person_id, residence: TripResidence}` | The same, for one Piece |
| `trip.container_stage_set` | `{entry_id, stage}` | Sets the container's journey stage. **One op moves everything inside it** |

```
TripResidence = {"in": "container", "entry_id": <uuid>}
              | {"in": "loose"}
```

Five ops close story 9 (a status per Entry and per Piece), story 10 (the
journey, and a container carrying its contents), and story 3's *trip residence*
— which S9b reads and this slice writes.

### 1.1 The register map is the contract

[Sync §3.7](../sync-protocol.md) has said since before S7 what an Entry and a
Piece hold:

```
entries.<entry_id>          source, bring_count, status, residence, stage, outcome, consumed_count, removed
entries.<entry_id>.pieces.<person_id>   status, residence, outcome, removed
```

S7 declared three of the Entry's eight and S8 declared one of the Piece's four,
each saying in a docstring which slice owed the rest. **This slice makes those
sentences false and is obliged to delete them**, exactly as S8 was obliged to
delete S7's *"Pieces are exactly Participants until S8"*. What remains after
S9a is `outcome` and `consumedCount` on both paths — S10's, and nobody else's.

### 1.2 Two tracks, two registers, one row

[Domain §7](../domain-model.md) says a Trip's state moves along two independent
tracks: **residence** answers *where*, **status**/**stage** answers *how far
along*. Sync §3.7 makes that structural — they are separate registers, so
**no merge can make them agree**, which is invariant 12 honoured for free rather
than enforced.

The design round made the same split the row's interaction model (ruling A2):
the pill at the right edge writes *how far along*, the row body writes *where*.
Two targets, two registers, and the reason the row body was free is that the
pill already owns the thumb side.

### 1.3 `stage` xor `status` is an authoring rule

Sync §3.7 says `stage` exists only on Entries whose gear carries the containment
trait, `status` on everything else, and never both on one Entry. **The reducer
does not enforce that, and must not** — this is the `TagString` split and
invariant 6's split, restated for a third pair of ops.

The trait lives on the **Gear** aggregate for a depot Entry, and a reducer that
resolved it before writing would make the fold order-dependent on whether
`gear.recorded` had arrived. So both registers fold unconditionally for any
Entry, and the gate lives on the way out, in `selectors/packing.ts`:

- `statusOf(entry, state)` returns `null` for a container Entry, whatever the
  register holds.
- `stageOf(entry, state)` returns `null` for a non-container Entry, likewise.

**A depot Entry whose Gear has not reached this replica is not a container.**
`entryKind` already reads `undefined` for that case and calls it the ordinary
cross-aggregate race rather than an error; the conservative direction here is
the same one `pieceCountOf` takes — the Entry carries a status, counts as a
piece, and starts carrying a journey the moment the Gear arrives. Asserting a
journey for gear nobody has described would draw a rail with no container under
it.

### 1.4 Two more absent reads, and where they are stated

**An absent `status` reads `not_packed`; an absent `stage` reads `home`.** This
is `ownerOf`'s rule and `phaseOf`'s rule for a fourth and fifth time, and it
earns the same defence: the fold conflates nothing — absent and an explicit
`"not_packed"` stay different facts about the log — but every reader treats them
alike, and saying so exactly once is what stops the row, the group count, the
progress line and the ▲ line drifting apart. The symptom of a call site
re-deriving it is a row drawn `NOT PACKED` while the group header counts it
packed.

Both are reachable in ordinary use rather than only in a fixture: no op writes
either register at `trip.entry_added`, so **every Entry begins with neither**,
and a Trip mid-pack-out has both kinds on screen at once.

**Both enums stay open** past their known members — `StatusValue` and
`StageValue` are `… | (string & {})`, exactly as `KindValue` and `PhaseValue`
are. Sync §3.3 spells out the payoff: because there is no rank function in the
merge, story 20's per-trip editable statuses widen the set with no migration and
no lattice, and an unrecognised value is simply a value. `packing.ts` answers for
one the way `trip.ts` answers for an unrecognised phase: drawn verbatim, not
packed, not counted toward the numerator, and never coerced.

### 1.5 Moving a container is one op, not N

Story 10 asks that moving a container move everything inside it, nested
containers included, in one action. It costs nothing, because containment is a
**pointer held by the contained thing**
([domain §3](../domain-model.md#3-containment-one-relationship-held-as-a-pointer)):
the contents already point at the container, so their whereabouts follows when
the container's own residence or stage changes. Nothing to fan out, and no
cross-entity write that could partially merge.

Their **statuses are deliberately untouched** — the duffel may be in the car
while the stove inside it is still `not_packed`, and that disagreement is
surfaced, not forbidden (invariant 12). Ruling A6 is the rule for *when* it is
surfaced; §3.5 is where it is computed.

---

## 2. State shape

```ts
export type StatusValue = 'not_packed' | 'staged' | 'packed' | (string & {})
export type StageValue = 'home' | 'staging' | 'car' | 'packed' | (string & {})

export type TripResidence =
  | { in: 'container'; entryId: string }
  | { in: 'loose' }

export interface PieceState {
  readonly id: string
  readonly removed?: Register<boolean>
  readonly status?: Register<StatusValue>       // S9a
  readonly residence?: Register<TripResidence>  // S9a
}

export interface EntryState {
  readonly id: string
  readonly source?: Register<EntrySource>
  readonly bringCount?: Register<number>
  readonly removed?: Register<boolean>
  readonly pieces?: Readonly<Record<string, PieceState>>
  readonly status?: Register<StatusValue>       // S9a
  readonly residence?: Register<TripResidence>  // S9a
  readonly stage?: Register<StageValue>         // S9a
}
```

Three things about the types:

- **`TripResidence` is a closed union**, unlike `StatusValue` and `StageValue`
  and exactly as `EntrySource` is: `readTripResidence` reads an unrecognised
  `in` as `absent`, so it never reaches state. The tolerance lives at the
  boundary; the type stays exhaustive. It is **not** the `Residence` the Depot
  uses — different members, and the container is keyed `entry_id`, not `id` —
  so it takes its own reader rather than widening that one. Two types the
  compiler keeps apart is the point: a trip residence assigned to `gear.residence`
  would be the bug invariant 13 exists to forbid.
- **The payload key is `entry_id`; the field is `entryId`** — the split
  `gear.owned_count_set{count}` → `owned_count` already has, and which
  `trip.entry_added{gear_id}` → `gearId` already restated for a nested field.
- **`status` and `residence` are declared on both paths, with identical
  types.** A Piece is a thing that travels, exactly as an Entry is; nothing
  about the two registers differs but the entity path they hang on.

---

## 3. Selectors

New file `shared/src/selectors/packing.ts` and new file
`shared/src/selectors/tripContainment.ts`. One existing function narrows.

### 3.1 Two tables, and every question with a function beside it

`packing.ts` follows `trip.ts`'s `PHASES` pattern exactly, because it is the
same shape of problem — **a fixed set that story 20 will make editable**, so it
must already be *seed values of a mechanism* rather than hard-coded branches
([domain §7](../domain-model.md), open question 1).

```ts
export const STATUSES: readonly PackingStatus[]   // not_packed · staged · packed
export const STAGES: readonly JourneyStage[]      // home · staging · car · packed
```

Each row carries its `id`, its `label` (`NOT PACKED` · `STAGED` · `PACKED`;
`⌂ HOME` · `STAGING` · `CAR` · `PACKED`) and its own flags. The row lookup is
**private**, for the reason S6 gives and three reviews caught: no call site
decides for itself what a missing row means.

The exported questions, one function each:

| Function | Answers |
| --- | --- |
| `statusOf(entry, state)` | The Entry's status; `null` for a container; absent reads `not_packed` |
| `pieceStatusOf(piece, entry, state)` | The same for one Piece |
| `stageOf(entry, state)` | The journey stage; `null` for a non-container; absent reads `home` |
| `statusLabel(status)` · `stageLabel(stage)` | How one is drawn; an unrecognised value verbatim |
| `nextStatus(status)` | The pill's cycle, `not_packed → staged → packed → not_packed`; an unrecognised value cycles to `not_packed`, the only answer that is not an invention |
| `isPacked(status)` | The **only** definition of packed-ness in the codebase — the numerator, `N LEFT`, and every group count read it |
| `isKnownStatus` · `isKnownStage` | Whether this build has a row at all |

`isPacked` is `isActive`'s sibling and exists for its reason: S10's close gate,
S9b's whereabouts and F4's four count lines must never disagree about what
counts. `staged` is **not** packed — the board's `48/61` with `13 LEFT` and the
`○ LEFT` pill all read the same predicate.

**There is no `nextStage`.** Ruling A15 makes the rail a direct set, so a
"next" would be a function with no caller and an idiom the round retired.

### 3.2 The Trip's own containment view

`tripContainment.ts` is `containment.ts`'s twin over `TripResidence`. It is a
second file rather than a parameter on the first, because the two worlds resolve
against different things — one against Places and Gear, the other against
Entries — and a shared implementation would take a strategy object for every
line of it.

`tripContainmentView(trip, state)` returns `holderOf`, `childrenOf` and
`brokenEdges`, and resolves a pointer through four reasons, the first three
reading **loose**:

1. it names an Entry this replica has not folded;
2. it names a **removed** Entry (`trip.entry_removed`) or a sourceless one — both
   already excluded from `entriesOf`, and a pointer into something the reader
   cannot see is a pointer nobody can settle;
3. it names an Entry that is **not a container**;
4. it is part of a **cycle** — two Devices putting crate X into Y and Y into X on
   one Trip, which per-field LWW cannot prevent because the two ops write two
   different registers.

**The cycle break is [sync §3.6](../sync-protocol.md)'s, verbatim**: within a
cycle, the edge whose `residence` register carries the lowest `(hlc, device_id)`
is reported loose, with the entry id as a canonical final tiebreak. Every replica
holds identical registers, so every replica breaks the same edge; the fold stays
untouched and every device draws the same tree. The traversal iterates **sorted
entry ids**, for `containment.ts`'s own stated reason — `Object.keys` is
insertion order, which two replicas that received the same ops in a different
order do not share, and a traversal driven by it is replica-dependent in a way
the convergence tier cannot see because it runs downstream of the fold.

One difference from the home tree worth stating: **`trip.entry_removed` has no
restore**, so a pointer into a removed container is permanent rather than
recoverable. It still reads loose rather than vanishing — nothing is deleted, and
the Entry re-added under a new id is a different Entry.

### 3.3 A container is not a piece

Ruling A5, and the one change this slice makes to shipped behaviour.

Sync §3.7's *never both on one entry* means a container Entry carries a journey
**instead of** a status, so it can never be marked packed. A denominator holding
things that can never be counted makes `61` unreachable — which is invariant 18's
own shape, one slice early: trip-only Entries are excluded from the open count
because they take no outcome.

So **`pieceCountOf` returns `0` for a container Entry**, and `listTotals`
follows. This **narrows ruling L rather than breaking it**: *PIECES is the trip
arithmetic only* stands, and A5 states what that arithmetic counts — things that
carry a status. No number on any existing board changes, because no drawn gear
list holds a container Entry; the numbers that move are on a real household's
Trip, and they move to the truth.

`entriesOf` is untouched: a container is still a line on the gear list, still
counted by `N ENTRIES`, still removable with its `✕`. **ENTRIES counts the list,
PIECES counts what travels** (ruling D) — and A5 is that sentence read
carefully.

**Claims are untouched.** `claim.ts` reads `pieceCountOf`'s *rule* rather than
the function, and its own `claimFor` gives a Single container Entry a count of
`1` — correctly: two active Trips cannot both take the one duffel, and a supply
rule is not a packing arithmetic.

### 3.4 The counts, and the person partition

Four count lines, one predicate (`isPacked`), and every one of them excludes
containers:

- **The trip total** — `packingTotals(trip, state)` → `{packed, total, left}`,
  drawing `● 48/61 PIECES` and `13 LEFT`. A Counted Entry contributes its whole
  Bring-count; a per-person Entry contributes one per **included** Piece
  (`piecesOf`, S8's derivation), each counted by its own status.
- **A container group's count** — `9/12`, its contents **at any depth**: the
  duffel's twelve include the stuff sack's four. It is a subtree sum over
  `tripContainmentView`, so a nested group's own rows are counted twice on
  screen — once in its header and once in its ancestor's — which is what
  "everything in the duffel" means to a household carrying it.
- **A person group's count** — `9/13 · 4 LEFT` (§3.4's partition below).
- **The `○ LEFT` filter**, which is `!isPacked` and nothing else.

**The person partition (ruling A7).** PERSON mode means *whose it is*, which
ownership answers; *whose body it goes with* is story 23 and the app holds no
such fact. Every non-container Entry falls in exactly one bucket, tested in this
order:

1. a **per-person** Entry contributes not itself but its included **Pieces**,
   each to its own Participant's bucket;
2. otherwise the Entry's `ownerOf` — a Person's bucket, **including a Person who
   is not a Participant**, because the header answers whose it is and Els's
   jacket carried by Mark is honest;
3. otherwise `Shared`.

The partition is total, so the arithmetic closes on facts the MVP holds:
`9/13 + 12/12 + 6/9 + 21/27 = 48/61`, left `4 + 0 + 3 + 6 = 13`. This is the
whole of what made the drawn frame unbuildable and now is not.

**Group order: People in `sortedPeople` order, then `Shared` last.** That is a
deliberate divergence from the Depot's `GROUP BY OWNER`, whose grouping table
pins `shared` **first**. The reason is A3's: `Shared` is the "everything else"
bucket and on a real Trip the biggest one, so first position pushes every person
header off-screen. Recorded here rather than reconciled, because the two
surfaces answer differently on purpose — the Depot files gear, F4 lists work.

### 3.5 The disagreement threshold

Ruling A6, which is the rule the two drawn frames encode and neither states:

```
disagreeing(entry) = stageOf(entry) ∈ {car, packed}
                     ∧ count of not-packed contents, at any depth, > 0
```

`car` and `packed` only — **staging *is* the act of packing**, so unpacked
contents on the staging floor are the work, not a contradiction. `not packed`
only — counting `staged` would fire on nearly every container in the car and the
▲ would stop meaning anything. The line takes the stage's own word:
`▲ IN CAR · 3 INSIDE NOT PACKED`, `▲ PACKED · 3 INSIDE NOT PACKED`, pinned at
`N=1` per ruling M.

It is a **pure function of the fold**, like `overClaims` and unlike anything with
an op: every replica computes the identical set, and it goes away when a
Quartermaster packs the contents or moves the container back — both ordinary
ops, nothing discarded.

### 3.6 What S9a does not touch

- **`whereabouts()`** keeps returning its single `'home'` slice. Its own
  docstring says the trip clause "arrives with stories 9/10"; S9a writes the
  fact and **S9b reads it**, and the docstring is amended to say so rather than
  left to read as a lie.
- **`slice.ts`** gains no dimension. `CONTAINER` is S9b's (ruling B4b) and
  `STATUS` is nobody's — ruling B4 retired it outright.
- **`claim.ts`** is untouched (§3.3).
- **`entriesOf`, `entryKind`, `bringCountOf`, `piecesOf`** are untouched.

---

## 4. Screens

### 4.1 One route, reachable at every phase

`/trips/:id/packing`, its own route at every width — not a pane, so nothing
about it is width-gated and `App.tsx` needs no `isSplit` redirect of the kind
`/trips/:id/add` and `/trips/:id/list` carry.

**It renders at every phase, Draft included.** A phase locks nothing
(invariant 16, story 32), and hiding a route is a soft lock the phase model
forbids — the same reasoning that keeps every editing capability available in
every phase. The title is the board's `Pack-out` at every phase: it names the
activity, and the phase itself is already stated on the card and the trip screen
by a chip that is the control for changing it.

### 4.2 The screen, top to bottom

Header band, then title, then `● 48/61 PIECES` / `13 LEFT` and the 6px bar, then
the segmented `CONTAINER · PERSON · ALL` and the `○ LEFT` pill, then the screen's
one hint — `TAP PILL = NEXT STATE · TAP CIRCLES = PER PERSON · TAP ROW = WHERE IT
GOES` — then the groups.

**CONTAINER** — one group per trip container, each header carrying its name, its
`9/12`, its journey rail and (conditionally) its ▲ line; nested containers as
**indented groups** rendered immediately after their parent's own rows, indent
16px per level **capped at two levels** below the top container, deeper headers
carrying their skipped ancestry as a meta line — the Home picker's rule verbatim
(ruling A4). A rail inside a rail is correct: the rail is that container's own
journey, and story 10's disagreement case is exactly the nested one. A trip-only
container is an ordinary group plus the amber `TRIP-ONLY` tag on its header
(ruling A14). The list **ends with `Loose`** — the container header's anatomy
minus the rail, since nothing loose has a journey: name `Loose` in ink/muted,
meta `NOT IN A CONTAINER`, right count (ruling A3). An empty `Loose` group draws
nothing; a Trip with no containers at all draws that one group holding
everything, and below the last row the permanent fact `A CONTAINER ON THE GEAR
LIST BECOMES A GROUP HERE.`

**PERSON** — §3.4's partition, headers at 28px circle + name + `9/13 · 4 LEFT`.
An all-done person reads `● 12/12` with its rows collapsed and the header
tappable to expand; the word `COLLAPSED` is dropped, being about the widget
rather than the ledger. A Piece's row names its owner inline —
`Headlamp — ELS'S PIECE`.

**ALL** — every Entry and Piece, flat, no headers, **name A→Z** (ruling A8). The
grouped modes answer *where is it going* and *whose is it*; ALL exists for *is
this one thing packed*, which is a lookup, and sorting by status would move rows
under the thumb as they are tapped. Each meta line ends in its trip residence,
amber — `▸ DUFFEL 90 L`, `▸ LOOSE`, and `▸ MIXED` where a per-person row's
Pieces sit in different containers. **No container rows**: ALL lists what carries
a status, and a container's name still appears as its contents' residence
segment, so nothing is hidden.

**Empty list** — `0 ENTRIES.` and `The gear list is built from the depot.`, the
trip screen's permanent fact word for word. The count line and the bar are
**absent, not zeroed**: `● 0/0 PIECES` states an arithmetic nobody asked for.

### 4.3 The row's two targets

Right edge, ≥44px: the status pill, tapping through `○ → ◐ → ● → ○`, or — on a
per-person row — the 34px circle cluster and its `1/3` as **one control**. Row
body: the Pack picker.

Both targets grow the standing clamped `::after` (ruling O) and the clamp is
what keeps them from overlapping each other on a ≥64px row.

### 4.4 The Piece status sheet

Ruling A1. **Ruling B holds unchanged at 34px** — circles on a 39px pitch put a
44px target over a neighbour, B's own arithmetic one size up, on the screen used
with cold hands — so the cluster and its count open a sheet rather than each
circle being a target.

Title = the gear name; mono fact `PACKING STATUS · 1 OF 3 PACKED` — the ledger
states, it does not ask. Rows 48px with **30px circles** (ruling K: the row's
height sets the circle), each row `● Mark · ▸ DUFFEL 90 L` with a trailing accent
`MOVE`. **Tap a row = next state for that Person, one op per tap** — the
tag-chip rule, and the same commit model the S8 Piece picker already uses. The
trailing `MOVE` is where a **single Piece's** residence is set (`trip.piece_moved`),
which is why a per-person row's body opens this sheet rather than the Pack
picker: one Piece may ride in the duffel while another is loose.

At the foot, **`SET EVERYONE`** over three 44px chips in the status pill's own
grammar — `○ NOT PACKED` `◐ STAGED` `● PACKED`. It is three chips and not one
control because **one control cannot name a next state when the people
disagree**, and it writes N ops in one batch, backwards included. **No confirm**:
nothing is destroyed and a second tap on another chip reverses the whole set.

**`LONG-PRESS` retires** — no keyboard equivalent, no second instance anywhere in
the app, no discoverable affordance. `P` opens the sheet at the keyboard, as it
opens the Piece picker in the builder. Accessible name
`Packing status — Headlamp, 1 of 3 packed`.

Sheet below Split, **popover from Split up** — and `ui/Popover` is still not
built, so this lands with the primitive as its third waiting caller. Until then
`Sheet`'s `desktopCard` stands in, S8's own precedent.

### 4.5 The Pack picker

Ruling A2. **The Home picker's twin, and not the Home picker.** What it borrows,
verbatim: `Loose` first with meta `NOT IN A CONTAINER`, nesting indented 16px per
level capped at two, `● NOW` on the current residence, the moved gear and its
whole subtree **absent at any depth** with the footer `CRATE B AND EVERYTHING
INSIDE IT ARE NOT OFFERED.`, the context line `MOVING CRATE B · 5 INSIDE RIDE
ALONG`, selection moves and closes.

What it does not borrow: **Places** — the trip world has none, and offering one
would break the two-worlds rule — and **creation**, because a trip container is
an Entry on the gear list, which the fact line says: `A TRIP CONTAINER IS AN
ENTRY ON THE GEAR LIST.` Title = the gear name, fact `WHERE IT GOES ON THIS
TRIP`.

Each row's right-hand mono is **that container's stage**, taking the slot the
Home picker gives `● NOW`, since one row cannot carry two right-hand reads and
where the gear stands outranks how far its holder has travelled.

Empty: `Loose` alone at `● NOW` above `No containers on this trip yet.` /
`Add a container to the gear list to pack into it.` — a quiet line and no button,
since the fix is one back-tap and a CTA here would name the gear list from inside
a picker.

**The subtree exclusion is invariant 3 for the trip world**, and it is what stops
a cycle being authored on one Device at all; `tripContainmentView`'s break
(§3.2) is for the cycles two Devices author while apart, which no picker can
prevent.

### 4.6 Which move confirms

Ruling A2b, one rule for three acts: **the confirm is owed where the act cannot
be seen on the screen that made it.**

- A plain **Entry or Piece move** does not confirm — one op, and the row visibly
  jumps to its new group.
- A **container move** confirms: `Move Crate B into Duffel 90 L?` ·
  `Crate B and everything inside it move on the trip. Nothing at home moves.` ·
  mono `5 INSIDE RIDE ALONG · STATUS UNCHANGED` · accent `Move` + ghost `Cancel`,
  in `ui/Confirm`. The ride-along is elsewhere on the screen and may be filtered
  out by `○ LEFT` — §3c's own argument, and story 36 is Later.
- A **rail tap never confirms**: it writes one register and rewrites nobody
  else's, the contents' whereabouts following a pointer.

The confirm's second sentence is load-bearing and not reassurance: `Nothing at
home moves` is invariant 13, and it is the one thing a Quartermaster who has used
the Home picker's identically-shaped sheet might reasonably fear.

### 4.7 The rail

Ruling A15: **a chip sets that stage** — backwards included, so tapping `⌂ HOME`
on a container in the car sends it home, which plain LWW makes correct and sync
§3.3 makes deliberate. **Tapping the current stage writes nothing**, `SET PHASE`'s
own rule and for a reason that survives translation: a redundant write moves the
stamp LWW compares. The current chip stays undimmed; dim means future.

Painted at its drawn size, hit 48 through the clamped `::after` clamped at the
header row — the phase chip's answer (§5c O).

### 4.8 Widths, and the back link at Desktop

Ruling A10: **one capped 560px column, centred, from Roomy up, and no pane.**
560 is the 393 row's content plus the room ALL mode's residence segment needs;
past it the pill drifts an arm's length from the name it belongs to. Gutters 20
at Roomy, 24 from Split. There is no detail for a packing row — its two acts are
a pill and a sheet — and the app's one unbuilt two-pane frame (Trips at Split) is
debt already logged.

Nothing else changes with width: segmented control 40px, filter pill 40px, rows
≥64, pill ≥44, circles 34 and 28, and **the rail keeps its own line at every
width**. Title takes the DISPLAY scale's 34 at Desktop. Group cards gain the 12px
radius border from Roomy up, where the list stops being edge-to-edge.

**The back link survives Desktop, and that needs no new rule.**
`useScreenHeader` has carried `atDesktopSidebarCarriesDestination` since S7,
added for the builder's "trip" door; F4 passes `false` and gets `‹ ALPS 2026` at
every width, because the 216px sidebar carries `TRIPS`, not `Alps 2026`. It is
the eleventh caller, `splitPane: false`, sync line at Split alone. This is the
first screen where the flag's *reason* is the only reason — worth stating,
because a reader meeting F4 first will otherwise read it as an exception.

### 4.9 The way in

Ruling A11. **S9a draws exactly one CTA**: `Continue pack-out` on the active
card at Pack-out. At On trip the slot stays **empty** — the CTA names the current
phase verb, whose control is the phase chip the card already carries, and
`Continue unpack` would name F5, a screen that does not exist. Unpack's CTA is
S10's to draw. Draft keeps `BUILD LIST ›`; Closed keeps its row.

**The progress line returns below the NEXT line** (§5's order: the permanent
obligation above the arithmetic, the arithmetic above the action) and **on Active
cards only**. A Draft's `● 0/59 PIECES` would state progress against an
arrangement invariant 17 makes inert, and the dashed card's own
`DRAFT · 14 ENTRIES` is the count that matters there. The five-element card is
now full, and this slice is what fills it.

**The second door is `PACKING ›`**, in the `GEAR LIST` band's trailing slot
beside `EDIT LIST ›`, gap 14, at every width and **at every phase**. Accessible
name `Open packing for Alps 2026` — the `Build list for …` pattern, with the `›`
kept out of it (ruling D).

**One consequence the round did not name, recorded rather than papered over:**
the band renders only when the Trip has Entries — `Trip.tsx` draws the
`0 ENTRIES.` region instead — so **a Trip with an empty gear list has no drawn
door to F4**. That is the right answer rather than a gap: a route to a screen
that can only say `0 ENTRIES.` is a door to an empty room, which is exactly what
the empty region's own rule forbids (*never a dead affordance*). F4's empty state
still has to exist, for the reader already standing there when another Device
removes the last Entry, and for a direct link. Flagged for the next round in case
the boards want a door there anyway.

### 4.10 Drawn and not built

**`UNDO` and the footer bar** (ruling A9). `UNDO` is drawn but not built — the
**third** instance of the §3b/§3c precedent, and the reason is strongest here:
this screen holds the app's most tapped writes, so a reversal that quietly
weakens with time is worst on it, and story 36 forbids exactly that. With no
action left, the pinned bar retires — a read does not spend the thumb zone — and
the hint moves under the controls row, read once at the start rather than at the
foot of sixty-one rows.

**The pack-out banner** (ruling A12) is deferred with its blocker named rather
than its slice guessed: a banner must name **one** trip, and §5's standing
decision refuses to rank them — *N Active trips render as N identical cards, no
primary-trip treatment*. Two banners stack over the phone header; one invents the
primary trip the Trips list deliberately does not have. §4.9's two routes reach
F4 in two taps from any tab, so the cost is one tap and not a lost capability.

---

## 5. Tests

### 5.1 Tier 1 — unit

- **The five registers fold**, each on its own entity path, and a losing write
  returns the identical object (the `WeakMap` memo's requirement).
- **Absent reads**: `statusOf` on an Entry with no register reads `not_packed`;
  `stageOf` reads `home`; both stated once and asserted against the selector, not
  against a screen.
- **`stage` xor `status` is a reader gate**: an Entry whose Gear is a container
  answers `null` from `statusOf` **even when a `status` register was folded** —
  the tolerant reader's own case, since a peer on another build may write one.
- **A depot Entry whose Gear has not synced is not a container**: carries a
  status, counts as a piece, and gains a rail when the Gear arrives.
- **An unrecognised status** is drawn verbatim, is not `isPacked`, and cycles to
  `not_packed`.
- **The trip containment view**: all four loose-reasons; a container move moving
  its contents' whereabouts **through the pointer**, nested included, with every
  status untouched; the cycle break choosing the lowest `(hlc, device_id)` edge;
  the traversal's sorted-id determinism.
- **`pieceCountOf` returns `0` for a container Entry** — depot and trip-only
  both — and `listTotals` follows; `entriesOf` still lists it and `N ENTRIES`
  still counts it.
- **The counts**: a container group's count sums its subtree at any depth; a
  Counted Entry contributes its Bring-count; a per-person Entry contributes one
  per **included** Piece.
- **The person partition is total** — every non-container Entry lands in exactly
  one bucket, per-person Pieces to their Participant, Personal gear to its owner
  including a **non-Participant** owner, everything else to `Shared` — and the
  bucket sums equal `packingTotals`. This is the assertion that would have caught
  the drawn frame's story-23 arithmetic.
- **The disagreement threshold**: fires at `car` and `packed`, not at `home` or
  `staging`; counts `not packed` only; counts at any depth; `N=1` pinned.

### 5.2 Tier 2 — convergence

- **`residence` and `status` are separate registers, so no merge can make them
  agree** (invariant 12) — the slice's headline convergence property. Device A
  moves the stove into the duffel; Device B marks it `not_packed`; both apply,
  and the disagreement survives the exchange in either order.
- **A backwards status move wins on its clock.** Device A sets `packed` at HLC
  100, Device B sets `staged` at HLC 200: the result is `staged` on both
  replicas. This is sync §3.3's dropped furthest-stage rule, asserted rather than
  assumed — and the test exists because the rule is the tempting one to
  reintroduce.
- **A trip-side containment cycle breaks identically on both replicas.** Device A
  moves crate X into Y, Device B moves Y into X; the logs are exchanged in both
  orders and both replicas report the same broken edge.
- **A `trip.container_stage_set` concurrent with a `trip.entry_moved` of one of
  its contents** — different registers on different entity paths, so both survive
  and the contents leave with the new holder.
- **`SET EVERYONE`'s batch is N independent ops**, so a concurrent single-Piece
  write on another Device resolves per Piece by plain LWW rather than
  all-or-nothing.

### 5.3 Tier 3 — component

F4 at 393 in all three modes; the `Loose` group last, and the no-containers case;
a nested group's indent and its own rail; the trip-only container's tag; the ▲
line present and absent at the two stage pairs; the empty list. The Piece status
sheet — one op per row tap, `SET EVERYONE`'s three chips, the trailing `MOVE`.
The Pack picker — the excluded subtree, `● NOW`, the empty case. The container
move confirm, including that `Cancel` writes nothing. The card's CTA at Pack-out
and its absence at On trip; the progress line on Active cards only; `PACKING ›`
at every phase.

Two the suite must own because no other tier can:

- **`app/src/screens/drawnSizes.test.ts`** gains F4's controls — the parse-the-
  stylesheet net that ruling O left behind, and this screen adds a pill, a rail
  chip, a segmented control, a filter pill and two sheet row controls.
- **`app/src/shell/screenBand.test.tsx`** gains F4 **rendered inside
  `AppShell`**, counting one visible `SYNCED` at phone width, at Split and at
  Desktop, and one `‹ ALPS 2026` at Desktop. A per-screen suite renders the
  screen alone, so its absence assertion proves one side of a two-sided fact —
  and F4 is the first screen whose Desktop answer is *drawn*, which is exactly
  the case that would ship inverted unnoticed.

### 5.4 The fixture rule

`shared/fixtures/s9a-packing.ops.json` and `shared/src/fixtures.s9a.test.ts`,
**in the same commit as the ops**. S4's spec said the fixture rule "applies
unchanged" and no file landed, so two frozen wire formats were pinned by nothing
for a slice; `s4-ownership.ops.json` was captured a slice late and its header
says so. Five op types freeze here, `TripResidence` among them, and a spec
sentence saying a standing rule applies produces no artefact.

The fixture carries: all five ops; a nested container three deep; a trip-only
container; a Counted Entry with a Bring-count; a per-person Entry with one Piece
removed and the other two at different statuses; a container in `car` with
unpacked contents; and an unrecognised status value from a peer on a later build.

### 5.5 Unchanged

Tier 2s, Tier 4 and Tier 5 gain nothing: no endpoint, no migration, no auth
surface. Tier 5's golden path stays incomplete until S10 closes a Trip.

---

## 6. What the design round ruled

Twenty questions, ruled before this document existed. The full register and its
reasons are `docs/design/README.md` §5e and the round's own board; this section
records only what **moved**, so a reader of this spec is not misled by what the
brief proposed.

| # | Verdict | What changed from the brief or the boards |
| --- | --- | --- |
| A1 | Redrawn | The cluster is one control opening a sheet; **`LONG-PRESS` retires**, and the all-people act becomes three chips that name what they write |
| A2 · A2b | Drawn | The row's two targets; the Pack picker as the Home picker's twin; the confirm rule for three acts |
| A3 | Drawn | `Loose` **last**, against the Home picker's Loose-first |
| A4 | Drawn | Indented groups, cap two, a rail inside a rail |
| A5 | Blessed | A container is not a piece — **narrows ruling L** |
| A6 | Drawn | The threshold the two frames encoded and neither stated |
| A7 | Redrawn | PERSON mode means *whose it is*; `Shared` becomes a group; the frame's arithmetic restated |
| A7b | **Overturned** | The `PARTICIPANT` tag is dropped |
| A8 | Drawn | ALL is flat, A→Z, residence in the meta, no container rows |
| A9 | Redrawn | `UNDO` drawn-not-built; the **footer bar retires**; the hint moves up |
| A10 | Drawn | 560 capped column, no pane; the back link survives Desktop |
| A11 | Drawn | One CTA only; `PACKING ›`; the progress line on Active cards only |
| A12 | Deferred | The banner, with its blocker named |
| A13 · A14 | Blessed | One status for `×N`; a trip-only container is an ordinary group |
| A15 | Redrawn | The rail is a **direct set**; `TAP TO ADVANCE` corrected |
| B1–B5 | S9b | Ruled here, built there — see §8 |

**Where the round contradicts a durable doc** (its own §10, and §7 below):
architecture §8.5 assigns `STATUS` to S9 and it now lands nowhere on the Depot;
§8.3 draws S9 as one slice and it is two.

**Two board-hygiene items went unruled** and are recorded by code in README §5e
rather than left to be rediscovered: `Components` §06's trip card still draws
`Continue packing`, and `Components` §03's Depot table still draws a `STATUS`
column and a disagreement line on Depot rows. Both contradict this README, which
is authoritative, so neither is built; both want a `retired` mark at the next
round.

---

## 7. Doc amendments

- **`sync-protocol.md` §4.4** — the Packing table's five rows are already
  written and need no change; add the note that `status` and `stage` are open
  enums whose authoring rule is not a reader gate, beside the identical notes
  `TagString` and `bring_count` already carry.
- **`architecture-design.md` §8.3** — S9 splits into S9a and S9b, on the seam
  §8.4 already uses; S9a's entry loses the story-3 and story-13 clauses to S9b.
- **`architecture-design.md` §8.5** — the dimension table's `Packing status;
  Container | S9` row becomes `Container (home) | S9b`, and `Packing status`
  leaves the table with a sentence naming ruling B4. Story 13 is then complete at
  S10 having been touched by five slices, one of which contributed a capability
  rather than a dimension.
- **`architecture-design.md` §12** — a new §12.15 for S9a's consequences, after
  the slice lands.
- **`docs/design/README.md`** — written by the round; two code-authored
  additions made while verifying it (§6 above).
- **`docs/technical-debt.md`** — one entry closes and one opens; see §9.

---

## 8. What S9a deliberately does not build

- **Every S9b surface.** `whereabouts()` keeps its single home slice, so the
  Depot column, gear detail's card, Find's per-person card and the `CONTAINER`
  dimension all stand as they are. **The cost, stated plainly:** between S9a and
  S9b a household can pack a Trip and the Depot will not say so — Find answers
  `⌂ HAL ▸ LADE 2` for a headlamp that is in the duffel, in the car. That is the
  same shape of gap S2a left before S2b and is why the two halves ship close
  together.
- **`ui/Popover`.** The Piece status sheet is a popover from Split up on the
  boards and a `Sheet` in code until the primitive lands — its third waiting
  caller, S8's own precedent.
- **The pack-out banner** (A12).
- **F4's slice bar.** Ruling B4 puts the packing-status *capability* on this
  screen, and notes that its segmented control plus `○ LEFT` already answer story
  13's own worked example. Giving F4 the full slice-bar treatment stays story
  13's scope, recorded and not built.
- **`trip.deleted`, outcomes, the close gate.** S14 and S10.

---

## 9. Technical debt this slice touches

**Closes:** nothing outright. The `WhereaboutsCard` collision entry — *"collides
once two `'trip'` slices exist at once"* — is S9b's to close (ruling B2 turns the
card into a stack of one row per slice), and it stays open through S9a, which is
correct: this slice creates the facts that make it reachable.

**Opens:**

- **A second containment view, and no shared shape.** `tripContainment.ts`
  restates `containment.ts`'s traversal, its sorted-id determinism and §3.6's
  cycle break over a different pointer type. The duplication is deliberate — a
  shared implementation would take a strategy object for every line — but the two
  must not drift, and the break rule is the half that would be silent if they
  did.
- **`useScreenHeader`'s tenth and eleventh callers disagree about the same
  question.** F4 passes `atDesktopSidebarCarriesDestination: false` and keeps
  `‹ ALPS 2026` at Desktop; `GearListBuilder`'s **default** door points at the
  same kind of destination — one specific Trip, which no sidebar row carries —
  and the round did not look at it. Either the builder is drawn wrong at Desktop
  or F4 is, and the boards draw the builder at 1024 with **no sidebar at all**,
  which is why the question has never been forced. Named here rather than
  answered.

**Already open and unchanged by this slice:** `ownedCountOf`'s five sites,
`sequence()`'s sixth hand-rolled clock-stamper, `Popover`'s waiting callers (now
three), the `DepotState` misnomer, and the two-panes-one-scroller entry — which
F4 does not add to, having no panes.

---

## 11. What changed during implementation

Written after the slice landed. **Nothing above this line has been edited.**
`the-gear-list.md` §11 sets the precedent and this repo's own S4-fixture lesson
names the reason: a dated spec is a record of what was believed when it was
written, and correcting it in place destroys the evidence of what moved. So a
sentence above that turned out false is listed here, beside the reason, rather
than quietly fixed where a reader would never learn it had been wrong.

### 11.1 Sentences in this document that are wrong

- **§4.5's right-hand slot is backwards, and the boards say so.** It reads
  "each row's right-hand mono is *that container's stage*, taking the slot the
  Home picker gives `● NOW`". The built picker does the reverse: **`● NOW`
  takes the slot on the current row, and every other row shows its container's
  stage.** `design/README.md` §1 is only consistent under that reading — it
  says `● NOW` on the current residence "taking that row's right-hand slot in
  place of the container's stage", and later in the same bullet that "each
  row's right-hand mono is that container's stage" — and the round's artboard
  settles it outright, drawing the `Loose` row's `● NOW` right-aligned in the
  same slot the container rows give `CAR` / `STAGING`. The error was carried
  from this spec into a task brief; the implementer overrode the brief and was
  right to.
- **§3.6 says `entry.ts` is untouched, and it means the four functions it
  names.** `entriesOf`, `entryKind`, `bringCountOf` and `piecesOf` are indeed
  untouched, but `isContainerEntry` landed **in `entry.ts`**, not in
  `packing.ts`: three files need it, and `entry.ts` is where *what does this
  Entry's Gear say* already lives. Putting it in `packing.ts` would have made
  the containment view and the counts import the packing module for a question
  that is not about packing.
- **§3.6's untouched list does not mention `ui/`, and `ui/` moved twice.**
  `PersonCircle` widened its `size` union to include **28 and 34** (§4 named
  both sizes without noticing that no such circle existed yet) and its `tone`
  union to include **`filled` and `half`**, so the sheet's row circle can state
  that Piece's status. The tones are named **presentationally on purpose**:
  S8's own rule is that `PersonCircle` takes a tone and not a state, so the
  packing vocabulary stays in `app/` and the sheet maps status → tone itself.
  `ui/Sheet` gained an optional **`description`**, rendered as Radix's
  `Dialog.Description` — see §11.2.
- **§3.6's promise about `whereabouts()`'s docstring went unkept until the
  doc task, and is now kept.** Both of its statements — *"`'trip'` arrives with
  stories 9/10"* — had gone from a promise to a **falsehood** the moment S9a
  landed, because S9a *is* stories 9 and 10: the facts exist and only the read
  is missing. §3.6 named the obligation in as many words (*"the docstring is
  amended to say so rather than left to read as a lie"*), so it was this
  slice's and not S9b's to inherit. Amended in the same commit as this section:
  **S9a writes the fact, S9b reads it**, with the union stated as one member
  wide until then. The `WhereaboutsCard` collision entry is still S9b's to
  close.
- **§3.1's table is the exported *questions*, not the exported surface.**
  `packing.ts` also exports `statusGlyph` (the pill's own `○ ◐ ●`),
  `countsAsDisagreement` (§11.2), `TRIP_LOOSE` — the frozen singleton, exported
  once `app/` had grown two more copies of the literal — and `subtreeOf`, made
  public rather than leave a third hand-rolled depth-first walk in a screen.
- **§3.5's threshold counts more than "not packed".** See §11.2; the rule as
  built is *not packed, or any status this build cannot name*.

### 11.2 Decisions this document did not take

Each was forced by the code and is recorded where it is implemented, not only
here.

- **A Piece with no `residence` register of its own reads its Entry's, then
  loose.** `trip.entry_moved` on a per-person Entry is a legitimate op — the
  whole headlamp set goes in the duffel — and the Piece ops are the refinement,
  so reading an absent Piece residence as `loose` would silently discard it.
  The two registers stay distinct facts about the log; only the read is
  layered. It is deliberately **not symmetric with `status`**: an absent Piece
  status reads `not_packed` rather than the Entry's, because a status is
  per-Piece work while a residence is where the set rides. Stated in
  `packingItems`' own docstring.
- **An unrecognised status counts toward the ▲ line.** Ruling A6 says "not
  packed only", but its whole stated reason is about `staged` — counting staged
  would fire on nearly every container in the car — so the carve-out is drawn
  against `staged` and the round never reached the unrecognised case. As first
  built, a crate in the car full of gear in a status this build cannot name
  drew **no ▲ at all**: the disagreement the feature exists to surface, hidden
  in silence. The failure directions are asymmetric and that decides it, and
  the open enum is not exotic — it is the mechanism story 20's editable
  statuses ship on, so every Trip using a custom status would have had a
  permanently silent ▲. `countsAsDisagreement` is
  `!isPacked(status) && status !== A6_CARVE_OUT`, with a test walking
  `STATUSES` and asserting the differing rows are exactly `['staged']`, so a
  second carve-out cannot appear unnoticed. **Carried into
  `design/README.md` §1 as a code-authored line**, rather than left in this
  dated spec alone, because that file is where the next round actually looks
  and the round is *ruling* on this rather than reviewing it: A6 did not reach
  the case.
- **A container's *where* target is its group header.** No board draws it. A
  container is never a row in any of the three modes, yet ruling A2b rules on a
  container move and the Pack picker and its confirm exist to serve one — so
  something must open the picker for a container, and only the header is left.
  The header therefore takes the row's own two-track shape (body = picker, rail
  = journey) and is drawn ≥48 under ruling O's standalone-control clause, so
  the rail's clamped `::after` meets it edge to edge. **Flagged for the next
  round.**
- **`SET EVERYONE` skips a Piece already at the tapped status**, so N is the
  number of Pieces that *change*. The harm the skip avoids is correctness under
  sync, not tidiness: a redundant `trip.piece_status_set` carries a later HLC
  than the register holds, so it beats — and silently discards — a genuine
  concurrent write from another Device. This sheet is the one surface where a
  single tap authors N such writes at once. §4.4's "it writes N ops in one
  batch" is still true; N is smaller than it reads.
- **`ui/Sheet` gained an optional `description`.** The board wants a short
  visible title (`Headlamp`), a visible mono fact line, and a fuller
  announcement on open (`Packing status — Headlamp, 1 of 3 packed`), while
  `Sheet` declares as an invariant that the accessible name **is** the visible
  title. Widening `title` to a `ReactNode` with visually-hidden spans would
  have kept the invariant only technically; making the whole sentence the
  visible title would have collapsed two drawn registers into one. `Sheet`
  already set `aria-describedby={undefined}` with the note that "our pickers
  have no single describing paragraph" — a statement that none had had one
  *yet*, not a rule against them. This sheet has one, already visible and
  already drawn. Thirteen existing callers are byte-identical without it.
- **Empty person buckets are omitted**, rather than drawn at `0/0`. That is the
  same "arithmetic nobody asked for" the empty state already refuses when it
  withholds `● 0/0 PIECES`.
- **`containerTotals` groups by the Entry's holder, not by a Piece's own
  residence** — a reason rather than a limitation. In CONTAINER mode the boards
  draw a per-person Entry as one row carrying a cluster, not one row per Piece;
  per-Piece residence surfaces only in ALL mode's `▸ MIXED`. Grouping by the
  Entry is what keeps a group header agreeing with the rows drawn under it,
  which is the precise symptom the shared arithmetic exists to prevent.
- **The Piece status sheet's residence names the immediate container**
  (`▸ DUFFEL 90 L`), never a breadcrumb — README §1's own row anatomy, and the
  read ALL mode's meta line already uses. The Pack picker is one tap away and
  shows the whole tree.

### 11.3 Departures from a drawn frame, each with its reason

- **The ▲ line's colour is split**: the line in the staged amber the frame
  paints, the **glyph alone** in attention, as its own element. Two README
  statements are in tension — the frame paints the whole line one colour, the
  Status Grammar puts ▲ in attention — and the general rule wins here against
  the usual specific-beats-general instinct, for one reason: a glyph meaning
  "attention" everywhere else in the app must not mean something else on one
  screen. The trip card already draws exactly this structure.
- **The residence segment stays amber in PERSON mode**, where the boards draw
  it amber in ALL and muted in PERSON. `▸` + amber is the app-wide trip-world
  mark (README §2's whereabouts encoding), and ALL's own stated reason for
  amber — "the only statement of *where* once no header makes one" — is equally
  true in PERSON, which groups by person rather than by container.
- **PERSON keeps `×N`.** Making units mode-dependent would buy a board detail
  at the cost of a per-mode branch in the meta line, and CONTAINER already
  draws `SHARED · ×1`.
- **The person header circle takes one tone rule, not the board's two.** The
  frame is internally inconsistent — Els at 9/13 is half-filled, Kees at 6/9 is
  bordered, the same partial state drawn two ways — so no rule fits all three
  circles. The build states only the fact the ruling names: filled = nothing
  left. **Board inconsistency flagged for the next round.**
- **The empty state withholds the controls row and the hint as well as the
  count line and the bar.** The board names only the count line and the bar, so
  this extends it — but it extends the board's own stated principle: a
  segmented control that partitions nothing and a hint naming three gestures on
  rows that do not exist are dead affordances, and "never a dead affordance" is
  the empty region's own rule, the same one §4.9 cites about the missing door.
  `Trip.tsx` sets the precedent by replacing its whole `GEAR LIST` band rather
  than merely its count.
- **Three spacing and type values follow a shared token rather than a board
  number, under one principle: a per-screen override of a shared token is
  exactly the drift the token exists to prevent, so where a board's number
  differs from the app's token, *the token wins* and the difference is recorded
  for a round that can change the token everywhere.** (1) The gutter reads the
  shell's `--gutter` (24) rather than §4.8's "20 at Roomy" — `Depot.module.css`
  and `Trips.module.css` carry the identical documented note, and a flat 20 is
  only meaningful below the 560 cap anyway, since above it the inset is
  (viewport − 560)/2. (2) §4.8's **Desktop title bump to 34 is deliberately not
  implemented**, because no screen in the app implements it and doing it here
  alone would make F4 the odd one out. (3) A 12px gap between group cards from
  Roomy up, unspecified anywhere, because adjacent rounded corners with no gap
  pinch.
- **§4.9's missing door is confirmed as built, not fixed.** A Trip with an
  empty gear list has no drawn door to F4, for the reason §4.9 gives.
  `design/README.md` §1 now carries the consequence as a code-authored line so
  it survives the next regeneration, and it is flagged for the next round in
  case the boards want a door there anyway.

### 11.4 Known limitations, deliberately taken

- **A Piece cannot be pinned against a later Entry move.** Tapping the Piece's
  own effective residence in the picker writes nothing, because a redundant
  write moves the stamp LWW compares. Writing it anyway would "pin" the Piece
  so a later `trip.entry_moved` could not carry it along — arguably not a
  redundant write at all, since it changes future behaviour — but **no board
  draws pinning**, and inventing it would add an unrequested capability. One
  guard narrows from effective to own-register residence if a round asks for
  it.
- **An orphaned indent survives under `○ LEFT`.** A nested group whose parent's
  header is filtered out keeps its indent, with no ancestor above it. Ruling
  A4's cap-and-ancestry rule is taken literally and no board draws a
  keep-the-ancestry condition, so inventing one would be designing. Pinned by a
  test that says in as many words that it records the ruling read literally and
  is a candidate for the next round, so a later refactor cannot change it
  silently.
- **`toneForStatus`'s `staged` branch is a second site naming that literal**,
  after `A6_CARVE_OUT`. Reusing the constant would be worse — it answers "which
  status is carved out of the ▲ threshold", a different question that merely
  shares a value today. The principled fix is a presentational column on
  `STATUSES`, which is exactly what story 20's design phase touches; **that is
  the moment to table-ise it, and this is the note that names the site.**
- **Inherited, not S9a's: `EntryRow`'s `TRIP-ONLY` badge announces
  `PassportsTRIP-ONLY`** — the same glued-name shape S9a fixed on its own Piece
  row, but shipped at S7 and inherited by `PackingRow`'s badge. Named here so
  it is not lost between "not this slice's" and "nobody's".

### 11.5 What the slice found in shipped code

- **A Counted *container* is authorable**, because `container` and `kind` are
  orthogonal registers — so ruling A5's narrowing made `EntryRow` draw `×0` for
  one. Fixed inside this slice rather than deferred, because no other task
  touched that file: the read-only `×N` reads the **Bring-count**, since `×N`
  answers "how many of this thing there are" while the totals answer "how many
  things travel and can be packed".
- **`align-items: center` sizes a flex item to its content on the cross
  axis**, so a nested content-sized button inside a ≥64px row had a ~38px hit
  area while its own comment claimed the row's height floored it. Every
  precedent in this repo puts the floor on the element that *is* the target;
  here the row is a `<div>` and the target is a button inside it, a shape the
  codebase had not had before.
- **`overflow: hidden` on a segmented control is a trap that no test could
  see.** A clipped descendant is not hit-testable, so a later `::after`
  extension would have been dead on arrival — and `drawnSizes.test.ts` works by
  **parsing stylesheet text**, so it would have asserted the extension exists
  and passed over a hit area that did not. Inherited verbatim from
  `AddGear.module.css`, where it is harmless because that control is drawn at
  48. Removed here; the end segments round with `border-radius` instead.
- **Adjacent `<span>`s carry no whitespace**, so the Piece row announced
  `Headlamp— Els's piece`. The assertion that was supposed to pin the name
  matched the suffix as a **substring**, so it never saw the defect — a test
  that pins a defect is worse than no test, and it was updated with the fix
  rather than around it.

### 11.6 One thing left unresolved

**A single unreproducible test failure.** One run reported
`1 failed | 1733 passed` and the output was lost before the test could be
named. It did not reproduce across eleven further runs by the implementer or
six by the controller — **seventeen consecutive clean runs against one
sighting**. Recorded rather than assumed away, and worth watching in CI. One
untested hypothesis for whoever meets it next: several `app/` suites compute
against `Date.now()` (`tripChip`, `phaseDay`), and `app/vitest.config.ts` pins
`TZ` precisely because those reads are time-sensitive — a run crossing a
boundary is the shape of thing that produces exactly one failure in seventeen.
Speculation, not a diagnosis.
