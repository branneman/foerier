import {
  gearRecorded,
  tripCreated,
  tripEntryAdded,
  tripEntryRemoved,
  tripNoteKept,
  tripNotePosted,
  tripPhaseMoved,
  type OpSpec,
} from '@foerier/shared'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { HouseholdProvider, type HouseholdStoreState } from '../household/store'
import { seededStore } from '../testUtils'
import { NotesPanel } from './NotesPanel'

afterEach(cleanup)

const TRIP = 'trip-alps'
const ENTRY = 'entry-chair'
const GEAR = 'gear-chair'

/**
 * A **real** store, seeded by emitting real ops — `OverClaimBand.test.tsx`'s
 * rule: what this panel draws is a fold of registers, so hand-shaping a
 * `NoteView` would test a shape the reducer might never produce.
 */
async function seeded(
  ...specs: readonly OpSpec[]
): Promise<StoreApi<HouseholdStoreState>> {
  return seededStore([
    tripCreated(TRIP, 'Alps 2026'),
    gearRecorded(GEAR, {
      name: 'Camp chair',
      container: false,
      kind: 'single',
    }),
    tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR }),
    ...specs,
  ])
}

function renderPanel(store: StoreApi<HouseholdStoreState>) {
  render(
    <HouseholdProvider value={store}>
      <NotesPanel tripId={TRIP} />
    </HouseholdProvider>,
  )
}

describe('the NOTES panel — the band (I3, I6)', () => {
  it('draws the band and the composer link with no notes at all', async () => {
    // I6: the band stays in every state. The gear list's may go empty
    // because it carries doors; this one carries a label and a composer.
    renderPanel(await seeded())

    expect(screen.getByText('NOTES')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /post a note/i })).toHaveAttribute(
      'href',
      `/trips/${TRIP}/note`,
    )
  })

  it('withholds the count at zero and states it above zero', async () => {
    // I3, and ruling G3's rule: a zero segment is absent, not written.
    renderPanel(await seeded())
    expect(screen.queryByTestId('notes-count')).not.toBeInTheDocument()

    cleanup()
    renderPanel(await seeded(tripNotePosted(TRIP, 'n1', 'Ran low on gas.')))
    expect(screen.getByTestId('notes-count')).toHaveTextContent('1 NOTE')

    cleanup()
    renderPanel(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'Ran low on gas.'),
        tripNotePosted(TRIP, 'n2', 'Warmer gloves.'),
      ),
    )
    expect(screen.getByTestId('notes-count')).toHaveTextContent('2 NOTES')
  })

  it('counts a discarded Note in the band', async () => {
    // I16: a discard costs the Note S14's template copy, not its place in
    // the record — so the band still says two.
    renderPanel(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'Ran low on gas.'),
        tripNotePosted(TRIP, 'n2', 'Warmer gloves.'),
        tripNoteKept(TRIP, 'n2', false),
      ),
    )

    expect(screen.getByTestId('notes-count')).toHaveTextContent('2 NOTES')
  })
})

describe('the NOTES panel — the empty state (I18)', () => {
  it('states the permanent domain fact, not a promise', async () => {
    renderPanel(await seeded())

    expect(screen.getByText('0 NOTES.')).toBeInTheDocument()
    expect(
      screen.getByText('Notes are reviewed at the unpack pass.'),
    ).toBeInTheDocument()
  })
})

describe('the NOTES panel — a row (I11, I13, I16)', () => {
  it('draws the text whole, over the posting clock', async () => {
    renderPanel(
      await seeded(tripNotePosted(TRIP, 'n1', 'Ran low on gas by day 2.')),
    )

    expect(screen.getByText('Ran low on gas by day 2.')).toBeInTheDocument()
    // `app/vitest.config.ts` pins TZ=Europe/Amsterdam, so the local-time
    // rendering is assertable at all — under UTC this would pass against the
    // bug it exists to catch (S5's lesson).
    expect(screen.getByRole('listitem')).toHaveTextContent(
      /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
    )
  })

  it('names the Entry a Note is about, and says nothing when it is about the Trip', async () => {
    renderPanel(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'Useless on gravel.', ENTRY),
        tripNotePosted(TRIP, 'n2', 'Warmer gloves.'),
      ),
    )
    const [about, standalone] = screen.getAllByRole('listitem')

    expect(about).toHaveTextContent('ABOUT: CAMP CHAIR')
    expect(standalone).not.toHaveTextContent('ABOUT:')
  })

  it('keeps reading after the Entry it is about is removed', async () => {
    // I10: the reference is an id, and an Entry's tombstone says nothing
    // about a sentence somebody wrote. The name goes with the Entry; the
    // Note does not.
    renderPanel(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'Useless on gravel.', ENTRY),
        tripEntryRemoved(TRIP, ENTRY),
      ),
    )

    expect(screen.getByText('Useless on gravel.')).toBeInTheDocument()
  })

  it('appends KEPT, and strikes a discarded Note without removing it', async () => {
    renderPanel(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'Bring more gas.'),
        tripNoteKept(TRIP, 'n1', true),
        tripNotePosted(TRIP, 'n2', 'The tarp leaks.'),
        tripNoteKept(TRIP, 'n2', false),
        tripNotePosted(TRIP, 'n3', 'Warmer gloves.'),
      ),
    )
    const [kept, discarded, unreviewed] = screen.getAllByRole('listitem')

    expect(kept).toHaveTextContent('· KEPT')
    expect(discarded).toHaveTextContent('· DISCARDED')
    expect(discarded).toBeInTheDocument()
    // I13: unreviewed draws plain — neither word.
    expect(unreviewed).not.toHaveTextContent('KEPT')
    expect(unreviewed).not.toHaveTextContent('DISCARDED')
  })

  it('lists oldest first', async () => {
    renderPanel(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'First.'),
        tripNotePosted(TRIP, 'n2', 'Second.'),
      ),
    )
    const [first, second] = screen.getAllByRole('listitem')

    expect(within(first!).getByText('First.')).toBeInTheDocument()
    expect(within(second!).getByText('Second.')).toBeInTheDocument()
  })

  it('draws no Note this replica has folded without text', async () => {
    // A peer's review landing before the post it addresses. The reducer
    // folds it; `notesOf` is what leaves it off the screen.
    renderPanel(await seeded(tripNoteKept(TRIP, 'n-ghost', true)))

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText('0 NOTES.')).toBeInTheDocument()
  })
})

describe('the NOTES panel — a closed Trip (I17)', () => {
  it('draws whole, composer included', async () => {
    // §3.8's test is *does an invariant close the write*, and none does: 19
    // and G6 freeze outcomes, 14 keeps notes as history, 16 locks nothing,
    // and story 12 says *or after*. This is the test that fails the day
    // somebody reaches for F5's `record` prop by analogy.
    renderPanel(
      await seeded(
        tripNotePosted(TRIP, 'n1', 'Bring more gas.'),
        tripPhaseMoved(TRIP, 'closed'),
      ),
    )

    expect(screen.getByText('Bring more gas.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /post a note/i })).toHaveAttribute(
      'href',
      `/trips/${TRIP}/note`,
    )
  })
})
