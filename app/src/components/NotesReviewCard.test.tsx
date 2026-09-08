import {
  gearRecorded,
  noteKeptOf,
  tripCreated,
  tripEntryAdded,
  tripNoteKept,
  tripNotePosted,
  tripPhaseMoved,
  type OpSpec,
} from '@foerier/shared'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { HouseholdProvider, type HouseholdStoreState } from '../household/store'
import { seededStore } from '../testUtils'
import { NotesReviewCard } from './NotesReviewCard'

afterEach(cleanup)

const TRIP = 'trip-alps'
const ENTRY = 'entry-chair'

async function seeded(
  ...specs: readonly OpSpec[]
): Promise<StoreApi<HouseholdStoreState>> {
  return seededStore([
    tripCreated(TRIP, 'Alps 2026'),
    gearRecorded('gear-chair', {
      name: 'Camp chair',
      container: false,
      kind: 'single',
    }),
    tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: 'gear-chair' }),
    ...specs,
  ])
}

function renderCard(store: StoreApi<HouseholdStoreState>) {
  render(
    <HouseholdProvider value={store}>
      <NotesReviewCard tripId={TRIP} />
    </HouseholdProvider>,
  )
}

function keptOf(store: StoreApi<HouseholdStoreState>, noteId: string) {
  const note = store.getState().state.trips[TRIP]?.notes?.[noteId]
  return note === undefined ? undefined : noteKeptOf(note)
}

describe('the F5 notes card — the band (I14)', () => {
  it('states the total, and TO REVIEW only while some are unreviewed', async () => {
    renderCard(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'Ran low on gas.'),
        tripNotePosted(TRIP, 'n2', 'Warmer gloves.'),
        tripNotePosted(TRIP, 'n3', 'The tarp leaks.'),
        tripNoteKept(TRIP, 'n3', true),
      ),
    )

    expect(screen.getByTestId('unpack-notes-count')).toHaveTextContent(
      '3 NOTES · 2 TO REVIEW',
    )
  })

  it('drops the TO REVIEW segment at zero, and keeps the total', async () => {
    // G3's rule: a zero count segment is absent, not written. The total is
    // not a segment — it is the band's subject, and it stays.
    renderCard(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'Ran low on gas.'),
        tripNoteKept(TRIP, 'n1', true),
      ),
    )

    const count = screen.getByTestId('unpack-notes-count')
    expect(count).toHaveTextContent('1 NOTE')
    expect(count).not.toHaveTextContent('TO REVIEW')
  })

  it('opens the same composer this screen came from (I20)', async () => {
    renderCard(await seeded())

    expect(screen.getByRole('link', { name: /post a note/i })).toHaveAttribute(
      'href',
      `/trips/${TRIP}/note`,
    )
  })
})

describe('the F5 notes card — the routes (I14)', () => {
  it('offers both routes on an unreviewed Note', async () => {
    renderCard(await seeded(tripNotePosted(TRIP, 'n1', 'Ran low on gas.')))
    const row = screen.getByRole('listitem')

    expect(
      within(row).getByRole('button', { name: 'KEEP' }),
    ).toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: 'DISCARD' }),
    ).toBeInTheDocument()
  })

  it('offers only the other route on a reviewed Note', async () => {
    // I14, and `patterns.md` §2.3 made structural: `KEEP` on a Note that is
    // already kept would author a register's own value again, moving the
    // stamp LWW compares. Here it is unreachable rather than discouraged.
    renderCard(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'Kept.'),
        tripNoteKept(TRIP, 'n1', true),
        tripNotePosted(TRIP, 'n2', 'Discarded.'),
        tripNoteKept(TRIP, 'n2', false),
      ),
    )
    const [kept, discarded] = screen.getAllByRole('listitem')

    expect(within(kept!).queryByRole('button', { name: 'KEEP' })).toBeNull()
    expect(
      within(kept!).getByRole('button', { name: 'DISCARD' }),
    ).toBeInTheDocument()
    expect(
      within(discarded!).queryByRole('button', { name: 'DISCARD' }),
    ).toBeNull()
    expect(
      within(discarded!).getByRole('button', { name: 'KEEP' }),
    ).toBeInTheDocument()
  })

  it('keeps and discards through the one op, and reverses a discard', async () => {
    const store = await seeded(tripNotePosted(TRIP, 'n1', 'Ran low on gas.'))
    renderCard(store)

    await userEvent.click(screen.getByRole('button', { name: 'DISCARD' }))
    expect(keptOf(store, 'n1')).toBe(false)

    await userEvent.click(await screen.findByRole('button', { name: 'KEEP' }))
    expect(keptOf(store, 'n1')).toBe(true)
  })

  it('strikes a discarded Note and leaves it counted and on screen', async () => {
    // I16: a discard costs the Note S14's template copy, not its place in
    // the record.
    renderCard(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'The tarp leaks.'),
        tripNoteKept(TRIP, 'n1', false),
      ),
    )

    expect(screen.getByText('The tarp leaks.')).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('· DISCARDED')
    expect(screen.getByTestId('unpack-notes-count')).toHaveTextContent('1 NOTE')
  })
})

describe('the F5 notes card — a closed Trip (I17)', () => {
  it('keeps both routes live, because invariant 19 freezes outcomes and not notes', async () => {
    // The card takes no `record` prop to be wrong about. §3.8's test is
    // whether an invariant closes the write, and none does — 19 and G6
    // freeze outcomes, 14 keeps notes as history, 16 locks nothing, and
    // story 12 says *mid-trip or after*.
    const store = await seeded(
      tripNotePosted(TRIP, 'n1', 'Posted in November.'),
      tripPhaseMoved(TRIP, 'closed'),
    )
    renderCard(store)

    await userEvent.click(screen.getByRole('button', { name: 'KEEP' }))

    expect(keptOf(store, 'n1')).toBe(true)
    expect(
      screen.getByRole('link', { name: /post a note/i }),
    ).toBeInTheDocument()
  })
})
