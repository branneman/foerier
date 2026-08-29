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
  type TripState,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { TripCard } from './TripCard'

/**
 * A **real** store seeded by emitting real ops — `PhaseSheet.test.tsx`'s rule,
 * and it matters twice as much here: `DAY N` is read off the `phase`
 * register's own stamp, so a hand-shaped register would test a state the
 * reducer cannot produce and would hide the very fact the chip draws.
 *
 * The seed clock is fixed, and `Date.now` is pinned per test rather than left
 * to the wall clock — `phaseDay` counts local calendar days between the two,
 * so an unpinned `now` would make `DAY N` a different number every run.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const TRIP = 'tttttttt-0000-7000-8000-000000000001'

/** The seed's wall clock, and the day every `DAY N` below counts from. */
const SEEDED_AT = 1_700_000_000_000
const A_DAY = 24 * 60 * 60 * 1000

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
  trip: () => TripState
}

async function seeded(...specs: readonly OpSpec[]): Promise<Seeded> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

/**
 * Rendered under a **recording** memory location, because the one thing this
 * card owes that cannot be asserted structurally is that the phase chip does
 * not navigate. `history` starts at `/trips` and grows by one entry per
 * followed link, so "nothing moved" and "this moved, once" are both statable.
 */
function renderCard(
  { store, trip }: Seeded,
  variant: 'active' | 'planned',
  onOpenPhase: () => void = () => {},
) {
  const location = memoryLocation({ path: '/trips', record: true })
  render(
    <Router hook={location.hook}>
      <DepotProvider value={store}>
        <TripCard trip={trip()} variant={variant} onOpenPhase={onOpenPhase} />
      </DepotProvider>
    </Router>,
  )
  return location
}

/** `DAY N` counts local calendar days, so this is what makes N deterministic. */
function today(daysAfterSeed: number) {
  vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT + daysAfterSeed * A_DAY)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the active trip card', () => {
  it('draws the board, top to bottom', async () => {
    today(1)
    const card = await seeded(
      personRecorded('mark', 'Mark'),
      personRecorded('els', 'Els'),
      tripCreated(TRIP, 'Alps 2026'),
      tripDatesSet(TRIP, { start: '2026-08-14', end: '2026-09-02' }),
      tripParticipantAdded(TRIP, 'mark'),
      tripParticipantAdded(TRIP, 'els'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active')

    // `▸` is the trip world, and the boards put it on the active card's name
    // and nowhere else on this screen.
    expect(screen.getByTestId('trip-name')).toHaveTextContent('▸ Alps 2026')
    expect(screen.getByTestId('phase-chip')).toHaveTextContent(
      'PACK-OUT · DAY 2',
    )
    expect(screen.getByTestId('trip-dates')).toHaveTextContent(
      'AUG 14 → SEP 02 · 20 DAYS',
    )
    // `sortedPeople` order, which is the order the People screen and the
    // participant picker already draw: "the third circle along" has to mean
    // one Person everywhere.
    expect(
      screen.getByRole('img', { name: 'Participants: Els, Mark' }),
    ).toBeVisible()
    // In place of the board's `● 48/61 PIECES · 13 LEFT`, which has nothing to
    // count until the gear list exists (spec §6.2).
    expect(screen.getByTestId('trip-next')).toHaveTextContent(
      'NEXT — PACK THE LIST',
    )
    expect(screen.queryByText(/PIECES/)).toBeNull()
    // The `›` beside the chip: the closed row's own glyph, doing what `OPEN ›`
    // used to do with a whole accent button.
    expect(screen.getByTestId('trip-chevron')).toHaveTextContent('›')
  })

  it('is one tap target, and carries no button and no verb link', async () => {
    today(1)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active')

    // `OPEN ›` is retired — it "spent the system's strongest element on its
    // flattest verb and taught the accent button to mean nothing", and a
    // board's CTA copy lands on the slice that builds its destination.
    expect(screen.queryByText(/OPEN/)).toBeNull()

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('Open Alps 2026')
    expect(links[0]).toHaveAttribute('href', `/trips/${TRIP}`)
  })

  it('carves the phase chip out of that target rather than nesting it', async () => {
    today(1)
    const user = userEvent.setup()
    const opens = vi.fn()
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    const location = renderCard(card, 'active', opens)

    // Siblings, never nested — `ClosedRow`'s own arrangement. A `<button>`
    // inside an `<a>` is invalid HTML *and* a live bug: one tap would open SET
    // PHASE and leave the screen it opened on.
    const chip = screen.getByTestId('phase-chip')
    expect(chip.closest('a')).toBeNull()

    await user.click(chip)
    expect(opens).toHaveBeenCalledTimes(1)
    expect(location.history).toEqual(['/trips'])

    await user.click(screen.getByRole('link', { name: 'Open Alps 2026' }))
    expect(location.history).toEqual(['/trips', `/trips/${TRIP}`])
    expect(opens).toHaveBeenCalledTimes(1)
  })

  it('draws a reversed ranges ▲ in the attention class, not the meta muted', async () => {
    today(0)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripDatesSet(TRIP, { start: '2026-09-02', end: '2026-08-14' }),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active')

    const dates = screen.getByTestId('trip-dates')
    expect(dates).toHaveTextContent('SEP 02 → AUG 14 · ▲ ENDS BEFORE IT STARTS')
    // The whole point of `tripDateRange` returning parts: the glyph is its own
    // element, so it can be coloured without colouring the range beside it. A
    // ▲ inheriting the muted meta it sits in is a ▲ in name only — the same
    // rule EDIT's stored-date note already follows one screen along.
    expect(dates.firstElementChild?.textContent).toBe('▲')

    // jsdom computes no cascade, so the class carrying the colour is asserted
    // where it is written — `Trip.test.tsx`'s shape, for the same fact.
    const css = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'TripCard.module.css'),
      'utf8',
    )
    expect(css).toMatch(
      /\.attention\s*\{[^}]*color:\s*var\(--color-status-attention\)/,
    )
    // And the count goes: `20 DAYS` beside the ▲ would be a second, confident,
    // false statement about the same pair of dates.
    expect(dates.textContent).not.toContain('DAYS')
  })

  it('drops the dates row entirely when the Trip has none', async () => {
    today(0)
    const card = await seeded(
      personRecorded('mark', 'Mark'),
      tripCreated(TRIP, 'Vosges — Oct'),
      tripParticipantAdded(TRIP, 'mark'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active')

    // The board's own variant: "dates are optional and a draft usually has
    // none — the meta row simply drops". The circles stay, because the day
    // count runs from the phase change and not from dates.
    expect(screen.queryByTestId('trip-dates')).toBeNull()
    expect(screen.getByTestId('phase-chip')).toHaveTextContent(
      'PACK-OUT · DAY 1',
    )
    expect(
      screen.getByRole('img', { name: 'Participants: Mark' }),
    ).toBeVisible()
  })

  it('draws no meta row at all when there is neither a date nor a Participant', async () => {
    today(0)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'on_trip'),
    )
    renderCard(card, 'active')

    expect(screen.queryByTestId('trip-meta')).toBeNull()
  })

  it('opens the SET PHASE sheet from the chip, and does not own it', async () => {
    today(1)
    const user = userEvent.setup()
    const opens = vi.fn()
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active', opens)

    await user.click(screen.getByTestId('phase-chip'))

    // The card asks; the screen mounts. `{open && <PhaseSheet …/>}` is the
    // caller's line, because `ui/`'s primitives have no `open` prop and mount
    // is what resets a sheet's own state.
    expect(opens).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the planned trip card', () => {
  it('draws the boards dashed card', async () => {
    today(3)
    const card = await seeded(tripCreated(TRIP, 'Vosges — Oct'))
    renderCard(card, 'planned')

    const article = screen.getByTestId(`trip-card-${TRIP}`)
    // The dash is the variant's own CSS — "drafts are dashed outlines, lists
    // in progress, not commitments" — and this attribute is what selects it.
    expect(article).toHaveAttribute('data-variant', 'planned')
    // No `▸`: the glyph is the trip world, and a Draft is not on one.
    expect(screen.getByTestId('trip-name')).toHaveTextContent('Vosges — Oct')
    expect(screen.getByTestId('trip-name').textContent).not.toContain('▸')
    expect(screen.getByTestId('phase-line')).toHaveTextContent(
      'DRAFT · 0 GEAR LISTED',
    )
    // The `0` is a fact today and stays true until S7 gives it something to
    // count. The day count is not drawn: a Draft has not started anything.
    expect(screen.getByTestId('phase-chip').textContent).not.toContain('DAY')
    // The line lands on every non-closed card, drafts included. It shipped
    // active-only, on the argument that it restates `0 GEAR LISTED`; that
    // redundancy is an accident of the count being zero and dies at
    // `DRAFT · 14 GEAR LISTED`.
    expect(screen.getByTestId('trip-next')).toHaveTextContent(
      'NEXT — BUILD THE GEAR LIST',
    )
    expect(screen.getByTestId('trip-chevron')).toHaveTextContent('›')
  })

  it('is tappable end to end, with its own chip carved out', async () => {
    today(0)
    const user = userEvent.setup()
    const opens = vi.fn()
    const card = await seeded(tripCreated(TRIP, 'Vosges — Oct'))
    const location = renderCard(card, 'planned', opens)

    // The board's `BUILD LIST ›` names the gear list builder, which is S7's,
    // so the dashed card gets the interim affordance the active one gets: the
    // `›`, and a card that is tappable end to end.
    expect(screen.queryByText(/BUILD LIST/)).toBeNull()
    expect(screen.queryByText(/OPEN/)).toBeNull()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('Open Vosges — Oct')
    expect(links[0]).toHaveAttribute('href', `/trips/${TRIP}`)

    // The chip sits on its own line here rather than beside the name, and is
    // carved out of the target exactly as the active card's is.
    await user.click(screen.getByTestId('phase-chip'))
    expect(opens).toHaveBeenCalledTimes(1)
    expect(location.history).toEqual(['/trips'])
  })

  it('states no next step for a phase this build has never heard of', async () => {
    today(2)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'portaging'),
    )
    renderCard(card, 'planned')

    // Stored and drawn verbatim (`sync-protocol.md` §5.3, obligation 4).
    // Inventing a casing would be coercion by another name.
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('portaging')
    // No `DAY N` either: the count is gated on `isActive`, which calls an
    // unrecognised phase inactive rather than guessing, so an old build never
    // over-states what a Trip is doing.
    expect(screen.getByTestId('phase-chip').textContent).not.toContain('DAY')
    // The card asks `phaseNext` for every Trip it draws, so this null is the
    // phase table's answer and not a variant gate: the next thing to do is a
    // fact of the row, and there is no row.
    expect(screen.queryByTestId('trip-next')).toBeNull()
  })

  it('reads a nameless Trip as the dash tripLabel decides on', async () => {
    today(0)
    const card = await seeded(tripCreated(TRIP, ''))
    renderCard(card, 'planned')

    expect(screen.getByTestId('trip-name')).toHaveTextContent('—')
  })
})

describe('a Participant whose Person has not folded yet', () => {
  it('draws an empty circle rather than a placeholder letter', async () => {
    today(0)
    const card = await seeded(
      personRecorded('mark', 'Mark'),
      tripCreated(TRIP, 'Alps 2026'),
      tripParticipantAdded(TRIP, 'mark'),
      // A `trip.participant_added` that overtook the `person.recorded` it
      // names — an ordinary state on a device that has pulled one and not the
      // other, and the reason `tripParticipants` appends rather than filters.
      tripParticipantAdded(TRIP, 'ghost'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active')

    const cluster = screen.getByRole('img', { name: 'Participants: Mark, —' })
    // The Participant is **listed**, because vanishing is the one behaviour a
    // membership list must never have. Inventing an initial for them would be
    // a fact the app does not have, so the circle is drawn empty — the People
    // screen's treatment, and `personLabel`'s dash carries the name.
    expect(cluster.children).toHaveLength(2)
    expect(cluster.children[0]?.textContent).toBe('M')
    expect(cluster.children[1]?.textContent).toBe('')
  })
})

describe('the container fold', () => {
  it('leaves the query container to the caller, as GearRow does', () => {
    // jsdom evaluates no container query and computes no layout, so the only
    // thing a test can hold here is the invariant itself — and this one is
    // worth holding, because breaking it renders wrong without failing
    // anything. An element is never its own query container: a rule matching
    // `.card` from inside `@container` resolves against the *next* container
    // out, which at Roomy is the screen at ≥40rem — so the dashed card would
    // flip to row at exactly the width the board specifies 2-up, while the
    // descendant rules resolving against the card (~17rem) stayed unapplied.
    // `Trips.module.css`'s `.cardItem` is the container, exactly as `GearRow`
    // queries the pane `Depot` hands it.
    // Read off disk, and located through Vitest's own `testPath`: under the
    // Vite transform `import.meta.url` is an http URL, and `?raw` on a
    // `.module.css` still yields the class map.
    const css = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'TripCard.module.css'),
      'utf8',
    )
    // A *declaration*, not the word: the paragraph above the rules explains
    // why there is none, and would otherwise match itself.
    expect(css).not.toMatch(/^\s*container-type\s*:/m)
    expect(css).toMatch(/@container \(min-width: 20rem\)/)
    // And never a media query: what folds here is layout, not which elements
    // exist (`frontend-design.md` §3.2).
    expect(css).not.toMatch(/^\s*@media\b/m)
  })
})
