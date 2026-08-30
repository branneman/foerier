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
- **`ui/`'s `Popover` is unbuilt and has a waiting caller.** §4a's desktop tag
  picker is a popover on the boards and is approximated by `Sheet`'s
  `desktopCard` until the primitive lands.
  [`frontend-design.md`](frontend-design.md) §5, anchor:
  `§4a's desktop tag picker is approximated by`
- **Two of §5's `ui/` composites are still in `app/`.** `TripCard` and
  `WhereaboutsCard` are named there and live in `app/src/components/`, each with
  one caller — and a second caller is the bar both moves so far have cleared
  (`GearRow`, `ExpiryChip`). `WhereaboutsCard` wants only that caller;
  `TripCard` reads the store, which §5's hard rule forbids in `ui/`, so it owes
  a lifted read as well. [`frontend-design.md`](frontend-design.md) §5, anchor:
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
