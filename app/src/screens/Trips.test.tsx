import {
  createHlcClock,
  personRecorded,
  tripCreated,
  tripDatesSet,
  tripEntryAdded,
  tripEntryStatusSet,
  tripParticipantAdded,
  tripPhaseMoved,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { DESKTOP, SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { Trips } from './Trips'

/**
 * A **real** store seeded by emitting real ops, as every screen test in this
 * directory does. It matters more than usual here because the three sections
 * are `tripSections`' partition and its order: a hand-shaped `DepotState`
 * could put a Trip in a section the fold would never place it in, and the
 * assertion that the list reads top to bottom would then prove nothing.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

/** The seed's wall clock — `DAY N` counts local calendar days from it. */
const SEEDED_AT = 1_700_000_000_000

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

interface Seeded {
  store: StoreApi<DepotStoreState>
  /** The phase moves authored **since** the seed — the screen's own output. */
  moves: () => Promise<readonly { trip: string; phase: unknown }[]>
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
  const before = (await phaseMoves(log)).length
  return { store, moves: async () => (await phaseMoves(log)).slice(before) }
}

async function phaseMoves(log: OpLog) {
  const all = await log.all()
  return all
    .filter((entry) => entry.op.type === 'trip.phase_moved')
    .map((entry) => ({
      trip: entry.op.aggregate_id,
      phase: entry.op.payload['phase'],
    }))
}

function renderTrips({ store }: Seeded) {
  render(
    <DepotProvider value={store}>
      <Trips />
    </DepotProvider>,
  )
}

/** Every drawn Trip, in DOM order — cards and ledger rows alike. */
function drawn(): (string | undefined)[] {
  return screen.getAllByTestId('trip-entry').map((node) => node.dataset['trip'])
}

const ALPS = 'tttttttt-0000-7000-8000-00000000000a'
const VOSGES = 'tttttttt-0000-7000-8000-00000000000b'
const TESSIN = 'tttttttt-0000-7000-8000-00000000000c'
const SCOTLAND = 'tttttttt-0000-7000-8000-00000000000d'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Trips screen', () => {
  it('says so plainly when the household has no Trips', async () => {
    renderTrips(await seeded())

    // The line `/trips` has drawn since the shell existed, kept word for word.
    expect(screen.getByText('No trips.')).toBeVisible()
    expect(screen.queryAllByTestId('trip-entry')).toHaveLength(0)
    // The step survives the empty state: without it the first Trip could never
    // be created.
    expect(screen.getByRole('link', { name: 'New trip' })).toHaveAttribute(
      'href',
      '/trips/new',
    )
  })

  it('draws the new-trip step as the Depots FAB', async () => {
    renderTrips(await seeded())

    // "The Trips list gains the Depot's 56px FAB as `+ NEW`'s drawn control
    // (F3 had the step, no frame)." The `+` is decoration; the FAB and the
    // desktop control below are the same action, so they carry the same name.
    const fab = screen.getByRole('link', { name: 'New trip' })
    expect(fab).toHaveTextContent('+')
    expect(fab.textContent).not.toContain('NEW')
  })

  it('hangs the FAB after the screen, as the last thing in the main area', async () => {
    renderTrips(await seeded())

    // The button is `position: sticky`, so where it comes to rest is where
    // flow puts it — the foot of the shell's main area, whose bottom edge is
    // the tab bar's top edge (`ui/styles/layout.css` puts the two in adjacent
    // grid rows) and whose bottom padding is the clearance it rests in. Inside
    // `.screen` it would rest at the end of that element's content box
    // instead, which the screen's own padding moves.
    //
    // The arrangement predates the sticky mechanism: `.screen` declares
    // `container-type`, which applies layout containment and so makes it the
    // containing block for a `position: fixed` descendant. That trap does not
    // catch a sticky box — it is offset against the scrollport, which here is
    // the main area itself — so this now stands on the flow reason above.
    //
    // jsdom computes no layout, so the shape is what holds this — the same
    // argument the `@container` fences below are asserted on.
    const fab = screen.getByRole('link', { name: 'New trip' })
    const trips = screen.getByTestId('trips-screen')
    expect(trips.contains(fab)).toBe(false)
    expect(fab.parentElement).toBe(trips.parentElement)
    expect(trips.parentElement?.lastElementChild).toBe(fab)
  })

  it('docks the step into the title row from Split up, with no FAB left', async () => {
    setViewport(SPLIT)
    renderTrips(await seeded())

    // "The FAB renders exactly where the bottom tab bar renders — Compact
    // through Roomy. From Split up there is no bar to clear and the floating
    // button was wrong there: the control docks into the list pane's title
    // row" (`docs/design/README.md` §5).
    const steps = screen.getAllByRole('link', { name: 'New trip' })
    expect(steps).toHaveLength(1)
    expect(steps[0]).toHaveTextContent('+ NEW')
    expect(steps[0]).toHaveAttribute('href', '/trips/new')
  })

  it('keeps the title-row step at desktop, where there is no FAB', async () => {
    setViewport(SPLIT, DESKTOP)
    renderTrips(await seeded())

    // Desktop's withheld FAB and title-row control are confirmed unchanged by
    // the same entry — the sidebar is the navigation there, and `Depot` keeps
    // `+ Add gear` in the same slot.
    const step = screen.getByRole('link', { name: 'New trip' })
    expect(step).toHaveTextContent('+ NEW')
    expect(step).toHaveAttribute('href', '/trips/new')
  })

  it('draws the three sections in order, and heads only the last', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(TESSIN, 'Tessin 2025'),
        tripDatesSet(TESSIN, { start: '2025-07-04' }),
        tripPhaseMoved(TESSIN, 'closed'),
        tripCreated(VOSGES, 'Vosges — Oct'),
        tripCreated(ALPS, 'Alps 2026'),
        tripPhaseMoved(ALPS, 'pack_out'),
      ),
    )

    expect(drawn()).toEqual([ALPS, VOSGES, TESSIN])
    // The board puts the active card and the draft card under the title with
    // nothing between them: a header over a single card is noise. `ACTIVE` and
    // `PLANNED` are how the selector partitions, not drawn copy.
    expect(screen.getByText('CLOSED')).toBeVisible()
    expect(screen.queryByText('ACTIVE')).toBeNull()
    expect(screen.queryByText('PLANNED')).toBeNull()
  })

  it('draws active Trips as cards and planned Trips as dashed ones', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        personRecorded('els', 'Els'),
        tripCreated(ALPS, 'Alps 2026'),
        tripParticipantAdded(ALPS, 'els'),
        tripPhaseMoved(ALPS, 'on_trip'),
        tripCreated(VOSGES, 'Vosges — Oct'),
      ),
    )

    expect(screen.getByTestId(`trip-card-${ALPS}`)).toHaveAttribute(
      'data-variant',
      'active',
    )
    expect(screen.getByTestId(`trip-card-${VOSGES}`)).toHaveAttribute(
      'data-variant',
      'planned',
    )
  })

  it('supplies the Draft card a real entry count, not a literal 0', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    // The exact shape this test guards against: `cards`'s own
    // `entryCount: listTotals(trip, state).entries` silently simplified back
    // to a literal `0`, the shape the code had before this task landed — a
    // change every other test in this file would still pass under, since
    // none of them seed a Draft with real Entries.
    renderTrips(
      await seeded(
        tripCreated(VOSGES, 'Vosges — Oct'),
        tripEntryAdded(VOSGES, anId(), {
          from: 'trip_only',
          name: 'Tent',
          container: false,
        }),
        tripEntryAdded(VOSGES, anId(), {
          from: 'trip_only',
          name: 'Stove',
          container: false,
        }),
      ),
    )

    expect(screen.getByTestId(`trip-card-${VOSGES}`)).toHaveTextContent(
      'DRAFT · 2 ENTRIES',
    )
  })

  /**
   * The progress line's own version of the test above, and it guards the
   * same shape: `packingTotals(trip, state)` silently replaced by a literal,
   * or the read moved into `TripCard` where it would deepen the store-read
   * debt spec §4.1 already logs.
   */
  it('supplies the active card a real packing count, read from the fold', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(ALPS, 'Alps 2026'),
        tripPhaseMoved(ALPS, 'pack_out'),
        tripEntryAdded(ALPS, 'e-tent', {
          from: 'trip_only',
          name: 'Tent',
          container: false,
        }),
        tripEntryAdded(ALPS, 'e-stove', {
          from: 'trip_only',
          name: 'Stove',
          container: false,
        }),
        tripEntryStatusSet(ALPS, 'e-tent', 'packed'),
      ),
    )

    const card = screen.getByTestId(`trip-card-${ALPS}`)
    expect(card).toHaveTextContent('● 1/2 PIECES')
    expect(card).toHaveTextContent('1 LEFT')
    // And the CTA S9a draws beside it, on the one phase that draws it.
    expect(
      screen.getByRole('link', { name: 'Continue pack-out for Alps 2026' }),
    ).toHaveAttribute('href', `/trips/${ALPS}/packing`)
  })

  /**
   * Ruling A11's other half, proved where the rule is decided: a Draft with a
   * real gear list draws `DRAFT · N ENTRIES` and no progress line at all —
   * `● 0/2 PIECES` would state progress against an arrangement invariant 17
   * makes inert.
   */
  it('hands a Draft card no packing count, however many Entries it holds', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(VOSGES, 'Vosges — Oct'),
        tripEntryAdded(VOSGES, 'e-tent', {
          from: 'trip_only',
          name: 'Tent',
          container: false,
        }),
        tripEntryAdded(VOSGES, 'e-stove', {
          from: 'trip_only',
          name: 'Stove',
          container: false,
        }),
      ),
    )

    expect(screen.getByTestId(`trip-card-${VOSGES}`)).toHaveTextContent(
      'DRAFT · 2 ENTRIES',
    )
    expect(screen.queryByTestId('trip-progress')).toBeNull()
    expect(screen.queryByText(/PIECES/)).toBeNull()
    // Nor a CTA: `Continue pack-out` is not a Draft's verb, and `BUILD LIST ›`
    // is the affordance that is.
    expect(screen.queryByTestId('packing-cta')).toBeNull()
    expect(screen.getByTestId('build-list-link')).toBeVisible()
  })

  it('targets the trip screen below Split, where it is the editor', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(await seeded(tripCreated(VOSGES, 'Vosges — Oct')))

    expect(screen.getByTestId('build-list-link')).toHaveAttribute(
      'href',
      `/trips/${VOSGES}`,
    )
  })

  it('targets the builder route, with ?from=trips, from Split up', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    setViewport(SPLIT)
    renderTrips(await seeded(tripCreated(VOSGES, 'Vosges — Oct')))

    // `?from=trips` is the door `GearListBuilder.tsx` reads with
    // `URLSearchParams` to draw `‹ TRIPS` rather than the Trip's own name —
    // `TripCard` no longer decides this itself (F4 review); `Trips.tsx`'s own
    // `useMediaQuery(SPLIT)` does, and hands the route down as a prop.
    expect(screen.getByTestId('build-list-link')).toHaveAttribute(
      'href',
      `/trips/${VOSGES}/list?from=trips`,
    )
  })

  it('renders every active Trip, not just the one the board drew', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(ALPS, 'Alps 2026'),
        tripDatesSet(ALPS, { start: '2026-08-14' }),
        tripPhaseMoved(ALPS, 'pack_out'),
        tripCreated(VOSGES, 'Vosges — Oct'),
        tripDatesSet(VOSGES, { start: '2026-10-02' }),
        tripPhaseMoved(VOSGES, 'unpack'),
      ),
    )

    // Over-claim is guarded, not prevented, so two active Trips are a
    // reachable and legitimate state (spec §3.5). Start date ascending.
    expect(drawn()).toEqual([ALPS, VOSGES])
  })

  it('orders the closed section most recent first', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(SCOTLAND, 'Scotland 2024'),
        tripDatesSet(SCOTLAND, { start: '2024-05-11' }),
        tripPhaseMoved(SCOTLAND, 'closed'),
        tripCreated(TESSIN, 'Tessin 2025'),
        tripDatesSet(TESSIN, { start: '2025-07-04' }),
        tripPhaseMoved(TESSIN, 'closed'),
      ),
    )

    // Ascending forward and descending back: what happened wants the most
    // recent first.
    expect(drawn()).toEqual([TESSIN, SCOTLAND])
  })

  it('draws the closed rows date and piece count, but not the date that is missing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(TESSIN, 'Tessin 2025'),
        tripDatesSet(TESSIN, { start: '2025-07-04', end: '2025-07-19' }),
        tripEntryAdded(TESSIN, anId(), {
          from: 'trip_only',
          name: 'Tent',
          container: false,
        }),
        tripEntryAdded(TESSIN, anId(), {
          from: 'trip_only',
          name: 'Stove',
          container: false,
        }),
        tripPhaseMoved(TESSIN, 'closed'),
        tripCreated(SCOTLAND, 'Scotland 2024'),
        tripPhaseMoved(SCOTLAND, 'closed'),
      ),
    )

    // The board's `JUL 2025 · 54 PIECES · 1 LOST` — S7 supplies the piece
    // count (`listTotals().pieces`, real trip-only Entries here, one piece
    // each); `1 LOST` still waits on S10's outcomes, so it is absent from
    // both rows.
    const tessin = screen.getByTestId(`closed-meta-${TESSIN}`)
    expect(tessin).toHaveTextContent('JUL 2025 · 2 PIECES')
    expect(tessin.textContent).not.toContain('LOST')

    // Scotland has no start date, so that segment drops — but it still has a
    // real piece count (zero, since it never held an Entry), so the row is no
    // longer absent the way it was before S7 gave it something to say.
    const scotland = screen.getByTestId(`closed-meta-${SCOTLAND}`)
    expect(scotland).toHaveTextContent('0 PIECES')
    expect(scotland.textContent).not.toContain('2025')
  })

  it('reopens a closed Trip into Unpack, once the decision is taken', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const store = await seeded(
      tripCreated(TESSIN, 'Tessin 2025'),
      tripPhaseMoved(TESSIN, 'closed'),
    )
    renderTrips(store)

    await user.click(screen.getByRole('button', { name: 'Reopen Tessin 2025' }))

    // The ledger row's reopen targets `unpack` specifically, which is why this
    // surface renders the board's sentence word for word.
    const confirm = screen.getByRole('alertdialog')
    expect(confirm).toHaveTextContent(
      'It returns to Unpack exactly as it stood. Closing cleared nothing.',
    )
    expect(await store.moves()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    await store.store.getState().drained()

    expect(await store.moves()).toEqual([{ trip: TESSIN, phase: 'unpack' }])
  })

  it('writes nothing when the reopen is declined', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const store = await seeded(
      tripCreated(TESSIN, 'Tessin 2025'),
      tripPhaseMoved(TESSIN, 'closed'),
    )
    renderTrips(store)

    await user.click(screen.getByRole('button', { name: 'Reopen Tessin 2025' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await store.store.getState().drained()

    expect(await store.moves()).toEqual([])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('opens SET PHASE from a cards chip, for that card and no other', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const store = await seeded(
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'pack_out'),
      tripCreated(VOSGES, 'Vosges — Oct'),
    )
    renderTrips(store)

    // `{open && <PhaseSheet …/>}`: one sheet exists at a time, mounted by the
    // screen, because `ui/`'s primitives have no `open` prop and mount is what
    // resets a sheet's own state.
    expect(screen.queryByRole('dialog')).toBeNull()

    const chips = screen.getAllByTestId('phase-chip')
    await user.click(chips[1]!)

    const sheet = screen.getByRole('dialog')
    expect(sheet).toHaveTextContent('SET PHASE')

    await user.click(screen.getByRole('button', { name: /ON TRIP/ }))
    await store.store.getState().drained()

    expect(await store.moves()).toEqual([{ trip: VOSGES, phase: 'on_trip' }])
  })
})

describe('the container the cards fold against', () => {
  it('is the list item, and the card sits directly inside it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    renderTrips(
      await seeded(
        tripCreated(ALPS, 'Alps 2026'),
        tripPhaseMoved(ALPS, 'pack_out'),
      ),
    )

    // An element is never its own query container, so `TripCard.module.css`
    // declares none and this file's `.cardItem` is it. The card must therefore
    // be a **descendant** of the item — the arrangement `GearRow` has with the
    // pane `Depot` hands it (`frontend-design.md` §3.2).
    expect(screen.getByTestId(`trip-card-${ALPS}`).parentElement).toBe(
      screen.getAllByTestId('trip-entry')[0],
    )
  })

  it('declares the query container, and zeroes the lists the UA indents', () => {
    // jsdom evaluates no container query and computes no layout, so the source
    // is the only place these hold. Both are silent when broken: the card
    // would fold against the screen at ≥40rem — the one width where the board
    // wants it 2-up — and an unzeroed `<ul>` takes 40px out of the columns'
    // own width, because `reset.css` zeroes only `ul[role='list']`.
    const css = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'Trips.module.css'),
      'utf8',
    )
    expect(css).toMatch(/\.cardItem\s*\{[^}]*container-type:\s*inline-size/)
    // `.screen`'s own container is what the 40rem query above resolves
    // against.
    expect(css).toMatch(/\.screen\s*\{[^}]*container-type:\s*inline-size/)
    expect(css).toMatch(/\.cards\s*\{[^}]*padding:\s*0/)
    expect(css).toMatch(/\.rows\s*\{[^}]*padding:\s*0/)
    // Container queries throughout: what folds is layout, never which
    // elements exist.
    expect(css).not.toMatch(/^\s*@media\b/m)
  })
})

describe('the offset that keeps the FAB clear of the tab bar', () => {
  const css = (): string =>
    readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'Trips.module.css'),
      'utf8',
    )

  it('is written against the bar, by naming no height of it at all', () => {
    // The rule the boards state: "the FAB clears the tab bar by 18px — 74
    // with the bar at its 56px `min-height` — written against the bar's real
    // height, so a bar grown by large user font sizes carries the button up
    // with it instead of drifting under it" (`docs/design/README.md` §5).
    //
    // A constant cannot follow a `min-height`, and neither can a custom
    // property restating it. So the button is a flow sibling parked at the
    // foot of the main area by an auto block margin and held there by
    // `position: sticky` once the list is longer than the screen — the bar's
    // height is not written down anywhere, and the main area's bottom edge is
    // the bar's top edge.
    //
    // The 18px is `--fab-clearance` in `ui/styles/layout.css`, said once, as
    // that foot's own padding. This `bottom` is `0` because the main area is
    // the scroll container the sticky box is offset against, and the offset is
    // resolved against the scrollport inset by that padding: an inset here is
    // *added* to the gap rather than restating it. Measured in Chromium,
    // `bottom: var(--fab-clearance)` against an 18px foot floats the button
    // 36px above the bar.
    const fab = /\.fab\s*\{[^}]*\}/.exec(css())?.[0] ?? ''
    expect(fab).toMatch(/position:\s*sticky/)
    expect(fab).toMatch(/bottom:\s*0;/)
    expect(fab).not.toMatch(/bottom:[^;]*--fab-clearance/)
    expect(fab).toMatch(/margin-block-start:\s*auto/)
    // The inline inset is the main column's own right edge, never a viewport
    // one — which is what keeps the button with the list at Roomy, where that
    // column is capped and centred.
    expect(fab).toMatch(/margin-inline-start:\s*auto/)
    expect(fab).not.toMatch(/position:\s*fixed/)
    expect(fab).not.toMatch(/\bright:/)
    // No literal may stand in for the clearance, the drawn 18px included:
    // `74px` is `4.625rem` and the bar's minimum is `3.5rem`, which the width
    // and height below also spell — so the fence is on the offset alone.
    expect(fab).not.toMatch(
      /bottom:[^;]*(?:4\.625rem|3\.5rem|1\.125rem|56px|74px)/,
    )
  })

  it('leaves the last row uncovered without a clearance to maintain', () => {
    // The button now reserves its own space at the end of the list, so the
    // 76px `padding-bottom` that used to hold the last row clear of a fixed
    // button is gone, and with it the class that carried it.
    expect(css()).not.toMatch(/4\.75rem/)
    expect(css()).not.toMatch(/\.clearance\b/)
  })
})
