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
  await db.schema
    .alterTable('passkey')
    .dropColumn('created_on_device')
    .execute()
  await db.schema.alterTable('invite').dropColumn('person_recorded').execute()
}
