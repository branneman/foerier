import {
  createHlcClock,
  gearRecorded,
  tripCreated,
  tripEntryAdded,
  tripPhaseMoved,
  tripRenamed,
  type Clock,
  type IdSource,
  type OpAuthor,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { RemoveElsewhereConfirm } from './RemoveElsewhereConfirm'

/**
 * A **real** store, `OverClaimBand.test.tsx`'s own rule: the confirm reads
 * the other Trip's phase, name and Entry straight out of the fold, so a
 * hand-shaped state would test a shape the reducer might never produce.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000013'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000013'
const HERE = 'trip-here'
const ALPS = 'trip-alps'

const SEEDED_AT = 1_700_000_000_000
const A_DAY = 24 * 60 * 60 * 1000

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

afterEach(() => {
  vi.restoreAllMocks()
})

interface Seeded {
  store: StoreApi<DepotStoreState>
  removals: () => Promise<readonly unknown[]>
}

async function seeded(): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  store.getState().emit(
    gearRecorded('tent', {
      name: 'Tent, tunnel 4p',
      container: false,
      kind: 'single',
    }),
  )
  store.getState().emit(tripCreated(HERE, 'Ardennen — Sep'))
  store.getState().emit(tripPhaseMoved(HERE, 'pack_out'))
  store.getState().emit(tripCreated(ALPS, 'Alps 2026'))
  store.getState().emit(tripPhaseMoved(ALPS, 'on_trip'))
  store
    .getState()
    .emit(tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'tent' }))
  store
    .getState()
    .emit(tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'tent' }))
  await store.getState().drained()

  const removedSoFar = (await removalOps(log)).length
  return {
    store,
    removals: async () => (await removalOps(log)).slice(removedSoFar),
  }
}

async function removalOps(log: OpLog): Promise<readonly unknown[]> {
  const all = await log.all()
  return all
    .filter((entry) => entry.op.type === 'trip.entry_removed')
    .map((entry) => ({
      aggregate_id: entry.op.aggregate_id,
      payload: entry.op.payload,
    }))
}

function renderConfirm(
  seed: Seeded,
  overrides: { entryId?: string; otherTripId?: string } = {},
) {
  let closed = 0
  render(
    <DepotProvider value={seed.store}>
      <RemoveElsewhereConfirm
        otherTripId={overrides.otherTripId ?? ALPS}
        entryId={overrides.entryId ?? 'e-alps'}
        onClose={() => {
          closed += 1
        }}
      />
    </DepotProvider>,
  )
  return { closes: () => closed }
}

describe('the Remove-on-Alps confirm', () => {
  it('names the other Trip in the confirm title and body', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const seed = await seeded()
    renderConfirm(seed)

    const confirm = screen.getByRole('alertdialog')
    expect(confirm).toHaveTextContent('Remove from Alps 2026?')
    expect(confirm).toHaveTextContent(
      'Tent, tunnel 4p comes off the Alps 2026 gear list. The gear itself does not move.',
    )
  })

  it("renders the other Trip's phase and day in the context line", async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT + 11 * A_DAY)
    const seed = await seeded()
    renderConfirm(seed)

    expect(screen.getByTestId('remove-elsewhere-context')).toHaveTextContent(
      '▸ Alps 2026 · ON TRIP · DAY 12',
    )
  })

  it('emits trip.entry_removed against the OTHER Trip’s aggregate', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await seeded()
    const confirm = renderConfirm(seed)

    await user.click(screen.getByRole('button', { name: 'Remove entry' }))
    await seed.store.getState().drained()

    expect(await seed.removals()).toEqual([
      { aggregate_id: ALPS, payload: { entry_id: 'e-alps' } },
    ])
    expect(confirm.closes()).toBe(1)
  })

  it('draws Remove entry before Cancel, the boards’ own DOM order', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const seed = await seeded()
    renderConfirm(seed)

    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Remove entry',
      'Cancel',
    ])
  })

  it('renders nothing when the Entry is gone from the fold — a live race, not a hypothetical', async () => {
    // The confirm can stay mounted while sync runs: another Device's own
    // `trip.entry_removed` for the same Entry can fold in through
    // `/sync/pull` while this confirm is still open. The Trip guard alone
    // does not cover that — the Entry can vanish while the Trip stays.
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const seed = await seeded()
    const { container } = render(
      <DepotProvider value={seed.store}>
        <RemoveElsewhereConfirm
          otherTripId={ALPS}
          entryId="e-does-not-exist"
          onClose={() => {}}
        />
      </DepotProvider>,
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('emits nothing on Cancel', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const user = userEvent.setup()
    const seed = await seeded()
    renderConfirm(seed)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await seed.store.getState().drained()

    expect(await seed.removals()).toEqual([])
  })

  it('reads an unnamed other Trip as Unnamed trip, in title and body', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SEEDED_AT)
    const log: OpLog = inMemoryOpLog()
    const store = createDepotStore({
      log,
      engine: noopEngine,
      author: anAuthor(),
    })
    store.getState().emit(
      gearRecorded('tent', {
        name: 'Tent, tunnel 4p',
        container: false,
        kind: 'single',
      }),
    )
    store.getState().emit(tripCreated(HERE, 'Ardennen — Sep'))
    store.getState().emit(tripPhaseMoved(HERE, 'pack_out'))
    store.getState().emit(tripCreated(ALPS, 'temp'))
    store.getState().emit(tripRenamed(ALPS, null))
    store.getState().emit(tripPhaseMoved(ALPS, 'on_trip'))
    store
      .getState()
      .emit(tripEntryAdded(HERE, 'e-here', { from: 'depot', gearId: 'tent' }))
    store
      .getState()
      .emit(tripEntryAdded(ALPS, 'e-alps', { from: 'depot', gearId: 'tent' }))
    await store.getState().drained()

    render(
      <DepotProvider value={store}>
        <RemoveElsewhereConfirm
          otherTripId={ALPS}
          entryId="e-alps"
          onClose={() => {}}
        />
      </DepotProvider>,
    )

    const confirm = screen.getByRole('alertdialog')
    expect(confirm).toHaveTextContent('Remove from Unnamed trip?')
    expect(confirm).toHaveTextContent(
      'Tent, tunnel 4p comes off the Unnamed trip gear list.',
    )
    expect(screen.getByTestId('remove-elsewhere-context')).toHaveTextContent(
      '▸ Unnamed trip · ON TRIP',
    )
  })
})
