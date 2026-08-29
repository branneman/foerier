import {
  createHlcClock,
  personRecorded,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { NewTrip } from './NewTrip'

/**
 * **F3 step 1** — `Trips → + NEW → name · dates · participants`, then the trip
 * screen.
 *
 * Every test drives a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createDepotStore` — and reads the log back, as `AddGear.test.tsx`
 * does. Reading the *log* rather than the fold is the point here and not a
 * habit: the fold cannot tell one op from three, and the single most important
 * property of this screen is that a Trip with a name and nothing else costs
 * **one** op. A `trip.dates_set` carrying two clears would fold to exactly the
 * same state and still be the waste spec §4.2 forbids — it moves a stamp, and
 * at this slice a moved stamp is visible, because `phaseDay` reads one.
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

type OpPayload = Record<string, unknown>

interface Seeded {
  store: StoreApi<DepotStoreState>
  /** Everything the *screen* authored — the seed is subtracted. */
  authored: () => Promise<readonly { type: string; payload: OpPayload }[]>
}

async function seeded(...specs: readonly OpSpec[]): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const seedCount = (await log.all()).length

  return {
    store,
    authored: async () => {
      await store.getState().drained()
      return (await log.all())
        .slice(seedCount)
        .map((entry) => ({ type: entry.op.type, payload: entry.op.payload }))
    },
  }
}

function renderNewTrip({ store }: Seeded) {
  const location = memoryLocation({ path: '/trips/new', record: true })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/trips/new">
          <DepotProvider value={store}>
            <NewTrip />
          </DepotProvider>
        </Route>
        <Route path="/trips/:id">
          {(params) => <p>Trip {params['id']}</p>}
        </Route>
      </Switch>
    </Router>,
  )
  return location
}

/** The one Trip a store holds after a create, and its id. */
function soleTrip(store: StoreApi<DepotStoreState>): string {
  const tripIds = Object.keys(store.getState().state.trips)
  expect(tripIds).toHaveLength(1)
  const id = tripIds[0]
  if (id === undefined) throw new Error('unreachable: length checked above')
  return id
}

describe('New trip — the create', () => {
  it('holds the primary until a name is typed', async () => {
    const user = userEvent.setup()
    renderNewTrip(await seeded())

    expect(screen.getByRole('button', { name: 'Create trip' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    expect(
      screen.getByRole('button', { name: 'Create trip' }),
    ).not.toBeDisabled()
  })

  /**
   * **The assertion this screen exists to satisfy.** A Trip with a name and
   * nothing else is one `trip.created`, full stop: no `trip.dates_set`
   * carrying `{start: null, end: null}`, and no participant ops.
   */
  it('emits exactly one op for a Trip with a name and nothing else', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    const ops = await seed.authored()
    expect(ops).toHaveLength(1)
    expect(ops[0]?.type).toBe('trip.created')
    expect(ops[0]?.payload).toEqual({ name: 'Alps 2026' })
  })

  it('trims the name it writes, and never writes a blank one', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    const field = screen.getByRole('textbox', { name: 'Name' })
    await user.type(field, '   ')
    expect(screen.getByRole('button', { name: 'Create trip' })).toBeDisabled()

    await user.type(field, 'Vosges  ')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    expect((await seed.authored())[0]?.payload).toEqual({ name: 'Vosges' })
  })

  it('carries only the date that was entered', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.type(screen.getByLabelText('Start'), '2026-08-14')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    const ops = await seed.authored()
    expect(ops.map((op) => op.type)).toEqual(['trip.created', 'trip.dates_set'])
    // One key, not two: an end date nobody entered is a register nothing has
    // ever written, and a clear over it is a needless op.
    expect(ops[1]?.payload).toEqual({ start: '2026-08-14' })
  })

  it('carries both dates when both were entered', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.type(screen.getByLabelText('Start'), '2026-08-14')
    await user.type(screen.getByLabelText('End'), '2026-09-02')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    const ops = await seed.authored()
    expect(ops[1]?.payload).toEqual({ start: '2026-08-14', end: '2026-09-02' })
  })

  it('adds one op per chosen Participant, and none for one unchosen again', async () => {
    const seed = await seeded(
      personRecorded('els', 'Els'),
      personRecorded('mies', 'Mies'),
      personRecorded('kees', 'Kees'),
    )
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.click(screen.getByRole('button', { name: 'Participants' }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: /Mies/ }))
    await user.click(screen.getByRole('button', { name: /Kees/ }))
    // Off again before the Trip exists: the picker holds draft state here, so
    // this costs nothing at all rather than an add and a remove.
    await user.click(screen.getByRole('button', { name: /Kees/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    const ops = await seed.authored()
    const added = ops.filter((op) => op.type === 'trip.participant_added')
    expect(added).toHaveLength(2)
    expect(added.map((op) => op.payload['person_id']).sort()).toEqual([
      'els',
      'mies',
    ])
    expect(ops.some((op) => op.type === 'trip.participant_removed')).toBe(false)
  })

  /**
   * A Person recorded from inside the picker is on the row **at once**, which
   * is `peopleOn`'s doing rather than this screen's: `emit` folds on the
   * store's queue, so for a tick that Person is in the selection and not yet
   * in `sortedPeople`. A row that filtered the roster would drop the Person it
   * had just been told to add.
   */
  it('lists a Person recorded from inside the picker', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.click(screen.getByRole('button', { name: 'Participants' }))
    await user.click(screen.getByRole('button', { name: '+ New person' }))
    await user.type(
      screen.getByRole('textbox', { name: 'New person name' }),
      'Kees',
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(
      screen.getByRole('button', { name: 'Participants' }),
    ).toHaveTextContent('Kees')
  })

  it('shows the chosen Participants on the row', async () => {
    const seed = await seeded(
      personRecorded('els', 'Els'),
      personRecorded('mies', 'Mies'),
    )
    const user = userEvent.setup()
    renderNewTrip(seed)

    expect(
      screen.getByRole('button', { name: 'Participants' }),
    ).toHaveTextContent('None')

    await user.click(screen.getByRole('button', { name: 'Participants' }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(
      screen.getByRole('button', { name: 'Participants' }),
    ).toHaveTextContent('Els')
  })

  /**
   * The whole burst, in the order the ledger line is written. The pairwise
   * tests above pin each op's payload; this one pins that all three go out
   * together and in that order — `trip.created` first, because the two after
   * it address a Trip it is what creates.
   */
  it('writes the three ops in order for a Trip carrying everything', async () => {
    const seed = await seeded(personRecorded('els', 'Els'))
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.type(screen.getByLabelText('Start'), '2026-08-14')
    await user.click(screen.getByRole('button', { name: 'Participants' }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Create trip' }))

    expect(await seed.authored()).toEqual([
      { type: 'trip.created', payload: { name: 'Alps 2026' } },
      { type: 'trip.dates_set', payload: { start: '2026-08-14' } },
      { type: 'trip.participant_added', payload: { person_id: 'els' } },
    ])
  })

  it('lands on the new Trip, which is where F3 points', async () => {
    const seed = await seeded()
    const user = userEvent.setup()
    renderNewTrip(seed)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Alps 2026')
    await user.click(screen.getByRole('button', { name: 'Create trip' }))
    await seed.store.getState().drained()

    expect(
      await screen.findByText(`Trip ${soleTrip(seed.store)}`),
    ).toBeInTheDocument()
  })

  it('offers a way back to the Trips list', async () => {
    renderNewTrip(await seeded())

    expect(screen.getByRole('link', { name: '‹ TRIPS' })).toHaveAttribute(
      'href',
      '/trips',
    )
  })
})
