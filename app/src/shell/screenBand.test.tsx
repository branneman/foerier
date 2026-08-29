import {
  createHlcClock,
  gearRecorded,
  tripCreated,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { createAuthApi } from '../auth/api'
import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { AddGear } from '../screens/AddGear'
import { Devices } from '../screens/Devices'
import { GearDetail } from '../screens/GearDetail'
import { NewTrip } from '../screens/NewTrip'
import { People } from '../screens/People'
import { Trip } from '../screens/Trip'
import { setViewport } from '../testSetup'
import { AppShell } from './AppShell'
import { DESKTOP, SPLIT } from './useMediaQuery'

/**
 * **The shell and the screen, composed — because the double print is only
 * visible when both are on the page.**
 *
 * Every other suite renders a pushed screen *without* `AppShell`, so an
 * absence assertion there proves one side of a two-sided fact: the screen
 * withheld its line, and nothing at all about whether the shell drew one. The
 * whole-branch review found the two defects that gap hid — a phone printing
 * `SYNCED` twice, and a Split pane printing it not at all — so the assertion
 * that would have caught them is a **count over the composed page**.
 *
 * The rule being counted, from `AppShell` itself:
 *
 * | Mode | `AppShell`'s marker | So the screen draws |
 * | --- | --- | --- |
 * | below Split (`tabs`) | header band, **`● SYNCED` in words** | no sync line |
 * | Split (`rail`) | a bare 6px dot, text only in `aria-label` | **its own sync line** |
 * | Desktop (`sidebar`) | the sidebar's line, **in words** | no sync line |
 *
 * Both Split board frames agree: `Depot split` (900) draws `● SYNCED` in the
 * detail pane's own band, and `Add gear — split 900` draws it in the pane
 * while the rail beside it carries a bare dot.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const TOKEN = 'foe_test_token'
const PERSON = 'mark'

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

/** `status: 'idle'` is what makes both labels read `SYNCED` — the whole point
 * of the count is that the shell's word and the screen's word are the same
 * word, which is why a duplicate is invisible to a per-screen suite. */
const idleEngine: EngineFactory = () => ({
  start() {},
  stop() {},
  flush: () => Promise.resolve(),
  pull: () => Promise.resolve(),
  status: () => 'idle',
  bootstrap: () => null,
})

async function seededStore(
  specs: readonly OpSpec[] = [],
): Promise<StoreApi<DepotStoreState>> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: idleEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return store
}

/**
 * `People` and `Devices` fetch their login half on mount, and this suite is
 * about the band above it — so every list answers empty. An unmocked request
 * throws rather than resolving to something invented, exactly as the two
 * per-screen suites' own stubs do.
 */
const authApi = createAuthApi((input: RequestInfo | URL) => {
  const url = String(input)
  if (url.endsWith('/auth/logins')) {
    return Promise.resolve(new Response(JSON.stringify({ logins: [] })))
  }
  if (url.endsWith('/auth/invites')) {
    return Promise.resolve(new Response(JSON.stringify({ invites: [] })))
  }
  if (url.endsWith('/auth/devices')) {
    return Promise.resolve(new Response(JSON.stringify({ devices: [] })))
  }
  throw new Error(`unmocked request: ${url}`)
})

/**
 * The whole page: the shell, and the screen the route pushes inside it.
 *
 * The routes mirror `App.tsx`'s, with one deliberate omission: `App.tsx`
 * wraps `/account/people` and `/account/devices` in a `Redirect to="/account"`
 * at Desktop, so neither screen is ever mounted at that width. Mounting them
 * here anyway would be a fixture describing an app that does not exist.
 */
function renderInShell(store: StoreApi<DepotStoreState>, path: string) {
  const location = memoryLocation({ path, record: true })
  render(
    <Router hook={location.hook}>
      <AppShell syncLine="SYNCED" syncTone="reachable">
        <DepotProvider value={store}>
          <Switch>
            <Route path="/add">
              <AddGear />
            </Route>
            <Route path="/gear/:id">
              <GearDetail />
            </Route>
            <Route path="/trips/new">
              <NewTrip />
            </Route>
            <Route path="/trips/:id">
              <Trip />
            </Route>
            <Route path="/account/people">
              <People api={authApi} token={TOKEN} personId={PERSON} />
            </Route>
            <Route path="/account/devices">
              <Devices api={authApi} token={TOKEN} onSignedOut={() => {}} />
            </Route>
          </Switch>
        </DepotProvider>
      </AppShell>
    </Router>,
  )
}

/** Every element whose own text is exactly `SYNCED`, anywhere on the page. */
function syncLines(): readonly HTMLElement[] {
  return screen.queryAllByText('SYNCED')
}

async function aGear(): Promise<{
  store: StoreApi<DepotStoreState>
  id: string
}> {
  const id = anId()
  const store = await seededStore([
    gearRecorded(id, { name: 'Tent', container: false, kind: 'single' }),
  ])
  return { store, id }
}

async function aTrip(): Promise<{
  store: StoreApi<DepotStoreState>
  id: string
}> {
  const id = anId()
  const store = await seededStore([tripCreated(id, 'Alps 2026')])
  return { store, id }
}

describe('the shell and a pushed screen, composed — one sync line, at every width', () => {
  it('states SYNCED once on a phone, in the shell header', async () => {
    const { store, id } = await aTrip()
    renderInShell(store, `/trips/${id}`)

    const lines = syncLines()
    expect(lines).toHaveLength(1)
    const [line] = lines
    expect(line).toBeVisible()
    // The shell's, not the screen's: below Split `AppShell` draws the header
    // band itself, so a screen drawing one too says it twice on the primary
    // device.
    expect(screen.getByRole('main')).not.toContainElement(line ?? null)
  })

  it('states SYNCED once at Split, in the screen — the rail carries only a dot', async () => {
    setViewport(SPLIT)
    const { store, id } = await aTrip()
    renderInShell(store, `/trips/${id}`)

    const lines = syncLines()
    expect(lines).toHaveLength(1)
    const [line] = lines
    expect(line).toBeVisible()
    // The 56px rail's marker is a bare dot whose words exist only as an
    // `aria-label`, so the pane's own band is the only place the state is
    // legible — which is what both Split board frames draw.
    expect(screen.getByRole('main')).toContainElement(line ?? null)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    expect(within(nav).queryByText('SYNCED')).toBeNull()
    expect(within(nav).getByRole('img', { name: 'SYNCED' })).toBeInTheDocument()
  })

  it('states SYNCED once at Desktop, in the sidebar', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store, id } = await aTrip()
    renderInShell(store, `/trips/${id}`)

    const lines = syncLines()
    expect(lines).toHaveLength(1)
    const [line] = lines
    expect(line).toBeVisible()
    expect(screen.getByRole('main')).not.toContainElement(line ?? null)
  })

  it('holds for the detail pane of a split view below Split, where it has no pane', async () => {
    const { store, id } = await aGear()

    renderInShell(store, `/gear/${id}`)
    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).not.toContainElement(
      syncLines()[0] ?? null,
    )
  })

  it('holds for the detail pane at Split, where the pane draws it', async () => {
    setViewport(SPLIT)
    const { store, id } = await aGear()

    renderInShell(store, `/gear/${id}`)
    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(syncLines()[0] ?? null)
  })

  it('holds for the detail pane at Desktop', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store, id } = await aGear()

    renderInShell(store, `/gear/${id}`)
    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).not.toContainElement(
      syncLines()[0] ?? null,
    )
  })

  it('holds for the screen with no list behind it at all', async () => {
    setViewport(SPLIT)
    const store = await seededStore()
    renderInShell(store, '/trips/new')

    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(syncLines()[0] ?? null)
  })

  /* Add gear is the one screen here reachable at **every** width —
     `<Route path="/add">` carries no width guard — so all three modes are
     counted for it. */

  it('holds for Add gear on a phone, the width it is used at most', async () => {
    const store = await seededStore()
    renderInShell(store, '/add')

    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).not.toContainElement(
      syncLines()[0] ?? null,
    )
  })

  it('holds for Add gear at Split, where it stands alone rather than in a pane', async () => {
    setViewport(SPLIT)
    const store = await seededStore()
    renderInShell(store, '/add')

    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(syncLines()[0] ?? null)
  })

  it('holds for Add gear at Desktop, where the sidebar states it', async () => {
    setViewport(SPLIT, DESKTOP)
    const store = await seededStore()
    renderInShell(store, '/add')

    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).not.toContainElement(
      syncLines()[0] ?? null,
    )
  })

  /* People and Devices are counted at the two widths `App.tsx` mounts them
     at. At Desktop it redirects both to `/account`, so there is no composed
     page to count — `renderInShell`'s own comment says why the route is not
     stood up here regardless. */

  it('holds for People on a phone', async () => {
    const store = await seededStore()
    renderInShell(store, '/account/people')
    await screen.findByRole('heading', { name: 'People & logins' })

    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).not.toContainElement(
      syncLines()[0] ?? null,
    )
  })

  it('holds for People at Split', async () => {
    setViewport(SPLIT)
    const store = await seededStore()
    renderInShell(store, '/account/people')
    await screen.findByRole('heading', { name: 'People & logins' })

    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(syncLines()[0] ?? null)
  })

  it('holds for Devices on a phone', async () => {
    const store = await seededStore()
    renderInShell(store, '/account/devices')
    await screen.findByRole('heading', { name: 'Devices' })

    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).not.toContainElement(
      syncLines()[0] ?? null,
    )
  })

  it('holds for Devices at Split', async () => {
    setViewport(SPLIT)
    const store = await seededStore()
    renderInShell(store, '/account/devices')
    await screen.findByRole('heading', { name: 'Devices' })

    expect(syncLines()).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(syncLines()[0] ?? null)
  })
})

/**
 * **The back link, which turns on a different fact from the sync line** — not
 * on a width alone, but on whether the destination it points at is already on
 * the page. At Desktop the labelled sidebar is that destination for every
 * screen. At Split it depends: `GearDetail` is the detail half of `DepotView`
 * with the Depot list beside it, and `Depot split` draws no `‹` at all; a Trip
 * has no two-pane view anywhere in `App.tsx`, so at Split it stands alone and
 * the link is the only route back.
 */
describe('the back link — withheld only where its destination is already drawn', () => {
  it('draws it on a Trip at Split, which is nobody’s pane', async () => {
    setViewport(SPLIT)
    const { store, id } = await aTrip()
    renderInShell(store, `/trips/${id}`)

    expect(screen.getByRole('link', { name: '‹ TRIPS' })).toBeVisible()
  })

  it('withholds it from the detail pane at Split, where the list is beside it', async () => {
    setViewport(SPLIT)
    const { store, id } = await aGear()
    renderInShell(store, `/gear/${id}`)

    expect(screen.queryByRole('link', { name: '‹ DEPOT' })).toBeNull()
  })

  it('draws it on the detail pane below Split, where there is no pane', async () => {
    const { store, id } = await aGear()
    renderInShell(store, `/gear/${id}`)

    expect(screen.getByRole('link', { name: '‹ DEPOT' })).toBeVisible()
  })

  it('withholds it from the detail pane at Desktop, where the sidebar is the navigation', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store, id } = await aGear()
    renderInShell(store, `/gear/${id}`)

    expect(screen.queryByRole('link', { name: '‹ DEPOT' })).toBeNull()
  })

  it('withholds it from a Trip at Desktop, for the same reason', async () => {
    setViewport(SPLIT, DESKTOP)
    const { store, id } = await aTrip()
    renderInShell(store, `/trips/${id}`)

    expect(screen.queryByRole('link', { name: '‹ TRIPS' })).toBeNull()
  })

  it('draws it on Add gear at Split, which the app renders standalone', async () => {
    setViewport(SPLIT)
    const store = await seededStore()
    renderInShell(store, '/add')

    // The board draws `Add gear — split 900` as a pane with the Depot list
    // beside it, and that two-pane Add gear has never been built: `App.tsx`
    // routes `/add` to a screen of its own at every width, so `‹ DEPOT`
    // points at something not on the page.
    expect(screen.getByRole('link', { name: '‹ DEPOT' })).toBeVisible()
  })

  it('withholds it from Add gear at Desktop, where the sidebar names the Depot', async () => {
    setViewport(SPLIT, DESKTOP)
    const store = await seededStore()
    renderInShell(store, '/add')

    expect(screen.queryByRole('link', { name: '‹ DEPOT' })).toBeNull()
  })

  it('draws it on People at Split, the widest width it is mounted at', async () => {
    setViewport(SPLIT)
    const store = await seededStore()
    renderInShell(store, '/account/people')
    await screen.findByRole('heading', { name: 'People & logins' })

    expect(screen.getByRole('link', { name: '‹ ACCOUNT' })).toBeVisible()
  })

  it('draws it on Devices at Split, for the same reason', async () => {
    setViewport(SPLIT)
    const store = await seededStore()
    renderInShell(store, '/account/devices')
    await screen.findByRole('heading', { name: 'Devices' })

    expect(screen.getByRole('link', { name: '‹ ACCOUNT' })).toBeVisible()
  })
})
