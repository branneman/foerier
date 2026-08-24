import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Logo, Mark } from './Logo'

describe('Mark', () => {
  it('drops the seams at small sizes', () => {
    // The design boards make this a rule rather than a preference: below ~20px
    // the two seam strokes stop reading as detail and start reading as noise.
    render(<Mark size={16} />)

    expect(screen.queryByTestId('mark-seams')).toBeNull()
  })

  it('keeps the seams at full size', () => {
    render(<Mark size={28} />)

    expect(screen.getByTestId('mark-seams')).toBeTruthy()
  })

  it('is decorative unless given a title', () => {
    // The mark sits beside the wordmark almost everywhere, so announcing it
    // would make a screen reader say "foerier" twice.
    const { rerender } = render(<Mark />)
    expect(screen.getByTestId('foerier-mark').getAttribute('role')).toBe(
      'presentation',
    )

    rerender(<Mark title="foerier" />)
    expect(screen.getByTestId('foerier-mark').getAttribute('role')).toBe('img')
  })
})

describe('Logo', () => {
  it('renders the wordmark in lowercase, as drawn', () => {
    render(<Logo />)

    expect(screen.getByText('foerier')).toBeTruthy()
  })

  it('can render the mark alone', () => {
    render(<Logo markOnly />)

    expect(screen.queryByText('foerier')).toBeNull()
    expect(screen.getByTestId('foerier-mark')).toBeTruthy()
  })
})
