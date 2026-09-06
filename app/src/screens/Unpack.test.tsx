import {
  gearRecorded,
  personRecorded,
  placeRecorded,
  tripConsumedCountSet,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripOutcomeSet,
  tripParticipantAdded,
  type HouseholdState,
  type OpSpec,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { inMemoryOpLog, type OpLog } from '../household/opLog'
import { createHouseholdStore, HouseholdProvider } from '../household/store'
import { DESKTOP, SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { anAuthor, noopEngine } from '../testUtils'
import { Unpack } from './Unpack'

/**
 * **F5's shell** — its route, its band, its title, its count line and bar,
 * and its empty state (`docs/design/README.md` §7, spec
 * `docs/specs/2026-09-05-unpack-resolve-and-close.md` §4.1–§4.2). The
 * segmented control, the `○ OPEN` filter, the hint, the groups, the three
 * sheets, the over-claim band and the close card are every one of them a
 * later task's scope.
 *
 * `Packing.test.tsx`'s own `renderPacking` harness, copied verbatim as
 * `renderUnpack`: a real store and the real reducer, seeded by emitting real
 * ops, with an `authored()` handle that subtracts the seed — the assertion
 * that a screen standing on an unknown `tripId` writes nothing.
 */

const ALPS = 'tttttttt-0000-7000-8000-00000000000a'

const STOVE = 'gggggggg-0000-7000-8000-00000000000a'
const HEADLAMP = 'gggggggg-0000-7000-8000-00000000000b'

const E_STOVE = 'nnnnnnnn-0000-7000-8000-00000000000a'
const E_HEADLAMP = 'nnnnnnnn-0000-7000-8000-00000000000b'

type OpPayload = Record<string, unknown>

interface Seeded {
  /** Everything the *screen* authored — the seed is subtracted. */
  authored: () => Promise<readonly { type: string; payload: OpPayload }[]>
  state: () => HouseholdState
}

/** Renders `/trips/:id/unpack` at `path`, over a store seeded with `specs`. */
async function renderUnpack(
  path: string,
  ...specs: readonly OpSpec[]
): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createHouseholdStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const seedCount = (await log.all()).length

  const location = memoryLocation({ path, record: true })
  render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/trips/:id/unpack">
          <HouseholdProvider value={store}>
            <Unpack />
          </HouseholdProvider>
        </Route>
      </Switch>
    </Router>,
  )

  return {
    authored: async () => {
      await store.getState().drained()
      return (await log.all())
        .slice(seedCount)
        .map((entry) => ({ type: entry.op.type, payload: entry.op.payload }))
    },
    state: () => store.getState().state,
  }
}

/** The Alps with one Participant and nothing on the list yet. */
function alps(): readonly OpSpec[] {
  return [
    personRecorded('els', 'Els'),
    tripCreated(ALPS, 'Alps 2026'),
    tripParticipantAdded(ALPS, 'els'),
  ]
}

/**
 * Two depot Entries, one resolved: a Single back, a per-person Entry (one
 * Participant) still open. `resolved: 1, total: 2, open: 1` — the count
 * line's own `● 1/2 RESOLVED` and `1 OPEN`.
 */
function twoWithOneResolved(): readonly OpSpec[] {
  return [
    ...alps(),

    gearRecorded(STOVE, { name: 'Stove', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_STOVE, { from: 'depot', gearId: STOVE }),
    tripOutcomeSet(ALPS, E_STOVE, 'back'),

    gearRecorded(HEADLAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(ALPS, E_HEADLAMP, { from: 'depot', gearId: HEADLAMP }),
  ]
}

const ATTIC = 'pppppppp-0000-7000-8000-00000000000a'
const KELDER = 'pppppppp-0000-7000-8000-00000000000b'

const SHELF = 'gggggggg-0000-7000-8000-00000000000c'
const CRATE_B = 'gggggggg-0000-7000-8000-00000000000d'
const SLEEPING_BAG = 'gggggggg-0000-7000-8000-00000000000e'
const DUFFEL = 'gggggggg-0000-7000-8000-00000000000f'
const BAK_3 = 'gggggggg-0000-7000-8000-000000000012'
const GAS_CANISTER = 'gggggggg-0000-7000-8000-000000000013'
const COOK_SET = 'gggggggg-0000-7000-8000-000000000014'
const TREKKING_POLES = 'gggggggg-0000-7000-8000-000000000015'

const E_BAG = 'nnnnnnnn-0000-7000-8000-000000000010'
const E_DUFFEL = 'nnnnnnnn-0000-7000-8000-000000000011'
const E_GAS = 'nnnnnnnn-0000-7000-8000-000000000014'
const E_COOK = 'nnnnnnnn-0000-7000-8000-000000000015'
const E_POLES = 'nnnnnnnn-0000-7000-8000-000000000016'
const E_PASSPORTS = 'nnnnnnnn-0000-7000-8000-000000000017'

/**
 * F3/F6's own scenario — `docs/design/README.md` §7's board (§01), minus the
 * two forms Task 10 does not build: the per-person cluster row (Task 13) and
 * a re-homed row's meta (Task 14).
 *
 * `Attic`: `Sleeping bag, winter` two levels deep (`Shelf L-Top ▸ Crate B`),
 * a Counted Entry, `back` — the plain-quantity form. `Duffel 90 L`, a
 * container one level deep (`Shelf L-Top`), `back`, with two Entries moved
 * inside it on the Trip — the container's `N INSIDE` form.
 *
 * `Kelder`: `Gas canister 450`, a Counted Entry (`bring 4`), `consumed` with
 * `consumedCount 2` — the consumed-split form. `Cook set`, a Single, `open`
 * — the plain no-suffix form.
 *
 * `Loose`: `Trekking poles`, a Counted Entry (`bring 2`) with no residence
 * at all, `open` — the quantity-with-no-path form.
 *
 * `Trip-only`: `Passports, all`, naming no Gear.
 */
function destinationScenario(): readonly OpSpec[] {
  return [
    ...alps(),

    placeRecorded(ATTIC, 'Attic'),
    placeRecorded(KELDER, 'Kelder'),

    gearRecorded(SHELF, {
      name: 'Shelf L-Top',
      container: true,
      kind: 'single',
      residence: { in: 'place', id: ATTIC },
    }),
    gearRecorded(CRATE_B, {
      name: 'Crate B',
      container: true,
      kind: 'single',
      residence: { in: 'gear', id: SHELF },
    }),
    gearRecorded(SLEEPING_BAG, {
      name: 'Sleeping bag, winter',
      container: false,
      kind: 'counted',
      residence: { in: 'gear', id: CRATE_B },
    }),
    tripEntryAdded(ALPS, E_BAG, { from: 'depot', gearId: SLEEPING_BAG }),
    tripEntryBringCountSet(ALPS, E_BAG, 2),
    tripOutcomeSet(ALPS, E_BAG, 'back'),

    gearRecorded(DUFFEL, {
      name: 'Duffel 90 L',
      container: true,
      kind: 'single',
      residence: { in: 'gear', id: SHELF },
    }),
    tripEntryAdded(ALPS, E_DUFFEL, { from: 'depot', gearId: DUFFEL }),
    tripOutcomeSet(ALPS, E_DUFFEL, 'back'),

    gearRecorded(BAK_3, {
      name: 'Bak 3',
      container: true,
      kind: 'single',
      residence: { in: 'place', id: KELDER },
    }),
    gearRecorded(GAS_CANISTER, {
      name: 'Gas canister 450',
      container: false,
      kind: 'counted',
      residence: { in: 'gear', id: BAK_3 },
    }),
    tripEntryAdded(ALPS, E_GAS, { from: 'depot', gearId: GAS_CANISTER }),
    tripEntryBringCountSet(ALPS, E_GAS, 4),
    tripOutcomeSet(ALPS, E_GAS, 'consumed'),
    tripConsumedCountSet(ALPS, E_GAS, 2),

    gearRecorded(COOK_SET, {
      name: 'Cook set',
      container: false,
      kind: 'single',
      residence: { in: 'gear', id: BAK_3 },
    }),
    tripEntryAdded(ALPS, E_COOK, { from: 'depot', gearId: COOK_SET }),

    gearRecorded(TREKKING_POLES, {
      name: 'Trekking poles',
      container: false,
      kind: 'counted',
    }),
    tripEntryAdded(ALPS, E_POLES, { from: 'depot', gearId: TREKKING_POLES }),
    tripEntryBringCountSet(ALPS, E_POLES, 2),

    tripEntryAdded(ALPS, E_PASSPORTS, {
      from: 'trip_only',
      name: 'Passports, all',
      container: false,
    }),

    // Two Entries riding inside the duffel **on the Trip** — `subtreeOf`'s
    // own count. `trip.entry_moved` is a trip residence, entirely unrelated
    // to either Entry's *home* containment, so this changes nothing about
    // where the Gas canister or the Cook set are grouped or what their own
    // return path meta reads.
    tripEntryMoved(ALPS, E_GAS, { in: 'container', entryId: E_DUFFEL }),
    tripEntryMoved(ALPS, E_COOK, { in: 'container', entryId: E_DUFFEL }),
  ]
}

describe('the unpack screen — the shell every mode hangs off', () => {
  it('draws the title Unpack', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...alps())

    expect(screen.getByRole('heading', { name: 'Unpack' })).toBeVisible()
  })

  it('draws the back link to the Trip it belongs to', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...alps())

    expect(screen.getByRole('link', { name: '‹ Alps 2026' })).toHaveAttribute(
      'href',
      `/trips/${ALPS}`,
    )
  })

  /** `Packing.tsx`'s own reason, transplanted: the 216px sidebar carries
   * `TRIPS`, not `Alps 2026`, so this screen's back link is owed at Desktop
   * too. `screenBand.test.tsx` proves the other side of this — the same
   * screen *inside* `AppShell` — because a per-screen suite renders the
   * screen alone. */
  it('keeps the back link at Desktop, where the sidebar names TRIPS', async () => {
    setViewport(SPLIT, DESKTOP)
    await renderUnpack(`/trips/${ALPS}/unpack`, ...alps())

    expect(screen.getByRole('link', { name: '‹ Alps 2026' })).toBeVisible()
  })

  /** §3.3's rule: the sync line is the screen's at Split and only at Split,
   * since `AppShell` puts a bare 6px dot in the rail there. */
  it('draws its own sync line at Split', async () => {
    setViewport(SPLIT)
    await renderUnpack(`/trips/${ALPS}/unpack`, ...alps())

    expect(screen.getByTestId('unpack-sync')).toBeVisible()
  })

  it.each([
    ['a phone', [] as readonly string[]],
    ['Desktop', [SPLIT, DESKTOP] as readonly string[]],
  ])(
    'withholds the sync line at %s, where AppShell states it in words',
    async (_mode, queries) => {
      setViewport(...queries)
      await renderUnpack(`/trips/${ALPS}/unpack`, ...alps())

      expect(screen.queryByTestId('unpack-sync')).not.toBeInTheDocument()
    },
  )

  /**
   * `Trip.tsx`'s and `Packing.tsx`'s guard, with every hook above it (S7
   * review F2): a control reachable against an unknown `tripId` would author
   * an op materialising a Trip that no delete op can remove before S14.
   */
  it('says No such trip. for an unknown id, and authors nothing', async () => {
    const seeded = await renderUnpack(
      '/trips/tttttttt-0000-7000-8000-0000000000ff/unpack',
      ...alps(),
    )

    expect(screen.getByText('No such trip.')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Unpack' })).toBeNull()
    expect(await seeded.authored()).toEqual([])
  })
})

describe('the count line and the bar', () => {
  it('draws the count line and the bar', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...twoWithOneResolved())

    expect(screen.getByText('● 1/2 RESOLVED')).toBeInTheDocument()
    expect(screen.getByText('1 OPEN')).toBeInTheDocument()
    expect(screen.getByTestId('unpack-bar')).toBeInTheDocument()
  })
})

describe('the empty screen (F19)', () => {
  /**
   * F19, word for word: a domain fact, not a promise. The count line and the
   * bar are absent, not zeroed — `● 0/0 RESOLVED` states an arithmetic
   * nobody asked for.
   */
  it('draws 0 ENTRIES. and the source line', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...alps())

    expect(screen.getByText('0 ENTRIES.')).toBeInTheDocument()
    expect(
      screen.getByText('The gear list is built from the depot.'),
    ).toBeInTheDocument()
  })

  /**
   * The four absences by name — this task's own scope discipline stated as
   * an assertion: no count line, no controls, no hint, no close card. The
   * three named controls/hint/close-card do not exist yet at all (they are
   * later tasks' scope), so this also stands as the net that would catch one
   * landing here by accident, ahead of its own task.
   */
  it('withholds the count line, the controls, the hint and the close card', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...alps())

    expect(screen.queryByText(/RESOLVED/)).not.toBeInTheDocument()
    expect(screen.queryByText(/OPEN/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('unpack-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unpack-controls')).not.toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unpack-close-card')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Close trip/ }),
    ).not.toBeInTheDocument()
  })

  it('keeps the title and the back link', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...alps())

    expect(screen.getByRole('heading', { name: 'Unpack' })).toBeVisible()
    expect(screen.getByRole('link', { name: '‹ Alps 2026' })).toBeVisible()
  })
})

/** Finds the group `<section>` by its visible header name — `Attic`,
 * `Kelder`, `Loose`, `Trip-only`. */
function groupNamed(name: string): HTMLElement {
  const headings = screen.getAllByTestId('unpack-group-name')
  const match = headings.find((el) => el.textContent === name)
  if (match === undefined) throw new Error(`no group named ${name}`)
  const section = match.closest('section')
  if (section === null) throw new Error(`group ${name} has no section`)
  return section
}

describe('DESTINATION mode — groups (F3)', () => {
  it('orders rooms A→Z, then Loose, then Trip-only', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    const names = screen
      .getAllByTestId('unpack-group-name')
      .map((el) => el.textContent)

    expect(names).toEqual(['Attic', 'Kelder', 'Loose', 'Trip-only'])
  })

  it('reads a room header as resolved/units', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    // Attic: Sleeping bag ×2 back (resolved) + Duffel ×1 back (resolved) = 3/3.
    const attic = groupNamed('Attic')
    expect(within(attic).getByText('3/3')).toBeInTheDocument()

    // Kelder: Gas canister ×4 consumed (resolved) + Cook set ×1 open = 4/5.
    const kelder = groupNamed('Kelder')
    expect(within(kelder).getByText('4/5')).toBeInTheDocument()
  })

  it('reads the Loose header muted, with NO HOME SLOT', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    const loose = groupNamed('Loose')
    expect(within(loose).getByText('NO HOME SLOT')).toBeInTheDocument()
    // Trekking poles ×2, open — 0/2.
    expect(within(loose).getByText('0/2')).toBeInTheDocument()
  })

  it('reads the Trip-only header as a plain count, with its own meta', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    const tripOnly = groupNamed('Trip-only')
    expect(
      within(tripOnly).getByText('TAKES NO OUTCOME · CLEARED AT CLOSE'),
    ).toBeInTheDocument()
    expect(within(tripOnly).getByText('1')).toBeInTheDocument()
  })
})

describe('DESTINATION mode — the row (F6)', () => {
  it('draws the plain-quantity return path form', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    expect(screen.getByText('→ Shelf L-Top ▸ Crate B · ×2')).toBeInTheDocument()
  })

  it("draws a container's return path form, N INSIDE, and no rail", async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    expect(screen.getByText('→ Shelf L-Top · 2 INSIDE')).toBeInTheDocument()

    const row = screen.getByTestId(`unpack-row-${E_DUFFEL}`)
    expect(within(row).queryByTestId('journey-rail')).not.toBeInTheDocument()
  })

  it("draws a consumed Counted's return path form", async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    expect(
      screen.getByText('→ Bak 3 · ×2 CONSUMED · ×2 BACK'),
    ).toBeInTheDocument()
  })

  it('draws a plain Single with no suffix', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    expect(screen.getByText('→ Bak 3')).toBeInTheDocument()
  })

  it('draws a quantity with no path for Loose Counted gear', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    expect(screen.getByText('×2')).toBeInTheDocument()
  })

  it('draws the four pills', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    expect(
      screen.getAllByRole('button', { name: '● BACK' }).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByRole('button', { name: '○ OPEN' }).length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'CONSUMED' })).toBeInTheDocument()
  })

  it('draws ▲ LOST alone, and never in the meta', async () => {
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...destinationScenario(),
      tripOutcomeSet(ALPS, E_COOK, 'lost'),
    )

    expect(screen.getByRole('button', { name: '▲ LOST' })).toBeInTheDocument()
    // The meta is where it goes; the pill is what happened (F6) — no meta
    // line ever carries the ▲ glyph, whatever the row's outcome.
    for (const meta of screen.getAllByTestId('unpack-row-meta')) {
      expect(meta.textContent).not.toContain('▲')
    }
  })
})

describe('DESTINATION mode — a trip-only row (F6)', () => {
  it('draws no button in the row, and NOT IN DEPOT as its meta', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    const row = screen.getByTestId(`unpack-row-${E_PASSPORTS}`)
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    expect(within(row).getByText('NOT IN DEPOT')).toBeInTheDocument()
    expect(within(row).getByText('CLEARS AT CLOSE')).toBeInTheDocument()
  })

  /**
   * `patterns.md` §6.6: a flex `gap` is not a character, so `getByText` on
   * the badge alone cannot see a missing space — this reads the row's own
   * **parent** text content, which is exactly what a screen reader's
   * concatenation (and an enclosing accessible name) would glue.
   */
  it('keeps a real space between the name and the TRIP-ONLY badge', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    const badge = screen.getByTestId('unpack-row-badge')
    expect(badge.parentElement).toHaveTextContent('Passports, all TRIP-ONLY')
  })
})
