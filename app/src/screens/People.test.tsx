import {
  createHlcClock,
  personRecorded,
  personRenamed,
  type Clock,
  type IdSource,
  type OpAuthor,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { createAuthApi, type InviteRow, type LoginRow } from '../auth/api'
import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type EngineFactory,
} from '../depot/store'
import { People, type PeopleProps } from './People'

/**
 * The board's Screens C §08 (`docs/design/README.md` §13), now with its
 * login half: every row state this file pins comes from three inputs — the
 * folded People, `GET /auth/logins`, and the join half of
 * `GET /auth/invites` — and `renderPeople` seeds a fixed household of three
 * (`MARK`, `ELS`, `KEES`) so every test can name a row by who it belongs to.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const TOKEN = 'foe_test_token'

const MARK = 'mark'
const ELS = 'els'
const KEES = 'kees'

const NOW = Date.now()
const NOW_ISO = new Date(NOW).toISOString()
const DAY = 24 * 60 * 60_000

let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

function fixedClock(): Clock {
  return { now: () => NOW }
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
 * framework) — the same shape `Devices.test.tsx` and `Account.test.tsx`
 * already use. */
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

/** Populated by the fake `DELETE` handlers below — read directly by name
 * from test bodies, as the brief's own assertions do. */
let revokedLogins: string[] = []
let revokedInvites: string[] = []

beforeEach(() => {
  revokedLogins = []
  revokedInvites = []
})

function renderPeople(
  options: {
    personId?: string
    variant?: PeopleProps['variant']
    logins?: readonly LoginRow[]
    invites?: readonly InviteRow[]
    /** Fails `GET /auth/logins` — the offline fallback's own trigger. */
    failLogins?: boolean
  } = {},
) {
  const {
    personId = MARK,
    variant,
    logins = [],
    invites = [],
    failLogins = false,
  } = options

  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  // Fire-and-forget, like every other caller of `emit` — the point of
  // `findBy*` below is to wait for the fold rather than for a promise
  // nothing in this file holds a reference to.
  store.getState().emit(personRecorded(MARK, 'Mark'))
  store.getState().emit(personRecorded(ELS, 'Els'))
  store.getState().emit(personRecorded(KEES, 'Kees'))

  const api = createAuthApi(
    fetchFrom([
      {
        method: 'GET',
        path: '/auth/logins',
        respond: () => {
          if (failLogins) throw new Error('offline')
          return jsonResponse({
            logins: logins.filter((row) => !revokedLogins.includes(row.id)),
          })
        },
      },
      {
        method: 'GET',
        path: '/auth/invites',
        respond: () =>
          jsonResponse({
            invites: invites.filter((row) => !revokedInvites.includes(row.id)),
          }),
      },
      ...logins.map((login) => ({
        method: 'DELETE',
        path: `/auth/logins/${login.id}`,
        respond: () => {
          revokedLogins.push(login.id)
          return noContent()
        },
      })),
      ...invites.map((invite) => ({
        method: 'DELETE',
        path: `/auth/invites/${invite.id}`,
        respond: () => {
          revokedInvites.push(invite.id)
          return noContent()
        },
      })),
    ]),
  )

  render(
    <DepotProvider value={store}>
      <People
        api={api}
        token={TOKEN}
        personId={personId}
        {...(variant === undefined ? {} : { variant })}
      />
    </DepotProvider>,
  )

  return { store }
}

function names(): (string | null)[] {
  return screen.getAllByTestId('person-name').map((node) => node.textContent)
}

describe('the People screen', () => {
  it('lists People alphabetically, whatever order they were recorded in', async () => {
    renderPeople()
    await screen.findByTestId(`person-row-${MARK}`)
    expect(names()).toEqual(['Els', 'Kees', 'Mark'])
  })

  it('badges the signed-in Person and nobody else', async () => {
    renderPeople()
    expect(await screen.findByTestId(`person-row-${MARK}`)).toHaveTextContent(
      'YOU',
    )
    expect(screen.getByTestId(`person-row-${ELS}`)).not.toHaveTextContent('YOU')
  })

  it('records a new Person', async () => {
    const user = userEvent.setup()
    renderPeople()
    await screen.findByTestId(`person-row-${MARK}`)

    await user.click(screen.getByRole('button', { name: '+ NEW PERSON' }))
    await user.type(screen.getByLabelText('New person name'), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Sam')).toBeInTheDocument()
  })

  it('will not record a Person with a blank name', async () => {
    const user = userEvent.setup()
    renderPeople()
    await screen.findByTestId(`person-row-${MARK}`)

    await user.click(screen.getByRole('button', { name: '+ NEW PERSON' }))
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    await user.type(screen.getByLabelText('New person name'), '   ')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  /**
   * EDIT mode is a mode, not a per-row control — the Home picker's round-2
   * change, for the same reason: a rename affordance on every resting row is
   * a wall of controls around a list you mostly read.
   */
  it('offers RENAME only inside EDIT mode', async () => {
    const user = userEvent.setup()
    renderPeople()
    await screen.findByTestId(`person-row-${MARK}`)

    expect(screen.queryByRole('button', { name: 'RENAME' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    expect(
      screen.getAllByRole('button', { name: 'RENAME' }).length,
    ).toBeGreaterThan(0)
  })

  it('renames a Person from EDIT mode', async () => {
    const user = userEvent.setup()
    const { store } = renderPeople()
    const row = await screen.findByTestId(`person-row-${ELS}`)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(within(row).getByRole('button', { name: 'RENAME' }))
    const field = screen.getByLabelText('New name')
    await user.clear(field)
    await user.type(field, 'Elsje')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.people[ELS]?.name?.value).toBe('Elsje')
  })

  it('will not rename a Person to nothing', async () => {
    const user = userEvent.setup()
    renderPeople()
    const row = await screen.findByTestId(`person-row-${ELS}`)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(within(row).getByRole('button', { name: 'RENAME' }))
    await user.clear(screen.getByLabelText('New name'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  /**
   * A Person is never removed: gear ownership and past trips reference them,
   * and the domain gives no removal operation (`sync-protocol.md` §4.2). The
   * Home picker's second EDIT verb has no counterpart here, and its absence
   * is the design rather than an omission.
   */
  it('offers no way to remove a Person, in EDIT mode or out of it', async () => {
    const user = userEvent.setup()
    renderPeople()
    await screen.findByTestId(`person-row-${ELS}`)

    expect(screen.queryByRole('button', { name: 'REMOVE' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    expect(screen.queryByRole('button', { name: 'REMOVE' })).toBeNull()
    expect(screen.getByText(/NEVER REMOVED/)).toBeInTheDocument()
  })

  it('draws an initial, and an empty circle for a Person with no name', async () => {
    // `AppShell`'s `AccountAvatar` rule: `null` draws an empty circle rather
    // than a placeholder letter, because inventing one is a fact the app does
    // not have. Reachable through an explicit name clear.
    const store = createDepotStore({
      log: inMemoryOpLog(),
      engine: noopEngine,
      author: anAuthor(),
    })
    store.getState().emit(personRecorded('ghost', 'Ghost'))
    store.getState().emit(personRenamed('ghost', null))
    await store.getState().drained()

    const api = createAuthApi(
      fetchFrom([
        {
          method: 'GET',
          path: '/auth/logins',
          respond: () => jsonResponse({ logins: [] }),
        },
        {
          method: 'GET',
          path: '/auth/invites',
          respond: () => jsonResponse({ invites: [] }),
        },
      ]),
    )
    render(
      <DepotProvider value={store}>
        <People api={api} token={TOKEN} personId="ghost" />
      </DepotProvider>,
    )

    await screen.findByTestId('person-initial-ghost')
    expect(screen.getByTestId('person-initial-ghost')).toBeEmptyDOMElement()
    // And the name itself reads as the dash every other surface draws. It
    // sorts **last**, which falls out of the em dash's code point rather
    // than from a rule anybody wrote — and is the right place for it.
    expect(names()).toEqual(['—'])
  })

  it('starts a rename of an unnamed Person from an empty field, not from a dash', async () => {
    const user = userEvent.setup()
    const store = createDepotStore({
      log: inMemoryOpLog(),
      engine: noopEngine,
      author: anAuthor(),
    })
    store.getState().emit(personRecorded('ghost', 'Ghost'))
    store.getState().emit(personRenamed('ghost', null))
    await store.getState().drained()

    const api = createAuthApi(
      fetchFrom([
        {
          method: 'GET',
          path: '/auth/logins',
          respond: () => jsonResponse({ logins: [] }),
        },
        {
          method: 'GET',
          path: '/auth/invites',
          respond: () => jsonResponse({ invites: [] }),
        },
      ]),
    )
    render(
      <DepotProvider value={store}>
        <People api={api} token={TOKEN} personId="ghost" />
      </DepotProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'RENAME' }))
    expect(screen.getByLabelText('New name')).toHaveValue('')
  })

  it('draws neither the header nor the title inline, because Account supplies them', async () => {
    renderPeople({ variant: 'inline' })
    await screen.findByTestId(`person-row-${MARK}`)

    expect(screen.queryByRole('heading', { name: 'People' })).toBeNull()
    expect(screen.queryByRole('link', { name: '‹ ACCOUNT' })).toBeNull()
  })

  it('draws your own row as signed in, with a chevron to your devices', async () => {
    renderPeople({
      logins: [
        { id: 'L1', person_id: MARK, device_count: 2, last_seen_at: NOW_ISO },
      ],
    })

    const row = await screen.findByTestId(`person-row-${MARK}`)
    expect(within(row).getByText('SIGNED IN · 2 DEVICES')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '›' })).toHaveAttribute(
      'href',
      '/account/devices',
    )
    // Your exit is SIGN OUT, never self-revocation.
    expect(within(row).queryByText('REVOKE')).not.toBeInTheDocument()
  })

  it('draws another Person’s login with a last seen, a device link and a revoke', async () => {
    renderPeople({
      logins: [
        { id: 'L1', person_id: MARK, device_count: 2, last_seen_at: NOW_ISO },
        {
          id: 'L2',
          person_id: ELS,
          device_count: 1,
          last_seen_at: '2026-08-20T19:04:00.000Z',
        },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    expect(
      within(row).getByText(
        'SIGNED IN · 1 DEVICE · LAST SEEN 2026-08-20 19:04',
      ),
    ).toBeInTheDocument()
    expect(
      within(row).getByRole('link', { name: 'DEVICE LINK ›' }),
    ).toHaveAttribute('href', `/account/people/${ELS}/device-link`)
    expect(
      within(row).getByRole('button', { name: 'REVOKE' }),
    ).toBeInTheDocument()
  })

  /**
   * A state the boards do not draw. `SIGNED IN · 0 DEVICES` would be false in
   * both of its words, and the product already talks about this case — §15's
   * explainer sheet is written for "if yours is the only login and it is
   * signed in nowhere".
   */
  it('says a Login is signed in nowhere rather than counting zero devices', async () => {
    renderPeople({
      logins: [
        { id: 'L1', person_id: MARK, device_count: 1, last_seen_at: NOW_ISO },
        { id: 'L2', person_id: ELS, device_count: 0, last_seen_at: null },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    expect(
      within(row).getByText('LOGIN · NO DEVICE SIGNED IN'),
    ).toBeInTheDocument()
  })

  it('offers an invite to a Person with no login', async () => {
    renderPeople({ logins: [] })

    const row = await screen.findByTestId(`person-row-${KEES}`)
    expect(
      within(row).getByText('NO LOGIN · JOINS TRIPS AS PARTICIPANT'),
    ).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'INVITE ›' })).toHaveAttribute(
      'href',
      `/account/people/${KEES}/invite`,
    )
  })

  it('collapses an outstanding join invite into the row', async () => {
    renderPeople({
      logins: [],
      invites: [
        {
          id: 'I1',
          purpose: 'join',
          person_id: ELS,
          expires_at: new Date(NOW + 7 * 24 * 60 * 60_000 - 100).toISOString(),
        },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    expect(within(row).getByText('INVITE OUT · SINGLE USE')).toBeInTheDocument()
    expect(within(row).getByText('EXPIRES IN 6 d')).toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: 'REVOKE' }),
    ).toBeInTheDocument()
    // REOPEN is not built: the secret is hashed and exists only in the link.
    expect(within(row).queryByText(/REOPEN/)).not.toBeInTheDocument()
  })

  it('ignores a device link when deciding whether an invite is out', async () => {
    renderPeople({
      logins: [
        { id: 'L2', person_id: ELS, device_count: 1, last_seen_at: NOW_ISO },
      ],
      invites: [
        {
          id: 'I2',
          purpose: 'device',
          person_id: ELS,
          expires_at: new Date(NOW + 60 * 60_000).toISOString(),
        },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    expect(
      within(row).queryByText('INVITE OUT · SINGLE USE'),
    ).not.toBeInTheDocument()
  })

  it('counts logins and outstanding invites', async () => {
    renderPeople({
      logins: [
        { id: 'L1', person_id: MARK, device_count: 1, last_seen_at: NOW_ISO },
      ],
      invites: [
        {
          id: 'I1',
          purpose: 'join',
          person_id: ELS,
          expires_at: new Date(NOW + DAY).toISOString(),
        },
      ],
    })

    expect(await screen.findByTestId('people-count')).toHaveTextContent(
      '1 of 3 people holds a login. 1 invite out.',
    )
  })

  it('omits the invite clause when nothing is out, and pluralises the first', async () => {
    renderPeople({
      logins: [
        { id: 'L1', person_id: MARK, device_count: 1, last_seen_at: NOW_ISO },
        { id: 'L2', person_id: ELS, device_count: 1, last_seen_at: NOW_ISO },
      ],
    })

    expect(await screen.findByTestId('people-count')).toHaveTextContent(
      '2 of 3 people hold a login.',
    )
  })

  it('revokes a login only after the confirm is taken', async () => {
    const user = userEvent.setup()
    renderPeople({
      logins: [
        { id: 'L1', person_id: MARK, device_count: 1, last_seen_at: NOW_ISO },
        { id: 'L2', person_id: ELS, device_count: 1, last_seen_at: NOW_ISO },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    await user.click(within(row).getByRole('button', { name: 'REVOKE' }))

    expect(screen.getByText('Revoke Els’s login?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Els’s devices lose access at their next contact with the server. Everything Els recorded stays.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(revokedLogins).toEqual([])

    await user.click(within(row).getByRole('button', { name: 'REVOKE' }))
    await user.click(screen.getByRole('button', { name: 'Revoke login' }))
    expect(revokedLogins).toEqual(['L2'])
  })

  it('revokes an invite with no confirm — it kills a link, never data', async () => {
    const user = userEvent.setup()
    renderPeople({
      logins: [],
      invites: [
        {
          id: 'I1',
          purpose: 'join',
          person_id: ELS,
          expires_at: new Date(NOW + DAY).toISOString(),
        },
      ],
    })

    const row = await screen.findByTestId(`person-row-${ELS}`)
    await user.click(within(row).getByRole('button', { name: 'REVOKE' }))

    expect(revokedInvites).toEqual(['I1'])
  })

  /**
   * The rule that governed the whole S4 → S5 seam, arriving later: drawing
   * every circle as "no login" would render the joiner — who demonstrably
   * holds one — as having none, and stating something false is worse than
   * stating less. Offline is S4's situation, not a degraded mode.
   */
  it('falls back to S4’s render when the login half cannot be loaded', async () => {
    renderPeople({ failLogins: true })

    expect(
      await screen.findByText(
        'Login state could not be loaded. Check your connection.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByTestId('people-count')).toHaveTextContent('3 people.')

    const row = screen.getByTestId(`person-row-${ELS}`)
    expect(
      within(row).queryByText(/SIGNED IN|NO LOGIN|INVITE OUT/),
    ).not.toBeInTheDocument()
    expect(
      within(row).queryByRole('link', { name: 'INVITE ›' }),
    ).not.toBeInTheDocument()
  })

  it('keeps + NEW PERSON and RENAME live with the login half down', async () => {
    const user = userEvent.setup()
    renderPeople({ failLogins: true })

    await user.click(
      await screen.findByRole('button', { name: '+ NEW PERSON' }),
    )
    await user.type(screen.getByLabelText('New person name'), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Sam')).toBeInTheDocument()
  })

  it('omits the own row’s chevron in the inline variant', async () => {
    renderPeople({
      variant: 'inline',
      logins: [
        { id: 'L1', person_id: MARK, device_count: 2, last_seen_at: NOW_ISO },
      ],
    })

    const row = await screen.findByTestId(`person-row-${MARK}`)
    expect(
      within(row).queryByRole('link', { name: '›' }),
    ).not.toBeInTheDocument()
  })
})
