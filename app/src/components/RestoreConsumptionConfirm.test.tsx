import {
  gearOwnedCountSet,
  gearRecorded,
  tripConsumptionPosted,
  tripCreated,
  type TripState,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../household/opLog'
import {
  createHouseholdStore,
  HouseholdProvider,
  type HouseholdStoreState,
} from '../household/store'
import { anAuthor, noopEngine } from '../testUtils'
import { RestoreConsumptionConfirm } from './RestoreConsumptionConfirm'
import styles from './RestoreConsumptionConfirm.module.css'

/**
 * **The restoration offer** (spec §3) — pinned on its own, real store,
 * `ReopenConfirm.test.tsx`'s own rule: this component reads `postedOf` and
 * the Gear's owned count itself, so a hand-folded prop object would not
 * exercise what it actually renders.
 *
 * `GAS`'s own numbers throughout: owned ×6 before the close, a Bring-count
 * of 4 fully consumed, reduced to ×2 and posted ×4 — the spec §3 example
 * verbatim (`Put ×4 back on Gas canister 450?` / `GAS CANISTER 450 ×2 →
 * ×6`).
 */

const TRIP = 'tttttttt-0000-7000-8000-000000000021'
const GAS = 'gggggggg-0000-7000-8000-000000000021'

interface Seeded {
  store: StoreApi<HouseholdStoreState>
  trip: () => TripState
}

async function aReopenedTripOwingFour(name = 'Alps 2026'): Promise<Seeded> {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(
    gearRecorded(GAS, {
      name: 'Gas canister 450',
      container: false,
      kind: 'counted',
      owned_count: 6,
    }),
  )
  store.getState().emit(tripCreated(TRIP, name))
  // What a real close already applied — the reduction and its posting.
  store.getState().emit(gearOwnedCountSet(GAS, 2))
  store.getState().emit(tripConsumptionPosted(TRIP, GAS, 4))
  await store.getState().drained()
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

function renderConfirm(
  seeded: Seeded,
  props: {
    owed: number
    onCancel?: () => void
    onConfirm?: () => void
  },
) {
  render(
    <HouseholdProvider value={seeded.store}>
      <RestoreConsumptionConfirm
        trip={seeded.trip()}
        gearId={GAS}
        owed={props.owed}
        onCancel={props.onCancel ?? (() => {})}
        onConfirm={props.onConfirm ?? (() => {})}
      />
    </HouseholdProvider>,
  )
}

describe('the restoration offer', () => {
  it('titles the offer with what would go back, and states the trip and the arrow', async () => {
    const seeded = await aReopenedTripOwingFour()
    renderConfirm(seeded, { owed: 0 })

    const confirm = screen.getByRole('alertdialog', {
      name: 'Put ×4 back on Gas canister 450?',
    })
    expect(confirm).toHaveTextContent(
      'Alps 2026 lowered the owned count when it closed. It goes back to what it was before that close.',
    )
    expect(screen.getByText('GAS CANISTER 450 ×2 → ×6')).toBeInTheDocument()
  })

  it('offers Put it back and Leave it, Action above Cancel in the DOM', async () => {
    const seeded = await aReopenedTripOwingFour()
    renderConfirm(seeded, { owed: 0 })

    const putItBack = screen.getByRole('button', { name: 'Put it back' })
    const leaveIt = screen.getByRole('button', { name: 'Leave it' })
    expect(
      putItBack.compareDocumentPosition(leaveIt) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps the primary flush left and filled accent, sheet variant with a grabber', async () => {
    const seeded = await aReopenedTripOwingFour()
    renderConfirm(seeded, { owed: 0 })

    const button = screen.getByRole('button', { name: 'Put it back' })
    expect(button).toHaveClass(styles['primary']!)

    const confirm = screen.getByRole('alertdialog')
    expect(confirm.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('takes the decision on Put it back', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const seeded = await aReopenedTripOwingFour()
    renderConfirm(seeded, { owed: 0, onConfirm })

    await user.click(screen.getByRole('button', { name: 'Put it back' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('withdraws on Leave it without confirming', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const seeded = await aReopenedTripOwingFour()
    renderConfirm(seeded, { owed: 0, onCancel, onConfirm })

    await user.click(screen.getByRole('button', { name: 'Leave it' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  /**
   * `ui/Confirm` withholds scrim dismissal (Radix AlertDialog's default) —
   * `ContainerMoveConfirm.test.tsx`'s own pattern, transplanted: a decision
   * is not a picker, and this is the one the brief names explicitly.
   */
  it('does not dismiss on the scrim — a decision is not a picker', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const seeded = await aReopenedTripOwingFour()
    renderConfirm(seeded, { owed: 0, onCancel })

    const confirm = screen.getByRole('alertdialog')
    const scrim = confirm.previousElementSibling
    if (scrim === null) throw new Error('the confirm drew no scrim')
    await user.click(scrim)

    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const seeded = await aReopenedTripOwingFour()
    renderConfirm(seeded, { owed: 0, onCancel })

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  /**
   * A lowered Consumed-count, not a cleared outcome — `owed` is what
   * remains, never `0`. Read fresh off the fold rather than off a hand-typed
   * number, so a hand correction to the Depot since the close is disclosed
   * honestly (spec §3).
   */
  it('states a partial restoration when owed has fallen but not to zero', async () => {
    const seeded = await aReopenedTripOwingFour()
    renderConfirm(seeded, { owed: 2 })

    expect(
      screen.getByRole('alertdialog', {
        name: 'Put ×2 back on Gas canister 450?',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('GAS CANISTER 450 ×2 → ×4')).toBeInTheDocument()
  })
})
