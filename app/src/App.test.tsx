import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import type { OpEnvelope } from '@foerier/shared'

import { App } from './App'
import { createAuthApi } from './auth/api'
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
 * FIND` none. Only the Depot count exists today — Trips arrive at S6, and
 * Find never carries one.
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
    expect(within(nav).getByRole('link', { name: /Depot/ })).toHaveTextContent(
      '2',
    )
  })

  it('gives Trips no count, because there are no trips yet', async () => {
    setViewport(SPLIT, DESKTOP)
    renderAt('/', { log: await aDepotOf(['Zeltbahn']) })

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    // A zero nobody asked about would be worse than nothing: S6 brings the
    // count with the feature.
    expect(
      within(nav).getByRole('link', { name: /Trips/ }),
    ).not.toHaveTextContent(/\d/)
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
