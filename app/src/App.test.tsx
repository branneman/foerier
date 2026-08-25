import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { App } from './App'
import { createAuthApi } from './auth/api'
import { inMemoryPendingStore } from './auth/pendingFirstPerson'
import { inMemorySessionStore, type Session } from './auth/sessionStore'

const A_SESSION: Session = {
  token: 'foe_test',
  loginId: '0f0000a1-0000-4000-8000-0000000000a1',
  personId: '0f0000a2-0000-4000-8000-0000000000a2',
  householdId: '0f0000a3-0000-4000-8000-0000000000a3',
  deviceId: '0f0000a4-0000-4000-8000-0000000000a4',
}

/** A fetch that fails loudly, so an unexpected network call is a test failure. */
const noNetwork: typeof fetch = () => {
  throw new Error('the shell must not call the network')
}

function renderAt(path: string, session: Session | null = A_SESSION) {
  const { hook } = memoryLocation({ path })
  return render(
    <Router hook={hook}>
      <App
        api={createAuthApi(noNetwork)}
        sessionStore={inMemorySessionStore(session)}
        pendingStore={inMemoryPendingStore()}
      />
    </Router>,
  )
}

describe('the app shell', () => {
  it('offers exactly the three destinations', async () => {
    // Three, not four: Account is reached from the avatar rather than the tab
    // bar, so adding it here would be a design regression rather than a
    // feature (docs/design/README.md §11).
    renderAt('/')

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    const links = within(nav).getAllByRole('link')

    expect(links.map((l) => l.textContent)).toEqual(['Depot', 'Trips', 'Find'])
  })

  it('marks the current destination', async () => {
    renderAt('/trips')

    expect(await screen.findByRole('link', { name: 'Trips' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Depot' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('states an empty depot as a fact rather than a placeholder', async () => {
    renderAt('/')

    expect(
      await screen.findByRole('heading', { name: 'Depot' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument()
  })

  it('renders an unknown route without crashing the shell', async () => {
    renderAt('/nope')

    expect(
      await screen.findByRole('heading', { name: 'Not found.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  })

  it('never reaches the network just to render', async () => {
    // Reads are pure and in-memory; nothing async sits in a render path
    // (architecture-design.md §3). `noNetwork` throws if that is violated.
    renderAt('/')

    expect(await screen.findByRole('heading', { name: 'Depot' })).toBeVisible()
  })
})

describe('when signed out', () => {
  it('shows nothing of the household', async () => {
    // Story 26: "Nothing about my Household is readable on a signed-out
    // Device."
    renderAt('/', null)

    expect(
      await screen.findByRole('button', { name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Depot' })).toBeNull()
  })

  it('sends a signed-in device away from the sign-in screen', async () => {
    renderAt('/signin')

    expect(
      await screen.findByRole('navigation', { name: 'Sections' }),
    ).toBeVisible()
  })
})
