import {
  createHlcClock,
  tripCreated,
  tripPhaseMoved,
  type Clock,
  type IdSource,
  type OpAuthor,
  type PhaseValue,
  type TripState,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { PhaseSheet } from './PhaseSheet'

/**
 * A **real** store, seeded by emitting real ops — `OwnerPicker.test.tsx`'s
 * rule. The seed matters more here than in the other pickers: a phase only
 * ever arrives as a `trip.phase_moved`, so a hand-shaped register would test a
 * state the reducer cannot produce and would hide the very thing `DAY N`
 * reads, which is the register's own stamp.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const TRIP = 'tttttttt-0000-7000-8000-000000000001'

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
  /** The phases moved to **since** the seed — the sheet's whole output. */
  moves: () => Promise<readonly unknown[]>
}

async function seededTrip(
  phase: PhaseValue,
  name = 'Alps 2026',
): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(tripCreated(TRIP, name))
  // `draft` is the reducer's own doing at `trip.created` (spec §1.3), so
  // seeding it again would put an op in the log the app never authors.
  if (phase !== 'draft') store.getState().emit(tripPhaseMoved(TRIP, phase))
  await store.getState().drained()

  const seeded = (await phaseMoves(log)).length
  return {
    store,
    trip: () => store.getState().state.trips[TRIP]!,
    moves: async () => (await phaseMoves(log)).slice(seeded),
  }
}

async function phaseMoves(log: OpLog): Promise<readonly unknown[]> {
  const all = await log.all()
  return all
    .filter((entry) => entry.op.type === 'trip.phase_moved')
    .map((entry) => entry.op.payload['phase'])
}

function renderSheet(seeded: Seeded) {
  let closed = 0
  render(
    <DepotProvider value={seeded.store}>
      <PhaseSheet
        trip={seeded.trip()}
        onClose={() => {
          closed += 1
        }}
      />
    </DepotProvider>,
  )
  return { closes: () => closed }
}

function rowLabels(): (string | null)[] {
  return screen
    .getAllByTestId('phase-row')
    .map((row) => row.firstElementChild?.textContent ?? null)
}

/** The label of the row carrying `● NOW`, or `null` when none does. */
function markedRow(): string | null {
  const marked = screen
    .getAllByTestId('phase-row')
    .filter((row) => row.textContent?.includes('● NOW') === true)
  return marked[0]?.firstElementChild?.textContent ?? null
}

describe('the SET PHASE sheet', () => {
  it('lists the five phases in PHASES order', async () => {
    const seeded = await seededTrip('pack_out')
    renderSheet(seeded)
    expect(rowLabels()).toEqual([
      'DRAFT',
      'PACK-OUT',
      'ON TRIP',
      'UNPACK',
      'CLOSED',
    ])
  })

  it('marks the current phase, and states the rule that moves one', async () => {
    const seeded = await seededTrip('pack_out')
    renderSheet(seeded)

    expect(markedRow()).toBe('PACK-OUT')
    expect(screen.getByRole('button', { name: /PACK-OUT/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The board's footnote, verbatim — the sheet is the only place the app
    // says out loud that nothing else moves a phase.
    expect(
      screen.getByText('NO DATE OR COUNT EVER MOVES A PHASE.'),
    ).toBeVisible()
  })

  it('moves backwards, which is the point of the sheet', async () => {
    const user = userEvent.setup()
    const seeded = await seededTrip('on_trip')
    const { closes } = renderSheet(seeded)

    // "We had left" until the duffel turns out to be still in the hall.
    await user.click(screen.getByRole('button', { name: /PACK-OUT/ }))
    await seeded.store.getState().drained()

    expect(await seeded.moves()).toEqual(['pack_out'])
    expect(closes()).toBe(1)
  })

  it('closes a Trip without asking anything', async () => {
    const user = userEvent.setup()
    const seeded = await seededTrip('unpack')
    renderSheet(seeded)

    await user.click(screen.getByRole('button', { name: /CLOSED/ }))
    await seeded.store.getState().drained()

    // Unguarded on purpose, and honest rather than provisional: the close
    // gate counts open outcomes (invariant 18) and nothing can be open until
    // S10. A stub gate would be a lie about what the app checks.
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await seeded.moves()).toEqual(['closed'])
  })

  it('writes nothing when the current phase is tapped', async () => {
    const user = userEvent.setup()
    const seeded = await seededTrip('pack_out')
    const { closes } = renderSheet(seeded)

    await user.click(screen.getByRole('button', { name: /PACK-OUT/ }))
    await seeded.store.getState().drained()

    // `DAY N` is the phase register's own stamp, so a redundant move would
    // silently reset a trip on `DAY 12` to `DAY 1`. The sheet just closes.
    expect(await seeded.moves()).toEqual([])
    expect(closes()).toBe(1)
  })

  describe('leaving CLOSED', () => {
    it('confirms first, in the boards words and nothing else', async () => {
      const user = userEvent.setup()
      const seeded = await seededTrip('closed')
      renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /UNPACK/ }))

      const confirm = screen.getByRole('alertdialog')
      expect(confirm).toHaveTextContent('Reopen Alps 2026?')
      expect(confirm).toHaveTextContent(
        'It returns to Unpack exactly as it stood. Closing cleared nothing.',
      )
      // The two mono blocks the board draws under that line are S10's
      // outcomes and S7's over-claim. Neither is faked or stubbed here, and
      // this assertion is what says so: the confirm holds its title, its one
      // line and its two buttons, and nothing more.
      expect(confirm.textContent).toBe(
        'Reopen Alps 2026?It returns to Unpack exactly as it stood. Closing cleared nothing.CancelReopen',
      )
      expect(await seeded.moves()).toEqual([])
    })

    it('moves only once the decision is taken', async () => {
      const user = userEvent.setup()
      const seeded = await seededTrip('closed')
      renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /UNPACK/ }))
      await user.click(screen.getByRole('button', { name: 'Reopen' }))
      await seeded.store.getState().drained()

      expect(await seeded.moves()).toEqual(['unpack'])
    })

    it('writes nothing when the decision is declined', async () => {
      const user = userEvent.setup()
      const seeded = await seededTrip('closed')
      renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /UNPACK/ }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      await seeded.store.getState().drained()

      expect(await seeded.moves()).toEqual([])
      // Cancelling the decision returns to the sheet rather than dismissing
      // it: nothing has been decided yet.
      expect(screen.getByRole('dialog')).toBeVisible()
    })
  })

  describe('a phase this build has never heard of', () => {
    it('marks no row and states the value verbatim', async () => {
      const seeded = await seededTrip('portaging')
      renderSheet(seeded)

      expect(markedRow()).toBeNull()
      // Drawn exactly as it arrived (§5.3 obligation 4) — inventing a casing
      // for it would be coercion by another name.
      expect(screen.getByText('● NOW — portaging')).toBeVisible()
      expect(rowLabels()).toHaveLength(5)
    })

    it('leaves every row tappable, so the Trip is never stranded', async () => {
      const user = userEvent.setup()
      const seeded = await seededTrip('portaging')
      renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /UNPACK/ }))
      await seeded.store.getState().drained()

      // Not a reopen: an unrecognised phase is not `closed`, and confirming
      // one would claim knowledge of a phase this build does not have.
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(await seeded.moves()).toEqual(['unpack'])
    })
  })

  it('titles the reopen with the dash a nameless Trip reads as', async () => {
    const user = userEvent.setup()
    const seeded = await seededTrip('closed', '')
    renderSheet(seeded)

    await user.click(screen.getByRole('button', { name: /DRAFT/ }))

    // `tripLabel` is the one place a Trip's name is decided; a raw `''` here
    // would render `Reopen ?`.
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Reopen —?')
  })
})
