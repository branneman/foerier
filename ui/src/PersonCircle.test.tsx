import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PersonCircle } from './PersonCircle'
import styles from './PersonCircle.module.css'

/**
 * The primitive that replaces six hand-rolled `.circle` rules (`TripCard`,
 * `Trip`, `GearListBuilder`, `NewTrip`, `ParticipantPicker`, `People`).
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

  // Spec §5.3's obligation, unmet until now: the CSS keys the border off
  // `data-tone` (`PersonCircle.module.css`'s own comment), so a caller's
  // `tone` prop reaching the DOM at all is the fact every caller test above
  // it in the file tree assumes rather than proves.
  it('renders the tone as data-tone, defaulting to control', () => {
    render(<PersonCircle label="M" size={22} />)
    expect(screen.getByTestId('person-circle')).toHaveAttribute(
      'data-tone',
      'control',
    )
  })

  it('renders an explicit tone as data-tone', () => {
    render(<PersonCircle label="E" size={22} tone="dashed" />)
    expect(screen.getByTestId('person-circle')).toHaveAttribute(
      'data-tone',
      'dashed',
    )
  })

  // S9b's own: a Piece two Trips both claim (Find's `PersonPieceRow`,
  // `GearDetail`'s `PIECES` chip).
  it('renders the attention tone as data-tone', () => {
    render(<PersonCircle label="M" size={22} tone="attention" />)
    expect(screen.getByTestId('person-circle')).toHaveAttribute(
      'data-tone',
      'attention',
    )
  })

  /**
   * **The sixth size, and the one that is not a roster circle.** Account's
   * `you` block draws the signed-in Person at 40 — the only place in the app
   * where the circle is the subject of its own band rather than a marker in
   * somebody else's row. It folds in here rather than staying hand-rolled
   * for the reason the other five did: a circle is sized by the density of
   * the band it sits in, and that is a fact this file should hold all of.
   */
  it.each([22, 24, 28, 30, 34, 40] as const)(
    'draws the %s size from its own class',
    (size) => {
      render(<PersonCircle label="M" size={size} />)
      expect(screen.getByTestId('person-circle')).toHaveClass(
        styles[`size${size}`] ?? '',
      )
    },
  )

  // S9's two, added for the Piece status sheet's packing fills.
  it.each(['filled', 'half'] as const)(
    'renders the %s tone as data-tone',
    (tone) => {
      render(<PersonCircle label="M" size={30} tone={tone} />)
      expect(screen.getByTestId('person-circle')).toHaveAttribute(
        'data-tone',
        tone,
      )
    },
  )

  // The five diameters of §5d K's band scale, each its own class: 22 chrome,
  // 24 dense display rows, 28 group headers, 30 roster rows, 34 working rows.
  // A table rather than one case, because the union and the stylesheet are two
  // files and a size added to one and not the other renders an unclassed
  // circle that still passes every other assertion here.
  it.each([22, 24, 28, 30, 34] as const)(
    'draws size %i as its own class',
    (size) => {
      render(<PersonCircle label="M" size={size} />)
      expect(screen.getByTestId('person-circle')).toHaveClass(
        styles[`size${size}`]!,
      )
    },
  )
})
