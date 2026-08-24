import { v7 as uuidv7 } from 'uuid'

/**
 * The two boundaries every tier below Tier 4 replaces with a real in-memory
 * fake rather than a mocking-framework mock (`docs/testing.md`, Tier 1).
 *
 * They are interfaces rather than direct calls so that a test can hand the
 * unit under test a fixed clock or a counting id source and get deterministic
 * output, without a global patch that leaks between tests.
 */

/** A source of wall-clock time, in milliseconds since the Unix epoch. */
export interface Clock {
  now(): number
}

/** A source of fresh identifiers. Every id foerier mints is a UUIDv7. */
export interface IdSource {
  next(): string
}

export const systemClock: Clock = {
  now: () => Date.now(),
}

/**
 * UUIDv7 is not an aesthetic choice: op ids are time-ordered, which is what
 * makes a re-sent op dedupe idempotently and a raw log dump sort sensibly
 * (`docs/architecture-design.md` §2).
 */
export const systemIdSource: IdSource = {
  next: () => uuidv7(),
}
