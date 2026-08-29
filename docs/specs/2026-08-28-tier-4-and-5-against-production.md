# Tier 4 and Tier 5 against production

The design for running the **household-scoped contract suite** and the **Tier 5
golden path** against the deployed box on every push to `main`, after
Watchtower has confirmed the SHA.

Both have been blocked since S2 by the same thing, and it is not the thing it
looks like: not the golden path being incomplete, but **the absence of any way
for CI to obtain a Household it is allowed to destroy**.

This is a **feature spec**: it is retired once the work has shipped. It settles
one new HTTP route on the surface [`auth-design.md`](../auth-design.md) §3.4
deliberately keeps closed, so it argues that case in full rather than assuming
it.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| New surface | **One route**: `POST /api/v1/test/reset`. Nothing else |
| What it does | Deletes every `op` row for the caller's Household, **revokes every other Device** of it, deletes its outstanding Invites, and deletes every Passkey but the one the caller signed in with. That is all |
| What it cannot do | **Create** a Household, a Login, or an Invite. §3.4 stays exactly true |
| Auth | `requireAuth` — an ordinary Device token. **No new auth path, no new secret class** |
| Second gate | The token's Household must equal `E2E_HOUSEHOLD_ID`, an env var set on the box. Unset ⇒ the route is **not mounted** |
| Third gate | The Household row carries `disposable = true`, set only by `admin:bootstrap --disposable`. Env alone is not enough |
| Seeding | **Client-side**, through the real `/sync/push`. The server grows no fixture generator |
| Bootstrap | **By hand, once**, with the existing `admin:bootstrap` script plus a `--disposable` flag. Never automated |
| Migration | **`0005_disposable_household`** — S3.5's `0004` landed without the two columns, so this spec ships its own (§12) |
| Tier 5 subset | Only specs tagged **`@production`** run against the box — the golden path and the shell. Everything that mints an Invite by script, or signs out the run's own Device, stays local-only (§6.2) |
| CI credential | One exported WebAuthn credential, replayed into Chrome's virtual authenticator each run — seeded with a **monotonic `signCount`** (§5.2), never with the exported one |
| Tier 4's token | Minted **inside the job that uses it**, by signing the assertion in Node from the same exported key (§6.4). **A Device token never crosses a job boundary** |
| The Device token | Masked the moment it exists, from `globalSetup` where the mask is known to fire; never in an assertion body; **no traces, HTML reports or artifacts uploaded** from the production project |
| Tripwire | Reset returns counts; the harness asserts `revoked ≤ 1`, `passkeys = 0`, `invites = 0`, so a foreign token or credential turns a silent compromise into a red build (§3.5) |
| Recovery | `DELETE FROM household WHERE id = $old` — cascades to everything. **Rehearsed once before this lands** |
| Isolation | Reset **at start**, never teardown — robust to a killed run |
| Parallelism | `workers: 1` against production. Multiple Households is a later optimisation |
| `household.op_seq` | **Not reset.** Rows are deleted; the counter stays monotonic |

---

## 1. Why now, and not at S10

`ci.yml` currently defers this:

> Tier 5 against the deployed site is still absent — the golden path needs
> domain behaviour (trips, pack, close) that awaits S6-S10.

That reasoning does not survive examination. **Every blocker is timeless.**
Seeding, write-pollution, credentials and rate limits all need solving whether
the journey is three steps or nine; S10 adds path to run, not answers. Waiting
only defers the decision while accumulating slices whose production behaviour
nobody has exercised.

Two things push the other way, and they are the actual argument:

- **A tier has been waiting since S2.** `test/contract/deployment.test.ts` says
  so itself: *"No household, no credentials. The charter's household-scoped
  suite waits for domain behaviour to exist (S2)."* That domain behaviour has
  existed since S2b. The suite is not waiting on the product any more; it is
  waiting on a Household.
- **One mechanism unblocks both tiers.** The same Device token that lets Tier 5
  sign in lets Tier 4 push and pull against the real box. Building it once pays
  twice.

## 2. The chicken-and-egg, stated exactly

`mintInvite()` (`test/e2e/mintInvite.ts`) shells out to the real
`admin:bootstrap` script with a `DATABASE_URL`. That is deliberate and good —
§3.4 makes the script the only way a Household's first Login is arranged, so a
test that seeded rows directly would not notice the front door breaking. But it
means **CI needs Postgres**, and a GitHub runner has no route to the box's
database.

There is no HTTP alternative, and that is by design. The whole authenticated
surface is:

```
POST /auth/join/preview      redeem-side only; creates nothing
POST /auth/register/options  needs an invite that already exists
POST /auth/register/verify   "
POST /auth/login/options     needs a Login that already exists
POST /auth/login/verify      "
GET  /auth/me                needs a token
POST /auth/signout           "
POST /auth/device/claim      redeem-side only; needs an Invite that already exists
POST /auth/invites           needs a token; device Invites only until S5
GET  /auth/invites           "
DELETE /auth/invites/:id     "
GET  /auth/devices           "
DELETE /auth/devices/:id     "
POST /auth/passkeys/options  "
POST /auth/passkeys/verify   "
GET  /auth/passkeys          "
DELETE /auth/passkeys/:id    "
POST /sync/push              needs a token
GET  /sync/pull              "
```

**Nothing mints a Household, and nothing mints an Invite without a token.**
S3.5's `POST /auth/invites` mints device links, and story 28 (invite another
Person) will mint join Invites at S5 — but both require an already-signed-in
Quartermaster, so neither can bootstrap the first one. `admin:invite` can,
and like `admin:bootstrap` it needs the box's Postgres.

So the question is not "how do we avoid a new route". It is **"what is the
smallest, most tightly gated capability that closes this, and can it avoid
touching §3.4 at all?"**

## 3. The route

```
POST /api/v1/test/reset
Authorization: Bearer <device token>

404  the route is not mounted unless the server was started with E2E_HOUSEHOLD_ID set
401  unless the token resolves (existing requireAuth)
403  unless auth.householdId === E2E_HOUSEHOLD_ID
403  unless that household row has disposable = true
200  { deleted: <n>, revoked: <m>, passkeys: <p>, invites: <q> }
```

Its entire body is one transaction, every statement scoped to `$1`, which
comes from the token and never from a body:

```sql
SELECT op_seq, disposable FROM household WHERE id = $1 FOR UPDATE;  -- the same lock push takes
-- 403 here, inside the transaction, if disposable is false
DELETE FROM op WHERE household_id = $1;
UPDATE device SET revoked_at = now()
  WHERE household_id = $1 AND id <> $caller_device AND revoked_at IS NULL;
DELETE FROM invite WHERE household_id = $1 AND used_at IS NULL;
DELETE FROM passkey
  WHERE login_id IN (SELECT id FROM login WHERE household_id = $1)
    AND id <> $caller_passkey;
```

`$caller_passkey` is the Passkey that verified the calling Device's sign-in.
`login/verify` already knows it (`row.passkey_id`, `api/src/auth/service.ts`)
and today throws it away; it is recorded on the Device row as
`device.passkey_id` (nullable FK, **`on delete set null`** — a device-link
Device has none, and S3.5's `removePasskey` deletes Passkey rows, which must
not fail on a Device that once signed in with one) in the same migration that
carries `disposable` (§12). `register/verify` records it too, by an `update`
after the Passkey row exists: S3.5 inserts the Device *before* the Passkey so
that `passkey.created_on_device` can point at it, which makes the two FKs
point at each other — legal because both ends are nullable. The two columns
are different facts and neither replaces the other: `created_on_device` is
*which Device enrolled this Passkey*; `passkey_id` is *which Passkey signed
this Device in*. The `disposable` gate is read
**under the lock**, in the same `SELECT` the wipe is scoped by, so the gate and
the wipe see the same row rather than a row that a concurrent statement could
change between them.

The lock is the one `/sync/push` serialises on
(`api/src/sync/service.ts`, step 1). Without it a push racing a reset could
commit rows that survive the wipe — harmless at `workers: 1`, and one line to
close now rather than rediscover when §6.3's later optimisation arrives.

The `UPDATE` is credential hygiene, and it is what keeps this a
*destroy-one* rather than a *destroy-one-and-leak-many*: every run signs in
and so mints a new Device row with a one-year sliding expiry
(`auth-design.md` §6.2), and nothing signs it out — a cancelled run cannot.
Revoking every Device but the caller's on each reset bounds the number of
live tokens for this Household to **exactly one**, always. It also revokes
the maintainer's own laptop session from the one-time capture in §5, which
is the right outcome.

The two `DELETE`s are the same hygiene applied to what a token can *make*.
Revoking Devices bounds tokens; it does nothing about persistence. After S3.5
a holder of one leaked token can add a Passkey or mint a device link, and a
reset that only revokes Devices would let that survive every run
indefinitely. Deleting outstanding Invites and every Passkey but the caller's
closes that: the only credential that lives past a reset is the one CI holds.

**Mount conditionally; do not guard a handler.** `buildApp` already takes its
knobs as injected deps; it gains `e2eHouseholdId?: string` and calls
`v1.route('/test', …)` only when it is defined. "Unset ⇒ 404" is then true by
construction — there is no early return to lose in a refactor — and the Tier
2s test for it tests *absence*, not a branch. `loadConfig` parses the value
as a UUID, lowercases it (Postgres returns `uuid` lowercase; a compose file
with capitals would 403 forever and read as a wrong token), and refuses to
boot on garbage, exactly as it treats `DATABASE_URL` in production.

### 3.1 What it deliberately cannot do

- **It cannot create anything.** Not a Household, not a Login, not an Invite,
  not a Person. `admin:bootstrap` remains the only front door, run by hand, on
  the box. **[`auth-design.md`](../auth-design.md) §3.4 is not amended.**
- **It cannot name its target.** The Household comes from the token via
  `requireAuth`, never from a body, query string or header — architecture
  [§8.7](../architecture-design.md)'s tenancy rule, unchanged and unrelaxed.
- **It cannot touch another Household.** Even a stolen e2e Device token resets
  only the Household that token belongs to, and only if that Household is the
  one the box was configured with.
- **It cannot be pointed at a real Household by a typo.** `household.disposable`
  (`boolean not null default false`, in this spec's own `0005` migration,
  §12) is set only by `admin:bootstrap --disposable`. The
  route requires both the env var *and* the flag, so the operator writing the
  compose file and the person minting the Household both had to say so. Env
  alone pointed at a real Household would otherwise hand its members a
  self-service wipe with no confirmation.

### 3.2 Why a destroy-one is safer than a create-many

The obvious alternative — a Maintainer-guarded endpoint that mints a fresh
Household per run — is **strictly more dangerous**, and it is worth naming why,
because it is the one most people reach for first:

| | Mint endpoint | This route |
| --- | --- | --- |
| Blast radius | unbounded: arbitrary new Households, forever | one named, disposable Household |
| New auth path | yes — a Maintainer bearer secret | no — an ordinary Device token |
| Touches §3.4 | yes, directly | no |
| Failure mode of a bug | tenant sprawl in production | the e2e Household is wiped twice |

A capability that can only ever destroy one thing you already agreed to destroy
is a much smaller thing to reason about than one that can create.

### 3.3 Two gates, and one of them is not ours

- `E2E_HOUSEHOLD_ID` is set on the box, by the infrastructure repository. If it
  is ever unset, the route disappears — **the kill switch lives outside this
  repo**, with whoever runs the server. Precisely: it is a switch this repo
  cannot defeat *by configuration*. It is not a trust boundary against this
  repo's *code* — a commit to `main` ships whatever image it likes, and a
  malicious commit to `main` is game over with or without this route. The
  env var guards against drift, not against the repo.
- The token's Household must match it. This is the line that must never
  regress, so it gets Tier 2s tests in the shape of the existing
  `householdIsolation.test.ts`, and there are three edges, not one:
  1. a valid token for a Household ≠ `E2E_HOUSEHOLD_ID` → 403, **and** the
     `op` row count of *both* Households is unchanged;
  2. the valid E2E token with the env var unset → 404, because the route is
     not mounted;
  3. the valid E2E token with the env var set → 200; only that Household's
     rows are gone; `household.op_seq` is unchanged; the other Household's
     rows are untouched; every other Device of the Household is revoked and
     the caller's is not.
- The route sits behind the **per-Device `/sync` bucket**, not `/auth`'s
  per-IP one and not outside both: it is an authenticated write like push.
  That needs wiring, not just saying: `buildApp` creates a separate
  `RateLimiter` **per `v1.route(...)` mount** (`api/src/app.ts`), so a `/test`
  sub-app gets a bucket of its own unless the sync limiter *instance* is
  handed to it. It is; and the Tier 2s test asserts it, by exhausting the
  bucket through `/sync/push` and seeing the reset 429.

### 3.4 Why `household.op_seq` is not reset

`op_seq` is a counter column on `household`
([sync §6.6](../sync-protocol.md)). Deleting rows is safe; **resetting the
counter is not.** A client holding a cursor at seq 50 against a Household whose
counter restarted at 0 would sit permanently ahead of the server and never pull
again — silent and undiagnosable, the exact failure mode migration `0003_op`'s
own comment exists to prevent.

Rows are deleted; the counter keeps climbing. Gaplessness is a property of
*assignment*, not of rows continuing to exist, and pull's `seq > cursor`
semantics are unaffected.

### 3.5 Reset is also a tripwire

§8 bounds a leaked credential with the rotation `DELETE` in §9.3 — but nothing
in the first draft would ever have *told* anyone to run it. A compromised E2E
Household looks healthy from the outside: it syncs, it signs in, its tests
pass. So the counts reset returns are not decoration. Every run, immediately
after its first reset, the harness asserts:

| Field | Expected | What a violation means |
| --- | --- | --- |
| `revoked` | `≤ 1` | more than the previous run's one Device was live: **someone else held a token** |
| `passkeys` | `= 0` | the route reports what it **deleted**, and CI's own Passkey is the one it spares — so any deletion at all is a Passkey other than CI's: **someone added a credential** |
| `invites` | `= 0` | an outstanding Invite existed: **someone minted a link** (or a test leaked one — also worth knowing) |

A violation fails the run with a message naming §9.3, and the run does *not*
continue — the wipe has already happened, so the evidence is the count, and a
green run after it would be the wrong signal. The "exactly one live token"
invariant of §3 is what makes this an oracle rather than a heuristic; the
one legitimate exception is the maintainer's capture session (§5), which the
first reset after capture is expected to report as `revoked: 1`. Two jobs each
sign in exactly once per run (§6.4), and each resets first, so `contract`'s
reset sees the previous run's `e2e-prod` Device and `e2e-prod`'s sees this
run's `contract` Device — one each, never more.

## 4. Seeding is client-side, so the server needs none

Once CI holds a real Device token it can push its own setup ops through the
real `POST /sync/push`. So the server grows **no fixture generator** — the new
production surface is one `DELETE`, not a data factory.

This is also more honest than a server-side fixture: the setup exercises the
same write path the product uses, so a broken push breaks setup loudly instead
of being bypassed.

For Tier 5 specifically, most "seeding" is not needed at all — the golden path
*records the gear itself*, through the UI. Reset is enough.

## 5. The credential, captured once

Chrome's virtual authenticator can be **seeded** as well as created:
`WebAuthn.addCredential` takes a credential the test supplies. So the passkey
is created once, by hand, and replayed every run.

**One-time, out of band:**

1. On the box, inside the api container:
   `node dist/bootstrap.js --disposable --name "E2E"`. Note the Household id
   → that is `E2E_HOUSEHOLD_ID` for the infra repo (`admin:list` finds it
   again later).
2. Locally, against `https://app.foerier.app`: attach a virtual authenticator,
   redeem the join link, complete the ceremony.
3. `WebAuthn.getCredentials` → export `credentialId`, `privateKey` (PKCS#8),
   `userHandle`, `rpId`, `isResidentCredential`.
4. Store as GitHub secrets.

**One credential has to serve both tiers, and that constrains the algorithm.**
Tier 5 replays it into Chrome; Tier 4 replays it into `SoftwareAuthenticator`,
which implements ES256 (P-256) and nothing else (§6.4). An authenticator takes
the **first** algorithm the relying party offers, and both ceremonies used to
offer Ed25519 first — so a capture would have produced a key that works
perfectly in a browser and fails only in Tier 4, weeks later, as an
unexplained production sign-in failure. So `generateRegistrationOptions` now
passes `supportedAlgorithmIDs: [-7, -8, -257]` in both ceremonies
(`api/src/auth/service.ts`), ES256 first; nothing is removed, and a real device
that prefers Ed25519 or RS256 still gets it. The capture script refuses a
non-ES256 key rather than warning about it.

**So the capture must happen after an API carrying that ordering is deployed.**
A key captured against the older image is Ed25519 and unusable, and the refusal
is what says so at capture time rather than in CI.

**Every run:** `WebAuthn.addVirtualAuthenticator` →
`WebAuthn.addCredential({ ...exported, signCount: <monotonic> })` (§5.2) →
**sign in** (not join) → Device token.

The credential must be **resident/discoverable**: sign-in is *"one button, no
username and no password"*, which is a discoverable-credential flow.

CI does not need `E2E_HOUSEHOLD_ID` — it signs in, and the server decides.
(It *learns* the id anyway: `register/verify` and `/auth/me` return it and it
is in every op. That is fine; a household id is not a secret.)

After the capture, **sign the laptop out**, or let the first reset revoke it
(§3): the capture leaves a real Device token for the E2E Household on the
maintainer's machine.

### 5.1 The Device token must never reach a log

The GitHub secret is the exported *private key*. GitHub masks secret
**values**; it does not mask values **derived** from them. The Device token
`login/verify` mints each run is a fresh `foe_…` string the masker has never
seen — and this is a public repository, so job logs are world-readable. Three
things print it unless stopped:

- a Vitest `toEqual` failing on a response body from `login/verify` or
  `/auth/me` prints the whole object — `deployment.test.ts` already asserts
  on a body in exactly that shape;
- a Playwright trace records the network log **with request headers and
  response bodies**, so `Authorization: Bearer foe_…` is in the zip. The
  config's `trace: 'on-first-retry'` plus `retries: 2` in CI means the first
  flaky production run *produces* one, and "upload the trace on failure" is
  the obvious next step someone adds;
- a `console.log` of a fetch result while chasing a production-only failure.

So, non-negotiable, and written into the harness rather than left to care:

1. **Mask first.** The sign-in helper masks the token the instant it exists
   (`core.setSecret` / `::add-mask::`), before it is used for anything.
2. **Never assert on a body that can carry a token.** The helper returns the
   token string and nothing else; assertions on `login/verify` and `/auth/me`
   are on `status`, never on the parsed object.
3. **The production project sets `trace: 'off'`, and no step ever uploads a
   trace, an HTML report, or any artifact from it.** Off, rather than "not
   uploaded", so the guard does not depend on nobody adding an
   `upload-artifact` step. The HTML report is named explicitly because it
   holds the same failure bodies the console would.
4. **Sign in from `globalSetup`, not from a test.** Masking only works if the
   `::add-mask::` line reaches the *step's* stdout, and in CI the Playwright
   config uses the `html` reporter, which keeps test-worker stdout inside the
   report rather than echoing it — a `core.setSecret` called inside a test
   masks nothing. Vitest forwards worker output but wraps and prefixes it,
   which is fragile for a line-anchored workflow command. `globalSetup` runs
   in the main process on the real stdout. It mints the token, masks it, and
   hands it to tests through `process.env` / storage state; no test ever
   calls `login/verify` itself.
5. **Prove the mask fires, once.** During the §9.3 rehearsal, a deliberately
   failing assertion on a body that contains the token is run on a throwaway
   branch and the log inspected for `***`. "It should mask" is not a control;
   a log that was looked at is.

### 5.2 The counter must advance, and the server must keep checking

The server enforces the WebAuthn signature counter: `isSignCountAcceptable`
(`api/src/auth/session.ts`) requires `received > stored`, and `login/verify`
rejects an assertion that fails it with `signature counter did not advance`.
Chrome's virtual authenticator starts from whatever `signCount` the
credential is seeded with and increments per assertion. So **replaying the
exported `signCount` breaks on the second run**: run 1 asserts `n+1` and the
server stores it; run 2 is seeded with `n` again, asserts `n+1`, and is
rejected — permanently, every run after the first green one.

The fix that suggests itself is the wrong one. Relaxing or special-casing the
counter check for the E2E Passkey would remove the one signal that exists for
precisely this credential: an exported private key replayed from another
machine *is* the cloned-authenticator case the counter was designed to catch,
and a leaked CI key being used elsewhere concurrently is the only misuse of it
that would be visible at all. **The server-side check is not touched.**

Instead the harness seeds a value that is strictly monotonic across runs and
larger than anything the server can have stored:

```ts
signCount: Math.floor(Date.now() / 1000)   // or github.run_id — either works
```

Within one run the authenticator increments on its own, so retries and a
second sign-in in the same job are fine. And so that nobody "fixes" the server
side under pressure, a Tier 2s test pins the behaviour: a Passkey re-seeded
with a counter at or below the stored one is rejected on sign-in.



## 6. What the tests become

### 6.1 Tier 4 — the household-scoped suite, unblocked

`test/contract/` gains what its own charter promised: with a real token against
the real box (minted as §6.4 describes), an op pushed is an op pulled — proving the whole `/sync` path
through Caddy, the deployed process, and the box's Postgres, which no local
tier can. `deployment.test.ts`'s unauthenticated assertions stay as they are.

**Not initially:** proving *tenancy* on the box, which needs a second Household
and a second credential. Tier 2s already proves it against a real Postgres
(`householdIsolation.test.ts`), and doubling the production credential surface
to re-prove it is not obviously worth it. Recorded as a deliberate omission —
see [§9](#9-open-questions).

### 6.2 Tier 5 — the golden path, retargeted

`PLAYWRIGHT_BASE_URL=https://app.foerier.app` already drops the `webServer`
block and points at production; the config was written for it. Two changes:

- **A signed-in Quartermaster comes from a fixture, not from `joinAs`.**
  Locally the fixture is what every spec does today — `mintInvite()` then
  `joinAs()`; against production it is `globalSetup`'s storage state (§5.1,
  point 4; saved with `indexedDB: true`, since that is where the token lives,
  `auth-design.md` §7.4, and into a gitignored path that no step uploads).
  Joining consumes an invite, and there is exactly one Household that is never
  re-created.
- **Only specs tagged `@production` run there**, selected by the production
  project's `grep`. Three kinds of spec cannot: one that mints an Invite by
  Maintainer script (`mintInvite`, `mintJoinInviteInto`, `mintDeviceLink` —
  all need `DATABASE_URL`), one that proves joining itself, and one that signs
  out the run's own Device — `deviceLink.spec.ts`'s sign-out test would kill
  the token every later spec and reset depend on. So `auth.spec.ts` and
  `deviceLink.spec.ts` stay local-only; `depot.spec.ts` (the golden path) and
  `shell.spec.ts` carry the tag. Local runs are unchanged: the local project
  has no `grep`.
- **Reset first.** Every tagged spec *that signs in* opens with
  `POST /test/reset`, so state comes from the run rather than from whatever the
  last run left. It is the `quartermaster` fixture that resets, which is the
  same thing said precisely: `shell.spec.ts`'s tests want a **signed-out**
  visitor, take no fixture, read nothing of the Household and write nothing to
  it, so there is neither a token to reset with nor state to reset.

**Reset-at-start, never teardown**, and that is the load-bearing choice: a
cancelled or crashed run leaves the Household dirty, and the next run's first
act fixes it. Teardown cannot offer that, and against an append-only op log
there is no cleanup to *do* — which is the objection this design removes
rather than answers.

### 6.3 Parallelism

`workers: 1` for the production project. One Household, one writer. The local
suite runs 7 tests in 15s; production latency does not change the order of
magnitude. Sharding across several seeded Households is a later optimisation,
and should stay unbuilt until the wall-clock actually hurts.

Concurrent CI runs are already handled: `ci.yml`'s `concurrency` group is
`${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress`, so a
second push to `main` cancels the first rather than racing it.

### 6.4 How Tier 4 authenticates — and why no token crosses a job

§1 says one mechanism unblocks both tiers, and that is true of the
*credential*, not of the *token*. Tier 4 is Vitest over plain `fetch`: no
browser, no virtual authenticator, no WebAuthn ceremony. And in `ci.yml` the
`contract` job runs **before** `e2e-prod` (`needs: [changes, contract]`), so
"reuse Tier 5's token" would mean a Device token travelling backwards between
jobs. Every route for that is a leak: a job output is not masked, and an
artifact is downloadable from the run page of a public repository — carrying a
token with a one-year sliding life. **A Device token never crosses a job
boundary.**

So Tier 4 mints its own, from the same secret, without a browser — and the
thing that does it already exists. Tier 2s has a real WebAuthn authenticator
in software, `api/test/server/softwareAuthenticator.ts`: P-256, `none`
attestation, discoverable credentials, signing with Node's `crypto`, verified
by `@simplewebauthn/server` exactly as a phone would be. It generates its own
keypair today; it gains a constructor that accepts the exported PKCS#8 key,
credential id and user handle instead, and Tier 4 drives it through
`login/options` → `login/verify` with the `signCount` seeded as §5.2
requires. The helper in `test/contract/` masks the token before returning it
and returns the token string alone. Two consequences:

- the `contract` job now holds the credential secrets too, so **everything
  §5.1 and §7 say about `e2e-prod` applies to `contract` as well** — pinned
  actions, masked token, no bodies in assertions, nothing uploaded;
- the assertion path is a different one from the browser's. That is the
  point rather than a cost: Tier 2s already trusts this authenticator against
  the same verification code, and Tier 5 proves the real browser path minutes
  later in the same workflow.

The alternative — an API-only Playwright project inside `e2e-prod` — is
legitimate if the shared authenticator turns out awkward to import across
workspaces. What is not legitimate is either job exporting the token.

## 7. CI wiring

A new job, after the contract tier rather than beside it:

```yaml
e2e-prod:
  needs: [changes, contract]
  if: >-
    vars.E2E_ENABLED == 'true' && github.event_name == 'push'
    && needs.changes.outputs.deployable == 'true'
```

`E2E_ENABLED` is a repository **variable**, not a secret, and it is the flip
that turns this job on. It has to exist because Tier 5 cannot degrade the way
Tier 4 does: `globalSetup.production.ts` calls `credential()`, which throws on
an empty `E2E_*` instead of skipping — and the credential cannot be captured
until an API carrying §5's ES256 ordering is deployed, which is to say until
after this work merges. The variable is therefore what keeps `main` green in
the window between the merge and the one-time capture; it is flipped to `true`
once the capture is done and the secrets are stored.

The `push` guard is on the job itself, not only inherited through `changes`:
a job holding a production credential should not depend on a guard that
exists for a different reason (skipping prose-only deploys). **Two jobs hold
it** — `contract` (§6.4) and `e2e-prod` — and the rules below apply to both,
not to whichever one was written first. Every third-party action in either
job is **pinned by SHA** — everything in its environment is one tag-move away
from the secret — and both declare `permissions: {}`, since neither needs a
`GITHUB_TOKEN` scope of any kind.

`needs: contract` is not decoration — the contract job already polls
`/version` until the pushed SHA is served, so depending on it means the
deploy-wait is written once and Tier 5 inherits it.

Secrets: the exported credential fields, in both jobs. Nothing else. See §5.1
for what a job must do with the token it derives from them, and §6.4 for why
each job derives its own.

## 8. Risks, and what bounds each

Stated plainly rather than mitigated away.

| Risk | Bound |
| --- | --- |
| Destructive code ships in the production image | Three gates: the route is mounted only when `E2E_HOUSEHOLD_ID` is set (by the infra repo — a configuration kill switch, §3.3), the token's Household must equal it, and that Household must be `disposable` |
| A bug in the Household check | Two equalities, covered by three Tier 2s tests in the isolation-test shape (§3.3). The lines that must never regress |
| The CI credential leaks | Grants a Device token for one disposable Household. It cannot mint and cannot reach another Household. **Rotating the passkey revokes nothing** — Device tokens live a sliding year, and after S3.5 a holder can add a passkey and issue device links — so the bound is `DELETE FROM household WHERE id = $old`, which cascades to every login, passkey, device, invite and op (§9) |
| A Device token leaks from a log or trace | §5.1: masked at birth from `globalSetup` where the mask demonstrably fires, never in an assertion body, traces and reports off and never uploaded. And reset revokes every Device but the caller's, so at most one token is live at any time |
| A Device token crosses a job boundary | It never does: each job mints its own from the credential (§6.4). There is no output or artifact to leak |
| The leak goes unnoticed | §3.5: reset's counts are asserted every run; a foreign Device, Passkey or Invite fails the build naming §9.3 |
| A well-meant fix relaxes the sign-count check | §5.2: the harness seeds a monotonic counter instead, and a Tier 2s test pins the rejection |
| Rate limiting affects real users | It does not: `/sync/*` and this route bucket **per Device** (`api/src/sync/routes.ts`), and `/auth/*` per IP (first `x-forwarded-for` hop), so CI exhausts only its own |
| Production writes accumulate | Reset deletes them at the start of each run, so the Household's `op` rows stay bounded by one run's worth; and revokes stale Devices, so `device` rows stay bounded too |

## 9. Open questions

1. **Does Tier 4 prove tenancy on the box?** Proposed no — Tier 2s proves it
   against a real Postgres, and a second production credential doubles the
   thing §8's table has to bound. Revisit if the box ever diverges from local
   in a way that could make isolation environment-dependent.
2. **`E2E_HOUSEHOLD_ID` is a cross-repo dependency.** The value lives in the
   infrastructure repo's compose file. Landing this needs a coordinated change
   there, and this repo cannot test that it happened — the route simply 404s
   until it does, which is the right failure.
3. ~~Credential rotation has no story.~~ **Settled: it does, and rehearsing it
   is a landing condition.** If the CI secret leaks:

   1. On the box: `DELETE FROM household WHERE id = '<old E2E id>'`. The FKs
      cascade (`0002_auth.ts`, `0003_op.ts`): every login, passkey, device,
      invite and op of that Household goes with it — including any passkey or
      device link an attacker added. This is the whole revocation; there is
      nothing else to rotate.
   2. `admin:bootstrap --disposable --name "E2E"` → new id.
   3. Re-capture the credential (§5), update the GitHub secrets, update
      `E2E_HOUSEHOLD_ID` in the infra repo.

   The `DELETE` is one statement rather than an `admin:` script; it is
   recorded here verbatim so it is not re-derived under pressure. **Step 1–3
   are run once, end to end, before this spec is retired** — the previous
   draft said "nobody has done it once to check", and that was the finding.

## 10. What this deliberately does not build

- **A mint endpoint.** See [§3.2](#32-why-a-destroy-one-is-safer-than-a-create-many).
- **SSH from CI to the box.** [Architecture §12.1](../architecture-design.md)
  draws the boundary deliberately: *"Deployment is not in this repository…
  this repo's whole side of the contract is: publish images to GHCR."* A deploy
  key would make foerier a deployment repo to save writing one `DELETE`.
- **Exposing the box's Postgres.** Opening a production database to the
  internet for a test needs no further argument.
- **A staging environment.** It does not exist, it is the infra repo's to
  create, and Tier 4 and 5 exist precisely to test *the box* — a staging box
  would prove something adjacent.
- **Server-side fixtures.** [§4](#4-seeding-is-client-side-so-the-server-needs-none).

## 11. Doc amendments

| Doc | Amendment |
| --- | --- |
| `testing.md` Tier 4 | The household-scoped suite exists; how it authenticates |
| `testing.md` Tier 5 | Runs against production after deploy; reset-at-start; `workers: 1` |
| `testing.md` UUID registry | Two slots for the reset route's Tier 2s test: **12 and 13**. S3.5 claimed 9, 10 and 11 as it landed (`deviceLink.test.ts` took a second slot for its mismatched-household Invite) |
| `auth-design.md` | A note that `/test/reset` exists, is not part of the auth surface, and does not weaken §3.4; §3.4 gains `--disposable`; §9.1's "what exists as of S3.5" names the route as outside the table |
| Migration `0005_disposable_household` | `household.disposable boolean not null default false` and `device.passkey_id uuid null references passkey on delete set null`; `db/schema.ts` follows — see §12 |
| `api/src/auth/service.ts` | `login/verify` and `register/verify` record the Passkey on the Device they mint (§3) |
| `api/test/server/auth.test.ts` | The §5.2 regression: a Passkey re-seeded with a counter at or below the stored one is rejected on sign-in |
| `api/test/server/softwareAuthenticator.ts` | A constructor that takes an exported key instead of generating one (§6.4) |
| `api/src/admin/bootstrap.ts` | The `--disposable` flag: sets the column; default false, so every existing invocation is unchanged |
| `architecture-design.md` §12 | Consequences, once shipped |
| `ci.yml` | The `e2e-prod` job; the credential secrets, SHA pinning and `permissions: {}` on **both** `contract` and `e2e-prod`; and the stale comment deferring Tier 5 |
| `playwright.config.ts` | `globalSetup` for the production project; `trace: 'off'` and `grep: /@production/` there |
| `test/e2e/quartermaster.ts` | The signed-in-Quartermaster fixture with its two implementations (§6.2) |

## 12. Dependency on S3.5, and how it actually resolved

This spec was written free of `shared/` and of any migration. The third gate
(§3.1's `household.disposable`) and the Passkey-scoped wipe (§3's
`device.passkey_id`) end that: they need two columns. The first draft planned
to borrow the `0004_device_links` migration S3.5 was about to open.

**S3.5 landed first, and `0004` shipped without them** — it carries
`invite.person_recorded` and `passkey.created_on_device` and nothing else, and
it has run on the box. Migration names sort lexicographically and are never
renamed once deployed (`api/src/db/migrations.ts`), so this spec ships its own
**`0005_disposable_household.ts`** with both columns, registered after `0004`.

Both columns are purely additive — one defaulted, one nullable — so the
expand-contract rule is satisfied trivially and no deployed image is affected
by their presence. A Device minted before `passkey_id` existed reads as
`null`, which the reset treats exactly like a device-link Device: its
Passkeys are not the caller's, and the caller's own is the only one spared.
