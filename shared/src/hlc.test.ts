import { describe, expect, it } from 'vitest'

import { fakeClock } from '../testUtils/index.ts'
import {
  compareStamps,
  createHlcClock,
  DRIFT_BOUND_MS,
  formatHlc,
  HLC_PATTERN,
  issueAt,
  parseHlc,
  receiveAt,
} from './hlc.ts'

const T = Date.UTC(2026, 7, 24, 10, 3, 11, 442)
const A = 'aaaaaaaa-0000-7000-8000-000000000001'
const B = 'bbbbbbbb-0000-7000-8000-000000000002'

describe('formatHlc / parseHlc', () => {
  it('renders the fixed-width sortable form of sync-protocol §2.2', () => {
    expect(formatHlc({ ms: T, counter: 7 })).toBe(
      '2026-08-24T10:03:11.442Z-0007',
    )
  })

  it('round-trips', () => {
    const parts = { ms: T, counter: 0xabcd }
    expect(parseHlc(formatHlc(parts))).toEqual(parts)
  })

  it('always emits three fractional digits and four lowercase hex', () => {
    const hlc = formatHlc({ ms: Date.UTC(2026, 0, 1), counter: 10 })
    expect(hlc).toBe('2026-01-01T00:00:00.000Z-000a')
    expect(HLC_PATTERN.test(hlc)).toBe(true)
  })

  it('sorts correctly as a plain string, which is the whole point', () => {
    const a = formatHlc({ ms: T, counter: 9 })
    const b = formatHlc({ ms: T, counter: 10 })
    const c = formatHlc({ ms: T + 1, counter: 0 })
    expect([c, b, a].sort()).toEqual([a, b, c])
  })

  it('rejects anything off-grammar rather than guessing', () => {
    expect(parseHlc('2026-08-24T10:03:11.44Z-0007')).toBeNull()
    expect(parseHlc('2026-08-24T10:03:11.442Z-7')).toBeNull()
    expect(parseHlc('2026-08-24T10:03:11.442Z-000G')).toBeNull()
    expect(parseHlc('2026-08-24T10:03:11.442+02:00-0007')).toBeNull()
    expect(parseHlc('')).toBeNull()
  })
})

describe('issueAt', () => {
  it('takes the wall clock when it has moved on', () => {
    expect(issueAt({ ms: T, counter: 4 }, T + 1)).toEqual({
      ms: T + 1,
      counter: 0,
    })
  })

  it('increments the counter within one millisecond', () => {
    expect(issueAt({ ms: T, counter: 4 }, T)).toEqual({ ms: T, counter: 5 })
  })

  it('is unharmed by a wall clock that jumps backwards', () => {
    expect(issueAt({ ms: T, counter: 4 }, T - 60_000)).toEqual({
      ms: T,
      counter: 5,
    })
  })

  it('carries into the next millisecond at counter overflow', () => {
    expect(issueAt({ ms: T, counter: 0xffff }, T)).toEqual({
      ms: T + 1,
      counter: 0,
    })
  })
})

describe('receiveAt', () => {
  it('adopts a peer ahead of us, one past its counter', () => {
    const { next, driftExceeded } = receiveAt(
      { ms: T, counter: 2 },
      { ms: T + 5, counter: 9 },
      T,
    )
    expect(next).toEqual({ ms: T + 5, counter: 10 })
    expect(driftExceeded).toBe(false)
  })

  it('takes the max counter when local, remote and now agree on the ms', () => {
    expect(
      receiveAt({ ms: T, counter: 2 }, { ms: T, counter: 9 }, T).next,
    ).toEqual({
      ms: T,
      counter: 10,
    })
  })

  it('resets the counter when the wall clock leads both', () => {
    expect(
      receiveAt({ ms: T, counter: 2 }, { ms: T, counter: 9 }, T + 5).next,
    ).toEqual({
      ms: T + 5,
      counter: 0,
    })
  })

  it('does not adopt a peer beyond the drift bound, but reports it', () => {
    const far = { ms: T + DRIFT_BOUND_MS + 1, counter: 0 }
    const { next, driftExceeded } = receiveAt({ ms: T, counter: 2 }, far, T)
    expect(driftExceeded).toBe(true)
    // The local clock moves on by its own rule only — never to the peer's
    // time. One phone with a mistyped year must not poison the household's
    // clock permanently (sync-protocol §2.6).
    expect(next).toEqual({ ms: T, counter: 3 })
  })

  it('adopts a peer exactly at the bound', () => {
    const edge = { ms: T + DRIFT_BOUND_MS, counter: 0 }
    const { next, driftExceeded } = receiveAt({ ms: T, counter: 2 }, edge, T)
    expect(driftExceeded).toBe(false)
    expect(next).toEqual({ ms: T + DRIFT_BOUND_MS, counter: 1 })
  })

  it('is unmoved by a peer behind us', () => {
    const { next } = receiveAt(
      { ms: T, counter: 2 },
      { ms: T - 999, counter: 0 },
      T - 1000,
    )
    expect(next).toEqual({ ms: T, counter: 3 })
  })
})

describe('compareStamps', () => {
  const hlc = formatHlc({ ms: T, counter: 1 })
  const later = formatHlc({ ms: T, counter: 2 })

  it('orders by hlc first', () => {
    expect(
      compareStamps({ hlc, deviceId: B }, { hlc: later, deviceId: A }),
    ).toBeLessThan(0)
  })

  it('breaks an exact tie on device id', () => {
    expect(
      compareStamps({ hlc, deviceId: A }, { hlc, deviceId: B }),
    ).toBeLessThan(0)
  })

  it('is zero only for the same stamp from the same device', () => {
    expect(compareStamps({ hlc, deviceId: A }, { hlc, deviceId: A })).toBe(0)
  })
})

describe('createHlcClock', () => {
  it('never issues the same stamp twice, even with a frozen clock', () => {
    const clock = createHlcClock(fakeClock(T))
    const issued = Array.from({ length: 100 }, () => clock.issue())
    expect(new Set(issued).size).toBe(100)
    expect([...issued].sort()).toEqual(issued)
  })

  it('re-establishes monotonicity after its state is lost', () => {
    const restored = createHlcClock(fakeClock(T - 10_000))
    restored.receive(formatHlc({ ms: T, counter: 5 }))
    expect(restored.issue() > formatHlc({ ms: T, counter: 5 })).toBe(true)
  })

  it('ignores an unparseable peer hlc rather than throwing', () => {
    const clock = createHlcClock(fakeClock(T), { ms: T, counter: 3 })
    expect(() => clock.receive('not-an-hlc')).not.toThrow()
    // A malformed op teaches the clock nothing about the peer, so the clock
    // must not move. `issue()` maxes against the wall clock anyway, so
    // standing still here costs nothing.
    expect(clock.state()).toEqual({ ms: T, counter: 3 })
  })
})
