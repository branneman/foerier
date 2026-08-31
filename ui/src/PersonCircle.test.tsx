import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PersonCircle } from './PersonCircle'

/**
 * The primitive that replaces five hand-rolled `.circle` rules
 * (`TripCard`, `Trip`, `GearListBuilder`, `ParticipantPicker`, `People`).
 * `tone` is a border, not a meaning — each caller's own test still covers
 * what that border says on that screen.
 */
describe('PersonCircle', () => {
  it('draws the label it is given', () => {
    render(<PersonCircle label="M" size={22} />)
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('draws an empty circle for a Person with no folded name', () => {
    const { container } = render(<PersonCircle size={22} />)
    expect(container.firstChild).toHaveTextContent('')
  })

  it('renders an overflow slot from a +N label', () => {
    render(<PersonCircle label="+3" size={22} tone="control" />)
    expect(screen.getByText('+3')).toBeInTheDocument()
  })
})
