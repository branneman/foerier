import type { ColumnType, Insertable, Selectable } from 'kysely'

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

export interface HouseholdTable {
  id: string
  name: string
  created_at: CreatedAt
}

export interface Database {
  household: HouseholdTable
}

export type Household = Selectable<HouseholdTable>
export type NewHousehold = Insertable<HouseholdTable>
