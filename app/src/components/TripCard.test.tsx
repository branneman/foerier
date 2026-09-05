import {
  personRecorded,
  tripCreated,
  tripDatesSet,
  tripParticipantAdded,
  tripPhaseMoved,
  type OpSpec,
  type PackingCount,
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

import { DepotProvider, type DepotStoreState } from '../depot/store'
import { SEEDED_AT, seededStore } from '../testUtils'
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

const TRIP = 'tttttttt-0000-7000-8000-000000000001'

/** The seed's wall clock, and the day every `DAY N` below counts from. */
const A_DAY = 24 * 60 * 60 * 1000

interface Seeded {
  store: StoreApi<DepotStoreState>
  trip: () => TripState
}

async function seeded(...specs: readonly OpSpec[]): Promise<Seeded> {
  const store = await seededStore(specs)
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

interface RenderCardOptions {
  onOpenPhase?: () => void
  // Defaults to 0 rather than being required: most of this file's tests are
  // about the active card or about facts the count does not touch, and
  // forcing every call site to spell out an irrelevant 0 would bury the ones
  // that actually mean something.
  entryCount?: number
  // `TripCard` asks no media query of its own (F4 review) — `Trips.tsx`
  // resolves the route and hands it down, so the default here is that
  // screen's own below-Split answer, and a test proving the Split-and-up one
  // passes a different string explicitly rather than flipping a viewport
  // this component no longer reads.
  buildListHref?: string
  // Absent by default, which is what a `planned` card gets from `Trips.tsx`
  // and is therefore the honest default here: the caller reads
  // `packingTotals` for the active section alone (ruling A11's "Active cards
  // only"), so a test that wants the progress line hands one down.
  progress?: PackingCount | undefined
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
  options: RenderCardOptions = {},
) {
  const {
    onOpenPhase = () => {},
    entryCount = 0,
    buildListHref = `/trips/${trip().id}`,
    progress,
  } = options
  const location = memoryLocation({ path: '/trips', record: true })
  render(
    <Router hook={location.hook}>
      <DepotProvider value={store}>
        <TripCard
          trip={trip()}
          variant={variant}
          entryCount={entryCount}
          buildListHref={buildListHref}
          progress={progress}
          onOpenPhase={onOpenPhase}
        />
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
    renderCard(card, 'active', {
      progress: { packed: 48, total: 61, left: 13 },
    })

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
    // The board's own order, and the one thing about this card that has been
    // got backwards before: the permanent obligation, then the arithmetic,
    // then the action. The five-element card is full as of S9a.
    expect(screen.getByTestId('trip-next')).toHaveTextContent(
      'NEXT — PACK THE LIST',
    )
    expect(screen.getByTestId('trip-progress')).toHaveTextContent(
      '● 48/61 PIECES',
    )
    expect(screen.getByTestId('trip-progress')).toHaveTextContent('13 LEFT')
    expect(screen.getByTestId('packing-cta')).toHaveTextContent(
      'Continue pack-out',
    )
    // The `›` beside the chip: the closed row's own glyph, doing what `OPEN ›`
    // used to do with a whole accent button.
    expect(screen.getByTestId('trip-chevron')).toHaveTextContent('›')
  })

  it('is one tap target, and carries no button and no verb link', async () => {
    today(1)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      // On trip, so the card carries no CTA at all: this is the whole-card
      // link's own test, and a phase that draws a second link would make
      // "one tap target" a claim about two of them.
      tripPhaseMoved(TRIP, 'on_trip'),
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

  /**
   * S9a's CTA is the second link on a Pack-out card, and the pair has to
   * stay two *separate* controls: an anchor inside an anchor is invalid HTML
   * and one tap following both, which is the same failure the phase chip's
   * own arrangement exists to avoid.
   */
  it('keeps the CTA beside the whole-card link, never inside it', async () => {
    today(1)
    const user = userEvent.setup()
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    const location = renderCard(card, 'active')

    const cta = screen.getByTestId('packing-cta')
    const surface = screen.getByRole('link', { name: 'Open Alps 2026' })
    expect(cta.contains(surface)).toBe(false)
    expect(surface.contains(cta)).toBe(false)

    await user.click(cta)
    expect(location.history).toEqual(['/trips', `/trips/${TRIP}/packing`])
  })

  it('carves the phase chip out of that target rather than nesting it', async () => {
    today(1)
    const user = userEvent.setup()
    const opens = vi.fn()
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    const location = renderCard(card, 'active', { onOpenPhase: opens })

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
    renderCard(card, 'active', { onOpenPhase: opens })

    await user.click(screen.getByTestId('phase-chip'))

    // The card asks; the screen mounts. `{open && <PhaseSheet …/>}` is the
    // caller's line, because `ui/`'s primitives have no `open` prop and mount
    // is what resets a sheet's own state.
    expect(opens).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  /**
   * The rule that let `BUILD LIST ›` land on the Draft card is the same one
   * that kept `Continue pack-out` off the active one until now — a board's
   * CTA copy lands on the slice that builds its destination — and S9a is
   * that slice for the packing view.
   */
  it('draws Continue pack-out on an active card at Pack-out', async () => {
    today(1)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active')

    const cta = screen.getByRole('link', { name: /Continue pack-out/ })
    // Built inline and not handed down: `/trips/:id/packing` is the same
    // route at every width, which is exactly why there is no `packingHref`
    // prop beside `buildListHref`.
    expect(cta).toHaveAttribute('href', `/trips/${TRIP}/packing`)
    // Named for the Trip, `BUILD LIST ›`'s own rule — two active cards are a
    // legitimate state, and `Continue pack-out` twice in a control list
    // tells them apart by nothing. `Continue pack-out` survives as a
    // substring for voice control (WCAG 2.5.3).
    expect(cta).toHaveAccessibleName('Continue pack-out for Alps 2026')
    expect(cta).toHaveTextContent('Continue pack-out')
    // The two never share a card: `BUILD LIST ›` is the planned variant's.
    expect(screen.queryByTestId('build-list-link')).toBeNull()
  })

  it('names a nameless Trip in the CTA the way a sentence has to', async () => {
    today(1)
    const card = await seeded(
      tripCreated(TRIP, ''),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active')

    // `Continue pack-out for —` announces "em dash", or nothing at all.
    // §5c's glyph/prose split: the title line keeps the mark, the sentences
    // take `tripNameOrUnnamed`'s word.
    expect(screen.getByTestId('trip-name')).toHaveTextContent('—')
    expect(screen.getByTestId('packing-cta')).toHaveAccessibleName(
      'Continue pack-out for Unnamed trip',
    )
    expect(
      screen.getByRole('link', { name: 'Open Unnamed trip' }),
    ).toBeVisible()
  })

  it('draws no CTA at On trip — the phase chip is the control for that verb', async () => {
    today(1)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'on_trip'),
    )
    renderCard(card, 'active', { progress: { packed: 27, total: 27, left: 0 } })

    // Ruling A11: the CTA names the *current* phase's verb, and the control
    // for that verb is the chip this card already carries. The slot is empty
    // rather than filled with a second way to do what the chip does.
    expect(screen.queryByTestId('packing-cta')).toBeNull()
    expect(screen.queryByRole('link', { name: /Continue/ })).toBeNull()
    // The progress line is not what goes with it — it draws on every active
    // card, this one included.
    expect(screen.getByTestId('trip-progress')).toHaveTextContent(
      '● 27/27 PIECES',
    )
  })

  it('draws no CTA at Unpack — S10 draws that one', async () => {
    today(1)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'unpack'),
    )
    renderCard(card, 'active')

    // `Continue unpack` would name F5, a screen that does not exist — the
    // retired `OPEN ›` failure one worse, an accent button lying about where
    // it goes.
    expect(screen.queryByTestId('packing-cta')).toBeNull()
    expect(screen.queryByRole('link', { name: /Continue/ })).toBeNull()
  })

  it('puts the progress line BELOW the NEXT line', async () => {
    today(1)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active', {
      progress: { packed: 48, total: 61, left: 13 },
    })

    // The order is the board's own sentence — `NEXT LINE SITS ABOVE THE
    // PROGRESS LINE.` — and §12.11 said "above" until the S6 round, so this
    // asserts DOM order rather than mere presence: the permanent obligation,
    // then the arithmetic, then the action.
    const next = screen.getByTestId('trip-next')
    const progress = screen.getByTestId('trip-progress')
    const cta = screen.getByTestId('packing-cta')
    expect(
      next.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      progress.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('states the count in words and the same fraction as a bar', async () => {
    today(1)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active', {
      progress: { packed: 48, total: 61, left: 13 },
    })

    const progress = screen.getByTestId('trip-progress')
    // Composed by `packedLabel`/`leftLabel`, which the packing view this
    // card's CTA opens draws its own head from: one Trip cannot read
    // `48/61` here and something else there.
    expect(progress).toHaveTextContent('● 48/61 PIECES')
    expect(progress).toHaveTextContent('13 LEFT')

    // The bar states the identical fact, so it is `aria-hidden` — a
    // `role="progressbar"` would announce one number twice.
    const bar = progress.querySelector('[aria-hidden="true"]')
    expect(bar).not.toBeNull()
    expect(bar?.firstElementChild).toHaveStyle({ inlineSize: '79%' })
  })

  it('draws no progress line when the caller hands none down', async () => {
    today(1)
    const card = await seeded(
      tripCreated(TRIP, 'Alps 2026'),
      tripPhaseMoved(TRIP, 'pack_out'),
    )
    renderCard(card, 'active')

    // Absence *is* the rule: `Trips.tsx` reads `packingTotals` for the active
    // section alone, so nothing here re-derives active-ness and the card
    // states no arithmetic it was not given.
    expect(screen.queryByTestId('trip-progress')).toBeNull()
    expect(screen.queryByText(/PIECES/)).toBeNull()
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
      'DRAFT · 0 ENTRIES',
    )
    // `0` is what `renderCard`'s own default hands down here; the next test
    // proves the number is read from that prop and not fixed at 0.
    expect(screen.getByTestId('phase-chip').textContent).not.toContain('DAY')
    // The line lands on every non-closed card, drafts included. It shipped
    // active-only, on the argument that it restates `0 ENTRIES`; that
    // redundancy is an accident of the count being zero and dies at
    // `DRAFT · 14 ENTRIES`.
    expect(screen.getByTestId('trip-next')).toHaveTextContent(
      'NEXT — BUILD THE GEAR LIST',
    )
    // The bare `›` moved into `BUILD LIST ›` below: no board draws both on
    // the same Draft card.
    expect(screen.queryByTestId('trip-chevron')).toBeNull()
  })

  it('renders · N ENTRIES from the prop, not from a store read', async () => {
    today(0)
    // The store holds no `trip.entry_*` ops for this Trip at all — `TripCard`
    // has no register or selector of its own that could produce `14`, so a
    // phase line reading it can only be echoing the prop `Trips.tsx` computed
    // with `listTotals` (spec §4.9's rule, and the debt note above it).
    const card = await seeded(tripCreated(TRIP, 'Vosges — Oct'))
    renderCard(card, 'planned', { entryCount: 14 })

    expect(screen.getByTestId('phase-line')).toHaveTextContent(
      'DRAFT · 14 ENTRIES',
    )
  })

  it('renders BUILD LIST › on a Draft card, named per-Trip for the AT rotor', async () => {
    today(0)
    const card = await seeded(tripCreated(TRIP, 'Vosges — Oct'))
    renderCard(card, 'planned')

    const buildList = screen.getByTestId('build-list-link')
    // Visible text stays the board's literal string; the accessible name is
    // overridden so a list of Draft cards doesn't announce `BUILD LIST ›`
    // identically for every one of them — `.card` is a nameless `<article>`
    // and the `<li>` around it is nameless too, so nothing else disambiguates.
    expect(buildList).toHaveTextContent('BUILD LIST ›')
    expect(buildList).toHaveAccessibleName('Build list for Vosges — Oct')
    expect(buildList.tagName).toBe('A')
    // Not the phase chip and not nested inside it or the surface link — three
    // siblings, per the docstring's own rule.
    expect(buildList).not.toBe(screen.getByTestId('phase-chip'))
  })

  it('is tappable end to end, with BUILD LIST as a second, visible link', async () => {
    today(0)
    const user = userEvent.setup()
    const opens = vi.fn()
    const card = await seeded(tripCreated(TRIP, 'Vosges — Oct'))
    const location = renderCard(card, 'planned', { onOpenPhase: opens })

    // `OPEN ›` stays retired: the whole card is still one tap target, and now
    // carries a second, visible one — `BUILD LIST ›`, discharging S6's
    // stated debt now that the builder exists.
    expect(screen.queryByText(/OPEN/)).toBeNull()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)

    const surface = screen.getByRole('link', { name: 'Open Vosges — Oct' })
    expect(surface).toHaveAttribute('href', `/trips/${TRIP}`)

    const buildList = screen.getByRole('link', {
      name: 'Build list for Vosges — Oct',
    })
    // `renderCard`'s own default — the below-Split answer `Trips.tsx` would
    // compute for this route.
    expect(buildList).toHaveAttribute('href', `/trips/${TRIP}`)

    // The chip sits on its own line here rather than beside the name, and is
    // carved out of the target exactly as the active card's is.
    await user.click(screen.getByTestId('phase-chip'))
    expect(opens).toHaveBeenCalledTimes(1)
    expect(location.history).toEqual(['/trips'])
  })

  it('renders BUILD LIST at whatever href it is given, not one computed here', async () => {
    today(0)
    // `TripCard` asks no media query of its own (F4 review) — the
    // Split-vs-below-Split choice is `Trips.tsx`'s, tested there. This proves
    // the link is a straight prop echo, the same shape as `entryCount`'s own
    // proof above: a string this component could not have derived itself.
    const card = await seeded(tripCreated(TRIP, 'Vosges — Oct'))
    renderCard(card, 'planned', {
      buildListHref: `/trips/${TRIP}/list?from=trips`,
    })

    expect(screen.getByTestId('build-list-link')).toHaveAttribute(
      'href',
      `/trips/${TRIP}/list?from=trips`,
    )
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

  /**
   * The other half of that, and the half the card had wrong: the glyph is
   * right on the *title line* and wrong in every sentence beside it. A
   * screen reader announcing `Open —` says "em dash" or says nothing, and
   * `ReopenConfirm` has titled the same Trip `Unnamed trip` since S6 — so
   * the two halves of one flow named it two different things.
   */
  it('speaks a nameless Trip in prose, while drawing it as the dash', async () => {
    today(0)
    const card = await seeded(tripCreated(TRIP, ''))
    renderCard(card, 'planned')

    expect(screen.getByTestId('trip-name')).toHaveTextContent('—')
    expect(
      screen.getByRole('link', { name: 'Open Unnamed trip' }),
    ).toBeVisible()
    expect(screen.getByTestId('build-list-link')).toHaveAccessibleName(
      'Build list for Unnamed trip',
    )
    // And nothing anywhere announces the mark itself.
    expect(screen.queryByRole('link', { name: /—/ })).toBeNull()
  })

  it('draws neither the progress line nor a CTA, whatever it is handed', async () => {
    today(0)
    const card = await seeded(tripCreated(TRIP, 'Vosges — Oct'))
    // Handed a count it must not draw. `Trips.tsx` never does this — the
    // point is that the two rules are separate facts and neither leans on
    // the other: a Draft's `● 0/59 PIECES` states progress against an
    // arrangement invariant 17 makes inert, and `Continue pack-out` is not
    // this Trip's verb.
    renderCard(card, 'planned', {
      entryCount: 14,
      progress: { packed: 0, total: 59, left: 59 },
    })

    expect(screen.queryByTestId('trip-progress')).toBeNull()
    expect(screen.queryByText(/PIECES/)).toBeNull()
    expect(screen.queryByTestId('packing-cta')).toBeNull()
    // `DRAFT · 14 ENTRIES` is the count that matters on this card, and it is
    // still here — the absence above is of the progress line, not of every
    // number.
    expect(screen.getByTestId('phase-line')).toHaveTextContent(
      'DRAFT · 14 ENTRIES',
    )
    expect(screen.getByTestId('build-list-link')).toBeVisible()
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
