import {
  createHlcClock,
  gearRecorded,
  gearRetired,
  gearTagApplied,
  normalizeTag,
  personRecorded,
  placeRecorded,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
  type TagString,
} from '@foerier/shared'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { DESKTOP } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { Depot } from './Depot'

/** The only way a `TagString` is made (`shared/src/tags.ts`). */
function aTag(raw: string): TagString {
  const tag = normalizeTag(raw)
  if (tag === null) throw new Error(`not a tag: ${raw}`)
  return tag
}

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createDepotStore` — by emitting real ops through `emit`, never by
 * hand-shaping `DepotState`. The engine is a no-op fake: this screen never
 * talks to the network, and the store's own suite (`depot/store.test.ts`)
 * already proves the sync half.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

let nextId = 0

/** A fresh, canonical-shaped id, distinct per call — never reused across
 * tests, so a failing assertion names the id it actually saw. */
function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

function fixedClock(): Clock {
  return { now: () => 1_700_000_000_000 }
}

function anAuthor(): OpAuthor {
  return {
    household_id: HOUSEHOLD,
    device_id: DEVICE,
    ids,
    hlc: createHlcClock(fixedClock()),
  }
}

const noopEngine: EngineFactory = () => ({
  start() {},
  stop() {},
  flush: () => Promise.resolve(),
  pull: () => Promise.resolve(),
  status: () => 'idle',
  bootstrap: () => null,
})

async function seededStore(
  specs: readonly OpSpec[],
): Promise<StoreApi<DepotStoreState>> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return store
}

function renderDepot(store: StoreApi<DepotStoreState>, path = '/') {
  const location = memoryLocation({ path, record: true })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/">
          <DepotProvider value={store}>
            <Depot />
          </DepotProvider>
        </Route>
        <Route path="/gear/:id">
          {(params) => <p>Gear detail {params['id']}</p>}
        </Route>
        <Route path="/add">
          <p>Add gear screen</p>
        </Route>
      </Switch>
    </Router>,
  )
  return location
}

/** Rows the screen renders for gear — the FAB is a link too, so this filters
 * to only the ones that navigate to a piece of gear. */
function gearRows(): HTMLElement[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('href')?.startsWith('/gear/'))
}

describe('the Depot list', () => {
  it('lists visible gear by name', async () => {
    const axe = anId()
    const stove = anId()
    const tent = anId()
    const store = await seededStore([
      gearRecorded(tent, { name: 'Tent', container: false, kind: 'single' }),
      gearRecorded(axe, { name: 'Axe', container: false, kind: 'single' }),
      gearRecorded(stove, {
        name: 'Stove',
        container: false,
        kind: 'single',
      }),
    ])

    renderDepot(store)

    expect(gearRows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Axe',
      'Stove',
      'Tent',
    ])
  })

  it('omits retired gear', async () => {
    const keptId = anId()
    const retiredId = anId()
    const store = await seededStore([
      gearRecorded(keptId, { name: 'Axe', container: false, kind: 'single' }),
      gearRecorded(retiredId, {
        name: 'Lantern',
        container: false,
        kind: 'single',
      }),
      gearRetired(retiredId),
    ])

    renderDepot(store)

    expect(screen.queryByRole('link', { name: 'Lantern' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Axe' })).toBeInTheDocument()
  })

  it('shows the full home path for gear inside a container', async () => {
    const placeId = anId()
    const crateId = anId()
    const tentId = anId()
    const store = await seededStore([
      placeRecorded(placeId, 'Attic'),
      gearRecorded(crateId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: placeId },
      }),
      gearRecorded(tentId, {
        name: 'Tent',
        container: false,
        kind: 'single',
        residence: { in: 'gear', id: crateId },
      }),
    ])

    renderDepot(store)

    const row = screen.getByRole('link', { name: 'Tent' })
    // Owner leads the meta slot since S4, so the path is no longer the whole
    // of it — the boards draw `PERSONAL E · SLAAPKAMER ▸ KAST`.
    expect(within(row).getByTestId('gear-row-meta')).toHaveTextContent(
      'SHARED · Attic ▸ Crate B',
    )
  })

  it('shows the owner alone where a home path would be for loose gear', async () => {
    // Before S4 the meta slot could be empty and loose gear had none. The
    // owner segment is never empty — an absent register reads `SHARED` — so
    // the slot now always exists, carrying just the owner.
    const ropeId = anId()
    const store = await seededStore([
      gearRecorded(ropeId, { name: 'Rope', container: false, kind: 'single' }),
    ])

    renderDepot(store)

    const row = screen.getByRole('link', { name: 'Rope' })
    expect(within(row).getByTestId('gear-row-meta')).toHaveTextContent('SHARED')
  })

  it('leads the meta slot with the owning Person`s initial', async () => {
    const jacketId = anId()
    const store = await seededStore([
      personRecorded('els', 'Els'),
      gearRecorded(jacketId, {
        name: 'Down jacket',
        container: false,
        kind: 'single',
        owner: { type: 'person', personId: 'els' },
      }),
    ])

    renderDepot(store)

    const row = screen.getByRole('link', { name: 'Down jacket' })
    expect(within(row).getByTestId('gear-row-meta')).toHaveTextContent(
      'PERSONAL E',
    )
  })

  it('shows the owned-count only for counted gear', async () => {
    const tentId = anId()
    const mugId = anId()
    const store = await seededStore([
      gearRecorded(tentId, { name: 'Tent', container: false, kind: 'single' }),
      gearRecorded(mugId, {
        name: 'Mug',
        container: false,
        kind: 'counted',
        owned_count: 4,
      }),
    ])

    renderDepot(store)

    const mugRow = screen.getByRole('link', { name: 'Mug' })
    expect(within(mugRow).getByTestId('gear-row-meta')).toHaveTextContent('×4')

    // The single's slot exists now — it carries the owner — but still no
    // count, which is what this test is about.
    const tentRow = screen.getByRole('link', { name: 'Tent' })
    expect(within(tentRow).getByTestId('gear-row-meta')).not.toHaveTextContent(
      '×',
    )
  })

  it('filters rows by the search field', async () => {
    const axeId = anId()
    const stoveId = anId()
    const tentId = anId()
    const store = await seededStore([
      gearRecorded(axeId, { name: 'Axe', container: false, kind: 'single' }),
      gearRecorded(stoveId, {
        name: 'Stove',
        container: false,
        kind: 'single',
      }),
      gearRecorded(tentId, { name: 'Tent', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()

    renderDepot(store)
    await user.type(
      screen.getByRole('searchbox', { name: 'Search gear' }),
      'sto',
    )

    expect(screen.getByRole('link', { name: 'Stove' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Axe' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Tent' })).toBeNull()
  })

  /**
   * **One count line**, always both numbers (`docs/design/README.md` §3):
   * `N OF M` covers search and filters together, because they AND. S2's
   * `2 GEAR · 2 PIECES` at rest and `1 MATCH` while searching were two reads
   * of the same line, and both are gone — the headline pair survives only as
   * the desktop title row's, where the board puts it.
   */
  it('reports one count line covering search and filters together', async () => {
    const axeId = anId()
    const stoveId = anId()
    const store = await seededStore([
      gearRecorded(axeId, { name: 'Axe', container: false, kind: 'single' }),
      gearRecorded(stoveId, {
        name: 'Stove',
        container: false,
        kind: 'single',
      }),
    ])
    const user = userEvent.setup()

    renderDepot(store)
    expect(screen.getByTestId('count-line')).toHaveTextContent('2 OF 2')

    await user.type(
      screen.getByRole('searchbox', { name: 'Search gear' }),
      'sto',
    )

    expect(screen.getByTestId('count-line')).toHaveTextContent('1 OF 2')
    expect(screen.queryByText('2 GEAR · 2 PIECES')).toBeNull()
  })

  it('renders the empty state before anything is recorded', async () => {
    const store = await seededStore([])

    renderDepot(store)

    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument()
    expect(gearRows()).toHaveLength(0)
  })

  it('opens gear detail when a row is activated', async () => {
    const tentId = anId()
    const store = await seededStore([
      gearRecorded(tentId, { name: 'Tent', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()

    renderDepot(store)
    await user.click(screen.getByRole('link', { name: 'Tent' }))

    expect(await screen.findByText(`Gear detail ${tentId}`)).toBeInTheDocument()
  })

  it('opens Add Gear from the FAB', async () => {
    const store = await seededStore([])
    const user = userEvent.setup()

    renderDepot(store)
    await user.click(screen.getByRole('link', { name: 'Add gear' }))

    expect(await screen.findByText('Add gear screen')).toBeInTheDocument()
  })
})

/**
 * **Tier 3's named target: the filter cluster**, wired to the real store and
 * the real slicing engine rather than to a fake. `SliceBar.test.tsx` proves
 * the cluster's own mechanics; this proves it actually narrows the list.
 */
describe('the Depot slice bar', () => {
  async function aTaggedDepot() {
    const bagId = anId()
    const potId = anId()
    const mugId = anId()
    return seededStore([
      gearRecorded(bagId, {
        name: 'Sleeping bag',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
      gearRecorded(potId, {
        name: 'Pot set',
        container: false,
        kind: 'single',
      }),
      gearRecorded(mugId, {
        name: 'Mug',
        container: false,
        kind: 'per_person',
      }),
      gearTagApplied(bagId, aTag('winter')),
      gearTagApplied(mugId, aTag('winter')),
      gearTagApplied(potId, aTag('cooking')),
    ])
  }

  it('narrows the list to a tag picked from the vocabulary', async () => {
    const user = userEvent.setup()
    renderDepot(await aTaggedDepot())

    await user.click(screen.getByRole('button', { name: '+ TAG' }))
    await user.click(screen.getByRole('button', { name: /#winter 2/ }))

    expect(gearRows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Mug',
      'Sleeping bag',
    ])
    expect(screen.getByTestId('count-line')).toHaveTextContent('2 OF 3')
  })

  it('ANDs a second tag rather than widening the list', async () => {
    const user = userEvent.setup()
    renderDepot(await aTaggedDepot())

    await user.click(screen.getByRole('button', { name: '+ TAG' }))
    await user.click(screen.getByRole('button', { name: /#winter 2/ }))
    await user.click(screen.getByRole('button', { name: '+ TAG' }))
    await user.click(screen.getByRole('button', { name: /#cooking 1/ }))

    // Nothing carries both, and that is the point: tags AND.
    expect(screen.getByTestId('count-line')).toHaveTextContent('0 OF 3')
    expect(screen.getByText('No matches.')).toBeInTheDocument()
  })

  it('ANDs the search with an active tag', async () => {
    const user = userEvent.setup()
    renderDepot(await aTaggedDepot())

    await user.click(screen.getByRole('button', { name: '+ TAG' }))
    await user.click(screen.getByRole('button', { name: /#winter 2/ }))
    await user.type(
      screen.getByRole('searchbox', { name: 'Search gear' }),
      'mug',
    )

    expect(screen.getByTestId('count-line')).toHaveTextContent('1 OF 3')
    expect(screen.getByTestId('count-line')).toHaveTextContent('CLEAR (2)')
  })

  it('puts the list back with CLEAR', async () => {
    const user = userEvent.setup()
    renderDepot(await aTaggedDepot())

    await user.click(screen.getByRole('button', { name: '+ TAG' }))
    await user.click(screen.getByRole('button', { name: /#winter 2/ }))
    await user.click(screen.getByRole('button', { name: 'CLEAR (1)' }))

    expect(gearRows()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /CLEAR/ })).toBeNull()
  })

  // Rows never show tags: a tag filter changes which rows appear, not the
  // rows (`docs/design/README.md` §3).
  it('never draws a tag on a row', async () => {
    renderDepot(await aTaggedDepot())

    const row = screen.getByRole('link', { name: 'Sleeping bag' })
    expect(within(row).queryByTestId('gear-row-tags')).toBeNull()
    expect(within(row).queryByText(/#winter/)).toBeNull()
  })

  it('groups by kind, and never offers grouping by tag', async () => {
    const user = userEvent.setup()
    renderDepot(await aTaggedDepot())

    await user.click(screen.getByTestId('arrange-readout'))
    const group = screen.getByTestId('group-options')
    expect(group).not.toHaveTextContent('TAG')

    await user.click(within(group).getByRole('button', { name: /KIND/ }))

    // Alphabetically by label, which is the board's grouped frame and not the
    // enum's own order.
    expect(
      screen
        .getAllByText(/^(Counted|Per-person|Single)$/)
        .map((element) => element.textContent),
    ).toEqual(['Counted', 'Per-person', 'Single'])
  })

  it('reorders the list from the sort sheet', async () => {
    const user = userEvent.setup()
    renderDepot(await aTaggedDepot())

    await user.click(screen.getByTestId('arrange-readout'))
    await user.click(
      within(screen.getByTestId('sort-options')).getByRole('button', {
        name: /NAME Z→A/,
      }),
    )

    expect(gearRows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Sleeping bag',
      'Pot set',
      'Mug',
    ])
  })

  /**
   * "Sort and group persist per device; filter chips and search reset on a
   * fresh start, but survive navigation." A remount is the fresh start.
   */
  it('keeps the sort across a fresh start but drops the filters', async () => {
    const user = userEvent.setup()
    const store = await aTaggedDepot()
    renderDepot(store)

    await user.click(screen.getByRole('button', { name: '+ TAG' }))
    await user.click(screen.getByRole('button', { name: /#winter 2/ }))
    await user.click(screen.getByTestId('arrange-readout'))
    await user.click(
      within(screen.getByTestId('sort-options')).getByRole('button', {
        name: /NAME Z→A/,
      }),
    )

    cleanup()
    renderDepot(store)

    expect(screen.getByTestId('arrange-readout')).toHaveTextContent('NAME Z→A')
    expect(screen.queryByRole('button', { name: /CLEAR/ })).toBeNull()
    expect(gearRows()).toHaveLength(3)
  })
})

/**
 * Desktop 1024 (`docs/design/README.md` §2): the sidebar, the 8-column table,
 * and column heads that sort. A **shell** decision, so it comes from a media
 * query rather than a container query — frontend-design §3.1's own split.
 */
describe('the Depot at desktop width', () => {
  async function aHomedDepot() {
    const atticId = anId()
    const crateId = anId()
    const bagId = anId()
    return seededStore([
      placeRecorded(atticId, 'Attic'),
      gearRecorded(crateId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: atticId },
      }),
      gearRecorded(bagId, {
        name: 'Sleeping bag',
        container: false,
        kind: 'counted',
        owned_count: 2,
        residence: { in: 'gear', id: crateId },
      }),
      gearTagApplied(bagId, aTag('winter')),
    ])
  }

  // Tags appear in the table's own column and nowhere else — at 44px density
  // chips would dominate the row, and the full set is on gear detail.
  it('shows tags in the table column that the folded row hides', async () => {
    setViewport(DESKTOP)
    renderDepot(await aHomedDepot())

    const row = screen.getByRole('link', { name: 'Sleeping bag' })
    expect(within(row).getByTestId('gear-row-tags')).toHaveTextContent(
      '#winter',
    )
    expect(within(row).getByTestId('gear-row-kind')).toHaveTextContent(
      'Counted',
    )
  })

  it('sorts from the GEAR column head', async () => {
    setViewport(DESKTOP)
    const user = userEvent.setup()
    renderDepot(await aHomedDepot())

    await user.click(screen.getByRole('button', { name: 'GEAR ↑' }))

    expect(gearRows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Sleeping bag',
      'Crate B',
    ])
  })

  /**
   * The board's desktop leaves `NEWEST FIRST` unreachable — sort there is
   * "click a column head", and no column shows when a piece of gear was
   * recorded. So the expanded arrange row keeps its SORT options rather than
   * dropping them as "the ▾ control appears only where no heads exist" would
   * suggest. A recorded deviation, not an oversight.
   */
  it('keeps every sort key reachable, including the one no column head offers', async () => {
    setViewport(DESKTOP)
    renderDepot(await aHomedDepot())

    expect(
      within(screen.getByTestId('sort-options')).getByRole('button', {
        name: /NEWEST FIRST/,
      }),
    ).toBeInTheDocument()
  })
})
