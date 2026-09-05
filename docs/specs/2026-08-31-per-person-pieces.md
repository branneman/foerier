# S8 — Per-person Pieces

The implementation design for [architecture §8.3](../architecture-design.md#83-the-slices)'s
**S8**: two op types, the Piece as a folded entity, and the first tombstone in
this codebase whose **restore** a Quartermaster can actually reach. It delivers
story **8**, and advances no other story — see
[§3.5](#35-story-13-gains-nothing-and-the-ladder-loses-a-rung).

This is a **feature spec**: it is retired once the slice has shipped. It settles
what the durable docs left to the implementer and records the decisions taken
before any code was written. It does **not** revisit anything above it — the op
envelope, the HLC, per-field LWW, the op catalogue and the evolution rules are
settled in [`sync-protocol.md`](../sync-protocol.md), and every ambiguity here is
resolved by reading that document, not this one.

**This spec was written before any code, and then a design round ruled on it.**
The first draft took **nine** decisions no board had reached; the round drew all
nine — `Screens B` **§02D**, `docs/design/README.md` **§5d** — blessing seven
with measurements, **redrawing two** and **overturning one outright**. What
follows is the second draft, written against those rulings.
[§6](#6-what-the-design-round-ruled) records what moved, so the reasoning is not
lost with the draft that carried it. **The boards are the authority**; where this
document and §5d disagree, §5d wins and this document is wrong.

The one overturned decision removes work rather than adding it: the
`PIECES BY PERSON · S8` slice-bar rung was **a drafting artefact, not a
decision**, and retires. S8 therefore touches the slicing engine not at all.

**S8 writes into the map S7 declared.** `EntryState` already reserves `pieces`
as *"S8's"*, `pieceCountOf` already carries the words *"until S8 tombstones
some"*, and `claim.ts`'s `Claim.personIds` already says *"Pieces are exactly
Participants until S8"*. This slice is what makes those three sentences false,
and it is obliged to delete them rather than leave them standing.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types | **2** — `trip.piece_removed`, `trip.piece_restored`, payload `{entry_id, person_id}` |
| Endpoints · migration | **None.** A domain slice adds neither ([§8.3](../architecture-design.md#83-the-slices)) |
| Registers on a Piece | **One — `removed`.** `status` · `residence` · `outcome` are §3.7's other three and arrive with the slice that writes them ([§2](#2-state-shape)) |
| How a Piece exists | **Derived**: the Trip's Participants minus the tombstoned. `trip.entry_added` enumerates nothing ([§1.2](#12-a-piece-is-derived-never-enumerated)) |
| A late Participant | Gets a Piece **with no backfill op** — the property the derivation exists to buy ([§1.2](#12-a-piece-is-derived-never-enumerated)) |
| A tombstone vs. its Participant | The tombstone **outlives** a Participant removal and re-add. A tombstone never cascades ([§1.3](#13-a-tombstone-outlives-its-participant-and-never-cascades)) |
| A tombstone for a non-Participant | **Inert, not an error.** Invariant 10 falls out of the derivation ([§1.4](#14-a-tombstone-for-a-non-participant-is-inert)) |
| The one derivation | `shared/src/selectors/piece.ts` — `pieceInclusion` is the primitive, `piecesOf` filters it ([§3.1](#31-the-one-derivation-and-its-two-readings)) |
| Per-person claims | Read **Pieces**, not Participants. Removing a Piece releases that Person's claim ([§3.3](#33-per-person-claims-stop-being-participants)) |
| An Entry with no included Pieces | **Holds no claim, and is never a settle target** ([§3.4](#34-an-entry-with-no-included-pieces-holds-no-claim)) |
| The slicing engine | **Untouched.** Ruling **H** retires the `PIECES BY PERSON · S8` rung as a drafting artefact ([§3.5](#35-story-13-gains-nothing-and-the-ladder-loses-a-rung)) |
| Circles: paint | 24px, all bordered; **dashed + dim = excluded**. Drawn in **both** row modes, **24px even at TABLE-44** — ruling **A** |
| Circles: control | **Never individual targets.** The cluster **and `×N` together** are one control; `::after` grows to the row's 48 — ruling **B** ([§4.2](#42-the-cluster-and-n-are-one-control)) |
| Cluster overflow | **Four painted slots.** ≤4 whole; from 5, three circles + `+N`; **dashed sort first**. One rule for all four cluster surfaces — ruling **E** ([§4.8](#48-cluster-overflow-four-painted-slots-exceptions-first)) |
| The Piece picker | Title = **the gear name**; mono fact `WHO BRINGS ONE · 2 OF 3`; rows `● Mark · BRINGS ONE ✓`; **one op per tap**; **no all/none** — ruling **C** ([§4.3](#43-the-piece-picker)) |
| Empty roster | **No circles, no picker, no control.** The row reads `NO PARTICIPANTS` + `×0` — ruling **C** |
| `×0` | **Stands, silently.** The all-dashed cluster *is* the statement — ruling **D** ([§4.5](#45-an-entry-nobody-is-bringing)) |
| Confirm | **None** on either op — the tag-chip rule: one op, reversed by the other ([§4.4](#44-no-confirm-in-either-direction)) |
| Over-claim band | Piece-level settle routes; the row fact names the other Trip **always** — ruling **F** ([§4.6](#46-the-over-claim-bands-per-person-row)) |
| The Remove-elsewhere confirm | Piece variant, copy **redrawn** to state the op rather than the actor's intent — ruling **G** ([§4.7](#47-the-remove-elsewhere-confirms-piece-variant)) |
| `ui/PersonCircle` | **Built**, five hand-rolled copies fold in; the prop is a **`tone`**, not a semantic state ([§4.9](#49-uipersoncircle-and-the-five-copies-that-fold-in)) |
| Find's per-person card | **Held to S9**; the board is restaged `S8 · PIECES` → `S9` — ruling **I** ([§6](#6-what-the-design-round-ruled)) |
| Two unbuilt primitives it leans on | `ui/Popover` and the keyboard surface. Both **named, neither built** ([§8](#8-what-s8-deliberately-does-not-build)) |
| Fixture | `shared/fixtures/s8-pieces.ops.json` + `shared/src/fixtures.s8.test.ts`, same commit ([§5.4](#54-the-fixture-rule)) |

---

## 1. Two ops, and what they close

| Type | Payload | Effect on folded state |
| --- | --- | --- |
| `trip.piece_removed` | `{entry_id, person_id}` | Tombstone on that Participant's Piece. *This is* "that Person isn't bringing one" (invariant 10) |
| `trip.piece_restored` | `{entry_id, person_id}` | Clears it if strictly later |

Both are frozen by [sync §4.4](../sync-protocol.md) and neither is negotiable
here. The aggregate is `trip`; `aggregate_id` is the Trip id, and `entry_id`
is a payload field, exactly as the three S7 gear-list ops have it.

They are an **ordinary LWW pair on one register** ([sync §3.5](../sync-protocol.md)):
*"`gear.retired` / `gear.restored` and `trip.piece_removed` / `trip.piece_restored`
are ordinary LWW pairs on one register."* Delete does not win by being a
delete; a restore wins only by being strictly later. There is no second rule.

### 1.1 The register map is the contract

[sync §3.7](../sync-protocol.md) states the row this slice fills:

```
entries.<entry_id>.pieces.<person_id>    status, residence, outcome, removed
```

S8 declares **`removed` alone**. `status` and `residence` are S9's
(`trip.piece_status_set`, `trip.piece_moved`); `outcome` is S10's
(`trip.outcome_set` with a `person_id`). This is `EntryState`'s own standing
rule, restated one level deeper: *"A register nobody writes is a field every
reader must have an opinion about, so each arrives with the slice that writes
it."*

The wire is `snake_case` and the fold is camelCase, as everywhere: payload key
`person_id`, map key `person_id`'s **value** (a Person id is an opaque string
either way), register `removed`.

### 1.2 A Piece is derived, never enumerated

[sync §4.4](../sync-protocol.md) is explicit, and it is the load-bearing
sentence of this slice:

> Adding per-person gear yields one Piece per Participant as a **starting
> default**, so `trip.entry_added` does not enumerate them — Pieces are derived
> from the trip's participants, minus those explicitly tombstoned. That keeps
> "add a participant later and they get a Piece" true without a backfill op.

Three things follow, and each is a place a future call site would drift:

1. **There is no `piece_added`.** A Piece comes into existence because a Person
   is a Participant, and it is the Trip's roster that is authored, not the
   Piece. The catalogue's omission is deliberate.
2. **A Participant added on day four gets a Piece on every per-person Entry
   already on the list**, retroactively and with no write. This is why
   `participants` had to be a per-person-id **map** rather than one register
   holding an array — `reduce.ts`'s `tripParticipantWritten` already says so in
   as many words, and this slice is the caller it was anticipating.
3. **A Participant *removed* loses every Piece**, on every Entry, with no
   write — for the same reason, running the other way.

Ruling C is this fact made visible at the extreme: a per-person Entry on a Trip
with **no** Participants draws no circles and mounts no picker, and its mono
line reads `NO PARTICIPANTS` — *"a domain fact (Pieces derive from
Participants)"*, not an empty state.

### 1.3 A tombstone outlives its Participant, and never cascades

The sequence that has to be got right, because it is reachable in ordinary use
and both plausible answers are defensible until the protocol is consulted:

```
1. trip.piece_removed{entry: headlamp, person: kim}   Kim isn't bringing hers
2. trip.participant_removed{person: kim}              Kim drops off the trip
3. trip.participant_added{person: kim}                Kim is back on
```

After step 3, **Kim's Piece is still tombstoned.** The `removed` register was
written at step 1 and nothing since has addressed it; steps 2 and 3 address a
different register on a different entity path.

This is not a defect to be papered over. [sync §3.5](../sync-protocol.md) is
categorical — *"A tombstone never cascades"* — and clearing the Piece tombstone
on re-add would be exactly that: one op reaching across an entity boundary to
unwrite a register a Quartermaster deliberately wrote. It would also be
unmergeable, since the clearing write has no clock of its own to lose on.

The domain reading agrees. "Kim is on the trip" and "Kim is bringing her own
headlamp" are two facts, and re-asserting the first was never a statement about
the second. If the intent is that Kim now brings one, that intent is a
`trip.piece_restored` — one tap in the picker on the row that is drawn dashed
precisely so the question is visible.

### 1.4 A tombstone for a non-Participant is inert

The mirror case: a `trip.piece_removed` naming a Person who is not (or is no
longer) a Participant folds normally and **shows nowhere**, because
[§3.1](#31-the-one-derivation-and-its-two-readings)'s derivation starts from
Participants and subtracts. There is no reducer gate, no rejection, and no
error state.

That is how **invariant 10** — *"a per-person entry's pieces are at most one per
participant; each piece belongs to exactly one participant"* — is honoured:
it falls out of the derivation rather than being enforced against the log. The
same shape as invariant 6, whose gate lives in `bringCountOf` and not in the
reducer, and for the same underlying reason: gating in the reducer would make
the fold order-dependent on whether the participant op had arrived first.

It is reachable without malice — two Devices, one removing Kim's Piece while
the other removes Kim from the Trip — so it is the ordinary case, not the
exceptional one.

---

## 2. State shape

```ts
/**
 * One Participant's copy of a per-person Entry.
 *
 * S8 declares one of §3.7's four registers. `status` and `residence` are
 * S9's; `outcome` is S10's.
 */
export interface PieceState {
  /** The Person id. The map key and this field are the same value. */
  readonly id: string
  /** Tombstone. `trip.piece_restored` clears it, if strictly later. */
  readonly removed?: Register<boolean>
}
```

and on `EntryState`:

```ts
  /**
   * Per-Person entities, keyed by Person id — a map of **entities**, like
   * `entries` and unlike `participants`, whose members carry only presence.
   *
   * A key here is a Piece that some op has *addressed*, which is a different
   * fact from a Piece **existing**: existence is the Trip's Participants
   * minus these tombstones, and `selectors/piece.ts` is the only place that
   * says so.
   */
  readonly pieces?: Readonly<Record<string, PieceState>>
```

`writePiece` nests inside `writeEntry` exactly as `writeEntry` nests inside
`writeTrip` — the third level of the same pattern, with the same
identity-propagation guard, so a losing write returns the identical
`HouseholdState` and does not invalidate `slice.ts`'s existing `WeakMap` memo:

```ts
function writePiece(
  state: HouseholdState,
  tripId: string,
  entryId: string,
  personId: string,
  stamp: Stamp,
  update: (piece: PieceState, stamp: Stamp) => PieceState,
): HouseholdState {
  return writeEntry(state, tripId, entryId, stamp, (entry, st) => {
    const existing = entry.pieces?.[personId]
    const current = existing ?? { id: personId }
    const updated = update(current, st)
    if (updated === current && existing !== undefined) return entry
    return { ...entry, pieces: { ...entry.pieces, [personId]: updated } }
  })
}
```

**A piece op creates the Entry, and the Trip, on sight.** That is `writeEntry`'s
existing behaviour and it is inherited, not re-decided: a `trip.piece_removed`
overtaking its own `trip.entry_added` leaves a **sourceless Entry carrying a
Piece tombstone** — folded, retained, excluded from every list by `entriesOf`,
holding no claim, and drawn nowhere. The moment the `trip.entry_added` lands the
Entry appears with the tombstone already correct. No special case, and one more
instance of the rule `entriesOf` already states.

Authoring gains two builders beside the three S7 ones:

```ts
tripPieceRemoved(tripId: string, entryId: string, personId: string): OpSpec
tripPieceRestored(tripId: string, entryId: string, personId: string): OpSpec
```

---

## 3. Selectors

### 3.1 The one derivation, and its two readings

A new file beside `entry.ts` and `claim.ts`, for the same reason those two
exist: a fact several surfaces must agree on, computed once.

```ts
/** Every Participant, and whether their Piece is included. */
export function pieceInclusion(
  entry: EntryState,
  trip: TripState,
): readonly { readonly personId: string; readonly included: boolean }[]

/** The Participants whose Piece is included — the count and the claim. */
export function piecesOf(entry: EntryState, trip: TripState): readonly string[]
```

`pieceInclusion` is the primitive and `piecesOf` filters it, so the derivation
is written exactly once. It starts from `participantIds(trip)` — already
id-sorted, total, and replica-identical — and marks each Person excluded when
`entry.pieces?.[personId]?.removed?.value === true`.

**Order here is by id, and it is not the drawn order.** That is
`participantIds`' own settled rule (*"the display order is by Person label
instead"*), and ruling **E** adds a second reordering on top of it — dashed
first. Both live at the cluster, not here; see
[§4.8](#48-cluster-overflow-four-painted-slots-exceptions-first).

**This is the only place the derivation is stated**, and the file says so in its
header — `ownerOf`'s rule and `phaseOf`'s rule for a third time, with the same
symptom when it drifts: a row whose `×N` disagrees with the circles beside it.

`piecesOf` deliberately takes no `state`. Unlike `entryKind` or `bringCountOf`
it asks nothing of another aggregate — a Piece is a fact about the Trip and the
Entry alone. It needs no memo either: it is O(participants) per Entry, where the
S7 dimension it superficially resembles was O(gear × entries) per render.

### 3.2 `pieceCountOf` and the totals

One line changes:

```ts
    case 'per_person':
      return piecesOf(entry, trip).length      // was participantIds(trip).length
```

and its docstring's *"Per-person is Participants and **all** of it until S8
tombstones some Pieces"* is deleted rather than amended — the sentence exists to
be false after this slice.

`listTotals` follows for free, because `pieces` and `perPerson` both sum
`pieceCountOf`. So the builder footer's `35 ENTRIES · 59 PIECES · 18 PER-PERSON`,
the `GEAR LIST` band's `N ENTRIES · N PIECES` and each group header's
`N PIECE(S)` all fall the moment a Piece comes off, from one edit.

`entries` does **not** fall, and ruling D confirms that is correct: *"`N ENTRIES`
counting a `×0` Entry is correct — ENTRIES counts the list, PIECES counts what
travels."*

### 3.3 Per-person claims stop being Participants

`claimFor`'s per-person branch:

```ts
  const personIds = piecesOf(entry, trip)     // was participantIds(trip)
  return { tripId: trip.id, entryId: entry.id, count: personIds.length, personIds }
```

and `Claim.personIds`' docstring loses *"is the full Participant set of the
claiming Trip — Pieces are exactly Participants until S8 tombstones some"*.

`supplyAndClaimed`'s per-person branch needs **no change at all**, which is the
test that S7 put the rule in the right place: it compares People rather than
counts, so narrowing the set of People a claim names narrows the conflict
without touching the arithmetic. `contestedPersonIds` becomes exactly "the
People whose Piece is claimed twice", which is what it always meant and could
not previously be.

The consequence a Quartermaster sees: **removing a Piece releases that Person's
claim.** Domain §5.2's third sentence — *"supply is one per person, so a given
participant's piece of that gear may be claimed by at most one active trip"* —
becomes settleable at the granularity it is stated in, which is what
[§4.6](#46-the-over-claim-bands-per-person-row) is about.

### 3.4 An Entry with no included Pieces holds no claim

A per-person Entry every one of whose Pieces has been removed is reachable in
one sitting and legal — invariant 11 says the *right* expression of "nobody is
bringing it" is removing the Entry, but nothing forbids the state, and
discarding a recorded write to prevent it is exactly what
[sync §3.6](../sync-protocol.md) rules out.

`claimsByGear` **skips it**: a claim naming nobody is not a claim. Without the
skip it would push a `{count: 0, personIds: []}` claim which changes neither
`supply` nor `claimed`, so it would raise no false conflict — but it would sit
in `OverClaim.claims`, where `ConflictRow`'s `hereClaims(overClaim, tripId)[0]`
would find it and draw a settle route against an Entry that is not part of the
problem. This is `entriesOf`'s own rule extended one step: *a claim the reader
cannot see is a claim they cannot settle*, and a claim on nobody is one nobody
can act on.

### 3.5 Story 13 gains nothing, and the ladder loses a rung

The first draft of this spec added a sixth dimension to `slice.ts`,
`PIECES BY PERSON`, reading the `Components` §04 ladder's dashed
`PIECES BY PERSON · S8` rung the way `TRIP · S7` had been read a slice earlier.

**Ruling H overturned it, and the rung retires.** The argument is not about
cost, it is that the rung contradicts a standing rule:

> **The Depot never shows packing or piece state; Pieces exist only in trip
> contexts** — the two-worlds rule.

Story 13's criterion list never names it (its seven are Tag, Person, Ownership,
Kind, Packing status, Container and Trip membership, all of which land at
S3/S4/S7/S9), no board draws it in use, and everything it would have answered is
owned elsewhere: `PERSON` (S4) answers *"Els's gear"*, `TRIP` (S7) answers
membership, `STATUS` (S9) answers pack state **on the trip side**.

So **S8 touches `slice.ts` not at all** — no dimension row, no second `WeakMap`
index, no chip label, no value picker, and no `EXCLUDED_DIMENSIONS` entry in
`DepotPicker`. This is the one ruling that made the slice smaller, and it is
worth stating why it was reachable at all: a dashed chip carrying a slice number
looks exactly like a decision, and the ladder had one rung that was a drafting
artefact. The generalisation, for the next reader of that ladder:
**a slice number on a board is a claim that has to survive the standing rules,
not a licence that overrides them.**

[§7](#7-doc-amendments) carries the consequences for
[§8.5](../architecture-design.md#85-where-story-13-attaches), whose table row
and slice count both move.

---

## 4. Screens

### 4.1 Where circles appear, and in which mode

`Screens A` §03 fixes the paint: **24px, all bordered; dashed border + dim =
excluded.** At S8 circles mean **inclusion, not status** — the sage/amber fills
are S9's, on the Pack-out screen, at 34px in rows and 28px in group headers.

`EntryRow`'s per-person trailing slot draws the cluster **and** `×N`, in
**both** modes. Ruling **A**, with its measurements:

| | Trailing content, per-person row |
| --- | --- |
| `editable` (phone `/trips/:id`, the builder's right pane), 48px row | cluster + `×N`, **one control** ([§4.2](#42-the-cluster-and-n-are-one-control)) |
| `!editable` (the trip screen at Split and up), 44px row | cluster + `×N`, inert |

- **24px holds at TABLE-44** — *"display needs no target's air"*.
- **No extra dimming in the read pane.** *"Dim already means excluded, and one
  encoding never carries two meanings."* The read-only cluster is
  pixel-identical to the editable one.
- **`×N` stays** — PIECES is the trip arithmetic.
- **02C's trailing-column ruling is amended, not broken**: `×N` for Counted,
  **circles + `×N` for per-person**, `—` for Single (and for trip-only, and for
  the `—` group).

The first draft argued for this from 02C's own reasoning — the circles are
**who**, not a quantity, and the `TRIP-ONLY` badge already renders in both modes
as a name adjunct. The round blessed the argument and supplied the numbers.

### 4.2 The cluster and `×N` are one control

**This was the round's most consequential question**, and the answer is precise:
**circles are never individual targets.**

Ruling **B** closes every alternative, and the reasoning is worth carrying here
because a future reader will re-propose one of them:

- 44px hit areas on 32px centres is **ruling O's own counter-example** — a tap
  meant for Els lands on Mark and removes the wrong Person's Piece.
- Clamped so they cannot overlap, targets reach only **~32px**, under the 44
  floor.
- Spacing until each clears 44 costs **~132px** of a 393 row that already
  carries a name, a count and a `✕`.
- Circle-targets-at-desktop-only is **two mechanisms for one act**, with
  keyboard users assigned one by viewport.
- Expanding the row in place **changes list height under the thumb mid-scroll**.

So the **cluster and `×N` together** are one control opening the Piece picker —
`ParticipantPicker`'s settled idiom, *rows not circles*. It grows the standing
clamped `::after` to the row's **48**, which is ruling O applied once instead of
N times.

- **Accessible name: `Who brings one — Headlamp, 2 of 3 bring one`.** The
  circles inside stay `aria-hidden`; the control's name carries the whole fact,
  because *"the initials are a single piece of information"* (`TripCard`).
- **`P` opens it at the keyboard** — assigned by the ruling, **not built by this
  slice**. See [§8](#8-what-s8-deliberately-does-not-build).
- **In the read-only mode the cluster is not a control at all** — a plain
  `<span>`, no button, no hit extension, nothing for ruling O to floor. The same
  distinction `EntryRow` already draws for the Bring-count: `Stepper` in
  `editable`, plain `×N` above Split.
- **With no Participants there is no control**, because there is no cluster —
  [§4.1](#41-where-circles-appear-and-in-which-mode)'s empty case.

### 4.3 The Piece picker

Ruling **C**, drawn on the board. It takes **§01B's surfaces**: a **sheet below
Split**, a **popover anchored to the cluster from Split up**.

```
Headlamp
WHO BRINGS ONE · 2 OF 3

  ●  Mark                              BRINGS ONE ✓
  ●  Els                               BRINGS ONE ✓
  ○  Kim

TAP TOGGLES — ONE OP PER TAP, REVERSED BY ITS OPPOSITE · NOTHING COMMITS AT CLOSE

                                              Close
```

- **The title is the gear name**, and the mono fact `WHO BRINGS ONE · 2 OF 3`
  sits beneath it. My straw man had asked a question (`Headlamp — who brings
  one?`) and the round redrew it: **the ledger states, it does not ask.**
- **Rows are circle + name + `BRINGS ONE ✓`** — the `IN LIST ✓` /
  `PARTICIPANT ✓` grammar. The circle carries the encoding and mirrors the row's
  state; the mono mark carries the word. Both, deliberately: not redundant, the
  two channels say the same thing to different readers.
- **Tap toggles, one op per tap** — the tag-chip rule. *"Commit-on-close is the
  two-commit model the trip screen already deleted."*
- **No all/none affordance at S8.** *"A roster is a handful of rows, and S9's
  long-press is a status gesture, not this one."*
- **Empty roster: no picker ever mounts.** No Participants, no cluster, no
  control; the row itself reads `NO PARTICIPANTS` + `×0`, and *"the fix, the `+`
  ghost, is one scroll up on the same screen."*

**`ui/Popover` does not exist**, and `Sheet`'s `desktopCard` is the standing
approximation for exactly this surface (§4a's desktop tag picker has been
waiting on it since S3). The Piece picker inherits that approximation and the
debt entry gains a second waiting caller — [§7](#7-doc-amendments).

### 4.4 No confirm, in either direction

Neither op confirms. This is the tag-chip rule verbatim — *"Removing a tag
confirms nothing — it is one op, instantly reversible by re-applying"* — and it
is stronger here than it was for tags, because the reversal is a **catalogued
op with a UI**, not merely a re-application.

That makes `trip.piece_restored` the **first restore in this codebase a
Quartermaster can actually reach**. `gear.restored` has been protocol-present
and UI-deferred since S2 (story 19 is Later), and `trip.entry_removed` has no
restore at all. The dashed circle is the restore's affordance: it states that
something was decided, and one tap undecides it.

### 4.5 An Entry nobody is bringing

Ruling **D**, blessing the first draft's assumption and supplying the argument:

> The write is honest and one tap from undone; the all-dashed cluster + `×0`
> **is** the statement, so no quiet line and no offer to remove — an offer would
> gate a reversible op (the tag-chip rule) and a nag would editorialize a state
> the Quartermaster chose.

Invariant 11's right expression of "nobody is bringing it" stays where it always
was: **the `✕` at the row's edge**. And the two ways to reach `×0` draw
differently, which is the point — all-dashed circles means three people each
declined; `NO PARTICIPANTS` means there is nobody to decline.

### 4.6 The over-claim band's per-person row

Before S8 a per-person conflict row offered `REMOVE HERE` and one
`REMOVE ON <trip>` per other claiming Trip, because `canBringFewer` gates on
`kind === 'counted'` and everything else falls to the removal branch. That was
the finest cut available while a Piece was not expressible.

**After S8 both of those routes destroy an uncontested claim.** The case:
Headlamp is per-person; **Alps** (pack-out, Mark + Els) and **Vosges** (on trip,
Mark + Kim) both list it. `claimsByPerson` is `Mark: 2, Els: 1, Kim: 1`, so
`contestedPersonIds` is `[Mark]` and Mark is the entire conflict; Els's and
Kim's claims are each held once and are legitimate, which domain §5.2 permits by
name. `REMOVE HERE` costs Els her headlamp; `REMOVE ON VOSGES` costs Kim hers.
Ruling I makes the band **the only surface that settles**, so the app would
offer, on its one settle surface, two controls that both do collateral damage
and none that is correct.

Ruling **F**, drawn:

```
▲ 1 entry claims Mark more than once.

Headlamp        PER-PERSON · CONTESTED MARK · VOSGES
                [ REMOVE MARK'S PIECE HERE ]  [ REMOVE MARK'S PIECE ON VOSGES ]
```

- **The attention line keeps §5b B's grammar**, unchanged.
- **The row fact names the other Trip *always***, not only when two or more
  Trips are involved. This corrects the first draft: *"this line class counts
  claims and cannot name the trip, so the row fact must."* `nameRow` is
  therefore **forced true** for the per-person line class, rather than left to
  the caller's existing multi-Trip heuristic.
- **The noun is `PIECE`.** *"`REMOVE MARK` reads as removing the Person"*, and
  the possessive keeps the actor visible. The trip name is CSS-uppercased and
  **never truncated** (§5b G), and the unnamed sentinel composes as
  `REMOVE UNNAMED PERSON'S PIECE …`.
- **From two contested People the routes stack one wrapped row per person,
  gap 6**, so one Person's routes stay adjacent. *"A bad case is tall, which G
  already accepts."*
- **F9's fallback still applies.** When the contested Person is this Entry's
  **only** included Piece, removing the Piece and removing the Entry are the
  same act, and `REMOVE HERE` is the honest label — the same shape as
  `BRING ×0 HERE` being suppressed in favour of `REMOVE HERE`.

`SettleRoutes` grows from three callbacks to five:

```ts
  /** Emits `trip.piece_removed` against **this** Trip. */
  readonly onRemovePieceHere: (entryId: string, personId: string) => void
  /** Emits `trip.piece_removed` against a Trip this screen is not showing. */
  readonly onRemovePieceThere: (tripId: string, entryId: string, personId: string) => void
```

The interface stays **grouped all-or-nothing**, which is why `ActivationConfirm`
and `ReopenConfirm` need no change at all: they pass no `settle` — ruling I's
facts-only mode — and gain two routes they do not render.

### 4.7 The Remove-elsewhere confirm's Piece variant

`REMOVE MARK'S PIECE ON VOSGES` writes against a **different Trip's aggregate**,
and its undo is a navigation away rather than a second tap — which is
`RemoveElsewhereConfirm`'s entire stated reason for existing. So the confirm
takes an optional `personId` and retitles, rather than a second component being
written beside it.

Ruling **G** **redrew the body copy** the first draft proposed:

| | Title | Body | Primary |
| --- | --- | --- | --- |
| Entry (today) | `Remove from Vosges?` | `Headlamp comes off the Vosges gear list. The gear itself does not move.` | `Remove` |
| Piece (draft) | `Remove Mark's piece from Vosges?` | ~~`Mark isn't bringing one on Vosges.`~~ …| |
| Piece (**ruled**) | `Remove Mark's piece from Vosges?` | `Mark's piece comes off the Vosges gear list. The entry stays for everyone else; the gear itself does not move.` | `Remove piece` |

The reason is worth keeping, because it is a general rule about this app's
voice: *"the spec's `Mark isn't bringing one on Vosges` **inferred intent**; the
sheet states what the op does, exactly as the Entry variant does."* The Entry
variant's construction — *"X comes off the Y gear list. The gear itself does not
move."* — is the parallel the Piece variant now follows.

Anatomy is untouched: `variant="sheet"`, action before cancel, the mono context
line carrying the other Trip's `tripChip`, accent primary because nothing is
destroyed. The already-vanished guard gains one clause: the Piece's Person may
have left the other Trip's roster while the sheet was open, which makes the
body's subject as absent as a removed Entry does.

### 4.8 Cluster overflow: four painted slots, exceptions first

**Ruling E, and entirely the round's** — the first draft asked the question and
proposed nothing. Every board had drawn three participants; nothing in the
domain caps a roster.

- **Four painted slots, maximum.** ≤4 participants draw whole.
- **From 5: three circles + a `+N` circle** — same size, solid
  `rule/control` border, muted mono.
- **Dashed (excluded) circles sort to the front.** *"Inclusion is the default,
  exclusion is the signal, so the exception is never the circle hidden behind
  `+N`."*
- **`×N` beside the cluster is the exact count**, and the picker states
  everybody.
- **One rule for all four cluster surfaces** — the builder row, `TripCard`, the
  trip screen header and the builder header — each at its own drawn size.
- **Never shrink below the drawn size, never wrap the row, never inner-scroll.**

So the drawn order is: excluded first, then included, **each in
`tripParticipants(state, trip)` order** (by Person label, the app's one Person
ordering), truncated to three plus `+N`. That composition lives in the cluster
component, not in `piecesOf` — [§3.1](#31-the-one-derivation-and-its-two-readings).

The three display-only clusters carry no exclusion state, so for them the rule
reduces to *four slots, then `+N`* — a change they need anyway, and one they
have silently needed since S6.

### 4.9 `ui/PersonCircle`, and the five copies that fold in

[frontend-design §5](../frontend-design.md) names `PersonCircle` as an unbuilt
primitive. **Five** near-identical hand-rolled copies exist:

| Caller | Diameter | Border |
| --- | --- | --- |
| `TripCard` · `Trip` · `GearListBuilder` | 22px (`1.375rem`) | `--color-rule-control` |
| `ParticipantPicker` | 30px (`1.875rem`) | `--color-rule-control` |
| `People` | 30px | S5's login ring — accent · control · **transparent** (withdrawn) |

and `TripCard.module.css`'s own comment already points at this slice:
*"No login encoding and no fill: **fill belongs to packing**."*

S8 adds 24px and, with ruling E, a `+N` slot. That is the `GearRow`-at-S3 bar
cleared several times over, so the primitive is built and all five fold in.

**The prop is a `tone`, not a `state`.** Three slices already want the same
border to mean three different things — S5's login ring, S8's inclusion, S9's
packing fills — and a semantic `state` prop would become the union of every
slice's vocabulary, re-shaped by each. A `ui/` primitive is *"pure props-in"*:
it renders a tone and the **caller** owns the meaning, exactly as `Chip` does.

```ts
export interface PersonCircleProps {
  /**
   * What the circle contains — an initial, or `+3` for ruling E's overflow
   * slot. `undefined` draws an **empty** circle, never a placeholder letter.
   *
   * Named `label` rather than `initial` because of that second caller: the
   * overflow slot is this same circle with different content, not a variant.
   */
  readonly label?: string | undefined
  /** The drawn diameter in px. S9 adds 28 (group headers) and 34 (rows). */
  readonly size: 22 | 24 | 30
  /**
   * How the ring reads. `none` is a transparent border holding the layout —
   * S5's **withdrawal**, which is a claim about knowledge and not a third
   * colour (`design/README.md` §13).
   */
  readonly tone?: 'control' | 'accent' | 'dashed' | 'none'
}
```

The mapping is exact and adds no case: `People` passes `accent` / `control` /
`none` for its three login states; the four display clusters pass the default
`control`; the piece cluster passes `control` for an included Piece, `dashed`
for an excluded one, and `control` with a `+N` label for the overflow slot.

- **The size is a number, not a t-shirt scale.** Two diameters exist, S8 adds a
  third and S9 adds two more; a `sm|md|lg` scale would be out of sizes at S9 and
  would have to be renamed across every caller.
- **No store, no router** — §5's hard rule. It takes a label, not a Person id.
- The `aria-hidden` treatment stays with the **callers**: a cluster carries one
  `role="img"` or one control name, never per-circle labels.

This removes five duplications and gives S9 a place to add fills rather than a
sixth copy. It does **not** close technical-debt's *"Two of §5's `ui/`
composites are still in `app/`"* — `TripCard` and `WhereaboutsCard` are
unmoved, and `TripCard` still owes the lifted store read that entry names.

### 4.10 What is not touched

`slice.ts` and every dimension ([§3.5](#35-story-13-gains-nothing-and-the-ladder-loses-a-rung));
`GearListSection`'s grouping and `rowKind`; `DepotPicker`; the trip-only sheet;
`Stepper`; every S9/S10 register; `/sync` in both directions; the API workspace
entirely.

---

## 5. Tests

### 5.1 Tier 1 — unit

`shared/src/selectors/piece.test.ts`:

- Pieces are the Participants, with no op at all — the starting default.
- A Participant added **after** a per-person Entry gets a Piece, **with no
  backfill op**. §8.3 names this scenario; it is the derivation's whole point.
- A `piece_removed` excludes exactly one Person and leaves the rest.
- `piece_restored` clears it **only when strictly later** — an out-of-order
  restore loses, and the register is untouched.
- **The tombstone survives a participant removal and re-add**
  ([§1.3](#13-a-tombstone-outlives-its-participant-and-never-cascades)).
- A tombstone for a **non-Participant** is inert and shows nowhere
  ([§1.4](#14-a-tombstone-for-a-non-participant-is-inert)) — at most one Piece
  per Participant, from the derivation rather than a guard.
- A piece op arriving **before** its `trip.entry_added` folds, is retained, and
  draws nowhere; the Entry appears correct when the add lands.

`shared/src/selectors/claim.test.ts` extends:

- A per-person claim names **Pieces**, not Participants.
- Two Trips claiming one per-person Gear for **disjoint** People report
  nothing — S7's test, re-asserted with a Piece removal producing the
  disjointness rather than the roster.
- Removing the **contested** Person's Piece settles the over-claim; removing an
  uncontested Person's does not.
- An Entry with **no included Pieces holds no claim** and appears in no
  `OverClaim.claims` ([§3.4](#34-an-entry-with-no-included-pieces-holds-no-claim)).

**No `slice.test.ts` additions** — ruling H.

### 5.2 Tier 2 — convergence

Both scenarios §8.3 names, plus the one this spec adds:

- **Remove-vs-restore ordering.** The two ops delivered in both orders, on both
  replicas, converge on the later stamp — an ordinary LWW pair, and the delete
  does **not** win by being a delete.
- **A Participant added concurrently with a Piece removal**, on different
  Devices. Both writes survive (different registers on different entity paths),
  and the Piece is out.
- **Two Devices removing different Pieces of one Entry** union without meeting —
  the per-key register property, one level deeper than S3's concurrent tagging.

### 5.3 Tier 3 — component

- `EntryRow` — the cluster in both modes; `×N` tracking inclusion; the cluster
  **and `×N` together** as one control in `editable` and inert above Split; the
  `NO PARTICIPANTS` row drawing no cluster and mounting no picker; the
  accessible name's exact text.
- **Cluster overflow (ruling E)** — ≤4 whole; 5+ giving three circles plus
  `+N`; **dashed sorted to the front**, pinned against the specific regression
  of an excluded Person being the one hidden behind `+N`; and the same assertion
  against `TripCard` and both headers, since one rule governs all four.
- `PiecePicker` — one op per tap in both directions; the title being the gear
  name and the mono fact reading `WHO BRINGS ONE · 2 OF 3`; no all/none control
  present.
- `OverClaimBand` — the per-person routes; the row fact naming the other Trip
  **with only one other Trip in play** (ruling F's correction); the F9 fallback
  when the contested Person is the only Piece; two contested People stacking one
  route row each; and the facts-only mode still rendering no routes.
- `RemoveElsewhereConfirm` — the Piece variant's ruled title, body and
  `Remove piece` primary.
- `ui/PersonCircle` — the four tones, the numeric sizes, `undefined` drawing
  empty, and a `+N` label rendering in the `control` tone.

`drawnSizes.test.ts` gains the cluster control: the circles keep their drawn
24px paint at **both** 48 and 44 rows, and the **control** carries the hit
extension clamped within its row. It reads the stylesheet text, the only
technique that sees CSS under `css: false`.

### 5.4 The fixture rule

`shared/fixtures/s8-pieces.ops.json` and `shared/src/fixtures.s8.test.ts`, in
**this** commit. S4's fixture debt — two op types whose wire format §5.4 had
already frozen, pinned by nothing for a whole slice — is the reason the rule
exists, and `testing.md` already carries the general lesson.

Two probes worth including because **no screen can produce them**, though the
builders can: a `trip.piece_removed` naming a Person who is not a Participant
([§1.4](#14-a-tombstone-for-a-non-participant-is-inert)), and one whose
`entry_id` names an Entry with no `trip.entry_added` anywhere in the fixture
([§2](#2-state-shape)). Both stand in for a peer whose ops arrived out of order,
which is the ordinary case rather than the exceptional one.

### 5.5 Unchanged

No Tier 2s (no endpoint), no Tier 4, no Tier 5 addition. The golden path does
not run through a Piece until S9 packs one.

---

## 6. What the design round ruled

Nine questions went to the round (`claude-design-prompt.md`); all nine came
back as `docs/design/README.md` §5d, drawn at `Screens B` §02D. **Seven blessed
with measurements, two redrawn, one overturned.**

| | Question | Outcome |
| --- | --- | --- |
| **A** | Read-only per-person rows | **Blessed** — 24px holds at TABLE-44, no extra dimming, `×N` stays; 02C's trailing column amended |
| **B** | What replaces the circle-as-target | **Blessed, made precise** — the cluster **and `×N`** are one control at every width; `::after` to 48; `P` at the keyboard; the accessible name given verbatim |
| **C** | The picker | **Redrawn** — title is the gear name + mono fact, **not** the draft's question; `BRINGS ONE ✓` rows; no all/none; **empty roster mounts no picker** |
| **D** | `×0` | **Blessed** — stands silently; `N ENTRIES` counting it is correct |
| **E** | Cluster overflow | **Drawn from nothing** — four slots, `+N`, **dashed sort first**, one rule for all four cluster surfaces |
| **F** | The band's per-person copy | **Redrawn in one respect** — the row fact names the other Trip **always**, not only from two Trips |
| **G** | The confirm's Piece variant | **Redrawn** — state the op, not the actor's intent; primary `Remove piece` |
| **H** | The slice-bar rung | **Overturned** — a drafting artefact; the rung retires and S8 touches `slice.ts` not at all |
| **I** | Find's per-person card | **Recorded** — restaged `S8 · PIECES` → `S9` on the board |

Two lessons generalise past this slice, and both are about **where a decision
came from**:

- **H — a slice number on a board is a claim, not a licence.** The rung looked
  exactly like the `TRIP · S7` rung that had shipped a slice earlier, and the
  first draft read it the same way. What separates them is that Trip membership
  survives the two-worlds rule and Pieces-by-person does not. A drawn artefact
  still has to be checked against the standing rules.
- **G — the sheet states what the op does, never what the actor meant.**
  *"Mark isn't bringing one on Vosges"* inferred an intent; *"Mark's piece comes
  off the Vosges gear list"* states a write. The Entry variant had the
  construction right all along and the draft failed to follow it.

One correction the round made to the boards themselves is recorded here because
this slice found it: `README.md` §3a's closing sentence still enumerated the
ladder as *"four rungs — Trip S7, Pieces-by-person S8, Status/Container S9,
Outcome S10"*, an S4-era count that §5d H falsified. It now reads three and
names the retirement.

---

## 7. Doc amendments

- **`architecture-design.md` §12.14** — consequences of S8, in §12's landing
  order.
- **§8.3's S8 entry** — marked landed, pointing here and at §12.14. Its
  *"Pieces derived one-per-Participant … the per-Person packed view"* bullet is
  corrected: the packed view is S9's, and S8 delivers the Piece it needs.
- **§8.3's S9 entry** — gains **Find's per-person answer card** explicitly, as
  work S8 held back and S9 inherits, so the next implementer meets the
  obligation without having to find the restaged tag and work out why. Named
  beside S9's existing "trip residence" bullet, since the card is unblocked by
  the same `'trip'` slice.
- **§8.5** — the **`Per-Person grouping of Pieces | S8` row is deleted**, not
  reworded (ruling H), and *"complete at S10, having been touched by **six**
  slices"* becomes **five** — S3, S4, S7, S9, S10. `slice.ts`'s copy of the same
  table follows.
- **`sync-protocol.md` §4.4** — no change. The catalogue was already right; this
  slice implements it.
- **`technical-debt.md`** — the `ui/Popover` entry gains a **second waiting
  caller**, the Piece picker's Split-and-up popover
  ([§4.3](#43-the-piece-picker)). Its anchor is unchanged, so the entry is
  edited rather than replaced. No entry closes.
- **Deleted, not amended** — four code comments written to be falsified by this
  slice: `pieceCountOf`'s *"until S8 tombstones some"*, `Claim.personIds`'
  *"Pieces are exactly Participants until S8"*, `EntryState`'s *"the `pieces`
  map is S8's"*, and `tripParticipantWritten`'s *"S8 derives one Piece per
  Participant"*.
- **`2026-08-29-the-gear-list.md` stays exactly as written.** Its §3.3,
  "Per-person claims are Participants until S8 subtracts", is now false — and a
  dated spec is left as it was and corrected in its own trailing section, never
  edited back into the sections it corrects. That is the precedent
  `trips-and-phases.md` §10 set and the gear list's own §11 and §12 follow. What
  S8 changed goes in that document's §12, one line.

---

## 8. What S8 deliberately does not build

- **Packing status per Piece.** `trip.piece_status_set` is S9's, and story 8's
  third criterion — *"I can see, per Person, whether their Piece is packed"* —
  is jointly delivered: S8 makes the Piece exist, S9 makes it packed. §8.3's
  "the per-Person packed view" bullet describes the pair, not this slice.
- **The Pack-out screen's `PERSON` view.** `Screens A` §01 draws it, with person
  group headers counting status (`14/20 · 6 LEFT`) — arithmetic that has nothing
  to count until S9. It is F4's, and F4 is S9's.
- **Find's per-person answer card** — ruling I; the board is restaged to `S9`.
- **Any slicing dimension** — ruling H.
- **`ui/Popover`.** Ruling C puts the picker in a popover from Split up, and the
  primitive is unbuilt. S8 uses `Sheet`'s `desktopCard`, the standing
  approximation §4a's tag picker has used since S3, and adds itself to that debt
  entry rather than building the primitive on a slice that has no other need of
  it. **The ruled design is not compromised** — it is approximated in the one
  documented way, in company.
- **The keyboard surface, including ruling B's `P`.** `DepotPicker.tsx:157`
  already ruled that `↑↓ ROW · ENTER ADD/REMOVE · T TRIP-ONLY`, `/` and `P` ship
  whole or not at all, and that *"a future slice that builds the keyboard
  surface reintroduces the branch then, not before"*. Ruling B now **assigns
  `P` a destination** — it opens the Piece picker — which is a fact worth having
  recorded before the surface is built, and still not a reason to ship one key
  ahead of its siblings.
- **A `piece_added` op.** There is none in the catalogue and there must not be:
  a Piece exists because a Person is a Participant
  ([§1.2](#12-a-piece-is-derived-never-enumerated)).
- **Spare or extra Pieces.** `user-stories.md`'s third open question parks it
  explicitly — *"Niche and possibly hypothetical — parked, not built"* — with a
  Trip-only Entry as the MVP escape hatch.
- **Any change to `/sync`, the API workspace, or the schema.**

## 9. What changed during implementation

§§1–8 record the design that was taken, and are left as they were
written — the precedent [`trips-and-phases.md`](2026-08-29-trips-and-phases.md)
§10 and [`the-gear-list.md`](2026-08-29-the-gear-list.md) §11/§12 set. Six
things below either turned out different from what §§4.3 and 4.9 describe, or
are decisions the implementation took that no board had reached. All six are
recorded here rather than back into the sections they correct; two are flagged
for the next design round.

**§4.9 — the copy count was six, not five.** The table names `TripCard` ·
`Trip` · `GearListBuilder`, `ParticipantPicker` and `People` — five callers
across three rows. `app/src/screens/NewTrip.tsx`'s Participants picker is a
sixth near-identical hand-rolled circle that the table missed, and it folds
into `ui/PersonCircle` along with the rest. Two further one-line initial
expressions stand at `app/src/App.tsx:177` and
`app/src/screens/Account.tsx:331` — the signed-in-user avatar, with its own
sizing and its own rules, not a roster circle — and were left out of scope
deliberately, not missed.

**[design] §4.9/ruling E — `NewTrip` is a fifth cluster surface ruling E does
not enumerate.** Ruling E names "one rule for all four cluster surfaces": the
builder row, `TripCard`, the trip screen header and the builder header
(`docs/design/README.md` §5d E). `NewTrip`'s Participants picker is the same
shape with the same overflow failure past four people, and it was folded into
`PersonCluster` under that same rule regardless — the ruling's own stated
intent, "one rule for all cluster surfaces", covers it in spirit even though
the enumeration does not name it. The omission is because the brief the
ruling was drawn against undercounted the circles by exactly the one this
section corrects. Flagged for the next design round to fold `NewTrip` into
ruling E's list explicitly.

**[design] §4.3 — the Piece picker's rows draw 30px circles, not the boards'
24px.** `Screens A` §03 fixes 24px for the *read pane* — the display
clusters, at TABLE-44 density. The Piece picker is a picker, not a display
cluster, and its structural sibling `ParticipantPicker` already draws 30px
rows on its own stated reason: a picker row's height sets its circle's size,
not the read pane's. Ruling C names no picker-row circle size at all, so
30px is the sibling's precedent applied rather than a number the round chose.
Flagged for the next design round to state a picker-row circle size
explicitly, the way §4.1 states the read pane's.

**A cluster inside an already-labelled control is wrapped in an
`aria-hidden` span carrying `display: contents`.** `NewTrip`'s Participants
button and the gear-list row's cluster-and-`×N` control both name the whole
fact in their own accessible name (`Participants: Els, Mies` and `Who brings
one — Headlamp, 2 of 3 bring one`), so the `PersonCluster` nested inside each
would otherwise add a redundant `role="img"` name to the same accessible
description. An `aria-hidden` ancestor removes the whole subtree from the
accessibility tree regardless of a descendant's own role, which suppresses
that without widening `PersonCluster`'s props to take a "don't announce
yourself" flag; `display: contents` generates no box of its own, so wrapping
introduces no layout shift. This is now the established pattern at two call
sites (`app/src/screens/NewTrip.tsx`, `app/src/components/EntryRow.tsx`) and
should be reached for again rather than re-solved, the next time a labelled
control needs a `PersonCluster` inside it.

**§4.6/ruling F — the F9 fallback was applied symmetrically, to
`REMOVE ON <trip>` as well as `HERE`.** Ruling F's drawn example and its
text name the fallback only for the `HERE` side: when the contested Person is
an Entry's only included Piece, `REMOVE HERE` replaces the Piece route
because removing the Piece and removing the Entry are the same act.
`OverClaimBand.tsx`'s implementation applies the identical reasoning to the
other Trip's side — whichever Entry holds the contested Person as its only
included Piece gets the plain Entry route through `onRemoveHere` /
`onRemoveThere`, not a Piece-specific one — on the argument that the domain
gives no reason to treat the two sides differently. The reasoning holds and
the ruling's own drawn example is unaffected by it either way, but the two
acts are **not** literally identical: `trip.piece_removed` leaves a `×0`
Entry standing (ruling D), while `trip.entry_removed` deletes the Entry
outright. The symmetry was previously recorded only in `OverClaimBand.tsx`'s
own JSDoc; it belongs here so a design audit of ruling F sees the widening
rather than discovering it in the code.

**§4.6 — an empty `.settleRow` is reachable, and it is a new symptom of a
pre-existing simplification, not a pre-existing symptom.** `PersonSettleRoutes`
carries forward the generic branch's existing simplification of taking at
most one claim per Trip (`here?.[0]` via `ConflictRow`'s `hereClaims`, and
`firstClaimOfTrip` for each other Trip) rather than widening it. What is new
at S8 is the *symptom*: the generic branch renders `REMOVE HERE` /
`REMOVE ON <trip>` unconditionally for every contested Person, so it can
never produce a routeless row, while the per-person branch renders one
`.settleRow` per contested Person and can render one with no button in it at
all — reachable only when one Gear has two Entries on one Trip, each claiming
the same Person, with a second Trip also claiming them; constructible
offline, not through this app's own screens. The no-route outcome is
arguably safer than the generic branch's pre-existing wrong-Entry route in
the same corner, so the code stands as written. It should be read as a new
symptom of a simplification the generic branch already carried, not as a
pre-existing issue this slice merely inherited.
