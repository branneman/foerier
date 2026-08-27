import {
  createHlcClock,
  gearRecorded,
  gearRetired,
  gearTagApplied,
  normalizeTag,
  placeRecorded,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
  type TagString,
} from '@foerier/shared'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from '../depot/store'
import { GearDetail } from './GearDetail'

/** The only way a `TagString` is made (`shared/src/tags.ts`). */
function aTag(raw: string): TagString {
  const tag = normalizeTag(raw)
  if (tag === null) throw new Error(`not a tag: ${raw}`)
  return tag
}

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createDepotStore` — by emitting real ops through `emit`, exactly as
 * `Depot.test.tsx` and `AddGear.test.tsx` do. Never a hand-shaped
 * `DepotState`.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

function fixedClock(): Clock {
  return { now: () => 1_700_000_000_000 }
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

async function seededStore(
  specs: readonly OpSpec[] = [],
): Promise<StoreApi<DepotStoreState>> {
  const store = createDepotStore({
    log: inMemoryOpLog(),
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return store
}

function renderGearDetail(store: StoreApi<DepotStoreState>, gearId: string) {
  const location = memoryLocation({ path: `/gear/${gearId}`, record: true })
  const result = render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/gear/:id">
          <DepotProvider value={store}>
            <GearDetail />
          </DepotProvider>
        </Route>
        <Route path="/">
          <p>Depot list</p>
        </Route>
      </Switch>
    </Router>,
  )
  return { location, container: result.container }
}

describe('Gear detail', () => {
  it('shows the gear name and the MVP meta line', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Sleeping bag, winter',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
    ])
    renderGearDetail(store, gearId)

    expect(
      screen.getByRole('heading', { name: 'Sleeping bag, winter' }),
    ).toBeInTheDocument()
    expect(screen.getByText('ITEM · SHARED · ×2')).toBeInTheDocument()
  })

  it('shows ×N in the meta line only for counted gear', async () => {
    const singleId = anId()
    const singleStore = await seededStore([
      gearRecorded(singleId, { name: 'Axe', container: false, kind: 'single' }),
    ])
    renderGearDetail(singleStore, singleId)
    // `getByText` matches the full, exact text of the node — this alone
    // proves the meta line itself carries no `×`. It can no longer be a
    // page-wide absence check: the Whereabouts card added below always shows
    // `×1 THERE` for the home slot, single gear included.
    expect(screen.getByText('ITEM · SHARED')).toBeInTheDocument()
    cleanup()

    const countedId = anId()
    const countedStore = await seededStore([
      gearRecorded(countedId, {
        name: 'Gas canister',
        container: false,
        kind: 'counted',
        owned_count: 3,
      }),
    ])
    renderGearDetail(countedStore, countedId)
    expect(screen.getByText('ITEM · SHARED · ×3')).toBeInTheDocument()
  })

  it('MOVE opens the home picker and emits gear.rehomed', async () => {
    const placeId = anId()
    const gearId = anId()
    const store = await seededStore([
      placeRecorded(placeId, 'Attic'),
      gearRecorded(gearId, { name: 'Rope', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'MOVE' }))
    expect(screen.getByRole('dialog', { name: 'Home' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Attic' }))

    // MOVE confirms. Story 36 (Undo) is Later and opens with a design phase,
    // so the board's "selection moves and closes; UNDO per the global rule"
    // has no global rule to lean on, and a mis-tapped destination in a nested
    // picker would otherwise be unrecoverable without re-navigating.
    await user.click(screen.getByRole('button', { name: 'Move gear' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.residence?.value).toEqual({
      in: 'place',
      id: placeId,
    })
    expect(screen.queryByRole('dialog', { name: 'Home' })).toBeNull()
  })

  it('EDIT renames and emits gear.renamed', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, { name: 'Rope', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    const nameField = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(nameField)
    await user.type(nameField, 'Climbing rope')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.name?.value).toBe(
      'Climbing rope',
    )
  })

  it('EDIT changes the owned-count and emits gear.owned_count_set', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Gas canister',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    const countField = screen.getByRole('spinbutton', { name: 'Owned count' })
    await user.clear(countField)
    await user.type(countField, '5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.ownedCount?.value).toBe(5)
  })

  it('EDIT changes the kind and emits gear.kind_set', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'single',
      }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('radio', { name: 'Per-person' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.kind?.value).toBe('per_person')
    // The meta line names the containment trait, not the Kind (fix round 1):
    // per-person gear is still an item, so switching Kind must not move the
    // rendered label off ITEM.
    expect(screen.getByText('ITEM · SHARED')).toBeInTheDocument()
  })

  it('RETIRE emits gear.retired only after the confirmation', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Old tent',
        container: false,
        kind: 'single',
      }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'RETIRE' }))
    await store.getState().drained()
    expect(store.getState().state.gear[gearId]?.retired?.value).not.toBe(true)
    expect(
      screen.getByRole('alertdialog', { name: 'Retire Old tent?' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retire gear' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.retired?.value).toBe(true)
  })

  // Fix round 1: this test's original name — 'renders RETIRE as text, not as
  // a filled button' — claimed more than a class-name comparison can prove.
  // `test.css` is off for this project (`vitest.config.ts`), so jsdom never
  // applies `GearDetail.module.css` — a mutation that repaints `.retire` as
  // a filled button *without* renaming the class would pass unnoticed. What
  // this test actually verifies, honestly: RETIRE is styled with a class of
  // its own, distinct from the bordered MOVE/EDIT class. The "text, never a
  // filled button" rule itself — `.retire` in GearDetail.module.css carries
  // no border and no background, matching `HomePicker`'s own `.remove` — is
  // unverified by automated test here and rests on code review.
  it('gives RETIRE a class distinct from the bordered MOVE/EDIT buttons', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Old tent',
        container: false,
        kind: 'single',
      }),
    ])
    renderGearDetail(store, gearId)

    const move = screen.getByRole('button', { name: 'MOVE' })
    const retire = screen.getByRole('button', { name: 'RETIRE' })
    expect(retire.className).not.toBe('')
    expect(retire.className).not.toBe(move.className)
  })

  it('renders a retired piece of gear struck through, with no actions', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Old tent',
        container: false,
        kind: 'single',
      }),
      gearRetired(gearId),
    ])
    const { container } = renderGearDetail(store, gearId)

    expect(container.querySelector('s')?.textContent).toBe('Old tent')
    expect(screen.getByText('RETIRED')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'MOVE' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'EDIT' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'RETIRE' })).toBeNull()
  })

  // The meta line's first segment is the containment trait, not Kind
  // (fix round 1) — Kind's only remaining consequence here is the ×N gate
  // below. An unrecognised `kind` therefore has no token of its own to
  // render verbatim; what obligation 4 (sync-protocol.md §5.3) guarantees
  // at this line's altitude is narrower: no crash, and no false ×N from
  // treating an unrecognised string as `'counted'`.
  it('does not crash or show a false owned-count for an unrecognised kind', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Odd thing',
        container: false,
        kind: 'exotic_future_kind',
      }),
    ])

    expect(() => renderGearDetail(store, gearId)).not.toThrow()
    expect(screen.getByText('ITEM · SHARED')).toBeInTheDocument()
  })

  it('shows CONTAINER in the meta line for container gear', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Crate B',
        container: true,
        kind: 'single',
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('CONTAINER · SHARED')).toBeInTheDocument()
  })

  it('shows ITEM in the meta line for per-person gear', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('ITEM · SHARED')).toBeInTheDocument()
  })

  // The COUNT group (`docs/design/README.md` §4) exists only for counted
  // gear — invariant 6, same gate `metaLine`'s ×N segment already uses.
  it('shows the COUNT group only for counted gear', async () => {
    const singleId = anId()
    const singleStore = await seededStore([
      gearRecorded(singleId, { name: 'Axe', container: false, kind: 'single' }),
    ])
    renderGearDetail(singleStore, singleId)
    expect(screen.queryByTestId('count-group')).toBeNull()
    cleanup()

    const countedId = anId()
    const countedStore = await seededStore([
      gearRecorded(countedId, {
        name: 'Mug',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
    ])
    renderGearDetail(countedStore, countedId)
    expect(screen.getByTestId('count-group')).toBeInTheDocument()
  })

  it('shows ×N OWNED in the COUNT group', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Mug',
        container: false,
        kind: 'counted',
        owned_count: 4,
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('×4 OWNED')).toBeInTheDocument()
  })

  // Fix round 1: counted gear with no residence (reachable in practice — Add
  // Gear records gear as loose when no home is chosen) must read LOOSE in
  // the COUNT chip, the same word the Whereabouts card uses two elements
  // above it for the identical condition. `HOME` was a second word for one
  // state and not a term this vocabulary defines.
  it('shows the COUNT chip as loose when the gear has no residence', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Mug',
        container: false,
        kind: 'counted',
        owned_count: 3,
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('×3 ⌂ LOOSE')).toBeInTheDocument()
  })

  // `whereabouts` returns one chip per *slice*, not per unit — S2b has
  // exactly one `home` slice regardless of owned-count, so a five-unit piece
  // of gear renders exactly one chip. A per-unit rendering would render five.
  it('renders no per-unit rows', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Mug',
        container: false,
        kind: 'counted',
        owned_count: 5,
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getAllByTestId('count-chip')).toHaveLength(1)
  })

  // LEDGER is story 33, tagged LATER, and derived from the change log rather
  // than a second record — S2a's task was told not to build it and not to
  // leave a placeholder either, and this slice holds that line too.
  it('renders no LEDGER group', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Mug',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.queryByText('LEDGER')).toBeNull()
    expect(screen.queryByText('APPEND-ONLY')).toBeNull()
  })
})

/**
 * The settled tag chip (Components §06, `docs/design/README.md` §4): lowercase,
 * mono, 32px, bordered, the `#` **drawn and never stored**. The trailing
 * dashed `+ tag` ghost is the one edit affordance on this read screen, and
 * **✕ lives in the picker, not on the chips**.
 */
describe('gear detail tags', () => {
  async function aTaggedGear() {
    const gearId = anId()
    const otherId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Sleeping bag',
        container: false,
        kind: 'single',
      }),
      gearRecorded(otherId, { name: 'Mug', container: false, kind: 'single' }),
      gearTagApplied(gearId, aTag('winter')),
      gearTagApplied(gearId, aTag('sleep')),
      gearTagApplied(otherId, aTag('winter')),
    ])
    return { store, gearId }
  }

  it('draws each applied tag with the # it never stores', async () => {
    const { store, gearId } = await aTaggedGear()
    renderGearDetail(store, gearId)

    const tags = screen.getByTestId('tag-chips')
    expect(tags).toHaveTextContent('#sleep')
    expect(tags).toHaveTextContent('#winter')
  })

  it('puts no remove control on the chips themselves', async () => {
    const { store, gearId } = await aTaggedGear()
    renderGearDetail(store, gearId)

    // ✕ lives in the picker. A read screen does not destroy things by
    // mis-tap.
    expect(
      within(screen.getByTestId('tag-chips')).queryByRole('button', {
        name: /Remove/,
      }),
    ).toBeNull()
  })

  it('shows the lone ghost on gear with no tags', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, { name: 'Axe', container: false, kind: 'single' }),
    ])
    renderGearDetail(store, gearId)

    const tags = screen.getByTestId('tag-chips')
    expect(
      within(tags).getByRole('button', { name: '+ tag' }),
    ).toBeInTheDocument()
    expect(tags).not.toHaveTextContent('#')
  })

  it('applies a tag from the picker, and shows it straight away', async () => {
    const { store, gearId } = await aTaggedGear()
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: '+ tag' }))
    await user.type(screen.getByLabelText('Tag'), 'alpine')
    await user.click(screen.getByTestId('create-tag'))

    expect(screen.getByTestId('tag-chips')).toHaveTextContent('#alpine')
  })

  // The near-duplicate defence, on the real vocabulary: another piece of gear
  // already carries `winter`, so the picker offers it with its count rather
  // than letting a second spelling be typed past it.
  it('offers the household vocabulary with counts', async () => {
    const { store, gearId } = await aTaggedGear()
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: '+ tag' }))
    expect(screen.getByTestId('in-the-depot')).toHaveTextContent('#winter')
    expect(screen.getByTestId('in-the-depot')).toHaveTextContent('2')
  })

  it('removes a tag from the picker without confirming', async () => {
    const { store, gearId } = await aTaggedGear()
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: '+ tag' }))
    await user.click(screen.getByRole('button', { name: 'Remove #winter' }))

    // One op, instantly reversible by re-applying — so nothing to confirm.
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByTestId('tag-chips')).not.toHaveTextContent('#winter')
  })

  it('records the tag as an op, so it survives a remount', async () => {
    const { store, gearId } = await aTaggedGear()
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: '+ tag' }))
    await user.type(screen.getByLabelText('Tag'), 'alpine')
    await user.click(screen.getByTestId('create-tag'))

    cleanup()
    renderGearDetail(store, gearId)
    expect(screen.getByTestId('tag-chips')).toHaveTextContent('#alpine')
  })
})
