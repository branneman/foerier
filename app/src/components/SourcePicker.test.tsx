import {
  gearRecorded,
  tripCreated,
  tripDatesSet,
  tripEntryAdded,
  tripNotePosted,
  tripParticipantAdded,
  tripPhaseMoved,
  tripTaskAdded,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { inMemoryOpLog } from '../household/opLog'
import { createHouseholdStore, HouseholdProvider } from '../household/store'
import { anAuthor, noopEngine } from '../testUtils'
import { SourcePicker } from './SourcePicker'

/**
 * **The source picker** (ruling J9). The three Trips below are minted with
 * real UUIDv7 shapes in creation order, because the ordering under test *is*
 * the id's own embedded timestamp — `sourceTrips`' corrected reading of J8.
 */

// `01920000…` < `01930000…` < `01940000…` as strings, because the first 48
// bits are a big-endian millisecond timestamp.
const OLD = '01920000-0000-7000-8000-000000000001'
const MID = '01930000-0000-7000-8000-000000000002'
const NEW = '01940000-0000-7000-8000-000000000003'
const GEAR = 'gggggggg-0000-7000-8000-000000000001'
const PERSON = 'pppppppp-0000-7000-8000-000000000001'

/**
 * `Vosges 2025` (closed, dated, one Entry, one task, one note), `Alps 2026`
 * (mid pack-out, two Entries, one task, **no notes**), and an unnamed Draft
 * with one Entry and **no dates**.
 */
function threeTrips(): readonly OpSpec[] {
  return [
    gearRecorded(GEAR, { name: 'Tent', container: false, kind: 'single' }),
    tripCreated(OLD, 'Vosges 2025'),
    tripDatesSet(OLD, { start: '2025-07-19', end: '2025-07-26' }),
    tripEntryAdded(OLD, 'e-1', { from: 'depot', gearId: GEAR }),
    tripTaskAdded(OLD, 'k-1', 'Book the hut'),
    tripNotePosted(OLD, 'n-1', 'The pole sleeve is splitting.'),
    tripPhaseMoved(OLD, 'closed'),

    tripCreated(MID, 'Alps 2026'),
    tripDatesSet(MID, { start: '2026-08-14' }),
    tripEntryAdded(MID, 'e-2', { from: 'depot', gearId: GEAR }),
    tripEntryAdded(MID, 'e-3', {
      from: 'trip_only',
      name: 'Passports',
      container: false,
    }),
    tripTaskAdded(MID, 'k-2', 'Renew the DAV cards'),
    tripPhaseMoved(MID, 'pack_out'),

    tripParticipantAdded(NEW, PERSON),
    tripEntryAdded(NEW, 'e-4', { from: 'depot', gearId: GEAR }),
  ]
}

async function renderPicker(
  options: {
    selected?: string | null
    onPicked?: (id: string | null) => void
    specs?: readonly OpSpec[]
  } = {},
) {
  const store = createHouseholdStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of options.specs ?? threeTrips()) store.getState().emit(spec)
  await store.getState().drained()

  render(
    <HouseholdProvider value={store}>
      <SourcePicker
        selected={options.selected ?? null}
        onPicked={options.onPicked ?? (() => undefined)}
        onClose={() => undefined}
      />
    </HouseholdProvider>,
  )
}

function names(): readonly (string | null)[] {
  return screen.getAllByTestId('source-name').map((node) => node.textContent)
}

describe('SourcePicker', () => {
  it('lists every visible Trip, newest created first, under the clear row', async () => {
    await renderPicker()

    // Closed, active and Draft together (J8) — the phase does not bear on
    // whether a list is worth copying. The unnamed Draft is newest and reads
    // through the prose sentinel.
    expect(names()).toEqual([
      'Nothing — start empty',
      'Unnamed trip',
      'Alps 2026',
      'Vosges 2025',
    ])
  })

  it('offers the clear as its first row, and marks the standing choice', async () => {
    const onPicked = vi.fn()
    await renderPicker({ selected: null, onPicked })

    const rows = screen.getAllByTestId('source-row')
    expect(rows[0]).toHaveTextContent('Nothing — start empty')
    expect(rows[0]).toHaveTextContent('A BLANK GEAR LIST')
    // `● NOW` is single select's own word, on the row that is the value.
    expect(rows[0]).toHaveTextContent('● NOW')

    await userEvent.setup().click(rows[0]!)
    expect(onPicked).toHaveBeenCalledWith(null)
  })

  it('reports the chosen Trip by id', async () => {
    const onPicked = vi.fn()
    await renderPicker({ onPicked })

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Vosges 2025/ }))
    expect(onPicked).toHaveBeenCalledWith(OLD)
  })

  it('names only what carries over, and never PIECES', async () => {
    await renderPicker()

    const metas = screen
      .getAllByTestId('source-meta')
      .map((node) => node.textContent)
    expect(metas).toEqual([
      // The Draft: no dates, one Entry, nothing else.
      'NO DATES · 1 ENTRIES',
      // `Alps 2026` has no notes, so the segment is absent rather than `0`.
      'AUG 2026 · 2 ENTRIES · 1 TASKS',
      'JUL 2025 · 1 ENTRIES · 1 TASKS · 1 NOTES',
    ])
    // Participants do not copy, so a Piece count would name a number the
    // copy cannot have — J10's second field line says this in words and
    // this line must not contradict it in figures.
    expect(screen.queryByText(/PIECES/)).toBeNull()
  })

  it('draws no phase or world chip on a row', async () => {
    await renderPicker()
    // The phase does not bear on whether a list is worth copying (J9).
    expect(screen.queryByText('CLOSED')).toBeNull()
    expect(screen.queryByText('PACK-OUT')).toBeNull()
  })

  it('draws the clear row alone in a household with no other Trip', async () => {
    await renderPicker({ specs: [] })
    expect(names()).toEqual(['Nothing — start empty'])
  })
})
