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
