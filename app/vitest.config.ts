import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Tier 3 — components in jsdom, behaviour-focused (`docs/testing.md`).
 *
 * Deliberately not reusing `vite.config.ts`: the PWA and font plugins do real
 * build work that a component test has no use for, and running them would make
 * the fastest tier slow for nothing.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'app',
    environment: 'jsdom',
    /**
     * The account surfaces render timestamps in the **reader's local time**
     * (Screens C §08, S5), so an unpinned zone would make those assertions
     * pass or fail by where the machine is.
     *
     * Pinned to a zone that is deliberately **not** UTC: under `TZ=UTC` a
     * local-time formatter and the ISO-slicing one it replaced produce
     * identical strings, so every assertion would hold against the bug it
     * exists to catch. Amsterdam is the household's own zone and is offset
     * in both halves of the year (+1 / +2), which is also what makes the
     * fixtures below read as the boards draw them.
     */
    env: { TZ: 'Europe/Amsterdam' },
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/testSetup.ts'],
  },
})
