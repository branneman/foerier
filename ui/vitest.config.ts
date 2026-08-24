import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'ui',
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./src/testSetup.ts'],
  },
})
