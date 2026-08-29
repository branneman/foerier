import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import {
  authorOp,
  createHlcClock,
  emptyState,
  fold,
  tripCreated,
  tripPhaseMoved,
  type DepotState,
  type OpAuthor,
  type OpEnvelope,
  type OpSpec,
} from '@foerier/shared'

import { App } from './App'
import { createAuthApi } from './auth/api'
import { BUILD_SHA } from './build'
import type { DepotSnapshot } from './depot/store'
import {
  inMemoryPendingStore,
  type PendingFirstPerson,
  type PendingStore,
} from './auth/pendingFirstPerson'
import { inMemorySessionStore, type Session } from './auth/sessionStore'
import { inMemoryOpLog, type OpLog } from './depot/opLog'
import {
  createFakeServer,
  fakeTransport,
  type FakeServer,
} from './depot/transport'
import { createSessionDepot, type DepotFactory } from './depot/wiring'
import { DESKTOP, SPLIT } from './shell/useMediaQuery'
import { setViewport } from './testSetup'

const A_SESSION: Session = {
  token: 'foe_test',
  loginId: '0f0000a1-0000-4000-8000-0000000000a1',
  personId: '0f0000a2-0000-4000-8000-0000000000a2',
  householdId: '0f0000a3-0000-4000-8000-0000000000a3',
  deviceId: '0f0000a4-0000-4000-8000-0000000000a4',
}

/** A fetch that fails loudly, so an unexpected network call is a test failure. */
const noNetwork: typeof fetch = () => {
  throw new Error('the shell must not call the network')
}

/**
 * The whole app over real fakes: an in-memory op log and the in-memory server
 * behind `fakeTransport`. `App`'s default is the IndexedDB log and the HTTP
 * transport, which is Tier 5's business — here the point is that the same
 * wiring code runs, with its two ends replaced.
 */
function fakeDepot(server: FakeServer, log: OpLog) {
  const factory: DepotFactory = (session) =>
    createSessionDepot(session, { log, transport: fakeTransport(server) })
  return factory
}

interface RenderOptions {
  session?: Session | null
  server?: FakeServer
  log?: OpLog
  pending?: PendingStore
}

function renderAt(path: string, options: RenderOptions = {}) {
  const { hook } = memoryLocation({ path })
  const session = options.session === undefined ? A_SESSION : options.session
  const server = options.server ?? createFakeServer()
  const log = options.log ?? inMemoryOpLog()
  const pending = options.pending ?? inMemoryPendingStore()

  render(
    <Router hook={hook}>
      <App
        api={createAuthApi(noNetwork)}
        sessionStore={inMemorySessionStore(session)}
        pendingStore={pending}
        createDepot={fakeDepot(server, log)}
      />
    </Router>,
  )

  return { server, log, pending }
}

const TRIP_ONE = 'ffffffff-0000-7000-8000-000000000001'
const TRIP_TWO = 'ffffffff-0000-7000-8000-000000000002'

/**
 * An author for the Trip ops these tests seed, matching the session the app
 * runs under — an op carrying another household's id is one `/sync` would
 * reject, and a fixture that could not have been authored here proves nothing.
 */
function anAuthor(): OpAuthor {
  let next = 0
  return {
    household_id: A_SESSION.householdId,
    device_id: A_SESSION.deviceId,
    ids: {
      next: () =>
        `ffffffff-0000-7000-8000-1000000000${(next++).toString().padStart(2, '0')}`,
    },
    hlc: createHlcClock({ now: () => 1_700_000_000_000 }),
  }
}

/**
 * Ops in the log, the way `aDepotOf` puts gear there — through the real
 * builders and the real `authorOp`, so what the app folds is a state the
 * reducer could actually produce.
 *
 * **One author for the whole log**, because its HLC is what orders the ops
 * against each other: a second author restarts the counter, and a
 * `trip.phase_moved` stamped behind the `trip.created` that seeded `draft`
 * would simply lose the per-field LWW and leave the phase where it was.
 */
async function aLogOf(specs: readonly OpSpec[]): Promise<OpLog> {
  const log = inMemoryOpLog()
  const author = anAuthor()
  for (const spec of specs) {
    await log.append(authorOp(author, spec))
  }
  return log
}

function aLogOfTrips(
  trips: readonly { id: string; name: string }[],
): Promise<OpLog> {
  return aLogOf(trips.map(({ id, name }) => tripCreated(id, name)))
}

/**
 * Two Trips, one of them deleted — which no op can say at S6.
 *
 * `trip.deleted` is S14's: there is no builder and **no handler**, so an op of
 * that type folds as nothing at all and the Trip would simply not exist. The
 * register is therefore written onto a folded state, exactly as
 * `shared/src/selectors/trip.test.ts` writes it for its own `visibleTrips`
 * test. The app's seam for handing the store a state it did not fold is the
 * **snapshot** (`depot/store.ts`), keyed on `BUILD_SHA` and already driven
 * this way by `depot/store.test.ts`; `lsn: 0` over a log with no ops means
 * nothing folds forward on top of it.
 */
async function aLogOfTwoTripsOneDeleted(): Promise<OpLog> {
  const log = inMemoryOpLog()
  const author = anAuthor()
  const folded = fold(
    [
      authorOp(author, tripCreated(TRIP_ONE, 'Alps 2026')),
      authorOp(author, tripCreated(TRIP_TWO, 'Ardennes')),
    ],
    emptyState(),
  )
  const state: DepotState = {
    ...folded,
    trips: {
      ...folded.trips,
      [TRIP_TWO]: {
        ...folded.trips[TRIP_TWO]!,
        deleted: {
          value: true,
          hlc: '2026-08-25T10:00:09.000Z-0001',
          deviceId: A_SESSION.deviceId,
        },
      },
    },
  }
  const snapshot: DepotSnapshot = { sha: BUILD_SHA, lsn: 0, state }
  await log.writeMeta('snapshot', snapshot)
  return log
}

describe('the app shell', () => {
  it('offers exactly the three destinations', async () => {
    // Three, not four: Account is reached from the avatar rather than the tab
    // bar, so adding it here would be a design regression rather than a
    // feature (docs/design/README.md §11).
    renderAt('/')

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    const links = within(nav).getAllByRole('link')

    expect(links.map((l) => l.textContent)).toEqual(['Depot', 'Trips', 'Find'])
  })

  it('marks the current destination', async () => {
    renderAt('/trips')

    expect(await screen.findByRole('link', { name: 'Trips' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Depot' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('states an empty depot as a fact rather than a placeholder', async () => {
    renderAt('/')

    expect(
      await screen.findByRole('heading', { name: 'Depot' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument()
  })

  it('renders an unknown route without crashing the shell', async () => {
    renderAt('/nope')

    expect(
      await screen.findByRole('heading', { name: 'Not found.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  })

  it('never reaches the network just to render', async () => {
    // Reads are pure and in-memory; nothing async sits in a render path
    // (architecture-design.md §3). `noNetwork` throws if that is violated.
    renderAt('/')

    expect(await screen.findByRole('heading', { name: 'Depot' })).toBeVisible()
  })
})

describe('the sync line', () => {
  it('reads SYNCED once the engine has reached the household', async () => {
    renderAt('/')

    expect(await screen.findByText('SYNCED')).toBeVisible()
  })

  /**
   * "The sync line lives in the sidebar beneath ACCOUNT — never in the main
   * column at desktop" (SIDEBAR ANATOMY, `Screens A` §02, R3).
   */
  it('moves into the sidebar at desktop rather than sitting above the screen', async () => {
    setViewport(SPLIT, DESKTOP)
    renderAt('/')

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    expect(within(nav).getByText('SYNCED')).toBeVisible()
    expect(screen.getAllByText('SYNCED')).toHaveLength(1)
  })
})

/**
 * The desktop sidebar's counts (`Screens A` §02): `DEPOT 128 · TRIPS 3 ·
 * FIND` none. Both counts exist now that Trips do; `FIND` still carries
 * none, because it answers a question rather than holding a collection.
 */
describe('the desktop sidebar counts', () => {
  async function aDepotOf(names: readonly string[]): Promise<OpLog> {
    const log = inMemoryOpLog()
    for (const [index, name] of names.entries()) {
      await log.append({
        id: `eeeeeeee-0000-7000-8000-00000000010${index}`,
        household_id: A_SESSION.householdId,
        aggregate: 'gear',
        aggregate_id: `eeeeeeee-0000-7000-8000-00000000020${index}`,
        type: 'gear.recorded',
        hlc: `2026-08-25T10:00:0${index}.000Z-0001`,
        device_id: A_SESSION.deviceId,
        payload: { name, container: false, kind: 'single' },
      })
    }
    return log
  }

  it('counts the depot beside DEPOT', async () => {
    setViewport(SPLIT, DESKTOP)
    renderAt('/', { log: await aDepotOf(['Zeltbahn', 'Feldflasche']) })

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    expect(within(nav).getByRole('link', { name: 'Depot' })).toHaveTextContent(
      '2',
    )
  })

  it('counts the trips beside TRIPS', async () => {
    setViewport(SPLIT, DESKTOP)
    renderAt('/', {
      log: await aLogOfTrips([
        { id: TRIP_ONE, name: 'Alps 2026' },
        { id: TRIP_TWO, name: 'Ardennes' },
      ]),
    })

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    expect(within(nav).getByRole('link', { name: 'Trips' })).toHaveTextContent(
      '2',
    )
  })

  it('counts closed trips too — the count is the size of the list it opens', async () => {
    // Not the *active* Trips: the destination's count answers "how much is
    // behind this row", and the Trips screen lists `CLOSED` alongside the
    // rest. A count of the active ones would read `0` on a household with a
    // year of finished trips behind it.
    setViewport(SPLIT, DESKTOP)
    renderAt('/', {
      log: await aLogOf([
        tripCreated(TRIP_ONE, 'Alps 2026'),
        tripPhaseMoved(TRIP_ONE, 'closed'),
      ]),
    })

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    expect(within(nav).getByRole('link', { name: 'Trips' })).toHaveTextContent(
      '1',
    )
  })

  it('leaves a deleted Trip out of the count', async () => {
    // The count goes through `visibleTrips`, not `Object.keys(state.trips)`.
    // Nothing at S6 can author `trip.deleted`, but S14 will, and a sidebar
    // that kept counting a deleted Trip would disagree with the list the row
    // opens — see `aLogOfTwoTripsOneDeleted` for how the register is seeded.
    setViewport(SPLIT, DESKTOP)
    renderAt('/', { log: await aLogOfTwoTripsOneDeleted() })

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    expect(within(nav).getByRole('link', { name: 'Trips' })).toHaveTextContent(
      '1',
    )
  })
})

/**
 * The three routes S6 adds. `Trips.test.tsx`, `NewTrip.test.tsx` and
 * `Trip.test.tsx` each drive their own screen; what is only provable here is
 * that the shell reaches them at all, and in the right order.
 */
describe('the Trips routes', () => {
  it('opens the Trips list at /trips', async () => {
    renderAt('/trips')

    // The screen's own empty state reads `No trips.` — the same line the
    // placeholder it replaced drew — so the assertion is on something only
    // the real screen has: F3's `+ NEW`.
    expect(await screen.findByRole('link', { name: '+ NEW' })).toBeVisible()
  })

  it('opens New trip at /trips/new rather than reading `new` as a Trip id', async () => {
    // Route order in the `Switch` is the whole of this test. With `/trips/:id`
    // declared first, wouter matches it and `new` becomes an id no Trip has,
    // drawing `No such trip.` — so finding the heading alone would not prove
    // the order; the **absence** of the trip screen is what does.
    renderAt('/trips/new')

    expect(
      await screen.findByRole('heading', { name: 'New trip' }),
    ).toBeVisible()
    expect(screen.queryByText('No such trip.')).toBeNull()
  })

  it('opens a folded Trip at /trips/:id', async () => {
    renderAt(`/trips/${TRIP_ONE}`, {
      log: await aLogOfTrips([{ id: TRIP_ONE, name: 'Alps 2026' }]),
    })

    expect(
      await screen.findByRole('heading', { name: 'Alps 2026' }),
    ).toBeVisible()
  })
})

describe('when the device token has expired', () => {
  /** An op this device authored and never got a seq for — the outbox. */
  function anUnpushedOp(): OpEnvelope {
    return {
      id: 'eeeeeeee-0000-7000-8000-00000000000f',
      household_id: A_SESSION.householdId,
      aggregate: 'gear',
      aggregate_id: 'eeeeeeee-0000-7000-8000-0000000000f1',
      type: 'gear.recorded',
      hlc: '2026-08-25T10:00:00.000Z-0001',
      device_id: A_SESSION.deviceId,
      payload: { name: 'Zeltbahn', container: false, kind: 'single' },
    }
  }

  async function seeded(): Promise<OpLog> {
    const log = inMemoryOpLog()
    await log.append(anUnpushedOp())
    return log
  }

  it('routes to sign-in rather than freezing the depot forever', async () => {
    // The 401 contract (auth-design.md §7.2). Without this the engine freezes
    // and there is no way back: `/signin` redirects away while a session
    // exists, so the depot would sit signed-out until someone opened
    // devtools.
    const server = createFakeServer()
    server.queueError('push', { status: 401, code: 'unauthorized' })

    renderAt('/', { server, log: await seeded() })

    expect(
      await screen.findByRole('button', { name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull()
  })

  it('states how much work is waiting on the device', async () => {
    // The whole reassurance of that screen, and it has to be a real number:
    // a hardcoded 0 tells a Quartermaster nothing is pending when something
    // is (architecture-design.md §12.3).
    const server = createFakeServer()
    server.queueError('push', { status: 401, code: 'unauthorized' })

    renderAt('/', { server, log: await seeded() })

    expect(
      await screen.findByText(/1 changes saved here and not yet synced\./),
    ).toBeVisible()
  })

  it('keeps the outbox — a 401 never costs queued work', async () => {
    // Story 26. Signing out is the only thing that clears the local log, and
    // this is not that.
    const server = createFakeServer()
    server.queueError('push', { status: 401, code: 'unauthorized' })
    const log = await seeded()

    renderAt('/', { server, log })

    await screen.findByRole('button', { name: 'Sign in' })
    expect(await log.outbox(10)).toHaveLength(1)
  })
})

describe('the joiner waiting to be recorded', () => {
  const PENDING: PendingFirstPerson = {
    personId: A_SESSION.personId,
    householdId: A_SESSION.householdId,
    name: 'Els',
  }

  it("authors the household's first Person with the Invite's own id", async () => {
    // The Invite pre-bound this Person id and the Login already points at it,
    // so minting a fresh one here would leave that Login pointing at a Person
    // nobody ever created (auth-design.md §3.4).
    const pending = inMemoryPendingStore(PENDING)
    const { log } = renderAt('/', { pending })

    await screen.findByRole('heading', { name: 'Depot' })

    await waitFor(async () => {
      const records = await log.all()
      expect(records.map((record) => record.op.type)).toContain(
        'person.recorded',
      )
    })

    const [record] = await log.all()
    expect(record?.op.aggregate_id).toBe(A_SESSION.personId)
    expect(record?.op.payload).toEqual({ name: 'Els' })
    expect(await pending.read()).toBeNull()
  })

  it('writes nothing when there is no joiner waiting', async () => {
    const { log } = renderAt('/')

    await screen.findByRole('heading', { name: 'Depot' })
    await waitFor(() => {
      expect(screen.getByText('SYNCED')).toBeVisible()
    })

    expect(await log.all()).toEqual([])
  })
})

describe('when signed out', () => {
  it('shows nothing of the household', async () => {
    // Story 26: "Nothing about my Household is readable on a signed-out
    // Device."
    renderAt('/', { session: null })

    expect(
      await screen.findByRole('button', { name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Depot' })).toBeNull()
  })

  it('sends a signed-in device away from the sign-in screen', async () => {
    renderAt('/signin')

    expect(
      await screen.findByRole('navigation', { name: 'Sections' }),
    ).toBeVisible()
  })
})

describe('the Devices route', () => {
  // Task 10's brief: without this redirect, `Devices` would be unreachable
  // below Desktop *and* the pushed screen would be a second, competing copy
  // of the DEVICES card above it.
  it('is the pushed screen below Desktop', async () => {
    renderAt('/account/devices')

    expect(
      await screen.findByRole('heading', { name: 'Devices' }),
    ).toBeInTheDocument()
  })

  // Task 9's review caught this: without the redirect, Account's own
  // Desktop DEVICES card and this pushed screen would both exist at once,
  // and the footer `SIGN OUT` link Task 9 shipped would lead to a route
  // that immediately sends it right back — a dead end, not a redirect.
  it('redirects to Account at Desktop, where the same rows unfold inline', async () => {
    setViewport(DESKTOP)
    renderAt('/account/devices')

    expect(
      await screen.findByRole('heading', { name: 'Account' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Devices' })).toBeNull()
  })
})

describe('the device-link route', () => {
  // Task 9's report flagged `/account/device-link` reaching the shell's
  // catch-all as the entry point's one gap until this screen existed
  // (`docs/design/README.md` §14). `noNetwork` means the Invite itself
  // never loads here — `issueDeviceLink`'s own contract is `DeviceLink.
  // test.tsx`'s business — this is only proving `App` routes here at all,
  // at every width, rather than to "Not found.".
  it('is reachable rather than falling through to the shell catch-all', async () => {
    renderAt('/account/device-link')

    expect(
      await screen.findByRole('heading', { name: 'Sign in on another device' }),
    ).toBeInTheDocument()
  })

  it('stays reachable at Desktop, unlike the Devices route', async () => {
    setViewport(DESKTOP)
    renderAt('/account/device-link')

    expect(
      await screen.findByRole('heading', { name: 'Sign in on another device' }),
    ).toBeInTheDocument()
  })
})
