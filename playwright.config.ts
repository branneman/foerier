import { defineConfig, devices } from '@playwright/test'

import { isProduction } from './test/e2e/production'

/**
 * Tier 5 — the real app in a real browser, exercising one core journey
 * (`docs/testing.md`). Deliberately small: edge cases belong in lower tiers.
 *
 * Locally this runs against a *production build* served by `vite preview`, not
 * against the dev server. That is not fussiness: `vite-plugin-pwa` does not
 * run a service worker in dev, so the dev server cannot go offline — and the
 * offline leg is the one thing Tier 5 exists to prove here.
 *
 * Requires the local Postgres:
 *   docker compose -f docker-compose.dev.yml up -d
 *
 * The post-deploy CI job points `PLAYWRIGHT_BASE_URL` at `app.foerier.app` and
 * the same specs run against production — retargeting is one variable, not a
 * rewrite (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §6.2).
 * That one variable switches four things on, and each is load-bearing:
 *
 * - **`globalSetup`** signs in from the exported credential and resets the
 *   Household. It is the main process, which is the only place `::add-mask::`
 *   is honoured, so the Device token is masked where the mask actually fires
 *   (§5.1 point 4).
 * - **`grep: /@production/`** — three kinds of spec cannot run against the
 *   box: one that mints an Invite by Maintainer script (it needs
 *   `DATABASE_URL`), one that proves joining itself, and one that signs the
 *   run's own Device out from under every later spec. The local project has no
 *   grep, so a local run is unchanged.
 * - **`trace: 'off'`** — a trace records request headers, so
 *   `Authorization: Bearer foe_…` would be inside the zip. Off, rather than
 *   merely not uploaded, so the guard does not depend on nobody ever adding an
 *   `upload-artifact` step (§5.1 point 3). The `list` reporter is there for
 *   the same reason: no HTML report is written, so none can be uploaded.
 * - **`workers: 1`** — one Household, one writer (§6.3).
 */
const PREVIEW_PORT = 4173
const API_PORT = 8080
const API_BASE = `http://localhost:${API_PORT}/api/v1`

const baseURL =
  process.env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${PREVIEW_PORT}`

const local = !isProduction

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://foerier:foerier@localhost:5433/foerier_test'

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] === undefined ? 0 : 2,
  reporter: process.env['CI'] === undefined ? 'list' : 'html',

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  ...(local
    ? {
        // **One database, one writer** — the local twin of the production
        // branch's `workers: 1` (§6.3's "one Household, one writer").
        // `fullyParallel: false` only serialises tests *within* a file;
        // separate spec files still run in parallel, and every local spec
        // mints its Invite into the one `foerier_test`. Racing workers redeem
        // each other's, and the run fails inside `joinAs` with the server
        // logging `auth failed: invite join not redeemable` — from a spec
        // that passes alone. Worth ~2s a run.
        workers: 1,
        webServer: [
          {
            command: 'npm run dev --workspace api',
            url: `${API_BASE}/version`,
            // Deliberately never reused, even locally. `API_PORT` (8080) is
            // the same port a developer's own `npm run dev:api` listens on,
            // and that server defaults to `foerier_dev`
            // (`api/src/config.ts`), not this file's `foerier_test`. A
            // reused dev server would answer on 8080 while `mintInvite`
            // writes each test's Invite into `foerier_test` — every spec
            // then fails with "invite unknown" against a server that, from
            // the developer's side, looks perfectly healthy. A few seconds
            // per run buys certainty that this server is the one this run's
            // data actually landed in.
            reuseExistingServer: false,
            timeout: 60_000,
            env: { DATABASE_URL, PORT: String(API_PORT) },
          },
          {
            // Built here rather than reusing a stale `dist`, and pointed at the
            // local API: a production build otherwise targets
            // api.foerier.app, which is not what this run is testing.
            command: `npm run build --workspace app && npm run preview --workspace app -- --port ${PREVIEW_PORT} --strictPort`,
            url: baseURL,
            reuseExistingServer: false,
            timeout: 180_000,
            env: { VITE_API_BASE: API_BASE },
          },
        ],
      }
    : {
        globalSetup: './test/e2e/globalSetup.production.ts',
        grep: /@production/,
        workers: 1,
        reporter: 'list',
        use: { baseURL, trace: 'off' },
      }),
})
