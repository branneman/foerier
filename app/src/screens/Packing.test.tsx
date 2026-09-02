import {
  createHlcClock,
  gearRecorded,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryStatusSet,
  tripParticipantAdded,
  tripPhaseMoved,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
  type PhaseValue,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
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

    gearRecorded(PEGS, { name: 'Tent peg', container: false, kind: 'counted' }),
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
    expect(screen.queryByTestId('packing-footer')).not.toBeInTheDocument()
  })

  /**
   * The over-claim band is a property of the **gear list** — the trip screen
   * and the builder's right pane — and F4 is not the gear list. Two Trips
   * claiming the same Piece is a fact about membership; this screen asks how
   * far along one Trip's own pack-out is.
   */
  it('draws no over-claim band — that belongs to the gear list', async () => {
    await renderPacking(`/trips/${ALPS}/packing`, ...nineWithFourPacked())

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
