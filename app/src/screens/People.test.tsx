import {
  createHlcClock,
  personRecorded,
  personRenamed,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { People } from './People'

/**
 * The board's Screens C §08 minus its login half, so most of what this file
 * pins is what is **absent** — and absent on purpose, because `GET
 * /auth/logins` is S5's endpoint and drawing login state S4 cannot know would
 * be stating something false.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

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

function renderPeople(
  store: StoreApi<DepotStoreState>,
  props: Partial<Parameters<typeof People>[0]> = {},
) {
  render(
    <DepotProvider value={store}>
      <People personId="mark" {...props} />
    </DepotProvider>,
  )
}

function names(): (string | null)[] {
  return screen.getAllByTestId('person-name').map((node) => node.textContent)
}

describe('the People screen', () => {
  it('lists People alphabetically, whatever order they were recorded in', async () => {
    const store = await seededStore([
      personRecorded('mark', 'Mark'),
      personRecorded('kees', 'Kees'),
      personRecorded('els', 'Els'),
    ])
    renderPeople(store)
    expect(names()).toEqual(['Els', 'Kees', 'Mark'])
  })

  it('badges the signed-in Person and nobody else', async () => {
    const store = await seededStore([
      personRecorded('mark', 'Mark'),
      personRecorded('els', 'Els'),
    ])
    renderPeople(store)
    expect(screen.getByTestId('person-row-mark')).toHaveTextContent('YOU')
    expect(screen.getByTestId('person-row-els')).not.toHaveTextContent('YOU')
  })

  it('counts the household, in the singular when there is one of them', async () => {
    const store = await seededStore([personRecorded('mark', 'Mark')])
    renderPeople(store)
    expect(screen.getByTestId('people-count')).toHaveTextContent('1 person.')
  })

  it('counts the household in the plural otherwise', async () => {
    const store = await seededStore([
      personRecorded('mark', 'Mark'),
      personRecorded('els', 'Els'),
    ])
    renderPeople(store)
    expect(screen.getByTestId('people-count')).toHaveTextContent('2 people.')
  })

  it('records a new Person', async () => {
    const user = userEvent.setup()
    const store = await seededStore([personRecorded('mark', 'Mark')])
    renderPeople(store)

    await user.click(screen.getByRole('button', { name: '+ NEW PERSON' }))
    await user.type(screen.getByLabelText('New person name'), 'Kees')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await store.getState().drained()

    expect(names()).toEqual(['Kees', 'Mark'])
  })

  it('will not record a Person with a blank name', async () => {
    const user = userEvent.setup()
    const store = await seededStore()
    renderPeople(store)

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
    const store = await seededStore([personRecorded('els', 'Els')])
    renderPeople(store)

    expect(screen.queryByRole('button', { name: 'RENAME' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    expect(screen.getByRole('button', { name: 'RENAME' })).toBeInTheDocument()
  })

  it('renames a Person from EDIT mode', async () => {
    const user = userEvent.setup()
    const store = await seededStore([personRecorded('els', 'Els')])
    renderPeople(store)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'RENAME' }))
    const field = screen.getByLabelText('New name')
    await user.clear(field)
    await user.type(field, 'Elsje')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.people['els']?.name?.value).toBe('Elsje')
  })

  it('will not rename a Person to nothing', async () => {
    const user = userEvent.setup()
    const store = await seededStore([personRecorded('els', 'Els')])
    renderPeople(store)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'RENAME' }))
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
    const store = await seededStore([personRecorded('els', 'Els')])
    renderPeople(store)

    expect(screen.queryByRole('button', { name: 'REMOVE' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    expect(screen.queryByRole('button', { name: 'REMOVE' })).toBeNull()
    expect(screen.getByText(/NEVER REMOVED/)).toBeInTheDocument()
  })

  /**
   * Every line the board draws in the row's meta slot and right column is
   * login state, and `GET /auth/logins` is S5's. None of it is drawn, and
   * none of it is faked — the same call Find made for its per-person card.
   */
  it('draws no login state, because it cannot know any', async () => {
    const store = await seededStore([
      personRecorded('mark', 'Mark'),
      personRecorded('els', 'Els'),
    ])
    renderPeople(store)

    expect(screen.queryByText(/LOGIN/i)).toBeNull()
    expect(screen.queryByText(/INVITE/i)).toBeNull()
    expect(screen.queryByText(/DEVICE LINK/i)).toBeNull()
    expect(screen.queryByText(/REVOKE/i)).toBeNull()
    expect(screen.queryByText(/SIGNED IN/i)).toBeNull()
  })

  it('draws an initial, and an empty circle for a Person with no name', async () => {
    // `AppShell`'s `AccountAvatar` rule: `null` draws an empty circle rather
    // than a placeholder letter, because inventing one is a fact the app does
    // not have. Reachable through an explicit name clear.
    const store = await seededStore([
      personRecorded('els', 'Els'),
      personRecorded('ghost', 'Ghost'),
      personRenamed('ghost', null),
    ])
    renderPeople(store)

    expect(screen.getByTestId('person-initial-els')).toHaveTextContent('E')
    expect(screen.getByTestId('person-initial-ghost')).toBeEmptyDOMElement()
    // And the name itself reads as the dash every other surface draws.
    // It sorts **last**, which falls out of the em dash's code point rather
    // than from a rule anybody wrote — and is the right place for it.
    expect(names()).toEqual(['Els', '—'])
  })

  it('starts a rename of an unnamed Person from an empty field, not from a dash', async () => {
    const user = userEvent.setup()
    const store = await seededStore([
      personRecorded('ghost', 'Ghost'),
      personRenamed('ghost', null),
    ])
    renderPeople(store)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'RENAME' }))
    expect(screen.getByLabelText('New name')).toHaveValue('')
  })

  it('draws neither the header nor the title inline, because Account supplies them', async () => {
    const store = await seededStore([personRecorded('mark', 'Mark')])
    renderPeople(store, { variant: 'inline' })

    expect(screen.queryByRole('heading', { name: 'People' })).toBeNull()
    expect(screen.queryByRole('link', { name: '‹ ACCOUNT' })).toBeNull()
    // The rows themselves are the point of the inline variant.
    expect(names()).toEqual(['Mark'])
  })
})
