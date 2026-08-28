import type { Kysely } from 'kysely'

/**
 * Two facts `/test/reset` needs that no existing column carries
 * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3, §12).
 *
 * `household.disposable` is the third gate on the reset route: env alone
 * says a route exists, a Device token alone says which Household, but
 * neither says that Household may be wiped. Set only by
 * `admin:bootstrap --disposable`, read under the same row lock the wipe is
 * scoped by, so the gate and the wipe see one another's answer.
 *
 * `device.passkey_id` records *which Passkey signed this Device in* — the
 * opposite direction from `0004`'s `passkey.created_on_device`, which
 * records *which Device enrolled this Passkey*. Neither replaces the other:
 * the reset's Passkey-scoped wipe needs to know which single Passkey to
 * spare, and `login/verify` already computes that answer and used to throw
 * it away. Nullable and `on delete set null`, because a device-link Device
 * has no Passkey and a Passkey can be removed out from under a Device that
 * once signed in with it — neither should fail the delete.
 *
 * This ships as its own migration, after `0004`, rather than folding into
 * it: `0004` had already landed and run before this need was identified,
 * and migration names are never renamed once deployed
 * (`api/src/db/migrations.ts`). Both columns are purely additive — one
 * defaulted, one nullable — so no deployed row or reader is affected.
 */
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
