import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  gearRecorded,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripParticipantAdded,
  tripPieceMoved,
  tripPieceRemoved,
  tripPieceStatusSet,
  type IdSource,
  type OpSpec,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
} from '../depot/store'
import { anAuthor, noopEngine } from '../testUtils'
import { PieceStatusSheet } from './PieceStatusSheet'

/**
 * Ruling A1. This picker emits directly, exactly as `PiecePicker` does, so a
 * **real** `OpLog` is what proves "one op per tap" and "N ops in one batch"
 * rather than a spy on a prop that does not exist.
 *
 * The accessible-name question this brief originally posed — folding
 * `PACKING STATUS · 1 OF 3 PACKED` into the dialog's *name* — was overruled
 * mid-task: `Sheet` grew a `description` slot instead (`ui/Sheet.tsx`), so
 * the name stays exactly the visible title (the gear's own name) and the
 * count reaches a screen reader as the dialog's *description*. Both are
 * asserted below rather than the brief's literal composed-name string.
 *
 * The Duffel is deliberately named in **mixed case** (`Duffel 90 L`, not
 * `DUFFEL 90 L`): the review round's F6 finding was that an all-caps fixture
 * lets a missing `text-transform: uppercase` pass by coincidence — this
 * repo's own S5 timezone lesson, restated for a stylesheet. The recorded
 * case is what the component renders; the caps are the stylesheet's job,
 * proven separately below by reading `PieceStatusSheet.module.css` as text.
 */

const TRIP = 'tttttttt-0000-7000-8000-000000000008'
const ENTRY = 'eeeeeeee-0000-7000-8000-000000000008'
const GEAR = 'gggggggg-0000-7000-8000-000000000008'
const DUFFEL_ENTRY = 'eeeeeeee-0000-7000-8000-00000000000d'
const DUFFEL_GEAR = 'gggggggg-0000-7000-8000-00000000000d'
const LOOSE_ENTRY = 'eeeeeeee-0000-7000-8000-00000000000e'
const LOOSE_GEAR = 'gggggggg-0000-7000-8000-00000000000e'

let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `dddddddd-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

interface Seeded {
  store: StoreApi<DepotStoreState>
  /** Every `trip.piece_status_set` op authored **since** the seed. */
  statusOps: () => Promise<readonly { personId: unknown; status: unknown }[]>
}

/**
 * Mark, Els and Kim on one Trip, one depot-sourced per-person Headlamp
 * Entry riding in a duffel, and a second per-person Entry (`LOOSE_ENTRY`)
 * that is never moved anywhere — the fixture every test in this file starts
 * from. Kim's Piece starts `packed`, which is what makes `1 OF 3 PACKED`
 * true before any test interacts with anything. `extra` layers on top, so a
 * test asking about a tombstone does not repeat the whole setup.
 */
async function seeded(...extra: readonly OpSpec[]): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor({ ids }),
  })
  const specs: readonly OpSpec[] = [
    personRecorded('mark', 'Mark'),
    personRecorded('els', 'Els'),
    personRecorded('kim', 'Kim'),
    tripCreated(TRIP, 'Vosges'),
    tripParticipantAdded(TRIP, 'mark'),
    tripParticipantAdded(TRIP, 'els'),
    tripParticipantAdded(TRIP, 'kim'),
    gearRecorded(DUFFEL_GEAR, {
      name: 'Duffel 90 L',
      container: true,
      kind: 'single',
    }),
    tripEntryAdded(TRIP, DUFFEL_ENTRY, { from: 'depot', gearId: DUFFEL_GEAR }),
    gearRecorded(GEAR, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(TRIP, ENTRY, { from: 'depot', gearId: GEAR }),
    // On the **Piece**: a per-person Entry has no residence of its own to
    // read (§5e C0), and this is the sheet whose whole point is that one
    // Piece may ride in the duffel while another is loose.
    tripPieceMoved(TRIP, ENTRY, 'mark', {
      in: 'container',
      entryId: DUFFEL_ENTRY,
    }),
    tripPieceStatusSet(TRIP, ENTRY, 'kim', 'packed'),
    // Never moved: this Entry's own `residence` register stays unset, which
    // `packing.ts` reads as loose — F1's dedicated fixture.
    gearRecorded(LOOSE_GEAR, {
      name: 'Spare Batteries',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(TRIP, LOOSE_ENTRY, { from: 'depot', gearId: LOOSE_GEAR }),
    ...extra,
  ]
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const baseline = (await allStatusOps(log)).length
  return {
    store,
    statusOps: async () => (await allStatusOps(log)).slice(baseline),
  }
}

async function allStatusOps(
  log: OpLog,
): Promise<readonly { personId: unknown; status: unknown }[]> {
  const all = await log.all()
  return all
    .filter((entry) => entry.op.type === 'trip.piece_status_set')
    .map((entry) => ({
      personId: entry.op.payload['person_id'],
      status: entry.op.payload['status'],
    }))
}

function renderSheet(
  seed: Seeded,
  onOpenPieceMove: (personId: string) => void = () => {},
  entryId: string = ENTRY,
) {
  render(
    <DepotProvider value={seed.store}>
      <PieceStatusSheet
        tripId={TRIP}
        entryId={entryId}
        onClose={() => {}}
        onOpenPieceMove={onOpenPieceMove}
      />
    </DepotProvider>,
  )
}

/** The `<li>` a Person's row lives in — the scope both their body button and
 * their trailing `MOVE` sit inside. `closest`'s own type parameter avoids
 * the cast a `HTMLElement | null` narrowing would otherwise need (F10). */
function rowFor(name: string): HTMLElement {
  const button = screen.getByRole('button', { name: new RegExp(name) })
  const row = button.closest<HTMLElement>('[data-testid="piece-status-row"]')
  if (row === null) throw new Error(`no row found for ${name}`)
  return row
}

/** The stylesheet as text — `PackPicker.test.tsx`'s and `drawnSizes.test.ts`'s
 * technique, and the only one that sees CSS at all under
 * `app/vitest.config.ts`'s `css: false`. */
function moduleCss(): string {
  return readFileSync(
    join(
      dirname(expect.getState().testPath ?? ''),
      'PieceStatusSheet.module.css',
    ),
    'utf8',
  )
}

describe('the piece status sheet', () => {
  it('is a dialog named by the gear, described by the count', async () => {
    const seed = await seeded()
    renderSheet(seed)

    // The name is the gear's own name alone — `ui/Sheet`'s invariant holds:
    // the accessible name never carries words that are not on screen as the
    // heading.
    const sheet = screen.getByRole('dialog', { name: 'Headlamp' })
    expect(sheet).toBeInTheDocument()

    // The count reaches a screen reader as the dialog's *description*,
    // wired by `aria-describedby` to the same visible mono line a sighted
    // Quartermaster reads — one node doing both jobs.
    const fact = screen.getByText('PACKING STATUS · 1 OF 3 PACKED')
    expect(sheet).toHaveAttribute('aria-describedby', fact.id)
  })

  it('states the count as a fact, never as a question', async () => {
    const seed = await seeded()
    renderSheet(seed)

    expect(
      screen.getByText('PACKING STATUS · 1 OF 3 PACKED'),
    ).toBeInTheDocument()
  })

  it('lists only included Pieces, in People-screen order', async () => {
    const seed = await seeded(tripPieceRemoved(TRIP, ENTRY, 'kim'))
    renderSheet(seed)

    // Kim's Piece is removed: two rows, not three — alphabetical
    // (`sortedPeople`'s order), Els before Mark.
    expect(
      screen.getAllByTestId('piece-status-row').map((row) => row.textContent),
    ).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: /Kim/ }),
    ).not.toBeInTheDocument()
    const rows = screen.getAllByTestId('piece-status-row-button')
    expect(rows[0]).toHaveTextContent('Els')
    expect(rows[1]).toHaveTextContent('Mark')
  })

  it("emits one op per row tap, moving that Person's status one step", async () => {
    const user = userEvent.setup()
    const seed = await seeded()
    renderSheet(seed)

    // Mark starts `not_packed` (no op has ever named him): one tap advances
    // to `staged`, the pill's own cycle.
    await user.click(screen.getByRole('button', { name: /Mark/ }))
    await seed.store.getState().drained()

    expect(await seed.statusOps()).toEqual([
      { personId: 'mark', status: 'staged' },
    ])
  })

  it("draws each row's own trip residence, in its recorded case", async () => {
    const seed = await seeded()
    renderSheet(seed)

    // Recorded case (`Duffel 90 L`), not upper-cased in the source — the
    // stylesheet draws the caps (F6, proven separately below).
    expect(
      within(rowFor('Mark')).getByText('▸ Duffel 90 L'),
    ).toBeInTheDocument()
  })

  it('names a Piece with no container LOOSE, never bare (F1)', async () => {
    const seed = await seeded()
    renderSheet(seed, () => {}, LOOSE_ENTRY)

    // README §101: `LOOSE` never stands alone as a world.
    expect(within(rowFor('Mark')).getByText('▸ LOOSE')).toBeInTheDocument()
  })

  it('draws the residence in caps through the stylesheet, not the source (F6)', () => {
    const css = moduleCss()
    expect(css).toMatch(/\.residence[\s\S]*?text-transform:\s*uppercase/)
  })

  it("draws each row's own status as a word, not only a glyph (F2)", async () => {
    const seed = await seeded()
    renderSheet(seed)

    expect(within(rowFor('Kim')).getByText('● PACKED')).toBeInTheDocument()
    expect(within(rowFor('Mark')).getByText('○ NOT PACKED')).toBeInTheDocument()
  })

  it("fills the row's circle by the Piece's own status, not a fixed tone (F3)", async () => {
    const seed = await seeded(tripPieceStatusSet(TRIP, ENTRY, 'els', 'staged'))
    renderSheet(seed)

    expect(within(rowFor('Kim')).getByTestId('person-circle')).toHaveAttribute(
      'data-tone',
      'filled',
    )
    expect(within(rowFor('Els')).getByTestId('person-circle')).toHaveAttribute(
      'data-tone',
      'half',
    )
    expect(within(rowFor('Mark')).getByTestId('person-circle')).toHaveAttribute(
      'data-tone',
      'control',
    )
  })

  it('opens the Pack picker for one Piece from the trailing MOVE', async () => {
    const user = userEvent.setup()
    const onOpenPieceMove = vi.fn()
    const seed = await seeded()
    renderSheet(seed, onOpenPieceMove)

    await user.click(
      within(rowFor('Mark')).getByRole('button', { name: /MOVE/ }),
    )
    expect(onOpenPieceMove).toHaveBeenCalledWith('mark')
  })

  it('writes N ops from one SET EVERYONE chip, with no confirm', async () => {
    const user = userEvent.setup()
    // Kim's Piece is out: two included Pieces.
    const seed = await seeded(tripPieceRemoved(TRIP, ENTRY, 'kim'))
    renderSheet(seed)

    await user.click(screen.getByRole('button', { name: '● PACKED' }))
    await seed.store.getState().drained()

    const ops = await seed.statusOps()
    expect(ops).toHaveLength(2)
    expect(ops.every((op) => op.status === 'packed')).toBe(true)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('skips a row already at the target, while its siblings still change', async () => {
    const user = userEvent.setup()
    // Kim's Piece is already `packed` from the seed's own baseline op; Els
    // and Mark start `not_packed`.
    const seed = await seeded()
    renderSheet(seed)

    await user.click(screen.getByRole('button', { name: '● PACKED' }))
    await seed.store.getState().drained()

    // Two ops, not three: a redundant `trip.piece_status_set` on Kim would
    // carry a *later* HLC than whatever is in her register, which could beat
    // a genuine concurrent write from another Device — the SET PHASE /
    // journey-rail rule, restated for a batch.
    const ops = await seed.statusOps()
    expect(ops).toHaveLength(2)
    expect(ops.map((op) => op.personId).sort()).toEqual(['els', 'mark'])
    expect(ops.every((op) => op.status === 'packed')).toBe(true)
  })

  it('emits nothing when every row already holds the tapped status', async () => {
    const user = userEvent.setup()
    // All three Pieces already `packed`: Kim from the seed's baseline, Els
    // and Mark set explicitly here.
    const seed = await seeded(
      tripPieceStatusSet(TRIP, ENTRY, 'els', 'packed'),
      tripPieceStatusSet(TRIP, ENTRY, 'mark', 'packed'),
    )
    renderSheet(seed)

    await user.click(screen.getByRole('button', { name: '● PACKED' }))
    await seed.store.getState().drained()

    // The screen already shows the state the tap asked for: writing anyway
    // would be a genuinely redundant op with nothing behind it.
    expect(await seed.statusOps()).toEqual([])
  })

  it('writes backwards from SET EVERYONE too', async () => {
    const user = userEvent.setup()
    const seed = await seeded(tripPieceRemoved(TRIP, ENTRY, 'kim'))
    renderSheet(seed)

    await user.click(screen.getByRole('button', { name: '● PACKED' }))
    await seed.store.getState().drained()
    await user.click(screen.getByRole('button', { name: '○ NOT PACKED' }))
    await seed.store.getState().drained()

    // A second tap on another chip reverses the whole set — which is why it
    // needs no confirm: nothing was destroyed by the first tap.
    const ops = await seed.statusOps()
    expect(ops).toHaveLength(4)
    expect(ops.slice(2).every((op) => op.status === 'not_packed')).toBe(true)
  })

  it('offers no long-press affordance anywhere', async () => {
    const seed = await seeded()
    renderSheet(seed)

    expect(screen.queryByText(/LONG-PRESS/i)).not.toBeInTheDocument()
  })

  it('draws 30px circles, never an individual tap target', async () => {
    const seed = await seeded()
    renderSheet(seed)

    // Ruling B/K restated inside the sheet: the circles are decoration on
    // the 48px row, and the row — not the circle — is the control. Every
    // circle's nearest ancestor `<button>` is that row's own body button,
    // never the trailing `MOVE`, and never itself a bare target.
    for (const circle of screen.getAllByTestId('person-circle')) {
      const row = circle.closest('[data-testid="piece-status-row"]')
      const rowButton = row?.querySelector(
        '[data-testid="piece-status-row-button"]',
      )
      expect(circle.closest('button')).toBe(rowButton)
    }
  })
})
