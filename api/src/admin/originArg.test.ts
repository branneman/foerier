import { describe, expect, it } from 'vitest'

import { parseOriginArg } from './originArg.ts'

describe('parseOriginArg', () => {
  it('accepts a bare http origin', () => {
    expect(parseOriginArg('http://192.168.1.42:5173')).toBe(
      'http://192.168.1.42:5173',
    )
  })

  it('accepts a bare https origin', () => {
    expect(parseOriginArg('https://app.foerier.app')).toBe(
      'https://app.foerier.app',
    )
  })

  it('normalises away a trailing slash', () => {
    expect(parseOriginArg('http://192.168.1.42:5173/')).toBe(
      'http://192.168.1.42:5173',
    )
  })

  it('rejects a malformed URL', () => {
    expect(() => parseOriginArg('not-a-url')).toThrow(/not a URL/)
  })

  it('rejects a non-http(s) protocol', () => {
    expect(() => parseOriginArg('ftp://192.168.1.42')).toThrow(/http:.*https:/)
  })

  // The dangerous case: a path here would land in the printed link as
  // `${origin}/join#secret`, so `http://host/join` would double up into
  // `http://host/join/join#secret` rather than failing loudly.
  it('rejects an origin with a path', () => {
    expect(() => parseOriginArg('http://192.168.1.42/join')).toThrow(/path/)
  })

  it('rejects an origin with a query string', () => {
    expect(() => parseOriginArg('http://192.168.1.42?x=1')).toThrow(
      /query or fragment/,
    )
  })

  it('rejects an origin with a fragment', () => {
    expect(() => parseOriginArg('http://192.168.1.42#x')).toThrow(
      /query or fragment/,
    )
  })
})
