import type { Kysely } from 'kysely'

import type { Clock } from '@foerier/shared'

import type { AuthContext } from '../auth/service.ts'
import type { Database } from '../db/schema.ts'

/**
 * The body of `POST /test/reset` —
 * `docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3.
 *
 * It deletes; it never creates. There is no Household, Login, Person or Invite
 * this module can bring into existence, so `auth-design.md` §3.4 — "only
 * `admin:bootstrap` arranges a Household's first Login" — stays exactly true
 * with this route on the surface.
 *
 * Everything it touches is scoped to `context.householdId`, which comes from
 * the Device token via `requireAuth` and from nowhere else (the tenancy rule,
 * `auth-design.md` §9.3). There is deliberately no parameter naming a target.
 */

/** What the route actually did, returned so CI can use it as a tripwire (§3.5). */
export interface ResetCounts {
  /** `op` rows removed. */
  deleted: number
  /** Other Devices of the Household that were live and now are not. */
  revoked: number
  /** Passkeys removed — every one but the caller's. */
  passkeys: number
  /** Outstanding Invites removed. */
  invites: number
}

/**
 * The third gate failing: the env var named this Household, but nobody ever
 * marked it disposable. Thrown from inside the transaction, so the wipe that
 * follows in the same block never runs.
 */
export class NotDisposableError extends Error {
  constructor() {
    super('household is not disposable')
    this.name = 'NotDisposableError'
  }
}

export interface TestResetServiceDeps {
  db: Kysely<Database>
  clock: Clock
}

export type TestResetService = ReturnType<typeof createTestResetService>

export function createTestResetService({ db, clock }: TestResetServiceDeps) {
  return {
    async reset(context: AuthContext): Promise<ResetCounts> {
      return db.transaction().execute(async (trx) => {
        // The same row lock `/sync/push` takes (`sync/service.ts`, step 1).
        // Without it a push racing a reset could commit rows that survive the
        // wipe — harmless at `workers: 1`, and one line to close now rather
        // than rediscover when parallel runs arrive (§3).
        //
        // `disposable` is read under that same lock, in the same row the wipe
        // is scoped by, so the gate and the wipe cannot see different rows.
        // `op_seq` is read and never written, which is the point: §3.4.
        const household = await trx
          .selectFrom('household')
          .select(['op_seq', 'disposable'])
          .where('id', '=', context.householdId)
          .forUpdate()
          .executeTakeFirstOrThrow()

        if (!household.disposable) throw new NotDisposableError()

        // Which Passkey signed the caller in — the one credential that lives
        // past a reset. Null for a Device that claimed a device link, which
        // has no Passkey to spare.
        const caller = await trx
          .selectFrom('device')
          .select('passkey_id')
          .where('id', '=', context.deviceId)
          .where('household_id', '=', context.householdId)
          .executeTakeFirstOrThrow()

        const deleted = await trx
          .deleteFrom('op')
          .where('household_id', '=', context.householdId)
          .executeTakeFirst()

        // Credential hygiene, and what keeps this a destroy-one rather than a
        // destroy-one-and-leak-many: every run mints a Device with a one-year
        // sliding expiry and nothing signs it out, so revoking every Device
        // but the caller's bounds the Household's live tokens to exactly one.
        // That bound is what makes §3.5's counts an oracle rather than a
        // heuristic.
        const revoked = await trx
          .updateTable('device')
          .set({ revoked_at: new Date(clock.now()) })
          .where('household_id', '=', context.householdId)
          .where('id', '<>', context.deviceId)
          .where('revoked_at', 'is', null)
          .executeTakeFirst()

        // Revoking Devices bounds tokens; it does nothing about what a token
        // already made. A holder of one leaked token can mint a device link
        // or add a Passkey, and either would otherwise survive every reset
        // indefinitely.
        const invites = await trx
          .deleteFrom('invite')
          .where('household_id', '=', context.householdId)
          .where('used_at', 'is', null)
          .executeTakeFirst()

        let passkeys = trx
          .deleteFrom('passkey')
          .where('login_id', 'in', (qb) =>
            qb
              .selectFrom('login')
              .select('id')
              .where('household_id', '=', context.householdId),
          )
        if (caller.passkey_id !== null) {
          passkeys = passkeys.where('id', '<>', caller.passkey_id)
        }
        const removed = await passkeys.executeTakeFirst()

        // `household.op_seq` is deliberately NOT reset (§3.4): rows go, the
        // counter keeps climbing. A client holding a cursor at 50 against a
        // counter restarted at 0 would sit permanently ahead of the server and
        // never pull again.

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
