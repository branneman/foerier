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
| What it does | Deletes every `op` row for the caller's Household. That is all |
| What it cannot do | **Create** a Household, a Login, or an Invite. §3.4 stays exactly true |
| Auth | `requireAuth` — an ordinary Device token. **No new auth path, no new secret class** |
| Second gate | The token's Household must equal `E2E_HOUSEHOLD_ID`, an env var set on the box. Unset ⇒ the route 404s |
| Seeding | **Client-side**, through the real `/sync/push`. The server grows no fixture generator |
| Bootstrap | **By hand, once**, with the existing `admin:bootstrap` script. Never automated |
| CI credential | One exported WebAuthn credential, replayed into Chrome's virtual authenticator each run |
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
POST /sync/push              needs a token
GET  /sync/pull              "
```

**Nothing mints a Household or an Invite.** Story 28 (invite another Person)
would, at S5 — but it requires an already-signed-in Quartermaster, so it cannot
bootstrap the first one either.

So the question is not "how do we avoid a new route". It is **"what is the
smallest, most tightly gated capability that closes this, and can it avoid
touching §3.4 at all?"**

## 3. The route

```
POST /api/v1/test/reset
Authorization: Bearer <device token>

404  unless the server was started with E2E_HOUSEHOLD_ID set
401  unless the token resolves (existing requireAuth)
403  unless auth.householdId === E2E_HOUSEHOLD_ID
200  { deleted: <n> }
```

Its entire body is one statement:

```sql
DELETE FROM op WHERE household_id = $1   -- $1 from the token, never a body
```

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
  repo**, with whoever runs the server.
- The token's Household must match it. This is the one line that must never
  regress, so it gets a Tier 2s test in the shape of the existing
  `householdIsolation.test.ts`: *Household B's valid token cannot reset
  Household A.*

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

1. On the box: `npm run admin:bootstrap --workspace api -- --name "E2E"`.
   Note the Household id → that is `E2E_HOUSEHOLD_ID` for the infra repo.
2. Locally, against `https://app.foerier.app`: attach a virtual authenticator,
   redeem the join link, complete the ceremony.
3. `WebAuthn.getCredentials` → export `credentialId`, `privateKey` (PKCS#8),
   `userHandle`, `rpId`, `isResidentCredential`.
4. Store as GitHub secrets.

**Every run:** `WebAuthn.addVirtualAuthenticator` →
`WebAuthn.addCredential(exported)` → **sign in** (not join) → Device token.

The credential must be **resident/discoverable**: sign-in is *"one button, no
username and no password"*, which is a discoverable-credential flow.

CI never learns `E2E_HOUSEHOLD_ID` — it signs in, and the server decides.

## 6. What the tests become

### 6.1 Tier 4 — the household-scoped suite, unblocked

`test/contract/` gains what its own charter promised: with a real token against
the real box, an op pushed is an op pulled — proving the whole `/sync` path
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

- **`joinAs` becomes `signInAs`** for the production project. Joining consumes
  an invite, and there is exactly one Household that is never re-created.
- **Reset first.** Every spec's first act is `POST /test/reset`, so state comes
  from the run rather than from whatever the last run left.

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

## 7. CI wiring

A new job, after the contract tier rather than beside it:

```yaml
e2e-prod:
  needs: [changes, contract]
  if: needs.changes.outputs.deployable == 'true'
```

`needs: contract` is not decoration — the contract job already polls
`/version` until the pushed SHA is served, so depending on it means the
deploy-wait is written once and Tier 5 inherits it.

Secrets: the exported credential fields. Nothing else.

## 8. Risks, and what bounds each

Stated plainly rather than mitigated away.

| Risk | Bound |
| --- | --- |
| Destructive code ships in the production image | Two independent gates; the outer one (`E2E_HOUSEHOLD_ID`) is set by the infra repo and is a kill switch this repo cannot defeat |
| A bug in the Household check | One equality, covered by a Tier 2s test in the isolation-test shape. The single line that must never regress |
| The CI credential leaks | Grants a Device token for one disposable Household. It cannot mint, cannot reach another Household, and is revocable by rotating the passkey |
| Rate limiting affects real users | It does not: `take(clientKey(...))` buckets **per IP** (first `x-forwarded-for` hop), so CI exhausts only its own |
| Production writes accumulate | Reset deletes them at the start of each run, so the Household's `op` rows stay bounded by one run's worth |

## 9. Open questions

1. **Does Tier 4 prove tenancy on the box?** Proposed no — Tier 2s proves it
   against a real Postgres, and a second production credential doubles the
   thing §8's table has to bound. Revisit if the box ever diverges from local
   in a way that could make isolation environment-dependent.
2. **`E2E_HOUSEHOLD_ID` is a cross-repo dependency.** The value lives in the
   infrastructure repo's compose file. Landing this needs a coordinated change
   there, and this repo cannot test that it happened — the route simply 404s
   until it does, which is the right failure.
3. **Credential rotation has no story.** If the CI secret leaks, the recovery
   is "bootstrap a new E2E Household, re-capture, update two secrets and one
   infra env var". Acceptable, but nobody has done it once to check.

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
| `testing.md` UUID registry | Two slots for the reset route's Tier 2s test (next free: 9, 10) |
| `auth-design.md` | A note that `/test/reset` exists, is not part of the auth surface, and does not weaken §3.4 |
| `architecture-design.md` §12 | Consequences, once shipped |
| `ci.yml` | The `e2e-prod` job, and the stale comment deferring Tier 5 |
