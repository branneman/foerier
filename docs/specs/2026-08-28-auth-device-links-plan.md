# S3.5 — Auth 3+4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship stories 29 and 30 — a Device that cannot hold a passkey the household will use can be signed in by a link, and every Device can be seen and cut off from any other.

**Architecture:** Nine new authenticated routes plus one unauthenticated redemption route on the existing Hono/Kysely server; one additive migration; two Maintainer scripts; the Account screen and its two sub-screens in `app/`, reached from four shell affordances that are already drawn and unbuilt. No ops, no reducer, no selector — `shared/` is untouched from first task to last.

**Tech Stack:** Hono · Kysely · Postgres · `@simplewebauthn/{server,browser}` · React 19 · wouter · Zustand · CSS Modules · Vitest · Playwright · **`uqr`** (new, `ui/` only)

**Spec:** [`docs/specs/2026-08-28-auth-device-links.md`](2026-08-28-auth-device-links.md) — read it alongside this plan. Where they disagree, the spec wins; where the spec and `docs/design/README.md` §§10–15 disagree, **the boards win**.

## Global Constraints

- **Relative imports in `api/` need an explicit `.ts` extension.** `app/` and `ui/` are the exception — Vite resolves, so no extension there.
- **Ops mirror the wire — `snake_case`, never transformed.** Folded state, service return values and React props are ordinary `camelCase`. HTTP request and response bodies are `snake_case`.
- **`household_id` comes from the auth context and never from a request body, query string, or header** (`auth-design.md` §9.3). Every new authenticated route obeys this; there is no exception in this slice.
- **One vague failure for auth.** `VAGUE_FAILURE = { error: 'auth_failed' }` at `401` for anything to do with a secret, a challenge, or an assertion. Precise in the log via `AuthError(reason)`, never to the client. A malformed request *shape* (a missing or wrong-typed field) is a plain `400`, because there is no secret to protect.
- **Auth vocabulary is law** (`docs/design/README.md`, "Auth vocabulary & rules"). Household · Person · Quartermaster · Login · Passkey · Device · Invite · Maintainer. Verbs: *sign in / sign out* (never "log in"), *join*, *invite*, *revoke*, *add a passkey*, *issue a device link*. Never "account" outside the tab name, never "user", "profile", "admin", or "registration".
- **A media query decides which elements *exist*; a container query decides how what exists *lays out*** (`frontend-design.md` §3.2).
- **Tier 2s isolation:** every new test class claims a free UUID registry slot in `docs/testing.md`, scopes every query to its own household, and clears no table it does not own — **never `webauthn_challenge`**.
- **Tier 0 runs on every commit** (pre-commit hook: `tsc --noEmit` across workspaces, ESLint, Prettier). A commit that fails it is not a commit.
- **Known-flaky neighbour:** `api/test/server/sync.test.ts` fails nondeterministically in the full suite (different tests each run) and passes alone — pre-existing, unrelated, suspected concurrent access to the shared `foerier_test` database. **Do not modify that file, and do not reuse its household slots (#6, #7).** If it fails during this work, re-run it alone to confirm it is the known flake before investigating.

---

## File Structure

**Server — `api/`**

| Path | Responsibility |
| --- | --- |
| `api/migrations/0004_device_links.ts` | Create: `invite.person_recorded`, `passkey.created_on_device` |
| `api/src/db/migrations.ts` | Modify: register `0004_device_links` |
| `api/src/db/schema.ts` | Modify: the two new columns on `InviteTable` / `PasskeyTable` |
| `api/src/auth/service.ts` | Modify: `previewInvite` reads the column; add `claimDevice`, `issueDeviceLink`, `listInvites`, `revokeInvite`, `listDevices`, `revokeDevice`, `beginAddPasskey`, `finishAddPasskey`, `listPasskeys`, `removePasskey`, `mintJoinInvite`, `listHouseholds`; `bootstrapHousehold` writes `person_recorded: false` |
| `api/src/auth/routes.ts` | Modify: the ten new routes |
| `api/src/admin/invite.ts` | Create: `admin:invite` |
| `api/src/admin/list.ts` | Create: `admin:list` |
| `api/package.json` | Modify: two script entries |

**Server tests**

| Path | Responsibility |
| --- | --- |
| `api/test/server/harness.ts` | Modify: `seedInvite` gains `personRecorded` and `loginId`; add `seedLogin`, `seedDevice` |
| `api/test/server/deviceLink.test.ts` | Create: slot **#9** — `person_recorded`, `device/claim` both purposes |
| `api/test/server/account.test.ts` | Create: slot **#10** — invites, devices, passkeys, `/auth/me` |
| `api/test/server/householdIsolation.test.ts` | Modify: the new routes join the isolation sweep |
| `docs/testing.md` | Modify: registry rows 9 and 10 |

**Client — `ui/` and `app/`**

| Path | Responsibility |
| --- | --- |
| `ui/src/QrCode.tsx` + `ui/src/index.ts` | Create/modify: the only place `uqr` is imported |
| `ui/package.json` | Modify: `uqr` dependency |
| `app/src/auth/api.ts` | Modify: nine client methods + `household_name` on `Me` |
| `app/src/screens/Account.tsx` + `.module.css` | Create: boards §11, both widths |
| `app/src/screens/Devices.tsx` + `.module.css` | Create: boards §12 + both confirm sheets |
| `app/src/screens/DeviceLink.tsx` + `.module.css` | Create: boards §14, device-link variant |
| `app/src/screens/NoPasskey.tsx` + `.module.css` | Create: boards §10 |
| `app/src/screens/Join.tsx` | Modify: the ghost door beneath the primary |
| `app/src/screens/JoinContainer.tsx` | Modify: the claim path and the fall-through |
| `app/src/shell/AppShell.tsx` + `.module.css` | Modify: the four affordances |
| `app/src/App.tsx` | Modify: three routes, the initial prop, `storage.persist()` |
| `app/src/shell/AppShell.test.tsx` | Modify: invert "the account affordance" |
| `test/e2e/deviceLink.spec.ts` | Create: the three journeys |
| `test/e2e/mintInvite.ts` | Modify: `mintDeviceLink`, `mintJoinInviteInto` |

---

## Task 1: The `0004` migration and the `person_recorded` defect

Spec §4. This is first because every later task seeds invites, and seeding them against the old shape means rewriting fixtures twice.

**Two columns, one migration.** `invite.person_recorded` is spec §4. `passkey.created_on_device` is **an addition to the spec** made while mapping boards §12: the Devices rows read `SIGNED IN 2026-03-02 · NO PASSKEY HERE`, which is a per-Device fact, and nothing today records which Device enrolled which Passkey. A nullable FK on `passkey` makes the line exactly true about *enrolment* and updates itself the moment that Device adds one. It is approximate in one direction — a credential synced through a password manager is usable on Devices that never enrolled it, and the server cannot see that — which is why the line says what happened here, not what is reachable from here.

**Files:**
- Create: `api/migrations/0004_device_links.ts`
- Modify: `api/src/db/migrations.ts:19-23`, `api/src/db/schema.ts` (`InviteTable`, `PasskeyTable`), `api/src/auth/service.ts` (`previewInvite`, `bootstrapHousehold`, `finishRegistration`), `api/test/server/harness.ts` (`seedInvite`)
- Test: `api/test/server/deviceLink.test.ts` (create)

**Interfaces:**
- Consumes: `createHarness`, `resetHouseholds`, `seedHousehold`, `seedInvite`, `jsonOf` from `./harness.ts`
- Produces: `InviteTable.person_recorded: boolean`; `PasskeyTable.created_on_device: string | null`; `seedInvite(db, { householdId, purpose?, clock, expiresAt?, personRecorded?, loginId? })`

- [ ] **Step 1: Write the failing test**

Create `api/test/server/deviceLink.test.ts`:

```ts
import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Database } from '../../src/db/schema.ts'
import {
  createHarness,
  jsonOf,
  resetHouseholds,
  seedHousehold,
  seedInvite,
  type Harness,
} from './harness.ts'

/**
 * Tier 2s — the token-only path and the Invite fact that makes a second
 * joiner possible.
 *
 * UUID registry slot #9 (`docs/testing.md`).
 */
const HOUSEHOLD = '0f000009-0000-4000-8000-000000000009'

describe('device links', () => {
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

  describe('person_recorded is recorded, not guessed', () => {
    it('says false for an invite minted for a Person who does not exist yet', async () => {
      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
        personRecorded: false,
      })

      const res = await h.app.request('/api/v1/auth/join/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })

      expect(res.status).toBe(200)
      expect(await jsonOf(res)).toMatchObject({ person_recorded: false })
    })

    /**
     * The defect this column exists for. The old derivation — "does this
     * Household have any Login" — is exactly right for the first joiner and
     * exactly wrong for the second, who would get no name field and a Login
     * pointing at a Person nobody ever recorded.
     */
    it('still says false for the SECOND joiner, though a Login already exists', async () => {
      await db
        .insertInto('login')
        .values({
          id: '0f000009-0000-4000-8000-0000000090a1',
          household_id: HOUSEHOLD,
          person_id: '0f000009-0000-4000-8000-0000000090a2',
        })
        .execute()

      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
        personRecorded: false,
      })

      const res = await h.app.request('/api/v1/auth/join/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })

      expect(await jsonOf(res)).toMatchObject({ person_recorded: false })
    })

    it('says true for an invite issued against a Person already recorded', async () => {
      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
        personRecorded: true,
      })

      const res = await h.app.request('/api/v1/auth/join/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })

      expect(await jsonOf(res)).toMatchObject({ person_recorded: true })
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run api/test/server/deviceLink.test.ts`
Expected: FAIL — `seedInvite` rejects the unknown `personRecorded` option (a TypeScript error), and the second test would fail at runtime anyway because `person_recorded` is still derived from `anyLogin`.

- [ ] **Step 3: Write the migration**

Create `api/migrations/0004_device_links.ts`:

```ts
import { type Kysely, sql } from 'kysely'

/**
 * Two facts the server was inferring or could not answer at all.
 *
 * `invite.person_recorded` replaces a derivation in `previewInvite` that read
 * "does this Household have any Login" as a proxy for "is this the first
 * joiner, who must name themselves". That proxy is exactly right for the
 * first Login and exactly wrong for every one after: the second joiner would
 * be shown no name field and would end up with a Login pointing at a Person
 * nobody ever recorded. The issuer always knows which case it is, so the fact
 * belongs on the row rather than in a query.
 *
 * `passkey.created_on_device` lets the Devices list say `NO PASSKEY HERE`
 * (`docs/design/README.md` §12) about a Device that was signed in by a link.
 * It records enrolment, not reachability — a credential synced through a
 * password manager works on Devices that never enrolled it, and the server
 * cannot see that.
 *
 * Additive: no existing column changes shape or nullability.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Three steps rather than one, because a NOT NULL column with no default
  // cannot be added to a table that already has rows. Nullable, backfilled,
  // then constrained — all inside the one transaction Kysely runs migrations
  // in, so no window exists where the column is half-applied.
  await db.schema
    .alterTable('invite')
    .addColumn('person_recorded', 'boolean')
    .execute()

  // Reproduce the old derivation exactly, so every Invite outstanding at
  // deploy time keeps the behaviour it had a second earlier. After this the
  // value is frozen and every insert must state it.
  await sql`
    update invite
       set person_recorded = exists (
             select 1 from login where login.household_id = invite.household_id
           )
     where person_recorded is null
  `.execute(db)

  await db.schema
    .alterTable('invite')
    .alterColumn('person_recorded', (col) => col.setNotNull())
    .execute()

  // Nullable with no backfill, deliberately: every passkey that exists before
  // this migration was enrolled by a Device we cannot now identify, and
  // guessing would be worse than the honest null the UI already has to
  // tolerate.
  await db.schema
    .alterTable('passkey')
    .addColumn('created_on_device', 'uuid', (col) =>
      col.references('device.id').onDelete('set null'),
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('passkey').dropColumn('created_on_device').execute()
  await db.schema.alterTable('invite').dropColumn('person_recorded').execute()
}
```

- [ ] **Step 4: Register it**

In `api/src/db/migrations.ts`, add the import beside the other three and the map entry:

```ts
import * as m0004 from '../../migrations/0004_device_links.ts'

const migrations: Record<string, Migration> = {
  '0001_household': m0001,
  '0002_auth': m0002,
  '0003_op': m0003,
  '0004_device_links': m0004,
}
```

- [ ] **Step 5: Add the columns to the schema types**

In `api/src/db/schema.ts`, inside `InviteTable`, after `purpose`:

```ts
  /**
   * Whether the Person this Invite names is already in the op log.
   *
   * `false` means the joiner names themselves and the client emits
   * `person.recorded` with this row's `person_id`. Written by whoever issues
   * the Invite — never derived, which is the whole point of the column.
   * `ColumnType` with a required insert: there is no default, so forgetting it
   * is a compile error rather than a silent `true`.
   */
  person_recorded: ColumnType<boolean, boolean, boolean>
```

and inside `PasskeyTable`, after `label`:

```ts
  /** The Device that enrolled this Passkey; null for rows predating 0004. */
  created_on_device: ColumnType<string | null, string | null, string | null>
```

- [ ] **Step 6: Stop guessing in `previewInvite`**

In `api/src/auth/service.ts`, delete the `anyLogin` query and its comment (around lines 193–201) and change the return:

```ts
      return {
        householdName: household.name,
        purpose: invite.purpose,
        expiresAt: invite.expires_at,
        personId: invite.person_id,
        // Read, not derived. The issuer knew; the row remembers.
        personRecorded: invite.person_recorded,
      }
```

Update the field's doc comment above the return type — it currently says "False for a brand-new Household's first Invite", which describes the old proxy:

```ts
      /**
       * False when the joiner names themselves — the client then emits
       * `person.recorded` with this Invite's `person_id`
       * (`docs/design/README.md` §9, "Name yourself").
       */
      personRecorded: boolean
```

- [ ] **Step 7: Make every insert state it**

In `bootstrapHousehold`'s `invite` insert, add `person_recorded: false` — a brand-new Household has no ops, so its first Person is created as they join.

In `finishRegistration`'s `passkey` insert, add `created_on_device: deviceId`. The Device row is inserted in the same transaction and `deviceId` is already in scope above it.

- [ ] **Step 8: Teach the harness the new shape**

In `api/test/server/harness.ts`, extend `seedInvite`:

```ts
export async function seedInvite(
  db: Kysely<Database>,
  {
    householdId,
    purpose = 'join',
    clock,
    expiresAt,
    personRecorded = true,
    loginId = null,
  }: {
    householdId: string
    purpose?: InvitePurpose
    clock: Clock
    expiresAt?: Date
    /**
     * Defaults to `true` — the ordinary case of an Invite issued for a Person
     * who already exists. The first-joiner case is the exception and states
     * itself.
     */
    personRecorded?: boolean
    /** Required for a device Invite; a join Invite has no Login yet. */
    loginId?: string | null
  },
): Promise<SeededInvite> {
  const { secret, secretHash } = generateInviteSecret()
  const inviteId = systemIdSource.next()
  const personId = systemIdSource.next()

  await db
    .insertInto('invite')
    .values({
      id: inviteId,
      household_id: householdId,
      person_id: personId,
      purpose,
      secret_hash: secretHash,
      login_id: loginId,
      created_by_login: null,
      person_recorded: personRecorded,
      expires_at: expiresAt ?? inviteExpiry(purpose, clock),
    })
    .execute()

  return { secret, inviteId, personId }
}
```

- [ ] **Step 9: Claim the registry slot**

In `docs/testing.md`, add a row to the UUID registry table above the "claim the next free slot" line:

```markdown
| 9 | `0f000009-…-000000000009` | `deviceLink.test.ts` — `person_recorded`, `device/claim` |
```

- [ ] **Step 10: Run the migration and the tests**

```bash
npm run migrate --workspace api
npx vitest run api/test/server/deviceLink.test.ts api/test/server/auth.test.ts api/test/server/migrations.test.ts
```

Expected: all PASS. If `sync.test.ts` is run and fails, confirm it is the known flake by running it alone.

- [ ] **Step 11: Commit**

```bash
git add api/migrations/0004_device_links.ts api/src/db api/src/auth/service.ts \
        api/test/server/harness.ts api/test/server/deviceLink.test.ts docs/testing.md
git commit -m "Record on the Invite whether its Person exists, instead of guessing"
```

---

## Task 2: `POST /auth/device/claim`

Spec §3.1. The one endpoint that can create a Login with no credential.

**Files:**
- Modify: `api/src/auth/service.ts` (add `claimDevice`), `api/src/auth/routes.ts`
- Test: `api/test/server/deviceLink.test.ts`

**Interfaces:**
- Consumes: `findRedeemableInvite`, `issueDeviceToken`, `nextExpiry`, `deviceLabelFrom`, `AuthError`, `AuthContext` (all already in `service.ts`)
- Produces: `claimDevice({ secret, userAgent }) => Promise<{ token: string; context: AuthContext; personId: string }>` — the same shape `finishRegistration` and `finishLogin` return, so the route can reuse their response builder

- [ ] **Step 1: Write the failing tests**

Append to the `describe('device links', …)` block in `api/test/server/deviceLink.test.ts`:

```ts
  describe('POST /auth/device/claim', () => {
    const LOGIN = '0f000009-0000-4000-8000-0000000090b1'
    const PERSON = '0f000009-0000-4000-8000-0000000090b2'

    async function seedLoginHere() {
      await db
        .insertInto('login')
        .values({ id: LOGIN, household_id: HOUSEHOLD, person_id: PERSON })
        .execute()
    }

    function claim(secret: string) {
      return h.app.request('/api/v1/auth/device/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })
    }

    it('signs an existing Login in on a new Device, creating no Passkey', async () => {
      await seedLoginHere()
      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        purpose: 'device',
        clock: h.clock,
        loginId: LOGIN,
      })

      const res = await claim(secret)
      expect(res.status).toBe(200)

      const body = await jsonOf<{
        token: string
        login_id: string
        person_id: string
        household_id: string
        device_id: string
      }>(res)
      expect(body.login_id).toBe(LOGIN)
      expect(body.person_id).toBe(PERSON)
      expect(body.household_id).toBe(HOUSEHOLD)
      expect(body.token.startsWith('foe_')).toBe(true)

      const passkeys = await db
        .selectFrom('passkey')
        .selectAll()
        .where('login_id', '=', LOGIN)
        .execute()
      expect(passkeys).toHaveLength(0)
    })

    it('creates the Login first when the Invite is a join, still with no Passkey', async () => {
      const { secret, personId } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        clock: h.clock,
        personRecorded: false,
      })

      const res = await claim(secret)
      expect(res.status).toBe(200)
      expect(await jsonOf(res)).toMatchObject({ person_id: personId })

      const logins = await db
        .selectFrom('login')
        .selectAll()
        .where('household_id', '=', HOUSEHOLD)
        .execute()
      expect(logins).toHaveLength(1)

      const passkeys = await db
        .selectFrom('passkey')
        .innerJoin('login', 'login.id', 'passkey.login_id')
        .selectAll('passkey')
        .where('login.household_id', '=', HOUSEHOLD)
        .execute()
      expect(passkeys).toHaveLength(0)
    })

    it('refuses a second use of the same link', async () => {
      await seedLoginHere()
      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        purpose: 'device',
        clock: h.clock,
        loginId: LOGIN,
      })

      expect((await claim(secret)).status).toBe(200)
      expect((await claim(secret)).status).toBe(401)

      const devices = await db
        .selectFrom('device')
        .selectAll()
        .where('household_id', '=', HOUSEHOLD)
        .execute()
      expect(devices).toHaveLength(1)
    })

    it('refuses an expired link', async () => {
      await seedLoginHere()
      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        purpose: 'device',
        clock: h.clock,
        loginId: LOGIN,
      })

      // Device Invites last an hour (`auth-design.md` §3.1).
      h.clock.advance(61 * 60 * 1000)
      expect((await claim(secret)).status).toBe(401)
    })

    it('refuses a link whose Login has been disabled', async () => {
      await seedLoginHere()
      await db
        .updateTable('login')
        .set({ disabled_at: new Date(h.clock.now()) })
        .where('id', '=', LOGIN)
        .execute()

      const { secret } = await seedInvite(db, {
        householdId: HOUSEHOLD,
        purpose: 'device',
        clock: h.clock,
        loginId: LOGIN,
      })

      expect((await claim(secret)).status).toBe(401)
    })

    it('answers 400 for a body with no secret, and consumes nothing', async () => {
      const res = await h.app.request('/api/v1/auth/device/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })
  })
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run api/test/server/deviceLink.test.ts`
Expected: FAIL — every claim returns `404`, because the route does not exist.

- [ ] **Step 3: Add `claimDevice` to the service**

In `api/src/auth/service.ts`, add to the returned object immediately after `finishRegistration`:

```ts
    /**
     * The compatibility floor (`auth-design.md` §5): a token for a Device that
     * holds no credential and may never be able to hold one.
     *
     * Serves **both** Invite kinds. A device Invite signs its Login in; a join
     * Invite creates the Login first, exactly as {@link finishRegistration}
     * does, minus the Passkey — so a Person's very first Device can be one
     * that cannot make a credential.
     */
    async claimDevice({
      secret,
      userAgent,
    }: {
      secret: string
      response?: never
      userAgent: string | undefined
    }): Promise<{ token: string; context: AuthContext; personId: string }> {
      const invite = await findRedeemableInvite(secret)

      // A device Invite names its Login; a join Invite creates one. Anything
      // else is a row we did not write.
      if (invite.purpose === 'device' && invite.login_id === null) {
        throw new AuthError('device invite has no login')
      }

      const { token, tokenHash } = issueDeviceToken()
      const loginId = invite.login_id ?? ids.next()
      const deviceId = ids.next()

      await db.transaction().execute(async (trx) => {
        // Claim the Invite with the same statement that checks it. `where
        // used_at is null` is what enforces single-use: two simultaneous
        // redemptions race here and exactly one updates a row.
        const claimed = await trx
          .updateTable('invite')
          .set({ used_at: new Date(clock.now()) })
          .where('id', '=', invite.id)
          .where('used_at', 'is', null)
          .where('revoked_at', 'is', null)
          .returning('id')
          .executeTakeFirst()

        if (claimed === undefined) throw new AuthError('invite already used')

        if (invite.purpose === 'join') {
          await trx
            .insertInto('login')
            .values({
              id: loginId,
              household_id: invite.household_id,
              person_id: invite.person_id,
            })
            .execute()
        } else {
          // A Device for a Login that has since been disabled would 401 on its
          // very first request; refusing here is the same answer, earlier and
          // truthfully. Read inside the transaction so a concurrent disable
          // cannot slip past the check.
          const login = await trx
            .selectFrom('login')
            .select(['id', 'disabled_at'])
            .where('id', '=', loginId)
            .executeTakeFirst()

          if (login === undefined) throw new AuthError('login unknown')
          if (login.disabled_at !== null) throw new AuthError('login disabled')
        }

        await trx
          .insertInto('device')
          .values({
            id: deviceId,
            login_id: loginId,
            household_id: invite.household_id,
            token_hash: tokenHash,
            label: deviceLabelFrom(userAgent),
            expires_at: nextExpiry(clock),
            last_seen_at: new Date(clock.now()),
          })
          .execute()
      })

      return {
        token,
        context: {
          deviceId,
          loginId,
          householdId: invite.household_id,
          personId: invite.person_id,
        },
        personId: invite.person_id,
      }
    },
```

- [ ] **Step 4: Add the route**

In `api/src/auth/routes.ts`, immediately after the `/register/verify` handler. Copy the response shape from that handler so the two agree field for field:

```ts
  // The compatibility floor (auth-design.md §5). Unauthenticated and rate
  // limited like the other redemption routes: the Invite secret is the whole
  // credential.
  auth.post('/device/claim', rateLimited, async (c) => {
    const body = await readJson<{ secret: unknown }>(c)
    if (typeof body.secret !== 'string') return c.json(VAGUE_FAILURE, 400)

    try {
      const { token, context } = await service.claimDevice({
        secret: body.secret,
        userAgent: c.req.header('user-agent'),
      })
      return c.json({
        token,
        login_id: context.loginId,
        person_id: context.personId,
        household_id: context.householdId,
        device_id: context.deviceId,
      })
    } catch (error) {
      return failure(c, error)
    }
  })
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run api/test/server/deviceLink.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
git add api/src/auth/service.ts api/src/auth/routes.ts api/test/server/deviceLink.test.ts
git commit -m "Let a Device claim a token with no credential at all"
```

---

## Task 3: The two Maintainer scripts

Spec §5. After this task the phone can be signed in — the client half is Task 4.

**Files:**
- Create: `api/src/admin/invite.ts`, `api/src/admin/list.ts`
- Modify: `api/src/auth/service.ts` (`mintJoinInvite`, `mintDeviceLink`, `listHouseholds`), `api/package.json`
- Test: `api/test/server/deviceLink.test.ts`

**Interfaces:**
- Produces:
  - `mintJoinInvite({ householdId }) => Promise<{ personId: string; secret: string; expiresAt: Date }>`
  - `mintDeviceLink({ loginId }) => Promise<{ householdId: string; secret: string; expiresAt: Date }>`
  - `listHouseholds() => Promise<Array<{ id: string; name: string; logins: Array<{ id: string; personId: string; createdAt: Date; devices: number }> }>>`

- [ ] **Step 1: Write the failing tests**

Append to `api/test/server/deviceLink.test.ts`, inside the top-level `describe`:

```ts
  describe('the Maintainer scripts', () => {
    const LOGIN = '0f000009-0000-4000-8000-0000000090c1'
    const PERSON = '0f000009-0000-4000-8000-0000000090c2'

    it('mints a join Invite into an existing Household, with person_recorded false', async () => {
      const service = h.service
      const { secret, personId } = await service.mintJoinInvite({
        householdId: HOUSEHOLD,
      })

      expect(personId).toMatch(/^[0-9a-f-]{36}$/)

      const res = await h.app.request('/api/v1/auth/join/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })
      expect(await jsonOf(res)).toMatchObject({
        household_name: 'Veldkamp',
        person_recorded: false,
        purpose: 'join',
      })
    })

    it('mints a device link for an existing Login', async () => {
      await db
        .insertInto('login')
        .values({ id: LOGIN, household_id: HOUSEHOLD, person_id: PERSON })
        .execute()

      const { secret, householdId } = await h.service.mintDeviceLink({
        loginId: LOGIN,
      })
      expect(householdId).toBe(HOUSEHOLD)

      const res = await h.app.request('/api/v1/auth/device/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      })
      expect(await jsonOf(res)).toMatchObject({ login_id: LOGIN })
    })

    it('lists Households with their Logins and Device counts', async () => {
      await db
        .insertInto('login')
        .values({ id: LOGIN, household_id: HOUSEHOLD, person_id: PERSON })
        .execute()

      const households = await h.service.listHouseholds()
      const mine = households.find((row) => row.id === HOUSEHOLD)
      expect(mine?.name).toBe('Veldkamp')
      expect(mine?.logins).toEqual([
        expect.objectContaining({ id: LOGIN, personId: PERSON, devices: 0 }),
      ])
    })
  })
```

The harness does not expose the service yet. In `api/test/server/harness.ts`, add it to `Harness` and build it in `createHarness`:

```ts
import { createAuthService, type AuthService } from '../../src/auth/service.ts'
import { rpConfig } from '../../src/auth/rp.ts'

export interface Harness {
  db: Kysely<Database>
  app: ReturnType<typeof buildApp>
  clock: FakeClock
  /**
   * The same service the app is built over, for the handful of operations that
   * have no HTTP surface — the Maintainer scripts. Sharing the instance keeps
   * one clock across both.
   */
  service: AuthService
}
```

and in the return: `return { db, app, clock, service: createAuthService({ db, clock, ids: systemIdSource, rp: rpConfig('test') }) }`.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run api/test/server/deviceLink.test.ts -t "Maintainer scripts"`
Expected: FAIL — `h.service.mintJoinInvite is not a function`.

- [ ] **Step 3: Add the three service methods**

In `api/src/auth/service.ts`, after `bootstrapHousehold`:

```ts
    /**
     * A join Invite into a Household that already exists.
     *
     * `auth-design.md` §3.4 puts only a Household's *first* Login out of band,
     * and every later Invite is meant to be issued in-app against a Person the
     * inviter picked. Until S5 builds that picker there is no route at all for
     * a second Login, so this is the Maintainer's stand-in: it pre-binds a
     * fresh Person id exactly as the bootstrap does, and the joiner names
     * themselves.
     */
    async mintJoinInvite({ householdId }: { householdId: string }): Promise<{
      personId: string
      secret: string
      expiresAt: Date
    }> {
      const household = await db
        .selectFrom('household')
        .select('id')
        .where('id', '=', householdId)
        .executeTakeFirst()
      if (household === undefined) throw new AuthError('household unknown')

      const personId = ids.next()
      const { secret, secretHash } = generateInviteSecret()
      const expiresAt = inviteExpiry('join', clock)

      await db
        .insertInto('invite')
        .values({
          id: ids.next(),
          household_id: householdId,
          person_id: personId,
          purpose: 'join',
          secret_hash: secretHash,
          login_id: null,
          created_by_login: null,
          person_recorded: false,
          expires_at: expiresAt,
        })
        .execute()

      return { personId, secret, expiresAt }
    },

    /**
     * A device link for an existing Login, minted with server access.
     *
     * `auth-design.md` §5 names the case this exists for — a Household with one
     * Login and no passkey, signed in nowhere — as "the single case in this
     * design that leaves the product". Until now it had a sentence and no
     * mechanism.
     */
    async mintDeviceLink({ loginId }: { loginId: string }): Promise<{
      householdId: string
      secret: string
      expiresAt: Date
    }> {
      const login = await db
        .selectFrom('login')
        .select(['id', 'household_id', 'person_id', 'disabled_at'])
        .where('id', '=', loginId)
        .executeTakeFirst()

      if (login === undefined) throw new AuthError('login unknown')
      if (login.disabled_at !== null) throw new AuthError('login disabled')

      const { secret, secretHash } = generateInviteSecret()
      const expiresAt = inviteExpiry('device', clock)

      await db
        .insertInto('invite')
        .values({
          id: ids.next(),
          household_id: login.household_id,
          person_id: login.person_id,
          purpose: 'device',
          secret_hash: secretHash,
          login_id: loginId,
          created_by_login: null,
          // A device link never creates a Person; the value is inert here and
          // stated only because the column has no default.
          person_recorded: true,
          expires_at: expiresAt,
        })
        .execute()

      return { householdId: login.household_id, secret, expiresAt }
    },

    /** The Maintainer's only window onto who exists. Reads nothing secret. */
    async listHouseholds(): Promise<
      Array<{
        id: string
        name: string
        logins: Array<{
          id: string
          personId: string
          createdAt: Date
          devices: number
        }>
      }>
    > {
      const households = await db
        .selectFrom('household')
        .select(['id', 'name'])
        .orderBy('name')
        .execute()

      const logins = await db
        .selectFrom('login')
        .leftJoin('device', (join) =>
          join
            .onRef('device.login_id', '=', 'login.id')
            .on('device.revoked_at', 'is', null),
        )
        .select(({ fn }) => [
          'login.id as id',
          'login.household_id as household_id',
          'login.person_id as person_id',
          'login.created_at as created_at',
          fn.count<string>('device.id').as('devices'),
        ])
        .groupBy(['login.id', 'login.household_id', 'login.person_id', 'login.created_at'])
        .execute()

      return households.map((household) => ({
        id: household.id,
        name: household.name,
        logins: logins
          .filter((login) => login.household_id === household.id)
          .map((login) => ({
            id: login.id,
            personId: login.person_id,
            createdAt: login.created_at,
            // `count` reaches the driver as a string; see `db/index.ts`.
            devices: Number(login.devices),
          })),
      }))
    },
```

Add `inviteExpiry` to the existing `./invite.ts` import at the top of the file.

- [ ] **Step 4: Write `admin:invite`**

Create `api/src/admin/invite.ts`. Mirror `bootstrap.ts` exactly — the same `parseArgs`, the same production/development mode split, the same origin-aware link printing, because a production link handed to someone running `npm run dev` fails as an RP-ID mismatch that reads like a bug:

```ts
import { parseArgs } from 'node:util'

import { systemClock, systemIdSource } from '@foerier/shared'

import { createAuthService } from '../auth/service.ts'
import { PRODUCTION_ORIGIN, rpConfig } from '../auth/rp.ts'
import { loadConfig } from '../config.ts'
import { createDb } from '../db/index.ts'

/**
 * The Maintainer's break-glass Invite (`auth-design.md` §5, §3.4).
 *
 *   npm run admin:invite -- --household <id>   a join Invite; the joiner names themselves
 *   npm run admin:invite -- --login <id>       a device link for an existing Login
 *
 * Neither is the normal path. In-app issuance is story 28 (S5) for join
 * Invites and the Account screen for device links; this exists because a
 * second Login has no route at all before S5, and because §5's "the single
 * case in this design that leaves the product" needed a mechanism rather than
 * a sentence.
 *
 * Run `npm run admin:list` to find either id.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { household: { type: 'string' }, login: { type: 'string' } },
  })

  const mode =
    process.env['NODE_ENV'] === 'production' ? 'production' : 'development'
  const usage =
    mode === 'production'
      ? 'usage: node dist/invite.js (--household <id> | --login <id>)'
      : 'usage: npm run admin:invite -- (--household <id> | --login <id>)'

  const household = values.household?.trim()
  const login = values.login?.trim()

  if ((household === undefined) === (login === undefined)) {
    console.error(usage)
    console.error('exactly one of --household or --login is required')
    process.exit(2)
  }

  const config = loadConfig()
  const db = createDb(config.databaseUrl)

  try {
    const service = createAuthService({
      db,
      clock: systemClock,
      ids: systemIdSource,
      rp: rpConfig(mode),
    })

    const appOrigin =
      mode === 'production' ? PRODUCTION_ORIGIN : 'http://localhost:5173'

    if (household !== undefined) {
      const { personId, secret, expiresAt } = await service.mintJoinInvite({
        householdId: household,
      })
      console.log('')
      console.log('Join invite — single use, 7 days, hand it over out of band:')
      console.log(`  person_id   ${personId}   (pre-bound; the joiner names themselves)`)
      console.log(`  expires     ${expiresAt.toISOString()}`)
      console.log('')
      console.log(`  ${appOrigin}/join#${secret}`)
      console.log('')
    } else {
      const { householdId, secret, expiresAt } = await service.mintDeviceLink({
        loginId: login as string,
      })
      console.log('')
      console.log('Device link — single use, 1 hour. The link is the credential.')
      console.log(`  household_id  ${householdId}`)
      console.log(`  expires       ${expiresAt.toISOString()}`)
      console.log('')
      console.log(`  ${appOrigin}/join#${secret}`)
      console.log('')
    }
  } finally {
    await db.destroy()
  }
}

await main()
```

- [ ] **Step 5: Write `admin:list`**

Create `api/src/admin/list.ts`:

```ts
import { systemClock, systemIdSource } from '@foerier/shared'

import { createAuthService } from '../auth/service.ts'
import { rpConfig } from '../auth/rp.ts'
import { loadConfig } from '../config.ts'
import { createDb } from '../db/index.ts'

/**
 * Households and their Logins (`auth-design.md` §5).
 *
 *   npm run admin:list
 *
 * Load-bearing rather than a convenience: `admin:invite --login <id>` cannot
 * be used without a way to find the id, and the alternative is the Maintainer
 * writing SQL against a production database to do routine recovery.
 *
 * Prints no token, no token hash, no secret hash, and no challenge (§9.4). A
 * `person_id` is an opaque UUID with no meaning to the server — the name it
 * points at lives in the op log, which this process has no view of.
 */
async function main(): Promise<void> {
  const mode =
    process.env['NODE_ENV'] === 'production' ? 'production' : 'development'
  const config = loadConfig()
  const db = createDb(config.databaseUrl)

  try {
    const service = createAuthService({
      db,
      clock: systemClock,
      ids: systemIdSource,
      rp: rpConfig(mode),
    })

    const households = await service.listHouseholds()
    if (households.length === 0) {
      console.log('No households. Run admin:bootstrap to create one.')
      return
    }

    for (const household of households) {
      console.log('')
      console.log(`${household.name}`)
      console.log(`  household_id  ${household.id}`)
      if (household.logins.length === 0) {
        console.log('  (no logins — its join invite is still outstanding)')
        continue
      }
      for (const login of household.logins) {
        console.log(
          `  login  ${login.id}  person ${login.personId}  ` +
            `${String(login.devices)} device(s)  since ${login.createdAt.toISOString().slice(0, 10)}`,
        )
      }
    }
    console.log('')
  } finally {
    await db.destroy()
  }
}

await main()
```

- [ ] **Step 6: Register the scripts**

In `api/package.json`, beside `admin:bootstrap`:

```json
    "admin:invite": "node src/admin/invite.ts",
    "admin:list": "node src/admin/list.ts"
```

- [ ] **Step 7: Run the tests and both scripts for real**

```bash
npx vitest run api/test/server/deviceLink.test.ts
npm run admin:list --workspace api
```

Expected: tests PASS; `admin:list` prints the households in your dev database (or the "No households" line). Then mint a link against a real Login id from that output and check it prints a `/join#…` URL.

- [ ] **Step 8: Commit**

```bash
git add api/src/admin api/src/auth/service.ts api/package.json \
        api/test/server/harness.ts api/test/server/deviceLink.test.ts
git commit -m "Give the Maintainer a second Login and a break-glass device link"
```

---

## Task 4: The client claims a link — the milestone task

Spec §6.5's door, §8's departure, §9's persistence. **After this task the passkey-less phone is signed in.** Everything after it is the in-app replacement for Task 3's script.

**Files:**
- Create: `app/src/screens/NoPasskey.tsx`, `app/src/screens/NoPasskey.module.css`, `app/src/screens/NoPasskey.test.tsx`
- Modify: `app/src/auth/api.ts`, `app/src/screens/Join.tsx`, `app/src/screens/JoinContainer.tsx`, `app/src/App.tsx`
- Test: `app/src/screens/NoPasskey.test.tsx`, `app/src/screens/Join.test.tsx`

**Interfaces:**
- Consumes: `claimDevice` from Task 2's route; `Session` from `app/src/auth/sessionStore`
- Produces: `api.claimDevice(secret) => Promise<SignedIn>`; `<NoPasskey personName={string | null} onContinue={() => Promise<void>} />`

- [ ] **Step 1: Write the failing component test**

Create `app/src/screens/NoPasskey.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { NoPasskey } from './NoPasskey'

/**
 * Boards §10. The anatomy *is* the argument: a Device on this path is a
 * first-class Device, and the screen says so by looking identical to the one
 * that made a passkey. Any amber, any ▲, any "however" is the bug.
 */
describe('Continue without a passkey', () => {
  it('names the person on the primary, as the boards draw it', () => {
    render(<NoPasskey personName="Els" onContinue={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: 'Continue as Els' }),
    ).toBeInTheDocument()
  })

  it('falls back to an unnamed primary when no Person is known yet', () => {
    render(<NoPasskey personName={null} onContinue={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })

  it('states the fact without claiming the device cannot', () => {
    render(<NoPasskey personName="Els" onContinue={vi.fn()} />)
    // The S3.5 departure: "This device cannot make one" is sometimes false.
    expect(screen.getByText(/No passkey is made here\./)).toBeInTheDocument()
    expect(
      screen.getByText(/You stay signed in until you sign out\./),
    ).toBeInTheDocument()
  })

  it('carries no warning affordance of any kind', () => {
    const { container } = render(
      <NoPasskey personName="Els" onContinue={vi.fn()} />,
    )
    expect(container.textContent).not.toContain('▲')
    expect(container.textContent).not.toMatch(/however|instead|unfortunately/i)
  })

  it('continues exactly once, even on a double tap', async () => {
    const onContinue = vi.fn().mockResolvedValue(undefined)
    render(<NoPasskey personName="Els" onContinue={onContinue} />)

    const button = screen.getByRole('button', { name: 'Continue as Els' })
    await userEvent.click(button)
    await userEvent.click(button)

    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run app/src/screens/NoPasskey.test.tsx`
Expected: FAIL — `Failed to resolve import "./NoPasskey"`.

- [ ] **Step 3: Build the screen**

Create `app/src/screens/NoPasskey.tsx`. Take the CSS module and the layout skeleton from `app/src/screens/SignIn.tsx` — the same centred stack and the same 48px accent primary:

```tsx
import { useState } from 'react'

import styles from './NoPasskey.module.css'

export interface NoPasskeyProps {
  /** Null while the Person exists only as a pre-bound id (`auth-design.md` §2.1). */
  personName: string | null
  onContinue: () => Promise<void>
}

/**
 * The compatibility path (`docs/design/README.md` §10), drawn deliberately
 * first-class: the same accent primary as every other confirm, **no amber, no
 * ▲, no "however"**.
 *
 * The first line reads "No passkey is made here" rather than the boards'
 * original "This device cannot make one" — the S3.5 departure. On the Android
 * builds this path exists for, the device *can* make one; what it cannot do is
 * make one in the credential store the household chose. A line that is
 * sometimes false fails this screen's whole discipline of stating plain facts.
 */
export function NoPasskey({ personName, onContinue }: NoPasskeyProps) {
  const [busy, setBusy] = useState(false)

  async function go() {
    if (busy) return
    setBusy(true)
    try {
      await onContinue()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['screen']}>
      <h1 className={styles['title']}>Continue without a passkey</h1>
      <p className={styles['body']}>
        No passkey is made here. It stays signed in anyway — nothing is limited.
      </p>
      <p className={styles['body']}>
        A passkey added later, on any device that supports one, makes future
        sign-ins self-service.
      </p>
      <p className={styles['fact']}>You stay signed in until you sign out.</p>

      <div className={styles['spacer']} />

      <button
        type="button"
        className={styles['primary']}
        onClick={() => void go()}
        disabled={busy}
      >
        {personName === null ? 'Continue' : `Continue as ${personName}`}
      </button>
    </div>
  )
}
```

Create `app/src/screens/NoPasskey.module.css` by copying the `screen`, `title`, `fact`, `spacer` and primary-button rules from `SignIn.module.css` and adding a `body` rule at `font-size: 15px; line-height: 22px; margin-top: 12px`. Use the existing token variables; introduce no new colour literals.

- [ ] **Step 4: Run the component test**

Run: `npx vitest run app/src/screens/NoPasskey.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the client API method**

In `app/src/auth/api.ts`, inside the returned object after `registerVerify`:

```ts
    /**
     * Redeems either Invite kind for a token with **no credential**
     * (`auth-design.md` §5). The same response shape as `registerVerify`,
     * because the Device it produces is the same kind of Device.
     */
    claimDevice: (secret: string) =>
      post<SignedIn>('/auth/device/claim', { secret }),
```

- [ ] **Step 6: Write the failing test for the join screen's door**

Append to `app/src/screens/Join.test.tsx`, inside the confirm-frame describe:

```tsx
  it('offers the passkey-less path as a deliberate choice, not only a fallback', async () => {
    const onNoPasskey = vi.fn()
    render(
      <Join
        preview={previewFixture()}
        deadEnd={null}
        onConfirm={vi.fn()}
        onOpenSignIn={vi.fn()}
        onNoPasskey={onNoPasskey}
        signedIn={false}
        onOpenDepot={vi.fn()}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'No passkey on this device?' }),
    )
    expect(onNoPasskey).toHaveBeenCalledTimes(1)
  })
```

Reuse whatever `previewFixture()` (or inline preview object) that file already uses for its other confirm-frame tests — do not invent a second fixture shape.

- [ ] **Step 7: Add the ghost to `Join.tsx`**

Add `onNoPasskey: () => void` to `JoinProps`, and render it directly beneath the primary, above the `Not Els?` quiet line:

```tsx
      {/* The S3.5 door (`docs/design/README.md` §10). The sign-in screen uses
          these exact words for its explainer sheet; here a secret is in hand,
          so they lead to the screen itself. Two destinations, deliberately —
          wiring both to one makes one of them a dead end. */}
      <button
        type="button"
        className={styles['ghost']}
        onClick={onNoPasskey}
      >
        No passkey on this device?
      </button>
```

Reuse the `ghost` class already in `Join.module.css` if one exists; otherwise copy the ghost-button rule from `SignIn.module.css`.

- [ ] **Step 8: Wire the claim path in `JoinContainer.tsx`**

Add a `noPasskey` state flag and a `claim` function beside `confirm`:

```tsx
  const [noPasskey, setNoPasskey] = useState(false)

  /**
   * The token-only path. No ceremony runs at all, so there is nothing to
   * detect and nothing that can be declined — which is exactly why it is also
   * reachable from the confirm frame's ghost, not only from a failure.
   */
  async function claim(name: string | null) {
    if (secret === null) return

    const result = await api.claimDevice(secret)

    if (name !== null && name !== '') {
      await pending.save({
        personId: result.person_id,
        householdId: result.household_id,
        name,
      })
    }

    await onSignedIn({
      token: result.token,
      loginId: result.login_id,
      personId: result.person_id,
      householdId: result.household_id,
      deviceId: result.device_id,
    })
    setJustJoined(true)
    setNoPasskey(false)
  }
```

Then wrap `confirm` so a ceremony that cannot run falls through rather than dead-ending:

```tsx
  async function confirmOrFallThrough(name: string | null) {
    // `auth-design.md` §5: absent API, no usable authenticator, or a plain
    // refusal all land in the same place. The ghost door reaches it too, for
    // the device that *can* make a credential in a store its owner declined.
    if (typeof window.PublicKeyCredential !== 'function') {
      setNoPasskey(true)
      return
    }
    try {
      await confirm(name)
    } catch {
      setNoPasskey(true)
    }
  }
```

Render `NoPasskey` when the flag is set, resolving the name from the preview when there is one:

```tsx
  if (noPasskey && preview !== null) {
    return (
      <NoPasskey
        personName={null}
        onContinue={() => claim(pendingName)}
      />
    )
  }
```

`pendingName` is the name the joiner typed on the "name yourself" frame; hold it in `JoinContainer` state (`const [pendingName, setPendingName] = useState<string | null>(null)`) and set it from `Join`'s existing name field via a new `onNameChange` prop, so the value survives the swap to `NoPasskey`. Pass `onNoPasskey={() => setNoPasskey(true)}` down to `Join`.

- [ ] **Step 9: Ask for persistent storage**

In `app/src/App.tsx`, add above the `App` component:

```ts
/**
 * Ask the browser not to evict us.
 *
 * It matters more from S3.5 on than it did before: a Device with no passkey
 * **cannot re-sign-in by itself** — lose the database and you lose the token,
 * and the way back is another Device's link. It protects the op log too, which
 * is the larger prize; the same eviction takes unsynced work with it.
 *
 * Best effort by design. An installed PWA on Android is generally granted this
 * automatically and a plain tab generally is not, and there is nothing useful
 * to tell the user either way.
 */
function requestPersistentStorage(): void {
  void navigator.storage?.persist?.().catch(() => undefined)
}
```

Call it from `signIn`'s caller path — the simplest correct place is inside the existing `useEffect` that builds the depot, immediately before `createDepot(session)`.

- [ ] **Step 10: Run everything client-side**

Run: `npx vitest run app/src`
Expected: PASS. Fix any `JoinProps` type errors in existing tests by adding `onNoPasskey={vi.fn()}` to their render calls.

- [ ] **Step 11: Commit**

```bash
git add app/src/screens/NoPasskey.tsx app/src/screens/NoPasskey.module.css \
        app/src/screens/NoPasskey.test.tsx app/src/screens/Join.tsx \
        app/src/screens/Join.test.tsx app/src/screens/JoinContainer.tsx \
        app/src/auth/api.ts app/src/App.tsx
git commit -m "Let a device with no usable credential store in, by choice"
```

**Checkpoint:** mint a device link with `npm run admin:invite -- --login <id>`, open it on the constrained phone, and confirm it signs in and syncs. This is the outcome the whole slice was pulled forward for; do not proceed until it works on real hardware.

---

## Task 5: `POST · GET · DELETE /auth/invites`

Spec §3. Device purpose only.

**Files:**
- Modify: `api/src/auth/service.ts`, `api/src/auth/routes.ts`
- Test: `api/test/server/account.test.ts` (create)

**Interfaces:**
- Produces:
  - `issueDeviceLink(context: AuthContext) => Promise<{ inviteId: string; secret: string; expiresAt: Date }>`
  - `listInvites(context: AuthContext) => Promise<Array<{ id: string; purpose: InvitePurpose; expiresAt: Date }>>`
  - `revokeInvite(context: AuthContext, inviteId: string) => Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `api/test/server/account.test.ts` with the same beforeAll/afterAll/beforeEach skeleton as `deviceLink.test.ts`, using slot **#10** (`0f00000a-0000-4000-8000-00000000000a`) and household name `Veldkamp`. Add a `signedInDevice()` helper that inserts a `login` and a `device` with a known token, then:

```ts
  describe('POST /auth/invites', () => {
    it('issues a device link for the calling Login and returns the secret once', async () => {
      const { token, loginId } = await signedInDevice()

      const res = await h.app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ purpose: 'device' }),
      })

      expect(res.status).toBe(200)
      const body = await jsonOf<{ id: string; secret: string; expires_at: string }>(res)
      expect(body.secret).toHaveLength(43)

      const invite = await db
        .selectFrom('invite')
        .selectAll()
        .where('id', '=', body.id)
        .executeTakeFirstOrThrow()
      expect(invite.purpose).toBe('device')
      expect(invite.login_id).toBe(loginId)
      expect(invite.created_by_login).toBe(loginId)
    })

    it('expires a device link in one hour, not seven days', async () => {
      const { token } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ purpose: 'device' }),
      })
      const body = await jsonOf<{ expires_at: string }>(res)
      expect(Date.parse(body.expires_at) - h.clock.now()).toBe(60 * 60 * 1000)
    })

    it('refuses a join purpose until S5 can name a Person', async () => {
      const { token } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ purpose: 'join' }),
      })

      expect(res.status).toBe(400)
      const invites = await db
        .selectFrom('invite')
        .selectAll()
        .where('household_id', '=', HOUSEHOLD)
        .execute()
      expect(invites).toHaveLength(0)
    })

    it('rejects an unauthenticated caller', async () => {
      const res = await h.app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'device' }),
      })
      expect(res.status).toBe(401)
    })
  })

  describe('GET and DELETE /auth/invites', () => {
    it('lists outstanding invites without ever returning the secret', async () => {
      const { token } = await signedInDevice()
      await h.app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ purpose: 'device' }),
      })

      const res = await h.app.request('/api/v1/auth/invites', {
        headers: { authorization: `Bearer ${token}` },
      })
      const body = await jsonOf<{ invites: Array<Record<string, unknown>> }>(res)
      expect(body.invites).toHaveLength(1)
      expect(body.invites[0]).not.toHaveProperty('secret')
      expect(body.invites[0]).not.toHaveProperty('secret_hash')
    })

    it('revokes one, after which it cannot be claimed', async () => {
      const { token } = await signedInDevice()
      const issued = await jsonOf<{ id: string; secret: string }>(
        await h.app.request('/api/v1/auth/invites', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ purpose: 'device' }),
        }),
      )

      const del = await h.app.request(`/api/v1/auth/invites/${issued.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(del.status).toBe(204)

      const claim = await h.app.request('/api/v1/auth/device/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: issued.secret }),
      })
      expect(claim.status).toBe(401)
    })
  })
```

Claim slot #10 in `docs/testing.md`:

```markdown
| 10 | `0f00000a-…-00000000000a` | `account.test.ts` — invites, devices, passkeys, `/auth/me` |
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run api/test/server/account.test.ts`
Expected: FAIL — `404` on every request; the routes do not exist.

- [ ] **Step 3: Add the service methods**

In `api/src/auth/service.ts`, after `mintDeviceLink`:

```ts
    /** A device link for the caller's own Login, issued from a signed-in Device. */
    async issueDeviceLink(context: AuthContext): Promise<{
      inviteId: string
      secret: string
      expiresAt: Date
    }> {
      const inviteId = ids.next()
      const { secret, secretHash } = generateInviteSecret()
      const expiresAt = inviteExpiry('device', clock)

      await db
        .insertInto('invite')
        .values({
          id: inviteId,
          // From the token, never the request — the tenancy rule (§9.3).
          household_id: context.householdId,
          person_id: context.personId,
          purpose: 'device',
          secret_hash: secretHash,
          login_id: context.loginId,
          created_by_login: context.loginId,
          person_recorded: true,
          expires_at: expiresAt,
        })
        .execute()

      return { inviteId, secret, expiresAt }
    },

    /**
     * Invites this Login issued and has not spent. Never returns the secret:
     * it exists only in the link, and the row holds a hash (§3.1).
     */
    async listInvites(context: AuthContext): Promise<
      Array<{ id: string; purpose: InvitePurpose; expiresAt: Date }>
    > {
      const rows = await db
        .selectFrom('invite')
        .select(['id', 'purpose', 'expires_at'])
        .where('household_id', '=', context.householdId)
        .where('created_by_login', '=', context.loginId)
        .where('used_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', new Date(clock.now()))
        .orderBy('expires_at')
        .execute()

      return rows.map((row) => ({
        id: row.id,
        purpose: row.purpose,
        expiresAt: row.expires_at,
      }))
    },

    /** Kills the link, never any data. Scoped to the caller's own Household. */
    async revokeInvite(context: AuthContext, inviteId: string): Promise<void> {
      await db
        .updateTable('invite')
        .set({ revoked_at: new Date(clock.now()) })
        .where('id', '=', inviteId)
        .where('household_id', '=', context.householdId)
        .where('created_by_login', '=', context.loginId)
        .execute()
    },
```

- [ ] **Step 4: Add the routes**

In `api/src/auth/routes.ts`, after `/signout`:

```ts
  auth.post('/invites', requireAuth, async (c) => {
    const body = await readJson<{ purpose: unknown }>(c)

    // Only `device` until S5. A join Invite must name a Person, and there is
    // no way to pick one before S4 records People — accepting one here would
    // produce exactly the unnamed-Quartermaster defect 0004 exists to prevent.
    // A plain 400 rather than the vague failure: there is no secret to protect
    // and no enumeration surface, so being precise costs nothing.
    if (body.purpose !== 'device') {
      return c.json({ error: 'unsupported_purpose' }, 400)
    }

    const { inviteId, secret, expiresAt } = await service.issueDeviceLink(
      c.get('auth'),
    )
    return c.json({
      id: inviteId,
      secret,
      expires_at: expiresAt.toISOString(),
    })
  })

  auth.get('/invites', requireAuth, async (c) => {
    const invites = await service.listInvites(c.get('auth'))
    return c.json({
      invites: invites.map((invite) => ({
        id: invite.id,
        purpose: invite.purpose,
        expires_at: invite.expiresAt.toISOString(),
      })),
    })
  })

  auth.delete('/invites/:id', requireAuth, async (c) => {
    await service.revokeInvite(c.get('auth'), c.req.param('id'))
    // 204 whether or not a row matched: "not yours" and "does not exist" are
    // the same answer, and the caller's next GET is the source of truth.
    return c.body(null, 204)
  })
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run api/test/server/account.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/auth/service.ts api/src/auth/routes.ts \
        api/test/server/account.test.ts docs/testing.md
git commit -m "Issue, list and revoke a device link from a signed-in Device"
```

---

## Task 6: `GET /auth/devices`, `DELETE /auth/devices/:id`, and `household_name`

Spec §3.2, §3.3.

**Files:**
- Modify: `api/src/auth/service.ts`, `api/src/auth/routes.ts`
- Test: `api/test/server/account.test.ts`

**Interfaces:**
- Produces:
  - `listDevices(context) => Promise<Array<{ id: string; label: string | null; createdAt: Date; lastSeenAt: Date; current: boolean; enrolledPasskeyHere: boolean }>>`
  - `revokeDevice(context, deviceId) => Promise<void>`
  - `me(context) => Promise<{ householdName: string }>`

- [ ] **Step 1: Write the failing tests**

Append to `api/test/server/account.test.ts`:

```ts
  describe('GET /auth/devices', () => {
    it('marks the calling Device as the current one', async () => {
      const { token, deviceId } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/devices', {
        headers: { authorization: `Bearer ${token}` },
      })

      const body = await jsonOf<{
        devices: Array<{ id: string; current: boolean; enrolled_passkey_here: boolean }>
      }>(res)
      const mine = body.devices.find((device) => device.id === deviceId)
      expect(mine?.current).toBe(true)
      // Seeded straight into the table, so no ceremony ever ran on it.
      expect(mine?.enrolled_passkey_here).toBe(false)
    })

    it('never lists another Login’s Devices', async () => {
      const mine = await signedInDevice()
      const theirs = await signedInDevice({ suffix: 'b' })

      const res = await h.app.request('/api/v1/auth/devices', {
        headers: { authorization: `Bearer ${mine.token}` },
      })
      const body = await jsonOf<{ devices: Array<{ id: string }> }>(res)
      expect(body.devices.map((device) => device.id)).not.toContain(
        theirs.deviceId,
      )
    })
  })

  describe('DELETE /auth/devices/:id', () => {
    it('revokes another of my Devices, which then 401s at its next request', async () => {
      const first = await signedInDevice()
      const second = await signedInDevice({ sameLoginAs: first })

      const del = await h.app.request(`/api/v1/auth/devices/${second.deviceId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${first.token}` },
      })
      expect(del.status).toBe(204)

      const after = await h.app.request('/api/v1/auth/me', {
        headers: { authorization: `Bearer ${second.token}` },
      })
      expect(after.status).toBe(401)
    })

    it('leaves another Login’s Device working', async () => {
      const mine = await signedInDevice()
      const theirs = await signedInDevice({ suffix: 'b' })

      await h.app.request(`/api/v1/auth/devices/${theirs.deviceId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${mine.token}` },
      })

      const after = await h.app.request('/api/v1/auth/me', {
        headers: { authorization: `Bearer ${theirs.token}` },
      })
      expect(after.status).toBe(200)
    })
  })

  describe('GET /auth/me', () => {
    it('carries the household name the Account screen has to print', async () => {
      const { token } = await signedInDevice()
      const res = await h.app.request('/api/v1/auth/me', {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(await jsonOf(res)).toMatchObject({ household_name: 'Veldkamp' })
    })
  })
```

Extend `signedInDevice` to take `{ suffix?: string; sameLoginAs?: { loginId: string } }` and return `{ token, loginId, deviceId }`.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run api/test/server/account.test.ts -t "devices"`
Expected: FAIL — `404` on `/auth/devices`; `household_name` absent from `/auth/me`.

- [ ] **Step 3: Add the service methods**

```ts
    /**
     * Every Device signed in as this Login. Coarse labels only — no IPs, no
     * fingerprinting (`docs/design/README.md` §12).
     */
    async listDevices(context: AuthContext): Promise<
      Array<{
        id: string
        label: string | null
        createdAt: Date
        lastSeenAt: Date
        current: boolean
        enrolledPasskeyHere: boolean
      }>
    > {
      const rows = await db
        .selectFrom('device')
        .leftJoin('passkey', 'passkey.created_on_device', 'device.id')
        .select(({ fn }) => [
          'device.id as id',
          'device.label as label',
          'device.created_at as created_at',
          'device.last_seen_at as last_seen_at',
          fn.count<string>('passkey.id').as('passkeys'),
        ])
        .where('device.login_id', '=', context.loginId)
        .where('device.revoked_at', 'is', null)
        .groupBy(['device.id', 'device.label', 'device.created_at', 'device.last_seen_at'])
        .orderBy('device.last_seen_at', 'desc')
        .execute()

      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        current: row.id === context.deviceId,
        // Enrolment, not reachability: a credential synced through a password
        // manager works on Devices that never enrolled it, and the server
        // cannot see that. The board's line says what happened here.
        enrolledPasskeyHere: Number(row.passkeys) > 0,
      }))
    },

    /**
     * Cuts a Device off. Scoped to the caller's own Login: cross-Login
     * revocation is `DELETE /auth/logins/:id`, which is story 28's.
     */
    async revokeDevice(context: AuthContext, deviceId: string): Promise<void> {
      await db
        .updateTable('device')
        .set({ revoked_at: new Date(clock.now()) })
        .where('id', '=', deviceId)
        .where('login_id', '=', context.loginId)
        .execute()
    },

    /** The household's name, which unlike the Person's is a server fact. */
    async me(context: AuthContext): Promise<{ householdName: string }> {
      const household = await db
        .selectFrom('household')
        .select('name')
        .where('id', '=', context.householdId)
        .executeTakeFirst()

      if (household === undefined) throw new AuthError('household missing')
      return { householdName: household.name }
    },
```

- [ ] **Step 4: Add the routes and extend `/auth/me`**

```ts
  auth.get('/devices', requireAuth, async (c) => {
    const devices = await service.listDevices(c.get('auth'))
    return c.json({
      devices: devices.map((device) => ({
        id: device.id,
        label: device.label,
        created_at: device.createdAt.toISOString(),
        last_seen_at: device.lastSeenAt.toISOString(),
        current: device.current,
        enrolled_passkey_here: device.enrolledPasskeyHere,
      })),
    })
  })

  auth.delete('/devices/:id', requireAuth, async (c) => {
    await service.revokeDevice(c.get('auth'), c.req.param('id'))
    return c.body(null, 204)
  })
```

Replace the existing `/me` handler — it becomes async, because the household name is a read:

```ts
  auth.get('/me', requireAuth, async (c) => {
    const context = c.get('auth')
    const { householdName } = await service.me(context)
    return c.json({
      login_id: context.loginId,
      person_id: context.personId,
      household_id: context.householdId,
      household_name: householdName,
      device_id: context.deviceId,
    })
  })
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run api/test/server/account.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/auth/service.ts api/src/auth/routes.ts api/test/server/account.test.ts
git commit -m "List and cut off Devices, and tell the client its household's name"
```

---

## Task 7: Passkeys — add with a name, list, remove the last one

Spec §6.5.

**Files:**
- Modify: `api/src/auth/service.ts`, `api/src/auth/routes.ts`
- Test: `api/test/server/account.test.ts`

**Interfaces:**
- Produces:
  - `beginAddPasskey(context) => Promise<PublicKeyCredentialCreationOptionsJSON>`
  - `finishAddPasskey({ context, response, label }) => Promise<{ passkeyId: string }>`
  - `listPasskeys(context) => Promise<Array<{ id: string; label: string | null; createdAt: Date; lastUsedAt: Date | null }>>`
  - `removePasskey(context, passkeyId) => Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `api/test/server/account.test.ts`. Use `SoftwareAuthenticator` exactly as `auth.test.ts` does — read that file's registration test first and mirror its setup:

```ts
  describe('passkeys', () => {
    it('adds one to an existing Login, with the name the person gave it', async () => {
      const { token, loginId, deviceId } = await signedInDevice()
      const authenticator = new SoftwareAuthenticator(TEST_RP_ID, TEST_ORIGIN)

      const options = await jsonOf<PublicKeyCredentialCreationOptionsJSON>(
        await h.app.request('/api/v1/auth/passkeys/options', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        }),
      )

      const res = await h.app.request('/api/v1/auth/passkeys/verify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          response: await authenticator.create(options),
          label: 'YubiKey, desk drawer',
        }),
      })
      expect(res.status).toBe(200)

      const rows = await db
        .selectFrom('passkey')
        .selectAll()
        .where('login_id', '=', loginId)
        .execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.label).toBe('YubiKey, desk drawer')
      // Which Device enrolled it — what makes `NO PASSKEY HERE` renderable.
      expect(rows[0]?.created_on_device).toBe(deviceId)
    })

    it('falls back to the derived Device label when none is given', async () => {
      const { token, loginId } = await signedInDevice()
      const authenticator = new SoftwareAuthenticator(TEST_RP_ID, TEST_ORIGIN)

      const options = await jsonOf<PublicKeyCredentialCreationOptionsJSON>(
        await h.app.request('/api/v1/auth/passkeys/options', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        }),
      )
      await h.app.request('/api/v1/auth/passkeys/verify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'user-agent':
            'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
        },
        body: JSON.stringify({ response: await authenticator.create(options) }),
      })

      const rows = await db
        .selectFrom('passkey')
        .selectAll()
        .where('login_id', '=', loginId)
        .execute()
      expect(rows[0]?.label).toBe('Firefox on Android')
    })

    it('allows removing the last passkey, leaving a device-link-only Login', async () => {
      const { token, loginId } = await signedInDevice()
      await db
        .insertInto('passkey')
        .values({
          id: '0f00000a-0000-4000-8000-0000000000f1',
          login_id: loginId,
          credential_id: Buffer.from('only-one'),
          public_key: Buffer.from('key'),
          sign_count: 0,
          transports: null,
          aaguid: null,
          uv_seen: true,
          label: 'The only one',
          created_on_device: null,
        })
        .execute()

      const res = await h.app.request(
        '/api/v1/auth/passkeys/0f00000a-0000-4000-8000-0000000000f1',
        { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
      )
      expect(res.status).toBe(204)

      // Dropping to zero is legal (`auth-design.md` §2, §5) — the Login is
      // device-link-only, not locked out. The Device keeps working.
      expect(
        (
          await h.app.request('/api/v1/auth/me', {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(200)
    })

    it('never removes another Login’s passkey', async () => {
      const mine = await signedInDevice()
      const theirs = await signedInDevice({ suffix: 'b' })
      await db
        .insertInto('passkey')
        .values({
          id: '0f00000a-0000-4000-8000-0000000000f2',
          login_id: theirs.loginId,
          credential_id: Buffer.from('theirs'),
          public_key: Buffer.from('key'),
          sign_count: 0,
          transports: null,
          aaguid: null,
          uv_seen: true,
          label: null,
          created_on_device: null,
        })
        .execute()

      await h.app.request(
        '/api/v1/auth/passkeys/0f00000a-0000-4000-8000-0000000000f2',
        { method: 'DELETE', headers: { authorization: `Bearer ${mine.token}` } },
      )

      const still = await db
        .selectFrom('passkey')
        .selectAll()
        .where('id', '=', '0f00000a-0000-4000-8000-0000000000f2')
        .execute()
      expect(still).toHaveLength(1)
    })
  })
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run api/test/server/account.test.ts -t "passkeys"`
Expected: FAIL — `404` on `/auth/passkeys/options`.

- [ ] **Step 3: Add the service methods**

Model `beginAddPasskey` on the existing `beginRegistration`, with two differences: the Login is the caller's rather than an Invite's, and `excludeCredentials` carries what the Login already holds so the authenticator does not silently make a duplicate.

```ts
    /**
     * Creation options for an additional Passkey on an already-signed-in
     * Login. The same ceremony as joining (§3.5), authenticated, appending
     * rather than creating.
     */
    async beginAddPasskey(
      context: AuthContext,
    ): Promise<PublicKeyCredentialCreationOptionsJSON> {
      const existing = await db
        .selectFrom('passkey')
        .select('credential_id')
        .where('login_id', '=', context.loginId)
        .execute()

      const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpId,
        userID: randomBytes(32),
        // Never the Person's name or any household data: user handles are
        // stored by the authenticator and may be displayed by password
        // managers (auth-design.md §3.5).
        userName: context.loginId,
        attestationType: 'none',
        // Offering to make a second credential for one already present is a
        // confusing prompt, not a security hole — but the authenticator can
        // refuse cleanly if we say so.
        excludeCredentials: existing.map((row) => ({
          id: toBase64Url(row.credential_id),
        })),
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'preferred',
        },
      })

      await storeChallenge(options.challenge, 'add-passkey', context.loginId)
      return options
    },

    async finishAddPasskey({
      context,
      response,
      label,
      userAgent,
    }: {
      context: AuthContext
      response: RegistrationResponseJSON
      label: string | null
      userAgent: string | undefined
    }): Promise<{ passkeyId: string }> {
      const challenge = challengeFromClientData(response.response.clientDataJSON)
      await consumeChallenge(challenge, 'add-passkey')

      let verification
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge: challenge,
          expectedOrigin: rp.allowedOrigins,
          expectedRPID: rp.rpId,
          requireUserVerification: false,
        })
      } catch (cause) {
        throw new AuthError(`add-passkey did not verify: ${String(cause)}`)
      }

      if (!verification.verified) throw new AuthError('add-passkey unverified')
      const { credential, aaguid, userVerified } = verification.registrationInfo

      const passkeyId = ids.next()
      const trimmed = label?.trim()

      await db
        .insertInto('passkey')
        .values({
          id: passkeyId,
          login_id: context.loginId,
          credential_id: fromBase64Url(credential.id),
          public_key: credential.publicKey,
          sign_count: credential.counter,
          transports:
            credential.transports === undefined
              ? null
              : JSON.stringify(credential.transports),
          aaguid,
          uv_seen: userVerified,
          // Named at the moment of adding, which is the only moment the person
          // reliably knows what the thing is (spec §6.5). An empty field still
          // produces a useful row. Renaming later is story 37, Later.
          label:
            trimmed === undefined || trimmed === ''
              ? deviceLabelFrom(userAgent)
              : trimmed.slice(0, 60),
          created_on_device: context.deviceId,
        })
        .execute()

      return { passkeyId }
    },

    async listPasskeys(context: AuthContext): Promise<
      Array<{
        id: string
        label: string | null
        createdAt: Date
        lastUsedAt: Date | null
      }>
    > {
      const rows = await db
        .selectFrom('passkey')
        .select(['id', 'label', 'created_at', 'last_used_at'])
        .where('login_id', '=', context.loginId)
        .orderBy('created_at')
        .execute()

      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      }))
    },

    /**
     * Removing the **last** one is allowed and warned about in the UI, not
     * blocked: it drops the Login to the device-link-only mode of §5 rather
     * than locking it out.
     */
    async removePasskey(context: AuthContext, passkeyId: string): Promise<void> {
      await db
        .deleteFrom('passkey')
        .where('id', '=', passkeyId)
        .where('login_id', '=', context.loginId)
        .execute()
    },
```

- [ ] **Step 4: Add the routes**

```ts
  auth.post('/passkeys/options', requireAuth, async (c) => {
    return c.json(await service.beginAddPasskey(c.get('auth')))
  })

  auth.post('/passkeys/verify', requireAuth, async (c) => {
    const body = await readJson<{ response: unknown; label: unknown }>(c)
    if (typeof body.response !== 'object' || body.response === null) {
      return c.json(VAGUE_FAILURE, 400)
    }

    try {
      const { passkeyId } = await service.finishAddPasskey({
        context: c.get('auth'),
        response: body.response as RegistrationResponseJSON,
        label: typeof body.label === 'string' ? body.label : null,
        userAgent: c.req.header('user-agent'),
      })
      return c.json({ id: passkeyId })
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.get('/passkeys', requireAuth, async (c) => {
    const passkeys = await service.listPasskeys(c.get('auth'))
    return c.json({
      passkeys: passkeys.map((passkey) => ({
        id: passkey.id,
        label: passkey.label,
        created_at: passkey.createdAt.toISOString(),
        last_used_at: passkey.lastUsedAt?.toISOString() ?? null,
      })),
    })
  })

  auth.delete('/passkeys/:id', requireAuth, async (c) => {
    await service.removePasskey(c.get('auth'), c.req.param('id'))
    return c.body(null, 204)
  })
```

Add `RegistrationResponseJSON` to the type imports at the top of `routes.ts`.

- [ ] **Step 5: Extend the isolation sweep**

In `api/test/server/householdIsolation.test.ts`, add household A's token against each of the new authenticated routes and assert it never reaches household B's rows. Follow that file's existing table-driven shape rather than inventing a new one.

- [ ] **Step 6: Run the server suite**

Run: `npx vitest run api/test/server/account.test.ts api/test/server/deviceLink.test.ts api/test/server/householdIsolation.test.ts api/test/server/auth.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/src/auth/service.ts api/src/auth/routes.ts \
        api/test/server/account.test.ts api/test/server/householdIsolation.test.ts
git commit -m "Add, name, list and remove a Passkey — including the last one"
```

---

## Task 8: `ui/src/QrCode.tsx`

Spec §6.4. The only place `uqr` is imported.

**Files:**
- Create: `ui/src/QrCode.tsx`, `ui/src/QrCode.test.tsx`
- Modify: `ui/src/index.ts`, `ui/package.json`

**Interfaces:**
- Produces: `<QrCode value={string} size={number} title={string} />`

- [ ] **Step 1: Add the dependency**

```bash
npm i uqr --workspace ui
```

Confirm it lands in `ui/package.json` `dependencies` and that `npm run check:workspaces` still passes.

- [ ] **Step 2: Write the failing test**

Create `ui/src/QrCode.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { QrCode } from './QrCode'

describe('QrCode', () => {
  it('renders an SVG that encodes the value', () => {
    render(
      <QrCode
        value="https://app.foerier.app/join#abc"
        size={126}
        title="Device link"
      />,
    )
    const image = screen.getByRole('img', { name: 'Device link' })
    expect(image.querySelector('svg')).not.toBeNull()
  })

  it('encodes a full-length invite link without throwing', () => {
    const secret = 'kJ2nQ7xWpL0aZ4vRtY8sMc1BdF6hGjNe3UiOkPqXwSb'
    expect(() =>
      render(
        <QrCode
          value={`https://app.foerier.app/join#${secret}`}
          size={126}
          title="Device link"
        />,
      ),
    ).not.toThrow()
  })

  it('carries the board’s light tile rather than the page background', () => {
    const { container } = render(
      <QrCode value="x" size={126} title="Device link" />,
    )
    expect(container.innerHTML).toContain('#F0EBDD')
  })
})
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run ui/src/QrCode.test.tsx`
Expected: FAIL — `Failed to resolve import "./QrCode"`.

- [ ] **Step 4: Build the component**

Create `ui/src/QrCode.tsx`:

```tsx
import { renderSVG } from 'uqr'

export interface QrCodeProps {
  /** The link to encode. */
  value: string
  /** Rendered edge length in px; the board draws 126 including the quiet zone. */
  size: number
  /** The accessible name. A QR with no name is an image nobody can identify. */
  title: string
}

/**
 * A QR code as inline SVG (`docs/design/README.md` §14).
 *
 * `uqr` was chosen by measurement: 4.3 KB gzipped against 8.5 and 9.7 for the
 * nearest alternatives, and the only candidate with no runtime dependencies.
 * It returns an SVG **string** with a `viewBox`, so the tile scales without a
 * canvas, without a `data:` URI, and without anything the CSP has to be
 * widened for.
 *
 * The light tile is not decoration: scanners want a light quiet zone, and the
 * app's own background is near-black. `border: 1` is the 10px quiet zone at
 * this scale.
 *
 * This is the only module in the repo that imports `uqr`
 * ([frontend-design §5](../../docs/frontend-design.md)).
 */
export function QrCode({ value, size, title }: QrCodeProps) {
  const svg = renderSVG(value, {
    border: 1,
    whiteColor: '#F0EBDD',
    blackColor: '#151A15',
  })

  return (
    <span
      role="img"
      aria-label={title}
      style={{ display: 'inline-block', width: size, height: size }}
      // The SVG is generated here from a value this component was handed; no
      // markup from the value reaches the output, because `uqr` emits only
      // rects and paths from a bit matrix.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
```

**Note on `dangerouslySetInnerHTML`:** `auth-design.md` §7.4 lists "React's default escaping with no `dangerouslySetInnerHTML`" among the mitigations the XSS residual risk leans on. This is the one exception, and it is a narrow one — the string is generated in-process from a bit matrix, never from user input or a network response. Add a line to that section recording the exception rather than leaving the claim overbroad; do it in Task 13's doc pass.

- [ ] **Step 5: Export it**

In `ui/src/index.ts`:

```ts
export { QrCode } from './QrCode'
export type { QrCodeProps } from './QrCode'
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run ui/src/QrCode.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/QrCode.tsx ui/src/QrCode.test.tsx ui/src/index.ts ui/package.json package-lock.json
git commit -m "Render a QR as inline SVG, on the smallest encoder measured"
```

---

## Task 9: The Account screen

Boards §11, both widths. Spec §6.1, §6.2.

**Files:**
- Create: `app/src/screens/Account.tsx`, `app/src/screens/Account.module.css`, `app/src/screens/Account.test.tsx`
- Modify: `app/src/auth/api.ts`, `app/src/App.tsx`

**Interfaces:**
- Consumes: `api.me()`, `api.listPasskeys()`, `api.listDevices()`, `api.addPasskeyOptions()`, `api.addPasskeyVerify()`
- Produces: `<Account />`, rendered inside `DepotProvider`, reading the Person's name with `useDepot`

- [ ] **Step 1: Add the client API methods**

In `app/src/auth/api.ts`, add the response types beside `SignedIn`:

```ts
export interface Me {
  login_id: string
  person_id: string
  household_id: string
  household_name: string
  device_id: string
}

export interface DeviceRow {
  id: string
  label: string | null
  created_at: string
  last_seen_at: string
  current: boolean
  enrolled_passkey_here: boolean
}

export interface PasskeyRow {
  id: string
  label: string | null
  created_at: string
  last_used_at: string | null
}

export interface IssuedInvite {
  id: string
  secret: string
  expires_at: string
}
```

Add a `get<T>` helper beside `post<T>` (same header and error handling, `method: 'GET'`, no body) and a `del` helper (`method: 'DELETE'`, expects 204), then:

```ts
    me: (token: string) => get<Me>('/auth/me', token),
    listDevices: (token: string) =>
      get<{ devices: DeviceRow[] }>('/auth/devices', token),
    revokeDevice: (token: string, id: string) =>
      del(`/auth/devices/${id}`, token),
    listPasskeys: (token: string) =>
      get<{ passkeys: PasskeyRow[] }>('/auth/passkeys', token),
    removePasskey: (token: string, id: string) =>
      del(`/auth/passkeys/${id}`, token),
    addPasskeyOptions: (token: string) =>
      post<PublicKeyCredentialCreationOptionsJSON>(
        '/auth/passkeys/options',
        undefined,
        token,
      ),
    addPasskeyVerify: (
      token: string,
      response: RegistrationResponseJSON,
      label: string,
    ) => post<{ id: string }>('/auth/passkeys/verify', { response, label }, token),
    issueDeviceLink: (token: string) =>
      post<IssuedInvite>('/auth/invites', { purpose: 'device' }, token),
    listInvites: (token: string) =>
      get<{ invites: Array<{ id: string; purpose: string; expires_at: string }> }>(
        '/auth/invites',
        token,
      ),
    revokeInvite: (token: string, id: string) =>
      del(`/auth/invites/${id}`, token),
```

- [ ] **Step 2: Write the failing screen test**

Create `app/src/screens/Account.test.tsx`. Follow the fake-fetch pattern the existing screen tests use — an in-memory `Fetch`, never a mocking framework (`docs/testing.md`). Assert:

```tsx
  it('names the person from folded state and the household from the API', async () => {
    renderAccount({ personName: 'Mark', householdName: 'Veldkamp' })
    expect(await screen.findByText('Mark')).toBeInTheDocument()
    expect(screen.getByText('VELDKAMP HOUSEHOLD')).toBeInTheDocument()
  })

  it('offers to add a passkey only where the device can make one', async () => {
    renderAccount({ passkeys: [], platformAuthenticator: false })
    expect(
      screen.queryByRole('button', { name: 'Add a passkey on this device' }),
    ).toBeNull()
  })

  it('shows the standing nudge as a quiet section state on a login with none', async () => {
    renderAccount({ passkeys: [], platformAuthenticator: true })
    expect(await screen.findByText('None on this login.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('summarises devices rather than listing them, below Desktop', async () => {
    renderAccount({ devices: threeDevices() })
    expect(await screen.findByText('3 devices signed in.')).toBeInTheDocument()
  })
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run app/src/screens/Account.test.tsx`
Expected: FAIL — no `./Account`.

- [ ] **Step 4: Build the screen**

Create `Account.tsx` following boards §11's section order exactly — **YOU → PASSKEYS → DEVICES → PEOPLE & LOGINS → footer** — which is frequency order and not alphabetical. Two rules the boards make explicit and the code must keep:

- **PEOPLE & LOGINS is a row that leads nowhere in S3.5.** Story 28 builds its screen. Render the row **disabled with no destination**, or omit it — an affordance that leads nowhere is worse than a missing one, which is the same rule that kept the ACCOUNT affordance out until now. **Omit it**, and leave a comment saying it lands with S5.
- **`Add a passkey on this device` renders only where the device supports passkeys.** Gate on `await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`, defaulting to hidden while the check is pending.

The add-a-passkey flow carries the name field from spec §6.5: one 48px input, prefilled with a client-side guess at the device label, submitted as `label` to `addPasskeyVerify`.

- [ ] **Step 5: Add the route**

In `app/src/App.tsx`, inside the `SignedInShell` switch, before the catch-all:

```tsx
              <Route path="/account">
                <Account />
              </Route>
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run app/src`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/screens/Account.tsx app/src/screens/Account.module.css \
        app/src/screens/Account.test.tsx app/src/auth/api.ts app/src/App.tsx
git commit -m "Build the Account screen the shell has been waiting for"
```

---

## Task 10: Devices, both confirm sheets, and `clearLocalData()`

Boards §12. Spec §7.

**Files:**
- Create: `app/src/screens/Devices.tsx`, `.module.css`, `Devices.test.tsx`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Consumes: `api.listDevices`, `api.revokeDevice`, `api.signOut`, `clearLocalData` from `app/src/depot/wiring`, `unsyncedCount` via `useDepot`

- [ ] **Step 1: Write the failing tests**

The two that carry real rules:

```tsx
  it('omits the unsynced line entirely when nothing is unsynced', async () => {
    renderDevices({ unsyncedCount: 0 })
    await userEvent.click(screen.getByRole('button', { name: /Sign out/ }))
    expect(screen.queryByText(/not yet synced/)).toBeNull()
    expect(screen.queryByText('▲')).toBeNull()
  })

  it('states the exact count when there is unsynced work', async () => {
    renderDevices({ unsyncedCount: 4 })
    await userEvent.click(screen.getByRole('button', { name: /Sign out/ }))
    expect(
      await screen.findByText('▲ 4 changes not yet synced. Signing out clears them.'),
    ).toBeInTheDocument()
  })

  it('clears local data even when the server cannot be reached', async () => {
    const clearLocalData = vi.fn().mockResolvedValue(undefined)
    renderDevices({ unsyncedCount: 0, signOutFails: true, clearLocalData })

    await userEvent.click(screen.getByRole('button', { name: /Sign out/ }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out and clear' }),
    )

    // The app works offline everywhere else; a sign-out that failed for want
    // of signal would be the one place auth blocks a local action. The token
    // dies with the database, so the orphaned server row is inert.
    expect(clearLocalData).toHaveBeenCalledTimes(1)
  })

  it('marks the current device and never lists an IP', async () => {
    renderDevices({ devices: threeDevices() })
    expect(await screen.findByText('THIS DEVICE')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
  })
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run app/src/screens/Devices.test.tsx`
Expected: FAIL — no `./Devices`.

- [ ] **Step 3: Build the screen and both sheets**

Per boards §12. Two anatomy rules that are easy to get wrong:

- **`SIGN OUT` is attention-coloured *text*, never a filled red button** — the RETIRE rule, applied here.
- **Only `sign out this device` carries `▲`.** The remote confirm sheet has none: revoking another Device destroys nothing.

Read the count *before* the confirm resolves, matching `App.tsx:169`'s ordering comment — ending the session drops the store that can answer the question.

Sign-out sequence:

```tsx
  async function signOutThisDevice() {
    // Best effort: revocation needs the network and clearing does not.
    await api.signOut(session.token).catch(() => undefined)
    stopSync()
    await clearLocalData()
    navigate('/signin')
  }
```

- [ ] **Step 4: Add the routes**

```tsx
              <Route path="/account/devices">
                <Devices />
              </Route>
```

At Desktop, redirect `/account/devices` to `/account` — the board unfolds the full list inline there. Use the existing `useMediaQuery(DESKTOP)` hook from `app/src/shell/useMediaQuery`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run app/src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/screens/Devices.tsx app/src/screens/Devices.module.css \
        app/src/screens/Devices.test.tsx app/src/App.tsx
git commit -m "See every signed-in Device, and cut off any of them including this one"
```

---

## Task 11: Invite issued — the device link

Boards §14, device-link variant only. The join variant is S5's.

**Files:**
- Create: `app/src/screens/DeviceLink.tsx`, `.module.css`, `DeviceLink.test.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
  it('renders the QR, the link, and the expiry as an amber chip under an hour', async () => {
    renderDeviceLink({ expiresInMinutes: 58 })
    expect(await screen.findByRole('img', { name: /device link/i })).toBeInTheDocument()
    expect(screen.getByText('EXPIRES IN 58 min')).toBeInTheDocument()
    expect(screen.getByText('SINGLE USE')).toBeInTheDocument()
  })

  it('says the link is the credential', async () => {
    renderDeviceLink({ expiresInMinutes: 58 })
    expect(
      await screen.findByText('The link is the credential. Treat it like a key.'),
    ).toBeInTheDocument()
  })

  it('issues exactly one link, however many times the screen re-renders', async () => {
    const { issueDeviceLink } = renderDeviceLink({ expiresInMinutes: 58 })
    await screen.findByRole('img', { name: /device link/i })
    expect(issueDeviceLink).toHaveBeenCalledTimes(1)
  })
```

That third test is the one that matters: the secret is returned **once**, so a component that re-issues on re-render silently burns invites and leaves a trail of unusable links.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run app/src/screens/DeviceLink.test.tsx`
Expected: FAIL — no `./DeviceLink`.

- [ ] **Step 3: Build the screen**

Per boards §14. Anatomy: QR on the light tile (126px including quiet zone) · the link in a `user-select: all` mono well · bordered 48px `Copy link` · the expiry chip, **amber under an hour and muted above** · `REVOKE` as attention text.

Issue the link in an effect with an empty dependency array guarded by a ref, so React 19 Strict Mode's double-invoke does not mint two.

- [ ] **Step 4: Add the route and the entry point**

Route `/account/device-link`. The entry point is Account's `Sign in on another device` button (boards §11, DEVICES section).

- [ ] **Step 5: Run the tests and commit**

```bash
npx vitest run app/src
git add app/src/screens/DeviceLink.tsx app/src/screens/DeviceLink.module.css \
        app/src/screens/DeviceLink.test.tsx app/src/App.tsx
git commit -m "Hand over a device link as a QR, a link, and an honest expiry"
```

---

## Task 12: The four shell affordances

Spec §6.3. `docs/architecture-design.md` §12.6's debt, discharged.

**Files:**
- Modify: `app/src/shell/AppShell.tsx`, `app/src/shell/AppShell.module.css`, `app/src/shell/AppShell.test.tsx`, `app/src/App.tsx`

**Interfaces:**
- Produces: `AppShellProps` gains `accountInitial?: string | null`

- [ ] **Step 1: Invert the pinning test**

In `app/src/shell/AppShell.test.tsx`, rewrite the `AppShell — the account affordance` block. **Edit it, do not delete it** — the diff is the record that the debt was discharged rather than dropped:

```tsx
describe('AppShell — the account affordance', () => {
  it('offers one in every mode, now that the Account screen exists', () => {
    for (const viewport of [[], [SPLIT], [SPLIT, DESKTOP]]) {
      setViewport(...viewport)
      renderShell({ accountInitial: 'M' })
      // The sidebar draws a labelled row; the rail and the phone header draw
      // an avatar with no label, so both need an accessible name or the
      // affordance is a link nobody can follow.
      expect(
        screen.getByRole('link', { name: 'Account' }),
      ).toBeInTheDocument()
      screen.getByRole('navigation', { name: 'Sections' }).remove()
    }
  })

  it('keeps the tab bar at three destinations', () => {
    setViewport()
    const nav = renderShell({ accountInitial: 'M' })
    // Account is reached from the avatar, not a fourth tab.
    expect(within(nav).getAllByRole('link')).toHaveLength(3)
  })

  it('draws an empty circle when no Person is folded yet', () => {
    setViewport()
    renderShell({ accountInitial: null })
    const link = screen.getByRole('link', { name: 'Account' })
    // A half-finished bootstrap has a person_id and no Person
    // (`auth-design.md` §2.1); a placeholder letter would be a fact invented.
    expect(link.textContent).toBe('')
  })

  it('never folds the initial into the accessible name', () => {
    setViewport(SPLIT)
    renderShell({ accountInitial: 'M' })
    expect(screen.queryByRole('link', { name: /^Account M$/ })).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run app/src/shell/AppShell.test.tsx`
Expected: FAIL — no link named `Account`.

- [ ] **Step 3: Add the affordance in all three modes**

In `AppShell.tsx`, add `accountInitial` to `AppShellProps` and render:

- **sidebar** — a labelled `ACCOUNT` row inside the existing `.navFoot` group, above the sync line. The `margin-top: auto` slot is already there.
- **rail** — a 22px avatar in a 40px `.railSquare`, above the sync dot, with `aria-label="Account"`.
- **tabs** — an avatar in the existing `<header>`, beside the sync line, with `aria-label="Account"`.

The initial is `aria-hidden`, for the same reason the sidebar count is: a name that changes as data loads reads as data.

- [ ] **Step 4: Hand the initial in from `App`**

`AppShell` renders outside `DepotProvider`, so `App` resolves it where it resolves `depotCounts`. Extend `useDestinationCounts` or add a sibling hook:

```ts
/**
 * The letter in the avatar (`docs/design/README.md` §11).
 *
 * Read here rather than inside `AppShell` for the same reason the counts are:
 * the shell renders *outside* `DepotProvider`, deliberately, so the nav never
 * depends on a store the signed-out shell has never had.
 *
 * Null rather than a placeholder when the Person is not folded yet — a Login
 * can point at a `person_id` no op has created (`auth-design.md` §2.1), and an
 * invented letter is worse than an empty circle.
 */
function useAccountInitial(
  store: StoreApi<DepotStoreState>,
  personId: string,
): string | null {
  const state = useStore(store, (depot) => depot.state)
  const name = state.people[personId]?.name?.value
  return name === undefined || name === null || name === ''
    ? null
    : name.trim().charAt(0).toUpperCase()
}
```

Thread `session.personId` into `SignedInShell` as a prop.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run app/src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/shell app/src/App.tsx
git commit -m "Open the four doors R3 drew and left leading nowhere"
```

---

## Task 13: Tier 5, and the doc pass

Spec §12.4, §13.

**Files:**
- Create: `test/e2e/deviceLink.spec.ts`
- Modify: `test/e2e/mintInvite.ts`, `CLAUDE.md`, `docs/architecture-design.md` (new §12.7), `docs/auth-design.md` (§7.4)

- [ ] **Step 1: Extend the e2e minting helpers**

In `test/e2e/mintInvite.ts`, add `mintJoinInviteInto(householdId)` and `mintDeviceLink(loginId)`, both shelling out to `npm run admin:invite --workspace api` exactly as `mintInvite` shells out to `admin:bootstrap`, and both parsing `/join#(\S+)` from stdout.

- [ ] **Step 2: Write the three journeys**

Create `test/e2e/deviceLink.spec.ts`.

**Journey 1 — the device link, end to end.** Sign in with the virtual authenticator, go to Account ▸ `Sign in on another device`, read the link out of the input well, then open it **in a second browser context with no virtual authenticator attached**:

```ts
  const constrained = await browser.newContext()
  const page2 = await constrained.newPage()
  // No `attachAuthenticator(page2)`. That absence is the test: WebAuthn is
  // present in the page and there is nothing behind it, which is exactly the
  // phone this slice exists for.
  await page2.goto(`/join#${secret}`)
  await page2.getByRole('button', { name: /^Continue/ }).click()
  await expect(page2.getByRole('navigation', { name: 'Sections' })).toBeVisible()
```

**Journey 2 — the second Login joins.** `mintJoinInviteInto(householdId)`, then assert the name field **is present** (this is Task 1's regression test, and it is only meaningful end to end because the defect lived in the seam between a server guess and a client branch), name the joiner, and assert their name renders in the avatar and on Account.

**Journey 3 — sign out this device**, with a non-empty outbox: record gear while offline, open Account ▸ Devices ▸ `SIGN OUT`, assert the sheet states the exact count, confirm, and assert the app lands on `/signin` with the database gone.

- [ ] **Step 3: Run the e2e suite**

Run: `npx playwright test`
Expected: all green, including the seven that already passed.

- [ ] **Step 4: The doc pass**

- `docs/auth-design.md` §7.4 — record the `QrCode` exception. The section claims "React's default escaping with no `dangerouslySetInnerHTML`"; there is now exactly one use, generated in-process from a bit matrix and never from input or a response. State it rather than leaving the claim overbroad.
- `docs/architecture-design.md` — add **§12.7, "Consequences of S3.5"**, written *now* rather than with the slice, because consequences are only knowable once the code exists. Cover: the `person_recorded` defect and what it teaches about server-side proxies for domain facts; `passkey.created_on_device` and the enrolment-not-reachability distinction; `uqr` as the first measured dependency choice; and the ACCOUNT debt discharged in all three modes.
- `CLAUDE.md` — S3.5 moves from "next" to "landed"; the debt list loses the four affordances and `clearLocalData()`; the Radix slice becomes next.

- [ ] **Step 5: Full verification**

```bash
npm run typecheck && npm run lint && npm run format:check
npx vitest run
npx playwright test
```

Every suite green except the known `sync.test.ts` flake — confirm by running it alone.

- [ ] **Step 6: Commit**

```bash
git add test/e2e CLAUDE.md docs/architecture-design.md docs/auth-design.md
git commit -m "Prove the token-only path in a browser with nothing behind WebAuthn"
```

---

## Self-Review

**Spec coverage.** §3 → Tasks 2, 5, 6, 7. §3.1 → Task 2. §3.2 → Tasks 5, 6. §3.3 → Task 6. §4 → Task 1. §5 → Task 3. §6.1 → Tasks 9, 10, 11. §6.2 → Task 9. §6.3 → Task 12. §6.4 → Task 8. §6.5 → Task 7 (server) + Task 9 (the field). §7 → Task 10. §8 → Task 4. §9 → Task 4. §10 → no task, correctly: Radix is deferred and its conversion is a separate slice. §11 → no task by definition. §12 → Tasks 1–13, each carrying its own tier. §13 → Task 13.

**One addition beyond the spec:** `passkey.created_on_device` (Task 1), needed by boards §12's `NO PASSKEY HERE` and not anticipated when the spec was written. Amend spec §4 to cover it during Task 1 rather than leaving the plan ahead of the spec.

**Type consistency.** `claimDevice`, `finishRegistration` and `finishLogin` all return `{ token, context, personId }`, so the route builds identical bodies from all three. `AuthContext` is `{ deviceId, loginId, householdId, personId }` throughout. Service methods return `camelCase`; every route serialises to `snake_case`. `enrolledPasskeyHere` (service) → `enrolled_passkey_here` (wire) → `enrolledPasskeyHere` (client prop) is the one field that crosses all three cases — keep it consistent.

**Ordering.** Tasks 1–4 are the usable increment: after Task 4 the passkey-less device is signed in via the Maintainer script. Tasks 5–12 replace that script with the in-app flow. Task 13 proves it in a browser.
