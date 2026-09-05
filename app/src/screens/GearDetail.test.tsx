import {
  gearRecorded,
  gearRetired,
  gearTagApplied,
  normalizeTag,
  personRecorded,
  placeRecorded,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripParticipantAdded,
  tripPhaseMoved,
  tripPieceRemoved,
  type OpSpec,
  type TagString,
} from '@foerier/shared'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../household/opLog'
import {
  createHouseholdStore,
  HouseholdProvider,
  type HouseholdStoreState,
} from '../household/store'
import { DESKTOP, SPLIT } from '../shell/useMediaQuery'
import { setViewport } from '../testSetup'
import { anAuthor, anId, noopEngine } from '../testUtils'
import { GearDetail } from './GearDetail'
import styles from './GearDetail.module.css'

/** The only way a `TagString` is made (`shared/src/tags.ts`). */
function aTag(raw: string): TagString {
  const tag = normalizeTag(raw)
  if (tag === null) throw new Error(`not a tag: ${raw}`)
  return tag
}

/**
 * Every test seeds a **real** store — `inMemoryOpLog` plus the real reducer
 * behind `createHouseholdStore` — by emitting real ops through `emit`, exactly as
 * `Depot.test.tsx` and `AddGear.test.tsx` do. Never a hand-shaped
 * `HouseholdState`.
 */

async function seededStore(
  specs: readonly OpSpec[] = [],
  log: OpLog = inMemoryOpLog(),
): Promise<StoreApi<HouseholdStoreState>> {
  const store = createHouseholdStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return store
}

function renderGearDetail(
  store: StoreApi<HouseholdStoreState>,
  gearId: string,
) {
  const location = memoryLocation({ path: `/gear/${gearId}`, record: true })
  const result = render(
    <Router hook={location.hook}>
      <Switch>
        <Route path="/gear/:id">
          <HouseholdProvider value={store}>
            <GearDetail />
          </HouseholdProvider>
        </Route>
        <Route path="/">
          <p>Depot list</p>
        </Route>
      </Switch>
    </Router>,
  )
  return { location, container: result.container }
}

/**
 * **The band above the title** — `useScreenHeader`'s rule, shared with `Trip`,
 * `NewTrip` and `Account`, and read here through the one screen that answers
 * `splitPane: true`.
 *
 * At Split this screen is the detail half of `DepotView`'s two panes, with the
 * Depot list in the other one: `‹ DEPOT` would point at something already on
 * the page, so it goes — and `Depot split` (900) contains no `‹` at all. The
 * sync line runs the other way. `AppShell` draws words in the phone header and
 * in the Desktop sidebar but only a **bare dot** on the Split rail, so this
 * band is where the state is legible at exactly that width, which is what the
 * same frame draws: `● SYNCED` in the detail pane.
 *
 * These tests render the screen alone, so they prove one side of that. The
 * count over shell **and** screen composed is `shell/screenBand.test.tsx`.
 */
describe('Gear detail — the band above the title', () => {
  it('draws the back link and no sync line below Split', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, { name: 'Tent', container: false, kind: 'single' }),
    ])
    renderGearDetail(store, gearId)

    // `AppShell`'s own header band states `SYNCED` in words at this width; a
    // second one here is the same fact printed twice on the primary device.
    expect(screen.getByRole('link', { name: '‹ DEPOT' })).toBeVisible()
    expect(screen.queryByText('SYNCED')).toBeNull()
  })

  it('hands the back link to the list pane at Split and draws the sync line', async () => {
    setViewport(SPLIT)
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, { name: 'Tent', container: false, kind: 'single' }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.queryByRole('link', { name: '‹ DEPOT' })).toBeNull()
    expect(screen.getByText('SYNCED')).toBeVisible()
  })

  it('draws neither at Desktop, where the sidebar is the navigation', async () => {
    setViewport(SPLIT, DESKTOP)
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, { name: 'Tent', container: false, kind: 'single' }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.queryByRole('link', { name: '‹ DEPOT' })).toBeNull()
    expect(screen.queryByText('SYNCED')).toBeNull()
  })
})

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

  it('reads ×1 on every surface for a Counted gear nobody counted', async () => {
    // `ownedCountOf` already says an absent register on Counted gear reads
    // `1`; before this, the meta line drew nothing, the COUNT header drew
    // `×0 OWNED` and the Depot's QTY column drew nothing — three answers to
    // one question, two of them on this screen.
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Gas canister',
        container: false,
        kind: 'counted',
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('ITEM · SHARED · ×1')).toBeInTheDocument()
    expect(screen.getByText('×1 OWNED')).toBeInTheDocument()
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

  /**
   * A needless write is never free: a `gear.rehomed` naming the home the gear
   * already has still moves the LWW stamp, and can silently beat a genuine
   * move queued on a Device that was offline. `HomePicker` reports the `● NOW`
   * row like any other — suppressing it is the caller's job, exactly as
   * `Packing.tsx` does for `PackPicker` through `sameTripResidence`.
   */
  it('MOVE to the current home emits no gear.rehomed', async () => {
    const placeId = anId()
    const gearId = anId()
    const log = inMemoryOpLog()
    const store = await seededStore(
      [
        placeRecorded(placeId, 'Attic'),
        gearRecorded(gearId, {
          name: 'Rope',
          container: false,
          kind: 'single',
          residence: { in: 'place', id: placeId },
        }),
      ],
      log,
    )
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'MOVE' }))
    const attic = screen.getByRole('button', { name: /Attic/ })
    expect(attic).toHaveTextContent('● NOW')
    await user.click(attic)
    await user.click(screen.getByRole('button', { name: 'Move gear' }))
    await store.getState().drained()

    const moves = (await log.all()).filter(
      (record) => record.op.type === 'gear.rehomed',
    )
    expect(moves).toEqual([])
    // The picker still closes: nothing to write is not a reason to stay.
    expect(screen.queryByRole('dialog', { name: 'Home' })).toBeNull()
  })

  /**
   * An absent `residence` register **is** loose — `looseGear` lists such gear
   * and the COUNT chip reads `⌂ LOOSE` for it — so the picker must say so
   * too. Handing it no `current` drew no `● NOW` at all, which left the
   * one row that *is* the current home indistinguishable from the rest and
   * gave the caller nothing to suppress a redundant move against.
   */
  it('MOVE marks Loose as the current home when the gear has no residence register', async () => {
    const gearId = anId()
    const store = await seededStore([
      placeRecorded(anId(), 'Attic'),
      gearRecorded(gearId, { name: 'Rope', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'MOVE' }))

    expect(screen.getByRole('button', { name: /Loose/ })).toHaveTextContent(
      '● NOW',
    )
    expect(screen.getByRole('button', { name: /Attic/ })).not.toHaveTextContent(
      '● NOW',
    )
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

  it('reads PERSONAL plus the initial in the meta line', async () => {
    const gearId = anId()
    const store = await seededStore([
      personRecorded('els', 'Els'),
      gearRecorded(gearId, {
        name: 'Down jacket',
        container: false,
        kind: 'single',
        owner: { type: 'person', personId: 'els' },
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('ITEM · PERSONAL E')).toBeInTheDocument()
  })

  it('EDIT sets a personal owner and emits gear.ownership_set', async () => {
    const gearId = anId()
    const store = await seededStore([
      personRecorded('els', 'Els'),
      gearRecorded(gearId, {
        name: 'Down jacket',
        container: false,
        kind: 'single',
      }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'Owner' }))
    await user.click(screen.getByRole('button', { name: /Els/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.owner?.value).toEqual({
      type: 'person',
      personId: 'els',
    })
    // And the meta line agrees with the picker, through the one selector.
    expect(screen.getByText('ITEM · PERSONAL E')).toBeInTheDocument()
  })

  it('EDIT returns gear to the shared pool', async () => {
    const gearId = anId()
    const store = await seededStore([
      personRecorded('els', 'Els'),
      gearRecorded(gearId, {
        name: 'Down jacket',
        container: false,
        kind: 'single',
        owner: { type: 'person', personId: 'els' },
      }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: 'Owner' }))
    await user.click(screen.getByRole('button', { name: /Shared/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    // A write, not a clear: the register holds `shared` explicitly, which is
    // what lets a later personal write lose to it on the clock alone.
    expect(store.getState().state.gear[gearId]?.owner?.value).toEqual({
      type: 'shared',
    })
  })

  it('EDIT writes no ownership op when the owner was not touched', async () => {
    // Gear recorded before S4 carries no `owner` register. The draft is
    // seeded through `ownerOf`, so the `Shared` the sheet draws compares
    // equal to that absence and a no-op Save stays a no-op — a needless
    // write here would move the gear's `recordedAt` and reorder NEWEST FIRST.
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, { name: 'Tent', container: false, kind: 'single' }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    expect(screen.getByRole('button', { name: 'Owner' })).toHaveTextContent(
      'Shared',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(Object.hasOwn(store.getState().state.gear[gearId]!, 'owner')).toBe(
      false,
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
    const countField = screen.getByRole('textbox', { name: 'Owned count' })
    await user.clear(countField)
    await user.type(countField, '5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.ownedCount?.value).toBe(5)
  })

  it('writes nothing when Save is untouched on a Gear with no registers', async () => {
    // The needless-write rule, at the two registers whose drafts used to be
    // seeded raw. A `gear.recorded` with no `kind` field seeded the segmented
    // control to `Single` and Saved a `gear.kind_set`; a Counted Gear with no
    // `owned_count` seeded the well to `1` and Saved a `gear.owned_count_set`
    // that changed no number any surface draws. A needless write is never
    // cosmetic here — it moves the stamp LWW compares, so it can beat and
    // silently discard a genuine concurrent write from a Device that was
    // offline. Same discipline S4 gave the owner draft through `ownerOf`.
    const bareId = anId()
    const countedId = anId()
    const log = inMemoryOpLog()
    const store = await seededStore(
      [
        {
          aggregate: 'gear',
          aggregate_id: bareId,
          type: 'gear.recorded',
          payload: { name: 'Mystery', container: false },
        },
        gearRecorded(countedId, {
          name: 'Gas canister',
          container: false,
          kind: 'counted',
        }),
      ],
      log,
    )
    const before = (await log.all()).length
    const user = userEvent.setup()

    for (const id of [bareId, countedId]) {
      renderGearDetail(store, id)
      await user.click(screen.getByRole('button', { name: 'EDIT' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await store.getState().drained()
      cleanup()
    }

    expect((await log.all()).length).toBe(before)
    expect(Object.hasOwn(store.getState().state.gear[bareId]!, 'kind')).toBe(
      false,
    )
    expect(
      Object.hasOwn(store.getState().state.gear[countedId]!, 'ownedCount'),
    ).toBe(false)
  })

  it('opens the count well empty on uncounted gear, and records a typed 1', async () => {
    // The other half of the untouched-Save rule. Seeding the well with
    // `ownedCountOf`'s defaulted `1` would make Save discard a typed `1` as
    // unchanged — `owned_count = 1` would be the one value this sheet could
    // never record, while the well displayed it. The well opens **empty**
    // instead, which is `design/README.md` §3b's rule for Add gear's own.
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Gas canister',
        container: false,
        kind: 'counted',
      }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    const countField = screen.getByRole('textbox', { name: 'Owned count' })
    expect(countField).toHaveValue('')

    await user.type(countField, '1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(store.getState().state.gear[gearId]?.ownedCount?.value).toBe(1)
  })

  it('leaves the Kind unchosen for a Gear carrying no kind register', async () => {
    // `kindOf` reads an absent register as *no Kind*, never Single, so the
    // segmented control has nothing to check. Drawing `Single` selected would
    // be the sheet asserting a Kind nobody stated — and then Saving it.
    const gearId = anId()
    const store = await seededStore([
      {
        aggregate: 'gear',
        aggregate_id: gearId,
        type: 'gear.recorded',
        payload: { name: 'Mystery', container: false },
      },
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    for (const label of ['Single', 'Per-person', 'Counted']) {
      expect(screen.getByRole('radio', { name: label })).not.toBeChecked()
    }
  })

  it('writes no owned_count when the well is emptied before Save', async () => {
    // The exact scenario `Stepper`'s `null`-on-blank exists for: gear with no
    // owned_count register at all, switched to Counted mid-edit (which seeds
    // the well from a fallback, not a fact the depot holds), then cleared.
    // "A silent ×1 is a wrong ledger line" whether Add gear writes it or gear
    // detail does — clearing the well must leave the register untouched.
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Tent peg',
        container: false,
        kind: 'single',
      }),
    ])
    const user = userEvent.setup()
    renderGearDetail(store, gearId)

    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('radio', { name: 'Counted' }))
    await user.clear(screen.getByRole('textbox', { name: 'Owned count' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await store.getState().drained()

    expect(
      Object.hasOwn(store.getState().state.gear[gearId]!, 'ownedCount'),
    ).toBe(false)
    // The Kind change itself is real and still lands.
    expect(store.getState().state.gear[gearId]?.kind?.value).toBe('counted')
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
 * S9b: the whereabouts card's trip rows, the COUNT group's trip chips, and
 * the new PIECES group (`docs/design/README.md` §4, §5f D1/D2/D6/D7/D8).
 */
describe('Gear detail — whereabouts reaches the screen', () => {
  it('lists home chips first, then one COUNT chip per active claiming Trip', async () => {
    const tripId = anId()
    const gearId = anId()
    const store = await seededStore([
      tripCreated(tripId, 'Alps 2026'),
      tripPhaseMoved(tripId, 'pack_out'),
      gearRecorded(gearId, {
        name: 'Gas canister',
        container: false,
        kind: 'counted',
        owned_count: 3,
      }),
      tripEntryAdded(tripId, 'e-canister', { from: 'depot', gearId }),
      tripEntryBringCountSet(tripId, 'e-canister', 1),
    ])
    renderGearDetail(store, gearId)

    const chips = screen.getAllByTestId('count-chip')
    expect(chips.map((chip) => chip.textContent)).toEqual([
      '×2 ⌂ LOOSE',
      '×1 ▸ Alps 2026',
    ])
  })

  it('shows the PIECES group for per-person gear with a Piece on an active Trip, in People-screen order', async () => {
    const tripId = anId()
    const gearId = anId()
    const markId = anId()
    const elsId = anId()
    const store = await seededStore([
      personRecorded(markId, 'Mark'),
      personRecorded(elsId, 'Els'),
      tripCreated(tripId, 'Alps 2026'),
      tripPhaseMoved(tripId, 'pack_out'),
      tripParticipantAdded(tripId, markId),
      tripParticipantAdded(tripId, elsId),
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(tripId, 'e-headlamp', { from: 'depot', gearId }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('PIECES')).toBeInTheDocument()
    expect(screen.getByText('1 PER PERSON')).toBeInTheDocument()
    expect(
      screen.getByText(
        'PER-PERSON GEAR HAS NO OWNED-COUNT — ITS SUPPLY IS ONE PER PERSON.',
      ),
    ).toBeInTheDocument()

    // People-screen order is alphabetic by label — Els before Mark.
    const chips = screen.getAllByTestId('piece-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveTextContent('E ▸ Alps 2026')
    expect(chips[1]).toHaveTextContent('M ▸ Alps 2026')
  })

  it('omits the PIECES group for per-person gear with no Piece on any active Trip', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.queryByTestId('pieces-group')).toBeNull()
  })

  // `whereaboutsByPerson`'s map is keyed by a claiming Trip's Participants
  // regardless of whether their own Piece is included (B5: a removed Piece
  // still reads home, rather than vanishing) — so an Entry whose every Piece
  // is tombstoned still populates the map, every answer reading home. That
  // is *not* "a Piece on an active Trip": nothing is actually out, so every
  // chip would draw the identical home path — exactly the identical-circles
  // fault §4/D6/B3 exist to prevent. The group must stay hidden.
  it("omits PIECES when every Participant's Piece on the claiming Trip has been removed", async () => {
    const tripId = anId()
    const gearId = anId()
    const markId = anId()
    const elsId = anId()
    const store = await seededStore([
      personRecorded(markId, 'Mark'),
      personRecorded(elsId, 'Els'),
      tripCreated(tripId, 'Alps 2026'),
      tripPhaseMoved(tripId, 'pack_out'),
      tripParticipantAdded(tripId, markId),
      tripParticipantAdded(tripId, elsId),
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(tripId, 'e-headlamp', { from: 'depot', gearId }),
      tripPieceRemoved(tripId, 'e-headlamp', markId),
      tripPieceRemoved(tripId, 'e-headlamp', elsId),
    ])
    renderGearDetail(store, gearId)

    expect(screen.queryByTestId('pieces-group')).toBeNull()
  })

  // The hazard `whereaboutsByPerson`'s own docstring names: its keys are a
  // claiming Trip's Participants, whatever Kind of Gear that Trip claims —
  // so a Counted gear on an active Trip with Participants populates the
  // exact same map, every answer reading home. The PIECES group must not
  // render for it regardless, which is what the explicit Kind gate in
  // `GearDetail` (not merely "the map is non-empty") is for.
  it('never shows PIECES for Counted gear, even with Participants on its claiming Trip', async () => {
    const tripId = anId()
    const gearId = anId()
    const personId = anId()
    const store = await seededStore([
      personRecorded(personId, 'Mark'),
      tripCreated(tripId, 'Alps 2026'),
      tripPhaseMoved(tripId, 'pack_out'),
      tripParticipantAdded(tripId, personId),
      gearRecorded(gearId, {
        name: 'Gas canister',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
      tripEntryAdded(tripId, 'e-canister', { from: 'depot', gearId }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.queryByTestId('pieces-group')).toBeNull()
  })

  it('shows neither COUNT nor PIECES on a Single', async () => {
    const gearId = anId()
    const store = await seededStore([
      gearRecorded(gearId, {
        name: 'Ice axe',
        container: false,
        kind: 'single',
      }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.queryByTestId('count-group')).toBeNull()
    expect(screen.queryByTestId('pieces-group')).toBeNull()
  })

  it('reads a contested Participant\'s chip as "M ▲ 2 TRIPS", with no link (D7)', async () => {
    const alpsId = anId()
    const vosgesId = anId()
    const gearId = anId()
    const markId = anId()
    const store = await seededStore([
      personRecorded(markId, 'Mark'),
      tripCreated(alpsId, 'Alps 2026'),
      tripPhaseMoved(alpsId, 'pack_out'),
      tripParticipantAdded(alpsId, markId),
      tripCreated(vosgesId, 'Vosges'),
      tripPhaseMoved(vosgesId, 'pack_out'),
      tripParticipantAdded(vosgesId, markId),
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(alpsId, 'e-alps', { from: 'depot', gearId }),
      tripEntryAdded(vosgesId, 'e-vosges', { from: 'depot', gearId }),
    ])
    renderGearDetail(store, gearId)

    const chip = screen.getByTestId('piece-chip')
    expect(chip).toHaveTextContent('M ▲ 2 TRIPS')
    expect(within(chip).queryByRole('link')).toBeNull()
    expect(within(chip).queryByRole('button')).toBeNull()
  })

  // Blocker 2 from the final whole-branch review: the contested chip was
  // drawing in ordinary ink while Find's equivalent row already drew this
  // fact in the app-wide attention class — two surfaces, one fact, two
  // tones. Two-sided: the contested chip carries the modifier and the
  // circle's `attention` tone, and an uncontested Participant's chip in the
  // very same PIECES group carries neither.
  it('draws a contested PIECES chip in the attention class, and an uncontested one in neither', async () => {
    const alpsId = anId()
    const vosgesId = anId()
    const gearId = anId()
    const markId = anId()
    const elsId = anId()
    const store = await seededStore([
      personRecorded(markId, 'Mark'),
      personRecorded(elsId, 'Els'),
      tripCreated(alpsId, 'Alps 2026'),
      tripPhaseMoved(alpsId, 'pack_out'),
      tripParticipantAdded(alpsId, markId),
      tripParticipantAdded(alpsId, elsId),
      tripCreated(vosgesId, 'Vosges'),
      tripPhaseMoved(vosgesId, 'pack_out'),
      tripParticipantAdded(vosgesId, markId),
      gearRecorded(gearId, {
        name: 'Headlamp',
        container: false,
        kind: 'per_person',
      }),
      tripEntryAdded(alpsId, 'e-alps', { from: 'depot', gearId }),
      tripEntryAdded(vosgesId, 'e-vosges', { from: 'depot', gearId }),
    ])
    renderGearDetail(store, gearId)

    // People-screen order: Els before Mark.
    const chips = screen.getAllByTestId('piece-chip')
    expect(chips).toHaveLength(2)
    const [elsChip, markChip] = chips as [HTMLElement, HTMLElement]

    expect(elsChip).toHaveTextContent('E ▸ Alps 2026')
    expect(elsChip).not.toHaveClass(styles['attention']!)
    expect(within(elsChip).getByTestId('person-circle')).toHaveAttribute(
      'data-tone',
      'control',
    )

    expect(markChip).toHaveTextContent('M ▲ 2 TRIPS')
    expect(markChip).toHaveClass(styles['attention']!)
    expect(within(markChip).getByTestId('person-circle')).toHaveAttribute(
      'data-tone',
      'attention',
    )
  })

  it('turns the footer ▲ for over-claimed Counted gear, with the two Counted-only numbers (D8, §6.1)', async () => {
    const alpsId = anId()
    const vosgesId = anId()
    const gearId = anId()
    const store = await seededStore([
      tripCreated(alpsId, 'Alps 2026'),
      tripPhaseMoved(alpsId, 'pack_out'),
      tripCreated(vosgesId, 'Vosges'),
      tripPhaseMoved(vosgesId, 'pack_out'),
      gearRecorded(gearId, {
        name: 'Gas canister',
        container: false,
        kind: 'counted',
        owned_count: 2,
      }),
      tripEntryAdded(alpsId, 'e-alps', { from: 'depot', gearId }),
      tripEntryBringCountSet(alpsId, 'e-alps', 2),
      tripEntryAdded(vosgesId, 'e-vosges', { from: 'depot', gearId }),
      tripEntryBringCountSet(vosgesId, 'e-vosges', 2),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('▲ CLAIMED ×4 · OWNED ×2')).toBeInTheDocument()
    const resolve = screen.getByRole('link', { name: 'Resolve on Alps 2026' })
    expect(resolve).toHaveTextContent('RESOLVE')
    expect(resolve).toHaveAttribute('href', `/trips/${alpsId}`)
  })

  it('falls back to "CLAIMED BY N TRIPS" for an over-claimed Single (every Kind but Counted, §6.1)', async () => {
    const alpsId = anId()
    const vosgesId = anId()
    const gearId = anId()
    const store = await seededStore([
      tripCreated(alpsId, 'Alps 2026'),
      tripPhaseMoved(alpsId, 'pack_out'),
      tripCreated(vosgesId, 'Vosges'),
      tripPhaseMoved(vosgesId, 'pack_out'),
      gearRecorded(gearId, {
        name: 'Ice axe',
        container: false,
        kind: 'single',
      }),
      tripEntryAdded(alpsId, 'e-alps', { from: 'depot', gearId }),
      tripEntryAdded(vosgesId, 'e-vosges', { from: 'depot', gearId }),
    ])
    renderGearDetail(store, gearId)

    expect(screen.getByText('▲ CLAIMED BY 2 TRIPS')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Resolve on Alps 2026' }),
    ).toHaveAttribute('href', `/trips/${alpsId}`)
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
