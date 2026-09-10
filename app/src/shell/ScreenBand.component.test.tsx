import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { inMemoryOpLog } from '../household/opLog'
import { createHouseholdStore, HouseholdProvider } from '../household/store'
import { anAuthor, noopEngine } from '../testUtils'
import { ScreenBand } from './ScreenBand'
import styles from './ScreenBand.module.css'

/**
 * The band on its own, with the hook's answer handed in as data. The
 * composed half — a pushed screen inside `AppShell`, where the double print
 * and the sage-beside-`OFFLINE` drift are actually visible — is
 * `screenBand.test.tsx`; this suite proves only what the component does
 * with what it is given.
 */

/**
 * A real store, because the band reads its own refusal count (§5n K24) — a
 * fact about the Device rather than about any screen, so it is the one thing
 * this component does not take as a prop. Empty unless a case says otherwise,
 * which is every case but the last two.
 */
function renderBand(
  props: Parameters<typeof ScreenBand>[0],
  refusals: readonly { subject: string; ops: number }[] = [],
) {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  if (refusals.length > 0) {
    store.setState({
      refusals: refusals.map((refusal, index) => ({
        id: `refusal-${index}`,
        at: Date.now(),
        reason: 'not-saved' as const,
        ...refusal,
      })),
    })
  }

  const location = memoryLocation({ path: '/somewhere', record: true })
  return render(
    <Router hook={location.hook}>
      <HouseholdProvider value={store}>
        <ScreenBand {...props} />
      </HouseholdProvider>
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

  /**
   * **The third state, and it outranks the other two** (§5n K24). At Split the
   * rail draws a bare marker, so this band is where a refused write is stated
   * in words — and a Device that is both offline and holding a lost write has
   * exactly one thing worth the reader's attention. The ▲ takes the dot's own
   * slot so the line's text edge does not move between states.
   */
  it('states a refused write over the engine’s own status', () => {
    renderBand(
      {
        header: { band: true, backLink: false, syncLine: true },
        back: { href: '/', label: 'DEPOT' },
        sync: 'offline',
      },
      [{ subject: 'Gas canister 450', ops: 1 }],
    )

    expect(screen.getByText('1 NOT SAVED')).toBeVisible()
    expect(screen.queryByText('OFFLINE')).toBeNull()
    expect(screen.getByTestId('screen-band-dot')).toHaveTextContent('▲')
  })

  it('counts refusals, not the ops that went down with them', () => {
    // A gesture refused whole is one thing the Quartermaster did. Two
    // refusals, sixteen ops, and the line says two.
    renderBand(
      {
        header: BOTH,
        back: { href: '/', label: 'DEPOT' },
        sync: 'idle',
      },
      [
        { subject: 'CLOSE TRIP · Alps 2026', ops: 14 },
        { subject: 'Gas canister 450', ops: 2 },
      ],
    )

    expect(screen.getByText('2 NOT SAVED')).toBeVisible()
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
