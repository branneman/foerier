import { type Kysely, sql } from 'kysely'

/**
 * The access tables, from `auth-design.md` §9.2.
 *
 * Purely additive — nothing existing changes shape — so the expand-contract
 * rule is satisfied trivially.
 *
 * Note the table is `passkey`, not `credential`: one word means one thing in
 * this repo, and Passkey is the word the glossary, the stories, and every
 * screen use. The *column* stays `credential_id`, because that one is
 * WebAuthn's own term for the value it holds.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('login')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('household_id', 'uuid', (col) =>
      col.notNull().references('household.id').onDelete('cascade'),
    )
    // An opaque UUID with no foreign key and no meaning to the server: the
    // Person it names exists only as the fold of an op log, and there is no
    // `person` table by design (auth-design.md §2.1). Keeping this a dumb
    // UUID is what stops auth and domain from entangling.
    .addColumn('person_id', 'uuid', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('disabled_at', 'timestamptz')
    // At most one Login per Person, by construction rather than convention.
    .addUniqueConstraint('login_household_person_unique', [
      'household_id',
      'person_id',
    ])
    .execute()

  await db.schema
    .createTable('passkey')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('login_id', 'uuid', (col) =>
      col.notNull().references('login.id').onDelete('cascade'),
    )
    .addColumn('credential_id', 'bytea', (col) => col.notNull().unique())
    .addColumn('public_key', 'bytea', (col) => col.notNull())
    // Passkey authenticators legitimately report 0 forever; treating that as a
    // cloned credential would lock out every synced passkey in existence
    // (auth-design.md §4).
    .addColumn('sign_count', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('transports', 'jsonb')
    .addColumn('aaguid', 'text')
    // Recorded per credential so that tightening `userVerification` to
    // "required" later is a policy change rather than a migration.
    .addColumn('uv_seen', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('label', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('last_used_at', 'timestamptz')
    .execute()

  await db.schema
    .createTable('device')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('login_id', 'uuid', (col) =>
      col.notNull().references('login.id').onDelete('cascade'),
    )
    // Denormalised so the auth middleware resolves a request in ONE indexed
    // lookup — this sits in front of every authenticated route.
    .addColumn('household_id', 'uuid', (col) =>
      col.notNull().references('household.id').onDelete('cascade'),
    )
    .addColumn('token_hash', 'bytea', (col) => col.notNull().unique())
    .addColumn('label', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('last_seen_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .execute()

  await db.schema
    .createIndex('device_login_idx')
    .on('device')
    .column('login_id')
    .execute()

  await db.schema
    .createTable('invite')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('household_id', 'uuid', (col) =>
      col.notNull().references('household.id').onDelete('cascade'),
    )
    // Always pre-bound, which is what makes "a Login is always a Person" true
    // by construction (auth-design.md §3.1).
    .addColumn('person_id', 'uuid', (col) => col.notNull())
    .addColumn('purpose', 'text', (col) => col.notNull())
    // Text plus a check rather than a Postgres enum: an enum would make adding
    // a purpose a migration with a deploy-order dependency.
    .addCheckConstraint(
      'invite_purpose_check',
      sql`purpose in ('join', 'device')`,
    )
    .addColumn('secret_hash', 'bytea', (col) => col.notNull().unique())
    // Device invites only; a join invite has no Login yet.
    .addColumn('login_id', 'uuid', (col) =>
      col.references('login.id').onDelete('cascade'),
    )
    // Null when the Maintainer minted it out of band (auth-design.md §3.4).
    .addColumn('created_by_login', 'uuid', (col) =>
      col.references('login.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .execute()

  await db.schema
    .createIndex('invite_household_idx')
    .on('invite')
    .column('household_id')
    .execute()

  await db.schema
    .createTable('webauthn_challenge')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('challenge', 'bytea', (col) => col.notNull().unique())
    .addColumn('purpose', 'text', (col) => col.notNull())
    .addColumn('login_id', 'uuid', (col) =>
      col.references('login.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('consumed_at', 'timestamptz')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('webauthn_challenge').execute()
  await db.schema.dropTable('invite').execute()
  await db.schema.dropTable('device').execute()
  await db.schema.dropTable('passkey').execute()
  await db.schema.dropTable('login').execute()
}
