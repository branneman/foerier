import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExpiryChip } from './ExpiryChip'

const NOW = Date.UTC(2026, 7, 25, 9, 0, 0)

function inMs(ms: number): string {
  return new Date(NOW + ms).toISOString()
}

describe('ExpiryChip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('floors to whole days above 48 hours', () => {
    // A fresh 7-day join Invite. The boards draw `6 d`, and a floor is right:
    // a link that says `7 d` on the day it dies is a lie in the direction
    // that costs somebody a handover.
    render(<ExpiryChip expiresAt={inMs(7 * 24 * 60 * 60_000 - 100)} />)
    expect(screen.getByText('EXPIRES IN 6 d')).toBeInTheDocument()
  })

  it('reads hours between one hour and two days', () => {
    render(<ExpiryChip expiresAt={inMs(5 * 60 * 60_000)} />)
    expect(screen.getByText('EXPIRES IN 5 h')).toBeInTheDocument()
  })

  it('reads minutes under an hour', () => {
    render(<ExpiryChip expiresAt={inMs(58 * 60_000)} />)
    expect(screen.getByText('EXPIRES IN 58 min')).toBeInTheDocument()
  })

  /**
   * The bug this component inherits a fix for. A freshly issued device link
   * has ~3,599,900 ms left, which *rounds* to a displayed "60 min" — and a
   * naive `minutes < 60` reads that as not urgent, rendering muted for the
   * first ~45 seconds of exactly the link that should always read amber.
   * Urgency is decided from the raw millisecond figure, never from what is
   * printed.
   */
  it('is urgent the instant a one-hour link is issued', () => {
    render(<ExpiryChip expiresAt={inMs(60 * 60_000 - 100)} />)
    const chip = screen.getByText(/^EXPIRES IN/)
    expect(chip).toHaveAttribute('data-urgent', 'true')
  })

  it('is not urgent with more than an hour left', () => {
    render(<ExpiryChip expiresAt={inMs(6 * 60 * 60_000)} />)
    expect(screen.getByText(/^EXPIRES IN/)).toHaveAttribute(
      'data-urgent',
      'false',
    )
  })

  it('counts down without being re-rendered by its parent', async () => {
    render(<ExpiryChip expiresAt={inMs(90 * 60_000)} />)
    expect(screen.getByText('EXPIRES IN 1 h')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(31 * 60_000)
    expect(screen.getByText('EXPIRES IN 59 min')).toBeInTheDocument()
  })

  it('never counts below zero', () => {
    render(<ExpiryChip expiresAt={inMs(-60_000)} />)
    expect(screen.getByText('EXPIRES IN 0 min')).toBeInTheDocument()
  })
})
