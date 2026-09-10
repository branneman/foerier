import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../household/opLog'
import type { Refusal } from '../household/refusal'
import {
  createHouseholdStore,
  HouseholdProvider,
  type HouseholdStoreState,
} from '../household/store'
import { anAuthor, noopEngine } from '../testUtils'
import { RefusalSheet } from './RefusalSheet'

/**
 * The refusal sheet (`docs/design/README.md` §5n K24b) — what this Device
 * could not save, and the one act that applies to it.
 *
 * A real store, because the sheet reads the list and clears it: the
 * acknowledgement is the behaviour under test, not a prop it is handed.
 */

const AT = new Date('2026-09-10T14:32:00').getTime()

function aRefusal(over: Partial<Refusal> = {}): Refusal {
  return {
    id: 'refusal-1',
    at: AT,
    subject: 'Gas canister 450',
    reason: 'too-large',
    ops: 1,
    ...over,
  }
}

function renderSheet(refusals: readonly Refusal[]): {
  store: StoreApi<HouseholdStoreState>
  closes: () => number
} {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  store.setState({ refusals })

  let closed = 0
  render(
    <HouseholdProvider value={store}>
      <RefusalSheet
        onClose={() => {
          closed += 1
        }}
      />
    </HouseholdProvider>,
  )
  return { store, closes: () => closed }
}

describe('the refusal sheet', () => {
  it('names the subject and the cause, one line per refusal', () => {
    renderSheet([
      aRefusal(),
      aRefusal({
        id: 'refusal-2',
        subject: 'Tent Arpy 3',
        reason: 'not-saved',
      }),
    ])

    expect(
      screen.getByText('GAS CANISTER 450 — TOO LARGE TO SAVE'),
    ).toBeVisible()
    expect(screen.getByText('TENT ARPY 3 — STORAGE UNAVAILABLE')).toBeVisible()
  })

  /**
   * `emitAll` refuses a gesture **whole**, so a fourteen-op close is one thing
   * the Quartermaster did and one line — naming the act rather than the ops,
   * with the count riding it so the line never understates what went down.
   */
  it('draws a refused gesture as one line, not one per op', () => {
    renderSheet([
      aRefusal({
        subject: 'CLOSE TRIP · Alps 2026',
        ops: 14,
        reason: 'not-saved',
      }),
    ])

    expect(
      screen.getByText('CLOSE TRIP · ALPS 2026 — 14 OPS, NONE SAVED'),
    ).toBeVisible()
    // The cause the reason would have given is *replaced*, not appended: what
    // matters about a refused gesture is that none of it landed.
    expect(screen.queryByText(/STORAGE UNAVAILABLE/)).toBeNull()
  })

  it('states the count and the time, pinned at one', () => {
    renderSheet([aRefusal()])

    expect(screen.getByText('1 WRITE REFUSED · 14:32')).toBeVisible()
  })

  it('states both registers — the answer in ink, the recovery as a note', () => {
    renderSheet([aRefusal()])

    expect(
      screen.getByText(
        'This device could not save it. Nothing was sent to the household.',
      ),
    ).toBeVisible()
    expect(screen.getByText('Do it again to record it.')).toBeVisible()
  })

  /**
   * **No `Try again`, and its absence is the honest half.** The refused
   * payload is not kept, so a retry could only re-run a gesture whose inputs
   * are gone, or lie. The note above says the recovery instead.
   */
  it('offers no retry', () => {
    renderSheet([aRefusal()])

    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })

  /**
   * **Acknowledgement is the clearing act.** A marker that cleared itself —
   * on a timer, or on the next accepted write, which is what the store used
   * to do — would be a fact nobody read.
   */
  it('clears the marker on Close, and only there', async () => {
    const user = userEvent.setup()
    const { store, closes } = renderSheet([aRefusal()])

    expect(store.getState().refusals).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(store.getState().refusals).toEqual([])
    expect(closes()).toBe(1)
  })
})
