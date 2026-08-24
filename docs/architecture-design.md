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
inventory, before Trips exist).

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

## 8. Hosting & deployment

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

## 9. Testing

The full strategy — the adapted seven-tier pyramid, its charters, and the
test-data approach — is a permanent reference in
[`docs/testing.md`](testing.md), following the lineage of the sibling
`health` manifesto and `bloomwatch` browser adaptation. The signature tier is
**convergence/merge**: divergent op-logs exchanged between simulated clients must
fold to identical state regardless of order (property-based). The domain
invariants and LWW/HLC resolution are pure `shared/` logic and carry the bulk of
the unit tests.

## 10. Deferred / open

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
