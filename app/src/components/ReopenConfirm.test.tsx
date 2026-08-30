import {
  createHlcClock,
  gearRecorded,
  tripCreated,
  tripEntryAdded,
  tripPhaseMoved,
  type Clock,
  type IdSource,
  type OpAuthor,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { ReopenConfirm } from './ReopenConfirm'
import styles from './ReopenConfirm.module.css'

/**
 * The confirm has **two** callers — the SET PHASE sheet and the Trips list's
 * closed ledger row — so its copy is pinned here rather than at either of
 * them. That is the whole reason it is its own module: a second copy of a
 * confirmation is how two copies of its copy drift apart.
 *
 * A **real** store, seeded by emitting real ops (`PhaseSheet.test.tsx`'s own
 * rule, and now load-bearing rather than optional here): Task 14 gives this
 * component its own `useDepot` reads, for `overClaimsIfActive` and for the
 * settle routes' emits, so every render needs a `DepotProvider` above it —
 * not only a hand-folded `TripState` passed in as a prop.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const TRIP = 'tttttttt-0000-7000-8000-000000000001'
const OTHER_TRIP = 'tttttttt-0000-7000-8000-000000000002'
const GEAR = 'gggggggg-0000-7000-8000-000000000001'

let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

function fixedClock(): Clock {
  return { now: () => 1_700_000_000_000 }
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

async function aClosedTrip(name = 'Tessin 2025'): Promise<Seeded> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(tripCreated(TRIP, name))
  store.getState().emit(tripPhaseMoved(TRIP, 'closed'))
  await store.getState().drained()
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

/**
 * `TRIP` closed while holding the same Single Gear as an already-active
 * `OTHER_TRIP` — `overClaimsIfActive` reports this pair the moment `TRIP` is
 * asked to reopen, exactly as `claim.test.ts`'s "reports a clash a closed
 * Trip would cause on reopening" case does at the selector tier.
 */
async function aClosedTripClash(): Promise<Seeded> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(
    gearRecorded(GEAR, {
      name: 'Tent, tunnel 4p',
      container: false,
      kind: 'single',
    }),
  )
  store.getState().emit(tripCreated(TRIP, 'Tessin 2025'))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-here', { from: 'depot', gearId: GEAR }))
  store.getState().emit(tripPhaseMoved(TRIP, 'closed'))
  store.getState().emit(tripCreated(OTHER_TRIP, 'Alps 2026'))
  store.getState().emit(tripPhaseMoved(OTHER_TRIP, 'pack_out'))
  store
    .getState()
    .emit(
      tripEntryAdded(OTHER_TRIP, 'e-other', { from: 'depot', gearId: GEAR }),
    )
  await store.getState().drained()
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

function renderConfirm(
  seeded: Seeded,
  props: {
    to: PhaseKey
    onCancel?: () => void
    onConfirm?: () => void
  },
) {
  render(
    <DepotProvider value={seeded.store}>
      <ReopenConfirm
        trip={seeded.trip()}
        to={props.to}
        onCancel={props.onCancel ?? (() => {})}
        onConfirm={props.onConfirm ?? (() => {})}
      />
    </DepotProvider>,
  )
}

describe('the reopen confirm', () => {
  it('ships the boards title and its second line, and nothing else', async () => {
    const seeded = await aClosedTrip()
    renderConfirm(seeded, { to: 'unpack' })

    const confirm = screen.getByRole('alertdialog')
    // Word for word from `Screens B` §02B. The one mono block the board
    // draws beneath still needs S10's outcomes; this assertion on the whole
    // text is what says it is neither faked nor stubbed.
    expect(confirm.textContent).toBe(
      'Reopen Tessin 2025?It returns to Unpack exactly as it stood. Closing cleared nothing.ReopenCancel',
    )
  })

  it('names the phase the move actually goes to, in sentence case', async () => {
    const seeded = await aClosedTrip()
    renderConfirm(seeded, { to: 'pack_out' })

    // `Pack-out`, not `PACK-OUT` and not `Pack out`: the phase table carries
    // the sentence-case name beside the mono label precisely because no
    // casing function gets both right.
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'It returns to Pack-out exactly as it stood.',
    )
  })

  it('titles a nameless Trip with the dash tripLabel reads it as', async () => {
    const seeded = await aClosedTrip('')
    renderConfirm(seeded, { to: 'unpack' })

    // `tripLabel` is the one place a Trip's name is decided; a raw `''` here
    // would render `Reopen ?`.
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Reopen —?')
  })

  it('decides only on the primary, and withdraws on Cancel', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const seeded = await aClosedTrip()
    renderConfirm(seeded, { to: 'unpack', onCancel, onConfirm })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('runs the move when the decision is taken', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const seeded = await aClosedTrip()
    renderConfirm(seeded, { to: 'unpack', onConfirm })

    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('renders the over-claim block in the reopen confirm', async () => {
    const seeded = await aClosedTripClash()
    renderConfirm(seeded, { to: 'unpack' })

    const confirm = screen.getByRole('alertdialog')
    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 1 entry is already claimed by Alps 2026.',
    )
    expect(screen.getByTestId('over-claim-row-' + GEAR)).toHaveTextContent(
      'Tent, tunnel 4p',
    )
    // The block sits above the body line, `Confirm`'s own `children` slot —
    // still present and still true beside it.
    expect(confirm).toHaveTextContent(
      'It returns to Unpack exactly as it stood. Closing cleared nothing.',
    )
  })

  it('renders no ENTRY STILL OPEN block — that needs outcomes', async () => {
    const seeded = await aClosedTripClash()
    renderConfirm(seeded, { to: 'unpack' })

    // `1 ENTRY STILL OPEN — HEADLAMP, K · ▲ LOST` is S10's: outcomes do not
    // exist yet, so nothing here fakes or stubs the mono line that would
    // read them.
    expect(screen.queryByText(/ENTRY STILL OPEN/)).toBeNull()
    expect(screen.queryByText(/LOST/)).toBeNull()
  })

  it('keeps the reopen primary flush left and filled accent', async () => {
    const seeded = await aClosedTrip()
    renderConfirm(seeded, { to: 'unpack' })

    const button = screen.getByRole('button', { name: 'Reopen' })
    expect(button).toHaveClass(styles['primary']!)
  })

  it('renders the sheet variant, with a grabber, not the card default', async () => {
    const seeded = await aClosedTrip()
    renderConfirm(seeded, { to: 'unpack' })

    // Task 14 review F6: `toHaveClass(styles['primary'])` alone covers
    // `flex: 1` and the accent background, but says nothing about the
    // variant — a regression to the `card` default draws the whole body in
    // attention-amber mono (`.descriptionCard`) and would still pass that
    // assertion. The grabber (`Confirm.tsx`'s own
    // `{sheet && <span aria-hidden="true" .../>}`) renders only under
    // `variant="sheet"`, so its presence is what actually pins the variant.
    const confirm = screen.getByRole('alertdialog')
    expect(confirm.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('reopens into draft without drawing an over-claim block', async () => {
    const seeded = await aClosedTripClash()
    renderConfirm(seeded, { to: 'draft' })

    // Invariant 17: drafts overlap freely. `TRIP` and `OTHER_TRIP` clash the
    // moment either is active, but reopening into `draft` activates
    // nothing — asking `overClaimsIfActive` anyway would draw a warning
    // about a conflict this move does not create (Task 14 review F2).
    expect(screen.queryByTestId('over-claim-attention')).toBeNull()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'It returns to Draft exactly as it stood. Closing cleared nothing.',
    )
  })
})
