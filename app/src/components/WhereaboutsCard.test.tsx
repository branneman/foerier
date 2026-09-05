import {
  gearRecorded,
  placeRecorded,
  tripContainerStageSet,
  tripCreated,
  tripEntryAdded,
  tripEntryMoved,
  tripPhaseMoved,
  whereabouts,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { anId, seededStore } from '../testUtils'
import {
  WhereaboutsCard,
  type WhereaboutsCardOverClaim,
} from './WhereaboutsCard'

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createHouseholdStore` — by emitting real ops through `emit`, exactly as
 * `GearDetail.test.tsx` and `Find.test.tsx` do, then reads `slices` off the
 * real `whereabouts` selector. `WhereaboutsCard` itself takes only
 * `slices: WhereaboutsSlice[]` and an optional `overClaim`
 * (`docs/design/README.md` §4) — never a full store or a hand-shaped
 * `HouseholdState`.
 */

async function slicesFor(
  specs: readonly OpSpec[],
  gearId: string,
): Promise<ReturnType<typeof whereabouts>['slices']> {
  const store = await seededStore(specs)
  return whereabouts(store.getState().state, gearId).slices
}

/** `RESOLVE` renders through wouter's `Link` (decision 1's `href`), so every
 *  render needs a `Router` ancestor — `TripCard.test.tsx`'s own pattern. */
function renderCard(
  slices: ReturnType<typeof whereabouts>['slices'],
  overClaim?: WhereaboutsCardOverClaim,
) {
  const location = memoryLocation({ path: '/gear/g1', record: true })
  return render(
    <Router hook={location.hook}>
      <WhereaboutsCard slices={slices} {...(overClaim ? { overClaim } : {})} />
    </Router>,
  )
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

    renderCard(slices)

    expect(screen.getByText('⌂ HOME SLOT')).toBeInTheDocument()
    expect(screen.getByText('Attic ▸ Crate B')).toBeInTheDocument()
    // **Single gear carries no count on either row** (S9b, ruling D1: *the
    // right-hand read names the unit that splits*), so the right-hand slot
    // is empty here where it used to read `×1 THERE`. The counted case one
    // test below is where the count is asserted now.
    expect(screen.queryByText(/THERE$/)).not.toBeInTheDocument()
  })

  it('names the quantity only where one splits — counted gear (D1)', async () => {
    const pegId = anId()
    const slices = await slicesFor(
      [
        gearRecorded(pegId, {
          name: 'Tent peg',
          container: false,
          kind: 'counted',
          owned_count: 6,
        }),
      ],
      pegId,
    )

    renderCard(slices)

    expect(screen.getByText('×6 THERE')).toBeInTheDocument()
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

    renderCard(slices)

    // `LOOSE` only renders inside `slices.map`, so this is the assertion
    // that actually depends on the map running.
    expect(screen.getByText('LOOSE')).toBeInTheDocument()
  })

  // D1: a Single splits nothing, so the footer drops the hint's first
  // clause rather than generalising Counted's arithmetic to a Kind with no
  // quantity to state.
  it("drops the hint's first clause for a Single, which splits nothing (D1)", async () => {
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

    renderCard(slices)

    expect(screen.getByText('HOME SLOT IS KEPT WHILE OUT.')).toBeInTheDocument()
    expect(screen.queryByText(/SPLIT COUNT/)).not.toBeInTheDocument()
  })

  it('keeps the full split-count hint for a Kind that does split', async () => {
    const gearId = anId()
    const slices = await slicesFor(
      [
        gearRecorded(gearId, {
          name: 'Mug',
          container: false,
          kind: 'counted',
          owned_count: 3,
        }),
      ],
      gearId,
    )

    renderCard(slices)

    expect(
      screen.getByText(
        'SPLIT COUNT — BOTH TRUE AT ONCE. HOME SLOT IS KEPT WHILE OUT.',
      ),
    ).toBeInTheDocument()
  })

  // The logged collision `WhereaboutsCard`'s own old docstring named:
  // `key={slice.kind}` alone collides the moment two `'trip'` slices exist
  // at once — two active Trips both claiming this Gear, which is legitimate
  // (§5e B2). This is the test that closes it: both rows must render.
  it('draws two active trip slices without colliding, by trip name', async () => {
    const tripAlps = anId()
    const tripVosges = anId()
    const gearId = anId()
    const slices = await slicesFor(
      [
        tripCreated(tripAlps, 'Alps 2026'),
        tripPhaseMoved(tripAlps, 'pack_out'),
        tripCreated(tripVosges, 'Vosges'),
        tripPhaseMoved(tripVosges, 'pack_out'),
        gearRecorded(gearId, {
          name: 'Ice axe',
          container: false,
          kind: 'single',
        }),
        tripEntryAdded(tripAlps, 'e-alps', { from: 'depot', gearId }),
        tripEntryAdded(tripVosges, 'e-vosges', { from: 'depot', gearId }),
      ],
      gearId,
    )

    renderCard(slices)

    expect(screen.getByText('▸ ON TRIP — Alps 2026')).toBeInTheDocument()
    expect(screen.getByText('▸ ON TRIP — Vosges')).toBeInTheDocument()
  })

  it("draws a trip row's value line — container and stage (D2, D3)", async () => {
    const tripId = anId()
    const duffelId = anId()
    const tentId = anId()
    const slices = await slicesFor(
      [
        tripCreated(tripId, 'Alps 2026'),
        tripPhaseMoved(tripId, 'pack_out'),
        gearRecorded(duffelId, {
          name: 'Duffel 90 L',
          container: true,
          kind: 'single',
        }),
        gearRecorded(tentId, {
          name: 'Tent',
          container: false,
          kind: 'single',
        }),
        tripEntryAdded(tripId, 'e-duffel', { from: 'depot', gearId: duffelId }),
        tripContainerStageSet(tripId, 'e-duffel', 'car'),
        tripEntryAdded(tripId, 'e-tent', { from: 'depot', gearId: tentId }),
        tripEntryMoved(tripId, 'e-tent', {
          in: 'container',
          entryId: 'e-duffel',
        }),
      ],
      tentId,
    )

    renderCard(slices)

    expect(screen.getByText('Duffel 90 L · CAR')).toBeInTheDocument()
  })

  it("reads MIXED in the container slot when a trip's residences disagree (D2)", async () => {
    const tripId = anId()
    const duffelId = anId()
    const crateId = anId()
    const pegId = anId()
    const slices = await slicesFor(
      [
        tripCreated(tripId, 'Alps 2026'),
        tripPhaseMoved(tripId, 'pack_out'),
        gearRecorded(duffelId, {
          name: 'Duffel 90 L',
          container: true,
          kind: 'single',
        }),
        gearRecorded(crateId, {
          name: 'Crate B',
          container: true,
          kind: 'single',
        }),
        gearRecorded(pegId, {
          name: 'Tent peg',
          container: false,
          kind: 'single',
        }),
        tripEntryAdded(tripId, 'e-duffel', { from: 'depot', gearId: duffelId }),
        tripContainerStageSet(tripId, 'e-duffel', 'car'),
        tripEntryAdded(tripId, 'e-crate', { from: 'depot', gearId: crateId }),
        tripContainerStageSet(tripId, 'e-crate', 'car'),
        // Two Entries for one Gear on one Trip — nothing in the catalogue
        // forbids it, and it is exactly what makes the residences disagree.
        tripEntryAdded(tripId, 'e-peg-1', { from: 'depot', gearId: pegId }),
        tripEntryMoved(tripId, 'e-peg-1', {
          in: 'container',
          entryId: 'e-duffel',
        }),
        tripEntryAdded(tripId, 'e-peg-2', { from: 'depot', gearId: pegId }),
        tripEntryMoved(tripId, 'e-peg-2', {
          in: 'container',
          entryId: 'e-crate',
        }),
      ],
      pegId,
    )

    renderCard(slices)

    // Both containers ride at `car`, so the stage still agrees — MIXED
    // never draws a second `MIXED` in its place (D2).
    expect(screen.getByText('MIXED · CAR')).toBeInTheDocument()
  })

  it('draws the ▲ over-claim footer with a RESOLVE door (D7, D8)', async () => {
    const gearId = anId()
    const slices = await slicesFor(
      [
        gearRecorded(gearId, {
          name: 'Gas canister',
          container: false,
          kind: 'counted',
          owned_count: 2,
        }),
      ],
      gearId,
    )

    renderCard(slices, {
      text: 'CLAIMED ×4 · OWNED ×2',
      href: '/trips/alps-id',
      resolveLabel: 'Resolve on Alps 2026',
    })

    expect(screen.getByText('▲ CLAIMED ×4 · OWNED ×2')).toBeInTheDocument()
    const resolve = screen.getByRole('link', { name: 'Resolve on Alps 2026' })
    expect(resolve).toHaveTextContent('RESOLVE')
    expect(resolve).toHaveAttribute('href', '/trips/alps-id')
    // The over-claim footer replaces the ordinary hint outright — one ▲,
    // one door, never both readings at once.
    expect(screen.queryByText(/SPLIT COUNT/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('HOME SLOT IS KEPT WHILE OUT.'),
    ).not.toBeInTheDocument()
  })
})
