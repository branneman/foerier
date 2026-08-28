# Tier 4 and Tier 5 against production — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the household-scoped contract suite (Tier 4) and the tagged Tier 5 golden path against the deployed box on every push to `main`, unblocked by one tightly gated `POST /api/v1/test/reset`.

**Architecture:** One conditionally-mounted Hono sub-app behind `requireAuth`, three gates (env var, household equality, `disposable` column), one additive migration `0005`. No `shared/` changes, no new op types. CI signs in from an exported WebAuthn credential — in Node for Tier 4 (via the existing software authenticator), in Chrome's virtual authenticator for Tier 5 — and never lets the Device token leave the job that minted it.

**Tech Stack:** Hono · Kysely · Postgres · `@simplewebauthn/server` · Vitest · Playwright (CDP `WebAuthn` domain) · GitHub Actions

**Spec:** [`docs/specs/2026-08-28-tier-4-and-5-against-production.md`](2026-08-28-tier-4-and-5-against-production.md) — read it alongside this plan; where they disagree the spec wins. The spec's **Decisions at a glance** table is the checklist.

## Global Constraints

- **Relative imports in `api/` need an explicit `.ts` extension.** Root-level `test/` files run under Vitest/Playwright and follow the same rule for `.ts` imports into `api/`; `app/` is the exception.
- **`household_id` comes from the auth context and never from a request body, query string, or header** (`auth-design.md` §9.3). The reset route's target is `c.get('auth').householdId` and nothing else.
- **The Device token never reaches a log, a job output, an artifact, or an assertion body** (spec §5.1, §6.4). Every helper that mints one masks it (`::add-mask::`) before returning it, and returns the string alone.
- **The server-side sign-count check is not touched** (spec §5.2). The harness seeds a monotonic counter instead.
- **Migration names sort lexicographically and are never renamed once deployed.** This work ships `0005_disposable_household`; `0004` is already on the box.
- **Tier 2s isolation:** the new test class claims UUID registry slots **12 and 13** in `docs/testing.md`, scopes every query to its own households, and clears no table it does not own — never `webauthn_challenge`.
- **Tier 0 runs on every commit** (pre-commit hook: typecheck, ESLint, Prettier). Prettier also formats Markdown — run `npx prettier --write` on any doc you touch.
- **Known-flaky neighbour:** `api/test/server/sync.test.ts` fails nondeterministically in the full suite and passes alone. Do not modify it; re-run it alone before investigating.
- **Local Postgres for Tier 2s:** `docker compose -f docker-compose.dev.yml up -d`, then `npm run test:server`.
- **Commit messages** end with `Claude-Session: https://claude.ai/code/session_0167quM4TbYHwiT6otPhVcQX`. Each commit's message says *why*, in the style of `git log`.

---

## File Structure

**Server — `api/`**

| Path | Responsibility |
| --- | --- |
| `api/migrations/0005_disposable_household.ts` | Create: `household.disposable`, `device.passkey_id` |
| `api/src/db/migrations.ts` | Modify: register `0005` |
| `api/src/db/schema.ts` | Modify: the two columns |
| `api/src/config.ts` | Modify: `e2eHouseholdId?: string` — UUID, lowercased, refuses garbage |
| `api/src/auth/service.ts` | Modify: `bootstrapHousehold` takes `disposable`; `finishLogin` and `finishRegistration` record `device.passkey_id` |
| `api/src/admin/bootstrap.ts` | Modify: `--disposable` flag |
| `api/src/test/service.ts` | Create: `createTestResetService` — the one transaction |
| `api/src/test/routes.ts` | Create: `createTestRoutes` — `POST /reset` |
| `api/src/app.ts` | Modify: `e2eHouseholdId` dep; mount `/test` only when set; hand it the sync limiter instance |
| `api/src/index.ts` | Modify: pass `config.e2eHouseholdId` |

**Server tests — `api/test/server/`**

| Path | Responsibility |
| --- | --- |
| `softwareAuthenticator.ts` | Modify: constructor accepts an exported credential; `export()` |
| `harness.ts` | Modify: `createHarness({ e2eHouseholdId })`; `seedHousehold` gains `disposable` |
| `auth.test.ts` | Modify: `passkey_id` is recorded; imported credential signs in; §5.2 counter regression |
| `migrations.test.ts` | Modify: `0005` up/down |
| `testReset.test.ts` | Create: slots **12, 13** — the three edges, the `disposable` gate, the counts, the shared bucket |
| `api/src/config.test.ts` | Modify: `E2E_HOUSEHOLD_ID` parsing |

**Tier 4 — `test/contract/`**

| Path | Responsibility |
| --- | --- |
| `test/contract/credential.ts` | Create: reads the `E2E_*` secrets; `hasCredential()` |
| `test/contract/signIn.ts` | Create: mints and masks a Device token in Node |
| `test/contract/reset.ts` | Create: `resetHousehold(token)` + the tripwire assertion (shared with Tier 5) |
| `test/contract/household.test.ts` | Create: reset → push → pull, skipped without secrets |
| `vitest.contract.config.ts` | Modify: `fileParallelism: false` |

**Tier 5 — `test/e2e/`**

| Path | Responsibility |
| --- | --- |
| `test/e2e/production.ts` | Create: `isProduction`, `API_URL`, `STORAGE_STATE` path |
| `test/e2e/globalSetup.production.ts` | Create: virtual authenticator + seeded credential → sign in → mask → storage state; first reset + tripwire |
| `test/e2e/quartermaster.ts` | Modify: the `quartermaster` fixture with two implementations |
| `test/e2e/depot.spec.ts`, `test/e2e/shell.spec.ts` | Modify: `@production` tag; depot uses the fixture |
| `test/e2e/captureCredential.ts` | Create: the one-time capture (spec §5), run by hand |
| `playwright.config.ts` | Modify: `production` project |
| `.gitignore` | Modify: `test/e2e/.auth/` |

**CI and docs**

| Path | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | Modify: `e2e-prod` job; secrets, SHA pins, `permissions: {}` on `contract` and `e2e-prod`; stale comment |
| `docs/testing.md` | Modify: Tier 4, Tier 5, registry rows 12–13 |
| `docs/auth-design.md` | Modify: §3.4 `--disposable`; §9.1 note |
| `docs/architecture-design.md` | Modify: §12.8 consequences |
| `CLAUDE.md` | Modify: current status |

---

### Task 1: Migration `0005_disposable_household`

**Files:**
- Create: `api/migrations/0005_disposable_household.ts`
- Modify: `api/src/db/migrations.ts`, `api/src/db/schema.ts`
- Test: `api/test/server/migrations.test.ts`

**Interfaces:**
- Produces: `HouseholdTable.disposable: ColumnType<boolean, boolean | undefined, boolean>`; `DeviceTable.passkey_id: ColumnType<string | null, string | null | undefined, string | null>`.

- [ ] **Step 1: Write the failing test** in `migrations.test.ts`, alongside the existing `0004` cases (read the file first and mirror its shape — it imports each migration module and calls `up`/`down` against `testDb()`):

```ts
import * as m0005 from '../../migrations/0005_disposable_household.ts'

it('0005 adds household.disposable (default false) and device.passkey_id (nullable, set null on delete)', async () => {
  await migrateToLatest(db)
  const cols = await sql<{ table_name: string; column_name: string; column_default: string | null; is_nullable: string }>`
    select table_name, column_name, column_default, is_nullable
      from information_schema.columns
     where (table_name, column_name) in (('household','disposable'), ('device','passkey_id'))
  `.execute(db)
  expect(cols.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ table_name: 'household', column_name: 'disposable', column_default: 'false', is_nullable: 'NO' }),
      expect.objectContaining({ table_name: 'device', column_name: 'passkey_id', is_nullable: 'YES' }),
    ]),
  )
  const fk = await sql<{ delete_rule: string }>`
    select rc.delete_rule from information_schema.referential_constraints rc
      join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
     where tc.table_name = 'device' and tc.constraint_name like '%passkey_id%'
  `.execute(db)
  expect(fk.rows[0]?.delete_rule).toBe('SET NULL')
})

it('0005 rolls back cleanly', async () => {
  await migrateToLatest(db)
  await m0005.down(db)
  const cols = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
     where (table_name, column_name) in (('household','disposable'), ('device','passkey_id'))
  `.execute(db)
  expect(cols.rows).toEqual([])
  await m0005.up(db)
})
```

- [ ] **Step 2: Run** `npm run test:server -- migrations` → FAIL (module not found).

- [ ] **Step 3: Implement** the migration. Doc comment in the style of `0004_device_links.ts`, saying the two facts and why they are separate from `passkey.created_on_device` (spec §3):

```ts
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('household')
    .addColumn('disposable', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()
  await db.schema
    .alterTable('device')
    .addColumn('passkey_id', 'uuid', (col) =>
      col.references('passkey.id').onDelete('set null'),
    )
    .execute()
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('device').dropColumn('passkey_id').execute()
  await db.schema.alterTable('household').dropColumn('disposable').execute()
}
```

Register it in `migrations.ts` as `'0005_disposable_household'`; add the two columns to `schema.ts` with one-line doc comments.

- [ ] **Step 4: Run** `npm run test:server -- migrations` → PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit** — "Add household.disposable and device.passkey_id in 0005".

---

### Task 2: `E2E_HOUSEHOLD_ID` in config

**Files:**
- Modify: `api/src/config.ts`, `api/src/config.test.ts`

**Interfaces:**
- Produces: `Config.e2eHouseholdId: string | undefined` — lowercase UUID or undefined.

- [ ] **Step 1: Write the failing tests** (mirror the file's existing `loadConfig({...})` style):

```ts
describe('E2E_HOUSEHOLD_ID', () => {
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://x' }
  it('is undefined when unset or empty', () => {
    expect(loadConfig({ ...base }).e2eHouseholdId).toBeUndefined()
    expect(loadConfig({ ...base, E2E_HOUSEHOLD_ID: '' }).e2eHouseholdId).toBeUndefined()
  })
  it('lowercases a UUID — Postgres returns uuid lowercase, and a capitalised compose value would 403 forever', () => {
    expect(loadConfig({ ...base, E2E_HOUSEHOLD_ID: '0F00000C-0000-4000-8000-00000000000C' }).e2eHouseholdId)
      .toBe('0f00000c-0000-4000-8000-00000000000c')
  })
  it('refuses to boot on garbage', () => {
    expect(() => loadConfig({ ...base, E2E_HOUSEHOLD_ID: 'not-a-uuid' })).toThrow(/E2E_HOUSEHOLD_ID/)
  })
})
```

- [ ] **Step 2: Run** `npm test -- config` → FAIL.

- [ ] **Step 3: Implement.** A `UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`; parse in `loadConfig`, throw `new Error('E2E_HOUSEHOLD_ID is not a UUID: …')` on mismatch. Doc comment: what the var does, that unset means the route is not mounted, that the value is set by the infrastructure repo (spec §3.3).

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — "Parse E2E_HOUSEHOLD_ID as a lowercased UUID, or refuse to boot".

---

### Task 3: `--disposable` on the bootstrap, and `passkey_id` recorded on the Device

**Files:**
- Modify: `api/src/auth/service.ts` (`bootstrapHousehold`, `finishLogin`, `finishRegistration`), `api/src/admin/bootstrap.ts`, `api/test/server/harness.ts` (`seedHousehold({ disposable })`)
- Test: `api/test/server/auth.test.ts`

**Interfaces:**
- Produces: `bootstrapHousehold({ name, disposable = false })`. Every Device minted by `register/verify` and `login/verify` has `passkey_id` set to the Passkey that verified the ceremony; `device/claim` leaves it null.

- [ ] **Step 1: Write the failing tests** in `auth.test.ts`. Read the file's helpers first (`post`, `SoftwareAuthenticator`, how it registers and signs in) and reuse them:

```ts
it('records which Passkey signed the Device in, on both ceremonies', async () => {
  // register/verify
  const joined = await join()            // whatever the file's existing helper is called
  const passkey = await db.selectFrom('passkey').select('id').where('login_id', '=', joined.login_id).executeTakeFirstOrThrow()
  const registered = await db.selectFrom('device').select('passkey_id').where('id', '=', joined.device_id).executeTakeFirstOrThrow()
  expect(registered.passkey_id).toBe(passkey.id)
  // login/verify
  const signedIn = await signIn(joined.device)
  const row = await db.selectFrom('device').select('passkey_id').where('id', '=', signedIn.device_id).executeTakeFirstOrThrow()
  expect(row.passkey_id).toBe(passkey.id)
})

it('bootstrapHousehold writes disposable only when told to', async () => {
  const a = await h.service.bootstrapHousehold({ name: 'Real' })
  const b = await h.service.bootstrapHousehold({ name: 'E2E', disposable: true })
  const rows = await db.selectFrom('household').select(['id', 'disposable']).where('id', 'in', [a.householdId, b.householdId]).execute()
  expect(rows.find((r) => r.id === a.householdId)?.disposable).toBe(false)
  expect(rows.find((r) => r.id === b.householdId)?.disposable).toBe(true)
  await db.deleteFrom('household').where('id', 'in', [a.householdId, b.householdId]).execute()
})
```

- [ ] **Step 2: Run** `npm run test:server -- auth` → FAIL.

- [ ] **Step 3: Implement.**
  - `finishLogin`: add `passkey_id: row.passkey_id` to the `insertInto('device')` values.
  - `finishRegistration`: the Device is inserted before the Passkey (S3.5's FK order). After the `insertInto('passkey')`, `trx.updateTable('device').set({ passkey_id: passkeyId }).where('id', '=', deviceId)` — hoist `const passkeyId = ids.next()` above the insert. Comment: the two FKs point at each other, legal because both are nullable (spec §3).
  - `bootstrapHousehold({ name, disposable = false })`: `.values({ id, name, disposable })`.
  - `bootstrap.ts`: `disposable: { type: 'boolean' }` in `parseArgs`; pass it; when set, print a line `  disposable    yes — POST /test/reset may wipe this Household` after `household_id`; extend the usage strings with `[--disposable]`; a paragraph in the doc comment pointing at the spec.
  - `harness.ts` `seedHousehold(db, { id, name, disposable? })`.

- [ ] **Step 4: Run** `npm run test:server` → PASS (re-run `sync.test.ts` alone if it flakes). `npm run typecheck`.

- [ ] **Step 5: Commit** — "Record the signing Passkey on each Device; add --disposable to bootstrap".

---

### Task 4: The software authenticator accepts an exported credential; the §5.2 regression

**Files:**
- Modify: `api/test/server/softwareAuthenticator.ts`
- Test: `api/test/server/auth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ExportedCredential {
    /** base64 (standard, not url) PKCS#8 DER — the encoding Chrome's `WebAuthn.addCredential` takes, so one secret serves both consumers */
    privateKey: string
    /** base64url */
    credentialId: string
  }
  interface SoftwareAuthenticatorOptions { …; credential?: ExportedCredential }
  class SoftwareAuthenticator { …; export(): ExportedCredential }
  ```

- [ ] **Step 1: Write the failing tests** in `auth.test.ts`'s "signing in again" block:

```ts
it('a credential exported from one authenticator signs in from another', async () => {
  const joined = await join()
  const replica = new SoftwareAuthenticator({ origin: TEST_ORIGIN, rpId: TEST_RP_ID, credential: joined.device.export(), signCount: 100 })
  const res = await signInRaw(replica)   // the file's login/options → login/verify pair, returning the Response
  expect(res.status).toBe(200)
})

it('rejects a Passkey re-seeded with a counter at or below the stored one', async () => {
  // Spec §5.2 — the check that must survive a replayed CI credential.
  const joined = await join()
  const first = new SoftwareAuthenticator({ origin: TEST_ORIGIN, rpId: TEST_RP_ID, credential: joined.device.export(), signCount: 50 })
  expect((await signInRaw(first)).status).toBe(200)          // stores 51
  const replayed = new SoftwareAuthenticator({ origin: TEST_ORIGIN, rpId: TEST_RP_ID, credential: joined.device.export(), signCount: 50 })
  const res = await signInRaw(replayed)
  expect(res.status).toBe(401)
  expect(await res.json()).toEqual({ error: 'auth_failed' })
})
```

(`SoftwareAuthenticator.get` writes `this.signCount` into the authenticator data; check whether it increments after signing — if it does not, increment in `get()` so a second assertion in the same instance advances, as a real authenticator does. Adjust the expected stored value accordingly.)

- [ ] **Step 2: Run** → FAIL (`export` is not a function).

- [ ] **Step 3: Implement.** In the constructor, if `credential` is given: `this.privateKey = createPrivateKey({ key: Buffer.from(credential.privateKey, 'base64'), format: 'der', type: 'pkcs8' })`, derive the public JWK with `createPublicKey(this.privateKey).export({ format: 'jwk' })`, and `this.credentialId = isoBase64URL.toBuffer(credential.credentialId)`. Otherwise generate as today. `export()` returns `{ privateKey: this.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), credentialId: this.credentialIdB64 }`. Make `get()` increment `this.signCount` after building the authenticator data if it does not already.

- [ ] **Step 4: Run** `npm run test:server -- auth` → PASS. **Step 5: Commit** — "Let the software authenticator replay an exported credential; pin the counter check".

---

### Task 5: `POST /api/v1/test/reset`

**Files:**
- Create: `api/src/test/service.ts`, `api/src/test/routes.ts`, `api/test/server/testReset.test.ts`
- Modify: `api/src/app.ts`, `api/src/index.ts`, `api/test/server/harness.ts`, `docs/testing.md` (registry rows 12, 13)

**Interfaces:**
- Consumes: `Config.e2eHouseholdId`, `DeviceTable.passkey_id`, `HouseholdTable.disposable`, `AuthContext { deviceId, loginId, householdId, personId }`.
- Produces: `buildApp({ …, e2eHouseholdId?: string })`; `createHarness({ e2eHouseholdId })`; response `200 { deleted, revoked, passkeys, invites }` (numbers); `403 { error: 'forbidden' }`.

- [ ] **Step 1: Claim the registry slots.** In `docs/testing.md` add above the "claim the next free slot" line:

```
| 12 | `0f00000c-…-00000000000c` | `testReset.test.ts` — the disposable E2E household |
| 13 | `0f00000d-…-00000000000d` | `testReset.test.ts` — the household that must stay untouched |
```

- [ ] **Step 2: Write the failing tests** — `testReset.test.ts`, modelled on `householdIsolation.test.ts` (copy its `post`, `joinHousehold`, `anOp`, `householdSeq` helpers; do not import them). Two harnesses: `h = await createHarness({ e2eHouseholdId: E2E })` and `unset = await createHarness()`; `E2E = '0f00000c-0000-4000-8000-00000000000c'`, `OTHER = '0f00000d-0000-4000-8000-00000000000d'`. `beforeEach`: reset both, seed `E2E` with `disposable: true` and `OTHER` without. Cases:

  1. **foreign token → 403, both op counts unchanged**: join `OTHER`, push one op into each household (join `E2E` too), reset with `OTHER`'s token → 403 `{ error: 'forbidden' }`; `op` counts for both still 1.
  2. **env unset → 404**: join `E2E` on `unset`, reset → 404.
  3. **the happy path**: join `E2E` twice (two Devices, two Passkeys), mint a device Invite via `h.service.issueDeviceLink(...)` (read its signature in `service.ts`), push two ops, `seq` before; reset with the *second* Device's token → 200 `{ deleted: 2, revoked: 1, passkeys: 1, invites: 1 }`; `E2E` has 0 `op` rows, `op_seq` unchanged, `OTHER`'s rows untouched; first Device `revoked_at` not null, caller's null; the only Passkey left is the caller's (`device.passkey_id`); no unused Invite remains.
  4. **`disposable = false` → 403**, nothing deleted: seed `E2E` with `disposable: false` for this test.
  5. **shares `/sync`'s bucket**: `createHarness({ e2eHouseholdId: E2E, syncRateLimit: { capacity: 2, refillPerMinute: 1 } })`, sign in, push twice (200s), then reset → 429.
  6. **a device-link Device (`passkey_id` null) as caller** spares no Passkey: claim a device Invite for the Login (read `deviceLink.test.ts` for how), reset with that token → `passkeys` equals the Login's Passkey count and none remain.

- [ ] **Step 3: Run** `npm run test:server -- testReset` → FAIL (404s everywhere).

- [ ] **Step 4: Implement.**

`api/src/test/service.ts`:

```ts
export interface ResetCounts { deleted: number; revoked: number; passkeys: number; invites: number }
export class NotDisposableError extends Error {}

export function createTestResetService({ db, clock }: { db: Kysely<Database>; clock: Clock }) {
  return {
    async reset(context: AuthContext): Promise<ResetCounts> {
      return db.transaction().execute(async (trx) => {
        // The same row lock /sync/push takes (sync/service.ts step 1), so a
        // push racing a reset cannot commit rows that survive the wipe.
        const household = await trx.selectFrom('household').select(['op_seq', 'disposable'])
          .where('id', '=', context.householdId).forUpdate().executeTakeFirstOrThrow()
        if (!household.disposable) throw new NotDisposableError()

        const caller = await trx.selectFrom('device').select('passkey_id')
          .where('id', '=', context.deviceId).executeTakeFirstOrThrow()

        const deleted = await trx.deleteFrom('op').where('household_id', '=', context.householdId).executeTakeFirst()
        const revoked = await trx.updateTable('device').set({ revoked_at: new Date(clock.now()) })
          .where('household_id', '=', context.householdId).where('id', '<>', context.deviceId)
          .where('revoked_at', 'is', null).executeTakeFirst()
        const invites = await trx.deleteFrom('invite').where('household_id', '=', context.householdId)
          .where('used_at', 'is', null).executeTakeFirst()
        let passkeys = trx.deleteFrom('passkey')
          .where('login_id', 'in', (qb) => qb.selectFrom('login').select('id').where('household_id', '=', context.householdId))
        if (caller.passkey_id !== null) passkeys = passkeys.where('id', '<>', caller.passkey_id)
        const removed = await passkeys.executeTakeFirst()

        return {
          deleted: Number(deleted.numDeletedRows),
          revoked: Number(revoked.numUpdatedRows),
          passkeys: Number(removed.numDeletedRows),
          invites: Number(invites.numDeletedRows),
        }
      })
    },
  }
}
```

`api/src/test/routes.ts` — `createTestRoutes({ service, requireAuth, limiter, e2eHouseholdId })`: `test.post('/reset', requireAuth, rateLimited, …)` where `rateLimited` keys the limiter by `c.get('auth').deviceId` exactly as `sync/routes.ts` does (read it; reuse the same idiom, do not import its private function). Handler: `if (auth.householdId !== e2eHouseholdId) return c.json({ error: 'forbidden' }, 403)`; `try { return c.json(await service.reset(auth)) } catch (e) { if (e instanceof NotDisposableError) return c.json({ error: 'forbidden' }, 403); throw e }`. File doc comment: the three gates, the spec path, and that this route is **not** part of the auth surface.

`app.ts`: `e2eHouseholdId?: string | undefined` on `AppDeps`; create `const syncLimiter = createRateLimiter({ ...syncRateLimit, clock })` once, hand it to both `/sync` and `/test`; `if (e2eHouseholdId !== undefined) v1.route('/test', createTestRoutes({ service: createTestResetService({ db, clock }), requireAuth, limiter: syncLimiter, e2eHouseholdId }))`. Comment: mounted conditionally, not guarded — "unset ⇒ 404" is true by construction (spec §3). `index.ts`: pass `e2eHouseholdId: config.e2eHouseholdId`. `harness.ts`: thread `e2eHouseholdId` through.

- [ ] **Step 5: Run** `npm run test:server` → PASS. `npm run typecheck && npm run lint`.

- [ ] **Step 6: Commit** — "Add POST /test/reset behind three gates".

---

### Task 6: Tier 4 — sign in from Node, reset, push, pull

**Files:**
- Create: `test/contract/credential.ts`, `test/contract/signIn.ts`, `test/contract/reset.ts`, `test/contract/household.test.ts`
- Modify: `vitest.contract.config.ts`, `test/contract/deployment.test.ts` (the stale "No household" paragraph)

**Interfaces:**
- Consumes: `SoftwareAuthenticator` with `credential` (Task 4), `POST /test/reset` (Task 5).
- Produces:
  ```ts
  // credential.ts — env: E2E_CREDENTIAL_ID (base64url), E2E_PRIVATE_KEY (base64 PKCS#8 DER)
  export function hasCredential(): boolean
  export function credential(): ExportedCredential
  export function monotonicSignCount(): number     // Math.floor(Date.now() / 1000)
  // signIn.ts
  export async function signIn(apiBase: string): Promise<string>   // masks, returns the token alone
  // reset.ts
  export interface ResetCounts { deleted: number; revoked: number; passkeys: number; invites: number }
  export async function resetHousehold(apiBase: string, token: string): Promise<ResetCounts>
  export function assertTripwire(counts: ResetCounts): void          // throws naming spec §9.3
  export function mask(secret: string): void                          // console.log(`::add-mask::${secret}`)
  ```

- [ ] **Step 1: Check the import path works.** `test/contract/signIn.ts` imports `../../api/test/server/softwareAuthenticator.ts` and that file imports `@simplewebauthn/server/helpers`. Run `node -e "import('@simplewebauthn/server/helpers').then(()=>console.log('ok'))"` from the repo root. If it fails, add `@simplewebauthn/server` to the root `package.json` devDependencies at the version `api/package.json` pins (hoisting makes it a no-op install) — the honest declaration rather than relying on hoisting.

- [ ] **Step 2: Write `household.test.ts`** (it runs against the internet, so "failing first" means: run it with `CONTRACT_API_URL=http://localhost:8080` against a local dev server started with `E2E_HOUSEHOLD_ID` and a bootstrapped `--disposable` household — do this once to prove the harness; see the Landing conditions section for the commands):

```ts
import { describe, expect, it } from 'vitest'
import { hasCredential } from './credential'
import { signIn } from './signIn'
import { assertTripwire, resetHousehold } from './reset'

const API = (process.env.CONTRACT_API_URL ?? 'https://api.foerier.app') + '/api/v1'

describe.skipIf(!hasCredential())('the deployed household', () => {
  // One token for the file: minted once, masked once, never in an assertion.
  let token: string
  beforeAll(async () => { token = await signIn(API); assertTripwire(await resetHousehold(API, token)) })

  it('accepts a pushed op and serves it back through Caddy, the process, and the box Postgres', async () => {
    const op = { id: uuidv7(), aggregate: 'gear', aggregate_id: crypto.randomUUID(), type: 'gear.recorded',
                 hlc: `${new Date().toISOString()}-0000`, device_id: crypto.randomUUID(), payload: { name: 'Zeltbahn' } }
    // household_id: read `docs/sync-protocol.md` §6.1 for whether the wire envelope carries it; mirror `householdIsolation.test.ts`'s anOp() and the push body shape exactly.
    const push = await fetch(`${API}/sync/push`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ops: [op] }) })
    expect(push.status).toBe(200)
    const pull = await fetch(`${API}/sync/pull?since=0`, { headers: { authorization: `Bearer ${token}` } })
    expect(pull.status).toBe(200)
    const body = (await pull.json()) as { ops: Array<{ id: string }> }
    expect(body.ops.map((o) => o.id)).toContain(op.id)
  })

  it('answers reset with exact counts the second time', async () => {
    expect(await resetHousehold(API, token)).toEqual({ deleted: 1, revoked: 0, passkeys: 0, invites: 0 })
  })
})
```

`uuidv7`: import `systemIdSource` from `@foerier/shared` (a workspace, resolvable from root) and call `.next()`. Read `sync-protocol.md` §6.1/§6.4 for the exact push and pull query/body shapes and adjust the literal above; the assertion is on `status` and on op ids only.

- [ ] **Step 3: Implement the helpers.** `signIn`: `login/options` → `new SoftwareAuthenticator({ origin: 'https://app.foerier.app', rpId: 'foerier.app', credential: credential(), signCount: monotonicSignCount() }).get(options)` → `login/verify` with `{ response }` (read `api/src/auth/routes.ts` for the exact body) → if status ≠ 200 throw `new Error(\`login/verify answered ${status}\`)` **without the body** → `mask(token)` → return `token`. `reset.ts`: `assertTripwire` throws `Error('TRIPWIRE: reset revoked ${n} devices / found ${p} foreign passkeys / ${i} outstanding invites — a credential other than CI's was live. Rotate per docs/specs/2026-08-28-tier-4-and-5-against-production.md §9.3')` when `revoked > 1 || passkeys !== 0 || invites !== 0`. (Note: the spec's table says `passkeys = 1` counting the survivor; the route returns *deleted* passkeys, so the expected value is **0** — say so in a comment.) `vitest.contract.config.ts`: `fileParallelism: false` with a comment (one Household, one writer). `deployment.test.ts`: replace the "No household, no credentials" paragraph with a pointer to `household.test.ts`.

- [ ] **Step 4: Verify locally** (see Landing conditions §L1) → both tests PASS against the local server; `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit** — "Tier 4: the household-scoped suite, signed in from an exported credential".

---

### Task 7: Tier 5 — the `quartermaster` fixture, the production project, the `@production` tag

**Files:**
- Create: `test/e2e/production.ts`, `test/e2e/globalSetup.production.ts`
- Modify: `test/e2e/quartermaster.ts`, `test/e2e/depot.spec.ts`, `test/e2e/shell.spec.ts`, `playwright.config.ts`, `.gitignore`

**Interfaces:**
- Consumes: `resetHousehold`, `assertTripwire`, `mask` (Task 6, imported from `../contract/reset`), `credential()`, `monotonicSignCount()`.
- Produces:
  ```ts
  // production.ts
  export const isProduction = process.env['PLAYWRIGHT_BASE_URL'] !== undefined
  export const API_URL = process.env['PLAYWRIGHT_API_URL'] ?? 'https://api.foerier.app'   // + '/api/v1' where used
  export const STORAGE_STATE = 'test/e2e/.auth/production.json'
  // quartermaster.ts
  export const test: TestType<{ quartermaster: { page: Page; context: BrowserContext } }>
  ```

- [ ] **Step 1: The fixture.** In `quartermaster.ts`, `export const test = base.extend<{ quartermaster: { page: Page; context: BrowserContext } }>({ quartermaster: async ({ browser, page, context }, use) => { … } })`:
  - **local**: `const { secret } = await mintInvite(); await attachAuthenticator(page); await joinAs(page, secret, 'Els'); await page.getByRole('button', { name: 'Open the depot' }).click(); await use({ page, context })`.
  - **production**: `assertTripwire(await resetHousehold(API, process.env['E2E_DEVICE_TOKEN']!))` is **not** repeated here (globalSetup did it once; the tripwire is a first-reset oracle, spec §3.5) — call `resetHousehold` only. Then `const ctx = await browser.newContext({ storageState: STORAGE_STATE }); const p = await ctx.newPage(); await p.goto('/'); await use({ page: p, context: ctx }); await ctx.close()`.
  - Both paths end on the Depot: `await expect(page.getByRole('heading', { name: 'Depot' })).toBeVisible()` before `use`.

- [ ] **Step 2: `globalSetup.production.ts`** (Playwright `globalSetup` signature `async (config: FullConfig) => void`):
  1. `const { chromium } = await import('@playwright/test')`; launch, `newContext({ baseURL })`, page, CDP session: `WebAuthn.enable`, `addVirtualAuthenticator` (same options as `attachAuthenticator`), then `WebAuthn.addCredential({ authenticatorId, credential: { credentialId: credential().credentialId /* CDP wants base64 — convert base64url→base64 */, isResidentCredential: true, rpId: 'foerier.app', privateKey: credential().privateKey, userHandle: process.env['E2E_USER_HANDLE'] /* base64 */, signCount: monotonicSignCount() } })`.
  2. `page.goto('/signin')`, click the one sign-in button (read `test/e2e/auth.spec.ts` "signing in again" for the exact selector), wait for the Depot heading.
  3. Read the token from IndexedDB: `page.evaluate` opening `foerier`, store `AUTH_STORE`'s `'session'` key (read `app/src/auth/sessionStore.ts` and `app/src/db.ts` for the store name and record shape) → `mask(token)`; `process.env['E2E_DEVICE_TOKEN'] = token`.
  4. `assertTripwire(await resetHousehold(API, token))`.
  5. `await context.storageState({ path: STORAGE_STATE, indexedDB: true })`; close the browser.
  Doc comment: spec §5.1 point 4 — why this is `globalSetup` and not a test (the mask must reach the step's stdout).

- [ ] **Step 3: `playwright.config.ts`.** Keep the `chromium` project for local; add `...(local ? {} : { globalSetup: './test/e2e/globalSetup.production.ts', workers: 1, use: { …, trace: 'off' }, grep: /@production/, reporter: 'list' })`. `reporter: 'list'` in production — no HTML report is written, so none can be uploaded (spec §5.1 point 3). Keep `retries: 2`. Update the file's doc comment (the "Once the deployment pipeline exists" paragraph is now true).

- [ ] **Step 4: Tag and rewire the specs.** `depot.spec.ts`: import `test` from `./quartermaster` instead of `@playwright/test`; title becomes `'gear recorded offline reaches the depot, survives a reload, and syncs @production'`; replace the `mintInvite`/`attachAuthenticator`/`joinAs`/"Open the depot" lines with `const { page, context } = quartermaster` from the fixture args. `shell.spec.ts`: append ` @production` to its three titles (they take no fixture). Add `test/e2e/.auth/` to `.gitignore` with a comment (it holds a live Device token).

- [ ] **Step 5: Run locally** `npm run test:e2e` → all existing specs PASS (the fixture's local path is behaviour-preserving). Then the production project against a local stack (Landing conditions §L2) → depot + shell specs PASS, `auth.spec.ts`/`deviceLink.spec.ts` not run.

- [ ] **Step 6: Commit** — "Tier 5: a production project that signs in from a seeded credential and resets first".

---

### Task 8: The one-time capture script

**Files:**
- Create: `test/e2e/captureCredential.ts`

**Interfaces:**
- Consumes: `attachAuthenticator`, `joinAs`.

- [ ] **Step 1: Write it.** Usage: `PLAYWRIGHT_BASE_URL=https://app.foerier.app node test/e2e/captureCredential.ts '<join secret>'`. Launches headed chromium, `attachAuthenticator`, `joinAs(page, secret, 'CI')`, then `cdp.send('WebAuthn.getCredentials', { authenticatorId })` → prints, one per line, `E2E_CREDENTIAL_ID=<base64url of credentialId>`, `E2E_PRIVATE_KEY=<privateKey as returned (base64)>`, `E2E_USER_HANDLE=<userHandle as returned>`, and reminds: store as GitHub secrets on **both** `contract` and `e2e-prod`'s environment; the laptop session this created is revoked by the first reset (spec §5). It converts `credentialId` from CDP's base64 to base64url so the same secret value works for `SoftwareAuthenticator` (base64url) and for `addCredential` (convert back in globalSetup). Doc comment: spec §5, run once, never in CI.

- [ ] **Step 2:** `npm run typecheck && npm run lint` → PASS. **Step 3: Commit** — "Add the one-time E2E credential capture".

---

### Task 9: CI wiring

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1:** In `contract`: add `permissions: {}`; `env:` with `E2E_CREDENTIAL_ID`, `E2E_PRIVATE_KEY`, `E2E_USER_HANDLE` from `secrets.*` on the `npm run test:contract` step only; pin `actions/checkout` and `actions/setup-node` **by SHA** (look up the current v4 SHAs with `gh api repos/actions/checkout/git/ref/tags/v4.2.2 --jq .object.sha` — resolve the annotated tag to a commit — and comment the tag next to each pin). Replace the stale Tier 5 comment above `contract` with the new picture.

- [ ] **Step 2:** Add `e2e-prod`:

```yaml
  # Tier 5 against production (docs/testing.md). Only specs tagged @production
  # run here; everything that needs a Maintainer script stays local. The job
  # holds the CI credential, so: pinned actions, no GITHUB_TOKEN scope, and
  # nothing — no trace, no report, no artifact — is ever uploaded from it.
  e2e-prod:
    needs: [changes, contract]
    if: github.event_name == 'push' && needs.changes.outputs.deployable == 'true'
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - uses: actions/checkout@<sha> # v4.x.y
      - uses: actions/setup-node@<sha> # v4.x.y
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env:
          PLAYWRIGHT_BASE_URL: https://app.foerier.app
          E2E_CREDENTIAL_ID: ${{ secrets.E2E_CREDENTIAL_ID }}
          E2E_PRIVATE_KEY: ${{ secrets.E2E_PRIVATE_KEY }}
          E2E_USER_HANDLE: ${{ secrets.E2E_USER_HANDLE }}
```

- [ ] **Step 3:** `npx prettier --check .github/workflows/ci.yml`; `gh workflow view` is not available offline — validate YAML with `node -e "require('yaml')"` if `yaml` resolves, else `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`.

- [ ] **Step 4: Commit** — "Run Tier 4's household suite and Tier 5's golden path after every deploy".

---

### Task 10: Docs

**Files:**
- Modify: `docs/testing.md` (Tier 4, Tier 5), `docs/auth-design.md` (§3.4, §9.1), `docs/architecture-design.md` (new §12.8), `CLAUDE.md`

- [ ] **Step 1: `testing.md`.** Tier 4: replace "Dedicated test household; each writing test cleans up in teardown" with how it actually works — one disposable Household, `POST /test/reset` at the start of every run, a Device token minted in-job from an exported credential, the tripwire. Tier 5: runs against production after deploy for `@production` specs only; reset-at-start; `workers: 1`; `trace: 'off'`; the golden path is currently "sign in → add gear offline → sync" and grows with S6–S10.

- [ ] **Step 2: `auth-design.md`.** §3.4: one sentence — `--disposable` marks a Household `POST /test/reset` may wipe; only ever set on the E2E Household. §9.1: after the table, a paragraph: `POST /test/reset` exists, is mounted only with `E2E_HOUSEHOLD_ID`, is not part of the auth surface, and does not amend §3.4 — link the spec.

- [ ] **Step 3: `architecture-design.md` §12.8 "Consequences of Tier 4 and 5 against production".** Five short paragraphs: the route and its three gates; the migration numbering lesson (spec §12); "a token never crosses a job"; the tripwire; the `@production` subset and why every other spec is local-only.

- [ ] **Step 4: `CLAUDE.md`.** In "Current status", one paragraph after the S3.5 block: Tier 4's household suite and Tier 5's `@production` specs run against the box after every deploy; the reset route and its gates; where the credential lives; that `admin:bootstrap --disposable` exists. Keep the Radix-conversion paragraph as "the next slice".

- [ ] **Step 5:** `npx prettier --write` on each; `npm run format:check`. **Commit** — "Document Tier 4 and 5 against production".

---

## Landing conditions (by hand — not tasks for a subagent)

The spec makes three things conditions of retiring it. None can run from CI or from a subagent; they are the maintainer's.

**L1 — prove Tier 4 locally** (also Task 6 step 4). In one terminal: `docker compose -f docker-compose.dev.yml up -d`, `npm run admin:bootstrap -- --disposable --name "E2E"` against `foerier_dev`, note the id and the join link; `E2E_HOUSEHOLD_ID=<id> npm run dev --workspace api`. Capture a credential against `http://localhost:5173` (Task 8's script with `PLAYWRIGHT_BASE_URL=http://localhost:5173` — the RP id is `localhost` there; `signIn.ts` and `globalSetup` take `origin`/`rpId` from `PLAYWRIGHT_BASE_URL`, so make sure Task 6 and 7 read them from the URL rather than hard-coding production). Then `CONTRACT_API_URL=http://localhost:8080 E2E_CREDENTIAL_ID=… E2E_PRIVATE_KEY=… npm run test:contract`.

**L2 — prove Tier 5's production project locally**: same stack, `PLAYWRIGHT_BASE_URL=http://localhost:4173 PLAYWRIGHT_API_URL=http://localhost:8080 E2E_*=… npm run test:e2e` after `npm run build --workspace app && npm run preview --workspace app -- --port 4173`.

**L3 — on the box** (spec §5, §9.3): `node dist/bootstrap.js --disposable --name "E2E"` in the api container; set `E2E_HOUSEHOLD_ID` in the infra repo's compose file; capture against `https://app.foerier.app`; store the three secrets; **rehearse §9.3 once** — `DELETE FROM household WHERE id = '<old>'`, re-bootstrap, re-capture, update the secrets and the env; and **prove the mask fires once** (spec §5.1 point 5) with a throwaway branch whose contract test deliberately asserts on the `login/verify` body, then inspect the log for `***`.
