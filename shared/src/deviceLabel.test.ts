import { describe, expect, it } from 'vitest'

import { guessDeviceLabel } from './deviceLabel.ts'

/**
 * The table itself is exercised thoroughly by `api/src/auth/session.test.ts`
 * (`deviceLabelFrom`, which wraps this) — these pin the two things that are
 * this module's own: the `null` contract callers build their own fallback
 * on, and that a real iPad's Safari UA resolves correctly now that `iPad` is
 * checked before `iPhone` (`final-review.md` finding 10's drift).
 */
describe('guessDeviceLabel', () => {
  it('names browser and platform for a real UA', () => {
    expect(
      guessDeviceLabel(
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe('Safari on iPad')
  })

  it('returns null, not a guess, when either half cannot be told', () => {
    expect(guessDeviceLabel('curl/8.4.0')).toBeNull()
    expect(guessDeviceLabel(undefined)).toBeNull()
    expect(guessDeviceLabel(null)).toBeNull()
    expect(guessDeviceLabel('')).toBeNull()
  })
})
