import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  normalizeTag,
  normalizeTagInput,
  TAG_PATTERN,
  type TagString,
} from './tags.ts'

/**
 * `sync-protocol.md` §4.3's `TagString` is an **authoring** rule: lowercase
 * `[a-z0-9-]`, 1–40 characters, stored without the `#` every screen draws.
 * This module is the only place that rule is applied, and it is applied on
 * the way *out*. Nothing here is a validation gate — `reduce.ts` reads a tag
 * with plain `readString` and folds whatever arrives (§5's tolerant-reader
 * discipline, which outranks this rule).
 */

describe('normalizeTag', () => {
  it('passes a conforming tag through unchanged', () => {
    expect(normalizeTag('winter')).toBe('winter')
    expect(normalizeTag('cook-set')).toBe('cook-set')
    expect(normalizeTag('3-season')).toBe('3-season')
  })

  it('folds case down', () => {
    expect(normalizeTag('Winter')).toBe('winter')
    expect(normalizeTag('WINTER')).toBe('winter')
  })

  it('collapses a run of whitespace to a single hyphen', () => {
    expect(normalizeTag('cook set')).toBe('cook-set')
    expect(normalizeTag('cook   set')).toBe('cook-set')
    expect(normalizeTag('cook\tset')).toBe('cook-set')
  })

  it('trims surrounding whitespace rather than turning it into hyphens', () => {
    expect(normalizeTag('  winter  ')).toBe('winter')
  })

  // The `#` is drawn by every chip and stored by nothing, so `##winter` must
  // be unreachable (`docs/design/README.md` §4a).
  it('strips a typed #, however many were typed', () => {
    expect(normalizeTag('#winter')).toBe('winter')
    expect(normalizeTag('##winter')).toBe('winter')
    expect(normalizeTag('win#ter')).toBe('winter')
  })

  it('drops characters outside the charset', () => {
    expect(normalizeTag('winter!')).toBe('winter')
    expect(normalizeTag('cook/set')).toBe('cookset')
    expect(normalizeTag('first_aid')).toBe('firstaid')
  })

  /**
   * The same fold `selectors/find.ts` applies to a search query, for the same
   * reason: a household that owns a `Hütte` kit types `hütte`, and dropping
   * the `ü` outright would file it as `htte`. Two surfaces disagreeing about
   * whether `ö` is an `o` is a bug waiting to be filed.
   */
  it('transliterates accented and non-decomposing letters', () => {
    expect(normalizeTag('hütte')).toBe('hutte')
    expect(normalizeTag('Norrøna')).toBe('norrona')
    expect(normalizeTag('Straße')).toBe('strasse')
  })

  it('collapses a run of hyphens to one', () => {
    expect(normalizeTag('cook--set')).toBe('cook-set')
    // A dropped character between two hyphens must not leave two behind.
    expect(normalizeTag('cook-/-set')).toBe('cook-set')
  })

  it('trims leading and trailing hyphens', () => {
    expect(normalizeTag('-winter-')).toBe('winter')
    expect(normalizeTag('winter ')).toBe('winter')
  })

  it('truncates to 40 characters', () => {
    expect(normalizeTag('a'.repeat(41))).toBe('a'.repeat(40))
  })

  // Truncation lands mid-word as readily as not, and a tag must never end in
  // the hyphen the cut happened to leave behind.
  it('does not leave a trailing hyphen behind after truncating', () => {
    expect(normalizeTag(`${'a'.repeat(39)}-bcd`)).toBe('a'.repeat(39))
  })

  it('answers null when nothing conforming survives', () => {
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag('#')).toBeNull()
    expect(normalizeTag('!!!')).toBeNull()
    expect(normalizeTag('---')).toBeNull()
  })

  /**
   * The enumerated cases above each pin one rule; this pins the *contract*.
   * Whatever a human manages to type — emoji, RTL marks, control characters,
   * a paragraph — the answer is either `null` or a tag that conforms. Nothing
   * else may ever escape this function, because nothing downstream checks.
   */
  it('answers null or a conforming tag, for any input at all', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const tag = normalizeTag(input)
        if (tag === null) return
        expect(tag).toMatch(TAG_PATTERN)
      }),
    )
  })

  it('is idempotent — normalising a normalised tag changes nothing', () => {
    const inputs = ['Winter Kit', '##cook  set!', ' -Hütte- ', 'a'.repeat(50)]
    for (const input of inputs) {
      const once = normalizeTag(input)
      expect(once).not.toBeNull()
      expect(normalizeTag(once as string)).toBe(once)
    }
  })
})

/**
 * The typing-time half of the rule. `normalizeTag` trims trailing hyphens,
 * because a finished tag must never end in one — but applied to every
 * keystroke that destroys the space in `cook set` before the `s` arrives, and
 * the picker silently produces `cookset`. A live field needs the same rule
 * minus the trailing trim.
 */
describe('normalizeTagInput', () => {
  it('keeps the hyphen a trailing space became, so the next word can follow', () => {
    expect(normalizeTagInput('cook ')).toBe('cook-')
    expect(normalizeTagInput('cook set')).toBe('cook-set')
  })

  it('still refuses a leading hyphen — no tag may start with one', () => {
    expect(normalizeTagInput(' cook')).toBe('cook')
    expect(normalizeTagInput('-cook')).toBe('cook')
  })

  it('still collapses runs, folds case, and drops what is outside the charset', () => {
    expect(normalizeTagInput('Cook  Set!')).toBe('cook-set')
    expect(normalizeTagInput('#hütte')).toBe('hutte')
    expect(normalizeTagInput('cook--')).toBe('cook-')
  })

  it('answers empty rather than null — a field holds a string', () => {
    expect(normalizeTagInput('###')).toBe('')
  })

  /**
   * The contract that ties the two together: whatever the field holds,
   * `normalizeTag` of it is what the op will carry. There is no third rule
   * hiding between what is typed and what is stored.
   */
  it('agrees with normalizeTag on everything but the trailing hyphen', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(normalizeTag(normalizeTagInput(input))).toBe(normalizeTag(input))
      }),
    )
  })
})

describe('TagString', () => {
  /**
   * The brand is the whole defence the design asks for: `docs/design/
   * README.md` §4a makes the picker the *only* place a spelling is ever
   * decided, because there is no Tag entity and no rename op. A raw string
   * must therefore be unable to reach an authoring builder, and the compiler
   * is what enforces it — this assertion is checked by Tier 0's `tsc`, not at
   * runtime.
   */
  it('cannot be produced from a raw string', () => {
    // @ts-expect-error a raw string is not a TagString; only normalizeTag makes one
    const forged: TagString = 'winter'
    expect(forged).toBe('winter')
  })

  it('is still a string everywhere a string is wanted', () => {
    const tag = normalizeTag('winter')
    expect(tag).not.toBeNull()
    expect((tag as TagString).toUpperCase()).toBe('WINTER')
  })
})
