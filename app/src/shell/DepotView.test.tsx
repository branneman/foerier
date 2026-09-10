import { gearRecorded } from '@foerier/shared'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { HouseholdProvider, type HouseholdStoreState } from '../household/store'
import { setViewport } from '../testSetup'
import { anId, seededStore } from '../testUtils'
import { DepotView } from './DepotView'
import { DESKTOP, SPLIT } from './useMediaQuery'

/**
 * **The two-pane unlock**, 832–1024 (`docs/design/README.md` §3a).
 *
 * Chartered to S0 and never built; §12.1 did not record the gap. S3 absorbs
 * it because the board draws S3's own tag chips inside the missing pane.
 */

function renderView(store: StoreApi<HouseholdStoreState>, path: string) {
  const location = memoryLocation({ path, record: true })
  render(
    <Router hook={location.hook}>
      <HouseholdProvider value={store}>
        <Switch>
          <Route path="/">
            <DepotView />
          </Route>
          <Route path="/gear/:id">
            <DepotView />
          </Route>
        </Switch>
      </HouseholdProvider>
    </Router>,
  )
  return location
}

async function aDepot() {
  const bagId = anId()
  const store = await seededStore([
    gearRecorded(bagId, {
      name: 'Sleeping bag',
      container: false,
      kind: 'single',
    }),
    gearRecorded(anId(), { name: 'Axe', container: false, kind: 'single' }),
  ])
  return { store, bagId }
}

describe('DepotView below Split', () => {
  it('shows the list alone on the list route', async () => {
    const { store } = await aDepot()
    renderView(store, '/')

    expect(screen.getByRole('heading', { name: 'Depot' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '‹ DEPOT' })).toBeNull()
  })

  it('shows the detail alone on the gear route', async () => {
    const { store, bagId } = await aDepot()
    renderView(store, `/gear/${bagId}`)

    expect(
      screen.getByRole('heading', { name: 'Sleeping bag' }),
    ).toBeInTheDocument()
    // The list is not beside it — gear detail is its own view down here.
    expect(screen.queryByRole('heading', { name: 'Depot' })).toBeNull()
  })
})

describe('DepotView at Split', () => {
  it('keeps the list beside the detail', async () => {
    setViewport(SPLIT)
    const { store, bagId } = await aDepot()
    renderView(store, `/gear/${bagId}`)

    expect(screen.getByRole('heading', { name: 'Depot' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Sleeping bag' }),
    ).toBeInTheDocument()
  })

  // "Selection stays visible while the detail is read" (§3a) — and via
  // `aria-current`, so it is not colour alone.
  it('marks the row the detail pane is showing', async () => {
    setViewport(SPLIT)
    const { store, bagId } = await aDepot()
    renderView(store, `/gear/${bagId}`)

    expect(screen.getByRole('link', { name: 'Sleeping bag' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('link', { name: 'Axe' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('waits quietly when no row has been chosen', async () => {
    setViewport(SPLIT)
    const { store } = await aDepot()
    renderView(store, '/')

    // Not an error and not a prompt: the list is the screen, and the pane is
    // simply waiting.
    expect(screen.getByText('SELECT A ROW.')).toBeInTheDocument()
  })
})

/**
 * Desktop deliberately spends the width on the table's eight columns instead
 * of on a detail pane — which is what the board's 1024 frame draws, and why
 * §3.1 puts the two-pane unlock at Split.
 */
describe('DepotView at Desktop', () => {
  it('drops the second pane in favour of the table', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store, bagId } = await aDepot()
    renderView(store, `/gear/${bagId}`)

    expect(
      screen.getByRole('heading', { name: 'Sleeping bag' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Depot' })).toBeNull()
  })
})

/**
 * **Each pane is its own scrollport, and it resets on its own route**
 * (§5n K21).
 *
 * This is the claim `AppShell.test.tsx` used to carry as an exception. The
 * shell's main area was one scroller, so `/` and `/gear/:id` were two routes
 * over one offset and the reset had to key on a *scroll group* to stop every
 * row tap taking the list to the top. The panes hold their own offsets now,
 * so the shell resets on the path like anything else and the real behaviour
 * is stated here, where the panes are.
 *
 * jsdom computes no layout, so what is asserted is the **reset**, which is
 * the part that is code: `scrollTop` is an ordinary property here and
 * `usePaneScroll` is what does or does not zero it. That the panes overflow
 * at all is CSS, and lives in the stylesheet.
 */
describe('the two panes’ scroll offsets', () => {
  /**
   * **The list pane's own reset never fires**, which is the half of K21's
   * *the list pane's offset persists* that this component controls.
   *
   * The other half is not code that lives here: `AppShell` keys the screen's
   * `ErrorBoundary` on the location, so every navigation remounts this view
   * and a remounted pane starts at the top whatever this hook does. Moving
   * that boundary into the panes is what would finish it — recorded in
   * `technical-debt.md` rather than done, because where a crash is contained
   * is a decision `AppShell` argues out loud.
   */
  it('never resets the list pane when a row is opened', async () => {
    setViewport(SPLIT)
    const { store, bagId } = await aDepot()
    const location = renderView(store, '/')

    const list = screen.getByTestId('depot-list-pane')
    list.scrollTop = 420

    act(() => {
      location.navigate(`/gear/${bagId}`)
    })

    // The list pane's route *is* the view — it does not change when a row is
    // opened, so `usePaneScroll` has nothing to reset.
    expect(list.scrollTop).toBe(420)
  })

  it('takes the detail pane to the top of the gear just opened', async () => {
    setViewport(SPLIT)
    const { store, bagId } = await aDepot()
    const location = renderView(store, '/')

    const detail = screen.getByTestId('depot-detail-pane')
    detail.scrollTop = 300

    act(() => {
      location.navigate(`/gear/${bagId}`)
    })

    expect(detail.scrollTop).toBe(0)
  })
})
