import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  createHlcClock,
  gearRecorded,
  overClaimsFor,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripParticipantAdded,
  tripPhaseMoved,
  tripRenamed,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
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
import { OverClaimBand, overClaimGroups } from './OverClaimBand'

/**
 * `Stepper.test.tsx`'s pattern: jsdom computes no layout (`css: false`), so
 * a hit area is pinned by reading the declared numbers and computing the
 * result, not by rendering and measuring.
 */
function css(): string {
  return readFileSync(
    join(dirname(expect.getState().testPath ?? ''), 'OverClaimBand.module.css'),
    'utf8',
  )
}

/**
 * A **real** store, seeded by emitting real ops — `TripCard.test.tsx`'s rule:
 * `overClaims(state)` is a fold of registers (spec §3.5), so a hand-shaped
 * `OverClaim` would test a shape the reducer might never actually produce.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000007'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000007'
const SEEDED_AT = 1_700_000_000_000

const HERE = 'trip-here'
const ALPS = 'trip-alps'
const JURA = 'trip-jura'

let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

function fixedClock(): Clock {
  return { now: () => SEEDED_AT }
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

async function seeded(
  ...specs: readonly OpSpec[]
): Promise<StoreApi<DepotStoreState>> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return store
}

function renderBand(
  store: StoreApi<DepotStoreState>,
  tripId: string,
  overrides: {
    onRemoveHere?: (entryId: string) => void
    onRemoveThere?: (tripId: string, entryId: string) => void
    onBringFewer?: (entryId: string, count: number) => void
  } = {},
) {
  const state = store.getState().state
  const overClaims = overClaimsFor(state, tripId)
  render(
    <DepotProvider value={store}>
      <OverClaimBand
        tripId={tripId}
        overClaims={overClaims}
        onRemoveHere={overrides.onRemoveHere ?? vi.fn()}
        onRemoveThere={overrides.onRemoveThere ?? vi.fn()}
        onBringFewer={overrides.onBringFewer ?? vi.fn()}
      />
    </DepotProvider>,
  )
  return overClaims
}

describe('the copy table', () => {
  it('names one other Trip, singular entry, "already"', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'tent' }),
    )

    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 1 entry is already claimed by Alps 2026.',
    )
    const row = screen.getByTestId('over-claim-row-tent')
    expect(row).toHaveTextContent('Tent, tunnel 4p')
    // No Trip name in the row's *fact*: the line above already named the one
    // Trip. (The settle route beside it legitimately names Alps — F1.)
    expect(within(row).getByTestId('over-claim-fact')).toHaveTextContent(
      'SINGLE · STILL OUT',
    )
    expect(within(row).getByTestId('over-claim-fact')).not.toHaveTextContent(
      'Alps',
    )
    expect(
      within(row).getByRole('button', { name: 'REMOVE HERE' }),
    ).toBeVisible()
    // Full name, never shortened — fix round F1: `Alps 2025` and
    // `Alps 2026` must never collide on one visible label.
    expect(
      within(row).getByRole('button', { name: 'REMOVE ON Alps 2026' }),
    ).toBeVisible()
  })

  it('names one other Trip, plural entries', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      gearRecorded('trangia', {
        name: 'Trangia 25',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-tent-here', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(ALPS, 'e-tent-alps', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(HERE, 'e-trangia-here', {
        from: 'depot',
        gearId: 'trangia',
      }),
      tripEntryAdded(ALPS, 'e-trangia-alps', {
        from: 'depot',
        gearId: 'trangia',
      }),
    )

    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 2 entries are already claimed by Alps 2026.',
    )
  })

  it('counts other Trips instead of naming one, from two — and each row carries its own', async () => {
    const store = await seeded(
      gearRecorded('g1', {
        name: 'Gear one',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g2', {
        name: 'Gear two',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g3', {
        name: 'Gear three',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g4', {
        name: 'Gear four',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g5', {
        name: 'Gear five',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripCreated(JURA, 'Jura 2026'),
      tripPhaseMoved(JURA, 'on_trip'),
      tripEntryAdded(HERE, 'e-g1-here', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(ALPS, 'e-g1-alps', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(HERE, 'e-g2-here', { from: 'depot', gearId: 'g2' }),
      tripEntryAdded(JURA, 'e-g2-jura', { from: 'depot', gearId: 'g2' }),
      tripEntryAdded(HERE, 'e-g3-here', { from: 'depot', gearId: 'g3' }),
      tripEntryAdded(ALPS, 'e-g3-alps', { from: 'depot', gearId: 'g3' }),
      tripEntryAdded(HERE, 'e-g4-here', { from: 'depot', gearId: 'g4' }),
      tripEntryAdded(JURA, 'e-g4-jura', { from: 'depot', gearId: 'g4' }),
      tripEntryAdded(HERE, 'e-g5-here', { from: 'depot', gearId: 'g5' }),
      tripEntryAdded(ALPS, 'e-g5-alps', { from: 'depot', gearId: 'g5' }),
    )

    const overClaims = renderBand(store, HERE)
    expect(overClaims).toHaveLength(5)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 5 entries are claimed by 2 other trips.',
    )
    // Each visible row carries its own Trip, not a repeated headline name.
    expect(screen.getByTestId('over-claim-row-g1')).toHaveTextContent(
      'SINGLE · STILL OUT · Alps 2026',
    )
    expect(screen.getByTestId('over-claim-row-g2')).toHaveTextContent(
      'SINGLE · STILL OUT · Jura 2026',
    )
  })

  it('names an unnamed Trip mid-sentence as "an unnamed trip"', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'temp'),
      tripRenamed(ALPS, null),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'tent' }),
    )

    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 1 entry is already claimed by an unnamed trip.',
    )
  })
})

describe('a claim with no other Trip to name', () => {
  it('states the gear was claimed more than once here, without inventing a Trip name (Single)', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      // Two offline Devices both add the same Gear to the same Trip: two
      // Entries, one gear, no other Trip in sight (ruling 12).
      tripEntryAdded(HERE, 'e-first', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(HERE, 'e-second', { from: 'depot', gearId: 'tent' }),
    )

    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 2 entries claim more of this gear than the depot holds.',
    )
    const row = screen.getByTestId('over-claim-row-tent')
    // Fix round F4: the board's only render of this shape is `×2 LISTED`,
    // gear-agnostic word order — `LISTED ×2` inverted it.
    expect(row).toHaveTextContent('SINGLE · ×2 LISTED')
    expect(row).not.toHaveTextContent('STILL OUT')
    // No other Trip to remove from: the only settle route is here.
    expect(within(row).getAllByRole('button')).toHaveLength(1)
    expect(
      within(row).getByRole('button', { name: 'REMOVE HERE' }),
    ).toBeVisible()
  })

  it('states the same, of the depot, for a Counted Entry alone over its own Owned-count', async () => {
    const store = await seeded(
      gearRecorded('bag', {
        name: 'Sleeping bag, winter',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'bag' }),
      tripEntryBringCountSet(HERE, 'e-here', 3),
    )

    renderBand(store, HERE)

    // Singular — one Entry, no other Trip, and still a real depot quantity.
    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 1 entry claims more of this gear than the depot holds.',
    )
    const row = screen.getByTestId('over-claim-row-bag')
    expect(row).toHaveTextContent('×3 LISTED · OWNED ×2')
    expect(row).not.toHaveTextContent('OUT')
  })

  it('drops OWNED ×N — but keeps the rest of the fact line — when the register is absent (fix round F6)', async () => {
    const store = await seeded(
      gearRecorded('bag', {
        name: 'Sleeping bag, winter',
        container: false,
        kind: 'counted',
        // No `owned_count`: `claim.ts`'s own `supplyAndClaimed` falls back
        // to `1`, which is indistinguishable from a genuinely-owned-one
        // Gear unless a reader checks the register itself rather than
        // trusting `overClaim.supply` alone. Unreachable from this app's
        // own authoring (Add gear always writes `owned_count` for a
        // Counted Kind) — reachable from a peer on a different build.
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'bag' }),
      tripEntryBringCountSet(HERE, 'e-here', 2),
    )

    renderBand(store, HERE)

    const row = screen.getByTestId('over-claim-row-bag')
    expect(row).toHaveTextContent('×2 LISTED')
    expect(row).not.toHaveTextContent('OWNED')
  })

  it('names the People doubled instead of a depot quantity for a per-person Entry (F3)', async () => {
    const store = await seeded(
      gearRecorded('headlamp', {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      personRecorded('mark', 'Mark'),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripParticipantAdded(HERE, 'mark'),
      // Two offline Devices both add the headlamp to the same Trip
      // (claim.ts:236-241's own example) — two Entries, one roster, no
      // other Trip in sight, and no depot quantity to state (invariant 6).
      tripEntryAdded(HERE, 'e-first', { from: 'depot', gearId: 'headlamp' }),
      tripEntryAdded(HERE, 'e-second', { from: 'depot', gearId: 'headlamp' }),
    )

    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 2 entries claim Mark more than once.',
    )
    expect(screen.getByTestId('over-claim-attention')).not.toHaveTextContent(
      'depot',
    )
    const row = screen.getByTestId('over-claim-row-headlamp')
    expect(row).toHaveTextContent('PER-PERSON · CONTESTED Mark')
  })
})

describe('a cross-Trip claim and a here-only claim together (F2)', () => {
  it('draws two lines, each true only of the rows beneath it', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      gearRecorded('stove', {
        name: 'Trangia 25',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      // Cross-Trip: one Entry here, one on Alps.
      tripEntryAdded(HERE, 'e-tent-here', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(ALPS, 'e-tent-alps', { from: 'depot', gearId: 'tent' }),
      // Here-only: two Entries here, no other Trip involved at all.
      tripEntryAdded(HERE, 'e-stove-first', {
        from: 'depot',
        gearId: 'stove',
      }),
      tripEntryAdded(HERE, 'e-stove-second', {
        from: 'depot',
        gearId: 'stove',
      }),
    )

    renderBand(store, HERE)

    const lines = screen.getAllByTestId('over-claim-attention')
    expect(lines).toHaveLength(2)
    // The cross-Trip line counts only the Alps entry — not all three.
    expect(lines[0]).toHaveTextContent(
      '▲ 1 entry is already claimed by Alps 2026.',
    )
    // The here-only line counts only the two stove entries.
    expect(lines[1]).toHaveTextContent(
      '▲ 2 entries claim more of this gear than the depot holds.',
    )
    expect(screen.getByTestId('over-claim-row-tent')).toHaveTextContent(
      'SINGLE · STILL OUT',
    )
    expect(screen.getByTestId('over-claim-row-stove')).toHaveTextContent(
      'SINGLE · ×2 LISTED',
    )
  })

  /**
   * Fix round F7. `group.line` used to be the React key `OverClaimGroups`
   * rendered with — copy, and copy is exactly what an editorial pass
   * changes. `kind` is the partition `overClaimGroups` actually computed,
   * one per shape and never repeated (the function pushes at most one group
   * per kind), so it survives a copy change that this store's own two
   * lines happen not to exercise: nothing here makes the cross-Trip and
   * here-only lines collide, but nothing should have to keep them apart —
   * the key must not depend on it.
   */
  it('keys each group on its kind, not on the copy of its line', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      gearRecorded('stove', {
        name: 'Trangia 25',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-tent-here', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(ALPS, 'e-tent-alps', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(HERE, 'e-stove-first', {
        from: 'depot',
        gearId: 'stove',
      }),
      tripEntryAdded(HERE, 'e-stove-second', {
        from: 'depot',
        gearId: 'stove',
      }),
    )

    const state = store.getState().state
    const groups = overClaimGroups(overClaimsFor(state, HERE), HERE, state)

    expect(groups.map((group) => group.kind)).toEqual([
      'cross-trip',
      'here-only-depot',
    ])
    // No duplicate keys — the property React reconciliation actually needs.
    expect(new Set(groups.map((group) => group.kind)).size).toBe(groups.length)
  })
})

describe('the Counted settle route', () => {
  it('offers BRING FEWER HERE computed from the excess, not REMOVE HERE', async () => {
    const onBringFewer = vi.fn()
    const store = await seeded(
      gearRecorded('bag', {
        name: 'Sleeping bag, winter',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'bag' }),
      tripEntryBringCountSet(HERE, 'e-here', 2),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'bag' }),
      tripEntryBringCountSet(ALPS, 'e-alps', 1),
    )

    const overClaims = renderBand(store, HERE, { onBringFewer })
    expect(overClaims).toEqual([
      expect.objectContaining({ gearId: 'bag', supply: 2, claimed: 3 }),
    ])

    const row = screen.getByTestId('over-claim-row-bag')
    expect(row).toHaveTextContent('×2 LISTED · ×1 OUT · OWNED ×2')
    expect(
      within(row).queryByRole('button', { name: 'REMOVE HERE' }),
    ).toBeNull()

    const user = userEvent.setup()
    await user.click(within(row).getByRole('button', { name: 'BRING ×1 HERE' }))
    expect(onBringFewer).toHaveBeenCalledWith('e-here', 1)
  })

  it('falls back to REMOVE HERE when bringing fewer here could not settle it alone (F9)', async () => {
    const onRemoveHere = vi.fn()
    const store = await seeded(
      gearRecorded('bag', {
        name: 'Sleeping bag, winter',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      // Here brings only one; Alps alone brings five — reducing the here
      // Entry to zero still leaves Alps's five over the Owned-count of two.
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'bag' }),
      tripEntryBringCountSet(HERE, 'e-here', 1),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'bag' }),
      tripEntryBringCountSet(ALPS, 'e-alps', 5),
    )

    renderBand(store, HERE, { onRemoveHere })
    const row = screen.getByTestId('over-claim-row-bag')

    expect(within(row).queryByRole('button', { name: /BRING/ })).toBeNull()
    const user = userEvent.setup()
    await user.click(within(row).getByRole('button', { name: 'REMOVE HERE' }))
    expect(onRemoveHere).toHaveBeenCalledWith('e-here')
  })
})

describe('a per-person over-claim', () => {
  it('names the contested People rather than a supply number', async () => {
    const store = await seeded(
      gearRecorded('headlamp', {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      personRecorded('mark', 'Mark'),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripParticipantAdded(HERE, 'mark'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      // Mark is on both rosters — a per-person Entry draws the *whole* Trip
      // roster, so this is the one Person two Trips both actually claim.
      tripParticipantAdded(ALPS, 'mark'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'headlamp' }),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'headlamp' }),
    )

    renderBand(store, HERE)

    const row = screen.getByTestId('over-claim-row-headlamp')
    expect(row).toHaveTextContent('PER-PERSON · CONTESTED Mark')
    expect(row).not.toHaveTextContent('OWNED')
    expect(
      within(row).getByRole('button', { name: 'REMOVE HERE' }),
    ).toBeVisible()
    expect(
      within(row).getByRole('button', { name: 'REMOVE ON Alps 2026' }),
    ).toBeVisible()
  })
})

describe('the row cap', () => {
  async function seededWithFiveConflicts() {
    return seeded(
      gearRecorded('g1', {
        name: 'Gear one',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g2', {
        name: 'Gear two',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g3', {
        name: 'Gear three',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g4', {
        name: 'Gear four',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g5', {
        name: 'Gear five',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-g1-here', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(ALPS, 'e-g1-alps', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(HERE, 'e-g2-here', { from: 'depot', gearId: 'g2' }),
      tripEntryAdded(ALPS, 'e-g2-alps', { from: 'depot', gearId: 'g2' }),
      tripEntryAdded(HERE, 'e-g3-here', { from: 'depot', gearId: 'g3' }),
      tripEntryAdded(ALPS, 'e-g3-alps', { from: 'depot', gearId: 'g3' }),
      tripEntryAdded(HERE, 'e-g4-here', { from: 'depot', gearId: 'g4' }),
      tripEntryAdded(ALPS, 'e-g4-alps', { from: 'depot', gearId: 'g4' }),
      tripEntryAdded(HERE, 'e-g5-here', { from: 'depot', gearId: 'g5' }),
      tripEntryAdded(ALPS, 'e-g5-alps', { from: 'depot', gearId: 'g5' }),
    )
  }

  it('caps at three rows and offers + N MORE', async () => {
    const store = await seededWithFiveConflicts()
    renderBand(store, HERE)

    expect(screen.getAllByTestId(/^over-claim-row-/)).toHaveLength(3)
    expect(screen.getByTestId('over-claim-more')).toHaveTextContent('+ 2 MORE')
  })

  it('expands in place when + N MORE is clicked', async () => {
    // Not asserted here: that there is "no scroll container". `app/vitest
    // .config.ts` sets no `css` option, so Vitest's `css: false` default
    // applies and no stylesheet ever reaches jsdom — a `toHaveStyle`
    // assertion on `overflowY` would read `visible` unconditionally and pass
    // whether or not `.rows` grew a scroll container. The behavioural half
    // below (3 rows becomes 5, the row itself expands rather than scrolling
    // inside a fixed height) is what this tier can actually hold accountable.
    const store = await seededWithFiveConflicts()
    renderBand(store, HERE)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('over-claim-more'))

    expect(screen.getAllByTestId(/^over-claim-row-/)).toHaveLength(5)
    expect(screen.queryByTestId('over-claim-more')).toBeNull()
  })
})

describe('an unnamed Trip inside a row', () => {
  async function seededWithNamedAndUnnamedOtherTrips() {
    return seeded(
      gearRecorded('g1', {
        name: 'Gear one',
        container: false,
        kind: 'single',
      }),
      gearRecorded('g2', {
        name: 'Gear two',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripCreated(JURA, 'temp'),
      tripRenamed(JURA, null),
      tripPhaseMoved(JURA, 'on_trip'),
      tripEntryAdded(HERE, 'e-g1-here', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(ALPS, 'e-g1-alps', { from: 'depot', gearId: 'g1' }),
      tripEntryAdded(HERE, 'e-g2-here', { from: 'depot', gearId: 'g2' }),
      tripEntryAdded(JURA, 'e-g2-jura', { from: 'depot', gearId: 'g2' }),
    )
  }

  it('renders an unnamed Trip as "Unnamed trip" in a row', async () => {
    const store = await seededWithNamedAndUnnamedOtherTrips()
    renderBand(store, HERE)

    expect(screen.getByTestId('over-claim-row-g2')).toHaveTextContent(
      'SINGLE · STILL OUT · Unnamed trip',
    )
    // Full label, natural case — `.settle`'s CSS uppercases it to
    // `REMOVE ON UNNAMED TRIP` on screen (fix round F1).
    expect(
      within(screen.getByTestId('over-claim-row-g2')).getByRole('button', {
        name: 'REMOVE ON Unnamed trip',
      }),
    ).toBeVisible()
  })

  it('renders no ▲ beside the unnamed name — the data is right', async () => {
    const store = await seededWithNamedAndUnnamedOtherTrips()
    renderBand(store, HERE)

    const row = screen.getByTestId('over-claim-row-g2')
    expect(row.textContent?.includes('▲')).toBe(false)
    // The one ▲ in the whole band is the headline's.
    expect(
      screen.getByTestId('over-claim-attention').textContent?.match(/▲/g),
    ).toHaveLength(1)
  })
})

describe('when there is nothing to settle', () => {
  it('renders nothing at all when there are no over-claims', async () => {
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'tent' }),
    )

    const { container } = render(
      <DepotProvider value={store}>
        <OverClaimBand
          tripId={HERE}
          overClaims={[]}
          onRemoveHere={vi.fn()}
          onRemoveThere={vi.fn()}
          onBringFewer={vi.fn()}
        />
      </DepotProvider>,
    )

    expect(screen.queryByTestId('over-claim-band')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })
})

describe('settle callbacks', () => {
  it('wires REMOVE HERE and REMOVE ON to the right entry and Trip', async () => {
    const onRemoveHere = vi.fn()
    const onRemoveThere = vi.fn()
    const store = await seeded(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
      tripCreated(HERE, 'Ardennen — Sep'),
      tripPhaseMoved(HERE, 'pack_out'),
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'on_trip'),
      tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'tent' }),
      tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'tent' }),
    )

    renderBand(store, HERE, { onRemoveHere, onRemoveThere })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'REMOVE HERE' }))
    expect(onRemoveHere).toHaveBeenCalledWith('e-here')

    await user.click(
      screen.getByRole('button', { name: 'REMOVE ON Alps 2026' }),
    )
    expect(onRemoveThere).toHaveBeenCalledWith(ALPS, 'e-alps')
  })
})

describe('touch-target hit areas (fix round F3: no local treatment)', () => {
  // `.settle` and `.more` are both real `<button>`s, so `ui/styles/base.css`'s
  // global `button { min-height: max(3rem, 48px); }` already floors them to
  // 48px — well past the 44px hit-area minimum — with no rule of their own.
  // A `::after` was tried here once (fix round F1) and reverted: `.settleRow`
  // wraps several `.settle` buttons `--space-12` (12px) apart, and that gap
  // is both the row gap between wrapped lines and the column gap between
  // buttons on one line, so growing vertically through it let two wrapped
  // settle routes' hit areas overlap by 18px. This test pins the revert:
  // neither rule sets its own `min-height`, and neither carries a `::after`.
  it.each(['settle', 'more'] as const)(
    '.%s carries no min-height and no ::after of its own',
    (className) => {
      const text = css()
      const rule =
        new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(text)?.[1] ?? ''
      const afterRule = new RegExp(`\\.${className}::after\\s*\\{`).exec(text)

      expect(rule).not.toMatch(/min-height/)
      expect(rule).not.toMatch(/position:\s*relative/)
      expect(afterRule).toBeNull()
    },
  )

  it('.settleRow wraps buttons with no ::after to overlap across the wrap', () => {
    // With no `::after`, the only thing that could still overlap two
    // wrapped `.settle` buttons is `.settleRow`'s own `gap` shrinking to 0
    // — it must stay a real, positive gap so 48px-tall wrapped rows never
    // touch.
    const text = css()
    const rowRule = /\.settleRow\s*\{([^}]*)\}/.exec(text)?.[1] ?? ''
    expect(rowRule).toMatch(/gap:\s*var\(--space-12\)/)
  })
})
