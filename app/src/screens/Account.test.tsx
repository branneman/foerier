import {
  createHlcClock,
  personRecorded,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { createAuthApi, type DeviceRow, type PasskeyRow } from '../auth/api'
import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { setViewport } from '../testSetup'
import { DESKTOP } from '../shell/useMediaQuery'
import { Account } from './Account'

/**
 * Every test seeds a **real** store, exactly as `GearDetail.test.tsx` and
 * `AddGear.test.tsx` do — never a hand-shaped `DepotState`.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const PERSON_ID = '0f0000aa-0000-4000-8000-0000000000aa'
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

async function seededStore(
  specs: readonly OpSpec[] = [],
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function noContent(): Response {
  return new Response(null, { status: 204 })
}

interface Handler {
  method: string
  path: string
  respond: () => Response
}

/** A fetch stub keyed on method + path suffix, standing in for the real
 * HTTP transport (`docs/testing.md`: an in-memory fake, never a mocking
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

function aPasskey(overrides: Partial<PasskeyRow> = {}): PasskeyRow {
  return {
    id: anId(),
    label: 'Pixel 9',
    created_at: '2026-03-02T10:00:00.000Z',
    last_used_at: '2026-07-14T10:00:00.000Z',
    ...overrides,
  }
}

function aDevice(overrides: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: anId(),
    label: 'Firefox on Android',
    created_at: '2026-03-02T10:00:00.000Z',
    last_seen_at: '2026-08-19T14:32:00.000Z',
    current: false,
    enrolled_passkey_here: false,
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

function stubPlatformAuthenticator(available: boolean | undefined): void {
  if (available === undefined) {
    Reflect.deleteProperty(window, 'PublicKeyCredential')
    return
  }
  Object.defineProperty(window, 'PublicKeyCredential', {
    value: {
      isUserVerifyingPlatformAuthenticatorAvailable: () =>
        Promise.resolve(available),
    },
    configurable: true,
  })
}

afterEach(() => {
  Reflect.deleteProperty(window, 'PublicKeyCredential')
})

async function renderAccount(
  options: {
    personName?: string | null
    householdName?: string
    passkeys?: PasskeyRow[]
    devices?: DeviceRow[]
    platformAuthenticator?: boolean
    desktop?: boolean
    signOutFails?: boolean
    clearLocalData?: () => Promise<void>
    /** Fails `GET /auth/passkeys` — `final-review.md` finding 2: a failed
     * fetch must not read as "None on this login." */
    passkeysFail?: boolean
    /** Fails `GET /auth/devices` — same finding, for the DEVICES card. */
    devicesFail?: boolean
    /** `GET /auth/logins`, read here only for the count the PEOPLE & LOGINS
     * summary carries — `People.test.tsx` owns the row-by-row states. */
    loginCount?: number
    /** Fails `GET /auth/logins` — same finding as `passkeysFail`/
     * `devicesFail`: a failed fetch must not read as "0 signed in." */
    loginsFail?: boolean
  } = {},
) {
  const {
    personName = null,
    householdName = 'Veldkamp',
    passkeys = [],
    devices = [],
    platformAuthenticator,
    desktop = false,
    signOutFails = false,
    clearLocalData,
    passkeysFail = false,
    devicesFail = false,
    loginCount = 0,
    loginsFail = false,
  } = options

  stubPlatformAuthenticator(platformAuthenticator)
  if (desktop) setViewport(DESKTOP)

  const specs: OpSpec[] =
    personName === null ? [] : [personRecorded(PERSON_ID, personName)]
  const store = await seededStore(specs)

  const removedPasskeys = new Set<string>()
  const revokedDevices = new Set<string>()
  // Fix round 1: pins that Desktop issues no `GET /auth/logins` of its
  // own — the phone summary row's dedicated fetch is dead there, since
  // `<People variant="inline">` fetches the same list itself. A counter on
  // the existing handler rather than new request-logging machinery.
  let loginsRequests = 0

  const api = createAuthApi(
    fetchFrom([
      {
        method: 'GET',
        path: '/auth/me',
        respond: () =>
          jsonResponse({
            login_id: anId(),
            person_id: PERSON_ID,
            household_id: HOUSEHOLD,
            household_name: householdName,
            device_id: DEVICE,
          }),
      },
      {
        method: 'GET',
        path: '/auth/passkeys',
        respond: () => {
          if (passkeysFail) throw new Error('offline')
          return jsonResponse({
            passkeys: passkeys.filter(
              (passkey) => !removedPasskeys.has(passkey.id),
            ),
          })
        },
      },
      {
        method: 'GET',
        path: '/auth/devices',
        respond: () => {
          if (devicesFail) throw new Error('offline')
          return jsonResponse({
            devices: devices.filter((device) => !revokedDevices.has(device.id)),
          })
        },
      },
      {
        method: 'GET',
        path: '/auth/logins',
        respond: () => {
          loginsRequests += 1
          if (loginsFail) throw new Error('offline')
          return jsonResponse({
            logins: Array.from({ length: loginCount }, (_, index) => ({
              id: `login-${index}`,
              person_id: PERSON_ID,
              device_count: 1,
              last_seen_at: null,
            })),
          })
        },
      },
      {
        method: 'GET',
        path: '/auth/invites',
        respond: () => jsonResponse({ invites: [] }),
      },
      {
        method: 'POST',
        path: '/auth/signout',
        respond: () => {
          if (signOutFails) throw new Error('offline')
          return noContent()
        },
      },
      // A generic handler for any `DELETE /auth/passkeys/:id` — records the
      // id so the next `GET /auth/passkeys` reflects the removal.
      ...passkeys.map((passkey) => ({
        method: 'DELETE',
        path: `/auth/passkeys/${passkey.id}`,
        respond: () => {
          removedPasskeys.add(passkey.id)
          return noContent()
        },
      })),
      ...devices.map((device) => ({
        method: 'DELETE',
        path: `/auth/devices/${device.id}`,
        respond: () => {
          revokedDevices.add(device.id)
          return noContent()
        },
      })),
    ]),
  )

  const onSignOut = vi.fn()
  const location = memoryLocation({ path: '/account', record: true })

  render(
    <Router hook={location.hook}>
      <DepotProvider value={store}>
        <Account
          api={api}
          token={TOKEN}
          personId={PERSON_ID}
          onSignOut={onSignOut}
          {...(clearLocalData === undefined ? {} : { clearLocalData })}
        />
      </DepotProvider>
    </Router>,
  )

  return { onSignOut, location, loginsRequests: () => loginsRequests }
}

describe('Account', () => {
  it('names the person from folded state and the household from the API', async () => {
    await renderAccount({ personName: 'Mark', householdName: 'Veldkamp' })

    expect(await screen.findByText('Mark')).toBeInTheDocument()
    expect(screen.getByText('VELDKAMP HOUSEHOLD')).toBeInTheDocument()
  })

  it('offers to add a passkey only where the device can make one', async () => {
    await renderAccount({ passkeys: [], platformAuthenticator: false })

    // jsdom implements no WebAuthn, so `window.PublicKeyCredential` is
    // already absent unless a test opts in — `platformAuthenticator: false`
    // makes that explicit rather than relying on the ambient absence.
    await screen.findByText('None on this login.')
    expect(
      screen.queryByRole('button', { name: 'Add a passkey on this device' }),
    ).toBeNull()
  })

  it('shows the standing nudge as a quiet section state on a login with none', async () => {
    await renderAccount({ passkeys: [], platformAuthenticator: true })

    expect(await screen.findByText('None on this login.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    // The add button DOES appear here — the device can make one.
    expect(
      await screen.findByRole('button', {
        name: 'Add a passkey on this device',
      }),
    ).toBeInTheDocument()
  })

  it('summarises devices rather than listing them, below Desktop', async () => {
    await renderAccount({ devices: threeDevices() })

    expect(await screen.findByText('3 devices signed in.')).toBeInTheDocument()
    // The per-device rows themselves are Devices' job (`/account/devices`),
    // not drawn here.
    expect(screen.queryByText('Edge on Windows')).toBeNull()
  })

  it('removes a passkey and drops it from the list', async () => {
    const user = userEvent.setup()
    const passkey = aPasskey({ label: 'YubiKey, desk drawer' })
    await renderAccount({ passkeys: [passkey], platformAuthenticator: true })

    expect(await screen.findByText('YubiKey, desk drawer')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'REMOVE' }))

    expect(await screen.findByText('None on this login.')).toBeInTheDocument()
    expect(screen.queryByText('YubiKey, desk drawer')).toBeNull()
  })

  it('routes the entry points to where they are actually handled', async () => {
    await renderAccount({ devices: threeDevices() })

    expect(
      await screen.findByRole('link', { name: /Sign in on another device/ }),
    ).toHaveAttribute('href', '/account/device-link')
    // `?signout` disambiguates the footer from the `All devices ›` row
    // below, which shares the same destination but not the same intent
    // (Task 10 brief's deferred Minor from Task 9's review).
    expect(screen.getByRole('link', { name: 'SIGN OUT' })).toHaveAttribute(
      'href',
      '/account/devices?signout',
    )
    expect(screen.getByRole('link', { name: /All devices/ })).toHaveAttribute(
      'href',
      '/account/devices',
    )
  })

  // `final-review.md` finding 2: `devices`/`passkeys` initialise to `[]`, so
  // a fetch that fails — the ordinary case offline, not the exception — used
  // to read as a confident, wrong "0 devices signed in." / "None on this
  // login." These pin the honest failure state instead.
  /**
   * The section the board reserves for `PEOPLE & LOGINS`, holding only the
   * half S4 can fill. The rule that kept it out at S3.5 — an affordance that
   * leads nowhere is worse than a missing one — now argues for it.
   */
  describe('the PEOPLE section', () => {
    it('links to the People screen below Desktop', async () => {
      await renderAccount({ personName: 'Mark' })
      expect(screen.getByRole('link', { name: /People/ })).toHaveAttribute(
        'href',
        '/account/people',
      )
    })

    it('counts the household in its summary row', async () => {
      await renderAccount({ personName: 'Mark' })
      expect(screen.getByRole('link', { name: /People/ })).toHaveTextContent(
        '1 PERSON',
      )
    })

    it('is titled PEOPLE & LOGINS, the board`s own label, now that S5 fills the second half', async () => {
      await renderAccount({ personName: 'Mark' })
      expect(screen.getByText('PEOPLE & LOGINS')).toBeInTheDocument()
    })

    it('states how many hold a login in the phone summary row, in the board`s own words', async () => {
      await renderAccount({ personName: 'Mark', loginCount: 1 })
      await waitFor(() => {
        expect(screen.getByRole('link', { name: /People/ })).toHaveTextContent(
          '1 OF 1 PERSON HOLDS A LOGIN',
        )
      })
      // Not `SIGNED IN` — that counts a different fact (Devices currently
      // reachable), which is the confusion `final-fix-report.md` finding 3
      // named: a Login with zero Devices still holds a login.
      expect(
        screen.getByRole('link', { name: /People/ }),
      ).not.toHaveTextContent('SIGNED IN')
    })

    it('omits the login clause while it cannot be loaded, rather than claiming zero', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      await renderAccount({ personName: 'Mark', loginsFail: true })
      // Waits for the failed fetch to actually settle, rather than the
      // absence being a race against a request still in flight.
      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'account: could not load logins',
          expect.any(Error),
        )
      })
      expect(
        screen.getByRole('link', { name: /People/ }),
      ).not.toHaveTextContent('HOLDS A LOGIN')
      expect(screen.getByRole('link', { name: /People/ })).toHaveTextContent(
        '1 PERSON',
      )
      consoleError.mockRestore()
    })
  })

  describe('when a load fails', () => {
    it('says passkeys could not be loaded, rather than claiming there are none', async () => {
      await renderAccount({ passkeysFail: true, platformAuthenticator: true })

      expect(
        await screen.findByText(
          'Passkeys could not be loaded. Check your connection.',
        ),
      ).toBeInTheDocument()
      expect(screen.queryByText('None on this login.')).toBeNull()
    })

    it('says devices could not be loaded, rather than a count, below Desktop', async () => {
      await renderAccount({ devicesFail: true })

      expect(
        await screen.findByText(
          'Devices could not be loaded. Check your connection.',
        ),
      ).toBeInTheDocument()
      expect(screen.queryByText(/devices signed in\./)).toBeNull()
    })

    it('says devices could not be loaded, rather than an empty list, at Desktop', async () => {
      await renderAccount({ devicesFail: true, desktop: true })

      expect(
        await screen.findByText(
          'Devices could not be loaded. Check your connection.',
        ),
      ).toBeInTheDocument()
    })
  })

  describe('at Desktop', () => {
    it('unfolds the People list inline instead of linking to it', async () => {
      // The board draws desktop with the summary rows unfolded — "all three
      // people inline" — so this is a media query, deciding which elements
      // exist. `/account/people` redirects back here, exactly as
      // `/account/devices` already does.
      await renderAccount({ personName: 'Mark', desktop: true })

      expect(screen.queryByRole('link', { name: /People/ })).toBeNull()
      expect(screen.getByTestId('person-name')).toHaveTextContent('Mark')
    })

    // Fix round 1: the phone summary row's own `GET /auth/logins` effect
    // used to fire unconditionally, so every Desktop visit issued a request
    // whose result nothing here reads — `<People variant="inline">` already
    // fetches the same list for its own row states. The gate is in the
    // effect itself; this pins the request count rather than the gate's
    // implementation.
    it('issues no dedicated GET /auth/logins of its own — the phone summary fetch is dead here', async () => {
      const { loginsRequests } = await renderAccount({
        personName: 'Mark',
        desktop: true,
      })

      // Waits for `People`'s own fetch to have actually landed, so the
      // count below is not a race against a request still in flight.
      await waitFor(() => {
        expect(screen.getByTestId('people-count')).toHaveTextContent(/hold/)
      })

      expect(loginsRequests()).toBe(1)
    })

    it('unfolds the full device list inline, with a per-row SIGN OUT except on THIS DEVICE', async () => {
      await renderAccount({ devices: threeDevices(), desktop: true })

      expect(await screen.findByText('Edge on Windows')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Sign out Edge on Windows' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Sign out Safari on iPad' }),
      ).toBeInTheDocument()
      // Boards §11's desktop frame draws no per-row action on THIS DEVICE —
      // its sign-out is the footer's job here, not a second row action.
      expect(
        screen.queryByRole('button', { name: 'Sign out this device' }),
      ).toBeNull()
    })

    it('revokes a remote Device from its own row', async () => {
      await renderAccount({ devices: threeDevices(), desktop: true })

      await userEvent.click(
        await screen.findByRole('button', { name: 'Sign out Edge on Windows' }),
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Sign out device' }),
      )

      expect(await screen.findByText('Firefox on Android')).toBeInTheDocument()
      expect(screen.queryByText('Edge on Windows')).toBeNull()
    })

    it("the footer's SIGN OUT is a button that opens the sheet in place, not a Link to a dead end", async () => {
      await renderAccount({ devices: threeDevices(), desktop: true })

      // `/account/devices` redirects straight back to `/account` at
      // Desktop (`App.tsx`) — a Link here would be a dead end, which is
      // exactly the defect Task 9's review caught in this task's plan.
      const signOut = screen.getByRole('button', { name: 'SIGN OUT' })
      expect(signOut.tagName).toBe('BUTTON')

      await userEvent.click(signOut)

      expect(
        await screen.findByRole('alertdialog', {
          name: 'Sign out this device?',
        }),
      ).toBeInTheDocument()
    })

    it('clears local data and ends the session from the footer, even offline', async () => {
      const clearLocalData = vi.fn().mockResolvedValue(undefined)
      const { onSignOut } = await renderAccount({
        devices: threeDevices(),
        desktop: true,
        signOutFails: true,
        clearLocalData,
      })

      await userEvent.click(screen.getByRole('button', { name: 'SIGN OUT' }))
      await userEvent.click(
        screen.getByRole('button', { name: 'Sign out and clear' }),
      )

      expect(clearLocalData).toHaveBeenCalledTimes(1)
      expect(onSignOut).toHaveBeenCalledTimes(1)
    })

    // `final-review.md` finding 4: a rejecting `clearLocalData` used to
    // close the sheet silently, with `stopSync()` already called and
    // `onSignOut` never invoked — this pins that Account, not only
    // `Devices`, surfaces it.
    it('says sign-out did not finish, and keeps the sheet open, when clearing local data fails', async () => {
      const clearLocalData = vi.fn().mockRejectedValue(new Error('IDB error'))
      const { onSignOut } = await renderAccount({
        devices: threeDevices(),
        desktop: true,
        clearLocalData,
      })

      await userEvent.click(screen.getByRole('button', { name: 'SIGN OUT' }))
      await userEvent.click(
        screen.getByRole('button', { name: 'Sign out and clear' }),
      )

      expect(
        await screen.findByText(
          '▲ Sign-out did not finish. Sync is stopped on this device — try again.',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('alertdialog', { name: 'Sign out this device?' }),
      ).toBeInTheDocument()
      expect(onSignOut).not.toHaveBeenCalled()
    })
  })
})
