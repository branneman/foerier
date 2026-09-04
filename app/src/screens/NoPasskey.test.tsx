import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

  it('lets a failed claim be retried, rather than wedging the button', async () => {
    // The exact wedge the `busy`-state guard was replaced to avoid, arriving
    // from the other direction: a permanent guard that never resets on
    // failure leaves the button looking enabled but permanently inert.
    const onContinue = vi.fn().mockRejectedValueOnce(new Error('claim failed'))
    render(<NoPasskey personName="Els" onContinue={onContinue} />)

    const button = screen.getByRole('button', { name: 'Continue as Els' })
    await userEvent.click(button)
    expect(onContinue).toHaveBeenCalledTimes(1)

    await userEvent.click(button)
    expect(onContinue).toHaveBeenCalledTimes(2)
  })

  // `final-review.md` finding 1: a bare catch used to leave a failed claim
  // showing nothing at all — the person's only feedback on the device-link
  // path, where this screen is the only one they ever see.
  it('says a failed claim failed, in the same plain-fact register as the rest of the screen', async () => {
    const onContinue = vi.fn().mockRejectedValue(new Error('device/claim: 401'))
    render(<NoPasskey personName="Els" onContinue={onContinue} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Continue as Els' }),
    )

    expect(
      await screen.findByText('Something went wrong. Ask for a new link.'),
    ).toBeInTheDocument()
  })

  it('carries no warning affordance on a failed claim either — same discipline as the happy path', async () => {
    const onContinue = vi.fn().mockRejectedValue(new Error('offline'))
    const { container } = render(
      <NoPasskey personName="Els" onContinue={onContinue} />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Continue as Els' }),
    )
    await screen.findByText('Something went wrong. Ask for a new link.')

    expect(container.textContent).not.toContain('▲')
    expect(container.textContent).not.toMatch(/however|instead|unfortunately/i)
  })

  it('clears a stale error once a retry is under way', async () => {
    const onContinue = vi
      .fn()
      .mockRejectedValueOnce(new Error('device/claim: 401'))
      .mockResolvedValueOnce(undefined)
    render(<NoPasskey personName="Els" onContinue={onContinue} />)

    const button = screen.getByRole('button', { name: 'Continue as Els' })
    await userEvent.click(button)
    await screen.findByText('Something went wrong. Ask for a new link.')

    await userEvent.click(button)

    expect(
      screen.queryByText('Something went wrong. Ask for a new link.'),
    ).toBeNull()
  })

  it('arrives already saying so when the caller already knows the attempt failed', async () => {
    render(
      <NoPasskey
        personName="Els"
        onContinue={vi.fn()}
        initialError="Something went wrong. Ask for a new link."
      />,
    )

    expect(
      screen.getByText('Something went wrong. Ask for a new link.'),
    ).toBeInTheDocument()
  })

  it('stays silent when the caller reached here without any error to report', () => {
    const { container } = render(
      <NoPasskey personName="Els" onContinue={vi.fn()} initialError={null} />,
    )

    expect(container.textContent).not.toContain('Something went wrong')
  })
})

/**
 * Type is stated in the token pairs and never in px (frontend-design §2.1):
 * a px size does not scale with the reader's font-size, and `.body` here was
 * the one place in the codebase that had drifted to `15px/22px`. jsdom
 * computes no styles under `css: false`, so the net reads the stylesheet text.
 */
describe('its stylesheet', () => {
  it('sets no type in px', () => {
    const css = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'NoPasskey.module.css'),
      'utf8',
    )
    expect(css).not.toMatch(/(?:font-size|line-height|margin-top):\s*\d+px/)
    expect(css).toMatch(
      /\.body\s*\{[^}]*font:\s*var\(--text-body\) var\(--font-ui\)/,
    )
    expect(css).toMatch(/\.body\s*\{[^}]*margin-top:\s*var\(--space-12\)/)
  })
})
