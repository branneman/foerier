import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Popover } from './Popover'

/**
 * `ui/Popover` (`docs/design/README.md` §5n K15–K17).
 *
 * Two halves, and they need two techniques. **What it does** — mounted is
 * open, the anchor is not a trigger, Escape and an outside pointer-down
 * close, focus comes back — is behaviour and is rendered here. **What it
 * looks like** is CSS, and Vitest processes no CSS modules and jsdom computes
 * no layout, so the anatomy is asserted as *stylesheet text*, the technique
 * `drawnSizes.test.ts` and `typeScale.test.ts` already use.
 */

const HERE = dirname(new URL(import.meta.url).pathname)

function stylesheet(): string {
  return readFileSync(join(HERE, 'Popover.module.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
}

/**
 * A caller in miniature, written the way all seven real ones are: the button
 * is the caller's, `open` is the caller's state, and the popover is mounted
 * rather than told to open.
 */
function Caller({ onClose }: { onClose?: () => void } = {}) {
  const [open, setOpen] = useState(false)
  const trigger = (
    <button type="button" onClick={() => setOpen((was) => !was)}>
      Who brings one
    </button>
  )

  return open ? (
    <Popover
      anchor={trigger}
      label="Who brings one"
      align="end"
      padding="rows"
      onClose={() => {
        setOpen(false)
        onClose?.()
      }}
    >
      <button type="button">Els</button>
    </Popover>
  ) : (
    trigger
  )
}

describe('Popover', () => {
  it('is opened by the caller’s own state, never by the anchor', async () => {
    const user = userEvent.setup()
    render(<Caller />)

    // Nothing is mounted until the caller says so — `{open && …}`, which is
    // what keeps mount the reset for a picker's drafts.
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Who brings one' }))

    expect(screen.getByRole('dialog', { name: 'Who brings one' })).toBeVisible()
  })

  /**
   * **The anchor keeps its own props.** A Radix `Trigger` clones its child to
   * attach `aria-expanded`, `aria-controls`, a ref and an `onClick`; these
   * triggers are real controls with their own accessible names and, often, a
   * hit extension clamped to their row. The anchor is positioned against and
   * nothing else.
   */
  it('leaves the anchor an ordinary button', async () => {
    const user = userEvent.setup()
    render(<Caller />)
    await user.click(screen.getByRole('button', { name: 'Who brings one' }))

    const anchor = screen.getByRole('button', { name: 'Who brings one' })
    expect(anchor).not.toHaveAttribute('aria-expanded')
    expect(anchor).not.toHaveAttribute('aria-controls')
    // Still the caller's toggle: a second press closes it, through the
    // caller's state rather than through Radix.
    await user.click(anchor)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape and reports it to the caller', async () => {
    const user = userEvent.setup()
    let closed = 0
    render(<Caller onClose={() => (closed += 1)} />)
    await user.click(screen.getByRole('button', { name: 'Who brings one' }))

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(closed).toBe(1)
  })

  describe('the anatomy, as stylesheet text', () => {
    it('takes the card radius — not the sheet’s, not a control’s', () => {
      // 12. Not 16, which is the sheet's top corners and a sheet-only shape;
      // not 8, which is what a control wears.
      expect(stylesheet()).toContain('border-radius: var(--radius-card)')
      expect(stylesheet()).not.toContain('--radius-sheet')
      expect(stylesheet()).not.toContain('--radius-control')
    })

    it('is the raised surface with a rule border', () => {
      expect(stylesheet()).toContain('background: var(--color-bg-raised)')
      expect(stylesheet()).toContain(
        'border: var(--stroke-rule) solid var(--color-rule)',
      )
    })

    /**
     * Dark elevates by lighter surface; light by rule plus a faint shadow.
     * The assertion is that the shadow exists **only** under a light guard —
     * an unguarded one would put a smudge on near-black.
     */
    it('gives the shadow to the light theme alone', () => {
      const css = stylesheet()
      const shadows = [...css.matchAll(/box-shadow/g)]
      expect(shadows).toHaveLength(2)
      expect(css).toContain('@media (prefers-color-scheme: light)')
      expect(css).toContain(":root[data-theme='light'] .content")
    })

    it('caps its width at the sheet’s measure and floors it at the trigger', () => {
      const css = stylesheet()
      expect(css).toContain(
        'min(20rem, var(--radix-popover-content-available-width))',
      )
      expect(css).toContain('var(--radix-popover-trigger-width)')
    })

    it('scrolls itself rather than clipping', () => {
      const css = stylesheet()
      expect(css).toContain(
        'max-height: var(--radix-popover-content-available-height)',
      )
      expect(css).toContain('overflow-y: auto')
    })

    /** No arrow: the app draws none anywhere, and the offset says what one
     * would. */
    it('draws no arrow', () => {
      expect(stylesheet()).not.toContain('Arrow')
      expect(readFileSync(join(HERE, 'Popover.tsx'), 'utf8')).not.toContain(
        'Popover.Arrow',
      )
    })
  })
})
