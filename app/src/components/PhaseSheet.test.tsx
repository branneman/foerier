import {
  gearOwnedCountSet,
  gearRecorded,
  tripConsumedCountSet,
  tripConsumptionPosted,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripOutcomeSet,
  tripPhaseMoved,
  type PhaseValue,
  type TripState,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../household/opLog'
import {
  createHouseholdStore,
  HouseholdProvider,
  type HouseholdStoreState,
} from '../household/store'
import { anAuthor, noopEngine } from '../testUtils'
import activationStyles from './ActivationConfirm.module.css'
import { PhaseSheet } from './PhaseSheet'

/**
 * A **real** store, seeded by emitting real ops — `OwnerPicker.test.tsx`'s
 * rule. The seed matters more here than in the other pickers: a phase only
 * ever arrives as a `trip.phase_moved`, so a hand-shaped register would test a
 * state the reducer cannot produce and would hide the very thing `DAY N`
 * reads, which is the register's own stamp.
 */

const TRIP = 'tttttttt-0000-7000-8000-000000000001'
const OTHER_TRIP = 'tttttttt-0000-7000-8000-000000000002'
const THIRD_TRIP = 'tttttttt-0000-7000-8000-000000000003'
const GEAR = 'gggggggg-0000-7000-8000-000000000001'

interface Seeded {
  store: StoreApi<HouseholdStoreState>
  trip: () => TripState
  /** The phases moved to **since** the seed — the sheet's whole output. */
  moves: () => Promise<readonly unknown[]>
}

async function seededTrip(
  phase: PhaseValue,
  name = 'Alps 2026',
): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createHouseholdStore({
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
  const store = createHouseholdStore({
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
  const store = createHouseholdStore({
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

// Takes only what it uses, as `renderSheetWithRouter` below already does:
// `seededReadyToClose` reports `authored` rather than `moves`, and a sheet
// that only mounts a Trip has no business requiring one reporter over the
// other.
function renderSheet(seeded: Pick<Seeded, 'store' | 'trip'>) {
  let closed = 0
  render(
    <HouseholdProvider value={seeded.store}>
      <PhaseSheet
        trip={seeded.trip()}
        onClose={() => {
          closed += 1
        }}
      />
    </HouseholdProvider>,
  )
  return { closes: () => closed }
}

/** Every op authored since the seed, by type — not filtered to phase moves,
 * so "emits nothing" and "emits the close batch" are both statable claims
 * rather than ones that only look at one register. */
async function authoredSince(
  log: OpLog,
  seededCount: number,
): Promise<readonly { type: string; payload: Record<string, unknown> }[]> {
  const all = await log.all()
  return all
    .slice(seededCount)
    .map((entry) => ({ type: entry.op.type, payload: entry.op.payload }))
}

/**
 * A Trip in `unpack` holding one `consumed` Counted Entry, wholly resolved —
 * `open` reads `0` — so tapping `CLOSED` must go through `closeTrip`'s
 * reduction rather than a bare phase move. Owned ×6, bring ×4, consumed ×2 →
 * reduces to ×4, `gestures.test.ts`'s own fixture read through the app's real
 * store instead of the selector's hand-built one.
 *
 * At module scope rather than inside one `describe`, because the reopen gate's
 * own suite needs the identical Trip one phase later: a Trip whose close owed
 * a reduction is exactly the Trip that may not be reopened, and building it
 * twice is how the two suites would come to disagree about what "owed a
 * reduction" means.
 */
async function seededReadyToClose(): Promise<{
  store: StoreApi<HouseholdStoreState>
  trip: () => TripState
  authored: () => Promise<readonly unknown[]>
}> {
  const log: OpLog = inMemoryOpLog()
  const store = createHouseholdStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(
    gearRecorded('g-gas', {
      name: 'Gas canister',
      container: false,
      kind: 'counted',
      owned_count: 6,
    }),
  )
  store.getState().emit(tripCreated(TRIP, 'Alps 2026'))
  store.getState().emit(tripPhaseMoved(TRIP, 'unpack'))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-gas', { from: 'depot', gearId: 'g-gas' }))
  store.getState().emit(tripEntryBringCountSet(TRIP, 'e-gas', 4))
  store.getState().emit(tripOutcomeSet(TRIP, 'e-gas', 'consumed'))
  store.getState().emit(tripConsumedCountSet(TRIP, 'e-gas', 2))
  await store.getState().drained()

  const seededCount = (await log.all()).length
  return {
    store,
    trip: () => store.getState().state.trips[TRIP]!,
    authored: async () => authoredSince(log, seededCount),
  }
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

  it('closes a Trip without asking anything, at open = 0', async () => {
    const user = userEvent.setup()
    // No Entries at all, so `unpackTotals` reads `0/0` — `open = 0`
    // trivially, and F12's gate lets the tap straight through.
    const seeded = await seededTrip('unpack')
    renderSheet(seeded)

    await user.click(screen.getByRole('button', { name: /CLOSED/ }))
    await seeded.store.getState().drained()

    // No confirm at open = 0 (F10) — the gate is the ceremony.
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

  /**
   * **F12 — the live defect this task closes.** Before this task the
   * `CLOSED` row emitted a bare `trip.phase_moved` with no gate at all: a
   * Quartermaster could close a Trip with outcomes still open, past a check
   * the domain gives no override, and the Depot never moved. These tests
   * are the proof the gate now stands on this door too, not only on F5's
   * close card.
   */
  describe('the CLOSED row while open > 0 (F12)', () => {
    /** A Trip in `unpack` holding one depot Entry with no outcome — `open`
     * reads `1`, so the CLOSED row must route rather than write. */
    async function seededOpenTrip(): Promise<{
      store: StoreApi<HouseholdStoreState>
      trip: () => TripState
      authored: () => Promise<readonly unknown[]>
    }> {
      const log: OpLog = inMemoryOpLog()
      const store = createHouseholdStore({
        log,
        engine: noopEngine,
        author: anAuthor(),
      })
      store.getState().emit(
        gearRecorded('g-headlamp', {
          name: 'Headlamp',
          container: false,
          kind: 'single',
        }),
      )
      store.getState().emit(tripCreated(TRIP, 'Alps 2026'))
      store.getState().emit(tripPhaseMoved(TRIP, 'unpack'))
      store.getState().emit(
        tripEntryAdded(TRIP, 'e-open', {
          from: 'depot',
          gearId: 'g-headlamp',
        }),
      )
      await store.getState().drained()

      const seededCount = (await log.all()).length
      return {
        store,
        trip: () => store.getState().state.trips[TRIP]!,
        authored: async () => authoredSince(log, seededCount),
      }
    }

    /** `PhaseSheet` mounted under a real `Router`, with a stand-in
     * `/trips/:id/unpack` route so "the tap routes there" is a statable
     * fact rather than an assumption about what `navigate` was called
     * with. */
    function renderSheetWithRouter(seeded: {
      store: StoreApi<HouseholdStoreState>
      trip: () => TripState
    }) {
      const location = memoryLocation({ path: '/trips/start', record: true })
      let closed = 0
      render(
        <Router hook={location.hook}>
          <Switch>
            <Route path="/trips/start">
              <HouseholdProvider value={seeded.store}>
                <PhaseSheet
                  trip={seeded.trip()}
                  onClose={() => {
                    closed += 1
                  }}
                />
              </HouseholdProvider>
            </Route>
            <Route path="/trips/:id/unpack">
              {(params) => <p>Unpack {params['id']}</p>}
            </Route>
          </Switch>
        </Router>,
      )
      return { location, closes: () => closed }
    }

    it('draws the right-hand N OPEN › and keeps the row tappable — never a disabled row (D7)', async () => {
      const seeded = await seededOpenTrip()
      renderSheetWithRouter(seeded)

      const closedRow = screen.getByRole('button', { name: /CLOSED/ })
      expect(closedRow).toHaveTextContent('1 OPEN ›')
      expect(closedRow).not.toBeDisabled()

      // The sheet's own standing rule, stated once for every row and
      // re-asserted here because this is the row a stub gate would have
      // been tempted to disable.
      for (const row of screen.getAllByTestId('phase-row')) {
        expect(row).not.toBeDisabled()
      }
    })

    it('spells the meta with openLabel, not a hand-rolled `${open} OPEN`', async () => {
      // A fixture whose `openLabel` output is not `1 OPEN` — proof this is
      // the same function `Unpack.tsx`'s count line and `TripCard`'s
      // progress line call, not a parallel literal that happens to agree
      // at `1`.
      const log: OpLog = inMemoryOpLog()
      const store = createHouseholdStore({
        log,
        engine: noopEngine,
        author: anAuthor(),
      })
      store.getState().emit(
        gearRecorded('g-a', {
          name: 'Headlamp',
          container: false,
          kind: 'single',
        }),
      )
      store.getState().emit(
        gearRecorded('g-b', {
          name: 'Stove',
          container: false,
          kind: 'single',
        }),
      )
      store.getState().emit(tripCreated(TRIP, 'Alps 2026'))
      store.getState().emit(tripPhaseMoved(TRIP, 'unpack'))
      store
        .getState()
        .emit(tripEntryAdded(TRIP, 'e-a', { from: 'depot', gearId: 'g-a' }))
      store
        .getState()
        .emit(tripEntryAdded(TRIP, 'e-b', { from: 'depot', gearId: 'g-b' }))
      await store.getState().drained()

      renderSheetWithRouter({
        store,
        trip: () => store.getState().state.trips[TRIP]!,
      })

      expect(screen.getByRole('button', { name: /CLOSED/ })).toHaveTextContent(
        '2 OPEN ›',
      )
    })

    it('draws the accent tone the round board paints this slot, not the muted meta ink', () => {
      const css = readFileSync(
        join(
          dirname(expect.getState().testPath ?? ''),
          'PhaseSheet.module.css',
        ),
        'utf8',
      )
      const rule = /\.openMeta\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
      expect(rule).toMatch(/color:\s*var\(--color-accent\)/)
    })

    it('keeps the › out of the accessible name (ruling D)', async () => {
      const seeded = await seededOpenTrip()
      renderSheetWithRouter(seeded)

      // The computed name is `CLOSED 1 OPEN` — no glyph, no button-name
      // spoken as "greater-than sign".
      expect(
        screen.getByRole('button', { name: 'CLOSED 1 OPEN' }),
      ).toBeVisible()
      expect(screen.queryByRole('button', { name: /›/ })).toBeNull()
    })

    it('routes to the unpack screen instead of writing, and closes the sheet', async () => {
      const user = userEvent.setup()
      const seeded = await seededOpenTrip()
      const { closes } = renderSheetWithRouter(seeded)

      await user.click(screen.getByRole('button', { name: /CLOSED/ }))
      await seeded.store.getState().drained()

      // Whatever F5 draws for a fresh visit, not a Trip mutated on the way
      // there.
      expect(await seeded.authored()).toEqual([])
      expect(screen.getByText(`Unpack ${seeded.trip().id}`)).toBeVisible()
      expect(closes()).toBe(1)
    })

    it('emits the close batch, not a bare phase move, once open = 0', async () => {
      const user = userEvent.setup()
      const seeded = await seededReadyToClose()
      const { closes } = renderSheetWithRouter(seeded)

      // Nothing marks this row `6 OPEN` — the ordinary setter underneath.
      expect(
        screen.getByRole('button', { name: /CLOSED/ }),
      ).not.toHaveTextContent('OPEN')

      await user.click(screen.getByRole('button', { name: /CLOSED/ }))
      await seeded.store.getState().drained()

      // The exact ops `gestures.test.ts` pins for this fixture
      // (owned ×6, bring ×4, consumed ×2 → ×4, posts ×2), read back through
      // the real store rather than the selector's own hand-built state —
      // proof this sheet calls `closeTrip` and not a bare
      // `trip.phase_moved`. Order is the assertion (spec §2.3): the
      // reduction before its own posting, `trip.phase_moved` last.
      expect(await seeded.authored()).toEqual([
        { type: 'gear.owned_count_set', payload: { count: 4 } },
        {
          type: 'trip.consumption_posted',
          payload: { gear_id: 'g-gas', units: 2 },
        },
        {
          type: 'trip.phase_moved',
          payload: { phase: 'closed' },
        },
      ])
      expect(closes()).toBe(1)
    })
  })

  /**
   * **S11 hands the route back (spec §5.1).** S10 withheld the four rows out
   * of `closed` on a Trip whose close lowered an owned count, and swapped
   * the footnote's first sentence for the reason. S11 makes the *close*
   * correct instead, so a re-close of such a Trip subtracts nothing further,
   * and every row draws out of `closed` regardless of what that Trip's close
   * did.
   */
  describe('the rows out of CLOSED, on a Trip whose close lowered an owned count', () => {
    async function seededClosedWithReduction() {
      const seeded = await seededReadyToClose()
      // The close itself, all three of its ops — so the fixture is the
      // state a real close leaves behind (`gestures.test.ts` pins the
      // triple) rather than a phase move with an unreduced Depot behind it.
      seeded.store.getState().emit(gearOwnedCountSet('g-gas', 4))
      seeded.store.getState().emit(tripConsumptionPosted(TRIP, 'g-gas', 2))
      seeded.store.getState().emit(tripPhaseMoved(TRIP, 'closed'))
      await seeded.store.getState().drained()
      return seeded
    }

    it('draws all four rows out of CLOSED, and the boards footnote', async () => {
      const seeded = await seededClosedWithReduction()
      renderSheet(seeded)

      expect(rowLabels()).toEqual([
        'DRAFT',
        'PACK-OUT',
        'ON TRIP',
        'UNPACK',
        'CLOSED',
      ])
      expect(markedRow()).toBe('CLOSED')
      expect(
        screen.getByText(
          'ANY ROW TAPPABLE, BACKWARDS INCLUDED. NO DATE OR COUNT EVER MOVES A PHASE.',
        ),
      ).toBeInTheDocument()
      expect(screen.queryByText(/COUNTS LOWERED AT CLOSE/)).toBeNull()
    })

    it('reaches the reopen confirm from a row out of CLOSED', async () => {
      const user = userEvent.setup()
      const seeded = await seededClosedWithReduction()
      renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /UNPACK/ }))
      await seeded.store.getState().drained()
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
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
      // this assertion is what says so: the confirm holds its title, both
      // description lines (the explainer sentence, fidelity review §5k) and
      // its two buttons, and nothing more.
      expect(confirm.textContent).toBe(
        'Reopen Alps 2026?It returns to Unpack exactly as it stood. Closing cleared nothing.Changing an outcome away from consumed offers to restore the owned-count and waits for the answer — a count corrected by hand is never rewritten.Reopen tripCancel',
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
      await user.click(screen.getByRole('button', { name: 'Reopen trip' }))
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

  /**
   * Amendment ruling J. S7 gated the preview on `draft → pack_out` alone,
   * reasoning that "starting pack-out on a draft" was the domain's own phrase
   * and a Draft jumping straight to `on_trip` or `unpack` was a case no board
   * drew. But every row of this sheet is tappable, and invariant 17 makes all
   * three active phases equally activating — so the narrow guard missed two
   * one-tap routes into exactly the state it exists to preview.
   */
  describe('the widened activation guard (J)', () => {
    it.each(['on_trip', 'unpack'] as const)(
      'previews a Draft moving straight to %s',
      async (phase) => {
        const user = userEvent.setup()
        const seeded = await seededDraftClash()
        renderSheet(seeded)

        await user.click(
          screen.getByRole('button', {
            name: new RegExp(phase === 'on_trip' ? 'ON TRIP' : 'UNPACK'),
          }),
        )

        // The title takes the phase row's own `name` field, with no casing
        // transform — the same rule the reopen body follows.
        expect(screen.getByRole('alertdialog')).toHaveTextContent(
          phase === 'on_trip'
            ? 'On trip — Vosges — Oct?'
            : 'Unpack — Vosges — Oct?',
        )
        // A preview states the conflict; it does not decide.
        expect(await seeded.moves()).toEqual([])
      },
    )

    it('moves an already-Active Trip without previewing anything', async () => {
      const user = userEvent.setup()
      const seeded = await seededDraftClash()
      seeded.store.getState().emit(tripPhaseMoved(TRIP, 'pack_out'))
      // `emit` lands asynchronously; without flushing it first the sheet
      // renders against the Draft and the gate reads the wrong source phase.
      await seeded.moves()
      renderSheet(seeded)

      await user.click(screen.getByRole('button', { name: /ON TRIP/ }))

      // Active → Active is not an activation: the claim already stands, and
      // the standing band on the trip screen is where it is stated.
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(await seeded.moves()).toEqual(['pack_out', 'on_trip'])
    })
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
