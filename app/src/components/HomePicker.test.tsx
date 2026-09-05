import {
  gearRecorded,
  gearRetired,
  placeRecorded,
  type OpSpec,
  type Residence,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
} from '../depot/store'
import { anAuthor, anId, noopEngine } from '../testUtils'
import { HomePicker } from './HomePicker'

/**
 * Every test seeds a **real** store by emitting real ops, exactly as
 * `Depot.test.tsx` does — never a hand-shaped `DepotState`.
 */

async function seededStore(
  specs: readonly OpSpec[] = [],
  log: OpLog = inMemoryOpLog(),
): Promise<StoreApi<DepotStoreState>> {
  const store = createDepotStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return store
}

type PickerProps = Parameters<typeof HomePicker>[0]

function renderPicker(
  store: StoreApi<DepotStoreState>,
  props: Partial<PickerProps> = {},
) {
  // Real no-ops, not `vi.fn()`, wherever a test does not assert on the call —
  // this repo's rule is real fakes, never mocking-framework mocks
  // (`docs/testing.md`).
  const selected: Residence[] = []
  render(
    <DepotProvider value={store}>
      <HomePicker
        onClose={() => {}}
        onSelect={(residence) => selected.push(residence)}
        {...props}
      />
    </DepotProvider>,
  )
  return { selected }
}

/** Edit mode is a mode, not a per-row control — every test about RENAME or
 * REMOVE has to enter it first. That is the round-2 change: round 1 laid both
 * jobs on every pick row, and a twelve-place household's picker became a wall
 * of controls around a one-tap task. */
async function enterEditMode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'EDIT' }))
}

describe('the Home picker', () => {
  it('lists places, their containers, and loose', async () => {
    const atticId = anId()
    const shedId = anId()
    const crateId = anId()
    const store = await seededStore([
      placeRecorded(atticId, 'Attic'),
      placeRecorded(shedId, 'Shed'),
      gearRecorded(crateId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: atticId },
      }),
    ])

    renderPicker(store)

    expect(screen.getByRole('button', { name: /^Loose/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crate B' })).toBeInTheDocument()
  })

  it('creates a Place inline and emits place.recorded', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ New place' }))
    await user.type(
      screen.getByRole('textbox', { name: 'New place name' }),
      'Garage',
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await store.getState().drained()

    const places = Object.values(store.getState().state.places)
    expect(places).toHaveLength(1)
    expect(places[0]?.name?.value).toBe('Garage')
    expect(screen.getByRole('button', { name: 'Garage' })).toBeInTheDocument()
  })

  it('renames a Place and emits place.renamed', async () => {
    const placeId = anId()
    const store = await seededStore([placeRecorded(placeId, 'Attic')])
    const user = userEvent.setup()
    renderPicker(store)

    await enterEditMode(user)
    await user.click(screen.getByRole('button', { name: 'Rename Attic' }))
    const field = screen.getByRole('textbox', { name: 'Rename Attic' })
    await user.clear(field)
    await user.type(field, 'Loft')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.places[placeId]?.name?.value).toBe('Loft')
    expect(screen.getByRole('button', { name: 'Loft' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Attic' })).toBeNull()
  })

  /**
   * A needless write is never free: a `place.renamed` equal to the current
   * name still moves the LWW stamp, and can silently beat a genuine rename
   * queued on a Device that was offline. `startRename` seeds the field with
   * the current name, so Save-without-editing is the ordinary way to author
   * one.
   */
  it('emits no place.renamed when the name was not changed', async () => {
    const placeId = anId()
    const log = inMemoryOpLog()
    const store = await seededStore([placeRecorded(placeId, 'Attic')], log)
    const user = userEvent.setup()
    renderPicker(store)

    await enterEditMode(user)
    await user.click(screen.getByRole('button', { name: 'Rename Attic' }))
    expect(screen.getByRole('textbox', { name: 'Rename Attic' })).toHaveValue(
      'Attic',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    const renames = (await log.all()).filter(
      (record) => record.op.type === 'place.renamed',
    )
    expect(renames).toEqual([])
    // The rename UI still closes: nothing to write is not a reason to stay.
    expect(screen.queryByRole('textbox', { name: 'Rename Attic' })).toBeNull()
  })

  it('names the count of gear that becomes loose before removing a Place', async () => {
    const placeId = anId()
    const specs: OpSpec[] = [placeRecorded(placeId, 'Attic')]
    for (const name of ['Rope', 'Mug', 'Axe', 'Stove']) {
      specs.push(
        gearRecorded(anId(), {
          name,
          container: false,
          kind: 'single',
          residence: { in: 'place', id: placeId },
        }),
      )
    }
    const store = await seededStore(specs)
    const user = userEvent.setup()
    renderPicker(store)

    await enterEditMode(user)
    await user.click(screen.getByRole('button', { name: 'Remove Attic' }))

    expect(
      screen.getByText('4 pieces of gear become loose.'),
    ).toBeInTheDocument()
  })

  it('excludes retired gear from the count of gear that becomes loose', async () => {
    const placeId = anId()
    const retiredId = anId()
    const specs: OpSpec[] = [placeRecorded(placeId, 'Attic')]
    for (const name of ['Rope', 'Mug', 'Axe']) {
      specs.push(
        gearRecorded(anId(), {
          name,
          container: false,
          kind: 'single',
          residence: { in: 'place', id: placeId },
        }),
      )
    }
    specs.push(
      gearRecorded(retiredId, {
        name: 'Old lantern',
        container: false,
        kind: 'single',
        residence: { in: 'place', id: placeId },
      }),
      gearRetired(retiredId),
    )
    const store = await seededStore(specs)
    const user = userEvent.setup()
    renderPicker(store)

    await enterEditMode(user)
    await user.click(screen.getByRole('button', { name: 'Remove Attic' }))

    // Four pieces reside in Attic, but one is retired — a soft-delete
    // (invariant 7), not gear waiting to be re-homed — so the count reads 3,
    // not 4.
    expect(
      screen.getByText('3 pieces of gear become loose.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('4 pieces of gear become loose.')).toBeNull()
  })

  it('emits place.removed only after the confirmation', async () => {
    const placeId = anId()
    const store = await seededStore([
      placeRecorded(placeId, 'Attic'),
      gearRecorded(anId(), {
        name: 'Rope',
        container: false,
        kind: 'single',
        residence: { in: 'place', id: placeId },
      }),
    ])
    const user = userEvent.setup()
    renderPicker(store)

    await enterEditMode(user)
    await user.click(screen.getByRole('button', { name: 'Remove Attic' }))
    expect(store.getState().state.places[placeId]?.removed?.value).not.toBe(
      true,
    )

    await user.click(screen.getByRole('button', { name: 'Remove place' }))
    await store.getState().drained()

    expect(store.getState().state.places[placeId]?.removed?.value).toBe(true)
  })

  it('emits nothing when the confirmation is dismissed', async () => {
    const placeId = anId()
    const store = await seededStore([
      placeRecorded(placeId, 'Attic'),
      gearRecorded(anId(), {
        name: 'Rope',
        container: false,
        kind: 'single',
        residence: { in: 'place', id: placeId },
      }),
    ])
    const user = userEvent.setup()
    renderPicker(store)

    await enterEditMode(user)
    await user.click(screen.getByRole('button', { name: 'Remove Attic' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await store.getState().drained()

    expect(
      Object.hasOwn(store.getState().state.places[placeId] ?? {}, 'removed'),
    ).toBe(false)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('does not offer a non-container piece of gear as a home', async () => {
    const placeId = anId()
    const store = await seededStore([
      placeRecorded(placeId, 'Attic'),
      gearRecorded(anId(), {
        name: 'Rope',
        container: false,
        kind: 'single',
        residence: { in: 'place', id: placeId },
      }),
    ])

    renderPicker(store)

    expect(screen.queryByRole('button', { name: 'Rope' })).toBeNull()
  })

  it('does not offer a container as a home for itself or its own descendants', async () => {
    const atticId = anId()
    const crateId = anId()
    const pouchId = anId()
    const tinyBagId = anId()
    const store = await seededStore([
      placeRecorded(atticId, 'Attic'),
      gearRecorded(crateId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: atticId },
      }),
      gearRecorded(pouchId, {
        name: 'Pouch',
        container: true,
        kind: 'single',
        residence: { in: 'gear', id: crateId },
      }),
      gearRecorded(tinyBagId, {
        name: 'Tiny bag',
        container: true,
        kind: 'single',
        residence: { in: 'gear', id: pouchId },
      }),
    ])

    renderPicker(store, { excludeGearId: crateId })

    expect(screen.queryByRole('button', { name: 'Crate B' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pouch' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tiny bag' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Attic' })).toBeInTheDocument()
  })
})

/**
 * **Round 2** (`docs/design/README.md` §3c, Screens A §07). Two jobs, one
 * sheet, **two modes** — because round 1 laid both jobs on every row, and a
 * twelve-place household's picker became a wall of controls around a one-tap
 * task.
 */
describe('the Home picker — pick mode', () => {
  it('makes every row a bare tap target, with no controls beside it', async () => {
    const atticId = anId()
    const store = await seededStore([placeRecorded(atticId, 'Attic')])
    renderPicker(store)

    // Picking is the whole fast path: one tap selects and closes.
    expect(screen.queryByRole('button', { name: 'Rename Attic' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove Attic' })).toBeNull()
  })

  it('puts Loose first and teaches the word', async () => {
    const store = await seededStore([placeRecorded(anId(), 'Attic')])
    renderPicker(store)

    // The picker is where the glossary word LOOSE is taught.
    expect(screen.getByText('NO RESIDENCE — THE DEFAULT')).toBeInTheDocument()
  })

  /**
   * Round 1 did not mark the current home, and MOVE without it cannot show
   * where the gear stands. `● NOW` is the SET PHASE anatomy, reused rather
   * than invented again.
   */
  it('marks the current home with the SET PHASE anatomy', async () => {
    const atticId = anId()
    const shedId = anId()
    const store = await seededStore([
      placeRecorded(atticId, 'Attic'),
      placeRecorded(shedId, 'Shed'),
    ])
    renderPicker(store, { current: { in: 'place', id: atticId } })

    expect(screen.getByRole('button', { name: /Attic/ })).toHaveTextContent(
      '● NOW',
    )
    expect(screen.getByRole('button', { name: /Shed/ })).not.toHaveTextContent(
      '● NOW',
    )
  })

  it('marks Loose as current when the gear lives nowhere', async () => {
    const store = await seededStore([placeRecorded(anId(), 'Attic')])
    renderPicker(store, { current: { in: 'loose' } })

    expect(screen.getByRole('button', { name: /Loose/ })).toHaveTextContent(
      '● NOW',
    )
  })

  /**
   * "Indent 16px per level, capped at **two** levels below the Place (was
   * three); deeper rows keep the cap indent and carry their skipped ancestry
   * as a meta line under the name" — the GearRow name+meta anatomy,
   * replacing round 1's inline parent prefix, which fought the name scan.
   */
  it('caps the indent and carries the skipped ancestry as a meta line', async () => {
    const atticId = anId()
    const shelfId = anId()
    const crateId = anId()
    const sackId = anId()
    const store = await seededStore([
      placeRecorded(atticId, 'Attic'),
      gearRecorded(shelfId, {
        name: 'Shelf L-top',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: atticId },
      }),
      gearRecorded(crateId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
        residence: { in: 'gear', id: shelfId },
      }),
      gearRecorded(sackId, {
        name: 'Stuff sack, green',
        container: true,
        kind: 'single',
        residence: { in: 'gear', id: crateId },
      }),
    ])

    renderPicker(store)

    // Third level below the Place: past the cap, so it carries its ancestry.
    const sack = screen.getByRole('button', { name: /Stuff sack, green/ })
    expect(sack).toHaveTextContent('Shelf L-top ▸ Crate B')
    // Exact: the sack's own ancestry meta line contains "Crate B" too, which
    // is the very thing being asserted one line above.
    // Within the cap: nothing to say, so nothing said.
    expect(
      screen.getByRole('button', { name: 'Crate B' }),
    ).not.toHaveTextContent('▸')
  })

  /**
   * "Creation stays in the pick path — a new shelf enters mid-sitting, and a
   * place created while picking is **selected immediately**."
   */
  it('selects a place created while picking, without a second tap', async () => {
    const store = await seededStore()
    const user = userEvent.setup()
    const { selected } = renderPicker(store)

    await user.click(screen.getByRole('button', { name: '+ New place' }))
    await user.type(
      screen.getByRole('textbox', { name: 'New place name' }),
      'Kelder',
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await store.getState().drained()

    expect(selected).toHaveLength(1)
    expect(selected[0]?.in).toBe('place')
  })

  // The first thing a new Quartermaster meets: one body line that teaches the
  // model at the moment it matters.
  it('teaches the model to an empty household', async () => {
    const store = await seededStore()
    renderPicker(store)

    expect(
      screen.getByText(
        'No places yet. Gear can stay loose, or live in a place — usually a room.',
      ),
    ).toBeInTheDocument()
  })

  it('says nothing about an empty household once it has a place', async () => {
    const store = await seededStore([placeRecorded(anId(), 'Attic')])
    renderPicker(store)

    expect(screen.queryByText(/No places yet/)).toBeNull()
  })
})

describe('the Home picker — edit mode', () => {
  it('suspends selection while editing', async () => {
    const atticId = anId()
    const store = await seededStore([placeRecorded(atticId, 'Attic')])
    const user = userEvent.setup()
    const { selected } = renderPicker(store)

    await enterEditMode(user)
    // Exact: in edit mode the row is flanked by `Rename Attic` and
    // `Remove Attic`, which a substring match would also find.
    await user.click(screen.getByRole('button', { name: 'Attic' }))

    // Rows stop closing the sheet: EDIT is a mode, and picking is off.
    expect(selected).toEqual([])
  })

  it('offers RENAME and REMOVE on Place rows only', async () => {
    const atticId = anId()
    const crateId = anId()
    const store = await seededStore([
      placeRecorded(atticId, 'Attic'),
      gearRecorded(crateId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: atticId },
      }),
    ])
    const user = userEvent.setup()
    renderPicker(store)
    await enterEditMode(user)

    expect(
      screen.getByRole('button', { name: 'Rename Attic' }),
    ).toBeInTheDocument()
    // Containers are gear, renamed from their own EDIT — not from here.
    expect(screen.queryByRole('button', { name: 'Rename Crate B' })).toBeNull()
    expect(screen.getByText('GEAR — EDIT FROM ITS DETAIL')).toBeInTheDocument()
  })

  it('returns to picking on DONE', async () => {
    const atticId = anId()
    const store = await seededStore([placeRecorded(atticId, 'Attic')])
    const user = userEvent.setup()
    const { selected } = renderPicker(store)

    await enterEditMode(user)
    await user.click(screen.getByRole('button', { name: 'DONE' }))
    await user.click(screen.getByRole('button', { name: /Attic/ }))

    expect(selected).toHaveLength(1)
  })
})

/**
 * **MOVE** — the same sheet, from gear detail. The caller supplies only the
 * exclusion and the context line.
 */
describe('the Home picker — MOVE', () => {
  async function aCrateInAnAttic() {
    const atticId = anId()
    const shedId = anId()
    const crateId = anId()
    const tentId = anId()
    const store = await seededStore([
      placeRecorded(atticId, 'Attic'),
      placeRecorded(shedId, 'Shed'),
      gearRecorded(crateId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
        residence: { in: 'place', id: atticId },
      }),
      gearRecorded(tentId, {
        name: 'Tent',
        container: false,
        kind: 'single',
        residence: { in: 'gear', id: crateId },
      }),
    ])
    return { store, atticId, shedId, crateId }
  }

  it('carries the ride-along count in the context line', async () => {
    const { store, crateId } = await aCrateInAnAttic()
    renderPicker(store, {
      excludeGearId: crateId,
      moving: { name: 'Crate B', insideCount: 1 },
    })

    // CAPS is a `text-transform` on the line, per this codebase's convention.
    expect(screen.getByTestId('moving-context')).toHaveTextContent(
      'MOVING Crate B · 1 INSIDE RIDE ALONG',
    )
  })

  /**
   * The excluded subtree is **absent at any depth** (invariant 3), with one
   * footer line saying so — not greyed. Components §05's blocked-rows mock is
   * retired: a picker never shows un-pickable rows.
   */
  it('says once that the moved gear and its contents are not offered', async () => {
    const { store, crateId } = await aCrateInAnAttic()
    renderPicker(store, {
      excludeGearId: crateId,
      moving: { name: 'Crate B', insideCount: 1 },
    })

    expect(screen.queryByRole('button', { name: /Crate B/ })).toBeNull()
    expect(screen.getByTestId('moving-footer')).toHaveTextContent(
      'Crate B AND EVERYTHING INSIDE IT ARE NOT OFFERED.',
    )
  })

  /**
   * **The departure from the board, and why.** Screens A §07 ends MOVE with
   * "selection moves and closes; UNDO per the global rule". There is no
   * global Undo rule in force — story 36 is Later and opens with a design
   * phase — and a mis-tapped destination in a nested picker is otherwise
   * unrecoverable without re-navigating. So MOVE confirms.
   */
  it('confirms before moving, because Undo is not built', async () => {
    const { store, crateId, shedId } = await aCrateInAnAttic()
    const user = userEvent.setup()
    const { selected } = renderPicker(store, {
      excludeGearId: crateId,
      moving: { name: 'Crate B', insideCount: 1 },
    })

    await user.click(screen.getByRole('button', { name: /Shed/ }))
    expect(selected).toEqual([])
    expect(
      screen.getByRole('alertdialog', { name: 'Move Crate B to Shed?' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Move gear' }))
    expect(selected).toEqual([{ in: 'place', id: shedId }])
  })

  it('moves nothing when the confirmation is dismissed', async () => {
    const { store, crateId } = await aCrateInAnAttic()
    const user = userEvent.setup()
    const { selected } = renderPicker(store, {
      excludeGearId: crateId,
      moving: { name: 'Crate B', insideCount: 1 },
    })

    await user.click(screen.getByRole('button', { name: /Shed/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(selected).toEqual([])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  // Picking a home for gear that does not exist yet (Add Gear) confirms
  // nothing — there is no prior state to lose.
  it('does not confirm when nothing is being moved', async () => {
    const { store } = await aCrateInAnAttic()
    const user = userEvent.setup()
    const { selected } = renderPicker(store)

    await user.click(screen.getByRole('button', { name: /Shed/ }))

    expect(selected).toHaveLength(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
  /**
   * **Mounted is open.** Before the Radix conversion this picker was mounted
   * permanently by gear detail and early-returned `null`, so EDIT mode — and
   * the drafts beside it — survived a close and came back on the next open.
   * Reopening put the Quartermaster in a mode that suspends selection, with
   * nothing on screen saying why.
   */
  it('opens in pick mode, even after a close that left it in EDIT', async () => {
    const store = await seededStore([placeRecorded(anId(), 'Attic')])
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <DepotProvider value={store}>
          <button type="button" onClick={() => setOpen(true)}>
            Open the picker
          </button>
          {open && (
            <HomePicker onClose={() => setOpen(false)} onSelect={() => {}} />
          )}
        </DepotProvider>
      )
    }
    render(<Harness />)

    await enterEditMode(user)
    expect(screen.getByRole('button', { name: 'DONE' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Open the picker' }))

    expect(screen.getByRole('button', { name: 'EDIT' })).toBeInTheDocument()
  })
})
