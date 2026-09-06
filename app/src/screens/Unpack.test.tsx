import {
  gearRecorded,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripOutcomeSet,
  tripParticipantAdded,
  type HouseholdState,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
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
