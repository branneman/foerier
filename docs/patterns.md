# foerier — The pattern catalogue

The recurring shapes in the client — `shared/`'s selectors as the app consumes
them, `app/`'s screens and components, `ui/`'s primitives, and the CSS — each
stated **once**, with the rule, the reason, the canonical example, and what
drift looks like. [`frontend-design.md`](frontend-design.md) is the solution
design (what was decided and why); this is the catalogue of the shapes that
decision-making has settled into, most of which were argued one slice at a time
in [`architecture-design.md` §12](architecture-design.md#12-implementation-decisions)
and the dated specs, and were never named in one place.

Two rules for this file:

- **A pattern earns an entry by recurring.** Three sites is the bar. A shape at
  one site is a decision and belongs beside that site; at two it is a
  coincidence worth watching.
- **The entry names the pattern; it does not re-argue it.** Each entry ends
  with *Argued in*, pointing at the document or docblock that carries the
  reasoning. Where a pattern has known departures, the entry says so under
  *Departures*, and [`technical-debt.md`](technical-debt.md) points back at
  that line — pointers run index → doc, never the other way.

The test-suite conventions are **not** here; they live in
[`testing.md`](testing.md), the permanent testing doc, under Tier 3.

---

## 1. Reading the fold

### 1.1 One store per session, one hook, the whole fold

The client has one Zustand vanilla store, built **per signed-in session** by
`createSessionHousehold` (`app/src/household/wiring.ts`) and handed down through
`HouseholdProvider`. A screen or component reads it with `useHousehold(selector)`
(`app/src/household/store.ts`) and nothing else — there is no module-level store to
import. Nearly every reader takes the whole fold, `useHousehold(d => d.state)`,
and derives with `shared/` selectors inside `useMemo(…, [state])`, because the
reducer returns the **identical** object for a lost write, so the fold's
identity is the memo key (`Depot.tsx` is the worked example: `containmentView`,
`sliceDepot`, `depotCounts`, each memoised on `state`).

`AppShell` sits **outside** the provider on purpose and is fed counts and the
avatar initial as props from `App.tsx`. `useHouseholdStore()` — the nullable
variant — has one caller, `FirstSync`, which renders before a depot exists.

*Drift symptom:* a component importing a store module, or holding a second
copy of a folded fact in `useState`.
*Argued in:* `store.ts`'s header; [`architecture-design.md` §3](architecture-design.md#3-client-architecture)
and [§12.3](architecture-design.md#123-consequences-of-s2a-the-depot).

### 1.2 An absent register reads X, and only one function says so

Several registers have a default the fold does **not** write, and each default
is stated in exactly one selector, which every reader calls:

| Register | Reads | The one function |
| --- | --- | --- |
| Gear `owner` | `SHARED` | `ownerOf` — `shared/src/selectors/owner.ts` |
| Trip `phase` | `draft` | `phaseOf` — `shared/src/selectors/trip.ts` |
| Entry `status` / Piece `status` | `not_packed` | `statusOf`, `pieceStatusOf` — `packing.ts` |
| Entry `stage` | `home` | `stageOf` — `packing.ts` |
| Entry `residence` (trip) | loose | `entryResidenceOf` — `packing.ts` |
| Piece `residence` | loose, **never its Entry's** | `packing.ts` (see [§12.15](architecture-design.md#1215-consequences-of-s9a-packing-and-the-journey)) |
| Entry `bring_count` on Counted | `1` | `bringCountOf` — `entry.ts` |
| Gear `residence` (home) | loose | `residenceOf` — `containment.ts` |
| Gear `owned_count` on Counted | `1` | `ownedCountOf` — `depot.ts` |
| Entry / Piece `outcome` | open | `outcomeOf`, `pieceOutcomeOf` — `unpack.ts` |
| Entry `consumed_count` on Counted | the Entry's own Bring-count | `consumedCountOf` — `unpack.ts` |

**S10 adds three facts to this table, not two.** The `outcome` row folds two
selectors into one line, the way the `status` row above it already does for
Entry and Piece — `outcomeOf` and `pieceOutcomeOf` are `ownerOf`'s rule
again, on both entity paths. `consumedCountOf` is a third, and `unpack.ts`'s
own header says so in as many words: it reads an absent register as the
Entry's Bring-count, never `1` and never `null`, "not the two its own
constraints announced" — a reader who counted only the new row would miss
the one hiding inside it. (`unpack.ts`'s own header carries the running
count; it is not restated here.)

The fold conflates nothing — absent and explicit stay different facts about the
log — but every *reader* treats them alike, and a call site that re-derives the
rule drifts from the filter. The symptom is always the same shape: a row
labelled `SHARED` vanishing under `OWNERSHIP: SHARED`; a Trip listed in one
section drawn with another section's chip. It also shapes the edit sheets: a
draft is **seeded through the selector**, so an untouched Save on a pre-default
row authors nothing — `GearDetail`'s `openEdit` seeds `owner` through
`ownerOf` and `kind` through `kindOf`. A needless write is not cosmetic here:
it moves the stamp LWW compares, so it can beat and silently discard a genuine
concurrent write from a Device that was offline.

**A register with no default is the one place a draft must *not* be seeded
through the selector.** Gear detail's owned-count well seeds from the raw
register and `null` when there is none, so it **opens empty** exactly as Add
gear's does (`design/README.md` §3b). Seeding it with `ownedCountOf`'s
defaulted `1` would display a number Save then discarded as unchanged, making
`owned_count = 1` the one value the sheet could never record — the seed rule
inverted into a product hole. The test for which applies: seed through the
selector when the default is what the app *reads*, and from the register when
the draft is what the app will *write*.

**Two registers deliberately get no default, and they still have one
function each.** An Entry with no `source` is not a line anybody can draw a
default for, so `entriesOf` (`entry.ts`) folds it, retains it, and excludes it
from every list, count and claim. A Gear with no `kind` is the second:
`kindOf` (`kind.ts`) answers `undefined`, never `'single'` — reading it as
Single would assert a Kind nobody stated, and `claim.ts` branches on this
value, so the misread would raise an over-claim the reader cannot settle. Each
surface decides what it *draws* for "no Kind" (the KIND dimension carries no
value, the grouping files it under `—`, the COUNT group does not render); what
none of them may do is invent one. **A register with no default still wants
the one function** — `kind.ts` is also where the Counted and per-person
**gates** live, `isCounted` and `isPerPerson`, previously spelled at nineteen
sites across two workspaces.

Two of those gates take `GearState | undefined` while `kindOf` does not, which
is the second half of the rule: *is this Gear Counted* has one honest answer
for a Gear this replica has not folded — no — while *what Kind is this Gear*
is not a question you can ask of a Gear that is not there. That is what keeps
`entryKind`'s two `undefined`s distinguishable, a cross-aggregate sync race
being a different fact from a Gear that arrived without a Kind.

`ownedCount !== undefined` survives at exactly **one** `app/` site,
`OverClaimBand`'s F6 guard, which asks *did anybody record a count* before
printing `OWNED ×N` beside a conflict. Every other `×N` reads `ownedCountOf`;
until this pass two of them did not, and a Counted Gear nobody counted drew
`×1` on one surface, `×0` on a second and nothing on a third.

*Argued in:* `kind.ts`, `owner.ts` (the original), [§12.10](architecture-design.md#1210-consequences-of-s4-people-and-ownership),
[§12.11](architecture-design.md#1211-consequences-of-s6-trips-and-phases),
[§12.15](architecture-design.md#1215-consequences-of-s9a-packing-and-the-journey).

**A per-Piece register needs its own function, and the Entry-level one will
answer `false` rather than fail.** A per-person Entry carries its outcomes on
the Pieces; the Entry's own `outcome` register is fold-but-ignore there
(sync §4.4). So `rehomedSinceOutcome(entry, gear)` — which reads that
register — answers `false` for every Piece there is, quietly and forever, and
the surface asking *has this been re-homed since it was lost* silently draws
nothing. `rehomedSincePieceOutcome` is the sibling that asks the Piece, named
after `outcomeOf` / `pieceOutcomeOf`, which had the split from the start.
Before adding a caller for one of these, check which entity path actually
holds the register the question is about.

### 1.3 Reader gates, not reducer gates

Where a rule depends on a fact from a **different aggregate**, the reducer
folds unconditionally and the selector decides on the way out — gating in the
reducer would make the fold order-dependent on whether the other aggregate's
op had arrived. The instances: `TagString` is normalised at the picker and read
tolerantly; a Bring-count folds on any Entry and `bringCountOf` gates on the
Gear's Kind; `stage` and `status` both fold on a container Entry and `statusOf`
/ `stageOf` each return `null` for the other's kind; `trip.entry_moved` on a
per-person Entry is **fold-but-ignore** and `entryResidenceOf` is the gate; and
an owned-count folds on any Gear while `ownedCountOf` (`depot.ts`) gates on the
Gear's own Kind, which is invariant 6 read out rather than enforced; and a
Consumed-count folds on any Entry while `consumedCountOf` (`unpack.ts`) gates
on both the Entry's container-ness and the Gear's Kind, `bringCountOf`'s
identical argument one register over.

*Drift symptom:* a reducer branch reading `state.gear[…]` to decide whether to
write a Trip register.
*Argued in:* [`sync-protocol.md` §4.4](sync-protocol.md), [§12.13](architecture-design.md#1213-consequences-of-s7-the-gear-list).

### 1.4 One function per question; the table lookup is private

A table of enumerated values (`PHASES`, `STATUSES`, `STAGES`) is read through
**named questions** — `phaseLabel`, `phaseName`, `isKnownPhase`,
`isActivePhase`, `phaseNext`; `isKnownStatus`, `isKnownStage`, `isPacked` —
and the row lookup they share (`phaseRow`, `statusRow`, `stageRow`) is
unexported, so no call site decides for itself what a missing row means.
`isActive` (`trip.ts`) is the **only** definition of active-ness in the
codebase; `isPacked` (`packing.ts`) the only definition of packed-ness.

*Departures:* `JourneyRail.tsx` does its own `STAGES.findIndex`, and
`PieceStatusSheet.tsx` decides a third visual encoding on a `'staged'` literal
the table has no column for.
*Argued in:* `trip.ts`'s header; [§12.11](architecture-design.md#1211-consequences-of-s6-trips-and-phases).

### 1.5 The sentinel split: a glyph for columns, a sentence for prose

A missing name has two renderings and both are constants. `—` is right in a
list column, a group header or a circle; a word is right in a sentence.
`UNNAMED_PERSON_GLYPH` / `UNNAMED_PERSON` / `personNameOrUnnamed` and
`UNNAMED_TRIP_GLYPH` / `UNNAMED_TRIP` / `tripNameOrUnnamed` are the two
families, both in `shared/src/selectors/`, and each `…OrUnnamed` sits
directly beneath its label function and compares to the exported **constant**,
so a spelling change is one edit. A call site comparing a label to the literal
`'—'` re-derives the naming rule from its own result, and that is the thing
the constants exist to make unnecessary.

*Drift symptom:* a hardcoded `'—'`, `'Unnamed'` or `'this person'` in a
component.
*Argued in:* `owner.ts`; `docs/design/README.md` §5c.

### 1.6 A hypothetical selector is unscoped; the caller scopes it

`overClaimsIfActive` (`claim.ts`) answers "what would conflict if this Trip
were Active" for **every** Trip, deliberately, and every caller that gates a
decision on it — `ActivationConfirm`, `ReopenConfirm`, the builder's
`Start pack-out` — filters through `overClaimGroups`
(`app/src/components/OverClaimBand.tsx`) first. Gating on the raw result opens
a confirm naming a conflict between two other Trips entirely.

*Argued in:* [§12.13](architecture-design.md#1213-consequences-of-s7-the-gear-list).

### 1.7 A cross-aggregate dimension memoises on the fold's identity

`sliceDepot`'s Trip-membership dimension cannot be answered from a Gear's own
registers, so `slice.ts` carries a module-level `WeakMap<HouseholdState, …>` keyed
on the fold — the same identity guarantee §1.1 leans on — rather than a change
to the dimension table's signature. The prediction that the next such reader
would want the same memo and not a new mechanism held at S9b, twice:
`CONTAINER_ANCESTORS` in the same file, and `TRIP_SLICES` in `whereabouts.ts`,
which is not a dimension at all but is called once per Depot row and once per
Find match. Two rules come out of the pair. The dimension's `valuesOf` and the
grouping's `keyOf` read **one** memo, so the filter and the group can never
disagree about what contains what; and anything else the build already scans
per fold is folded into the same pass — `TRIP_SLICES` reads `overClaims(state)`
once, because reading it per row would double the cost the memo exists to
remove.

**A selector memoises its own build; a caller does not hoist it.**
`containmentView` is the third memo of this shape and the one that changed a
rule: it had eight callers building their own, six of them screens hoisting a
`useMemo` by hand, and the hoists are gone because the file that owns the
build now owns the memo. A screen defending against a selector's cost is a
sign the selector should hold the memo — the hoist is per screen, and one
screen forgetting it is a silent O(n²).

*Departures:* none. `slice.ts` still memoises the **ancestor index** beside
it, and that is not a duplicate: the view answers *who holds this* and a
dimension needs *every ancestor of this*, which is a walk per Gear per row on
top of the shared build.
*Argued in:* `slice.ts`; [§12.13](architecture-design.md#1213-consequences-of-s7-the-gear-list),
[§12.16](architecture-design.md#1216-consequences-of-s9b-whereabouts-reaches-the-depot).

### 1.8 App-side display selectors compose `shared/` answers

`app/src/household/trips.ts` and `people.ts` are the shelf for **display**
derivations that need nothing from the store or the DOM — `tripChip`,
`tripDateRange`, `packedLabel`, `sortedPeople`, `personInitial`. They compose
`shared/` selectors and formatting; they hold no rule a `shared/` selector
already states. Server timestamps render in the reader's local time through
`app/src/format.ts`, the one formatter (`app/vitest.config.ts` pins `TZ` so
the assertions mean something); register dates (`YYYY-MM-DD`) are a different
fact and go through `trips.ts`.

*Argued in:* [§12.12](architecture-design.md#1212-consequences-of-s5-in-app-invites-and-the-logins-list).

---

## 2. Writing to the log

### 2.1 One authoring path: a builder from `authoring.ts`, handed to `emit`

No op type string exists in `app/src`. Every write calls a builder from
`shared/src/authoring.ts` (`gearRenamed`, `tripPhaseMoved`, …) and hands the
`OpSpec` to the store's `emit`, which stamps the envelope on its own work
queue. `emit` returns `void` and is never awaited; `emitDurable` — the
per-op handshake — has exactly one caller, the join flow's pending first
Person. Entity ids for creations are minted at the call site with
`systemIdSource.next()`.

*Argued in:* `store.ts`; [`sync-protocol.md` §5](sync-protocol.md).

### 2.2 Durable-first; the read may be optimistic, the write is not

`emit` appends to the log, folds forward, then nudges the outbox — the fold
never runs ahead of the log. The folded answer therefore arrives a queue-turn
after the tap, and where that gap is visible a screen unions a **local,
add-only set** into the fold for the read (`DepotPicker`'s `IN LIST ✓`). No
tier can prove that timing, since `await user.click` drains the queue; it
lives in `KEYBOARD-PASS.md`.

*Drift symptom:* a screen writing to React state and to the log as two
separate sources of the same fact.
*Argued in:* `DepotPicker.tsx`; [§12.13](architecture-design.md#1213-consequences-of-s7-the-gear-list).

### 2.3 A needless write is never free

An op equal to the current value moves the stamp LWW compares and can beat,
and silently discard, a genuine concurrent write from a Device that was
offline. At S6 the mistake was visible (`DAY N` reads the phase register's
own stamp); everywhere since it is invisible and exactly as wrong. So:

- **Tapping the current value writes nothing** — `PhaseSheet`, `JourneyRail`,
  `SET EVERYONE` in `PieceStatusSheet`, `EntryRow`'s Bring-count.
- **An edit sheet emits one op per field that actually changed, none for the
  rest** — `GearDetail`'s `submitEdit` (owner compared through `ownerOf` on
  both sides), `Trip`'s (a `trip.dates_set` payload carrying only the dates
  that moved, `null` to clear, absent to leave alone — [`sync-protocol.md`
  §1.3](sync-protocol.md)), `People`'s and `HomePicker`'s renames.
- **A pure picker's caller suppresses a selection equal to the current
  value** — see §4.3.
- **A gesture writes nothing for the part of its work already done** —
  `closeTrip`'s reduction loop skips a Gear whose `delta = owed − postedOf(…)`
  is not positive (S11). This is an **instance of the rule, not an exception to
  it**: `gear.owned_count_set` is absolute, so re-emitting the target a first
  close already wrote is the needless write in its purest form, and here it is
  not merely stamp-moving but arithmetically wrong — the loop reads the
  *current* owned count, so a second close would subtract from the already
  reduced one. The posting register is what lets the comparison be exact
  instead of a stamp guess ([`sync-protocol.md` §4.4](sync-protocol.md)).
  `restoreConsumption` is its mirror and needs no guard of its own: the offer
  that calls it fires only on a change that actually moves the number.

**One stated exception.** `GearDetail`'s unaccounted-standing settle route
(`resolveOpen`'s `HomePicker`, `nowLabel="● NOW — FOUND HERE"`) writes
`gear.rehomed` even when the picked residence equals the Gear's current
home, deliberately not guarded by `sameResidence` the way the screen's own
MOVE handler two paragraphs up is. Here the write is not a restatement of a
value — it is a **new assertion about now**: `outcomeStands` (`unpack.ts`)
reads the standing off a stamp comparison between the `lost` outcome and the
Gear's `residence` register, so writing the *same* home on a later clock is
precisely the fact that ends it. `reHomeOnTheSpot`'s own unconditional
`gear.rehomed` (F5's row) is not a second exception — spec §1.5 calls it the
rule's *complement*, because that write is always paired with a genuine
outcome change, never offered alone against an unchanged residence.

**The rule inside a batch, where it costs hundreds of ops rather than one**
(S14). `startTripFrom` copies a Bring-count from the **register** and never
from `bringCountOf`, which supplies a default — an absent count on a Counted
Entry reads `1`. That default is right for one row on a screen and becomes a
fabricated fact the moment it is *written*, several hundred times, on a copy
of a two-hundred-line gear list. The general form is worth carrying into any
future bulk write: **read registers where a surface reads selectors.** A
selector's job is to answer what a reader should see, and a default is part
of that answer; an op is a claim about what somebody did.

There is no helper for this in `authoring.ts`: every builder is a pure
payload constructor, and the comparison is spelled at each site. That is the
pattern's weak point, and the audit that produced this file found the rule
missed at four of them.

*Argued in:* [§12.11](architecture-design.md#1211-consequences-of-s6-trips-and-phases),
[§12.15](architecture-design.md#1215-consequences-of-s9a-packing-and-the-journey),
[§12.22](architecture-design.md#1222-consequences-of-s14-trip-history-and-templates).

### 2.4 Created while picking is selected

Three pickers may **create** an entity mid-sitting — `HomePicker` a Place,
`OwnerPicker` and `ParticipantPicker` a Person — and each authors that
creation itself and then reports the new entity as the selection. They are the
only components under `app/src/components/` whose store reads are load-bearing
rather than liftable (§5.2).

*Argued in:* `HomePicker.tsx`; [§12.3](architecture-design.md#123-consequences-of-s2a-the-depot).

### 2.5 The engine's lifecycle is the session's; a 401 freezes, sign-out clears

Sign-in builds the store, which builds and starts the engine. A 401 freezes
that engine for good and touches neither the outbox nor the log — the store
reports `signed-out`, `App.tsx` reads `unsyncedCount()` **before**
`handleUnauthorized()` clears the session, and the sign-in screen states the
count. `clearLocalData()` has exactly one caller, the Devices screen's
sign-out confirm, and it is the only auth action allowed to clear the op log.
A frozen engine is never resumed; re-signing in builds a new one.

*Departures:* the store's `refusal` channel — an op that could not be written
(overflow, storage failure) — is set and **read by no screen**; the failure
reaches the console and nobody else. Blocked on a board that draws it.
*Argued in:* `wiring.ts`'s header; [`auth-design.md` §7.2](auth-design.md).

---

## 3. Screens

### 3.1 The route table decides what exists at a width; screens never measure

`App.tsx` reads `SPLIT` and `DESKTOP` once, through `useMediaQuery`
(`app/src/shell/useMediaQuery.ts`, the **only** place `window.matchMedia` is
touched), and width-guards a route with one shape:
`cond ? <Screen/> : <Redirect/>`. `/trips/:id/add` and `/trips/:id/list`
swap on Split; `/account/devices` and `/account/people` fold into `/account`
at Desktop. `DepotView` chooses its two panes the same way. A screen that
needs a breakpoint composes the same two constants; nothing reads a width.

*Argued in:* [`frontend-design.md` §3.1–3.2](frontend-design.md); `useMediaQuery.ts`.

### 3.2 A pushed screen asks `useScreenHeader` and draws the band it answers

Every screen that draws a back link or a sync line asks
`useScreenHeader({ splitPane, atDesktopSidebarCarriesDestination })` and
renders `ScreenBand` (`app/src/shell/ScreenBand.tsx`) with the answer. The
hook decides; the component draws — the back link as `‹ DESTINATION`, the sync
line as the dot plus `syncLabel(sync)`, the dot's tone from `syncTone(sync)`.
`splitPane` is `true` for `GearDetail` alone; the Desktop flag is `false` only
where the destination is one specific Trip, which no sidebar row carries
(`Packing`, `GearListBuilder`'s trip door). A screen with no sync line
(`InviteIssued`) gates on `backLink`; every other gates on `band`.

Before `ScreenBand` existed the JSX and four CSS rules were pasted per screen,
and the sync dot's tone — amber when unreachable — was carried by exactly the
two screens written in one slice and missed by the other eight. That is the
drift a centralised decision with a decentralised rendering invites.

*Argued in:* [`frontend-design.md` §3.3](frontend-design.md#33-screen-headers--the-back-link-and-the-sync-line).

### 3.2a Shell chrome is the shell's; a destination screen draws none of it

The brand mark, the sync line and the account avatar are chrome — they say
which app this is, how it is doing and who is signed in, none of which is a
fact about the destination inside the shell. `AppShell` draws all three, once
per nav mode: below Split as one header band (mark left, sync line and avatar
right), at Split atop the 56px rail, at Desktop in the 216px sidebar. A
destination screen (`Depot`, `Trips`, `Find`) opens with its own title row and
nothing above it.

The mark shipped as each screen's job and drifted three ways at once, which is
§3.2's lesson a second time: `Depot` and `Find` drew one and `Trips` drew none;
both drew `Logo` (mark **and** wordmark) where every phone frame draws the bare
`Mark`, the wordmark belonging to the sidebar alone; and both gated on
`!isDesktop`, which is true at Split — where the rail already carries one, so
the page held two. Only `Find` had a test, and a per-screen suite could see the
screen's half and nothing about the shell's.

The count that holds it is in `shell/screenBand.test.tsx`, beside the sync
line's, and for the same reason: one mark per page at every width is a fact
about the **composed** page, and a screen rendered without the shell has
nothing to double against.

*Departures:* none known.
*Argued in:* `AppShell.tsx`'s "Why the mark is the shell's and not a screen's".

### 3.3 The floating control is the screen's sibling, sticky against the shell

A screen returns a fragment: `<div className={styles.screen}>…</div>` and,
below Split, the FAB as its **sibling**, `position: sticky; bottom: 0`. The
container stays on `.screen` because the row and card folds resolve against
it, and `container-type` makes an element the containing block for its fixed
descendants — a FAB inside it lands beside the title and scrolls away. From
Split up the control docks in the title row instead. `Trip` uses the other
legal shape: a flex spacer and a full-width primary as a flex child.

*Argued in:* [`frontend-design.md` §3.1](frontend-design.md); `Depot.module.css`.

### 3.4 Every hook above the `No such X.` guard

A screen keyed on a route param reads every hook first and only then returns
the `No such gear.` / `No such trip.` line — `DepotPicker`, `GearListBuilder`,
`Packing`, `Trip` each state it. Empty states are one mono line in ledger
voice: sentence case with a full stop (`No trips.`, `Nothing recorded yet.`)
or an uppercase count (`0 ENTRIES.`, `SELECT A ROW.`).

*Argued in:* `docs/design/README.md` "Voice: strict ledger".

### 3.5 The inline variant

A screen that Desktop unfolds into another screen's card takes a
`variant: 'list' | 'inline'` prop and, inline, returns its body with no
`.screen`, no band and no title row — `People` inside `Account`. `Devices`
does the same by exporting `DeviceList` and its hook. The route to the
standalone screen redirects at that width, so the band is never drawn twice.

*Argued in:* [`frontend-design.md` §3.3](frontend-design.md#33-screen-headers--the-back-link-and-the-sync-line).

### 3.6 Load status is three states

A fetch a screen depends on is `'loading' | 'loaded' | 'failed'`, never a
boolean, and `failed` draws `Check your connection.` — `Account`, `Devices`,
`People`. When the failed fetch is what gives an encoding its meaning (S5's
login ring) the encoding is **withdrawn**, not drawn in a third colour.

*Argued in:* [§12.12](architecture-design.md#1212-consequences-of-s5-in-app-invites-and-the-logins-list); `docs/design/README.md` §13.

### 3.7 Nothing to do is drawn as nothing, never as a disabled control

A control whose act is unavailable is **withheld**, not greyed: a disabled
button still announces an act the surface does not have, and an empty region's
own rule already forbids a door to a room that can only say `0 ENTRIES.` back.
The same refusal at five sizes — a screen (`Trip` draws no `PACKING ›` band on
a Trip with no Entries), a control row (F4's empty state withholds the
segmented control and the hint as well as the count line), a header (F4's
PERSON group is a `<button>` only where it has something to expand; `Loose`'s
is text), a row (a per-person Entry with no Pieces draws neither cluster nor
body button, and says `PER-PERSON · NO PIECES` instead), and an encoding
(§3.6's withdrawn login ring).

Its mirror is that the fact still gets stated. The row stays on the list, the
empty state still draws its one line — what goes is the target, not the
information.

*Argued in:* `docs/design/README.md` §1 and §5g E9; `app/src/components/PackingRow.tsx`'s
"A per-person Entry with no Pieces is a fact, not a control".

### 3.8 A screen that may no longer be written keeps its anatomy and drops its controls

Where an invariant closes a screen's writes — a phase reached, a record
sealed — the screen does **not** become a different screen. Every read stays:
the counts, the progress, the mode controls, the filter. What goes is each
control, in §3.7's own manner (withheld, never greyed), and what replaces a
control is the fact it was stating, in the treatment already drawn for a slot
that is not a control. F5 on a closed Trip is the worked example (§5i G6): the
pill and the cluster lose their border and read as text — a border **is** a
control (§5b O) — the body routes to the screen where the remaining acts live,
and the hint names the one gesture left.

Two rules fall out of it. **Decide it once and hand it down**: a screen with
two render sites (F5's grouped modes and its flat `ALL`) will otherwise draw
the sealed state two ways, so the prop is composed in one function and spread
at both. And **name the invariant, not the phase**: `isClosed` is the only
definition of closed-ness in the codebase, and the reason F4 stays live at
every phase while F5 does not is that invariant 16 governs packing status and
19 governs outcomes — two invariants, two answers, and neither is *a phase
locks things*.

*Argued in:* `docs/design/README.md` §5i G6/G7; `app/src/components/UnpackRow.tsx`'s
`record` prop; `app/src/screens/Unpack.tsx`'s `recordProp`.

### 3.9 An end-of-list composer commits per line and keeps the caret

A list whose items are one short string each takes its composer as the **last
row of the list**, not a screen and not a sheet: a dashed row naming the verb
and a permanent fact, becoming a well on tap. The commit model is the typed
`Stepper`'s (§5b K) read onto a field that creates rather than edits —
**Return commits and keeps focus** so a batch of lines is one sitting,
**blur with text commits**, **empty commits nothing** on either path, and
**Escape discards**, because a composer has no committed value for Escape to
restore. Whitespace is empty, and the trimmed string is what reaches the
payload, so no op ever carries a blank line.

Two things follow that a screen-shaped composer does not need. The empty state
**is** the composer — a list drawing its own composer needs no `0 THINGS.`
line to stand in for one elsewhere (`TasksPanel` writes none; `NotesPanel` and
the gear region both do, and both have their composer somewhere else). And the
read stays **non-optimistic** despite §2.2's durable-first gap: the list is
above the well and focus never leaves it, so the queue-turn before the folded
row appears is a frame nobody is looking at. `DepotPicker`'s `IN LIST ✓` needs
the local union because the tapped row *is* the thing that must change; here it
is not.

*Argued in:* `docs/design/README.md` §5l I21/I27; `app/src/components/TasksPanel.tsx`'s
`Composer`.

---

## 4. Overlays

### 4.1 Radix is wrapped exactly once, and mounted is open

`ui/src/Sheet.tsx` (Dialog) and `ui/src/Confirm.tsx` (AlertDialog) are the
only two Radix consumers in the repo; `app/` imports `Sheet`, `Sheet.Close`,
`Confirm.Cancel` and `Confirm.Action` and never a Radix name. Neither takes an
`open` prop: a caller writes `{open && <Sheet …/>}`, and **mount is what
resets a picker's drafts**. The opener's focus is captured on first render and
restored by `restoreOpenerFocus` only while the opener is still on the page.

*Argued in:* [`specs/2026-08-29-radix-conversion.md`](specs/2026-08-29-radix-conversion.md);
[§12.9](architecture-design.md#129-consequences-of-the-radix-conversion).

### 4.2 A picker dismisses on the scrim; a decision does not

A selection, list or form is a `Sheet`; anything titled with a question and
ending in a consequence is a `Confirm`, which ignores the scrim, gives initial
focus to Cancel and always renders a description. Its prose comes in **two
registers and two slots** (ruling H9): `description` is the answer — the one
sentence saying what will happen — in default ink, and `note` is the
explainer beneath it, muted. A confirm whose `children` block *is* its answer
carries a `note` alone, which the prop type states as a union rather than
leaving to each caller. Tone lives in the caller's
button class — attention-bordered text for destructive, accent for
non-destructive — never in a prop. `Confirm.Action` closes on click, so a
caller never also calls `onClose`; a decision that must **outlive** its own
action (sign out this Device, which has to say `▲ Another tab has this open`)
uses a plain button and closes when the sequence finishes.

*Departures:* the remote sign-out and the revoke-login confirms put an async
handler on `Confirm.Action`, so their `busy` state and their failure line are
unreachable; card confirms disagree on Cancel-first versus Action-first
between the S3-era cards and the S9 card, which is a board question;
`RemoveElsewhereConfirm` still puts a second `<span>` inside `description`
rather than in `note`, because what it adds is a mono **fact** line about
the other Trip, not an explaining sentence.
*Argued in:* `Confirm.tsx`'s header; `docs/design/README.md` §5k H9.

### 4.3 A picker is pure selection; the caller suppresses and decides

`PackPicker`, `HomePicker`, `OwnerPicker`, `ParticipantPicker`, `TagPicker`,
`ValueMenu`, `SortGroupSheet` report every pick, the current one included.
The **caller** compares against the current value (`sameTripResidence` and
`sameResidence`, both in `shared/` beside the types they compare and
exported for exactly that) and closes the picker.
`PackPicker`'s own container-move confirm is the caller's
(`ContainerMoveConfirm`, rendered by `Packing.tsx`): the sheet reports the
pick and nothing stands between it and the caller's own decision. The `● NOW`
mark is otherwise every picker's only knowledge of the current value, and it
is a mark, not a gate.

**`HomePicker` is the one picker that does not hold to "no business rule."**
Its own MOVE confirm is drawn **inside** the sheet, gated by the
caller-supplied `moving.confirm` flag (default `true`) rather than by the
caller's own JSX — `GearDetail`'s move confirm is this internal one, not a
sibling component the screen renders itself. Lifting it out to the callers is
recorded as debt (`technical-debt.md`), and is more than it looks: the
confirm's title names the destination the picker just resolved
(`` `Move ${moving.name} to ${pending.label}?` ``), a fact only the picker
holds today.

*Departures:* who closes after a pick is decided per component — `PackPicker`
and `PhaseSheet` close themselves, the rest are closed by the caller.
**`HomePicker` holds its own MOVE confirm rather than leaving it to the
caller** — see above.
*Argued in:* `PackPicker.tsx`'s header; `HomePicker.tsx`'s header;
[§12.15](architecture-design.md#1215-consequences-of-s9a-packing-and-the-journey).

### 4.4 A confirm is facts-only; the standing band is the only surface that settles

`ActivationConfirm` and `ReopenConfirm` render the over-claim block with no
settle routes, because a control that emits inside a cancellable confirm makes
`Cancel` state something false. `OverClaimGroups` takes one optional
`SettleRoutes` prop — grouped, so the type system enforces all-or-nothing —
and its absence *is* read-only. `Unpack.tsx` (S10, F5) is a third facts-only
renderer, for a different reason: it lists the gear list rather than editing
it, so it renders `OverClaimGroups` directly, with `settle` omitted, rather
than the mandatory-`settle` `OverClaimBand`.

*Argued in:* `docs/design/README.md` §5b ruling I; [§12.13](architecture-design.md#1213-consequences-of-s7-the-gear-list).

### 4.5 The fact line under a title is the sheet's description

A sheet whose anatomy is *title, then one fact line* (`PACKING STATUS · 1 OF 3
PACKED`, `WHO BRINGS ONE · 2 OF 3`, `WHERE IT GOES ON THIS TRIP`) passes that
element as `description`, so a screen reader hears name plus fact on open
without the name becoming a superset of the visible title. `desktopCard` is
the popover approximation from Split up for the sheets a board draws as
popovers, not every sheet's Desktop form.

*Departures:* `desktopCard` is passed by five sheets no board draws as a
popover (`OwnerPicker`, `ParticipantPicker`, `PhaseSheet`, `SortGroupSheet`,
`ValueMenu`) while their nearest siblings do not pass it.
*Argued in:* `Sheet.tsx`'s `description` and `desktopCard` docs.

---

## 5. Components and the `ui/` boundary

### 5.1 `ui/` imports nothing of the app's

No store, no router, no `@foerier/shared` — `ui/package.json` depends on two
Radix packages and `uqr`, and every component restates the rule in its
header. A composite takes domain data as **props**; `GearRow` takes
`anchorProps` so `app/` can wrap it in the router's `Link` without `ui/`
knowing a router exists. `ui/src/index.ts` exports every component and its
props type, and `app/` imports only from the package index.

*Departures:* `TripCard`, `WhereaboutsCard` and `JourneyRail` are §5
composites still in `app/`, each blocked by something — a store read, a
router `Link`, a runtime `shared/` import — recorded in
[`technical-debt.md`](technical-debt.md).
*Argued in:* [`frontend-design.md` §5](frontend-design.md#5-component-architecture--the-ui-package).

### 5.2 A component under `app/src/components/` is props-in unless its read is load-bearing

The bar for a store read inside a component is that the component **authors**
something mid-sitting (§2.4) or renders a whole-fold derivation nothing above
it computes (`OverClaimBand`, `GearListSection`). A read that a parent already
has, or could pass, is lifted. Two sibling components with one shape share
one data-flow shape.

*Departures:* `ReopenConfirm` reads the store and computes its own groups
while `ActivationConfirm`, its twin, takes `groups` as a prop; `TripCard`
reads `tripParticipants` while `Trips` already hands it `entryCount` and
`progress` for exactly this reason.
*Argued in:* [`frontend-design.md` §5](frontend-design.md#5-component-architecture--the-ui-package).

### 5.3 A `ui/` prop names the paint; the caller owns the meaning

`PersonCircle` takes `tone` — `control`, `accent`, `dashed`, `filled`,
`half` — not `state`, because S5's login ring, S8's inclusion and S9's packing
fill are three meanings for the same border and the caller decides which
applies. `Chip` takes `selected` and `ghost`; `Stepper` holds no business
state (`value: number | null` is the one source of truth; a local text buffer
only keeps an unresolved keystroke on screen, and commits on blur or Enter,
never per keystroke).

*Departures:* `GearRow`'s `tone` is `home | trip | attention` — world names,
defensible for a composite; `ExpiryChip` decides its own urgency threshold.
*Argued in:* `PersonCircle.tsx`'s header; [§12.14](architecture-design.md#1214-consequences-of-s8-per-person-pieces).

### 5.4 A cluster and its count are one control

`PersonCluster` renders the circles and `×N` as a single `role="img"` with one
accessible name carrying the fact (`Who brings one — Headlamp, 2 of 3 bring
one`); circles are never individual targets, because 44px hit areas on 32px
centres let a tap meant for one Person land on their neighbour.

*Argued in:* [§12.14](architecture-design.md#1214-consequences-of-s8-per-person-pieces).

### 5.4a A crash boundary is placed by whoever owns the unit, never by the unit

`ui/ErrorBoundary` is wired at exactly three sites, and no screen and no panel
wraps itself: `main.tsx` around `<App/>`, `AppShell` around the routed screen
and *inside* the scroller (so a crashed screen keeps the nav that reached it),
and `TripPanels` around each panel it is passed. The rule is the one
`useScreenHeader` already sets — *a rule spelled per screen is one chance per
screen to spell it differently* — and it is what makes a new screen or a third
panel covered on the day it is added, with nothing to remember.

Two properties the placement buys, both of which want a test when a fourth
site appears: the screen boundary is **keyed on the location**, because
nothing else clears a boundary's state and a deterministic crash would
otherwise hold the main column for the rest of the session; and the fallback
sits **inside** whatever box the crashed thing occupied, which is the whole
difference between an in-place fallback and a white-out.

*Argued in:* `ui/src/ErrorBoundary.tsx`'s header;
[`frontend-design.md` §5](frontend-design.md#5-component-architecture--the-ui-package);
`docs/design/README.md` §16.

### 5.5 A second caller is the bar for moving into `ui/`

`GearRow` moved on its second caller (`Depot`, `Find`); `ExpiryChip` on its
(`InviteIssued`, `People`, since joined by `Join`). A primitive on §5's list
that is hand-rolled at a third site is the codebase's own trigger to build it.

`Band` is the fourth, and the one where the count was
**three** — `Trip`'s `GEAR LIST` (S7) plus `NotesPanel`'s and `TasksPanel`'s
(S12 and S13, in parallel worktrees, each borrowing the first and saying so).
It also shows what a primitive keeps and what it hands back: the row, the
label's paint and the trailing slot's reflow are anatomy; the count's words,
the routes and the class that paints them are the caller's, because a count
is a fact about a section rather than about a band.

**Three fired at once after S9**, and the count was wrong on the first two.
`SegmentedControl` was hand-rolled at **four** sites, not the three anyone had
counted — `TripOnlySheet`'s copy had never been noticed — and one of the four
was the only one that had solved the `overflow: hidden` hit-testing trap, so
the primitive inherited that copy's rules and the other three gained them.
`StatusPill`'s two callers are genuinely two controls (F4's states a status,
the Piece sheet's writes one), so it owns the **grammar** they share and takes
one prop per real difference rather than one per divergence. `PersonCircle`
gained a sixth size, 40, and absorbed the two hand-rolled avatars.

**What a fold is allowed to change, and what it must not.** These three moved
paint at four points, each recorded: `GearDetail`'s segments gain a focus ring
they never had and the hit extension their clipping parent had made
impossible; its checked segment gains the 600 the other copies drew; and the
nav avatar drops from a 10px initial to the 22 size's own 9px. A fold that
silently kept every copy's paint would not be a primitive.

**A fold may change behaviour, and that is the caller's to check.** Add gear's
Owned-count well folded into `Stepper` after the MVP landed, ending one
control with two accessible names — and inherited the commit-on-blur rule
(§5.3) in place of its own per-keystroke one. Its CTA is `disabled` on that
value, so the fold rests on a tap over a disabled button still blurring the
well: measured in Chromium and WebKit before the fold, and recorded in
`KEYBOARD-PASS.md` because no tier can hold it. A fold that changes when a
value is stated wants that question asked of every gate reading it.
*Argued in:* [`frontend-design.md` §5](frontend-design.md#5-component-architecture--the-ui-package);
`ui/src/SegmentedControl.tsx` and `ui/src/StatusPill.tsx`'s own headers.

---

## 6. CSS

### 6.1 Every module is one `@layer components` block

`ui/styles/index.css` declares the order once —
`reset, tokens, base, layout, components, utilities, overrides` — and every
`*.module.css` in `ui/src/` and `app/src/` opens with `@layer components {`
and closes at the end of the file. `overrides` is declared and empty. No
`!important`, no `:global`, no `composes` (four headers say why not).

*Argued in:* [`frontend-design.md` §4.1](frontend-design.md#41-cascade-layers).

### 6.2 Components consume semantic tokens; primitives never leak

`ui/styles/tokens.css` holds the primitive scale and the semantic layer; the
theme flips by re-pointing the semantic names under `[data-theme]` and
`prefers-color-scheme`. A module consumes `--color-*`, `--space-*`,
`--text-*`, `--font-*`, `--stroke-*`, `--radius-*`, and derives a tint with
`color-mix(in srgb, var(--token) N%, transparent)` so it tracks both themes.
Zero modules consume a `--sage-*` / `--parchment-*` primitive directly.

The mono-caps label recipe is three declarations —
`font: var(--text-label) var(--font-mono); letter-spacing:
var(--tracking-label); text-transform: uppercase;` — and is the codebase's
most-copied rule.

*Departures:* the boards specify mono sizes below the token scale's floor
(8.5–10px), so ~170 `font-size` declarations set a raw `rem`, and 41
`letter-spacing`s a raw `em`; the badge in `Account` and `Devices` states its
own px where `--radius-badge` was minted for it; `Sheet`'s shadow is the one
raw colour.
*Argued in:* [`frontend-design.md` §2.2](frontend-design.md#22-token-layers-css-custom-properties).

### 6.3 `rem` for the grid, `em` for internals and breakpoints, px only for floors and hairlines

Breakpoints are `em` (30 · 40 · 52 · 64) so a reader who raises their
font-size crosses them at the right perceptual point; the container fold is
`38rem` and `ui/src/GearRow.module.css` owns it — any other container width
carries a stated reason. px appears only in `max(Nrem, Npx)` floors,
`var(--stroke-rule)` hairlines, the pill radius and the fixed table columns.

*Argued in:* [`frontend-design.md` §2.1, §3.2](frontend-design.md).

### 6.4 A media query decides what exists; a container query decides how it lays out

The JS reads a breakpoint to choose **which** DOM renders (§3.1); a module's
media query mirrors that existence decision or caps the shell measure; a
container query does everything else, resolving against the pane the
component was handed. `container-type: inline-size` goes on the pane or list
item, never on the component itself, and nothing `position: fixed` lives
inside one.

*Argued in:* [`frontend-design.md` §3.2](frontend-design.md#32-components--container-queries); `Depot.module.css`'s title-row comment.

### 6.5 A drawn size is the painted size; 48 floors the hit area

There is no global touch floor and there must not be one. A standalone
control is drawn ≥48 (`min-height: max(3rem, 48px)`); a dense in-row control
keeps its drawn paint, states its own `min-height` so the arithmetic has a
base, and grows a non-painting `::after` whose `inset` **clamps at its owning
row's bounds** on the axis where a neighbour sits. `Stepper.module.css`,
`EntryRow.module.css` and `PackingRow.module.css`'s `.body` are the worked
examples, and `app/src/screens/drawnSizes.test.ts` pins each case by parsing
the stylesheet text, asserting the paint, the presence of the extension and —
where a board states a number — the inset.

**A wrapping row of controls owes the extension its room.** Two lines whose
extensions overlap put the tap in the band between them at the mercy of paint
order, so a caller that wraps `ui/Chip`'s 32px tag size states a `row-gap` of
12 — `GearDetail`'s `.tagChips` and `TagPicker`'s `.chips` both say so, and
`drawnSizes.test.ts` pins the gap beside the inset, since the component's own
suite cannot see its callers.

**Where no extension is possible, the paint moves.** `SortGroupSheet`'s sheet
rows are stacked full width with no gap at all, so they take the explicit 48
the board's *rows 40+* permits rather than an `::after` that would decide a
tap by paint order; the same options drawn **inline** in the arrange row keep
their 36 and take the clamp, because 16 between wrapped lines pays for it.
One control, two rows, two answers — which is why this can never be one
declaration.

*Departures:* `TagPicker`'s ✕ reaches 44 × **40**, not 44 × 44: the missing 4
could only come from the tag's own label, and a tap that appears to land on
the word would then delete it. The Desktop sidebar's rows paint 36 and carry
no extension — a pointer surface, and outside the eight this rule closed.
`GearDetail`'s segments were a ninth and are closed the same way: folding them
into `ui/SegmentedControl` removed the `overflow: hidden` that made an
extension impossible and gave them one.
*Argued in:* `docs/design/README.md` §5b ruling O; [`frontend-design.md` §2.1](frontend-design.md#21-root-and-units); `ui/styles/base.css`.

### 6.6 A flex `gap` is not a character; adjacent spans need a real space

Two sibling `<span>`s separated on screen by `gap` or `margin` are separated
by **nothing** in the DOM's text, so the row's text content — which is what a
screen reader reads as it crosses the row, and what an enclosing `<button>`
takes as its accessible name — glues them into one word. Any adjacent pair
that reads as one sentence carries an explicit `{' '}` between them, inside
the same conditional as the second span so it never renders alone. Four sites
draw a name-plus-badge pair this way (`EntryRow`, `PackingRow`, `PackPicker`,
`Devices`, `People`), and `PackingRow`'s `— ELS'S PIECE` suffix is the same
shape without a badge.

**A `getByText` on the badge cannot see this**, because it matches that span
in isolation; the assertion has to read the *parent's* whole text content and
name the glued spelling on its own line. That is exactly how the defect
survived S7 — the assertion meant to pin the name matched the suffix as a
substring.

*Departures:* none known.
*Argued in:* `PackingRow.tsx`'s `.nameLine` note;
[`specs/2026-09-01-packing-and-the-journey.md`](specs/2026-09-01-packing-and-the-journey.md) §11.5.

### 6.8 `.shell__main` owns the gutter; a `.screen` adds none

`ui/styles/layout.css` gives the shell's main area `padding-inline:
var(--gutter)` and `padding-block: var(--space-16) var(--fab-clearance)`, and
the gutter steps by mode (12 · 16 · 24). A signed-in screen's own `.screen`
therefore sets **no inline padding and no block padding** — fourteen of the
sixteen do, and take the shell's. A screen that adds its own pays twice and
drifts from its neighbours at every width at once.

Two did. `Find` carried `padding: var(--space-16)` with no media query, so
its title sat 16px right and 16px down of `Depot`'s at all five modes —
measured in a browser: `titleLeft` 28/32/40/158/256 against Depot's
12/16/24/142/240. `GearDetail` carried the same plus `padding-bottom:
var(--space-32)`, which at Split misaligned the two panes of one view (the
board's `Depot split` draws the list pane at 16 and the detail at 18; shipped
they were 16 and 32).

The three signed-out screens (`SignIn`, `Join`, `NoPasskey`) render outside
`AppShell` entirely and keep their own padding — there is no shell under them
to inherit from. A **measure cap** is a different thing and stays the
screen's: `max-width` plus `margin-inline: auto` narrows the column the shell
handed over, and does not restate its inset.

*Departures:* none known.
*Argued in:* `ui/styles/layout.css`'s `.shell__main` note; the layout review.

### 6.7 Variants: a modifier class for a boolean, `data-*` for an enumeration, ARIA for state the DOM already carries

`.retired`, `.selected`, `.dense`, `.inline` sit beside the base class;
`data-tone`, `data-status`, `data-stage-state`, `data-urgent` carry an
enumerated value; `[aria-current='page']`, `[aria-pressed='true']` and
`:has(input:checked)` style what the accessibility tree already states rather
than duplicating it in a class. Class names are camelCase; the two global
shell classes are BEM (`.shell__main`, `.shell__nav`).

*Departures:* "selected" is expressed three ways across `Chip`, `Packing`'s
filters and the segmented controls; `AppShell` uses kebab `nav-*` keys.
*Argued in:* `PersonCircle.module.css`'s header.
