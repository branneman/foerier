# S9b — Whereabouts reaches the Depot

The implementation design for the second half of
[architecture §8.3](../architecture-design.md#83-the-slices)'s **S9**: no op
types, no endpoints, no migration, and no line of `reduce.ts` or `state.ts`. The
whole slice is one selector growing a second slice kind, and the four surfaces
that read it.

It advances story **3** (the trip clause and the quantity split) and story **13**
(the `CONTAINER` dimension, meaning the *home* container). It delivers neither
whole: story 3's last clause — gear whose last unpack outcome was `lost` reads as
*unaccounted for* — reads a fact that does not exist until **S10**, and story 13
completes there too.

This is a **feature spec**: retired once the slice has shipped. It settles what
the durable docs left to the implementer, and it revisits nothing above
it — [`sync-protocol.md`](../sync-protocol.md) is untouched by a slice with no
ops, and every ambiguity about the fold is resolved by reading that document.

**Every design question this slice has is ruled, and none of it was ruled here.**
`docs/design/README.md` **§5e B** (B1–B5, with `S9 Round` frames **06 · 07 · 08**)
settled the shape before S9a was built; **§5e C** settled the per-person Entry's
place; and **§5f** (D1–D9, `S9 Round 3 - Whereabouts Reaches the Depot.dc.html`)
settled the nine decisions the earlier frames did not reach — before a line of
this slice exists. **The boards are the authority**; where this document and
§5e/§5f disagree, the boards win and this document is wrong.
[§6](#6-what-round-3-ruled-and-the-three-things-it-did-not-reach) records what
round 3 moved against the draft of this spec that preceded it, so the reasoning
is not lost, and names the three seams it did not reach.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types · endpoints · migration | **None of any.** The read side of a seam whose write side shipped as S9a |
| `shared/` files changed | `selectors/whereabouts.ts` (rewritten), `selectors/slice.ts` (two table rows), `selectors/depot.ts` (`ownedCountOf`), `index.ts` |
| `WhereaboutsSlice` | Becomes a **discriminated union** — `home` or `trip` — which is the shape S2b built the `slices` list for ([§2.1](#21-whereaboutsslice-becomes-a-union)) |
| Which Trips | **Active only** (`isActive`) — domain §4. Deliberately *not* the `trip` dimension's own rule, which is every **non-closed** Trip, membership being a different question ([§2.2](#22-active-only-and-why-it-differs-from-the-trip-dimension)) |
| One slice per Trip | Not per Entry. A Trip listing one Gear twice, and a per-person Entry whose Pieces are apart, both collapse into one slice, each **segment resolving on its own** — D2 ([§2.3](#23-one-slice-per-trip-and-each-segment-resolves-on-its-own)) |
| Container · stage | Container = the **immediate** holder; stage = the **root** of its containment chain, because a container carries its contents — D3 ([§2.3](#23-one-slice-per-trip-and-each-segment-resolves-on-its-own)) |
| The quantity split | **The right-hand read names the unit that splits** — a quantity for Counted, Pieces for Per-person, **nothing for Single** — D1 ([§2.4](#24-the-split-arithmetic-and-the-unit-that-splits)) |
| An over-claim | A **Whereabouts fact**: the home count floors at `×0`, the card's footer turns ▲, and the one-slot surfaces swap the glyph — D8 ([§2.5](#25-an-over-claim-is-a-whereabouts-fact)) |
| B1's segment ladder | One function, `whereaboutsText(slice, density)`, three densities — `full · column · chip`. Home's `column` form is `⌂ HOME` because that density's surfaces state the home path in a neighbouring slot ([§3.2](#32-b1s-ladder-is-one-function)) |
| B2's one-named-two-counted | A second function, `rowWhereabouts(w)`, because it reads the whole answer rather than one slice — and it is the only thing the Depot column and Find's plain row call ([§3.3](#33-b2-is-about-the-answer-not-the-slice)) |
| Cost | Whereabouts becomes **cross-aggregate**, so it takes S7's `WeakMap<DepotState, …>` memo verbatim; the `CONTAINER` dimension takes a second one ([§3.5](#35-two-memos-and-why-neither-is-new-machinery)) |
| `CONTAINER` | A **dimension row and a grouping row**, so `SliceBar`, `ValueMenu` and `SortGroupSheet` change **not at all** — S3's altitude test, passed by the sixth dimension. Sentinel `NOT IN A CONTAINER`; filter deep, group flat — D4, D5 ([§4.4](#44-the-container-dimension-changes-no-component)) |
| `STATUS` | **Never built.** Ruling B4 retired it; `architecture-design.md` §8.5 already carries the correction |
| Fixture | **None, and that is the rule rather than an exception** — the fixture rule pins **wire formats**, and this slice adds no op type ([§5.4](#54-no-fixture-and-why-that-is-not-s4s-mistake-again)) |
| Debt | Closes the `WhereaboutsCard` collision entry outright; closes `ownedCountOf`'s five sites, because this slice would otherwise author the sixth ([§7](#7-technical-debt-this-slice-touches)) |

---

## 1. What a slice with no ops has to get right

S2b is the precedent and the shape is identical one seam later: **S9a wrote the
facts, S9b reads them.** That buys three things worth naming, because they are
the reason the seam was cut here rather than anywhere else.

- **It cannot break merge behaviour.** No op type, so no wire format, no
  evolution rule, no tolerant-reader obligation. An installed PWA holding S9a
  ops queued offline is unaffected by S9b landing, in both directions.
- **Its whole risk is in agreement, not in convergence.** Every surface here
  computes from `DepotState`, so every replica computes the same answer by
  construction. What can go wrong is two *surfaces* disagreeing — the Depot
  column saying `⌂ HOME` while gear detail says `▸ ALPS 2026` — which is why
  every rule below is stated in exactly one function and read from there.
- **The cost of the gap is over the moment it lands.** Between S9a and S9b a
  household can pack a Trip and the Depot will not say so: Find answers
  `⌂ HAL ▸ LADE 2` for a headlamp that is in the duffel, in the car. That is the
  sentence [§12.15](../architecture-design.md#1215-consequences-of-s9a-packing-and-the-journey)
  wrote against itself, and closing it is this slice's whole point.

---

## 2. The selector's shape

### 2.1 `WhereaboutsSlice` becomes a union

```ts
/** D2: one, several, or none — each segment of a slice resolves on its own. */
export type TripContainerRead =
  | { of: 'one'; entryId: string; name: string }
  | { of: 'mixed' }
  | null

export type WhereaboutsSlice =
  | {
      kind: 'home'
      path: PathSegment[]
      /** Units at home. `null` wherever no quantity splits — per-person gear
       *  has no owned-count (invariant 6), and Single gear has no quantity at
       *  all (D1). Floored at zero when over-claimed (D8). */
      count: number | null
    }
  | {
      kind: 'trip'
      tripId: string
      /** `tripLabel` — never abbreviated (§5b G); truncated by CSS only. */
      tripName: string
      /** The **immediate** holder, `MIXED` when the slice's residences
       *  disagree, `null` when loose. Never a breadcrumb — S9a §11.2's
       *  Piece-status-sheet rule (D2, D3). */
      container: TripContainerRead
      /** The **root** of the containment chain (D3), or `null` when nothing
       *  carries one or the slice's residences disagree about it. */
      stage: StageValue | null
      /** Units out on this Trip; `null` for per-person and Single (D1). */
      count: number | null
      /** Pieces of this Gear out on this Trip — `2 PIECES OUT`. */
      pieceCount: number | null
    }

export interface Whereabouts {
  gearId: string
  slices: WhereaboutsSlice[]
  /** D8 — claims exceed supply, so *where* has no single answer. Computed in
   *  the same pass as the slices, never by a caller. */
  overClaimed: boolean
}
```

`slices` is unchanged in shape. S2b built it as a list from the start and wrote
down why — *"story 3's later clauses need more than one slice to be true at
once"* — so **this is a widening and not a restructuring**, which is the property
the seam was cut for. `WhereaboutsCard` already maps over the list rather than
reading `slices[0]`, and `Find`'s `CountedCard` already sums over it.

**Home is always the first slice, and there is always exactly one.** The card's
own footer states the promise (`HOME SLOT IS KEPT WHILE OUT.`) and the domain
states the fact (*"the home residence is never vacated by a trip"*). D1 turns
that from a card convention into a rule with teeth: a Single gear out on a Trip
**keeps its home row**, because dropping it would delete the path you need to put
the thing back, exactly while it is away. Trip slices follow, **by trip name
A→Z** with the trip id as a total tiebreak, per `design/README.md` §4's *"home
first, then trip slices by name A→Z"*.

### 2.2 Active only, and why it differs from the `trip` dimension

Domain §4: *"Only an active trip's packing arrangement has effect. A draft
trip's arrangement is not yet real and a closed trip's is no longer real, so
neither is consulted."* So the trip slices come from
`visibleTrips(state).filter(isActive)` — `isActive` being, since S6, the only
definition of active-ness in the codebase.

**This is deliberately not the rule `slice.ts`'s `trip` dimension uses**, and the
difference is worth stating because the two sit one file apart and look like a
copy of each other. `tripMembershipOf` includes every **non-closed** Trip, drafts
included, and says why in as many words: *"a Draft speaks for gear as surely as a
Pack-out does — membership is every non-closed Trip."* Membership is a property
of a **list**; whereabouts is a claim about **where a thing physically is**, and
a Draft gear list has not moved anything. A Gear on a Draft therefore reads
`TRIP: ALPS 2026` in the slice bar and `⌂ HOME` in the column beside it, and both
are right. A test pins the pair, because the symptom of somebody unifying them is
a Depot claiming that a Trip nobody has started has taken the tent.

### 2.3 One slice per Trip, and each segment resolves on its own

Two Entries on one Trip may name the same Gear — nothing in the catalogue forbids
it, and `claimsByGear` already handles the case by accumulating claims rather
than assuming one. A per-person Entry, since §5e C0, has **no Entry-level
residence at all**; its Pieces each carry their own.

So a Trip contributes **one** slice, gathering every residence that Trip holds
for this Gear, and **D2's rule is that each segment then answers separately —
never one "is it mixed" question governing both**:

| Segment | Rule |
| --- | --- |
| `container` | The residences' **immediate** holders: one → name it; several → `{ of: 'mixed' }`; none (all loose) → `null` |
| `stage` | Each residence's **chain root's** stage (D3): all equal → that stage; disagreeing → `null`, **never a second `MIXED`** |

**D3 is why the two segments name two different things on purpose.** A stove in
`Crate B` (rail `HOME`) inside `Duffel 90 L` (rail `CAR`) reads
`CRATE B · CAR` — the container is *what it is in*, the stage is *where that is*,
and a container carries its contents, which is story 10 whole. Computing it is
one walk up the tree `tripContainmentView` already stores; no rank function and
no new register, which is what kills the *furthest-along* candidate that would
have needed an order over a stage set sync §3.3 keeps deliberately open.

Two corollaries fall out and are stated so no call site re-derives them:

- **A Gear that is itself the trip container has no `container` segment and
  carries its own stage** — its chain root is itself. Unless it is nested, when
  it reads like anything else inside.
- **The Depot column never says `MIXED`**, because `column` density drops the
  container segment anyway (B1's ladder); a disagreeing stage there simply drops.
  `MIXED` is not attention, either: a set in two bags is not a fault (C2).

Reconciling here rather than at each caller is the argument `packing.ts`'s header
already makes about `packingItems`: derive it once, or watch the card and the
column disagree about one Gear on one screen.

### 2.4 The split arithmetic, and the unit that splits

D1's rule, which is one rule and not a third per-Kind branch: **the right-hand
read names the unit that splits.**

| Kind | Home | Trip | Right-hand read |
| --- | --- | --- | --- |
| Counted | `ownedCountOf(gear) − Σ bringCountOf(entry)`, floored at 0 | that Trip's Bring-count | `×2 THERE` · `×1 OUT` |
| Per-person | `null` — invariant 6 gives per-person gear no owned-count, and the household's Person list is not a supply | `pieceCount`, that Trip's included Pieces (`piecesOf`) | *(home: nothing)* · `2 PIECES OUT` |
| Single | `null` | `null` | **nothing, either side** |

`×0 THERE` was the obvious generalisation and D1 refused it: it asserts a
quantity for a Kind whose own fact line says it has none. `×0` stays perfectly
legitimate on **Counted** gear, which is D8's case.

**The counts come from the same functions the over-claim band reads** —
`bringCountOf` and `piecesOf`, not a second walk. `claim.ts`'s `claimFor` is the
model, and a Depot card disagreeing with the Trip's own band about how many are
out is precisely the drift this repo keeps writing down.

### 2.5 An over-claim is a Whereabouts fact

Two Trips each claiming `×2` of a Gear owned `×2` makes the home count `−2`.
D8: *a negative count of things on a shelf is not a fact about the shelf; it is
a fact about the claims.* So the count **floors at `×0`** and the claim is stated
where it belongs:

- **Gear detail's card footer turns ▲**, replacing `SPLIT COUNT — BOTH TRUE AT
  ONCE.` — which cannot be said when they are not — with
  `▲ CLAIMED ×4 · OWNED ×2` and a `RESOLVE` routing per D7. Not a new door: the
  unaccounted variant already puts ▲ + `RESOLVE` on this card.
- **Trip rows keep their honest `×2 OUT` each**, and `COUNT`'s chips draw the
  same numbers as the rows (`×0 ⌂ CRATE B · ×2 ▸ ALPS 2026 · ×2 ▸ VOSGES`) with
  no ▲ of their own. **One screen, one ▲, one door.**
- **The one-slot surfaces swap the glyph**: `▲ 2 TRIPS`, glyph naming the world
  (Components §11), word being B2's count unchanged.

`overClaimed` therefore rides on `Whereabouts` rather than being asked for
separately — it is computed in the same pass as the slices (§3.5), so no surface
pays a second full scan and no surface can forget to ask.

### 2.6 What does *not* change

`reduce.ts`, `state.ts`, `ops.ts`, every fixture, `containment.ts`,
`tripContainment.ts`, `packing.ts`, `entry.ts`, `piece.ts`, `trip.ts`,
`owner.ts`, `find.ts` and every file in `api/`. The `entry.ts`, `packing.ts` and
`claim.ts` exports this slice reads are read, never restated.

Two files move for the debt this slice closes rather than for anything it
delivers: `depot.ts` gains `ownedCountOf`, and `claim.ts` loses its own spelling
of that default to call it ([§7](#7-technical-debt-this-slice-touches)). Neither
changes an answer.

---

## 3. The functions, and where each rule is stated once

### 3.1 The exported surface

| Function | Answers |
| --- | --- |
| `whereabouts(state, gearId, view?)` | The whole answer: the home slice, one per active claiming Trip, and `overClaimed` |
| `whereaboutsText(slice, density)` | B1's segment ladder, at `full · column · chip` |
| `rowWhereabouts(w)` | B2's single-slot read for a list row: text **and** `GearRow`'s tone, D8's glyph swap included |
| `sliceCountLabel(slice)` | `×2 THERE` · `×1 OUT` · `2 PIECES OUT` · `null` (D1) |
| `whereaboutsByPerson(state, gearId, view?)` | One answer per Participant, for `PIECES` and Find's card ([§3.4](#34-the-per-person-read)) |

Five functions rather than one object with five fields, for `trip.ts`'s stated
reason: *every question the table answers has exactly one function beside it*.
`sliceCountLabel` needs only the slice, because D1's rule is already encoded in
which of `count` and `pieceCount` is non-null — the Kind is read once, where the
slice is built.

### 3.2 B1's ladder is one function

`▸ WORLD · TRIP NAME · CONTAINER · STAGE`, dropped from the right,
rightmost-but-one first:

| Density | Trip slice | Home slice | Callers |
| --- | --- | --- | --- |
| `full` | `▸ ALPS 2026 · DUFFEL 90 L · CAR` | `⌂ HAL ▸ LADE 2` | Find's card rows |
| `column` | `▸ ALPS 2026 · CAR` | `⌂ HOME` | the Depot column, `GearRow`'s slot |
| `chip` | `▸ ALPS 2026` | `⌂ HAL ▸ LADE 2` | the `PIECES` group's chips |

**The home row's forms are governed by a different fact than the trip row's, and
the table hides it, so it is stated here.** B1's ladder is about a *trip* string
running out of width. Home's two forms answer *does the surface state the home
path somewhere else*: the Depot table has a `HOME` column and the 2-line row has
its meta line, so `column` says the word; Find's card row and a `PIECES` chip
have no such neighbour, so they say the path. That is why `chip` is not simply
one rung below `column`. **Gear detail calls neither** — its card carries all
four segments across two lines and composes them from the slice itself.

A `container` of `{ of: 'mixed' }` draws `MIXED`; `null` draws `LOOSE`, matching
`WhereaboutsCard.pathText`'s and `GearDetail.chipLocation`'s existing fallback
for the identical condition in the home world. Chips are trip-name-only, so they
can never draw either (D2).

### 3.3 B2 is about the answer, not the slice

```
0 trip slices → ⌂ HOME                              tone home
1 trip slice  → whereaboutsText(slice, 'column')    tone trip
2 or more     → ▸ N TRIPS  (stage dropped — there are two)   tone trip
overClaimed   → the same word, glyph ▲              tone attention
```

One function, because the rule reads the **whole** `Whereabouts` and no single
slice can answer it. It returns the tone as well as the text, so no caller
decides for itself which world it is looking at — `GearRow.tone` has carried
`'home' | 'trip' | 'attention'` since S2b, and D8 makes the third arm reachable
one slice earlier than S2b expected (§6.1).

### 3.4 The per-person read

`whereaboutsByPerson(state, gearId, view?)` returns a
`ReadonlyMap<string, PersonWhereabouts>`:

```ts
export interface PersonWhereabouts {
  personId: string
  /** This Person's own answer — a trip slice while their Piece is out on an
   *  active Trip, otherwise the Gear's home slice. A **removed** Piece falls
   *  through to home with nothing said about the removal (B5). */
  slice: WhereaboutsSlice
  /** The Trips whose Pieces both name this Person — `▲ CLAIMED BY 2 TRIPS`.
   *  Empty in every ordinary case: a Piece belongs to at most one active
   *  Trip (domain §5.2), so this is only reachable once an over-claim has
   *  arrived through sync. */
  contestedTripIds: readonly string[]
}
```

**The keys are the Participants of the claiming Trip(s)** — D6, the union of both
Participant sets when two Trips claim — and **not every recorded Person**. A
Person not on the Trip has the home answer the card's home row already states
once, and drawing it again per Person re-makes B3's own identical-circles fault
on the surface B3 built. A Participant whose Piece was **removed** stays in the
map and reads home, which is why the strictest reading (only the differing) was
also refused: it would drop Kees from the frame B5 draws him in.

**A Map keyed by id, and not an ordered list, on purpose.** The order both
callers draw is *People-screen order*, which lives in `app/src/depot/people.ts`'s
`sortedPeople` and exists there because *"the People screen and the owner picker
are two views of one list; if they sorted differently, picking 'the third one
down' would mean two different People."* Returning a second ordering from
`shared/` would make three. The screens iterate `sortedPeople(state)` and take
the Participants from it in that order.

### 3.5 Two memos, and why neither is new machinery

`whereabouts` is called **once per row** on the Depot's 128-row list and once per
match on Find, on every keystroke. Answering the trip question per Gear means
scanning every active Trip's Entries, which is S7's exact problem one dimension
later, and it takes S7's exact answer:

```ts
const TRIP_SLICES = new WeakMap<DepotState, Map<string, TripSliceFacts[]>>()
```

`DepotState` is immutable and its identity changes on exactly the folds that
could change the answer, so the key is exact rather than approximate, and a
`WeakMap` lets superseded states be collected. `slice.ts`'s `tripMembershipOf`
states the whole argument, and this is the second instance of it — the sentence
[§12.13](../architecture-design.md#1213-consequences-of-s7-the-gear-list)
predicted: *"the next cross-aggregate dimension should expect to need the same
memo, not a new mechanism."*

**`overClaimed` is folded into the same pass.** `overClaims(state)` is itself a
scan of every active Trip's Entries, so calling it per row would double the cost
this memo exists to remove; the build reads it once and stores the gear ids it
names.

The `CONTAINER` dimension needs a second memo for a different reason:
`Dimension.valuesOf` receives `(gear, state)` and no view, and building a
`containmentView` is O(depot log depot). A per-row build is O(n² log n) on the
app's most-visited screen. So `slice.ts` gains
`CONTAINER_ANCESTORS = new WeakMap<DepotState, Map<string, readonly string[]>>()`
beside `TRIP_MEMBERSHIP`, holding each Gear's container ancestors, outermost
first.

**The alternative was memoising `containmentView` itself**, which three callers
now want. It is rejected here rather than skipped: `containment.ts` states as a
property that it is *"memoised only within this one call — nothing is cached
across calls in module state"*, and quietly making a documented purity claim
false, on a slice that owns neither file, is the wrong place to do it. Named as a
candidate in [§7](#7-technical-debt-this-slice-touches) instead.

---

## 4. The four surfaces

### 4.1 The Depot's `WHEREABOUTS` column and rows

`app/src/screens/Depot.tsx`'s `Row` currently hardcodes `whereabouts="⌂ HOME"`
with a comment saying the trip read is deliberately not placeholder'd. Both go;
the prop and the tone come from `rowWhereabouts(whereabouts(state, gear.id, view))`.

Nothing else about the row moves, and D9 confirms why. **The `HOME` column keeps
the home path in every state** — it is the home world's column, and the trip
world reaches exactly one column, which is the two-worlds rule holding at the
width of a table cell. The 2-line row keeps owner/path/qty in the meta, muted,
whether the gear is out or not. **That is what makes D1's one-slot answer cost
nothing:** the row already gives both facts, in the order a Quartermaster in a
garage needs them — *it is in the car; it lives in Crate B.*

### 4.2 Gear detail: the card, the `COUNT` chips, the `PIECES` group

- **`WhereaboutsCard`** takes the label per slice (`⌂ HOME SLOT` ·
  `▸ ON TRIP — ALPS 2026`) and the value line per slice
  (`ATTIC ▸ SHELF L-TOP ▸ CRATE B` · `DUFFEL 90 L · CAR`), with the right-hand
  read from `sliceCountLabel` — **absent on both rows for a Single** (D1).
  **This closes the logged defect outright**: `HOME_LABEL` is no longer
  hardcoded inside the map, and `key={slice.kind}` becomes a composite (`kind`
  plus `tripId`) that survives two active Trips.
- **The footer has three states**, and they are the card's own summary of what
  it just said: `SPLIT COUNT — BOTH TRUE AT ONCE. HOME SLOT IS KEPT WHILE OUT.`
  ordinarily; **the first clause dropped** for a Single, which splits nothing
  (D1); and **▲ + `RESOLVE`** when over-claimed (D8).
- **The `COUNT` group** — counted gear only, unchanged — gains one chip per trip
  slice, home chips first (`×2 ⌂ CRATE B` · `×1 ▸ ALPS 2026` · `×1 ▸ VOSGES`).
  `chipLabel` grows a trip arm; `chipLocation` is unchanged.
- **The `PIECES` group** is new and per-person only: header `PIECES` with right
  `1 PER PERSON`, one chip per **Participant** — a 22px `PersonCircle` plus that
  Person's own `whereaboutsText(slice, 'chip')` — and the hint
  `PER-PERSON GEAR HAS NO OWNED-COUNT — ITS SUPPLY IS ONE PER PERSON.` It renders
  **only while a Piece is on an active Trip** (B3), which is one rule with Find's
  card and not two. A contested Participant's chip reads `M ▲ 2 TRIPS` **with no
  route** — D7: *a chip is not a door and never has been.*
- **Neither group renders for a Single** (D1), which was already true of `COUNT`
  structurally and is now true of the card as a whole by rule.

`PersonCircle` is called at **22px**, a size it already carries, with a tone the
caller owns — S8's rule that the primitive takes a `tone` and not a `state`.

### 4.3 Find: the plain row, the counted card, the per-person card

- **`PlainRow`** gets `rowWhereabouts`, exactly as the Depot row does, and keeps
  its `⌂` path meta — D9's *same row with the meta-slot swap*.
- **`CountedCard`** already maps over `result.slices` and sums their counts —
  *"the shape is what carries forward once story 11's quantity split gives
  counted gear a second slice to add here"*, written at S2b and now true. Its
  rows call `whereaboutsText(slice, 'full')`.
- **`PerPersonCard`** is new, and is the work S8 held back (`Screens B` 03,
  restaged `S8 · PIECES` → `S9`). Gear header row (name, `PER-PERSON · ×3`, scope
  tag), then one row per **Participant** in People-screen order: 28px
  `PersonCircle`, that Person's whereabouts at `full` density, and a trailing
  mini status chip. The card appears only while at least one Piece is on an
  active Trip; otherwise per-person gear keeps falling through to `PlainRow`.
- **The over-claimed Piece row** takes the unaccounted row's anatomy —
  `▲ CLAIMED BY 2 TRIPS` + `RESOLVE` — from `contestedTripIds`, routing to the
  **first claiming Trip by name A→Z** with the accessible name
  `Resolve on Alps 2026` (D7). That is not the ranking A12 refused: A12 refused
  to promote one Trip as *the* Trip on a banner, where here the destination is
  the conflict, and the over-claim band is a property of the gear list — the same
  band on either Trip screen, naming the other — so the landing is symmetric
  whichever is first.

`Find.tsx`'s header docblock says per-person gear *"waits for Pieces, rather than
being approximated"* and names S9–10 as when. **That sentence becomes false in
this slice and is deleted rather than left to read as a lie** — the obligation
S9a's §3.6 took about `whereabouts`'s own docstring, applied to the file that
inherits it.

### 4.4 The `CONTAINER` dimension changes no component

`SliceBar` renders from `DIMENSIONS`; `ValueMenu` renders from `dimensionValues`;
`SortGroupSheet` renders from `GROUP_KEYS` and `groupLabel`. So the sixth
dimension is **two table rows and one array literal**, and every component that
draws it is untouched:

```
DIMENSION_TABLE.container   arity 'single', pinned <sentinel>, valuesOf = container ancestors
GROUPING_TABLE.container    keyOf = the immediate container, pinned <sentinel>
GROUP_KEYS                  ['none', 'kind', 'owner', 'container']
```

That is the test S3 set for itself — *"story 34 attaching with no structural
change is the test that it was built at the right altitude"* — and story 34 is
not even needed to run it.

**D4 — the sentinel is `NOT IN A CONTAINER`, not `LOOSE`.** The glossary's Loose
is *a root with no home set*, and this bucket also holds a tent on the Attic
floor, which has a home and is not Loose — the stretch the Vocabulary guards
exist to refuse. The phrase is not invented: it is F4's and the Pack picker's own
meta for their Loose group, promoted to a chip in `TRIP`'s `NOT IN ANY TRIP`
shape. Chip `CONTAINER: NOT IN A CONTAINER`; grouped header `Not in a container`,
first and muted, no meta line — *the name is the definition*; ghost
`+ CONTAINER` unchanged. **Header and chip use the same words: one bucket, one
name.** The Loose-first rule becomes sentinel-first and the position stands.

**D5 — the filter reaches any depth, the group is by immediate container, and
the asymmetry ships named.** A filter is a scope and a group is a partition, and
a household asks both: *everything in the attic crate*, then *which bag inside
it*. Combined they compose — `CONTAINER: CRATE B` + `GROUP BY CONTAINER` lists
the crate's contents by holder — so no exception is needed anywhere. In code:

- `valuesOf` returns **every container ancestor** (the scope), so the engine's one
  filter rule expresses "at any depth" with no second combinator;
- `keyOf` returns the **immediate** container (the partition), or the sentinel;
- the arrange row's hint gains a second clause **while the group is active**:
  `GROUPS FILE EACH GEAR UNDER THE CONTAINER IT IS IN`;
- headers are **flat** — the Depot's grouped band, surface, 16/600 name, right
  mono count, not the picker's tree, because a partition has no nesting to
  draw — sorted name A→Z after the sentinel, each carrying **the container's own
  home path** as a muted meta line so two same-named stuff sacks stay apart
  without indentation;
- the header count is gear **immediately inside**, so the headers sum to the
  list — a partition that visibly is one.

**`STATUS` is never built.** B4 retired it, `architecture-design.md` §8.5 carries
the correction, and `Components` §03's Depot table wants a `retired` mark for
still drawing it.

---

## 5. Testing

### 5.1 Tier 1 — the selectors

The slice's whole risk lives here, so most of it goes here.

- **Reconciling home against trip residence for Active Trips only.** A Draft's
  arrangement and a Closed one's are not consulted; a `trip.phase_moved` into
  `pack_out` makes the same arrangement start counting with no other op.
- **Whereabouts and `TRIP` membership disagreeing on a Draft**, per §2.2 — one
  test holding both answers, so unifying them fails loudly.
- **The unit that splits** (D1): Counted with the home slot kept, per-person with
  `pieceCount` over included Pieces, Single with **both** counts `null` and its
  home row still present.
- **One slice per Trip, segment by segment** (D2): two Entries on one Trip naming
  one Gear; a per-person Entry whose Pieces are in different containers →
  `MIXED` container; residences in one container but disagreeing chain roots →
  container named, stage dropped, and **never a second `MIXED`**.
- **The stage is the chain root's** (D3): the `CRATE B · CAR` case asserted
  literally, plus a Gear that is itself the trip container (no container segment,
  own stage) and the same Gear nested (reads like anything else inside).
- **Unresolvable residences**: a pointer at a removed, non-container or unfolded
  Entry resolves loose through `TripContainmentView`, never a fourth copy of
  those four reasons.
- **`rowWhereabouts`' four arms**, and that the tone travels with the text.
- **The over-claim reads** (D8): the home count floors at `×0` rather than going
  negative, trip counts stay honest, `overClaimed` rides on the answer, and the
  one-slot read swaps the glyph.
- **`whereaboutsByPerson` keys are Participants** (D6), the union across two
  claiming Trips, a removed Piece present and reading home, and a Person who is
  not a Participant **absent**.
- **The `CONTAINER` dimension**: ancestors at depth, the sentinel, the pinned
  first position, and grouping as a **partition** — every visible Gear in exactly
  one bucket, and the header counts summing to `visibleGear().length`.
- **Both memos are keyed on identity**, not on content: folding an op that
  changes the answer changes it.

### 5.2 Tier 2 — nothing

There is nothing to converge. Not a gap: no op type means no merge behaviour,
which is the property
[§8.4](../architecture-design.md#84-story-11-is-two-slices)'s argument turns on.

### 5.3 Tier 3 — the four surfaces

The Depot column at both layouts; gear detail's card as a stack with **two** trip
rows (the case the old key collided on, asserted rather than assumed); the card's
three footer states; the `PIECES` group appearing and not appearing; Find's three
row shapes and `RESOLVE`'s destination; the grouped Depot's flat headers with
their path meta. The column's tone is a `GearRow` prop, so it is asserted on the
rendered element and not on the string handed in — the lesson
`screenBand.test.tsx` already carries about one-sided assertions.

### 5.4 No fixture, and why that is not S4's mistake again

The fixture rule pins **op wire formats**: `shared/fixtures/*.ops.json` exists so
a format frozen in [sync §5.4](../sync-protocol.md) cannot drift. **S9b adds no
op type**, so there is no format for a fixture to pin, and adding one would pin a
selector's output, which is what Tier 1 is for.

This is stated rather than passed over because the repo's own S4 lesson runs the
other way: *a spec sentence saying a standing rule applies produces no artefact,
and no tier notices its absence.* The rule here does not apply, and saying which
of the two cases this is costs a paragraph and saves the next reader the check.

---

## 6. What round 3 ruled, and the three things it did not reach

This spec was drafted with nine holes in it and a **working answer** in each, so
the shape could be read whole while the boards ruled. §5f ruled all nine, and the
body above is written against the rulings and not against the draft. What the
round **moved** is recorded here rather than silently absorbed, because a
working answer that survived and one that was overturned are different kinds of
fact about this design.

| | Ruling | Against the draft |
| --- | --- | --- |
| **D1** | A Single's card keeps both rows and neither carries a count | **Overturned.** The draft said `×0 THERE`, generalising Counted's arithmetic; D1 named the better rule — *the right-hand read names the unit that splits* — which makes it one rule rather than three |
| **D2** | `MIXED` in the container slot; the stage rides its container | **Confirmed and sharpened.** The draft had one mixed-or-not question; D2 split it per segment, so a disagreeing stage drops instead of drawing a second `MIXED` |
| **D3** | The stage segment is the **outermost** container's | **Overturned.** The draft took the immediate container's, reading the Piece-status-sheet rule too widely: that rule is about the *container* segment, and D3 keeps it there while the stage answers *where that is* |
| **D4** | Sentinel `NOT IN A CONTAINER` | **Confirmed**, with the grouped header, its tone and the retired chip's annotation added |
| **D5** | Filter deep, group by immediate container | **Confirmed**, with the hint clause, flat path-carrying headers, and the header count settled |
| **D6** | Participants of the claiming Trip(s), not every Person | **Overturned.** The draft read §4's *one chip per Person* literally; D6 narrowed §4 and §6 in place instead |
| **D7** | `RESOLVE` routes to the first claiming Trip A→Z | **Confirmed**, plus the accessible name and the ruling that a `PIECES` chip carries no route |
| **D8** | The home count floors at `×0`; the footer turns ▲ | **Extended.** The draft floored and said nothing; D8 made the over-claim a Whereabouts fact with a footer, a door and a glyph swap |
| **D9** | The two list rows and the table | **Confirmed** |

### 6.1 Three seams the round did not reach

Each is taken here, in code, and named so the next round meets it where it looks.

- **The ▲ footer's two numbers are Counted-only.** D8 writes it
  `▲ CLAIMED ×4 · OWNED ×2`, and `claim.ts` states plainly that `supply` is a
  depot quantity for Single and Counted but **not** for Per-person, where it is
  *"a fact of who happens to be claiming"* and *"a surface must not render a
  Per-person row from these two fields as though they were `OWNED ×N`"*. Single
  is excluded too, by D1's own reason. So the numbers render for Counted, and
  every other Kind falls back to **`▲ CLAIMED BY N TRIPS`** — the string D7
  already ruled for a Piece row, reused rather than invented.
- **A one-Trip over-claim swaps the glyph too.** D8's one-slot example is
  `▲ 2 TRIPS`, but a Counted Gear owned `×2` with a single Trip bringing `×4` is
  an over-claim with one claim. The generalisation taken is D8's own
  parenthetical read as a rule: **the glyph names the world and the word is B2's
  read unchanged**, so that Gear reads `▲ ALPS 2026 · CAR`.
- **`GearRow.tone`'s `attention` arm becomes reachable at S9b**, not S10. S2b
  drew all three arms and wrote that `attention` *"arrives with story 11's `lost`
  outcome"*; D8 gets there first with the over-claim. The comment is corrected in
  the same commit rather than left to read as a lie — S9a's §3.6 obligation
  again, on the third file to inherit it.

---

## 7. Technical debt this slice touches

**Closes:**

- **`WhereaboutsCard` collides on a second `'trip'` slice.** The entry exists
  because S2b saw the trap and wrote it down; this is the slice that makes it
  reachable, and it closes it. Delete the entry.
- **"an absent owned-count reads 1" is stated at five sites across two
  workspaces.** Taken here rather than deferred again, for one reason: §2.4's
  home arithmetic reads that default, so this slice's alternative is to author
  another site. `ownedCountOf(gear)` lands in `selectors/depot.ts`.

  **The entry is stale, and the close is smaller than it reads.** Only **two**
  sites spell the default today: `claim.ts`'s `supply` and `whereabouts.ts`'s
  own count. `depot.ts`'s went with the `PIECES` arithmetic ruling L retired at
  the S7 amendment round, and `Find.tsx` reads the register nowhere at all.
  **The `app/` gates are a different question and stay**: `Depot.tsx`'s
  `qtyFor`, `GearDetail.tsx`'s `metaLine` and `OverClaimBand`'s F6 guard all
  test `ownedCount !== undefined`, which asks *did somebody record a count* —
  `claim.ts` says in as many words that `supply` alone cannot tell a
  genuinely-owned-one Gear from one nobody recorded a count for, *"which is
  exactly why a surface must read the register itself before printing
  `OWNED ×N`"*. Unifying them would undo fix round F6. `GearDetail.tsx:135`'s
  `?? 1` is a third question again — what an edit sheet prefills — and is left
  alone. Delete the entry, and say in the deletion what it had wrong.

**Opens:**

- **Three callers now want a memoised `containmentView`** — `whereabouts`, the
  `CONTAINER` dimension, and every list screen that hoists one by hand. §3.5 says
  why this slice does not take it: `containment.ts` documents its own
  non-caching as a property, and the change belongs to a slice that owns that
  file.

**Already open and unchanged:** `Popover`'s three waiting callers, the
`DepotState` misnomer, `sequence()`'s sixth clock-stamper, the
two-panes-one-scroller entry, `InvitePreview`'s missing person name, the two 401
body shapes, `landing/`, and the three `ui/` composites still in `app/` — **to
which this slice adds no fourth**, `PerPersonCard` being a Find-local card rather
than a named §5 composite.

---

## 8. What S9b deliberately does not build

- **Story 3's last clause.** `lost` reads as *unaccounted for* — the
  `▲ ×1 TESSIN 2025` column read, gear detail's `▲ UNACCOUNTED · LAST SEEN` row,
  and Find's `RESOLVE` on an unaccounted piece — needs an unpack outcome, which
  is **S10**. So between these two slices a piece row can state a trip and not
  yet an outcome, which `design/README.md` §6 says in as many words. The
  `attention` tone itself arrives here, on D8's over-claim (§6.1), which is one
  slice earlier than S2b expected.
- **`STATUS` on the Depot's slice bar.** Retired by B4, not deferred.
- **F4's slice bar.** B4 puts the packing-status capability on F4 and notes that
  its segmented control plus `○ LEFT` already answer story 13's worked example.
  Giving F4 the full treatment stays story 13's scope: recorded, not built.
- **`ui/Popover`, the `WhereaboutsCard` move into `ui/`, the `DepotState`
  rename.** None is this slice's, and each has a stated blocker.

---

## 9. What changed during implementation

Written after the slice landed. **Nothing above this line has been edited.**
[`the-gear-list.md` §11](2026-08-29-the-gear-list.md#11-what-changed-during-implementation)
sets the precedent and
[`packing-and-the-journey.md` §11](2026-09-01-packing-and-the-journey.md#11-what-changed-during-implementation)
follows it: a dated spec is a record of what was believed when it was written,
and correcting it in place destroys the evidence of what moved. So a sentence
above that turned out false is listed here, beside the reason, rather than
quietly fixed where a reader would never learn it had been wrong.

### 9.1 Sentences in this document that are wrong

- **"`SliceBar`, `ValueMenu` and `SortGroupSheet` change _not at all_" is
  untrue of `SliceBar`.** The Decisions table says it and §4.4 argues it, and
  the argument survives the exception: the **dimension row and the grouping
  row** really do change no component, and the sixth dimension proved S3's
  altitude claim with all three components compiling and passing their existing
  suites unedited. But D5's own last-but-one clause — _the arrange row's hint
  gains a second clause while the group is active_ — is a component edit, and
  §4.4 lists it two bullets above the sentence that denies it. `CONTAINER` is
  the first dimension whose filter and grouping answer different questions, and
  nothing else on the bar can say so. Known false before the code was written,
  and recorded here rather than fixed above.
- **The hint's punctuation is a choice this document does not make.** D5 quotes
  the clause without a terminator; it ships as two period-terminated
  sentences — `SEARCH + FILTERS COMBINE WITH AND.` then
  `GROUPS FILE EACH GEAR UNDER THE CONTAINER IT IS IN.` — following
  `WhereaboutsCard`'s own two-clause footer. Reversible, and this is where a
  later editor should look.
- **§2.6 lists `packing.ts` as untouched, and it moved twice.**
  `sameTripResidence` moved _into_ it from `app/src/components/PackPicker.tsx`
  (§9.3), and `STAGES` gained a `word` column with `stageWord` beside
  `stageLabel` (§9.2). Both are exported from `shared/src/index.ts`, which §2.6
  does name.
- **§2.3's container rule is stated over holders and ships stated over
  residences.** The table reads _"the residences' **immediate** holders: one →
  name it; several → `mixed`; none (all loose) → `null`"_, which only parses if
  a loose residence contributes no holder — and under that reading gear detail
  answered `▸ ALPS 2026 · CRATE B` for a set F4's ALL mode already called
  `▸ MIXED`, because `PackingRow` compares residences and **a loose residence
  is a residence**. `reconcile` now asks whether every residence in the slice is
  `sameTripResidence` to the first: if so that residence names itself (`null`
  when it is loose), otherwise `MIXED`. D2 adopts the word precisely because it
  is _"already the app's word for this exact fact"_, so the two surfaces had to
  agree — which is the failure §1 names as this slice's whole risk, realised
  once and caught in review.
- **§5.1's D2 case _container named, stage dropped_ is unreachable by
  construction.** One residence for everybody is one chain root is one stage, so
  the stage can only drop where the container is already `MIXED`. `reconcile`'s
  docstring states the asymmetry as a property so no reader hunts for a test
  that cannot exist, and three reachable cases replace it: two Pieces in two
  containers **sharing** a root (`▸ ALPS 2026 · MIXED · CAR`), two whose roots
  **differ** (`▸ ALPS 2026 · MIXED`), and one held beside one loose (`MIXED`,
  the F4 agreement above).
- **`PersonWhereabouts` has three fields, not two.** §3.4 gives it `slice` and
  `contestedTripIds`; it ships with `status` as well (§9.2).
- **§7 says "Delete the entry" of the owned-count debt, and the entry had a
  second half.** Its title also carries _"an absent kind has no stated reading
  at all"_, which S9b does not close — `kindOf` is still unwritten. The entry is
  **narrowed** to that half rather than deleted, and the owned-count half is
  gone with its reasoning in the commit that removed it, per the index's own
  rule that the argument never lives in the index.

### 9.2 Decisions this document did not take

Each was forced by the code and is recorded where it is implemented, not only
here.

- **A per-person Entry that is also a container reads its own residence through
  `view.holderOf`, not `entryResidenceOf`.** `container` and `kind` are
  orthogonal registers — S9a found the Counted-container case the same way — and
  since §5e C0 `entryResidenceOf` answers `null` for a per-person Kind, which is
  right for a thing that travels and wrong for a container, which is one thing
  wherever it rides. So the **container check comes before Kind** for the
  residence, as `packingItems` and `statusOf` both already do, while the
  **counts follow Kind**, which is `claim.ts`'s permanent divergence from
  `pieceCountOf`. The choice had no test and reverting it passed all 46; a
  per-person container — a family stuff sack carrying both registers, inside a
  duffel staged in the car — now pins all three halves of it, and the block
  comment says every other container in the suite is Single or Counted, where
  the two functions agree.
- **The stage segment renders `stageWord`, never `stageLabel`.** `STAGES`'
  `label` is the _rail's_ text and its `home` row is `⌂ HOME`, so the trip line
  could have read `▸ ALPS 2026 · CRATE B · ⌂ HOME` — a home-world glyph inside a
  trip-world statement, against `design/README.md` §2's app-wide marks and
  against the whole point of B1's segment order. The table gains a `word`
  column (`HOME · STAGING · CAR · PACKED`) and `stageWord` joins `stageLabel`
  and `stageDisagreementLabel`, the row lookup staying private per that file's
  convention that every question the table answers has exactly one function of
  its own. An unrecognised stage renders verbatim through either. The rail is
  untouched.
- **`PersonWhereabouts` carries the packing status, resolved in the same
  per-Piece walk that resolves the residence.** §4.3 draws a trailing mini
  status chip on Find's per-piece row; deriving it in the screen would have
  meant a second walk of the Trip's Entries. It is threaded from
  `contributionOf` through `TripSliceFacts` to `whereaboutsByPerson`, which
  reads it off the identical `first.pieces` lookup, and it is `null` exactly
  when the Person's answer is home — **one `included` boolean now gates slice
  and status together**, replacing two separate checks that could have drifted.
  Gear detail's `PIECES` chip stays circle-plus-whereabouts with no status, per
  §4's own drawn anatomy.
- **The trip-slice comparator borrows `order.ts`'s `byNameThenId` behind a
  one-line adapter.** A local `compareTripFacts` agreed with it byte for
  byte — which is what makes it a defect rather than a bug, since _"a second
  copy of a total-order comparator is exactly how two devices start drawing
  lists differently again"_. The adapter is what borrowing costs and the
  docstring says so: `byNameThenId` sorts register-shaped `{id, name: {value}}`
  entities and a `TripSliceFacts` holds neither, its `tripName` being
  `tripLabel`'s already-resolved answer. Feeding the **label** is deliberate and
  is `sortedPeople`'s stated rule — sort by the label a row draws, or a nameless
  Trip files under an empty string while the reader sees a word.
- **Both per-person surfaces gate on _at least one answer is a trip slice_,
  never on the map's size.** `whereaboutsByPerson` keys on every Participant of
  a claiming Trip whether or not their Piece is included (B5), so a per-person
  Entry whose every Piece has been tombstoned still fills the map — with every
  answer reading the identical home path, which is exactly B3's
  identical-circles fault on the surface B3 built. Gear detail and Find each
  compute the boolean in the parent, before the card is mounted, because a JSX
  element is never itself `null` and testing one for null-ness to decide on a
  fallback silently never falls back.
- **`1 PIECE OUT` / `N PIECES OUT`.** `GearListSection.tsx`'s own noun rule, one
  file over; no board draws the singular.
- **A Person's own slice carries `count: null, pieceCount: 1`.** A Person's
  answer speaks for their one Piece. Neither field is drawn at either density
  the callers use, so it is inert — but it had to be something, and `1` is the
  only honest number.
- **An unrecognised or unsynced Kind gets both counts `null` on a trip slice** —
  D1's Single arm taken as the conservative direction, since asserting a
  quantity for a Kind this build has no rule for is the stronger claim. It
  matches `claim.ts`'s `isClaimableKind` posture rather than `pieceCountOf`'s
  count-it-as-one.
- **`whereabouts` on a `gearId` not in the fold answers a home slice with an
  empty path**, plus whatever trip slices name it. It cannot throw.
- **The grouped `CONTAINER` header reads the sentinel off
  `dimension('container').pinned`, not off an absent `state.gear` lookup.** The
  lookup is a proxy — it answers _this key names no folded Gear_ — and the two
  causes of a header with no meta line are now distinct code paths: the
  sentinel's (D4, _the name is the definition_) and a real container whose own
  home path is empty. The sentinel's name is muted through a `.sentinelName`
  modifier mirroring `Packing.tsx`'s `.looseName`, which D4 states and the first
  cut missed; the test asserts the class **and** its absence on two real
  headers, since a one-sided check passes against a stylesheet that mutes
  everything.
- **`dimension('container').format` falls back to the existing private
  `nameOf`** for a container with no name register, rather than inventing an
  `UNNAMED_GEAR` sentinel: no such vocabulary exists, because unlike a Person or
  a Trip a piece of Gear is named at `gear.recorded` in every path that creates
  one.
- **`PerPersonCard`'s header `×N` is the Participant roster size**, the
  per-person analogue of `COUNTED`'s owned count. An inference, not a quoted
  rule.
- **Find's `CountedCard` grows no over-claim footer.** D8 puts one ▲ and one
  door on gear detail's card — _one screen, one ▲, one door_ — and Find's
  counted card is not that card. Its per-piece rows still carry D7's `RESOLVE`,
  which is a different fact about a different row.

### 9.3 What review caught, and what it says about the seam

Four of the five findings are one surface disagreeing with another, which is
what §1 predicted this slice's failures would look like.

- **Gear detail contradicting F4's `▸ MIXED`** (§9.1) — the risk statement
  realised, and the fix was a move into `shared/` rather than a second rule.
- **The `PIECES` gate on the map's size**, found on gear detail and guarded in
  advance on Find because of it.
- **The sentinel header's muted tone**, stated by D4 and shipped on
  `ink-primary`.
- **The missing trailing status chip on Find's per-piece rows.** The first pass
  reasoned it waited on S10; that was wrong. S9a already shipped
  `pieceStatusOf`, and what S10 owns is the separate `▲ LAST SEEN` unaccounted
  read — a different sentence in the same paragraph of `design/README.md` §6.
- **The duplicated comparator** (§9.2), which agreed and was therefore invisible
  to every test.

### 9.4 What the slice found in shipped code

- **Five docblocks and comments had turned false and were deleted rather than
  left to read as lies**, on S9a's §3.6 obligation: `Find.tsx`'s two (per-person
  gear _"waits for Pieces"_, and the amber trip slice _"deliberately not
  placeholder'd"_), `Find.module.css`'s `.sliceWhereabouts` note that the trip
  and attention variants were _"a later slice's work"_, `Depot.tsx`'s comment
  beside its `whereabouts="⌂ HOME"` literal, and `ui/GearRow.tsx`'s `tone`
  comment naming story 11's `lost` outcome as when `attention` arrives (§6.1's
  third seam).
- **`slice.test.ts`'s dimension-table docblock had been stale since S7** — _"S7,
  S8, S9 and S10 each add a row … these pin the four rows that exist"_ — and
  undercounted by two by the time this slice landed. It also promised a row for
  S8 and one for S9a, both of which rulings H and B4 retired. Corrected here,
  because a count in a test's own header is the one place a reader trusts
  without checking.
- **`overClaims` reaches the memo but the memo does not reach `overClaims`.**
  The `TRIP_SLICES` build walks each active Trip's Entries once for the slices,
  and `overClaims(state)` walks them again inside itself. Fusing them would mean
  exporting `claimsByGear` or duplicating the supply rule, and duplicating it is
  precisely what this slice must not do. It is one extra O(entries) pass **per
  fold**, not per row, so the memo still removes the cost that mattered.
  Recorded, not fixed.
- **`containerAncestorsOf` cannot produce a container id the fold does not
  hold**, and that is a real architectural difference rather than an oversight.
  `resolvePointer` already resolves an unresolvable home pointer to `LOOSE` one
  layer below it, so every ancestor it yields is by construction already a key
  of the same `state`. `dimension('trip')` and `dimension('person')` have no
  such gate — a Trip id or an `owner.personId` is read with no existence check
  at fold time — which is why their `format` arms must defend against a ghost id
  and this one need not, though it is written to anyway.
