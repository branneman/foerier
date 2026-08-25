import type { Clock, IdSource } from '../src/boundaries.ts'

export { aGear, aPlace, anOp, hlcAt } from './factories.ts'

/**
 * Real, minimal in-memory fakes for the injected boundaries — not
 * mocking-framework mocks (`docs/testing.md`, Philosophy). They implement the
 * whole interface and behave like the thing they replace; a test that drives
 * one is exercising real control flow.
 *
 * The factory functions this module will grow (`aTrip`, …) arrive one at a
 * time with the slices that need them. No speculative fixture library.
 */

/** A clock frozen at `start`, advanced only by an explicit {@link FakeClock.advance}. */
export interface FakeClock extends Clock {
  advance(ms: number): void
  set(ms: number): void
}

export function fakeClock(start = 0): FakeClock {
  let current = start
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
    set: (ms) => {
      current = ms
    },
  }
}

/**
 * An id source producing predictable, ordered, canonical-shaped ids
 * (`00000000-0000-7000-8000-00000000002a`), so a failing assertion names the
 * id it saw rather than a fresh random one. Ordering matches UUIDv7's: the
 * nth id sorts after the (n-1)th.
 */
export function countingIdSource(start = 0): IdSource {
  let n = start
  return {
    next: () => {
      const suffix = (n++).toString(16).padStart(12, '0')
      return `00000000-0000-7000-8000-${suffix}`
    },
  }
}
