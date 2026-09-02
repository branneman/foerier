import {
  createHlcClock,
  gearOwnershipSet,
  gearRecorded,
  overClaimsFor,
  personRecorded,
  tripContainerStageSet,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripEntryStatusSet,
  tripParticipantAdded,
  tripPhaseMoved,
  type Clock,
  type DepotState,
  type IdSource,
  type OpAuthor,
  type OpSpec,
  type PhaseValue,
  type StageValue,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type EngineFactory,
} from '../depot/store'
import { DESKTOP, SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { Packing } from './Packing'

/**
 * **F4, the screen the app lives on** — its route, its shell and its empty
 * state (`docs/specs/2026-09-01-packing-and-the-journey.md` §4.1, §4.2 and
 * §4.8). The groups themselves are Tasks 10 and 11; what this file pins is
 * everything above them, and the three things the screen deliberately does
 * **not** draw.
 *
 * A real store and the real reducer, seeded by emitting real ops — every
 * screen suite here does the same. The `authored()` handle exists for one
 * assertion: that a screen standing on an unknown `tripId` writes nothing,
 * which is why every hook runs above the `No such trip.` guard rather than a
 * control being rendered against an id no Trip answers to.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

const SEEDED_AT = 1_700_000_000_000

const ALPS = 'tttttttt-0000-7000-8000-00000000000a'
const JURA = 'tttttttt-0000-7000-8000-00000000000b'

const STOVE = 'gggggggg-0000-7000-8000-00000000000a'
const PEGS = 'gggggggg-0000-7000-8000-00000000000b'
const HEADLAMP = 'gggggggg-0000-7000-8000-00000000000c'
const MAP = 'gggggggg-0000-7000-8000-00000000000d'
const ROPE = 'gggggggg-0000-7000-8000-00000000000e'

const E_STOVE = 'nnnnnnnn-0000-7000-8000-00000000000a'
const E_PEGS = 'nnnnnnnn-0000-7000-8000-00000000000b'
const E_HEADLAMP = 'nnnnnnnn-0000-7000-8000-00000000000c'
const E_MAP = 'nnnnnnnn-0000-7000-8000-00000000000d'
const E_ROPE = 'nnnnnnnn-0000-7000-8000-00000000000e'

const CRATE = 'gggggggg-0000-7000-8000-00000000000f'
const E_CRATE = 'nnnnnnnn-0000-7000-8000-00000000000f'
const J_STOVE = 'nnnnnnnn-0000-7000-8000-000000000010'

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

type OpPayload = Record<string, unknown>

interface Seeded {
  /** Everything the *screen* authored — the seed is subtracted. */
  authored: () => Promise<readonly { type: string; payload: OpPayload }[]>
  /** The fold, for the one assertion that has to prove a *positive* control:
   * that the seed genuinely over-claims, so the band's absence is F4's own
   * decision rather than an empty selector. */
  state: () => DepotState
}

/** Renders `/trips/:id/packing` at `path`, over a store seeded with `specs`. */
async function renderPacking(
  path: string,
  ...specs: readonly OpSpec[]
): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
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
        <Route path="/trips/:id/packing">
          <DepotProvider value={store}>
            <Packing />
          </DepotProvider>
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

/** The Alps with three Participants and nothing on the list yet. */
function alps(phase: PhaseValue = 'pack_out'): readonly OpSpec[] {
  return [
    personRecorded('els', 'Els'),
    personRecorded('mies', 'Mies'),
    personRecorded('kim', 'Kim'),
    tripCreated(ALPS, 'Alps 2026'),
    tripParticipantAdded(ALPS, 'els'),
    tripParticipantAdded(ALPS, 'mies'),
    tripParticipantAdded(ALPS, 'kim'),
    tripPhaseMoved(ALPS, phase),
  ]
}

/**
 * Nine pieces, four of them packed — the brief's own `● 4/9 PIECES` /
 * `5 LEFT`, built from all three Kinds so the arithmetic exercises the units
 * table rather than counting lines: a Counted Entry contributes its whole
 * Bring-count (ruling A13) and a per-person Entry one per included Piece.
 *
 * `1 (stove, packed) + 3 (pegs ×3, packed) = 4`;
 * `3 (headlamp, three Pieces) + 1 (map) + 1 (rope) = 5 left`; `9` in all.
 */
function nineWithFourPacked(): readonly OpSpec[] {
  return [
    ...alps(),

    gearRecorded(STOVE, { name: 'Stove', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_STOVE, { from: 'depot', gearId: STOVE }),
    tripEntryStatusSet(ALPS, E_STOVE, 'packed'),

    // `owned_count` stated, so the depot's supply covers the Bring-count: an
    // absent register reads `1`, and three pegs claimed against one owned is
    // an over-claim this fixture does not mean to carry.
    gearRecorded(PEGS, {
      name: 'Tent peg',
      container: false,
      kind: 'counted',
      owned_count: 6,
    }),
    tripEntryAdded(ALPS, E_PEGS, { from: 'depot', gearId: PEGS }),
    tripEntryBringCountSet(ALPS, E_PEGS, 3),
    tripEntryStatusSet(ALPS, E_PEGS, 'packed'),

    gearRecorded(HEADLAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(ALPS, E_HEADLAMP, { from: 'depot', gearId: HEADLAMP }),

    gearRecorded(MAP, { name: 'Map', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_MAP, { from: 'depot', gearId: MAP }),

    gearRecorded(ROPE, { name: 'Rope', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_ROPE, { from: 'depot', gearId: ROPE }),

    // A second **active** Trip claiming the one stove. `overClaims` is a pure
    // fold of registers, so this state genuinely over-claims — which is what
    // makes the "no over-claim band" assertion below say something: with one
    // Trip the band returns `null` before its `data-testid` is ever rendered,
    // and the test would pass identically whether or not F4 asked for it.
    tripCreated(JURA, 'Jura 2026'),
    tripPhaseMoved(JURA, 'pack_out'),
    tripEntryAdded(JURA, J_STOVE, { from: 'depot', gearId: STOVE }),
  ]
}

const HINT =
  'TAP PILL = NEXT STATE · TAP CIRCLES = PER PERSON · TAP ROW = WHERE IT GOES'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the packing screen — the shell every mode hangs off', () => {
  /**
   * The title is the **activity**, not the phase. A phase locks nothing
   * (invariant 16) and the phase itself is already stated by a chip that is
   * the control for changing it, so naming the phase here would be a second,
   * uncontrollable copy of a fact the trip screen owns.
   */
  it.each([
    ['draft'],
    ['pack_out'],
    ['on_trip'],
    ['unpack'],
    ['closed'],
  ] as const)('draws the title Pack-out at %s', async (phase) => {
    await renderPacking(`/trips/${ALPS}/packing`, ...alps(phase))

    expect(screen.getByRole('heading', { name: 'Pack-out' })).toBeVisible()
  })

  /**
   * The other half of the same rule, and the one that would be easy to get
   * wrong by adding a phase guard: **hiding a route is a soft lock**, which
   * the phase model forbids. Draft is the case a guard would have caught.
   */
  it.each([
    ['draft'],
    ['pack_out'],
    ['on_trip'],
    ['unpack'],
    ['closed'],
  ] as const)('is reachable at %s — a phase locks nothing', async (phase) => {
    await renderPacking(`/trips/${ALPS}/packing`, ...alps(phase))

    expect(screen.queryByText('No such trip.')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pack-out' })).toBeVisible()
  })

  /**
   * `Trip.tsx`'s and `GearListBuilder.tsx`'s guard, with **every hook above
   * it** for the identical reason (S7 review F2): a control reachable against
   * an unknown `tripId` would author an op materialising a Trip that no
   * delete op can remove before S14.
   */
  it('says No such trip. for an unknown id, and authors nothing', async () => {
    const seeded = await renderPacking(
      '/trips/tttttttt-0000-7000-8000-0000000000ff/packing',
      ...alps(),
    )

    expect(screen.getByText('No such trip.')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Pack-out' })).toBeNull()
    expect(await seeded.authored()).toEqual([])
  })

  it('draws the back link to the Trip it belongs to', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...alps())

    expect(screen.getByRole('link', { name: '‹ Alps 2026' })).toHaveAttribute(
      'href',
      `/trips/${ALPS}`,
    )
  })

  /**
   * **The first screen whose Desktop back link is drawn**, and it needs no
   * new rule: `useScreenHeader` has carried
   * `atDesktopSidebarCarriesDestination` since S7, and the 216px sidebar
   * carries `TRIPS`, not `Alps 2026`. Task 12's `screenBand.test.tsx` proves
   * the other side of this — the same screen *inside* `AppShell` — because a
   * per-screen suite renders the screen alone.
   */
  it('keeps the back link at Desktop, where the sidebar names TRIPS', async () => {
    setViewport(SPLIT, DESKTOP)
    await renderPacking(`/trips/${ALPS}/packing`, ...alps())

    expect(screen.getByRole('link', { name: '‹ Alps 2026' })).toBeVisible()
  })

  /** §3.3's other half: the sync line is the screen's at Split and only at
   * Split, since `AppShell` puts a bare 6px dot in the 56px rail there. */
  it('draws its own sync line at Split', async () => {
    setViewport(SPLIT)
    await renderPacking(`/trips/${ALPS}/packing`, ...alps())

    expect(screen.getByTestId('packing-sync')).toBeVisible()
  })

  it.each([
    ['a phone', [] as readonly string[]],
    ['Desktop', [SPLIT, DESKTOP] as readonly string[]],
  ])(
    'withholds the sync line at %s, where AppShell states it in words',
    async (_mode, queries) => {
      setViewport(...queries)
      await renderPacking(`/trips/${ALPS}/packing`, ...alps())

      expect(screen.queryByTestId('packing-sync')).not.toBeInTheDocument()
    },
  )
})

describe('the count line, the bar and the controls', () => {
  it('draws the count line, the LEFT read and the bar', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...nineWithFourPacked())

    expect(screen.getByText('● 4/9 PIECES')).toBeInTheDocument()
    expect(screen.getByText('5 LEFT')).toBeInTheDocument()
    expect(screen.getByTestId('packing-bar')).toBeInTheDocument()
  })

  /**
   * Ruling A5: a container is not a piece, so it is excluded from PIECES and
   * from `N LEFT` — a denominator holding things that can never be counted
   * makes 61 unreachable. A Trip holding only a container therefore has a
   * **real** `0/0`, and it is not an empty list: `0 ENTRIES.` counts lines,
   * which is why the empty check reads `entriesOf` and not the totals.
   */
  it('reads a real 0/0 for a Trip whose only Entry is a container', async () => {
    await renderPacking(
      `/trips/${ALPS}/packing`,
      ...alps(),
      gearRecorded(CRATE, { name: 'Crate B', container: true, kind: 'single' }),
      tripEntryAdded(ALPS, E_CRATE, { from: 'depot', gearId: CRATE }),
    )

    expect(screen.getByText('● 0/0 PIECES')).toBeInTheDocument()
    expect(screen.getByText('0 LEFT')).toBeInTheDocument()
    expect(screen.queryByText('0 ENTRIES.')).not.toBeInTheDocument()
  })

  it('draws the three modes as one segmented control, CONTAINER first', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...nineWithFourPacked())

    // The group's own name, which the board draws nowhere: `getAllByRole`
    // below passes with the `<legend>` deleted, so this is the assertion that
    // pins the repo's first use of `visually-hidden` at the point where it is
    // load-bearing.
    expect(screen.getByRole('group', { name: 'Group by' })).toBeInTheDocument()

    const modes = screen.getAllByRole('radio')
    expect(modes.map((mode) => mode.getAttribute('value'))).toEqual([
      'container',
      'person',
      'all',
    ])
    expect(screen.getByRole('radio', { name: 'CONTAINER' })).toBeChecked()
  })

  it('draws the ○ LEFT filter unselected', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...nineWithFourPacked())

    const pill = screen.getByRole('button', { name: '○ LEFT' })
    expect(pill).toHaveAttribute('aria-pressed', 'false')
  })

  /**
   * Ruling A9. The hint sits **under the controls row**, read once at the
   * start rather than at the foot of sixty-one rows — which is where the
   * retired footer bar would have put it.
   */
  it('draws the hint under the controls row, not at the foot', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...nineWithFourPacked())

    const hint = screen.getByText(HINT)
    const controls = screen.getByTestId('packing-controls')

    expect(hint).toBeInTheDocument()
    expect(
      controls.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe('what F4 deliberately does not draw', () => {
  /**
   * Ruling A9 again, from the other side. `UNDO` is drawn on the board and
   * not built — the third instance of the §3b/§3c precedent and the
   * strongest, because this screen holds the app's most tapped writes — and
   * with no action left the pinned bar retires on the builder's own argument:
   * a read does not spend the thumb zone.
   */
  it('draws no pinned footer bar and no UNDO', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...nineWithFourPacked())

    expect(
      screen.queryByRole('button', { name: /UNDO/i }),
    ).not.toBeInTheDocument()
  })

  /**
   * The over-claim band is a property of the **gear list** — the trip screen
   * and the builder's right pane — and F4 is not the gear list. Two Trips
   * claiming the same Piece is a fact about membership; this screen asks how
   * far along one Trip's own pack-out is.
   */
  it('draws no over-claim band — that belongs to the gear list', async () => {
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...nineWithFourPacked(),
    )

    // The positive control first: Jura claims the one stove too, so there
    // *is* an over-claim naming this Trip. Without it the assertion below
    // passes over an empty selector and proves nothing about F4 at all.
    expect(
      overClaimsFor(seeded.state(), ALPS).map((claim) => claim.gearId),
    ).toEqual([STOVE])
    expect(screen.queryByTestId('over-claim-band')).not.toBeInTheDocument()
  })
})

describe('the empty list', () => {
  /**
   * The trip screen's permanent fact, word for word — a domain fact, not a
   * promise. And the count line and the bar are **absent, not zeroed**:
   * `● 0/0 PIECES` states an arithmetic nobody asked for.
   */
  it('withholds the count line and the bar entirely on an empty list', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...alps())

    expect(screen.getByText('0 ENTRIES.')).toBeInTheDocument()
    expect(
      screen.getByText('The gear list is built from the depot.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/PIECES/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('packing-bar')).not.toBeInTheDocument()
  })

  /**
   * The same rule carried one step further, and stated because the boards do
   * not: the controls partition and filter a list, and the hint names three
   * gestures on rows. With no rows there is nothing to group, nothing to
   * filter and nothing to tap — a dead affordance, which is precisely what
   * spec §4.9 forbids when it argues the `GEAR LIST` band draws no door to a
   * screen that can only say `0 ENTRIES.`. `Trip.tsx` takes the same shape:
   * its empty region replaces the `GEAR LIST` band, not just its rows.
   */
  it('withholds the controls and the hint too, drawing no dead affordance', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...alps())

    expect(screen.queryByTestId('packing-controls')).not.toBeInTheDocument()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  /** The title and the back link are the screen, not the list, so they stay:
   * a reader standing here when another Device removes the last Entry needs
   * both to know where they are and how to leave. */
  it('keeps the title and the back link', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...alps())

    expect(screen.getByRole('heading', { name: 'Pack-out' })).toBeVisible()
    expect(screen.getByRole('link', { name: '‹ Alps 2026' })).toBeVisible()
  })
})

/* ------------------------------------------------------------------------ *
 * CONTAINER mode — the row, the rail, the groups and the ▲ line.
 *
 * `docs/design/README.md` §1 and §5e A2 · A2b · A3 · A4 · A5 · A6 · A13 ·
 * A14 · A15; spec §4.2, §4.3 and §4.7.
 * ------------------------------------------------------------------------ */

const FILTER = 'gggggggg-0000-7000-8000-000000000011'
const SACK = 'gggggggg-0000-7000-8000-000000000012'
const FLEECE = 'gggggggg-0000-7000-8000-000000000013'
const POLES = 'gggggggg-0000-7000-8000-000000000014'

const E_FILTER = 'nnnnnnnn-0000-7000-8000-000000000011'
const E_SACK = 'nnnnnnnn-0000-7000-8000-000000000012'
const E_FLEECE = 'nnnnnnnn-0000-7000-8000-000000000013'
const E_POLES = 'nnnnnnnn-0000-7000-8000-000000000014'
const E_BORROWED = 'nnnnnnnn-0000-7000-8000-000000000015'
const E_PASSPORTS = 'nnnnnnnn-0000-7000-8000-000000000016'

/**
 * The board's own frame, in ops (`S9 Round` §01).
 *
 * ```
 * Crate B          1/5   ⌂ HOME ✓ · STAGING ✓ · CAR ● · PACKED
 *                        ▲ IN CAR · 3 INSIDE NOT PACKED
 *   Stove                SHARED · ×1                     ○ NOT PACKED
 *   Trekking poles       PERSONAL E · ×2                 ○ NOT PACKED
 *   Water filter         SHARED · ×1                     ◐ STAGED
 *   Stuff sack     1/1   ⌂ HOME ● · …                    (indent 1)
 *     Fleece             SHARED · ×1                     ● PACKED
 * Crate, borrowed  0/0   TRIP-ONLY
 * Loose            0/4
 *   Headlamp             PER-PERSON · 0/3                M E K
 *   Passports            TRIP-ONLY · NOT IN DEPOT        ○ NOT PACKED
 * ```
 *
 * Nine pieces (`1 + 2 + 1 + 1` inside Crate B, `3 + 1` loose), one packed.
 * Crate B's ▲ counts `Stove` and both trekking poles and **not** the staged
 * filter (ruling A6's one carve-out) and not the packed fleece — three, at
 * any depth.
 */
function containerFrame(): readonly OpSpec[] {
  return [
    ...alps(),

    gearRecorded(CRATE, { name: 'Crate B', container: true, kind: 'single' }),
    tripEntryAdded(ALPS, E_CRATE, { from: 'depot', gearId: CRATE }),
    tripContainerStageSet(ALPS, E_CRATE, 'car'),

    gearRecorded(STOVE, { name: 'Stove', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_STOVE, { from: 'depot', gearId: STOVE }),
    tripEntryMoved(ALPS, E_STOVE, { in: 'container', entryId: E_CRATE }),

    gearRecorded(FILTER, {
      name: 'Water filter',
      container: false,
      kind: 'single',
    }),
    tripEntryAdded(ALPS, E_FILTER, { from: 'depot', gearId: FILTER }),
    tripEntryMoved(ALPS, E_FILTER, { in: 'container', entryId: E_CRATE }),
    tripEntryStatusSet(ALPS, E_FILTER, 'staged'),

    // Counted and Personal: one pill for the whole Bring-count (ruling A13),
    // and the meta's ownership segment is `ownerLabel`'s.
    gearRecorded(POLES, {
      name: 'Trekking poles',
      container: false,
      kind: 'counted',
      owned_count: 4,
    }),
    gearOwnershipSet(POLES, { type: 'person', personId: 'els' }),
    tripEntryAdded(ALPS, E_POLES, { from: 'depot', gearId: POLES }),
    tripEntryBringCountSet(ALPS, E_POLES, 2),
    tripEntryMoved(ALPS, E_POLES, { in: 'container', entryId: E_CRATE }),

    // The nested container, and the one packed thing on the Trip inside it.
    gearRecorded(SACK, { name: 'Stuff sack', container: true, kind: 'single' }),
    tripEntryAdded(ALPS, E_SACK, { from: 'depot', gearId: SACK }),
    tripEntryMoved(ALPS, E_SACK, { in: 'container', entryId: E_CRATE }),

    gearRecorded(FLEECE, { name: 'Fleece', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_FLEECE, { from: 'depot', gearId: FLEECE }),
    tripEntryMoved(ALPS, E_FLEECE, { in: 'container', entryId: E_SACK }),
    tripEntryStatusSet(ALPS, E_FLEECE, 'packed'),

    // A trip-only container (ruling A14) and a trip-only row.
    tripEntryAdded(ALPS, E_BORROWED, {
      from: 'trip_only',
      name: 'Crate, borrowed',
      container: true,
    }),
    tripContainerStageSet(ALPS, E_BORROWED, 'staging'),

    tripEntryAdded(ALPS, E_PASSPORTS, {
      from: 'trip_only',
      name: 'Passports',
      container: false,
    }),

    gearRecorded(HEADLAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(ALPS, E_HEADLAMP, { from: 'depot', gearId: HEADLAMP }),
  ]
}

/** One container at `stage` holding one not-packed Entry — the smallest
 * fixture the ▲ threshold can be read off. */
function oneInside(stage: StageValue): readonly OpSpec[] {
  return [
    ...alps(),
    gearRecorded(CRATE, { name: 'Crate B', container: true, kind: 'single' }),
    tripEntryAdded(ALPS, E_CRATE, { from: 'depot', gearId: CRATE }),
    tripContainerStageSet(ALPS, E_CRATE, stage),
    gearRecorded(STOVE, { name: 'Stove', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_STOVE, { from: 'depot', gearId: STOVE }),
    tripEntryMoved(ALPS, E_STOVE, { in: 'container', entryId: E_CRATE }),
  ]
}

/** Four containers, one inside the next — `Bag A ▸ Bag B ▸ Bag C ▸ Bag D`. */
function fourDeep(): readonly OpSpec[] {
  const bags = ['A', 'B', 'C', 'D'] as const
  return [
    ...alps(),
    ...bags.flatMap((letter, index) => {
      const gearId = `gggggggg-0000-7000-8000-00000000002${index}`
      const entryId = `nnnnnnnn-0000-7000-8000-00000000002${index}`
      const parent = `nnnnnnnn-0000-7000-8000-00000000002${index - 1}`
      return [
        gearRecorded(gearId, {
          name: `Bag ${letter}`,
          container: true,
          kind: 'single',
        }),
        tripEntryAdded(ALPS, entryId, { from: 'depot', gearId }),
        ...(index === 0
          ? []
          : [
              tripEntryMoved(ALPS, entryId, {
                in: 'container',
                entryId: parent,
              }),
            ]),
      ]
    }),
  ]
}

/** The group header whose name is exactly `name` — `getAllByTestId` plus a
 * search, because a header is not a landmark and has no role of its own. */
function headerFor(name: string): HTMLElement {
  for (const header of screen.getAllByTestId('packing-group-header')) {
    if (within(header).queryByText(name) !== null) return header
  }
  throw new Error(`No group header named ${name}`)
}

function rowFor(name: string): HTMLElement {
  for (const row of screen.getAllByTestId('packing-row')) {
    if (within(row).queryByText(name) !== null) return row
  }
  throw new Error(`No packing row named ${name}`)
}

/** One row of the open Pack picker, by the name it draws. */
function pickerRow(name: string): HTMLElement {
  for (const row of screen.getAllByTestId('pack-row')) {
    if (within(row).queryByText(name) !== null) return row
  }
  throw new Error(`No picker row named ${name}`)
}

/** The `{ … }` body of the rule whose selector is exactly `selector` — the
 * one technique that sees CSS under `css: false` (`drawnSizes.test.ts`). */
function ruleBody(file: string, selector: string): string | undefined {
  const here = dirname(expect.getState().testPath ?? '')
  const css = readFileSync(join(here, file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
  const escaped = selector.replace(/[.[\]:='"]/g, '\\$&')
  return new RegExp(`(?:^|[\\s{}])${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
}

describe('the row', () => {
  it('cycles the pill one step per tap, one op each', async () => {
    const user = userEvent.setup()
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...containerFrame(),
    )

    await user.click(
      within(rowFor('Stove')).getByRole('button', { name: /NOT PACKED/ }),
    )

    expect(await seeded.authored()).toEqual([
      expect.objectContaining({
        type: 'trip.entry_status_set',
        payload: { entry_id: E_STOVE, status: 'staged' },
      }),
    ])
  })

  it('opens the Pack picker from the row body', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    await user.click(within(rowFor('Stove')).getByTestId('packing-row-body'))

    expect(screen.getByText('WHERE IT GOES ON THIS TRIP')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Stove' })).toBeInTheDocument()
  })

  /**
   * Spec §4.4's own reason: one Piece may ride in the duffel while another
   * is loose, and only the status sheet can say which — so a per-person
   * row's *body* is the sheet too, and the Pack picker never opens from it.
   */
  it('opens the Piece status sheet from a per-person row body, not the picker', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    await user.click(within(rowFor('Headlamp')).getByTestId('packing-row-body'))

    expect(screen.getByText('PACKING STATUS · 0 OF 3 PACKED')).toBeVisible()
    expect(
      screen.queryByText('WHERE IT GOES ON THIS TRIP'),
    ).not.toBeInTheDocument()
  })

  it('opens the Piece status sheet from a per-person cluster, not the picker', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    // The cluster AND its count are one control (ruling B at 34px), so the
    // name states the whole fact rather than any circle doing it.
    await user.click(
      screen.getByRole('button', {
        name: 'Packing status — Headlamp, 0 of 3 packed',
      }),
    )

    expect(screen.getByText('PACKING STATUS · 0 OF 3 PACKED')).toBeVisible()
    expect(
      screen.queryByText('WHERE IT GOES ON THIS TRIP'),
    ).not.toBeInTheDocument()
  })

  it('gives no individual circle its own tap target', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    const cluster = within(rowFor('Headlamp')).getByTestId(
      'packing-row-cluster',
    )
    const circles = within(rowFor('Headlamp')).getAllByTestId('person-circle')

    expect(circles).toHaveLength(3)
    for (const circle of circles) {
      expect(circle.closest('button')).toBe(cluster)
    }
  })

  /**
   * Ruling A5 — and the assertion is on the pill's own `data-testid` rather
   * than on `getByRole('button', { name: /PACKED/ })`, because the header
   * legitimately holds a rail chip named `PACKED`. A container carries a
   * journey *instead of* a status; that chip is the journey.
   */
  it('draws no status pill on a container Entry', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    expect(
      within(headerFor('Crate B')).queryByTestId('packing-status-pill'),
    ).not.toBeInTheDocument()
    // Nor anywhere else: a container is never a row.
    expect(
      screen.getAllByTestId('packing-row-name').map((name) => name.textContent),
    ).toEqual(expect.not.arrayContaining(['Crate B', 'Stuff sack']))
  })

  it('draws one pill for a Counted Entry, whatever its Bring-count', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    // Ruling A13: one register, no per-unit identity, so one tap moves the
    // count by two — correct, and needing no UI.
    const row = rowFor('Trekking poles')
    expect(within(row).getAllByTestId('packing-status-pill')).toHaveLength(1)
    expect(within(row).getByTestId('packing-row-meta')).toHaveTextContent(
      'PERSONAL E · ×2',
    )
  })

  it('tags a trip-only item amber and meta NOT IN DEPOT', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    const row = rowFor('Passports')
    expect(within(row).getByText('TRIP-ONLY')).toBeInTheDocument()
    expect(within(row).getByTestId('packing-row-meta')).toHaveTextContent(
      'NOT IN DEPOT',
    )
  })

  it('draws the shared meta as ownership and units', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    expect(
      within(rowFor('Stove')).getByTestId('packing-row-meta'),
    ).toHaveTextContent('SHARED · ×1')
    expect(
      within(rowFor('Headlamp')).getByTestId('packing-row-meta'),
    ).toHaveTextContent('PER-PERSON · 0/3')
  })
})

describe('the rail', () => {
  it('sets the tapped stage, backwards included', async () => {
    const user = userEvent.setup()
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...containerFrame(),
    )

    await user.click(
      within(headerFor('Crate B')).getByRole('button', { name: '⌂ HOME' }),
    )

    expect(await seeded.authored()).toEqual([
      expect.objectContaining({
        type: 'trip.container_stage_set',
        payload: { entry_id: E_CRATE, stage: 'home' },
      }),
    ])
  })

  it('writes nothing when the current stage is tapped', async () => {
    // SET PHASE's own rule: a redundant write moves the stamp LWW compares,
    // and at S6 that was visible in DAY N. Here it is invisible and still
    // wrong.
    const user = userEvent.setup()
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...containerFrame(),
    )

    await user.click(
      within(headerFor('Crate B')).getByRole('button', { name: 'CAR' }),
    )

    expect(await seeded.authored()).toEqual([])
  })

  it('never confirms', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    await user.click(
      within(headerFor('Crate B')).getByRole('button', { name: '⌂ HOME' }),
    )

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('leaves the current chip undimmed — dim means future', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    const chips = within(headerFor('Crate B')).getAllByTestId('journey-chip')
    expect(chips.map((chip) => chip.dataset['stageState'])).toEqual([
      'past',
      'past',
      'current',
      'future',
    ])
    expect(
      within(headerFor('Crate B')).getByRole('button', { name: 'CAR' }),
    ).toHaveAttribute('aria-current', 'step')

    // And the paint says the same thing: `--color-ink-dim` belongs to the
    // future chip and to nothing else. jsdom computes no layout and the
    // suite runs with `css: false`, so the stylesheet's own text is the only
    // thing that can be read (`drawnSizes.test.ts`'s technique).
    const file = join('..', 'components', 'JourneyRail.module.css')
    expect(ruleBody(file, ".chip[data-stage-state='future']")).toMatch(
      /--color-ink-dim/,
    )
    expect(ruleBody(file, ".chip[data-stage-state='current']")).not.toMatch(
      /--color-ink-dim/,
    )
  })
})

describe('the groups', () => {
  it('draws one group per container, counting its subtree at any depth', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    // Crate B's five are its own four plus the stuff sack's one — and the
    // sack's row is counted twice on screen, once in each header, which is
    // what "everything in the crate" means to a household carrying it.
    expect(headerFor('Crate B')).toHaveTextContent('1/5')
    expect(headerFor('Stuff sack')).toHaveTextContent('1/1')
    expect(headerFor('Crate, borrowed')).toHaveTextContent('0/0')
    expect(headerFor('Loose')).toHaveTextContent('0/4')
  })

  it('renders a nested group immediately after its parent rows, indented', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    expect(
      screen
        .getAllByTestId('packing-group-name')
        .map((name) => name.textContent),
    ).toEqual(['Crate B', 'Stuff sack', 'Crate, borrowed', 'Loose'])

    // Its parent's own rows come first, then the nested group's.
    expect(
      screen.getAllByTestId('packing-row-name').map((name) => name.textContent),
    ).toEqual([
      'Stove',
      'Trekking poles',
      'Water filter',
      'Fleece',
      'Headlamp',
      'Passports',
    ])

    expect(headerFor('Crate B').closest('section')).toHaveAttribute(
      'data-indent',
      '0',
    )
    expect(headerFor('Stuff sack').closest('section')).toHaveAttribute(
      'data-indent',
      '1',
    )
  })

  it('caps the indent at two levels and states the skipped ancestry', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...fourDeep())

    expect(headerFor('Bag C').closest('section')).toHaveAttribute(
      'data-indent',
      '2',
    )
    expect(headerFor('Bag D').closest('section')).toHaveAttribute(
      'data-indent',
      '2',
    )
    expect(headerFor('Bag D')).toHaveTextContent('Bag A ▸ Bag B ▸ Bag C')
    // The cap is what makes the ancestry line necessary, so a header inside
    // it must not carry one.
    expect(headerFor('Bag B')).not.toHaveTextContent('▸')
  })

  it('gives a nested container its own rail', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    // A rail inside a rail is correct — story 10's disagreement case is the
    // nested one, and the rail is that container's own journey.
    expect(
      within(headerFor('Stuff sack')).getByTestId('journey-rail'),
    ).toBeInTheDocument()
    expect(
      within(headerFor('Stuff sack')).getByRole('button', { name: '⌂ HOME' }),
    ).toHaveAttribute('aria-current', 'step')
  })

  it('tags a trip-only container and otherwise draws an ordinary group', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    const header = headerFor('Crate, borrowed')
    expect(within(header).getByText('TRIP-ONLY')).toBeInTheDocument()
    expect(within(header).getByTestId('journey-rail')).toBeInTheDocument()
    expect(header).toHaveTextContent('0/0')
  })

  it('puts Loose last and draws it without a rail', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    const headers = screen.getAllByTestId('packing-group-header')
    expect(headers[headers.length - 1]).toHaveTextContent('Loose')
    expect(headers[headers.length - 1]).toHaveTextContent('NOT IN A CONTAINER')
    // Nothing loose has a journey.
    expect(within(headerFor('Loose')).queryByTestId('journey-rail')).toBeNull()
  })

  it('draws nothing for an empty Loose group', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...oneInside('home'))

    expect(screen.getAllByTestId('packing-group-header')).toHaveLength(1)
    expect(screen.queryByText('NOT IN A CONTAINER')).not.toBeInTheDocument()
  })

  it('states the permanent fact when a Trip has no containers', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...nineWithFourPacked())

    // One group, holding everything, and no empty state: the header's count
    // is the honest read.
    const headers = screen.getAllByTestId('packing-group-header')
    expect(headers).toHaveLength(1)
    expect(headers[0]).toHaveTextContent('Loose')
    expect(
      screen.getByText('A CONTAINER ON THE GEAR LIST BECOMES A GROUP HERE.'),
    ).toBeInTheDocument()
  })

  it('withholds that fact once a container exists', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    expect(
      screen.queryByText('A CONTAINER ON THE GEAR LIST BECOMES A GROUP HERE.'),
    ).not.toBeInTheDocument()
  })
})

describe('the ▲ disagreement line', () => {
  it('appears at car with unpacked contents', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    // Three: the stove and both trekking poles. The staged filter is ruling
    // A6's one carve-out and the packed fleece is packed — at any depth.
    expect(
      within(headerFor('Crate B')).getByTestId('packing-disagreement'),
    ).toHaveTextContent('IN CAR · 3 INSIDE NOT PACKED')
  })

  it('appears at packed', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...oneInside('packed'))

    expect(screen.getByTestId('packing-disagreement')).toHaveTextContent(
      'PACKED · 1 INSIDE NOT PACKED',
    )
  })

  it.each([['home'], ['staging']] as const)(
    'does not appear at %s',
    async (stage) => {
      await renderPacking(`/trips/${ALPS}/packing`, ...oneInside(stage))

      // Staging *is* the act of packing: unpacked contents on the staging
      // floor are the work, not a contradiction.
      expect(screen.queryByTestId('packing-disagreement')).toBeNull()
    },
  )

  it('pins at N=1', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...oneInside('car'))

    expect(screen.getByTestId('packing-disagreement')).toHaveTextContent(
      'IN CAR · 1 INSIDE NOT PACKED',
    )
  })

  it('carries the ▲ in its own attention element', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...oneInside('car'))

    // The trip card's date warning verbatim: a single text node would force
    // the attention class onto the whole line or onto none of it.
    const line = screen.getByTestId('packing-disagreement')
    const mark = within(line).getByText('▲')
    expect(mark).not.toBe(line)
    expect(mark.className).not.toBe('')
    expect(mark.className).not.toBe(line.className)
  })
})

describe('moving what a group holds', () => {
  /**
   * `PackPicker` reports a tap on its `● NOW` row like any other and says in
   * its own docblock that the caller must drop it. **This screen is that
   * caller**, and a redundant `trip.entry_moved` moves the stamp LWW
   * compares — the journey rail's own reason, one op over.
   */
  it('authors nothing when the picker chooses the residence already held', async () => {
    const user = userEvent.setup()
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...containerFrame(),
    )

    await user.click(within(rowFor('Stove')).getByTestId('packing-row-body'))
    // The positive control: the row this taps is the one the picker itself
    // marks `● NOW`, so the suppression is what is being read and not an
    // absent row.
    expect(within(pickerRow('Crate B')).getByText('● NOW')).toBeInTheDocument()
    await user.click(within(pickerRow('Crate B')).getByRole('button'))

    expect(await seeded.authored()).toEqual([])
  })

  it('moves a plain Entry with one op and no confirm', async () => {
    const user = userEvent.setup()
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...containerFrame(),
    )

    await user.click(within(rowFor('Stove')).getByTestId('packing-row-body'))
    await user.click(within(pickerRow('Stuff sack')).getByRole('button'))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await seeded.authored()).toEqual([
      expect.objectContaining({
        type: 'trip.entry_moved',
        payload: {
          entry_id: E_STOVE,
          residence: { in: 'container', entry_id: E_SACK },
        },
      }),
    ])
  })

  /**
   * A container never appears as a row anywhere on this screen, so its group
   * header is the only surface its *where* track can live on — the row's own
   * two-track shape, one level up.
   */
  it('opens the picker for a container from its group header', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    await user.click(
      within(headerFor('Crate B')).getByTestId('packing-group-move'),
    )

    expect(screen.getByTestId('moving-context')).toHaveTextContent(
      'MOVING Crate B · 5 INSIDE RIDE ALONG',
    )
    expect(screen.getByTestId('moving-footer')).toHaveTextContent(
      'Crate B AND EVERYTHING INSIDE IT ARE NOT OFFERED.',
    )
  })

  it('confirms a container move and authors it on Move', async () => {
    const user = userEvent.setup()
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...containerFrame(),
    )

    await user.click(
      within(headerFor('Crate B')).getByTestId('packing-group-move'),
    )
    await user.click(within(pickerRow('Crate, borrowed')).getByRole('button'))

    expect(
      screen.getByText('Move Crate B into Crate, borrowed?'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Move' }))

    expect(await seeded.authored()).toEqual([
      expect.objectContaining({
        type: 'trip.entry_moved',
        payload: {
          entry_id: E_CRATE,
          residence: { in: 'container', entry_id: E_BORROWED },
        },
      }),
    ])
    // `Confirm.Action` closes the dialog and Radix reports that close as
    // this component's `onCancel`, so `Move` fires **both** callbacks. A
    // cancel handler that reopened the picker would reopen it here too.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('authors nothing when the container move is cancelled', async () => {
    const user = userEvent.setup()
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...containerFrame(),
    )

    await user.click(
      within(headerFor('Crate B')).getByTestId('packing-group-move'),
    )
    await user.click(within(pickerRow('Crate, borrowed')).getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await seeded.authored()).toEqual([])
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
