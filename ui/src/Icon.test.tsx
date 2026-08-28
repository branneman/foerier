import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IconDepot, IconFind, IconTrips } from './Icon'

/**
 * The rail's icons sit beside a link that already carries the destination's
 * name, so announcing themselves would say it twice. Decorative by default,
 * nameable only where one stands alone.
 */
describe('the navigation icons', () => {
  it('are decorative unless given a title', () => {
    const { rerender } = render(<IconDepot />)
    expect(screen.getByTestId('icon-depot')).toHaveAttribute(
      'role',
      'presentation',
    )

    rerender(<IconDepot title="Depot" />)
    expect(screen.getByTestId('icon-depot')).toHaveAttribute('role', 'img')
  })

  it('take their colour from the row they sit in', () => {
    render(
      <>
        <IconDepot />
        <IconTrips />
        <IconFind />
      </>,
    )
    // `currentColor` throughout is what lets the active row set one colour
    // and have the icon follow, rather than every icon carrying two variants.
    for (const id of ['icon-depot', 'icon-trips', 'icon-find']) {
      expect(screen.getByTestId(id).innerHTML).toContain('currentColor')
      expect(screen.getByTestId(id).innerHTML).not.toMatch(/#[0-9A-Fa-f]{6}/)
    }
  })
})
