import {
  createHlcClock,
  gearKindSet,
  gearRecorded,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryRemoved,
  tripParticipantAdded,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
  type TripState,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { GearListSection } from './GearListSection'

/**
 * A **real** store, seeded by emitting real ops — `OverClaimBand.test.tsx`'s
 * rule: `entriesOf`/`entryKind`/`bringCountOf` are all folds of registers, so
 * a hand-shaped `EntryState` would test a shape the reducer might never
 * actually produce.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000008'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000008'
const TRIP = 'tttttttt-0000-7000-8000-000000000008'
const SEEDED_AT = 1_700_000_000_000

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

interface Seeded {
  store: StoreApi<DepotStoreState>
  trip: () => TripState
}

async function seeded(...specs: readonly OpSpec[]): Promise<Seeded> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return { store, trip: () => store.getState().state.trips[TRIP]! }
}

function renderSection(
  seed: Seeded,
  overrides: {
    editable?: boolean
    onBringCountChange?: (entryId: string, next: number) => void
    onRemove?: (entryId: string) => void
  } = {},
) {
  render(
    <DepotProvider value={seed.store}>
      <GearListSection
        trip={seed.trip()}
        editable={overrides.editable ?? true}
        onBringCountChange={overrides.onBringCountChange ?? vi.fn()}
        onRemove={overrides.onRemove ?? vi.fn()}
      />
    </DepotProvider>,
  )
}

describe('GearListSection', () => {
  it('renders nothing when the list is empty', async () => {
    const seed = await seeded(tripCreated(TRIP, 'Alps 2026'))
    renderSection(seed)
    expect(screen.queryByTestId('gear-list-section')).toBeNull()
  })

  describe('grouping by Kind', () => {
    it('groups SINGLE, COUNTED, PER-PERSON and TRIP-ONLY in that order, each with a pluralised piece count', async () => {
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        personRecorded('p1', 'Bran'),
        tripParticipantAdded(TRIP, 'p1'),
        gearRecorded('g-single', {
          name: 'Headlamp',
          container: false,
          kind: 'single',
        }),
        tripEntryAdded(TRIP, 'e-single', {
          from: 'depot',
          gearId: 'g-single',
        }),
        gearRecorded('g-counted', {
          name: 'Tent stake',
          container: false,
          kind: 'counted',
        }),
        tripEntryAdded(TRIP, 'e-counted', {
          from: 'depot',
          gearId: 'g-counted',
        }),
        tripEntryBringCountSet(TRIP, 'e-counted', 4),
        gearRecorded('g-person', {
          name: 'Trekking pole',
          container: false,
          kind: 'per_person',
        }),
        tripEntryAdded(TRIP, 'e-person', {
          from: 'depot',
          gearId: 'g-person',
        }),
        tripEntryAdded(TRIP, 'e-trip-only', {
          from: 'trip_only',
          name: 'Passports',
          container: false,
        }),
      )
      renderSection(seed)

      const labels = screen.getAllByTestId('gear-list-group-label')
      expect(labels.map((el) => el.textContent)).toEqual([
        'SINGLE',
        'COUNTED',
        'PER-PERSON',
        'TRIP-ONLY',
      ])

      // Each header's own group carries the right pluralised piece count.
      function headerFor(label: string): HTMLElement {
        return labels.find((el) => el.textContent === label)!.parentElement!
      }
      expect(
        within(headerFor('SINGLE')).getByText('1 PIECE'),
      ).toBeInTheDocument()
      expect(
        within(headerFor('COUNTED')).getByText('4 PIECES'),
      ).toBeInTheDocument()
      expect(
        within(headerFor('PER-PERSON')).getByText('1 PIECE'),
      ).toBeInTheDocument()
      expect(
        within(headerFor('TRIP-ONLY')).getByText('1 PIECE'),
      ).toBeInTheDocument()
    })

    it('omits a group with no Entries', async () => {
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        gearRecorded('g-single', {
          name: 'Headlamp',
          container: false,
          kind: 'single',
        }),
        tripEntryAdded(TRIP, 'e-single', {
          from: 'depot',
          gearId: 'g-single',
        }),
      )
      renderSection(seed)
      expect(screen.getByText('SINGLE')).toBeInTheDocument()
      expect(screen.queryByText('COUNTED')).toBeNull()
      expect(screen.queryByText('PER-PERSON')).toBeNull()
      expect(screen.queryByText('TRIP-ONLY')).toBeNull()
    })

    it('files a depot Entry whose Gear has no Kind register yet under a trailing — group, not SINGLE or TRIP-ONLY', async () => {
      // `gear.recorded` never landed for this id — the ordinary
      // cross-aggregate sync race (spec §3.1): `entryKind` reads `undefined`.
      // Review round F2: an unresolved Kind is its own group, never `SINGLE`
      // — re-stating "single" would assert a fact `entryKind` declines to.
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        tripEntryAdded(TRIP, 'e-unsynced', {
          from: 'depot',
          gearId: 'g-not-yet-synced',
        }),
      )
      renderSection(seed)
      const labels = screen
        .getAllByTestId('gear-list-group-label')
        .map((el) => el.textContent)
      expect(labels).toEqual(['—'])
      expect(screen.queryByText('SINGLE')).toBeNull()
      expect(screen.queryByText('TRIP-ONLY')).toBeNull()
      // The label falls back to `—`, per `entryLabel`.
      expect(screen.getByTestId('entry-row')).toHaveTextContent('—')
    })

    it('files an unrecognised Kind under the same trailing — group as an unsynced one, sorted last', async () => {
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        gearRecorded('g-single', {
          name: 'Headlamp',
          container: false,
          kind: 'single',
        }),
        tripEntryAdded(TRIP, 'e-single', {
          from: 'depot',
          gearId: 'g-single',
        }),
        gearRecorded('g-weird', {
          name: 'Odd gear',
          container: false,
          kind: 'single',
        }),
        gearKindSet('g-weird', 'widget'),
        tripEntryAdded(TRIP, 'e-weird', { from: 'depot', gearId: 'g-weird' }),
      )
      renderSection(seed)
      const labels = screen
        .getAllByTestId('gear-list-group-label')
        .map((el) => el.textContent)
      // SINGLE (the real one) first, the merged tail group last.
      expect(labels).toEqual(['SINGLE', '—'])
      expect(screen.queryByText('COUNTED')).toBeNull()
      expect(screen.queryByText('PER-PERSON')).toBeNull()
      expect(screen.queryByText('TRIP-ONLY')).toBeNull()
    })
  })

  describe('accessibility — the group header names its own rows (review round F3)', () => {
    it('wires each group as role="group" labelled by its own header', async () => {
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        gearRecorded('g-single', {
          name: 'Headlamp',
          container: false,
          kind: 'single',
        }),
        tripEntryAdded(TRIP, 'e-single', {
          from: 'depot',
          gearId: 'g-single',
        }),
      )
      renderSection(seed)
      const group = screen.getByRole('group', { name: 'SINGLE' })
      expect(within(group).getByText('Headlamp')).toBeInTheDocument()
    })
  })

  describe('editable={true}', () => {
    it('renders a remove control on every row and calls onRemove with the Entry id', async () => {
      const user = userEvent.setup()
      const onRemove = vi.fn()
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        gearRecorded('g-single', {
          name: 'Headlamp',
          container: false,
          kind: 'single',
        }),
        tripEntryAdded(TRIP, 'e-single', {
          from: 'depot',
          gearId: 'g-single',
        }),
      )
      renderSection(seed, { onRemove })
      await user.click(screen.getByRole('button', { name: 'Remove Headlamp' }))
      expect(onRemove).toHaveBeenCalledWith('e-single')
    })

    it('calls onBringCountChange with the Entry id and the new count', async () => {
      const user = userEvent.setup()
      const onBringCountChange = vi.fn()
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        gearRecorded('g-counted', {
          name: 'Tent stake',
          container: false,
          kind: 'counted',
        }),
        tripEntryAdded(TRIP, 'e-counted', {
          from: 'depot',
          gearId: 'g-counted',
        }),
        tripEntryBringCountSet(TRIP, 'e-counted', 4),
      )
      renderSection(seed, { onBringCountChange })
      await user.click(
        screen.getByRole('button', { name: /increase bring-count/i }),
      )
      expect(onBringCountChange).toHaveBeenCalledWith('e-counted', 5)
    })

    it('does not call onBringCountChange when the stepper reports the current value', async () => {
      const user = userEvent.setup()
      const onBringCountChange = vi.fn()
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        gearRecorded('g-counted', {
          name: 'Tent stake',
          container: false,
          kind: 'counted',
        }),
        tripEntryAdded(TRIP, 'e-counted', {
          from: 'depot',
          gearId: 'g-counted',
        }),
        tripEntryBringCountSet(TRIP, 'e-counted', 4),
      )
      renderSection(seed, { onBringCountChange })
      const well = screen.getByRole('textbox', {
        name: /bring-count for tent stake/i,
      })
      await user.clear(well)
      await user.type(well, '4')
      expect(onBringCountChange).not.toHaveBeenCalled()
    })

    it('excludes a removed Entry from the list', async () => {
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        gearRecorded('g-single', {
          name: 'Headlamp',
          container: false,
          kind: 'single',
        }),
        tripEntryAdded(TRIP, 'e-single', {
          from: 'depot',
          gearId: 'g-single',
        }),
        tripEntryRemoved(TRIP, 'e-single'),
      )
      renderSection(seed)
      expect(screen.queryByTestId('gear-list-section')).toBeNull()
    })
  })

  describe('editable={false} (Split and up)', () => {
    it('renders no remove control and no stepper', async () => {
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        gearRecorded('g-counted', {
          name: 'Tent stake',
          container: false,
          kind: 'counted',
        }),
        tripEntryAdded(TRIP, 'e-counted', {
          from: 'depot',
          gearId: 'g-counted',
        }),
        tripEntryBringCountSet(TRIP, 'e-counted', 4),
      )
      renderSection(seed, { editable: false })
      expect(screen.queryByTestId('entry-row-remove')).toBeNull()
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×4')
    })

    it('reads — for a per-person row rather than ×N', async () => {
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        personRecorded('p1', 'Bran'),
        tripParticipantAdded(TRIP, 'p1'),
        gearRecorded('g-person', {
          name: 'Trekking pole',
          container: false,
          kind: 'per_person',
        }),
        tripEntryAdded(TRIP, 'e-person', {
          from: 'depot',
          gearId: 'g-person',
        }),
      )
      renderSection(seed, { editable: false })
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('—')
    })

    it('still draws the TRIP-ONLY badge, even though the trailing slot reads —', async () => {
      // Review round F1, asserted at the section level (this is what Tasks 9
      // and 11 actually mount): the badge is a name adjunct, not
      // trailing-column content, so read-only mode does not drop it.
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        tripEntryAdded(TRIP, 'e-trip-only', {
          from: 'trip_only',
          name: 'Passports',
          container: false,
        }),
      )
      renderSection(seed, { editable: false })
      expect(screen.getByTestId('entry-row-badge')).toHaveTextContent(
        'TRIP-ONLY',
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('—')
    })
  })

  describe('the 0 Bring-count (review round F6, invariant 11)', () => {
    it('keeps a 0-count Counted Entry on the list, under a 0 PIECES header', async () => {
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        gearRecorded('g-counted', {
          name: 'Tent stake',
          container: false,
          kind: 'counted',
        }),
        tripEntryAdded(TRIP, 'e-counted', {
          from: 'depot',
          gearId: 'g-counted',
        }),
        tripEntryBringCountSet(TRIP, 'e-counted', 0),
      )
      renderSection(seed)
      expect(screen.getByTestId('entry-row')).toHaveTextContent('Tent stake')
      const group = screen.getByRole('group', { name: 'COUNTED' })
      expect(within(group).getByText('0 PIECES')).toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: /bring-count for tent stake/i }),
      ).toHaveValue('0')
    })

    it('reads ×0 in read-only mode for a 0-count Counted Entry', async () => {
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        gearRecorded('g-counted', {
          name: 'Tent stake',
          container: false,
          kind: 'counted',
        }),
        tripEntryAdded(TRIP, 'e-counted', {
          from: 'depot',
          gearId: 'g-counted',
        }),
        tripEntryBringCountSet(TRIP, 'e-counted', 0),
      )
      renderSection(seed, { editable: false })
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×0')
      const group = screen.getByRole('group', { name: 'COUNTED' })
      expect(within(group).getByText('0 PIECES')).toBeInTheDocument()
    })
  })
})
