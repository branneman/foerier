import {
  gearRecorded,
  placeRecorded,
  whereabouts,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { anId, seededStore } from '../testUtils'
import { WhereaboutsCard } from './WhereaboutsCard'

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createDepotStore` — by emitting real ops through `emit`, exactly as
 * `GearDetail.test.tsx` and `Find.test.tsx` do, then reads `slices` off the
 * real `whereabouts` selector. `WhereaboutsCard` itself takes only
 * `slices: WhereaboutsSlice[]` (`docs/design/README.md` §4) — never a full
 * store or a hand-shaped `DepotState`.
 */

async function slicesFor(
  specs: readonly OpSpec[],
  gearId: string,
): Promise<ReturnType<typeof whereabouts>['slices']> {
  const store = await seededStore(specs)
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

  it('shows an empty path as loose rather than as a blank row, and the split-count hint', async () => {
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

    // `LOOSE` only renders inside `slices.map`, so this is the assertion
    // that actually depends on the map running — the hint below is a
    // static footer outside it and would pass with the map deleted, which
    // is why it rides along here rather than carrying its own test.
    expect(screen.getByText('LOOSE')).toBeInTheDocument()
    expect(
      screen.getByText(
        'SPLIT COUNT — BOTH TRUE AT ONCE. HOME SLOT IS KEPT WHILE OUT.',
      ),
    ).toBeInTheDocument()
  })
})
