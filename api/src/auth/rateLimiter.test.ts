import { describe, expect, it } from 'vitest'

import { fakeClock } from '@foerier/shared/testUtils'

import { createRateLimiter } from './rateLimiter.ts'

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0)

describe('createRateLimiter', () => {
  it('admits requests up to the burst size', () => {
    const limiter = createRateLimiter({
      capacity: 3,
      refillPerMinute: 3,
      clock: fakeClock(NOW),
    })

    expect(limiter.take('1.2.3.4')).toBe(true)
    expect(limiter.take('1.2.3.4')).toBe(true)
    expect(limiter.take('1.2.3.4')).toBe(true)
    expect(limiter.take('1.2.3.4')).toBe(false)
  })

  it('refills over time', () => {
    const clock = fakeClock(NOW)
    const limiter = createRateLimiter({
      capacity: 2,
      refillPerMinute: 60,
      clock,
    })

    limiter.take('ip')
    limiter.take('ip')
    expect(limiter.take('ip')).toBe(false)

    clock.advance(1_000)
    expect(limiter.take('ip')).toBe(true)
  })

  it('never refills past capacity', () => {
    // A bucket that accumulated credit while idle would let a returning client
    // burst far past the limit it is supposed to enforce.
    const clock = fakeClock(NOW)
    const limiter = createRateLimiter({
      capacity: 2,
      refillPerMinute: 60,
      clock,
    })

    clock.advance(60 * 60 * 1000)

    expect(limiter.take('ip')).toBe(true)
    expect(limiter.take('ip')).toBe(true)
    expect(limiter.take('ip')).toBe(false)
  })

  it('counts each caller separately', () => {
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerMinute: 1,
      clock: fakeClock(NOW),
    })

    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
    expect(limiter.take('b')).toBe(true)
  })

  it('forgets callers that have gone quiet', () => {
    // This is a process-lifetime map fed by an unauthenticated endpoint, so
    // without eviction it is an unbounded allocation an attacker controls.
    const clock = fakeClock(NOW)
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerMinute: 60,
      clock,
    })

    limiter.take('transient')
    expect(limiter.size()).toBe(1)

    clock.advance(60 * 60 * 1000)
    limiter.take('someone-else')

    expect(limiter.size()).toBe(1)
  })
})
