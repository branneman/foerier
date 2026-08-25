import { defineConfig, devices } from '@playwright/test'

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
 * Once the deployment pipeline exists, the post-deploy CI job points
 * `PLAYWRIGHT_BASE_URL` at `app.foerier.app` and the same specs run against
 * production — retargeting is one variable, not a rewrite.
 */
const PREVIEW_PORT = 4173
const API_PORT = 8080
const API_BASE = `http://localhost:${API_PORT}/api/v1`

const baseURL =
  process.env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${PREVIEW_PORT}`

const local = process.env['PLAYWRIGHT_BASE_URL'] === undefined

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
        webServer: [
          {
            command: 'npm run dev --workspace api',
            url: `${API_BASE}/version`,
            reuseExistingServer: process.env['CI'] === undefined,
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
    : {}),
})
