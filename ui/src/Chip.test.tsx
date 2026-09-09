import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Chip } from './Chip'

/**
 * The chip settled at **36px** in Components §04 — "the 32/36/40 drift across
 * boards is settled here" — for the slice bar, and at **32px** in Components
 * §06 for gear detail's tag chips. One component, two sizes.
 */

describe('Chip', () => {
  it('draws its label', () => {
    render(<Chip label="TAG: #WINTER" />)
    expect(screen.getByText('TAG: #WINTER')).toBeInTheDocument()
  })

  it('is a button when it does something, and plain text when it does not', () => {
    const { rerender } = render(<Chip label="#winter" />)
    expect(screen.queryByRole('button')).toBeNull()

    rerender(<Chip label="#winter" onClick={() => {}} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('offers a remove control only when a remover is given', () => {
    const onRemove = vi.fn()
    const { rerender } = render(<Chip label="TAG: #WINTER" />)
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()

    rerender(<Chip label="TAG: #WINTER" onRemove={onRemove} />)
    expect(
      screen.getByRole('button', { name: 'Remove TAG: #WINTER' }),
    ).toBeInTheDocument()
  })

  it('removes without also firing the chip itself', async () => {
    const onClick = vi.fn()
    const onRemove = vi.fn()
    render(<Chip label="TAG: #WINTER" onClick={onClick} onRemove={onRemove} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove TAG: #WINTER' }),
    )

    expect(onRemove).toHaveBeenCalledOnce()
    // The ✕ sits inside the chip; a bubbling click would re-open the picker
    // the removal was meant to close out of.
    expect(onClick).not.toHaveBeenCalled()
  })

  it('marks a selected chip as pressed, so the state is not colour alone', () => {
    render(<Chip label="TAG: #WINTER" selected onClick={() => {}} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('leaves aria-pressed off a chip that is not a toggle', () => {
    render(<Chip label="+ TAG" ghost onClick={() => {}} />)
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed')
  })
})

/**
 * **Ruling O's two sizes, pinned** — the same technique
 * `app/src/screens/drawnSizes.test.ts` uses and for the same reason:
 * `ui/vitest.config.ts` sets no `css` option, so CSS modules are not
 * processed, `toHaveStyle` passes unconditionally and jsdom computes no
 * layout. Reading the stylesheet text is what sees a regression here.
 *
 * What it guards is that the two drawn paints stay drawn — a later author
 * reaching for the retired global floor would repaint a 32px tag chip at
 * 48 — and that each still carries the extension that makes the small paint
 * reachable, at the inset its own arithmetic needs.
 */
function chipCss(): string {
  const here = dirname(expect.getState().testPath ?? '')
  return readFileSync(join(here, 'Chip.module.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
}

function ruleBody(css: string, selector: string): string | undefined {
  const escaped = selector.replace(/[.[\]:]/g, '\\$&')
  return new RegExp(`(?:^|[\\s{}])${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
}

const FLOOR = /min-height:\s*max\(3rem,\s*48px\)/

describe("the chip's drawn sizes and hit areas", () => {
  it('keeps both boards’ paints, neither floored', () => {
    const css = chipCss()

    expect(ruleBody(css, '.filter')).toMatch(/min-height:\s*2\.25rem/)
    expect(ruleBody(css, '.filter')).not.toMatch(FLOOR)
    expect(ruleBody(css, '.tag')).toMatch(/min-height:\s*2rem/)
    expect(ruleBody(css, '.tag')).not.toMatch(FLOOR)
  })

  it('reaches 44 from both paints, vertically only', () => {
    const css = chipCss()

    expect(ruleBody(css, 'button.chip')).toMatch(/position:\s*relative/)
    // 36 + 4 + 4 = 44.
    expect(ruleBody(css, 'button.chip::after')).toMatch(/inset:\s*-0\.25rem 0/)
    // 32 + 6 + 6 = 44 — the size-specific override, and the reason a caller
    // that wraps tag chips owes a 12px `row-gap`.
    expect(ruleBody(css, 'button.chip.tag::after')).toMatch(
      /inset:\s*-0\.375rem 0/,
    )
  })

  it('withholds the extension from a chip a remove has already stretched', () => {
    // `.group` is `align-items: stretch` and `.remove` states its own 48, so
    // a grouped chip is already a floor-height target; an extension there
    // would only reach into the rows above and below for nothing.
    expect(ruleBody(chipCss(), '.group > button.chip::after')).toMatch(
      /content:\s*none/,
    )
    expect(ruleBody(chipCss(), '.remove')).toMatch(FLOOR)
  })
})
