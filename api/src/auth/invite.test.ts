import { describe, expect, it } from 'vitest'

import { fakeClock } from '@foerier/shared/testUtils'

import {
  INVITE_LIFETIME_MS,
  inviteState,
  isRedeemable,
  type InviteRecord,
} from './invite.ts'

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0)

function anInvite(overrides: Partial<InviteRecord> = {}): InviteRecord {
  return {
    purpose: 'join',
    expires_at: new Date(NOW + 60_000),
    used_at: null,
    revoked_at: null,
    ...overrides,
  }
}

describe('inviteState', () => {
  const clock = fakeClock(NOW)

  it('is fresh while unexpired, unused and unrevoked', () => {
    expect(inviteState(anInvite(), clock)).toBe('fresh')
  })

  it('is used once redeemed', () => {
    expect(
      inviteState(anInvite({ used_at: new Date(NOW - 1000) }), clock),
    ).toBe('used')
  })

  it('is revoked once revoked', () => {
    expect(
      inviteState(anInvite({ revoked_at: new Date(NOW - 1000) }), clock),
    ).toBe('revoked')
  })

  it('is expired at exactly its expiry, not a moment later', () => {
    // An off-by-one here is a link that works for one extra request.
    expect(inviteState(anInvite({ expires_at: new Date(NOW) }), clock)).toBe(
      'expired',
    )
    expect(
      inviteState(anInvite({ expires_at: new Date(NOW + 1) }), clock),
    ).toBe('fresh')
  })

  it('reports used ahead of expired when both are true', () => {
    // Only affects the log line, never the client: every non-fresh state
    // returns one indistinguishable response (auth-design.md §9.4). But the
    // log should say the more specific thing that happened.
    const spent = anInvite({
      used_at: new Date(NOW - 10_000),
      expires_at: new Date(NOW - 5_000),
    })

    expect(inviteState(spent, clock)).toBe('used')
  })

  it('reports revoked ahead of used', () => {
    const both = anInvite({
      used_at: new Date(NOW - 10_000),
      revoked_at: new Date(NOW - 20_000),
    })

    expect(inviteState(both, clock)).toBe('revoked')
  })
})

describe('isRedeemable', () => {
  const clock = fakeClock(NOW)

  it('admits only a fresh invite', () => {
    expect(isRedeemable(anInvite(), clock)).toBe(true)
    expect(isRedeemable(anInvite({ used_at: new Date(NOW) }), clock)).toBe(
      false,
    )
    expect(isRedeemable(anInvite({ revoked_at: new Date(NOW) }), clock)).toBe(
      false,
    )
    expect(
      isRedeemable(anInvite({ expires_at: new Date(NOW - 1) }), clock),
    ).toBe(false)
  })
})

describe('INVITE_LIFETIME_MS', () => {
  it('gives a join invite 7 days and a device link 1 hour', () => {
    // A join invite is handed over at leisure; a device link is used while
    // both people are standing there (auth-design.md §3.1).
    expect(INVITE_LIFETIME_MS.join).toBe(7 * 24 * 60 * 60 * 1000)
    expect(INVITE_LIFETIME_MS.device).toBe(60 * 60 * 1000)
  })
})
