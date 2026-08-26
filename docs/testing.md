# foerier — Testing

How this project is tested. Adapted from
[branneman/health's testing manifesto](https://github.com/branneman/health/blob/main/docs/testing-manifesto.md)
and its browser-only descendant in `bloomwatch`, for an **offline-first React PWA
with an operation-log sync engine** talking to a thin **Hono + Postgres** server.

This is the permanent reference — unlike a per-story design spec, which is
retired once implemented, this file stays up to date as the testing approach
evolves.

## Philosophy

Testing is about confidence, not coverage numbers. Catch regressions as cheaply
as possible — push risk mitigation as low in the pyramid as possible. A test
belongs at the lowest tier whose tools can catch the failure; don't reach for a
higher tier just because it's easier to write.

**Tests must test real behaviour.** A test that can't be wrong — asserting a
function exists, exercising a stub that always returns the expected value —
provides no confidence and is noise. Dependencies that cross a boundary (the
clock, `crypto`, storage, `fetch`) are replaced with **real, minimal fake
implementations of the interface — not mocking-framework mocks**.

**Each tier has a charter.** A test belongs at the lowest tier whose tools can
catch its failure. The **bold** tiers below are where *foerier's* real risk lives:
the purity of the merge logic and the convergence of divergent replicas.

## The pyramid

```
[T5] E2E smoke          ← Playwright, real app.foerier.app, one golden path (+ an offline leg)
[T4] Contract / API     ← real deployed server, verifies the box (migrations, Caddy, WebAuthn origin)
[T2s] Server integration ← real Hono + local Postgres (foerier_test), endpoints + household isolation
[T3] Component          ← React Testing Library, core-flow screens (F1–F5)
[T2] CONVERGENCE / MERGE ← ≥2 divergent op-logs → exchange → identical state (property-based)
[T1] UNIT               ← op-log fold, LWW + tombstones, HLC, selectors, domain invariants
[T0] Static analysis    ← tsc, ESLint(+react-hooks), Prettier, Husky full-project pre-commit
```

---

## Tier 0 — Static analysis

**Charter:** catch syntax, type, and style errors before any behavioural test —
the cheapest tier, and a different class of issue than behaviour covers.

- **`npm run check:workspaces` — first, and cheapest of all.** It asserts every
  `@foerier/*` package is linked inside *this* working tree. A git worktree
  with no install of its own resolves them up into the main checkout instead,
  and then every tier below this one passes judgement on the wrong source
  tree without erroring. Detection, not prevention: npm workspaces cannot link
  into a worktree without an install there.
- `tsc --noEmit` across every workspace (`app` · `api` · `shared` · `ui`).
  `landing` is not scaffolded yet (architecture §12.1) and carries no
  workspace to check.
- ESLint (`typescript-eslint` + `eslint-plugin-react-hooks`) — correctness rules
  (unused vars, hook-dependency bugs, unreachable code).
- Prettier for formatting only; `eslint-config-prettier` keeps the two from
  fighting.

**Runs on the whole monorepo, not just changed files** — in the pre-commit hook
and in CI. Deliberate: LLM-authored changes tend to leave unrelated files
unformatted or untouched, and a staged-files-only check would miss that.

**Pre-commit hook (Husky)** runs `typecheck`, `lint`, and `format:check`
full-repo before a commit is allowed — the same commands as CI, no separate fast
path. Installed automatically via `package.json`'s `"prepare": "husky"`.

## Tier 1 — Unit tests

**Charter:** pure logic, no I/O, no DOM. The majority of tests, and the first
thing written for any new logic. Nearly all of it lives in `shared/`.

Covers the crown jewels:

- **the op-log fold** — applying an op to state, snapshotting, tail-replay;
- **conflict resolution** — per-field last-writer-wins by `(hlc, device_id)`,
  tombstone semantics (a removal survives a later edit; only an explicit restore
  clears one), and per-element registers for tags and participants
  ([`sync-protocol.md` §3](sync-protocol.md));
- **Hybrid Logical Clock** — monotonicity, merge on receive, tiebreak ordering,
  behaviour under skewed device clocks;
- **selectors** — Whereabouts (home vs. trip residence), the emergent containment
  tree, filtered/grouped/sorted slices (story 13);
- **domain invariants** — acyclic containment, single-residence, Kind exclusivity
  (never Counted *and* Per-person), at-most-one Piece per Participant, soft-delete
  preserving history.

**Tooling:** Vitest, co-located as `*.test.ts` next to the unit under test.
Boundaries (clock, `crypto.randomUUID`/UUIDv7, storage) are injected as real
in-memory fakes — the `health` `RateLimiterTest` gold standard (injected
`Clock.fixed()`, a real fake store), applied here to a fake clock and a fake
op-store.

## Tier 2 — Convergence / merge tests

**Charter — foerier's signature tier, and the one unique to offline-first.** The
analog of "server integration", except the integration that matters is
**client ↔ client convergence**, not client ↔ server.

Spin up ≥2 in-memory replicas sharing the real `shared/` reducer. Let them
diverge offline, exchange ops through a **fake transport**, and assert they
**converge to byte-identical state regardless of op arrival order** — expressed
**property-based** (generate random interleavings of a random op set; the
invariant is order-independent convergence — the direct consequence of `apply`
being commutative, associative, and idempotent). Specific scenarios pin the
edges: a delete racing an edit resolves to deleted; two `bring-count` edits
resolve by plain LWW on `(hlc, device_id)`; concurrent tagging **unions** rather
than clobbering; and the two conditions a merge must *not* resolve — an
over-claim, and a containment cycle from two concurrent moves — are surfaced and
broken identically on every replica
([`sync-protocol.md` §3.6](sync-protocol.md)). Also covers the outbox:
retry/backoff, idempotent re-send of the same UUIDv7 op, per-op push outcomes and
the dead-letter path, and pull-cursor advancement.

**Tooling:** Vitest in Node, real reducer + fake transport + fake clock/store. No
real network, no real DB — this tier proves the *algebra*, not the wiring.

## Tier 2s — Server integration tests

**Charter:** the real Hono application wired to a real local Postgres, exercised
over HTTP. Proves routing, auth middleware, SQL, and tenant scoping are correct.

The app runs against a local `foerier_test` database; Kysely migrations bring it
up. Tests seed their own data and assert on real HTTP responses. Coverage:

- **invite issuance** and single-use/expiry enforcement;
- **WebAuthn register/login** against a test authenticator;
- **`sync/push`** — sequence assignment, idempotent re-push, ordering;
- **`sync/pull`** — cursor correctness, since-semantics;
- **multi-household isolation** — the `health` `MultiUserIsolationTest` analog and
  *the* test that protects the sell-later tenancy: household A can never read or
  write household B's ops.

**Isolation model (from `health`):** each test class owns a fixed
`household_id`/user UUID no other class uses; mutable rows are deleted in setup;
no transaction rollback — tests delete their own rows. Maintain a **UUID
registry** below so a persistent `foerier_test` DB never collides across classes.

| # | household UUID suffix | Test class |
| --- | --- | --- |
| 1 | `0f000001-…-000000000001` | `auth.test.ts` — the join and sign-in ceremonies |
| 2 | `0f000002-…-000000000002` | `householdIsolation.test.ts` — household A |
| 3 | `0f000003-…-000000000003` | `householdIsolation.test.ts` — household B |
| 4 | `0f000004-…-000000000004` | `migrations.test.ts` — the op table, household A |
| 5 | `0f000005-…-000000000005` | `migrations.test.ts` — the op table, household B |
| 6 | `0f000006-…-000000000006` | `sync.test.ts` — push, pull, sequence assignment |
| 7 | `0f000007-…-000000000007` | `sync.test.ts` — the other household |
| 8 | none | `rateLimit.test.ts` — claims no household UUID, so nothing can collide |
| _(claim the next free slot when adding a server-integration class)_ | | |

Two rules the suite learned the hard way and that a new class must follow:

- **Scope every query to your own household.** `foerier_test` is persistent and
  shared, so an unscoped `select … from login` silently counts another class's
  rows and passes or fails for reasons that have nothing to do with the test.
- **Never clear a table you do not own.** `webauthn_challenge` belongs to no
  household — challenges exist before a Login does — so wiping it in `beforeEach`
  pulls the rug from under a ceremony running in another file. Tier 2s runs
  single-threaded (`--no-file-parallelism`) for the same reason; note that
  `fileParallelism` is a *root-level* Vitest option and is silently ignored
  inside a project config.

## Tier 3 — Component tests

**Charter:** React components in isolation — the core-flow screens (F1 Add Gear,
F2 Find, F3 New Trip, F4 Pack-out, F5 Unpack & Close) rendered in jsdom, primary
interactions exercised with a fake store injected as the source. Behaviour-focused
(what the user sees and can do), not pixel/screenshot tests.

**Tooling:** Vitest + React Testing Library, co-located `*.test.tsx`. Shared `ui/`
components get their own component tests; `app/` screens are tested with a fake
Zustand store seeded via factories.

## Tier 4 — Contract / API tests

**Charter:** the real deployed server on the CX33, called over HTTP with a
dedicated test household. Where Tier 2s proves the code is correct in isolation,
this proves the **deployment** is correct — problems a local DB cannot surface:

- a Kysely migration that ran locally but failed on the box;
- Caddy dropping or rewriting the `Authorization` header;
- the **WebAuthn RP origin/config wrong in production** (only the real
  `app.foerier.app`/`api.foerier.app` origins surface this);
- CORS misconfigured for the `app.` → `api.` cross-origin.

**Trigger:** on every push to `main`, after the image builds and Watchtower
deploys — the CI job polls `GET /version` until the deployed SHA matches the
pushed commit, then runs the suite. Dedicated test household; each writing test
cleans up in teardown.

## Tier 5 — E2E smoke tests

**Charter:** the real deployed site in a real browser, exercising exactly one core
journey. Deliberately small — edge cases belong in lower tiers.

**Golden path:** login → add gear → find it → build a trip → pack an item → close
the trip.

Two PWA-specific twists this project must cover:

- **Passkeys via Playwright's virtual authenticator** (CDP `WebAuthn` domain) —
  register/login a credential without real biometrics.
- **An offline leg** — `context.setOffline(true)`, make edits, go back online, and
  assert the outbox flushes and state converges. Offline-first *is* the product,
  so the smoke test must prove it.

**Tooling:** Playwright, `test/e2e/`. Target via `PLAYWRIGHT_BASE_URL` (local dev
server by default; CI's post-deploy job points it at `app.foerier.app`).
**Trigger:** automatically after every deploy to `main`.

## Test data strategy

Three contexts, three strategies — never shared across contexts.

- **Tiers 1–3:** hand-built factory functions with defaults + overrides, in
  `shared/testUtils/factories.ts` (e.g. `aGear({ kind: 'per-person' })`,
  `aTrip({ participants: [...] })`). Grows one function at a time — no speculative
  fixture library. Tests read as `aGear({ kind: 'counted' })`: exactly the field
  under test, nothing else.
- **Tier 2s:** each class seeds its own rows under its registered `household_id`
  and cleans mutable rows in setup; delete-by-both-UUID-and-natural-key to survive
  a persistent `foerier_test` DB (the `health` `init`-block pattern).
- **Tier 4** needs no household and no credentials at all
  (`test/contract/deployment.test.ts:12-15`): its charter is everything
  reachable unauthenticated, which is what lets it run from the first deploy
  rather than from the first feature that needs a Household.
- **Tier 5** mints a fresh Household per test by invoking the real Maintainer
  bootstrap script (`test/e2e/mintInvite.ts:11-46`), deliberately rather than
  seeding rows directly — `auth-design.md` §3.4 makes that script the only way
  a Household's first Login is ever arranged, so a test that bypassed it would
  not notice the front door breaking.

## Backward-compatibility testing

Because installed PWAs run older app versions with **offline-queued ops** (see the
[architecture spec](architecture-design.md) §7), the
op-format must stay tolerant. A dedicated Tier 2 group replays **op fixtures**
through the current reducer and asserts they still fold correctly — the guard
that keeps expand-contract honest as vertical slices ship. Most of the
fixture is genuinely captured from a previous app version; two ops
(`shared/src/fixtures.test.ts:9-17`) are **forward-compatibility probes**
instead, standing in for a foreign or future client — `authoring.ts` types
every builder's `name` as `string`, so no foerier client, past or present,
can author the `{name: null}` those two ops carry.

The obligations under test are enumerated in
[`sync-protocol.md` §5.3](sync-protocol.md): an unknown op type is retained
rather than discarded, unknown fields and enum values are ignored without
crashing or coercing, absent is never treated as null, and a stored op is never
mutated. §5.4's frozen list is the other half — a test that an existing op type's
effect on folded state has not drifted.

**Capture a fixture in the same slice that introduces an op type.** A fixture
written later is captured from a format that has already drifted, and proves
nothing.

*Same slice, not same commit.* The rule protects against **drift**, not against
commit boundaries: what matters is that no format change happened between the op
type landing and the fixture being taken. A large slice that keeps its history
rather than squashing (see [CLAUDE.md](../CLAUDE.md)'s merge convention) will
have the fixture a few commits after the reducer, and that is fine — the format
did not move in between. A fixture taken a *slice* later is not fine, because by
then it can have.

S2a is the evidence the rule earns its keep: the fixture caught a live
obligation-5 violation on its first run — `gear.renamed{name: null}` was being
silently collapsed into "absent" — that fifteen named reducer tests and a
passing review had all missed, because no op in that slice was nullable and
nothing else reached the path.

## CI triggers summary

| Tier | When it runs |
| --- | --- |
| 0 (static analysis) | Every commit (pre-commit hook) and every push (CI) |
| 1–3 (unit / convergence / component) | Every push to `main` |
| 2s (server integration) | Every push to `main` (local `foerier_test` in CI) |
| 4 (contract / API) | After every deploy to `main` (polls `/version` for the SHA) |
| 5 (E2E smoke) | After every deploy to `main` |

## Running everything locally

```
npm run typecheck && npm run lint && npm run format:check   # Tier 0
npm test              # Tiers 1–3 + convergence
npm run test:server   # Tier 2s (needs a local foerier_test Postgres)
npm run test:contract # Tier 4 (needs the deployed server + test-household creds)
npm run test:e2e      # Tier 5 (Playwright; virtual authenticator)
```
