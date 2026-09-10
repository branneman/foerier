import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
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
  /**
   * **This is a popover anchor, so it has to be measurable** (§5n K17).
   *
   * `ui/Popover` positions against an element inside its own Radix root, and
   * Radix measures it through a ref. React 19 hands `ref` to a function
   * component as an ordinary prop, but it only reaches the DOM if the
   * component passes it on — and a component that drops it fails **silently**:
   * Floating UI never runs, no position variable is set, and the popover
   * paints off-screen with no error anywhere. `Chip` shipped that way until a
   * browser was pointed at it; these two are its siblings.
   */
  it('forwards its ref to a real element', () => {
    const ref = createRef<HTMLElement>()
    render(
      <StatusPill
        glyph="○"
        label="NOT PACKED"
        onClick={() => undefined}
        ref={ref}
      />,
    )

    expect(ref.current).toBeInstanceOf(HTMLElement)
  })
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

  /**
   * S10's third and fourth callers of this grammar: F5's outcome pill
   * reuses `StatusPill` rather than growing a second control, so `▲ LOST`
   * gets the system's one attention tint and a fourth pill gets a dashed,
   * unfilled border — no tone this file had before either shape. Named
   * `dashed`, not for what a caller means by it: `PersonCircle` already
   * owns this word for the identical border.
   */
  it('tints the attention tone with the system’s one attention colour', () => {
    render(
      <StatusPill glyph="▲" label="LOST" tone="attention" onClick={vi.fn()} />,
    )

    expect(screen.getByRole('button')).toHaveAttribute('data-tone', 'attention')
    expect(ruleBody(".pill[data-tone='attention']")).toMatch(
      /--color-status-attention/,
    )
  })

  it('dashes the dashed tone rather than filling it', () => {
    render(
      <StatusPill glyph="" label="CONSUMED" tone="dashed" onClick={vi.fn()} />,
    )

    expect(screen.getByRole('button')).toHaveAttribute('data-tone', 'dashed')
    expect(ruleBody(".pill[data-tone='dashed']")).toMatch(
      /border-style:\s*dashed/,
    )
    expect(ruleBody(".pill[data-tone='dashed']")).not.toMatch(/background:/)
  })

  it('draws a focus ring', () => {
    expect(ruleBody('.pill:focus-visible')).toMatch(
      /box-shadow:\s*var\(--focus-ring\)/,
    )
  })
})
