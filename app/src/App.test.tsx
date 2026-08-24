import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { App } from './App'

function renderAt(path: string) {
  const { hook } = memoryLocation({ path })
  return render(
    <Router hook={hook}>
      <App />
    </Router>,
  )
}

describe('the app shell', () => {
  it('offers exactly the three destinations', () => {
    // Three, not four: Account is reached from the avatar rather than the tab
    // bar, so adding it here would be a design regression rather than a
    // feature (docs/design/README.md §11).
    renderAt('/')

    const nav = screen.getByRole('navigation', { name: 'Sections' })
    const links = within(nav).getAllByRole('link')

    expect(links.map((l) => l.textContent)).toEqual(['Depot', 'Trips', 'Find'])
  })

  it('marks the current destination', () => {
    renderAt('/trips')

    expect(screen.getByRole('link', { name: 'Trips' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Depot' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('states an empty depot as a fact rather than a placeholder', () => {
    renderAt('/')

    expect(screen.getByRole('heading', { name: 'Depot' })).toBeInTheDocument()
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument()
  })

  it('renders an unknown route without crashing the shell', () => {
    renderAt('/nope')

    expect(
      screen.getByRole('heading', { name: 'Not found.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  })
})
