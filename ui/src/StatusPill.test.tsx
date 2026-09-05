import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { StatusPill } from './StatusPill'

/**
 * `frontend-design.md` §5's `StatusPill`, built at the point it had two
 * callers: F4's in-row pill, which **states** a status and cycles on tap, and
 * the Piece status sheet's `SET EVERYONE` chips, which **write** one. They
 * share a grammar — pill radius, chip stroke, mono caps, glyph then word, a
 * 44 floor reached by paint rather than by a clamp — and differ in exactly
 * two ways, which is what the two props are for.
 */

function css(): string {
  return readFileSync(
    join(dirname(expect.getState().testPath ?? ''), 'StatusPill.module.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')
}

function ruleBody(selector: string): string | undefined {
  const escaped = selector.replace(/[.[\]:='+>~() -]/g, '\\$&')
  return new RegExp(`(?:^|[\\s{}])${escaped}\\s*\\{([^}]*)\\}`).exec(css())?.[1]
}

describe('StatusPill', () => {
  it('reads glyph then word, as one accessible name', () => {
    render(<StatusPill glyph="◐" label="STAGED" onClick={vi.fn()} />)

    expect(screen.getByRole('button', { name: '◐ STAGED' })).toBeInTheDocument()
  })

  it('calls back on a tap', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<StatusPill glyph="○" label="NOT PACKED" onClick={onClick} />)

    await user.click(screen.getByRole('button'))

    expect(onClick).toHaveBeenCalledOnce()
  })

  /**
   * The tone names the **paint**, and the caller owns which status it means
   * (`patterns.md` §5.3) — `PersonCircle`'s rule, and the reason the packing
   * vocabulary stays in `app/`. It rides a `data-tone` attribute so the
   * stylesheet holds one rule per tone and no component decides a colour
   * (`patterns.md` §6.7).
   */
  it('carries its tone as an attribute, never a colour of its own', () => {
    render(
      <StatusPill glyph="●" label="PACKED" tone="packed" onClick={vi.fn()} />,
    )

    expect(screen.getByRole('button')).toHaveAttribute('data-tone', 'packed')
  })

  it('defaults to the plain tone, which is what a control that writes wears', () => {
    render(<StatusPill glyph="○" label="NOT PACKED" onClick={vi.fn()} />)

    expect(screen.getByRole('button')).toHaveAttribute('data-tone', 'plain')
  })

  /**
   * **44 by paint, not by clamp.** The pill is drawn at its own floor, so
   * ruling O's `::after` never applies to it — and must not, since the
   * in-row size sits beside a row body whose own hit area it would overlap.
   */
  it('paints its own 44 floor and grows no extension', () => {
    expect(ruleBody('.pill')).toMatch(/min-height:\s*max\(2\.75rem,\s*44px\)/)
    expect(ruleBody('.pill::after')).toBeUndefined()
  })

  /**
   * The two callers' one layout difference: the in-row pill keeps its
   * intrinsic width at the row's edge, and the sheet's three chips share
   * their row equally.
   */
  it('holds its width in a row and shares it as an action', () => {
    expect(ruleBody('.pill')).toMatch(/flex:\s*none/)
    expect(ruleBody(".pill[data-size='action']")).toMatch(/flex:\s*1/)
  })

  it('tints only on a tone that asks for one', () => {
    expect(ruleBody(".pill[data-tone='staged']")).toMatch(
      /--color-status-staged/,
    )
    expect(ruleBody(".pill[data-tone='packed']")).toMatch(
      /--color-status-packed/,
    )
  })

  it('draws a focus ring', () => {
    expect(ruleBody('.pill:focus-visible')).toMatch(
      /box-shadow:\s*var\(--focus-ring\)/,
    )
  })
})
