# S5 — In-app Invites and the Logins list: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship story 28 — a Quartermaster issues a join Invite for any Person recorded in the Household from inside the app, sees who holds a Login, and revokes one — so the second Quartermaster is arranged between the household, not by whoever runs the server.

**Architecture:** One migration (`login` uniqueness becomes partial), two new endpoints (`GET · DELETE /auth/logins`), three widened ones (`POST · GET · DELETE /auth/invites`), one new `ui/` primitive (`ExpiryChip`), one screen generalised (`DeviceLink` → `InviteIssued`, boards §14's "one screen for both purposes") and one screen finished (`People` → People & logins). **No op types. `shared/` is untouched.**

**Tech Stack:** TypeScript · Hono · Kysely · Postgres · React 19 · wouter · Zustand · CSS Modules · Radix (`ui/`'s `Confirm`) · Vitest · Testing Library · Playwright

**Spec:** [`docs/specs/2026-08-29-in-app-invites-and-logins.md`](2026-08-29-in-app-invites-and-logins.md) — read it alongside this plan. Where they disagree, **the spec wins**; where the spec and `docs/design/*.dc.html` disagree, **the boards win**, except at the three points the spec's §6 names and argues.

## Global Constraints

- **Relative imports in `api/` need an explicit `.ts` extension.** Node's ESM resolver does not guess, and `node src/…` runs the dev server, the migration CLI and the bootstrap script. **`app/` and `ui/` are the exception** — Vite resolves, so no extension there.
- **Every handler takes `household_id` from `AuthContext`, never from a body, a query string or a header** ([auth-design §9.3](../auth-design.md)). This is the property `householdIsolation.test.ts` exists to protect.
- **Precise `400`s on these routes, never the vague `401`.** §9.4's vagueness protects the *unauthenticated* redemption endpoints. These callers are already inside the Household and can already list its People, so there is nothing to enumerate. The existing `unsupported_purpose` on `POST /auth/invites` is the precedent to follow. `AuthError` still means `401` — do not throw it for a validation failure.
- **A `DELETE` of an id that matches nothing returns `204`, and so does a non-UUID.** "Not yours", "does not exist" and "not even a UUID" are one answer. `DELETE /auth/invites/:id` already sets this convention.
- **The Invite secret is never stored, never logged, never returned by a list.** It exists in the `POST` response and in the link, once ([auth-design §3.1](../auth-design.md)).
- **Never log tokens, token hashes, Invite secrets, challenges or public keys** (§9.4).
- **Vocabulary is law.** Household · Person · Quartermaster · Login · Passkey · Device · Invite (a **join invite** or a **device link**) · Maintainer. Never "user", "account" (except the tab name), "profile", "log in/out", "admin", or "registration". Verbs: *sign in / sign out*, *join*, *invite*, *revoke*, *add a passkey*, *issue a device link*.
- **A media query decides which elements *exist*; a container query decides how what exists *lays out*** ([frontend-design §3.2](../frontend-design.md)).
- **`ui/` never imports the store** ([frontend-design §5](../frontend-design.md)). Props in, callbacks out.
- **Mounted is open.** `Sheet` and `Confirm` have no `open` prop — a caller writes `{open && <Confirm …/>}` ([Radix conversion spec](2026-08-29-radix-conversion.md) §3).
- **A picker dismisses on the scrim; a decision does not.** Revoking a Login is a decision → `Confirm`. Revoking an Invite kills a link and never data → a plain button, no confirm.
- **Tier 0 runs on every commit** (pre-commit: `npm run check:workspaces`, `tsc --noEmit` across workspaces, ESLint, Prettier). A commit that fails it is not a commit.
- **Working in a git worktree: run `npm ci` in it, first thing.** Without it Node's resolver walks up to the main checkout's `node_modules` and you edit one tree while testing another.
- **Known-flaky neighbour:** `api/test/server/sync.test.ts` fails nondeterministically in the full suite and passes alone. If it fails, re-run it alone to confirm the known flake.
- **Commands.** `npm test -w @foerier/api` (Tier 2s needs Postgres up: `docker compose -f docker-compose.dev.yml up -d`), `npm test -w @foerier/app`, `npm test -w @foerier/ui`, `npm test` (all), `npm run typecheck`, `npx playwright test` (Tier 5).

---

## File Structure

**`api/` — the server**

| Path | Responsibility |
| --- | --- |
| `api/migrations/0006_login_reinvite.ts` | **Create**: the plain unique constraint becomes a partial unique index |
| `api/src/db/migrations.ts` | Modify: register `0006_login_reinvite` |
| `api/src/auth/service.ts` | Modify: `listLogins`, `revokeLogin`, `issueJoinInvite`, `issueDeviceLinkFor`; `listInvites` + `revokeInvite` scope by purpose |
| `api/src/auth/routes.ts` | Modify: `GET · DELETE /logins`; `POST /invites` takes `person_id`; `GET /invites` returns `person_id` |

**`api/` tests**

| Path | Responsibility |
| --- | --- |
| `api/test/server/logins.test.ts` | **Create**: slot #14 — list, revoke, self-revoke, the `401` at next request |
| `api/test/server/invites.test.ts` | **Create**: slot #15 — join issuance, single-use, expiry, purpose-scoped list/revoke |
| `api/test/server/migrations.test.ts` | Modify: a revoked Person can hold a Login again |
| `api/test/server/householdIsolation.test.ts` | Modify: two rows for the two new routes |
| `test/contract/deployment.test.ts` | Modify: one case — `GET /auth/logins` answers `200` on the box |

**`ui/` — the primitive**

| Path | Responsibility |
| --- | --- |
| `ui/src/ExpiryChip.tsx` (+ `.module.css`, `.test.tsx`) | **Create**: `N d` / `N h` / `N min`, urgency from raw ms, owns its tick |
| `ui/src/index.ts` | Modify: the export |

**`app/` — the screens**

| Path | Responsibility |
| --- | --- |
| `app/src/auth/api.ts` | Modify: `listLogins`, `revokeLogin`, `issueJoinInvite`, `issueDeviceLinkFor`; `listInvites` typing |
| `app/src/screens/InviteIssued.tsx` (+ `.module.css`, `.test.tsx`) | **Renamed** from `DeviceLink.*`: three entry points, one screen |
| `app/src/screens/People.tsx` (+ `.module.css`, `.test.tsx`) | Modify: the login half — circles, meta, right column, count clause, revoke confirm, offline fallback |
| `app/src/screens/Account.tsx` | Modify: `PEOPLE` → `PEOPLE & LOGINS`; thread `api` + `token` into the inline `People` |
| `app/src/App.tsx` | Modify: two new routes; `api` + `token` into `People` |

**Tier 5**

| Path | Responsibility |
| --- | --- |
| `test/e2e/invite.spec.ts` | **Create**: in-app join, **untagged** — never `@production` |

**Docs**

| Path | Responsibility |
| --- | --- |
| `docs/auth-design.md` | §9.1 caveat, §9.2 partial index, §13 slice 2 landed |
| `docs/architecture-design.md` | §8.3's S5 entry; new §12.11 |
| `docs/design/README.md` | §13 debts discharged + two departures; §14 the third entry point |
| `docs/testing.md` | UUID registry slots #14 and #15 |
| `CLAUDE.md` | S5 status; S6 next |

---

## Task 1: The migration that makes re-inviting possible

**Files:**
- Create: `api/migrations/0006_login_reinvite.ts`
- Modify: `api/src/db/migrations.ts:1-27`
- Test: `api/test/server/migrations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `login` table on which `(household_id, person_id)` is unique **only among rows with `disabled_at is null`**. Every later task that disables a Login depends on this.

- [ ] **Step 1: Write the failing test**

Append to `api/test/server/migrations.test.ts`, inside its existing top-level `describe`. Use the file's existing household constant (slot #4) and its `db` handle; follow the surrounding style for how rows are inserted.

```ts
  /**
   * The defect `0006_login_reinvite` exists for. A revoked Login keeps its
   * row — deleting it would take its Passkeys and Devices with it — so a
   * plain unique constraint on (household_id, person_id) would mean a
   * revoked Person can never hold a Login again. Story 28 says "at most one
   * Login", not "at most one ever".
   */
  it('lets a Person hold a new Login after the old one is disabled', async () => {
    const personId = '0f000004-0000-4000-8000-0000000040f1'

    await db
      .insertInto('login')
      .values({
        id: '0f000004-0000-4000-8000-0000000040f2',
        household_id: HOUSEHOLD_A,
        person_id: personId,
        disabled_at: new Date(Date.UTC(2026, 7, 25, 9, 0, 0)),
      })
      .execute()

    await expect(
      db
        .insertInto('login')
        .values({
          id: '0f000004-0000-4000-8000-0000000040f3',
          household_id: HOUSEHOLD_A,
          person_id: personId,
        })
        .execute(),
    ).resolves.toBeDefined()
  })

  it('still refuses two ACTIVE Logins for one Person', async () => {
    const personId = '0f000004-0000-4000-8000-0000000040f4'

    await db
      .insertInto('login')
      .values({
        id: '0f000004-0000-4000-8000-0000000040f5',
        household_id: HOUSEHOLD_A,
        person_id: personId,
      })
      .execute()

    await expect(
      db
        .insertInto('login')
        .values({
          id: '0f000004-0000-4000-8000-0000000040f6',
          household_id: HOUSEHOLD_A,
          person_id: personId,
        })
        .execute(),
    ).rejects.toThrow()
  })
```

If `migrations.test.ts`'s household constant is named differently, use the name it actually has — read the file first.

- [ ] **Step 2: Run it and watch the first case fail**

```bash
docker compose -f docker-compose.dev.yml up -d
npm test -w @foerier/api -- migrations
```

Expected: `lets a Person hold a new Login after the old one is disabled` FAILS with a unique-violation error naming `login_household_person_unique`. The second case passes already.

- [ ] **Step 3: Write the migration**

Create `api/migrations/0006_login_reinvite.ts`. Read `0004_device_links.ts` first for the house style of an additive migration.

```ts
import { type Kysely, sql } from 'kysely'

/**
 * `login_household_person_unique` is right while no Login can ever be
 * revoked. `DELETE /auth/logins/:id` disables one by stamping `disabled_at`
 * — the row stays, because deleting it would cascade its Passkeys and
 * Devices away and leave no record that access was ever granted — so a plain
 * unique constraint would mean a revoked Person can never hold a Login
 * again. Story 28 says "A Person may hold at most one Login", not "at most
 * one ever".
 *
 * A pure loosening: every row that satisfied the constraint satisfies the
 * index, so there is no backfill and nothing for a running older reader to
 * notice (`architecture-design.md`'s expand-contract rule).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('login')
    .dropConstraint('login_household_person_unique')
    .execute()

  await db.schema
    .createIndex('login_active_household_person_unique')
    .on('login')
    .columns(['household_id', 'person_id'])
    .unique()
    .where(sql.ref('disabled_at'), 'is', null)
    .execute()
}

/**
 * Honest only while no Household holds a disabled Login: restoring the
 * constraint over rows that include one would fail, and that is the correct
 * failure — rolling back past this migration is rolling back past
 * revocation.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('login_active_household_person_unique').execute()

  await db.schema
    .alterTable('login')
    .addUniqueConstraint('login_household_person_unique', [
      'household_id',
      'person_id',
    ])
    .execute()
}
```

- [ ] **Step 4: Register it**

In `api/src/db/migrations.ts`, add the import beside the others and the entry in the map. Both lists stay in lexicographic order.

```ts
import * as m0006 from '../../migrations/0006_login_reinvite.ts'
```

```ts
  '0006_login_reinvite': m0006,
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -w @foerier/api -- migrations
```

Expected: both new cases PASS. If the first still fails, the test database is holding the old constraint — `migrations.test.ts` runs migrations itself; check that the file's setup actually migrates rather than assuming a pre-migrated database.

- [ ] **Step 6: Commit**

```bash
git add api/migrations/0006_login_reinvite.ts api/src/db/migrations.ts api/test/server/migrations.test.ts
git commit -m "Let a revoked Person hold a Login again"
```

---

## Task 2: `GET /auth/logins`

**Files:**
- Modify: `api/src/auth/service.ts` (add `listLogins` beside `listDevices`)
- Modify: `api/src/auth/routes.ts` (add the route after the `/invites` block)
- Test: `api/test/server/logins.test.ts` (**create**)
- Modify: `docs/testing.md` (claim UUID registry slot #14)

**Interfaces:**
- Consumes: `AuthContext` (`{ deviceId, loginId, householdId, personId }`) from `api/src/auth/service.ts:51`.
- Produces:
  ```ts
  listLogins(context: AuthContext): Promise<Array<{
    id: string
    personId: string
    deviceCount: number
    lastSeenAt: Date | null
  }>>
  ```
  and over the wire `GET /api/v1/auth/logins` → `{ logins: [{ id, person_id, device_count, last_seen_at }] }`, `last_seen_at` an ISO string or `null`. Tasks 7 and 10 consume the wire shape.

- [ ] **Step 1: Claim the UUID slot**

In `docs/testing.md`'s registry table, add below slot #13:

```markdown
| 14 | `0f00000e-…-00000000000e` | `logins.test.ts` — the Logins list and revoking a Login |
```

- [ ] **Step 2: Write the failing test**

Create `api/test/server/logins.test.ts`. It borrows `account.test.ts`'s `signedInDevice` helper wholesale — read `api/test/server/account.test.ts:50-95` and copy the shape, changing the household constant.

```ts
import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { systemIdSource } from '@foerier/shared'

import type { Database } from '../../src/db/schema.ts'
import { issueDeviceToken } from '../../src/auth/tokens.ts'
import { nextExpiry } from '../../src/auth/session.ts'
import {
  createHarness,
  jsonOf,
  resetHouseholds,
  seedHousehold,
  type Harness,
} from './harness.ts'

/**
 * Tier 2s — `GET /auth/logins` and `DELETE /auth/logins/:id` (story 28).
 *
 * UUID registry slot #14 (`docs/testing.md`).
 */
const HOUSEHOLD = '0f00000e-0000-4000-8000-00000000000e'

interface LoginsBody {
  logins: Array<{
    id: string
    person_id: string
    device_count: number
    last_seen_at: string | null
  }>
}

describe('logins', () => {
  let h: Harness
  let db: Kysely<Database>

  beforeAll(async () => {
    h = await createHarness()
    db = h.db
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await resetHouseholds(db, [HOUSEHOLD])
    await seedHousehold(db, { id: HOUSEHOLD, name: 'Veldkamp' })
    h.clock.set(Date.UTC(2026, 7, 25, 9, 0, 0))
  })

  /** A Login with no Device at all — the state the boards do not draw. */
  async function seedLogin(): Promise<{ loginId: string; personId: string }> {
    const loginId = systemIdSource.next()
    const personId = systemIdSource.next()
    await db
      .insertInto('login')
      .values({ id: loginId, household_id: HOUSEHOLD, person_id: personId })
      .execute()
    return { loginId, personId }
  }

  /** A Device on an existing Login, or on a fresh one. */
  async function signedInDevice(
    options: { sameLoginAs?: { loginId: string }; lastSeenAt?: Date } = {},
  ): Promise<{ token: string; loginId: string; deviceId: string }> {
    const deviceId = systemIdSource.next()
    const { token, tokenHash } = issueDeviceToken()

    const loginId =
      options.sameLoginAs?.loginId ?? (await seedLogin()).loginId

    await db
      .insertInto('device')
      .values({
        id: deviceId,
        login_id: loginId,
        household_id: HOUSEHOLD,
        token_hash: tokenHash,
        label: 'Firefox on Android',
        last_seen_at: options.lastSeenAt ?? new Date(h.clock.now()),
        expires_at: nextExpiry(h.clock),
      })
      .execute()

    return { token, loginId, deviceId }
  }

  function get(path: string, token: string) {
    return h.app.request(`/api/v1${path}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  }

  it('counts only admissible Devices and reports the newest last seen', async () => {
    const older = new Date(Date.UTC(2026, 7, 20, 19, 4, 0))
    const newer = new Date(Date.UTC(2026, 7, 24, 8, 30, 0))

    const first = await signedInDevice({ lastSeenAt: older })
    await signedInDevice({ sameLoginAs: first, lastSeenAt: newer })

    // Revoked, so it must not be counted and must not set `last_seen_at`.
    const revoked = await signedInDevice({
      sameLoginAs: first,
      lastSeenAt: new Date(Date.UTC(2026, 7, 25, 8, 0, 0)),
    })
    await db
      .updateTable('device')
      .set({ revoked_at: new Date(h.clock.now()) })
      .where('id', '=', revoked.deviceId)
      .execute()

    const res = await get('/auth/logins', first.token)
    expect(res.status).toBe(200)

    const { logins } = await jsonOf<LoginsBody>(res)
    const mine = logins.find((row) => row.id === first.loginId)
    expect(mine).toMatchObject({
      device_count: 2,
      last_seen_at: newer.toISOString(),
    })
  })

  it('reports a Login with no Device as zero and null', async () => {
    const caller = await signedInDevice()
    const lonely = await seedLogin()

    const { logins } = await jsonOf<LoginsBody>(
      await get('/auth/logins', caller.token),
    )

    expect(logins.find((row) => row.id === lonely.loginId)).toMatchObject({
      person_id: lonely.personId,
      device_count: 0,
      last_seen_at: null,
    })
  })

  it('omits a disabled Login', async () => {
    const caller = await signedInDevice()
    const gone = await seedLogin()
    await db
      .updateTable('login')
      .set({ disabled_at: new Date(h.clock.now()) })
      .where('id', '=', gone.loginId)
      .execute()

    const { logins } = await jsonOf<LoginsBody>(
      await get('/auth/logins', caller.token),
    )

    expect(logins.map((row) => row.id)).not.toContain(gone.loginId)
  })

  it('refuses an unauthenticated caller', async () => {
    const res = await h.app.request('/api/v1/auth/logins')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npm test -w @foerier/api -- logins
```

Expected: FAIL — `404` where `200` was expected, because the route does not exist.

- [ ] **Step 4: Add `listLogins` to the service**

In `api/src/auth/service.ts`, immediately before `listDevices`, add:

```ts
    /**
     * Which People in this Household hold a Login (story 28).
     *
     * **Active Logins only.** A disabled Login is not a fact the screen has
     * any use for: the Person reads `NO LOGIN`, and that is true, because
     * they cannot sign in.
     *
     * `deviceCount` counts Devices on exactly the predicate the middleware
     * admits a request on — neither revoked nor expired — so the number on
     * screen and the number that can actually reach the server are the same
     * number. `lastSeenAt` is the newest across those, `null` when there are
     * none.
     *
     * Returns `person_id` and never a name: the server has never folded an
     * op and does not start here (`auth-design.md` §2.1).
     */
    async listLogins(context: AuthContext): Promise<
      Array<{
        id: string
        personId: string
        deviceCount: number
        lastSeenAt: Date | null
      }>
    > {
      const now = new Date(clock.now())

      const rows = await db
        .selectFrom('login')
        .leftJoin('device', (join) =>
          join
            .onRef('device.login_id', '=', 'login.id')
            .on('device.revoked_at', 'is', null)
            .on('device.expires_at', '>', now),
        )
        .select(({ fn }) => [
          'login.id as id',
          'login.person_id as person_id',
          fn.count<number>('device.id').as('device_count'),
          fn.max('device.last_seen_at').as('last_seen_at'),
        ])
        .where('login.household_id', '=', context.householdId)
        .where('login.disabled_at', 'is', null)
        .groupBy(['login.id', 'login.person_id'])
        .execute()

      return rows.map((row) => ({
        id: row.id,
        personId: row.person_id,
        // `count` reaches the driver as a string on `bigint`; see
        // `db/index.ts`. Number() rather than trusting the column type.
        deviceCount: Number(row.device_count),
        lastSeenAt: row.last_seen_at ?? null,
      }))
    },
```

- [ ] **Step 5: Add the route**

In `api/src/auth/routes.ts`, after the `auth.delete('/invites/:id', …)` block:

```ts
  auth.get('/logins', requireAuth, async (c) => {
    try {
      const logins = await service.listLogins(c.get('auth'))
      return c.json({
        logins: logins.map((login) => ({
          id: login.id,
          person_id: login.personId,
          device_count: login.deviceCount,
          last_seen_at: login.lastSeenAt?.toISOString() ?? null,
        })),
      })
    } catch (error) {
      return failure(c, error)
    }
  })
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -w @foerier/api -- logins
npm run typecheck
```

Expected: all four PASS. If `device_count` comes back as a string, the `Number()` in step 4 is what fixes it — do not change the assertion.

- [ ] **Step 7: Commit**

```bash
git add api/src/auth/service.ts api/src/auth/routes.ts api/test/server/logins.test.ts docs/testing.md
git commit -m "Say which People hold a Login"
```

---

## Task 3: `DELETE /auth/logins/:id`

**Files:**
- Modify: `api/src/auth/service.ts` (add `revokeLogin` after `listLogins`)
- Modify: `api/src/auth/routes.ts` (add the route after `GET /logins`)
- Test: `api/test/server/logins.test.ts`

**Interfaces:**
- Consumes: Task 2's `listLogins` and its test helpers.
- Produces:
  ```ts
  revokeLogin(context: AuthContext, loginId: string): Promise<void>
  ```
  and `DELETE /api/v1/auth/logins/:id` → `204`, or `400 { error: 'cannot_revoke_self' }`. Task 10 calls it.

- [ ] **Step 1: Write the failing tests**

Append inside `logins.test.ts`'s `describe`:

```ts
  function del(path: string, token: string) {
    return h.app.request(`/api/v1${path}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
  }

  it('disables the Login and its next request is 401', async () => {
    const caller = await signedInDevice()
    const target = await signedInDevice()

    expect((await del(`/auth/logins/${target.loginId}`, caller.token)).status)
      .toBe(204)

    // The middleware rejects a request whose Login is disabled, so the
    // revoked Device fails at its very next call — no waiting for expiry.
    expect((await get('/auth/me', target.token)).status).toBe(401)
  })

  it('revokes the Login’s Devices and the Invites bound to it', async () => {
    const caller = await signedInDevice()
    const target = await signedInDevice()

    const inviteId = systemIdSource.next()
    await db
      .insertInto('invite')
      .values({
        id: inviteId,
        household_id: HOUSEHOLD,
        person_id: systemIdSource.next(),
        purpose: 'device',
        secret_hash: new Uint8Array(32).fill(7),
        login_id: target.loginId,
        created_by_login: caller.loginId,
        person_recorded: true,
        expires_at: new Date(h.clock.now() + 60 * 60_000),
      })
      .execute()

    await del(`/auth/logins/${target.loginId}`, caller.token)

    const device = await db
      .selectFrom('device')
      .select('revoked_at')
      .where('id', '=', target.deviceId)
      .executeTakeFirstOrThrow()
    expect(device.revoked_at).not.toBeNull()

    const invite = await db
      .selectFrom('invite')
      .select('revoked_at')
      .where('id', '=', inviteId)
      .executeTakeFirstOrThrow()
    expect(invite.revoked_at).not.toBeNull()
  })

  /**
   * Story 28: "everything they recorded stays". True by construction — the
   * transaction touches no `op` row, and `op.device_id` carries no foreign
   * key to `device`.
   */
  it('leaves the ops that Login pushed readable', async () => {
    const caller = await signedInDevice()
    const target = await signedInDevice()

    await db
      .insertInto('op')
      .values({
        op_id: systemIdSource.next(),
        household_id: HOUSEHOLD,
        seq: 1,
        aggregate: 'gear',
        aggregate_id: systemIdSource.next(),
        type: 'gear.recorded',
        hlc: '2026-08-25T09:00:00.000Z-0000-aaaa',
        device_id: target.deviceId,
        payload: { name: 'Tarp' },
      })
      .execute()

    await del(`/auth/logins/${target.loginId}`, caller.token)

    const pulled = await get('/sync/pull?since=0', caller.token)
    expect(pulled.status).toBe(200)
    const body = await jsonOf<{ ops: Array<{ type: string }> }>(pulled)
    expect(body.ops.map((op) => op.type)).toContain('gear.recorded')
  })

  /**
   * No Login can disable itself, which is what makes "a Household never
   * reaches zero active Logins" true by construction rather than by a count.
   */
  it('refuses to revoke your own Login', async () => {
    const caller = await signedInDevice()

    const res = await del(`/auth/logins/${caller.loginId}`, caller.token)
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toMatchObject({ error: 'cannot_revoke_self' })

    expect((await get('/auth/me', caller.token)).status).toBe(200)
  })

  it('answers 204 for an unknown id and for a non-UUID', async () => {
    const caller = await signedInDevice()

    expect(
      (await del('/auth/logins/0f00000e-0000-4000-8000-0000000000ff', caller.token))
        .status,
    ).toBe(204)
    expect((await del('/auth/logins/not-a-uuid', caller.token)).status).toBe(204)
  })
```

Check `/sync/pull`'s actual query parameter name in `api/src/sync/routes.ts` before running — use whatever it is, not `since` if that is wrong. Likewise check the `op` table's required columns in `api/src/db/schema.ts` and supply exactly those.

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -w @foerier/api -- logins
```

Expected: the five new cases FAIL with `404`.

- [ ] **Step 3: Add `revokeLogin` to the service**

```ts
    /**
     * Disables another Login in this Household (story 28) — one transaction,
     * in this order:
     *
     * 1. `login.disabled_at`, guarded by `disabled_at is null` so a
     *    double-tap cannot move the timestamp.
     * 2. `revoked_at` on its Devices.
     * 3. `revoked_at` on Invites **bound to** it — a device link into a Login
     *    nobody may use is a live credential for a dead account.
     *
     * Invites that Login *created* for other People are left alone: a join
     * Invite creates a Login for somebody else, and Kees's onboarding does
     * not collapse because Els lost access.
     *
     * Step 1 alone would already lock the account out — the middleware
     * rejects a disabled Login, and `login/verify`, `device/claim` and
     * `mintDeviceLink` each check it. Steps 2 and 3 exist so the Devices
     * list and the Invite list stop *claiming* something no longer true.
     *
     * **Nothing here touches `op`.** That is how story 28's "everything they
     * recorded stays" is kept — by construction rather than by care.
     *
     * Refusing the caller's own Login is the route's job, not this one's:
     * it is a request-shape rule, and the route answers it with a `400`
     * before any work starts.
     */
    async revokeLogin(context: AuthContext, loginId: string): Promise<void> {
      const now = new Date(clock.now())

      await db.transaction().execute(async (trx) => {
        const disabled = await trx
          .updateTable('login')
          .set({ disabled_at: now })
          .where('id', '=', loginId)
          .where('household_id', '=', context.householdId)
          .where('disabled_at', 'is', null)
          .returning('id')
          .executeTakeFirst()

        // Not ours, already disabled, or no such row — all one answer, and
        // nothing further to revoke.
        if (disabled === undefined) return

        await trx
          .updateTable('device')
          .set({ revoked_at: now })
          .where('login_id', '=', loginId)
          .where('revoked_at', 'is', null)
          .execute()

        await trx
          .updateTable('invite')
          .set({ revoked_at: now })
          .where('login_id', '=', loginId)
          .where('used_at', 'is', null)
          .where('revoked_at', 'is', null)
          .execute()
      })
    },
```

- [ ] **Step 4: Add the route**

```ts
  auth.delete('/logins/:id', requireAuth, async (c) => {
    const id = c.req.param('id')
    const context = c.get('auth')

    // Checked first, and precisely: the boards give the reason ("only your
    // own row lacks them — your exit is SIGN OUT"), and the consequence is
    // stronger than a screen rule. Since no Login can disable itself, a
    // Household never reaches zero active Logins by any single act.
    if (id === context.loginId) {
      return c.json({ error: 'cannot_revoke_self' }, 400)
    }

    // 204 whether or not a row matched — same convention as
    // `DELETE /invites/:id`.
    if (!isUuid(id)) return c.body(null, 204)

    try {
      await service.revokeLogin(context, id)
      return c.body(null, 204)
    } catch (error) {
      return failure(c, error)
    }
  })
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -w @foerier/api -- logins
npm run typecheck
```

Expected: all nine PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/auth/service.ts api/src/auth/routes.ts api/test/server/logins.test.ts
git commit -m "Revoke a Login without touching what it recorded"
```

---

## Task 4: `POST /auth/invites` learns the join purpose

**Files:**
- Modify: `api/src/auth/service.ts` (add `issueJoinInvite` and `issueDeviceLinkFor` beside `issueDeviceLink`)
- Modify: `api/src/auth/routes.ts:213-236` (the `POST /invites` handler)
- Test: `api/test/server/invites.test.ts` (**create**)
- Modify: `docs/testing.md` (claim slot #15)

**Interfaces:**
- Consumes: `insertDeviceLinkInvite` (`service.ts:157`), `inviteExpiry` (`api/src/auth/invite.ts`), `generateInviteSecret` (`api/src/auth/tokens.ts`), `AuthContext`.
- Produces:
  ```ts
  issueJoinInvite(context: AuthContext, personId: string):
    Promise<{ inviteId: string; secret: string; expiresAt: Date }>
  issueDeviceLinkFor(context: AuthContext, personId: string):
    Promise<{ inviteId: string; secret: string; expiresAt: Date }>
  ```
  Both throw `InviteRequestError` (a new exported class carrying a `code`) for the refusals. `POST /api/v1/auth/invites` accepts `{ purpose: 'join' | 'device', person_id?: string }` and answers `{ id, secret, expires_at }` or a precise `400`.

- [ ] **Step 1: Claim the UUID slot**

```markdown
| 15 | `0f00000f-…-00000000000f` | `invites.test.ts` — in-app join Invites and purpose-scoped list/revoke |
```

- [ ] **Step 2: Write the failing tests**

Create `api/test/server/invites.test.ts` with the same `beforeAll` / `beforeEach` / `signedInDevice` scaffolding as `logins.test.ts` (copy it; the two files own different Households and must not share state), with:

```ts
const HOUSEHOLD = '0f00000f-0000-4000-8000-00000000000f'
```

and these cases:

```ts
  function post(path: string, token: string, body: unknown) {
    return h.app.request(`/api/v1${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
  }

  it('mints a join Invite for a recorded Person', async () => {
    const caller = await signedInDevice()
    const personId = systemIdSource.next()

    const res = await post('/auth/invites', caller.token, {
      purpose: 'join',
      person_id: personId,
    })
    expect(res.status).toBe(200)

    const body = await jsonOf<{ id: string; secret: string; expires_at: string }>(res)
    expect(body.secret).toHaveLength(43)

    const row = await db
      .selectFrom('invite')
      .selectAll()
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow()

    expect(row.purpose).toBe('join')
    expect(row.person_id).toBe(personId)
    expect(row.login_id).toBeNull()
    expect(row.created_by_login).toBe(caller.loginId)
    // Stated by the minting code: the client picked this Person off the
    // folded list, so the joiner does not name themselves (§12.7).
    expect(row.person_recorded).toBe(true)
    // 7 days (auth-design §3.1).
    expect(row.expires_at.getTime() - h.clock.now()).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('is single-use — the second redemption of one secret fails', async () => {
    const caller = await signedInDevice()
    const personId = systemIdSource.next()
    const { secret } = await jsonOf<{ secret: string }>(
      await post('/auth/invites', caller.token, {
        purpose: 'join',
        person_id: personId,
      }),
    )

    const first = await h.app.request('/api/v1/auth/device/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    expect(first.status).toBe(200)

    const second = await h.app.request('/api/v1/auth/device/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    expect(second.status).toBe(401)
  })

  it('expires after seven days', async () => {
    const caller = await signedInDevice()
    const { secret } = await jsonOf<{ secret: string }>(
      await post('/auth/invites', caller.token, {
        purpose: 'join',
        person_id: systemIdSource.next(),
      }),
    )

    h.clock.advance(7 * 24 * 60 * 60 * 1000 + 1)

    const res = await h.app.request('/api/v1/auth/device/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    expect(res.status).toBe(401)
  })

  it('refuses a join Invite for a Person who already holds a Login', async () => {
    const caller = await signedInDevice()
    const holder = await signedInDevice()
    const person = await db
      .selectFrom('login')
      .select('person_id')
      .where('id', '=', holder.loginId)
      .executeTakeFirstOrThrow()

    const res = await post('/auth/invites', caller.token, {
      purpose: 'join',
      person_id: person.person_id,
    })
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toMatchObject({ error: 'person_has_login' })
  })

  it('revokes the Person’s previous outstanding join Invite', async () => {
    const caller = await signedInDevice()
    const personId = systemIdSource.next()

    const first = await jsonOf<{ id: string }>(
      await post('/auth/invites', caller.token, {
        purpose: 'join',
        person_id: personId,
      }),
    )
    await post('/auth/invites', caller.token, {
      purpose: 'join',
      person_id: personId,
    })

    const row = await db
      .selectFrom('invite')
      .select('revoked_at')
      .where('id', '=', first.id)
      .executeTakeFirstOrThrow()
    expect(row.revoked_at).not.toBeNull()
  })

  it('refuses a join Invite with no person_id', async () => {
    const caller = await signedInDevice()

    const res = await post('/auth/invites', caller.token, { purpose: 'join' })
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toMatchObject({ error: 'person_id_required' })
  })

  it('mints a device link against another Person’s Login', async () => {
    const caller = await signedInDevice()
    const other = await signedInDevice()
    const person = await db
      .selectFrom('login')
      .select('person_id')
      .where('id', '=', other.loginId)
      .executeTakeFirstOrThrow()

    const body = await jsonOf<{ id: string }>(
      await post('/auth/invites', caller.token, {
        purpose: 'device',
        person_id: person.person_id,
      }),
    )

    const row = await db
      .selectFrom('invite')
      .selectAll()
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow()

    expect(row.purpose).toBe('device')
    expect(row.login_id).toBe(other.loginId)
    expect(row.created_by_login).toBe(caller.loginId)
  })

  it('refuses a device link for a Person who holds no Login', async () => {
    const caller = await signedInDevice()

    const res = await post('/auth/invites', caller.token, {
      purpose: 'device',
      person_id: systemIdSource.next(),
    })
    expect(res.status).toBe(400)
    expect(await jsonOf(res)).toMatchObject({ error: 'no_login_for_person' })
  })

  it('still mints the caller’s own device link with no person_id', async () => {
    const caller = await signedInDevice()

    const body = await jsonOf<{ id: string }>(
      await post('/auth/invites', caller.token, { purpose: 'device' }),
    )

    const row = await db
      .selectFrom('invite')
      .select('login_id')
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow()
    expect(row.login_id).toBe(caller.loginId)
  })
```

Check `h.clock`'s advance method name in `shared/testUtils`'s `fakeClock` before writing `advance` — use whatever it exposes.

- [ ] **Step 3: Run to verify they fail**

```bash
npm test -w @foerier/api -- invites
```

Expected: every join case FAILS with `400 unsupported_purpose`; the device-with-person_id cases fail because `person_id` is ignored.

- [ ] **Step 4: Add the refusal type and the two service methods**

Near `AuthError` in `api/src/auth/service.ts`, add:

```ts
/**
 * A refusal the caller can act on, as distinct from `AuthError`, which is the
 * vague `401` protecting the unauthenticated redemption endpoints. These
 * callers are already inside the Household and can already list its People,
 * so there is nothing to enumerate and precision costs nothing
 * (`auth-design.md` §9.4).
 */
export class InviteRequestError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'InviteRequestError'
    this.code = code
  }
}
```

Then, beside `issueDeviceLink`:

```ts
    /**
     * A join Invite for a Person recorded in this Household (story 28).
     *
     * Two guards and one supersede, in one transaction:
     *
     * - an active Login for that Person is `person_has_login`. The partial
     *   index would catch it too, but only at redemption — on a stranger's
     *   phone, behind the vague `401`, which is not enforcement a
     *   Quartermaster can act on.
     * - the Person's other outstanding join Invites are revoked, which keeps
     *   `INVITE OUT` singular **by construction**. Two Quartermasters on two
     *   Devices are the only path to a second one, and one link quietly
     *   superseding the other beats two links of which the second dies at
     *   redemption for reasons nobody can see.
     *
     * `person_recorded: true` is stated here rather than derived, which is
     * the rule `invite.person_recorded` exists to keep: the client picked
     * this Person off the folded list, so the joiner does not name
     * themselves. The server has not folded an op and cannot check it.
     */
    async issueJoinInvite(
      context: AuthContext,
      personId: string,
    ): Promise<{ inviteId: string; secret: string; expiresAt: Date }> {
      const inviteId = ids.next()
      const { secret, secretHash } = generateInviteSecret()
      const expiresAt = inviteExpiry('join', clock)
      const now = new Date(clock.now())

      await db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('login')
          .select('id')
          .where('household_id', '=', context.householdId)
          .where('person_id', '=', personId)
          .where('disabled_at', 'is', null)
          .executeTakeFirst()

        if (existing !== undefined) {
          throw new InviteRequestError('person_has_login')
        }

        await trx
          .updateTable('invite')
          .set({ revoked_at: now })
          .where('household_id', '=', context.householdId)
          .where('person_id', '=', personId)
          .where('purpose', '=', 'join')
          .where('used_at', 'is', null)
          .where('revoked_at', 'is', null)
          .execute()

        await trx
          .insertInto('invite')
          .values({
            id: inviteId,
            household_id: context.householdId,
            person_id: personId,
            purpose: 'join',
            secret_hash: secretHash,
            login_id: null,
            created_by_login: context.loginId,
            person_recorded: true,
            expires_at: expiresAt,
          })
          .execute()
      })

      return { inviteId, secret, expiresAt }
    },

    /**
     * A device link against **another Person's** Login.
     *
     * `auth-design.md` §3.1 has always said a device Invite may be issued by
     * "that Login, **or any Quartermaster of the Household**"; this is the
     * route that finally means it. The Login is resolved from the Person
     * inside this Household — never taken from the body — so §9.3's tenancy
     * rule applies unrelaxed.
     */
    async issueDeviceLinkFor(
      context: AuthContext,
      personId: string,
    ): Promise<{ inviteId: string; secret: string; expiresAt: Date }> {
      const login = await db
        .selectFrom('login')
        .select('id')
        .where('household_id', '=', context.householdId)
        .where('person_id', '=', personId)
        .where('disabled_at', 'is', null)
        .executeTakeFirst()

      if (login === undefined) {
        throw new InviteRequestError('no_login_for_person')
      }

      return insertDeviceLinkInvite({
        householdId: context.householdId,
        personId,
        loginId: login.id,
        createdByLogin: context.loginId,
      })
    },
```

- [ ] **Step 5: Rewrite the `POST /invites` handler**

Replace `api/src/auth/routes.ts:213-236` with:

```ts
  auth.post('/invites', requireAuth, async (c) => {
    const body = await readJson<{ purpose: unknown; person_id: unknown }>(c)
    const context = c.get('auth')
    const personId =
      typeof body.person_id === 'string' && isUuid(body.person_id)
        ? body.person_id
        : null

    // Precise 400s throughout: there is no secret to protect here and no
    // enumeration surface, so being vague would cost the caller and buy
    // nothing (`auth-design.md` §9.4 governs the unauthenticated routes).
    try {
      if (body.purpose === 'join') {
        if (personId === null) {
          return c.json({ error: 'person_id_required' }, 400)
        }
        const issued = await service.issueJoinInvite(context, personId)
        return c.json({
          id: issued.inviteId,
          secret: issued.secret,
          expires_at: issued.expiresAt.toISOString(),
        })
      }

      if (body.purpose === 'device') {
        const issued =
          personId === null || personId === context.personId
            ? await service.issueDeviceLink(context)
            : await service.issueDeviceLinkFor(context, personId)
        return c.json({
          id: issued.inviteId,
          secret: issued.secret,
          expires_at: issued.expiresAt.toISOString(),
        })
      }

      return c.json({ error: 'unsupported_purpose' }, 400)
    } catch (error) {
      if (error instanceof InviteRequestError) {
        return c.json({ error: error.code }, 400)
      }
      return failure(c, error)
    }
  })
```

Import `InviteRequestError` alongside the existing `AuthError` import.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -w @foerier/api -- invites
npm test -w @foerier/api -- account
npm run typecheck
```

Expected: the new suite PASSES and `account.test.ts` still passes — its `purpose: 'device'` case goes down the unchanged branch.

- [ ] **Step 7: Commit**

```bash
git add api/src/auth/service.ts api/src/auth/routes.ts api/test/server/invites.test.ts docs/testing.md
git commit -m "Issue a join Invite from inside the app"
```

---

## Task 5: Listing and revoking scope by purpose

**Files:**
- Modify: `api/src/auth/service.ts` (`listInvites`, `revokeInvite`)
- Modify: `api/src/auth/routes.ts` (the `GET /invites` response)
- Test: `api/test/server/invites.test.ts`

**Interfaces:**
- Consumes: Task 4's suite scaffolding.
- Produces: `listInvites` returns `Array<{ id; purpose; personId; expiresAt }>`; over the wire `GET /auth/invites` → `{ invites: [{ id, purpose, person_id, expires_at }] }`. Tasks 7 and 10 consume it.

- [ ] **Step 1: Write the failing tests**

Append to `invites.test.ts`:

```ts
  /**
   * The rule, in one sentence: a join Invite creates a Login — that is
   * Household business — and a device Invite is a credential for one Login,
   * so it stays with its issuer (`auth-design.md` §3.1's own "listable by
   * the issuer", kept for the purpose it was written about and widened for
   * the one it was not).
   */
  it('shows a join Invite to a second Login in the Household', async () => {
    const issuer = await signedInDevice()
    const other = await signedInDevice()
    const personId = systemIdSource.next()

    const minted = await jsonOf<{ id: string }>(
      await post('/auth/invites', issuer.token, {
        purpose: 'join',
        person_id: personId,
      }),
    )

    const { invites } = await jsonOf<{
      invites: Array<{ id: string; purpose: string; person_id: string }>
    }>(await get('/auth/invites', other.token))

    expect(invites).toContainEqual(
      expect.objectContaining({
        id: minted.id,
        purpose: 'join',
        person_id: personId,
      }),
    )
  })

  it('lets a second Login revoke a join Invite it did not issue', async () => {
    const issuer = await signedInDevice()
    const other = await signedInDevice()

    const minted = await jsonOf<{ id: string }>(
      await post('/auth/invites', issuer.token, {
        purpose: 'join',
        person_id: systemIdSource.next(),
      }),
    )

    expect((await del(`/auth/invites/${minted.id}`, other.token)).status).toBe(204)

    const row = await db
      .selectFrom('invite')
      .select('revoked_at')
      .where('id', '=', minted.id)
      .executeTakeFirstOrThrow()
    expect(row.revoked_at).not.toBeNull()
  })

  it('hides another Login’s device link, and refuses to revoke it', async () => {
    const issuer = await signedInDevice()
    const other = await signedInDevice()

    const minted = await jsonOf<{ id: string }>(
      await post('/auth/invites', issuer.token, { purpose: 'device' }),
    )

    const { invites } = await jsonOf<{ invites: Array<{ id: string }> }>(
      await get('/auth/invites', other.token),
    )
    expect(invites.map((invite) => invite.id)).not.toContain(minted.id)

    // 204 either way — "not yours" and "does not exist" are one answer — but
    // the row must survive.
    expect((await del(`/auth/invites/${minted.id}`, other.token)).status).toBe(204)
    const row = await db
      .selectFrom('invite')
      .select('revoked_at')
      .where('id', '=', minted.id)
      .executeTakeFirstOrThrow()
    expect(row.revoked_at).toBeNull()
  })
```

Add the `del` and `get` helpers to this file too, matching Task 3's.

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -w @foerier/api -- invites
```

Expected: the first two FAIL (the join Invite is invisible to `other`), the third passes already.

- [ ] **Step 3: Widen both service methods**

Replace `listInvites` and `revokeInvite` in `api/src/auth/service.ts`:

```ts
    /**
     * Outstanding Invites this caller may see. Never returns the secret: it
     * exists only in the link, and the row holds a hash (§3.1).
     *
     * **Scoped by purpose, not by a flag.** A join Invite creates a Login —
     * Household business, listed on People & logins where any member may
     * revoke it, because two Quartermasters who cannot see each other's
     * invites will both issue one for Els. A device Invite is a credential
     * for one Login and stays with its issuer, which is what §3.1 says.
     */
    async listInvites(context: AuthContext): Promise<
      Array<{
        id: string
        purpose: InvitePurpose
        personId: string
        expiresAt: Date
      }>
    > {
      const rows = await db
        .selectFrom('invite')
        .select(['id', 'purpose', 'person_id', 'expires_at'])
        .where('household_id', '=', context.householdId)
        .where((eb) =>
          eb.or([
            eb('purpose', '=', 'join'),
            eb('created_by_login', '=', context.loginId),
          ]),
        )
        .where('used_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', new Date(clock.now()))
        .orderBy('expires_at')
        .execute()

      return rows.map((row) => ({
        id: row.id,
        purpose: row.purpose,
        personId: row.person_id,
        expiresAt: row.expires_at,
      }))
    },

    /** Kills the link, never any data. Same purpose scope as `listInvites`. */
    async revokeInvite(context: AuthContext, inviteId: string): Promise<void> {
      await db
        .updateTable('invite')
        .set({ revoked_at: new Date(clock.now()) })
        .where('id', '=', inviteId)
        .where('household_id', '=', context.householdId)
        .where((eb) =>
          eb.or([
            eb('purpose', '=', 'join'),
            eb('created_by_login', '=', context.loginId),
          ]),
        )
        .execute()
    },
```

- [ ] **Step 4: Return `person_id` from the route**

In `api/src/auth/routes.ts`'s `GET /invites`, add the field:

```ts
        invites: invites.map((invite) => ({
          id: invite.id,
          purpose: invite.purpose,
          person_id: invite.personId,
          expires_at: invite.expiresAt.toISOString(),
        })),
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -w @foerier/api
npm run typecheck
```

Expected: `invites`, `logins`, `account`, `deviceLink` and `auth` all PASS. (`sync.test.ts` may flake — re-run it alone.)

- [ ] **Step 6: Commit**

```bash
git add api/src/auth/service.ts api/src/auth/routes.ts api/test/server/invites.test.ts
git commit -m "Make a join Invite Household business and a device link its issuer's"
```

---

## Task 6: The isolation rows and the one contract case

**Files:**
- Modify: `api/test/server/householdIsolation.test.ts`
- Modify: `test/contract/deployment.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5's routes.
- Produces: nothing the app reads. This task is proof, not surface.

- [ ] **Step 1: Read the isolation test and add rows in its own shape**

Open `api/test/server/householdIsolation.test.ts` and follow whatever mechanism it already uses (a table of routes, or a case per route — do not invent a third). Add:

- `GET /auth/logins` — a token from household A must never see a Login of household B.
- `DELETE /auth/logins/:id` — a token from household A revoking a Login id belonging to household B must answer `204` **and leave that Login's `disabled_at` null**. The status is deliberately indistinguishable; the row is what proves the scoping.

- [ ] **Step 2: Run it**

```bash
npm test -w @foerier/api -- householdIsolation
```

Expected: PASS — the service scopes both queries by `context.householdId`. If either fails, that is a real tenancy bug in Task 2 or 3, not a test to relax.

- [ ] **Step 3: Add the contract case**

In `test/contract/deployment.test.ts`, beside the existing authenticated checks, add one:

```ts
  /**
   * The deployed box has S5's route. A schema fact — `0006`'s partial index —
   * is deliberately NOT checked here: proving it needs a Login minted on the
   * box, which is exactly what the Tier 4/5 spec §5 rules out.
   * `migrations.test.ts` proves it against a real Postgres instead.
   */
  it('answers GET /auth/logins with the calling Login present', async () => {
    const res = await fetch(`${API}/api/v1/auth/logins`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      logins: Array<{ id: string; person_id: string }>
    }
    expect(body.logins.length).toBeGreaterThan(0)
  })
```

Use whatever the file names its token and `API` constant — read it first. If the token is obtained per-test rather than shared, follow that pattern.

- [ ] **Step 4: Commit**

```bash
git add api/test/server/householdIsolation.test.ts test/contract/deployment.test.ts
git commit -m "Extend the tenancy proof to the two new routes"
```

---
## Task 7: The auth API client learns four calls

**Files:**
- Modify: `app/src/auth/api.ts`

**Interfaces:**
- Consumes: Tasks 2–5's wire shapes.
- Produces, on the object `createAuthApi` returns:
  ```ts
  listLogins(token: string): Promise<{ logins: LoginRow[] }>
  revokeLogin(token: string, id: string): Promise<void>
  issueJoinInvite(token: string, personId: string): Promise<IssuedInvite>
  issueDeviceLinkFor(token: string, personId: string): Promise<IssuedInvite>
  listInvites(token: string): Promise<{ invites: InviteRow[] }>   // retyped
  ```
  with
  ```ts
  export interface LoginRow {
    id: string
    person_id: string
    device_count: number
    last_seen_at: string | null
  }

  export interface InviteRow {
    id: string
    purpose: 'join' | 'device'
    person_id: string
    expires_at: string
  }
  ```
  Tasks 9 and 10 import both types and call all five.

- [ ] **Step 1: Add the two interfaces**

In `app/src/auth/api.ts`, beside `IssuedInvite`, add the `LoginRow` and `InviteRow` declarations exactly as written above. `InviteRow` replaces the inline anonymous type on `listInvites`.

- [ ] **Step 2: Add the four methods and retype the fifth**

In the object `createAuthApi` returns, replace `listInvites` and append the rest:

```ts
    listInvites: (token: string) =>
      get<{ invites: InviteRow[] }>('/auth/invites', token),

    listLogins: (token: string) =>
      get<{ logins: LoginRow[] }>('/auth/logins', token),

    /** Disables another Person's Login. Never your own — the server refuses. */
    revokeLogin: (token: string, id: string) => del(`/auth/logins/${id}`, token),

    /** A join Invite for a Person recorded in the Household (story 28). */
    issueJoinInvite: (token: string, personId: string) =>
      post<IssuedInvite>(
        '/auth/invites',
        { purpose: 'join', person_id: personId },
        token,
      ),

    /**
     * A device link against **another** Person's Login. The caller's own is
     * `issueDeviceLink` above, which sends no `person_id`.
     */
    issueDeviceLinkFor: (token: string, personId: string) =>
      post<IssuedInvite>(
        '/auth/invites',
        { purpose: 'device', person_id: personId },
        token,
      ),
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS. There is no behaviour to test here — this file is a typed transport with no logic, and the tests that matter are the screen tests in Tasks 9 and 10, which drive it with a real in-memory `fetch`.

- [ ] **Step 4: Commit**

```bash
git add app/src/auth/api.ts
git commit -m "Give the client the four calls S5's screens need"
```

---

## Task 8: `ui/ExpiryChip`

**Files:**
- Create: `ui/src/ExpiryChip.tsx`, `ui/src/ExpiryChip.module.css`, `ui/src/ExpiryChip.test.tsx`
- Modify: `ui/src/index.ts`

**Interfaces:**
- Consumes: nothing. `ui/` never imports the store.
- Produces:
  ```ts
  export interface ExpiryChipProps {
    /** ISO string or Date — when the Invite dies. */
    expiresAt: string | Date
  }
  export function ExpiryChip(props: ExpiryChipProps): JSX.Element
  ```
  Renders `EXPIRES IN 6 d` / `EXPIRES IN 3 h` / `EXPIRES IN 58 min`, with `data-urgent="true"` when under an hour. Tasks 9 and 10 both render it.

- [ ] **Step 1: Write the failing test**

Create `ui/src/ExpiryChip.test.tsx`. Read `ui/src/Chip.test.tsx` first for the file's render/setup idiom.

```tsx
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExpiryChip } from './ExpiryChip'

const NOW = Date.UTC(2026, 7, 25, 9, 0, 0)

function inMs(ms: number): string {
  return new Date(NOW + ms).toISOString()
}

describe('ExpiryChip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('floors to whole days above 48 hours', () => {
    // A fresh 7-day join Invite. The boards draw `6 d`, and a floor is right:
    // a link that says `7 d` on the day it dies is a lie in the direction
    // that costs somebody a handover.
    render(<ExpiryChip expiresAt={inMs(7 * 24 * 60 * 60_000 - 100)} />)
    expect(screen.getByText('EXPIRES IN 6 d')).toBeInTheDocument()
  })

  it('reads hours between one hour and two days', () => {
    render(<ExpiryChip expiresAt={inMs(5 * 60 * 60_000)} />)
    expect(screen.getByText('EXPIRES IN 5 h')).toBeInTheDocument()
  })

  it('reads minutes under an hour', () => {
    render(<ExpiryChip expiresAt={inMs(58 * 60_000)} />)
    expect(screen.getByText('EXPIRES IN 58 min')).toBeInTheDocument()
  })

  /**
   * The bug this component inherits a fix for. A freshly issued device link
   * has ~3,599,900 ms left, which *rounds* to a displayed "60 min" — and a
   * naive `minutes < 60` reads that as not urgent, rendering muted for the
   * first ~45 seconds of exactly the link that should always read amber.
   * Urgency is decided from the raw millisecond figure, never from what is
   * printed.
   */
  it('is urgent the instant a one-hour link is issued', () => {
    render(<ExpiryChip expiresAt={inMs(60 * 60_000 - 100)} />)
    const chip = screen.getByText(/^EXPIRES IN/)
    expect(chip).toHaveAttribute('data-urgent', 'true')
  })

  it('is not urgent with more than an hour left', () => {
    render(<ExpiryChip expiresAt={inMs(6 * 60 * 60_000)} />)
    expect(screen.getByText(/^EXPIRES IN/)).toHaveAttribute(
      'data-urgent',
      'false',
    )
  })

  it('counts down without being re-rendered by its parent', () => {
    render(<ExpiryChip expiresAt={inMs(90 * 60_000)} />)
    expect(screen.getByText('EXPIRES IN 1 h')).toBeInTheDocument()

    vi.advanceTimersByTime(31 * 60_000)
    expect(screen.getByText('EXPIRES IN 59 min')).toBeInTheDocument()
  })

  it('never counts below zero', () => {
    render(<ExpiryChip expiresAt={inMs(-60_000)} />)
    expect(screen.getByText('EXPIRES IN 0 min')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -w @foerier/ui -- ExpiryChip
```

Expected: FAIL — cannot resolve `./ExpiryChip`.

- [ ] **Step 3: Write the component**

```tsx
import { useEffect, useState } from 'react'

import styles from './ExpiryChip.module.css'

/**
 * `EXPIRES IN 6 d` · `EXPIRES IN 3 h` · `EXPIRES IN 58 min`
 * (`docs/design/README.md` §14).
 *
 * **Not a `Chip`.** `ui/Chip` is the tag-and-filter chip settled by
 * Components §04 and §06 — 36px or 32px, three appearances, a `#`-bearing
 * label somebody taps. This is §14's own separate anatomy: radius 999, 1.5px
 * stroke, mono 10/600, inert, and a *status* rather than a value. Two
 * components that share a border radius are not one component.
 *
 * Two callers, which is what moved it out of a screen's CSS module: the
 * invite card on `InviteIssued`, and the outstanding-invite row on People &
 * logins.
 */
export interface ExpiryChipProps {
  /** When the Invite dies. */
  expiresAt: string | Date
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The **displayed** string only, and nothing else may read it. `d` floors and
 * `min` rounds on purpose: a fresh 7-day Invite reads `6 d`, because a link
 * claiming `7 d` on the day it dies is a lie in the direction that costs
 * somebody a handover, while a minute's rounding either way costs nothing.
 */
function label(remainingMs: number): string {
  const remaining = Math.max(0, remainingMs)
  if (remaining >= 2 * DAY) return `${Math.floor(remaining / DAY)} d`
  if (remaining >= HOUR) return `${Math.floor(remaining / HOUR)} h`
  return `${Math.round(remaining / MINUTE)} min`
}

/**
 * Forces a re-render every 30s so the count is live at minute granularity
 * (§14). Deliberately a trigger only — it holds no time value, and the
 * component reads `Date.now()` fresh at render, so a render caused by
 * anything else is never computed against a stale "now".
 */
function useTick(intervalMs = 30_000): void {
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((count) => count + 1), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
}

export function ExpiryChip({ expiresAt }: ExpiryChipProps) {
  useTick()

  const remainingMs =
    new Date(expiresAt).getTime() - Date.now()

  // Computed from the raw figure, never from `label`'s rounded output: a
  // freshly issued one-hour link has ~3,599,900ms left, which prints as
  // "60 min", and a check on the printed number would call it not urgent for
  // the first ~45 seconds of exactly the link that must always read amber.
  const urgent = remainingMs <= HOUR

  return (
    <span className={styles['chip']} data-urgent={urgent}>
      EXPIRES IN {label(remainingMs)}
    </span>
  )
}
```

- [ ] **Step 4: Write the CSS module**

Create `ui/src/ExpiryChip.module.css`. Copy the anatomy out of `app/src/screens/DeviceLink.module.css`'s `.chip` and `.chip[data-urgent='true']` rules verbatim — they are already the board's — and use `ui/`'s own token names. §14's values: radius 999, 1.5px stroke, mono 10/600; muted `#47523F` border on `#97A08C` text; urgent `#E2A65B` on a `rgba(226,166,91,.08)` tint.

- [ ] **Step 5: Export it**

In `ui/src/index.ts`, beside the `Chip` exports:

```ts
export { ExpiryChip } from './ExpiryChip'
export type { ExpiryChipProps } from './ExpiryChip'
```

- [ ] **Step 6: Run to verify it passes**

```bash
npm test -w @foerier/ui -- ExpiryChip
npm run typecheck
```

Expected: all seven PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/ExpiryChip.tsx ui/src/ExpiryChip.module.css ui/src/ExpiryChip.test.tsx ui/src/index.ts
git commit -m "Move the expiry chip out of one screen and into ui/"
```

---

## Task 9: `DeviceLink` becomes `InviteIssued`

**Files:**
- Rename: `app/src/screens/DeviceLink.tsx` → `InviteIssued.tsx`; `DeviceLink.module.css` → `InviteIssued.module.css`; `DeviceLink.test.tsx` → `InviteIssued.test.tsx`
- Modify: `app/src/App.tsx` (the existing `/account/device-link` route + two new ones)
- Modify: `app/src/screens/Account.tsx` if it imports `DeviceLink` by name

**Interfaces:**
- Consumes: Task 7's `issueJoinInvite` / `issueDeviceLinkFor` / `issueDeviceLink`; Task 8's `ExpiryChip`.
- Produces:
  ```ts
  export interface InviteIssuedProps {
    api: AuthApi
    token: string
    /** The signed-in Login's Person. */
    personId: string
    /** Who the Invite is for. Equal to `personId` for the own device link. */
    subjectPersonId: string
    purpose: 'join' | 'device'
  }
  ```
  and three routes: `/account/device-link`, `/account/people/:personId/device-link`, `/account/people/:personId/invite`.

- [ ] **Step 1: Rename the three files with git**

```bash
git mv app/src/screens/DeviceLink.tsx app/src/screens/InviteIssued.tsx
git mv app/src/screens/DeviceLink.module.css app/src/screens/InviteIssued.module.css
git mv app/src/screens/DeviceLink.test.tsx app/src/screens/InviteIssued.test.tsx
```

Update the CSS import inside `InviteIssued.tsx` and the component import inside `InviteIssued.test.tsx` and `App.tsx`. Rename the component and its props interface. Run `npm run typecheck` — it should pass with the screen still behaving exactly as before.

- [ ] **Step 2: Write the failing tests for the two new variants**

Append to `app/src/screens/InviteIssued.test.tsx`, following the file's existing harness (it already builds a fake `fetch` and a `AuthApi`; reuse it rather than writing a second one).

```tsx
  it('mints a join Invite and names the Person it is for', async () => {
    renderInviteIssued({ purpose: 'join', subjectPersonId: ELS })

    expect(await screen.findByText('Invite for Els')).toBeInTheDocument()
    expect(
      screen.getByText('Hand it over yourself — foerier sends no mail.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('It creates a login for Els. Nothing else can use it.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '‹ PEOPLE & LOGINS' })).toBeInTheDocument()
    expect(await screen.findByText(/EXPIRES IN 6 d/)).toBeInTheDocument()

    expect(issuedBodies).toEqual([{ purpose: 'join', person_id: ELS }])
  })

  it('mints a device link against another Person’s Login', async () => {
    renderInviteIssued({ purpose: 'device', subjectPersonId: ELS })

    expect(await screen.findByText('Device link for Els')).toBeInTheDocument()
    expect(
      screen.getByText('Open this on Els’s device. It signs that device in as Els.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '‹ PEOPLE & LOGINS' })).toBeInTheDocument()

    expect(issuedBodies).toEqual([{ purpose: 'device', person_id: ELS }])
  })

  it('still mints the caller’s own device link with no person_id', async () => {
    renderInviteIssued({ purpose: 'device', subjectPersonId: MARK })

    expect(await screen.findByText('Sign in on another device')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '‹ ACCOUNT' })).toBeInTheDocument()

    expect(issuedBodies).toEqual([{ purpose: 'device' }])
  })

  /**
   * The guard that was bought with a bug. React 19 Strict Mode
   * double-invokes an effect on mount precisely to surface non-idempotence,
   * and a screen that re-issues does not merely waste a request — it burns
   * single-use Invites and leaves dead links behind, each failing later with
   * no explanation on screen.
   */
  it('issues exactly one Invite per mount, for every variant', async () => {
    renderInviteIssued({ purpose: 'join', subjectPersonId: ELS })
    await screen.findByText('Invite for Els')
    expect(issuedBodies).toHaveLength(1)
  })
```

`renderInviteIssued`, `issuedBodies`, `ELS` and `MARK` are yours to add to the file's existing harness: `issuedBodies` records every JSON body posted to `/auth/invites`, and the fake depot state must hold a Person `ELS` named `Els` and `MARK` named `Mark` (the file already seeds a depot for the personalised lead — extend it).

- [ ] **Step 3: Run to verify they fail**

```bash
npm test -w @foerier/app -- InviteIssued
```

Expected: FAIL — the component takes no `purpose` or `subjectPersonId`.

- [ ] **Step 4: Generalise the component**

Change the props to `InviteIssuedProps` as declared above, derive `own`, and replace the four hardcoded strings with a lookup. Keep the header comment's history but rewrite its opening: the file now builds **both** halves of boards §14.

```tsx
  const own = subjectPersonId === personId
  const subjectName = useDepot(
    (depot) => depot.state.people[subjectPersonId]?.name?.value ?? null,
  )
  const name = subjectName ?? 'this person'

  /**
   * Boards §14 is one screen for both purposes, and the third entry point —
   * a device link for someone else — is S5's. The back link **follows the
   * route** rather than being fixed to `‹ ACCOUNT` as §14 draws it: a back
   * link that returns somewhere the reader has not been is worse than one
   * word of variance.
   */
  const copy = own
    ? {
        back: { href: '/account', label: '‹ ACCOUNT' },
        title: 'Sign in on another device',
        lead: `Open this on the other device. It signs that device in as ${
          subjectName === null ? 'you' : `you, ${subjectName}`
        }.`,
        fact: 'The link is the credential. Treat it like a key.',
        qrTitle: 'Device link',
      }
    : purpose === 'device'
      ? {
          back: { href: '/account/people', label: '‹ PEOPLE & LOGINS' },
          title: `Device link for ${name}`,
          lead: `Open this on ${name}’s device. It signs that device in as ${name}.`,
          fact: 'The link is the credential. Treat it like a key.',
          qrTitle: 'Device link',
        }
      : {
          back: { href: '/account/people', label: '‹ PEOPLE & LOGINS' },
          title: `Invite for ${name}`,
          lead: 'Hand it over yourself — foerier sends no mail.',
          fact: `It creates a login for ${name}. Nothing else can use it.`,
          qrTitle: 'Join invite',
        }
```

The mint effect picks its call the same way, and the `useRef` guard is untouched:

```tsx
  useEffect(() => {
    if (issuedRef.current) return
    issuedRef.current = true

    const issue =
      purpose === 'join'
        ? api.issueJoinInvite(token, subjectPersonId)
        : own
          ? api.issueDeviceLink(token)
          : api.issueDeviceLinkFor(token, subjectPersonId)

    void issue.then(setInvite).catch((error: unknown) => {
      console.error('invite issued: could not issue a link', error)
    })
  }, [api, token, purpose, subjectPersonId, own])
```

Replace the local expiry chip with `ExpiryChip` from `@foerier/ui`, and delete `minutesRemaining`, `useTick`, `DEVICE_LINK_TTL_MS` and the `.chip` rules from the module — all four now live in `ui/`. `revoke()` navigates to `copy.back.href` rather than `/account`.

- [ ] **Step 5: Add the two routes**

In `app/src/App.tsx`, change the existing route to pass the new props and add two more. Note the `:personId` param and `useParams` — follow whatever wouter idiom the `/gear/:id` route already uses.

```tsx
              <Route path="/account/device-link">
                <InviteIssued
                  api={api}
                  token={session.token}
                  personId={session.personId}
                  subjectPersonId={session.personId}
                  purpose="device"
                />
              </Route>
              <Route path="/account/people/:personId/invite">
                {(params) => (
                  <InviteIssued
                    api={api}
                    token={session.token}
                    personId={session.personId}
                    subjectPersonId={params.personId}
                    purpose="join"
                  />
                )}
              </Route>
              <Route path="/account/people/:personId/device-link">
                {(params) => (
                  <InviteIssued
                    api={api}
                    token={session.token}
                    personId={session.personId}
                    subjectPersonId={params.personId}
                    purpose="device"
                  />
                )}
              </Route>
```

Place both **after** `/account/people` in the `Switch`, so the more specific patterns are not shadowed — check wouter's matching order in this version and order accordingly.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -w @foerier/app -- InviteIssued
npm run typecheck
```

Expected: every pre-existing case still PASSES plus the four new ones. If an existing case broke, the generalisation changed the own-device-link path — that path must be byte-identical in behaviour.

- [ ] **Step 7: Commit**

```bash
git add -A app/src/screens ui/src app/src/App.tsx
git commit -m "One invite-issued screen, three ways in"
```

---

## Task 10: People & logins — the milestone task

**Files:**
- Modify: `app/src/screens/People.tsx`, `People.module.css`, `People.test.tsx`
- Modify: `app/src/screens/Account.tsx` (`:493-510`)
- Modify: `app/src/App.tsx` (the `/account/people` route's props)

**Interfaces:**
- Consumes: Task 7's `listLogins`, `listInvites`, `revokeLogin`, `revokeInvite`; Task 8's `ExpiryChip`; Task 9's two routes.
- Produces:
  ```ts
  export interface PeopleProps {
    api: AuthApi
    token: string
    personId: string
    variant?: 'list' | 'inline'
  }
  ```

- [ ] **Step 1: Write the failing tests**

`app/src/screens/People.test.tsx` already renders the screen against a fake depot. Extend its harness so a test can supply `logins` and `invites` (and make either request fail), then add:

```tsx
  it('draws your own row as signed in, with a chevron to your devices', async () => {
    renderPeople({
      logins: [{ id: 'L1', person_id: MARK, device_count: 2, last_seen_at: NOW_ISO }],
    })

    const row = await screen.findByTestId(`person-row-${MARK}`)
    expect(within(row).getByText('SIGNED IN · 2 DEVICES')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '›' })).toHaveAttribute(
      'href',
      '/account/devices',
    )
    // Your exit is SIGN OUT, never self-revocation.
    expect(within(row).queryByText('REVOKE')).not.toBeInTheDocument()
  })

  it('draws another Person’s login with a last seen, a device link and a revoke', async () => {
    renderPeople({
      logins: [
        { id: 'L1', person_id: MARK, device_count: 2, last_seen_at: NOW_ISO },
        { id: 'L2', person_id: ELS, device_count: 1, last_seen_at: '2026-08-20T19:04:00.000Z' },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    expect(
      within(row).getByText('SIGNED IN · 1 DEVICE · LAST SEEN 2026-08-20 19:04'),
    ).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'DEVICE LINK ›' })).toHaveAttribute(
      'href',
      `/account/people/${ELS}/device-link`,
    )
    expect(within(row).getByRole('button', { name: 'REVOKE' })).toBeInTheDocument()
  })

  /**
   * A state the boards do not draw. `SIGNED IN · 0 DEVICES` would be false in
   * both of its words, and the product already talks about this case — §15's
   * explainer sheet is written for "if yours is the only login and it is
   * signed in nowhere".
   */
  it('says a Login is signed in nowhere rather than counting zero devices', async () => {
    renderPeople({
      logins: [
        { id: 'L1', person_id: MARK, device_count: 1, last_seen_at: NOW_ISO },
        { id: 'L2', person_id: ELS, device_count: 0, last_seen_at: null },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    expect(within(row).getByText('LOGIN · NO DEVICE SIGNED IN')).toBeInTheDocument()
  })

  it('offers an invite to a Person with no login', async () => {
    renderPeople({ logins: [] })

    const row = await screen.findByTestId(`person-row-${KEES}`)
    expect(
      within(row).getByText('NO LOGIN · JOINS TRIPS AS PARTICIPANT'),
    ).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'INVITE ›' })).toHaveAttribute(
      'href',
      `/account/people/${KEES}/invite`,
    )
  })

  it('collapses an outstanding join invite into the row', async () => {
    renderPeople({
      logins: [],
      invites: [
        {
          id: 'I1',
          purpose: 'join',
          person_id: ELS,
          expires_at: new Date(NOW + 7 * 24 * 60 * 60_000 - 100).toISOString(),
        },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    expect(within(row).getByText('INVITE OUT · SINGLE USE')).toBeInTheDocument()
    expect(within(row).getByText('EXPIRES IN 6 d')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'REVOKE' })).toBeInTheDocument()
    // REOPEN is not built: the secret is hashed and exists only in the link.
    expect(within(row).queryByText(/REOPEN/)).not.toBeInTheDocument()
  })

  it('ignores a device link when deciding whether an invite is out', async () => {
    renderPeople({
      logins: [{ id: 'L2', person_id: ELS, device_count: 1, last_seen_at: NOW_ISO }],
      invites: [
        { id: 'I2', purpose: 'device', person_id: ELS, expires_at: new Date(NOW + 60 * 60_000).toISOString() },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    expect(within(row).queryByText('INVITE OUT · SINGLE USE')).not.toBeInTheDocument()
  })

  it('counts logins and outstanding invites', async () => {
    renderPeople({
      logins: [{ id: 'L1', person_id: MARK, device_count: 1, last_seen_at: NOW_ISO }],
      invites: [
        { id: 'I1', purpose: 'join', person_id: ELS, expires_at: new Date(NOW + DAY).toISOString() },
      ],
    })

    expect(await screen.findByTestId('people-count')).toHaveTextContent(
      '1 of 3 people holds a login. 1 invite out.',
    )
  })

  it('omits the invite clause when nothing is out, and pluralises the first', async () => {
    renderPeople({
      logins: [
        { id: 'L1', person_id: MARK, device_count: 1, last_seen_at: NOW_ISO },
        { id: 'L2', person_id: ELS, device_count: 1, last_seen_at: NOW_ISO },
      ],
    })

    expect(await screen.findByTestId('people-count')).toHaveTextContent(
      '2 of 3 people hold a login.',
    )
  })

  it('revokes a login only after the confirm is taken', async () => {
    const user = userEvent.setup()
    renderPeople({
      logins: [
        { id: 'L1', person_id: MARK, device_count: 1, last_seen_at: NOW_ISO },
        { id: 'L2', person_id: ELS, device_count: 1, last_seen_at: NOW_ISO },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    await user.click(within(row).getByRole('button', { name: 'REVOKE' }))

    expect(screen.getByText('Revoke Els’s login?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Els’s devices lose access at their next contact with the server. Everything Els recorded stays.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(revokedLogins).toEqual([])

    await user.click(within(row).getByRole('button', { name: 'REVOKE' }))
    await user.click(screen.getByRole('button', { name: 'Revoke login' }))
    expect(revokedLogins).toEqual(['L2'])
  })

  it('revokes an invite with no confirm — it kills a link, never data', async () => {
    const user = userEvent.setup()
    renderPeople({
      logins: [],
      invites: [
        { id: 'I1', purpose: 'join', person_id: ELS, expires_at: new Date(NOW + DAY).toISOString() },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    await user.click(within(row).getByRole('button', { name: 'REVOKE' }))

    expect(revokedInvites).toEqual(['I1'])
  })

  /**
   * The rule that governed the whole S4 → S5 seam, arriving later: drawing
   * every circle as "no login" would render the joiner — who demonstrably
   * holds one — as having none, and stating something false is worse than
   * stating less. Offline is S4's situation, not a degraded mode.
   */
  it('falls back to S4’s render when the login half cannot be loaded', async () => {
    renderPeople({ failLogins: true })

    expect(
      await screen.findByText('Login state could not be loaded. Check your connection.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('people-count')).toHaveTextContent('3 people.')

    const row = screen.getByTestId(`person-row-${ELS}`)
    expect(within(row).queryByText(/SIGNED IN|NO LOGIN|INVITE OUT/)).not.toBeInTheDocument()
    expect(within(row).queryByRole('link', { name: 'INVITE ›' })).not.toBeInTheDocument()
  })

  it('keeps + NEW PERSON and RENAME live with the login half down', async () => {
    const user = userEvent.setup()
    renderPeople({ failLogins: true })

    await user.click(await screen.findByRole('button', { name: '+ NEW PERSON' }))
    await user.type(screen.getByLabelText('New person name'), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Sam')).toBeInTheDocument()
  })

  it('omits the own row’s chevron in the inline variant', async () => {
    renderPeople({
      variant: 'inline',
      logins: [{ id: 'L1', person_id: MARK, device_count: 2, last_seen_at: NOW_ISO }],
    })

    const row = await screen.findByTestId(`person-row-${MARK}`)
    expect(within(row).queryByRole('link', { name: '›' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -w @foerier/app -- People
```

Expected: FAIL across the board — `People` takes no `api`.

- [ ] **Step 3: Load the two lists**

Add `api` and `token` to `PeopleProps`, and a single load:

```tsx
type LoadStatus = 'loading' | 'loaded' | 'failed'

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [logins, setLogins] = useState<readonly LoginRow[]>([])
  const [invites, setInvites] = useState<readonly InviteRow[]>([])

  /**
   * One status for both lists, because the login half is one claim and half
   * of it is not worth drawing: a row that knows about an outstanding invite
   * but not about a Login would say `INVITE OUT` for somebody who has
   * already joined.
   */
  const load = useCallback(async () => {
    try {
      const [loginsBody, invitesBody] = await Promise.all([
        api.listLogins(token),
        api.listInvites(token),
      ])
      setLogins(loginsBody.logins)
      setInvites(invitesBody.invites)
      setStatus('loaded')
    } catch (error) {
      console.error('people: could not load login state', error)
      setStatus('failed')
    }
  }, [api, token])

  useEffect(() => {
    void load()
  }, [load])
```

Both revokes call `void load()` on success rather than patching local state: two lists whose consistency with each other is what the row states are computed from is not a place to hand-maintain a cache.

- [ ] **Step 4: Derive the row state**

Add a small pure helper above the component — it is the piece worth reading on its own:

```tsx
type RowState =
  | { kind: 'unknown' }
  | { kind: 'own'; deviceCount: number }
  | { kind: 'login'; loginId: string; deviceCount: number; lastSeenAt: string | null }
  | { kind: 'invited'; inviteId: string; expiresAt: string }
  | { kind: 'none' }

/**
 * The five states of boards §08's person row, from three inputs: the folded
 * People, `GET /auth/logins`, and the join half of `GET /auth/invites`.
 *
 * A device link is deliberately ignored — one Mark issued for Els must not
 * make Els's row read `INVITE OUT`, which describes a Login that does not
 * exist yet.
 *
 * `unknown` is what the whole screen falls back to when the server half
 * cannot be loaded, and it renders exactly what S4 rendered.
 */
function rowStateOf(
  personId: string,
  selfPersonId: string,
  status: LoadStatus,
  logins: readonly LoginRow[],
  invites: readonly InviteRow[],
): RowState {
  if (status !== 'loaded') return { kind: 'unknown' }

  const login = logins.find((row) => row.person_id === personId)
  if (login !== undefined) {
    return personId === selfPersonId
      ? { kind: 'own', deviceCount: login.device_count }
      : {
          kind: 'login',
          loginId: login.id,
          deviceCount: login.device_count,
          lastSeenAt: login.last_seen_at,
        }
  }

  const invite = invites.find(
    (row) => row.purpose === 'join' && row.person_id === personId,
  )
  if (invite !== undefined) {
    return { kind: 'invited', inviteId: invite.id, expiresAt: invite.expires_at }
  }

  return { kind: 'none' }
}
```

and the meta line:

```tsx
/** `2026-08-20 19:04` — local time, as the board draws it. */
function lastSeenLabel(iso: string): string {
  const at = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  )
}

function metaOf(state: RowState): string | null {
  switch (state.kind) {
    case 'unknown':
      return null
    case 'own':
      // No `LAST SEEN` on your own row: printing when *you* were last seen,
      // on the screen you are looking at, is noise.
      return `SIGNED IN · ${state.deviceCount} ${
        state.deviceCount === 1 ? 'DEVICE' : 'DEVICES'
      }`
    case 'login':
      if (state.deviceCount === 0) return 'LOGIN · NO DEVICE SIGNED IN'
      return (
        `SIGNED IN · ${state.deviceCount} ` +
        `${state.deviceCount === 1 ? 'DEVICE' : 'DEVICES'}` +
        (state.lastSeenAt === null
          ? ''
          : ` · LAST SEEN ${lastSeenLabel(state.lastSeenAt)}`)
      )
    case 'invited':
      return 'INVITE OUT · SINGLE USE'
    case 'none':
      return 'NO LOGIN · JOINS TRIPS AS PARTICIPANT'
  }
}
```

- [ ] **Step 5: Draw the row**

The circle takes the login encoding — `data-login="yes" | "no"` when `status === 'loaded'`, and **no attribute at all** when it is not, so the CSS falls through to S4's neutral border. The right column is rendered only when `!editing`; EDIT mode replaces it with `RENAME` exactly as it does today, so the two never compete for the slot.

```tsx
              <span
                className={styles['circle']}
                data-testid={`person-initial-${person.id}`}
                data-login={
                  state.kind === 'unknown'
                    ? undefined
                    : state.kind === 'own' || state.kind === 'login'
                      ? 'yes'
                      : 'no'
                }
                aria-hidden="true"
              >
```

and, after the name and `YOU` badge:

```tsx
                {meta !== null && (
                  <span className={styles['meta']}>{meta}</span>
                )}

                {!editing && state.kind === 'own' && variant === 'list' && (
                  // At Desktop the inline card sits inside Account, which
                  // already draws DEVICES two rows above — and
                  // `/account/devices` redirects back to `/account` there.
                  // A chevron whose destination is the card above it is an
                  // affordance that leads nowhere.
                  <Link href="/account/devices" className={styles['chevron']}>
                    ›
                  </Link>
                )}

                {!editing && state.kind === 'login' && (
                  <>
                    <Link
                      href={`/account/people/${person.id}/device-link`}
                      className={styles['action']}
                    >
                      DEVICE LINK ›
                    </Link>
                    <button
                      type="button"
                      className={styles['revoke']}
                      onClick={() =>
                        setRevoking({ loginId: state.loginId, name: person.label })
                      }
                    >
                      REVOKE
                    </button>
                  </>
                )}

                {!editing && state.kind === 'invited' && (
                  <>
                    <ExpiryChip expiresAt={state.expiresAt} />
                    {/* No REOPEN: the secret is stored hashed and exists
                        only in the link (auth-design §3.1), so nothing can
                        reopen one. Re-handing a link is REVOKE, which
                        returns this row to `INVITE ›`. */}
                    <button
                      type="button"
                      className={styles['revoke']}
                      onClick={() => void revokeInvite(state.inviteId)}
                    >
                      REVOKE
                    </button>
                  </>
                )}

                {!editing && state.kind === 'none' && (
                  <Link
                    href={`/account/people/${person.id}/invite`}
                    className={styles['action']}
                  >
                    INVITE ›
                  </Link>
                )}
```

- [ ] **Step 6: The count line and the failed line**

```tsx
      <p className={styles['count']} data-testid="people-count">
        {status === 'loaded' ? countLine : `${people.length} ${people.length === 1 ? 'person' : 'people'}.`}
      </p>

      {status === 'failed' && (
        <p className={styles['nudgeLine']}>
          Login state could not be loaded. Check your connection.
        </p>
      )}
```

with

```tsx
  const loginCount = logins.length
  const inviteCount = invites.filter((row) => row.purpose === 'join').length
  const countLine =
    `${loginCount} of ${people.length} ` +
    `${people.length === 1 ? 'person holds' : loginCount === 1 ? 'people holds' : 'people hold'} a login.` +
    (inviteCount === 0
      ? ''
      : ` ${inviteCount} ${inviteCount === 1 ? 'invite' : 'invites'} out.`)
```

Check that against the boards: `1 of 3 people holds a login.` and `2 of 3 people hold a login.` — the verb agrees with the **count of logins**, not with the count of people.

- [ ] **Step 7: The revoke confirm**

```tsx
      {revoking !== null && (
        <Confirm
          variant="sheet"
          title={`Revoke ${revoking.name}’s login?`}
          description={`${revoking.name}’s devices lose access at their next contact with the server. Everything ${revoking.name} recorded stays.`}
          onClose={() => setRevoking(null)}
          actions={
            <>
              <Confirm.Action>
                <button
                  type="button"
                  className={styles['confirmAttention']}
                  onClick={() => void confirmRevokeLogin()}
                >
                  Revoke login
                </button>
              </Confirm.Action>
              <Confirm.Cancel>
                <button type="button" className={styles['ghost']}>
                  Cancel
                </button>
              </Confirm.Cancel>
            </>
          }
        />
      )}
```

No `▲`. Nothing is discarded, and §12's rule is that signing out this device is the only auth action that earns the attention class.

- [ ] **Step 8: The CSS**

Add `.meta`, `.chevron`, `.action`, `.revoke`, `.nudgeLine`, `.confirmAttention` and `.ghost` to `People.module.css`. Copy the mono-11 meta, the accent-text action and the attention-text revoke off `Devices.module.css` and `Account.module.css` rather than inventing values. The circle gains:

```css
  .circle[data-login='yes'] {
    border-color: var(--color-accent);
  }
  .circle[data-login='no'] {
    border-color: var(--color-rule-control);
  }
```

and keeps its existing neutral border as the no-attribute default — that is what the offline fallback renders. Use the token names this repo actually has; read `Foundations.dc.html` §Color or an existing module if unsure. `#93BC9F` is accent, `#47523F` is control.

- [ ] **Step 9: Thread the props**

`app/src/App.tsx`'s `/account/people` route and `Account.tsx`'s inline render both gain `api={api} token={session.token}` / `api={api} token={token}`.

- [ ] **Step 10: Rename the Account section**

In `Account.tsx`, `:495`'s label becomes `PEOPLE & LOGINS`, and the comment at `:493` is replaced by a statement of what is now true. The phone summary row's meta gains the login clause the count line carries — read the surrounding rows and match their shape.

- [ ] **Step 11: Run the tests to verify they pass**

```bash
npm test -w @foerier/app
npm run typecheck
```

Expected: every `People` case PASSES, and `Account.test.tsx` passes with its label expectation updated.

- [ ] **Step 12: Commit**

```bash
git add app/src/screens app/src/App.tsx
git commit -m "Fill the half of the People screen S4 could not know"
```

---

## Task 11: Tier 5 — joining on an in-app Invite, locally

**Files:**
- Create: `test/e2e/invite.spec.ts`

**Interfaces:**
- Consumes: `test/e2e/quartermaster.ts` (the signed-in fixture) and `test/e2e/deviceLink.spec.ts`'s two-context-with-virtual-authenticators pattern. Read both before writing.
- Produces: nothing. This is the proof that the slice is usable.

- [ ] **Step 1: Write the spec**

```ts
/**
 * Tier 5 — story 28 end to end: a Quartermaster records a Person, issues a
 * join Invite from that Person's row, and the link turns into a second
 * Login on a different device.
 *
 * **Deliberately untagged — this must never carry `@production`.** The Tier
 * 4/5 spec §5 rules that anything which proves joining stays local, and the
 * mechanism is decisive: `POST /test/reset` cannot delete a Login — by
 * design, since it can never create one either — so every production run
 * would leave one behind in the disposable Household, and the tripwire that
 * says `passkeys = 0, invites = 0, revoked ≤ 1` would have nothing to say
 * about it.
 */
```

The body, in order:

1. Sign in as the Quartermaster (the existing fixture).
2. Go to `/account/people`, add a Person named `Els`.
3. Click `INVITE ›` on Els's row; wait for the invite card; read the link out of the input well.
4. Assert the row now reads `INVITE OUT · SINGLE USE` on returning to `/account/people`.
5. Open a **second browser context** with its own virtual authenticator, navigate to the link, confirm the join, and assert it lands in the Depot **without** a name field — `person_recorded` is true, so the joiner does not name themselves.
6. Back in the first context, reload `/account/people` and assert Els's row now reads `SIGNED IN · 1 DEVICE …` and offers `DEVICE LINK ›` and `REVOKE`.

- [ ] **Step 2: Run it**

```bash
npx playwright test invite
```

Expected: PASS. If step 5 shows a name field, `person_recorded` is not reaching the join screen — check Task 4's insert, not the join screen.

- [ ] **Step 3: Prove it is not tagged**

```bash
grep -c '@production' test/e2e/invite.spec.ts
```

Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/invite.spec.ts
git commit -m "Prove a join on an in-app Invite, and keep it off the box"
```

---

## Task 12: The doc pass

**Files:**
- Modify: `docs/auth-design.md`, `docs/architecture-design.md`, `docs/design/README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: durable docs that are true again.

- [ ] **Step 1: `auth-design.md`**

- §9.1 — delete the "What exists as of S3.5" paragraph's caveat about `GET /auth/logins` and `DELETE /auth/logins/:id` and about `purpose: "device"` only. State instead that `POST /auth/invites` takes an optional `person_id` for both purposes, and that `GET · DELETE /auth/invites` scope by purpose: a join Invite is Household business, a device Invite stays with its issuer.
- §9.2 — the `login` row's uniqueness is `unique (household_id, person_id) where disabled_at is null`, with one clause on why.
- §13 — slice 2 marked landed, dated, noting it arrived after slices 3 and 4 and pointing at this spec.

- [ ] **Step 2: `architecture-design.md`**

- §8.3's **S5** entry — mark **Landed**, link this spec and the new §12.11. Correct the Endpoints line to include the widened `/auth/invites`, add a **Migration** line for `0006_login_reinvite`, and correct the Tier 5 line to say local-only with the reason.
- New **§12.11 — Consequences of S5**, in the register §12.7 and §12.10 use. Cover: REOPEN being undrawable and why; the partial index as a defect found by design rather than in production; purpose-scoped listing as a one-sentence rule; self-revocation as the thing that keeps a Household above zero Logins; and that a screen designed to be true while knowing less turned out to be its own offline mode.

- [ ] **Step 3: `design/README.md`**

- §13 — S5's three debts marked discharged; record the `REOPEN` departure and `LOGIN · NO DEVICE SIGNED IN` as an added state.
- §14 — the third entry point (a device link for someone else) and the back-link rule.

- [ ] **Step 4: `CLAUDE.md`**

Replace the "Next is S5" paragraph with an S5 status block in the register the S3.5 and S4 blocks use, plus the two or three things worth knowing before touching auth again. Name S6 (Trips and phases) as next.

- [ ] **Step 5: Full green**

```bash
npm run typecheck && npm test && npx playwright test
```

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md
git commit -m "Record what S5 settled"
```

---

## Self-Review

**Spec coverage.** §1 → Task 1. §2.1 → Task 2. §2.2 → Task 3. §2.3 → Task 4. §2.4 → Task 5. §3.1–§3.3 → Task 10. §3.4 → Task 9. §3.5 → Task 10 steps 9–10. §4 → Task 8. §5.1 → Tasks 2–6. §5.2 → Tasks 8–10. §5.3 → Task 6. §5.4 → Task 11. §6.1–§6.3 → Tasks 9, 10 (and recorded in Task 12). §7 is what is *not* built and needs no task. §8 → Task 12.

**Type consistency.** `LoginRow` and `InviteRow` are declared once in Task 7 and used verbatim in Tasks 9 and 10. `listLogins` returns `{ logins }` and `listInvites` returns `{ invites }` throughout. The service returns camelCase (`personId`, `deviceCount`, `lastSeenAt`, `expiresAt`) and the routes are the only place it becomes snake_case — the repo's standing rule. `InviteRequestError` is declared in Task 4 and caught in Task 4's route only.

**Ordering.** Task 7 (the client) precedes both screens. Task 8 (`ExpiryChip`) precedes both callers. Task 9 renames the file Task 10's routes point at. Task 11 needs Tasks 9 and 10 on screen. Task 12 is last.

**Two things an implementer must read before writing, not assume:** `migrations.test.ts`'s household constant and setup; and `People.test.tsx`'s existing harness, which is extended rather than replaced.
