import { gearRecorded } from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { DepotProvider, type DepotStoreState } from '../depot/store'
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

function renderView(store: StoreApi<DepotStoreState>, path: string) {
  const location = memoryLocation({ path, record: true })
  render(
    <Router hook={location.hook}>
      <DepotProvider value={store}>
        <Switch>
          <Route path="/">
            <DepotView />
          </Route>
          <Route path="/gear/:id">
            <DepotView />
          </Route>
        </Switch>
      </DepotProvider>
    </Router>,
  )
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
