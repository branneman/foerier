import {
  gearRecorded,
  personRecorded,
  placeRecorded,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripOutcomeSet,
  tripParticipantAdded,
  type OpSpec,
} from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog, type OpLog } from '../household/opLog'
import {
  createHouseholdStore,
  HouseholdProvider,
  useHousehold,
  type HouseholdStoreState,
} from '../household/store'
import { anAuthor, noopEngine } from '../testUtils'
import { OutcomeSheet } from './OutcomeSheet'

/**
 * **F5/F9's outcome sheet** (`docs/design/README.md` §7, spec
 * `docs/specs/2026-09-05-unpack-resolve-and-close.md` §4.4).
 *
 * `PieceStatusSheet.test.tsx`'s own harness, transplanted: a real store and
 * the real reducer, seeded by emitting real ops, an `authored()` handle that
 * subtracts the seed. `Harness` — not a bare `render(<OutcomeSheet
 * trip={...} entry={...} />)` — is what makes a second tap's assertions mean
 * anything: `trip`/`entry` are props here exactly as they are on
 * `Unpack.tsx`'s real call site, so something has to re-read the store and
 * hand down fresh ones after an op lands, the way the real caller does.
 */

const TRIP = 'tttttttt-0000-7000-8000-000000000012'

const BAK3 = 'pppppppp-0000-7000-8000-000000000012'

const GAS = 'gggggggg-0000-7000-8000-000000000012'
const E_GAS = 'eeeeeeee-0000-7000-8000-000000000012'

const TENT = 'gggggggg-0000-7000-8000-000000000013'
const E_TENT = 'eeeeeeee-0000-7000-8000-000000000013'

const CRATE = 'gggggggg-0000-7000-8000-000000000014'
const E_CRATE = 'eeeeeeee-0000-7000-8000-000000000014'
const INNER = 'gggggggg-0000-7000-8000-000000000015'
const E_INNER = 'eeeeeeee-0000-7000-8000-000000000015'

const HEADLAMP = 'gggggggg-0000-7000-8000-000000000016'
const E_HEADLAMP = 'nnnnnnnn-0000-7000-8000-000000000016'

interface Seeded {
  store: StoreApi<HouseholdStoreState>
  authored: () => Promise<
    readonly { type: string; payload: Record<string, unknown> }[]
  >
}

/**
 * A Counted Gas canister (Bring-count 4, Owned ×6, home `Bak 3`); a Single
 * Tent; a container Crate B with one Entry (`Inner`) packed inside it on
 * this Trip; and a per-person Headlamp with one Participant — every shape
 * the sheet's own gates read.
 */
async function seeded(...extra: readonly OpSpec[]): Promise<Seeded> {
  const log: OpLog = inMemoryOpLog()
  const store = createHouseholdStore({
    log,
    engine: noopEngine,
    author: anAuthor(),
  })
  const specs: readonly OpSpec[] = [
    placeRecorded(BAK3, 'Bak 3'),
    tripCreated(TRIP, 'Alps 2026'),

    gearRecorded(GAS, {
      name: 'Gas canister 450',
      container: false,
      kind: 'counted',
      owned_count: 6,
      residence: { in: 'place', id: BAK3 },
    }),
    tripEntryAdded(TRIP, E_GAS, { from: 'depot', gearId: GAS }),
    tripEntryBringCountSet(TRIP, E_GAS, 4),

    gearRecorded(TENT, {
      name: 'Tent, 3p',
      container: false,
      kind: 'single',
    }),
    tripEntryAdded(TRIP, E_TENT, { from: 'depot', gearId: TENT }),

    gearRecorded(CRATE, { name: 'Crate B', container: true, kind: 'single' }),
    tripEntryAdded(TRIP, E_CRATE, { from: 'depot', gearId: CRATE }),
    gearRecorded(INNER, {
      name: 'Tarp',
      container: false,
      kind: 'single',
    }),
    tripEntryAdded(TRIP, E_INNER, { from: 'depot', gearId: INNER }),
    tripEntryMoved(TRIP, E_INNER, { in: 'container', entryId: E_CRATE }),

    personRecorded('mark', 'Mark'),
    tripParticipantAdded(TRIP, 'mark'),
    gearRecorded(HEADLAMP, {
      name: 'Headlamp',
      container: false,
      kind: 'per_person',
    }),
    tripEntryAdded(TRIP, E_HEADLAMP, { from: 'depot', gearId: HEADLAMP }),

    ...extra,
  ]
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  const seedCount = (await log.all()).length

  return {
    store,
    authored: async () => {
      await store.getState().drained()
      return (await log.all())
        .slice(seedCount)
        .map((entry) => ({ type: entry.op.type, payload: entry.op.payload }))
    },
  }
}

/** Reads `trip`/`entry` fresh off the live store on every render — exactly
 * what `Unpack.tsx` does for its own `OutcomeSheet` mount — so a second tap
 * in one test sees the effect of the first. */
function Harness({
  entryId,
  onClose = () => {},
}: {
  entryId: string
  onClose?: () => void
}) {
  const state = useHousehold((depot) => depot.state)
  const trip = state.trips[TRIP]
  const entry = trip?.entries?.[entryId]
  if (trip === undefined || entry === undefined) return null
  return <OutcomeSheet trip={trip} entry={entry} onClose={onClose} />
}

function renderSheet(
  seed: Seeded,
  entryId: string,
  onClose: () => void = () => {},
): void {
  render(
    <HouseholdProvider value={seed.store}>
      <Harness entryId={entryId} onClose={onClose} />
    </HouseholdProvider>,
  )
}

function chipNamed(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

describe('the outcome sheet', () => {
  it('names the sheet by the gear and describes it with the outcome fact', async () => {
    const seed = await seeded()
    renderSheet(seed, E_GAS)

    const sheet = screen.getByRole('dialog', { name: 'Gas canister 450' })
    const fact = screen.getByText('OUTCOME · ×4 BROUGHT · → Bak 3')
    expect(sheet).toHaveAttribute('aria-describedby', fact.id)
  })

  it('draws four chips in BACK · OPEN · CONSUMED · LOST order, the current one raised', async () => {
    const seed = await seeded(tripOutcomeSet(TRIP, E_GAS, 'back'))
    renderSheet(seed, E_GAS)

    const chips = screen.getAllByTestId('outcome-chip')
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual([
      '● BACK',
      '○ OPEN',
      'CONSUMED',
      '▲ LOST',
    ])
    expect(chips[0]).toHaveAttribute('data-current', 'true')
    for (const chip of chips.slice(1)) {
      expect(chip).not.toHaveAttribute('data-current')
    }
  })

  it('writes one op on a tap and keeps the sheet open', async () => {
    const user = userEvent.setup()
    const seed = await seeded()
    renderSheet(seed, E_GAS)

    await user.click(chipNamed('● BACK'))

    expect(await seed.authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: { entry_id: E_GAS, outcome: 'back' },
      },
    ])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('writes nothing tapping the outcome already current', async () => {
    const user = userEvent.setup()
    const seed = await seeded(tripOutcomeSet(TRIP, E_GAS, 'back'))
    renderSheet(seed, E_GAS)

    await user.click(chipNamed('● BACK'))

    expect(await seed.authored()).toEqual([])
  })

  it('writes nothing tapping OPEN when the Entry is already open', async () => {
    const user = userEvent.setup()
    const seed = await seeded()
    renderSheet(seed, E_GAS)

    await user.click(chipNamed('○ OPEN'))

    expect(await seed.authored()).toEqual([])
  })

  it('reveals the stepper only while CONSUMED is the outcome, opening at the Bring-count', async () => {
    const user = userEvent.setup()
    const seed = await seeded()
    renderSheet(seed, E_GAS)

    expect(
      screen.queryByRole('textbox', { name: /consumed count/i }),
    ).not.toBeInTheDocument()

    await user.click(chipNamed('CONSUMED'))

    const well = await screen.findByRole('textbox', {
      name: /consumed count/i,
    })
    expect(well).toHaveValue('4')
    expect(screen.getByText('×0 BACK')).toBeInTheDocument()
  })

  it('hides the stepper again once a different outcome is tapped', async () => {
    const user = userEvent.setup()
    const seed = await seeded(tripOutcomeSet(TRIP, E_GAS, 'consumed'))
    renderSheet(seed, E_GAS)

    expect(
      screen.getByRole('textbox', { name: /consumed count/i }),
    ).toBeInTheDocument()

    await user.click(chipNamed('▲ LOST'))

    expect(
      screen.queryByRole('textbox', { name: /consumed count/i }),
    ).not.toBeInTheDocument()
  })

  it('floors the stepper at ×1 and ceilings it at the Bring-count', async () => {
    const user = userEvent.setup()
    const seed = await seeded(tripOutcomeSet(TRIP, E_GAS, 'consumed'))
    renderSheet(seed, E_GAS)

    // The Bring-count is 4 and the register is still absent — a tap past it
    // clamps to the value already held, which is the needless-write guard
    // and authors nothing.
    await user.click(
      screen.getByRole('button', { name: /increase consumed count/i }),
    )
    expect(await seed.authored()).toEqual([])

    for (let i = 0; i < 3; i++) {
      await user.click(
        screen.getByRole('button', { name: /decrease consumed count/i }),
      )
    }

    expect(await seed.authored()).toEqual([
      {
        type: 'trip.consumed_count_set',
        payload: { entry_id: E_GAS, count: 3 },
      },
      {
        type: 'trip.consumed_count_set',
        payload: { entry_id: E_GAS, count: 2 },
      },
      {
        type: 'trip.consumed_count_set',
        payload: { entry_id: E_GAS, count: 1 },
      },
    ])
    expect(
      screen.getByRole('button', { name: /decrease consumed count/i }),
    ).toBeDisabled()
  })

  it('draws the derived split and states the consequence once', async () => {
    const seed = await seeded(tripOutcomeSet(TRIP, E_GAS, 'consumed'))
    const user = userEvent.setup()
    renderSheet(seed, E_GAS)

    await user.click(
      screen.getByRole('button', { name: /decrease consumed count/i }),
    )
    await user.click(
      screen.getByRole('button', { name: /decrease consumed count/i }),
    )

    expect(screen.getByText('×2 BACK')).toBeInTheDocument()
    expect(
      screen.getByText('THE REST CAME BACK. OWNED ×6 → ×4 AT CLOSE.'),
    ).toBeInTheDocument()
  })

  it('commits a typed value once, on blur, not per keystroke (ui/Stepper K)', async () => {
    const user = userEvent.setup()
    const seed = await seeded(tripOutcomeSet(TRIP, E_GAS, 'consumed'))
    renderSheet(seed, E_GAS)

    const well = screen.getByRole('textbox', { name: /consumed count/i })
    await user.clear(well)
    await user.type(well, '2')
    expect(await seed.authored()).toEqual([])

    await user.tab()

    expect(await seed.authored()).toEqual([
      {
        type: 'trip.consumed_count_set',
        payload: { entry_id: E_GAS, count: 2 },
      },
    ])
  })

  it('grows no stepper for a Single Entry, even when CONSUMED is tapped', async () => {
    const user = userEvent.setup()
    const seed = await seeded()
    renderSheet(seed, E_TENT)

    await user.click(chipNamed('CONSUMED'))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(await seed.authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: { entry_id: E_TENT, outcome: 'consumed' },
      },
    ])
  })

  it('grows no stepper for a per-person Entry, even when CONSUMED is tapped', async () => {
    const user = userEvent.setup()
    const seed = await seeded()
    renderSheet(seed, E_HEADLAMP)

    await user.click(chipNamed('CONSUMED'))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it("adds the container's fact and authors no op on its contents", async () => {
    const user = userEvent.setup()
    const seed = await seeded()
    renderSheet(seed, E_CRATE)

    expect(
      screen.getByText(
        'OUTCOME · CONTAINER · 1 INSIDE · ITS CONTENTS KEEP THEIR OWN OUTCOMES.',
      ),
    ).toBeInTheDocument()

    await user.click(chipNamed('● BACK'))

    // Exactly one op — nothing about `Inner`, sitting inside the crate.
    expect(await seed.authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: { entry_id: E_CRATE, outcome: 'back' },
      },
    ])
  })

  it('grows no stepper for a container, even when CONSUMED is tapped', async () => {
    const user = userEvent.setup()
    const seed = await seeded()
    renderSheet(seed, E_CRATE)

    await user.click(chipNamed('CONSUMED'))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('states the footer on every variant', async () => {
    const seed = await seeded()
    renderSheet(seed, E_GAS)

    expect(
      screen.getByText(
        'ONE OP PER TAP. LOST KEEPS THE HOME SLOT AND STAYS SEARCHABLE.',
      ),
    ).toBeInTheDocument()
  })
})
