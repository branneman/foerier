import {
  gearRecorded,
  tripCreated,
  tripDeleted,
  tripEntryAdded,
  tripEntryRemoved,
  type OpSpec,
} from '@foerier/shared'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { HouseholdProvider, type HouseholdStoreState } from '../household/store'
import { seededStore } from '../testUtils'
import { NoteComposer } from './NoteComposer'

afterEach(cleanup)

const TRIP = 'trip-alps'
const CHAIR = 'entry-chair'
const STOVE = 'entry-stove'

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
    gearRecorded('gear-stove', {
      name: 'Stove',
      container: false,
      kind: 'single',
    }),
    tripEntryAdded(TRIP, CHAIR, { from: 'depot', gearId: 'gear-chair' }),
    tripEntryAdded(TRIP, STOVE, { from: 'depot', gearId: 'gear-stove' }),
    ...specs,
  ])
}

function renderComposer(store: StoreApi<HouseholdStoreState>, trip = TRIP) {
  const { hook } = memoryLocation({ path: `/trips/${trip}/note` })
  render(
    <HouseholdProvider value={store}>
      <Router hook={hook}>
        {/* A real `<Route>`, because `useParams` reads the matched pattern —
            rendering the screen bare gives it no `:id` at all, and every
            assertion below would be against the `No such trip.` guard. */}
        <Route path="/trips/:id/note">
          <NoteComposer />
        </Route>
      </Router>
    </HouseholdProvider>,
  )
}

/** Every `trip.note_posted` this store has folded, in log order. */
function posted(store: StoreApi<HouseholdStoreState>) {
  return Object.values(store.getState().state.trips[TRIP]?.notes ?? {})
}

describe('the note composer — the gate (I9)', () => {
  it('withholds Post note until there is text', async () => {
    renderComposer(await seeded())

    expect(screen.getByRole('button', { name: 'Post note' })).toBeDisabled()
  })

  it('treats whitespace as empty', async () => {
    // I9 says it in as many words: whitespace is empty. A space bar tap is
    // not a note, and the trimmed text is what the op would carry anyway.
    renderComposer(await seeded())
    await userEvent.type(screen.getByRole('textbox', { name: 'Note' }), '   ')

    expect(screen.getByRole('button', { name: 'Post note' })).toBeDisabled()
  })

  it('opens the gate on real text', async () => {
    renderComposer(await seeded())
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Note' }),
      'Ran low on gas.',
    )

    expect(screen.getByRole('button', { name: 'Post note' })).toBeEnabled()
  })
})

describe('the note composer — return is a newline (I9)', () => {
  it('does not post on Enter, and keeps the newline', async () => {
    // `NewTrip` creates on return at a desk and `AddGear` records on it
    // unconditionally; both hold a name, where return can only mean *done*.
    // A Note is prose, and prose has paragraphs.
    const store = await seeded()
    renderComposer(store)
    const well = screen.getByRole('textbox', { name: 'Note' })
    await userEvent.type(well, 'First line{Enter}second line')

    expect(posted(store)).toHaveLength(0)
    expect(well).toHaveValue('First line\nsecond line')
  })
})

describe('the note composer — ABOUT (I10)', () => {
  it('defaults to the Trip and authors no entry_id', async () => {
    const store = await seeded()
    renderComposer(store)

    expect(
      screen.getByRole('button', { name: 'About: The trip' }),
    ).toBeInTheDocument()

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Note' }),
      'Warmer gloves.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Post note' }))

    expect(posted(store)).toHaveLength(1)
    expect(posted(store)[0]?.entryId).toBeUndefined()
  })

  it('carries the picked Entry into the one op', async () => {
    const store = await seeded()
    renderComposer(store)

    await userEvent.click(
      screen.getByRole('button', { name: 'About: The trip' }),
    )
    await userEvent.click(screen.getByRole('button', { name: /Camp chair/ }))

    expect(
      screen.getByRole('button', { name: 'About: Camp chair' }),
    ).toBeInTheDocument()

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Note' }),
      'Useless on gravel.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Post note' }))

    expect(posted(store)[0]?.entryId?.value).toBe(CHAIR)
    expect(posted(store)[0]?.text?.value).toBe('Useless on gravel.')
  })

  it('posts the trimmed text, not the typed whitespace', async () => {
    const store = await seeded()
    renderComposer(store)
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Note' }),
      '  Ran low on gas.  ',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Post note' }))

    expect(posted(store)[0]?.text?.value).toBe('Ran low on gas.')
  })

  it('closes on a selection and marks the current value', async () => {
    renderComposer(await seeded())
    await userEvent.click(
      screen.getByRole('button', { name: 'About: The trip' }),
    )
    await userEvent.click(screen.getByRole('button', { name: /Stove/ }))

    // A picker closes on a selection (`patterns.md` §4.2) — the sheet's own
    // rows are gone, and the row it left behind carries the value.
    expect(screen.queryByText('ONE ENTRY ON THIS TRIP, OR THE TRIP')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'About: Stove' }))
    expect(screen.getByText('● NOW')).toBeInTheDocument()
  })

  it('offers no Entry the gear list would not draw', async () => {
    // `entriesOf`'s own list: a tombstoned Entry is not a line anybody may
    // pick, exactly as it is not one anybody may see.
    renderComposer(await seeded(tripEntryRemoved(TRIP, CHAIR)))
    await userEvent.click(
      screen.getByRole('button', { name: 'About: The trip' }),
    )

    expect(screen.queryByRole('button', { name: /Camp chair/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Stove/ })).toBeInTheDocument()
  })

  it('falls back to the Trip when the chosen Entry is removed under it', async () => {
    // The reference is read back through `visibleEntry`, so a peer's removal
    // arriving while this screen is open cannot leave the composer holding a
    // row the gear list no longer draws.
    const store = await seeded()
    renderComposer(store)
    await userEvent.click(
      screen.getByRole('button', { name: 'About: The trip' }),
    )
    await userEvent.click(screen.getByRole('button', { name: /Camp chair/ }))
    await store.getState().emit(tripEntryRemoved(TRIP, CHAIR))

    expect(
      await screen.findByRole('button', { name: 'About: The trip' }),
    ).toBeInTheDocument()
  })
})

describe('the note composer — a Trip this replica has not folded', () => {
  it('says so rather than drawing a composer that posts nowhere', async () => {
    const store = await seededStore([])
    renderComposer(store)

    expect(screen.getByText('No such trip.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Post note' })).toBeNull()
  })

  /**
   * **A deleted Trip falls into the same state** (S14). `trip.deleted` writes
   * a register on an entity the fold *keeps*, so a guard testing `undefined`
   * alone goes on drawing a Trip the household has thrown away — the defect
   * the trip screen carried until S14, and every sub-route of a Trip carried
   * it too. `tripStandingOf` is the one place the question is asked; J5's two
   * sentences stay the trip screen's own, because a sub-route of a Trip that
   * is gone has nothing more to add.
   */
  it('says so for a deleted Trip too', async () => {
    renderComposer(await seeded(tripDeleted(TRIP)))

    expect(screen.getByText('No such trip.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Post note' })).toBeNull()
  })
})
