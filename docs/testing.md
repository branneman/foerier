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

**Where one rule has two implementations, a test holds them against each
other.** The containment tree is the standing case: `tripContainment.ts`
restates `containment.ts`'s traversal, its sorted-id determinism and §3.6's
cycle break over a different pointer type, and the duplication is deliberate
(see [CLAUDE.md](../CLAUDE.md)). Each file's own suite pins the rule on its own
side, so a divergence is not undetectable — but neither file knows the other
exists, and the cycle-break half is the one that would be **silent**, showing
up only as two Devices drawing different trees.
`selectors/containmentParity.test.ts` is the one place that compares them: one
random functional graph, played into both worlds with the same ids in the same
order, both views asserted equal. It covers the stamp comparison and not the
`id` tiebreak beneath it, because equal stamps are unreachable from a real
replica — a limit the file states and demonstrates by mutation rather than
assumes.

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

**A slice that adds an op type adds it to the generator, not only to the
scenarios.** The scenarios pin edges a generator would reach only by luck; the
generator is what covers the pairs nobody thought to name, and an op type absent
from it has **no property coverage at all** no matter how many scenarios cite it.
S9a is the worked example: five hand-written scenarios landed with the ops, the
generator was left claiming *"all twenty-four op types this build folds"* while
the reducer folded thirty-one, and one op type — `trip.piece_moved` — had no
Tier 2 coverage of any kind until a whole-branch review caught it three tasks
later. Two habits follow. **Make the count executable rather than prose**, so a
stale claim fails instead of merely reading wrong. And **weigh the new branches**:
adding op types at the existing weight dilutes the contest the tier exists to
create — S9a's own entry-register contest fell from 22 runs in 200 to 5, under
this file's stated floor, until the trip weight was raised to compensate.

**Both of those are now assertions rather than habits**, and the second one
took a second pass to notice. `convergence.test.ts` reads `reduce.ts`'s own
dispatch table and fails if the generator does not reach every type in it; and
it re-derives the contest rate per level and fails under the 12-in-200 floor
this paragraph cites. The floor had been argued from measured figures
transcribed into three docstrings, one of which sent the reader to a counter
that did not exist — the same shape of claim as *"all twenty-four op types"*,
one level up, and equally invisible to every tier. **A tuning knob argued from
a number needs the number computed where it is argued.** Two of those
transcribed figures do not reproduce: at 200 runs the per-level counts swing
too wide to floor at all (the piece level measured 8 to 25 across seven seeds),
so the executable version samples 1000 and floors at the same 6%.

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
| 9 | `0f000009-…-000000000009` | `deviceLink.test.ts` — `person_recorded`, `device/claim` |
| 10 | `0f00000a-…-00000000000a` | `account.test.ts` — invites, devices, passkeys, `/auth/me` |
| 11 | `0f00000b-…-00000000000b` | `deviceLink.test.ts` — the mismatched-household Invite |
| 12 | `0f00000c-…-00000000000c` | `testReset.test.ts` — the disposable E2E household |
| 13 | `0f00000d-…-00000000000d` | `testReset.test.ts` — the household that must stay untouched |
| 14 | `0f00000e-…-00000000000e` | `logins.test.ts` — the Logins list and revoking a Login |
| 15 | `0f00000f-…-00000000000f` | `invites.test.ts` — in-app join Invites and purpose-scoped list/revoke |
| _(claim the next free slot when adding a server-integration class)_ | | |

Two rules the suite learned the hard way and that a new class must follow:

- **Scope every query to your own household.** `foerier_test` is persistent and
  shared, so an unscoped `select … from login` silently counts another class's
  rows and passes or fails for reasons that have nothing to do with the test.
- **Never clear a table you do not own.** `webauthn_challenge` belongs to no
  household — challenges exist before a Login does — so wiping it in `beforeEach`
  pulls the rug from under a ceremony running in another file.

**Tier 2s runs single-threaded, and the project config is what enforces it.**
`api/vitest.server.config.ts` sets `pool: 'forks'` with
`poolOptions.forks.singleFork`, so every invocation gets one worker and the
files run one after another. It is expressed there rather than as
`--no-file-parallelism` in the `test:server` script because `fileParallelism`
is a *root-level* Vitest option, silently ignored inside a project config and
therefore only ever supplied by that one script — while `npx vitest run
api/test/server/` is an entirely ordinary thing to type. Run in parallel, the
classes delete each other's rows mid-ceremony, and `migrations.test.ts`
— which proves `0003_op.down()` by actually dropping the `op` table before
re-creating it — makes a neighbour fail with `relation "op" does not exist`
on whichever test was in flight. `poolOptions` *is* honoured per project, so
the serialisation is now a property of the suite rather than of how it was
invoked.

## Tier 3 — Component tests

**Charter:** React components in isolation — every screen and every component
in `app/` and `ui/`, rendered in jsdom, primary interactions exercised.
Behaviour-focused (what the user sees and can do), not pixel/screenshot tests.

**Tooling:** Vitest + React Testing Library + `@testing-library/user-event`,
co-located `*.test.tsx`. Shared `ui/` components get their own component tests.

**How an `app/` suite is built — the conventions the code actually carries,
which this section once described as "a fake Zustand store seeded via
factories" and which are nothing of the kind:**

- **The store is real and the log is fake.** A suite builds
  `createDepotStore({ log: inMemoryOpLog(), engine: noopEngine, author })`
  and seeds it by **emitting real ops** through the same builders the screen
  uses, then `await drained()`. The reducer, the selectors and the store's
  queue are all live; only storage and transport are stubbed. Factories from
  `shared/testUtils/` seed exactly one suite, `screenBand.test.tsx`.
- **An op is asserted from the log, never from a spy.** A test that proves a
  tap authored an op reads `log.all()` (or the seeded log's `authored()`) and
  filters by `type`; a test that proves a tap authored **nothing** counts the
  same way. There is no `vi.mock` of a module anywhere in `app/` or `ui/`;
  `fetch` is injected and faked with a handler table.
- **The viewport is a `matchMedia` stub, and a test names every breakpoint
  the width crosses.** `app/src/testSetup.ts` installs it and exports
  `setViewport(...queries)`; `useMediaQuery` fails open to `false` without it,
  so an unset test is the phone layout.
- **`TZ=Europe/Amsterdam` is pinned in `app/vitest.config.ts`**, so a
  timestamp assertion means something — under UTC it would pass against the
  bug it exists to catch.
- **A per-screen suite renders without `AppShell`, and
  `screenBand.test.tsx` renders inside it.** An absence assertion in the first
  proves the screen withheld a line and nothing about whether the shell drew
  one, so the second counts one visible `SYNCED` at each width. That is a
  permanent property of the two suites ([frontend-design §3.3](frontend-design.md)).
- **CSS is read as text.** jsdom computes no layout and Vitest processes no
  CSS modules by default, so a rule about a stylesheet — a drawn size, a hit
  extension, the absence of a rule — is proved by parsing the `.module.css`
  file (`app/src/screens/drawnSizes.test.ts` is the canonical case). A class
  name assertion against the imported module object is tolerable; a regex on
  the generated class string is not, since it leans on Vitest's `stable`
  naming.
- **Queries are role-first**, then accessible name, then text; `data-testid`
  is a first-class hook on both sides for what has no role. `fireEvent`
  appears once, in `ui/`'s `Stepper` suite, with a written reason.
- **What jsdom cannot see is in `KEYBOARD-PASS.md`** at the repo root — seven
  manual checks (focus order, the optimistic-read timing of `IN LIST ✓`, the
  scroll lock) that no tier replaces. A change to an overlay or to focus
  handling reruns it.

The scaffolding above is hand-rolled per suite — `noopEngine` in thirty files,
`anAuthor()` in thirty-four, the store-and-seed block in thirty-two, the
router-and-provider wrapper in nineteen. Only the `matchMedia` stub was
centralised. It is recorded in [technical-debt.md](technical-debt.md); the
render helper it wants is the same shape `screenBand.test.tsx` already carries.

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
pushed commit, then runs the suite. The poll asks the **API** only, so the app
bundle Tier 5 loads may still be one Watchtower cycle behind the SHA the API
reports; nothing in Tier 4 depends on the bundle, and Tier 5 runs minutes later.

**Two files, two claims.** `deployment.test.ts` needs no Household and no
credentials — its charter is everything reachable unauthenticated, which is
what let it run from the first deploy. `household.test.ts` is the other half:
with a real Device token it pushes an op and pulls it back, proving the whole
`/sync` path through Caddy, the deployed process and the box's Postgres, which
no local tier can. It `describe.skipIf`s itself when the credential secrets are
absent, so a developer's laptop still runs the unauthenticated file.

**One disposable Household, wiped at the start of every run.** The suite does
not create a Household and cannot: `admin:bootstrap --disposable --name "E2E"`
mints it by hand, once, on the box. `POST /api/v1/test/reset`
(`api/src/test/`) is what empties it — it deletes the Household's ops, revokes
every Device but the caller's, and deletes its outstanding Invites and every
Passkey but the caller's. Reset is at the **start**, never a teardown, so a
cancelled or crashed run leaves a dirty Household and the next run's first act
fixes it. Three gates keep the route away from anything real: it is not mounted
unless the server was started with `E2E_HOUSEHOLD_ID`, the calling token's
Household must equal that value, and the Household row must carry
`disposable = true`.

**The token is minted inside the job that spends it.** Vitest's `globalSetup`
signs in over `POST /auth/login/verify` — in Node, with no browser, driving
Tier 2s's own `SoftwareAuthenticator` from an exported credential — masks the
token on the main process's stdout where `::add-mask::` is honoured, resets the
Household, and hands the token to tests through `provide`/`inject`. No test
performs the ceremony and no Device token crosses a job boundary. The config
sets `fileParallelism: false`: one Household, one writer.

**The reset is also a tripwire.** It returns counts of what it *did*, and the
harness asserts `revoked ≤ 1`, `passkeys = 0`, `invites = 0` immediately after
the first one. A compromised E2E Household looks healthy from the outside — it
syncs, it signs in, its tests pass — so this is the only thing that would ever
say otherwise: more than one revoked Device means someone else held a token, a
deleted Passkey means someone added a credential (CI's own is the one spared,
so a clean run deletes none), an Invite means someone minted a link. A
violation fails the run naming the rotation procedure.

## Tier 5 — E2E smoke tests

**Charter:** the real deployed site in a real browser, exercising exactly one core
journey. Deliberately small — edge cases belong in lower tiers.

**Golden path, eventually:** sign in → add gear → find it → build a trip → pack
an item → close the trip. **Today it stops at the third step** — sign in, record
gear with the network cut, find it, watch it sync. The journey grows a leg per
slice; the harness around it does not change.

**Three legs are owed and not written, which is a debt rather than a wait.**
*Build a trip* has been buildable since S6 and *pack an item* since S9a; only
*close the trip* still awaits S10. Each of those slices shipped without adding
its leg, and none recorded that it had not — so the path stalled at step three
while the app grew two steps past it. **A slice that builds a golden-path step
adds its leg in the same slice, or writes the debt down.** The gap is indexed in
[`technical-debt.md`](technical-debt.md); this sentence is what makes it
detectable, and it goes when the legs land.

Two PWA-specific twists this project must cover:

- **Passkeys via Playwright's virtual authenticator** (CDP `WebAuthn` domain) —
  register/login a credential without real biometrics.
- **An offline leg** — `context.setOffline(true)`, make edits, go back online, and
  assert the outbox flushes and state converges. Offline-first *is* the product,
  so the smoke test must prove it.

**Tooling:** Playwright, `test/e2e/`. Target via `PLAYWRIGHT_BASE_URL` (a local
production build served by `vite preview` by default; CI's post-deploy job
points it at `app.foerier.app`). **Trigger:** automatically after every deploy
to `main` — gated on the `E2E_ENABLED` repository variable, because unlike Tier
4 this tier cannot degrade without the credential: `globalSetup` throws on an
empty `E2E_*` rather than skipping, so the variable stays off until the
credential has been captured.

**Retargeting is one variable, and that variable switches four things on.**
Setting `PLAYWRIGHT_BASE_URL` drops the `webServer` block and, with it, adds a
`globalSetup` that signs in and resets; `grep: /@production/`; `workers: 1` —
one Household, one writer; and `trace: 'off'` with the `list` reporter, because
a trace records request headers and `Authorization: Bearer foe_…` would be
inside the zip. Off rather than merely not uploaded, so the guard does not
depend on nobody ever adding an `upload-artifact` step.

**Only tagged specs run against the box.** Three kinds of spec cannot: one that
mints an Invite by Maintainer script (it needs `DATABASE_URL`, which CI does not
have and must not), one that proves joining itself — joining consumes an Invite
from the one Household that is never re-created — and one that signs the run's
own Device out from under every later spec. So `auth.spec.ts`,
`deviceLink.spec.ts` and `invite.spec.ts` stay local-only; `depot.spec.ts` and
`shell.spec.ts` carry
`@production`. A local run is unchanged: the local project has no grep.

**A signed-in Quartermaster comes from a fixture**
(`test/e2e/quartermaster.ts`), and the fixture is two genuinely different acts
behind one name. Locally it is
what every spec did before it existed: mint an Invite with the real Maintainer
script, attach a virtual authenticator, join. Against production it resets the
Household and opens a context from `globalSetup`'s storage state — saved with
`indexedDB: true`, since that is where the Device token lives, into a gitignored
path no step uploads. The state is applied *in the fixture* rather than as a
project-wide `use.storageState` because `shell.spec.ts` runs against production
too and needs a **signed-out** visitor; signing that visitor in would quietly
empty out the tests. Those specs take no fixture and so do not reset — they
neither read the Household nor write to it.

`globalSetup` clears the client's synced IndexedDB stores before saving the
state, sparing only `auth`. The order is forced — the token exists only once the
browser has signed in, and by then the sync engine has already pulled whatever
the last run left — so without that step every spec would restore a snapshot
holding last run's gear, against a server the reset had already emptied.

## Test data strategy

Three contexts, three strategies — never shared across contexts.

- **Tiers 1–3:** hand-built factory functions with defaults + overrides, in
  `shared/testUtils/factories.ts` (e.g. `aGear({ kind: 'per-person' })`,
  `aTrip({ participants: [...] })`). Grows one function at a time — no speculative
  fixture library. Tests read as `aGear({ kind: 'counted' })`: exactly the field
  under test, nothing else.
- **A factory's specs reach a fold through `shared/testUtils/log.ts`, never a
  local stamper.** `stamp` gives each spec its **own**, increasing counter, and
  `depot`/`foldAt` fold the result through the real reducer, so a selector can
  never pass against a state the reducer could not produce. The counter is the
  whole point and the reason the helper is shared: a stamper that gave one HLC
  to a whole multi-op factory folded `aTrip({ phase: 'pack_out' })` to a
  **Draft**, because `trip.phase_moved` sharing `trip.created`'s exact stamp
  loses the tie on `writeRegister`'s `<= 0` rule rather than moving the
  register. S5 shipped that bug; six suites had each written the correct
  version and nothing pinned it until `log.test.ts`.
- **Tier 2s:** each class seeds its own rows under its registered `household_id`
  and cleans mutable rows in setup; delete-by-both-UUID-and-natural-key to survive
  a persistent `foerier_test` DB (the `health` `init`-block pattern).
- **Tier 4's `deployment.test.ts`** needs no household and no credentials at all
  (`test/contract/deployment.test.ts:12-15`): its charter is everything
  reachable unauthenticated, which is what lets it run from the first deploy
  rather than from the first feature that needs a Household.
- **Tier 5 locally** mints a fresh Household per test by invoking the real
  Maintainer bootstrap script (`test/e2e/mintInvite.ts:11-46`), deliberately
  rather than seeding rows directly — `auth-design.md` §3.4 makes that script
  the only way a Household's first Login is ever arranged, so a test that
  bypassed it would not notice the front door breaking.
- **Tier 4's household suite and Tier 5 against production share one Household
  and one credential**, and neither creates either. The Household is
  bootstrapped by hand with `--disposable`; the Passkey is captured **once, by
  hand**, against the deployed app (`test/e2e/captureCredential.ts`) and stored
  as two GitHub secrets — a base64url credential id and a base64 PKCS#8 private
  key — plus the user handle Chrome's virtual authenticator wants. Each job
  replays that credential and mints a Device token of its own: a token is never
  handed forward as a job output or an artifact, both of which are readable from
  the run page of a public repository. The seeded sign count is **monotonic**,
  never the exported one — the server requires `received > stored` and that
  check is deliberately not relaxed: an exported key replayed from elsewhere is
  exactly the cloned-authenticator case the counter exists to catch
  (`api/test/server/auth.test.ts` pins the rejection). Both jobs pin every
  third-party action by SHA, declare `permissions: {}`, and upload nothing.
  Setup beyond the reset is **client-side**, pushed through the real
  `/sync/push`: the server grows no fixture generator, and for Tier 5 the golden
  path records its own gear through the UI anyway.

## Backward-compatibility testing

Because installed PWAs run older app versions with **offline-queued ops** (see the
[architecture spec](architecture-design.md) §7), the
op-format must stay tolerant. A dedicated Tier 2 group replays **op fixtures**
through the current reducer and asserts they still fold correctly — the guard
that keeps expand-contract honest as vertical slices ship. There is one fixture
per slice that introduced op types, and a slice **adds** one rather than editing
a captured one:

| Fixture | Op types it pins | Captured |
| --- | --- | --- |
| `shared/fixtures/s2-depot.ops.json` | the eleven Place · Person · Gear ops, plus an unknown-type probe | S2a |
| `shared/fixtures/s3-tags.ops.json` | `gear.tag_applied`, `gear.tag_removed` | S3 |
| `shared/fixtures/s4-ownership.ops.json` | `person.renamed`, `gear.ownership_set` | **S6 — one slice late** |
| `shared/fixtures/s6-trips.ops.json` | the six Trip root ops | S6 |
| `shared/fixtures/s7-entries.ops.json` | `trip.entry_added`, `trip.entry_removed`, `trip.entry_bring_count_set` | S7 |
| `shared/fixtures/s8-pieces.ops.json` | `trip.piece_removed`, `trip.piece_restored` | S8 |
| `shared/fixtures/s9a-packing.ops.json` | the five packing ops — `trip.entry_status_set`, `trip.piece_status_set`, `trip.entry_moved`, `trip.piece_moved`, `trip.container_stage_set` | S9a |

Most of what each carries is genuinely captured from the app that introduced
the ops. A handful are **forward-compatibility probes** instead, standing in for
a foreign or future client and documented as such in each test file's
header — two `{name: null}` ops in the S2 fixture (named in
`fixtures.test.ts`'s own header, and carried on builders whose `name` parameter
is `string` and always has been), foreign tags in the S3 one, and four in the S6
one: a `from_trip_id` no builder yet accepts, a sixth phase, a date in no
recognised format, and a `null` name placed on `trip.created` precisely because
that builder — unlike `trip.renamed`, which S6 settled as nullable — cannot
author one. The S7 fixture carries three of its own, two of them un-authorable
by any builder: a malformed `source` (`from: "elsewhere"`), folding to a
sourceless Entry that is retained and undrawn; and a `trip.entry_bring_count_set`
on a per-person Entry, which invariant 6 says should not exist and which the
reader folds anyway ([sync-protocol.md §4.4](sync-protocol.md)). The third pins
an ordering no builder call sequence can force either: `trip.entry_removed`
carrying a lower `seq` than the `trip.entry_added` that creates the Entry.
**Do not read a probe as evidence some old build emitted it**; that is the one
misreading a fixture invites, and it would give exactly the wrong account of
what the builders permit.

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

**`s4-ownership.ops.json` is what the rule looks like when it is missed.** S4's
spec said the fixture rule "applies unchanged" and no file landed, so two op
types whose wire format §5.4 had already frozen were pinned by nothing until S6
captured them. The capture is folded by the **S6** reducer, which means a drift
between the two slices is baked into the snapshot as though it had always been
the format, and nothing in the repo could now tell — the exact weakness the rule
exists to prevent, in miniature. It is still strictly better than the same gap
found three slices later. The lesson generalises past fixtures: a spec sentence
saying a standing rule applies produces no artefact, and no tier notices its
absence.

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
| 5 (E2E smoke) | After every deploy to `main` — the `@production` subset only |

## Running everything locally

```
npm run typecheck && npm run lint && npm run format:check   # Tier 0
npm test              # Tiers 1–3 + convergence
npm run test:server   # Tier 2s (needs a local foerier_test Postgres)
npm run test:contract # Tier 4 (needs the deployed server; E2E_CREDENTIAL_ID +
                      #         E2E_PRIVATE_KEY for the household suite)
npm run test:e2e      # Tier 5 (Playwright; virtual authenticator)
```

`npm test` is the invocation that matters: a bare `npx vitest run` misses the
`api` project's environment and reports failures that are an artefact of how it
was started rather than of the code.

### The intermittent, and how it was caught

**`npm test` reported a single failure three times across S9a. The third
sighting was captured, and it was `Account.test.tsx`** — a test that awaited one
async source and then asserted on another:

```ts
expect(await screen.findByText('Mark')).toBeInTheDocument()      // folded state
expect(screen.getByText('VELDKAMP HOUSEHOLD')).toBeInTheDocument() // GET /auth/me
```

The person's name is folded state, on screen at first render, so `findByText`
resolves on its first check and waits for nothing else. The household name is a
`fetch`, a `res.json()` stream read and a `setState` further out, asserted
synchronously. Nothing sequenced the two. It won roughly twenty-nine runs in
thirty because the poll that finds the first name usually leaves the response
enough room, and lost under the load of the other 105 files — which is why the
file passed twelve times out of twelve when run alone, and why the fix was
verified by **delaying only `/auth/me`**, where it fails deterministically
before and passes after.

Whether the two earlier sightings were this same test is unknowable: both were
lost to an immediate re-run, which is the whole reason the rule below exists.
Twenty consecutive clean full runs sit against the fix.

Three habits are worth keeping out of it, in the order they mattered:

- **Save the output before re-running.** Two of three sightings were destroyed
  by the reflex to re-run, and a captured failure took about ten minutes to
  diagnose from the assertion alone.
- **A hunt is only as good as its detector.** The first attempt grepped for the
  word `failed` and matched a **test name** (`lets sign-out be retried after it
  failed`), reporting a catch on a clean run — read the `Tests` summary line
  instead.
- **Awaiting one source proves nothing about another.** The bug shape is a
  `findBy` on whichever thing renders first, followed by a `getBy` on something
  that arrives on its own schedule. It reads as sequenced and is not. The
  earlier `Date.now()`/`TZ` hypothesis recorded here was wrong, and cost the
  first hunt its direction — a plausible mechanism is not evidence.
