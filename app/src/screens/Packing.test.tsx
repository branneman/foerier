import {
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
  tripPieceMoved,
  tripPieceStatusSet,
  type DepotState,
  type OpSpec,
  type PhaseValue,
  type StageValue,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import { createDepotStore, DepotProvider } from '../depot/store'
import { DESKTOP, SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { anAuthor, noopEngine } from '../testUtils'
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
      within(headerFor('Crate B')).queryByTestId('status-pill'),
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
    expect(within(row).getAllByTestId('status-pill')).toHaveLength(1)
    expect(within(row).getByTestId('packing-row-meta')).toHaveTextContent(
      'PERSONAL E · ×2',
    )
  })

  it('tags a trip-only item amber and meta NOT IN DEPOT', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...containerFrame())

    const row = rowFor('Passports')
    expect(within(row).getByText('TRIP-ONLY')).toBeInTheDocument()
    // **The whole announced name, not the badge as a substring** — the Piece
    // suffix's own lesson one span along. `.nameLine`'s flex `gap` is not a
    // character, so `getByText('TRIP-ONLY')` passes happily while the body
    // button announces `PassportsTRIP-ONLY` as one word.
    expect(within(row).getByTestId('packing-row-body')).toHaveTextContent(
      'Passports TRIP-ONLY',
    )
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
    // The row's assertion, on the header's own button: the tag has to be a
    // separate word in `packing-group-move`'s accessible name, not
    // `Crate, borrowedTRIP-ONLY`.
    expect(within(header).getByTestId('packing-group-move')).toHaveTextContent(
      'Crate, borrowed TRIP-ONLY',
    )
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

    // Six, not the Entry tree's five: the trekking poles are a Bring-count of
    // two and the stuff sack is a thing that rides along while contributing
    // no packable piece (ruling A5). `ridesAlongCount` is the argument.
    expect(screen.getByTestId('moving-context')).toHaveTextContent(
      'MOVING Crate B · 6 INSIDE RIDE ALONG',
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

  /**
   * The **container** arm of the same guard (review F6). Crate B is already
   * loose, so the picker's own `● NOW` sits on `Loose` — and this also pins
   * that the suppression runs *before* the confirm: a container move that
   * changes nothing must not put a decision on screen either.
   */
  it('authors nothing, and confirms nothing, when a container is moved where it already is', async () => {
    const user = userEvent.setup()
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...containerFrame(),
    )

    await user.click(
      within(headerFor('Crate B')).getByTestId('packing-group-move'),
    )
    expect(within(pickerRow('Loose')).getByText('● NOW')).toBeInTheDocument()
    await user.click(within(pickerRow('Loose')).getByRole('button'))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await seeded.authored()).toEqual([])
  })

  /**
   * The **Piece** arm (review F6), reached through the status sheet's own
   * trailing `MOVE`. A Piece with no residence register of its own reads its
   * Entry's — the headlamp set is loose — so `● NOW` is on `Loose` again,
   * and choosing it authors no `trip.piece_moved`.
   */
  it('authors nothing when a Piece is moved where it already rides', async () => {
    const user = userEvent.setup()
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...containerFrame(),
    )

    await user.click(within(rowFor('Headlamp')).getByTestId('packing-row-body'))
    const rows = screen.getAllByTestId('piece-status-row')
    expect(rows).toHaveLength(3)
    await user.click(
      within(rows[0] ?? document.body).getByRole('button', { name: 'MOVE' }),
    )

    expect(within(pickerRow('Loose')).getByText('● NOW')).toBeInTheDocument()
    await user.click(within(pickerRow('Loose')).getByRole('button'))

    expect(await seeded.authored()).toEqual([])
  })

  /** …and the same Piece genuinely moving, so the arm above is read as a
   * suppression rather than as a dead route. */
  it('moves one Piece with one op and no confirm', async () => {
    const user = userEvent.setup()
    const seeded = await renderPacking(
      `/trips/${ALPS}/packing`,
      ...containerFrame(),
    )

    await user.click(within(rowFor('Headlamp')).getByTestId('packing-row-body'))
    const rows = screen.getAllByTestId('piece-status-row')
    await user.click(
      within(rows[0] ?? document.body).getByRole('button', { name: 'MOVE' }),
    )
    await user.click(within(pickerRow('Crate B')).getByRole('button'))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await seeded.authored()).toEqual([
      expect.objectContaining({
        type: 'trip.piece_moved',
        payload: {
          entry_id: E_HEADLAMP,
          person_id: 'els',
          residence: { in: 'container', entry_id: E_CRATE },
        },
      }),
    ])
  })
})

/* ------------------------------------------------------------------------ *
 * S9 round 2 — the per-person Entry in CONTAINER mode.
 *
 * `docs/design/README.md` §5e C1 · C2 · C3 · C4;
 * `docs/specs/2026-09-04-per-person-rows-in-container-mode.md` §2, §4, §5.
 * ------------------------------------------------------------------------ */

/**
 * The board's own round-2 frame, in ops
 * (`S9 Round 2 …` §01): the Headlamp's three Pieces in three places.
 *
 * ```
 * Crate B      0/1   Headlamp   PER-PERSON · 0/1 · 2 ELSEWHERE   M
 * Duffel 90 L  1/1   Headlamp   PER-PERSON · 1/1 · 2 ELSEWHERE   E
 * Loose        0/1   Headlamp   PER-PERSON · 0/1 · 2 ELSEWHERE   K
 * ```
 *
 * Els's Piece rides in the duffel and is packed; Mies's rides in the crate
 * and is staged; **Kim's names no residence at all**, which reads loose
 * (ruling C0) and draws under `Loose` (C4) rather than nowhere.
 *
 * Three groups, three rows, one Entry — and `0 + 1 + 0 = 1` over `3`, which
 * is `packingTotals`' own numerator: the rows sum into the headers and the
 * headers into the trip.
 */
function splitFrame(): readonly OpSpec[] {
  return [
    ...alps(),

    gearRecorded(CRATE, { name: 'Crate B', container: true, kind: 'single' }),
    tripEntryAdded(ALPS, E_CRATE, { from: 'depot', gearId: CRATE }),

    gearRecorded(DUFFEL, {
      name: 'Duffel 90 L',
      container: true,
      kind: 'single',
    }),
    tripEntryAdded(ALPS, E_DUFFEL, { from: 'depot', gearId: DUFFEL }),

    gearRecorded(HEADLAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(ALPS, E_HEADLAMP, { from: 'depot', gearId: HEADLAMP }),

    tripPieceMoved(ALPS, E_HEADLAMP, 'els', {
      in: 'container',
      entryId: E_DUFFEL,
    }),
    tripPieceStatusSet(ALPS, E_HEADLAMP, 'els', 'packed'),

    tripPieceMoved(ALPS, E_HEADLAMP, 'mies', {
      in: 'container',
      entryId: E_CRATE,
    }),
    tripPieceStatusSet(ALPS, E_HEADLAMP, 'mies', 'staged'),
  ]
}

/** The same two containers and Headlamp, with every Piece where `residences`
 * puts it — `undefined` meaning *unplaced*, which reads loose. */
function headlampIn(
  residences: Readonly<Record<string, string | undefined>>,
): readonly OpSpec[] {
  return [
    ...alps(),
    gearRecorded(CRATE, { name: 'Crate B', container: true, kind: 'single' }),
    tripEntryAdded(ALPS, E_CRATE, { from: 'depot', gearId: CRATE }),
    gearRecorded(DUFFEL, {
      name: 'Duffel 90 L',
      container: true,
      kind: 'single',
    }),
    tripEntryAdded(ALPS, E_DUFFEL, { from: 'depot', gearId: DUFFEL }),
    gearRecorded(HEADLAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(ALPS, E_HEADLAMP, { from: 'depot', gearId: HEADLAMP }),
    ...Object.entries(residences).flatMap(([personId, entryId]) =>
      entryId === undefined
        ? []
        : [
            tripPieceMoved(ALPS, E_HEADLAMP, personId, {
              in: 'container',
              entryId,
            }),
          ],
    ),
  ]
}

/** The one row of the group named `name` — every fixture below puts exactly
 * one there, so this says more than `rowFor`, which takes the **first**
 * Headlamp row on the screen whichever group it landed in. */
function onlyRowIn(name: string): HTMLElement {
  return within(groupFor(name)).getByTestId('packing-row')
}

function metaIn(name: string): HTMLElement {
  return within(onlyRowIn(name)).getByTestId('packing-row-meta')
}

describe('a per-person Entry in CONTAINER mode', () => {
  /**
   * **Ruling C1**, and the two frames the boards carry are its two ends: all
   * Pieces together is one clustered row, all Pieces apart is a row under
   * each group. One rule, both frames.
   */
  it('draws one row per group holding at least one of its Pieces', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...splitFrame())

    expect(groupNames()).toEqual(['Crate B', 'Duffel 90 L', 'Loose'])
    expect(rowNames()).toEqual(['Headlamp', 'Headlamp', 'Headlamp'])
  })

  /**
   * **The assertion this round exists for.** `tripContainmentView` is
   * deliberately **not** gated on the Kind — it resolves *structure*, and a
   * domain read-rule does not belong inside pointer resolution — so
   * `childrenOf` still answers with a per-person Entry's own `residence`
   * register, the one ruling C0 retires. If `containerView` placed rows from
   * the view, this Headlamp would draw under `Crate B`, which holds none of
   * its Pieces, and the crate's header would count none of them beneath it.
   *
   * Rows come from the **items'** own residences instead, so the row is drawn
   * where the Pieces are. Revert that and this goes red in both directions at
   * once: a Headlamp under the crate and none under the duffel.
   */
  it('places the row where the Pieces are, never where the Entry register points', async () => {
    await renderPacking(
      `/trips/${ALPS}/packing`,
      ...headlampIn({ els: E_DUFFEL, mies: E_DUFFEL, kim: E_DUFFEL }),
      // A peer on another build wrote it — the reducer folds it (sync §5.3's
      // tolerant reader is absolute) and no reader consults it.
      tripEntryMoved(ALPS, E_HEADLAMP, { in: 'container', entryId: E_CRATE }),
    )

    expect(
      within(groupFor('Duffel 90 L')).getByTestId('packing-row-name'),
    ).toHaveTextContent('Headlamp')
    expect(within(groupFor('Crate B')).queryByTestId('packing-row')).toBeNull()
    // And the headers agree with the rows drawn under them.
    expect(within(groupFor('Duffel 90 L')).getByText('0/3')).toBeVisible()
    expect(within(groupFor('Crate B')).getByText('0/0')).toBeVisible()
  })

  /**
   * The header agreeing with its rows is C5; the **move confirm** agreeing
   * with both is the same fact one surface further out. `insideCount` used to
   * be `subtreeOf(view, entryId).size` — the Entry tree — so the crate, which
   * draws no rows and counts `0/0`, told a Quartermaster that one thing rode
   * along inside it.
   */
  it('counts nothing riding along in a container whose rows are all elsewhere', async () => {
    const user = userEvent.setup()
    await renderPacking(
      `/trips/${ALPS}/packing`,
      ...headlampIn({ els: E_DUFFEL, mies: E_DUFFEL, kim: E_DUFFEL }),
      tripEntryMoved(ALPS, E_HEADLAMP, { in: 'container', entryId: E_CRATE }),
    )

    await user.click(
      within(headerFor('Crate B')).getByTestId('packing-group-move'),
    )

    expect(screen.getByTestId('moving-context')).toHaveTextContent(
      'MOVING Crate B · 0 INSIDE RIDE ALONG',
    )
  })

  /** The all-together end of C1's one rule — **today's frame, unchanged**. */
  it('draws exactly one row when every Piece shares a group', async () => {
    await renderPacking(
      `/trips/${ALPS}/packing`,
      ...headlampIn({ els: E_DUFFEL, mies: E_DUFFEL, kim: E_DUFFEL }),
      tripPieceStatusSet(ALPS, E_HEADLAMP, 'els', 'packed'),
    )

    expect(rowNames()).toEqual(['Headlamp'])
    expect(metaIn('Duffel 90 L')).toHaveTextContent('PER-PERSON · 1/3')
    // `N ELSEWHERE` only above zero — the string is unchanged and only its
    // meaning is narrowed (C2).
    expect(metaIn('Duffel 90 L')).not.toHaveTextContent('ELSEWHERE')
  })

  /**
   * **Ruling C4.** `Loose` means `NOT IN A CONTAINER`, not *undecided* — a
   * Piece naming no residence reads loose, so it draws there and the group's
   * header counts it. Hiding those Pieces would make `Loose`'s own count lie
   * about its contents, which is the fault this round removes.
   */
  it('draws unplaced Pieces under Loose, beside the placed ones elsewhere', async () => {
    await renderPacking(
      `/trips/${ALPS}/packing`,
      ...headlampIn({ els: E_DUFFEL }),
    )

    expect(groupNames()).toEqual(['Crate B', 'Duffel 90 L', 'Loose'])
    expect(metaIn('Duffel 90 L')).toHaveTextContent(
      'PER-PERSON · 0/1 · 2 ELSEWHERE',
    )
    expect(metaIn('Loose')).toHaveTextContent('PER-PERSON · 0/2 · 1 ELSEWHERE')
    expect(within(groupFor('Loose')).getByText('0/2')).toBeVisible()
  })

  /** Ruling C2's two drawn meta lines, verbatim. */
  it('scopes the meta count to the group and names the rest', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...splitFrame())

    expect(metaIn('Duffel 90 L')).toHaveTextContent(
      'PER-PERSON · 1/1 · 2 ELSEWHERE',
    )
    expect(metaIn('Crate B')).toHaveTextContent(
      'PER-PERSON · 0/1 · 2 ELSEWHERE',
    )
    expect(metaIn('Loose')).toHaveTextContent('PER-PERSON · 0/1 · 2 ELSEWHERE')
  })

  /** Pinned at N=1 (§5b M): the remainder is a count, not a plural. */
  it('pins the remainder at 1 ELSEWHERE', async () => {
    await renderPacking(
      `/trips/${ALPS}/packing`,
      ...headlampIn({ els: E_DUFFEL, mies: E_DUFFEL }),
      tripPieceStatusSet(ALPS, E_HEADLAMP, 'els', 'packed'),
    )

    expect(metaIn('Duffel 90 L')).toHaveTextContent(
      'PER-PERSON · 1/2 · 1 ELSEWHERE',
    )
    expect(metaIn('Loose')).toHaveTextContent('PER-PERSON · 0/1 · 2 ELSEWHERE')
  })

  /**
   * **Muted, not amber** (C2): a remainder, not a residence — the residence
   * is the header, and a set in two bags is not a fault. `css: false`, so the
   * stylesheet text is the only thing that sees this.
   */
  it('draws the remainder muted, never in the residence amber', async () => {
    const file = '../components/PackingRow.module.css'

    expect(ruleBody(file, '.elsewhere')).toMatch(/--color-ink-faint/)
    expect(ruleBody(file, '.elsewhere')).not.toMatch(/amber/)
    expect(ruleBody(file, '.residence')).toMatch(/amber/)
  })

  /**
   * `N ELSEWHERE` counts the **whole Entry** under `○ LEFT` — it says where
   * the rest of the set is, not what the filter shows. The duffel's row (Els,
   * packed) drops out and takes its now-empty group with it; the crate's and
   * `Loose`'s stay, both still reading `2 ELSEWHERE`.
   */
  it('keeps the remainder whole under ○ LEFT, and filters rows per row', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...splitFrame())
    await pressLeftOnly(user)

    expect(groupNames()).toEqual(['Crate B', 'Loose'])
    expect(metaIn('Crate B')).toHaveTextContent(
      'PER-PERSON · 0/1 · 2 ELSEWHERE',
    )
    expect(metaIn('Loose')).toHaveTextContent('PER-PERSON · 0/1 · 2 ELSEWHERE')
  })

  /** Ruling C2's accessible name, on a scoped row. */
  it('announces the scoped count and the remainder as one control', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...splitFrame())

    expect(
      within(onlyRowIn('Duffel 90 L')).getByTestId('packing-row-cluster'),
    ).toHaveAccessibleName(
      'Packing status — Headlamp, 1 of 1 packed here, 2 elsewhere',
    )
  })

  /**
   * **Ruling C1's refusal.** The cluster paints the Pieces in this group and
   * no others — a one-circle cluster is a legal cluster — and a Piece
   * elsewhere is **never** drawn dashed and dim: that is `PersonCluster`'s
   * word for *excluded* on the builder, and a removed Piece is not drawn on
   * F4 at all, so a dashed circle here would read *not bringing one*.
   */
  it('paints only this group Pieces, and no circle anywhere is dashed', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...splitFrame())

    for (const group of ['Crate B', 'Duffel 90 L', 'Loose']) {
      expect(
        within(onlyRowIn(group)).getAllByTestId('person-circle'),
      ).toHaveLength(1)
    }
    expect(document.querySelectorAll('[data-tone="dashed"]')).toHaveLength(0)

    // The other two modes draw the same primitive over the same fold.
    for (const mode of ['PERSON', 'ALL']) {
      await chooseMode(user, mode)
      expect(document.querySelectorAll('[data-tone="dashed"]')).toHaveLength(0)
    }
  })

  /** The cluster **and its count** stay one control (rulings B and A1):
   * scoping changes what it covers, never that it is one target. */
  it('gives the scoped cluster no individual circle target', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...splitFrame())

    const row = onlyRowIn('Crate B')
    const cluster = within(row).getByTestId('packing-row-cluster')
    for (const circle of within(row).getAllByTestId('person-circle')) {
      expect(circle.closest('button')).toBe(cluster)
    }
  })

  /**
   * **Ruling C3, verified rather than assumed.** One sheet per Entry, never
   * one per row: opened from the duffel's row — which draws Els alone — it
   * lists **all three** Pieces with their three residences, because it is the
   * one surface where the split is seen whole and mended at `MOVE`.
   */
  it('opens the whole Entry sheet from a scoped row', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...splitFrame())

    await user.click(
      within(onlyRowIn('Duffel 90 L')).getByTestId('packing-row-body'),
    )

    expect(screen.getByText('PACKING STATUS · 1 OF 3 PACKED')).toBeVisible()
    const rows = screen.getAllByTestId('piece-status-row')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('▸ Duffel 90 L'),
      expect.stringContaining('▸ LOOSE'),
      expect.stringContaining('▸ Crate B'),
    ])
  })

  /** The same sheet from the same Entry's `Loose` row — C3's *from any of its
   * rows*, which is the half a per-row sheet would fail. */
  it('opens that same sheet from the Entry other rows', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...splitFrame())

    await user.click(
      within(onlyRowIn('Loose')).getByTestId('packing-row-cluster'),
    )

    expect(screen.getByText('PACKING STATUS · 1 OF 3 PACKED')).toBeVisible()
    expect(screen.getAllByTestId('piece-status-row')).toHaveLength(3)
  })

  /**
   * **No ruling reaches this state, so S9a's read is kept.** A per-person
   * Entry with no Pieces at all — no Participant yet, the ordinary shape of a
   * Draft — yields no item, so C1's *a group holding at least one of its
   * Pieces* names none. It is still a line on the gear list, and a line
   * drawing in no group would vanish from the mode the screen rests in while
   * ALL mode still lists it. `Loose` is where a thing in no container goes.
   */
  it('draws a per-person Entry with no Pieces under Loose', async () => {
    await renderPacking(
      `/trips/${ALPS}/packing`,
      tripCreated(ALPS, 'Alps 2026'),
      tripPhaseMoved(ALPS, 'pack_out'),
      gearRecorded(HEADLAMP, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(ALPS, E_HEADLAMP, { from: 'depot', gearId: HEADLAMP }),
    )

    expect(groupNames()).toEqual(['Loose'])
    expect(metaIn('Loose')).toHaveTextContent('PER-PERSON · 0/0')
    expect(metaIn('Loose')).not.toHaveTextContent('ELSEWHERE')
  })
})

/* ------------------------------------------------------------------------ *
 * PERSON mode, ALL mode, and the `○ LEFT` filter.
 *
 * `docs/design/README.md` §1 and §5e A7 · A7b · A8; spec §4.2.
 * ------------------------------------------------------------------------ */

/** The non-Participant owner. `aa-zoe` sorts **first** among the roster's
 * ids and `Zoë` sorts **last** among its names — see {@link personFrame}. */
const ZOE = 'aa-zoe'

const DUFFEL = 'gggggggg-0000-7000-8000-000000000030'
const DRYBAG = 'gggggggg-0000-7000-8000-000000000031'
const JACKET = 'gggggggg-0000-7000-8000-000000000032'
const BOOTS = 'gggggggg-0000-7000-8000-000000000033'

const E_DUFFEL = 'nnnnnnnn-0000-7000-8000-000000000030'
const E_DRYBAG = 'nnnnnnnn-0000-7000-8000-000000000031'
const E_JACKET = 'nnnnnnnn-0000-7000-8000-000000000032'
const E_BOOTS = 'nnnnnnnn-0000-7000-8000-000000000033'

/**
 * Eight pieces over five buckets, built so that every rule ruling A7 states
 * has exactly one row proving it.
 *
 * ```
 * Els    0/2 · 2 LEFT   Headlamp — Els's piece   ▸ DUFFEL 90 L   ○
 *                       Jacket                   ▸ LOOSE         ○
 * Kim    ● 1/1          (collapsed)
 * Mies   0/1 · 1 LEFT   Headlamp — Mies's piece  ▸ LOOSE         ○
 * Zoë    0/1 · 1 LEFT   Boots                    ▸ LOOSE         ○
 * Shared 2/3 · 1 LEFT   Map                      ▸ LOOSE         ●
 *                       Rope                     ▸ DRY BAG       ●
 *                       Stove                    ▸ DUFFEL 90 L   ○
 * ```
 *
 * - **Zoë is not a Participant** and still gets a group: the header answers
 *   *whose it is*, and Els's jacket carried by Mark is honest (ruling A7).
 * - **Kim's group is all done**, which is what the `● 1/1` collapse is read
 *   off, and what `○ LEFT` empties.
 * - **Els's Headlamp Piece rides in the duffel while the other two are
 *   loose**, which is the only way `▸ MIXED` becomes reachable.
 * - **`Dry bag` holds one packed Entry and nothing else**, so `○ LEFT` has a
 *   fully-packed *container* group to empty as well as a person one.
 *
 * `● 3/8 PIECES` / `5 LEFT` in all, and `0 + 1 + 0 + 0 + 2 = 3` across the
 * groups — ruling A7's arithmetic, on facts the MVP holds.
 *
 * ## Zoë's id sorts against her name, deliberately
 *
 * `packing.counts.test.ts`'s own hazard, and this file walked into it once:
 * `alps()`'s three People are `els · kim · mies` named `Els · Kim · Mies`, so
 * **id order and name order agree**, and `personPartition` already returns
 * `shared` last on its own — an ordering assertion over that roster passes
 * whether or not the screen orders anything at all.
 *
 * {@link ZOE} is `aa-zoe`, which sorts **first** by id and **last** by name,
 * so the drawn order can only be produced by `peopleOn`. And `Zoë` sorts
 * *after* `Shared`, so an implementation that folded the `Shared` bucket into
 * that same label sort would draw it fourth rather than last. The two
 * mechanisms the group order rests on are each pinned by one row of the
 * expected array.
 */
function personFrame(): readonly OpSpec[] {
  return [
    ...alps(),
    personRecorded(ZOE, 'Zoë'),

    gearRecorded(DUFFEL, {
      name: 'Duffel 90 L',
      container: true,
      kind: 'single',
    }),
    tripEntryAdded(ALPS, E_DUFFEL, { from: 'depot', gearId: DUFFEL }),

    gearRecorded(DRYBAG, { name: 'Dry bag', container: true, kind: 'single' }),
    tripEntryAdded(ALPS, E_DRYBAG, { from: 'depot', gearId: DRYBAG }),

    // Per-person, with one Piece moved away from the other two.
    gearRecorded(HEADLAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(ALPS, E_HEADLAMP, { from: 'depot', gearId: HEADLAMP }),
    tripPieceMoved(ALPS, E_HEADLAMP, 'els', {
      in: 'container',
      entryId: E_DUFFEL,
    }),
    tripPieceStatusSet(ALPS, E_HEADLAMP, 'kim', 'packed'),

    // Personal to a Participant, and personal to a Person who is not one.
    gearRecorded(JACKET, { name: 'Jacket', container: false, kind: 'single' }),
    gearOwnershipSet(JACKET, { type: 'person', personId: 'els' }),
    tripEntryAdded(ALPS, E_JACKET, { from: 'depot', gearId: JACKET }),

    gearRecorded(BOOTS, { name: 'Boots', container: false, kind: 'single' }),
    gearOwnershipSet(BOOTS, { type: 'person', personId: ZOE }),
    tripEntryAdded(ALPS, E_BOOTS, { from: 'depot', gearId: BOOTS }),

    // Shared: one in the duffel, one loose and packed, one in the dry bag.
    gearRecorded(STOVE, { name: 'Stove', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_STOVE, { from: 'depot', gearId: STOVE }),
    tripEntryMoved(ALPS, E_STOVE, { in: 'container', entryId: E_DUFFEL }),

    gearRecorded(MAP, { name: 'Map', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_MAP, { from: 'depot', gearId: MAP }),
    tripEntryStatusSet(ALPS, E_MAP, 'packed'),

    gearRecorded(ROPE, { name: 'Rope', container: false, kind: 'single' }),
    tripEntryAdded(ALPS, E_ROPE, { from: 'depot', gearId: ROPE }),
    tripEntryMoved(ALPS, E_ROPE, { in: 'container', entryId: E_DRYBAG }),
    tripEntryStatusSet(ALPS, E_ROPE, 'packed'),
  ]
}

/** A group as a landmark: `<section aria-labelledby>` is a `region` named by
 * its own heading, so a group is addressable without a testid of its own. */
function groupFor(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

/** Switch the segmented control, which is what the three modes hang off. */
async function chooseMode(user: UserEvent, label: string): Promise<void> {
  await user.click(screen.getByRole('radio', { name: label }))
}

async function pressLeftOnly(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: /○ LEFT/ }))
}

/** Every drawn row's name, in document order. */
function rowNames(): string[] {
  return screen
    .getAllByTestId('packing-row-name')
    .map((name) => name.textContent ?? '')
}

/** Every drawn group's name, in document order. */
function groupNames(): string[] {
  return screen
    .getAllByTestId('packing-group-name')
    .map((name) => name.textContent ?? '')
}

describe('PERSON mode', () => {
  /**
   * The partition is `personPartition`'s and is not re-derived on the screen;
   * **the order is the screen's**, because `shared/` deliberately does not
   * supply one — its buckets come back in person-id order with `Shared`
   * distinguished by its key rather than by its position.
   *
   * **Both mechanisms are pinned by one row each**, which is only true
   * because {@link ZOE}'s id sorts against her name: `Zoë` fourth is
   * `peopleOn`'s label order rather than `personPartition`'s id order (which
   * would draw her first), and `Shared` fifth is this screen's own push
   * rather than a label sort over every bucket (which would draw `Shared`
   * fourth, since `shared` < `zoë`). Both mutations were run and both go red.
   */
  it('orders People by the People screen, with Shared last', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    expect(groupNames()).toEqual(['Els', 'Kim', 'Mies', 'Zoë', 'Shared'])
  })

  /**
   * `Shared` is last on purpose, a deliberate divergence from the Depot's
   * `GROUP BY OWNER`, whose grouping table pins `shared` **first**: it is the
   * everything-else bucket and on a real Trip the biggest one, so first
   * position would push every person header off-screen.
   */
  it('names the Shared group for what it is, with its own meta', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    const shared = groupFor('Shared')
    expect(
      within(shared).getByText('NOT ATTRIBUTED TO A PERSON'),
    ).toBeInTheDocument()
    expect(within(shared).getByText('2/3 · 1 LEFT')).toBeInTheDocument()
  })

  it('buckets a Piece to its Participant', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    const mies = groupFor('Mies')
    expect(within(mies).getAllByTestId('packing-row')).toHaveLength(1)
    expect(within(mies).getByTestId('packing-row-name')).toHaveTextContent(
      'Headlamp',
    )
  })

  /** Rule 2, and the one that makes the group answer *whose it is* rather
   * than *who is going*: Zoë is not a Participant and still has a group. */
  it('buckets Personal gear to its owner, participant or not', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    expect(
      within(groupFor('Zoë')).getByTestId('packing-row-name'),
    ).toHaveTextContent('Boots')
    expect(
      within(groupFor('Els')).getAllByTestId('packing-row-name')[1],
    ).toHaveTextContent('Jacket')
  })

  /** Ruling A7's arithmetic: the buckets close on facts the MVP holds, and
   * the header counts sum to the count line above them. */
  it('sums the group counts to the trip total', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    expect(screen.getByText('● 3/8 PIECES')).toBeInTheDocument()
    expect(screen.getByText('5 LEFT')).toBeInTheDocument()

    expect(within(groupFor('Els')).getByText('0/2 · 2 LEFT')).toBeVisible()
    expect(within(groupFor('Kim')).getByText('● 1/1')).toBeVisible()
    expect(within(groupFor('Mies')).getByText('0/1 · 1 LEFT')).toBeVisible()
    expect(within(groupFor('Zoë')).getByText('0/1 · 1 LEFT')).toBeVisible()
    expect(within(groupFor('Shared')).getByText('2/3 · 1 LEFT')).toBeVisible()
  })

  /** Ruling A7's collapse, and the word that went with it. */
  it('collapses an all-done person and says nothing about the widget', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    const kim = groupFor('Kim')
    expect(within(kim).getByText('● 1/1')).toBeInTheDocument()
    expect(within(kim).queryAllByTestId('packing-row')).toHaveLength(0)
    expect(screen.queryByText(/COLLAPSED/)).not.toBeInTheDocument()
  })

  it('expands an all-done person in place when its header is tapped', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    const expand = within(groupFor('Kim')).getByTestId('packing-group-expand')
    expect(expand).toHaveAttribute('aria-expanded', 'false')

    await user.click(expand)

    expect(expand).toHaveAttribute('aria-expanded', 'true')
    expect(within(groupFor('Kim')).getAllByTestId('packing-row')).toHaveLength(
      1,
    )
  })

  /**
   * A group with work left is already showing it, so its header is text and
   * not a control — the dead affordance the empty state refuses one screen
   * up, and `Loose`'s own header rule one mode over.
   */
  it('gives a group with work left no expand control at all', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    expect(
      within(groupFor('Els')).queryByTestId('packing-group-expand'),
    ).not.toBeInTheDocument()
  })

  it("names a Piece row's owner inline", async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    // Recorded case in the DOM, capped by CSS — the house rule. Asserted as
    // the one phrase the body button announces, which is also what pins the
    // space between the two spans: `.nameLine`'s gap is not a character.
    expect(
      within(groupFor('Els')).getAllByTestId('packing-row-body')[0],
    ).toHaveTextContent("Headlamp — Els's piece")
  })

  /**
   * Ruling A7b, overturned. Its only possible fact is *holds no Login*, which
   * S5 ruled must be withdrawn rather than guessed when the read fails — a
   * screen used in a cold garage cannot rest on a network call.
   */
  it('draws no PARTICIPANT tag anywhere', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    expect(screen.queryByText('PARTICIPANT')).not.toBeInTheDocument()
  })

  /**
   * The header circle's tone is the group's **one** fact, said a second way:
   * `filled` where nothing is left, `control` otherwise — the `●` in
   * `● 1/1` in a second channel, never colour alone.
   *
   * It is deliberately **not** the three-way `toneForStatus` a row's circle
   * takes. A group has no status, and borrowing that vocabulary for an
   * aggregate would invent one — which is also why the board's own frame,
   * drawing a partial group half-amber in one row and bordered in another,
   * could not be followed as drawn.
   */
  it('fills an all-done header circle and leaves every other one bordered', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    const toneIn = (group: string): string | null =>
      within(groupFor(group))
        .getAllByTestId('person-circle')[0]
        ?.getAttribute('data-tone') ?? null

    expect(toneIn('Kim')).toBe('filled')
    expect(toneIn('Els')).toBe('control')
    expect(toneIn('Mies')).toBe('control')
    expect(toneIn('Zoë')).toBe('control')

    // `Shared` is not a Person and draws no circle at all: one there would
    // claim an attribution the group exists to say is absent.
    expect(
      within(groupFor('Shared')).queryAllByTestId('person-circle'),
    ).toHaveLength(0)
  })

  /** No header states *where* in this mode either, so every row's meta ends
   * in its own trip residence. */
  it("ends a row's meta line in its trip residence", async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')

    const els = within(groupFor('Els')).getAllByTestId('packing-row')
    expect(els[0]).toHaveTextContent('▸ Duffel 90 L')
    expect(els[1]).toHaveTextContent('PERSONAL E · ×1 · ▸ LOOSE')
  })
})

describe('ALL mode', () => {
  /**
   * Ruling A8. The grouped modes answer *where is it going* and *whose is
   * it*; ALL exists for *is this one thing packed*, which is a lookup — and
   * **sorting by status would move rows under the thumb as they are tapped**.
   *
   * The order is `entriesOf`', which sorts through `byNameThenId`
   * (`selectors/order.ts`) — no second comparator, so two Devices holding
   * identical state draw the identical list.
   */
  it('sorts by name A→Z, never by status', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'ALL')

    expect(rowNames()).toEqual([
      'Boots',
      'Headlamp',
      'Jacket',
      'Map',
      'Rope',
      'Stove',
    ])
  })

  it('draws no group headers', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'ALL')

    expect(screen.queryAllByTestId('packing-group-header')).toHaveLength(0)
  })

  /** A container carries no status, and its name still appears as its
   * contents' residence segment — so nothing is hidden by leaving it out. */
  it('draws no container rows', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'ALL')

    expect(rowNames()).not.toContain('Duffel 90 L')
    expect(rowNames()).not.toContain('Dry bag')
    expect(within(rowFor('Stove')).getByText('▸ Duffel 90 L')).toBeVisible()
  })

  it("ends each meta line in the item's trip residence", async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'ALL')

    expect(within(rowFor('Stove')).getByText('▸ Duffel 90 L')).toBeVisible()
    expect(within(rowFor('Map')).getByText('▸ LOOSE')).toBeVisible()
    expect(within(rowFor('Rope')).getByText('▸ Dry bag')).toBeVisible()
  })

  /** One row for the whole per-person Entry, so the row cannot name three
   * residences — the sheet it opens is what states each one. */
  it("reads ▸ MIXED where a per-person row's Pieces differ", async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'ALL')

    expect(
      within(rowFor('Headlamp')).getByTestId('packing-row-meta'),
    ).toHaveTextContent('PER-PERSON · 1/3 · ▸ MIXED')
  })

  /** …and names the one residence they share the moment they agree. */
  it("names the residence a per-person row's Pieces share", async () => {
    const user = userEvent.setup()
    await renderPacking(
      `/trips/${ALPS}/packing`,
      ...personFrame(),
      tripPieceMoved(ALPS, E_HEADLAMP, 'mies', {
        in: 'container',
        entryId: E_DUFFEL,
      }),
      tripPieceMoved(ALPS, E_HEADLAMP, 'kim', {
        in: 'container',
        entryId: E_DUFFEL,
      }),
    )
    await chooseMode(user, 'ALL')

    expect(
      within(rowFor('Headlamp')).getByTestId('packing-row-meta'),
    ).toHaveTextContent('PER-PERSON · 1/3 · ▸ Duffel 90 L')
  })

  /**
   * **Ruling B's condition, on the one mode that can still break it.** The
   * visible `1/3` sits in a per-person row's *meta line*, inside the body
   * button rather than inside the cluster control — a departure from
   * `EntryRow` that is harmless **only because the body and the cluster open
   * the same sheet**, so the digit and the circles stay one control's worth
   * of target between them. `PackingRow`'s docstring says in as many words
   * that giving a per-person row's body a different destination turns this
   * into a violation.
   *
   * PERSON mode cannot break it — `personPartition` emits one `piece` item
   * per Piece, so no clustered row is drawn there at all and the rule holds
   * vacuously. **ALL mode is where a clustered row survives**, so this is
   * where the invariant is worth an assertion.
   */
  it("opens the Piece sheet from a per-person row's body, not the picker", async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'ALL')

    await user.click(within(rowFor('Headlamp')).getByTestId('packing-row-body'))

    expect(screen.getByText('PACKING STATUS · 1 OF 3 PACKED')).toBeVisible()
    expect(
      screen.queryByText('WHERE IT GOES ON THIS TRIP'),
    ).not.toBeInTheDocument()
  })

  /** The other half of the same control: the cluster opens the same sheet, so
   * the two targets on that row are one destination. */
  it("opens the same sheet from that row's cluster", async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'ALL')

    await user.click(
      within(rowFor('Headlamp')).getByTestId('packing-row-cluster'),
    )

    expect(screen.getByText('PACKING STATUS · 1 OF 3 PACKED')).toBeVisible()
  })
})

describe('the ○ LEFT filter', () => {
  it('hides packed items and nothing else', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'ALL')
    await pressLeftOnly(user)

    // Map and Rope are packed; the Headlamp keeps two unpacked Pieces, so the
    // row it draws survives — the filter is over what carries a status.
    expect(rowNames()).toEqual(['Boots', 'Headlamp', 'Jacket', 'Stove'])
  })

  /** The counts state the pack-out's arithmetic, not the view's: a control
   * that narrows a list must not move a denominator. */
  it('leaves the count line and the group counts alone', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await chooseMode(user, 'PERSON')
    await pressLeftOnly(user)

    expect(screen.getByText('● 3/8 PIECES')).toBeInTheDocument()
    expect(within(groupFor('Shared')).getByText('2/3 · 1 LEFT')).toBeVisible()
  })

  it('applies in all three modes', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await pressLeftOnly(user)

    // CONTAINER: the packed Map goes from the Loose group.
    expect(rowNames()).not.toContain('Map')
    expect(rowNames()).toContain('Stove')

    await chooseMode(user, 'PERSON')
    expect(rowNames()).not.toContain('Map')
    expect(rowNames()).toContain('Boots')

    await chooseMode(user, 'ALL')
    expect(rowNames()).not.toContain('Map')
    expect(rowNames()).toContain('Jacket')
  })

  it('leaves a fully-packed group drawing nothing', async () => {
    const user = userEvent.setup()
    await renderPacking(`/trips/${ALPS}/packing`, ...personFrame())
    await pressLeftOnly(user)

    // CONTAINER: `Dry bag` holds one packed Entry and nothing else.
    expect(screen.queryByRole('region', { name: 'Dry bag' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Duffel 90 L' })).toBeVisible()

    await chooseMode(user, 'PERSON')
    expect(screen.queryByRole('region', { name: 'Kim' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Els' })).toBeVisible()
  })

  /**
   * A container holding nothing but nested containers keeps its header: the
   * rail is that container's own journey, not its contents'.
   *
   * **The `Stove` and Els's Headlamp Piece both have to leave the duffel for
   * this fixture to say anything.** A container produces no item of its own,
   * so a rows-less container is one nothing *sits in* — and while the duffel
   * still held the unpacked stove it survived `○ LEFT` on that row rather
   * than on the rule under test. Els's Piece is the round-2 half of the same
   * point: under ruling C1 it draws a Headlamp row **in the duffel**, so the
   * duffel is rows-less only once the Piece is loose too. The guard reads
   * `group.rows.length > 0 && rows.length === 0` precisely so that emptiness
   * has to be **caused** by the filter; drop that first conjunct and this
   * goes red.
   */
  it('keeps a container group whose only rows are nested groups', async () => {
    const user = userEvent.setup()
    await renderPacking(
      `/trips/${ALPS}/packing`,
      ...personFrame(),
      tripEntryMoved(ALPS, E_DRYBAG, { in: 'container', entryId: E_DUFFEL }),
      // Now the duffel's own rows are none: the dry bag is its only child.
      tripEntryMoved(ALPS, E_STOVE, { in: 'loose' }),
      tripPieceMoved(ALPS, E_HEADLAMP, 'els', { in: 'loose' }),
    )
    await pressLeftOnly(user)

    const duffel = screen.getByRole('region', { name: 'Duffel 90 L' })
    expect(duffel).toBeVisible()
    expect(within(duffel).getByTestId('journey-rail')).toBeVisible()
    // Its one nested group *is* filtered out — the rope inside is packed —
    // which is what makes the duffel's survival the rule and not an
    // accident of something unpacked still sitting in it.
    expect(screen.queryByRole('region', { name: 'Dry bag' })).toBeNull()
    expect(within(duffel).queryAllByTestId('packing-row')).toHaveLength(0)
  })

  /**
   * **The orphaned indent, pinned as it behaves rather than as anyone drew
   * it.** *A group whose items all filter out draws nothing* is **the
   * slice's own sentence, not a ruling's** — ruling A3 settles `Loose`-last
   * and nothing else, and §1's "empty, it draws nothing" is about an empty
   * `Loose` group rather than about the filter. Taken literally it has one
   * shape with a visible cost: a parent container whose own rows are all
   * packed disappears while a nested container inside it survives, so the
   * child's group keeps its 16px indent with nothing above it to be indented
   * from.
   *
   * The alternative would be a keep-the-ancestry condition, and **no board
   * draws one** — inventing it here would be designing rather than building,
   * which is what §5e's own "a slice number on a board is a claim, not a
   * licence" warns against from the other direction.
   *
   * So this asserts what currently happens, deliberately. **It is a candidate
   * for the next design round, not settled intent**, and it is pinned so that
   * a later change to it is a visible decision rather than a silent one.
   */
  it('orphans a nested group whose parent filtered out — taken literally, and a candidate for the next round', async () => {
    const user = userEvent.setup()
    await renderPacking(
      `/trips/${ALPS}/packing`,
      ...personFrame(),
      // `Duffel 90 L ▸ Dry bag`, the duffel's own one row packed and the dry
      // bag's own one row not — the exact shape, and the smallest one.
      tripEntryMoved(ALPS, E_DRYBAG, { in: 'container', entryId: E_DUFFEL }),
      tripEntryStatusSet(ALPS, E_STOVE, 'packed'),
      tripEntryStatusSet(ALPS, E_ROPE, 'not_packed'),
      // Els's Headlamp Piece rides in the duffel in `personFrame`, and under
      // ruling C1 that draws a second, unpacked Headlamp row there — which
      // would keep the duffel alive on a row this test is not about.
      tripPieceMoved(ALPS, E_HEADLAMP, 'els', { in: 'loose' }),
    )
    await pressLeftOnly(user)

    expect(screen.queryByRole('region', { name: 'Duffel 90 L' })).toBeNull()

    const nested = screen.getByRole('region', { name: 'Dry bag' })
    expect(nested).toBeVisible()
    // The indent survives its parent: one level in, with no header above it
    // stating what it is one level inside of.
    expect(nested).toHaveAttribute('data-indent', '1')
    expect(within(nested).getByTestId('packing-row-name')).toHaveTextContent(
      'Rope',
    )
  })
})
