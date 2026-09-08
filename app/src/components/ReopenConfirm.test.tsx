import {
  gearOwnedCountSet,
  gearRecorded,
  personRecorded,
  tripConsumedCountSet,
  tripConsumptionPosted,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripOutcomeSet,
  tripParticipantAdded,
  tripPhaseMoved,
  type PhaseKey,
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
 * component its own `useHousehold` reads, for `overClaimsIfActive` and for the
 * settle routes' emits, so every render needs a `HouseholdProvider` above it —
 * not only a hand-folded `TripState` passed in as a prop.
 */

const TRIP = 'tttttttt-0000-7000-8000-000000000001'
const OTHER_TRIP = 'tttttttt-0000-7000-8000-000000000002'
const GEAR = 'gggggggg-0000-7000-8000-000000000001'
const GEAR_LAMP = 'gggggggg-0000-7000-8000-000000000002'
const TENT = 'gggggggg-0000-7000-8000-000000000003'
const PERSON = 'pppppppp-0000-7000-8000-000000000001'

interface Seeded {
  store: StoreApi<HouseholdStoreState>
  trip: () => TripState
}

async function aClosedTrip(name = 'Tessin 2025'): Promise<Seeded> {
  const store = createHouseholdStore({
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
  const store = createHouseholdStore({
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

/**
 * `TRIP` closed holding one Counted Entry resolved `consumed` — the shape
 * whose close authored a `gear.owned_count_set` (finding I2). The phase move
 * to `closed` is emitted last, so the fold under test is what a real close
 * produced.
 */
async function aClosedTripWithConsumed(): Promise<Seeded> {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(
    gearRecorded(GEAR, {
      name: 'Gas canister',
      container: false,
      kind: 'counted',
    }),
  )
  store.getState().emit(gearOwnedCountSet(GEAR, 6))
  store.getState().emit(tripCreated(TRIP, 'Tessin 2025'))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-gas', { from: 'depot', gearId: GEAR }))
  store.getState().emit(tripEntryBringCountSet(TRIP, 'e-gas', 4))
  store.getState().emit(tripOutcomeSet(TRIP, 'e-gas', 'consumed'))
  store.getState().emit(tripConsumedCountSet(TRIP, 'e-gas', 2))
  store.getState().emit(gearOwnedCountSet(GEAR, 4))
  store.getState().emit(tripPhaseMoved(TRIP, 'closed'))
  await store.getState().drained()
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

/**
 * `TRIP` closed by **this** build, so its close left a posting behind: the
 * ×2 it applied to the Depot is on the record as `trip.consumption_posted`,
 * beside the reduced owned count. `consumed` is the resting outcome, so
 * `consumedReductions` and the register agree here — the helpers below are
 * the ones where they come apart.
 */
async function aClosedTripPosted(
  ...after: readonly ReturnType<typeof tripConsumptionPosted>[]
): Promise<Seeded> {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(
    gearRecorded(GEAR, {
      name: 'Gas canister',
      container: false,
      kind: 'counted',
    }),
  )
  store.getState().emit(gearOwnedCountSet(GEAR, 6))
  store.getState().emit(tripCreated(TRIP, 'Tessin 2025'))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-gas', { from: 'depot', gearId: GEAR }))
  store.getState().emit(tripEntryBringCountSet(TRIP, 'e-gas', 4))
  store.getState().emit(tripOutcomeSet(TRIP, 'e-gas', 'consumed'))
  store.getState().emit(tripConsumedCountSet(TRIP, 'e-gas', 2))
  store.getState().emit(gearOwnedCountSet(GEAR, 4))
  store.getState().emit(tripConsumptionPosted(TRIP, GEAR, 2))
  store.getState().emit(tripPhaseMoved(TRIP, 'closed'))
  for (const op of after) store.getState().emit(op)
  await store.getState().drained()
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

/**
 * `TRIP` closed by this build, reopened, the outcome moved off `consumed`,
 * the restoration offer **declined** (G1's own default — the posting is not
 * lowered, so the units stay deducted), and re-closed. `owed` is now `0` and
 * `consumedReductions` is empty; the ×2 the Depot is short of is recorded
 * only in the posting register.
 */
async function aClosedTripDeclinedRestore(): Promise<Seeded> {
  const seeded = await aClosedTripPosted()
  seeded.store.getState().emit(tripPhaseMoved(TRIP, 'unpack'))
  seeded.store.getState().emit(tripOutcomeSet(TRIP, 'e-gas', 'back'))
  seeded.store.getState().emit(tripPhaseMoved(TRIP, 'closed'))
  await seeded.store.getState().drained()
  return seeded
}

/**
 * `TRIP` closed holding one per-person Entry whose sole Piece is still
 * `lost` — `standingLostOf`'s own shape, real Person named `K` so the
 * rendered string matches spec §6's example verbatim rather than needing a
 * regex.
 */
async function aClosedTripWithStandingLost(): Promise<Seeded> {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(personRecorded(PERSON, 'K'))
  store.getState().emit(
    gearRecorded(GEAR_LAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
  )
  store.getState().emit(tripCreated(TRIP, 'Tessin 2025'))
  store.getState().emit(tripParticipantAdded(TRIP, PERSON))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: GEAR_LAMP }))
  store.getState().emit(tripOutcomeSet(TRIP, 'e-lamp', 'lost', PERSON))
  store.getState().emit(tripPhaseMoved(TRIP, 'closed'))
  await store.getState().drained()
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

/**
 * `TRIP` closed holding **two** standing lost items — the per-person
 * Headlamp above plus a Single Tent with no Person. The reviewed ruling on
 * the multi-item separator: items join on `·` and `▲ LOST` trails the whole
 * block once, since every candidate `standingLostOf` returns is `lost` by
 * construction and the mark is a property of the block, not of each row.
 */
async function aClosedTripWithTwoStandingLost(): Promise<Seeded> {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(personRecorded(PERSON, 'K'))
  store.getState().emit(
    gearRecorded(GEAR_LAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
  )
  // A plain name with no comma of its own, so the assertion below is not
  // ambiguous about which comma belongs to the fact-line grammar.
  store.getState().emit(
    gearRecorded(TENT, {
      name: 'Tent',
      container: false,
      kind: 'single',
    }),
  )
  store.getState().emit(tripCreated(TRIP, 'Tessin 2025'))
  store.getState().emit(tripParticipantAdded(TRIP, PERSON))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: GEAR_LAMP }))
  store.getState().emit(tripOutcomeSet(TRIP, 'e-lamp', 'lost', PERSON))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: TENT }))
  store.getState().emit(tripOutcomeSet(TRIP, 'e-tent', 'lost'))
  store.getState().emit(tripPhaseMoved(TRIP, 'closed'))
  await store.getState().drained()
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

/**
 * **Ruling H2's third form.** A Counted Entry states its units after its
 * name, `GAS CANISTER 450 ×2`, so the block's head count and its items add
 * up in the reader's eye — one Counted Entry bringing ×2 beside a Single is
 * `▲ 3 STILL UNACCOUNTED`, and without the `×2` the reader sees two names
 * under a count of three.
 */
async function aClosedTripWithCountedStandingLost(): Promise<Seeded> {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(
    gearRecorded(GEAR, {
      name: 'Gas canister 450',
      container: false,
      kind: 'counted',
    }),
  )
  store.getState().emit(gearOwnedCountSet(GEAR, 6))
  store.getState().emit(
    gearRecorded(TENT, {
      name: 'Tent',
      container: false,
      kind: 'single',
    }),
  )
  store.getState().emit(tripCreated(TRIP, 'Tessin 2025'))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-gas', { from: 'depot', gearId: GEAR }))
  store.getState().emit(tripEntryBringCountSet(TRIP, 'e-gas', 2))
  store.getState().emit(tripOutcomeSet(TRIP, 'e-gas', 'lost'))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-tent', { from: 'depot', gearId: TENT }))
  store.getState().emit(tripOutcomeSet(TRIP, 'e-tent', 'lost'))
  store.getState().emit(tripPhaseMoved(TRIP, 'closed'))
  await store.getState().drained()
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

/**
 * `TRIP` closed holding all three at once — the standing lost Piece
 * (`aClosedTripWithStandingLost`), the consumed reduction
 * (`aClosedTripWithConsumed`) and the clash with `OTHER_TRIP`
 * (`aClosedTripClash`) — so the order test below asserts all three blocks
 * against one real fold rather than three isolated ones that could each
 * pass while the stacking order drifts.
 */
async function aClosedTripWithEverything(): Promise<Seeded> {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(personRecorded(PERSON, 'K'))
  store.getState().emit(
    gearRecorded(GEAR_LAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
  )
  store.getState().emit(
    gearRecorded(GEAR, {
      name: 'Gas canister',
      container: false,
      kind: 'counted',
    }),
  )
  store.getState().emit(gearOwnedCountSet(GEAR, 6))
  store.getState().emit(
    gearRecorded(TENT, {
      name: 'Tent, tunnel 4p',
      container: false,
      kind: 'single',
    }),
  )
  store.getState().emit(tripCreated(TRIP, 'Tessin 2025'))
  store.getState().emit(tripParticipantAdded(TRIP, PERSON))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-lamp', { from: 'depot', gearId: GEAR_LAMP }))
  store.getState().emit(tripOutcomeSet(TRIP, 'e-lamp', 'lost', PERSON))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-gas', { from: 'depot', gearId: GEAR }))
  store.getState().emit(tripEntryBringCountSet(TRIP, 'e-gas', 4))
  store.getState().emit(tripOutcomeSet(TRIP, 'e-gas', 'consumed'))
  store.getState().emit(tripConsumedCountSet(TRIP, 'e-gas', 2))
  store.getState().emit(gearOwnedCountSet(GEAR, 4))
  store
    .getState()
    .emit(tripEntryAdded(TRIP, 'e-here', { from: 'depot', gearId: TENT }))
  store.getState().emit(tripPhaseMoved(TRIP, 'closed'))
  store.getState().emit(tripCreated(OTHER_TRIP, 'Alps 2026'))
  store.getState().emit(tripPhaseMoved(OTHER_TRIP, 'pack_out'))
  store
    .getState()
    .emit(
      tripEntryAdded(OTHER_TRIP, 'e-other', { from: 'depot', gearId: TENT }),
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
    <HouseholdProvider value={seeded.store}>
      <ReopenConfirm
        trip={seeded.trip()}
        to={props.to}
        onCancel={props.onCancel ?? (() => {})}
        onConfirm={props.onConfirm ?? (() => {})}
      />
    </HouseholdProvider>,
  )
}

describe('the reopen confirm', () => {
  it('ships the boards title, both description lines, and nothing else', async () => {
    const seeded = await aClosedTrip()
    renderConfirm(seeded, { to: 'unpack' })

    const confirm = screen.getByRole('alertdialog')
    // Word for word from `Screens B` §02B, including the explainer sentence
    // (fidelity review, §5k) — drawn unconditionally, so it ships even on a
    // Trip with no conditional mono block. This assertion on the whole text
    // is what says none of it is faked or stubbed.
    expect(confirm.textContent).toBe(
      'Reopen Tessin 2025?It returns to Unpack exactly as it stood. Closing cleared nothing.Changing an outcome away from consumed offers to restore the owned-count and waits for the answer — a count corrected by hand is never rewritten.Reopen tripCancel',
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

  it('titles a nameless Trip with the word tripNameOrUnnamed reads it as', async () => {
    const seeded = await aClosedTrip('')
    renderConfirm(seeded, { to: 'unpack' })

    // Fix round F4: `tripLabel` alone would draw the bare `—` glyph into a
    // sentence (`Reopen —?`) — right in a list column, wrong here.
    // `tripNameOrUnnamed` is the substitution `ActivationConfirm` and
    // `RemoveElsewhereConfirm` already share.
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Reopen Unnamed trip?',
    )
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

    await user.click(screen.getByRole('button', { name: 'Reopen trip' }))
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

    // Amendment ruling I, the same rule `ActivationConfirm` follows: this
    // sheet states the conflict and offers no route out of it, because a
    // control that emits inside a cancellable confirm makes `Cancel` state
    // something false. The standing band on the trip screen is the only
    // surface that settles.
    expect(screen.queryByRole('button', { name: /REMOVE HERE/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /REMOVE ON/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /BRING ×/ })).toBeNull()
  })

  /**
   * **S11's last mono block (spec §6).** `standingLostOf` reads this Trip's
   * own Entries and Pieces whose `lost` outcome still stands — a Person
   * named `K` matches spec §6's own example verbatim, so the assertion pins
   * the exact string rather than a regex around it.
   */
  it('renders the STILL UNACCOUNTED block for a standing lost Piece', async () => {
    const seeded = await aClosedTripWithStandingLost()
    renderConfirm(seeded, { to: 'unpack' })

    expect(screen.getByTestId('reopen-unaccounted')).toHaveTextContent(
      '▲ 1 STILL UNACCOUNTED — HEADLAMP, K',
    )
  })

  it('draws no STILL UNACCOUNTED block on a Trip with nothing still lost (G3)', async () => {
    const seeded = await aClosedTripClash()
    renderConfirm(seeded, { to: 'unpack' })

    expect(screen.queryByTestId('reopen-unaccounted')).not.toBeInTheDocument()
    expect(screen.queryByText(/STILL UNACCOUNTED/)).toBeNull()
  })

  /**
   * **Ruling H2 — the mark leads, and `·` then has one job.** The block's
   * own word already says lost, so a trailing `▲ LOST` said it twice; the
   * head is where every other standing line in the app carries the mark.
   * `·` divides items and the comma divides a gear name from its Person
   * inside one item — two levels of grammar, one glyph each, which the
   * first draft's `HEADLAMP, K · ▲ LOST · TENT · ▲ LOST` flattened.
   */
  it('leads with ▲ and joins items on ·, never a trailing ▲ LOST', async () => {
    const seeded = await aClosedTripWithTwoStandingLost()
    renderConfirm(seeded, { to: 'unpack' })

    const block = screen.getByTestId('reopen-unaccounted')
    expect(block).toHaveTextContent(
      '▲ 2 STILL UNACCOUNTED — HEADLAMP, K · TENT',
    )
    expect(block.textContent).not.toContain('▲ LOST')
  })

  /**
   * **Ruling H2, the Counted form.** The head count is units and a Counted
   * item names its own, so the two agree; a Single names one thing and
   * carries nothing. Which items print a quantity is `standingLostOf`'s
   * call — it hands back `count` non-null for exactly the Kind that splits
   * by quantity (D1's encoding), so this screen never asks a Kind.
   */
  it('states units after a Counted item’s name, and nothing after a Single’s', async () => {
    const seeded = await aClosedTripWithCountedStandingLost()
    renderConfirm(seeded, { to: 'unpack' })

    expect(screen.getByTestId('reopen-unaccounted')).toHaveTextContent(
      '▲ 3 STILL UNACCOUNTED — GAS CANISTER 450 ×2 · TENT',
    )
  })

  /**
   * The sheet's own `children` slot stacks three conditional blocks in one
   * order — this Trip's own history first, the world outside it last (spec
   * §6): the unaccounted block, then G1's reduction lines, then the
   * facts-only over-claim block.
   */
  it('stacks the unaccounted, reduction and over-claim blocks in that order', async () => {
    const seeded = await aClosedTripWithEverything()
    renderConfirm(seeded, { to: 'unpack' })

    const confirm = screen.getByRole('alertdialog')
    const text = confirm.textContent ?? ''
    const unaccountedAt = text.indexOf('STILL UNACCOUNTED')
    const reductionAt = text.indexOf('OWNED COUNTS LOWERED AT CLOSE')
    const overClaimAt = text.indexOf('already claimed by')

    expect(unaccountedAt).toBeGreaterThanOrEqual(0)
    expect(reductionAt).toBeGreaterThan(unaccountedAt)
    expect(overClaimAt).toBeGreaterThan(reductionAt)
  })

  it('keeps the reopen primary flush left and filled accent', async () => {
    const seeded = await aClosedTrip()
    renderConfirm(seeded, { to: 'unpack' })

    const button = screen.getByRole('button', { name: 'Reopen trip' })
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

  /**
   * **Finding I2, ruled at §5i G1.** *"Closing cleared nothing"* is true of
   * the Trip and was misleading about the Depot: closing applied every
   * `consumed` Entry's owned-count reduction, and reopening does not offer
   * it back. The disclosure stays and its **register** moves — out of body
   * prose, which reads as though it were always so, and into the
   * conditional mono block this sheet already reserves for facts that hold
   * on this Trip alone. The body is the board's again, verbatim.
   */
  it('states the reduction as a fact line, and leaves the body verbatim (§5i G1)', async () => {
    const seeded = await aClosedTripWithConsumed()
    renderConfirm(seeded, { to: 'unpack' })

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'It returns to Unpack exactly as it stood. Closing cleared nothing.',
    )
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(
      /reopening does not give them back/,
    )

    // The arrow's left-hand side is a reconstruction — `owned + consumed`,
    // since the close wrote the owned count absolutely and the fold keeps
    // only the reduced one.
    expect(screen.getByTestId('reopen-reduction')).toHaveTextContent(
      'OWNED COUNTS LOWERED AT CLOSE STAY LOWERED — GAS CANISTER ×6 → ×4',
    )
  })

  /**
   * **The register is the fact; `consumedReductions` is only the fallback.**
   * Reopen, move the outcome off `consumed`, decline the restoration
   * (G1's own default) and re-close: `owed` is `0`, so a line built from
   * `consumedReductions` **disappears** — on the very Trip where it is most
   * true, since the ×2 was never handed back. `postedOf` still says ×2.
   */
  it('keeps the fact line after a declined restoration, where the reconstruction is empty', async () => {
    const seeded = await aClosedTripDeclinedRestore()
    renderConfirm(seeded, { to: 'unpack' })

    expect(screen.getByTestId('reopen-reduction')).toHaveTextContent(
      'OWNED COUNTS LOWERED AT CLOSE STAY LOWERED — GAS CANISTER ×6 → ×4',
    )
  })

  /**
   * **The arrow is as wide as what was applied, not as what is owed now.**
   * A Consumed-count re-raised only part way leaves `owed` ×2 against a
   * posting of ×4 — §2.2's negative-delta row, which the close refuses to
   * write and only the restoration offer may reconcile. Reading `owed` drew
   * an arrow two units wide for a count the Depot is four short of.
   */
  it('states the applied units, not the owed ones, when the two disagree', async () => {
    const seeded = await aClosedTripPosted(tripConsumptionPosted(TRIP, GEAR, 4))
    renderConfirm(seeded, { to: 'unpack' })

    expect(screen.getByTestId('reopen-reduction')).toHaveTextContent(
      'OWNED COUNTS LOWERED AT CLOSE STAY LOWERED — GAS CANISTER ×8 → ×4',
    )
  })

  /**
   * **A posting restored to `0` owes no line.** Present, not absent — the
   * close *was* recorded and its units have since been handed back (spec
   * §3) — so there is nothing lowered to disclose, and the block goes with
   * the fact rather than being drawn empty (G3).
   */
  it('draws no fact line for a Gear whose posting has been restored to 0', async () => {
    const seeded = await aClosedTripPosted(tripConsumptionPosted(TRIP, GEAR, 0))
    renderConfirm(seeded, { to: 'unpack' })

    expect(screen.queryByTestId('reopen-reduction')).not.toBeInTheDocument()
  })

  it('draws no fact line at all on a Trip whose close owed the Depot nothing (I2)', async () => {
    const seeded = await aClosedTripClash()
    renderConfirm(seeded, { to: 'unpack' })

    // Which is most Trips — an unconditional line would be noise on them.
    expect(screen.queryByTestId('reopen-reduction')).not.toBeInTheDocument()
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
