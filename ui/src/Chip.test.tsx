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
