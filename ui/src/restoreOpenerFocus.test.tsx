import { describe, expect, it, vi } from 'vitest'

import { restoreOpenerFocus } from './restoreOpenerFocus'

/**
 * Fix round F3. This is tested directly rather than through `Sheet`/
 * `Confirm` end-to-end: Radix's own `FocusScope` restore targets the exact
 * same (by-then-detached) element `opener.current` does, so an end-to-end
 * assertion on `document.activeElement` cannot tell the fixed code apart
 * from the bug it replaces — both leave focus on `<body>` once the opener
 * is gone. What changed is narrower and directly observable here: whether
 * this handler claims the restore (`preventDefault()` + `focus()`) or
 * leaves it alone.
 */
describe('restoreOpenerFocus', () => {
  it('claims the restore when the opener is still on the page', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    const event = { preventDefault: vi.fn() }

    restoreOpenerFocus(opener, event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(opener)

    opener.remove()
  })

  it('leaves Radix’s own restore alone once the opener has left the page', () => {
    // Never appended — `REMOVE ON <trip>` settling the conflict makes
    // `OverClaimBand` return `null`, and `Start pack-out` moving the phase
    // unmounts the button the same way: gone by the time this runs.
    const opener = document.createElement('button')
    const event = { preventDefault: vi.fn() }

    restoreOpenerFocus(opener, event)

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does nothing when there was no opener to begin with', () => {
    const event = { preventDefault: vi.fn() }

    expect(() => restoreOpenerFocus(null, event)).not.toThrow()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
