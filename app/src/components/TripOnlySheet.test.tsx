import { tripCreated } from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../household/opLog'
import {
  createHouseholdStore,
  HouseholdProvider,
  type HouseholdStoreState,
} from '../household/store'
import { anAuthor, noopEngine } from '../testUtils'
import { TripOnlySheet } from './TripOnlySheet'

/**
 * A **real** store, seeded by emitting a real `trip.created` — `PhaseSheet
 * .test.tsx`'s rule. The sheet itself never reads the Trip's state (it only
 * addresses `tripId`), but a Trip that exists is what every other caller of
 * this sheet hands it.
 */

const TRIP = 'tttttttt-0000-7000-8000-000000000012'

interface Seeded {
  store: StoreApi<HouseholdStoreState>
  /** The `trip.entry_added` ops emitted **since** the seed — the sheet's
   * whole output. */
  entryAdds: () => Promise<readonly unknown[]>
}

async function seededTrip(): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createHouseholdStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(tripCreated(TRIP, 'Alps 2026'))
  await store.getState().drained()

  const seededCount = (await entryAddOps(log)).length
  return {
    store,
    entryAdds: async () => (await entryAddOps(log)).slice(seededCount),
  }
}

async function entryAddOps(log: OpLog): Promise<readonly unknown[]> {
  const all = await log.all()
  return all
    .filter((entry) => entry.op.type === 'trip.entry_added')
    .map((entry) => entry.op.payload)
}

function renderSheet(seeded: Seeded) {
  let closed = 0
  render(
    <HouseholdProvider value={seeded.store}>
      <TripOnlySheet
        tripId={TRIP}
        onClose={() => {
          closed += 1
        }}
      />
    </HouseholdProvider>,
  )
  return { closes: () => closed }
}

describe('the trip-only entry sheet', () => {
  it('titles itself Trip-only entry', async () => {
    const seeded = await seededTrip()
    renderSheet(seeded)
    expect(
      screen.getByRole('dialog', { name: 'Trip-only entry' }),
    ).toBeVisible()
  })

  it('focuses Name on open, surviving Sheet’s own container focus', async () => {
    const seeded = await seededTrip()
    renderSheet(seeded)

    // `Sheet.tsx`'s own `onOpenAutoFocus` moves focus to the sheet container
    // first; a plain `autoFocus` on the field would be silently overridden by
    // it. This is the effect-timing fix's whole point, so it asserts the
    // field itself ends up focused rather than merely present.
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })

  it('gates Add entry on a non-empty name', async () => {
    const user = userEvent.setup()
    const seeded = await seededTrip()
    renderSheet(seeded)

    expect(screen.getByRole('button', { name: 'Add entry' })).toBeDisabled()

    await user.type(screen.getByLabelText('Name'), 'Camp table')
    expect(screen.getByRole('button', { name: 'Add entry' })).toBeEnabled()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), '   ')
    expect(screen.getByRole('button', { name: 'Add entry' })).toBeDisabled()
  })

  it('emits one trip.entry_added carrying name and container', async () => {
    const user = userEvent.setup()
    const seeded = await seededTrip()
    const sheet = renderSheet(seeded)

    await user.type(screen.getByLabelText('Name'), 'Camp table')
    await user.click(screen.getByRole('radio', { name: 'Container' }))
    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    await seeded.store.getState().drained()

    expect(await seeded.entryAdds()).toEqual([
      {
        entry_id: expect.any(String),
        source: { from: 'trip_only', name: 'Camp table', container: true },
      },
    ])
    expect(sheet.closes()).toBe(1)
  })

  it('mounts no tag chip and no tag picker', async () => {
    const seeded = await seededTrip()
    renderSheet(seeded)

    // Invariant 9: a trip-only Entry never carries a tag, and this sheet
    // imports neither the chip nor the picker that would let one land.
    expect(screen.queryByTestId('tag-chips')).toBeNull()
    expect(screen.queryByText(/tag/i)).toBeNull()
  })

  it('says nothing about renaming', async () => {
    const seeded = await seededTrip()
    renderSheet(seeded)

    // There is no `trip.entry_renamed`; stating that at creation is release
    // meta-text, so the sheet states only what is true (spec §4.6's bottom
    // fact line) and never what is missing.
    expect(screen.queryByText(/rename/i)).toBeNull()
  })

  it('states the trait fact and the not-kept fact, verbatim', async () => {
    const seeded = await seededTrip()
    renderSheet(seeded)

    expect(
      screen.getByText('CONTAINERS HOLD OTHER GEAR · FIXED WHEN RECORDED'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('NOT KEPT IN THE DEPOT · CLEARED AT CLOSE'),
    ).toBeInTheDocument()
  })

  it('resets its draft on remount', async () => {
    const user = userEvent.setup()
    const seeded = await seededTrip()

    const first = render(
      <HouseholdProvider value={seeded.store}>
        <TripOnlySheet tripId={TRIP} onClose={() => {}} />
      </HouseholdProvider>,
    )
    await user.type(screen.getByLabelText('Name'), 'Camp table')
    await user.click(screen.getByRole('radio', { name: 'Container' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Camp table')
    first.unmount()

    render(
      <HouseholdProvider value={seeded.store}>
        <TripOnlySheet tripId={TRIP} onClose={() => {}} />
      </HouseholdProvider>,
    )

    // Mount is the reset — `HomePicker`'s bug is what this proves absent
    // here: a reopened sheet holds neither the declined name nor the
    // declined trait.
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'Item' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Container' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Add entry' })).toBeDisabled()
  })
})
