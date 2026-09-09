# Technical debt

One line per piece of outstanding technical work, naming it and pointing at the
document that argues it. Answering _"what is outstanding?"_ used to mean reading
four documents; this is the index that saves the reading.

**This file is not the record.** The reasoning stays beside the thing it is
about — which is how the next person to touch a pushed screen meets the header
rule's obligation without knowing this file exists, and how a debt gets read by
someone who came for something else. Copying the argument here would give every
debt two writers, and two writers is how [`design/README.md`](design/README.md)
lost seven annotations to a single regeneration.

Four rules keep an entry's shape:

- **Pointers run one way: index → doc.** Never add a back-reference from a
  durable doc to this file. Each doc has to stay readable, and correct, alone.
- **Every entry carries a verbatim anchor** — a phrase from the owning document,
  chosen because it _disappears_ when the debt is paid. Staleness is then
  detectable rather than remembered:
  `grep -rF "<anchor>" docs shared/src ui/src app/src api/src --exclude=technical-debt.md`.
  **Three things that command has to get right, each of which has been wrong.**
  It must **exclude this file**: every anchor is quoted verbatim in its own
  entry, so a sweep that reads the index finds every anchor it looks for and can
  never report a stale one — a check that only ever passes, and the one that let
  S9b's closed `metaFor` entry survive to a merge. It must reach **`shared/` and
  `ui/`**, which the earlier `docs app/src api/src` did not, so an anchor living
  in `shared/src/selectors/` read as stale while it was live. And a miss is
  **not proof of staleness**, because Prettier rewraps prose: three of the four
  misses in S9b's sweep were anchors split across a line break, which `grep -F`
  cannot see. So **choose an anchor short enough to survive rewrapping**, and
  re-read the owning section before deleting a line.
  An entry whose anchor no longer appears is either **closed** (delete the line)
  or **moved** (fix the pointer); it is never a reason to re-argue the debt here.
  An entry that resists an anchor is a debt recorded nowhere durable, and wants a
  home before it wants a line.
- **Delete when closed; never tick.** Git holds the history.
- **No numbers.** Nothing cross-references these, and an identifier that churns
  is worse than none. User stories are the opposite case and keep theirs forever.

Two things do not belong here. Work that is a **user need** is a story in
[`user-stories.md`](user-stories.md). Work **deliberately not done** is a
decision, not a debt, and belongs only where it is argued — folding the deferral
lists in [`auth-design.md`](auth-design.md) §11,
[`architecture-design.md`](architecture-design.md) §11 and
[`sync-protocol.md`](sync-protocol.md) §8 into this file would bury a dozen live
items under thirty settled ones.

## Open

The five sections below sort by **what is in the way**, which is the question
that decides whether an entry is work anyone can pick up today. An entry goes in
the **first section it qualifies for**, reading top to bottom — a duplication
that is also wrong today is filed under Wrong today, and the section is not a
second opinion about severity. Moving an entry between sections is an ordinary
edit; a debt that fits none of the five means the sections are wrong, not the
entry.

### Wrong today

Something is incorrect right now — what a screen states, what a control
offers, or what the tiers claim to cover. Nothing here is blocked on anything.

- **A pre-S11 close that the Depot could only partly satisfy is back-filled at
  the full amount it owed.** `reopenTrip`'s back-fill reconstructs a missing
  posting from `consumedReductions`, which is what that close *declared*; a
  close of ×5 against a Depot holding ×1 applied ×1, and the pre-close owned
  count survives only in the log, so nothing distinguishes the two after the
  fact. A restoration on such a Trip then hands back more than it took. It
  needs a Trip closed before S11 **and** an over-claim on it, and every close
  performed by this build leaves a posting behind — `0` included — so the
  reconstruction is never consulted for one. Recorded as a shrinking
  cross-version residue rather than outstanding work.
  `shared/src/gestures.ts`'s own docblock on `reopenTrip`, anchor:
  `right unless that pre-S11 close was itself floored`
- **A peer on a pre-gate build can reopen a Trip without leaving a posting,
  after which any build's close reduces a second time.** Reopening is a bare
  `trip.phase_moved` out of `closed`, and a build from before S11 emits one
  with nothing recording what its earlier close already applied; the Trip then
  syncs here as an ordinary `unpack` Trip with an empty postings map, and this
  build's close subtracts from the already-reduced count. It needs a build
  **two** releases old — S10-era, before the gate that S11 deleted — *and*
  that Device to be the one performing the reopen: a reopen through any
  current build back-fills the posting and the hazard never arises.
  **It cannot be closed from this side at all**, because the only evidence
  would be an op that build never wrote. Recorded as a shrinking cross-version
  residue rather than outstanding work; it retires when no such installed PWA
  remains. `shared/src/gestures.ts`'s own docblock on `reopenTrip`, anchor:
  `whose reopen this build never witnessed`
- **The property tier never meets a trip-side containment cycle, and never
  compares the trip tree across replicas at all.** `arbOpSets`'s generator
  produces a `tripContainmentView(…).brokenEdges` hit in **0–1 runs per
  1000** across seven seeds (against 27–46 for the home tree, now floored at
  15 — ruling R37), so a floor at 0 asserts nothing and a floor at 1 fails on
  four of them. Worse, the convergence property's only cross-replica
  containment assertion is over the **home** view; the trip tree's cycle
  break — `sync-protocol.md` §3.6's deterministic tie-break, and the half of
  that duplicated traversal whose divergence would be **silent**, two Devices
  simply drawing different trees — is covered by one hand-built scenario and
  nothing else. Closing it means changing what `arbTripResidence` draws, or
  how often, which moves every other measured rate in that file.
  `shared/src/convergence.test.ts`'s own docblock on `HOME_CYCLE_FLOOR`,
  anchor: `The trip side is deliberately NOT floored`
- **Creating a Trip flashes `TRIP NOT ON THIS DEVICE` for a frame.**
  `NewTrip`'s `submit` emits and navigates in the same tick, and `emit` is
  durable-first — the fold happens on the store's queue — so the trip screen's
  first render finds no Trip and draws ruling J5's *not folded here* state.
  It clears itself on the next fold, and the shape predates S14 (the screen
  has navigated-after-emit since S6); what changed is the **copy**, from a
  quiet `No such trip.` to a sentence confidently asserting a sync fact one
  frame after the Quartermaster pressed Create.
  **Both obvious fixes are wrong here, which is why this is recorded rather
  than done.** Awaiting `emitDurable` does not help: it resolves immediately
  after the log append and *before* `foldForward`, deliberately, so the race
  survives. And `drained()` is not a screen's tool — its own docblock says it
  is a queue-drain signal for tests and teardown, and it resolves just as
  readily after an append that failed. A real fix is either a store-level
  join that means *folded*, or a rule that J5's `unknown` state withholds its
  sentence until the fold is settled — and the second is ruled copy, so it
  wants a board. `app/src/screens/NewTrip.tsx`, anchor:
  `the copy deliberately supplies neither`
- **The closed ledger's `1 LOST` colour can read muted while a unit is still
  genuinely unaccounted for.** `tripHasUnaccounted`
  (`app/src/household/trips.ts`) asks `unaccountedOf`'s finished map by trip
  id, and that function names only the Trip of the **latest** live `lost`
  report when two Trips both hold one for the same Gear. An older closed
  Trip whose own unit is still summed into that standing then reads `false`
  here, and its `N LOST` draws muted despite one of its own units still
  being out there. One-directional: the row can be falsely muted, never
  falsely attention. `app/src/household/trips.ts`'s own docblock on
  `tripHasUnaccounted`, anchor: `A known imprecision, inherited from`

### Traps

Correct today, and silently wrong the moment a named future slice lands.
Each entry names its trigger. Paying one after its trigger costs a debugging
session rather than an edit, because the symptom shows up somewhere else.

- **The trip's containment view restates the home one's traversal, and the two
  must not drift.** `shared/src/selectors/tripContainment.ts` reimplements
  `containment.ts`'s walk, its sorted-id determinism and
  [`sync-protocol.md`](sync-protocol.md) §3.6's cycle break over a different
  pointer type. The duplication is deliberate — the two worlds resolve against
  different things, and a shared implementation would take a strategy object
  for every line — but the **cycle break is the half that would be silent if
  they diverged**, since a replica-dependent break shows up only as two devices
  drawing different trees. Argued in the module's own header,
  `shared/src/selectors/tripContainment.ts`, anchor:
  `non-drift is the obligation it`
- **`useScreenHeader`'s tenth and eleventh callers disagree about the same
  question.** F4 passes `atDesktopSidebarCarriesDestination: false` and keeps
  `‹ ALPS 2026` at Desktop; `GearListBuilder`'s **default** door points at the
  same kind of destination — one specific Trip, which no sidebar row
  carries — and the S9 round did not look at it. One of the two is drawn
  wrong at Desktop, and the boards draw the builder at 1024 with no sidebar at
  all, which is why the question has never been forced.
  [`architecture-design.md`](architecture-design.md) §12.15, anchor:
  `the first screen where that flag's`
- **Who closes a picker after a pick is decided per component.** `PackPicker`
  and `PhaseSheet` close themselves; `HomePicker`, `OwnerPicker`,
  `ParticipantPicker` and `SortGroupSheet` are closed by the caller. A new
  caller of the second group that forgets `setOpen(false)` gets a sheet that
  stays up after a tap. [`patterns.md`](patterns.md) §4.3, anchor:
  `decided per component`

### Specified and not built

A board or a design doc settles it and the code has never caught up.
Actionable without a new decision; the size runs from a `<link>` tag to a
second pane.

- **The two-pane Trips is drawn and not built.** `Trips — split 900` puts a trip
  detail beside the list; `DepotView` and, since S7, the gear-list builder are
  the app's two-pane views, and Trips is neither of them — it stays a single
  full-width pane at Split and keeps Desktop's `+ NEW` there instead of
  the frame's dense filled control. That control's copy and treatment land with
  the pane. [`design/README.md`](design/README.md) §5, anchor:
  `two-pane Trips, list left and trip detail right`
- **The two-pane Add gear is drawn and not built.** `Add gear — split 900` draws
  the form as a pane with the Depot list kept beside it; `<Route path="/add">`
  renders it standalone at every width — unlike S7's gear-list builder, which
  the app did build as a second two-pane view. That is why `AddGear` answers
  `splitPane: false` against its own frame and still draws `‹ DEPOT` at Split,
  and why its CTA fact line has only one alignment to say.
  [`frontend-design.md`](frontend-design.md) §3.3, anchor:
  `two-pane Add gear has never been built`
- **`InvitePreview` carries no person name**, so the join confirm's `YOU JOIN AS`
  and `INVITED BY` lines and the success frame's `Els · Veldkamp` are
  half-buildable and neither frame renders them. Widening the auth contract on a
  slice's last task was refused deliberately; `household_seq` on the join
  response is a candidate for the same trip if one is ever made.
  [`architecture-design.md`](architecture-design.md) §12.2, anchor:
  `` still owe `person_name` ``
- **Split's two panes share one scroller — now in two places.** `DepotView`
  draws the Depot list and the gear detail as two panes of one view that
  never unmounts, so `/` and `/gear/:id` are two routes over that one
  scroller and `AppShell.tsx` keys its route-change reset on a scroll group
  rather than the path there — a workaround standing in for panes that
  scroll themselves, which would also move each reset's own target. S7's
  gear-list builder repeats the two-panes-one-scroller shape for its picker
  and list panes, but both already sit behind the same route
  (`/trips/:id/list`), so its own reset already keys on the path; the actual
  gap is `GearListBuilder.module.css` carrying no `overflow` of its own, so
  the two panes still share the shell's one scroller instead of scrolling
  independently. Blocks story 38 from doing the honest thing at Split, and
  doubles what that fix will have to cover.
  [`frontend-design.md`](frontend-design.md) §3.1, anchor:
  `Panes with scrollers of their own`
- **`landing/` is a redirect stub, not a workspace.** It does not build, so it
  cannot import `ui/styles/tokens.css` and its two background colours are copies
  a token change never reaches. The marketing site and the live demo on `ui/`
  components are what close it.
  [`architecture-design.md`](architecture-design.md) §12.1, anchor:
  `` until there is a `ui/` worth showing off ``
- **Three of §5's `ui/` composites are still in `app/`, and none of the three
  is merely waiting for a second caller.** `TripCard`, `WhereaboutsCard` and —
  since S9a — `JourneyRail` are named there and live in
  `app/src/components/`, each with exactly one caller, so §5.5's own bar (a
  second caller) has not been reached for any of them. Each also owes work
  beyond the move: `TripCard` reads the store, which §5's hard rule forbids in
  `ui/`; `JourneyRail` reads the stage table from `shared/`, which `ui/` does
  not depend on; and `WhereaboutsCard` **owes both of those plus a router
  import** — it reads four values and two types from `shared/` and renders
  wouter's `<Link>` for `RESOLVE`. Its move is therefore an API redesign, not
  a relocation: every `shared/` value has to arrive pre-resolved as a row view
  model and the `RESOLVE` link has to arrive as a `ReactNode` from the caller.
  Doing it before a second caller exists would also design that view model
  against a single screen. [`frontend-design.md`](frontend-design.md) §5,
  anchor: `` still in `app/src/components/` with one caller each ``

### Waiting on a decision

Cannot be coded yet: no frame draws it, or the ruling that would settle it
has not been made. These want a design sitting, not an afternoon — reading
them looking for work is the thing this section exists to stop.

- **`Find` spends the full 1120 at Desktop, and no frame draws it there.**
  `.shell__main` caps the column at 70rem and `Find` adds no measure cap of
  its own, so its answer cards stretch the whole width — where `Depot` spends
  that width on eight table columns and `Trips` on 2-up cards, both drawn.
  `Screens B`'s Find frame is 393 only, and §6 already records that the
  Desktop *withholding* of the header was inherited from `Depot desktop`
  rather than drawn. Blocked on a board, not on an afternoon: a cap is one
  declaration, but which one is a design call.
  [`docs/design/README.md`](design/README.md) §6, anchor:
  `no frame draws Find at 1024`
- **`InviteIssued` draws no sync line at Split**, the one mode where nothing
  legible states sync status — the rail gives a bare 6px dot with the words on an
  `aria-label`. Blocked on a board rather than on the rule: no frame draws this
  screen at Split at all. [`frontend-design.md`](frontend-design.md) §3.3, anchor:
  `sync half has no drawn answer`
- **The store's `refusal` channel has no reader.** An op that could not be
  written — a 16 KB overflow, an IndexedDB failure — sets `depot.refusal`
  and is logged to the console, and no screen draws it, so the Quartermaster
  learns nothing. Blocked on a board: no frame draws a refused write.
  [`patterns.md`](patterns.md) §2.5, anchor:
  `read by no screen`
- **`ui/`'s `Popover` is unbuilt, has seven waiting callers, and no board
  draws one.** §4a's desktop tag picker, the slice bar's `ValueMenu`, S8's
  Piece picker, S9a's Piece status sheet, the outcome sheet and its roster
  variant (S10), and — since S14 — the template source picker are each
  described in board prose as *sheet below Split, popover from Split up*, and
  all seven are approximated by `Sheet`'s `desktopCard` meanwhile. S14's own
  round declined to draw the seventh rather than take a set of visual
  decisions against nothing, and said so. **That prose is the whole of the
  specification.** The bundle contains no popover artboard: nothing states a
  side, an alignment, an offset, a width, collision behaviour or whether it
  carries an arrow, and the only popover token in `Foundations` is the
  `bg/raised` background it shares with a hovered row. Building it therefore
  means taking seven visual decisions across seven surfaces with nothing to
  build against, which is why this sits here and not under *Specified and not
  built*. It also needs each caller restructured so the trigger and the
  content are siblings under one Radix root, against the app's settled
  mounted-is-open convention ([`patterns.md`](patterns.md) §4.1) — so a
  ruling should cover the trigger anatomy too. Wants the same sitting as the
  entry below. [`frontend-design.md`](frontend-design.md) §5, anchor:
  `is the one with waiting callers`

- **`desktopCard` is a per-slice choice masquerading as a rule.** Five sheets
  pass it with no board drawing them as a popover, while their nearest
  siblings do not, so at Desktop the Owner picker is a centred card and the
  Home picker a bottom sheet on the same edit sheet. Wants a design ruling,
  not a code change — and so does the card confirms' Cancel-first versus
  Action-first order, which the S3-era and S9 boards draw differently.
  [`patterns.md`](patterns.md) §4.5, anchor: `no board draws as a`
- **Two 401 body shapes.** `/auth/*` answers a flat `{ "error": "unauthorized" }`
  and `/sync/*` answers [`sync-protocol.md`](sync-protocol.md) §6.3's structured
  object. Neither breaks a contract — [`auth-design.md`](auth-design.md)
  specifies no 401 body at all — but the divergence is real and the decision to
  unify is deferred rather than made.
  [`architecture-design.md`](architecture-design.md) §12.4, anchor:
  `Unifying the two shapes`, which is also the comment at `api/src/sync/routes.ts`

### Consolidation

One rule, several spellings; or one thing under the wrong name. Nothing
observable changes when these close, which is why none is urgent and why
every one of them gets more expensive per slice.

- **`ReopenConfirm` reads the store; `ActivationConfirm`, its twin, takes
  `groups`.** Two facts-only confirms with one anatomy and two data-flow
  shapes; the lift is `groups` as a prop from `PhaseSheet` and `Trips`, which
  already compute them. `TripCard` has the same shape of debt at one read.
  [`patterns.md`](patterns.md) §5.2, anchor:
  `computes its own groups`
- **`HomePicker` holds its own MOVE confirm; every other picker leaves the
  decision to its caller.** `patterns.md` §4.3's rule — a picker is pure
  selection, and the caller decides whether a confirm stands between the pick
  and the write — holds for `PackPicker`'s `ContainerMoveConfirm` but not for
  `HomePicker`: its `Confirm` is drawn inside the sheet itself, switched on by
  the caller-supplied `moving.confirm` flag rather than by the caller's own
  JSX. Lifting it out is more than a cut-and-paste: the confirm's title names
  the destination the picker just resolved
  (`` `Move ${moving.name} to ${pending.label}?` ``), a fact only the picker
  holds today, so a caller-owned confirm needs that label reported back
  through `onSelect` or a second callback before the sheet can lose its own
  copy. `HomePicker.tsx`, anchor: `MOVE's confirmation. Not on the board`
- **The mono-caps label is the most-copied rule in the codebase, and the
  small sizes have no token.** Seventy-six uppercase-label rules across
  twenty-nine modules, nineteen carrying the full three-line recipe verbatim;
  ~170 `font-size` declarations set a raw `rem` because the boards specify
  mono at 8.5–10px and the token scale stops at 11. A shared class and two or
  three small `--text-*` pairs would close most of it.
  [`patterns.md`](patterns.md) §6.2, anchor:
  `most-copied rule`
