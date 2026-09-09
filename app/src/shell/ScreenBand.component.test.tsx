import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { ScreenBand } from './ScreenBand'
import styles from './ScreenBand.module.css'

/**
 * The band on its own, with the hook's answer handed in as data. The
 * composed half — a pushed screen inside `AppShell`, where the double print
 * and the sage-beside-`OFFLINE` drift are actually visible — is
 * `screenBand.test.tsx`; this suite proves only what the component does
 * with what it is given.
 */

function renderBand(props: Parameters<typeof ScreenBand>[0]) {
  const location = memoryLocation({ path: '/somewhere', record: true })
  return render(
    <Router hook={location.hook}>
      <ScreenBand {...props} />
    </Router>,
  )
}

const BOTH = { band: true, backLink: true, syncLine: true }

describe('ScreenBand', () => {
  it('renders nothing when the hook withholds the band', () => {
    const { container } = renderBand({
      header: { band: false, backLink: false, syncLine: false },
      back: { href: '/', label: 'DEPOT' },
      sync: 'idle',
    })

    expect(container).toBeEmptyDOMElement()
  })

  it('draws the back link with the ‹ prefix, its label and its href', () => {
    renderBand({
      header: { band: true, backLink: true, syncLine: false },
      back: { href: '/trips', label: 'TRIPS' },
      sync: 'idle',
    })

    const link = screen.getByRole('link', { name: '‹ TRIPS' })
    expect(link).toHaveAttribute('href', '/trips')
    expect(screen.queryByText('SYNCED')).toBeNull()
  })

  it('draws the sync line with a sage dot while the household is reachable', () => {
    renderBand({
      header: { band: true, backLink: false, syncLine: true },
      back: { href: '/', label: 'DEPOT' },
      sync: 'idle',
    })

    expect(screen.getByText('SYNCED')).toBeVisible()
    expect(screen.queryByRole('link')).toBeNull()
    const dot = screen.getByTestId('screen-band-dot')
    expect(dot).toHaveClass(styles['syncDot']!)
    expect(dot).not.toHaveClass(styles['syncDotUnreachable']!)
  })

  it.each(['offline', 'signed-out'] as const)(
    'turns the dot amber when the engine reports %s',
    (status) => {
      renderBand({
        header: BOTH,
        back: { href: '/', label: 'DEPOT' },
        sync: status,
      })

      expect(screen.getByTestId('screen-band-dot')).toHaveClass(
        styles['syncDotUnreachable']!,
      )
    },
  )

  it('draws the label the compact form gives, not the shell header line', () => {
    renderBand({
      header: BOTH,
      back: { href: '/', label: 'DEPOT' },
      sync: 'signed-out',
    })

    expect(screen.getByText('SIGNED OUT')).toBeVisible()
  })

  it('draws the sync half alone when the hook withholds the back link', () => {
    // `InviteIssued`'s case at Split since §5n K23: the screen used to be
    // the one caller that handed in no `sync` at all, and the band gated on
    // the back link to keep the wrapper from rendering empty. It draws the
    // line now, so `band` is the whole gate and this is an ordinary shape.
    renderBand({
      header: { band: true, backLink: false, syncLine: true },
      back: { href: '/account', label: 'ACCOUNT' },
      sync: 'idle',
    })

    expect(screen.getByText('SYNCED')).toBeVisible()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('puts a caller-named test id on the sync line', () => {
    renderBand({
      header: BOTH,
      back: { href: '/', label: 'DEPOT' },
      sync: 'idle',
      syncTestId: 'packing-sync',
    })

    expect(screen.getByTestId('packing-sync')).toHaveTextContent('SYNCED')
  })
})
