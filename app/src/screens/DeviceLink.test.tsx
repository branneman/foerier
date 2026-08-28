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
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
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
import { DeviceLink } from './DeviceLink'

/**
 * Every test seeds a **real** store, exactly as `Account.test.tsx` and
 * `Devices.test.tsx` do — never a hand-shaped `DepotState`.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const PERSON_ID = '0f0000aa-0000-4000-8000-0000000000aa'
const TOKEN = 'foe_test_token'
const SECRET = 'kJ2nQ7xWpL0aZ4vRtY8sMc1BdF6hGjNe3UiOkPqXwSb'
const INVITE_ID = 'eeeeeeee-0000-7000-8000-00000000001'

function fixedClock(): Clock {
  return { now: () => 1_700_000_000_000 }
}

function anAuthor(): OpAuthor {
  const ids: IdSource = { next: () => 'unused' }
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

/** A fetch stub keyed on method + path suffix, standing in for the real HTTP
 * transport (`docs/testing.md`: an in-memory fake, never a mocking
 * framework). Counting calls this way — rather than spying on the `api`
 * object itself — is how the "exactly one issue" test stays a real fake
 * instead of a mock. */
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

async function renderDeviceLink(
  options: {
    personName?: string | null
    expiresInMinutes?: number
    secret?: string
    inviteId?: string
  } = {},
) {
  const {
    personName = null,
    expiresInMinutes = 58,
    secret = SECRET,
    inviteId = INVITE_ID,
  } = options

  const specs: OpSpec[] =
    personName === null ? [] : [personRecorded(PERSON_ID, personName)]
  const store = await seededStore(specs)

  // Shared across every `api` object this test builds — including the
  // fresh one `rerenderWithNewApi` swaps in — so "exactly one issue" is a
  // fact about the screen, not an artefact of counting on one particular
  // `AuthApi` instance.
  let issueCalls = 0
  const revokedIds: string[] = []

  function buildApi() {
    return createAuthApi(
      fetchFrom([
        {
          method: 'POST',
          path: '/auth/invites',
          respond: () => {
            issueCalls += 1
            return jsonResponse({
              id: inviteId,
              secret,
              expires_at: new Date(
                Date.now() + expiresInMinutes * 60_000,
              ).toISOString(),
            })
          },
        },
        {
          method: 'DELETE',
          path: `/auth/invites/${inviteId}`,
          respond: () => {
            revokedIds.push(inviteId)
            return noContent()
          },
        },
      ]),
    )
  }

  const api = buildApi()

  const location = memoryLocation({
    path: '/account/device-link',
    record: true,
  })

  function tree(currentApi: ReturnType<typeof buildApi>) {
    return (
      <StrictMode>
        <Router hook={location.hook}>
          <DepotProvider value={store}>
            <DeviceLink api={currentApi} token={TOKEN} personId={PERSON_ID} />
          </DepotProvider>
        </Router>
      </StrictMode>
    )
  }

  const view = render(tree(api))

  return {
    issueCalls: () => issueCalls,
    revokedIds,
    location,
    rerender: () => view.rerender(tree(api)),
    // A distinct `AuthApi` object — `token` and `personId` stay the same,
    // only `api`'s identity changes, which is enough to change the mount
    // effect's dependency array and force it to re-run.
    rerenderWithNewApi: () => view.rerender(tree(buildApi())),
  }
}

describe('the device-link screen', () => {
  it('renders the QR, the link, and the expiry as an amber chip under an hour', async () => {
    await renderDeviceLink({ expiresInMinutes: 58 })

    expect(
      await screen.findByRole('img', { name: /device link/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('EXPIRES IN 58 min')).toBeInTheDocument()
    expect(screen.getByText('SINGLE USE')).toBeInTheDocument()

    const chip = screen.getByText('EXPIRES IN 58 min')
    expect(chip).toHaveAttribute('data-urgent', 'true')
  })

  // fix-round-1: a freshly issued link has ~3,600,000ms remaining, which
  // `Math.round` turns into a *displayed* "60 min" — and a naive
  // `minutes < 60` then reads that as not urgent, so the chip rendered
  // muted for the first ~45 seconds of exactly the link boards §14 says
  // should always read amber. `urgent` must be decided from the raw
  // remaining milliseconds, never from the rounded display value.
  it('reads urgent at the full hour, before rounding would pull the display to 60 min', async () => {
    await renderDeviceLink({ expiresInMinutes: 60 })
    await screen.findByRole('img', { name: /device link/i })

    const chip = screen.getByText(/^EXPIRES IN \d+ min$/)
    expect(chip).toHaveAttribute('data-urgent', 'true')
  })

  it('says the link is the credential', async () => {
    await renderDeviceLink({ expiresInMinutes: 58 })

    expect(
      await screen.findByText(
        'The link is the credential. Treat it like a key.',
      ),
    ).toBeInTheDocument()
  })

  it('issues exactly one link, however many times the screen re-renders', async () => {
    // Rendered inside `StrictMode` (see `renderDeviceLink`), which double-
    // invokes a mount effect in development on its own — if this test can
    // pass without the `useRef` guard in `DeviceLink.tsx`, it is not
    // actually testing anything.
    const { issueCalls, rerender } = await renderDeviceLink({
      expiresInMinutes: 58,
    })
    await screen.findByRole('img', { name: /device link/i })

    // A couple of ordinary re-renders on top of Strict Mode's own
    // double-invoke — the guard must hold beyond the mount, not just
    // survive it once.
    rerender()
    rerender()

    expect(issueCalls()).toBe(1)
  })

  // The test above only varies re-renders with a stable `api` reference,
  // which the mount effect's `[api, token]` dependency array never reacts
  // to — it proves nothing about a dependency actually changing. The
  // `useRef` guard survives that too, but only because the ref is a
  // property of the component instance, not of any one effect run: this
  // is what actually establishes that, rather than assuming it.
  it('does not re-issue when a re-render changes the api dependency', async () => {
    const { issueCalls, rerenderWithNewApi } = await renderDeviceLink({
      expiresInMinutes: 58,
    })
    await screen.findByRole('img', { name: /device link/i })

    rerenderWithNewApi()

    expect(issueCalls()).toBe(1)
  })

  it('builds the link from the origin, /join, and the secret in the fragment', async () => {
    await renderDeviceLink({ secret: 'abc123', expiresInMinutes: 58 })

    const expected = `${window.location.origin}/join#abc123`
    const well = await screen.findByText(expected)
    expect(well).toBeInTheDocument()
    // The secret goes in the fragment, never the path or query — it is
    // never sent to a server (`auth-design.md` §3.2).
    expect(well.textContent).not.toContain('?')
  })

  it('copies the exact link to the clipboard', async () => {
    const user = userEvent.setup()
    const copied: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          copied.push(text)
          return Promise.resolve()
        },
      },
      configurable: true,
    })

    await renderDeviceLink({ secret: 'abc123', expiresInMinutes: 58 })
    await screen.findByRole('img', { name: /device link/i })

    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    expect(copied).toEqual([`${window.location.origin}/join#abc123`])
  })

  it('personalises the lead line once the Person is folded', async () => {
    await renderDeviceLink({ personName: 'Mark', expiresInMinutes: 58 })

    expect(
      await screen.findByText(
        'Open this on the other device. It signs that device in as you, Mark.',
      ),
    ).toBeInTheDocument()
  })

  it('revokes the link and leaves for Account, never touching the household', async () => {
    const user = userEvent.setup()
    const { revokedIds, location } = await renderDeviceLink({
      inviteId: INVITE_ID,
      expiresInMinutes: 58,
    })
    await screen.findByRole('img', { name: /device link/i })

    await user.click(screen.getByRole('button', { name: 'REVOKE LINK' }))

    await waitFor(() => expect(revokedIds).toEqual([INVITE_ID]))
    await waitFor(() => expect(location.history.at(-1)).toBe('/account'))
  })
})
