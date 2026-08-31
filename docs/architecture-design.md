# foerier — Architecture & Delivery Design

The first realisation of foerier in code: how the persistence-ignorant
[domain model](domain-model.md) is stored, synced, served, and shipped.
This is the design the maintainer approved on 2026-08-20; it settles the two
decisions [`CLAUDE.md`](../CLAUDE.md) had held **deliberately open** —
persistence and tech stack.

It does **not** change the domain design. The [model](domain-model.md),
[ubiquitous language](ubiquitous-language.md), and
[user stories](user-stories.md) stay persistence-ignorant; the schema and
stack live here, and only here.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Persistence model | Per-aggregate **operation log** in Postgres; state is a fold of ops |
| Conflict resolution | Per-field **last-writer-wins** by **Hybrid Logical Clock**, silent, one rule ([contract](sync-protocol.md)) |
| Client store | Op-log folded into a normalised **in-memory** store; IndexedDB for the log + snapshot |
| Client stack | Vite + React + TypeScript, **wouter** router, `vite-plugin-pwa`, build-time CSS |
| Server | **Hono** + **Kysely** + Postgres 17 |
| Auth | **WebAuthn/passkeys**, no passwords; single-use **invite links** issued in-app; long-lived per-device bearer token ([detail](auth-design.md)) |
| Tenancy | Everything scoped by `household_id` — the boundary foerier is sold along |
| Repo | One **monorepo** (`app` · `landing` · `api` · `shared` · `ui`); landing also here |
| Versioning | SHA for deployables; **one API major in the path**; semver reserved for the contract |
| Delivery | Vertical-slice **XP continuous delivery**; expand-contract migrations; tolerant-reader ops |
| Slice order | 15 slices from a walking skeleton to the retired spreadsheets ([§8](#8-the-slice-plan)); story 11 split in two |
| Hosting | Existing **Hetzner CX33** via Docker Compose + Caddy + Watchtower; landing on **GitHub Pages** |
| CDN | **None.** EU-sovereign; an organic hug is absorbed by static serving + the service worker |

---

## 1. Guiding constraints

The design answers to six forces, in rough priority:

1. **Offline-first.** Every flow runs fully offline against local state. Sync is
   a background merge, never in the user's critical path. Uploads are attempted
   instantly whenever a connection exists, but never block the user.
2. **Performance.** All reads are in-memory; nothing async sits in a render path.
   A lean bundle so the installed-PWA experience is fast (the explicit lesson
   from a prior React+Firebase PWA that loaded slowly).
3. **Cheap + hug-resistant.** Rides already-paid-for infrastructure; an
   organic Reddit/HN spike must not become a bill or an outage.
4. **EU-sovereign & private.** The app records, in effect, when a household is
   away. Its traffic stays on EU infrastructure, TLS-terminated at the origin —
   no US intermediary in the request path.
5. **Sell-later.** A clean tenant boundary (`household_id`) and an extractable
   database, so foerier can become a product without a rewrite.
6. **Small conflict surface.** The domain is used by **two quartermasters** who
   rarely touch the same field offline at the same moment. This is not
   Google-Docs-scale collaboration, and the merge design is sized accordingly.

The [domain model](domain-model.md) already drew the sync boundaries: the
Trip is a **coarse** aggregate ("sync a trip as a whole without cross-aggregate
coordination", §5), while Gear, Place, and Person are **small** per-entity
aggregates. Concurrent edits therefore have a naturally small, well-defined blast
radius.

## 2. The keystone: operation log + LWW

State is never overwritten in place. Every change is an **operation** appended to
a log, and current state is the deterministic **fold** of that log. An op-log is
a Redux action log by another name — ops are actions, state is
`ops.reduce(apply, {})` — which is why the client store (§3) and the sync model
are the same idea seen twice.

**Aggregates → op scopes.** Ops are scoped to an aggregate, mirroring the model:

- **Gear**, **Place**, **Person** — fine-grained aggregates; each op targets one.
- **Trip** — one coarse aggregate owning its whole packing world (entries,
  pieces, trip containers, tasks, notes). Trip ops target the Trip root.

**Op envelope.** Every op carries:

- a client-generated id — **UUIDv7** (time-ordered, so re-sends dedupe
  idempotently and the id itself sorts sensibly);
- `household_id` (tenant scope), aggregate id, and an op `type`;
- a **Hybrid Logical Clock (HLC)** timestamp and originating device id;
- a small, additive `type`-specific payload.

**Why HLC, not wall-clock.** LWW compares timestamps to pick a winner. Naive
device wall-clocks are the classic footgun: one phone with a wrong clock would
win — or lose — every conflict forever. An HLC is monotonic and merges physical
time with a logical counter, so ordering survives clock skew and stays stable.

**Resolution — per field, silent, one rule.** **Last-writer-wins per field** by
HLC (not per record — editing a piece of gear's home and its tags concurrently
never collide), tiebroken on device id. Resolution is applied **silently**; there
is no conflict UI.

**Delete / retire wins** over a concurrent edit — and it needs no special rule to
do so: a tombstone is an ordinary per-field register, and an edit never writes
it, so a removal survives a later rename. Only an explicit restore clears one.

This spec originally also carried *packing status = furthest-stage wins*. It has
been **dropped** in favour of plain LWW, because it is in direct conflict with
stories 9 and 32 — if `packed` always wins, a mistaken `packed` can never be
un-marked. [`sync-protocol.md` §3.3](sync-protocol.md) records the reasoning, the
convergent-but-heavier alternative that was rejected, and the fact that the
decision is reversible additively.

So the resolution logic in `shared/` is one comparator plus tombstone semantics,
pure and exhaustively unit-tested. The two conditions that *cannot* be resolved
by a merge — an over-claim, and a containment cycle produced by two concurrent
moves — are computed by selectors and surfaced for a quartermaster, never fixed
by discarding a write.

**Tolerant reader, additive ops.** Ops are only ever *added*; an existing op
type never changes meaning. Readers ignore unknown fields and tolerate unknown
op types rather than rejecting them. This is what lets offline clients on older
app versions keep syncing (see §7).

**The concrete contract** — the exact envelope encoding, the HLC's serialised
form and drift rule, the full MVP op catalogue, the evolution rules, and the
`/sync` wire format — is
[`docs/sync-protocol.md`](sync-protocol.md). This section states the shape; that
document is what the implementation is built from.

## 3. Client architecture

**The op-log is the local source of truth**, persisted in **IndexedDB** (via
`idb`, a ~1 KB wrapper) as the log plus a periodic materialised **snapshot** so
startup folds only the recent tail, not all history.

```
IndexedDB: op-log (+ periodic snapshot)
      │  fold on load, append on edit
      ▼
in-memory normalised store   ← the single source the UI reads
      │  memoised selectors
      ▼
derived views: whereabouts, containment tree, filtered/grouped slices
```

- **Reads are pure in-memory** → instant, no async in any render path.
- **A local edit** appends an op (optimistic state update) and enqueues it in the
  sync outbox (§4). The user never waits on the network.
- **Reactive surface: Zustand** (~2 KB) with selector subscriptions over the
  fold — fine-grained re-renders, no over-rendering. Reducers and selectors are
  pure and live in `shared/`, so they are trivially unit-testable and identical
  across app, tests, and (if ever needed) server.

**Stack.** Vite + React + TypeScript. **wouter** (~2 KB) for routing — the app is
three tabs with shallow stacks and **no route data-loaders** (data is already
local), so a heavier router's features would be dead weight.
`vite-plugin-pwa` (Workbox) precaches the app shell and serves hashed, immutable
assets cache-first, so repeat and offline visits never touch the origin.
**Build-time CSS only** (Tailwind or CSS Modules — no runtime CSS-in-JS), for
zero render-time styling cost.

**Layout.** Mobile-first three-tab shell (Depot · Trips · Find, plus Account)
with primary actions in the thumb zone. Phone baseline (~360–412 px, Pixel 10 the
smallest target) → tablet-landscape unlocks list+detail two-pane → ultrawide
desktop centres at a max-width.

**Performance budget (testable).** App-shell JS **< ~150 KB gzipped**; Lighthouse
Perf/PWA **≥ 90** on mid Android; warm installed-PWA TTI **< 1.5 s**; 60 fps on
status-chip cycling; **no async in any render path**.

## 4. Sync protocol

Sync is background and off the user's critical path — server latency, cold
starts, and brief overloads never reach the UI.

The shape is below; the **contract** — request and response bodies, cursor
semantics, batch caps, per-op outcomes, the error classes and what a client does
with each, and the first-sync bootstrap — is
[`docs/sync-protocol.md`](sync-protocol.md) §6–§8.

- **Outbox (push).** Local ops queue in IndexedDB and flush by `POST` to
  `api.foerier.app` when online — triggered on reconnect, app focus, and a gentle
  interval, with exponential-backoff retry. Ops carry client UUIDv7 ids, so
  re-sends are idempotent. **Never blocks the UI.**
- **Inbox (pull).** `GET` ops since a **server-assigned monotonic sequence**
  cursor — on push response, focus, and interval. Applying pulled ops folds them
  through the same reducer, so all clients converge regardless of arrival order.
- **No WebSocket initially.** Two users do not need sub-second liveness. **Seam:**
  Server-Sent Events can be added later for live co-packing without changing the
  op model.
- **Auth:** a long-lived **bearer token** (cached in IndexedDB) on the
  `Authorization` header — not cookies, so there is no CSRF surface and no
  cross-subdomain cookie juggling.

## 5. Server architecture

A deliberately **thin** server: an ordered op store plus auth plus tenant
scoping. **Hono** (standards-based `Request`/`Response`, tiny, first-class TS,
portable across runtimes) + **Kysely** (a type-safe query *builder*, not an ORM —
what you write is what runs) + **Postgres 17**.

**Responsibilities.**

- Accept pushed ops, assign each a **monotonic per-household sequence**, store
  them in the op-log tables. The sequence comes from a per-household counter row
  allocated inside the push transaction, **not** a Postgres `SEQUENCE` — see
  [`sync-protocol.md` §6.6](sync-protocol.md) for the silent data-loss hazard
  that rules out.
- Serve ops since a cursor for pull.
- Issue and validate auth (§6); scope every read and write by `household_id` from
  the session — a client can only ever exchange its own household's ops.

**Deliberately *not* the server's job (for now).** The server does not re-run the
full domain reducer or enforce domain invariants (acyclicity, kind exclusivity,
etc.); resolution is deterministic and done identically on every client, and a
household's members are trusted with their own household's data. Server-side
validation is a named **deferred** option (§10), reached for only if untrusted
multi-tenant use makes it worth the weight.

**Endpoints (under `/api/v1`).** The `/sync/*` wire format, storage shape, and
error contract are specified in [`sync-protocol.md` §6](sync-protocol.md).
`POST /sync/push`, `GET /sync/pull`, and
`GET /version` (returns the deployed commit SHA, matching the sibling `health`
project's convention), plus the `/auth/*` surface enumerated in
[`auth-design.md` §9.1](auth-design.md).

**Migrations — Kysely.** Migration files are type-checked TypeScript exporting
`up`/`down` against Kysely's schema builder; a `Migrator` runs pending files in
order under a Postgres advisory lock and records them. The `Database` type is
**hand-maintained** (a single small interface file, updated when a migration
lands) — at this schema's size, `kysely-codegen` is overkill and is not used
until (if ever) the type starts drifting. The container entrypoint runs
migrations before serving. Migrations are **expand-contract** (§7).

**Tenancy.** `household_id` scopes every op and row. A member belongs to one
household; sync only ever exchanges that household's ops. This is the boundary a
future sale is drawn along, and the isolation guaranteed by the dedicated
multi-household integration test (see [testing.md](testing.md)).

## 6. Auth

Summarised here; the full design — flows, endpoints, tables, headers, threat
model — lives in [`docs/auth-design.md`](auth-design.md).

**WebAuthn / passkeys, no passwords.** Phishing-resistant, nothing to breach, no
third party. **Relying Party ID = `foerier.app`** (the parent registrable
domain), so passkeys are valid across `app.` / `api.` and any future subdomain;
pinned now because the RP ID is baked into every credential and painful to change
later. Credentials are discoverable, so sign-in needs no username — and the
"biometrics" of the phone case is really just WebAuthn *user verification*, which
a desktop password manager satisfies equally well.

**Enrolment — invite-only, issued in-app.** There is **no open registration
endpoint** and no public sign-up. An invite is a single-use, short-lived link
that pre-binds both the `household_id` and the **Person** the new Login belongs
to. The **maintainer** (whoever has server access — not a role in the product)
creates a household and its *first* invite with a small script; every invite
after that is issued by a Quartermaster from inside the app. This removes the
bot/abuse surface rather than mitigating it, and keeps account management out of
the maintainer's inbox.

**Every device stays supported.** A device whose OS offers no credential store
cannot hold a passkey; the same invite mechanism, in *device-link* form, signs
such a device in with a token and no credential, at no loss of function. Social
re-invite by another Quartermaster is also the recovery path, which is why
foerier needs no email subsystem.

**Offline.** Sign-in yields a long-lived, per-device bearer token cached on-device
(sliding one-year expiry, revocable per device), so sync never blocks on re-auth
in the field, and a `401` never costs the user queued offline work.

## 7. Repository, versioning, and delivery

**Monorepo** (npm/pnpm workspaces):

```
app/       PWA: sync client, IndexedDB, routing, screens   → Docker → CX33
landing/   marketing + live demo (real UI on demo data)    → GitHub Pages
api/       Hono + Kysely server                            → Docker → CX33
shared/    pure-TS domain core: op & entity types, reducer,
           LWW + tombstones, HLC, selectors, invariants     (app · api · tests)
ui/        shared presentational React components            (app · landing)
```

`shared/` is framework-free (no React, DB, or HTTP) so the same merge logic runs
in the app, the convergence tests, and — if ever needed — the server. `ui/` lets
the landing page show off *real* interface components on demo data without
depending on the app's sync/IndexedDB internals. The **landing lives in the
monorepo** (it shares `ui/`) but deploys separately.

**Versioning.**

- **Deployables (app, api) are versioned by commit SHA**, not semver. They have
  no external API consumer to promise compatibility to, so "which build is this"
  is answered honestly by the SHA (matching `health`'s `/version`).
- **The API contract carries one major version in the path** (`/api/v1`). It is
  bumped only for a genuine break that cannot be done compatibly; old majors stay
  alive while old clients exist, retired case-by-case.
- **Semver is reserved for the contract**, where it communicates real
  compatibility to an independent consumer — not sprayed across artifacts that
  have none.

**Delivery — vertical-slice XP continuous delivery.** Each story ships
end-to-end (server + app) as an independently valuable increment; there is no
waterfall gate. A slice is naturally new op type(s) + reducer + selector +
endpoint + UI, and — because it is one monorepo — lands in **one atomic commit**.
The stories are ordered so every release is immediately usable, however thin (the
first usable slice: auth + add-gear + find-gear — a searchable household
inventory, before Trips exist). **The full ordering is [§8](#8-the-slice-plan)**:
the dependency graph over the MVP stories, the slices in order, and what each one
must preserve rather than deliver.

**The discipline this imposes (non-negotiable).** Installed PWA clients run
*older app versions* in the wild and may have **ops queued offline** authored
against a previous version. So no breaking lockstep change is allowed:

- **Expand-contract migrations** — add the new shape, deploy readers tolerant of
  both, backfill, and only much later drop the old.
- **Tolerant-reader, additive ops** — new fields are optional; unknown fields and
  op types are ignored, never rejected.

The PWA's service worker shortens this window: an online client auto-updates its
code, so genuinely old *code* is rare and short-lived; what must be tolerated is
*queued ops from a recently-older version*, bounded by the offline window (days),
not forever.

## 8. The slice plan

§7 fixes *how* we ship — one atomic commit per vertical slice, every release
usable. This fixes *what, in what order*. It covers the MVP stories 1–15 and 32;
the four auth slices come from [auth-design §13](auth-design.md), reordered here
for one dependency that document missed (§8.2).

The plan refers to stories **by number only**; numbers are stable names and are
never renumbered, so this section stays valid as the backlog grows.

### 8.1 The dependency graph

**Hard** means impossible otherwise — the later story has no expressible state
without the earlier one. **Soft** means an ordering that is merely right: the
slice would build, but the product would be incoherent or the work would be done
twice.

```
LAYER 0   26 · 27                        auth: bootstrap, join, sign in
LAYER 1   1 · 2 · 7(Kind) · 3(Home)      the Depot              — needs nothing
LAYER 2   13(Tag ops + engine)           slicing                — 1 · 2
          4                              People + Ownership     — 2, for Ownership
LAYER 3   28                             auth: in-app Invites   — 4  ◄ missed edge
LAYER 4   5 · 32(phase machine)          Trips                  — 4
LAYER 5   6 · 7(Bring-count)             the gear list          — 5 · 32
          32(overlap guard)
LAYER 6   8                              per-person Pieces      — 4 · 6 · 7
          9 · 10 · 3(trip Whereabouts)   packing + the Journey  — 1 · 6
LAYER 7   11a · 32(close gate)           resolve and close      — 6 · 32
          3(unaccounted for)                                      soft: 9 · 10
LAYER 8   11b · 32(reopen clause)        reopen                 — 11a · 32
LAYER 9   12 ──► 15 ──► 14               notes, tasks, templates
                                         — 14 also needs 6 · 7

FLOATING  29 · 30                        auth 3 · 4 — no ops, no `shared/`;
                                         any time after layer 0
```

**Hard edges**

| Edge | Why |
| --- | --- |
| 5 → 32 | A phase belongs to a Trip. `trip.created` seeds `phase = "draft"` ([sync §4.4](sync-protocol.md)), so the register exists from the Trip's first op |
| 5 → 6 | An Entry is on a Trip's gear list |
| 4 → 5 | `trip.participant_added{person_id}` needs recorded People (the Trip *root* alone does not — a Trip with zero Participants is expressible, so only the Participants clause is hard) |
| 4 → 8 | A Piece is per Participant, and a Participant is a Person |
| 4 → 28 | Story 28 issues an Invite "for any Person recorded in our Household (story 4)". See §8.2 |
| 7 → 8 | Pieces exist only because Kind is per-person |
| 6 → 8 | A Piece belongs to an Entry |
| 6 → 9 | A packing status is a register on an Entry |
| 6 → 10 | A container journey is a register on a container Entry |
| 1 → 10 | The containment trait is set at `gear.recorded`; a Trip container Entry references gear that carries it |
| 6 → 11a | There is nothing to resolve without Entries |
| 32 → 11a | The close is `trip.phase_moved{phase:"closed"}`, and the pass happens in `unpack` |
| 11a → 11b | Reopening is leaving a state 11a is the only thing that can enter |
| 32 → 11b | Reopening is `trip.phase_moved` backwards out of `closed` |
| 12 → 14 | The template copy carries **kept reference Notes** |
| 15 → 14 | The template copy carries **Pre-trip tasks** |
| 6 → 14, 7 → 14 | It carries the gear list and Bring-counts |

**Soft edges**

| Edge | Why it is only soft |
| --- | --- |
| 1 → 2 | A Container **is** Gear (`gear.recorded{container: bool}`); story 1's only distinct ops are the three `place.*`. Gear can be recorded entirely `loose`, so 2 is buildable first — but a Home that can only be "loose" makes story 2's central promise hollow. Ship them together |
| 9 → 11a, 10 → 11a | `trip.outcome_set` reads no packing status and no journey stage; the outcome track is structurally independent. But "walk the Gear back Home in a pass that **reverses the Journey**" presupposes a Journey, so unpack before packing would be nonsense |
| 9 ↔ 10 | Not an edge at all — **one mechanism.** [Sync §3.7](sync-protocol.md) is explicit that `stage` and `status` are "the same track — *how far along* — for the two shapes of thing", never both on one Entry. Two slices would build the same track twice |
| 11a → 14 | You could template from a Draft. But "past Trips remain browsable with their final decisions" has no content until Trips can close |
| 11a → 12 | Notes can be posted from the moment a Trip exists — but story 12's own acceptance criterion "at the Unpack pass I review the Trip's Notes and either keep or discard them" needs the unpack screen, so `trip.note_kept` has nowhere to live before 11a |
| 2 → 4 | People are independent of Gear; only `gear.ownership_set` needs both |
| 13 → everything | The slicing engine narrows lists that must already exist. It attaches rather than depends — see §8.5 |

Story **31** is not a slice. As in [auth-design §13](auth-design.md), it is a
property every slice preserves, enforced by tests rather than by a screen (§8.7).

### 8.2 Four stories accrete across slices rather than landing in one

This is the plan's least obvious property, and the reason a naive
one-story-one-slice reading of `user-stories.md` does not survive contact with
the op catalogue.

**Story 7 cannot be deferred at all.** `gear.recorded` carries `kind` as a
**required** field ([sync §4.3](sync-protocol.md)), so the Kind register is
load-bearing from the very first gear op. The field and its picker land in the
Depot slice; only Kind's *trip-side* consequences wait — Bring-count with 6,
per-person fan-out with 8. This is a deviation from document order, where 7 sits
after 6.

**Story 32 lands in four places.** The phase machine (both directions) with 5;
the "overlap surfaces when I start Pack-out" clause with 6, because it needs the
claim selector; the close gate with 11a, because it needs outcomes to count; the
reopen clause with 11b.

**Story 3 lands in three.** The Home-path lookup in the Depot slice; the
trip-residence split and the quantity split when trip residences exist (9/10);
the **unaccounted for** standing with 11a.

**Story 4 unblocks auth.** Story 28 — auth-design §13's *second* slice — issues
Invites for People recorded under story 4, so it cannot be built before People
exist. The plan therefore interleaves: auth 1 → Depot → Tags → People → auth 2.
Nothing
is lost, because auth slice 1 already admits a second Quartermaster on a
Maintainer-minted Invite ([auth-design §3.4](auth-design.md)); only *in-app*
issuance waits. Auth slices 3 and 4 float freely (§8.6).

### 8.3 The slices

**Landed so far: S0, S1, S2a, S2b, S3, S3.5, S4, S6, S5 and S7**, plus two
pieces of work carrying no slice number (the Radix conversion, §12.9; Tier 4
and 5 against production, §12.8). S2 was the first slice to need the op log,
the reducer, and `/sync`, and it landed in **two halves rather than one** —
see its entry below for why, and §12.3 and §12.4 for what each half settled.
**S5 is the one gap in the order**: it is an auth slice, it shares no file
with the Trip, and S6 took the float §8.6 grants rather than idling behind
it. S7 landed after S5, back in step with §8's order — it is next after S6
either way, since it shares no file with an auth slice.

Two properties hold across every slice below and are not repeated in each:

- **Domain slices add no endpoints.** The server has no op vocabulary
  ([sync §6.2](sync-protocol.md)) — it validates envelopes and stores opaque
  rows. So every slice from S2 onwards touches exactly `POST /api/v1/sync/push`
  and `GET /api/v1/sync/pull`, and changes neither. Only auth slices add
  endpoints. This is the architecture paying out: new op types are a client-side
  deploy.
- **Every slice runs Tier 0** (full-repo `tsc`, ESLint, Prettier — pre-commit and
  CI) and leaves the golden-path Tier 5 smoke test green. Tiers named below are
  the ones a slice must *add to*.

The op counts below sum to **38** — exactly the MVP catalogue of
[sync §4](sync-protocol.md), each op type introduced by precisely one slice:
3 Place (S2), 2 Person (S2 · S4), 10 Gear (S2 · S3 · S4), 23 Trip (S6 · S7
· S8 · S9 · S10 · S12 · S13 · S14). If a slice needs an op that is not in
that catalogue, that is a signal to check the domain, not to invent a row.

---

**S0 — Walking skeleton.** *No stories.*

The empty deployable: the five workspaces of §7 scaffolded, `shared/` holding the
op envelope type and an empty reducer, Docker images to GHCR, the two Caddy site
blocks, Watchtower, `foerier_postgres` with the first Kysely migration, and the
GitHub Pages workflow for `landing/`.

- **Ops:** none.
- **Endpoints:** `GET /version` returning the deployed commit SHA
  ([sync §6.8](sync-protocol.md)), unauthenticated.
- **UI:** the app shell only — the five layout modes and nav treatments of
  [frontend-design §3.1](frontend-design.md), rendering an empty state.
- **Tests:** Tier 0 across all five workspaces; the Tier 4 harness itself,
  proving the CI job can poll `/version` until the deployed SHA matches the
  pushed commit. Tier 5 scaffolding with no golden path yet.
- **Usable?** Only to us — but it is the one slice permitted that exemption, and
  it buys the deploy pipeline every later slice rides.

**S1 — Auth 1: bootstrap, join, sign in.** *Stories 26, 27.*

[auth-design §13](auth-design.md) slice 1, unchanged.

- **Ops:** none. Auth state is tables, not ops
  ([sync §4.2](sync-protocol.md)).
- **Endpoints:** `/auth/register/options`, `/auth/register/verify`,
  `/auth/login/options`, `/auth/login/verify`, `/auth/me`, `/auth/signout`; the
  Device-token middleware and `household_id` scoping on `/sync/*`; the Maintainer
  bootstrap script.
- **UI:** Screens C — join, sign-in, the signed-out state, the 401 contract
  ([auth-design §7.2](auth-design.md)).
- **Tests:** Tier 1 (Invite state machine, token hashing); **Tier 2s** including
  the multi-household isolation test; Tier 4 (RP origin, `Authorization`
  pass-through, CORS, security headers on both hosts); Tier 5 with Playwright's
  virtual authenticator.
- **Usable?** One Quartermaster is in the app. Empty, but theirs.

**S2 — The Depot.** *Delivers 1, 2. Advances 3 (Home path), 7 (Kind register).*

The architecture's named first usable slice — "auth + add-gear + find-gear, a
searchable household inventory, before Trips exist."

- **Ops (11):** `place.recorded`, `place.renamed`, `place.removed`;
  `person.recorded`; `gear.recorded`, `gear.renamed`, `gear.rehomed`,
  `gear.kind_set`, `gear.owned_count_set`, `gear.retired`, `gear.restored`; plus
  the client outbox and pull cursor going live against `/sync`.
- **UI:** F1 Add Gear, F2 Find, the Depot list and the gear-detail screen
  (Screens A + B).
- **Tests:** Tier 1 — the fold, per-field LWW, tombstones, the HLC, the
  containment-tree selector and its **cycle break**
  ([sync §3.6](sync-protocol.md)), and gear at a removed Place reading `loose`
  without a cascade. **Tier 2** — the
  first convergence properties, plus the outbox (retry/backoff, idempotent
  re-push, dead-letter, cursor advance). Tier 2s — `sync/push` sequence
  assignment and `sync/pull` since-semantics. Tier 3 — F1, F2.
- **Note:** `gear.restored` is **protocol-present, UI-deferred.** Story 2's
  soft-delete is in the MVP; managing Retired Gear as a view is story 19, tagged
  Later. The op ships so that a restore is expressible and its merge behaviour is
  pinned by tests from day one; no Retired screen is built. Deliberate, not an
  oversight.
- **Note:** **`person.recorded` is S2's, not S4's.** It was catalogued with the
  rest of Person because that is where People become a *feature*; but S1 already
  ships a join screen that asks the joiner their name and pre-binds their Person
  id ([auth-design §3.4](auth-design.md)), and until some slice authors that op
  the Household's own Login points at a Person nobody ever created. The op
  therefore lands with the first slice that has an op log to append it to, which
  is this one. S4 keeps `person.renamed` and the People UI.
- **Usable?** The spreadsheet's inventory tab is replaced.

**S2 landed as two halves, S2a and S2b.** Not a change of plan about what a
slice is — S2's whole span is one increment and both halves ship inside it —
but a recognition that "the op log, the reducer, `/sync`, the outbox and four
screens" is the largest single commit in the plan by a wide margin, and that
it contains a clean seam:

- **S2a — the Depot.** Everything that *writes*: the eleven ops and the
  reducer, the IndexedDB op log, the HLC, `/sync/push` and `/sync/pull` with
  gapless per-household seqs, the outbox and its dead-letter, F1 Add Gear, the
  Depot list, and the gear-detail screen. `person.recorded` is authored here,
  from the name the join screen took. Ends with a Quartermaster who can record
  gear on a phone with no signal and find it on a laptop.
- **S2b — find it.** Everything that *reads*: story 3's Home path and
  whereabouts, F2 Find, and the join screen's gated first-sync fold (§12.2).
  **Zero new op types and zero new endpoints** — purely additive client
  read-side code, which is exactly what made the seam a clean one. Ends with a
  Quartermaster who can find any piece of gear and see where it lives, all
  from local state, with the radio off.

**S3 — Tags and the slicing engine.** *Advances 13.*

Early on purpose, and deliberately ahead of the first slice that narrows a list:
you Tag while populating the Depot rather than re-visiting two hundred records
later, and every later narrowing extends one engine instead of growing its own.

- **Ops (2):** `gear.tag_applied`, `gear.tag_removed` — per-tag registers
  ([sync §3.4](sync-protocol.md)).
- **UI:** tag editing on gear; the filter/sort/group cluster on the Depot list,
  carrying the dimensions that exist today — **Tag** and **Kind**.
- **Also, and not optional:** `GearRow` moves into `ui/` (§12.4 named this
  slice for it), and S3 pays down **S0's layout shortfall** — the pane
  structure and the `@container` layer of
  [frontend-design §3](frontend-design.md), neither of which was ever built
  (§12.1). The boards draw S3's own tag chips inside Split's detail pane, so
  the slice cannot ship whole without it.
- **Tests:** Tier 1 — the composable slicing selector. **Tier 2 — concurrent
  tagging must union, never clobber**; this is the named per-element-register
  scenario. Tier 3 — the filter cluster.
- **Usable?** "Everything `bushcraft`" is one tap. See §8.5 for the rest of 13.

**S3.5 — Auth 3+4: device links and the Account screen.** *Delivers 29, 30.*

[auth-design §13](auth-design.md) slices 3 and 4, landed together and ahead of
slice 2 by spending the float §8.6 grants. **Not a renumbering** — the slices
either side keep their names, for the same reason stories do.

- **Ops:** none. `shared/` is untouched.
- **Endpoints:** `POST /auth/device/claim`; `POST · GET · DELETE
  /auth/invites` (`purpose: "device"` only until S5); `GET /auth/devices`,
  `DELETE /auth/devices/:id`; `POST /auth/passkeys/options` + `/verify`,
  `GET · DELETE /auth/passkeys[/:id]`; `household_name` added to `/auth/me`.
  Plus two Maintainer scripts, `admin:invite` and `admin:list`.
- **Migration:** one additive column, `invite.person_recorded`, replacing a
  server-side guess that was right for exactly the first Login of a Household
  and wrong for every one after it.
- **UI:** Screens C — Account, Devices, Invite issued, and the
  passkey-less path; the `ACCOUNT` affordance in **all three** nav modes at
  once, discharging §12.6's four-way debt; `clearLocalData()` gains its only
  caller.
- **Tests:** Tier 2s across nine new authenticated routes, the isolation test
  extended to each. **Tier 5 — a device link claimed in a browser context with
  no virtual authenticator registered**, which is the honest simulation of a
  phone whose credential store the household will not use.
- **Usable?** Every Device the household owns can be signed in, and any of them
  cut off from any other. Before this, one of them could not get in at all.

**S4 — People and ownership. Landed.** *Delivers 4.* See
[its spec](specs/2026-08-29-people-and-ownership.md) and §12.10.

- **Ops (2):** `person.renamed`, `gear.ownership_set`. `person.recorded` is
  S2's — see that slice's second note.
- **UI:** the People screen; the owner picker; owner on Add gear, on gear
  detail and in the Depot's rows and OWNER column; **Person** and
  **Ownership** added to S3's slicing cluster — which is how story 4's
  "narrowed to one Person's Personal gear, or to Shared only" is delivered,
  rather than as a second, private filter — plus `GROUP BY OWNER`.
- **Tests:** Tier 1 — the ownership register and the two narrowings. Tier 2 —
  concurrent ownership edits.
- **Usable?** Personal gear stops being everyone's problem, and S5 is unblocked.

**S5 — Auth 2: bring another Person in. Landed, after S6.** *Story 28.* See
[its spec](specs/2026-08-29-in-app-invites-and-logins.md) and §12.12 — which
is numbered after S6's because §12 records the order slices **landed**, and
S6 took the float §8.6 grants rather than idling behind this one.

[auth-design §13](auth-design.md) slice 2, moved behind S4 per §8.2.

- **Ops:** none. `shared/` is untouched, as at S3.5.
- **Migration:** one — `0006_login_reinvite`, making `login`'s uniqueness
  partial (`where disabled_at is null`), so a revoked Person can hold a Login
  again.
- **Endpoints:** `GET /auth/logins`, `DELETE /auth/logins/:id`; `POST
  /auth/invites` widened with `purpose: "join"` and an optional `person_id`
  for `"device"`; `GET · DELETE /auth/invites` widened to scope **by
  purpose** rather than always by issuer.
- **UI:** People becomes **People & logins** — issue an Invite from a
  Person's row, the login half of the row, revoke a Login; `DeviceLink.tsx`
  becomes `InviteIssued.tsx`, one screen for both Invite purposes across
  three entry points.
- **Tests:** Tier 2s — single-use and expiry enforcement, a revoked Login's
  Devices receiving `401`, purpose-scoped list/revoke. Tier 5 — join via an
  in-app Invite, **local-only and untagged**: `POST /test/reset` cannot
  delete a Login, so a `@production` run would leave one behind that its own
  tripwire could never see.
- **Usable?** The second Quartermaster is arranged between us, not by whoever
  runs the server.

**S6 — Trips and phases. Landed.** *Delivers 5. Advances 32 (phase machine).*
See [its spec](specs/2026-08-29-trips-and-phases.md) and §12.11.

- **Ops (6):** `trip.created`, `trip.renamed`, `trip.dates_set`,
  `trip.phase_moved`, `trip.participant_added`, `trip.participant_removed`.
- **UI:** F3 New Trip; the Trips list; the phase control, moving **both
  directions**, with the next thing to do stated.
- **Tests:** Tier 1 — the phase register, the `active` predicate
  (`pack_out ｜ on_trip ｜ unpack`), participants as per-person-id registers.
  Tier 2 — concurrent phase moves resolving by plain LWW; a participant added on
  one Device and removed on another. Tier 3 — F3.
- **Note:** the close gate is *not* in this slice — it needs outcomes to count.
  Until S10 the phase control offers `unpack → closed` unguarded, which is
  honest, because until S10 nothing can be open. `trip.deleted` waits for S14
  with the rest of story 14.
- **Usable?** Trips exist and say where they stand.

**S7 — The gear list. Landed.** *Delivers 6. Advances 7 (Bring-count), 32
(overlap guard), 13 (Trip-membership dimension).* See
[its spec](specs/2026-08-29-the-gear-list.md) and §12.13.

- **Ops (3):** `trip.entry_added`, `trip.entry_removed`,
  `trip.entry_bring_count_set`.
- **UI:** build the list from the Depot; add a Trip-only Entry; Bring-count on
  Counted Entries; the **over-claim surface** — at add-to-an-Active-Trip, at
  Draft→Pack-out, and when one arrives through sync.
- **Tests:** Tier 1 — the claim selector across the three Kinds
  ([domain §5.2](domain-model.md)); Entries referencing gear and copying nothing.
  **Tier 2 — the over-claim is surfaced identically on every replica and
  resolved only by `trip.entry_removed`; nothing recorded is discarded**
  ([sync §3.6](sync-protocol.md)). Tier 3 — the gear-list screen.
- **Usable?** A Trip has a real list. This is the slice that starts replacing the
  per-trip sheet.

**S8 — Per-person Pieces. Landed.** *Delivers 8.* See
[its spec](specs/2026-08-31-per-person-pieces.md) and §12.14.

- **Ops (2):** `trip.piece_removed`, `trip.piece_restored`.
- **UI:** Pieces derived one-per-Participant; remove or restore one Person's
  Piece from the cluster-and-`×N` control; the over-claim band's per-person
  settle routes. The per-Person **packed** view is not this slice's — S8
  delivers the Piece it needs, and S9 draws the view on top of it.
- **Tests:** Tier 1 — Pieces derived from participants minus tombstones, so a
  Participant added later gets a Piece **with no backfill op**; at most one Piece
  per Participant. Tier 2 — remove-vs-restore ordering; a Participant added
  concurrently with a Piece removal.
- **Usable?** One missing headlamp is obvious, and obvious whose.

**S9 — Packing and the Journey.** *Delivers 9, 10. Advances 3 (trip
Whereabouts), 13 (Packing-status and Container dimensions).*

One slice, because [sync §3.7](sync-protocol.md) makes 9 and 10 one mechanism.

- **Ops (5):** `trip.entry_status_set`, `trip.piece_status_set`,
  `trip.entry_moved`, `trip.piece_moved`, `trip.container_stage_set`.
- **UI:** F4 Pack-out — status per Entry and per Piece, trip residence, the
  Container journey board, and the **disagreement shown, not forbidden** when a
  packed Container holds a not-packed Entry. Also **Find's per-person answer
  card**, work S8 held back — `Screens B` 03 is restaged `S8 · PIECES` → `S9`.
- **Tests:** Tier 1 — Whereabouts reconciling home against trip residence for
  Active Trips only, and the **quantity split** for Counted and Per-person gear
  with the Home slot kept; moving a Container moving its contents through the
  pointer, nested included, with statuses untouched. **Tier 2 — `residence` and
  `status` are separate registers, so no merge can make them agree (invariant
  12); two Bring-count edits resolve by plain LWW.** Tier 3 — F4.
- **Usable?** A multi-day Pack-out is trustworthy. With S10 still to come, this
  is the last slice where the Depot can drift.

**S10 — Unpack: resolve and close.** *Delivers 11a. Advances 32 (close gate), 3
(unaccounted for).*

See §8.4 for why story 11 is two slices and why the seam falls here.

- **Ops (2 new):** `trip.outcome_set`, `trip.consumed_count_set`. Plus two
  cross-aggregate **gestures** over ops that already exist
  ([sync §4.5](sync-protocol.md)): re-homing on the spot emits `trip.outcome_set`
  + `gear.rehomed`; resolving a `consumed` Counted Entry emits
  `trip.consumed_count_set` + `gear.owned_count_set` with the new **absolute**
  count.
- **UI:** F5 Unpack — an outcome on every Entry and Piece, the Consumed-count,
  Re-home on the spot, and the close button stating the count
  ("Close trip — 6 open"), available only at zero.
- **Tests:** Tier 1 — open ≡ no outcome; Trip-only Entries excluded from the open
  count and cleared at the close; `lost` writing **nothing** to the Depot while
  Whereabouts reads *unaccounted for*, naming the Trip; the claim releasing the
  moment an outcome is recorded, mid-pass. **Tier 2 — two Devices closing the
  same Trip must not double-apply the Consumed reduction**; this is precisely why
  `gear.owned_count_set` is absolute and never a delta
  ([sync §4.3](sync-protocol.md)). Tier 3 — F5. **Tier 5 — the golden path is
  complete for the first time**: sign in → add gear → find it → build a trip →
  pack → close.
- **Timing to build correctly:** the owned-count reduction applies **once, at the
  close** ([domain §6](domain-model.md)) — not per Entry as outcomes are
  recorded. Recording the outcome releases the *claim*; it does not write the
  Depot.
- **Usable?** This is the slice that stops the Depot drifting after every Trip —
  the point of the whole tool. A Trip can be unpacked and closed honestly without
  ever being reopened.

**S11 — Reopen.** *Delivers 11b. Advances 32 (reopen clause).*

- **Ops:** **none new.** Reopening is `trip.phase_moved{phase:"unpack"}` out of
  `closed`; changing an outcome is `trip.outcome_set`; the restoration is
  `gear.owned_count_set`.
- **UI:** the confirmation — the same weight as deleting a Trip; changing an
  outcome after the fact; the **offer** to put the Owned-count back, computed as
  a new absolute value and waiting for a human; the over-claim warning at the
  reopen moment, which **never refuses the reopen**.
- **Tests:** Tier 1 — the offered restoration is computed, never auto-applied.
  **Tier 2 — a reopened Trip's retained packing arrangement comes back into
  effect on every replica.** This is a *test* obligation, not implementation
  work: nothing is destroyed to close, and active-ness is derived from `phase`,
  so the arrangement returns for free. Tier 3 — the confirm and the offer.
- **Usable?** The tent marked `lost` in September and found in November can be
  corrected without lying about it.

**S12 — Trip notes.** *Delivers 12.*

- **Ops (2):** `trip.note_posted`, `trip.note_kept`.
- **UI:** low-friction capture on the Trip and against an Entry; the keep/discard
  review in F5.
- **Tests:** Tier 1 — a Note optionally about an Entry; kept vs discarded. Tier 2
  — concurrent Notes, both kept.
- **Usable?** "Ran low on gas" is captured where it will be read again.

**S13 — Pre-trip tasks.** *Delivers 15.*

Story 15 is tagged "deliberately the last MVP story; first to move to Later".
Placed before 14 only because 14's template copy carries tasks — see §8.4's note
on what happens if 15 does move.

- **Ops (2):** `trip.task_added`, `trip.task_ticked`.
- **UI:** the checklist on the Trip.
- **Tests:** Tier 1 — ticked/unticked as one op in both directions. Tier 3 — the
  checklist.

**S14 — Trip history and templates.** *Delivers 14. Completes the MVP.*

- **Ops (1 new):** `trip.deleted`. The template copy introduces nothing: it
  **materialises at creation time** into one batch of ordinary existing ops —
  `trip.created{from_trip_id}`, then `trip.entry_added` per Entry,
  `trip.entry_bring_count_set`, `trip.task_added`, and `trip.note_posted` per
  kept Note ([sync §4.5](sync-protocol.md)).
- **UI:** past Trips browsable with their final decisions; the confirmed delete;
  Start a new Trip from a past one.
- **Tests:** Tier 1 — the copy takes gear list, Bring-counts, tasks, and kept
  Notes, and **starts statuses, journeys, outcomes, Consumed-counts and dates
  fresh by simply not writing them**. Tier 2 — the batch is ≤ 500 ops and
  converges; the copy does not mutate as late ops for the source Trip arrive
  (the reason it is materialised, not derived).
- **Usable?** A hüttentour starts from a proven list. The spreadsheets are
  retired.

---

**Deviations from `user-stories.md`'s document order**, all argued above: 7's
Kind register moves ahead of 6 (§8.2); 14 moves behind 15 and 12 (§8.1, hard);
12 moves behind 11a (§8.1, soft); auth 2 moves behind 4 (§8.2). Everything else
follows the document.

### 8.4 Story 11 is two slices

After the domain reconciliation, story 11 is by a distance the heaviest MVP
story: three outcomes with three different write-back behaviours, the
consumed-count and its Owned-count reduction, `lost` as a purely read-side
standing, mid-pass claim release, the close gate, and reopening. Planning it as
one slice would produce the largest commit in the project at the exact point
where the Depot's integrity is decided.

The seam falls between **resolve-and-close (11a, S10)** and **reopen (11b,
S11)**, and the decisive argument is at the protocol layer:

> **11b introduces no new op types at all.**

Reopening is `trip.phase_moved` — an op S6 already shipped and S10 already
depends on. Changing an outcome is `trip.outcome_set`, from 11a. The offered
restoration is `gear.owned_count_set`, from S2. So 11a carries **100% of the
protocol weight** of story 11 — two new op types, two cross-aggregate gestures,
the claim-release rule, the open-count selector — and 11b is entirely UI,
selector, guard, and convergence-test work. A seam that leaves one side with no
new ops is a seam in the right place: 11b cannot break 11a's merge behaviour,
because it writes nothing 11a did not already write.

The value test holds independently in both directions. **11a alone is the point
of the story** — the Depot stops drifting, and a Trip can be unpacked and closed
honestly by someone who never reopens anything. **11b alone is meaningless**,
which is why it is second rather than parallel.

Two things the split must get right, both easy to get wrong:

- The Owned-count reduction is a **close-time** gesture, not a per-Entry one
  ([domain §6](domain-model.md): "it applies once, at the close"). Building it as
  an immediate write at outcome-recording time would make 11b's *offered*
  correction incoherent — you cannot offer to put back something that was
  deducted at a moment nobody agreed was final.
- "The retained packing arrangement comes back into effect" is **not
  implementation work in 11b.** Nothing is destroyed to close a Trip, and
  active-ness is derived from `phase`, so reopening restores the arrangement for
  free. It is a convergence-tier assertion, and belongs in 11b as one.

### 8.5 Where story 13 attaches

Story 13 is not a slice and is not one slice's problem. It has a small hard core
and a long tail that rides along.

**The core lands in S3:** two ops (`gear.tag_applied`, `gear.tag_removed`), tag
editing, and the generic filter/sort/group selector — built once, composable,
and carrying the only two dimensions that exist at that point, **Tag** and
**Kind**. It goes early for two reasons: Tags get applied while the Depot is
being populated for real, and every later narrowing extends one engine instead
of growing a private filter beside it.

**The tail rides along.** Each later slice extends the same engine with the
dimension it introduces, as part of that slice's definition of done — never as a
follow-up:

| Dimension | Arrives with |
| --- | --- |
| Person; Ownership (Personal / Shared) | S4 |
| Trip membership ("Gear not in any Trip") | S7 |
| Packing status; Container | S9 |
| Outcome (`open`, `lost`) | S10 |

**Trip membership landed with S7**, the fifth dimension the table carries —
see §12.13 for what a cross-aggregate dimension cost the engine that S3 built
for one that reads only the Gear's own registers.

**S8 added no row.** Its first draft did — `PIECES BY PERSON · S8`, read off
`Components §04`'s dashed rung the way `TRIP · S7` had been read a slice
earlier — but the round's ruling H overturned it: the rung contradicted the
standing two-worlds rule (Pieces exist only in trip contexts, never on the
Depot) and story 13's own criterion list had never named it. See §12.14.

Story 13 is therefore **complete at S10**, having been touched by **five**
slices — S3, S4, S7, S9, S10 — and owned by one, and story 4's own narrowing
criterion is delivered by S4 through this engine rather than beside it. Story
34 (naming a slice) is Later and attaches to the same engine with no
structural change, which is the test that the engine was built at the right
altitude.

### 8.6 What can be built in parallel

Honestly: **very little, and that is the correct answer** for a two-person
monorepo where a slice lands in one atomic commit.

Every domain slice queues on the same three files-in-spirit — one reducer, one
register map, one selector set in `shared/` — and on overlapping screens. Two
domain slices in flight would conflict in `shared/` on almost every commit, and
the merge would be resolved by hand in the one package the entire correctness
argument rests on. Not worth it.

What genuinely parallelises:

- **Auth 3 (story 29, second Device) and auth 4 (story 30, Device management)**
  introduce **no ops**, touch `shared/` not at all, and live in `api/`'s auth
  tables and the account routes of Screens C. They can be built alongside any
  domain slice from S2 onwards, in either order. **They were spent immediately
  after S3, together, as S3.5** — this bullet's float is the permission that
  made that a scheduling decision rather than a re-plan. The trigger was not the
  "any time before S10" this bullet used to recommend: the R3 shell round had
  queued four settled affordances behind the Account screen (§12.6), and a
  household device could not sign in at all until the Device link of
  [auth-design §5](auth-design.md) existed. Float is worth having precisely
  because you cannot predict which week it gets spent.
- **S12 (notes) and S13 (tasks)** touch disjoint Trip register namespaces
  (`notes.<id>` vs `tasks.<id>`, [sync §3.7](sync-protocol.md)) and disjoint
  panels. Their only collision is the Trip screen shell, which is a layout
  conflict rather than a logic one. They can run concurrently if the shell is
  settled first.
- **`landing/`** is fully independent — it depends only on `ui/`, deploys
  separately to GitHub Pages, and carries no ops, no auth, and no household data.
  It can be built at any point by anyone.

Everything else: sequence it.

### 8.7 What every slice must preserve, not deliver

Three obligations belong to no slice and to all of them. A slice that delivers
its stories and breaks one of these is not done.

**Story 31 — the tenancy property.** Every record belongs to exactly one
Household and is unreachable across that boundary by any route. `household_id`
comes from the Device token and never from a body, query string, or header
([sync §6](sync-protocol.md)). Enforced by the **Tier 2s multi-household
isolation test**, which every slice adding a read or write path must extend —
including its "Household A's token cannot push ops carrying Household B's id"
half. This is the boundary foerier would be sold along; it is never
provisionally relaxed.

**Expand-contract.** No slice makes a breaking lockstep change. Installed PWAs
run older app versions and may hold ops queued offline against them. Add the new
shape, deploy readers tolerant of both, backfill, drop the old much later. A
slice that needs a field to change shape does not change it — it adds one.

**Tolerant-reader, additive ops.** New fields are optional; unknown fields, enum
values, and whole op types are **retained and ignored, never rejected**
([sync §5.3](sync-protocol.md)). Absent is never coerced to null, and a stored op
is never mutated. §5.4's frozen list — what may never change about an existing op
type — is the other half, and is a Tier 2 assertion, not a convention.

**The fixture rule makes the last two real.** [testing.md](testing.md):
**capture an op fixture in the same commit as the slice that introduces the op
type.** A fixture written later is captured from a format that has already
drifted and proves nothing. Every slice from S2 onwards owes fixtures for the op
types in its entry in §8.3, replayed by the backward-compatibility group through
the current reducer.

**And the standing bar:** every slice leaves the Tier 5 golden path green, and
leaves the product usable — however thin. S0 is the single exemption, and it buys
the pipeline that makes the exemption pay for itself.

## 9. Hosting & deployment

**app + api ride the existing Hetzner CX33** (4 vCPU / 8 GB / 20 TB) as new Docker
Compose services alongside the `health` project, mirroring its proven pattern:

- **Caddy** (already the front door on 80/443) gains two site blocks —
  `app.foerier.app` serving the static PWA, `api.foerier.app` reverse-proxying the
  Hono container on `127.0.0.1` — each with automatic Let's Encrypt TLS.
- **Watchtower** is CD: images pushed to GHCR auto-deploy within ~60 s.
- A **separate `foerier_postgres`** container with its own volume and backups —
  with 8 GB the ~100 MB is nothing, and the database lifts off intact the day
  foerier is spun out to sell. Per-service Docker resource limits keep a foerier
  spike from starving `health`.
- **Cross-origin** `app.` → `api.` is handled by a tight CORS allowlist plus
  bearer tokens (no cookies), so there is no CSRF or cookie-domain complexity.

**landing deploys to GitHub Pages** via the GitHub Actions Pages workflow
(`upload-pages-artifact` → `deploy-pages`), which builds `landing/` and uploads
`landing/dist`; `foerier.app` is the Pages custom domain. GitHub Pages (US) is
acceptable *here and only here* because the landing page carries no auth, no
household data, and no "we're away" signal — it is public marketing on synthetic
demo data. All sensitive traffic stays on the EU box.

**No CDN.** An organic hug never touches existing users (installed PWA, served
from cache); it only has new visitors download a small bundle once. The math is
forgiving: 100 k first-time visitors ≈ 30 GB against a 20 TB allowance, and Caddy
serves static files from page cache at thousands of req/s, bounded by the NIC
long before CPU. The worst realistic case is "the bundle loads a little slower
for new visitors for an hour," not an outage. A CDN's one unique benefit —
malicious L7 DDoS scrubbing — is a different threat from an organic hug; if it is
ever needed, the escape hatch is an **EU provider** (Bunny.net, or Hetzner's own
CDN), never a US intermediary. **Cloudflare is deliberately rejected** on
sovereignty and privacy grounds (it would terminate TLS and see all traffic in
cleartext).

## 10. Testing

The full strategy — the adapted seven-tier pyramid, its charters, and the
test-data approach — is a permanent reference in
[`docs/testing.md`](testing.md), following the lineage of the sibling
`health` manifesto and `bloomwatch` browser adaptation. The signature tier is
**convergence/merge**: divergent op-logs exchanged between simulated clients must
fold to identical state regardless of order (property-based). The domain
invariants and LWW/HLC resolution are pure `shared/` logic and carry the bulk of
the unit tests.

## 11. Deferred / open

Named so they are not built ahead of need:

- **Server-side invariant validation** — deferred; the server stays a thin op
  store while households are trusted. Revisit if untrusted multi-tenant use
  warrants it.
- **SSE liveness** — a seam on the sync protocol (§4) for live co-packing.
- **Forced-update UX** — surfacing "new version available" / forcing a
  service-worker update; the mechanism exists, the UX is unbuilt.
- **Retiring old API majors** — case-by-case, only when an old major is
  demonstrably unused.
- **EU CDN** — only if a genuine DDoS (not an organic hug) ever materialises.

The domain-model [seams](domain-model.md#10-seams) (configurable status,
promotion, weight, sharing, …) are unaffected by this design and attach as their
stories are built.

## 12. Implementation decisions

Settled on 2026-08-24, when the first code landed. These are the calls the
sections above deliberately left open, plus the ones the walking skeleton
forced. Recorded here rather than in the decisions table at the top because
they are one level down from architecture: they bind the toolchain, not the
design.

| Concern | Decision |
| --- | --- |
| Package manager | **npm workspaces** (`shared` · `ui` · `api` · `app`) |
| Node | `.nvmrc` pins **24.19.0** exactly; `engines: >=24.19 <25`; images use the `node:24-alpine` **major** tag |
| TypeScript | pinned **exactly** (5.9.2), never a range |
| Strictness | `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch` + `verbatimModuleSyntax` + `isolatedModules` + `erasableSyntaxOnly` |
| UUIDv7 | the **`uuid`** package's `v7()`, behind an injected `IdSource` |
| Package linking | **source-exporting** internal packages — no build step, no `dist` |
| Naming | ubiquitous-language terms **verbatim**; ops mirror the wire; state is camelCase |
| Formatting | Prettier: no semicolons, single quotes, 80 columns; markdown excluded |

**Why Node's major tag in images but an exact `.nvmrc`.** A TypeScript minor
can change type-checking outcomes, so an unpinned compiler turns an unrelated
commit red — that is the surprise worth paying a pin for. A Node *patch*
carries security fixes and changes nothing observable, and there is no Renovate
or Dependabot here yet, so pinning the base image exactly would leave it
quietly unpatched. Humans and CI share one exact version; the image takes
patches as it rebuilds.

**Why `exactOptionalPropertyTypes` in particular.** [`sync-protocol.md`
§1.3](sync-protocol.md) makes *absent is not null* a **protocol** rule: an
absent payload field leaves a register alone, an explicit `null` clears it.
This flag is the type-level enforcement of exactly that distinction. Without
it, `{ start?: string | null }` lets the two collapse into each other and the
compiler never notices.

**Why ops are the one un-idiomatic corner.** Op envelopes and payloads keep the
wire's `snake_case` and are **never transformed** in either direction, while
folded state, selectors, and UI props are ordinary camelCase. [`sync-protocol.md`
§1.2](sync-protocol.md) obliges a reader to *retain unknown fields verbatim*
while ignoring them for the fold; a camelCase mapping layer over the envelope
would be precisely the place that obligation breaks, on the one interface that
must stay forward-compatible forever. Kysely maps database rows, and that is
the only mapping in the system.

**Why source-exporting packages.** `shared` and `ui` point their `exports` at
raw TypeScript. Vite compiles them for the app, esbuild bundles them into the
api image, and Vitest imports them directly — so there is no build ordering in
CI, in either Dockerfile, or in watch mode, and no stale `dist` to mislead a
debugging session. Project references buy incremental builds that a repo this
size does not need.

**Unused locals and parameters are ESLint's job, not `tsc`'s.** Both tools can
report them; having both means every unused import is two errors. `tsc` owns
types, ESLint owns correctness-style rules ([testing.md](testing.md) Tier 0).

**Prettier does not touch markdown.** Every design doc here is hand-wrapped
prose at 80 columns, and Prettier's markdown formatter reflows it into enormous
diffs that hide the actual change. `docs/design/` is excluded for a stronger
reason: the `*.dc.html` boards are the visual source of truth, exported
byte-exact.

### 12.1 Deviations from §8's S0, and why

- **`landing/` is a redirect stub, not a workspace.** §7 lists five workspaces
  and S0 asks for the GitHub Pages workflow. Four workspaces are built; the
  fifth is three static files — `index.html`, `styles.css`, `CNAME` — that send
  `foerier.app` to `app.foerier.app` and nothing else. It was scaffolded ahead
  of the marketing site because without it `foerier.app` resolves to Pages IPs
  that serve no certificate, and `.app` is HSTS-preloaded, so the bare domain
  is an error page with no http fallback. The workflow (`pages.yml`) is
  therefore real and deployed; the Vite build and the live demo on `ui/`
  components still wait until there is a `ui/` worth showing off. Nothing
  depends on it — it carries no ops, no auth, and no household data.

  Two consequences worth knowing before touching it. It **does not build**, so
  it cannot import `ui/styles/tokens.css`; its two background colours are
  copies of `--sage-bg-base` and `--parchment-bg-base`, and a token change does
  not reach them. And the redirect is a **declarative `<meta http-equiv=
  "refresh" content="0">`**, not `location.replace()` — which is what lets the
  page's meta CSP (§8.2 of [auth-design](auth-design.md), since Pages cannot
  set headers) tighten to `default-src 'none'` with no `script-src` at all.
- **Deployment is not in this repository.** S0 asks for the Caddy site blocks,
  Watchtower, and the compose stack. Those moved to a separate infrastructure
  repository so that `health` and foerier never learn about each other. This
  repo's whole side of the contract is: publish `foerier-api` and `foerier-app`
  to GHCR tagged `:latest` and `:<sha>`, listen on a port, run migrations at
  start, and answer `GET /api/v1/version`. `docker-compose.dev.yml` is local
  development only.
- **The deployed-target Tier 5 is absent from CI** until that infrastructure
  can deploy the images. Adding a job that cannot pass would only teach us to
  ignore a red pipeline. Tier 5 runs locally against a production build in the
  meantime. Tier 4 has since landed (`1539df4`): CI's `contract` job waits for
  Watchtower to serve the pushed SHA, then runs `npm run test:contract`. **This
  deviation is now closed**: an `e2e-prod` job runs the `@production` specs
  against `app.foerier.app` after `contract`, and the thing that had actually
  been missing was a Household CI may destroy rather than the deploy (§12.8).
- **The API's response headers landed with the skeleton**, not with auth. They
  are baseline hygiene for every response, and `Cache-Control: no-store` is
  specifically what makes `/version` usable as a deploy signal.
- **The layout ladder landed by half, and this list did not say so** — found
  and closed at S3, recorded here because the omission is the interesting
  part. S0's entry asks for "the five layout modes and nav treatments of
  [frontend-design §3.1](frontend-design.md)", and because nothing here
  contradicted it the ladder was believed complete for three slices. What
  *had* landed (`ui/styles/layout.css`, `AppShell.module.css`) is the
  viewport ladder: the em breakpoints, the gutter steps, `--nav-size`
  flipping 56px → 216px, and the nav's three treatments. What had **not** is
  the **pane structure** §3.1 also promises — no screen ever grew a second
  pane — and the entire `@container` layer of §3.2, of which `app/src` held
  exactly zero rules against five specified layout modes. S3 built both
  ([§12.5](#125-consequences-of-s3-tags-and-the-slicing-engine)). The lesson
  for a future slice: a deviation that is *invisible* until a later slice
  needs it is exactly the one worth writing down here.

### 12.2 Consequences of auth slice 1

- **Relative imports in `api/` and `shared/` carry an explicit `.ts`
  extension**, enabled by `allowImportingTsExtensions`. Node's ESM resolver
  does not guess extensions, and `node src/…` is what runs the dev server, the
  migration CLI, and the **Maintainer bootstrap script** — none of which would
  resolve an extensionless specifier no matter what the type checker thinks.
  Vite and esbuild handle `.ts` specifiers, so the bundled side is unaffected.
- **The relying party has three modes, not two.** WebAuthn requires the RP ID
  to be a registrable suffix of the origin's domain, so `foerier.app` simply
  cannot work on `localhost` — no configuration makes both work at once. Local
  development and a *local* Tier 5 run therefore use `localhost`, which yields
  credentials that are correctly useless anywhere else — while a production
  Tier 4 or Tier 5 run derives `foerier.app` from the origin under test
  (`rpIdFor`, `test/contract/credential.ts`), so the one captured credential
  stays valid across `app.`, `api.` and any later subdomain. **Tier 2s uses
  the production values**, since it needs no browser: the RP ID and origin
  that actually ship are the ones under test. Production is a constant with no
  environment override, because a wrong RP ID in production is unrecoverable.
- **One endpoint was added to [auth-design §9.1](auth-design.md):**
  `POST /auth/join/preview`. The join screen has to render "Join Veldkamp?"
  before the user agrees to anything, and no endpoint in the original table
  could tell it the household's name. It consumes nothing and stores nothing —
  not even a challenge — so a link preview still burns no Invite.
- **The `credential` table is named `passkey`**, per the rule that each term
  means exactly one thing; the `credential_id` column keeps WebAuthn's word.
- **The join success screen owes a first-sync fold.** The design boards were
  revised (`ff31e38`) after this slice was built: `Open the depot` used to be
  ungated and explicitly "does not wait for sync to finish", which is what is
  implemented. It is now specified as the app's one unavoidable loading screen
  — a determinate, resumable fold of the household's op log, with the CTA
  gated on completion. That cannot be built until the op log exists, and the
  screen is correct as it stands today because a new Household has nothing to
  fold. **S2b delivered the gated variant** — one `FirstSync` component, keyed
  off the engine's bootstrap progress rather than its status string, composed
  into the join card and rendered full-screen ahead of the shell everywhere
  else.
- **The first-sync screens still owe `person_name`.** The success frame's
  `Els · Veldkamp` and the confirm frame's `YOU JOIN AS` / `INVITED BY` are
  all blocked on one field: `InvitePreview` (`app/src/auth/api.ts:22`) carries
  `household_name` and no person, so that line is currently half-buildable —
  which is worse than absent, and neither frame renders it. Widening the auth
  contract on a slice's last task was rejected deliberately; this records the
  debt rather than paying it. A second, unrelated field is a candidate for the
  same trip if one is ever made: `household_seq` on the join response, which
  would let the confirm frame's `OP 0 OF —` denominator resolve immediately
  instead of waiting on the first pull — a possibility, not a commitment.
- **Story 27's last acceptance criterion is not delivered.** "If this Device
  cannot hold a Passkey, I can still complete the join" needs
  `POST /auth/device/claim`, which [auth-design §13](auth-design.md) places in
  slice **3**, not slice 1. The tension is between that slicing and the story's
  own criteria; it is recorded rather than resolved, because promoting work
  across a slice boundary is the maintainer's call, not the implementer's.

### 12.3 Consequences of S2a, the Depot

- **The local log is keyed by `lsn`, not by `seq`.** A locally-authored op has
  no `seq` at all until the server assigns one, so `seq` can key neither the
  log nor the snapshot's high-water mark. `lsn` is a purely local append
  counter: never sent, never compared across devices, and meaningless beyond
  "written to this device's log before that one". It is what makes the outbox
  a *query* rather than a second structure — every record with `seq === null`
  and not dead-lettered, in `lsn` order — and what lets the store fold by
  catching up from `since(lastLsn)` whether the op came from a local `emit` or
  from a pulled page.
- **The push transaction locks, then dedupes, then reserves — in that order.**
  `sync/push` takes the household's row lock first, resolves which submitted
  ops are already stored (they get back the seq they *already had*, never a
  fresh one), and only then reserves one contiguous range for the genuinely
  new ones. Reversing any two of those steps leaves the sequence with a **gap**
  — a reserved seq that no op ever occupies — and a gap is not cosmetic here:
  [sync §6.4](sync-protocol.md)'s `household_seq` is usable as the first
  sync's *total* precisely because `seq` is gapless and therefore counts. A
  bootstrap denominator that can never be reached is the app's one unavoidable
  loading screen never finishing.
- **`household_seq` rides on the pull response as well as the push one.** It
  is the same field and the same fact — the household's high-water mark — and
  pull is where the first sync actually needs it. It is a **denominator**, and
  a moving one; `has_more` remains the sole paging condition. A client that
  paged until `cursor` caught `household_seq` would never finish against a
  household being written to.
- **`null` clears a nullable register; an absent field leaves it alone.**
  [sync §1.3](sync-protocol.md) is the authority for that, generally and with
  no per-field carve-out. **§5.3 obligation 5 is not**: its text runs one way
  only — treating an *absent* field as an explicit clear — so it says nothing
  about what a `null` payload should do, and citing it to justify collapsing
  `null` into absent was an error made and corrected inside this slice. This
  is also what `exactOptionalPropertyTypes` (§12) has been enforcing at the
  type level since S0.
- **Two dependencies were added.** `zustand` in `app/` — the reactive surface
  §3 named from the start, finally needed now that there is a fold to
  subscribe to; the store is built with `zustand/vanilla` and provided through
  React context rather than reached for as a module global, so a test renders
  a screen over a store it seeded. And `fast-check` at the **root**, for the
  convergence tier ([testing.md](testing.md) Tier 2) — the property-based
  "any interleaving of the same ops reaches the same state" checks that are
  this project's signature test, and the one tier that cannot be written by
  hand.
- **A 401 is acted on, not merely displayed.** The engine reporting
  `signed-out` is the app's only signal that a Device's token is gone, and it
  is what calls `handleUnauthorized()`: [auth-design §7.2](auth-design.md)
  literally — mark the session invalid, route to `/signin`, and **leave the op
  log and the outbox untouched**. Ending the session drops the store and stops
  the frozen engine through the same effect cleanup a sign-out uses, and
  re-signing in builds a **new** store with a **new** engine. A frozen engine
  is still never resumed; `resumeSync()` exists for a re-auth flow that
  recovers *in place*, which this deliberately is not.

  Without this the depot froze with `SIGNED OUT · SAVED ON DEVICE` in the
  header and no route back — `/signin` redirects away while a session exists
  — so the shell line is now what it should always have been: the state for
  the moment between the freeze and the redirect, not a resting place.
- **The sign-in screen's unsynced count is read before the session ends**, for
  the obvious reason that ending it drops the store that can answer. The
  number is `DepotStoreState.unsyncedCount()` — the outbox plus the
  dead-letter, which do not overlap — and it is the whole reassurance of that
  screen: the work is on the device and flushes after the next sign-in.
- **Still owed to the Account screen: `sign out this device`.** Its destructive
  half exists — `clearLocalData()` in `app/src/depot/wiring.ts`, the one path
  that clears the local log — and so does the count its confirm sheet must
  state, but S2a builds no Account screen, so nothing calls either yet. A 401
  must never take that path.

### 12.4 Consequences of S2b: Find, whereabouts, and the fold

- **`ownedCount` must be gated on `kind` wherever it is read.** Per-field LWW
  leaves the `ownedCount` register intact through a `gear.kind_set` to
  `single`, by design — nothing cascades. So any reader that does not gate
  shows a count the gear no longer owns. This shipped as a live bug: the gear
  detail screen rendered `ITEM · SHARED` from a gated `metaLine` directly
  above a Whereabouts card reading `×6 THERE`. Fixed in `dec9462`. The three
  readers that must agree are `shared/src/selectors/whereabouts.ts`,
  `shared/src/selectors/depot.ts`'s `depotCounts`, and `GearDetail.tsx`'s
  `metaLine`. This is the most important entry — two screens two lines apart
  depend on it and no durable doc said so until now.
- **Two different 401 body shapes.** `/auth/*` returns a flat
  `{ "error": "unauthorized" }` (`api/src/auth/middleware.ts:41,63,67,69,72`);
  `/sync/*` returns sync §6.3's `{ error: { code, message, detail } }`
  (`api/src/sync/routes.ts:47-60`, whose comment ends "Unifying the two shapes
  is a later decision for whoever owns `/auth/*`"). `auth-design.md` specifies
  no 401 body at all, so neither shape is a contract violation — but the
  divergence is real, and the decision to unify them is deferred rather than
  made.
- **`WhereaboutsCard` has a known future collision.** `HOME_LABEL` is
  hardcoded inside the map and `key={slice.kind}` collides the moment two
  `'trip'` slices coexist — i.e. multiple active trips. Recorded today only
  in the component's JSDoc (`app/src/components/WhereaboutsCard.tsx:13-18`);
  the type will force both edits when a second `'trip'` slice kind lands, but
  nothing enforces it before then.
- **`ui/` never received its composites.** `ui/src/` holds only `Logo`, while
  [frontend-design §5](frontend-design.md) assigns `WhereaboutsCard`,
  `GearRow`, `TripCard`, the Radix-wrapped primitives, `ErrorBoundary`, `Icon`
  and `motion` to `ui/`. `WhereaboutsCard` and `HomePicker` were built in
  `app/src/components/` instead, and Radix is not a dependency yet.
  `Find.module.css` and `Depot.module.css` now share nine byte-identical
  blocks, and `Find`'s `PlainRow` duplicates `Depot`'s row JSX — the second
  copy, which is what makes a shared `GearRow` worth extracting in S3.
- **`/trips` is a stub.** `app/src/App.tsx` renders an `EmptyState`
  placeholder awaiting S6.

### 12.5 Consequences of S3: tags and the slicing engine

- **A dimension is a row in a table, never a branch in a predicate.**
  `shared/src/selectors/slice.ts` holds `DIMENSION_TABLE`, and each dimension
  declares an `arity`, a `valuesOf` and a `format`. §8.5's five later slices
  add a row there. Two things already fall out of `arity` rather than being
  special-cased: whether picking a value **adds or replaces**, and whether a
  ghost add-chip survives an active value. `valuesOf` takes `state` as well
  as `gear` even though neither S3 dimension needs it — S4's Ownership must
  resolve a `personId` and S7's Trip membership is cross-aggregate, and
  reshaping the table later is the expensive version of that.
- **There is exactly one filter rule: every selected value must be carried.**
  Search ANDs with it. A second combinator was the obvious thing to build and
  buys nothing: several tags AND (Components §04 says so), a single-arity
  dimension degenerates to equality for free, and a dimension with nothing
  selected is skipped rather than turned into a predicate matching
  everything.
- **`NEWEST FIRST` is derived, because there is no `createdAt`.**
  `recordedAt` is the **minimum `(hlc, deviceId)` across a gear's registers**.
  Adding a register would have been wrong for every piece of gear recorded
  before this slice — i.e. the only depot that exists — and reading
  `gear.container`'s stamp ties the sort to an omission §4.3 records as
  deliberate. The derivation is convergent (every replica holds the same
  registers) and monotone (a register only accepts a strictly later write).
  **Tag registers count too**; excluding them would make the answer depend on
  which dimensions happened to exist when the gear was recorded.
- **`TagString` is the project's first branded type.** There is no Tag entity
  and no rename op, so the picker is the only place a spelling is decided —
  and the brand is what makes "only" structural rather than aspirational:
  `gearTagApplied` cannot be handed a raw string. It costs nothing at
  runtime. The reader stays entirely tolerant: `reduce.ts` reads the tag with
  plain `readString`, so a non-conforming tag folds exactly as received and
  two spellings of one intent are two registers.
- **Normalisation has two halves, and the split was found by a test.**
  `normalizeTag` trims the trailing hyphen, because a finished tag must never
  carry one — but run on every keystroke that eats the space in `cook set`
  before the `s` arrives, and the picker silently stores `cookset`.
  `normalizeTagInput` is the typing-time half, and `normalizeTag` is defined
  in terms of it so no third rule can hide between what a field shows and
  what an op stores.
- **`ui/` finally has composites, and `GearRow`'s table variant is a prop.**
  Components §03 says all three renders are "picked by `@container`, never by
  viewport", and `2-LINE` ↔ `1-LINE` is exactly that. `TABLE-44` is not: it
  is a different DOM (a `KIND` cell and a `TAGS` cell no folding row has), so
  a CSS-only switch would render both and hide one, duplicating every fact in
  the accessibility tree — and the widths do not separate, Roomy's widest
  container being ~672px against Desktop's narrowest table at ~760px. Recorded
  as a deliberate departure from §03.
- **S0's layout shortfall is paid down** (§12.1): the Split two-pane, and the
  first `@container` rules in `app/`. The rule the two now follow is written
  into [frontend-design §3.2](frontend-design.md) — a **media** query decides
  which panes or elements *exist*, a **container** query decides how what
  exists *lays out*. Desktop deliberately keeps no detail pane; the board's
  1024 frame spends that width on the table.
- **The Depot's desktop `PLACES` sidebar was built, seen to be wrong at a real
  viewport, and removed — and the design round that followed agreed.** §2's
  desktop frame drew a 216px sidebar holding logo · ALL GEAR · PLACES · sync
  line and no nav at all, while [frontend-design §3.1](frontend-design.md)
  gives Desktop a **labeled nav sidebar** at that exact width, so building both
  put two 216px rails side by side. The deciding argument was never layout:
  **Place is not a dimension** — not in S3 and not anywhere in §8.5's ladder —
  so a `PLACES` list could only ever have been decorative. Design round 3
  settled it the same way ([§12.6](#126-consequences-of-the-r3-shell-round)):
  the sidebar is the app nav, `PLACES` is retired outright, and Components
  §05's containment tree is tagged retired with it for want of an entry point.
- **Two board elements ship changed, both because story 36 (Undo) is Later.**
  Add gear's confirmation line has no `UNDO` — the board specifies "removes
  the op", which an append-only log that may already have pushed cannot do,
  and story 36 rules out `gear.retired` by name — and the Home picker's
  `MOVE` **gains a confirm**, since "UNDO per the global rule" has no global
  rule to lean on. Both revisit when story 36's design phase lands.
- **The desktop board leaves `NEWEST FIRST` unreachable.** Sort there is
  "click a column head", and no column shows when gear was recorded. The
  expanded arrange row therefore keeps its `SORT` options *and* the `GEAR`
  head toggles A→Z / Z→A — strictly more reachable than either alone.
- **Radix is still not a dependency.** [§5](frontend-design.md) assigns the
  interactive primitives to thin Radix wrappers in `ui/`; the sheets that
  shipped in S2 are hand-rolled scrims and S3's two new surfaces match them.
  A deliberate deferral, not an oversight.
- **`localStorage` enters the app, for two enum values only.** Sort and group
  persist per device; `localStorage` because it is **synchronous**, and an
  async `META_STORE` read would paint the default sort on the most-visited
  screen and then flip it. It holds no household data and must not.

### 12.6 Consequences of the R3 shell round

The design round that answered S3's open question, and the code that followed
it. The question was which of two boards owned the 216px Desktop slot; the
answer is **the app nav, one spec on every desktop screen**, with `PLACES`
retired outright.

- **The shell now has three nav treatments, and picks between them in JS.**
  Bottom tabs below Split; a 56px **icon** rail at Split; a 216px labeled
  sidebar at Desktop. A media query and not CSS, because the treatments differ
  in **which elements exist** — icons versus labels, a count versus none — and
  hiding the surplus with `display: none` would leave a count in the
  accessibility tree at phone width, on a board that draws none there. This is
  [frontend-design §3.2](frontend-design.md)'s own rule, applied a second time
  and for the same reason `GearRow`'s table variant is a prop.
- **The sync line moved into the nav from Split up**, and the shell grid lost
  the header row with it. The SIDEBAR ANATOMY card is explicit — "never in the
  main column at desktop" — and at Split the 56px rail carries the **dot
  alone**, which is then the element that has to announce the state, since no
  text sits beside it.
- **Counts are handed in, not read.** `AppShell` renders *outside* the
  `DepotProvider` — deliberately, so the nav never depends on a store the
  signed-out shell has never had — so `App` reads the counts and passes a map
  keyed by href. A destination with no entry simply draws no count, which is
  how the board reads it, and the rule for which destinations get one is not a
  list but a sentence: **a count is the size of the list the destination
  opens.** `/find` therefore never gets one — it answers a question rather
  than holding a collection — and every destination that does open a list gets
  one on the slice that builds the list.
- **The `ACCOUNT` affordance was settled and left unbuilt, in all three
  modes — and built at S3.5.** R3 draws a sidebar row pinned bottom, a rail
  avatar, and a phone header avatar; all three were blocked on the same
  thing, **there is no Account screen**, and an affordance that leads
  nowhere is worse than a missing one, so the anatomy landed at R3 and its
  entry points waited for the screen they open. S3.5 built that screen
  (auth slice 4, story 30, `docs/design/README.md` §11) and opened all three
  doors in the same slice: the sidebar's `margin-top: auto` group holds the
  labelled row, the rail gets a 22px avatar above the sync dot, the phone
  header gets one beside the sync line. The initial is `aria-hidden` for the
  same reason the sidebar count is two bullets up, and `null` — a Login can
  point at a `person_id` no op has created yet, `auth-design.md` §2.1 —
  draws an empty circle rather than an invented letter.
- **`Logo` had been announcing "foerier" twice** wherever it was given a
  `title` — its own doc said the mark "would make a screen reader say foerier
  twice" beside the wordmark, while `title` was passed straight through. Three
  call sites were doing exactly that. The rule now lives in `Logo`: a `title`
  reaches the mark only when the mark stands alone.
- **A nav link's accessible name must not carry its count.** Folding `128`
  into the sidebar link made the name change as gear was recorded — `Depot 0`,
  then `Depot 1` — and announced, that is as easily a room number as a tally.
  The count is `aria-hidden`; the Depot screen's own `128 GEAR · 214 PIECES`
  headline is where the fact is stated unambiguously. **Found by Tier 5**,
  which had been asking for the link by name and stopped finding it — the
  first defect in this codebase that only the golden path caught.
- **`ui/` gained the `Icon` set** ([frontend-design §5](frontend-design.md)'s
  assignment) — three inline SVGs transcribed from the rail, `currentColor`
  throughout so the active state is expressed once by the row rather than
  twice per icon, and decorative by default because the link beside them
  already carries the name.

### 12.7 Consequences of S3.5

Auth slices 3 and 4, delivered together
([spec](specs/2026-08-28-auth-device-links.md), §8's float): device links,
"Continue without a passkey", the Account screen, and both Maintainer
scripts. Written after the slice, deliberately — these are the things only
running code could teach.

- **A server-side proxy for a domain fact is only ever right for one case,
  and the second case is what finds the boundary.** `previewInvite` answered
  "does the joiner name themselves" with "does this Household have any
  Login" — sound for a brand-new Household, since one with no Login is
  necessarily one whose first Person is created as they join, and wrong for
  every Household after its first. The fix was not a better guess; it was to
  stop guessing. `person_recorded` moved onto the Invite itself, stated by
  whichever code mints it — the bootstrap script, `admin:invite
  --household`, and S5's in-app issuer later — because the issuer is the one
  place that actually knows which case it is. The lesson generalises past
  this one field: a proxy computed from *other* state is a bet that the
  cases it was fitted to are the only cases, and the domain model, not the
  server, is what should be asked to state a fact it already owns.
- **`passkey.created_on_device`, and enrolment is not reachability.** The
  Devices list's `NO PASSKEY HERE` line needed a per-Device fact nothing
  recorded: which Device enrolled which Passkey. A nullable FK on `passkey`
  answers it — set once, in the same transaction that adds the credential —
  but it is honest about what it is not: a credential synced through a
  platform's own password manager is usable from a Device that never
  enrolled it, and the server has no way to see that. The column, and the
  line it feeds, say what happened *here*, never what is reachable *from*
  here. Not in the original spec — added while mapping boards §12, and the
  spec was amended to cover it rather than left behind by the code.
- **`uqr` is the first dependency this repo chose by measurement rather than
  reputation.** A device link's whole reason to exist is reaching a phone
  that cannot be handed a 43-character secret by any other means, so the QR
  in boards §14 is load-bearing, not decorative — and hand-rolling one trades
  a small dependency for Reed–Solomon and mask-penalty scoring whose failure
  mode is silent (a code that scans on the author's phone and not on
  anyone else's). Three real candidates were minified and gzipped through
  `esbuild`: `uqr` at 4.3 KB gzipped with zero runtime dependencies, against
  8.5 KB and 9.7 KB for the nearest alternatives, one of which resists
  tree-shaking entirely. It returns an SVG string rather than a canvas or a
  `data:` URI, so nothing in the CSP had to widen. Landed behind
  `ui/src/QrCode.tsx`, per [frontend-design §5](frontend-design.md)'s rule
  that a primitive is reached through a wrapper — the one place a future
  replacement, should `uqr`'s pre-1.0 status ever become a live risk rather
  than a small one, would have to change.
- **The `ACCOUNT` debt §12.6 recorded as "settled and left unbuilt" is now
  discharged, in all three nav modes.** The sidebar row, the rail avatar, and
  the phone header avatar all open the same screen; see §12.6's own bullet
  for the anatomy. What that leaves the debt ledger (`CLAUDE.md`) shorter by:
  the four affordances R3 drew with nowhere to go, and `clearLocalData()`,
  which had a name and no caller until this slice gave "sign out this
  device" a confirm sheet to call it from.
- **A component test's injected `clearLocalData` had been standing in for a
  real IndexedDB connection, and the stand-in was hiding a real hang.**
  `sessionStore.ts` caches one long-lived connection to `foerier` for the
  app's whole life — unlike `depot/opLog.ts`, which opens and closes per
  call for exactly the reason given below — and `auth/pendingFirstPerson.ts`
  was opening a fresh one per call and never closing it. Neither blocks
  `deleteDB(DB_NAME)` in a Tier 3 test, because Tier 3 injects a fake
  `clearLocalData` that never touches a real database at all. It blocks
  forever in a real browser: IndexedDB will not grant a delete while any
  same-origin connection is still open, so "sign out this device" hung on
  its confirm sheet — buttons disabled, nothing to click, no way out short
  of a reload — every single time, for every real Quartermaster. **Found by
  Tier 5's sign-out journey**, the second defect in this codebase only a
  real browser could catch (`§12.6`'s nav-link name was the first). The fix
  is the pattern `opLog.ts` already carried a warning about in its own
  comment: `sessionStore.ts` now closes its cached connection when a
  `blocking` event says something else is waiting on it, and
  `pendingFirstPerson.ts` now opens and closes per call, matching `opLog.ts`
  exactly.
- **Three new screens shipped eleven `console.error` calls and zero error
  surfaces, in an app whose defining property is that the network is
  usually absent.** `Account.tsx`, `Devices.tsx` and `DeviceLink.tsx`
  between them caught every failure their own comments described — a spent
  secret, a 401, being offline — and told nobody: the failure was logged to
  a console no Quartermaster will ever open, and the screen carried on as
  if nothing had happened. `NoPasskey`'s bare catch routed every one of
  those failures onto the single screen the device-link path shows, silently;
  `Account` and `Devices` initialised their device and passkey lists to
  `[]` and let a failed fetch read as `0 devices signed in.` — a confident,
  wrong statement about the household's security posture, not an empty
  state; `confirmThisDevice` had no catch at all, so a rejecting
  `clearLocalData` left `stopSync()` already called with an unhandled
  promise rejection and the sign-out sheet closing over it. Thirty-four
  component tests existed across the three screens and not one of them
  made an API call fail — the absence of error state and the absence of a
  test that would have noticed were the same gap, seen from two sides.
  **Two of these were genuinely new at the final whole-branch review; the
  third was not, and that half is the more instructive one.** The
  Account/Devices load-state lies and `confirmThisDevice`'s missing catch
  surfaced for the first time there, after five separate per-task reviews
  had each passed the commit that introduced them — a per-task review is
  scoped to the screen its own commit touches, and each of those screens'
  failure paths looked locally reasonable, a `catch` that did *something*
  (logged, swallowed, moved on) reading as handled until it is read against
  the app's own premise that offline is the ordinary case, not the
  exception. `NoPasskey`'s silence is different: Task 4's own review caught
  it and named it — "retryable but silent … a claim that fails for a spent
  or expired link currently just does nothing visible, which on the
  compatibility path is the wrong kind of quiet" — and the controller
  deferred it rather than fixing it, on the judgement that a screen-local
  gap could ride to the next round. The final review's addition was that the
  deferral had understated its own finding: every register failure funnels
  there, not only a decline, and on the device-link path it is the *only*
  screen the person ever sees, so its silence was 100% of that journey's
  feedback rather than one screen's rough edge. Two lessons, not one: a
  slice's error-handling discipline is not a per-screen property checkable
  one task at a time, it is a property of the slice as a whole and needs a
  pass that reads the whole diff looking for exactly this shape of gap —
  and separately, a deferral is a bet on a finding's blast radius, and that
  bet needs to be re-priced against the whole journey the screen sits on,
  not just the screen in front of the reviewer when it was made.

### 12.8 Consequences of Tier 4 and 5 against production

The contract tier's household suite and the Tier 5 golden path now run against
the box after every deploy
([spec](specs/2026-08-28-tier-4-and-5-against-production.md)). Not a slice — no
op type, no `shared/`, one route and one migration — but it settled several
things the tiers above only stated in the abstract.

- **The blocker was never the golden path being incomplete.** `ci.yml` had
  deferred Tier 5 on the grounds that the journey needs trips, packing and
  closing, which await S6–S10. That reasoning does not survive examination:
  every actual blocker was timeless, and the real one was that CI had no way
  to obtain a **Household it is allowed to destroy**. Naming it that way turned
  a wait-for-S10 into one route, `POST /api/v1/test/reset` (`api/src/test/`),
  that deletes and can never create. Three gates hold it: it is not mounted
  unless the server was started with `E2E_HOUSEHOLD_ID` — so the kill switch
  lives in the infrastructure repo, outside this one — the calling token's
  Household must equal that value, and the Household row must carry
  `disposable = true`, set only by `admin:bootstrap --disposable` and read
  under the same `FOR UPDATE` lock `/sync/push` takes, so the gate and the wipe
  cannot see different rows. Mounted conditionally rather than guarded inside a
  handler, so "unset ⇒ 404" is true by construction with no early return for a
  refactor to lose. A destroy-one is a much smaller thing to reason about than
  the mint-a-Household-per-run endpoint most designs reach for first: its blast
  radius is one named Household rather than unbounded tenant sprawl, and it
  needs no new class of secret.
- **A migration number is claimed when it lands, not when it is planned.** This
  work was designed to borrow the `0004` migration S3.5 was about to open.
  S3.5 landed first and `0004` shipped without the two columns, and migration
  names sort lexicographically and are never renamed once deployed
  (`api/src/db/migrations.ts`) — so the columns ship as their own
  `0005_disposable_household`. Both are purely additive (one defaulted, one
  nullable), which is what made the reorder cost nothing. The general form: a
  spec may depend on another spec's *behaviour* and be rearranged around it,
  but it must not depend on another spec's *unopened numbered slot*, because
  that slot is allocated by whichever branch reaches the box first.
- **A Device token never crosses a job boundary.** One mechanism unblocks both
  tiers, and it is the **credential**, not the token: `contract` runs before
  `e2e-prod`, so "reuse the browser's token" would mean a token travelling
  backwards as a job output or an artifact, neither masked and both readable
  from the run page of a public repository — carrying a sliding year of life.
  So each job mints its own from the same exported Passkey, and Tier 4 does it
  with no browser at all, driving Tier 2s's own `SoftwareAuthenticator`
  (`api/test/server/softwareAuthenticator.ts`) through the real ceremony. The
  token is masked in `globalSetup`, in the main process, because `::add-mask::`
  is honoured only on a line of the step's own stdout and a mask called from a
  test worker masks nothing; no assertion is ever made on a body that carries
  one; and the production Playwright project sets `trace: 'off'` with the
  `list` reporter, so there is no artifact to upload rather than a convention
  against uploading it. Serving both tiers from one credential is also what
  fixed the algorithm order: an authenticator takes the first algorithm offered
  and `SoftwareAuthenticator` implements only ES256, so both registration
  ceremonies now offer `[-7, -8, -257]` (`api/src/auth/service.ts`) and the
  capture script refuses anything else.
- **A test fixture can be an intrusion detector, and this one is.** A
  compromised E2E Household looks perfectly healthy from outside: it syncs, it
  signs in, its tests pass. Nothing would ever have prompted the rotation the
  risk table bounds the leak with. So the route returns counts of what it
  *did*, and every run asserts `revoked ≤ 1`, `passkeys = 0`, `invites = 0`
  immediately after its first reset. What makes that an oracle rather than a
  heuristic is the `UPDATE` itself: revoking every Device but the caller's on
  every reset bounds the Household to exactly one live token, always, so the
  expected counts are exact. A violation fails the build naming the rotation
  procedure, and does not continue — the wipe has already happened, so the
  count is the only evidence left.
- **Only a subset of Tier 5 can run against a shared, never-recreated
  Household**, and the specs that cannot are more interesting than the ones
  that can. Three kinds are excluded: one that mints an Invite by Maintainer
  script (it needs `DATABASE_URL`, which CI does not have and must not), one
  that proves joining itself — joining consumes an Invite from the one
  Household nothing re-creates — and one that signs the run's own Device out
  from under every later spec. So `auth.spec.ts` and `deviceLink.spec.ts` stay
  local-only and `depot.spec.ts` and `shell.spec.ts` carry `@production`,
  selected by the production project's `grep`. The local project has no grep,
  so a local run is unchanged, and every excluded spec still runs there against
  a Household minted per test. The seam shows up in the fixture too: the
  signed-in storage state is applied *inside* `quartermaster.ts` rather than as
  a project-wide `use.storageState`, because `shell.spec.ts` needs a
  **signed-out** visitor and a project-wide setting would have signed it in and
  quietly emptied those tests out.

### 12.9 Consequences of the Radix conversion

The slice that discharged [S3.5 §10](specs/2026-08-28-auth-device-links.md)'s
condition and made §5's `ui/` assignment true for the first time. No ops, no
endpoints, no `shared/`; see its
[spec](specs/2026-08-29-radix-conversion.md).

- **It was eleven surfaces, not six.** Three deferrals had all counted
  *components* — the census by `aria-modal` found eleven, because three
  confirms were nested inside other sheets' JSX and had never been counted at
  all. Those three were also the worst-behaved: no Escape, no dismissal but
  their own Cancel, no focus trap. The lesson is small and repeatable: a debt
  that gets re-counted at each deferral should be counted by the thing that
  costs, not by the file it lives in.
- **Two primitives, because the role is not the only difference.** `Sheet`
  wraps Radix Dialog; `Confirm` wraps AlertDialog, which withholds
  outside-click dismissal and focuses its Cancel. Passing
  `role="alertdialog"` to a Dialog would have bought the announcement and none
  of the behaviour. `Confirm` therefore joins §5's primitive list rather than
  being a variant of `Sheet`.
- **`open` is not a prop anywhere; mounted is open.** The reason is a live bug
  it fixed rather than symmetry: `HomePicker` was mounted permanently by gear
  detail and early-returned `null`, so EDIT mode and four drafts survived a
  close and returned on the next open. Mount is the reset. The trade, recorded
  in the spec: Radix's `Presence` needs an `open` transition to animate a sheet
  *out*, so the first exit animation puts the prop back and moves draft state
  below `Dialog.Content`.
- **Radix restores focus to a `Trigger`, and we render none.** Its modal
  Dialog `preventDefault()`s the focus scope's own restore and focuses
  `Dialog.Trigger` instead — so a wrapper that is mounted *because* it is open
  restores focus to nothing, leaving it on `<body>`. Both wrappers capture the
  opener during first render and restore it from `onCloseAutoFocus`. Worth
  knowing before wrapping any other Radix primitive the same way: a
  trigger-less mount is not a shape Radix's defaults assume.
- **A ≥52em treatment was nearly deleted in the move.** `TagPicker` and
  `SortGroupSheet` each ended with a media block that redrew `.scrim`,
  `.sheet` and `.grabber` as a centred, unscrimmed card — so the slice-bar
  pickers were never bottom sheets at Split and above. Moving those three
  classes to `ui/` would have taken the block with them, silently. It survives
  as `Sheet`'s opt-in `desktopCard`, which is honest about what it is: §4a's
  *"popover on desktop"* approximated until `Popover` lands, rather than every
  sheet's desktop form. **The general point**: when a class moves out of a
  module, what dies with it is every rule that *selected* on it, and a media
  block at the bottom of a file is where that hides.
- **The accessible name moved from `aria-label` to the visible title**, and
  all eleven names already matched their headings — so sixteen existing
  `getByRole(…, { name })` assertions across five test files passed unedited
  and were the conversion's regression suite. A name that is the text on
  screen cannot drift away from it.
- **Measured cost: +13.45 kB gzip** on the app's one JS chunk (106.75 →
  120.20), for both packages, against roughly 120 lines of hand-rolled JSX and
  sixteen CSS blocks deleted. There is still no enforced bundle budget in CI.
- **What every overlay gained**: a focus trap, focus return, Escape, the rest
  of the app hidden from assistive tech, and a scroll lock — none of which any
  of the eleven had. What five of them lost: scrim dismissal, which
  `Confirm` withholds on purpose (a stray tap on the dim area is not a
  decision, least of all on a sheet that is mid-`clearLocalData()`).
- **One confirm cannot use `Confirm.Action`.** That part closes on click,
  which is right for a decision that is over when it is taken and wrong for
  sign-out-this-device, which has to outlive its own action to say `▲ Another
  tab has this open`. It uses a plain button and closes when the sequence
  finishes. `Confirm.Cancel` is still there, so Radix's focus target is
  unaffected.

### 12.10 Consequences of S4: People and ownership

The slice that delivers story 4 and unblocks S5. Two op types, no endpoints,
no migration; see its [spec](specs/2026-08-29-people-and-ownership.md).

- **§8.5's ladder was followed, not departed from — and that is worth saying
  because S3's entry above records departures and a reader will look for one
  here.** The ladder says Person *and* Ownership at S4, and the boards draw
  two dashed ghost chips to match. The tidier design was one merged `OWNER`
  dimension: the folded state is a single register, one chip would have
  expressed both of story 4's narrowings, and it would have matched the Depot
  table's own column head. Two rows won because the boards drew two, and
  because the second row buys a query the merge cannot express — *all*
  Personal gear, whoever's.
- **The price of two dimensions over one register is a chip pair that can
  only ever return nothing**, and it is **recorded rather than guarded**.
  `OWNERSHIP: SHARED` + `PERSON: ELS` is reachable; the count line reads
  `0 OF N`, which is honest, and `CLEAR (2)` is one tap away. Guarding it
  would mean a second combinator *between* dimensions, and refusing to build
  one is what S3's engine is. The note lives in `passesFilters`, where the
  next author will be standing when they wonder.
- **Grouping got its own table, beside the dimension table rather than inside
  it.** A dimension may answer "several" (Tag) or "none" (Person, for shared
  gear); a grouping must answer exactly one, because it is a partition. `OWNER`
  groups by the *register*, which neither filter dimension does alone —
  grouping by `person` would file the whole shared pool under `—`, and by
  `ownership` would give two coarse groups and never name a Person. The
  distinction paid for itself immediately: "GROUP BY never offers TAG" stopped
  being prose beside a hardcoded branch in three files and became the fact that
  a grouping needs a `keyOf` and Tag has none.
- **An absent `owner` register reads `SHARED`, said once in `shared/`.** The
  fold conflates nothing — absent and `{type:'shared'}` stay different facts
  about the op log — but every *reader* treats them alike, and that equivalence
  lives in one selector because the Ownership dimension derives its values from
  it. A call site that re-derived the rule and drifted would make a row plainly
  labelled `SHARED` vanish under `OWNERSHIP: SHARED`, which is a bug a
  Quartermaster can see. It is also why gear detail's Edit sheet seeds its
  draft through that selector: reading the raw register would make every Save
  on pre-S4 gear author an ownership op, and a needless write moves
  `recordedAt` and reorders `NEWEST FIRST`.
- **`Dimension.format` gained the depot, and S3's own note is why that is
  cheap.** S3 anticipated the need exactly — "S4's Ownership resolves a
  `personId` to a Person" — and put the parameter one function too early, on
  `valuesOf`. Right about the need, off by one about the place. The correction
  reached `app/`, where `SliceBar` took a bound `formatFor` beside the
  `valuesFor` it already had, keeping the component free of `DepotState`.
- **Add gear gained an `OWNER` row, and that is a departure.** The board's F1
  order is settled and reasoned and carries no owner. Without it, S4's only
  route to attributing gear is one gear-detail visit per item and the Depot's
  bulk `SET OWNER` band is story 35, Later — so a household attributing a
  two-hundred-item depot makes two hundred screen visits, and the slice's own
  "usable?" test fails on the first day. It carries over between records for
  the board's own reason for HOME doing so: a depot is recorded shelf by shelf,
  and a shelf in a bedroom is one person's.
- **The People screen ships as the board's minus its entire login half, and
  the three gaps are S5's stated debt.** Every line in the person row's meta
  slot and right column is login state, and `GET /auth/logins` is S5's; the
  circle's accent border means "holds a Login", which S4 cannot know, so it
  draws neutral rather than rendering the joiner as having none. Written into
  the spec's §7 so S5 inherits an obligation rather than a gap somebody has to
  notice — the same discipline §12.7 asked for after `invite.person_recorded`.
- **The Account row S3.5 deliberately omitted is now the argument for its own
  existence.** "An affordance that leads nowhere is worse than a missing one"
  kept `PEOPLE & LOGINS` out at S3.5; at S4 it leads to a real screen, so the
  rule puts it in. It is titled `PEOPLE` until S5 can fill the other half.

### 12.11 Consequences of S6: Trips and phases

The first Trip slice, and therefore the one that decides how the fourth
aggregate is shaped in `shared/` — eight later slices extend what it lays down.
Six op types, no endpoints, no migration; see its
[spec](specs/2026-08-29-trips-and-phases.md).

- **`phase = "draft"` is the reducer's write at `trip.created`, not a payload
  field**, and that single choice does the work three special cases would
  otherwise have to. A `trip.phase_moved` delivered *before* its creation wins
  on its strictly later stamp; a re-delivered creation writes an identical value
  on an identical stamp and loses on `<= 0`; and nothing on the wire can carry a
  phase, so no client can create a Trip that arrives already `closed` — an
  absence rather than a guard. All three are the ordinary per-field LWW rule of
  [sync §3.2](sync-protocol.md) doing the work, which is the argument for
  putting the seed in the handler rather than in the payload, where the
  catalogue's original `{name, from_trip_id?}` shape rather implied it
  belonged.
- **An absent `phase` register reads `draft`, and only
  `shared/src/selectors/trip.ts` says so.** S4's `ownerOf` rule transplanted,
  for the reason §12.10 gives: the fold conflates nothing, every reader treats
  the two alike, and a call site that re-derives the equivalence drifts from the
  sections. Here the symptom is sharper than S4's — a Trip listed under one
  section drawn with another section's chip. What makes it reachable is the
  bullet above read the other way: `trip.created` and `trip.phase_moved` are
  the register's only writers, and `writeTrip` creates the entity on first
  sight of *any* Trip op, exactly as the other three maps do. So a
  `trip.renamed`, a `trip.dates_set` or a participant op landing while the
  creation is still queued on another device leaves a Trip with a name, dates
  or participants and no phase. The out-of-order `phase_moved` is not one of
  those cases and never was: it writes the register unconditionally, so that
  Trip has a phase before it has a name.
- **Every question the phase table answers has exactly one function beside it,
  and the lookup itself is private.** `phaseOf`, `isActive`, `phaseLabel`,
  `phaseName`, `phaseNext` and `isKnownPhase` each answer one question in one
  way, and the row lookup **five** of them share is not exported. `phaseOf` is
  the sixth and reads the register rather than the table, so it is the one that
  never asks. The lookup stays private because each of the five *resolves* a
  missing row — to the raw value, to not-active, to no next step — and
  handing the row out would let a call site decide for itself what a miss
  means. `isActive` is the only definition of active-ness in the codebase, and
  S7's claim selector, S9's whereabouts and S10's close gate all call it. The
  discipline was not free: three separate reviews in this slice caught a call
  site re-deriving one of these — a `PHASES.some(…)` inline, a `?.next ?? null`
  about to be written twice, a hard-coded phase name in the reopen confirm's
  copy.
- **`DAY N` is the `phase` register's own stamp, so at S6 a needless write is
  visible.** No new field, no new op, no migration — `recordedAt`'s trick from
  S3 over one register instead of the earliest of many. The consequence is that
  S4's "a needless write moves `recordedAt` and reorders `NEWEST FIRST`" gets a
  louder instance: a redundant `trip.phase_moved` resets a Trip on `DAY 12` to
  `DAY 1`, in the chip's own content. So tapping the phase the Trip is already
  in emits nothing, and the trip screen's EDIT mode emits one op per field that
  actually changed and none for the rest.
- **An unrecognised phase is not a draft, and the four answers are each a
  decision.** It is **not active** (invariant 17 names three phases; the
  conservative direction is the one where an old build never over-states what a
  Trip is doing), it is **drawn verbatim** (`dimension('kind').format`'s rule),
  it **states no next step** (there is no row to read one from), and it files
  under a section named **`PLANNED`** rather than `DRAFTS` — the section is
  named for its class because calling an unrecognised value a draft would state
  something false. The five known rows stay tappable underneath it, so a Trip is
  never stranded in a phase this build cannot leave.
- **The CTA names the destination that exists, and that is a rule rather than a
  placeholder.** The board's cards read `Continue pack-out` and `BUILD LIST ›`;
  both name screens S7 and S9 build. "An affordance that leads nowhere is worse
  than a missing one" — the rule that kept the `ACCOUNT` row out at S3.5 and put
  the `PEOPLE` row in at S4 — is not quite the case here, because a button that
  leads *somewhere* and lies about where is worse still. So no card carries a
  button or a verb link at all — the interim affordance is the closed row's own
  `›` at the card's trailing edge, with the whole card tappable — and the
  general form is worth carrying forward: **a board's CTA copy lands on the
  slice that builds the board's destination.**
- **The progress line falls through to a next-step line, which is the slice's
  actual requirement rather than a substitute for it.** `● 48/61 PIECES` has
  nothing to count until Entries exist and a `0/0` bar would state a fact about
  a list nobody has built, so its place is taken by the phase's next step —
  §8.3's "with the next thing to do stated". Because the line is a fact of the
  phase *table* and not of the Trip, it stays correct as the later slices build
  the things it names. It is **permanent, not a stand-in**: the line keeps the
  slot it holds today and S7 and S9 return the progress line **below** it,
  never in place of it. The card is also the only surface that draws it: a
  next-step line is a list-scanning affordance, and the trip screen already
  states the phase in its chip and the task in its empty region.
- **`SET PHASE` is drawn as a mono eyebrow and ships in the display face, and
  that is a stated debt rather than a gap.** `Screens B` 02A sets the sheet's
  title in Spline Sans Mono at 8.5px with the eyebrow's letterspacing;
  `Sheet.module.css`'s one `.title` rule sets `var(--font-display)` and both
  `Sheet` and `Confirm` render their titles through it, and `PhaseSheet` is the
  only caller in the app passing a title that is not sentence case. Restyling
  the primitive was refused: the board means *this* title, and every other
  sheet and confirm in the app — `Edit gear`, `Tags`,
  `Home`, `Owner`, `Participants`, `Sort and group`, `Sign out this device?` —
  is sentence-case display and would be wrong in mono. The fix is an opt-in
  `titleTone` on `Sheet` that `PhaseSheet` alone passes, and it belongs to
  whichever slice next opens `ui/`'s overlay primitives rather than to a
  one-caller detour through the shared package.
- **`DepotState` is now the fold of everything, not just the depot, and the name
  stays.** Renaming reaches `DepotStoreState`, `DepotProvider`, `useDepot`,
  `DepotView` and every screen in three workspaces, and S5 was in flight across
  those same files when S6 landed. Recorded as a misnomer rather than fixed
  under a slice that would have to merge against it. **The reason has since
  expired** — S5 has landed, so the rename is now a self-contained job for
  whichever slice wants it, and no longer blocked on anything.
- **S6 paid S4's fixture debt, and the payment is weaker than the original would
  have been.** §8.7 obliges every slice from S2 onwards to capture an op fixture
  for its own op types; S4's spec said the rule applied and no file landed, so
  `person.renamed` and `gear.ownership_set` were pinned by nothing while
  [sync §5.4](sync-protocol.md) had already frozen their wire format.
  `s4-ownership.ops.json` is folded by the **S6** reducer, so any drift between
  the two slices is baked into the snapshot as if it had always been the format
  and nothing in the repo could now tell.
  One slice of window is still far better than the three the next discovery
  would have carried. The transferable lesson is about the shape of the gap
  rather than the fixture: **a spec sentence saying a standing rule "applies
  unchanged" produces no artefact**, and nothing in Tier 0 or CI notices its
  absence.

### 12.12 Consequences of S5: in-app Invites and the Logins list

The slice that finishes the screen S4 shipped half of and delivers story 28;
see its [spec](specs/2026-08-29-in-app-invites-and-logins.md).

- **`REOPEN ›` is undrawable, and the board drew it anyway.** Screens C §08
  puts a `REOPEN ›` affordance on the outstanding-invite row, and it cannot be
  built: [§3.1](auth-design.md#31-the-invite) stores the secret **hashed**, so
  neither the server nor a reloaded client holds anything to reopen — the
  plaintext lived once, in the link, and is gone. The row ships as `EXPIRES IN
  6 d` + `REVOKE` instead; re-handing a link is two deliberate steps, `REVOKE`
  then `INVITE ›`, each of which says exactly what it does. This is the same
  class of departure S3 and S4 each recorded once: a board is a hypothesis
  about the screen, not about what the security design already settled, and
  where the two disagree the security design wins.
- **The partial unique index closes a defect [§1 of the spec](specs/2026-08-29-in-app-invites-and-logins.md#1-one-migration-and-the-defect-it-prevents)
  found at design time, not in production.** `0002_auth.ts`'s plain `unique (household_id,
  person_id)` was right for as long as no Login could be revoked, and wrong
  the moment `DELETE /auth/logins/:id` existed: the next `register/verify` for
  a revoked Person's `person_id` would have hit the index and failed with a
  raw Postgres unique-violation error — not an `AuthError`, so `failure()`
  (`api/src/auth/routes.ts:422`) rethrows it and, with no `app.onError`, Hono
  answers a plain-text `500` rather than the vague `401` every other failure
  on these routes gets — on a screen that can only say "ask for a new invite"
  — which produces another Invite that fails the same way (`JoinContainer`
  treats any non-decline error alike, so the user-facing experience is the
  intended one even though the status code is not). `0006_login_reinvite`
  loosens the constraint to `where disabled_at is null` before any code
  exercised the old one in anger, which is the whole argument for writing a
  spec before writing the migration: the bug this closes never had a chance to
  reach a Household.
- **Purpose-scoped listing is one sentence, not a query parameter.** *A join
  Invite creates a Login — Household business. A device Invite is a
  credential for one Login, and stays with its issuer.* `listInvites` and
  `revokeInvite` both gained the same predicate, `purpose = 'join' or
  created_by_login = <caller>`, because the alternative — a boolean column
  saying who may see a row — would have let the two purposes' visibility rules
  drift independently the first time either changed. One predicate, stated
  once, is what keeps them the same rule read from two directions.
- **Self-revocation is refused, and that refusal is what keeps a Household
  above zero Logins.** `DELETE /auth/logins/:id` answers `400
  cannot_revoke_self` before touching anything else. Since no Login can
  disable itself, no single act can bring a Household to zero active Logins —
  the property holds **by construction**, not by a count checked afterward.
  Two Logins revoking each other in the same instant is the one way around it,
  and it is accepted rather than guarded: it needs two people deliberately
  racing, and `npm run admin:invite` is the named escape hatch
  [auth-design §5](auth-design.md#5-devices-that-cannot-hold-a-passkey)
  already provides for exactly this.
- **A screen designed to be true while knowing less turned out to be its own
  offline mode — everywhere except the one pixel that had quietly become a
  claim.** §12.10 recorded that S4 shipped People with its login half drawn
  neutral, because stating "no login" for a joiner who demonstrably held one
  would be false. S5 needed a fallback for exactly one new case — the login
  fetch failing — and the render it needed already existed: S4's screen, plus
  one line saying the connection failed. But S4 could call its circle
  "neutral" only because the control border meant nothing yet. **S5 gives that
  border the meaning `= no login`, and a neutral state cannot be spelled with
  a token that now carries a claim.** The first fix reached for a third
  colour, which held in sage and collapsed in parchment — where every
  `--color-rule*` resolved to one value — putting the false statement back for
  every light-theme reader, invisibly, because the tests pinned the attribute
  and not the pixel. The boards answered with a **withdrawal**: the ring *is*
  the statement "login state is known", so when the list cannot load the ring
  goes with it. Adding no colour is what makes it unflattenable in any theme.
  The general lesson is about the *seam*, not the circle: an encoding
  inherited as "meaningless for now" becomes load-bearing the moment a later
  slice assigns it meaning, and every fallback that leaned on its emptiness
  silently becomes a lie.
- **Twelve decisions reached code without ever reaching a board, and a design
  pass took all twelve.** S5 is the first slice to have that gap audited
  rather than noticed: what shipped was compared against `docs/design`
  line by line, and everything the boards did not draw — an added meta state,
  an undrawn confirm sheet and its copy, a third door on the handover screen,
  what `EDIT` does to a right column that did not exist when `EDIT` was
  settled, where an undrawn chevron leads — was written up and challenged.
  **Ten came back blessed as built; two were overturned**, the revoke sheet's
  wording and `LAST SEEN`'s timezone. That ratio is the argument for the
  audit rather than against it: the two that changed were both *copy*
  decisions taken silently by an implementer, which is exactly the class a
  code review cannot catch, because nothing about them is wrong as code.
  §8.5's later slices should expect the same pass.

### 12.13 Consequences of S7: the gear list

The Trip's first nested entity map, and therefore the slice that decides how
four later slices (S8 · S9 · S10 · S14) address something smaller than an
aggregate. Three op types, no endpoints, no migration; see its
[spec](specs/2026-08-29-the-gear-list.md).

- **`entries` is a `Record` of entities, and that is a new shape in the
  codebase.** `participants` and `tags` are sets, whose member carries only
  presence; an Entry carries registers of its own — `source`, `bringCount`,
  `removed` — so it needed the shape a set cannot hold. `writeEntry` follows
  `writeTrip` one level deeper, with the same identity check at each level so
  a lost write returns the original object; the generic `writeEntity`
  collapsing all five writers into one is **still not taken**, and `writeEntry`
  being the first two-level instance is the marker for when that argument
  should reopen.
- **`source` is one register holding a discriminated union, and a trip-only
  Entry cannot be renamed.** Renaming would rewrite the whole union, carrying
  `container` along with `name`, and two Devices renaming concurrently would
  each clobber the other's trait. The catalogue defines three gear-list ops
  and none is a rename — recorded as a deliberate omission, on the precedent
  of the containment trait's own missing mutation op
  ([sync §4.3](sync-protocol.md)) — and the UI states nothing about it: a
  missing op is a fact for this document, not release meta-text for a
  Quartermaster mid-sitting.
- **An Entry with no `source` gets no default, unlike `phase` and `owner`.** S6
  reads an absent `phase` as `draft` and S4 reads an absent `owner` as
  `SHARED`; an Entry naming neither a piece of Gear nor a trip-only name is not
  a line anybody can draw a default for. It is folded, retained, excluded from
  the list, from every count and from every claim — the same conservative
  direction S6 took with an unrecognised phase, stated once in
  `shared/src/selectors/entry.ts`'s `entriesOf` and read through nothing else.
- **Invariant 6 is enforced by the authoring screen alone, which is the
  `TagString` split restated for a second op.** `bring_count`'s "Counted
  entries only" cannot be a reducer gate, because the Entry's Kind lives on the
  Gear aggregate and resolving it in the handler would make the fold
  order-dependent on whether `gear.kind_set` had arrived first. `bringCountOf`
  is one of several sites already gating on `kind === 'counted'`
  (`shared/src/selectors/depot.ts`, `shared/src/selectors/whereabouts.ts`,
  `app/src/screens/GearDetail.tsx` and `app/src/screens/Depot.tsx` among
  them), and moving the question behind one function is what let this slice
  add another without adding another copy of the gate.
- **The over-claim view is a pure function of the fold, with no op, no flag and
  no write of its own.** `overClaims(state)` reads registers only, so every
  replica computes the identical set — the containment-cycle argument
  ([sync §3.6](sync-protocol.md)) applied to the second condition the reducer
  must not resolve — and it disappears only when a Quartermaster removes an
  Entry or lowers a Bring-count, both ordinary ops merging like any other.
  Nothing is discarded to resolve a forbidden state; the state is retained,
  reported identically everywhere, and settled by the same op vocabulary as
  everything else. This is what let the band render with no notification
  machinery and no server involvement at all.
- **The first cross-aggregate dimension needed an index, not a reshape.**
  Trip membership is the first of the five dimensions `sliceDepot` cannot
  answer from a Gear's own registers in constant time — answering it per Gear
  means scanning every Trip's Entries, which is O(gear × entries) on the
  Depot's most-visited screen. S3 passed `state` into the dimension table's
  signature so it "would not be reshaped by the first dimension that needs
  it"; S7 is that dimension, and the fix is a module-level `WeakMap<
  DepotState, …>` memo inside `slice.ts` rather than a change to the
  signature — `DepotState`'s immutability is what makes the key exact instead
  of approximate.
- **Ten sentences in the feature spec turned out false once the code
  existed, and none of them are corrected in place** — the shape CLAUDE.md's
  S4-fixture lesson already named, generalised: a spec sentence can assert a
  fact no test then pins, and the fix belongs beside the sentence, not inside
  it. `trips-and-phases.md` §10 sets the precedent — a dated spec is left as
  written — and the gear-list spec's own new §11 is where all ten now live:
  `Stepper` shipped with **two** callers, not three, and — since its contract
  widened to accept `null` partway through this same slice — folding Add gear
  in is possible and deferred, not impossible; a concurrent
  `trip.entry_added` / `trip.entry_removed` writes **two** registers
  (`source`, `removed`), not one contested LWW field, so nothing races;
  `entriesOf` takes `(trip, state)`, not `(trip)` alone, and `entryKind` can
  read `undefined` for two reasons, not one; the builder's band, title and
  footer are right-pane at Split but a **full-width strip above the grid** at
  Desktop, for the back link and the title — never for sync, which the
  Desktop sidebar already states in words at every width; the picker's meta
  line carries the home path plus **at most one** suffix, not a fixed pair;
  closed ledger rows draw a **real** `N PIECES` fold, not a presumed one; the
  activation gate reads the **filtered** over-claim result, since the raw one
  can name an unrelated Trip; §7's technical-debt entry overstated what S7
  does to `AddGear` — the slice does not touch that file at all; and the
  picker's search field carries no `/` hint at either width, matching the
  keyboard surface §9 already rules unbuilt.
- **`useScreenHeader`'s reach is ten callers, both of S7's new ones
  width-guarded.** Before S7, `People` and `Devices` were the only two of
  eight routes whose own path redirects across a width boundary; S7's two new
  callers, `/trips/:id/add` and `/trips/:id/list`, make it four of ten, each
  redirecting the other way across Split — the picker collapses into the
  builder above it, the builder collapses into the trip screen below it.

### 12.14 Consequences of S8: per-person Pieces

Two op types, no endpoints, no migration, and — after a ruling removed the one
dimension the first draft had proposed — the slicing engine untouched. See its
[spec](specs/2026-08-31-per-person-pieces.md).

- **A Piece is derived, never enumerated, and carries two tombstone rules a
  future caller could easily get backwards.** `trip.entry_added` names no
  Pieces; a Piece exists because a Person is a Participant, minus whoever
  `trip.piece_removed` has tombstoned (`pieceInclusion` in
  `shared/src/selectors/piece.ts`), so a Participant added after the Entry
  gets a Piece with no backfill op, and one removed loses every Piece the same
  way. The first rule: **a tombstone outlives its Participant.** Removing
  Kim's Piece, then dropping Kim from the Trip, then re-adding her leaves her
  Piece tombstoned — `trip.piece_removed` and `trip.participant_removed`
  address different registers on different entity paths, and
  [sync §3.5](sync-protocol.md)'s "a tombstone never cascades" forbids the
  re-add from clearing it. The second: **a tombstone naming a non-Participant
  is inert, not an error.** It shows nowhere and needs no reducer gate —
  invariant 10 falls out of the derivation itself, the same shape invariant 6
  already took at `bringCountOf`, and for the same reason: gating in the
  reducer would make the fold order-dependent on which op arrived first.
- **Per-person claims read Pieces now, not Participants, so removing a Piece
  releases that Person's claim** at the granularity
  [domain §5.2](domain-model.md) states it in. `supplyAndClaimed` needed no
  change at all — it already compared People rather than counts, so narrowing
  the claimed set narrowed the conflict for free, which is the sign S7 put the
  rule in the right place the first time. An Entry with no included Pieces
  holds no claim and is skipped by `claimsByGear`, the same "a claim the
  reader cannot see is a claim they cannot settle" rule `entriesOf` already
  states.
- **Ruling H retired a ladder rung that had never been a decision, and the
  lesson outlasts this slice.** The first draft added a sixth `slice.ts`
  dimension, reading `Components §04`'s dashed `PIECES BY PERSON · S8` rung
  the way `TRIP · S7` had been read one slice earlier. The round overturned it:
  the rung contradicted the standing two-worlds rule — Pieces exist only in
  trip contexts, never on the Depot — and story 13's own criterion list had
  never named it. S8 therefore touches `slice.ts` not at all: no dimension
  row, no second memo, no chip, no picker. The generalisation for the next
  reader of that ladder: **a slice number on a board is a claim that has to
  survive the standing rules, not a licence that overrides them.**
- **Ruling B makes the cluster and `×N` one control; circles are never
  individual targets.** Every alternative the round considered failed on
  ground S7's own ruling O had already surveyed: 44px hit areas on 32px
  centres are ruling O's own counter-example — a tap meant for one Person
  lands on their neighbour — and clamping so targets cannot overlap caps them
  under the 44 floor anyway. So the cluster and the `×N` beside it open the
  Piece picker together, one accessible name carrying the whole fact (`Who
  brings one — Headlamp, 2 of 3 bring one`), and the standing clamped
  `::after` grows to the row's 48 once instead of once per circle.
- **Ruling E gives every cluster surface one overflow rule, retroactively.**
  Four painted slots; from five, three circles plus a `+N`; and — the part
  worth remembering — **dashed, excluded circles sort to the front**, so the
  one Person declining is never the one hidden behind the count. The rule
  reaches `TripCard`, the trip screen header and the builder header as well as
  the Piece cluster, none of which had ever handled a roster past three
  before this slice.

