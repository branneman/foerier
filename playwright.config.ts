import { defineConfig, devices } from '@playwright/test'

/**
 * Tier 5 — the real app in a real browser, exercising one core journey
 * (`docs/testing.md`). Deliberately small: edge cases belong in lower tiers.
 *
 * Targets a local dev server by default. Once the deployment pipeline exists,
 * the post-deploy CI job points `PLAYWRIGHT_BASE_URL` at `app.foerier.app`
 * and the same specs run against production — retargeting is one variable, not
 * a rewrite.
 */
/**
 * Locally this runs against a *production build* served by `vite preview`, not
 * against the dev server. That is not fussiness: `vite-plugin-pwa` does not
 * run a service worker in dev, so the dev server cannot go offline — and the
 * offline leg is the one thing Tier 5 exists to prove here.
 */
const PREVIEW_PORT = 4173
const baseURL =
  process.env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${PREVIEW_PORT}`

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] === undefined ? 0 : 2,
  reporter: process.env['CI'] === undefined ? 'list' : 'html',

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Only boot a dev server when pointing at the default local target; against
  // a deployed origin there is nothing to start.
  ...(process.env['PLAYWRIGHT_BASE_URL'] === undefined
    ? {
        webServer: {
          command: `npm run build --workspace app && npm run preview --workspace app -- --port ${PREVIEW_PORT} --strictPort`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }
    : {}),
})
