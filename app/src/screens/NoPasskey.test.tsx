import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { NoPasskey } from './NoPasskey'

/**
 * Boards §10. The anatomy *is* the argument: a Device on this path is a
 * first-class Device, and the screen says so by looking identical to the one
 * that made a passkey. Any amber, any ▲, any "however" is the bug.
 */
describe('Continue without a passkey', () => {
  it('names the person on the primary, as the boards draw it', () => {
    render(<NoPasskey personName="Els" onContinue={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: 'Continue as Els' }),
    ).toBeInTheDocument()
  })

  it('falls back to an unnamed primary when no Person is known yet', () => {
    render(<NoPasskey personName={null} onContinue={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })

  it('states the fact without claiming the device cannot', () => {
    render(<NoPasskey personName="Els" onContinue={vi.fn()} />)
    // The S3.5 departure: "This device cannot make one" is sometimes false.
    expect(screen.getByText(/No passkey is made here\./)).toBeInTheDocument()
    expect(
      screen.getByText(/You stay signed in until you sign out\./),
    ).toBeInTheDocument()
  })

  it('carries no warning affordance of any kind', () => {
    const { container } = render(
      <NoPasskey personName="Els" onContinue={vi.fn()} />,
    )
    expect(container.textContent).not.toContain('▲')
    expect(container.textContent).not.toMatch(/however|instead|unfortunately/i)
  })

  it('continues exactly once, even on a double tap', async () => {
    const onContinue = vi.fn().mockResolvedValue(undefined)
    render(<NoPasskey personName="Els" onContinue={onContinue} />)

    const button = screen.getByRole('button', { name: 'Continue as Els' })
    await userEvent.click(button)
    await userEvent.click(button)

    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
