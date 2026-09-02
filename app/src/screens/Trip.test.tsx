import {
  createHlcClock,
  gearRecorded,
  personRecorded,
  tripCreated,
  tripDatesSet,
  tripEntryAdded,
  tripEntryBringCountSet,
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
import { DESKTOP, SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { Trip } from './Trip'

/**
 * **The trip screen** — the `Gear list builder` board's header (S6), plus the
 * gear list itself below it (S7): the region S6 left empty now edits below
 * Split and reads from Split up, per
 * `docs/specs/2026-08-29-the-gear-list.md` §4.2.
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
const JURA = 'tttttttt-0000-7000-8000-00000000000b'

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
   * gear list is built from the depot, which is as true now as it was before
   * this slice. From Split up the screen only ever reads, so an empty list
   * there draws no control at all — a stronger claim than "no button whose
   * name says add".
   */
  it('says the gear list is empty and says where it comes from, with no control from Split up', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    setViewport(SPLIT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    const region = screen.getByTestId('gear-list')
    expect(region).toHaveTextContent('0 ENTRIES.')
    expect(region).toHaveTextContent('The gear list is built from the depot.')
    expect(region.querySelectorAll('button, a')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /add/i })).toBeNull()
    expect(screen.queryByText('EDIT LIST ›')).toBeNull()
  })

  /**
   * The state every *new* Trip opens in: below Split, empty, and editable.
   * The add affordances sit outside the empty/non-empty ternary in
   * `Trip.tsx` precisely so they survive both branches — this pins that they
   * are not accidentally scoped to the non-empty one.
   */
  it('below Split: an empty list still offers the dashed row and the pinned button', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    const region = screen.getByTestId('gear-list')
    expect(region).toHaveTextContent('0 ENTRIES.')
    expect(region).toHaveTextContent('The gear list is built from the depot.')
    expect(
      screen.getByRole('button', {
        name: '+ TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE',
      }),
    ).toBeVisible()
    // A `<Link>` now that `/trips/:id/add` (Task 10) exists.
    expect(
      screen.getByRole('link', { name: '+ Add from the depot' }),
    ).toBeVisible()
    // No `GEAR LIST` band and no `EDIT LIST ›`: those belong to the
    // non-empty branch alone.
    expect(screen.queryByTestId('gear-list-band')).toBeNull()
    expect(screen.queryByText('EDIT LIST ›')).toBeNull()
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

  it('draws a reversed ranges ▲ in the attention class, not the header muted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      tripCreated(ALPS, 'Alps 2026'),
      tripDatesSet(ALPS, { start: '2026-09-02', end: '2026-08-14' }),
    )

    const dates = screen.getByTestId('trip-dates')
    expect(dates).toHaveTextContent('SEP 02 → AUG 14 · ▲ ENDS BEFORE IT STARTS')
    // The glyph is its own element, exactly as EDIT's stored-date note draws
    // it: the header line is muted meta and only the mark is the warning, so
    // one text node would force the attention class onto all of it or none.
    expect(dates.firstElementChild?.textContent).toBe('▲')
    expect(dates.textContent).not.toContain('DAYS')

    // jsdom computes no cascade, so the class carrying the colour is asserted
    // where it is written — the stored-date note's own shape, below.
    const css = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'Trip.module.css'),
      'utf8',
    )
    expect(css).toMatch(
      /\.attention\s*\{[^}]*color:\s*var\(--color-status-attention\)/,
    )
  })

  it('draws both at Split, where the rail carries only a dot', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    setViewport(SPLIT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    // The rail's sync marker is a bare 6px dot whose words exist only as an
    // `aria-label`, so this band is the one place the state is legible at
    // this width. The rail carries no destination labels either, so
    // `‹ TRIPS` is still the only thing naming where the reader came from —
    // and a Trip is nobody's pane, so nothing else supplies it.
    expect(screen.getByRole('link', { name: '‹ TRIPS' })).toBeVisible()
    expect(screen.getByText('SYNCED')).toBeVisible()
  })

  it('draws the back link and no sync line below Split', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    // `AppShell` draws its header band on `mode === 'tabs'` — below Split —
    // and states `SYNCED` in words there, so a second one beside the title
    // would print it twice on the primary device.
    expect(screen.getByRole('link', { name: '‹ TRIPS' })).toBeVisible()
    expect(screen.queryByText('SYNCED')).toBeNull()
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

/**
 * **The gear list itself** — S7's fill of the hole S6 left. A real store,
 * seeded by emitting real ops, exactly as the rest of this file does:
 * `listTotals`/`overClaimsFor` are folds of registers, and a hand-shaped
 * count or conflict would test a shape the reducer might never actually
 * produce.
 */
describe('the trip screen — the gear list (S7)', () => {
  it('renders the section band with N ENTRIES · N PIECES', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-single', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
      gearRecorded('g-counted', {
        name: 'Tent stake',
        container: false,
        kind: 'counted',
      }),
      tripEntryAdded(ALPS, 'e-counted', {
        from: 'depot',
        gearId: 'g-counted',
      }),
      tripEntryBringCountSet(ALPS, 'e-counted', 4),
    )

    // 2 Entries (one Single, one Counted), 5 Pieces (1 + 4).
    expect(screen.getByTestId('gear-list-count')).toHaveTextContent(
      '2 ENTRIES · 5 PIECES',
    )
  })

  /**
   * `entryCountLabel`/`pieceCountLabel`'s singular branch, unexercised until
   * now: a Trip with exactly one Single Entry has one Entry and one Piece,
   * so both nouns take their singular spelling — `1 ENTRY STILL OPEN`'s own
   * rule, restated for this band.
   */
  it('singularises both nouns at exactly one', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-single', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
    )

    expect(screen.getByTestId('gear-list-count')).toHaveTextContent(
      '1 ENTRY · 1 PIECE',
    )
  })

  it('renders the groups with pluralised piece counts, omitting empty ones', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-single', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
      gearRecorded('g-counted', {
        name: 'Tent stake',
        container: false,
        kind: 'counted',
      }),
      tripEntryAdded(ALPS, 'e-counted', {
        from: 'depot',
        gearId: 'g-counted',
      }),
      tripEntryBringCountSet(ALPS, 'e-counted', 4),
    )

    const labels = screen
      .getAllByTestId('gear-list-group-label')
      .map((el) => el.textContent)
    // PER-PERSON and TRIP-ONLY are both empty, so neither group renders —
    // `GearListSection`'s own rule, exercised here through the screen.
    expect(labels).toEqual(['SINGLE', 'COUNTED'])
    expect(screen.queryByText('PER-PERSON')).toBeNull()
    expect(screen.queryByText('TRIP-ONLY')).toBeNull()
    expect(screen.getByText('1 PIECE')).toBeInTheDocument()
    expect(screen.getByText('4 PIECES')).toBeInTheDocument()
  })

  it('below Split: renders steppers, the remove control, the dashed row and the pinned button', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-counted', {
        name: 'Tent stake',
        container: false,
        kind: 'counted',
      }),
      tripEntryAdded(ALPS, 'e-counted', {
        from: 'depot',
        gearId: 'g-counted',
      }),
      tripEntryBringCountSet(ALPS, 'e-counted', 4),
    )

    expect(
      screen.getByRole('textbox', { name: /bring-count for tent stake/i }),
    ).toHaveValue('4')
    expect(
      screen.getByRole('button', { name: 'Remove Tent stake' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: '+ TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE',
      }),
    ).toBeVisible()
    // A `<Link>` now that `/trips/:id/add` (Task 10) exists.
    expect(
      screen.getByRole('link', { name: '+ Add from the depot' }),
    ).toBeVisible()
    // The reading affordance belongs to the other mode alone.
    expect(screen.queryByText('EDIT LIST ›')).toBeNull()
  })

  it('from Split up: renders none of those, and renders EDIT LIST ›', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    setViewport(SPLIT)
    await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-counted', {
        name: 'Tent stake',
        container: false,
        kind: 'counted',
      }),
      tripEntryAdded(ALPS, 'e-counted', {
        from: 'depot',
        gearId: 'g-counted',
      }),
      tripEntryBringCountSet(ALPS, 'e-counted', 4),
    )

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByTestId('entry-row-remove')).toBeNull()
    expect(
      screen.queryByText(
        '+ TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE',
      ),
    ).toBeNull()
    expect(
      screen.queryByRole('link', { name: '+ Add from the depot' }),
    ).toBeNull()
    expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×4')
    expect(screen.getByRole('link', { name: 'EDIT LIST ›' })).toBeVisible()
  })

  it('renders the over-claim band between the header and the section band', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-here', { from: 'depot', gearId: 'tent' }),
      tripCreated(JURA, 'Jura'),
      tripPhaseMoved(JURA, 'on_trip'),
      tripEntryAdded(JURA, 'e-jura', { from: 'depot', gearId: 'tent' }),
    )

    const band = screen.getByTestId('over-claim-band')
    expect(band).toBeVisible()
    expect(band).toHaveTextContent('already claimed by Jura')

    // "Between" is a claim about DOM order, not merely about presence —
    // and `‹ TRIPS` is the first element on the whole screen, so following it
    // is nearly vacuous. Compare against the dates line instead: it is part
    // of the S6 header content, genuinely above the gear list.
    const dates = screen.getByTestId('trip-dates')
    expect(
      dates.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const gearListBand = screen.getByTestId('gear-list-band')
    expect(
      band.compareDocumentPosition(gearListBand) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders no band when the fold reports no conflict', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-single', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
    )

    expect(screen.queryByTestId('over-claim-band')).toBeNull()
  })

  it('emits trip.entry_removed on the remove control without confirming', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-single', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
    )

    await user.click(screen.getByRole('button', { name: 'Remove Headlamp' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await seed.authored()).toEqual([
      { type: 'trip.entry_removed', payload: { entry_id: 'e-single' } },
    ])
  })

  it('emits nothing when the stepper is set to its current value', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-counted', {
        name: 'Tent stake',
        container: false,
        kind: 'counted',
      }),
      tripEntryAdded(ALPS, 'e-counted', {
        from: 'depot',
        gearId: 'g-counted',
      }),
      tripEntryBringCountSet(ALPS, 'e-counted', 4),
    )

    const well = screen.getByRole('textbox', {
      name: /bring-count for tent stake/i,
    })
    await user.clear(well)
    await user.type(well, '4')

    expect(await seed.authored()).toEqual([])
  })

  it('settles an over-claim REMOVE HERE against this Trip, with no confirm', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-here', { from: 'depot', gearId: 'tent' }),
      tripCreated(JURA, 'Jura'),
      tripPhaseMoved(JURA, 'on_trip'),
      tripEntryAdded(JURA, 'e-jura', { from: 'depot', gearId: 'tent' }),
    )

    await user.click(screen.getByRole('button', { name: 'REMOVE HERE' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await seed.authored()).toEqual([
      { type: 'trip.entry_removed', payload: { entry_id: 'e-here' } },
    ])
  })

  /**
   * `REMOVE ON Jura` writes against an aggregate this screen is not
   * showing, and spec §4.7 puts a confirm between the click and that write —
   * `RemoveElsewhereConfirm`. A click opens it naming Jura and authors
   * nothing by itself; `Cancel` closes it, still authoring nothing; only
   * `Remove entry` inside it writes, against Jura's own Entry.
   */
  it('REMOVE ON opens a confirm naming the other Trip, and only its own action writes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-here', { from: 'depot', gearId: 'tent' }),
      tripCreated(JURA, 'Jura'),
      tripPhaseMoved(JURA, 'on_trip'),
      tripEntryAdded(JURA, 'e-jura', { from: 'depot', gearId: 'tent' }),
    )

    await user.click(screen.getByRole('button', { name: 'REMOVE ON Jura' }))

    const confirm = screen.getByRole('alertdialog')
    expect(confirm).toHaveTextContent('Remove from Jura?')
    expect(await seed.authored()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await seed.authored()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'REMOVE ON Jura' }))
    await user.click(screen.getByRole('button', { name: 'Remove entry' }))

    expect(await seed.authored()).toEqual([
      { type: 'trip.entry_removed', payload: { entry_id: 'e-jura' } },
    ])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('the dashed row opens Trip-only entry, which owns its own write', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-single', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
    )

    await user.click(
      screen.getByRole('button', {
        name: '+ TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE',
      }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Trip-only entry' }),
    ).toBeVisible()
    expect(await seed.authored()).toEqual([])

    await user.type(screen.getByLabelText('Name'), 'Guy-line kit')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(screen.queryByRole('dialog', { name: 'Trip-only entry' })).toBeNull()
    expect(await seed.authored()).toEqual([
      {
        type: 'trip.entry_added',
        payload: {
          entry_id: expect.any(String),
          source: { from: 'trip_only', name: 'Guy-line kit', container: false },
        },
      },
    ])
    // Still on the Trip screen: no navigation away.
    expect(screen.getByRole('heading', { name: 'Alps 2026' })).toBeVisible()
  })

  /**
   * The pinned primary used to be this same file's third documented no-op —
   * `/trips/:id/add` now exists (Task 10), so the control is a real `<Link>`
   * and this pins the destination rather than an absence of one. `‹ TRIPS`'s
   * own assertion above checks a destination the same way, rather than
   * simulating a navigation this test's own `<Route path="/trips/:id">` has
   * no page to receive.
   */
  it('the pinned button now points at /trips/:id/add', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-single', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
    )

    expect(
      screen.getByRole('link', { name: '+ Add from the depot' }),
    ).toHaveAttribute('href', `/trips/${ALPS}/add`)
  })

  /**
   * `EDIT LIST ›` used to be this file's fourth documented no-op —
   * `/trips/:id/list` now exists (Task 11), so the control is a real
   * `<Link>` and this pins the destination rather than an absence of one,
   * exactly as the pinned primary's own test above does for `/trips/:id/add`.
   * No door param: the builder's own default (the "trip" door,
   * `GearListBuilder.tsx`) applies from here, giving `‹ Alps 2026` back
   * rather than `‹ TRIPS`.
   */
  it('EDIT LIST › now points at /trips/:id/list', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    setViewport(SPLIT)
    await renderTrip(
      `/trips/${ALPS}`,
      ...alps(),
      gearRecorded('g-single', {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
    )

    expect(screen.getByRole('link', { name: 'EDIT LIST ›' })).toHaveAttribute(
      'href',
      `/trips/${ALPS}/list`,
    )
  })

  /**
   * Fix round F2 — `Stepper.test.tsx`'s pattern: jsdom computes no layout
   * (`css: false`), so the hit area is pinned by reading the declared
   * numbers and computing the result. `.editList` inherits its line-height
   * from `body`'s `--text-body` (1.375rem = 22px) rather than deriving one
   * from its own smaller `font-size`, so 22px — not `--text-label`'s 14px —
   * is the padding box the `::after` grows from.
   */
  it('EDIT LIST › grows to a ≥44px hit area without moving the baseline', () => {
    const css = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'Trip.module.css'),
      'utf8',
    )
    const rule = /\.editList\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    const afterRule = /\.editList::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(rule).toMatch(/position:\s*relative/)
    expect(afterRule).toMatch(/position:\s*absolute/)

    const insetRem = /inset:\s*(-?[0-9.]+)rem/.exec(afterRule)?.[1]
    expect(insetRem).toBeDefined()
    const insetPx = Math.abs(Number.parseFloat(insetRem ?? '0') * 16)

    // `--text-body`'s line-height, not `.editList`'s own `font-size`: a
    // length-valued `line-height` inherits as that computed length, not
    // recomputed against a descendant's smaller font.
    const bodyLineHeightRem = /--text-body:\s*[0-9.]+rem\/([0-9.]+)rem/.exec(
      readFileSync(
        join(
          dirname(expect.getState().testPath ?? ''),
          '..',
          '..',
          '..',
          'ui',
          'styles',
          'tokens.css',
        ),
        'utf8',
      ),
    )?.[1]
    expect(bodyLineHeightRem).toBeDefined()
    const paddingBoxHeight = Number.parseFloat(bodyLineHeightRem ?? '0') * 16

    const hitArea = paddingBoxHeight + 2 * insetPx
    expect(hitArea).toBeGreaterThanOrEqual(44)
  })
})

/**
 * Ruling A11's second door. The asymmetry with `EDIT LIST ›` beside it is the
 * point: that link is *withheld* below Split because this screen is the
 * editor there, while `/trips/:id/packing` is F4's own route at every width
 * and so is never width-gated.
 */
describe('the trip screen — PACKING › (S9a)', () => {
  const headlamp = [
    gearRecorded('g-single', {
      name: 'Headlamp',
      container: false,
      kind: 'single',
    }),
    tripEntryAdded(ALPS, 'e-single', { from: 'depot', gearId: 'g-single' }),
  ]

  it('draws PACKING › in the gear list band, below Split, where EDIT LIST › is withheld', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps(), ...headlamp)

    expect(
      screen.getByRole('link', { name: 'Open packing for Alps 2026' }),
    ).toHaveAttribute('href', `/trips/${ALPS}/packing`)
    // The half that makes this a claim about two links and not one: the
    // editor's own door is absent here, because below Split this screen *is*
    // the editor.
    expect(screen.queryByText('EDIT LIST ›')).toBeNull()
    expect(screen.getByTestId('gear-list-band')).toHaveTextContent('PACKING ›')
  })

  it('draws it from Split up too, beside EDIT LIST › and trailing it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    setViewport(SPLIT)
    await renderTrip(`/trips/${ALPS}`, ...alps(), ...headlamp)

    const edit = screen.getByRole('link', { name: 'EDIT LIST ›' })
    const packing = screen.getByRole('link', {
      name: 'Open packing for Alps 2026',
    })
    // Trailing-most at both widths, which is where the drawn phone frame puts
    // it: its position does not move across the breakpoint that adds the
    // second link beside it.
    expect(
      edit.compareDocumentPosition(packing) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('draws it at every phase, Draft included — a phase locks nothing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(
      `/trips/${ALPS}`,
      // No `trip.phase_moved` at all: `phaseOf` reads the absent register as
      // `draft`, and hiding the route there would be a soft lock the phase
      // model does not have.
      tripCreated(ALPS, 'Alps 2026'),
      ...headlamp,
    )

    expect(screen.getByTestId('phase-chip')).toHaveTextContent('DRAFT')
    expect(
      screen.getByRole('link', { name: 'Open packing for Alps 2026' }),
    ).toHaveAttribute('href', `/trips/${ALPS}/packing`)
  })

  it('names a nameless Trip in prose, not with the title lines dash', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, tripCreated(ALPS, ''), ...headlamp)

    // The heading keeps `tripLabel`'s mark — a title is where `—` is right —
    // while the link beside it is a sentence and takes `tripNameOrUnnamed`
    // (§5c's glyph/prose split). `Open packing for —` announces "em dash".
    expect(screen.getByRole('heading', { name: '—' })).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Open packing for Unnamed trip' }),
    ).toHaveAttribute('href', `/trips/${ALPS}/packing`)
  })

  it('keeps the › out of the accessible name', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps(), ...headlamp)

    // Ruling D. Read as text content the name would carry the glyph, spoken
    // "greater-than sign"; `aria-label` overrides content wholesale, so the
    // visible mono string keeps its `›` and the name does not. `EDIT LIST ›`
    // beside it predates the ruling and still announces its own — pinned in
    // the test above, not repaired here.
    const packing = screen.getByRole('link', {
      name: 'Open packing for Alps 2026',
    })
    expect(packing).toHaveTextContent('PACKING ›')
    expect(packing).toHaveAccessibleName('Open packing for Alps 2026')
    expect(screen.queryByRole('link', { name: 'PACKING ›' })).toBeNull()
  })

  /**
   * **Recorded, not a gap.** The `GEAR LIST` band renders only in the
   * non-empty branch, so a Trip with no Entries has no drawn door to F4 at
   * all — a route to a screen that could only say `0 ENTRIES.` back is the
   * dead affordance the empty region's own rule forbids. F4's empty state
   * still exists for a direct link and for the reader already standing there
   * when another Device removes the last Entry (`Packing.tsx`). Flagged for
   * the next design round in case the boards want a door here anyway.
   */
  it('draws no door at all when the gear list is empty', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    expect(screen.getByText('0 ENTRIES.')).toBeVisible()
    expect(screen.queryByTestId('gear-list-band')).toBeNull()
    expect(screen.queryByRole('link', { name: /Open packing/ })).toBeNull()
    expect(screen.queryByText('PACKING ›')).toBeNull()
  })

  /**
   * `.editList`'s hit-area test, restated for its twin — and for the one
   * difference between them. This link has an interactive same-row
   * neighbour from Split up, so its extension is **vertical only**: two
   * symmetric 11px extensions across `.gearListTrailing`'s 12px gap would
   * overlap by 10, the exact mis-tap `OverClaimBand`'s `.settleRow` already
   * refuses.
   */
  it('grows PACKING › to a ≥44px hit area without reaching its neighbour', () => {
    const css = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'Trip.module.css'),
      'utf8',
    )
    const rule = /\.packing\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    const afterRule = /\.packing::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(rule).toMatch(/position:\s*relative/)
    expect(afterRule).toMatch(/position:\s*absolute/)

    // Two values, and the second is `0`: the vertical half grows, the
    // horizontal half does not.
    const inset = /inset:\s*(-?[0-9.]+)rem\s+0\b/.exec(afterRule)?.[1]
    expect(inset).toBeDefined()
    const insetPx = Math.abs(Number.parseFloat(inset ?? '0') * 16)

    const bodyLineHeightRem = /--text-body:\s*[0-9.]+rem\/([0-9.]+)rem/.exec(
      readFileSync(
        join(
          dirname(expect.getState().testPath ?? ''),
          '..',
          '..',
          '..',
          'ui',
          'styles',
          'tokens.css',
        ),
        'utf8',
      ),
    )?.[1]
    expect(bodyLineHeightRem).toBeDefined()
    const paddingBoxHeight = Number.parseFloat(bodyLineHeightRem ?? '0') * 16

    expect(paddingBoxHeight + 2 * insetPx).toBeGreaterThanOrEqual(44)
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

/**
 * **The 1024 frame is a different set of elements, not the same ones
 * reordered.** `Screens B` §02A draws two trip screens, and comparing them
 * element by element is what settles the mechanism: at 1024 the
 * `PARTICIPANTS` group label **does not exist**, the circles are pushed to the
 * trailing edge of a single header row, and `EDIT` is last. Existence
 * differing by mode is
 * [frontend-design §3.2](../../../docs/frontend-design.md)'s media query, and
 * DOM order is what these tests read — CSS `order` would have moved the
 * drawing and left the focus order behind.
 */
describe('the trip screen — the 1024 frame', () => {
  it('gathers the whole header into one row, with EDIT last', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    setViewport(SPLIT, DESKTOP)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    // Title, chip, dates and the Participants cluster are siblings of one
    // parent here; at 393 they are three stacked blocks.
    const row = screen.getByRole('heading', { name: 'Alps 2026' }).parentElement
    expect(row).not.toBeNull()
    expect(row).toContainElement(screen.getByTestId('phase-chip'))
    expect(row).toContainElement(screen.getByTestId('trip-dates'))
    expect(row).toContainElement(
      screen.getByRole('button', { name: 'Participants' }),
    )
    expect(row).toContainElement(screen.getByRole('button', { name: 'EDIT' }))

    // `EDIT` is last, which is a fact about the **document** and therefore
    // about the tab order too. Reordering one DOM in CSS would have satisfied
    // the eye and left the keyboard reading the 393 sequence.
    expect(
      screen
        .getByRole('button', { name: 'Participants' })
        .compareDocumentPosition(screen.getByRole('button', { name: 'EDIT' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('draws no PARTICIPANTS group label — the board has none at 1024', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    setViewport(SPLIT, DESKTOP)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    expect(screen.queryByText('PARTICIPANTS')).toBeNull()
    // The cluster and its ghost are the same elements at both widths — only
    // the label and the arrangement differ.
    expect(
      screen.getByRole('img', { name: 'Participants: Els, Mies' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Participants' })).toBeVisible()
  })

  it('keeps the label at 393 and hides it from the accessibility tree', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    // Drawn, because the board draws it — and `aria-hidden`, because the two
    // elements under it already carry the meaning: a screen reader would
    // otherwise hear PARTICIPANTS, then `Participants: Els, Mies`, then
    // `Participants button`, three announcements for one block.
    expect(screen.getByText('PARTICIPANTS')).toHaveAttribute(
      'aria-hidden',
      'true',
    )

    // And the 393 order is the other one: `EDIT` sits beside the title, so it
    // comes *before* the ghost rather than after it.
    expect(
      screen
        .getByRole('button', { name: 'EDIT' })
        .compareDocumentPosition(
          screen.getByRole('button', { name: 'Participants' }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('leaves the back link and the sync line to the sidebar', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    setViewport(SPLIT, DESKTOP)
    await renderTrip(`/trips/${ALPS}`, ...alps())

    // The 216px sidebar is the navigation and carries the sync line itself —
    // "never in the main column at desktop". `Account` withholds the same two
    // for the same reason, and the sidebar's `TRIPS` is the very destination
    // `‹ TRIPS` points at.
    expect(screen.queryByRole('link', { name: '‹ TRIPS' })).toBeNull()
    expect(screen.queryByText('SYNCED')).toBeNull()
  })

  it('opens the same EDIT, over the same two registers', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    setViewport(SPLIT, DESKTOP)
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
    // The button unmounts while editing at this width too, so the same
    // hand-back applies.
    expect(screen.getByRole('button', { name: 'EDIT' })).toHaveFocus()
  })

  /**
   * jsdom computes no cascade, so the two rules the frames turn on are
   * asserted where they are written — the `▲` colour test above and
   * `TripCard`'s container-query test are the shape.
   */
  it('fills the pane with the empty region, and pushes the cluster right', async () => {
    const css = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'Trip.module.css'),
      'utf8',
    )

    // The board gives the region the rest of the pane and centres the two
    // lines in it; fixed padding left it sitting under the header with the
    // pane empty below.
    expect(css).toMatch(/\.gear\s*\{[^}]*flex:\s*1/)
    expect(css).toMatch(/\.gear\s*\{[^}]*justify-content:\s*center/)

    // `margin-left: auto` inside the one header row — the board's own
    // mechanism for the trailing cluster, and the reason nothing here needs
    // CSS `order`.
    expect(css).toMatch(
      /\.deskHeader\s+\.participantRow\s*\{[^}]*margin-left:\s*auto/,
    )
  })
})
