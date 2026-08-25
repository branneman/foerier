import { describe, expect, it } from 'vitest'

import { fakeClock } from '@foerier/shared/testUtils'

import {
  SESSION_LIFETIME_MS,
  deviceLabelFrom,
  isSignCountAcceptable,
  nextExpiry,
  shouldRefreshLastSeen,
} from './session.ts'

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000

describe('nextExpiry', () => {
  it('is one year from now', () => {
    expect(nextExpiry(fakeClock(NOW))).toEqual(
      new Date(NOW + SESSION_LIFETIME_MS),
    )
    expect(SESSION_LIFETIME_MS).toBe(365 * DAY)
  })
})

describe('shouldRefreshLastSeen', () => {
  it('does not write on the common request', () => {
    // The sliding expiry must not turn every sync into a write. A device in
    // constant use would otherwise generate one UPDATE per request forever
    // (auth-design.md §6.2).
    const clock = fakeClock(NOW)
    expect(shouldRefreshLastSeen(new Date(NOW - 60_000), clock)).toBe(false)
  })

  it('writes once a day has passed', () => {
    const clock = fakeClock(NOW)
    expect(shouldRefreshLastSeen(new Date(NOW - DAY - 1), clock)).toBe(true)
  })

  it('does not write at exactly a day, only past it', () => {
    const clock = fakeClock(NOW)
    expect(shouldRefreshLastSeen(new Date(NOW - DAY), clock)).toBe(false)
  })

  it('writes for a device returning after a long time offline', () => {
    const clock = fakeClock(NOW)
    expect(shouldRefreshLastSeen(new Date(NOW - 200 * DAY), clock)).toBe(true)
  })
})

describe('isSignCountAcceptable', () => {
  it('accepts a counter that increased', () => {
    expect(isSignCountAcceptable({ stored: 4, received: 5 })).toBe(true)
  })

  it('accepts 0 against 0', () => {
    // THE case that matters. Passkey authenticators legitimately report 0
    // forever; treating that as a clone would lock out every synced credential
    // in existence (auth-design.md §4).
    expect(isSignCountAcceptable({ stored: 0, received: 0 })).toBe(true)
  })

  it('rejects a counter that went backwards', () => {
    expect(isSignCountAcceptable({ stored: 9, received: 4 })).toBe(false)
  })

  it('rejects a repeated non-zero counter', () => {
    // A non-zero counter that does not advance is the actual clone signal.
    expect(isSignCountAcceptable({ stored: 7, received: 7 })).toBe(false)
  })
})

describe('deviceLabelFrom', () => {
  it('derives something coarse and human, with no fingerprinting', () => {
    // "What it is, roughly" (story 30). No IPs, no version numbers, nothing
    // that identifies a machine rather than describes it.
    expect(
      deviceLabelFrom(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android')

    expect(
      deviceLabelFrom(
        'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
      ),
    ).toBe('Firefox on Android')

    expect(
      deviceLabelFrom(
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe('Safari on iPad')

    expect(
      deviceLabelFrom(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36 Edg/131',
      ),
    ).toBe('Edge on Windows')
  })

  it('falls back to a plain fact rather than guessing', () => {
    expect(deviceLabelFrom('curl/8.4.0')).toBe('Unknown device')
    expect(deviceLabelFrom(undefined)).toBe('Unknown device')
    expect(deviceLabelFrom('')).toBe('Unknown device')
  })
})
