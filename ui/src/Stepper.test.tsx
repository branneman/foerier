import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Stepper } from './Stepper'

/**
 * One control, two sizes (`docs/specs/2026-08-29-the-gear-list.md` §4.8):
 * h48 default (Add gear's Owned-count) and h32 dense (the gear list's
 * in-row Bring-count). `value` is the one source of truth — every assertion
 * here drives `Stepper` purely through `value`/`onChange`.
 */

function css(): string {
  return readFileSync(
    join(dirname(expect.getState().testPath ?? ''), 'Stepper.module.css'),
    'utf8',
  )
}

describe('Stepper', () => {
  it('renders the value between a decrement and an increment', () => {
    const { container } = render(
      <Stepper value={3} onChange={() => {}} label="Owned count" />,
    )

    const well = screen.getByRole('spinbutton', { name: 'Owned count' })
    expect(well).toHaveValue(3)

    // Order, not just presence: the well sits between the two buttons.
    const controls = Array.from(
      container.querySelectorAll('button, input'),
    ).map((element) => element.getAttribute('aria-label'))
    expect(controls).toEqual([
      'Decrease Owned count',
      'Owned count',
      'Increase Owned count',
    ])
  })

  it('calls onChange with value + 1 on increment', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper value={3} onChange={onChange} label="Owned count" />)

    await user.click(
      screen.getByRole('button', { name: 'Increase Owned count' }),
    )

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('calls onChange with value - 1 on decrement', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper value={3} onChange={onChange} label="Owned count" />)

    await user.click(
      screen.getByRole('button', { name: 'Decrease Owned count' }),
    )

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('does not go below min, and min defaults to 0', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper value={1} onChange={onChange} label="Bring count" />)

    // No `min` prop given at all — decrementing from 1 should land on the
    // default floor, 0, and go no lower.
    await user.click(
      screen.getByRole('button', { name: 'Decrease Bring count' }),
    )
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('clamps a typed value below a non-zero min to that min', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Stepper value={5} min={2} onChange={onChange} label="Owned count" />,
    )

    // The well clamps too, not just the button: typing a value under the
    // floor commits the floor rather than the literal digits typed.
    const well = screen.getByRole('spinbutton', { name: 'Owned count' })
    await user.clear(well)
    await user.type(well, '1')

    expect(onChange).not.toHaveBeenCalledWith(1)
    expect(onChange).toHaveBeenLastCalledWith(2)
  })

  it('disables decrement at min', () => {
    render(
      <Stepper value={0} min={0} onChange={() => {}} label="Bring count" />,
    )

    expect(
      screen.getByRole('button', { name: 'Decrease Bring count' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Increase Bring count' }),
    ).toBeEnabled()
  })

  it('re-enables decrement once above a non-zero min', () => {
    const { rerender } = render(
      <Stepper value={2} min={2} onChange={() => {}} label="Owned count" />,
    )
    expect(
      screen.getByRole('button', { name: 'Decrease Owned count' }),
    ).toBeDisabled()

    rerender(
      <Stepper value={3} min={2} onChange={() => {}} label="Owned count" />,
    )
    expect(
      screen.getByRole('button', { name: 'Decrease Owned count' }),
    ).toBeEnabled()
  })

  it('labels both controls for assistive technology using the label prop', () => {
    render(<Stepper value={1} onChange={() => {}} label="Bring count" />)

    expect(
      screen.getByRole('button', { name: 'Decrease Bring count' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Increase Bring count' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('spinbutton', { name: 'Bring count' }),
    ).toBeInTheDocument()
  })

  it('renders the dense size with a hit area of at least 44px', () => {
    const { container } = render(
      <Stepper
        value={1}
        onChange={() => {}}
        size="dense"
        label="Bring count"
      />,
    )

    // jsdom computes no layout, so the shape is what gets pinned: the dense
    // class is on the root, and the stylesheet pads the button's hit area to
    // 44px (32px painted + 2 * 6px) without resizing the paint — the same
    // `::after` technique `Trip.module.css`'s `.addParticipant` uses for its
    // 22px circle.
    expect(container.firstElementChild?.className).toMatch(/dense/)

    const text = css()
    expect(text).toMatch(/\.dense \.button\s*\{[^}]*width:\s*2rem/)
    expect(text).toMatch(/\.dense \.button\s*\{[^}]*height:\s*2rem/)
    expect(text).toMatch(/\.dense \.button::after\s*\{[^}]*inset:\s*-0\.375rem/)
    // -0.375rem (6px) on every side of a 32px (2rem) box is 44px — the
    // ≥44px floor this dense variant is allowed as its one exception.
  })

  it('is driven by value alone — a caller that ignores onChange never moves', async () => {
    // `Stepper` reflects `value` on every render; a caller that does not
    // update it (e.g. a Kind that no longer counts) leaves the well right
    // where the caller left it, not where the last tap requested.
    function Frozen() {
      const [count] = useState(5)
      return <Stepper value={count} onChange={() => {}} label="Owned count" />
    }
    const user = userEvent.setup()
    render(<Frozen />)

    await user.click(
      screen.getByRole('button', { name: 'Increase Owned count' }),
    )

    expect(screen.getByRole('spinbutton', { name: 'Owned count' })).toHaveValue(
      5,
    )
  })
})
