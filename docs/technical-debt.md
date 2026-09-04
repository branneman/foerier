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

Four rules keep the shape:

- **Pointers run one way: index → doc.** Never add a back-reference from a
  durable doc to this file. Each doc has to stay readable, and correct, alone.
- **Every entry carries a verbatim anchor** — a phrase from the owning document,
  chosen because it _disappears_ when the debt is paid. Staleness is then
  detectable rather than remembered: `grep -rF "<anchor>" docs app/src api/src`.
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
- **`InviteIssued` draws no sync line at Split**, the one mode where nothing
  legible states sync status — the rail gives a bare 6px dot with the words on an
  `aria-label`. Blocked on a board rather than on the rule: no frame draws this
  screen at Split at all. [`frontend-design.md`](frontend-design.md) §3.3, anchor:
  `sync half has no drawn answer`
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
  `desktop tag picker is approximated by`
- **Three of §5's `ui/` composites are still in `app/`.** `TripCard`,
  `WhereaboutsCard` and — since S9a — `JourneyRail` are named there and live in
  `app/src/components/`, each with one caller, and a second caller is the bar
  both moves so far have cleared (`GearRow`, `ExpiryChip`).
  `WhereaboutsCard` wants only that caller; `TripCard` reads the store, which
  §5's hard rule forbids in `ui/`, so it owes a lifted read as well; and
  `JourneyRail` reads the stage table from `shared/`, which `ui/` does not
  depend on. [`frontend-design.md`](frontend-design.md) §5, anchor:
  `` still in `app/src/components/` with one caller each ``
- **`DepotState` is a misnomer** — it is the fold of everything, Trips included.
  The rename reaches `DepotStoreState`, `DepotProvider`, `useDepot`, `DepotView`
  and every screen in three workspaces; it was held back by S5 being in flight
  across those same files, and that reason has expired.
  [`architecture-design.md`](architecture-design.md) §12.11, anchor:
  `the rename is now a self-contained job`
- **`InvitePreview` carries no person name**, so the join confirm's `YOU JOIN AS`
  and `INVITED BY` lines and the success frame's `Els · Veldkamp` are
  half-buildable and neither frame renders them. Widening the auth contract on a
  slice's last task was refused deliberately; `household_seq` on the join
  response is a candidate for the same trip if one is ever made.
  [`architecture-design.md`](architecture-design.md) §12.2, anchor:
  `` still owe `person_name` ``
- **Two 401 body shapes.** `/auth/*` answers a flat `{ "error": "unauthorized" }`
  and `/sync/*` answers [`sync-protocol.md`](sync-protocol.md) §6.3's structured
  object. Neither breaks a contract — [`auth-design.md`](auth-design.md)
  specifies no 401 body at all — but the divergence is real and the decision to
  unify is deferred rather than made.
  [`architecture-design.md`](architecture-design.md) §12.4, anchor:
  `Unifying the two shapes`, which is also the comment at `api/src/sync/routes.ts`
- **`WhereaboutsCard` collides on a second `'trip'` slice.** `HOME_LABEL` is
  hardcoded inside the map and `key={slice.kind}` repeats the moment two active
  Trips both claim one piece of Gear. The type forces the edit when that slice
  kind lands and nothing catches it before, so it is a trap laid for S9–S10
  rather than a bug today. Argued in the component's own JSDoc,
  `app/src/components/WhereaboutsCard.tsx`, anchor:
  `` collides once two `'trip'` slices exist at once ``
- **`landing/` is a redirect stub, not a workspace.** It does not build, so it
  cannot import `ui/styles/tokens.css` and its two background colours are copies
  a token change never reaches. The marketing site and the live demo on `ui/`
  components are what close it.
  [`architecture-design.md`](architecture-design.md) §12.1, anchor:
  `` until there is a `ui/` worth showing off ``
- **"an absent owned-count reads 1" is stated at five sites across two
  workspaces, and "an absent kind" has no stated reading at all.**
  `shared/src/selectors/whereabouts.ts` and `claim.ts` spell the owned-count
  default, `app/`'s `Depot.tsx` and `Find.tsx` gate the same question again,
  and the Counted gate itself is spelled at a dozen sites. The one-function
  form is an `ownedCountOf(gear)` and a `kindOf(gear)` beside `ownerOf` and
  `phaseOf`; the extraction reaches two workspaces, which is why S7 named it
  rather than took it. The drift symptom is already visible: gear detail
  draws `×0 OWNED` in its header, `×1` in the COUNT chips beneath and no
  segment in the meta line, for one Counted Gear with no register — and its
  edit sheet seeds `kind` and `owned_count` raw, so an untouched Save on such
  a Gear authors both. [`patterns.md`](patterns.md) §1.2, anchor:
  `one-function form is a`
- **`sequence()` is the sixth hand-rolled clock-stamper in `shared/`.**
  `trip.test.ts`, `claim.test.ts`, `entry.test.ts` and `piece.test.ts` each
  carry a byte-identical `foldAt` that flattens factory specs and stamps
  increasing HLCs, and `slice.test.ts` now carries a fifth spelling of it.
  The contract they all implement is stated once, in `aTrip`'s own
  docstring — *"they come back in authoring order, so a caller stamping
  increasing clocks over the flattened list gets exactly the log a screen
  would have written"* — so the right home is `shared/testUtils/`, beside
  that sentence. S5 found the cost: a helper that stamped one HLC across a
  multi-op factory silently produced Draft Trips where the author wrote
  `phase: 'pack_out'`. [`testing.md`](testing.md), anchor: `foldAt`
- **`SliceBar`'s filter plumbing is reproduced in `DepotPicker`.** About
  fifty-five lines — `withFilters`, `apply`, `remove` and both chip-row
  blocks — near-verbatim. Reusing `SliceBar` itself is genuinely wrong (it also
  draws the count line, `CLEAR (n)` and the arrange readout, none of which the
  picker wants), but the *logic* could be extracted. `dimensionsFor` already
  derives from `DIMENSIONS` with a named exclusion list, so a later slice's
  dimension reaches both bars — this is duplication, not divergence.
  [`frontend-design.md`](frontend-design.md) §5, anchor: `withFilters`
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
- **`Depot.tsx`'s `metaFor` computes `×N` inline rather than calling the
  `qtyFor` beside it.** S7 exported `qtyFor` so `DepotPicker` could draw the same
  suffix; `metaFor`, four lines above it in the same file, still spells the
  Counted gate and the count out again. Two computations of one drawn value, in
  one file. [`frontend-design.md`](frontend-design.md) §5, anchor:
  `` `metaFor` ``
- **The E2E golden path has stalled two steps behind the app.** Tier 5's journey
  is meant to grow a leg per slice, and three slices have shipped a step without
  one: S6 made *build a trip* reachable, S7 the gear list it needs, and S9a
  *pack an item* — the fifth step by name. The specs still stop after *find it*,
  so the two most-used screens in the product are covered by no tier above
  component tests, and nothing failed when they were skipped, which is why it
  went unnoticed for three slices rather than one.
  [`testing.md`](testing.md) Tier 5, anchor:
  `Three legs are owed and not written`
- **The resilience layer's `ErrorBoundary` is drawn and not built.** §6 gives
  a component crash a home in `ui/ErrorBoundary`, wrapping each screen and
  panel with an in-place ledger-voice fallback; nothing of the kind exists and
  `main.tsx` mounts `<App/>` bare, so one card's render error is a white page
  for the whole app. The other two unbuilt homes — the `motion` module and the
  chunk-load reload handler — are moot until a module declares a transition
  or a route is code-split, and become due the same day.
  [`frontend-design.md`](frontend-design.md) §5, anchor:
  `no error boundary exists in`
- **Print gets one viewport.** §6 promises nav hidden, single column,
  ink-on-white and truncation expanded; the first and third are written, and
  nothing unpins `.shell__main`'s inner scroller or re-enables the ellipsis
  rules, so a long Depot prints whatever was on screen.
  [`frontend-design.md`](frontend-design.md) §6, anchor:
  `prints one viewport`
- **The primary font is not preloaded.** §7 says `<link rel="preload">` the
  Spline Sans woff2; `app/index.html` carries no such link.
  [`frontend-design.md`](frontend-design.md) §7, anchor:
  `not yet written`
- **The store's `refusal` channel has no reader.** An op that could not be
  written — a 16 KB overflow, an IndexedDB failure — sets `depot.refusal`
  and is logged to the console, and no screen draws it, so the Quartermaster
  learns nothing. Blocked on a board: no frame draws a refused write.
  [`patterns.md`](patterns.md) §2.5, anchor:
  `read by no screen`
- **`ReopenConfirm` reads the store; `ActivationConfirm`, its twin, takes
  `groups`.** Two facts-only confirms with one anatomy and two data-flow
  shapes; the lift is `groups` as a prop from `PhaseSheet` and `Trips`, which
  already compute them. `TripCard` has the same shape of debt at one read.
  [`patterns.md`](patterns.md) §5.2, anchor:
  `computes its own groups`
- **Nine touch controls between 32 and 40px carry no hit extension.**
  `TripCard`'s phase chip, `ui/Chip`'s two sizes rendered as buttons, the
  slice bar's readout, `TagPicker`'s remove, `SortGroupSheet`'s rows,
  `GearDetail`'s segments (whose parent's `overflow: hidden` would clip one),
  the Split rail's links and the inline Save/Cancel pair copied into four
  pickers. Each wants ruling O's `::after` with a clamp chosen against its own
  row, and the chip's trip-screen twin already has it.
  [`patterns.md`](patterns.md) §6.5, anchor:
  `carry no extension`
- **`desktopCard` is a per-slice choice masquerading as a rule.** Five sheets
  pass it with no board drawing them as a popover, while their nearest
  siblings do not, so at Desktop the Owner picker is a centred card and the
  Home picker a bottom sheet on the same edit sheet. Wants a design ruling,
  not a code change — and so does the card confirms' Cancel-first versus
  Action-first order, which the S3-era and S9 boards draw differently.
  [`patterns.md`](patterns.md) §4.5, anchor:
  `no board draws as a popover`
- **Who closes a picker after a pick is decided per component.** `PackPicker`
  and `PhaseSheet` close themselves; `HomePicker`, `OwnerPicker`,
  `ParticipantPicker` and `SortGroupSheet` are closed by the caller. A new
  caller of the second group that forgets `setOpen(false)` gets a sheet that
  stays up after a tap. [`patterns.md`](patterns.md) §4.3, anchor:
  `decided per component`
- **Three `ui/` primitives are hand-rolled at three or more sites.** The
  segmented control in `AddGear`, `GearDetail` and `Packing`; a status pill in
  `PackingRow` and `PieceStatusSheet`; the avatar circle in `Account` and
  `AppShell`, which predates `PersonCircle`. Each is on §5's list and each has
  reached the bar `GearRow` and `ExpiryChip` moved on.
  [`patterns.md`](patterns.md) §5.5, anchor:
  `segmented control is hand-rolled`
- **The mono-caps label is the most-copied rule in the codebase, and the
  small sizes have no token.** Seventy-six uppercase-label rules across
  twenty-nine modules, nineteen carrying the full three-line recipe verbatim;
  ~170 `font-size` declarations set a raw `rem` because the boards specify
  mono at 8.5–10px and the token scale stops at 11. A shared class and two or
  three small `--text-*` pairs would close most of it.
  [`patterns.md`](patterns.md) §6.2, anchor:
  `most-copied rule`
- **`N INSIDE` counts the container tree, not what rides along.** `Packing`'s
  `insideCount` reads `subtreeOf` on the trip containment view, which builds
  from every Entry's raw residence register — per-person ones included, the
  fold-but-ignore register a peer build may write — so the container-move
  confirm can name pieces the group's rows do not show. The count should come
  from the items' resolved residences.
  [`sync-protocol.md`](sync-protocol.md) §4.4, anchor:
  `must come from the items' resolved residences`
- **Thirty Tier 3 suites hand-roll the same scaffolding.** `noopEngine`,
  `anAuthor()`, the store-and-seed block and the router-and-provider wrapper
  are copied per file; only the `matchMedia` stub was centralised. The render
  helper it wants is the shape `screenBand.test.tsx` already carries.
  [`testing.md`](testing.md) Tier 3, anchor: `hand-rolled per suite`
