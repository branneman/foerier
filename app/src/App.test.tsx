import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

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

  it('says the work is safe when the token has expired', async () => {
    // A 401 freezes the engine and keeps every queued op. The header says so
    // in one quiet line — no banner, no lock, no prompt (story 26).
    const server = createFakeServer()
    server.queueError('pull', { status: 401, code: 'unauthorized' })

    renderAt('/', { server })

    expect(
      await screen.findByText('SIGNED OUT · SAVED ON DEVICE'),
    ).toBeVisible()
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
