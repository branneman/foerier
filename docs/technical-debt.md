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
  `itself floored`
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

- **Add gear says `RECORDED` for a write that was refused.** `submit` calls
  `emit`, which is fire-and-forget by design, and sets its confirmation line
  in the same tick — so an op the store refuses leaves the screen stating
  `RECORDED · <name> → LOOSE` and `1 RECORDED` beside the shell's own
  `▲ 1 NOT SAVED`. Two surfaces, one act, opposite claims. It predates §5n
  K24 and was simply invisible before it: the refusal reached nobody, so the
  false confirmation was the only thing on screen. **Not fixed here because
  the honest fix is a design call**: awaiting `emitDurable` before confirming
  is correct and costs the batch loop an IndexedDB round trip per record,
  which is exactly the per-tap feel §3b argued for a screen over a sheet to
  get. The alternative — a confirmation that withdraws when the refusal
  lands — is a surface no board draws. `app/src/screens/AddGear.tsx`, anchor:
  `act, opposite claims`

### Traps

Correct today, and silently wrong the moment a named future slice lands.
Each entry names its trigger. Paying one after its trigger costs a debugging
session rather than an edit, because the symptom shows up somewhere else.

- **The auth limiter's per-IP key is whatever the caller says it is.**
  `clientKey` reads the first field of `X-Forwarded-For`, and Caddy's
  `reverse_proxy` *appends* to that header rather than replacing it — so a
  caller who sends one of their own keeps the first slot and can pick a fresh
  bucket per request, which is the whole of the limit. §9.4 calls this
  capacity protection rather than a security control and the secrets it sits
  in front of are 256-bit, so nothing is exposed by it; what is wrong is that
  the doc claims a per-IP limit the deployment does not deliver. The fix is
  one line of Caddy config (`trusted_proxies` / strip the inbound header) and
  it lives in the infrastructure repo, which is why it is recorded here rather
  than fixed. Trigger: any slice that leans on the limit for anything beyond
  box capacity. [`auth-design.md`](auth-design.md) §9.4, anchor:
  `The size is deployment configuration`

- **The trip's containment view restates the home one's traversal, and the
  two must not drift.** `shared/src/selectors/tripContainment.ts` reimplements
  `containment.ts`'s walk and its sorted-id determinism over a different
  pointer type. The duplication is deliberate — the two worlds resolve against
  different things, and a shared implementation would take a strategy object
  for every line — and the **cycle break**, the half whose divergence would be
  silent, is now pinned for both by `shared/src/selectors/cycleBreak.test.ts`.
  What is still un-guarded is the rest of the traversal: the four loose
  reasons and the sorted iteration are asserted per file, so a drift in either
  fails only its own suite and nothing compares them. Argued in the module's
  own header, `shared/src/selectors/tripContainment.ts`, anchor:
  `non-drift is the obligation it`

### Specified and not built

A board or a design doc settles it and the code has never caught up.
Actionable without a new decision; the size runs from a `<link>` tag to a
second pane.

- **The two-pane Add gear is drawn and not built.** `Add gear — split 900` draws
  the form as a pane with the Depot list kept beside it; `<Route path="/add">`
  renders it standalone at every width — unlike S7's gear-list builder, which
  the app did build as a second two-pane view. That is why `AddGear` answers
  `splitPane: false` against its own frame and still draws `‹ DEPOT` at Split,
  and why its CTA fact line has only one alignment to say. **§5n K20 blessed
  the frame** and stated what lands with it so no further design is needed:
  `splitPane: true`, no `‹ DEPOT` at Split, the 40px inline primary with the
  fact line beside it in the same row (K9's other half), and the pane's own
  scroller (K21, the entry below). The asymmetry with the retired two-pane
  Trips is the ruling's own: **one pane is a reference, the other was a
  menu** — the left pane here holds the Depot list you are recording *into*,
  and watching it grow row by row is the feedback the batch loop has no other
  source for. [`frontend-design.md`](frontend-design.md) §3.3, anchor:
  `two-pane Add gear has never been built`
- **A pane's scroll offset cannot survive a route change, because the screen
  boundary is keyed on the location.** §5n K21's *each pane scrolls itself*
  and *a pane resets on its own route* both landed (`usePaneScroll`,
  `DepotView.module.css`, `GearListBuilder.module.css`, measured in a browser:
  the panes overflow and `.shell__main` does not). What did not is **the list
  pane's offset persisting across every detail navigation**: `AppShell` gives
  the screen's `ErrorBoundary` `key={location}`, so every navigation remounts
  the whole view and a remounted pane starts at the top whatever the hook
  does.
  **The fix is to move the boundary into the panes**, which is already the
  app's shape one level down — `TripPanels` wraps each panel in its own
  boundary keyed on its own index. The reason it is recorded rather than done
  is that `AppShell`'s comment argues the current key explicitly and rejects a
  coarser one (*a crash is not a scroll offset, and the Depot list and a gear
  detail are two screens even where they share one scroller*) — an argument
  made before panes had boundaries of their own, and one whose answer changes
  where a crash is contained. It also needs `/` and `/gear/:id` to be **one**
  route, since `Switch` unmounts across two; a `RegExp` path does that and
  costs `useParams` its named params, so `GearDetail` would take its id as a
  prop. Blocks story 38 from doing the honest thing at Split.
  `app/src/shell/usePaneScroll.ts`, anchor: `while the other does not`

- **Four mono labels sit at 8px, below the type ladder's floor.**
  `Account`'s and `Devices`' and `People`'s badge and `JourneyRail`'s stage
  chip each spell `font-size: 0.5rem` beside `var(--font-mono)`, and §5n K28's
  four-step ladder bottoms at `--text-label-head`, 8.5/11.5. They are not a
  migration this pass missed — `typeScale.test.ts` bans the four *step* sizes
  as raw rems and 8 is not one of them — they are four rules at a size the
  scale does not carry. Either they take the head step or the ladder grows a
  fifth, and K28b's own precedent says a step change is a round's call and not
  a screen's. [`docs/design/README.md`](design/README.md) §5n, anchor:
  `the four-step type ladder`
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

**Empty, as of the post-MVP round** (`docs/design/README.md` §5n). Every
entry that stood here — Find at Desktop, the refused write, `ui/Popover`, the
join confirm's two blocked rows, the small end of the type scale — was either
built, moved to *Specified and not built* with a ruling behind it, or closed
as a decision. The heading stays because the category is real and the next
slice will fill it again; an empty section is a statement, and deleting it
would lose the one it is making.

