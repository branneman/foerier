import { cleanup, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { setViewport } from '../testSetup'
import { AppShell } from './AppShell'
import { DESKTOP, SPLIT } from './useMediaQuery'

/**
 * The shell's three nav treatments (`frontend-design.md` §3.1, and the
 * **SIDEBAR ANATOMY** card on `Screens A` §02 as settled in R3):
 *
 * | Mode | Nav | Sync |
 * | --- | --- | --- |
 * | below Split | bottom tabs, three labels | header line |
 * | Split 52–64em | 56px icon rail, logo mark on top | **dot only**, in the rail |
 * | Desktop ≥64em | 216px sidebar, logo + wordmark, counts | **line**, in the sidebar |
 *
 * Which *elements exist* differs per mode — icons versus labels, count versus
 * no count — so the mode comes from a media query rather than from CSS.
 * Hiding a count with `display: none` at phone width would leave it in the
 * accessibility tree on a board that does not draw it (`frontend-design.md`
 * §3.2's own rule).
 */

function renderShell(
  path = '/',
  props: Partial<Parameters<typeof AppShell>[0]> = {},
) {
  const location = memoryLocation({ path, record: true })
  render(
    <Router hook={location.hook}>
      <AppShell syncLine="SYNCED 14:32" syncTone="reachable" {...props}>
        <p>screen</p>
      </AppShell>
    </Router>,
  )
  return screen.getByRole('navigation', { name: 'Sections' })
}

describe('AppShell — bottom tabs, below Split', () => {
  it('offers exactly the three destinations, as labels', () => {
    // Three, not four: Account is reached from the avatar rather than the tab
    // bar (`docs/design/README.md` §11).
    const nav = renderShell()
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Depot', 'Trips', 'Find'])
  })

  it('draws no icons and no logo in the tab bar', () => {
    const nav = renderShell()
    expect(within(nav).queryByTestId('icon-depot')).toBeNull()
    expect(within(nav).queryByTestId('foerier-mark')).toBeNull()
  })

  it('keeps the sync line in the header, not in the nav', () => {
    const nav = renderShell()
    expect(screen.getByText('SYNCED 14:32')).toBeInTheDocument()
    expect(within(nav).queryByText('SYNCED 14:32')).toBeNull()
  })

  it('shows no counts, because the tab bar draws none', () => {
    const nav = renderShell('/', { counts: { '/': 128 } })
    expect(within(nav).queryByText('128')).toBeNull()
  })
})

describe('AppShell — the icon rail at Split', () => {
  it('draws the mark and an icon per destination', () => {
    setViewport(SPLIT)
    const nav = renderShell()

    expect(within(nav).getByTestId('foerier-mark')).toBeInTheDocument()
    expect(within(nav).getByTestId('icon-depot')).toBeInTheDocument()
    expect(within(nav).getByTestId('icon-trips')).toBeInTheDocument()
    expect(within(nav).getByTestId('icon-find')).toBeInTheDocument()
  })

  it('keeps each destination reachable by name, though the label is not drawn', () => {
    setViewport(SPLIT)
    const nav = renderShell()
    // A 56px rail has no room for a label, but a link with no accessible name
    // is a link nobody can follow.
    expect(within(nav).getByRole('link', { name: 'Depot' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Trips' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Find' })).toBeInTheDocument()
  })

  // 56px is too narrow for `SYNCED 14:32`, so the rail carries the dot alone —
  // the state, without the timestamp.
  it('carries the sync dot alone, with the state still announced', () => {
    setViewport(SPLIT)
    const nav = renderShell()

    expect(within(nav).getByTestId('sync-dot')).toBeInTheDocument()
    expect(screen.queryByText('SYNCED 14:32')).toBeNull()
    expect(within(nav).getByTestId('sync-dot')).toHaveAccessibleName(
      'SYNCED 14:32',
    )
  })
})

describe('AppShell — the sidebar at Desktop', () => {
  it('draws the full wordmark and labelled rows', () => {
    setViewport(SPLIT, DESKTOP)
    const nav = renderShell()

    expect(within(nav).getByText('foerier')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Depot/ })).toBeInTheDocument()
    expect(within(nav).queryByTestId('icon-depot')).toBeNull()
  })

  it('shows a count where one is handed to it, and nothing where none is', () => {
    setViewport(SPLIT, DESKTOP)
    const nav = renderShell('/', { counts: { '/': 128 } })

    expect(within(nav).getByRole('link', { name: 'Depot' })).toHaveTextContent(
      '128',
    )
    // The shell draws what it is handed and nothing else. This `counts` map
    // carries `/` alone, so Trips draws no count here — not because Trips has
    // none (`App` hands it one), but because a destination absent from the map
    // renders no badge at all, which is what Find relies on permanently.
    expect(
      within(nav).getByRole('link', { name: 'Trips' }),
    ).not.toHaveTextContent(/\d/)
  })

  /**
   * A destination is called Depot whether it holds nothing or two hundred
   * things. Folding the count into the link's accessible name made the name
   * change as gear was recorded — and "Depot 128", announced, is as easily a
   * room number as a tally. The count is a glance affordance; the Depot
   * screen's own `128 GEAR · 214 PIECES` headline is where that fact is
   * actually stated.
   *
   * Found by the Tier 5 golden path, which had been asking for the link by
   * its name and stopped finding it.
   */
  it('keeps the destination name stable as the count moves', () => {
    setViewport(SPLIT, DESKTOP)
    const nav = renderShell('/', { counts: { '/': 0 } })

    expect(within(nav).getByRole('link', { name: 'Depot' })).toBeInTheDocument()
    expect(within(nav).getByText('0')).toHaveAttribute('aria-hidden', 'true')
  })

  it('moves the sync line into the sidebar, out of the main column', () => {
    setViewport(SPLIT, DESKTOP)
    const nav = renderShell()
    // "The sync line lives in the sidebar beneath ACCOUNT — never in the main
    // column at desktop" (SIDEBAR ANATOMY, Screens A §02).
    expect(within(nav).getByText('SYNCED 14:32')).toBeInTheDocument()
    expect(screen.getAllByText('SYNCED 14:32')).toHaveLength(1)
  })

  it('marks the current destination', () => {
    setViewport(SPLIT, DESKTOP)
    const nav = renderShell('/trips')

    expect(within(nav).getByRole('link', { name: /Trips/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(nav).getByRole('link', { name: /Depot/ }),
    ).not.toHaveAttribute('aria-current')
  })
})

/**
 * The design settles an `ACCOUNT` row pinned to the bottom of the sidebar, a
 * matching avatar on the Split rail, and an avatar in the phone header. All
 * three were blocked on the same thing — there was no Account screen to open
 * — until Task 11 built it (auth slice 4, story 30). An affordance that leads
 * nowhere is worse than a missing one, which is why this asserted absence
 * until now; it asserts presence in the same three modes, in the same loop,
 * because that diff is the record that the debt was discharged rather than
 * dropped.
 */
describe('AppShell — the account affordance', () => {
  it('offers one in every mode, now that the Account screen exists', () => {
    for (const viewport of [[], [SPLIT], [SPLIT, DESKTOP]]) {
      setViewport(...viewport)
      renderShell('/', { accountInitial: 'M' })
      // The sidebar draws a labelled row; the rail and the phone header draw
      // an avatar with no label, so both need an accessible name or the
      // affordance is a link nobody can follow. Below `nav`, deliberately:
      // the phone header's avatar sits outside it.
      expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument()
      // A full unmount, not just the nav removed: the phone header (tabs
      // mode) sits outside `nav` too, and would otherwise survive into the
      // next iteration and leave two links named "Account" in the document.
      cleanup()
    }
  })

  it('keeps the tab bar at three destinations', () => {
    setViewport()
    const nav = renderShell('/', { accountInitial: 'M' })
    // Account is reached from the avatar, not a fourth tab.
    expect(within(nav).getAllByRole('link')).toHaveLength(3)
  })

  it('draws an empty circle when no Person is folded yet', () => {
    setViewport()
    renderShell('/', { accountInitial: null })
    const link = screen.getByRole('link', { name: 'Account' })
    // A half-finished bootstrap has a person_id and no Person
    // (`auth-design.md` §2.1); a placeholder letter would be a fact invented.
    expect(link.textContent).toBe('')
  })

  it('never folds the initial into the accessible name', () => {
    setViewport(SPLIT)
    renderShell('/', { accountInitial: 'M' })
    expect(screen.queryByRole('link', { name: /^Account M$/ })).toBeNull()
  })
})

/**
 * The main area is where a screen's floating control comes to rest, so two of
 * its properties are load-bearing outside this file (`docs/design/README.md`
 * §5). jsdom computes no layout and applies no stylesheet, so the source is
 * the only place they can be held.
 */
describe('the main area the shell hands a screen', () => {
  const layout = (): string =>
    readFileSync(
      join(
        dirname(expect.getState().testPath ?? ''),
        '../../../ui/styles/layout.css',
      ),
      'utf8',
    )

  it('is a column, so a control after the screen can be parked at its foot', () => {
    // `Depot`'s and `Trips`' add button is a flow sibling of the screen with
    // `margin-block-start: auto`. An auto block margin absorbs free space only
    // in a flex or grid container: in a block container it resolves to zero
    // and the button would sit directly under a one-card list rather than
    // above the tab bar.
    expect(layout()).toMatch(
      /\.shell__main\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/,
    )
  })

  it('ends where the tab bar begins, which is what the button follows', () => {
    // Below Split — the one shape with a bottom bar, and the one where the
    // button is drawn — the shell is three rows and the nav is the third. So
    // the main area's bottom edge is the bar's top edge, and a bar grown by a
    // large user font size takes the height out of the `1fr` row between them
    // and carries the button up with it. That is the whole of the mechanism:
    // no height of the bar is written down.
    expect(layout()).toMatch(
      /\.shell\s*\{[^}]*grid-template-rows:\s*auto 1fr auto/,
    )
    expect(
      readFileSync(
        join(dirname(expect.getState().testPath ?? ''), 'AppShell.module.css'),
        'utf8',
      ),
    ).toMatch(/\.nav-tabs\s*\{[^}]*grid-row:\s*3/)
  })

  it('sets its own foot to the clearance the button comes to rest in', () => {
    // The resting gap is this padding and nothing else: the button's box ends
    // where the main area's content box ends. Zero it and the button sits
    // flush on the bar with every other assertion still green, which is why
    // the number is fenced here rather than only at the button.
    //
    // 18px, so that with the bar at its 56px `min-height` the button's bottom
    // edge is the 74px above the viewport's that the frames measure.
    expect(layout()).toMatch(/--fab-clearance:\s*1\.125rem/)
    expect(layout()).toMatch(
      /\.shell__main\s*\{[^}]*padding-block:\s*var\(--space-16\) var\(--fab-clearance\)/,
    )
  })

  it('leaves the tab bar unpinned, which the floating offset depends on', () => {
    // The button floats `--fab-clearance` above the **scrollport**, not above
    // the bar — sticky references the scrollport. That reads as 18px of
    // clearance only because the bar is in flow and has scrolled away by
    // then: nothing in `.nav-tabs` takes it out of flow. Pin it and the
    // button lands behind it, and the offset has to become the bar's height
    // plus the clearance — the sum this mechanism exists to avoid naming.
    const shell = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'AppShell.module.css'),
      'utf8',
    )
    expect(/\.nav-tabs\s*\{[^}]*\}/.exec(shell)?.[0] ?? '').not.toMatch(
      /position:\s*(?:sticky|fixed)/,
    )
  })
})
