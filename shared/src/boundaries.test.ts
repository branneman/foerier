import { describe, expect, it } from 'vitest'
import { systemIdSource } from './boundaries.ts'

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('systemIdSource', () => {
  it('mints lowercase canonical UUIDs', () => {
    expect(systemIdSource.next()).toMatch(CANONICAL_UUID)
  })

  it('mints version 7, not version 4', () => {
    // The version nibble is the first character of the third group. This is
    // worth pinning: a silent downgrade to v4 would still produce valid,
    // unique ids, and the op log would lose its time ordering without a
    // single test going red anywhere else.
    const [, , third] = systemIdSource.next().split('-')
    expect(third?.[0]).toBe('7')
  })

  it('mints ids that sort ascending, including within one millisecond', () => {
    // The property the op log actually depends on: a re-sent op dedupes by id
    // and a raw log dump sorts sensibly (architecture-design.md §2). A v7
    // implementation without an intra-millisecond counter would fail this
    // burst while passing every other test here.
    const ids = Array.from({ length: 500 }, () => systemIdSource.next())
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
