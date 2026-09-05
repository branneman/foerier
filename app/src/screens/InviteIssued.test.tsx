import {
  createHlcClock,
  personRecorded,
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
import { DepotProvider, type DepotStoreState } from '../depot/store'
import { DEVICE, fixedClock, HOUSEHOLD, seededStore } from '../testUtils'
import { InviteIssued } from './InviteIssued'

/**
 * Every test seeds a **real** store, exactly as `Account.test.tsx` and
 * `Devices.test.tsx` do — never a hand-shaped `DepotState`.
 */

/** The signed-in Login's Person, in every test that does not say otherwise. */
const MARK = '0f0000aa-0000-4000-8000-0000000000aa'
/** A second, distinct Person — the subject of the "for someone else" cases. */
const ELS = '0f0000aa-0000-4000-8000-0000000000bb'
const TOKEN = 'foe_test_token'
const SECRET = 'kJ2nQ7xWpL0aZ4vRtY8sMc1BdF6hGjNe3UiOkPqXwSb'
const INVITE_ID = 'eeeeeeee-0000-7000-8000-00000000001'

// Each seed now emits **two** person ops in the same `seededStore` call (Mark
// and Els) — a single constant id here would collide, since `opLog.append`
// refuses a duplicate id, and the second person's Person Recorded op would
// silently fail to author (`People.test.tsx`'s own `anId` fixture solves the
// same problem the same way).
let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `ffffffff-0000-7000-8000-${suffix}`
}

function anAuthor(): OpAuthor {
  const ids: IdSource = { next: anId }
  return {
    household_id: HOUSEHOLD,
    device_id: DEVICE,
    ids,
    hlc: createHlcClock(fixedClock()),
  }
}

/**
 * The shared seed, authored by **this suite's own** id source. `INVITE_ID`
 * below is a hand-named `eeeeeeee-…` id, and the default source mints ids
 * under that same prefix — so the counter would eventually reach it and
 * `opLog.append` would refuse the duplicate.
 */
function seededHousehold(
  specs: readonly OpSpec[] = [],
): Promise<StoreApi<DepotStoreState>> {
  return seededStore(specs, { author: anAuthor() })
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
  respond: (init?: RequestInit) => Response
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
    return Promise.resolve(handler.respond(init))
  }
}

/** Every JSON body posted to `/auth/invites`, across the whole file — reset
 * at the start of every `renderInviteIssued` call. Read directly by a test
 * right after rendering, never destructured off the render result, because
 * `AuthApi` never hands the body back to its caller — the request itself is
 * the only place it exists. */
let issuedBodies: unknown[] = []

async function renderInviteIssued(
  options: {
    purpose?: 'join' | 'device'
    /** The signed-in Login's Person. */
    personId?: string
    /** Who the Invite is for. Defaults to `personId` — the own device link. */
    subjectPersonId?: string
    expiresInMinutes?: number
    secret?: string
    inviteId?: string
  } = {},
) {
  const {
    purpose = 'device',
    personId = MARK,
    subjectPersonId = personId,
    expiresInMinutes = 58,
    secret = SECRET,
    inviteId = INVITE_ID,
  } = options

  issuedBodies = []

  // Both named Persons are always on the depot — the lead line and title
  // read a name off whichever one `subjectPersonId` points at, and a test
  // asking for Els must find her recorded exactly as a test asking for Mark
  // does.
  const store = await seededHousehold([
    personRecorded(MARK, 'Mark'),
    personRecorded(ELS, 'Els'),
  ])

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
          respond: (init) => {
            issueCalls += 1
            if (typeof init?.body === 'string') {
              issuedBodies.push(JSON.parse(init.body) as unknown)
            }
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
            <InviteIssued
              api={currentApi}
              token={TOKEN}
              personId={personId}
              subjectPersonId={subjectPersonId}
              purpose={purpose}
            />
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

describe('InviteIssued (the invite-issued screen)', () => {
  it('renders the QR, the link, and the expiry as an amber chip under an hour', async () => {
    await renderInviteIssued({ expiresInMinutes: 58 })

    expect(
      await screen.findByRole('img', { name: /device link/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('EXPIRES IN 58 min')).toBeInTheDocument()
    expect(screen.getByText('SINGLE USE')).toBeInTheDocument()

    const chip = screen.getByText('EXPIRES IN 58 min')
    expect(chip).toHaveAttribute('data-urgent', 'true')
  })

  // fix-round-1: a freshly issued link has ~3,600,000ms remaining, which
  // rounds to a *displayed* "60 min" — and a naive `minutes < 60` then reads
  // that as not urgent, so the chip rendered muted for the first ~45 seconds
  // of exactly the link boards §14 says should always read amber. `urgent`
  // must be decided from the raw remaining milliseconds, never from the
  // rounded display value. (Now `ui/ExpiryChip`'s own rule; this test keeps
  // this screen's coverage of it end to end.)
  it('reads urgent at the full hour, before rounding would pull the display to 60 min', async () => {
    await renderInviteIssued({ expiresInMinutes: 60 })
    await screen.findByRole('img', { name: /device link/i })

    const chip = screen.getByText(/^EXPIRES IN \d+ min$/)
    expect(chip).toHaveAttribute('data-urgent', 'true')
  })

  it('says the link is the credential', async () => {
    await renderInviteIssued({ expiresInMinutes: 58 })

    expect(
      await screen.findByText(
        'The link is the credential. Treat it like a key.',
      ),
    ).toBeInTheDocument()
  })

  it('issues exactly one link, however many times the screen re-renders', async () => {
    // Rendered inside `StrictMode` (see `renderInviteIssued`), which double-
    // invokes a mount effect in development on its own — if this test can
    // pass without the `useRef` guard in `InviteIssued.tsx`, it is not
    // actually testing anything.
    const { issueCalls, rerender } = await renderInviteIssued({
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
  // which the mount effect's dependency array never reacts to — it proves
  // nothing about a dependency actually changing. The `useRef` guard
  // survives that too, but only because the ref is a property of the
  // component instance, not of any one effect run: this is what actually
  // establishes that, rather than assuming it.
  it('does not re-issue when a re-render changes the api dependency', async () => {
    const { issueCalls, rerenderWithNewApi } = await renderInviteIssued({
      expiresInMinutes: 58,
    })
    await screen.findByRole('img', { name: /device link/i })

    rerenderWithNewApi()

    expect(issueCalls()).toBe(1)
  })

  it('builds the link from the origin, /join, and the secret in the fragment', async () => {
    await renderInviteIssued({ secret: 'abc123', expiresInMinutes: 58 })

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

    await renderInviteIssued({ secret: 'abc123', expiresInMinutes: 58 })
    await screen.findByRole('img', { name: /device link/i })

    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    expect(copied).toEqual([`${window.location.origin}/join#abc123`])
  })

  it('personalises the lead line once the Person is folded', async () => {
    await renderInviteIssued({ expiresInMinutes: 58 })

    expect(
      await screen.findByText(
        'Open this on the other device. It signs that device in as you, Mark.',
      ),
    ).toBeInTheDocument()
  })

  it('revokes the link and leaves for Account, never touching the household', async () => {
    const user = userEvent.setup()
    const { revokedIds, location } = await renderInviteIssued({
      inviteId: INVITE_ID,
      expiresInMinutes: 58,
    })
    await screen.findByRole('img', { name: /device link/i })

    await user.click(screen.getByRole('button', { name: 'REVOKE LINK' }))

    await waitFor(() => expect(revokedIds).toEqual([INVITE_ID]))
    await waitFor(() => expect(location.history.at(-1)).toBe('/account'))
  })

  it('mints a join Invite and names the Person it is for', async () => {
    // A join Invite's TTL is 7 days (`auth-design.md` §5); one minute short
    // of it so `ExpiryChip`'s day-floor reads `6 d` rather than `7 d`.
    await renderInviteIssued({
      purpose: 'join',
      subjectPersonId: ELS,
      expiresInMinutes: 7 * 24 * 60 - 1,
    })

    expect(await screen.findByText('Invite for Els')).toBeInTheDocument()
    expect(
      screen.getByText('Hand it over yourself — foerier sends no mail.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('It creates a login for Els. Nothing else can use it.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '‹ PEOPLE & LOGINS' }),
    ).toBeInTheDocument()
    expect(await screen.findByText(/EXPIRES IN 6 d/)).toBeInTheDocument()
    // A join Invite is not a link — the vocabulary in
    // `docs/design/README.md` makes the two named things load-bearing, and
    // the board draws this button's label as `REVOKE INVITE` here, never
    // `REVOKE LINK`.
    expect(
      screen.getByRole('button', { name: 'REVOKE INVITE' }),
    ).toBeInTheDocument()

    expect(issuedBodies).toEqual([{ purpose: 'join', person_id: ELS }])
  })

  it('mints a device link against another Person’s Login', async () => {
    await renderInviteIssued({ purpose: 'device', subjectPersonId: ELS })

    expect(await screen.findByText('Device link for Els')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Open this on Els’s device. It signs that device in as Els.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '‹ PEOPLE & LOGINS' }),
    ).toBeInTheDocument()
    // A device link is a link, and this is the other entry point that
    // shares the own device-link's `REVOKE LINK` label.
    expect(
      screen.getByRole('button', { name: 'REVOKE LINK' }),
    ).toBeInTheDocument()

    expect(issuedBodies).toEqual([{ purpose: 'device', person_id: ELS }])
  })

  it('still mints the caller’s own device link with no person_id', async () => {
    await renderInviteIssued({ purpose: 'device', subjectPersonId: MARK })

    expect(
      await screen.findByText('Sign in on another device'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '‹ ACCOUNT' })).toBeInTheDocument()

    expect(issuedBodies).toEqual([{ purpose: 'device' }])
  })

  /**
   * The guard that was bought with a bug. React 19 Strict Mode
   * double-invokes an effect on mount precisely to surface non-idempotence,
   * and a screen that re-issues does not merely waste a request — it burns
   * single-use Invites and leaves dead links behind, each failing later with
   * no explanation on screen.
   */
  it('issues exactly one Invite per mount, for every variant', async () => {
    await renderInviteIssued({ purpose: 'join', subjectPersonId: ELS })
    await screen.findByText('Invite for Els')
    expect(issuedBodies).toHaveLength(1)
  })
})
