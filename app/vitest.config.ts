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
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./src/testSetup.ts'],
  },
})
