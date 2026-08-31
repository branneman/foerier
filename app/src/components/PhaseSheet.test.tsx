import {
  createHlcClock,
  gearRecorded,
  tripCreated,
  tripEntryAdded,
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
import activationStyles from './ActivationConfirm.module.css'
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
const OTHER_TRIP = 'tttttttt-0000-7000-8000-000000000002'
const THIRD_TRIP = 'tttttttt-0000-7000-8000-000000000003'
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

/**
 * A Draft (`TRIP`) and an already-active Trip (`OTHER_TRIP`) both holding an
 * Entry for the same Single Gear — `overClaimsIfActive` reports this pair the
 * moment `TRIP` is asked to activate, exactly as `claim.test.ts`'s own
 * "reports a clash a Draft would cause on activation" case does at the
 * selector tier. `TRIP` stays a Draft here; the test drives the actual
 * PACK-OUT tap.
 */
async function seededDraftClash(name = 'Vosges — Oct'): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
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
  store.getState().emit(tripCreated(TRIP, name))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-here', { from: 'depot', gearId: GEAR }))
  store.getState().emit(tripCreated(OTHER_TRIP, 'Alps 2026'))
  store.getState().emit(tripPhaseMoved(OTHER_TRIP, 'pack_out'))
  store
    .getState()
    .emit(
      tripEntryAdded(OTHER_TRIP, 'e-other', { from: 'depot', gearId: GEAR }),
    )
  await store.getState().drained()

  const seeded = (await phaseMoves(log)).length
  return {
    store,
    trip: () => store.getState().state.trips[TRIP]!,
    moves: async () => (await phaseMoves(log)).slice(seeded),
  }
}

/**
 * `TRIP` is a Draft holding no Entry at all. `OTHER_TRIP` and `THIRD_TRIP`
 * are both already active and clash with **each other** over the same Gear —
 * `overClaimsIfActive(state, TRIP)` is deliberately unscoped to `TRIP`
 * (`OverClaimBand`'s own docstring), so it reports this pair even though
 * `TRIP` names none of it. Task 14 review F1's regression: the gate must
 * ask the **filtered** block (`overClaimGroups`), which excludes every claim
 * not naming `TRIP`, or this scenario opens a sheet with an attention line
 * and nothing beneath it.
 */
async function seededUnrelatedClash(): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
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
  store.getState().emit(tripCreated(TRIP, 'Vosges — Oct'))
  store.getState().emit(tripCreated(OTHER_TRIP, 'Alps 2026'))
  store.getState().emit(tripPhaseMoved(OTHER_TRIP, 'pack_out'))
  store
    .getState()
    .emit(tripEntryAdded(OTHER_TRIP, 'e-alps', { from: 'depot', gearId: GEAR }))
  store.getState().emit(tripCreated(THIRD_TRIP, 'Jura 2025'))
  store.getState().emit(tripPhaseMoved(THIRD_TRIP, 'on_trip'))
  store
    .getState()
    .emit(tripEntryAdded(THIRD_TRIP, 'e-jura', { from: 'depot', gearId: GEAR }))
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
  it('titles itself SET PHASE, and nothing longer', async () => {
    const seeded = await seededTrip('draft')
    renderSheet(seeded)

    // The sheet's short label, and the whole of it: the chip that opened it
    // is the Trip's own, on the Trip's own screen, so naming the Trip here
    // would repeat what the reader is already looking at.
    expect(screen.getByRole('dialog', { name: 'SET PHASE' })).toBeVisible()
  })

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
    // The board's footnote, **both** sentences. The first is what tells a
    // quartermaster the backward move exists at all — five rows with one
    // marked otherwise read as a status readout.
    expect(
      screen.getByText(
        'ANY ROW TAPPABLE, BACKWARDS INCLUDED. NO DATE OR COUNT EVER MOVES A PHASE.',
      ),
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
        'Reopen Alps 2026?It returns to Unpack exactly as it stood. Closing cleared nothing.ReopenCancel',
      )
      expect(await seeded.moves()).toEqual([])
    })

    it('names the phase the move actually goes to', async () => {
      const user = userEvent.setup()
      const seeded = await seededTrip('closed')
      renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /DRAFT/ }))

      // The board draws this sentence for the reopen from a closed ledger
      // row, which targets `unpack`. The sheet offers all four other rows —
      // invariant 16, and the footnote right above them — so the sentence
      // has to name the row that was tapped or it states something false for
      // three of the four. `Draft`, not `DRAFT`: the phase table carries the
      // sentence-case name beside the mono label so no screen casts one into
      // the other.
      expect(screen.getByRole('alertdialog')).toHaveTextContent(
        'It returns to Draft exactly as it stood. Closing cleared nothing.',
      )
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
      // One `p`, two spans: `● NOW` carries the accent and the raw value
      // carries ink, so this line encodes the word exactly as the marked row
      // does — and an unrecognised phase never reads as the thing on screen
      // that wants an action.
      expect(screen.getByTestId('phase-now')).toHaveTextContent(
        '● NOW — portaging',
      )
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

  it('titles the reopen with the word a nameless Trip reads as', async () => {
    const user = userEvent.setup()
    const seeded = await seededTrip('closed', '')
    renderSheet(seeded)

    await user.click(screen.getByRole('button', { name: /DRAFT/ }))

    // Fix round F4: `tripLabel`'s bare `—` is right in a list column and
    // wrong in a sentence (`Reopen —?`) — `tripNameOrUnnamed` is the
    // substitution `ActivationConfirm` and `RemoveElsewhereConfirm` already
    // share, and `ReopenConfirm` now follows it too.
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Reopen Unnamed trip?',
    )
  })

  describe('activating a Draft into pack-out', () => {
    it('renders the over-claim block when a Draft would clash on activation', async () => {
      const user = userEvent.setup()
      const seeded = await seededDraftClash()
      renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /PACK-OUT/ }))

      const confirm = screen.getByRole('alertdialog')
      expect(confirm).toHaveTextContent('Start pack-out — Vosges — Oct?')
      expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
        '▲ 1 entry is already claimed by Alps 2026.',
      )
      expect(screen.getByTestId('over-claim-row-' + GEAR)).toHaveTextContent(
        'Tent, tunnel 4p',
      )
      // The board's own body sentence, verbatim, still present beside the
      // block — starting still warns rather than blocks. Amendment ruling I
      // rewrote its second half: the block here is facts-only, because a
      // settle route that emits inside a cancellable confirm makes `Cancel`
      // state something false.
      expect(confirm).toHaveTextContent(
        'Starting warns, never blocks. Nothing changes here — the settle routes are on the trip screen.',
      )
      // Amendment ruling I: facts, and no routes. The whole row of settle
      // controls is *absent*, not disabled — a disabled control would still
      // state that the action belongs here, and the ruling's point is that it
      // belongs on the trip screen's standing band instead. Asserted by role
      // rather than by text so a renamed route cannot slip through.
      expect(screen.queryByRole('button', { name: /REMOVE HERE/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /REMOVE ON/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /BRING ×/ })).toBeNull()

      // Not moved yet — a preview states the conflict, it does not decide
      // for the Quartermaster.
      expect(await seeded.moves()).toEqual([])
    })

    it('renders no block when it would not', async () => {
      const user = userEvent.setup()
      const seeded = await seededTrip('draft')
      const { closes } = renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /PACK-OUT/ }))
      await seeded.store.getState().drained()

      // No conflict, no preview: "never blocks" also means never adding a
      // screen nobody needs. The move happens exactly as it does for every
      // other unguarded transition.
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.queryByTestId('over-claim-attention')).toBeNull()
      expect(await seeded.moves()).toEqual(['pack_out'])
      expect(closes()).toBe(1)
    })

    it('does not gate on a conflict naming two other Trips entirely', async () => {
      const user = userEvent.setup()
      const seeded = await seededUnrelatedClash()
      const { closes } = renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /PACK-OUT/ }))
      await seeded.store.getState().drained()

      // `overClaimsIfActive(state, TRIP)` is non-empty here — Alps and Jura
      // clash over the same tent — but neither claim names TRIP, so the
      // filtered block is empty and the gate must not fire (Task 14 review
      // F1). The un-fixed gate opened a sheet reading `Start pack-out — …?`
      // with an attention line and nothing beneath it.
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.queryByTestId('over-claim-attention')).toBeNull()
      expect(await seeded.moves()).toEqual(['pack_out'])
      expect(closes()).toBe(1)
    })

    it('keeps Start pack-out filled accent, never red', async () => {
      const user = userEvent.setup()
      const seeded = await seededDraftClash()
      renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /PACK-OUT/ }))

      const button = screen.getByRole('button', { name: 'Start pack-out' })
      // `.primary` (`ActivationConfirm.module.css`) is the accent button —
      // background `var(--color-accent)`, never the attention colour the
      // block above it carries. Asserting the class rather than a computed
      // style: this project's Tier 3 runs with `css: false`, so
      // `toHaveStyle` would pass unconditionally.
      expect(button).toHaveClass(activationStyles['primary']!)
    })

    it('still moves the phase when the primary is pressed', async () => {
      const user = userEvent.setup()
      const seeded = await seededDraftClash()
      const { closes } = renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /PACK-OUT/ }))
      await user.click(screen.getByRole('button', { name: 'Start pack-out' }))
      await seeded.store.getState().drained()

      // Warns and allows: the conflict is still there, and the move happens
      // anyway — nothing here ever blocks it.
      expect(await seeded.moves()).toEqual(['pack_out'])
      expect(closes()).toBe(1)
    })

    it('titles a nameless Draft with the word tripNameOrUnnamed reads it as', async () => {
      const user = userEvent.setup()
      const seeded = await seededDraftClash('')
      renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /PACK-OUT/ }))

      // `tripLabel` alone would draw `Start pack-out — —?` — the em dash
      // twice with nothing between (Task 14 review F5). `tripNameOrUnnamed`
      // is the substitution `RemoveElsewhereConfirm` and `OverClaimBand`
      // already share.
      expect(screen.getByRole('alertdialog')).toHaveTextContent(
        'Start pack-out — Unnamed trip?',
      )
    })
  })
})
