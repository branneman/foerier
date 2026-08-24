import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Without this, each `render` appends to the same document and later queries
// match elements left behind by earlier tests.
afterEach(() => {
  cleanup()
})
