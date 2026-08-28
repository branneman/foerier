#!/usr/bin/env node

/**
 * Idempotent creation of `foerier_dev`, the local dev server's own database
 * — separate from `foerier_test`, which Tier 2s owns and is allowed to
 * destroy (`api/src/config.ts` explains why the split exists at all).
 *
 * `docker-compose.dev.yml` creates `foerier_dev` automatically, but only for
 * a **brand-new** named volume — Postgres runs `/docker-entrypoint-initdb.d/`
 * once, on first init, and silently skips it on every later start. Anyone
 * with an existing `foerier-dev_foerier_pgdata_dev` volume (every checkout
 * that predates this change) needs this script, once:
 *
 *   npm run db:setup
 *
 * Safe to run again — and again after that. It connects to the container's
 * default `foerier_test` database (the one guaranteed to exist), checks
 * whether `foerier_dev` is already there, and creates it only if not.
 *
 * Uses the `pg` package already in the tree rather than `docker exec`, which
 * assumes a container name and a particular way of running Postgres — this
 * only assumes a reachable Postgres speaking the wire protocol.
 */

import pg from 'pg'

const DEV_DATABASE_NAME = 'foerier_dev'

// The database `docker-compose.dev.yml` guarantees exists, used only as a
// connection to issue `CREATE DATABASE` from — never as the target itself. A
// server cannot `CREATE DATABASE` for the database it is currently connected
// to.
const ADMIN_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://foerier:foerier@localhost:5433/foerier_test'

const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL })

try {
  await client.connect()

  const { rows } = await client.query(
    'select 1 from pg_database where datname = $1',
    [DEV_DATABASE_NAME],
  )

  if (rows.length > 0) {
    console.log(`${DEV_DATABASE_NAME} already exists — nothing to do.`)
  } else {
    // CREATE DATABASE cannot run inside a transaction. A single `client.query`
    // call is not wrapped in one on its own, so this is safe as written —
    // just never move it next to another statement inside a BEGIN/COMMIT.
    await client.query(`CREATE DATABASE ${DEV_DATABASE_NAME} OWNER foerier`)
    console.log(`created ${DEV_DATABASE_NAME}.`)
  }
} catch (error) {
  console.error(
    `could not set up ${DEV_DATABASE_NAME}: ${error instanceof Error ? error.message : String(error)}`,
  )
  console.error(
    'is the local Postgres up? docker compose -f docker-compose.dev.yml up -d',
  )
  process.exitCode = 1
} finally {
  await client.end()
}
