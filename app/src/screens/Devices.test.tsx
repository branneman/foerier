import {
  createHlcClock,
  type Clock,
  type IdSource,
  type OpAuthor,
} from '@foerier/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { createAuthApi, type DeviceRow } from '../auth/api'
import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { Devices } from './Devices'

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createDepotStore` — exactly as `Account.test.tsx` does. The one
 * hand override is `unsyncedCount` itself: the count this screen reads is a
 * fact about the outbox and the dead-letter set together
 * (`depot/store.ts`'s own `unsyncedCount`), and this suite is about what the
 * screen *does* with that number, not about re-proving the outbox math —
 * that belongs to `store.test.ts`.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const TOKEN = 'foe_test_token'

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

async function aStore(
  unsyncedCount: number,
): Promise<StoreApi<DepotStoreState>> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  await store.getState().drained()
  // The one hand override — see the file-level doc comment.
  store.setState({ unsyncedCount: () => Promise.resolve(unsyncedCount) })
  return store
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function noContent(): Response {
  return new Response(null, { status: 204 })
}

interface Handler {
  method: string
  path: string
  /** A `Promise` here is a request held open on purpose — the remote
   * confirm's in-flight tests resolve or reject it by hand. */
  respond: () => Response | Promise<Response>
}

/** A fetch stub keyed on method + path suffix, standing in for the real HTTP
 * transport (`docs/testing.md`: an in-memory fake, never a mocking
 * framework). */
function fetchFrom(handlers: readonly Handler[]): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const handler = handlers.find(
      (candidate) =>
        candidate.method === method && url.endsWith(candidate.path),
    )
    if (handler === undefined) {
      throw new Error(`unmocked request: ${method} ${url}`)
    }
    return Promise.resolve(handler.respond())
  }
}

function aDevice(overrides: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: anId(),
    label: 'Firefox on Android',
    created_at: '2026-03-02T10:00:00.000Z',
    last_seen_at: '2026-08-19T12:32:00.000Z',
    current: false,
    enrolled_passkey_here: true,
    ...overrides,
  }
}

function threeDevices(): DeviceRow[] {
  return [
    aDevice({ label: 'Firefox on Android', current: true }),
    aDevice({ label: 'Edge on Windows' }),
    aDevice({ label: 'Safari on iPad' }),
  ]
}

async function renderDevices(
  options: {
    devices?: DeviceRow[]
    unsyncedCount?: number
    signOutFails?: boolean
    clearLocalData?: (onBlocked: () => void) => Promise<void>
    path?: string
    /** Stands in for every `DELETE /auth/devices/:id` — the remote
     * confirm's in-flight tests hand over a promise they settle by hand. */
    revokeResponds?: () => Promise<Response>
  } = {},
) {
  const {
    devices = [aDevice({ current: true, enrolled_passkey_here: false })],
    unsyncedCount = 0,
    signOutFails = false,
    clearLocalData,
    path = '/account/devices',
    revokeResponds,
  } = options

  const store = await aStore(unsyncedCount)
  const revoked = new Set<string>()

  const api = createAuthApi(
    fetchFrom([
      {
        method: 'GET',
        path: '/auth/devices',
        respond: () =>
          jsonResponse({
            devices: devices.filter((device) => !revoked.has(device.id)),
          }),
      },
      {
        method: 'POST',
        path: '/auth/signout',
        respond: () => {
          if (signOutFails) throw new Error('offline')
          return noContent()
        },
      },
      ...devices.map((device) => ({
        method: 'DELETE',
        path: `/auth/devices/${device.id}`,
        respond: () => {
          if (revokeResponds !== undefined) return revokeResponds()
          revoked.add(device.id)
          return noContent()
        },
      })),
    ]),
  )

  const onSignedOut = vi.fn()
  const location = memoryLocation({ path, record: true })

  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <Switch>
        <Route path="/account/devices">
          <DepotProvider value={store}>
            <Devices
              api={api}
              token={TOKEN}
              onSignedOut={onSignedOut}
              {...(clearLocalData === undefined ? {} : { clearLocalData })}
            />
          </DepotProvider>
        </Route>
        <Route path="/signin">
          <p>Sign-in screen</p>
        </Route>
      </Switch>
    </Router>,
  )

  return { store, onSignedOut, location }
}

describe('Devices', () => {
  // `final-review.md` finding 2: `devices` initialises to `[]`, so a fetch
  // that fails — offline, the ordinary case in this app — used to read as a
  // confident, wrong "0 signed in with this login."
  it('says devices could not be loaded, rather than 0 signed in, when the fetch fails', async () => {
    const api = createAuthApi(() => Promise.reject(new Error('offline')))
    const store = await aStore(0)
    const location = memoryLocation({ path: '/account/devices' })

    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <DepotProvider value={store}>
          <Devices api={api} token={TOKEN} onSignedOut={vi.fn()} />
        </DepotProvider>
      </Router>,
    )

    expect(
      await screen.findByText(
        'Devices could not be loaded. Check your connection.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/signed in with this login/)).toBeNull()
  })

  it('lists every signed-in Device with a coarse label and a meta line', async () => {
    await renderDevices({ devices: threeDevices() })

    expect(await screen.findByText('Firefox on Android')).toBeInTheDocument()
    expect(screen.getByText('Edge on Windows')).toBeInTheDocument()
    expect(screen.getByText('Safari on iPad')).toBeInTheDocument()
    // Both non-current fixtures share `aDevice`'s default `last_seen_at`.
    expect(screen.getAllByText('LAST SEEN 2026-08-19 14:32')).toHaveLength(2)
  })

  it('marks the current device and never lists an IP', async () => {
    await renderDevices({ devices: threeDevices() })

    expect(await screen.findByText('THIS DEVICE')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
  })

  it('states a passkey-less current Device as a plain fact, not a warning', async () => {
    await renderDevices({
      devices: [aDevice({ current: true, enrolled_passkey_here: false })],
    })

    expect(
      await screen.findByText('SIGNED IN 2026-03-02 · NO PASSKEY HERE'),
    ).toBeInTheDocument()
  })

  it('omits the unsynced line entirely when nothing is unsynced', async () => {
    await renderDevices({ unsyncedCount: 0 })
    await userEvent.click(
      await screen.findByRole('button', { name: /Sign out/ }),
    )
    expect(screen.queryByText(/not yet synced/)).toBeNull()
    expect(screen.queryByText('▲')).toBeNull()
  })

  it('states the exact count when there is unsynced work', async () => {
    await renderDevices({ unsyncedCount: 4 })
    await userEvent.click(
      await screen.findByRole('button', { name: /Sign out/ }),
    )
    expect(
      await screen.findByText(
        '▲ 4 changes not yet synced. Signing out clears them.',
      ),
    ).toBeInTheDocument()
  })

  it('clears local data even when the server cannot be reached', async () => {
    const clearLocalData = vi.fn().mockResolvedValue(undefined)
    await renderDevices({
      unsyncedCount: 0,
      signOutFails: true,
      clearLocalData,
    })

    await userEvent.click(
      await screen.findByRole('button', { name: /Sign out/ }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out and clear' }),
    )

    // The app works offline everywhere else; a sign-out that failed for want
    // of signal would be the one place auth blocks a local action. The token
    // dies with the database, so the orphaned server row is inert.
    expect(clearLocalData).toHaveBeenCalledTimes(1)
  })

  it('ends the session and returns to sign-in once local data is cleared', async () => {
    const clearLocalData = vi.fn().mockResolvedValue(undefined)
    const { onSignedOut } = await renderDevices({ clearLocalData })

    await userEvent.click(
      await screen.findByRole('button', { name: /Sign out/ }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out and clear' }),
    )

    expect(await screen.findByText('Sign-in screen')).toBeInTheDocument()
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })

  it('surfaces a blocked delete — a second tab holding the database open — and finishes once it releases', async () => {
    // `clearLocalData`'s real implementation (`depot/wiring.ts`) never
    // resolves this call until `deleteDB` genuinely completes, however long
    // a second tab makes it wait — `onBlocked` only ever *reports*. This
    // fake holds the promise open the same way, so the covering assertion
    // below is against the actual blocked state rather than a mock that
    // resolves instantly no matter what it was told (fix round 1).
    let release: () => void = () => {
      throw new Error('release called before it was assigned')
    }
    const blockedGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const clearLocalData = vi.fn(async (onBlocked: () => void) => {
      onBlocked()
      await blockedGate
    })
    const { onSignedOut } = await renderDevices({ clearLocalData })

    await userEvent.click(
      await screen.findByRole('button', { name: /Sign out/ }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out and clear' }),
    )

    expect(
      await screen.findByText(
        '▲ Another tab has this open. Close it to finish signing out.',
      ),
    ).toBeInTheDocument()
    // Nothing gave up and nothing pretended the data was gone: the sheet is
    // still this Device's own confirm, still up, and the session has not
    // ended.
    expect(
      screen.getByRole('alertdialog', { name: 'Sign out this device?' }),
    ).toBeInTheDocument()
    expect(onSignedOut).not.toHaveBeenCalled()

    // The other tab closes; the delete that was genuinely blocked resolves
    // for real, and sign-out finishes exactly like the happy path.
    release()

    expect(await screen.findByText('Sign-in screen')).toBeInTheDocument()
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })

  // `final-review.md` finding 4: `confirmThisDevice` had no `catch`. A
  // rejecting `clearLocalData` used to close the sheet anyway, in the
  // `finally`, with `stopSync()` already called and nothing on screen to say
  // what happened — worse than the action having done nothing, and silent.
  it('says sign-out did not finish, and keeps the sheet open, when clearing local data fails', async () => {
    const clearLocalData = vi.fn().mockRejectedValue(new Error('IDB error'))
    const { onSignedOut } = await renderDevices({ clearLocalData })

    await userEvent.click(
      await screen.findByRole('button', { name: /Sign out/ }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out and clear' }),
    )

    expect(
      await screen.findByText(
        '▲ Sign-out did not finish. Sync is stopped on this device — try again.',
      ),
    ).toBeInTheDocument()
    // Not closed over the failure: still this Device's own confirm sheet,
    // still up, and the session has not ended.
    expect(
      screen.getByRole('alertdialog', { name: 'Sign out this device?' }),
    ).toBeInTheDocument()
    expect(onSignedOut).not.toHaveBeenCalled()
  })

  it('lets sign-out be retried after it failed', async () => {
    const clearLocalData = vi
      .fn()
      .mockRejectedValueOnce(new Error('IDB error'))
      .mockResolvedValueOnce(undefined)
    const { onSignedOut } = await renderDevices({ clearLocalData })

    await userEvent.click(
      await screen.findByRole('button', { name: /Sign out/ }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out and clear' }),
    )
    await screen.findByText(/Sign-out did not finish/)

    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out and clear' }),
    )

    expect(await screen.findByText('Sign-in screen')).toBeInTheDocument()
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })

  it('cancelling this-device sign-out clears nothing', async () => {
    const clearLocalData = vi.fn().mockResolvedValue(undefined)
    await renderDevices({ clearLocalData })

    await userEvent.click(
      await screen.findByRole('button', { name: /Sign out/ }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(clearLocalData).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('alertdialog', { name: 'Sign out this device?' }),
    ).toBeNull()
  })

  it('the remote confirm sheet carries no ▲ — revoking a Device destroys nothing', async () => {
    await renderDevices({ devices: threeDevices() })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Sign out Edge on Windows' }),
    )
    const sheet = screen.getByRole('alertdialog', {
      name: 'Sign out Edge on Windows?',
    })
    expect(sheet).toBeInTheDocument()
    expect(screen.queryByText('▲')).toBeNull()
    expect(screen.queryByText(/not yet synced/)).toBeNull()
  })

  it('revoking a remote Device drops it from the list', async () => {
    await renderDevices({ devices: threeDevices() })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Sign out Edge on Windows' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out device' }),
    )

    expect(await screen.findByText('Firefox on Android')).toBeInTheDocument()
    expect(screen.queryByText('Edge on Windows')).toBeNull()
  })

  it('cancelling a remote confirm revokes nothing', async () => {
    await renderDevices({ devices: threeDevices() })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Sign out Edge on Windows' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Edge on Windows')).toBeInTheDocument()
  })

  /**
   * `Confirm.tsx`'s own rule: `Confirm.Action` closes on click, which is
   * right for a decision that is over the moment it is taken and wrong for
   * one that is not. The remote confirm used to close before the request
   * resolved, so `busy` was never visible and a failed revoke was reported
   * to nobody — the sheet closed and the Device kept its access.
   */
  it('keeps the remote confirm up and disabled while the revoke is in flight, then closes it', async () => {
    let release: (response: Response) => void = () => {
      throw new Error('release called before it was assigned')
    }
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    await renderDevices({
      devices: threeDevices(),
      revokeResponds: () => gate,
    })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Sign out Edge on Windows' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out device' }),
    )

    const sheet = screen.getByRole('alertdialog', {
      name: 'Sign out Edge on Windows?',
    })
    expect(sheet).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sign out device' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    release(noContent())

    await waitFor(() =>
      expect(
        screen.queryByRole('alertdialog', {
          name: 'Sign out Edge on Windows?',
        }),
      ).toBeNull(),
    )
    expect(screen.queryByText('Edge on Windows')).toBeNull()
  })

  it('keeps the remote confirm up and says so when the revoke fails, and Cancel still closes it', async () => {
    await renderDevices({
      devices: threeDevices(),
      revokeResponds: () => Promise.reject(new Error('offline')),
    })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Sign out Edge on Windows' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out device' }),
    )

    expect(
      await screen.findByText(
        'Edge on Windows could not be signed out. Check your connection.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('alertdialog', { name: 'Sign out Edge on Windows?' }),
    ).toBeInTheDocument()
    // Nothing is discarded by a failed revoke, so the line carries no ▲
    // (boards §12) — and the Device is still listed, because it still has
    // access.
    expect(screen.queryByText(/▲/)).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Sign out device' }),
    ).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.queryByRole('alertdialog', { name: 'Sign out Edge on Windows?' }),
    ).toBeNull()
    expect(screen.getByText('Edge on Windows')).toBeInTheDocument()
  })

  it('opens a fresh remote confirm without a failure left over from the last one', async () => {
    await renderDevices({
      devices: threeDevices(),
      revokeResponds: () => Promise.reject(new Error('offline')),
    })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Sign out Edge on Windows' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out device' }),
    )
    expect(
      await screen.findByText(/could not be signed out/),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out Safari on iPad' }),
    )
    expect(
      screen.getByRole('alertdialog', { name: 'Sign out Safari on iPad?' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/could not be signed out/)).toBeNull()
  })

  it("opens this Device's own confirm sheet straight from a `?signout` link", async () => {
    await renderDevices({
      devices: [aDevice({ current: true })],
      unsyncedCount: 2,
      path: '/account/devices?signout',
    })

    expect(
      await screen.findByRole('alertdialog', { name: 'Sign out this device?' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(
        '▲ 2 changes not yet synced. Signing out clears them.',
      ),
    ).toBeInTheDocument()
  })

  it('gives SIGN OUT a class distinct from a filled button — the RETIRE rule', async () => {
    await renderDevices({ devices: threeDevices() })

    const signOut = await screen.findByRole('button', {
      name: 'Sign out this device',
    })
    expect(signOut.className).not.toBe('')
  })
})

describe('Devices — the band above the title', () => {
  /**
   * `useScreenHeader`'s rule on a screen that answers `splitPane: false`.
   * Two widths, because two are all this screen has: `App.tsx` redirects
   * `/account/devices` to `/account` at Desktop, where the same rows unfold
   * into that screen's own card instead.
   *
   * Half the fact, as always without the shell: an absence here says this
   * screen withheld a line, not that nothing else drew one.
   * `shell/screenBand.test.tsx` counts the composed page.
   */
  it('draws the back link and no sync line below Split', async () => {
    await renderDevices()
    await screen.findByRole('heading', { name: 'Devices' })

    // `AppShell`'s own header band already states it, in words, at this width.
    expect(screen.getByRole('link', { name: '‹ ACCOUNT' })).toBeVisible()
    expect(screen.queryByText('SYNCED')).toBeNull()
  })

  it('draws both at Split, where the rail has neither a label nor a word', async () => {
    setViewport(SPLIT)
    await renderDevices()
    await screen.findByRole('heading', { name: 'Devices' })

    expect(screen.getByRole('link', { name: '‹ ACCOUNT' })).toBeVisible()
    expect(screen.getByText('SYNCED')).toBeVisible()
  })
})
