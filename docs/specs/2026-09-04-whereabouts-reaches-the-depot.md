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

**The boards ruled S9b before S9a was built.** `S9 Round - Packing and the
Journey.dc.html` frames **06 · 07 · 08** carry **B1–B5**, registered in
`docs/design/README.md` **§5e B**, and `§5e C` (round 2) settled the per-person
Entry's place. **The boards are the authority**; where this document and §5e
disagree, §5e wins and this document is wrong.

**Nine decisions sit past where those frames reach, and they are with the boards
now**, as `claude-design-prompt.md`'s round-3 brief (D1–D9).
[§6](#6-the-nine-open-rulings-and-what-each-blocks) lists them, says exactly
which line of this design each one moves, and states the **working answer** the
rest of this spec is written against so the shape can be read whole. A working
answer is not a decision — every one of them is overturned by whatever §5f says.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types · endpoints · migration | **None of any.** The read side of a seam whose write side shipped as S9a |
| `shared/` files changed | `selectors/whereabouts.ts` (rewritten), `selectors/slice.ts` (two table rows), `index.ts` |
| `WhereaboutsSlice` | Becomes a **discriminated union** — `home` or `trip` — which is the shape S2b built the `slices` list for ([§2.1](#21-whereaboutsslice-becomes-a-union)) |
| Which Trips | **Active only** (`isActive`) — domain §4. Deliberately *not* the `trip` dimension's own rule, which is every **non-closed** Trip, membership being a different question ([§2.2](#22-active-only-and-why-it-differs-from-the-trip-dimension)) |
| One slice per Trip | Not per Entry. A Trip listing one Gear twice, and a per-person Entry whose Pieces are apart, both collapse into one slice ([§2.3](#23-one-slice-per-trip-not-per-entry)) |
| The quantity split | Counted: `owned − Σ claimed`. Per-person: no home count at all (invariant 6). Single: **D1** ([§2.4](#24-the-split-arithmetic)) |
| B1's segment ladder | One function, `whereaboutsText(slice, density)`, three densities — `full · column · chip`. Home's `column` form is `⌂ HOME` because that density's surfaces state the home path in a neighbouring slot ([§3.2](#32-b1s-ladder-is-one-function)) |
| B2's one-named-two-counted | A second function, `rowWhereabouts(w)`, because it reads the whole answer rather than one slice — and it is the only thing the Depot column and Find's plain row call ([§3.3](#33-b2-is-about-the-answer-not-the-slice)) |
| Cost | Whereabouts becomes **cross-aggregate**, so it takes S7's `WeakMap<DepotState, …>` memo verbatim; the `CONTAINER` dimension takes a second one ([§3.5](#35-two-memos-and-why-neither-is-new-machinery)) |
| `CONTAINER` | A **dimension row and a grouping row**, so `SliceBar`, `ValueMenu` and `SortGroupSheet` change **not at all** — S3's altitude test, passed by the sixth dimension ([§4.4](#44-the-container-dimension-changes-no-component)) |
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
export type WhereaboutsSlice =
  | {
      kind: 'home'
      path: PathSegment[]
      /** Units at home. `null` for per-person gear, which has no owned-count
       *  (invariant 6) and therefore no home quantity to state. */
      count: number | null
    }
  | {
      kind: 'trip'
      tripId: string
      /** `tripLabel` — never abbreviated (§5b G); truncated by CSS only. */
      tripName: string
      /** The immediate holding container Entry, `null` when loose on the Trip.
       *  Never a breadcrumb — S9a §11.2's Piece-status-sheet rule. */
      container: { entryId: string; name: string } | null
      /** The journey stage that applies, `null` when nothing carries one. */
      stage: StageValue | null
      /** Units out on this Trip; `null` for per-person gear, whose trip count
       *  is a number of **Pieces** and is carried in `pieceCount`. */
      count: number | null
      /** Pieces of this Gear out on this Trip — `2 PIECES OUT`. */
      pieceCount: number | null
    }
```

`Whereabouts` itself is unchanged: `{ gearId, slices }`. S2b built `slices` as a
list from the start and wrote down why — *"story 3's later clauses need more than
one slice to be true at once"* — so **this is a widening and not a
restructuring**, which is the property the seam was cut for. `WhereaboutsCard`
already maps over the list rather than reading `slices[0]`, and `Find`'s
`CountedCard` already sums over it.

**Home is always the first slice, and there is always exactly one.** The card's
own footer states the promise (`HOME SLOT IS KEPT WHILE OUT.`) and the domain
states the fact (*"the home residence is never vacated by a trip"*). Trip slices
follow, **by trip name A→Z** with the trip id as a total tiebreak, per
`design/README.md` §4's *"home first, then trip slices by name A→Z"*.

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
a Depot that claims a Trip nobody has started has taken the tent.

### 2.3 One slice per Trip, not per Entry

Two Entries on one Trip may name the same Gear — nothing in the catalogue forbids
it, and `claimsByGear` already handles the case by accumulating claims rather
than assuming one. A per-person Entry, since §5e C0, has **no Entry-level
residence at all**; its Pieces each carry their own.

So a Trip contributes **one** slice, and the residence facts underneath it are
reconciled into that slice's `container` and `stage`:

- every contributing residence resolves to the same holder → name it;
- they disagree → **D2**;
- the Gear is itself a container Entry on this Trip → no `container` segment, and
  the `stage` is its own (`stageOf`) — **D3** confirms or redraws this.

Reconciling here rather than at each caller is the argument `packing.ts`'s header
already makes about `packingItems`: derive it once, or watch the card and the
column disagree about one Gear on one screen.

### 2.4 The split arithmetic

| Kind | Home count | Trip count |
| --- | --- | --- |
| Counted | `ownedCountOf(gear) − Σ bringCountOf(entry)` over active Trips | that Trip's Bring-count |
| Per-person | **`null`** — invariant 6 gives per-person gear no owned-count, and the household's Person list is not a supply | `pieceCount` — that Trip's included Pieces, `piecesOf` |
| Single | **D1** | **D1** |

Two notes the table cannot carry:

- **The counts come from the same functions the over-claim band reads.**
  `bringCountOf` and `piecesOf`, not a second walk — `claim.ts`'s `claimFor` is
  the model, and a Depot card disagreeing with the Trip's own band about how many
  are out is precisely the drift this repo keeps writing down.
- **An over-claimed Counted gear makes the home count negative** — two Trips each
  claiming `×2` of a gear owned `×2`. That is **D8**.

### 2.5 What does *not* change

`reduce.ts`, `state.ts`, `ops.ts`, every fixture, `containment.ts`,
`tripContainment.ts`, `packing.ts`, `entry.ts`, `piece.ts`, `trip.ts`,
`owner.ts`, `find.ts` and every file in `api/`. The `entry.ts` and `packing.ts`
exports this slice reads are read, never restated.

Two files move for the debt this slice closes rather than for anything it
delivers: `depot.ts` gains `ownedCountOf`, and `claim.ts` loses its own spelling
of that default to call it ([§7](#7-technical-debt-this-slice-touches)). Neither
changes an answer.

---

## 3. The functions, and where each rule is stated once

### 3.1 The exported surface

| Function | Answers |
| --- | --- |
| `whereabouts(state, gearId, view?)` | The whole answer: the home slice, plus one per active claiming Trip |
| `whereaboutsText(slice, density)` | B1's segment ladder, at `full · column · chip` |
| `rowWhereabouts(w)` | B2's single-slot read for a list row: text **and** `GearRow`'s tone |
| `sliceCountLabel(w, slice)` | `×2 THERE` · `×1 OUT` · `2 PIECES OUT` · `null` |
| `whereaboutsByPerson(state, gearId, view?)` | One answer per Person, for `PIECES` and Find's card ([§3.4](#34-the-per-person-read)) |

Five functions rather than one object with five fields, for `trip.ts`'s stated
reason: *every question the table answers has exactly one function beside it*.

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

`LOOSE` on a trip slice's container is drawn as **`LOOSE`**, matching
`WhereaboutsCard.pathText`'s and `GearDetail.chipLocation`'s existing fallback
for the identical condition in the home world.

### 3.3 B2 is about the answer, not the slice

```
0 trip slices → ⌂ HOME                              tone home
1 trip slice  → whereaboutsText(slice, 'column')    tone trip
2 or more     → ▸ N TRIPS  (stage dropped — there are two)   tone trip
```

One function, because the rule reads the **whole** `Whereabouts` and no single
slice can answer it. It returns the tone as well as the text, so no caller
decides for itself which world it is looking at — `GearRow.tone` has carried
`'home' | 'trip' | 'attention'` since S2b for exactly this, and `attention` stays
unreachable until S10's `lost`.

### 3.4 The per-person read

`whereaboutsByPerson(state, gearId, view?)` returns a
`ReadonlyMap<string, PersonWhereabouts>`, keyed by `personId`:

```ts
export interface PersonWhereabouts {
  personId: string
  /** This Person's own answer — a trip slice while their Piece is out on an
   *  active Trip, otherwise the Gear's home slice. */
  slice: WhereaboutsSlice
  /** The Trips whose Pieces both name this Person — `▲ CLAIMED BY 2 TRIPS`.
   *  Empty in every ordinary case: a Piece belongs to at most one active
   *  Trip (domain §5.2), so this is only reachable once an over-claim has
   *  arrived through sync. */
  contestedTripIds: readonly string[]
}
```

**A Map keyed by id, and not an ordered list, on purpose.** The order both
callers draw is *People-screen order*, which lives in `app/src/depot/people.ts`'s
`sortedPeople` and exists there because *"the People screen and the owner picker
are two views of one list; if they sorted differently, picking 'the third one
down' would mean two different People."* Returning a second ordering from
`shared/` would make three. The screens iterate `sortedPeople(state)` and look up.

**Which People are in the map is D6.** A **removed** Piece falls through to the
home answer with nothing said about the removal — that is B5, and it is settled:
*the tombstone is a fact about a trip; Find asks about gear.*

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

The `CONTAINER` dimension needs a second one for a different reason:
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

Nothing else about the row moves. **The `HOME` column keeps the home path in
every state** — it is the home world's column, and the trip world reaches exactly
one column, which is the two-worlds rule holding at the width of a table cell.
The 2-line row's meta line keeps owner/path/qty for the same reason (**D9**
confirms both).

### 4.2 Gear detail: the card, the `COUNT` chips, the `PIECES` group

- **`WhereaboutsCard`** takes the label per slice (`⌂ HOME SLOT` ·
  `▸ ON TRIP — ALPS 2026`) and the value line per slice
  (`ATTIC ▸ SHELF L-TOP ▸ CRATE B` · `DUFFEL 90 L · CAR`), with the count from
  `sliceCountLabel`. **This closes the logged defect outright**: `HOME_LABEL` is
  no longer hardcoded inside the map, and `key={slice.kind}` becomes a composite
  (`kind` plus `tripId`) that survives two active Trips.
- **The `COUNT` group** gains one chip per trip slice, home chips first
  (`×2 ⌂ CRATE B` · `×1 ▸ ALPS 2026` · `×1 ▸ VOSGES`). `chipLabel` grows a trip
  arm; `chipLocation` is unchanged.
- **The `PIECES` group** is new and per-person only: header `PIECES` with right
  `1 PER PERSON`, one chip per Person — a 22px `PersonCircle` plus that Person's
  own `whereaboutsText(slice, 'chip')` — and the hint
  `PER-PERSON GEAR HAS NO OWNED-COUNT — ITS SUPPLY IS ONE PER PERSON.` It renders
  **only while a Piece is on an active Trip** (B3), which is one rule with Find's
  card and not two.

`PersonCircle` is called at **22px**, a size it already carries, with a tone the
caller owns — S8's rule that the primitive takes a `tone` and not a `state`.

### 4.3 Find: the plain row, the counted card, the per-person card

- **`PlainRow`** gets `rowWhereabouts`, exactly as the Depot row does, and keeps
  its `⌂` path meta.
- **`CountedCard`** already maps over `result.slices` and sums their counts —
  *"the shape is what carries forward once story 11's quantity split gives
  counted gear a second slice to add here"*, written at S2b and now true. Its
  rows call `whereaboutsText(slice, 'full')`.
- **`PerPersonCard`** is new, and is the work S8 held back (`Screens B` 03,
  restaged `S8 · PIECES` → `S9`). Gear header row (name, `PER-PERSON · ×3`, scope
  tag), then one row per Person: 28px `PersonCircle`, that Person's whereabouts
  at `full` density, and a trailing mini status chip. The card appears only while
  at least one Piece is on an active Trip; otherwise per-person gear keeps
  falling through to `PlainRow`.
- **The over-claimed Piece row** takes the unaccounted row's anatomy —
  `▲ CLAIMED BY 2 TRIPS` + `RESOLVE` — from `contestedTripIds`. Where `RESOLVE`
  routes is **D7**.

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

Two halves of B4b are shaped differently, and the difference is **D5**: the filter
means *that container and everything inside it at any depth*, which `valuesOf`
expresses by returning every container ancestor; the grouping needs exactly one
bucket per Gear, which can only be the immediate container. The sentinel's word
is **D4**.

**`STATUS` is never built.** B4 retired it, §8.5 carries the correction, and
`Components` §03's Depot table wants a `retired` mark for still drawing it.

---

## 5. Testing

### 5.1 Tier 1 — the selectors

The slice's whole risk lives here, so most of it goes here.

- **Reconciling home against trip residence for Active Trips only.** A Draft's
  arrangement and a Closed one's are not consulted; a `trip.phase_moved` into
  `pack_out` makes the same arrangement start counting with no other op.
- **The quantity split**, both directions: Counted with the home slot kept, and
  per-person with `pieceCount` over included Pieces and a `null` home count.
- **One slice per Trip** — two Entries on one Trip naming one Gear; a per-person
  Entry whose Pieces are in different containers.
- **The container and stage reads**, including a residence pointing at a removed,
  non-container or unfolded Entry (all resolve loose through
  `TripContainmentView`, never a fourth copy of those four reasons), and the
  nested case D3 rules.
- **`rowWhereabouts`' three arms**, and that the tone travels with the text.
- **Whereabouts and `TRIP` membership disagreeing on a Draft**, per §2.2.
- **The `CONTAINER` dimension**: ancestors at depth, the sentinel, the pinned
  first position, and grouping as a **partition** — every visible Gear in exactly
  one bucket, the buckets summing to `visibleGear().length`.
- **Both memos are keyed on identity**, not on content: folding an op that
  changes the answer changes it.

### 5.2 Tier 2 — nothing

There is nothing to converge. Not a gap: no op type means no merge behaviour,
which is the property
[§8.4](../architecture-design.md#84-story-11-is-two-slices)'s argument turns on.

### 5.3 Tier 3 — the four surfaces

The Depot column at both layouts; gear detail's card as a stack with **two** trip
rows (the case the old key collided on, asserted rather than assumed); the
`PIECES` group appearing and not appearing; Find's three row shapes. The column's
tone is a `GearRow` prop, so it is asserted on the rendered element and not on
the string handed in — the lesson `screenBand.test.tsx` already carries about
one-sided assertions.

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

## 6. The nine open rulings, and what each blocks

With the boards as `claude-design-prompt.md`'s round-3 brief. Each row names the
line of this design it moves, and the **working answer** the spec above is
written against — a placeholder, never a decision.

| | Question | Moves | Working answer |
| --- | --- | --- | --- |
| **D1** | A Single gear's home row while it is out | §2.4's third row; `sliceCountLabel` | `×0 THERE` + `×1 OUT` — one arithmetic for all three Kinds |
| **D2** | A per-person Entry whose out-Pieces are in different containers | §2.3's second bullet | `MIXED` in the container slot — F4's own word for the same fact |
| **D3** | Which stage a nested container's contents report | §2.3's third bullet; `whereaboutsText` | The **immediate** container's, matching the Piece status sheet's no-breadcrumb rule |
| **D4** | The `CONTAINER` sentinel's word | `DIMENSION_TABLE.container.format` | `NOT IN A CONTAINER`, mirroring the `trip` row's own sentinel and leaving the glossary's `Loose` alone |
| **D5** | Filter at any depth vs. group into one bucket | §4.4's closing paragraph | Ships as-is, the asymmetry stated in the arrange row's hint |
| **D6** | Which People the `PIECES` group and Find's card list | §3.4 | Every recorded Person, `sortedPeople` order — B3's own words read literally |
| **D7** | Where `RESOLVE` routes on a contested Piece | §4.3's last bullet | The first claiming Trip by name A→Z; the band shows the same conflict from either |
| **D8** | An over-claimed Counted gear's home count | §2.4's second note | Floored at `×0`; the Trip's standing band is the only surface that says more |
| **D9** | The two 2-line rows in their new state | §4.1 | The whereabouts slot takes the trip read; the meta line keeps the home path |

**None of the nine reaches `reduce.ts`, `state.ts`, a fixture, an endpoint or a
migration.** Every one is a formatting or a partitioning rule, which is what makes
it safe to build the shape now and let §5f land on top of it.

---

## 7. Technical debt this slice touches

**Closes:**

- **`WhereaboutsCard` collides on a second `'trip'` slice.** The entry exists
  because S2b saw the trap and wrote it down; this is the slice that makes it
  reachable, and it closes it. Delete the entry.
- **"an absent owned-count reads 1" is stated at five sites across two
  workspaces.** Taken here rather than deferred again, for one reason: §2.4's
  home arithmetic reads that default, so this slice's alternative is to author
  the **sixth** site. `ownedCountOf(gear)` lands in `selectors/depot.ts`, and the
  five sites — `whereabouts.ts`, `depot.ts`, `claim.ts`, `Depot.tsx`, `Find.tsx`
  — read it. Delete the entry.

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
  is **S10**. `GearRow.tone`'s `attention` arm therefore stays unreachable for
  one more slice, and Find's per-person rows can state a trip and not yet an
  outcome (§6 says so in as many words).
- **`STATUS` on the Depot's slice bar.** Retired by B4, not deferred.
- **F4's slice bar.** B4 puts the packing-status capability on F4 and notes that
  its segmented control plus `○ LEFT` already answer story 13's worked example.
  Giving F4 the full treatment stays story 13's scope: recorded, not built.
- **`ui/Popover`, the `WhereaboutsCard` move into `ui/`, the `DepotState`
  rename.** None is this slice's, and each has a stated blocker.
