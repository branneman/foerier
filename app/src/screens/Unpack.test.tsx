import {
  gearRecorded,
  gearRehomed,
  personRecorded,
  placeRecorded,
  tripConsumedCountSet,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripOutcomeSet,
  tripParticipantAdded,
  tripPhaseMoved,
  type HouseholdState,
  type OpSpec,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
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
// A second Active Trip, elsewhere — the over-claim band's own "there".
const VOSGES = 'tttttttt-0000-7000-8000-00000000000b'

const STOVE = 'gggggggg-0000-7000-8000-00000000000a'
const HEADLAMP = 'gggggggg-0000-7000-8000-00000000000b'
const FILTER = 'gggggggg-0000-7000-8000-000000000080'

const E_STOVE = 'nnnnnnnn-0000-7000-8000-00000000000a'
const E_HEADLAMP = 'nnnnnnnn-0000-7000-8000-00000000000b'
const E_FILTER_ALPS = 'nnnnnnnn-0000-7000-8000-000000000080'
const E_FILTER_VOSGES = 'nnnnnnnn-0000-7000-8000-000000000081'

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
 * **F15's own fixture** (spec §4.9) — a Single Gear, `Water filter`, claimed
 * by two Active Trips: Alps (this screen) and Vosges (elsewhere). `alps()`'s
 * own phase is `draft`, which is not enough on its own — `claim.ts`'s
 * `overClaimsFor` counts only an Active Trip (`isActive`), so both Trips are
 * moved into one here. Neither Entry has an outcome recorded, which is what
 * makes this a genuine, standing over-claim: an owned-×1 Single claimed
 * twice.
 */
function overClaimedAcrossTrips(): readonly OpSpec[] {
  return [
    ...alps(),
    tripPhaseMoved(ALPS, 'unpack'),
    tripCreated(VOSGES, 'Vosges 2026'),
    tripPhaseMoved(VOSGES, 'on_trip'),
    gearRecorded(FILTER, {
      name: 'Water filter',
      container: false,
      kind: 'single',
    }),
    tripEntryAdded(ALPS, E_FILTER_ALPS, { from: 'depot', gearId: FILTER }),
    tripEntryAdded(VOSGES, E_FILTER_VOSGES, { from: 'depot', gearId: FILTER }),
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
const HAL = 'pppppppp-0000-7000-8000-00000000000c'

const SHELF = 'gggggggg-0000-7000-8000-00000000000c'
const CRATE_B = 'gggggggg-0000-7000-8000-00000000000d'
const SLEEPING_BAG = 'gggggggg-0000-7000-8000-00000000000e'
const DUFFEL = 'gggggggg-0000-7000-8000-00000000000f'
const BAK_3 = 'gggggggg-0000-7000-8000-000000000012'
const GAS_CANISTER = 'gggggggg-0000-7000-8000-000000000013'
const COOK_SET = 'gggggggg-0000-7000-8000-000000000014'
const TREKKING_POLES = 'gggggggg-0000-7000-8000-000000000015'
const HAL_HEADLAMP = 'gggggggg-0000-7000-8000-000000000016'

const E_BAG = 'nnnnnnnn-0000-7000-8000-000000000010'
const E_DUFFEL = 'nnnnnnnn-0000-7000-8000-000000000011'
const E_GAS = 'nnnnnnnn-0000-7000-8000-000000000014'
const E_COOK = 'nnnnnnnn-0000-7000-8000-000000000015'
const E_POLES = 'nnnnnnnn-0000-7000-8000-000000000016'
const E_PASSPORTS = 'nnnnnnnn-0000-7000-8000-000000000017'
const E_HAL_HEADLAMP = 'nnnnnnnn-0000-7000-8000-000000000018'

/**
 * F3/F6's own scenario — `docs/design/README.md` §7's board (§01), minus the
 * one form no task before Task 14 builds: a re-homed row's meta.
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
 * `Hal`: `Headlamp`, a per-person Entry with one Participant (Els), open —
 * the board's own `Hal 3/3` case, one Participant short: Task 13's own
 * cluster row, `0/1`. Kept simple deliberately — the roster sheet's own
 * three-Participant shape is `OutcomeSheet.test.tsx`'s fixture to carry.
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
    placeRecorded(HAL, 'Hal'),

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

    // A per-person Entry, resolved by nobody yet — Task 13's own row (the
    // 34px cluster), skipped here (`destinationGroups`' own rule) but its
    // room still has to draw a real `resolved/units` header above the empty
    // list it leaves behind.
    gearRecorded(HAL_HEADLAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
      residence: { in: 'place', id: HAL },
    }),
    tripEntryAdded(ALPS, E_HAL_HEADLAMP, {
      from: 'depot',
      gearId: HAL_HEADLAMP,
    }),

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

    // Two Entries riding inside the duffel **on the Trip**, and G2's
    // `N INSIDE` counts their **units**: the Gas canister's Bring-count of
    // 4 plus the Cook set's 1, so the duffel reads `▸ 5 INSIDE`, not `2`.
    // `trip.entry_moved` is a trip residence, entirely unrelated to either
    // Entry's *home* containment, so this changes nothing about where the
    // Gas canister or the Cook set are grouped or what their own return
    // path meta reads.
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
    // A distinct test id, not the bare text: the close card's own summary
    // line (this task) also ends in `N OPEN`, and on this Trip the two
    // numbers coincide.
    expect(screen.getByTestId('unpack-open-count')).toHaveTextContent('1 OPEN')
    expect(screen.getByTestId('unpack-bar')).toBeInTheDocument()
  })
})

describe('the over-claim band (F15, spec §4.9)', () => {
  it('renders between the count block and the controls, facts-only', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...overClaimedAcrossTrips())

    const bar = screen.getByTestId('unpack-bar')
    const band = screen.getByTestId('over-claim-band')
    const controls = screen.getByTestId('unpack-controls')

    // Sits between the count block and the controls, not merely somewhere
    // on the page — the same `previousElementSibling`/`nextElementSibling`
    // discipline the close card's own position test uses.
    expect(bar.nextElementSibling).toBe(band)
    expect(band.nextElementSibling).toBe(controls)

    expect(screen.getByTestId('over-claim-attention')).toHaveTextContent(
      '▲ 1 entry is already claimed by Vosges 2026.',
    )
    expect(
      within(screen.getByTestId(`over-claim-row-${FILTER}`)).getByTestId(
        'over-claim-fact',
      ),
    ).toHaveTextContent('SINGLE · STILL OPEN HERE')

    // Facts-only (§5b I): no `REMOVE HERE`/`BRING ×N HERE` — no route at
    // all, since the row of routes is what `settle` being absent withholds.
    expect(within(band).queryByRole('button')).not.toBeInTheDocument()
  })

  /**
   * Resolving the row is the ordinary way an over-claim ends on this screen
   * (spec §4.9) — and the test that proves the claim gate this slice built
   * earlier actually reaches F5: `claim.ts`'s own rule is that a claim
   * releases the moment an outcome is recorded for the contributing Entry.
   */
  it('disappears once its own row is resolved here', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...overClaimedAcrossTrips())

    expect(screen.getByTestId('over-claim-band')).toBeInTheDocument()

    const row = screen.getByTestId(`unpack-row-${E_FILTER_ALPS}`)
    await user.click(within(row).getByRole('button', { name: '○ OPEN' }))
    const sheet = screen.getByRole('dialog', { name: 'Water filter' })
    await user.click(within(sheet).getByRole('button', { name: '● BACK' }))

    expect(screen.queryByTestId('over-claim-band')).not.toBeInTheDocument()
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

    expect(names).toEqual(['Attic', 'Hal', 'Kelder', 'Loose', 'Trip-only'])
  })

  /**
   * The board's own `Hal 3/3` case, one room early — a per-person Entry is
   * skipped from the row list here (Task 13's cluster), but its units still
   * count in the header, read from `unpackItems` directly. **If Task 13
   * ever misses this room**, this is the test that would catch it: without
   * a per-person Entry in the fixture at all, nothing would notice.
   */
  it('reads a per-person-only room header and its one cluster row', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    const hal = groupNamed('Hal')
    expect(within(hal).getByText('0/1')).toBeInTheDocument()
    // Task 13's own row — Els's one Piece, still open, so the cluster reads
    // 0 of 1 resolved and the meta closes with `PER-PERSON · 0/1`.
    const names = within(hal).getAllByTestId('unpack-row-name')
    expect(names).toHaveLength(1)
    expect(names[0]).toHaveTextContent('Headlamp')
    expect(
      within(hal).getByRole('button', {
        name: 'Outcome — Headlamp, 0 of 1 resolved',
      }),
    ).toBeInTheDocument()
    expect(within(hal).getByText('PER-PERSON · 0/1')).toBeInTheDocument()
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

  /**
   * **§5i G2.** The count is the **lid-open** one — direct children, units
   * by their count — over the **trip** tree, and it carries the trip
   * world's `▸` because the return path beside it is home. `toHaveTextContent`
   * rather than `getByText`: the toned segment is its own element, exactly
   * as `RE-HOMED` already is.
   */
  it("draws a container's return path form, the trip-marked N INSIDE, and no rail", async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    const duffel = screen.getByTestId(`unpack-row-${E_DUFFEL}`)
    expect(within(duffel).getByTestId('unpack-row-meta')).toHaveTextContent(
      '→ Shelf L-Top · ▸ 5 INSIDE',
    )

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

  /**
   * **Task 12's own wiring test** — the pill used to be a stated no-op
   * (Task 10's `noop`); this is what proves it now opens `OutcomeSheet` for
   * the tapped row's own Entry, and that a tap inside it is live behind the
   * sheet rather than waiting for a close to be seen.
   */
  it("opens the outcome sheet from the row's pill and updates that row live", async () => {
    const user = userEvent.setup()
    const { authored } = await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...destinationScenario(),
    )

    // Cook set: a Single, still open, in `destinationScenario()`.
    const row = screen.getByTestId(`unpack-row-${E_COOK}`)
    await user.click(within(row).getByRole('button', { name: '○ OPEN' }))

    const sheet = screen.getByRole('dialog', { name: 'Cook set' })
    await user.click(within(sheet).getByRole('button', { name: '● BACK' }))

    expect(await authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: { entry_id: E_COOK, outcome: 'back' },
      },
    ])
    // A tap writes one op and the sheet stays open (spec §4.4) — a picker's
    // dismissal, not a decision's.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // The row behind the sheet is the identical `state.trips` fold, so it
    // reads the new outcome without waiting for the sheet to close.
    // `{ hidden: true }`: Radix's open `Dialog` marks the rest of the page
    // `aria-hidden` while it is up (correct — it is inert to a screen
    // reader), which `getByRole` respects by default; this assertion is
    // about the row's own DOM content, not its place in the a11y tree.
    expect(
      within(row).getByRole('button', { name: '● BACK', hidden: true }),
    ).toBeInTheDocument()
  })

  /**
   * **Task 13's own wiring test** — the cluster used to draw nothing at all
   * (a per-person Entry was skipped from every row list); this is what
   * proves it now opens `OutcomeSheet` in its roster variant, over the
   * identical Entry the room header's `0/1` already counts.
   */
  it('opens the roster sheet from the cluster, EVERYONE selected, and applies a chip to it', async () => {
    const user = userEvent.setup()
    const { authored } = await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...destinationScenario(),
    )

    const hal = groupNamed('Hal')
    await user.click(
      within(hal).getByRole('button', {
        name: 'Outcome — Headlamp, 0 of 1 resolved',
      }),
    )

    const sheet = screen.getByRole('dialog', { name: 'Headlamp' })
    // The roster, not the plain entry-level controls.
    expect(within(sheet).getByTestId('roster-everyone')).toBeInTheDocument()
    const rows = within(sheet).getAllByTestId('roster-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Els')
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(sheet).getByRole('button', { name: '● BACK' }))

    expect(await authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: {
          entry_id: E_HAL_HEADLAMP,
          outcome: 'back',
          person_id: 'els',
        },
      },
    ])
  })
})

const ATTIC_R = 'pppppppp-0000-7000-8000-000000000060'
const SHED_R = 'pppppppp-0000-7000-8000-000000000061'

const TENT = 'gggggggg-0000-7000-8000-000000000060'
const CRATE_R = 'gggggggg-0000-7000-8000-000000000061'
const POUCH_R = 'gggggggg-0000-7000-8000-000000000062'
const BAG_OPEN = 'gggggggg-0000-7000-8000-000000000063'

const E_TENT = 'nnnnnnnn-0000-7000-8000-000000000060'
const E_CRATE_R = 'nnnnnnnn-0000-7000-8000-000000000061'
const E_BAG_OPEN = 'nnnnnnnn-0000-7000-8000-000000000063'

/**
 * Task 14's own scenario (F8, spec §4.6) — `Tent, 3p`, a plain Single at
 * Attic, already `back` (the simplest row, and the board's own example
 * gear); `Crate B`, a container at Attic, already `back`, with `Pouch` — a
 * second container — physically nested one level inside it at home (the
 * subtree the picker must exclude, and the count its context line carries);
 * `Sleeping bag`, a plain Single at Attic, still open (the two-op case).
 */
function reHomeScenario(): readonly OpSpec[] {
  return [
    ...alps(),
    placeRecorded(ATTIC_R, 'Attic'),
    placeRecorded(SHED_R, 'Shed'),

    gearRecorded(TENT, {
      name: 'Tent, 3p',
      container: false,
      kind: 'single',
      residence: { in: 'place', id: ATTIC_R },
    }),
    tripEntryAdded(ALPS, E_TENT, { from: 'depot', gearId: TENT }),
    tripOutcomeSet(ALPS, E_TENT, 'back'),

    gearRecorded(CRATE_R, {
      name: 'Crate B',
      container: true,
      kind: 'single',
      residence: { in: 'place', id: ATTIC_R },
    }),
    gearRecorded(POUCH_R, {
      name: 'Pouch',
      container: true,
      kind: 'single',
      residence: { in: 'gear', id: CRATE_R },
    }),
    tripEntryAdded(ALPS, E_CRATE_R, { from: 'depot', gearId: CRATE_R }),
    tripOutcomeSet(ALPS, E_CRATE_R, 'back'),

    gearRecorded(BAG_OPEN, {
      name: 'Sleeping bag',
      container: false,
      kind: 'single',
      residence: { in: 'place', id: ATTIC_R },
    }),
    tripEntryAdded(ALPS, E_BAG_OPEN, { from: 'depot', gearId: BAG_OPEN }),
  ]
}

/**
 * **Task 14 — re-home on the spot (F8, `docs/design/README.md` §7/§5h,
 * spec §4.6).** The row body opens `HomePicker` in MOVE mode with a context
 * line stating the one thing this caller adds; picking marks the Entry
 * back and writes the new home, with no confirm between the pick and the
 * write (A2b).
 */
describe('DESTINATION mode — re-home on the spot (Task 14, F8)', () => {
  it('opens the Home picker on the row body with F8’s own context line', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...reHomeScenario())

    const row = screen.getByTestId(`unpack-row-${E_TENT}`)
    await user.click(within(row).getByTestId('unpack-row-body'))

    expect(screen.getByRole('dialog', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByTestId('moving-context')).toHaveTextContent(
      'RE-HOMING Tent, 3p · PICKING A HOME MARKS IT BACK',
    )
  })

  it('picking a home for an OPEN Entry emits trip.outcome_set{back} then gear.rehomed, in that order', async () => {
    const user = userEvent.setup()
    const { authored } = await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...reHomeScenario(),
    )

    const row = screen.getByTestId(`unpack-row-${E_BAG_OPEN}`)
    await user.click(within(row).getByTestId('unpack-row-body'))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Home' })).getByRole('button', {
        name: /Shed/,
      }),
    )

    expect(await authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: { entry_id: E_BAG_OPEN, outcome: 'back' },
      },
      {
        type: 'gear.rehomed',
        payload: { residence: { in: 'place', id: SHED_R } },
      },
    ])
  })

  it('picking a home for an Entry already back emits ONLY gear.rehomed', async () => {
    const user = userEvent.setup()
    const { authored } = await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...reHomeScenario(),
    )

    const row = screen.getByTestId(`unpack-row-${E_TENT}`)
    await user.click(within(row).getByTestId('unpack-row-body'))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Home' })).getByRole('button', {
        name: /Shed/,
      }),
    )

    expect(await authored()).toEqual([
      {
        type: 'gear.rehomed',
        payload: { residence: { in: 'place', id: SHED_R } },
      },
    ])
  })

  it('stands no confirm between the pick and the write (A2b) — the picker closes on its own', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...reHomeScenario())

    const row = screen.getByTestId(`unpack-row-${E_TENT}`)
    await user.click(within(row).getByTestId('unpack-row-body'))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Home' })).getByRole('button', {
        name: /Shed/,
      }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Home' })).toBeNull()
  })

  /**
   * **§5i G15.** §1's one rule — *the confirm is owed where the act cannot
   * be seen on the screen that made it* — reaches this route: a container's
   * re-home also rewrites every home path beneath it, and those rows are
   * elsewhere on F5 and may be filtered out under `○ OPEN`. The plain row
   * above still raises nothing; the row jumps, and F8 stays blessed.
   */
  it('confirms a container row’s re-home, in the drawn copy', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...reHomeScenario())

    const row = screen.getByTestId(`unpack-row-${E_CRATE_R}`)
    await user.click(within(row).getByTestId('unpack-row-body'))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Home' })).getByRole('button', {
        name: /Shed/,
      }),
    )

    const confirm = screen.getByRole('alertdialog', {
      name: 'Re-home Crate B to Shed?',
    })
    expect(
      within(confirm).getByText(
        'Crate B and everything inside it move at home. It is marked back; its contents keep their own outcomes.',
      ),
    ).toBeInTheDocument()
    // Both writes as numbers — what moves, and the outcome the pick implies.
    expect(
      within(confirm).getByText('1 RIDE ALONG · OUTCOME → BACK'),
    ).toBeInTheDocument()
    expect(
      within(confirm).getByRole('button', { name: 'Re-home' }),
    ).toBeInTheDocument()
  })

  it('writes nothing until the container re-home is confirmed', async () => {
    const user = userEvent.setup()
    const { authored } = await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...reHomeScenario(),
    )

    const row = screen.getByTestId(`unpack-row-${E_CRATE_R}`)
    await user.click(within(row).getByTestId('unpack-row-body'))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Home' })).getByRole('button', {
        name: /Shed/,
      }),
    )

    expect(await authored()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Re-home' }))

    // This crate is seeded already `back`, so the gesture emits the
    // re-home alone (E10) — what matters here is that neither op was
    // authored before the confirm, and both arrive after it.
    expect(await authored()).toEqual([
      {
        type: 'gear.rehomed',
        payload: { residence: { in: 'place', id: SHED_R } },
      },
    ])
  })

  it('carries the N RIDE ALONG count for a container, and excludes its own subtree', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...reHomeScenario())

    const row = screen.getByTestId(`unpack-row-${E_CRATE_R}`)
    await user.click(within(row).getByTestId('unpack-row-body'))

    const dialog = screen.getByRole('dialog', { name: 'Home' })
    expect(within(dialog).getByTestId('moving-context')).toHaveTextContent(
      // §5i G5: act · what moves · consequence.
      'RE-HOMING Crate B · 1 RIDE ALONG · PICKING A HOME MARKS IT BACK',
    )
    // Invariant 3 — Crate B's own subtree (Pouch) is absent at any depth.
    expect(within(dialog).queryByRole('button', { name: 'Pouch' })).toBeNull()
    expect(
      within(dialog).getByText(
        'Crate B AND EVERYTHING INSIDE IT ARE NOT OFFERED.',
      ),
    ).toBeInTheDocument()
  })

  it('reads a RE-HOMED segment in the row’s meta afterward, derived from the fold (spec §4.6)', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...reHomeScenario())

    const row = screen.getByTestId(`unpack-row-${E_TENT}`)
    // Nothing to say yet — Tent sits directly in its room, no suffix and no
    // path, so the row draws no meta line at all (`UnpackRow`'s own rule).
    expect(within(row).queryByTestId('unpack-row-meta')).not.toBeInTheDocument()

    await user.click(within(row).getByTestId('unpack-row-body'))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Home' })).getByRole('button', {
        name: 'Crate B',
      }),
    )

    // Tent now sits inside Crate B, itself in Attic — the same room, so the
    // group header is unchanged and the meta reads the path plus the segment.
    expect(within(row).getByTestId('unpack-row-meta')).toHaveTextContent(
      '→ Crate B · RE-HOMED',
    )
  })

  /**
   * **I3's own edge case, pinned rather than assumed.** A re-home to Loose
   * has no path segment to state at all — `meta` is `''` — so the segment
   * must not lead with a stray `· `.
   */
  it('reads a bare RE-HOMED with no leading separator when the row has no meta of its own', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...reHomeScenario())

    await user.click(
      within(screen.getByTestId(`unpack-row-${E_TENT}`)).getByTestId(
        'unpack-row-body',
      ),
    )
    await user.click(
      within(screen.getByRole('dialog', { name: 'Home' })).getByRole('button', {
        name: /^Loose/,
      }),
    )

    // Re-homed to Loose moves the row into a different DESTINATION group
    // (Attic → Loose), so it is re-queried fresh rather than through a
    // stale reference to the row's old group.
    const row = screen.getByTestId(`unpack-row-${E_TENT}`)
    // Loose states no path — this must render bare, not `· RE-HOMED`.
    expect(within(row).getByTestId('unpack-row-meta').textContent).toBe(
      'RE-HOMED',
    )
  })

  /**
   * **The over-inclusive case, pinned rather than hidden (spec §4.6).** A
   * Gear re-homed from *elsewhere* — gear detail's own `MOVE`, never this
   * screen's re-home flow — after its Entry was marked back also draws the
   * segment. It reads truthfully ("its home changed since it was resolved")
   * and it is cosmetic: no count depends on it.
   */
  it('also draws RE-HOMED when the Gear was re-homed from elsewhere after being marked back', async () => {
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...reHomeScenario(),
      // Not this screen's flow at all — a later, unrelated `gear.rehomed`.
      gearRehomed(TENT, { in: 'place', id: SHED_R }),
    )

    const row = screen.getByTestId(`unpack-row-${E_TENT}`)
    expect(within(row).getByTestId('unpack-row-meta')).toHaveTextContent(
      'RE-HOMED',
    )
  })
})

/**
 * The two renderings `returnPathMeta` used to produce that no board drew,
 * **ruled at §5i G3 and inverted here with their reasons attached** rather
 * than deleted: a zero count segment is absent, not written. Both were
 * pinned as code-authored while the question stood open, which is the whole
 * point of pinning one — the round met the shipped behaviour rather than
 * re-deriving it, and these two tests are the same pair now asserting the
 * answer.
 */
describe('DESTINATION mode — G3: a zero segment draws nothing', () => {
  const BERGING = 'pppppppp-0000-7000-8000-000000000099'
  const CANISTER = 'gggggggg-0000-7000-8000-000000000099'
  const E_CANISTER = 'nnnnnnnn-0000-7000-8000-000000000099'

  /**
   * `consumedCountOf` reads an absent `consumedCount` register as the
   * **whole** Bring-count (F9: the stepper opens there, since "all of it
   * used up is the ordinary case") — so tapping `CONSUMED` and never
   * touching the stepper is the *default* consumed rendering, not a
   * crafted edge case. **G3:** the split segment exists to say *the rest
   * came back*, and with nothing back there is no rest, so the ordinary
   * row reads `×3 CONSUMED` alone.
   */
  it('drops the BACK segment on a consumed Counted Entry whose Consumed-count was never touched', async () => {
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...alps(),
      placeRecorded(BERGING, 'Berging'),
      gearRecorded(CANISTER, {
        name: 'Fuel canister',
        container: false,
        kind: 'counted',
        residence: { in: 'place', id: BERGING },
      }),
      tripEntryAdded(ALPS, E_CANISTER, { from: 'depot', gearId: CANISTER }),
      tripEntryBringCountSet(ALPS, E_CANISTER, 3),
      tripOutcomeSet(ALPS, E_CANISTER, 'consumed'),
      // Deliberately no `trip.consumed_count_set`.
    )

    // No intermediate container between the Gear and its room, so the
    // room's own name — already the group header — has nothing further to
    // add and the meta reads the suffix alone.
    expect(screen.getByText('×3 CONSUMED')).toBeInTheDocument()
    expect(screen.queryByText(/×0 BACK/)).not.toBeInTheDocument()
  })

  const SCHUUR = 'pppppppp-0000-7000-8000-00000000009a'
  const EMPTY_CRATE = 'gggggggg-0000-7000-8000-00000000009a'
  const E_EMPTY_CRATE = 'nnnnnnnn-0000-7000-8000-00000000009a'

  /**
   * **G3:** an empty crate takes its outcome like a tarp, so it reads its
   * return path alone. The count is honest either way; what the ruling
   * decides is that a zero of it is not written.
   */
  it('draws the return path alone on a container Entry with nothing moved inside it', async () => {
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...alps(),
      placeRecorded(SCHUUR, 'Schuur'),
      gearRecorded(EMPTY_CRATE, {
        name: 'Empty crate',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: SCHUUR },
      }),
      tripEntryAdded(ALPS, E_EMPTY_CRATE, {
        from: 'depot',
        gearId: EMPTY_CRATE,
      }),
      tripOutcomeSet(ALPS, E_EMPTY_CRATE, 'back'),
      // Deliberately no `trip.entry_moved` targeting this container.
    )

    // The crate sits directly in its room, so with the suffix gone the
    // meta has nothing left to draw at all — which is the ruling: the
    // return path alone, and here the return path is the group header.
    expect(screen.queryByText(/INSIDE/)).not.toBeInTheDocument()
    const row = screen.getByTestId(`unpack-row-${E_EMPTY_CRATE}`)
    expect(
      within(row).queryByTestId('unpack-row-meta')?.textContent ?? '',
    ).toBe('')
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

/** Switch the segmented control — `Packing.test.tsx`'s `chooseMode` twin. */
async function chooseMode(user: UserEvent, label: string): Promise<void> {
  await user.click(screen.getByRole('radio', { name: label }))
}

async function pressOpenOnly(user: UserEvent): Promise<void> {
  await user.click(screen.getByTestId('unpack-open-filter'))
}

describe('the controls (F4)', () => {
  it('draws DESTINATION · PERSON · ALL as one segmented control, DESTINATION first', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...twoWithOneResolved())

    expect(screen.getByRole('group', { name: 'Group by' })).toBeInTheDocument()

    const modes = screen.getAllByRole('radio')
    expect(modes.map((mode) => mode.getAttribute('value'))).toEqual([
      'destination',
      'person',
      'all',
    ])
    expect(screen.getByRole('radio', { name: 'DESTINATION' })).toBeChecked()
  })

  it('draws the ○ OPEN filter unselected, never OPEN ONLY', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...twoWithOneResolved())

    const pill = screen.getByTestId('unpack-open-filter')
    expect(pill).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText(/ONLY/)).not.toBeInTheDocument()
  })

  it('gains a ✕ once the filter is tapped', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...twoWithOneResolved())

    const pill = screen.getByTestId('unpack-open-filter')
    expect(pill.textContent).not.toContain('✕')

    await pressOpenOnly(user)

    expect(pill).toHaveAttribute('aria-pressed', 'true')
    expect(pill.textContent).toContain('✕')
  })

  it('draws the one hint, under the controls row', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...twoWithOneResolved())

    const hint = screen.getByText(
      'TAP PILL = OUTCOME · TAP CIRCLES = PER PERSON · TAP ROW = RE-HOME',
    )
    const controls = screen.getByTestId('unpack-controls')

    expect(hint).toBeInTheDocument()
    expect(
      controls.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

const ZOLDER = 'pppppppp-0000-7000-8000-000000000030'
const LAMP = 'gggggggg-0000-7000-8000-000000000030'
const E_LAMP = 'nnnnnnnn-0000-7000-8000-000000000030'
const PAN = 'gggggggg-0000-7000-8000-000000000031'
const E_PAN = 'nnnnnnnn-0000-7000-8000-000000000031'
const TORCH = 'gggggggg-0000-7000-8000-000000000032'
const E_TORCH = 'nnnnnnnn-0000-7000-8000-000000000032'
const PASSPORTS2 = 'nnnnnnnn-0000-7000-8000-000000000033'

/** One resolved Entry in its own room (`Zolder`), one still open in another
 * (`Kelder`) — the fixture the filter tests narrow and widen. */
function twoRoomsOneEachScenario(): readonly OpSpec[] {
  return [
    ...alps(),
    placeRecorded(ZOLDER, 'Zolder'),
    placeRecorded(KELDER, 'Kelder'),

    gearRecorded(LAMP, {
      name: 'Lamp',
      container: false,
      kind: 'single',
      residence: { in: 'place', id: ZOLDER },
    }),
    tripEntryAdded(ALPS, E_LAMP, { from: 'depot', gearId: LAMP }),
    tripOutcomeSet(ALPS, E_LAMP, 'back'),

    gearRecorded(PAN, {
      name: 'Pan',
      container: false,
      kind: 'single',
      residence: { in: 'place', id: KELDER },
    }),
    tripEntryAdded(ALPS, E_PAN, { from: 'depot', gearId: PAN }),
    // Left open.
  ]
}

/** One room (`Zolder`) with two rows — `Lamp` resolved, `Torch` still open —
 * plus a trip-only Entry with no room to belong to (F19's own kind, spec
 * §3.7's spine): both halves of I2's own exemption in one fixture. */
function oneRoomTwoRowsWithTripOnlyScenario(): readonly OpSpec[] {
  return [
    ...alps(),
    placeRecorded(ZOLDER, 'Zolder'),

    gearRecorded(LAMP, {
      name: 'Lamp',
      container: false,
      kind: 'single',
      residence: { in: 'place', id: ZOLDER },
    }),
    tripEntryAdded(ALPS, E_LAMP, { from: 'depot', gearId: LAMP }),
    tripOutcomeSet(ALPS, E_LAMP, 'back'),

    gearRecorded(TORCH, {
      name: 'Torch',
      container: false,
      kind: 'single',
      residence: { in: 'place', id: ZOLDER },
    }),
    tripEntryAdded(ALPS, E_TORCH, { from: 'depot', gearId: TORCH }),
    // Left open.

    tripEntryAdded(ALPS, PASSPORTS2, {
      from: 'trip_only',
      name: 'Passports, all',
      container: false,
    }),
  ]
}

describe('the ○ OPEN filter (F4)', () => {
  /**
   * `within(group)`, not a bare `getByRole` — this screen's own outcome pill
   * *also* reads `○ OPEN` (F6), so an unscoped query would count the filter
   * pill itself among the matches and could never actually fail (M2).
   */
  it('hides a resolved row and keeps an open one, in the same group', async () => {
    const user = userEvent.setup()
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...oneRoomTwoRowsWithTripOnlyScenario(),
    )

    const zolder = groupNamed('Zolder')
    expect(
      within(zolder).getByRole('button', { name: '● BACK' }),
    ).toBeInTheDocument()
    expect(
      within(zolder).getByRole('button', { name: '○ OPEN' }),
    ).toBeInTheDocument()

    await pressOpenOnly(user)

    const zolderAfter = groupNamed('Zolder')
    expect(
      within(zolderAfter).queryByRole('button', { name: '● BACK' }),
    ).not.toBeInTheDocument()
    expect(
      within(zolderAfter).getByRole('button', { name: '○ OPEN' }),
    ).toBeInTheDocument()
  })

  /**
   * I2, adjudicated correct: a trip-only Entry takes no outcome at all
   * (invariant 18) and is excluded from {@link unpackTotals}, so it cannot
   * be *open* in the sense the pill states — code-authored, and this is the
   * test that pins it. **Failure scenario this guards**: a later
   * simplification of the predicate to the naive `row.outcome === null`
   * would keep it (a trip-only row's own `outcome` is constructed `null`),
   * every other test in this file would stay green, and on a real Trip the
   * whole `Trip-only` group would render inside a view whose entire promise
   * is *only what is open*.
   */
  it('hides a trip-only row too, though its own outcome reads null', async () => {
    const user = userEvent.setup()
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...oneRoomTwoRowsWithTripOnlyScenario(),
    )

    expect(screen.getByText('Trip-only')).toBeInTheDocument()

    await pressOpenOnly(user)

    expect(screen.queryByText('Trip-only')).not.toBeInTheDocument()
    // The room with a genuinely open row survives the same press.
    expect(screen.getByText('Zolder')).toBeInTheDocument()
  })

  it('withholds a group whose every row the filter drops, and keeps one that still has work', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...twoRoomsOneEachScenario())

    expect(screen.getByText('Zolder')).toBeInTheDocument()
    expect(screen.getByText('Kelder')).toBeInTheDocument()

    await pressOpenOnly(user)

    expect(screen.queryByText('Zolder')).not.toBeInTheDocument()
    expect(screen.getByText('Kelder')).toBeInTheDocument()
  })

  /**
   * Task 13's own case — `Hal`'s cluster row is Els's one open Piece, so
   * `visibleRows`' cluster branch (`resolved < total`) keeps it exactly as
   * the pill branch would, and the group survives with its row still under
   * it, not merely with an empty header.
   */
  it('keeps an open cluster row and its group under the filter', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    await pressOpenOnly(user)

    const hal = groupNamed('Hal')
    expect(
      within(hal).getByRole('button', {
        name: 'Outcome — Headlamp, 0 of 1 resolved',
      }),
    ).toBeInTheDocument()
  })

  /**
   * The other half — a per-person Entry whose every Piece is resolved reads
   * exactly as closed as an ordinary resolved row, through the identical
   * cluster branch (`resolved < total` is now false).
   */
  it('hides a fully-resolved cluster row', async () => {
    const user = userEvent.setup()
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...destinationScenario(),
      tripOutcomeSet(ALPS, E_HAL_HEADLAMP, 'back', 'els'),
    )

    await pressOpenOnly(user)

    expect(
      screen.queryByRole('button', {
        name: 'Outcome — Headlamp, 1 of 1 resolved',
      }),
    ).not.toBeInTheDocument()
  })

  it('reads NOTHING OPEN. once every row is resolved and the filter is still on', async () => {
    const user = userEvent.setup()
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...twoRoomsOneEachScenario(),
      tripOutcomeSet(ALPS, E_PAN, 'back'),
    )

    await pressOpenOnly(user)

    expect(screen.getByText('NOTHING OPEN.')).toBeInTheDocument()
    expect(screen.queryByText('Zolder')).not.toBeInTheDocument()
    expect(screen.queryByText('Kelder')).not.toBeInTheDocument()
  })
})

const KEES = 'kees'
const ELS = 'els'
const ROOM = 'pppppppp-0000-7000-8000-000000000040'
const RAINCOAT = 'gggggggg-0000-7000-8000-000000000040'
const E_RAINCOAT = 'nnnnnnnn-0000-7000-8000-000000000040'
const P_HEADLAMP = 'gggggggg-0000-7000-8000-000000000041'
const E_P_HEADLAMP = 'nnnnnnnn-0000-7000-8000-000000000041'
const STOVE_SHARED = 'gggggggg-0000-7000-8000-000000000042'
const E_STOVE_SHARED = 'nnnnnnnn-0000-7000-8000-000000000042'

/**
 * A7's own partition, exercised: `Kees` gets a Personal-owned Single still
 * open (`Rain jacket, K`) and his own resolved Piece of a per-person Entry
 * (`Headlamp`); `Els` gets only her own open Piece of that same Entry;
 * `Shared` gets a resolved Single nobody owns (`Stove`).
 *
 * `Kees`: 1/2 · 1 OPEN. `Els`: 0/1 · 1 OPEN. `Shared`: 1/1 · 0 OPEN.
 */
function personScenario(): readonly OpSpec[] {
  return [
    personRecorded(KEES, 'Kees'),
    personRecorded(ELS, 'Els'),
    tripCreated(ALPS, 'Alps 2026'),
    tripParticipantAdded(ALPS, KEES),
    tripParticipantAdded(ALPS, ELS),

    placeRecorded(ROOM, 'Room'),

    gearRecorded(RAINCOAT, {
      name: 'Rain jacket, K',
      container: false,
      kind: 'single',
      residence: { in: 'place', id: ROOM },
      owner: { type: 'person', personId: KEES },
    }),
    tripEntryAdded(ALPS, E_RAINCOAT, { from: 'depot', gearId: RAINCOAT }),
    // Left open.

    gearRecorded(P_HEADLAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
      residence: { in: 'place', id: ROOM },
    }),
    tripEntryAdded(ALPS, E_P_HEADLAMP, { from: 'depot', gearId: P_HEADLAMP }),
    tripOutcomeSet(ALPS, E_P_HEADLAMP, 'back', KEES),
    // Els's own Piece left open.

    gearRecorded(STOVE_SHARED, {
      name: 'Stove',
      container: false,
      kind: 'single',
    }),
    tripEntryAdded(ALPS, E_STOVE_SHARED, {
      from: 'depot',
      gearId: STOVE_SHARED,
    }),
    tripOutcomeSet(ALPS, E_STOVE_SHARED, 'back'),
  ]
}

describe('PERSON mode (F4, ruling A7)', () => {
  it('orders Els, Kees, then Shared last', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...personScenario())

    await chooseMode(user, 'PERSON')

    const names = screen
      .getAllByTestId('unpack-group-name')
      .map((el) => el.textContent)
    expect(names).toEqual(['Els', 'Kees', 'Shared'])
  })

  it('reads a PERSON header as resolved/units · N OPEN', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...personScenario())

    await chooseMode(user, 'PERSON')

    expect(
      within(groupNamed('Kees')).getByText('1/2 · 1 OPEN'),
    ).toBeInTheDocument()
    expect(
      within(groupNamed('Els')).getByText('0/1 · 1 OPEN'),
    ).toBeInTheDocument()
    expect(
      within(groupNamed('Shared')).getByText('1/1 · 0 OPEN'),
    ).toBeInTheDocument()
  })

  it("draws a Piece row with the board's own name suffix and its own pill, not a cluster", async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...personScenario())

    await chooseMode(user, 'PERSON')

    const kees = groupNamed('Kees')
    expect(
      within(kees).getByText("Headlamp — KEES'S PIECE"),
    ).toBeInTheDocument()
    expect(
      within(kees).getByRole('button', { name: '● BACK' }),
    ).toBeInTheDocument()

    const els = groupNamed('Els')
    expect(within(els).getByText("Headlamp — ELS'S PIECE")).toBeInTheDocument()
    expect(
      within(els).getByRole('button', { name: '○ OPEN' }),
    ).toBeInTheDocument()
  })

  /**
   * **Task 13's own closer** — the composite-key wiring the module docblock
   * describes. Els's own pill carries her composite key
   * (`${entryId}:els`), which never resolves in `trip.entries`; this proves
   * `openOutcome` still finds the real Entry behind it and opens the
   * identical roster the DESTINATION cluster would, `EVERYONE` selected
   * regardless of which Piece's pill was tapped.
   */
  /**
   * **Ruling R23** — a Piece row's own pill seeds the selection to that one
   * Piece alone, not `EVERYONE`. Kees's own Piece is cleared back to open
   * here (`personScenario()`'s own `back` overwritten by a later stamp), so
   * both his and Els's Pieces sit open — the fixture that actually tells
   * "seeded to `{els}`" apart from "seeded to everyone": with both open, a
   * chip tapped under a wrongly-`EVERYONE` selection authors **two** ops,
   * not one, since neither Piece would be skipped by the redundant-write
   * guard. Reverting `Unpack.tsx`'s `openOutcome` to discard `personId`
   * (Task 13's first cut) makes this test fail on the `authored()`
   * assertion below, not only on the roster's own `aria-pressed` reads.
   */
  it('seeds the roster to the one Piece whose pill opened it, not EVERYONE', async () => {
    const user = userEvent.setup()
    const { authored } = await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...personScenario(),
      tripOutcomeSet(ALPS, E_P_HEADLAMP, null, KEES),
    )

    await chooseMode(user, 'PERSON')

    const els = groupNamed('Els')
    await user.click(within(els).getByRole('button', { name: '○ OPEN' }))

    const sheet = screen.getByRole('dialog', { name: 'Headlamp' })
    expect(within(sheet).getByTestId('roster-everyone')).toBeInTheDocument()
    const rows = within(sheet).getAllByTestId('roster-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Els'),
      expect.stringContaining('Kees'),
    ])
    // Els's own pill opened this sheet — she alone is selected on open.
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true')
    expect(rows[1]).toHaveAttribute('aria-pressed', 'false')

    await user.click(within(sheet).getByRole('button', { name: '● BACK' }))

    // One op, for Els alone — a wrongly-`EVERYONE` selection would author a
    // second one for Kees, whose own Piece is open too in this fixture.
    expect(await authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: { entry_id: E_P_HEADLAMP, outcome: 'back', person_id: ELS },
      },
    ])
  })

  it('keeps EVERYONE selected when the cluster, not a Piece row, opens the roster', async () => {
    const user = userEvent.setup()
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...personScenario(),
      tripOutcomeSet(ALPS, E_P_HEADLAMP, null, KEES),
    )

    // DESTINATION mode's cluster, not PERSON mode's own pill — the same
    // Entry, opened from its other door.
    const room = groupNamed('Room')
    await user.click(
      within(room).getByRole('button', {
        name: 'Outcome — Headlamp, 0 of 2 resolved',
      }),
    )

    const sheet = screen.getByRole('dialog', { name: 'Headlamp' })
    for (const row of within(sheet).getAllByTestId('roster-row')) {
      expect(row).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it("draws a Piece row's meta as the full return path alone, no ownership segment", async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...personScenario())

    await chooseMode(user, 'PERSON')

    const rows = screen.getAllByTestId('unpack-row-meta')
    expect(rows.some((row) => row.textContent === '→ Room')).toBe(true)
  })

  it('draws a Personal entry row with its ownership segment, unit count and full path', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...personScenario())

    await chooseMode(user, 'PERSON')

    expect(
      within(groupNamed('Kees')).getByText('PERSONAL K · ×1 · → Room'),
    ).toBeInTheDocument()
  })

  it('draws a Shared entry row with SHARED and no path when the gear is Loose', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...personScenario())

    await chooseMode(user, 'PERSON')

    expect(
      within(groupNamed('Shared')).getByText('SHARED · ×1'),
    ).toBeInTheDocument()
  })
})

const CRATE_K = 'gggggggg-0000-7000-8000-000000000043'
const E_CRATE_K = 'nnnnnnnn-0000-7000-8000-000000000043'
const CANISTER_K = 'gggggggg-0000-7000-8000-000000000044'
const E_CANISTER_K = 'nnnnnnnn-0000-7000-8000-000000000044'
const INSIDE_K = 'gggggggg-0000-7000-8000-000000000045'
const E_INSIDE_K = 'nnnnnnnn-0000-7000-8000-000000000045'

/**
 * Ruling I1's two arms `personScenario` above does not exercise: a
 * Personal-owned **container** and a Personal-owned **consumed** Counted
 * Entry, both routed through `personEntryMeta`'s container/consumed branches
 * rather than its plain one — the two branches the first draft of I1's fix
 * still got backwards (delegating to `returnPathMeta`, path-first).
 */
function personContainerAndConsumedScenario(): readonly OpSpec[] {
  return [
    personRecorded(KEES, 'Kees'),
    tripCreated(ALPS, 'Alps 2026'),
    tripParticipantAdded(ALPS, KEES),
    placeRecorded(ROOM, 'Room'),

    gearRecorded(CRATE_K, {
      name: 'Kees crate',
      container: true,
      kind: 'single',
      residence: { in: 'place', id: ROOM },
      owner: { type: 'person', personId: KEES },
    }),
    tripEntryAdded(ALPS, E_CRATE_K, { from: 'depot', gearId: CRATE_K }),
    tripOutcomeSet(ALPS, E_CRATE_K, 'back'),

    // One Entry packed inside it, so the container arm draws a count at
    // all: G3 makes an empty container read its return path alone, which
    // would leave the ordering this scenario exists to prove with nothing
    // to order.
    gearRecorded(INSIDE_K, {
      name: 'Kees tarp',
      container: false,
      kind: 'single',
      residence: { in: 'place', id: ROOM },
      owner: { type: 'person', personId: KEES },
    }),
    tripEntryAdded(ALPS, E_INSIDE_K, { from: 'depot', gearId: INSIDE_K }),
    tripEntryMoved(ALPS, E_INSIDE_K, { in: 'container', entryId: E_CRATE_K }),

    gearRecorded(CANISTER_K, {
      name: 'Kees canister',
      container: false,
      kind: 'counted',
      residence: { in: 'place', id: ROOM },
      owner: { type: 'person', personId: KEES },
    }),
    tripEntryAdded(ALPS, E_CANISTER_K, { from: 'depot', gearId: CANISTER_K }),
    tripEntryBringCountSet(ALPS, E_CANISTER_K, 4),
    tripOutcomeSet(ALPS, E_CANISTER_K, 'consumed'),
    tripConsumedCountSet(ALPS, E_CANISTER_K, 2),
  ]
}

describe('PERSON mode — a trip-only Entry sits at Shared’s tail (§5i G9)', () => {
  /**
   * **G9 overturns R20.** PERSON partitions by *whose it is*, and a
   * trip-only Entry is attributed to nobody — `Shared`'s own definition,
   * and the answer F4 already gives one tap away on the same Trip. R20 had
   * kept the omission rather than invent a placement and a slot treatment;
   * the round drew both, and it is DESTINATION's anatomy verbatim.
   */
  it('draws the trip-only row under Shared, in DESTINATION’s own anatomy', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    await chooseMode(user, 'PERSON')

    const shared = groupNamed('Shared')
    const row = within(shared).getByTestId(`unpack-row-${E_PASSPORTS}`)
    expect(within(row).getByText('TRIP-ONLY')).toBeInTheDocument()
    expect(within(row).getByText('NOT IN DEPOT')).toBeInTheDocument()
    expect(within(row).getByText('CLEARS AT CLOSE')).toBeInTheDocument()
    // The slot is an Entry row's, not a control: nothing new holds text.
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('sits at the tail, after Shared’s own depot rows', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    await chooseMode(user, 'PERSON')

    const rows = within(groupNamed('Shared'))
      .getAllByTestId(/^unpack-row-/)
      .map((row) => row.getAttribute('data-testid'))
      // `unpack-row-body`/`-name`/`-meta`/`-rehomed`/`-badge` share the
      // prefix; the row wrappers are the ones ending in an Entry id.
      .filter((id) => id !== null && id.includes('-0000-7000-8000-'))

    expect(rows[rows.length - 1]).toBe(`unpack-row-${E_PASSPORTS}`)
  })

  it('excludes it from Shared’s header count, as every count on this screen does', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    await chooseMode(user, 'PERSON')

    // `unpackItems` never yields a trip-only item (invariant 18), so the
    // count is of the bucket alone and the appended row is counted by
    // nothing — the denominator stays the 10 units the depot Entries carry,
    // where counting the passports would make it 11.
    const header = within(groupNamed('Shared')).getByTestId(
      'unpack-group-header',
    )
    expect(header).toHaveTextContent('7/10 · 3 OPEN')
  })
})

describe('PERSON mode — the container and consumed-split arms (ruling I1)', () => {
  it('draws a Personal container row with N INSIDE before the path, not after', async () => {
    const user = userEvent.setup()
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...personContainerAndConsumedScenario(),
    )

    await chooseMode(user, 'PERSON')

    expect(
      within(screen.getByTestId(`unpack-row-${E_CRATE_K}`)).getByTestId(
        'unpack-row-meta',
      ),
    ).toHaveTextContent('PERSONAL K · ▸ 1 INSIDE · → Room')
  })

  /**
   * **G3 reaches this grammar too.** The two shared arms live in
   * `sharedMetaSuffix` precisely so a ruling that moves one string cannot
   * move it in DESTINATION alone — which is what happened for one commit,
   * with `×0 BACK` and `0 INSIDE` surviving here unasserted.
   */
  it('drops the zero segments in the header-less grammar as well', async () => {
    const user = userEvent.setup()
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...personContainerAndConsumedScenario(),
      // Every unit burned, and a second empty container.
      tripConsumedCountSet(ALPS, E_CANISTER_K, 4),
    )

    await chooseMode(user, 'PERSON')

    const kees = groupNamed('Kees')
    expect(
      within(kees).getByText('PERSONAL K · ×4 CONSUMED · → Room'),
    ).toBeInTheDocument()
    expect(within(kees).queryByText(/×0 BACK/)).not.toBeInTheDocument()
  })

  it('draws a Personal consumed-split row with the split before the path, not after', async () => {
    const user = userEvent.setup()
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...personContainerAndConsumedScenario(),
    )

    await chooseMode(user, 'PERSON')

    expect(
      within(groupNamed('Kees')).getByText(
        'PERSONAL K · ×2 CONSUMED · ×2 BACK · → Room',
      ),
    ).toBeInTheDocument()
  })
})

describe('ALL mode (spec §3.4)', () => {
  it('draws every Entry flat, A→Z, with no group headers — a per-person one included', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    await chooseMode(user, 'ALL')

    expect(screen.queryAllByTestId('unpack-group-name')).toHaveLength(0)

    const names = screen
      .getAllByTestId('unpack-row-name')
      .map((el) => el.textContent)
    expect(names).toEqual([
      'Cook set',
      'Duffel 90 L',
      'Gas canister 450',
      'Headlamp',
      'Passports, all',
      'Sleeping bag, winter',
      'Trekking poles',
    ])
  })

  /**
   * Task 13's own row, ALL mode's header-less grammar (ruling I1) — suffix
   * first, path last, the opposite of DESTINATION's `PER-PERSON · 0/1 · →
   * Hal` order the room-header test above pins.
   */
  it("draws the per-person row's cluster and suffix-first meta", async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    await chooseMode(user, 'ALL')

    expect(
      screen.getByRole('button', {
        name: 'Outcome — Headlamp, 0 of 1 resolved',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('PER-PERSON · 0/1 · → Hal')).toBeInTheDocument()
  })

  /**
   * The header-less grammar (ruling I1): suffix **before** the return path,
   * board §03's own order — the opposite of DESTINATION's `returnPathMeta`,
   * which puts the path first because its room header already trimmed it.
   * The quantity is unconditional too: `Cook set`, a plain Single, now reads
   * `×1` where DESTINATION's own meta for the identical Entry
   * (`destinationScenario`'s own DESTINATION-mode test) reads `→ Bak 3`
   * alone — the two grammars are not the same function, on purpose.
   */
  it('draws the return path last, suffix first, room included', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    await chooseMode(user, 'ALL')

    expect(
      screen.getByText('×2 · → Attic ▸ Shelf L-Top ▸ Crate B'),
    ).toBeInTheDocument()
    // The container's lid-open count keeps its trip mark in this grammar
    // too — it is a fact about the segment, not about where the segment
    // sits (§5i G2) — so it is its own element and asserts by content.
    expect(
      within(screen.getByTestId(`unpack-row-${E_DUFFEL}`)).getByTestId(
        'unpack-row-meta',
      ),
    ).toHaveTextContent('▸ 5 INSIDE · → Attic ▸ Shelf L-Top')
    expect(
      screen.getByText('×2 CONSUMED · ×2 BACK · → Kelder ▸ Bak 3'),
    ).toBeInTheDocument()
    expect(screen.getByText('×1 · → Kelder ▸ Bak 3')).toBeInTheDocument()
    // Loose Counted gear has no path segment to end in at all.
    expect(screen.getByText('×2')).toBeInTheDocument()
  })

  it('draws a trip-only row inline, no button, NOT IN DEPOT', async () => {
    const user = userEvent.setup()
    await renderUnpack(`/trips/${ALPS}/unpack`, ...destinationScenario())

    await chooseMode(user, 'ALL')

    const row = screen.getByTestId(`unpack-row-${E_PASSPORTS}`)
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    expect(within(row).getByText('NOT IN DEPOT')).toBeInTheDocument()
  })
})

const CANISTER = 'gggggggg-0000-7000-8000-000000000070'
const E_CANISTER = 'nnnnnnnn-0000-7000-8000-000000000070'
const MAP = 'gggggggg-0000-7000-8000-000000000071'
const E_MAP = 'nnnnnnnn-0000-7000-8000-000000000071'
const BOOTS = 'gggggggg-0000-7000-8000-000000000072'
const E_BOOTS = 'nnnnnnnn-0000-7000-8000-000000000072'

/**
 * **Task 15's own fixture (spec §4.7)** — one of each of the close card's
 * summary segments, so the exact `53 BACK · 2 CONSUMED · 1 LOST · 6 OPEN`
 * shape is exercised with real numbers rather than a scenario that happens
 * to leave one bucket at zero: `Stove` resolved `back` (1 unit), `Gas
 * canister` a consumed Counted Entry that splits (bring ×4, consumed ×2 —
 * `consumedCountOf`'s own clamp, `owned_count: 5` so the reduction target
 * is a real, non-zero, non-coincidental `5 − 2 = 3`), `Map` resolved `lost`
 * (1 unit), and `Boots` left open (1 unit) — the one thing the gated tests
 * need to gate on.
 *
 * Gated (`Boots` still open): `3 BACK · 2 CONSUMED · 1 LOST · 1 OPEN`
 * (`back` = Stove's 1 + Gas canister's own back remainder, 4 − 2 = 2).
 * Resolving `Boots` too (`finishedCloseCardScenario`) reaches
 * `4 BACK · 2 CONSUMED · 1 LOST · 0 OPEN`.
 */
function closeCardScenario(): readonly OpSpec[] {
  return [
    ...alps(),

    gearRecorded(STOVE, { name: 'Stove', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_STOVE, { from: 'depot', gearId: STOVE }),
    tripOutcomeSet(ALPS, E_STOVE, 'back'),

    gearRecorded(CANISTER, {
      name: 'Gas canister',
      container: false,
      kind: 'counted',
      owned_count: 5,
    }),
    tripEntryAdded(ALPS, E_CANISTER, { from: 'depot', gearId: CANISTER }),
    tripEntryBringCountSet(ALPS, E_CANISTER, 4),
    tripOutcomeSet(ALPS, E_CANISTER, 'consumed'),
    tripConsumedCountSet(ALPS, E_CANISTER, 2),

    gearRecorded(MAP, { name: 'Map', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_MAP, { from: 'depot', gearId: MAP }),
    tripOutcomeSet(ALPS, E_MAP, 'lost'),

    gearRecorded(BOOTS, { name: 'Boots', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_BOOTS, { from: 'depot', gearId: BOOTS }),
  ]
}

/** {@link closeCardScenario} with `Boots` resolved too — `open = 0`. */
function finishedCloseCardScenario(): readonly OpSpec[] {
  return [...closeCardScenario(), tripOutcomeSet(ALPS, E_BOOTS, 'back')]
}

/**
 * A Trip already `closed`, with a resolved Single and no consumed Counted
 * Entry at all — the fixture for this suite's own no-op test: nothing for
 * the reduction loop to sum, and `trip.phase_moved{closed}`'s own guard
 * suppresses the redundant phase write.
 */
function alreadyClosedScenario(): readonly OpSpec[] {
  return [
    ...alps(),
    gearRecorded(STOVE, { name: 'Stove', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_STOVE, { from: 'depot', gearId: STOVE }),
    tripOutcomeSet(ALPS, E_STOVE, 'back'),
    tripPhaseMoved(ALPS, 'closed'),
  ]
}

/**
 * **§5i G6 — F5 on a closed Trip is a record**, and the conflict the round
 * named: leaving every outcome writable there contradicts invariant 19,
 * which sends a change to a closed Trip's outcomes through reopen. A live
 * pill on a closed row is that change without the ceremony.
 *
 * Invariant 16 is not contradicted and F4 stays live at every phase — a
 * phase locks no *packing* status. 19 is the specific rule for outcomes.
 */
describe('a closed Trip draws a record (§5i G6)', () => {
  /** A closed Trip with a resolved Single and a trip-only Entry — the
   *  pill's slot and the one whose treatment it now borrows. */
  function closedRecordScenario(): readonly OpSpec[] {
    return [
      ...alps(),
      gearRecorded(STOVE, { name: 'Stove', container: false, kind: 'single' }),
      tripEntryAdded(ALPS, E_STOVE, { from: 'depot', gearId: STOVE }),
      tripOutcomeSet(ALPS, E_STOVE, 'back'),
      tripEntryAdded(ALPS, E_PASSPORTS, {
        from: 'trip_only',
        name: 'Passports, all',
        container: false,
      }),
      tripPhaseMoved(ALPS, 'closed'),
    ]
  }

  it('draws the reads — count line, bar, controls and filter all stay', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...closedRecordScenario())

    expect(screen.getByTestId('unpack-open-count')).toBeInTheDocument()
    expect(screen.getByTestId('unpack-bar')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'DESTINATION' })).toBeVisible()
    expect(screen.getByRole('button', { name: /OPEN/ })).toBeVisible()
  })

  it('states the one gesture left in the hint', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...closedRecordScenario())

    expect(screen.getByText('CLOSED · TAP ROW = GEAR DETAIL')).toBeVisible()
    expect(screen.queryByText(/TAP PILL = OUTCOME/)).not.toBeInTheDocument()
  })

  it('draws the outcome as text, not as a control — a border is a control', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...closedRecordScenario())

    const row = screen.getByTestId(`unpack-row-${E_STOVE}`)
    expect(within(row).getByTestId('unpack-row-record')).toHaveTextContent(
      '● BACK',
    )
    // The pill is gone entirely: no outcome sheet can be opened from here.
    expect(
      within(row).queryByRole('button', { name: /BACK/ }),
    ).not.toBeInTheDocument()
  })

  it('routes the row body to gear detail, where a closed Gear’s acts live', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...closedRecordScenario())

    const row = screen.getByTestId(`unpack-row-${E_STOVE}`)
    const body = within(row).getByTestId('unpack-row-body')
    expect(body).toHaveAttribute('href', `/gear/${STOVE}`)
  })

  it('keeps the card’s summary, withholds its button, and offers no third door to reopen', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...closedRecordScenario())

    // Every word of the summary is still true of a closed Trip.
    expect(screen.getByTestId('unpack-close-summary')).toBeInTheDocument()
    expect(
      screen.getByText('CLOSED · OUTCOMES ARE HISTORY. REOPEN TO CHANGE ONE.'),
    ).toBeVisible()

    // Withheld, not greyed (patterns.md §3.7) — and no `Reopen` here: the
    // ledger row and SET PHASE already hold that door (F13's rule).
    expect(
      screen.queryByRole('button', { name: /Close trip/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Reopen/ }),
    ).not.toBeInTheDocument()
  })

  /**
   * **S11 hands the route back (spec §5.1).** S10's `reopenBlocked`
   * withheld both doors out of `closed` on a Trip whose close lowered an
   * owned count and swapped this hint's route half for
   * `NO REOPEN — COUNTS LOWERED AT CLOSE.` S11 makes the *close* correct
   * instead, so a re-close of such a Trip subtracts nothing further and the
   * hint reads G6's form on every closed Trip regardless of what its close
   * did.
   *
   * This scenario is `closedRecordScenario`'s Trip plus a `consumed` Counted
   * Entry, which is what the retired gate used to read — the pair with the
   * test above says the same hint draws whether or not the close owed a
   * reduction.
   */
  it('reads REOPEN TO CHANGE ONE even when the close lowered an owned count', async () => {
    await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...alps(),
      gearRecorded(GAS_CANISTER, {
        name: 'Gas canister 450',
        container: false,
        kind: 'counted',
        owned_count: 6,
      }),
      tripEntryAdded(ALPS, E_GAS, { from: 'depot', gearId: GAS_CANISTER }),
      tripEntryBringCountSet(ALPS, E_GAS, 4),
      tripOutcomeSet(ALPS, E_GAS, 'consumed'),
      tripConsumedCountSet(ALPS, E_GAS, 2),
      tripPhaseMoved(ALPS, 'closed'),
    )

    expect(
      screen.getByText('CLOSED · OUTCOMES ARE HISTORY. REOPEN TO CHANGE ONE.'),
    ).toBeVisible()
    expect(screen.queryByText(/NO REOPEN/)).not.toBeInTheDocument()
  })

  it('leaves a trip-only row exactly as it was — the treatment the others borrowed', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...closedRecordScenario())

    const row = screen.getByTestId(`unpack-row-${E_PASSPORTS}`)
    expect(within(row).getByText('CLEARS AT CLOSE')).toBeInTheDocument()
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('the close card (F11, spec §4.7)', () => {
  /**
   * **F11 — the list's last card at every width.** `previousElementSibling`
   * pins what F11 actually says — *last* — not merely "a sibling somewhere
   * in `.screen`'s column", which a docked footer bolted on afterward would
   * also satisfy if it happened to share a parent.
   */
  it('is the last card, immediately after the groups region — not a docked footer', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...closeCardScenario())

    const groups = screen.getByTestId('unpack-groups')
    const card = screen.getByTestId('unpack-close-card')

    expect(card.previousElementSibling).toBe(groups)
  })

  it('reads the four-segment summary exactly and gates the button while open > 0', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...closeCardScenario())

    // Exact, not a substring match — the line is composed here from
    // `unpackTotals`' own fields, not drawn by a selector that could only
    // ever produce this shape.
    expect(screen.getByTestId('unpack-close-summary').textContent).toBe(
      '3 BACK · 2 CONSUMED · 1 LOST · 1 OPEN',
    )

    const button = screen.getByRole('button', { name: 'Close trip — 1 open' })
    expect(button).toBeDisabled()

    expect(
      screen.getByText(
        'BACK WRITES HOME AT THE TAP. CLOSE WHEN OPEN = 0 — LOST IS ALWAYS AN ANSWER.',
      ),
    ).toBeInTheDocument()
  })

  it('goes live and accent-worded once open = 0, with the finished-screen hint', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...finishedCloseCardScenario())

    expect(screen.getByTestId('unpack-close-summary').textContent).toBe(
      '4 BACK · 2 CONSUMED · 1 LOST · 0 OPEN',
    )

    const button = screen.getByRole('button', { name: 'Close trip' })
    expect(button).not.toBeDisabled()

    expect(
      screen.getByText(
        'CLOSE WRITES THE CONSUMED REDUCTION. THE ARRANGEMENT AND EVERY OUTCOME ARE KEPT. LOST KEEPS ITS HOME SLOT.',
      ),
    ).toBeInTheDocument()
  })

  /**
   * **The gate is a real `disabled` attribute, not `aria-disabled` alone**
   * (this task's own requirement) — a disabled native `<button>` fires no
   * click event at all, for a mouse or a keyboard user alike, so this is the
   * strongest assertion available that nothing can be fired past it: even a
   * direct `user.click` on the gated button authors nothing.
   */
  it('cannot be fired past the gate — a real disabled attribute, no click reaches the handler', async () => {
    const user = userEvent.setup()
    const seeded = await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...closeCardScenario(),
    )

    const button = screen.getByRole('button', { name: 'Close trip — 1 open' })
    expect(button).toHaveAttribute('disabled')
    await user.click(button)

    expect(await seeded.authored()).toEqual([])
  })

  /**
   * **F10 — no confirm.** The tap writes immediately; no `alertdialog` (this
   * codebase's own `Confirm` role, `ReopenConfirm`'s and
   * `ContainerMoveConfirm`'s) ever mounts.
   */
  it('writes on the tap with no confirm standing between it and the write', async () => {
    const user = userEvent.setup()
    const seeded = await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...finishedCloseCardScenario(),
    )

    await user.click(screen.getByRole('button', { name: 'Close trip' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    // The reduction before its own posting (spec §2.3), `trip.phase_moved`
    // last — `gestures.test.ts`'s own pinned order for this shape of fixture.
    expect(await seeded.authored()).toEqual([
      { type: 'gear.owned_count_set', payload: { count: 3 } },
      {
        type: 'trip.consumption_posted',
        payload: { gear_id: CANISTER, units: 2 },
      },
      { type: 'trip.phase_moved', payload: { phase: 'closed' } },
    ])
  })

  /**
   * **Ruling R27 Layer A — the app-level chained case the brief asked for,
   * now expressible.** Before R27 the card gated only on `open`, so a Trip
   * this very tap just closed still drew a live `Close trip` button —
   * exactly the door the reviewer walked through for zero cost. After R27
   * the card gates on `isClosed(trip)` too: the moment the fold reflects
   * the tap's own `trip.phase_moved{closed}`, this screen re-renders with
   * the button and its hint withheld (`patterns.md` §3.7), so there is no
   * control left for a second tap to reach. This is the strongest available
   * proof that nothing further can be authored — not a second click that
   * happens to write nothing, but the control itself gone.
   */
  it('withdraws the button the instant its own tap closes the Trip — no second tap is possible', async () => {
    const user = userEvent.setup()
    const seeded = await renderUnpack(
      `/trips/${ALPS}/unpack`,
      ...finishedCloseCardScenario(),
    )

    await user.click(screen.getByRole('button', { name: 'Close trip' }))
    const firstBatch = await seeded.authored()
    expect(firstBatch).toEqual([
      { type: 'gear.owned_count_set', payload: { count: 3 } },
      {
        type: 'trip.consumption_posted',
        payload: { gear_id: CANISTER, units: 2 },
      },
      { type: 'trip.phase_moved', payload: { phase: 'closed' } },
    ])

    expect(
      screen.queryByRole('button', { name: /Close trip/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'CLOSE WRITES THE CONSUMED REDUCTION. THE ARRANGEMENT AND EVERY OUTCOME ARE KEPT. LOST KEEPS ITS HOME SLOT.',
      ),
    ).not.toBeInTheDocument()
    // The ledger line is a fact about a closed Trip regardless — it stays.
    expect(screen.getByTestId('unpack-close-summary').textContent).toBe(
      '4 BACK · 2 CONSUMED · 1 LOST · 0 OPEN',
    )

    // Nothing further was authored — there being no button left to tap.
    expect(await seeded.authored()).toEqual(firstBatch)
  })

  /**
   * **Ruling R27 Layer A, the already-closed case** — `patterns.md` §3.7's
   * *withheld, not greyed*: a Trip that starts out `closed` (a peer closed
   * it, or a Device reopened and closed it again) draws no button and no
   * hint at all, live or gated — never a `Close trip` a Quartermaster could
   * still tap. The summary line is the one thing that survives, because
   * `4 BACK · … · 0 OPEN` remains a true fact about a closed Trip.
   */
  it('draws no button or hint at all on a Trip that is already closed, only the summary', async () => {
    await renderUnpack(`/trips/${ALPS}/unpack`, ...alreadyClosedScenario())

    expect(
      screen.queryByRole('button', { name: /Close trip/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'BACK WRITES HOME AT THE TAP. CLOSE WHEN OPEN = 0 — LOST IS ALWAYS AN ANSWER.',
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'CLOSE WRITES THE CONSUMED REDUCTION. THE ARRANGEMENT AND EVERY OUTCOME ARE KEPT. LOST KEEPS ITS HOME SLOT.',
      ),
    ).not.toBeInTheDocument()

    expect(screen.getByTestId('unpack-close-card')).toBeInTheDocument()
    expect(screen.getByTestId('unpack-close-summary').textContent).toBe(
      '1 BACK · 0 CONSUMED · 0 LOST · 0 OPEN',
    )
  })
})
