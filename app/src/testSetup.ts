import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * jsdom implements no CSS layout and no `matchMedia`, so a screen that asks
 * which layout mode it is in gets an honest, controllable answer here instead
 * of a missing global.
 *
 * `useMediaQuery` fails open to `false` on its own, so a test that says
 * nothing gets the single-column phone layout — the mode every other one
 * degrades to, and the one most tests mean. {@link setViewport} is for the
 * tests that are specifically about a wider mode.
 */
let matches = new Set<string>()

/**
 * Make these queries match until the next test. Pass nothing to reset.
 *
 * The stub matches **exact query strings**, so it will happily describe a
 * viewport that cannot exist: `setViewport(DESKTOP)` alone is a width at or
 * above 64em that is somehow below 52em. Name every breakpoint the width
 * crosses — `setViewport(SPLIT, DESKTOP)` for Desktop — or the first component
 * that starts asking about Split gets a silently wrong answer.
 */
export function setViewport(...queries: readonly string[]): void {
  matches = new Set(queries)
}

const listeners = new Set<() => void>()

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList =>
    ({
      media: query,
      get matches() {
        return matches.has(query)
      },
      onchange: null,
      addEventListener: (_: string, handler: () => void) => {
        listeners.add(handler)
      },
      removeEventListener: (_: string, handler: () => void) => {
        listeners.delete(handler)
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
})

afterEach(() => {
  cleanup()
  setViewport()
  listeners.clear()
  // `slicePrefs` persists sort and group per device, and jsdom keeps one
  // `localStorage` for the whole file — so without this a test that changes
  // the grouping silently changes the starting state of every test after it.
  // Found by exactly that: a sort assertion three tests later was reading a
  // list grouped by an earlier test.
  localStorage.clear()
})
