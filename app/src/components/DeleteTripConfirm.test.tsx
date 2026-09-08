import {
  gearRecorded,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripNoteKept,
  tripNotePosted,
  tripOutcomeSet,
  tripParticipantAdded,
  tripPhaseMoved,
  tripTaskAdded,
  type HouseholdState,
  type OpSpec,
  type TripState,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { inMemoryOpLog } from '../household/opLog'
import { createHouseholdStore } from '../household/store'
import { anAuthor, noopEngine } from '../testUtils'
import { DeleteTripConfirm } from './DeleteTripConfirm'

/**
 * **The delete confirm** (rulings J2, J3). Its counts come from four
 * selectors that already own them, so what is worth pinning here is not the
 * arithmetic but the *presentation rules*: which lines appear, in which
 * order, which vanish at zero, and what the two prose slots say.
 *
 * A real store seeded with real ops, as every confirm test here does — a
 * hand-shaped `TripState` would let the block assert a shape the reducer
 * never produces.
 */

const TRIP = 'tttttttt-0000-7000-8000-000000000001'
const GEAR = 'gggggggg-0000-7000-8000-000000000001'
const LAMP = 'gggggggg-0000-7000-8000-000000000002'
const PERSON = 'pppppppp-0000-7000-8000-000000000001'

async function seeded(...specs: readonly OpSpec[]) {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const state: HouseholdState = store.getState().state
  return { state, trip: state.trips[TRIP] as TripState }
}

/** A Trip with something in every one of the four slots. */
async function aLoadedTrip() {
  return seeded(
    personRecorded(PERSON, 'Els'),
    gearRecorded(GEAR, { name: 'Tent', container: false, kind: 'single' }),
    gearRecorded(LAMP, { name: 'Headlamp', container: false, kind: 'counted' }),
    tripCreated(TRIP, 'Tessin 2025'),
    tripParticipantAdded(TRIP, PERSON),
    tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: GEAR }),
    tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: LAMP }),
    tripEntryBringCountSet(TRIP, 'e-lamp', 3),
    tripTaskAdded(TRIP, 'k-1', 'Book the hut'),
    tripTaskAdded(TRIP, 'k-2', 'Renew the DAV cards'),
    tripNotePosted(TRIP, 'n-1', 'The pole sleeve is splitting.'),
    tripNotePosted(TRIP, 'n-2', 'Bring the small pump.'),
    // Discarded, and still counted — a discarded Note never vanishes (I16).
    tripNoteKept(TRIP, 'n-2', false),
    tripPhaseMoved(TRIP, 'unpack'),
    tripOutcomeSet(TRIP, 'e-tent', 'lost'),
    tripOutcomeSet(TRIP, 'e-lamp', 'back'),
  )
}

function renderConfirm(
  trip: TripState,
  state: HouseholdState,
  handlers: { onCancel?: () => void; onConfirm?: () => void } = {},
) {
  render(
    <DeleteTripConfirm
      trip={trip}
      state={state}
      onCancel={handlers.onCancel ?? (() => undefined)}
      onConfirm={handlers.onConfirm ?? (() => undefined)}
    />,
  )
}

describe('DeleteTripConfirm', () => {
  it('states the four lines in the trip screen`s order, outcomes last', async () => {
    const { trip, state } = await aLoadedTrip()
    renderConfirm(trip, state)

    // TASKS · NOTES · GEAR LIST is the order that screen stacks them in;
    // outcomes go last because they are the one register it does not carry.
    //
    // `4 OUTCOMES` from two Entries, because `unpackTotals` counts **units**
    // rather than lines — the Counted headlamp at ×3 plus the tent. That is
    // F5's own arithmetic (`56/62 RESOLVED`), and the reason this line says
    // OUTCOMES rather than ENTRIES: the two numbers beside each other in
    // this block are deliberately counting different things.
    expect(
      screen.getAllByTestId('delete-fact').map((node) => node.textContent),
    ).toEqual([
      '2 TASKS',
      '2 NOTES',
      '2 ENTRIES · 4 PIECES',
      '4 OUTCOMES · 1 LOST',
    ])
  })

  it('counts a discarded Note, which never vanishes', async () => {
    const { trip, state } = await aLoadedTrip()
    renderConfirm(trip, state)
    // Both notes, though one is discarded — ruling I16, read through
    // `noteCounts(...).total` rather than a filter of our own.
    expect(screen.getByText('2 NOTES')).toBeVisible()
  })

  it('omits a segment at zero rather than writing it', async () => {
    const { trip, state } = await seeded(
      gearRecorded(GEAR, { name: 'Tent', container: false, kind: 'single' }),
      tripCreated(TRIP, 'Tessin 2025'),
      tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: GEAR }),
    )
    renderConfirm(trip, state)

    // Ruling G3. One line, and no `0 TASKS`, no `0 NOTES`, no outcomes line.
    expect(
      screen.getAllByTestId('delete-fact').map((node) => node.textContent),
    ).toEqual(['1 ENTRIES · 1 PIECES'])
  })

  it('draws no block at all on an empty Draft', async () => {
    const { trip, state } = await seeded(tripCreated(TRIP, 'Tessin 2025'))
    renderConfirm(trip, state)

    expect(screen.queryAllByTestId('delete-fact')).toHaveLength(0)
    // Both fillers were drawn and refused: three zero segments four rounds
    // after G3 ruled one absent, and a line whose only job is to occupy the
    // slot they vacated while saying less than the title already does.
    expect(screen.queryByText('NOTHING RECORDED YET')).toBeNull()
    expect(screen.queryByText(/0 ENTRIES/)).toBeNull()
  })

  it('titles with the prose sentinel for a Trip with no name', async () => {
    // A title is a sentence, so `—` is wrong here even though it is right in
    // the ledger row one screen over (§5c).
    const { trip, state } = await seeded(tripParticipantAdded(TRIP, PERSON))
    renderConfirm(trip, state)

    expect(screen.getByText('Delete Unnamed trip?')).toBeVisible()
  })

  it('answers in ink and explains in the note', async () => {
    const { trip, state } = await aLoadedTrip()
    renderConfirm(trip, state)

    // `Confirm`'s two prose slots — the split ruling H9 added them for. The
    // first is the literal truth of the catalogue: `trip.deleted` has no
    // partner, and this sentence must not hint that one might arrive.
    expect(
      screen.getByText('Permanent. No route puts a trip back.'),
    ).toBeVisible()
    expect(
      screen.getByText(
        'The depot is untouched. An entry lists gear; it never holds it.',
      ),
    ).toBeVisible()
  })

  it('writes none of the strings the round refused', async () => {
    const { trip, state } = await aLoadedTrip()
    renderConfirm(trip, state)

    expect(screen.queryByText(/Are you sure/i)).toBeNull()
    expect(screen.queryByText(/will be lost/i)).toBeNull()
    // No ▲: the glyph is for a confirm whose action can discard *unsynced*
    // work, which sign-out-this-device is the only one of. A tombstone syncs.
    expect(screen.queryByText('▲')).toBeNull()
  })

  // Two renders rather than two clicks in one: `Confirm.Action` closes the
  // dialog on click, which fires `onClose` — so a single mounted confirm
  // reports both a confirm and a close, and the caller unmounts it either
  // way. Asserting them apart is what the caller actually sees.
  it('reports the decision through onConfirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const { trip, state } = await aLoadedTrip()
    renderConfirm(trip, state, { onConfirm })

    await user.click(screen.getByRole('button', { name: 'Delete trip' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('reports a refusal through onCancel, and never as a decision', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { trip, state } = await aLoadedTrip()
    renderConfirm(trip, state, { onConfirm, onCancel })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
