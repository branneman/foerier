import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from './ErrorBoundary'

/**
 * React writes every caught error to the console itself, and a boundary that
 * works is therefore a noisy test. Silencing it here is not hiding a failure:
 * the assertions below read the fallback's own DOM, and the boundary's own
 * console line is asserted where it matters.
 */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function Boom({ throws }: { throws: boolean }): React.ReactNode {
  if (throws) throw new Error('bring_count was null')
  return <p>The gear list.</p>
}

/** A child whose crash can be repaired from outside the boundary. */
function Harness({ initiallyBroken = true }: { initiallyBroken?: boolean }) {
  const [broken, setBroken] = useState(initiallyBroken)
  return (
    <>
      <button type="button" onClick={() => setBroken(false)}>
        Repair
      </button>
      <ErrorBoundary buildSha="7c39f2a" label="the gear list">
        <Boom throws={broken} />
      </ErrorBoundary>
    </>
  )
}

describe('ErrorBoundary', () => {
  it('renders its children while nothing throws', () => {
    render(
      <ErrorBoundary buildSha="7c39f2a">
        <Boom throws={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('The gear list.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('draws the fallback in place of a crashed child', () => {
    render(
      <ErrorBoundary buildSha="7c39f2a">
        <Boom throws={true} />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(
      screen.getByText('This part could not be drawn.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('The gear list.')).not.toBeInTheDocument()
  })

  it('keeps the report collapsed, and holds the message, both stacks and the build', () => {
    render(
      <ErrorBoundary buildSha="7c39f2a">
        <Boom throws={true} />
      </ErrorBoundary>,
    )

    const details = screen.getByTestId('error-report')
    expect(details).not.toHaveAttribute('open')

    const report = screen.getByTestId('error-report-text').textContent ?? ''
    expect(report).toContain('bring_count was null')
    // The JS stack, minified in production and mapped back later.
    expect(report).toContain('Boom')
    // React's own component stack, which is the half that names the screen.
    expect(report).toContain('COMPONENT STACK')
    expect(report).toContain('BUILD 7c39f2a')
  })

  it('reports a thrown non-Error rather than dropping it', () => {
    function Throw(): React.ReactNode {
      throw 'the outbox is gone'
    }

    render(
      <ErrorBoundary buildSha="7c39f2a">
        <Throw />
      </ErrorBoundary>,
    )

    expect(screen.getByTestId('error-report-text').textContent).toContain(
      'the outbox is gone',
    )
  })

  it('logs the same report once, under the label it was given', () => {
    render(
      <ErrorBoundary buildSha="7c39f2a" label="the gear list">
        <Boom throws={true} />
      </ErrorBoundary>,
    )

    expect(console.error).toHaveBeenCalledWith(
      'crash: the gear list could not be drawn',
      expect.stringContaining('bring_count was null'),
    )
  })

  it('retries in place, and draws the child again once it is repaired', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Repair' }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('The gear list.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('returns to the fallback when the retry finds the same crash', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    // Honest rather than magic: a deterministic crash crashes again, and the
    // fallback is what the reader is left with.
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('copies the report a phone cannot otherwise hand over', async () => {
    // `setup()` installs a clipboard stub of its own, so the spy goes in
    // after it or user-event's copy is the one that gets called.
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    })

    render(
      <ErrorBoundary buildSha="7c39f2a">
        <Boom throws={true} />
      </ErrorBoundary>,
    )
    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('bring_count was null'),
    )
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('withholds the copy control where there is no clipboard to write to', () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })

    render(
      <ErrorBoundary buildSha="7c39f2a">
        <Boom throws={true} />
      </ErrorBoundary>,
    )

    // An insecure context — a dev server reached over a LAN address — has
    // none, and a dead control is worse than a missing one.
    expect(
      screen.queryByRole('button', { name: 'Copy' }),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('error-report-text')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

/**
 * **The scope decides the noun, the vessel and the control** (§5n K1/K1b).
 * One sentence is true of a screen and a panel because the fallback sits
 * inside the box that failed and the placement states the scope; at page
 * scope it is false, there being no whole with other parts standing.
 */
describe('the page scope', () => {
  function Boom(): React.ReactNode {
    throw new Error('the session store is gone')
  }

  it('names the app, and offers the only move left', () => {
    render(
      <ErrorBoundary buildSha="7c39f2a" variant="page">
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('foerier could not be drawn.')).toBeInTheDocument()
    // The body drops its first clause: there is no `Try again` to name.
    expect(
      screen.getByText('The ledger is saved on this device. Reload the app.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('keeps the other two scopes on the sentence that is true of both', () => {
    render(
      <ErrorBoundary buildSha="7c39f2a">
        <Boom />
      </ErrorBoundary>,
    )

    expect(
      screen.getByText('This part could not be drawn.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
  })

  it('reloads rather than re-rendering the children that just threw', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...globalThis.location, reload })
    const user = userEvent.setup()

    render(
      <ErrorBoundary buildSha="7c39f2a" variant="page">
        <Boom />
      </ErrorBoundary>,
    )
    await user.click(screen.getByRole('button', { name: 'Reload' }))

    // Retrying at this scope re-renders the same children, which is the move
    // least likely to work — so the control does what its word says.
    expect(reload).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
