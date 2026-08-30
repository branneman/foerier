import {
  createHlcClock,
  gearRecorded,
  gearRetired,
  personRecorded,
  placeRecorded,
  tripCreated,
  tripEntryAdded,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { DepotPicker } from './DepotPicker'
import styles from './DepotPicker.module.css'

/**
 * `Trip.test.tsx`'s fixtures — a **real** store, seeded by emitting real ops,
 * never a hand-shaped `DepotState`.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const ALPS = 'tttttttt-0000-7000-8000-00000000000a'
const JURA = 'tttttttt-0000-7000-8000-00000000000b'

let nextId = 0

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

interface Seeded {
  store: StoreApi<DepotStoreState>
  /** Everything the *screen* authored — the seed is subtracted. */
  authored: () => Promise<readonly { type: string; payload: object }[]>
}

async function seededStore(...specs: readonly OpSpec[]): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const seedCount = (await log.all()).length

  return {
    store,
    authored: async () => {
      await store.getState().drained()
      return (await log.all())
        .slice(seedCount)
        .map((entry) => ({ type: entry.op.type, payload: entry.op.payload }))
    },
  }
}

/** Renders the picker over the given store, wrapped exactly as `App.tsx`
 * mounts it: inside a `Router` (the header's back link and the empty state's
 * `+ Add gear` are both `<Link>`s) with `/trips/:id` and `/add` as
 * destinations a test can assert against without simulating full navigation. */
function renderPicker(
  store: StoreApi<DepotStoreState>,
  props: { tripId?: string; variant?: 'screen' | 'pane' } = {},
) {
  const tripId = props.tripId ?? ALPS
  const location = memoryLocation({
    path: `/trips/${tripId}/add`,
    record: true,
  })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/trips/:id/add">
          <DepotProvider value={store}>
            <DepotPicker tripId={tripId} variant={props.variant ?? 'screen'} />
          </DepotProvider>
        </Route>
        <Route path="/trips/:id">{(params) => <p>Trip {params.id}</p>}</Route>
        <Route path="/add">
          <p>Add gear</p>
        </Route>
      </Switch>
    </Router>,
  )
  return location
}

function rowNames(): string[] {
  return screen
    .getAllByTestId('depot-picker-row')
    .map((row) => row.querySelector('span')?.textContent ?? '')
}

/** The meta slot's own text — the second `<span>` in the row, before the
 * trailing `+ ADD` button or `IN LIST ✓` span — read on its own so a name
 * that happens to contain the same characters the meta suffix would (an
 * owner's initial, say) cannot make an assertion pass for the wrong reason. */
function rowMeta(row: HTMLElement): string | null {
  return row.querySelectorAll('span')[1]?.textContent ?? null
}

describe('the depot picker — anatomy', () => {
  it('renders the screen variant: header, title, footer hint, and all three ghost chips', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    renderPicker(store, { variant: 'screen' })

    expect(
      screen.getByRole('link', { name: '‹ Vosges — Oct' }),
    ).toHaveAttribute('href', `/trips/${ALPS}`)
    expect(
      screen.getByRole('heading', { name: 'Add from the depot' }),
    ).toBeVisible()
    expect(
      screen.getByRole('searchbox', { name: 'Search the depot' }),
    ).toHaveAttribute('placeholder', 'Search the depot…')
    expect(screen.getByRole('button', { name: '+ TAG' })).toBeVisible()
    expect(screen.getByRole('button', { name: '+ KIND' })).toBeVisible()
    expect(screen.getByRole('button', { name: '+ TRIP' })).toBeVisible()
    expect(
      screen.getByText('ADDING LISTS IT — GEAR DOES NOT MOVE UNTIL PACK-OUT'),
    ).toBeVisible()
  })

  it('renders the pane variant: the FROM THE DEPOT eyebrow, no header, no title, and no + TRIP chip', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    renderPicker(store, { variant: 'pane' })

    expect(screen.getByText('FROM THE DEPOT')).toBeVisible()
    expect(screen.queryByRole('link', { name: /‹/ })).toBeNull()
    expect(
      screen.queryByRole('heading', { name: 'Add from the depot' }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: '+ TAG' })).toBeVisible()
    expect(screen.getByRole('button', { name: '+ KIND' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '+ TRIP' })).toBeNull()
  })

  it('draws the sync line at Split, the one mode the rail carries only a dot', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    setViewport(SPLIT)
    renderPicker(store, { variant: 'screen' })

    expect(screen.getByText('SYNCED')).toBeVisible()
  })

  it('draws no sync line below Split, where the header band already states it', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    renderPicker(store, { variant: 'screen' })

    expect(screen.queryByText('SYNCED')).toBeNull()
  })
})

describe('the depot picker — rows', () => {
  it('draws the home path alone for a Single, Shared piece of gear', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      placeRecorded('garage', 'Garage'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
        residence: { in: 'place', id: 'garage' },
      }),
    )
    renderPicker(store)

    const row = screen.getByTestId('depot-picker-row')
    expect(row).toHaveTextContent('Tent, tunnel 4p')
    expect(row).toHaveTextContent('Garage')
  })

  it('draws LOOSE, in literal caps, for gear with no residence', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('gloves', {
        name: 'Ski gloves',
        container: false,
        kind: 'single',
      }),
    )
    renderPicker(store)

    // Literal caps, matching `Find.tsx`'s `'⌂ LOOSE'` and `GearDetail.tsx`'s
    // `chipLocation` — not a CSS transform of a mixed-case `'Loose'` written
    // here (S7 review F1).
    expect(screen.getByTestId('depot-picker-row')).toHaveTextContent('LOOSE')
  })

  it('appends ×N for Counted gear, from the owned count — even for a row that is not on the list', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('canister', {
        name: 'Gas canister 450',
        container: false,
        kind: 'counted',
        owned_count: 4,
      }),
    )
    renderPicker(store)

    const row = screen.getByTestId('depot-picker-row')
    // Still `+ ADD` — not on this Trip's list — and still `×4`: the owned
    // count is a Gear fact, not a Bring-count, which only exists once an
    // Entry does.
    expect(row).toHaveTextContent('×4')
    expect(row).toHaveTextContent('+ ADD')
  })

  it('draws PER-PERSON for per-person gear, the Kind label CSS upper-cases', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('gloves', {
        name: 'Ski gloves',
        container: false,
        kind: 'per_person',
      }),
    )
    renderPicker(store)

    expect(screen.getByTestId('depot-picker-row')).toHaveTextContent(
      'Per-person',
    )
  })

  it("draws a Personal owner's bare initial, with no PERSONAL word beside it", async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      personRecorded('els', 'Els'),
      gearRecorded('jacket', {
        // No "E" in the name itself, so a positive match on the meta slot
        // proves the owner-initial rule rather than the gear's own name.
        name: 'Down jacket',
        container: false,
        kind: 'single',
        owner: { type: 'person', personId: 'els' },
      }),
    )
    renderPicker(store)

    const row = screen.getByTestId('depot-picker-row')
    expect(rowMeta(row)).toBe('LOOSE · E')
    expect(row).not.toHaveTextContent('PERSONAL')
  })

  it('lets Kind win over ownership: a Counted, Personal piece of gear reads ×N, not the initial', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      personRecorded('els', 'Els'),
      gearRecorded('canister', {
        name: 'Gas canister 450',
        container: false,
        kind: 'counted',
        owned_count: 4,
        owner: { type: 'person', personId: 'els' },
      }),
    )
    renderPicker(store)

    const row = screen.getByTestId('depot-picker-row')
    // The owner is not on the board and not drawn: an undrawn combination
    // (S7 review F1's ruling), not a silent contradiction — `LOOSE · ×4`,
    // never `LOOSE · E`.
    expect(rowMeta(row)).toBe('LOOSE · ×4')
  })

  it('lets Kind win over ownership: a per-person, Personal piece of gear reads PER-PERSON, not the initial', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      personRecorded('els', 'Els'),
      gearRecorded('gloves', {
        name: 'Ski gloves',
        container: false,
        kind: 'per_person',
        owner: { type: 'person', personId: 'els' },
      }),
    )
    renderPicker(store)

    const row = screen.getByTestId('depot-picker-row')
    expect(rowMeta(row)).toBe('LOOSE · Per-person')
  })

  it('excludes retired gear', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      gearRetired('tent'),
      gearRecorded('gloves', {
        name: 'Ski gloves',
        container: false,
        kind: 'per_person',
      }),
    )
    renderPicker(store)

    expect(screen.queryByText('Tent, tunnel 4p')).toBeNull()
    expect(screen.getByText('Ski gloves')).toBeVisible()
  })

  it('marks an already-listed Gear IN LIST ✓ and mutes the row', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-tent', { from: 'depot', gearId: 'tent' }),
    )
    renderPicker(store)

    const row = screen.getByTestId('depot-picker-row')
    expect(row).toHaveTextContent('IN LIST ✓')
    expect(
      screen.queryByRole('button', { name: 'Add Tent, tunnel 4p' }),
    ).toBeNull()
    // Against the CSS-module identity map (S7 review F9) — not `toHaveStyle`,
    // which passes unconditionally under this project's `css: false`.
    expect(row).toHaveClass(styles['muted']!)
  })

  it('does not mute a row that is not on the list', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    renderPicker(store)

    expect(screen.getByTestId('depot-picker-row')).not.toHaveClass(
      styles['muted']!,
    )
  })

  it('offers + ADD for a Gear not on the list', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    renderPicker(store)

    expect(
      screen.getByRole('button', { name: 'Add Tent, tunnel 4p' }),
    ).toHaveTextContent('+ ADD')
    expect(screen.queryByText('IN LIST ✓')).toBeNull()
  })

  it('adds without navigating away, and the row becomes IN LIST ✓', async () => {
    const user = userEvent.setup()
    const seed = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    renderPicker(seed.store)

    await user.click(
      screen.getByRole('button', { name: 'Add Tent, tunnel 4p' }),
    )

    expect(await seed.authored()).toEqual([
      {
        type: 'trip.entry_added',
        payload: {
          entry_id: expect.any(String),
          source: { from: 'depot', gear_id: 'tent' },
        },
      },
    ])
    // Still on the picker — no `<Route path="/trips/:id">` fallback page
    // rendered, and the row itself now reads the other marker.
    expect(
      screen.getByRole('heading', { name: 'Add from the depot' }),
    ).toBeVisible()
    expect(screen.getByTestId('depot-picker-row')).toHaveTextContent(
      'IN LIST ✓',
    )
  })

  it('shows no claim read on any row — no world chip, no status, home path only', async () => {
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      tripCreated(JURA, 'Jura'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(JURA, 'e-jura', { from: 'depot', gearId: 'tent' }),
    )
    renderPicker(store, { tripId: ALPS })

    const row = screen.getByTestId('depot-picker-row')
    // No `⌂`/world glyph, no `STILL OUT`, no other Trip's name — only this
    // Trip's own membership speaks here, via `+ ADD` (this Trip does not
    // list it, whatever Jura's claim says).
    expect(row).not.toHaveTextContent('STILL OUT')
    expect(row).not.toHaveTextContent('Jura')
    expect(row).not.toHaveTextContent('⌂')
    expect(row).toHaveTextContent('+ ADD')
  })
})

describe('the depot picker — empty and unmatched states', () => {
  it('renders Empty depot. when the household has no gear', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    renderPicker(store)

    expect(screen.getByText('Empty depot.')).toBeVisible()
    expect(screen.getByText('Add the first item.')).toBeVisible()
    expect(screen.getByRole('link', { name: '+ Add gear' })).toHaveAttribute(
      'href',
      '/add',
    )
    expect(screen.queryByTestId('depot-picker-row')).toBeNull()
  })

  it('renders No matches. when the search excludes everything', async () => {
    const user = userEvent.setup()
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    renderPicker(store)

    await user.type(
      screen.getByRole('searchbox', { name: 'Search the depot' }),
      'nonesuch',
    )

    expect(screen.getByText('No matches.')).toBeVisible()
    expect(screen.getByText('1 FILTER ACTIVE')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(screen.getByTestId('depot-picker-row')).toBeVisible()
    expect(
      screen.getByRole('searchbox', { name: 'Search the depot' }),
    ).toHaveValue('')
  })

  it('pluralises FILTERS ACTIVE past one', async () => {
    const user = userEvent.setup()
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    renderPicker(store)

    await user.type(
      screen.getByRole('searchbox', { name: 'Search the depot' }),
      'nonesuch',
    )
    await user.click(screen.getByRole('button', { name: '+ KIND' }))
    await user.click(screen.getByRole('button', { name: /Single/ }))

    expect(screen.getByText('2 FILTERS ACTIVE')).toBeVisible()
  })
})

describe('the depot picker — narrowing', () => {
  // The pane half of this claim is the anatomy suite's own
  // "renders the pane variant" test above — S7 review F9 caught this test's
  // old name promising both halves while its body only ever asserted this
  // one.
  it('offers the + TRIP chip to narrow by, in the screen variant', async () => {
    const { store } = await seededStore(tripCreated(ALPS, 'Vosges — Oct'))
    renderPicker(store, { variant: 'screen' })
    expect(screen.getByRole('button', { name: '+ TRIP' })).toBeVisible()
  })

  it('narrows the rows by KIND through the value menu', async () => {
    const user = userEvent.setup()
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      gearRecorded('stake', {
        name: 'Tent stake',
        container: false,
        kind: 'counted',
      }),
    )
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ KIND' }))
    await user.click(screen.getByRole('button', { name: /Counted/ }))

    expect(rowNames()).toEqual(['Tent stake'])
    expect(
      screen.getByRole('button', { name: 'Remove KIND: Counted' }),
    ).toBeVisible()
  })

  it('narrows the rows by TAG through the tag picker', async () => {
    const user = userEvent.setup()
    const { store } = await seededStore(
      tripCreated(ALPS, 'Vosges — Oct'),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    // No tag applied yet — the tag picker's own vocabulary is empty, and
    // opening it must not throw.
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ TAG' }))
    expect(screen.getByRole('dialog', { name: 'Tags' })).toBeVisible()
  })
})

describe('the depot picker — an unknown Trip', () => {
  // S7 review F2: without this guard a `+ ADD` against a `tripId` this
  // replica has not folded a `trip.created` for would author a
  // `trip.entry_added` that materialises a permanent, nameless Trip — a
  // consequence worth pinning as its own suite, `Trip.tsx`'s and
  // `GearDetail.tsx`'s own `No such trip.` guards' precedent.
  it('renders No such trip. rather than the picker, and offers nothing to add', async () => {
    const { store } = await seededStore()
    renderPicker(store, { tripId: JURA })

    expect(screen.getByText('No such trip.')).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Add from the depot' }),
    ).toBeNull()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull()
  })

  it('draws the same guard in the pane variant', async () => {
    const { store } = await seededStore()
    renderPicker(store, { tripId: JURA, variant: 'pane' })

    expect(screen.getByText('No such trip.')).toBeVisible()
    expect(screen.queryByText('FROM THE DEPOT')).toBeNull()
  })
})
