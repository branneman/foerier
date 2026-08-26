import {
  createHlcClock,
  gearRecorded,
  placeRecorded,
  whereabouts,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { inMemoryOpLog } from '../depot/opLog'
import { createDepotStore, type EngineFactory } from '../depot/store'
import { WhereaboutsCard } from './WhereaboutsCard'

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createDepotStore` — by emitting real ops through `emit`, exactly as
 * `GearDetail.test.tsx` and `Find.test.tsx` do, then reads `slices` off the
 * real `whereabouts` selector. `WhereaboutsCard` itself takes only
 * `slices: WhereaboutsSlice[]` (`docs/design/README.md` §4) — never a full
 * store or a hand-shaped `DepotState`.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

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

async function slicesFor(
  specs: readonly OpSpec[],
  gearId: string,
): Promise<ReturnType<typeof whereabouts>['slices']> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return whereabouts(store.getState().state, gearId).slices
}

describe('WhereaboutsCard', () => {
  it('shows the home slot with its full path', async () => {
    const placeId = anId()
    const crateId = anId()
    const tentId = anId()
    const slices = await slicesFor(
      [
        placeRecorded(placeId, 'Attic'),
        gearRecorded(crateId, {
          name: 'Crate B',
          container: true,
          kind: 'single',
          residence: { in: 'place', id: placeId },
        }),
        gearRecorded(tentId, {
          name: 'Tent',
          container: false,
          kind: 'single',
          residence: { in: 'gear', id: crateId },
        }),
      ],
      tentId,
    )

    render(<WhereaboutsCard slices={slices} />)

    expect(screen.getByText('⌂ HOME SLOT')).toBeInTheDocument()
    expect(screen.getByText('Attic ▸ Crate B')).toBeInTheDocument()
    expect(screen.getByText('×1 THERE')).toBeInTheDocument()
  })

  it('shows the split-count hint', async () => {
    const gearId = anId()
    const slices = await slicesFor(
      [
        gearRecorded(gearId, {
          name: 'Rope',
          container: false,
          kind: 'single',
        }),
      ],
      gearId,
    )

    render(<WhereaboutsCard slices={slices} />)

    expect(
      screen.getByText(
        'SPLIT COUNT — BOTH TRUE AT ONCE. HOME SLOT IS KEPT WHILE OUT.',
      ),
    ).toBeInTheDocument()
  })

  it('shows an empty path as loose rather than as a blank row', async () => {
    const gearId = anId()
    const slices = await slicesFor(
      [
        gearRecorded(gearId, {
          name: 'Rope',
          container: false,
          kind: 'single',
        }),
      ],
      gearId,
    )

    render(<WhereaboutsCard slices={slices} />)

    expect(screen.getByText('LOOSE')).toBeInTheDocument()
  })
})
