import {
  authorOp,
  createHlcClock,
  emptyState,
  fold,
  tripCreated,
  tripPhaseMoved,
  type OpAuthor,
  type OpSpec,
  type TripState,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ReopenConfirm } from './ReopenConfirm'

/**
 * The confirm has **two** callers — the SET PHASE sheet and the Trips list's
 * closed ledger row — so its copy is pinned here rather than at either of
 * them. That is the whole reason it is its own module: a second copy of a
 * confirmation is how two copies of its copy drift apart.
 *
 * A real `TripState` from a real fold, per `depot/trips.test.ts`'s rule: a
 * hand-shaped register would let this pass against a state the reducer cannot
 * produce.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const TRIP = 'tttttttt-0000-7000-8000-000000000001'

let nextId = 0

function anAuthor(): OpAuthor {
  return {
    household_id: HOUSEHOLD,
    device_id: DEVICE,
    ids: {
      next: () =>
        `eeeeeeee-0000-7000-8000-${(nextId++).toString(16).padStart(12, '0')}`,
    },
    hlc: createHlcClock({ now: () => 1_700_000_000_000 }),
  }
}

function aClosedTrip(name = 'Tessin 2025'): TripState {
  const author = anAuthor()
  const specs: readonly OpSpec[] = [
    tripCreated(TRIP, name),
    tripPhaseMoved(TRIP, 'closed'),
  ]
  const state = fold(
    specs.map((spec) => authorOp(author, spec)),
    emptyState(),
  )
  return state.trips[TRIP]!
}

describe('the reopen confirm', () => {
  it('ships the boards title and its second line, and nothing else', () => {
    render(
      <ReopenConfirm
        trip={aClosedTrip()}
        to="unpack"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )

    const confirm = screen.getByRole('alertdialog')
    // Word for word from `Screens B` §02B. The two mono blocks the board
    // draws beneath need S10's outcomes and S7's Entries; this assertion on
    // the whole text is what says neither is faked and neither is stubbed.
    expect(confirm.textContent).toBe(
      'Reopen Tessin 2025?It returns to Unpack exactly as it stood. Closing cleared nothing.CancelReopen',
    )
  })

  it('names the phase the move actually goes to, in sentence case', () => {
    render(
      <ReopenConfirm
        trip={aClosedTrip()}
        to="pack_out"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )

    // `Pack-out`, not `PACK-OUT` and not `Pack out`: the phase table carries
    // the sentence-case name beside the mono label precisely because no
    // casing function gets both right.
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'It returns to Pack-out exactly as it stood.',
    )
  })

  it('titles a nameless Trip with the dash tripLabel reads it as', () => {
    render(
      <ReopenConfirm
        trip={aClosedTrip('')}
        to="unpack"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )

    // `tripLabel` is the one place a Trip's name is decided; a raw `''` here
    // would render `Reopen ?`.
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Reopen —?')
  })

  it('decides only on the primary, and withdraws on Cancel', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ReopenConfirm
        trip={aClosedTrip()}
        to="unpack"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('runs the move when the decision is taken', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ReopenConfirm
        trip={aClosedTrip()}
        to="unpack"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
