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

- **Three callers now want a memoised `containmentView`.** `whereabouts`, the
  `CONTAINER` dimension and every list screen that hoists one by hand each
  build their own; `slice.ts` memoises the *ancestor index* instead, because
  `containment.ts` states its own non-caching as a property and the slice that
  owns that file is the one that should make the claim false. Argued in the
  memo's own JSDoc, `shared/src/selectors/slice.ts`, anchor:
  `The rejected alternative was memoising`
- **The resilience layer's `ErrorBoundary` is drawn and not built.** §6 gives
  a component crash a home in `ui/ErrorBoundary`, wrapping each screen and
  panel with an in-place ledger-voice fallback; nothing of the kind exists and
  `main.tsx` mounts `<App/>` bare, so one card's render error is a white page
  for the whole app. The other two unbuilt homes — the `motion` module and the
  chunk-load reload handler — are moot until a module declares a transition
  or a route is code-split, and become due the same day.
  [`frontend-design.md`](frontend-design.md) §5, anchor:
  `no error boundary exists in`
- **Eight touch controls between 32 and 40px carry no hit extension.**
  `TripCard`'s phase chip, `ui/Chip`'s two sizes rendered as buttons, the
  slice bar's readout, `TagPicker`'s remove, `SortGroupSheet`'s rows, the
  Split rail's links and the inline Save/Cancel pair copied into four
  pickers. Each wants ruling O's `::after` with a clamp chosen against its own
  row, and the chip's trip-screen twin already has it.
  [`patterns.md`](patterns.md) §6.5, anchor:
  `carry no extension`
- **One control answers to two accessible names.** Add gear's hand-rolled
  Owned-count stepper says `Fewer` / `More`; `ui/Stepper` says
  `Decrease {label}` / `Increase {label}`. A screen-reader user meets two names
  for one control on two screens of one app — worse than before S7, when both
  were hand-rolled and incoherent in the same way. It closes when Add gear folds
  into `Stepper`, which is possible today and merely undone (`Stepper`'s
  contract takes `number | null`); what Add gear still needs from its own
  component is a `<label htmlFor>`, its `OPENS EMPTY — GATES THE CTA` fact line,
  and a CTA gate computed from the parsed value.
  [`frontend-design.md`](frontend-design.md) §5, anchor: `aria-label="Fewer"`
- **Print gets one viewport.** §6 promises nav hidden, single column,
  ink-on-white and truncation expanded; the first and third are written, and
  nothing unpins `.shell__main`'s inner scroller or re-enables the ellipsis
  rules, so a long Depot prints whatever was on screen.
  [`frontend-design.md`](frontend-design.md) §6, anchor:
  `prints one viewport`
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
- **`ui/`'s `Popover` is unbuilt and has three waiting callers.** §4a's desktop
  tag picker, S8's Piece picker and S9a's Piece status sheet are all popovers
  from Split up on the boards, and all three are approximated by `Sheet`'s
  `desktopCard` until the primitive lands.
  [`frontend-design.md`](frontend-design.md) §5, anchor:
  `is the one with waiting callers`
- **`AddGear`'s CTA is not pinned to the thumb zone**, where `NewTrip`'s and
  `Trip`'s are. Three fields do not fill a phone, so the primary and the fact
  line beneath it sit mid-screen on exactly the device the thumb zone exists for.
  [`design/README.md`](design/README.md) §5, anchor:
  `` `AddGear` still has (3) ``
- **`ui/Sheet` renders every title in the display face**, and `Screens B` 02A
  draws `SET PHASE` as a mono eyebrow. Restyling the primitive is wrong — every
  other sheet and confirm in the app is sentence case and belongs in display — so
  the fix is an opt-in prop that one caller passes, parked for whichever slice
  next opens `ui/`'s overlay primitives.
  [`architecture-design.md`](architecture-design.md) §12.11, anchor:
  `` `titleTone` on `Sheet` that `PhaseSheet` alone passes ``
- **`InvitePreview` carries no person name**, so the join confirm's `YOU JOIN AS`
  and `INVITED BY` lines and the success frame's `Els · Veldkamp` are
  half-buildable and neither frame renders them. Widening the auth contract on a
  slice's last task was refused deliberately; `household_seq` on the join
  response is a candidate for the same trip if one is ever made.
  [`architecture-design.md`](architecture-design.md) §12.2, anchor:
  `` still owe `person_name` ``
- **The primary font is not preloaded.** §7 says `<link rel="preload">` the
  Spline Sans woff2; `app/index.html` carries no such link.
  [`frontend-design.md`](frontend-design.md) §7, anchor:
  `not yet written`
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
- **`desktopCard` is a per-slice choice masquerading as a rule.** Five sheets
  pass it with no board drawing them as a popover, while their nearest
  siblings do not, so at Desktop the Owner picker is a centred card and the
  Home picker a bottom sheet on the same edit sheet. Wants a design ruling,
  not a code change — and so does the card confirms' Cancel-first versus
  Action-first order, which the S3-era and S9 boards draw differently.
  [`patterns.md`](patterns.md) §4.5, anchor:
  `no board draws as a popover`
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

- **`SliceBar`'s filter plumbing is reproduced in `DepotPicker`.** About
  fifty-five lines — `withFilters`, `apply`, `remove` and both chip-row
  blocks — near-verbatim. Reusing `SliceBar` itself is genuinely wrong (it also
  draws the count line, `CLEAR (n)` and the arrange readout, none of which the
  picker wants), but the *logic* could be extracted. `dimensionsFor` already
  derives from `DIMENSIONS` with a named exclusion list, so a later slice's
  dimension reaches both bars — this is duplication, not divergence.
  [`frontend-design.md`](frontend-design.md) §5, anchor: `withFilters`
- **`ReopenConfirm` reads the store; `ActivationConfirm`, its twin, takes
  `groups`.** Two facts-only confirms with one anatomy and two data-flow
  shapes; the lift is `groups` as a prop from `PhaseSheet` and `Trips`, which
  already compute them. `TripCard` has the same shape of debt at one read.
  [`patterns.md`](patterns.md) §5.2, anchor:
  `computes its own groups`
- **The mono-caps label is the most-copied rule in the codebase, and the
  small sizes have no token.** Seventy-six uppercase-label rules across
  twenty-nine modules, nineteen carrying the full three-line recipe verbatim;
  ~170 `font-size` declarations set a raw `rem` because the boards specify
  mono at 8.5–10px and the token scale stops at 11. A shared class and two or
  three small `--text-*` pairs would close most of it.
  [`patterns.md`](patterns.md) §6.2, anchor:
  `most-copied rule`
