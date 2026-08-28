import { describe, expect, it } from 'vitest'

import { DEV_DATABASE_URL, loadConfig } from './config.ts'

describe('loadConfig', () => {
  it('falls back to the local database outside production', () => {
    // So the readme's commands work against a fresh checkout with nothing
    // exported. Getting this wrong is not a crash — it is a confusing one.
    expect(loadConfig({}).databaseUrl).toBe(DEV_DATABASE_URL)
  })

  it('refuses to boot without a database in production', () => {
    // A production server that quietly fell back to localhost would come up
    // healthy, serve nothing, and look like a networking problem.
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/)
  })

  it('always prefers an explicit value', () => {
    const explicit = 'postgres://elsewhere/foerier'

    expect(loadConfig({ DATABASE_URL: explicit }).databaseUrl).toBe(explicit)
    expect(
      loadConfig({ DATABASE_URL: explicit, NODE_ENV: 'production' })
        .databaseUrl,
    ).toBe(explicit)
  })

  it('reports the build as `dev` when no commit was baked in', () => {
    expect(loadConfig({}).gitSha).toBe('dev')
    expect(loadConfig({ GIT_SHA: 'abc1234' }).gitSha).toBe('abc1234')
  })

  it('defaults the port to the one the container exposes', () => {
    expect(loadConfig({}).port).toBe(8080)
    expect(loadConfig({ PORT: '9000' }).port).toBe(9000)
  })
})

describe('E2E_HOUSEHOLD_ID', () => {
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://x' }
  it('is undefined when unset or empty', () => {
    expect(loadConfig({ ...base }).e2eHouseholdId).toBeUndefined()
    expect(
      loadConfig({ ...base, E2E_HOUSEHOLD_ID: '' }).e2eHouseholdId,
    ).toBeUndefined()
  })
  it('lowercases a UUID — Postgres returns uuid lowercase, and a capitalised compose value would 403 forever', () => {
    expect(
      loadConfig({
        ...base,
        E2E_HOUSEHOLD_ID: '0F00000C-0000-4000-8000-00000000000C',
      }).e2eHouseholdId,
    ).toBe('0f00000c-0000-4000-8000-00000000000c')
  })
  it('refuses to boot on garbage', () => {
    expect(() =>
      loadConfig({ ...base, E2E_HOUSEHOLD_ID: 'not-a-uuid' }),
    ).toThrow(/E2E_HOUSEHOLD_ID/)
  })
})
