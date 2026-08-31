# CLAUDE.md

Guidance for working in this repository.

## What foerier is

A quartermaster's tool for a household's shared outdoor gear: a year-round
inventory of what is owned and where it lives, plus the outfitting and packing
of individual trips from that depot. See [README.md](README.md) for the full
framing, [docs/user-stories.md](docs/user-stories.md) for the requirements, and
[docs/ubiquitous-language.md](docs/ubiquitous-language.md) +
[docs/domain-model.md](docs/domain-model.md) for the domain design.

## Current status

**Code has started.** Seven slices of [§8's plan](docs/architecture-design.md#8-the-slice-plan)
have landed:

- **S0, the walking skeleton** — the four workspaces (`app` · `api` · `shared` ·
  `ui`; `landing` deferred), the Tier 0 toolchain and pre-commit hook, the test
  tiers, both container images, and `GET /api/v1/version`. S0's one remaining
  gap has since been closed part-way: `landing/` exists as a **redirect stub**
  (three static files, no build) deployed to GitHub Pages by `pages.yml`, so
  `foerier.app` sends visitors to `app.foerier.app` instead of failing TLS. The
  marketing site and the live demo on `ui/` are still deferred; see
  [§12.1](docs/architecture-design.md#121-deviations-from-8s-s0-and-why) for
  what the stub does and does not carry.
- **S1, auth slice 1** (stories 26, 27) — the Maintainer bootstrap script, both
  WebAuthn ceremonies, device tokens, the auth middleware and tenancy rule, and
  the sign-in and join screens.
- **S2, the Depot** (stories 1, 2) — the op log, `/sync`, gear, Find, and
  whereabouts. S2 is the one slice in the plan that ships as **two halves**,
  S2a and S2b; see [§8.3](docs/architecture-design.md#83-the-slices) for the
  seam and [§12.3](docs/architecture-design.md#123-consequences-of-s2a-the-depot)
  + [§12.4](docs/architecture-design.md#124-consequences-of-s2b-find-whereabouts-and-the-fold)
  for what each half settled. A slice is not a commit: S2a alone landed as
  51, under the merge convention below.

**The Depot is complete, both halves.** S2a delivered eleven op types and the
reducer that folds them (`shared/`), per-field LWW by HLC, the containment
selector and its cycle break; the client's IndexedDB op log, the HLC
persisted across restarts, the outbox, the pull cursor and the dead-letter;
`POST /sync/push` and `GET /sync/pull` with gapless per-household seqs; and
the screens — F1 Add Gear, the Depot list, the gear detail. S2b delivered
story 3's Home path and whereabouts, F2 Find, and the join screen's gated
**first-sync fold** — the app's one unavoidable loading screen. **Zero new op
types and zero new endpoints**: purely additive client read-side code. A
Quartermaster can record gear on a phone with no signal, find it, and see
where it lives — all from a laptop, or from that same phone with the radio
off.

- **S3, Tags and the slicing engine** (advances story 13) — two ops, the
  composable slicing selector, `ui/`'s first composites, and the Depot's
  slice bar at all five layout modes. See
  [its spec](docs/specs/2026-08-27-tags-and-slicing.md) for the reasoning and
  [§12.5](docs/architecture-design.md#125-consequences-of-s3-tags-and-the-slicing-engine)
  for what it settled.

**S3 was the first slice designed before it was coded**, and that changed how
it was cut: the boards led and the code followed, so a handful of decisions
arrived as *departures* to be justified rather than as choices to be made. The
three worth knowing before touching this area:

- **A dimension is a row in a table** (`shared/src/selectors/slice.ts`), and
  §8.5's five later slices each add one. Arity already decides add-or-replace
  and whether a ghost chip survives; there is exactly one filter rule (every
  selected value must be carried) and deliberately no second combinator.
- **`TagString` is branded**, because there is no Tag entity and no rename op,
  so the picker is the only place a spelling is decided and the compiler is
  what points every author at it. The *reader* stays entirely tolerant — a
  non-conforming tag folds exactly as received.
- **Story 36 (Undo) being Later is load-bearing.** Add gear's `UNDO` is drawn
  and not built; the Home picker's `MOVE` gains a confirm the board does not
  draw. Both are recorded in `docs/design/README.md` §3b/§3c and revisit when
  story 36's design phase lands.

**S3.5, auth slices 3+4** (stories 29, 30) — device links and the Account
screen. See [its spec](docs/specs/2026-08-28-auth-device-links.md). It
delivered `POST /auth/device/claim` and the token-only path that needs
nothing of a Device beyond a browser, in-app device links, the Devices list,
add/remove passkey with name-on-add, and the **Account screen** — the fourth
destination, reached from the avatar in all three nav modes. No ops and no
`shared/`, so it moved ahead of S4 on the float
[§8.6](docs/architecture-design.md#86-what-can-be-built-in-parallel) granted
it. See [§12.7](docs/architecture-design.md#127-consequences-of-s35) for what
it settled.

**Four things about S3.5 are worth knowing before touching auth:**

- **The compatibility floor is wider than "cannot".** A phone can pass every
  capability check and still be unusable, because the only credential store it
  offers is one the household declined. So the token-only path is reachable
  **by choice**, not only by failure — a departure from the boards, recorded in
  `docs/design/README.md` §10, which also falsified one drawn line.
- **`invite.person_recorded` replaced a guess.** The join screen had learned
  whether the joiner names themselves from *"does this Household have any
  Login"*, which is right for the first Person and wrong for every one
  after — the second joiner got no name field and a Login pointing at a
  Person nobody recorded. The fact now lives on the Invite, stated by
  whichever code mints it; [§12.7](docs/architecture-design.md#127-consequences-of-s35)
  has the general lesson about server-side proxies for domain facts.
- **Two Maintainer scripts, `admin:invite` and `admin:list`**, because
  [auth-design §3.4](docs/auth-design.md)'s "only the first Login is arranged out
  of band" left the *second* Login with no route at all until S5, and §5's named
  escape hatch had no mechanism.
- **`clearLocalData()` finally has a caller.** The Devices screen's "sign out
  this device" confirm sheet is what calls it — the action `unsyncedCount()`'s
  own caller (`App.tsx:145`, the sign-in screen's session-lost line, §12.3)
  had been waiting on since S2. Signing out is the only auth action allowed
  to clear the op log; the **401 contract stays wired** for every other
  case — the engine reporting `signed-out` calls `handleUnauthorized()`,
  which routes to `/signin` and leaves the op log and outbox untouched
  ([auth-design §7.2](docs/auth-design.md)). A frozen engine is never
  resumed — re-signing in builds a new one — so `resumeSync()` stays for a
  future recover-in-place flow.

**Tier 4 and Tier 5 run against the box after every deploy, once the
Household is bootstrapped and the credential stored** — the two out-of-band
steps CI cannot take for itself, written up in
[the spec](docs/specs/2026-08-28-tier-4-and-5-against-production.md) §5 and
§9.3, with the consequences in
[§12.8](docs/architecture-design.md#128-consequences-of-tier-4-and-5-against-production).
Not a slice — no op type, no `shared/` — but it ends a block that had been
attributed to the golden path being incomplete and was really the absence of a
**Household CI is allowed to destroy**. `POST /api/v1/test/reset`
(`api/src/test/`) empties one: it deletes that Household's ops, its
outstanding Invites and every Passkey but the caller's, and **revokes** its
other Devices. It can never *create*, so
[auth-design §3.4](docs/auth-design.md) is untouched, and three gates hold
it — the route is not mounted unless the server was started with
`E2E_HOUSEHOLD_ID`, the calling token's Household must equal that value, and
the row must carry `disposable = true` (`admin:bootstrap --disposable`, read
under the same lock the wipe takes). Reset runs at the **start** of a run,
never as a teardown, so a cancelled run leaves a dirty Household and the next
run's first act fixes it; its returned counts double as a tripwire, since
`revoked ≤ 1`, `passkeys = 0`, `invites = 0` is the only thing that would ever
say the E2E credential had leaked. Three things to know before touching this
area: the Household and its Passkey are both **created by hand, once** —
the Passkey by `test/e2e/captureCredential.ts`, stored as GitHub secrets, and
nothing in CI can mint either; **a Device token never crosses a job
boundary**, so `contract` signs in through Tier 2s's software authenticator
and `e2e-prod` through Chrome's, each from the same credential; and only specs
tagged **`@production`** run against the box — anything that mints an Invite
by Maintainer script, proves joining, or signs the run's own Device out stays
local-only.

**The Radix conversion has landed**, discharging the condition S3.5 §10 set in
place of a fourth deferral. Every hand-rolled scrim in the app is now
`ui/`'s `Sheet` (Radix Dialog) or `Confirm` (Radix AlertDialog) — the first
of [frontend-design §5](docs/frontend-design.md)'s primitives to exist. See
[its spec](docs/specs/2026-08-29-radix-conversion.md) and
[§12.9](docs/architecture-design.md#129-consequences-of-the-radix-conversion).
It carries no §8 slice number on purpose: no story, no op, no endpoint, no
`shared/`. **Three things about it are worth knowing before touching an
overlay:**

- **It was eleven surfaces, not the "roughly six" three deferrals had
  counted** — the earlier count was of components, and three confirms nested
  inside other sheets' JSX had never been counted at all.
- **There is no `open` prop: mounted is open.** A caller writes
  `{open && <Sheet …/>}`, and mount is what resets a picker's drafts —
  `HomePicker` used to keep EDIT mode and four drafts across a close. An exit
  animation would need the prop back.
- **A picker dismisses on the scrim; a decision does not.** `Confirm`
  withholds it, which is Radix's AlertDialog default and the right one:
  `Sign out this device?` can be part-way through `clearLocalData()`. Escape
  closes both.

**S4, People and ownership, has landed** (story 4). Two ops —
`person.renamed` and `gear.ownership_set` — the People screen, the owner
picker, owner on Add gear, on gear detail and in the Depot's rows and OWNER
column, and **Ownership and Person as two more rows in S3's dimension table**
plus `GROUP BY OWNER`. No endpoints and no migration. See
[its spec](docs/specs/2026-08-29-people-and-ownership.md) and
[§12.10](docs/architecture-design.md#1210-consequences-of-s4-people-and-ownership).

**Three things about S4 are worth knowing before touching People or
ownership:**

- **Two dimensions over one register, and the contradictory pair is recorded
  rather than guarded.** The folded state is one `owner` register, and one
  merged `OWNER` dimension would have expressed both of story 4's narrowings
  with a single chip — but Components §04 draws `PERSON · S4` and
  `OWNERSHIP · S4` as two dashed ghosts, and the second row buys the query the
  merge cannot: *all* personal gear, whoever's. The price is that
  `OWNERSHIP: SHARED` + `PERSON: ELS` is reachable and always empty. Not
  guarded: the engine has exactly **one** filter rule, `0 OF N` is the honest
  answer, and a second combinator between dimensions is precisely what S3
  refused to build.
- **An absent `owner` register reads `SHARED`, and only
  `shared/src/selectors/owner.ts` says so.** The fold conflates nothing —
  absent and `{type:'shared'}` stay different facts about the log — but every
  reader treats them alike, and the Ownership dimension derives its values from
  that one function. A call site that re-derives the rule will drift from the
  filter, and the symptom is a row labelled `SHARED` vanishing under
  `OWNERSHIP: SHARED`. It is also why gear detail's Edit sheet seeds its draft
  through `ownerOf`: reading the raw register would make every Save on pre-S4
  gear author an op, and a needless write moves `recordedAt` and reorders
  `NEWEST FIRST`.
- **The People screen is the board's minus its entire login half, and what it
  leaves empty is S5's stated debt.** The row's meta slot, the circle's
  accent-border login encoding, and the `PEOPLE` → `PEOPLE & LOGINS` rename all
  wait on `GET /auth/logins`. Drawing every circle as "no login" would render
  the joiner, who demonstrably holds one, as having none — so it draws neutral.
  The three obligations are listed in the spec's §7 and in
  `docs/design/README.md` §13.

**Add gear gained an `OWNER` row, which is a departure from a settled board.**
Recorded in `docs/design/README.md` §3b beside the `UNDO` note, for the same
kind of reason: without it, attributing a two-hundred-item depot is two hundred
gear-detail visits, and the bulk `SET OWNER` band is story 35, Later. It
carries over between records exactly as `HOME` does, and leaving it at `Shared`
writes **no** register at all.

**S6, Trips and phases, has landed** (story 5; advances story 32, the phase
machine). Six op types — `trip.created`, `trip.renamed`, `trip.dates_set`,
`trip.phase_moved`, `trip.participant_added`, `trip.participant_removed` — the
fourth aggregate reaching the fold, `shared/src/selectors/trip.ts`, three
components (`TripCard`, `PhaseSheet` with `ReopenConfirm`,
`ParticipantPicker`) and three routes (`/trips`, `/trips/new`, `/trips/:id`).
No endpoints, no migration, and the slicing engine untouched — Trip membership
is S7's row in the dimension table. See
[its spec](docs/specs/2026-08-29-trips-and-phases.md) and
[§12.11](docs/architecture-design.md#1211-consequences-of-s6-trips-and-phases).

**Four things about S6 are worth knowing before touching Trips or phases:**

- **Every question the phase table answers has exactly one function beside it,
  and the lookup itself is private.** `phaseOf`, `isActive`, `phaseLabel`,
  `phaseName`, `phaseNext` and `isKnownPhase` each answer one question in one
  way; the row lookup **five** of them share is unexported precisely so no
  call site decides for itself what a missing row means (`phaseOf` is the
  sixth and reads the register rather than the table, so it is the one that
  never asks). `isActive` is the **only** definition of active-ness in the
  codebase, and S7's claim selector, S9's whereabouts and S10's close gate all
  call it. This is not theoretical tidiness: three separate reviews in this
  slice caught a call site re-deriving one of them.
- **An absent `phase` register reads `draft`, and only
  `shared/src/selectors/trip.ts` says so** — S4's `ownerOf` rule transplanted,
  with the same symptom when it drifts (a Trip listed in one section drawn with
  another section's chip). It is reachable because `trip.created` and
  `trip.phase_moved` are the register's only writers while `writeTrip` creates
  the entity for *any* Trip op: a `trip.renamed`, a `trip.dates_set` or a
  participant op landing before the creation leaves a Trip with no phase. An
  out-of-order `phase_moved` is **not** such a case — it writes the register
  unconditionally, so that Trip has a phase before it has a name. Relatedly,
  **`phase = "draft"` is the reducer's write at `trip.created`, not a payload
  field** — which is what makes an out-of-order `phase_moved` win on its own
  clock, a re-delivered creation idempotent, and a Trip that arrives already
  `closed` unauthorable, all with no special case.
- **`DAY N` comes from the `phase` register's own stamp, so at S6 a needless
  write is *visible*.** A redundant `trip.phase_moved` resets a Trip on `DAY 12`
  to `DAY 1`, in the chip's own content — S4's "a needless write moves
  `recordedAt`", louder. That is why tapping the phase a Trip is already in
  emits nothing, and why the trip screen's EDIT mode emits one op per field
  that actually changed and none for the rest.
- **The CTA names the destination that exists.** No card carries the board's
  `Continue pack-out` or `BUILD LIST ›`, because those name screens S7 and S9
  build — a button that leads somewhere and lies about where is worse than a
  missing one. The general rule, recorded in `docs/design/README.md` §5 beside
  the other S6 departures: **a board's CTA copy lands on the slice that builds
  the board's destination.** (The interim `OPEN ›` that first stood in its place
  has since been retired; see the design round below.)

**S6 also paid S4's fixture debt.** S4's spec said the fixture rule "applies
unchanged" and no file landed, so `person.renamed` and `gear.ownership_set` —
two op types whose wire format [sync §5.4](docs/sync-protocol.md) had already
frozen — were pinned by nothing. `s4-ownership.ops.json` is captured a slice
late, and `shared/src/fixtures.s4.test.ts`'s header says so: a drift between S4 and S6 is now baked into
the snapshot as though it had always been the format. The lesson generalises
past fixtures, and is written into [`docs/testing.md`](docs/testing.md): a spec
sentence saying a standing rule applies produces no artefact, and no tier
notices its absence.

**A design round has since redrawn every one of S6's Trips surfaces**, against
a new board round at `Screens B` **02A**. No new op types, no endpoints, no
migration; `shared/` moved only for two copy strings and `UNNAMED_PERSON`, the
sentinel `personLabel` returns, hoisted out of five hardcoded literals.
`OPEN ›` is retired and the whole card is tappable; Participants left EDIT for
the resting screen (gear detail's tag chips), leaving EDIT holding name and
dates under one commit model; a reversed date range is reported (`▲ ENDS BEFORE
IT STARTS`) rather than guarded; the trip screen gained its own 1024 frame.
The dated spec is **not** rewritten —
[its §10](docs/specs/2026-08-29-trips-and-phases.md) lists what the round
superseded, and `docs/design/README.md` §5 is the shipped authority.

**Three things about it are worth knowing before touching these surfaces:**

- **The NEXT line is permanent, and the progress line comes back *below* it.**
  This is the thing S7 and S9 will otherwise get backwards — §12.11 said "above"
  until this round, and the board says `NEXT LINE SITS ABOVE THE PROGRESS LINE.`
  in as many words. It draws on every non-closed card, drafts included, and it
  belongs to **the card and not the trip screen**: a next-step line is a
  list-scanning affordance, and on the trip screen the chip already states the
  phase and the empty region the task.
- **`container-type` makes an element the containing block for its
  `position: fixed` descendants.** A FAB inside `.screen` is fixed to a box whose
  height is the content's, not to the viewport — invisible on a long Depot list,
  obvious on a one-card Trips list where it lands beside the title and scrolls
  away. It had shipped that way on Depot since S3. Both screens now return a
  fragment with the FAB as the screen's sibling; the container stays, because the
  card and row folds resolve against it. jsdom computes no layout, so both tests
  assert the **shape** — the FAB is not contained by the element declaring the
  query container.
- **A screen draws its own sync line at Split and only at Split, and its own
  back link unless the destination is already on the page.** `AppShell` states
  the status in words in the phone header and in the Desktop sidebar, and draws
  a **bare 6px dot** on the Split rail — so Split is the one mode where nothing
  legible says it. The back link turns on a different fact: never at Desktop,
  where the labeled sidebar is the destination, and at Split only for a screen
  that is not a pane — `GearDetail` has the Depot list beside it there and
  `Depot split` draws no `‹` at all, while a Trip has no two-pane view at any
  width. One hook, `useScreenHeader`, taking a `splitPane` placement, is the
  only place that says so ([frontend-design §3.3](docs/frontend-design.md)).
  **The round shipped this inverted and review caught it**, which is why
  `app/src/shell/screenBand.test.tsx` renders a screen *inside* `AppShell` and
  counts: the per-screen suites render without the shell, so their absence
  assertions prove one side of a two-sided fact. **The hook's reach was every
  screen that draws either half of the band — eight at this point, ten once
  S7 adds its two:** `AddGear`, `GearDetail`, `Trip`, `NewTrip`, `Account`,
  `People`, `Devices` and `InviteIssued`, the last of which draws a back link
  and no sync line, so it gates its band on `backLink`. `splitPane` is true
  for `GearDetail` alone; `AddGear` answers `false` against its own board
  frame, because `Add gear — split 900` draws a pane the app has never built
  and `<Route path="/add">` renders it standalone at every width.

**S5, auth 2, has landed** (story 28) — the second Quartermaster is now
arranged from inside the app rather than by whoever runs the server. No
ops and `shared/` untouched, as at S3.5. One migration, `0006_login_reinvite`,
makes `login`'s uniqueness partial so a revoked Person can hold a Login
again. `GET /auth/logins` and `DELETE /auth/logins/:id` are new; `POST ·
GET · DELETE /auth/invites` widen to take an optional `person_id` for both
purposes and to scope list/revoke **by purpose** rather than always by
issuer. People becomes **People & logins**, filling the login half S4 left
empty; `DeviceLink.tsx` becomes `InviteIssued.tsx`, one screen for a join
Invite and a device link across three entry points. See
[its spec](docs/specs/2026-08-29-in-app-invites-and-logins.md) and
[§12.12](docs/architecture-design.md#1212-consequences-of-s5-in-app-invites-and-the-logins-list).

**Three things about S5 are worth knowing before touching auth again:**

- **Purpose scopes listing and revoking, and it is one sentence, not a
  flag.** A join Invite creates a Login, which is Household business — any
  member may see and revoke it. A device Invite is a credential for one
  Login and stays with its issuer. Both `listInvites` and `revokeInvite`
  carry the same predicate, `purpose = 'join' or created_by_login = <caller>`,
  and a future purpose should extend that sentence rather than grow a second
  mechanism beside it.
- **A device link the Maintainer mints is invisible to that predicate,
  forever, and this was true before S5 too.** `mintDeviceLink`
  (`admin:invite`'s device path) has always inserted `created_by_login:
  null`, since there is no signed-in caller to name — no `loginId` equals
  `null`, so such a row can never be listed or revoked through
  `/auth/invites` by anyone. Recorded rather than fixed, in
  [auth-design §9.1](docs/auth-design.md#91-endpoints): the obvious fix
  would make every Maintainer-minted device link revocable by any member,
  a policy call this design has not made. It expires in an hour regardless —
  `admin:list` does not show it; it prints only Households and their Logins.
- **An encoding inherited as "meaningless for now" becomes load-bearing the
  moment a slice gives it meaning.** S4 drew the person circle's control
  border with *no meaning attached*, so its offline render could call that
  border neutral. S5 makes the same border mean `= no login` — and every
  fallback that leaned on its emptiness silently became a false statement.
  The boards' answer is a **withdrawal**, not a third colour: the ring *is*
  the claim "login state is known", so when the list cannot load the ring
  goes with it (`docs/design/README.md` §13). A third colour was tried first
  and collapsed in the parchment theme, where every `--color-rule*` resolved
  to one value. Two habits come out of it — **timestamps render in the
  reader's local time** through the one formatter in `app/src/format.ts`
  (`app/vitest.config.ts` pins `TZ=Europe/Amsterdam` so the assertions mean
  something; under UTC they would pass against the bug they exist to catch),
  and **a decision taken in code that no board draws gets written down and
  challenged**. S5's audit found twelve; the boards blessed ten and
  overturned two, both of them copy.

**S5 landed after S6, which is the one place the slice order does not match
[§8](docs/architecture-design.md#8-the-slice-plan)'s.** It was next after S4,
which unblocked it (story 28 issues Invites for People recorded under story 4,
[§8.2](docs/architecture-design.md#82-four-stories-accrete-across-slices-rather-than-landing-in-one)),
and S6 took the float
[§8.6](docs/architecture-design.md#86-what-can-be-built-in-parallel) grants
rather than idling behind it — an auth slice shares no op type and no
`shared/` file with the Trip, so the two never met. S7 landed after S5, back
in step with §8's order.

**S7, the gear list, has landed** (story 6; advances story 7, Bring-count,
story 32, the overlap guard, and story 13, the Trip-membership dimension).
Three op types — `trip.entry_added`, `trip.entry_removed`,
`trip.entry_bring_count_set` — the Trip's first **nested entity map**
(`entries`, a `Record` of entities rather than the sets `participants` and
`tags` use), `shared/src/selectors/entry.ts` and `claim.ts`, three routes
(`/trips/:id`, `/trips/:id/add`, `/trips/:id/list`), and the **over-claim
surfaced rather than prevented** — a standing band, never a block, never
dismissible. No endpoints, no migration. See
[its spec](docs/specs/2026-08-29-the-gear-list.md) and
[§12.13](docs/architecture-design.md#1213-consequences-of-s7-the-gear-list).

**Six things about S7 are worth knowing before touching Entries, claims or
the builder:**

- **`source` is one register holding a discriminated union, and a trip-only
  Entry cannot be renamed.** Renaming would rewrite `name` and `container`
  together, and two Devices renaming concurrently would each clobber the
  other's trait. The catalogue defines three gear-list ops and none is a
  rename — a deliberate omission, not a gap — and the UI states nothing about
  it: a missing op is a fact for the docs, not release meta-text for a
  Quartermaster mid-sitting.
- **An Entry with no `source` gets no default, unlike `phase` and `owner`.**
  S6 reads an absent `phase` as `draft`; S4 reads an absent `owner` as
  `SHARED`. An Entry naming neither a piece of Gear nor a trip-only name is
  not a line anybody can draw a default for, so it is folded, retained, and
  excluded from the list, from every count and from every claim —
  `entriesOf(trip, state)` is the one place this is stated.
- **Invariant 6 is the authoring screen's job, not the reducer's** — the
  `TagString` split restated for a second op. A Bring-count cannot be gated in
  the reducer, because the Kind it depends on lives on the Gear aggregate, a
  different aggregate with no ordering against the Trip's; gating there would
  make the fold order-dependent on whether `gear.kind_set` had arrived first.
  `bringCountOf` is one of several sites gating on `kind === 'counted'`
  (`shared/src/selectors/depot.ts`, `shared/src/selectors/whereabouts.ts`,
  `app/src/screens/GearDetail.tsx` and `app/src/screens/Depot.tsx` among the
  others), and the reader folds a Bring-count on any Entry regardless of what
  the authoring screen would ever offer.
- **The over-claim view is a pure function of the fold, with no op, no flag
  and no write of its own.** `overClaims(state)` reads registers only, so
  every replica computes the identical set, and it disappears only when a
  Quartermaster removes an Entry or lowers a Bring-count — both ordinary ops.
  Nothing is discarded to resolve a forbidden state, which is story 6's
  closing sentence. `overClaimsIfActive` answers the hypothetical three
  guarded moments ask (adding to an active Trip, activating a Draft,
  reopening a closed one) and is **deliberately unscoped to a `tripId`**, so
  every caller that gates a decision on it — `ActivationConfirm`,
  `ReopenConfirm`, `GearListBuilder`'s `Start pack-out` — must filter through
  `overClaimGroups` first; gating on the raw result opens a confirm naming a
  conflict between two other Trips entirely.
- **Trip membership is the first dimension `sliceDepot` cannot answer from a
  Gear's own registers in constant time.** Answering it per Gear means
  scanning every Trip's Entries — O(gear × entries) on the Depot's
  most-visited screen — so `slice.ts` carries a module-level
  `WeakMap<DepotState, …>` memo, keyed on the fold's own immutable identity,
  rather than a change to the dimension table's signature. The next
  cross-aggregate dimension should expect to need the same memo, not a new
  mechanism.
- **Ten sentences in this spec turned out false once the code existed, and
  are recorded rather than corrected in place** — the same shape this
  document's own S4-fixture lesson already names, and the precedent
  `trips-and-phases.md` §10 sets: a dated spec is left as it was written, and
  what changed lives in its own new [§11](docs/specs/2026-08-29-the-gear-list.md#11-what-changed-during-implementation),
  not edited back into the sections it corrects. The one most likely to bite
  a future reader: `ui/Stepper` ships with **two** callers, gear detail and
  the gear list, not three — Add gear's Owned-count well must stay
  representable as *unset* to gate its CTA. **The fold is possible and
  deferred, not impossible**: `Stepper`'s contract widened to
  `value: number | null` partway through this same slice, after the
  not-convert decision was made for a different reason; what Add gear's own
  field still owns is a label, a fact line and a CTA gate computed from the
  raw string, not a channel `Stepper` categorically lacks. The rest are
  listed in full in the spec's own §11 and summarised in
  [§12.13](docs/architecture-design.md#1213-consequences-of-s7-the-gear-list).

**A design round has since ruled on all fifteen decisions S7's code took
because no board reached them** (`docs/design/README.md` §5b, items A–O;
`S7 Amendments - Rulings A-O.dc.html`). Nine were blessed, six redrawn. No op
types, no endpoints, no migration. The dated spec is not rewritten —
[its §12](docs/specs/2026-08-29-the-gear-list.md) lists what the round settled,
and §5b is the shipped authority.

**Five things from it are worth knowing before touching these surfaces:**

- **There is no global touch-target floor any more, and there must not be
  one.** `base.css` used to carry
  `button, … { min-height: max(3rem, 48px) }`, which floors the *paint* rather
  than the hit area — and `min-height` beats `height` regardless of cascade
  layer, since layers resolve a conflict within one property and never across
  two. Every control drawn smaller was painted at 48 while its own declaration
  looked like it worked. The rule now: a drawn size is the painted size; 48
  floors the **hit area** (44 minimum) through a non-painting `::after`; that
  extension **clamps at its owning row's bounds**; a standalone control is
  simply drawn ≥48. It cannot be one declaration — what a hit area may grow
  into is a fact about the owning row, and `input`/`select` render no
  pseudo-element at all. Seventeen controls had been leaning on the floor and
  now state their own paint.
- **`UNNAMED_PERSON` is the prose sentinel; the glyph is
  `UNNAMED_PERSON_GLYPH`.** The Person now carries the split the Trip always
  had: `—` is right in a list column, a group header and a circle, and wrong in
  a sentence. `personNameOrUnnamed` decides the substitution once, exactly as
  `tripNameOrUnnamed` does.
- **The standing band is the only surface that settles.** `ActivationConfirm`
  and `ReopenConfirm` render the conflict block facts-only, because a control
  that emits inside a cancellable confirm makes `Cancel` state something false.
  `OverClaimGroups` takes one optional `SettleRoutes` prop, and its absence
  *is* read-only — grouped rather than three optional callbacks so the type
  system enforces all-or-nothing. The band itself is a property of the **gear
  list, not a route**, so it renders in the builder's right pane too.
- **The activation preview fires on any transition entering Active from
  non-Active**, both halves asking `isActivePhase` — invariant 17 makes
  pack-out, on trip and unpack equally activating, and every SET PHASE row is
  one tap. Closed → Active still gets the reopen confirm.
- **A typed `Stepper` value commits on blur or Enter, never per keystroke.**
  Per-keystroke commits authored every intermediate spelling, so `2` → `10`
  put a `1` in the log permanently. Taps stay per-tap. Relatedly, `IN LIST ✓`
  reads an optimistic set unioned into the fold, because `emit` is
  durable-first and the folded answer arrives a queue-turn after the tap —
  and **no tier can prove that timing**, since `await user.click` drains the
  queue; it lives in `KEYBOARD-PASS.md` instead.

Four conventions the code now carries that are easy to trip over:

- Relative imports in `api/` and `shared/` need an explicit **`.ts` extension**
  (Node's ESM resolver does not guess, and `node src/…` runs the dev server,
  the migration CLI, and the bootstrap script). **`app/` is the exception** —
  Vite resolves, so relative imports there carry no extension. `test/e2e/` is
  mixed for the same underlying reason: `quartermaster.ts`'s own imports carry
  explicit `.ts`, because `captureCredential.ts` imports it and is run by plain
  `node`; the specs and `globalSetup.production.ts`, which only ever run under
  Playwright, do not.
- **Ops mirror the wire** — `snake_case`, never transformed — while folded
  state and UI props are ordinary camelCase. See
  [architecture §12](docs/architecture-design.md) for that and the rest of the
  toolchain decisions.
- **`null` clears a nullable register; an absent field leaves it alone.**
  [sync §1.3](docs/sync-protocol.md) is the authority — not §5.3's obligation
  5, which runs the other way only.
- **A media query decides which panes or elements *exist*; a container query
  decides how what exists *lays out*.** Settled at S3 and written into
  [frontend-design §3.2](docs/frontend-design.md). The reason is not taste: a
  CSS-only switch between two different DOMs has to render both and hide one,
  which puts every fact in the accessibility tree twice. The fold is `38rem`,
  owned by `ui/src/GearRow.module.css`.

The repo also holds requirements plus a DDD domain
design — a [ubiquitous language](docs/ubiquitous-language.md) (the glossary) and
a conceptual, persistence-ignorant [domain model](docs/domain-model.md)
(aggregates, invariants, the two worlds of home and trip) — and now an approved
[architecture & delivery design](docs/architecture-design.md)
that settles the two formerly-open decisions:

1. **Persistence** — a per-aggregate **operation log** in Postgres; state is a
   fold of ops; per-field last-writer-wins by Hybrid Logical Clock.
2. **Tech stack** — offline-first React PWA (Vite + TypeScript) with an
   in-memory op-log store; **Hono + Kysely + Postgres** server; WebAuthn/passkey
   auth; one monorepo on the existing Hetzner box. See the spec for the full
   picture and [`docs/testing.md`](docs/testing.md) for the test strategy.

The op log itself is now specified as a concrete contract in
[`docs/sync-protocol.md`](docs/sync-protocol.md) — envelope, HLC, merge rules,
the full MVP op catalogue, and the `/sync` wire format.

**The conceptual domain docs stay persistence-ignorant.** The schema and stack
live in the architecture spec, and only there — do not smuggle tables, fields,
or framework choices into the [model](docs/domain-model.md),
[language](docs/ubiquitous-language.md), [stories](docs/user-stories.md), or
`examples/`. Extend the domain model deliberately and keep it conceptual.

## Design docs

- [`docs/ubiquitous-language.md`](docs/ubiquitous-language.md) — the glossary;
  each term means exactly one thing. Use these words, capitalised, in the user
  stories.
- [`docs/domain-model.md`](docs/domain-model.md) — the structure: aggregates,
  relationships, invariants, domain operations. Conceptual only.
- [`docs/architecture-design.md`](docs/architecture-design.md)
  — the persistence, stack, sync, auth, hosting, and delivery design. Where all
  the technical choices live. Its
  [**§8 is the slice plan**](docs/architecture-design.md#8-the-slice-plan): the
  dependency graph over the MVP stories, the ordered vertical slices, and what
  each must preserve rather than deliver.
- [`docs/sync-protocol.md`](docs/sync-protocol.md) — one level below the
  architecture: the op envelope, the HLC, conflict resolution, the **MVP op
  catalogue**, the evolution rules, the `/sync` wire format, and first-sync
  bootstrap. The contract every vertical slice is cut from, and the one interface
  that must stay forward-compatible forever.
- [`docs/frontend-design.md`](docs/frontend-design.md) — one level below the
  architecture: scaling, responsive system, CSS architecture, `ui/` package,
  resilience.
- [`docs/auth-design.md`](docs/auth-design.md) — one level below the
  architecture: enrolment, sign-in, sessions, devices, and the whole HTTP
  security surface (headers, CORS, CSP, endpoints, tables). Supersedes the
  architecture spec's §6 summary.
- [`docs/design/`](docs/design/) — the Claude Design boards (`*.dc.html`): visual
  foundations, flows, components, screens. Design intent; `frontend-design.md` is
  how it gets built.
- [`docs/testing.md`](docs/testing.md) — the permanent testing strategy (the
  seven-tier pyramid; the convergence tier is the signature).
- [`docs/technical-debt.md`](docs/technical-debt.md) — the index of outstanding
  technical work: one line per item, each pointing at the document that argues
  it plus a verbatim anchor to grep for. **Not where the reasoning lives**, and
  never pointed back at — entries are deleted when the debt closes.

Keep the design docs — stories, language, model — mutually consistent. A new or
changed concept updates the language and the model together, and the stories
adopt the term.

## Delivery model

Build in **vertical slices via XP-style continuous delivery.** Each story ships
end-to-end (server + app) as an independently valuable increment; stories are
ordered so every release gives the user something immediately usable, however
thin. No waterfall gate. A slice is naturally new op type(s) + reducer +
selector + endpoint + UI, and lands as **one reviewable unit** (it is one
monorepo) — usually one commit, but see the merge convention below: past about
a thousand lines the branch's own history is the reviewable unit and squashing
it destroys more than it tidies.

A slice's op types come from the catalogue in
[`docs/sync-protocol.md`](docs/sync-protocol.md) §4; new ones follow its naming
and evolution rules (§5).

This coexists with offline-first only under one **non-negotiable discipline:**
installed PWA clients run older app versions in the wild and may hold ops queued
offline against a previous version. So **never make a breaking lockstep change.**

- **Expand-contract migrations** — add the new shape, deploy readers tolerant of
  both, backfill, drop the old only much later.
- **Tolerant-reader, additive ops** — new fields optional; unknown fields and op
  types ignored, never rejected.

Versioning follows suit: deployables are versioned by **commit SHA** (not
semver); the API contract carries **one major in the path** (`/api/v1`), bumped
only on a genuine break; semver is reserved for the contract, not sprayed across
artifacts with no external consumer.

## Working conventions

- **Keep the stories at problem level.** User stories describe needs and
  behaviour, not representations; the domain design lives in its own docs. When
  tempted to write a _story_ in terms of tables, fields, screens, or objects,
  stop — frame it as a user need instead. The domain model may name aggregates
  and invariants, but it too stays conceptual: no tables, fields, or storage —
  that is persistence modeling, still a separate, later phase.
- **Challenge with reasoning; concede to evidence.** Push back on assumptions
  when warranted rather than validating by default, but update when the
  maintainer shows real-world evidence.
- **English** for all repository content.
- **Scope tags matter.** Stories are tagged MVP / Later / Out of scope. Respect
  the boundary; don't quietly promote Later work into MVP.
- **Never renumber user stories.** A story's number is a **stable identifier**,
  assigned once, never reused and never reshuffled — renumbering would break
  every cross-reference in the docs and in git history, forever, each time a
  story is added. A new story takes the **next unused number** and is placed
  where it belongs by topic and scope: story 26 may sit inside MVP between
  stories 2 and 3. The backlog's numbers are not a sequence and the document's
  order is the reading order. Deleting a story retires its number rather than
  freeing it.
- **Merge via rebase + fast-forward only. Never create a merge commit.**
  Before integrating a branch: `git rebase main`, then
  `git checkout main && git merge --ff-only <branch>`. History stays linear, so
  `git log` reads as the order work actually landed rather than something to
  untangle from a merge bubble. (Same rule as the sibling repos.)
- **Squash a small slice; keep a large one's history.** The delivery model says
  a slice lands in one atomic commit, and for a slice of a few hundred lines
  that is right — the commit *is* the reviewable unit. Past roughly a thousand
  lines it inverts: one commit stops being reviewable and its message stops
  being able to carry the reasoning, so squashing destroys the record instead of
  tidying it. S2a was ~19,000 lines over 51 commits, each carrying why a
  decision went the way it did — a fixture catching a live obligation-5 bug, an
  HLC that must not advance on garbage, a lock taken before a dedupe so a
  sequence stays gapless. That is worth more than a tidy log.
  So: **fast-forward is absolute; squashing is a judgement.** Squash when the
  slice is small enough that one commit can still be read and explained. Keep
  the history when it is not, and let `git log --oneline main..<branch>` be the
  review surface instead. Either way the branch is linear and no merge commit
  appears.
- **Working in a git worktree: run `npm ci` in it, first thing.** A fresh
  worktree has no `node_modules`, so Node's resolver walks *up* and finds the
  main checkout's — where `node_modules/@foerier/shared` is a symlink to the
  **main checkout's** `shared/`. Nothing errors. You edit `shared/` in the
  worktree while `api/` and `app/` compile and test against the other tree, so
  an export you just added reads as missing and a behaviour you just changed
  reads as unchanged — both look like ordinary bugs, and the hours go into the
  wrong file. `npm run check:workspaces` (first step of `npm run typecheck`,
  so pre-commit and CI both run it) turns that silence into an error that names
  the fix. npm workspaces cannot link into a worktree without an install there;
  the guard is the whole of the defence.
- **Doc paths: two shelves, and the date is what separates them.** A
  **perpetually relevant** doc — one that is kept true as the code evolves —
  lives flat in `docs/`, named for what it is and never dated:
  `docs/architecture-design.md`, `docs/testing.md`. A **feature spec** — the
  design for one slice or feature, retired once it has shipped — lives in
  `docs/specs/YYYY-MM-DD-<slug>.md`, dated because its value is historical the
  moment it lands. Never date a durable doc, and never put a feature spec on the
  flat shelf where it will quietly rot. (The sibling repos have no `docs/specs/`
  shelf; this repo diverges deliberately, because slices here carry more design
  than a commit message can hold.)

## Requirements process

New requirements go through brainstorming before they are written down, and land
in `docs/user-stories.md` as problem-level stories with testable acceptance
criteria and a scope tag. Unresolved points belong in that file's "Open
questions" section, not resolved by guesswork.

## `examples/` (gitignored)

The `examples/` directory holds private exports of the real spreadsheets this
app replaces. It is gitignored and must never be committed — it contains
personal data. Treat it as evidence of real workflows, not as seed data or a
schema source. Note that the original sheets encoded packing status as cell
colors, which did not survive export, so the files understate the real process.
