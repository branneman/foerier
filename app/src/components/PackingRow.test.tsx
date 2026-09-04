import {
  createHlcClock,
  gearRecorded,
  personRecorded,
  tripCreated,
  tripEntryAdded,
  tripParticipantAdded,
  tripPhaseMoved,
  tripPieceMoved,
  tripPieceStatusSet,
  TRIP_LOOSE,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
  type PackingItem,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type EngineFactory,
} from '../depot/store'
import { PackingRow } from './PackingRow'

/**
 * **The per-Piece row**, which CONTAINER mode never draws.
 *
 * `Packing.test.tsx` covers every shape the packing screen itself renders —
 * the pill, the cluster, the meta line, the two targets. This file covers
 * the one shape it cannot reach: `personId`, which draws **one Piece** of a
 * per-person Entry rather than the Entry. PERSON mode is its caller and
 * lands with the next task; the row is pinned here so that task inherits a
 * tested control rather than an untested prop.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const SEEDED_AT = 1_700_000_000_000

const ALPS = 'tttttttt-0000-7000-8000-00000000000a'
const CRATE = 'gggggggg-0000-7000-8000-00000000000f'
const E_CRATE = 'nnnnnnnn-0000-7000-8000-00000000000f'
const HEADLAMP = 'gggggggg-0000-7000-8000-00000000000c'
const E_HEADLAMP = 'nnnnnnnn-0000-7000-8000-00000000000c'

let nextId = 0

const ids: IdSource = {
  next: () =>
    `eeeeeeee-0000-7000-8000-${(nextId++).toString(16).padStart(12, '0')}`,
}

function anAuthor(): OpAuthor {
  const clock: Clock = { now: () => SEEDED_AT }
  return {
    household_id: HOUSEHOLD,
    device_id: DEVICE,
    ids,
    hlc: createHlcClock(clock),
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

/** Els's headlamp Piece, staged, riding in Crate B with the rest of the set. */
function seed(): readonly OpSpec[] {
  return [
    personRecorded('els', 'Els'),
    personRecorded('kim', 'Kim'),
    tripCreated(ALPS, 'Alps 2026'),
    tripParticipantAdded(ALPS, 'els'),
    tripParticipantAdded(ALPS, 'kim'),
    tripPhaseMoved(ALPS, 'pack_out'),

    gearRecorded(CRATE, { name: 'Crate B', container: true, kind: 'single' }),
    tripEntryAdded(ALPS, E_CRATE, { from: 'depot', gearId: CRATE }),

    gearRecorded(HEADLAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(ALPS, E_HEADLAMP, { from: 'depot', gearId: HEADLAMP }),
    // Written on the **Piece**, not the Entry: for per-person gear *where it
    // is* is only ever a per-Piece fact, and a `trip.entry_moved` here would
    // fold and be ignored (§5e C0).
    tripPieceMoved(ALPS, E_HEADLAMP, 'els', {
      in: 'container',
      entryId: E_CRATE,
    }),
    tripPieceStatusSet(ALPS, E_HEADLAMP, 'els', 'staged'),
  ]
}

interface Rendered {
  authored: () => Promise<readonly { type: string; payload: unknown }[]>
  openPicker: ReturnType<typeof vi.fn>
  openPieceSheet: ReturnType<typeof vi.fn>
}

async function renderPieceRow(
  tripItems?: readonly PackingItem[],
): Promise<Rendered> {
  const log: OpLog = inMemoryOpLog()
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of seed()) store.getState().emit(spec)
  await store.getState().drained()
  const seedCount = (await log.all()).length

  const openPicker = vi.fn()
  const openPieceSheet = vi.fn()

  render(
    <DepotProvider value={store}>
      {/* `showResidence` because **PERSON mode is the only caller that
          passes `personId`, and it passes both** — rendering a Piece row
          without it would pin a configuration the app never draws. */}
      <PackingRow
        tripId={ALPS}
        entryId={E_HEADLAMP}
        personId="els"
        showResidence
        {...(tripItems === undefined ? {} : { tripItems })}
        onOpenPicker={openPicker}
        onOpenPieceSheet={openPieceSheet}
      />
    </DepotProvider>,
  )

  return {
    authored: async () => {
      await store.getState().drained()
      return (await log.all())
        .slice(seedCount)
        .map((entry) => ({ type: entry.op.type, payload: entry.op.payload }))
    },
    openPicker,
    openPieceSheet,
  }
}

describe('a per-Piece packing row', () => {
  /**
   * The board's own anatomy (`S9 Round` §02): the name gains `— ELS'S PIECE`
   * and the meta is simply where that Piece rides, since a Piece's own
   * residence is the one fact its Entry does not carry.
   *
   * **The whole phrase, on the body button, and that is the point of the
   * assertion.** `.nameLine` separates its two spans with a CSS `gap`, which
   * is not a character — so a substring assertion on the suffix alone passes
   * happily while the row's text content, and the button's accessible name
   * with it, read `Headlamp— Els's piece` as one word. Asserting the
   * announced sentence is what catches that.
   */
  it('names whose Piece it is and where that Piece rides', async () => {
    await renderPieceRow()

    const row = screen.getByTestId('packing-row')
    expect(within(row).getByTestId('packing-row-name')).toHaveTextContent(
      'Headlamp',
    )
    expect(within(row).getByTestId('packing-row-body')).toHaveTextContent(
      "Headlamp — Els's piece",
    )
    expect(within(row).getByTestId('packing-row-meta')).toHaveTextContent(
      '▸ Crate B',
    )
  })

  /** The pill reads **that Piece's** status, not the Entry's. */
  it('draws the Piece own status and cycles it one step per tap', async () => {
    const user = userEvent.setup()
    const rendered = await renderPieceRow()

    const pill = screen.getByTestId('packing-status-pill')
    expect(pill).toHaveTextContent('◐ STAGED')

    await user.click(pill)

    expect(await rendered.authored()).toEqual([
      {
        type: 'trip.piece_status_set',
        payload: {
          entry_id: E_HEADLAMP,
          person_id: 'els',
          status: 'packed',
        },
      },
    ])
  })

  /**
   * A Piece row's body is *where* again, not the status sheet: the sheet is
   * the whole set's row, and one Piece is set from its own row's picker.
   */
  it('opens the picker from the body, and draws no cluster', async () => {
    const user = userEvent.setup()
    const rendered = await renderPieceRow()

    await user.click(screen.getByTestId('packing-row-body'))

    expect(rendered.openPicker).toHaveBeenCalledTimes(1)
    expect(rendered.openPieceSheet).not.toHaveBeenCalled()
    expect(screen.queryByTestId('packing-row-cluster')).not.toBeInTheDocument()
  })

  /**
   * **The only assertion that proves `tripItems` is read at all**, and it is
   * here because nothing else can be: the packing screen threads its one
   * `packingItems` list into every row purely so the row does not rebuild a
   * containment view of its own, and the default rebuilds an *identical*
   * list. Delete a `tripItems={view.items}` from `Packing.tsx` and no tier
   * goes red — the threading is a pure performance fact, so its only
   * observable consequence is the one this test manufactures.
   *
   * So the list handed in **disagrees with the fold on purpose**: the seed
   * moves Els's Piece into Crate B, and this list says `loose`. A row reading
   * its prop draws `▸ LOOSE`; a row that quietly fell back to
   * `packingItems(trip, state)` draws `▸ Crate B`. That is a state the app
   * cannot produce — every real caller derives the list from the same fold —
   * and pinning an impossible state is the price of pinning the wiring. It is
   * the same trade `screenBand.test.tsx` makes when it renders a screen
   * inside `AppShell` to prove one side of a two-sided fact.
   *
   * **The pill is deliberately not part of the claim.** A Piece row's status
   * comes from the register through `pieceStatusOf`, not from the item, so it
   * still reads the fold's `◐ STAGED` while the list says `packed`. The two
   * can only differ here, in a hand-built list; asserting it states where the
   * prop's reach ends rather than blessing a disagreement.
   */
  it('draws its Pieces from `tripItems` when the caller threads them', async () => {
    await renderPieceRow([
      {
        kind: 'piece',
        entryId: E_HEADLAMP,
        personId: 'els',
        units: 1,
        status: 'packed',
        residence: TRIP_LOOSE,
      },
    ])

    const meta = within(screen.getByTestId('packing-row')).getByTestId(
      'packing-row-meta',
    )
    expect(meta).toHaveTextContent('▸ LOOSE')
    expect(meta).not.toHaveTextContent('Crate B')

    expect(screen.getByTestId('packing-status-pill')).toHaveTextContent(
      '◐ STAGED',
    )
  })
})
