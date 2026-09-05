import { describe, expect, it } from 'vitest'

import { KIND_OPTIONS, TRAIT_OPTIONS } from './gear'

/**
 * The vocabularies two screens each used to carry a copy of. There is no
 * runtime catalogue in `shared/` to check these against and deliberately so —
 * `KindValue` is an **open** enum (`kind.ts`: a value this build does not
 * know is still a value somebody stated), so the three known members are a
 * fact about what this app lets a Quartermaster *author*, not about what it
 * can read. That is exactly why they are worth pinning here: an authoring
 * vocabulary has no reader to fall back on.
 */
describe('the gear-authoring vocabularies', () => {
  it('offers the three Kinds a Quartermaster may author', () => {
    expect(KIND_OPTIONS).toEqual([
      { value: 'single', label: 'Single' },
      { value: 'per_person', label: 'Per-person' },
      { value: 'counted', label: 'Counted' },
    ])
  })

  /** The trait is a boolean register drawn as two words; there is no third. */
  it('offers exactly the two trait words', () => {
    expect(TRAIT_OPTIONS).toEqual([
      { value: 'item', label: 'Item' },
      { value: 'container', label: 'Container' },
    ])
  })
})
