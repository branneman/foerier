# S10 — Unpack: resolve and close

*Delivers story 11a. Advances story 32 (the close gate) and story 3 (the
*unaccounted for* standing). Story 13 is **not** advanced — see §3.7.*

The slice the whole tool exists for. Until now a Trip could be built, packed
and driven to the Alps, and when the household came home the Depot had no way
to learn what came back. S10 is the pass that teaches it: an outcome on every
Entry and every Piece, the Consumed-count and its Owned-count reduction, `lost`
as a purely read-side standing, the claim released mid-pass, and the close
gated on nothing being open.

Two op types, two cross-aggregate gestures, one new screen, and **no
endpoint, no migration and no change to the slicing engine.**

Its design was ruled before a line of it existed: the round board is
`docs/design/S10 Round - Unpack Resolve and Close.dc.html`, and
`docs/design/README.md` **§5h (F1–F20)** plus its rewritten **§7** are the
shipped authority. Where this document and §5h disagree, §5h wins.

---

## Decisions at a glance

| | |
| --- | --- |
| **Ops** | 2 — `trip.outcome_set`, `trip.consumed_count_set` |
| **Gestures** | 2 — re-home on the spot; the consumed reduction, once, at the close |
| **Endpoints** | none |
| **Migration** | none |
| **`shared/` registers** | 2 — `outcome` (Entry and Piece), `consumedCount` (Entry) |
| **New selector modules** | 1 — `shared/src/selectors/unpack.ts` |
| **New authoring module** | 1 — `shared/src/gestures.ts` |
| **Slicing engine** | **untouched** — F17 overturned the `OUTCOME` dimension |
| **Routes** | 1 — `/trips/:id/unpack` |
| **Screens** | F5 + three sheets (outcome · roster · re-home) |
| **Fixture** | `s10-unpack.ops.json`, this commit |
| **Golden path** | completes — `close the trip` is the sixth and last leg |

---

## 1. Two ops, and what they close

[Sync §4.4](../sync-protocol.md) already froze both, and
[architecture §8.3](../architecture-design.md#83-the-slices) already assigned
them here. Nothing about their wire format is decided by this slice; what is
decided is where each rule is stated exactly once.

| Type | Payload | Effect |
| --- | --- | --- |
| `trip.outcome_set` | `{entry_id, person_id?, outcome: "back"｜"consumed"｜"lost"｜null}` | Sets `outcome` on the Entry, or on one Piece when `person_id` is present. `null` clears it back to **open** |
| `trip.consumed_count_set` | `{entry_id, count: int ≥ 0}` | Sets `consumedCount` on the Entry, absolutely |

### 1.1 The register map is the contract

[Sync §3.7](../sync-protocol.md) has named both registers since before S6:

| Entity path | Registers |
| --- | --- |
| `entries.<entry_id>` | `source`, `bring_count`, `status`, `residence`, `stage`, **`outcome`**, **`consumed_count`**, `removed` |
| `entries.<entry_id>.pieces.<person_id>` | `status`, `residence`, **`outcome`**, `removed` |

`state.ts` reserved all three fields at S9a in as many words — *"`outcome` is
S10's, and nobody else's"* — and the reason it reserved them as **comments
rather than as optional fields** is the rule this slice honours in the other
direction: a register nobody writes is a field every reader must have an
opinion about, so each arrives with the slice that writes it. S10 writes them,
so S10 declares them.

`consumed_count` hangs on the **Entry** and not on a Piece: per-person gear has
no count at all (invariant 6), which is also why F9 gives the roster sheet no
stepper.

### 1.2 `outcome` is the first nullable open enum, and `null` means open

`outcome?: Register<OutcomeValue | null>` where

```ts
export type OutcomeValue = 'back' | 'consumed' | 'lost' | (string & {})
```

open past its three known members for `KindValue`'s and `PhaseValue`'s reason —
an unknown enum value is stored verbatim and never coerced
([sync §5.3](../sync-protocol.md) obligation 4).

Two absences that are not the same fact, and one read that treats them alike:

- an **absent** register means no op has ever addressed this outcome;
- a register holding **`null`** means an op explicitly cleared it.

Both read **open**, and only `outcomeOf` / `pieceOutcomeOf`
(`selectors/unpack.ts`) say so — `ownerOf`'s rule for a sixth and seventh
time, and `patterns.md` §1.2's table gains the row. The fold conflates
nothing; the readers agree because one function decides.

**No new payload reader is needed.** `readOpen` is `readString`, which already
returns `{kind:'null'}` for an explicit `null`, and
`writeNullableIfPresent` — named for the *type* and not for `name`, precisely
so it would generalise — already implements *absent leaves it alone, `null`
clears*. Its docblock predicted `trip.dates_set` as the next case and was
right; this is the third, and the first where the cleared value is an enum
rather than a string. The rule it states is uniform and applies unchanged: a
register whose declared type includes `null` takes an explicit `null` as a
clear.

### 1.3 One op, two entity paths

`trip.outcome_set` is the **first op in the catalogue whose entity path is
chosen by an optional payload field**. `person_id` present → `writePiece`;
absent → `writeEntry`. Both writers exist and neither changes.

A malformed `person_id` — present but not a string — reads `absent` through
`readString`, so the op writes the **Entry's** outcome. That is the tolerant
reader's own answer (a field it cannot read is a field that was not there) and
it is the conservative direction: the outcome lands on the line the
Quartermaster was looking at rather than being dropped.

### 1.4 `consumed_count` is a reader gate, not a reducer gate

The catalogue says *"on a counted Entry resolved as `consumed`"*. Both halves
of that are facts about **other** places — the Kind lives on the Gear
aggregate, the outcome is a second register on the same Entry — so the reducer
folds `consumed_count` on **any** Entry, unconditionally, and
`consumedCountOf` decides on the way out. This is `patterns.md` §1.3's list
gaining its sixth instance, and it is the identical argument
`bringCountOf` already makes one register over: a gate in the reducer would
make the fold order-dependent on whether `gear.kind_set` had arrived.

`consumedCountOf(entry, state)` returns `null` for anything that is not a
Counted depot Entry, and otherwise the register's value **clamped to
`[1, bringCount]`** on the way out (F9's floor and ceiling). The clamp is a
read, never a write: a peer on another build may author `×0` or `×99`, and
§5.3 forbids rewriting what arrived.

### 1.5 Two gestures, and one new module

[Sync §4.5](../sync-protocol.md) names three multi-op gestures. Two are S10's,
and they are the reason for **`shared/src/gestures.ts`**, a new module beside
`authoring.ts`:

```ts
export function reHomeOnTheSpot(
  trip, entryId, gearId, residence, state,
): readonly OpSpec[]

export function closeTrip(trip, state): readonly OpSpec[]
```

`authoring.ts` is deliberately a shelf of **pure payload constructors** and
sees no `HouseholdState`; a gesture is a composition of builders with a read of
the fold, and it belongs one file over rather than inside a screen. There are
**two callers of the close** (F5's card and `PhaseSheet` at open = 0) and two
of the re-home (F5's row, gear detail's `RESOLVE`), which is exactly the
two-surfaces-must-not-drift risk this codebase keeps answering the same way.

**Re-home on the spot** emits `trip.outcome_set{back}` + `gear.rehomed`. If
the Entry is already `back`, the outcome op is **not** emitted — §2.3, a
needless write is never free. If the residence is unchanged, the `gear.rehomed`
op **is** emitted, and that is not an exception to §2.3 but its complement; see
§4.6.

**The close** emits `trip.phase_moved{closed}` plus one
`gear.owned_count_set{count}` per Gear named by a `consumed` Counted Entry on
this Trip, with a **new absolute count**, summed per Gear (a Trip may list one
Gear twice) and floored at `0`. It applies **once, at the close** — never per
Entry as outcomes are recorded, because 11b's *offered* correction cannot offer
to put back something deducted at a moment nobody agreed was final
([architecture §8.4](../architecture-design.md#84-story-11-is-two-slices)).

Absolute and never a delta is what makes two Devices closing the same Trip
safe: both compute the same target from the same fold, so the second write is
idempotent, and if the folds differ the later stamp simply wins. This is the
property [sync §4.3](../sync-protocol.md) states and §5.2 tests.

---

## 2. State shape

```ts
export type OutcomeValue = 'back' | 'consumed' | 'lost' | (string & {})

export interface PieceState {
  readonly id: string
  readonly removed?: Register<boolean>
  readonly status?: Register<StatusValue>
  readonly residence?: Register<TripResidence>
  /** S10. Absent *and* `null` both read open — `pieceOutcomeOf`. */
  readonly outcome?: Register<OutcomeValue | null>
}

export interface EntryState {
  readonly id: string
  readonly source?: Register<EntrySource>
  readonly bringCount?: Register<number>
  readonly removed?: Register<boolean>
  readonly pieces?: Readonly<Record<string, PieceState>>
  readonly status?: Register<StatusValue>
  readonly residence?: Register<TripResidence>
  readonly stage?: Register<StageValue>
  /** S10. Absent *and* `null` both read open — `outcomeOf`. */
  readonly outcome?: Register<OutcomeValue | null>
  /** S10. Folded on any Entry; meaningful on a Counted depot Entry
   *  resolved `consumed` — `consumedCountOf` is the gate. */
  readonly consumedCount?: Register<number>
}
```

`TripState` is untouched. `HouseholdState` is untouched. **`reduce.ts` gains
two handlers and no new machinery** — `writeEntry`, `writePiece`,
`writeNullableIfPresent`, `writeIfPresent`, `readString`, `readOpen` and
`readCount` all exist and all fit.

---

## 3. Selectors

### 3.1 `unpack.ts` — the spine, and why it is not `packingItems`

`packing.ts`'s header calls `PackingItem` *"the spine the four count lines
share"*, and F5 has four count lines of its own: the screen's, each group's,
the close card's summary, and the trip card's progress line. It gets a spine,
in `shared/src/selectors/unpack.ts`, and it is **deliberately a different one**
(F1, F2):

```ts
export type UnpackItem =
  | { kind: 'entry'; entryId: string; units: number
      outcome: OutcomeValue | null; consumed: number | null }
  | { kind: 'piece'; entryId: string; personId: string; units: 1
      outcome: OutcomeValue | null; consumed: null }

export function unpackItems(trip, state): readonly UnpackItem[]
```

Three differences from `packingItems`, each ruled:

- **A container Entry produces an item** (F1). Ruling A5 excluded containers
  from the *packing* arithmetic because a container carries a journey **instead
  of** a status, so a denominator holding one could never be reached. That
  argument does not transfer: `outcome` is a third register and a container has
  it, and depot gear that went out must come home or be lost. `units` is `1` —
  `pieceCountOf` is not consulted for a container, because it answers a
  different question and answers it `0`.
- **A trip-only Entry produces no item.** It takes no outcome, never entered
  the Depot, and is excluded from the open count (invariant 18, domain §6). It
  is still **drawn** — in its own closing group, with `CLEARS AT CLOSE` where a
  pill would be (F3, F6) — which is `entriesOf`'s own distinction between
  *counted* and *listed*, one slice on.
- **Everything else matches `packingItems`**: a per-person Entry fans out one
  item per included Piece; a Counted Entry carries its Bring-count as `units`
  (A13); a Single Entry carries `1`. Those rows read `pieceCountOf`, which
  **is** the units table, rather than restating it.

So `unpackItems` = `packingItems` **− trip-only + containers**, and F1 states
the arithmetic in the round's own numbers: the Trip reading `48/61 PIECES` on
F4 reads `56/62 RESOLVED` here — `61 − 1 trip-only + 2 depot containers`. The
two boards' twin `61` was a mock coincidence, and the round says so.

**A Piece is included exactly as `piecesOf` says.** A tombstoned Piece is not
brought and takes no outcome; a Participant added late gets an open Piece with
no backfill op. Both fall out of S8's derivation and neither is restated here.

### 3.2 The count is units *resolved*

```ts
export interface UnpackCount {
  readonly resolved: number
  readonly total: number
  readonly open: number
  readonly back: number
  readonly consumed: number
  readonly lost: number
}
```

`open` is `total − resolved` and **not a third sum**, `countOf`'s rule
verbatim: two independent sums can disagree, a subtraction cannot.

**The numerator is `resolved`, not `back`** (F2), and the reason is A5's own
fault caught one slice later: a bar counting `BACK` can never fill on a Trip
with one lost item, so it would measure a distance the Quartermaster cannot
close. The bar measures the distance to **the gate**, and the gate is
invariant 18's `open = 0`.

**A `consumed` Counted Entry splits.** The domain's own sentence about the
Consumed-count is *"the rest came back"*, so an Entry with `bringCount ×4` and
`consumedCount ×2` contributes `2` to `consumed` and `2` to `back` — and `4` to
`resolved`, because the *decision* is whole. The four buckets sum to `total`,
which is what the close card's `53 BACK · 2 CONSUMED · 1 LOST · 6 OPEN` states
and what the frame's own annotation checks (`53 + 2 + 1 + 6 = 62`).

**An unrecognised outcome counts as resolved.** It is a value some build wrote
deliberately, and the alternative — treating it as open — would leave a Trip a
peer had finished permanently uncloseable on this build, with a row whose pill
this build cannot draw as the only thing standing in the way. It is not
counted into `back`, `consumed` or `lost`, so the three named buckets can sum
to less than `resolved`; the close card renders the segments it has. This is
`nextStatus`'s direction of failure, one register over: never invent, and
prefer the failure that is visible over the one that is silent.

`unpackTotals(trip, state)` is `countOf`'s sibling over `unpackItems`, and
every one of the four count lines reads it. `countOf`'s own comment about
deriving any of them separately applies here word for word.

### 3.3 The claim gate goes inside `claim.ts`, and nowhere else

`claim.ts`'s header has carried the instruction since S7:

> **S10's gate goes here**, inside this file and nowhere else. A speculative
> `isResolved` returning `false` today would be a function no caller could make
> true, and a fifth thing about outcomes to keep in agreement before outcomes
> exist.

Two edits, both inside that file:

- `claimsByGear` skips an Entry whose `outcomeOf` is not `null` — a resolved
  Entry holds no claim.
- `claimFor`'s per-person branch reads `piecesOf(entry, trip)` **minus the
  Pieces with an outcome**, so resolving one Person's Piece releases exactly
  that Person's claim, which is the granularity domain §5.2 states the rule at.

That is the whole of *"marking an Entry resolved hands its Gear straight
back — mid-pass, before the Trip closes"*: the claim is released by the same
read that computes it, and `overClaims` therefore stops reporting a conflict
the moment either side is resolved. **No op resolves an over-claim at S10 that
did not at S7**; an outcome is simply a second thing that can make one go away.

`claim.ts`'s existing note that *"at S7 every non-removed Entry on an active
Trip is unresolved and this file reads them all"* is corrected in place.

### 3.4 The destination grouping

F3 groups by **the Place at the root of the home path** — the room you walk
to — and keeps the container in the row's return path. It is deliberately
*not* D5's partition, which files by the immediate holder: D5 answers *where is
this filed*, F5 answers *where does my body go*, and the round states both
questions rather than reconciling them.

```ts
export function unpackDestinationOf(gearId, state, view): string | null
```

`null` is the `Loose` bucket — gear with no Place at the root of its home path.
The sentinel is the glossary's **Loose** and D4's guard permits the word here
that it refused on the Depot: D4 refused `Loose` for a bucket that also held a
tent standing on the Attic floor, and *this* bucket is exactly gear with no
Place at its root, which is what Loose means. It draws last (A3's Loose-last),
muted, meta `NO HOME SLOT`.

**Trip-only Entries are their own closing group**, after `Loose`, meta
`TAKES NO OUTCOME · CLEARED AT CLOSE`. They are not Loose gear and the previous
board filed them there wrongly.

Group headers read `resolved/units` (`Attic 4/5`) — the trip-only group's
header carries a plain count, having no outcomes to fraction. PERSON mode's
headers add `· N OPEN` (`Kees 7/9 · 2 OPEN`), read from the frame: a room
header names a place you are standing in and the fraction is enough, while a
person header names somebody's remaining work and that is the point of the
mode.

PERSON mode reuses **`personPartition`** unchanged (A7: *whose it is* — a
Piece to its Participant, Personal gear to its owner, the rest to `Shared`,
drawn last). ALL is flat, A→Z, with the return path as the meta's last segment.

### 3.5 The unaccounted standing, and the stamp comparison

Story 3: gear whose last unpack outcome was `lost` reads as **unaccounted
for**, naming the Trip it was last seen on, *until a later fact settles it*.
Domain §4 orders the whole answer: an unresolved Entry on an **active** Trip
wins; then the unaccounted standing; then home (F16(4) confirms it).

The rule, stated once, in `unpack.ts`:

> A `lost` outcome contributes to the standing **iff its register's stamp is
> later than the Gear's own `residence` register's stamp**.

This is the codebase's **first cross-aggregate stamp comparison**, and it is
legitimate for the same reason every other derived answer is: every replica
holds identical registers with identical stamps, so every replica computes the
identical standing. `compareStamps` (`hlc.ts`) and `stampOf` (`registers.ts`)
already exist; a Gear with no `residence` register at all compares as
*earlier than everything*, so a lost outcome stands until somebody re-homes.

Three consequences worth stating because a call site would otherwise re-derive
them:

- **A re-home settles the whole standing for that Gear**, not one unit of it.
  There is no way to say *one of the two turned up*, because there is no
  per-unit identity to say it about — domain §6 refuses to give counted units
  one, deliberately. The MVP answer is the honest one and it is recorded here
  rather than worked around.
- **Two Trips can both hold a live lost outcome for one Gear.** The units sum,
  and the **latest** such outcome names the Trip. Nothing in the catalogue
  forbids a Gear being lost twice, and `claimsByGear` already accumulates
  rather than assuming one Entry per Gear.
- **A later `back` on another Entry does not settle an earlier `lost`.** They
  are different units. What settles a lost outcome is a `gear.rehomed` with a
  later stamp, or that Entry's own outcome changing (S11).

`unaccountedOf(state)` returns, per Gear id:

```ts
interface Unaccounted {
  readonly tripId: string        // the latest live lost outcome's Trip
  readonly tripName: string
  readonly units: number         // Single → 1, Counted → Σ bring counts
  readonly personIds: readonly string[]   // per-person only
}
```

It is computed in the **same pass** as `whereabouts.ts`'s `TRIP_SLICES` memo —
`patterns.md` §1.7's second rule, *anything else the build already scans per
fold is folded into the same pass*. The memo's loop widens from active Trips to
every visible Trip (a closed Trip's outcomes are exactly the history this
standing reads), with the active-only filter moving inside the loop so that
`whereabouts`' own *active Trips only* rule is unchanged and still stated in
one place.

### 3.6 `whereabouts.ts` — three changes and one non-change

1. **Resolved Entries and Pieces stop contributing a trip slice.** This is
   *"marking BACK hands the gear home there and then"*, and it is one predicate
   inside the existing loop.
2. **`Whereabouts` gains `unaccounted: Unaccounted | null`**, beside
   `overClaimed` and shaped like it (F16(3)) — a **standing, not a slice**. The
   retired alternative is on the round board: a row claims a place, and
   unaccounted is the absence of one, so the row form both over-stated the home
   count and drew a slice with nowhere to point.
3. **The home slice's count subtracts the unaccounted units** (F16(3)), so a
   Counted Gear owned ×3 with one lost reads `×2 THERE` instead of `×3 THERE`.
   It floors at zero exactly as D8's over-claim case does. The **owned** number
   is stated by the card's footer, which is the one place it can be stated
   truthfully now that the shelf count and the owned count differ.

`rowWhereabouts` gains the standing in the one-slot surfaces' grammar (F16(2)):
glyph `▲`, word from B2's read — `▲ TESSIN 2025`, and `▲ ×1 TESSIN 2025` on
Counted. **Over-claimed and unaccounted at once reads the active fact**,
`▲ 2 TRIPS`: one glyph, one word, and the fact about *now* beats the fact about
last September.

The non-change: `sliceCountLabel`, `whereaboutsText` and B1's density ladder
are untouched. The standing rides beside the slices; it is not one.

### 3.7 What S10 does **not** touch

**`slice.ts` — not a line.** F17 overturned the `OUTCOME` dimension on H's and
B4's argument: story 13's criterion list never names it; `open` is undefined
for every Gear on no active Trip and restates TRIP membership where it is
defined; and `lost` alone is a one-value dimension over a glyph the
`WHEREABOUTS` column already draws — the case for the column, not for a chip.

**Story 13 therefore completed at S9b, not here**, and
[architecture §8.5](../architecture-design.md#85-where-story-13-attaches) is
wrong in two places until §7's amendment lands. The capability F17 declines to
build is named rather than hidden: *list every unaccounted gear* is the
`WHEREABOUTS` column's sort at Desktop and Find per Gear, and nothing on the
phone.

Also untouched: `reduce.ts`'s existing handlers, `containment.ts`,
`tripContainment.ts`, `depot.ts`, `find.ts`, `order.ts`, `tags.ts`, every
endpoint, and every table.

---

## 4. Screens

### 4.1 One route, three doors

`/trips/:id/unpack`, its own route at **every width** (no pane — a Trip has no
two-pane view at any width) and reachable at **every phase**. A phase locks
nothing, and hiding a route by phase is the soft lock the band's own comment
already refuses for `PACKING ›`.

- **The trip card's CTA at Unpack** — `Continue unpack` (F13), the slot A11
  deliberately left empty because F5 did not exist. The CTA names the current
  phase's verb; it does **not** become `Close trip` at open = 0, because that
  would be a third door for one register.
- **`UNPACK ›` beside `PACKING ›` in the `GEAR LIST` band** (F14), every
  width, every phase, **no swap**. At Compact the trailing slot wraps its
  routes to a second right-aligned line, order and gap 14 kept. Accessible name
  `Open unpack for Alps 2026`. **An empty gear list draws neither door** —
  F4's own rule, unchanged.
- **`SET PHASE`'s `CLOSED` row while open > 0** (F12) — see §4.8.

### 4.2 The screen, top to bottom

Band `‹ ALPS 2026` + sync line, through `useScreenHeader({ splitPane: false,
atDesktopSidebarCarriesDestination: false })` — `Packing`'s own answer, and the
hook's **twelfth** caller.

Title `Unpack`. Count line `● 56/62 RESOLVED` · `6 OPEN`, mono 11, over a 6px
bar. Then the over-claim band, facts-only (§4.9). Then the controls: a
`ui/SegmentedControl` reading `DESTINATION · PERSON · ALL` and an `○ OPEN`
filter pill. Then the hint, the screen's whole instruction:

```
TAP PILL = OUTCOME · TAP CIRCLES = PER PERSON · TAP ROW = RE-HOME
```

Then the groups, then the close card as **the list's last card** (F11) — not a
docked footer, which would spend the thumb zone on a control disabled for most
of the pass, and not a right-hand column, which needs a pane F5 lacks.

**Empty** (F19): `0 ENTRIES.` + `The gear list is built from the depot.` and
nothing else — no count line, no controls, no hint, **no close card**. Closing
an empty Trip is `SET PHASE`'s ordinary row at open = 0. Reachable by direct
link only, since the trip screen draws no door to an empty list.

**Finished** (F19): `● 62/62 RESOLVED · 0 OPEN`, bar full, card live; with
`○ OPEN` still on from the pass the list reads `NOTHING OPEN.` above it.

### 4.3 The row and its three targets

A row is one Entry — never one Piece, outside PERSON mode (F7). N rows
repeating one return path is the identical-rows fault rulings B3 and I have
already named twice.

| Slot | Content |
| --- | --- |
| Name | `entryLabel` |
| Meta | the **return path**, `→ SHELF L-TOP ▸ CRATE B · ×2`; a container `→ SHELF L-TOP · 12 INSIDE`; a consumed Counted `→ BAK 3 · ×2 CONSUMED · ×2 BACK`; a re-homed row `→ CRATE B · RE-HOMED` |
| Right | the pill, or a 34px `PersonCluster`, or faint mono `CLEARS AT CLOSE` |

**The meta is where it goes; the pill is what happened** (F6). `▲ NOT SEEN AT
UNPACK` retires: one `▲` per row, and it lives on the pill. The consumed split
in the meta is not a counter-example — it is a quantity fact, the same slot's
`×2` one state on.

Four pills, `ui/StatusPill`'s grammar: `● BACK` (packed style) · `○ OPEN`
(muted — **one word for the unresolved state everywhere; never "out"**) ·
`CONSUMED` (dashed `#6A7161`, no glyph) · `▲ LOST` (attention). `OPEN` is the
day's work, not a fault, which is why it is muted and why `▲` is `LOST` alone.

A trip-only row's right slot is faint mono `CLEARS AT CLOSE` with **no
border** — a pill shape is a control on every other row (§5b O), and a
trip-only Entry takes no outcome. Its meta reads `NOT IN DEPOT`.

Three targets:

- **pill → the outcome sheet** (§4.4)
- **34px cluster → the roster sheet** (§4.5)
- **row body → the Home picker** (§4.6)

**The pill opens rather than cycles**, and F5 rules the asymmetry with F4
acceptable without a disclosure mark: a chevron breaks the pill's glyph + word
grammar, the hint states the behaviour, and the failure is safe in the only
direction that matters — a reader expecting a cycle taps once and a sheet opens
with nothing written.

### 4.4 The outcome sheet

Title = the gear name. Fact line = `OUTCOME · ×4 BROUGHT · → BAK 3`, passed as
`Sheet`'s `description` (§4.5 of the pattern catalogue). Four 44px chips in the
pill's grammar, the current outcome raised and focus-ringed. **A tap writes one
op and the sheet stays open** until dismissed on the scrim — a picker's
dismissal, which is what it is.

On a Counted depot Entry the `CONSUMED` chip **reveals a stepper beneath the
verbs**, and only while `CONSUMED` is the outcome. It opens at the Bring-count
(all of it used up is the ordinary case), floors at `×1` — `×0` is not a value,
that is `BACK` — ceilings at the Bring-count, and draws the split beside it
(`×2 BACK`). The fact line beneath states the consequence **once, here**:

```
THE REST CAME BACK. OWNED ×6 → ×4 AT CLOSE.
```

The close card's hint accordingly loses `CONSUMED REDUCES DEPOT COUNT` (F9).
Per-person gear has no count and grows no stepper.

A container's fact line adds `CONTAINER · 12 INSIDE · ITS CONTENTS KEEP THEIR
OWN OUTCOMES.` — **no cascade, ever** (F1). Footer, on every variant:
`ONE OP PER TAP. LOST KEEPS THE HOME SLOT AND STAYS SEARCHABLE.`

`ui/Stepper` gains its **third** caller and the second that commits on blur or
Enter rather than per keystroke. `AddGear`'s well remains the recorded
not-yet-folded fourth.

### 4.5 The roster sheet

The outcome sheet **with a roster above the verbs** (F7), opened from the
cluster. It is one component with a variant, not a second sheet: *the chips are
the verbs, the roster is who*, which is why `SET EVERYONE` needs no second
control and a single Piece needs no second sheet.

Rows are the Piece status sheet's — 48px, 30px circles — and each row is a
**selection** in the Participants picker's `✓` grammar. `EVERYONE` is selected
on open and the chip restores it. The four chips apply to the selection, **one
op per Piece that changes** — §5g E10's rule, which is A15's redundant-write
rule applied to N registers at once, and the one surface where a single tap
authors N writes is the one where a redundant one matters most.

Circle tones (F7), three values on a 34px cluster and on the roster's 30px
rows:

| Tone | Means |
| --- | --- |
| filled | resolved — `back` **or** `consumed` |
| bordered | open |
| attention ring | `lost` |

`consumed` is not drawable as a fourth tone at that size and differs from
`back` only in the Depot count, which the sheet states. The cluster's count is
**resolved over Pieces** (`3/3`). `ui/PersonCircle` takes a `tone` and the
caller owns the meaning — S5's login ring, S8's inclusion, S9's packing fill,
and now S10's resolution are four meanings for one border, exactly as §5.3
predicted.

In **PERSON** mode a Piece row carries its own pill — one Piece, one outcome —
so the cluster belongs to DESTINATION and ALL.

### 4.6 Re-home on the spot

The row body opens the shipped `HomePicker` in MOVE mode, unchanged but for a
context line:

```
RE-HOMING TENT, 3P · PICKING A HOME MARKS IT BACK
```

Picking emits `trip.outcome_set{back}` + `gear.rehomed` (F8). **No confirm** —
A2b: the row visibly jumps to its new room, and a second re-home is the
reversal. Gear detail's own MOVE confirms because gear detail shows no such
jump. A container being re-homed carries its own `N INSIDE RIDE ALONG` line
and subtree exclusion, as §3c already draws.

Afterwards the meta reads the new return path plus a muted segment,
`→ CRATE B · RE-HOMED`. **It is derived, not stored, and its rule is one
comparison:** the segment draws while the Gear's `residence` stamp is at or
after this Entry's `outcome` stamp — *the home moved when this line was
resolved*. The gesture produces exactly that, since it authors the re-home
into the same batch as the outcome and therefore on a strictly later clock.

It is deliberately **not** *"re-homed during this pass"*, which would need a
fact the fold does not hold — there is no register marking when the pass began,
and the `phase` stamp answers a different question on a Trip whose phase never
moved. The consequence is one over-inclusive case, stated rather than hidden: a
Gear re-homed from gear detail *after* its Entry was marked back also draws the
segment. That reads truthfully ("its home changed since it was resolved"), it
is cosmetic, and no count depends on it.

**The one place a needless write is the point.** F16's settle route reuses this
picker, and its `● NOW — FOUND HERE` row is **tappable**, because writing the
same home again is the settling fact: the new `gear.rehomed` stamp is later
than the `lost` outcome's, which is precisely what ends the standing.
`patterns.md` §2.3 gains this as its one stated exception, with the reason —
here the write is not a restatement of a value, it is a **new assertion about
now**.

### 4.7 The close card, and the close batch

Surface card, the list's last card at every width. Summary mono
`53 BACK · 2 CONSUMED · 1 LOST · 6 OPEN`. Full-width 48px button, **gated**:
disabled style reading `Close trip — 6 open` until `open = 0`, then accent
`Close trip`. Hint:

```
BACK WRITES HOME AT THE TAP. CLOSE WHEN OPEN = 0 — LOST IS ALWAYS AN ANSWER.
```

and at open = 0:

```
CLOSE WRITES THE CONSUMED REDUCTION. THE ARRANGEMENT AND EVERY OUTCOME ARE KEPT. LOST KEEPS ITS HOME SLOT.
```

**No confirm** (F10), stated so the engineer's default does not add one. The
gate is the ceremony; the Depot write was stated at the decision that caused it
(F9) and is offered back by S11's reopen; closing destroys nothing (invariant
14). `ReopenConfirm` is not the precedent — it confirms because invariant 19
makes *leaving* closed deliberate, while *entering* closed has the gate.

The tap emits `closeTrip(trip, state)` (§1.5) through `emit`, one op at a time,
in the returned order: the reductions first and `trip.phase_moved` **last**, so
that a Device dying mid-batch leaves a Trip still in `unpack` with its
reduction applied rather than a closed Trip whose Depot never moved. Both
orders converge; this one fails better.

### 4.8 `SET PHASE`'s `CLOSED` row

`PhaseSheet`'s standing rule — **any row tappable, backwards included** — holds
(F12). While `open > 0` the `CLOSED` row draws a right mono `6 OPEN ›` and the
tap **routes to F5** rather than writing; at `open = 0` the slot is empty and
the row is the ordinary setter.

The rejected alternative is on the board: a disabled `CLOSED · 6 OPEN —
RESOLVE ON UNPACK` row is truthful and dead — a dead tap in a sheet built to
have none (D7), and a Quartermaster reading it has nowhere to go but back out
and hunt for the band's link.

This discharges `PhaseSheet.tsx`'s standing comment that *"entering `closed` is
unguarded… S10 adds the gate; a stub here would be a claim about a check the
app does not perform."*

### 4.9 The over-claim band renders here, facts-only

F15: the band is a property of the **gear list, not a route**, and F5 is a
third view of that list. It sits between the count block and the controls — the
slot the trip screen gives it — and it disappears the moment an outcome
releases the claim, which is the ordinary way an over-claim ends on this
screen.

**No settle routes.** `REMOVE HERE` and `BRING ×N HERE` edit the list, and F5
is not the list editor; `OverClaimGroups`' `SettleRoutes` prop is omitted, and
its absence *is* read-only (§5b I, `patterns.md` §4.4). Its fact line reads
`SINGLE · STILL OPEN HERE`, naming what F5 *can* do about it.

### 4.10 Widths

A10 verbatim (F11): one capped **560px** column, centred, from Roomy up, with
the shell's gutter; bordered group cards with 12 between (E5, E6); no pane at
any width. The back link survives Desktop because the sidebar names the Trips
list, not this Trip — F4's own reason, and `useScreenHeader`'s
`atDesktopSidebarCarriesDestination: false`. The sync line is drawn at Split
alone, where the rail's bare dot is the only other statement.

### 4.11 The five surfaces downstream

| Surface | Change | Ruling |
| --- | --- | --- |
| `TripCard` | `Continue unpack` at Unpack; the progress line reads `unpackTotals` at Unpack and `packingTotals` at the other two Active phases | F13 |
| `Trips`' `ClosedRow` | meta gains `1 LOST` — **attention while any is still unaccounted, muted once all are re-homed**; zero lost drops the segment as the date does; `N CONSUMED` never joins | F18 |
| `GearDetail`'s `WhereaboutsCard` | the home row's glyph turns `▲` and its count subtracts the lost units; footer `▲ ×1 LAST SEEN: TESSIN 2025 · OWNED ×3` + `RESOLVE` → the Home picker with context `RESOLVING HEADLAMP · LAST SEEN: TESSIN 2025`; Single reads `▲ LAST SEEN: TESSIN 2025` with no counts; §4's row variant retired | F16(1)(3) |
| `Depot`'s `WHEREABOUTS` column and 2-line row | `▲ ×1 TESSIN 2025`; over-claimed **and** unaccounted reads the active fact, `▲ 2 TRIPS` | F16(2) |
| `Find` | the per-person card row's `▲ LAST SEEN: TESSIN 2025` + `RESOLVE`, live at last — routing to gear detail, **not** to the closed Trip. A contested Piece keeps D7's route to the band: two `▲`s, two doors, because they have two settlers | F16(1)(2) |

`Find.tsx`'s standing comment — *"**Still left to S10:** the `▲ LAST SEEN`
unaccounted read has no unpack outcome yet to draw from"* — is discharged.

---

## 5. Tests

### 5.1 Tier 1 — unit

The reducer, `shared/src/reduce.outcomes.test.ts`:

- `trip.outcome_set` with and without `person_id`, writing the two entity
  paths; a malformed `person_id` landing on the Entry (§1.3).
- `null` clearing to open, and **absent leaving the register alone** — the
  obligation-5 pair, on the first nullable enum.
- An unrecognised outcome folded verbatim.
- `trip.consumed_count_set` on a non-Counted Entry folding anyway (§1.4).
- Both ops arriving before their `trip.entry_added`.
- Plain LWW on both registers; a lost write returning the identical object.

`unpack.ts`:

- **open ≡ no outcome**, absent and `null` alike.
- The spine: a container produces an item and a trip-only Entry does not, so
  `unpackItems` ≠ `packingItems` — pinned as the arithmetic F1 states, in both
  directions from one fixture Trip.
- Units resolved; the consumed split; the four buckets summing to `total`;
  `open = total − resolved`; an unrecognised outcome counting as resolved and
  into none of the three named buckets.
- `consumedCountOf`'s gate and its `[1, bringCount]` clamp, including a peer's
  out-of-range value read clamped and **stored unchanged**.
- The destination grouping, its `Loose` bucket, and the trip-only group.

`claim.ts`:

- **The claim releases the moment an outcome is recorded, mid-pass** — a Single
  Gear on two Trips stops over-claiming when either is resolved.
- A per-person claim releasing **per Person**.
- A resolved Entry on an active Trip contributing nothing to `claimed`.

`whereabouts.ts`:

- A resolved Entry stops contributing a trip slice; the Gear reads home again
  with the Trip still Active.
- The unaccounted standing: the stamp comparison in both directions; a
  re-home settling it; a re-home writing the **same** residence settling it;
  a Gear with no `residence` register.
- The home count subtracting the lost units and flooring at zero.
- Over-claimed **and** unaccounted reading `▲ 2 TRIPS`.
- Precedence: active Entry · unaccounted · home.

`gestures.ts`:

- `closeTrip` computing absolute counts, summing per Gear across two Entries,
  flooring at zero, and emitting `trip.phase_moved` **last**.
- `reHomeOnTheSpot` omitting the outcome op for an already-`back` Entry and
  **keeping** the `gear.rehomed` op for an unchanged residence.

### 5.2 Tier 2 — convergence

- **Two Devices closing the same Trip must not double-apply the Consumed
  reduction.** The named obligation, and the whole reason
  `gear.owned_count_set` is absolute. Both replicas converge on the same
  owned-count whichever order the two batches merge in.
- An outcome and a `gear.rehomed` racing: the standing resolves identically on
  both replicas, whichever clock is later.
- `trip.outcome_set` on an Entry racing `trip.outcome_set` on one of its
  Pieces — different registers, both survive.
- A Participant added on one Device while their Piece is resolved on another.
- **Nothing recorded is discarded to resolve an over-claim**, one slice on:
  the claim releases because an outcome was recorded, and both Entries remain.
- The frozen-list assertion for both new op types (§5.4's other half).

### 5.3 Tier 3 — component

F5 at each mode and each filter state; the empty and finished screens; the
gated button's two states and its copy; the three sheets, including the
stepper's floor, ceiling and split; the roster's default selection and its
one-op-per-changed-Piece write; the re-home gesture's two ops and its
already-`back` single op; `SET PHASE`'s `CLOSED` row routing rather than
writing while open > 0; the trip card's CTA and its progress line at Unpack;
the closed row's `1 LOST` in both tones; the four downstream unaccounted
surfaces.

`app/src/shell/screenBand.test.tsx` gains F5 — the band's two-sided fact, for
the twelfth screen.

`app/src/screens/drawnSizes.test.ts` gains the 34px cluster and the 44px
chips.

### 5.4 The fixture rule

`shared/src/fixtures/s10-unpack.ops.json` + `shared/src/fixtures.s10.test.ts`,
**in this commit**. S4's lesson is written into `testing.md` and this is the
first slice since S6 to introduce an op type; the fixture pins both wire
formats — including a `null` outcome and a `person_id`-bearing one — through
the current reducer, from the format as it actually shipped.

### 5.5 Tier 5 — the golden path completes

`sign in → add gear → find it → build a trip → pack an item → **close the
trip**`. The sixth and last leg lands **in this slice**, per `testing.md`'s own
standing sentence: *a slice that builds a golden-path step adds its leg in the
same slice, or writes the debt down.* Three slices went the other way and the
path stalled; this one does not.

The leg clicks its way in: the phase chip → `SET PHASE` → `UNPACK`, then the
trip card's `Continue unpack` (F13) — or the band's `UNPACK ›` (F14) from the
trip screen it is already standing on. It resolves the one packed Entry `BACK`,
watches the count reach `0 OPEN`, taps the now-live `Close trip`, and asserts
the Trip reads `CLOSED` in the ledger and the gear's Whereabouts reads home
again. **No `goto` stands in for a control** — every hop has a door, which is
what F13 and F14 are for, and a `goto` that stands in for a control nobody can
reach is a product defect wearing a test's clothes.

`depot.spec.ts` carries `@production`, and nothing in this leg mints an
Invite, proves joining, or signs the run's Device out, so the leg is
`@production`-safe.

---

## 6. Doc amendments

| Doc | Change |
| --- | --- |
| `architecture-design.md` §8.5 | **Remove the `Outcome ｜ S10` row** (F17). Story 13 completes at **S9b**, touched by four slices — S3, S4, S7, S9 — not five. The closing paragraph's *"Only `Outcome` is left, so story 13 completes at S10 as planned"* is wrong and is replaced by F17's reasoning |
| `architecture-design.md` §8.3 | S10's entry gains *landed*, its spec link, and a §12.17 pointer |
| `architecture-design.md` §12 | new §12.17, consequences of S10 |
| `sync-protocol.md` §4.4 | the reader-gate note gains its sixth instance (`consumed_count`), beside `TagString` and `bring_count` |
| `patterns.md` §1.2 | the absent-reads-X table gains `Entry / Piece outcome → open` |
| `patterns.md` §1.3 | the reader-gate list gains `consumed_count` |
| `patterns.md` §2.3 | the needless-write rule gains its **one stated exception**, `● NOW — FOUND HERE` (§4.6) |
| `technical-debt.md` | `ui/Popover`'s waiting callers go from four to **six** |
| `testing.md` | the golden path is complete; the *awaits S10* sentence goes |
| `CLAUDE.md` | S10's paragraph, and the things worth knowing before touching outcomes |

---

## 7. What S10 deliberately does not build

- **Reopen** (S11) — `ReopenConfirm`'s still-open block included, which
  §8.3 assigns to S11 and the component's own header already says so. No
  outcome can be changed after a close, because nothing in S10 can leave
  `closed`.
- **The `OUTCOME` dimension** — F17, and §3.7 above.
- **Notes review** (S12) and **Save as template** (S14), both drawn as steps of
  `User Flows` F5 and both later slices. F5 leaves the room and draws nothing.
- **`ui/Popover`** — the outcome and roster sheets are its fifth and sixth
  waiting callers and are approximated by `Sheet`'s `desktopCard`, as the other
  four are. Nothing in the bundle draws a popover, which is why that debt sits
  where it does.
- **Per-unit identity for counted gear** — the reason a re-home settles a whole
  standing rather than one unit of it (§3.5). Domain §6 refuses it deliberately.
- **A retirement path for lost gear.** `lost` is never a retirement; the Gear
  is still ours and still expected.

---

## 8. What changed during implementation

Written after the close card and the close batch shipped and were reviewed.
**Nothing above this line has been edited** — `the-gear-list.md` §11 and
`packing-and-the-journey.md` §11 set the precedent this repo follows: a dated
spec is a record of what was believed when it was written, and a sentence that
turned out wrong is listed here rather than quietly fixed where a reader would
never learn it had moved.

### 8.1 `closeTrip` on an already-closed Trip returns `[]`, not just the reduction

§4.7's own reasoning — "the reductions always emit regardless of the current
phase … that is precisely the die-mid-batch recovery path" — is **overturned**.
Review found the ordinary, no-crash case that guard gets backwards: on an
already-closed Trip, `gear.owned_count_set` is absolute, and the reduction loop
reads the Gear's **current** owned count, which after a first close has already
landed is the **reduced** count. A second call — a second tap on a still-live
card, or a stale peer's card gated on `open` alone — recomputes
`reduced − consumed` and subtracts the Consumed-count a second time, silently,
with no crash and no second Device required.

`closeTrip` now returns `[]` unconditionally once `isClosed(trip)` — before it
computes a single reduction. F5's close card gates its button and hint on the
same fact (ruling R27 Layer A: `isClosed(trip)`, never re-derived), withholding
both rather than drawing them disabled (`patterns.md` §3.7, *withheld, not
greyed*) — the summary line stays, since it remains a true fact about a closed
Trip. No board draws F5 on a closed Trip; withholding is the ruling meanwhile,
and the picture is logged as an open question for the next design round.

### 8.2 Two paths still double-reduce, and are recorded rather than patched

Closing the two doors above (the same-device double tap, and the
already-synced stale peer) does not close every path, because two narrower
ones cannot be told apart from "a reduction is still pending" using the fold
alone:

- **Crash mid-batch, then retried.** A Device dies after the reduction op is
  durably written but before the phase move lands — the fold still reads
  `unpack`, exactly as a Trip that was never closed — and a retry recomputes
  the reduction from the now-already-reduced count.
- **Close → reopen → close.** `ReopenConfirm` (shipped since S6) is an
  ordinary way to move a `closed` Trip back to `unpack`, so a second close is
  not a misuse; it recomputes from a fold the first close already reduced.

Both would need a fact the fold as specified here cannot state: whether *this
Gear's own reduction, for this Trip*, has already been applied. The one
precedented mechanism for a cross-aggregate "has this already happened"
question — a stamp comparison, `unaccountedOf`'s own shape
(`selectors/unpack.ts`) — was considered and rejected (ruling R28): it would
read as a false negative exactly when a Quartermaster corrects the owned count
*between* declaring the consumption and closing, silently skipping a reduction
that was never applied. A wrong "already reduced" belief is worse than the
narrow, rare corruption it would replace. A per-Trip-per-Gear "already
reduced" register would close this cleanly and is outside S10's op catalogue —
not built here, and not to be patched with a third, narrower mechanism later
without first weighing it against this same false-negative cost.

The crash-mid-batch window is tracked in `docs/technical-debt.md`. Close →
reopen → close's Depot semantics are S11's to design — §7 above already parks
reopen's Depot semantics with S11, and this is the same parking, named for the
specific failure it now covers rather than left implicit.

### 8.3 Tests added for both

`shared/src/gestures.test.ts` gained a **sequential** case beside the existing
"calling it twice against the same fold" one — apply the first call's own ops
to the fold, then call `closeTrip` again against the fold that produced —
which is the case that would have caught this before it shipped, since the
existing idempotence test only ever called `closeTrip` twice against one
*unchanged* fold. The two already-closed unit tests were corrected to expect
`[]` rather than a partial reduction. `shared/src/convergence.test.ts` gained
the genuinely two-replica case the gesture-level test cannot express: Device A
closes and exchanges, so Device B's own fold already reflects the reduction
and the `closed` phase before B's own (would-be) still-live card computes
`closeTrip` again. `app/src/screens/Unpack.test.tsx` gained the app-level
case the brief originally asked for, now expressible because the card
withdraws its own button the instant its tap closes the Trip: there is no
control left for a second tap to reach.

### 8.4 Gear detail's `RESOLVE` (F16(3)) emits `gear.rehomed` alone — §1.5 and §4.6 are not rewritten

§1.5 and §4.6 (and `gestures.ts`'s own docstring, before this correction)
described the settle route as a second caller of `reHomeOnTheSpot`,
re-homing gear that turned up **and** marking the claiming Entry's outcome
`back` in one action — the identical gesture F5's own row uses. Review
(ruling R30) found this wrong, on grounds the spec did not weigh:

- **The standing is a selector reading an outcome, never a stored fact**
  (`unaccountedOf`, `selectors/unpack.ts`; sync §4.5: *"`lost` emits nothing
  against the depot at all … unaccounted for is a selector reading the
  outcome"*). Ending it by rewriting the very outcome the selector reads
  fixes the thermometer, not the temperature.
- **It would edit a closed Trip's history from a Depot screen.** By the time
  a Quartermaster resolves a months-old standing, the Trip that produced it
  is very often already `closed`. Invariant 19 treats reopening — the one
  route the domain gives for changing a closed Trip's outcomes — as
  deliberate and disclosed, weighted like deleting a Trip. `RESOLVE` offers
  no reopen, no confirm, and a context line (`RESOLVING … · LAST SEEN: …`)
  that says nothing about touching Trip history — unlike F8's own re-home
  row, whose context line (`PICKING A HOME MARKS IT BACK`) discloses the
  identical write in words the board wrote for it.
- **Ruling F18 becomes unsatisfiable.** F18 draws the closed-Trip row's
  `N LOST` meta as *"attention while any is still unaccounted, muted once
  all are re-homed — the number is history, the colour is the standing."*
  That sentence requires a re-home to leave the `lost` outcome itself
  standing; flipping it to `back` drops the count to zero and the segment
  disappears outright, which is a different ruling from the same round
  reading the same fact two ways.
- **It cannot pick the right Entry (Critical 2/ruling R31).** Nothing about
  `Unaccounted.tripId` names *which* Entry to edit when two Entries share a
  Gear on that Trip (one `consumed`, one `lost`) — a lookup keyed on the
  depot source alone ties an arbitrary tie-break, and can overwrite the
  wrong Entry's outcome. `unaccountedOf` itself is also not scoped to one
  Entry: it accumulates across every live `lost` outcome for a Gear and
  names only the **latest** Trip, so a route that edits "the" Entry's
  outcome cannot even be correct in principle when two Trips both hold one.

`RESOLVE`'s `onSelect` now emits `gear.rehomed` alone. This is the whole of
the truthful record: `outcomeStands` (`selectors/unpack.ts`) already compares
the residence write's stamp against the `lost` outcome's, so the standing
clears the moment a later `gear.rehomed` lands, naming any home, unchanged
values included (`patterns.md` §2.3's one stated exception). No Entry's
`outcome` register is read or written by this route. `reHomeOnTheSpot` keeps
its one caller, F5's own row, and its unconditional-`gear.rehomed` rule is
unchanged and still correct there — see the corrected docstring in
`shared/src/gestures.ts` for why F5 needs it independently of anything F16
does. §1.5 and §4.6 above are left as written, per this spec's own §8 rule:
what changed is recorded here, not edited back into the sections it
corrects.
