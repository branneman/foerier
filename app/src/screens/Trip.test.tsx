import {
  createHlcClock,
  personRecorded,
  tripCreated,
  tripDatesSet,
  tripParticipantAdded,
  tripPhaseMoved,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type EngineFactory,
} from '../depot/store'
import { Trip } from './Trip'

/**
 * **The trip screen** — the `Gear list builder` board's header, built now,
 * with the two panes below it left to the slice that has a gear list to put
 * there.
 *
 * A real store and the real reducer, seeded by emitting real ops, as every
 * screen test here does. The assertions that matter most read the **log**
 * rather than the fold: this screen's discipline is gear detail's — *each
 * edit emits its own op when it changes and nothing when it does not* — and a
 * needless write folds to identical state while still moving a stamp. At this
 * slice a moved stamp is visible, because `phaseDay` reads the `phase`
 * register's own.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

/** The seed's wall clock — `DAY N` counts local calendar days from it. */
const SEEDED_AT = 1_700_000_000_000

const ALPS = 'tttttttt-0000-7000-8000-00000000000a'

let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

function fixedClock(): Clock {
  return { now: () => SEEDED_AT }
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
  /** Everything the *screen* authored — the seed is subtracted. */
  authored: () => Promise<readonly { type: string; payload: OpPayload }[]>
}

/** Renders `/trips/:id` at `path`, over a store seeded with `specs`. */
async function renderTrip(
  path: string,
  ...specs: readonly OpSpec[]
): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const seedCount = (await log.all()).length

  const location = memoryLocation({ path, record: true })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/trips/:id">
          <DepotProvider value={store}>
            <Trip />
          </DepotProvider>
        </Route>
      </Switch>
    </Router>,
  )

  return {
    authored: async () => {
      await store.getState().drained()
      return (await log.all())
        .slice(seedCount)
        .map((entry) => ({ type: entry.op.type, payload: entry.op.payload }))
    },
  }
}

/** The Alps, mid pack-out, with two Participants and both dates. */
function alps(): readonly OpSpec[] {
  return [
    personRecorded('els', 'Els'),
    personRecorded('mies', 'Mies'),
    tripCreated(ALPS, 'Alps 2026'),
    tripDatesSet(ALPS, { start: '2026-08-14', end: '2026-09-02' }),
    tripParticipantAdded(ALPS, 'els'),
    tripParticipantAdded(ALPS, 'mies'),
    tripPhaseMoved(ALPS, 'pack_out'),
  ]
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the trip screen — the header the board draws', () => {
  it('draws the back link, the name, the dates and the Participants', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    expect(screen.getByRole('link', { name: '‹ TRIPS' })).toHaveAttribute(
      'href',
      '/trips',
    )
    // The heading's accessible name is the Trip's and nothing else: the
    // board's `Alps 2026 — gear list` names a list that does not exist yet, so
    // the exact-name match is the assertion that the suffix is absent.
    expect(screen.getByRole('heading', { name: 'Alps 2026' })).toBeVisible()

    expect(screen.getByTestId('trip-dates')).toHaveTextContent(
      'AUG 14 → SEP 02 · 20 DAYS',
    )
    // One `role="img"` over the cluster, as the card draws it: the initials
    // are one fact — who is on this Trip — and read out letter by letter they
    // are as easily a stray alphabet as a roster.
    expect(
      screen.getByRole('img', { name: 'Participants: Els, Mies' }),
    ).toBeVisible()
  })

  it('draws the phase chip with its day count and the next step', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    expect(screen.getByTestId('phase-chip')).toHaveTextContent(
      'PACK-OUT · DAY 1',
    )
    expect(screen.getByTestId('trip-next')).toHaveTextContent('NEXT — PACK IT')
  })

  it('draws no day count for a Draft', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, tripCreated(ALPS, 'Vosges — Oct'))

    // A Draft has not started anything, so the chip is the label alone.
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('DRAFT')
    expect(screen.getByTestId('phase-chip')).not.toHaveTextContent('DAY')
    expect(screen.getByTestId('trip-next')).toHaveTextContent(
      'NEXT — BUILD THE GEAR LIST',
    )
  })

  it('states no next step once the Trip is closed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      tripCreated(ALPS, 'Tessin 2025'),
      tripPhaseMoved(ALPS, 'closed'),
    )

    expect(screen.getByTestId('phase-chip')).toHaveTextContent('CLOSED')
    expect(screen.queryByTestId('trip-next')).toBeNull()
  })

  it('opens SET PHASE from the chip, and moves the Trip', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByTestId('phase-chip'))
    await user.click(screen.getByRole('button', { name: /ON TRIP/ }))

    expect(await seed.authored()).toEqual([
      { type: 'trip.phase_moved', payload: { phase: 'on_trip' } },
    ])
  })

  /**
   * The gear-list region: board copy, honest, and **no add affordance**. The
   * builder is a later slice; a control that led to a screen with no list
   * would not lead nowhere, it would lead somewhere and lie about it.
   */
  it('says the gear list is empty and offers nothing to add to it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    // Anchored, because `toHaveTextContent` is a substring match and the
    // region's copy is exact: `0 GEAR LISTED.` and nothing beside it.
    expect(screen.getByTestId('gear-list')).toHaveTextContent(
      /^0 GEAR LISTED\.$/,
    )
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /add/i })).toBeNull()
  })

  it('renders a line rather than throwing for an id the fold has never seen', async () => {
    // `state.trips[id]` is `undefined`, which is a different fact from a Trip
    // that exists and carries nothing: this one the fold has never heard of.
    await renderTrip('/trips/tttttttt-0000-7000-8000-0000000000ff')

    expect(screen.getByText('No such trip.')).toBeVisible()
  })

  /**
   * The other half of the not-found split. `writeTrip` creates the entity for
   * **any** Trip op, out of authoring order, so a `trip.participant_added`
   * that arrives before its `trip.created` yields a Trip the fold has seen and
   * that carries no name — an ordinary unnamed Trip, drawn `—`, and emphatically
   * not a missing one.
   */
  it('draws a Trip that exists with no name as —, never as missing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      personRecorded('els', 'Els'),
      tripParticipantAdded(ALPS, 'els'),
    )

    expect(screen.queryByText('No such trip.')).toBeNull()
    expect(screen.getByRole('heading', { name: '—' })).toBeVisible()
    // The phase register is absent too, and an absent one reads `draft`.
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('DRAFT')
    expect(screen.getByRole('img', { name: 'Participants: Els' })).toBeVisible()
  })

  it('drops the meta row entirely for a Trip with neither dates nor Participants', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, tripCreated(ALPS, 'Vosges — Oct'))

    // The board's own variant: "dates are optional and a draft usually has
    // none — the meta row simply drops."
    expect(screen.queryByTestId('trip-dates')).toBeNull()
    expect(screen.queryByRole('img', { name: /Participants/ })).toBeNull()
  })

  it('offers no way to delete a Trip', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /remove trip/i })).toBeNull()
  })
})

describe('the trip screen — EDIT', () => {
  it('carries rename, dates and participants, all three', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    await renderTrip(`/trips/${ALPS}`, ...alps())

    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'EDIT' }))

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Alps 2026',
    )
    expect(screen.getByLabelText('Start')).toHaveValue('2026-08-14')
    expect(screen.getByLabelText('End')).toHaveValue('2026-09-02')
    expect(screen.getByRole('button', { name: 'Participants' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    // The button unmounted while editing, so leaving EDIT has to hand focus
    // back by hand — otherwise a keyboard lands on `<body>`.
    expect(screen.getByRole('button', { name: 'EDIT' })).toHaveFocus()
  })

  it('returns focus to EDIT after a Save as well', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('button', { name: 'EDIT' })).toHaveFocus()
  })

  it('announces no pressed state on a control that is only ever off', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    // People's `EDIT` persists and swaps to `DONE`, so `aria-pressed` is a
    // fact there. This one unmounts while editing, so the attribute could only
    // ever read `"false"` — a state announced and never changed.
    expect(screen.getByRole('button', { name: 'EDIT' })).not.toHaveAttribute(
      'aria-pressed',
    )
  })

  it('writes nothing at all when nothing changed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await seed.authored()).toEqual([])
  })

  it('writes nothing when the name is retyped to the same string', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    const field = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(field)
    await user.type(field, 'Alps 2026')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await seed.authored()).toEqual([])
  })

  it('renames on its own op, and leaves the dates alone', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    const field = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(field)
    await user.type(field, 'Alps 2027')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await seed.authored()).toEqual([
      { type: 'trip.renamed', payload: { name: 'Alps 2027' } },
    ])
    expect(screen.getByRole('heading', { name: 'Alps 2027' })).toBeVisible()
  })

  it('never writes a blank name over a Trip that has one', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.clear(screen.getByRole('textbox', { name: 'Name' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    expect(await seed.authored()).toEqual([])
  })

  /**
   * One key, not two. The other date is a register this edit says nothing
   * about, and an absent field leaves it alone (`sync-protocol.md` §1.3) —
   * which is also what stops one device's edit of the end date from reverting
   * another's edit of the start.
   */
  it('changes one date with one key', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.clear(screen.getByLabelText('End'))
    await user.type(screen.getByLabelText('End'), '2026-09-09')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await seed.authored()).toEqual([
      { type: 'trip.dates_set', payload: { end: '2026-09-09' } },
    ])
  })

  it('clears a date that was set with an explicit null', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.clear(screen.getByLabelText('End'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // `null` clears a nullable register; an absent field leaves it alone. The
    // start date is untouched, so it is not in the payload at all.
    expect(await seed.authored()).toEqual([
      { type: 'trip.dates_set', payload: { end: null } },
    ])
  })

  it('writes no date op for a Trip that never had dates and still has none', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(
      `/trips/${ALPS}`,
      tripCreated(ALPS, 'Vosges — Oct'),
    )

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Never `{start: null, end: null}`: a clear over a register nothing has
    // ever written is a needless op that moves a stamp.
    expect(await seed.authored()).toEqual([])
  })

  it('emits a Participant toggle immediately, both ways', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(
      `/trips/${ALPS}`,
      personRecorded('els', 'Els'),
      personRecorded('kees', 'Kees'),
      tripCreated(ALPS, 'Alps 2026'),
      tripParticipantAdded(ALPS, 'els'),
    )

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'Participants' }))
    await user.click(screen.getByRole('button', { name: /Kees/ }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    // The Trip exists, so there is something to address: unlike the create
    // screen, a tap here is an op and not a draft.
    expect(await seed.authored()).toEqual([
      { type: 'trip.participant_added', payload: { person_id: 'kees' } },
      { type: 'trip.participant_removed', payload: { person_id: 'els' } },
    ])
  })
})
