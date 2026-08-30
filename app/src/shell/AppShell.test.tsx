import { act, cleanup, render, screen, within } from '@testing-library/react'
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
 * The shell stays put and the screen scrolls inside it. Two facts hang off
 * that — the tab bar is in the thumb zone on the app's longest list, and the
 * main area's foot is where a screen's floating control comes to rest
 * (`docs/design/README.md` §5). jsdom computes no layout and applies no
 * stylesheet, so the source is the only place either can be held.
 */
describe('the shell that stays put while a screen scrolls', () => {
  // Declarations only. These fences match across a whole rule with `[^}]*`,
  // so a comment inside one can satisfy or break them by quoting the very
  // declaration under discussion — which is exactly what the prose explaining
  // why `min-height` was rejected went on to do.
  const layout = (): string =>
    readFileSync(
      join(
        dirname(expect.getState().testPath ?? ''),
        '../../../ui/styles/layout.css',
      ),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')

  it('is exactly one viewport tall, so nothing outside the screen scrolls away', () => {
    // A `min-height` lets the grid grow with its content, which takes every
    // row down the page with it: on a list longer than the viewport the tab
    // bar leaves the thumb zone entirely, and from Split up the nav column's
    // pinned foot — ACCOUNT, then the sync line — ends up at the bottom of
    // the document rather than the bottom of the screen.
    expect(layout()).toMatch(/\.shell\s*\{[^}]*height:\s*100svh/)
    expect(layout()).not.toMatch(/\.shell\s*\{[^}]*min-height:/)
  })

  it('scrolls the main area rather than the document', () => {
    // This is the whole of the pinning: rows 1 and 3 are not inside this box,
    // so they cannot move while it scrolls.
    expect(layout()).toMatch(/\.shell__main\s*\{[^}]*overflow-y:\s*auto/)
  })

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
    //
    // The floor is pinned as well as the shape. `minmax` rather than a bare
    // `1fr` is what stops a scroll container's zero automatic minimum crushing
    // this row, and `50svh` is the decision about where pinning stops paying:
    // below it the shell overflows and the document scrolls, so the number is
    // the boundary between the two behaviours rather than a spacing value.
    expect(layout()).toMatch(
      /\.shell\s*\{[^}]*grid-template-rows:\s*auto minmax\(50svh, 1fr\) auto/,
    )
    expect(
      readFileSync(
        join(dirname(expect.getState().testPath ?? ''), 'AppShell.module.css'),
        'utf8',
      ),
    ).toMatch(/\.nav-tabs\s*\{[^}]*grid-row:\s*3/)
  })

  it('sets its own foot to the clearance, which is now the only place it is said', () => {
    // The main area is the scrollport, so this padding is the gap in both of
    // the button's states — the one it rests in, and the one it floats at.
    // Zero it and the button sits flush on the bar with every other assertion
    // still green, which is why the number is fenced here rather than at the
    // button, whose own `bottom` is `0` (`Depot.module.css` explains why an
    // inset there would be added to this padding rather than restate it).
    //
    // 18px, so that with the bar at its 56px `min-height` the button's bottom
    // edge is the 74px above the viewport's that the frames measure.
    expect(layout()).toMatch(/--fab-clearance:\s*1\.125rem/)
    expect(layout()).toMatch(
      /\.shell__main\s*\{[^}]*padding-block:\s*var\(--space-16\) var\(--fab-clearance\)/,
    )
  })
})

/**
 * A scroll container that outlives the route carries its offset into whatever
 * renders next, so a reader part-way down a two-hundred-item Depot who opens a
 * gear would land part-way down the gear's screen.
 *
 * **The reset is a behaviour chosen here, not one restored.** `pushState` does
 * not reset scroll — measured in Chromium, an offset of 1200 survives both the
 * call and a full re-render — so the document scroller this replaced kept its
 * offset too and was merely *clamped* by a shorter next screen. Most screens
 * were shorter, which is what made it read as a reset.
 *
 * One place says it, for every screen: this is a shell concern, and a rule
 * spelled per screen is one chance per screen to spell it differently
 * (`useScreenHeader`'s own reason, `frontend-design.md` §3.3).
 */
describe('the scroll position across a route change', () => {
  function watchMainScroll(): { get: () => number } {
    const main = screen.getByRole('main')
    let scrollTop = 420
    Object.defineProperty(main, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (next: number) => {
        scrollTop = next
      },
    })
    return { get: () => scrollTop }
  }

  it('returns the main area to the top when the route changes', () => {
    const location = memoryLocation({ path: '/', record: true })
    render(
      <Router hook={location.hook}>
        <AppShell>
          <p>screen</p>
        </AppShell>
      </Router>,
    )

    const scroll = watchMainScroll()
    act(() => {
      location.navigate('/trips')
    })

    expect(scroll.get()).toBe(0)
  })

  it('leaves it alone when the shell re-renders on the same route', () => {
    // The engine reports a new status every few seconds and the shell draws
    // it. Resetting on a re-render would jump the list under the reader's
    // thumb while they are half-way down it.
    const location = memoryLocation({ path: '/', record: true })
    const { rerender } = render(
      <Router hook={location.hook}>
        <AppShell syncLine="OFFLINE" syncTone="unreachable">
          <p>screen</p>
        </AppShell>
      </Router>,
    )

    const scroll = watchMainScroll()
    rerender(
      <Router hook={location.hook}>
        <AppShell syncLine="SYNCED 14:32" syncTone="reachable">
          <p>screen</p>
        </AppShell>
      </Router>,
    )

    expect(scroll.get()).toBe(420)
  })

  it('holds the offset across the two routes of one Split view', () => {
    setViewport(SPLIT)
    const location = memoryLocation({ path: '/', record: true })
    render(
      <Router hook={location.hook}>
        <AppShell>
          <p>screen</p>
        </AppShell>
      </Router>,
    )

    // At Split `DepotView` draws the Depot list and the gear detail as two
    // panes of one view that never unmounts, so these two routes share this
    // one scroll offset. Resetting on the route would take the list to the top
    // on every row tap — the reader loses their place in the list precisely by
    // using it.
    const scroll = watchMainScroll()
    act(() => {
      location.navigate('/gear/abc')
    })

    expect(scroll.get()).toBe(420)
  })

  it('still resets when a Split reader leaves the Depot entirely', () => {
    setViewport(SPLIT)
    const location = memoryLocation({ path: '/gear/abc', record: true })
    render(
      <Router hook={location.hook}>
        <AppShell>
          <p>screen</p>
        </AppShell>
      </Router>,
    )

    const scroll = watchMainScroll()
    act(() => {
      location.navigate('/trips')
    })

    expect(scroll.get()).toBe(0)
  })

  it('resets between those same two routes below Split, where they are two screens', () => {
    setViewport()
    const location = memoryLocation({ path: '/', record: true })
    render(
      <Router hook={location.hook}>
        <AppShell>
          <p>screen</p>
        </AppShell>
      </Router>,
    )

    // Below Split — and at Desktop — `DepotView` renders one screen or the
    // other, so there the path *is* the group.
    const scroll = watchMainScroll()
    act(() => {
      location.navigate('/gear/abc')
    })

    expect(scroll.get()).toBe(0)
  })
})
