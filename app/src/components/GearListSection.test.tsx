import {
  gearKindSet,
  gearRecorded,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryRemoved,
  tripParticipantAdded,
  tripPieceRemoved,
  type OpSpec,
  type TripState,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { DepotProvider, useDepot, type DepotStoreState } from '../depot/store'
import { seededStore } from '../testUtils'
import { GearListSection } from './GearListSection'

/**
 * A **real** store, seeded by emitting real ops — `OverClaimBand.test.tsx`'s
 * rule: `entriesOf`/`entryKind`/`bringCountOf` are all folds of registers, so
 * a hand-shaped `EntryState` would test a shape the reducer might never
 * actually produce.
 */

const TRIP = 'tttttttt-0000-7000-8000-000000000008'

interface Seeded {
  store: StoreApi<DepotStoreState>
  trip: () => TripState
}

async function seeded(...specs: readonly OpSpec[]): Promise<Seeded> {
  const store = await seededStore(specs)
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

/**
 * `renderSection`'s own `trip` prop is a **snapshot**, taken once at render
 * time (`seed.trip()`), which is right for every test above: none of them
 * emits an op that changes the *Trip's own registers* after mounting. The
 * one below does — `PiecePicker`'s toggle authors `trip.piece_removed`,
 * nested on `trip.entries` — and `entriesOf` reads `trip.entries` directly
 * (`shared/src/selectors/entry.ts`), so a stale `trip` prop would never see
 * it fold. `Trip.tsx` avoids this by deriving `trip` fresh from
 * `state.trips[tripId]` on every render (`state` itself is a live
 * `useDepot` subscription); this wrapper is that same shape, reused here so
 * the test exercises the real re-fold path rather than a frozen snapshot.
 */
function ReactiveGearListSection({ tripId }: { tripId: string }) {
  const trip = useDepot((depot) => depot.state.trips[tripId]!)
  return (
    <GearListSection
      trip={trip}
      editable
      onBringCountChange={() => {}}
      onRemove={() => {}}
    />
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

    it("draws the cluster and ×N for a per-person row, ruling A's amendment to the — rule", async () => {
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
      // Amended by ruling A (`docs/design/README.md` §5d): unlike every
      // other Kind, `per_person` draws the identical circles + `×N` above
      // Split — display needs no target's air — rather than falling back to
      // the read pane's general `—` rule.
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×1')
      expect(screen.getByRole('img', { name: /who brings one/i })).toBeVisible()
      // Inert, not a control: this is the Split-and-up read pane, and
      // ruling B withholds the control there entirely.
      expect(
        screen.queryByRole('button', { name: /who brings one/i }),
      ).toBeNull()
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

  describe('per-person Pieces (S8, rulings A–D)', () => {
    it("orders pieces by tripParticipants (display, by label) rather than pieceInclusion's id order", async () => {
      // Recorded out of the ids' own order — `personRecorded` is emitted for
      // "Zara" before "Ansel", and `participantAdded` for "Zara" first too,
      // so a row drawing id order or arrival order would read Zara, Ansel;
      // the display order is alphabetical by label.
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        personRecorded('p-zara', 'Zara'),
        personRecorded('p-ansel', 'Ansel'),
        tripParticipantAdded(TRIP, 'p-zara'),
        tripParticipantAdded(TRIP, 'p-ansel'),
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
      renderSection(seed)
      const control = screen.getByRole('button', { name: /who brings one/i })
      expect(control).toHaveTextContent('AZ')
    })

    it('opens PiecePicker from the one control, and a toggle there updates the row', async () => {
      const user = userEvent.setup()
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
        personRecorded('p1', 'Bran'),
        personRecorded('p2', 'Els'),
        tripParticipantAdded(TRIP, 'p1'),
        tripParticipantAdded(TRIP, 'p2'),
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
      render(
        <DepotProvider value={seed.store}>
          <ReactiveGearListSection tripId={TRIP} />
        </DepotProvider>,
      )

      expect(screen.queryByTestId('piece-row')).toBeNull()
      await user.click(
        screen.getByRole('button', {
          name: 'Who brings one — Trekking pole, 2 of 2 bring one',
        }),
      )
      expect(screen.getAllByTestId('piece-row')).toHaveLength(2)

      await user.click(screen.getByRole('button', { name: /Els/ }))
      // `emit` folds on the store's queue (`EntryRow.tsx`'s own docstring on
      // the S7 precedent) — `await user.click` alone does not prove the
      // fold has caught up, only that the click handler ran.
      await seed.store.getState().drained()
      await user.click(screen.getByRole('button', { name: 'Close' }))

      // The toggle in the picker authored `trip.piece_removed`, and the row
      // re-folds from the same store — one op, no separate refresh.
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×1')
      expect(
        screen.getByRole('button', {
          name: 'Who brings one — Trekking pole, 1 of 2 bring one',
        }),
      ).toBeInTheDocument()
    })

    it('reads NO PARTICIPANTS beside ×0 with no Participants on the Trip, and mounts no control', async () => {
      const seed = await seeded(
        tripCreated(TRIP, 'Alps 2026'),
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
      renderSection(seed)
      expect(screen.getByText('NO PARTICIPANTS')).toBeInTheDocument()
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×0')
      expect(
        screen.queryByRole('button', { name: /who brings one/i }),
      ).toBeNull()
    })

    it('says ×0 silently when every Piece is removed, with no offer to remove', async () => {
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
        tripPieceRemoved(TRIP, 'e-person', 'p1'),
      )
      renderSection(seed)
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×0')
      expect(screen.queryByText(/nobody/i)).toBeNull()
      expect(screen.queryByText('NO PARTICIPANTS')).toBeNull()
    })
  })
})
