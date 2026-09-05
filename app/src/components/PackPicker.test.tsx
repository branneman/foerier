import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  gearRecorded,
  placeRecorded,
  tripContainerStageSet,
  tripCreated,
  tripEntryAdded,
  tripEntryMoved,
  type OpSpec,
  type TripResidence,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { DepotProvider, type DepotStoreState } from '../depot/store'
import { anId, seededStore } from '../testUtils'
import { PackPicker } from './PackPicker'

/**
 * `HomePicker.test.tsx`'s harness, over the Trip's world instead of the
 * household's: a **real** store seeded by emitting real ops, never a
 * hand-shaped `DepotState`.
 */

const TRIP = 'tttttttt-0000-7000-8000-000000000009'

type PickerProps = Parameters<typeof PackPicker>[0]

function renderPicker(
  store: StoreApi<DepotStoreState>,
  props: Partial<PickerProps> = {},
) {
  // Real no-ops and a real array, not `vi.fn()`, per `HomePicker.test.tsx`'s
  // own rule for this file's twin.
  const selected: TripResidence[] = []
  const closes: number[] = []
  render(
    <DepotProvider value={store}>
      <PackPicker
        tripId={TRIP}
        title="Crate B"
        onClose={() => closes.push(1)}
        onSelect={(residence) => selected.push(residence)}
        {...props}
      />
    </DepotProvider>,
  )
  return { selected, closes: () => closes.length }
}

/** Every row — `Loose` first, then the containers in drawn order. */
function rows(): readonly HTMLElement[] {
  return screen.getAllByTestId('pack-row')
}

function rowNames(): readonly (string | null)[] {
  return rows().map(
    (row) => within(row).getByTestId('pack-row-name').textContent,
  )
}

function rowFor(name: string): HTMLElement {
  const found = rows().find(
    (row) => within(row).getByTestId('pack-row-name').textContent === name,
  )
  if (found === undefined) throw new Error(`no row named ${name}`)
  return found
}

/**
 * The stylesheet as text — `EntryRow.test.tsx`'s and `drawnSizes.test.ts`'s
 * technique, and the only one that sees CSS at all under
 * `app/vitest.config.ts`'s `css: false`.
 */
function moduleCss(): string {
  return readFileSync(
    join(dirname(expect.getState().testPath ?? ''), 'PackPicker.module.css'),
    'utf8',
  )
}

interface Fixture {
  store: StoreApi<DepotStoreState>
  duffel: string
  crate: string
  sack: string
  rope: string
}

/**
 * One Trip carrying `Duffel 90 L` (a container, in the car), `Crate B` (a
 * container, loose), `Stuff sack` (a container, **inside Crate B**) and
 * `Rope` (plain gear). A Place with a container in it sits in the depot and
 * belongs to the other world — no row here may ever name it.
 */
async function aTripWithContainers(
  ...extra: readonly OpSpec[]
): Promise<Fixture> {
  const atticId = anId()
  const shelfId = anId()

  const duffelGear = anId()
  const crateGear = anId()
  const sackGear = anId()
  const ropeGear = anId()

  const duffel = anId()
  const crate = anId()
  const sack = anId()
  const rope = anId()

  const store = await seededStore([
    // The home world, which this picker must not reach into.
    placeRecorded(atticId, 'Attic'),
    gearRecorded(shelfId, {
      name: 'Shelf L-top',
      container: true,
      kind: 'single',
      residence: { in: 'place', id: atticId },
    }),

    gearRecorded(duffelGear, {
      name: 'Duffel 90 L',
      container: true,
      kind: 'single',
    }),
    gearRecorded(crateGear, {
      name: 'Crate B',
      container: true,
      kind: 'single',
    }),
    gearRecorded(sackGear, {
      name: 'Stuff sack',
      container: true,
      kind: 'single',
    }),
    gearRecorded(ropeGear, { name: 'Rope', container: false, kind: 'single' }),

    tripCreated(TRIP, 'Vosges'),
    tripEntryAdded(TRIP, duffel, { from: 'depot', gearId: duffelGear }),
    tripEntryAdded(TRIP, crate, { from: 'depot', gearId: crateGear }),
    tripEntryAdded(TRIP, sack, { from: 'depot', gearId: sackGear }),
    tripEntryAdded(TRIP, rope, { from: 'depot', gearId: ropeGear }),
    tripEntryMoved(TRIP, sack, { in: 'container', entryId: crate }),
    tripContainerStageSet(TRIP, duffel, 'car'),
    tripContainerStageSet(TRIP, crate, 'car'),
    ...extra,
  ])

  return { store, duffel, crate, sack, rope }
}

describe('the Pack picker', () => {
  it('lists Loose first, then the trip containers', async () => {
    const { store } = await aTripWithContainers()
    renderPicker(store)

    // `Loose` first — a picker lists **destinations**, and ruling A3's
    // last-position `Loose` is about the packing *screen*, which lists work.
    expect(rowNames()).toEqual([
      'Loose',
      'Crate B',
      'Stuff sack',
      'Duffel 90 L',
    ])
    expect(
      within(rowFor('Loose')).getByText('NOT IN A CONTAINER'),
    ).toBeInTheDocument()

    // Plain gear is not a destination (invariant 2's trip twin).
    expect(screen.queryByText('Rope')).toBeNull()
  })

  it('offers no Places, at any depth', async () => {
    const { store } = await aTripWithContainers()
    renderPicker(store)

    // The two-worlds rule: the trip world has no Places, and a container
    // that lives in one is still only reachable here by being an Entry.
    expect(screen.queryByText('Attic')).toBeNull()
    expect(screen.queryByText('Shelf L-top')).toBeNull()
  })

  it('offers no way to create a container', async () => {
    const { store } = await aTripWithContainers()
    renderPicker(store)

    expect(screen.queryByText(/\+ NEW/i)).not.toBeInTheDocument()
    expect(
      screen.getByText('A TRIP CONTAINER IS AN ENTRY ON THE GEAR LIST.'),
    ).toBeInTheDocument()
  })

  it('states what the sheet is for under the gear name', async () => {
    const { store } = await aTripWithContainers()
    renderPicker(store, { title: 'Crate B' })

    const sheet = screen.getByRole('dialog', { name: 'Crate B' })
    expect(sheet).toBeInTheDocument()
    expect(screen.getByText('WHERE IT GOES ON THIS TRIP')).toBeInTheDocument()
    // The fact line is the dialog's *description*, wired through `ui/Sheet`'s
    // `description` — `PieceStatusSheet`'s pattern for this anatomy, so a
    // screen reader hears the gear name and then what the sheet is for.
    expect(sheet).toHaveAccessibleDescription('WHERE IT GOES ON THIS TRIP')
  })

  /**
   * **The right-hand slot carries exactly one read, and `● NOW` outranks the
   * stage.** `docs/design/README.md` §1 — "`● NOW` on the current residence
   * — taking that row's right-hand slot in place of the container's stage,
   * since one row cannot carry two right-hand reads and where the gear
   * stands outranks how far that holder has travelled" — and the board draws
   * the Loose row with `● NOW` at the row's right edge. The dated spec
   * (§4.5) states the swap the other way round; the boards outrank it.
   */
  it("marks the current residence ● NOW, in place of that row's stage", async () => {
    const { store, duffel } = await aTripWithContainers()
    renderPicker(store, { current: { in: 'container', entryId: duffel } })

    const current = rowFor('Duffel 90 L')
    expect(within(current).getByText('● NOW')).toBeInTheDocument()
    // One row, one right-hand read: the stage gives way.
    expect(within(current).queryByText('CAR')).toBeNull()

    expect(within(rowFor('Crate B')).queryByText('● NOW')).toBeNull()
    expect(within(rowFor('Loose')).queryByText('● NOW')).toBeNull()
  })

  it('marks Loose as current when the gear rides loose', async () => {
    const { store } = await aTripWithContainers()
    renderPicker(store, { current: { in: 'loose' } })

    expect(within(rowFor('Loose')).getByText('● NOW')).toBeInTheDocument()
    expect(within(rowFor('Duffel 90 L')).queryByText('● NOW')).toBeNull()
  })

  it("draws each container's own stage in the right-hand slot", async () => {
    const { store } = await aTripWithContainers()
    renderPicker(store)

    expect(within(rowFor('Crate B')).getByText('CAR')).toBeInTheDocument()
    // An Entry with no stage register reads `home` — `stageOf`'s rule, not
    // this component's.
    expect(within(rowFor('Stuff sack')).getByText('⌂ HOME')).toBeInTheDocument()
    // Loose is not a container and has travelled nowhere.
    expect(within(rowFor('Loose')).queryByText('⌂ HOME')).toBeNull()
  })

  it('badges a trip-only container as the gear list does', async () => {
    const borrowed = anId()
    const { store } = await aTripWithContainers(
      tripEntryAdded(TRIP, borrowed, {
        from: 'trip_only',
        name: 'Crate, borrowed',
        container: true,
      }),
    )
    renderPicker(store)

    expect(
      within(rowFor('Crate, borrowed')).getByText('TRIP-ONLY'),
    ).toBeInTheDocument()
    expect(within(rowFor('Duffel 90 L')).queryByText('TRIP-ONLY')).toBeNull()

    /**
     * `EntryRow`'s and `PackingRow`'s note, on the `TRIP-ONLY` badge: the row's
     * flex `gap` separates the two spans on screen and a gap is not a
     * character, so without a real space the row announces them as one
     * glued word. Asserted over the row's whole text content, because a
     * `getByText` on the badge alone matches it in isolation and cannot
     * see a missing separator in front of it.
     */
    const nameLine = rowFor('Crate, borrowed').querySelector(
      '[data-testid="pack-row-name"]',
    )?.parentElement
    expect(nameLine?.textContent).toContain('Crate, borrowed TRIP-ONLY')
    expect(nameLine?.textContent).not.toContain('borrowedTRIP-ONLY')
  })

  /**
   * **The one test in this file whose failure mode is a cycle authored on a
   * single Device** — invariant 3 for the trip world — so it goes three
   * levels deep on purpose. `Stuff sack` alone would prove nothing beyond a
   * one-level `childrenOf(…).filter`: `Pouch` is the **grandchild**, and it
   * is what separates a transitive walk from a single hop.
   */
  it('omits the moved Entry and its whole subtree, at any depth', async () => {
    const { store, crate, sack } = await aTripWithContainers()
    const pouchGear = anId()
    const pouch = anId()
    for (const spec of [
      gearRecorded(pouchGear, {
        name: 'Pouch',
        container: true,
        kind: 'single',
      }),
      tripEntryAdded(TRIP, pouch, { from: 'depot', gearId: pouchGear }),
      // Crate B ▸ Stuff sack ▸ Pouch: two levels below the excluded Entry.
      tripEntryMoved(TRIP, pouch, { in: 'container', entryId: sack }),
    ]) {
      store.getState().emit(spec)
    }
    await store.getState().drained()

    renderPicker(store, {
      excludeEntryId: crate,
      moving: { name: 'Crate B', insideCount: 5 },
    })

    // Scoped to the rows: the sheet's own title *is* the moved gear's name,
    // and the context line and the footer both state it too.
    expect(rowNames()).not.toContain('Crate B')
    expect(rowNames()).not.toContain('Stuff sack')
    expect(rowNames()).not.toContain('Pouch')
    // The rest of the Trip is untouched by the exclusion.
    expect(rowNames()).toEqual(['Loose', 'Duffel 90 L'])
    expect(screen.getByTestId('moving-footer')).toHaveTextContent(
      'Crate B AND EVERYTHING INSIDE IT ARE NOT OFFERED.',
    )
  })

  /**
   * **The footer is about the exclusion, not about `moving`.** The two props
   * do not travel together: a plain Entry or a Piece move passes `moving`
   * for its context line and **no** `excludeEntryId`, because neither can
   * hold anything. A footer drawn on `moving` would then state something
   * false about the list beneath it — every container is offered, and the
   * line would claim one was withheld.
   */
  it('draws no exclusion footer for a move that excludes nothing', async () => {
    const { store } = await aTripWithContainers()
    renderPicker(store, { moving: { name: 'Headlamp', insideCount: 0 } })

    expect(screen.getByTestId('moving-context')).toHaveTextContent(
      'MOVING Headlamp · 0 INSIDE RIDE ALONG',
    )
    expect(screen.queryByTestId('moving-footer')).toBeNull()
    // Nothing was withheld, and the list says so.
    expect(rowNames()).toEqual([
      'Loose',
      'Crate B',
      'Stuff sack',
      'Duffel 90 L',
    ])
  })

  /**
   * And the mirror: the footer names the **excluded Entry**, from the Entry
   * itself, so it stands without `moving` at all.
   */
  it('names the excluded Entry in the footer without a context line', async () => {
    const { store, crate } = await aTripWithContainers()
    renderPicker(store, { excludeEntryId: crate })

    expect(screen.queryByTestId('moving-context')).toBeNull()
    expect(screen.getByTestId('moving-footer')).toHaveTextContent(
      'Crate B AND EVERYTHING INSIDE IT ARE NOT OFFERED.',
    )
  })

  it('states the ride-along in the context line', async () => {
    const { store, crate } = await aTripWithContainers()
    renderPicker(store, {
      excludeEntryId: crate,
      moving: { name: 'Crate B', insideCount: 5 },
    })

    expect(screen.getByTestId('moving-context')).toHaveTextContent(
      'MOVING Crate B · 5 INSIDE RIDE ALONG',
    )
  })

  /**
   * The recorded name is stored in its **recorded case** and drawn in caps
   * by the line's own `text-transform` — `HomePicker`'s convention and
   * ruling F1's (`docs/design/README.md` §5b): one Trip-name rule, and the
   * caps live in CSS. The copy specimen's `MOVING CRATE B · …` is the
   * *rendered* string, which is why the two assertions above read
   * `Crate B` and this one proves the transform that makes them agree.
   */
  it('renders both mono lines in caps through the stylesheet, not the source', async () => {
    const css = moduleCss()
    expect(css).toMatch(/\.context,[\s\S]*?text-transform:\s*uppercase/)
  })

  it('says nothing about a ride-along when nothing is moving', async () => {
    const { store } = await aTripWithContainers()
    renderPicker(store)

    expect(screen.queryByTestId('moving-context')).toBeNull()
    expect(screen.queryByTestId('moving-footer')).toBeNull()
  })

  it('indents nesting 16px per level, capped at two, with skipped ancestry', async () => {
    const { store, crate, sack, duffel } = await aTripWithContainers()
    // A fourth level, so the cap has something to hide: Duffel ▸ Crate B ▸
    // Stuff sack ▸ Pouch.
    const pouchGear = anId()
    const pouch = anId()
    for (const spec of [
      gearRecorded(pouchGear, {
        name: 'Pouch',
        container: true,
        kind: 'single',
      }),
      tripEntryAdded(TRIP, pouch, { from: 'depot', gearId: pouchGear }),
      tripEntryMoved(TRIP, pouch, { in: 'container', entryId: sack }),
      tripEntryMoved(TRIP, crate, { in: 'container', entryId: duffel }),
    ]) {
      store.getState().emit(spec)
    }
    await store.getState().drained()
    renderPicker(store)

    // Duffel ▸ Crate B ▸ Stuff sack ▸ Pouch is depth 0, 1, 2, 3 → 0, 1rem,
    // 2rem, 2rem: the fourth level keeps the cap's indent (`INDENT_CAP = 2`).
    expect(rowFor('Duffel 90 L').style.paddingLeft).toBe('0rem')
    expect(rowFor('Crate B').style.paddingLeft).toBe('1rem')
    expect(rowFor('Stuff sack').style.paddingLeft).toBe('2rem')
    expect(rowFor('Pouch').style.paddingLeft).toBe('2rem')
  })

  it('carries the skipped ancestry as a meta line past the cap', async () => {
    const { store, sack } = await aTripWithContainers()
    const pouchGear = anId()
    const pouch = anId()
    const tinyGear = anId()
    const tiny = anId()
    for (const spec of [
      gearRecorded(pouchGear, {
        name: 'Pouch',
        container: true,
        kind: 'single',
      }),
      gearRecorded(tinyGear, {
        name: 'Tiny bag',
        container: true,
        kind: 'single',
      }),
      tripEntryAdded(TRIP, pouch, { from: 'depot', gearId: pouchGear }),
      tripEntryAdded(TRIP, tiny, { from: 'depot', gearId: tinyGear }),
      tripEntryMoved(TRIP, pouch, { in: 'container', entryId: sack }),
      tripEntryMoved(TRIP, tiny, { in: 'container', entryId: pouch }),
    ]) {
      store.getState().emit(spec)
    }
    await store.getState().drained()
    renderPicker(store)

    // Past the cap the indent stops saying where the row sits, so the row
    // says it itself — outermost first, `tripPath`'s own order.
    expect(rowFor('Tiny bag')).toHaveTextContent('Crate B ▸ Stuff sack ▸ Pouch')
    // Within the cap: nothing to say, so nothing said.
    expect(rowFor('Stuff sack')).not.toHaveTextContent('▸')
  })

  it('selects and closes on a tap', async () => {
    const { store, duffel } = await aTripWithContainers()
    const user = userEvent.setup()
    const { selected, closes } = renderPicker(store)

    await user.click(within(rowFor('Duffel 90 L')).getByRole('button'))

    expect(selected).toEqual([{ in: 'container', entryId: duffel }])
    expect(closes()).toBe(1)
  })

  /**
   * **A no-op selection is reported, not swallowed.** This sheet is pure
   * selection — it holds no Trip and emits nothing — so it cannot know
   * whether the caller means to author an op from a tap on the `● NOW` row.
   * The caller drops a residence equal to the `current` it passed, exactly as
   * the trip screen's SET PHASE emits nothing for the phase a Trip is already
   * in; a redundant `trip.entry_moved` would move the stamp LWW compares.
   * `HomePicker` has the identical gap and the identical contract, and Task
   * 10's caller carries the test that proves the suppression.
   */
  it('reports a tap on the current residence, leaving the caller to drop it', async () => {
    const { store, duffel } = await aTripWithContainers()
    const user = userEvent.setup()
    const { selected, closes } = renderPicker(store, {
      current: { in: 'container', entryId: duffel },
    })

    await user.click(within(rowFor('Duffel 90 L')).getByRole('button'))

    expect(selected).toEqual([{ in: 'container', entryId: duffel }])
    expect(closes()).toBe(1)
  })

  it('selects Loose on a tap', async () => {
    const { store } = await aTripWithContainers()
    const user = userEvent.setup()
    const { selected, closes } = renderPicker(store)

    await user.click(within(rowFor('Loose')).getByRole('button'))

    expect(selected).toEqual([{ in: 'loose' }])
    expect(closes()).toBe(1)
  })

  it('draws the empty state with a quiet line and no button', async () => {
    const store = await seededStore([tripCreated(TRIP, 'Vosges')])
    renderPicker(store, { current: { in: 'loose' } })

    expect(rowNames()).toEqual(['Loose'])
    expect(within(rowFor('Loose')).getByText('● NOW')).toBeInTheDocument()
    expect(
      screen.getByText('No containers on this trip yet.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Add a container to the gear list to pack into it.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /add/i }),
    ).not.toBeInTheDocument()
  })

  /**
   * A Trip this replica has not folded is not an empty Trip, but it offers
   * the same one destination — and `Loose` is a destination no Trip has to
   * exist to name.
   */
  it('offers Loose alone for a Trip that is not in the fold', async () => {
    const store = await seededStore()
    renderPicker(store)

    expect(rowNames()).toEqual(['Loose'])
    expect(
      screen.getByText('No containers on this trip yet.'),
    ).toBeInTheDocument()
  })

  it('says nothing about an empty list once the Trip has a container', async () => {
    const { store } = await aTripWithContainers()
    renderPicker(store)

    expect(screen.queryByText('No containers on this trip yet.')).toBeNull()
  })

  /**
   * The empty line names the **Trip's** state, not the offer's: moving the
   * only container leaves nothing to offer, and `No containers on this trip
   * yet.` would then be false — the footer already says why the list is
   * short.
   */
  it('does not claim an empty Trip when the only container is the one moving', async () => {
    const crateGear = anId()
    const crate = anId()
    const store = await seededStore([
      gearRecorded(crateGear, {
        name: 'Crate B',
        container: true,
        kind: 'single',
      }),
      tripCreated(TRIP, 'Vosges'),
      tripEntryAdded(TRIP, crate, { from: 'depot', gearId: crateGear }),
    ])
    renderPicker(store, {
      excludeEntryId: crate,
      moving: { name: 'Crate B', insideCount: 0 },
    })

    expect(rowNames()).toEqual(['Loose'])
    expect(screen.queryByText('No containers on this trip yet.')).toBeNull()
    expect(screen.getByTestId('moving-footer')).toBeInTheDocument()
  })
})
