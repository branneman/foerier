import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SLICE_PREFS,
  readSlicePrefs,
  writeSlicePrefs,
  type SlicePrefs,
} from './slicePrefs'

/**
 * "Sort and group persist per device; filter chips and search reset on a
 * fresh start" (`docs/design/README.md` §3).
 *
 * A real in-memory `Storage`, never a mocking-framework mock — the same rule
 * every other boundary in this codebase follows.
 */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
  }
}

/** Storage that throws on every access — a private window, or a browser set
 * to block site data. Reachable in the wild, so it must not take the screen
 * with it. */
function hostileStorage(): Storage {
  const boom = () => {
    throw new DOMException('denied', 'SecurityError')
  }
  return {
    get length(): number {
      return boom()
    },
    key: boom,
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
  } as unknown as Storage
}

describe('readSlicePrefs', () => {
  it('answers the defaults on a device that has never chosen', () => {
    expect(readSlicePrefs(fakeStorage())).toEqual(DEFAULT_SLICE_PREFS)
  })

  it('answers what was written', () => {
    const storage = fakeStorage()
    const prefs: SlicePrefs = { sort: 'newest', group: 'kind' }
    writeSlicePrefs(prefs, storage)
    expect(readSlicePrefs(storage)).toEqual(prefs)
  })

  it('falls back to the defaults rather than crashing on nonsense', () => {
    expect(
      readSlicePrefs(fakeStorage({ 'foerier.slice': 'not json' })),
    ).toEqual(DEFAULT_SLICE_PREFS)
  })

  /**
   * A preference written by a *later* build naming a sort this one has never
   * heard of is the same tolerant-reader problem the op log has, at a much
   * smaller scale: the answer is to ignore the value, not to render a list
   * sorted by nothing.
   */
  it('ignores a sort or group this build does not know', () => {
    const storage = fakeStorage({
      'foerier.slice': JSON.stringify({ sort: 'by-weight', group: 'tag' }),
    })
    expect(readSlicePrefs(storage)).toEqual(DEFAULT_SLICE_PREFS)
  })

  it('keeps the half it recognises when the other half is unknown', () => {
    const storage = fakeStorage({
      'foerier.slice': JSON.stringify({ sort: 'newest', group: 'tag' }),
    })
    expect(readSlicePrefs(storage)).toEqual({ sort: 'newest', group: 'none' })
  })

  it('survives storage that refuses to be read', () => {
    expect(readSlicePrefs(hostileStorage())).toEqual(DEFAULT_SLICE_PREFS)
  })
})

describe('writeSlicePrefs', () => {
  it('survives storage that refuses to be written', () => {
    // Losing a sort preference costs one tap. Throwing here would cost the
    // whole screen.
    expect(() =>
      writeSlicePrefs({ sort: 'newest', group: 'kind' }, hostileStorage()),
    ).not.toThrow()
  })
})
