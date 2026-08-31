import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PersonCluster } from './PersonCluster'

const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => ({ key: l, label: l }))

/**
 * Ruling E (`docs/design/README.md` §5d E): four painted slots, then
 * `+N`; dashed (excluded) entries sort to the front so truncation never
 * hides the exception.
 */
describe('PersonCluster', () => {
  it('draws four or fewer whole', () => {
    render(
      <PersonCluster people={six.slice(0, 4)} size={22} label="Participants" />,
    )
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  it('draws three circles and a +N from five', () => {
    render(<PersonCluster people={six} size={22} label="Participants" />)
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.queryByText('D')).not.toBeInTheDocument()
  })

  it('sorts excluded circles to the front so the exception is never hidden', () => {
    const people = [
      ...six.slice(0, 5).map((p) => ({ ...p })),
      { key: 'Z', label: 'Z', tone: 'dashed' as const },
    ]
    render(<PersonCluster people={people} size={24} label="Who brings one" />)
    // Z is last in input order but excluded, so it survives truncation.
    expect(screen.getByText('Z')).toBeInTheDocument()
  })

  it('partitions stably: dashed first in arrival order, then the rest, before the cut', () => {
    const people = [
      { key: 'A', label: 'A' },
      { key: 'B', label: 'B' },
      { key: 'C', label: 'C' },
      { key: 'D', label: 'D' },
      { key: 'E', label: 'E' },
      { key: 'Z', label: 'Z', tone: 'dashed' as const },
    ]
    render(<PersonCluster people={people} size={22} label="Participants" />)

    // Z sorts to the front, A and B keep their own relative order behind it —
    // this is not merely "Z survives" (the prior test), it is the drawn
    // order: Z, A, B, +3, with C/D/E the three the +N slot stands for.
    const drawn = screen
      .getAllByTestId('person-circle')
      .map((el) => el.textContent)
    expect(drawn).toEqual(['Z', 'A', 'B', '+3'])
  })

  it('renders one role="img" with the given accessible name', () => {
    render(
      <PersonCluster
        people={six.slice(0, 2)}
        size={22}
        label="Participants: A, B"
      />,
    )
    expect(
      screen.getByRole('img', { name: 'Participants: A, B' }),
    ).toBeInTheDocument()
  })
})
