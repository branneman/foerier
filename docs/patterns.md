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
`createSessionDepot` (`app/src/depot/wiring.ts`) and handed down through
`DepotProvider`. A screen or component reads it with `useDepot(selector)`
(`app/src/depot/store.ts`) and nothing else — there is no module-level store to
import. Nearly every reader takes the whole fold, `useDepot(d => d.state)`,
and derives with `shared/` selectors inside `useMemo(…, [state])`, because the
reducer returns the **identical** object for a lost write, so the fold's
identity is the memo key (`Depot.tsx` is the worked example: `containmentView`,
`sliceDepot`, `depotCounts`, each memoised on `state`).

`AppShell` sits **outside** the provider on purpose and is fed counts and the
avatar initial as props from `App.tsx`. `useDepotStore()` — the nullable
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
Gear's own Kind, which is invariant 6 read out rather than enforced.

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
registers, so `slice.ts` carries a module-level `WeakMap<DepotState, …>` keyed
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

*Departures:* three callers now want a memoised `containmentView` itself, and
`slice.ts` memoises the ancestor index instead —
[`technical-debt.md`](technical-debt.md).
*Argued in:* `slice.ts`; [§12.13](architecture-design.md#1213-consequences-of-s7-the-gear-list),
[§12.16](architecture-design.md#1216-consequences-of-s9b-whereabouts-reaches-the-depot).

### 1.8 App-side display selectors compose `shared/` answers

`app/src/depot/trips.ts` and `people.ts` are the shelf for **display**
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

There is no helper for this in `authoring.ts`: every builder is a pure
payload constructor, and the comparison is spelled at each site. That is the
pattern's weak point, and the audit that produced this file found the rule
missed at four of them.

*Argued in:* [§12.11](architecture-design.md#1211-consequences-of-s6-trips-and-phases),
[§12.15](architecture-design.md#1215-consequences-of-s9a-packing-and-the-journey).

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
focus to Cancel and always renders a `description`. Tone lives in the caller's
button class — attention-bordered text for destructive, accent for
non-destructive — never in a prop. `Confirm.Action` closes on click, so a
caller never also calls `onClose`; a decision that must **outlive** its own
action (sign out this Device, which has to say `▲ Another tab has this open`)
uses a plain button and closes when the sequence finishes.

*Departures:* the remote sign-out and the revoke-login confirms put an async
handler on `Confirm.Action`, so their `busy` state and their failure line are
unreachable; card confirms disagree on Cancel-first versus Action-first
between the S3-era cards and the S9 card, which is a board question.
*Argued in:* `Confirm.tsx`'s header.

### 4.3 A picker is pure selection; the caller suppresses and decides

`PackPicker`, `HomePicker`, `OwnerPicker`, `ParticipantPicker`, `TagPicker`,
`ValueMenu`, `SortGroupSheet` report every pick, the current one included,
and hold no business rule. The **caller** compares against the current value
(`sameTripResidence`, `sameResidence` are exported for exactly that), decides
whether a confirm stands between the pick and the write (`Packing`'s
container-move confirm; `GearDetail`'s move confirm), and closes the picker.
The `● NOW` mark is the picker's only knowledge of the current value, and it
is a mark, not a gate.

*Departures:* who closes after a pick is decided per component — `PackPicker`
and `PhaseSheet` close themselves, the rest are closed by the caller.
*Argued in:* `PackPicker.tsx`'s header; [§12.15](architecture-design.md#1215-consequences-of-s9a-packing-and-the-journey).

### 4.4 A confirm is facts-only; the standing band is the only surface that settles

`ActivationConfirm` and `ReopenConfirm` render the over-claim block with no
settle routes, because a control that emits inside a cancellable confirm makes
`Cancel` state something false. `OverClaimGroups` takes one optional
`SettleRoutes` prop — grouped, so the type system enforces all-or-nothing —
and its absence *is* read-only.

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

### 5.5 A second caller is the bar for moving into `ui/`

`GearRow` moved on its second caller (`Depot`, `Find`); `ExpiryChip` on its
(`InviteIssued`, `People`, since joined by `Join`). A primitive on §5's list
that is hand-rolled at a third site is the codebase's own trigger to build it.

*Departures:* the segmented control is hand-rolled in `AddGear`, `GearDetail`
and `Packing`; a status pill in `PackingRow` and `PieceStatusSheet`; the
avatar circle in `Account` and `AppShell` predates `PersonCircle`; `AddGear`'s
Owned-count stepper is the recorded not-yet-folded caller of `Stepper`.
*Argued in:* [`frontend-design.md` §5](frontend-design.md#5-component-architecture--the-ui-package).

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

*Departures:* nine touch-surface controls between 32 and 40px carry no
extension (`TripCard`'s phase chip, `ui/Chip`'s two sizes as buttons, the
slice bar's readout, `TagPicker`'s remove, `SortGroupSheet`'s rows,
`GearDetail`'s segments — whose parent's `overflow: hidden` would kill one —
the Split rail's links, and the inline Save/Cancel pair copied four times).
*Argued in:* `docs/design/README.md` §5b ruling O; [`frontend-design.md` §2.1](frontend-design.md#21-root-and-units); `ui/styles/base.css`.

### 6.6 Variants: a modifier class for a boolean, `data-*` for an enumeration, ARIA for state the DOM already carries

`.retired`, `.selected`, `.dense`, `.inline` sit beside the base class;
`data-tone`, `data-status`, `data-stage-state`, `data-urgent` carry an
enumerated value; `[aria-current='page']`, `[aria-pressed='true']` and
`:has(input:checked)` style what the accessibility tree already states rather
than duplicating it in a class. Class names are camelCase; the two global
shell classes are BEM (`.shell__main`, `.shell__nav`).

*Departures:* "selected" is expressed three ways across `Chip`, `Packing`'s
filters and the segmented controls; `AppShell` uses kebab `nav-*` keys.
*Argued in:* `PersonCircle.module.css`'s header.
