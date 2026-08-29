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
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
 *
 * **One commit model.** EDIT covers the two typed registers, name and dates,
 * and nothing else; Participants are gear detail's tag chips — an edit
 * affordance on the resting screen, writing at once. So a good half of this
 * file asserts what is *not* there: no Participants row inside EDIT, no
 * disclosure line patching two commit models together, and no confirm on a
 * removal.
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

  it('draws the phase chip with its day count', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    expect(screen.getByTestId('phase-chip')).toHaveTextContent(
      'PACK-OUT · DAY 1',
    )
  })

  it('draws no day count for a Draft', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, tripCreated(ALPS, 'Vosges — Oct'))

    // A Draft has not started anything, so the chip is the label alone.
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('DRAFT')
    expect(screen.getByTestId('phase-chip')).not.toHaveTextContent('DAY')
  })

  /**
   * The NEXT line belongs to the **card** and to nothing else. On a list a
   * reader is scanning rows, and the line is what says which row wants them;
   * on the trip itself the chip already states the phase and the empty region
   * already states the task, so a third line restating the second is a
   * list-scanning affordance printed on the one screen nobody is scanning.
   *
   * Asserted at a Draft and mid pack-out both, because a line drawn for only
   * one phase would still be a line the board does not draw.
   */
  it('draws no next step for a Draft — the NEXT line belongs to the card', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, tripCreated(ALPS, 'Vosges — Oct'))

    expect(screen.queryByTestId('trip-next')).toBeNull()
    expect(screen.queryByText(/NEXT/)).toBeNull()
  })

  it('draws no next step mid pack-out either', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    expect(screen.queryByTestId('trip-next')).toBeNull()
    expect(screen.queryByText(/NEXT/)).toBeNull()
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
   * The gear-list region: the count, then **one permanent domain fact** — the
   * gear list is built from the depot, which will be as true the day the
   * builder lands as it is now. Never release meta-text ("coming soon"), and
   * still **no add affordance**: a control leading to a builder that does not
   * exist would not lead nowhere, it would lead somewhere and lie about it.
   */
  it('says the gear list is empty, says where it comes from, and offers nothing to add', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    const region = screen.getByTestId('gear-list')
    expect(region).toHaveTextContent('0 GEAR LISTED.')
    expect(region).toHaveTextContent('The gear list is built from the depot.')
    // Two lines and nothing else — the region holds no control at all, which
    // is a stronger claim than "no button whose name says add".
    expect(region.querySelectorAll('button, a')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /add/i })).toBeNull()
  })

  /**
   * The redraw's centrepiece. Participants are gear detail's tag chips: the
   * circles are display, the dashed `+` is the one edit affordance on a read
   * surface, and neither is behind EDIT.
   */
  it('opens the participants picker from the resting screen, with no EDIT', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    await renderTrip(`/trips/${ALPS}`, ...alps())

    // Still resting: the typed fields are not mounted.
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Participants' }))
    expect(screen.getByRole('dialog', { name: 'Participants' })).toBeVisible()
  })

  /**
   * A gear with no tags shows the lone ghost, and a Trip with no Participants
   * does the same. The dates are the half of the old meta row that still
   * drops — "a draft usually has none, so the header simply drops them".
   */
  it('drops the dates but keeps the lone participants ghost', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, tripCreated(ALPS, 'Vosges — Oct'))

    expect(screen.queryByTestId('trip-dates')).toBeNull()
    // No cluster at all rather than an empty one: `role="img"` over nothing
    // announces a picture of nobody.
    expect(screen.queryByRole('img', { name: /Participants/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Participants' })).toBeVisible()
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
  it('carries the name and the dates, and nothing else', async () => {
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

    // Two typed registers on Save/Cancel — one commit model. The disclosure
    // line that used to patch the second one together is gone with it, and it
    // is asserted absent rather than merely deleted, because a sentence
    // apologising for a shape the app no longer has is worse than the shape.
    expect(screen.queryByText(/TAKES EFFECT AT ONCE/i)).toBeNull()
    expect(screen.queryByText(/SAVE AND CANCEL DO NOT COVER/i)).toBeNull()

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

  it('holds no Participants row of its own', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByRole('button', { name: 'EDIT' }))

    // Exactly one control opens the picker, and it is the resting screen's
    // ghost — not a second one inside a form that neither commits nor cancels
    // it.
    expect(
      screen.getAllByRole('button', { name: 'Participants' }),
    ).toHaveLength(1)
  })
})

/**
 * A date register holds whatever arrived: spec §1.4 gates no format, because a
 * reader rejecting anything but `YYYY-MM-DD` would be discarding a
 * quartermaster's work to enforce a spelling. A `date` control cannot draw
 * such a value, so the field renders **empty while the value survives** — and
 * an empty field that is not empty is the one thing EDIT must not leave
 * unsaid.
 */
describe('the trip screen — a stored date EDIT cannot draw', () => {
  it('states the stored value beside the field', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    await renderTrip(
      `/trips/${ALPS}`,
      tripCreated(ALPS, 'Alps 2026'),
      tripDatesSet(ALPS, { start: 'aug sometime', end: '2026-09-02' }),
    )

    await user.click(screen.getByRole('button', { name: 'EDIT' }))

    // Drawn from the value actually stored, quoted verbatim — a paraphrase
    // would leave the household guessing what it is about to replace.
    expect(screen.getByTestId('start-note')).toHaveTextContent(
      '▲ STORED AS "aug sometime" — PICKING A DATE REPLACES IT',
    )
    // The readable end is not annotated: the note is about a field that looks
    // cleared and is not.
    expect(screen.queryByTestId('end-note')).toBeNull()
  })

  it('draws the ▲ in the attention class rather than the field meta', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    await renderTrip(
      `/trips/${ALPS}`,
      tripCreated(ALPS, 'Alps 2026'),
      tripDatesSet(ALPS, { start: 'aug sometime' }),
    )

    await user.click(screen.getByRole('button', { name: 'EDIT' }))

    // The glyph is its own element, so it can be coloured without colouring
    // the sentence — a ▲ that inherits the surrounding muted meta is a ▲ in
    // name only, and the attention class is the whole of what it says.
    const note = screen.getByTestId('start-note')
    expect(note.firstElementChild?.textContent).toBe('▲')

    // jsdom computes no cascade, so the class carrying the colour is asserted
    // where it is written. `TripCard`'s container-query test is the shape.
    const css = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'Trip.module.css'),
      'utf8',
    )
    expect(css).toMatch(
      /\.attention\s*\{[^}]*color:\s*var\(--color-status-attention\)/,
    )
  })

  it('annotates a well-formed date that is not a day on the calendar', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    await renderTrip(
      `/trips/${ALPS}`,
      tripCreated(ALPS, 'Alps 2026'),
      // Right shape, no such day — and a `date` control renders it empty just
      // as it renders `aug sometime` empty, so the same silence needs the same
      // sentence.
      tripDatesSet(ALPS, { end: '2026-02-30' }),
    )

    await user.click(screen.getByRole('button', { name: 'EDIT' }))

    expect(screen.getByTestId('end-note')).toHaveTextContent(
      '▲ STORED AS "2026-02-30" — PICKING A DATE REPLACES IT',
    )
  })

  it('writes nothing when the unreadable value is left alone', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(
      `/trips/${ALPS}`,
      tripCreated(ALPS, 'Alps 2026'),
      tripDatesSet(ALPS, { start: 'aug sometime' }),
    )

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // The draft holds the stored string even though the field draws nothing,
    // so an untouched Save compares equal — the quartermaster's value is not
    // silently cleared by a control that could not show it.
    expect(await seed.authored()).toEqual([])
  })

  it('drops the note once a date has been picked over it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(
      `/trips/${ALPS}`,
      tripCreated(ALPS, 'Alps 2026'),
      tripDatesSet(ALPS, { start: 'aug sometime' }),
    )

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.type(screen.getByLabelText('Start'), '2026-08-14')

    // The field no longer looks cleared, so the sentence explaining that it
    // only looked cleared has nothing left to say.
    expect(screen.queryByTestId('start-note')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await seed.authored()).toEqual([
      { type: 'trip.dates_set', payload: { start: '2026-08-14' } },
    ])
  })
})

describe('the trip screen — Participants on the resting screen', () => {
  it('emits a toggle immediately, both ways', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(
      `/trips/${ALPS}`,
      personRecorded('els', 'Els'),
      personRecorded('kees', 'Kees'),
      tripCreated(ALPS, 'Alps 2026'),
      tripParticipantAdded(ALPS, 'els'),
    )

    await user.click(screen.getByRole('button', { name: 'Participants' }))
    await user.click(screen.getByRole('button', { name: /Kees/ }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    // The Trip exists, so there is something to address: unlike the create
    // screen, a tap here is an op and not a draft. Nothing was saved and
    // nothing could have been cancelled — the pick *is* the decision.
    expect(await seed.authored()).toEqual([
      { type: 'trip.participant_added', payload: { person_id: 'kees' } },
      { type: 'trip.participant_removed', payload: { person_id: 'els' } },
    ])
  })

  /**
   * The tag picker's rule: removal is cheap and instantly reversible — the
   * next tap puts them back — and at this slice removing a Participant
   * removes nothing else. A confirm here would be the app asking permission
   * to do something it can undo in one tap.
   */
  it('never confirms a removal', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(`/trips/${ALPS}`, ...alps())

    await user.click(screen.getByRole('button', { name: 'Participants' }))
    await user.click(screen.getByRole('button', { name: /Els/ }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await seed.authored()).toEqual([
      { type: 'trip.participant_removed', payload: { person_id: 'els' } },
    ])
  })

  it('draws the circles as a single cluster, and an empty one for an unfolded Person', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      personRecorded('els', 'Els'),
      tripCreated(ALPS, 'Alps 2026'),
      tripParticipantAdded(ALPS, 'els'),
      // A `trip.participant_added` that overtook the `person.recorded` it
      // names. Listed, never dropped — vanishing is the one behaviour a
      // membership list must not have — and drawn empty, because inventing an
      // initial would be a fact the app does not hold.
      tripParticipantAdded(ALPS, 'ghost'),
    )

    const cluster = screen.getByRole('img', { name: 'Participants: Els, —' })
    expect(cluster.children).toHaveLength(2)
    expect(cluster.children[1]?.textContent).toBe('')
  })
})
