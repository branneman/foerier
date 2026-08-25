import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely'

/**
 * The database shape, **hand-maintained** and updated when a migration lands
 * (`architecture-design.md` §5). At this schema's size `kysely-codegen` is
 * overkill; it gets reached for only if this type starts drifting from the
 * migrations in practice.
 *
 * Table and column names are snake_case, matching Postgres convention and the
 * tables as specified in `auth-design.md` §9.2. Kysely is the only place that
 * mapping lives.
 */

/** Written by the database on insert, never supplied, never updated. */
type CreatedAt = ColumnType<Date, never, never>

/** Supplied on insert with a default, and updatable afterwards. */
type Timestamp = ColumnType<Date, Date | undefined, Date>

export interface HouseholdTable {
  id: string
  name: string
  created_at: CreatedAt
  /** `bigint` reaches the driver as a string; see `db/index.ts`. */
  op_seq: ColumnType<number, number | undefined, number>
}

export interface LoginTable {
  id: string
  household_id: string
  /** Opaque UUID; the server attaches no meaning to it (auth-design.md §2.1). */
  person_id: string
  created_at: CreatedAt
  disabled_at: Date | null
}

export interface PasskeyTable {
  id: string
  login_id: string
  credential_id: Uint8Array
  public_key: Uint8Array
  /** `bigint` reaches the driver as a string; see `db/index.ts`. */
  sign_count: ColumnType<number, number | undefined, number>
  transports: ColumnType<string[] | null, string | null, string | null>
  aaguid: string | null
  uv_seen: ColumnType<boolean, boolean | undefined, boolean>
  label: string | null
  created_at: CreatedAt
  last_used_at: Date | null
}

export interface DeviceTable {
  id: string
  login_id: string
  household_id: string
  token_hash: Uint8Array
  label: string | null
  created_at: CreatedAt
  last_seen_at: Timestamp
  expires_at: Date
  revoked_at: Date | null
}

export type InvitePurpose = 'join' | 'device'

export interface InviteTable {
  id: string
  household_id: string
  person_id: string
  purpose: InvitePurpose
  secret_hash: Uint8Array
  login_id: string | null
  created_by_login: string | null
  created_at: CreatedAt
  expires_at: Date
  used_at: Date | null
  revoked_at: Date | null
}

export type ChallengePurpose = 'register' | 'login' | 'add-passkey'

export interface WebauthnChallengeTable {
  id: string
  challenge: Uint8Array
  purpose: ChallengePurpose
  login_id: string | null
  created_at: CreatedAt
  expires_at: Date
  consumed_at: Date | null
}

/**
 * The op log (`sync-protocol.md` §6.7). `type` is `text`, never a Postgres
 * enum — see the doc comment in `migrations/0003_op.ts` for why.
 */
export interface OpTable {
  op_id: string
  household_id: string
  /** `bigint` reaches the driver as a string; see `db/index.ts`. Never
   * updated — an accepted op is immutable once stored. */
  seq: ColumnType<number, number, never>
  aggregate: string
  aggregate_id: string
  type: string
  hlc: string
  device_id: string
  /** Inserted as a JSON string and cast by Postgres; selected back already
   * parsed. Never updated — an accepted op is immutable once stored. */
  payload: ColumnType<Record<string, unknown>, string, never>
  /**
   * Supplied by the push transaction from the injected clock — the one
   * timestamp foerier writes rather than letting Postgres write, because a
   * test that proves a re-push does **not** move it (`sync-protocol.md` §8.1)
   * has to be able to advance time by a day between the two pushes. The
   * column's `now()` default stays as the backstop.
   *
   * Never updated: a re-push must be invisible to every other client.
   */
  received_at: ColumnType<Date, Date | undefined, never>
}

export interface Database {
  household: HouseholdTable
  login: LoginTable
  passkey: PasskeyTable
  device: DeviceTable
  invite: InviteTable
  webauthn_challenge: WebauthnChallengeTable
  op: OpTable
}

export type Household = Selectable<HouseholdTable>
export type NewHousehold = Insertable<HouseholdTable>
export type Login = Selectable<LoginTable>
export type Passkey = Selectable<PasskeyTable>
export type Device = Selectable<DeviceTable>
export type DeviceUpdate = Updateable<DeviceTable>
export type Invite = Selectable<InviteTable>
export type Op = Selectable<OpTable>
