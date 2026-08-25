import { describe, expect, it } from 'vitest'

import {
  TOKEN_PREFIX,
  generateInviteSecret,
  hashSecret,
  issueDeviceToken,
} from './tokens.ts'

describe('issueDeviceToken', () => {
  it('prefixes the token so a human or a secret scanner recognises it', () => {
    // The prefix earns its keep the day one of these turns up in a log or a
    // pasted bug report (auth-design.md §6.1).
    expect(issueDeviceToken().token.startsWith(TOKEN_PREFIX)).toBe(true)
  })

  it('carries 256 bits of randomness', () => {
    const { token } = issueDeviceToken()
    const secret = token.slice(TOKEN_PREFIX.length)

    // 32 bytes base64url, unpadded.
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('never repeats', () => {
    const tokens = new Set(
      Array.from({ length: 1000 }, () => issueDeviceToken().token),
    )

    expect(tokens.size).toBe(1000)
  })

  it('returns the hash that gets stored, never the token itself', () => {
    const { token, tokenHash } = issueDeviceToken()

    expect(tokenHash).toEqual(hashSecret(token))
    // A database reader must not be able to mint access from a stored row.
    expect(Buffer.from(tokenHash).toString()).not.toContain(token)
  })
})

describe('hashSecret', () => {
  it('is SHA-256 — 32 bytes', () => {
    expect(hashSecret('anything')).toHaveLength(32)
  })

  it('is stable, so a lookup by hash finds the row', () => {
    expect(hashSecret('foe_abc')).toEqual(hashSecret('foe_abc'))
  })

  it('separates values that differ by one character', () => {
    expect(hashSecret('foe_abc')).not.toEqual(hashSecret('foe_abd'))
  })
})

describe('generateInviteSecret', () => {
  it('is 32 random bytes, base64url, and carries no prefix', () => {
    // Unlike a device token this one travels in a URL fragment, where a
    // recognisable prefix would only help someone reading over a shoulder.
    const { secret } = generateInviteSecret()

    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(secret.startsWith(TOKEN_PREFIX)).toBe(false)
  })

  it('is URL-fragment safe, so the link never needs encoding', () => {
    for (let i = 0; i < 200; i++) {
      const { secret } = generateInviteSecret()
      expect(encodeURIComponent(secret)).toBe(secret)
    }
  })
})
