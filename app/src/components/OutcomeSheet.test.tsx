import {
  containmentView,
  gearOwnedCountSet,
  gearRecorded,
  personRecorded,
  placeRecorded,
  tripConsumedCountSet,
  tripCreated,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripOutcomeSet,
  tripParticipantAdded,
  tripPhaseMoved,
  type OpSpec,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
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

const MAP = 'gggggggg-0000-7000-8000-000000000017'
const E_MAP = 'eeeeeeee-0000-7000-8000-000000000017'

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
 * Tent with **no** residence at all (the fully-Loose case); a second Single,
 * Map case, with a home path; a container Crate B with one Entry (`Inner`)
 * packed inside it on this Trip; and a per-person Headlamp with one
 * Participant — every shape the sheet's own gates read.
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

    gearRecorded(MAP, {
      name: 'Map case',
      container: false,
      kind: 'single',
      residence: { in: 'place', id: BAK3 },
    }),
    tripEntryAdded(TRIP, E_MAP, { from: 'depot', gearId: MAP }),

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
      residence: { in: 'place', id: BAK3 },
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
  roster = false,
  personId,
}: {
  entryId: string
  onClose?: () => void
  roster?: boolean
  personId?: string
}) {
  const state = useHousehold((depot) => depot.state)
  const trip = state.trips[TRIP]
  const entry = trip?.entries?.[entryId]
  if (trip === undefined || entry === undefined) return null
  return (
    <OutcomeSheet
      trip={trip}
      entry={entry}
      view={containmentView(state)}
      onClose={onClose}
      roster={roster}
      {...(personId === undefined ? {} : { personId })}
    />
  )
}

function renderSheet(
  seed: Seeded,
  entryId: string,
  onClose: () => void = () => {},
  roster = false,
  personId?: string,
): void {
  render(
    <HouseholdProvider value={seed.store}>
      <Harness
        entryId={entryId}
        onClose={onClose}
        roster={roster}
        {...(personId === undefined ? {} : { personId })}
      />
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

  /**
   * **The only path in the app that clears an outcome.** `choose` emits
   * `{ outcome: null }` — the payload a well-meaning `if (!next) return`
   * would treat identically to "nothing chosen" and silently swallow, since
   * `null` is falsy. Nothing else in this file exercises tapping `OPEN`
   * while a *resolved* outcome is current, so this is the one test standing
   * between that regression and a green suite.
   */
  it('writes {outcome: null} tapping OPEN to clear a resolved outcome', async () => {
    const user = userEvent.setup()
    const seed = await seeded(tripOutcomeSet(TRIP, E_GAS, 'back'))
    renderSheet(seed, E_GAS)

    await user.click(chipNamed('○ OPEN'))

    expect(await seed.authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: { entry_id: E_GAS, outcome: null },
      },
    ])
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

  /**
   * **Multi-digit, and past the ceiling on purpose (review Minor 9, ruling
   * R21).** A single-digit typed value never exercises `Stepper`'s own
   * `max` clamp; typing `44` against a Bring-count of 4 is exactly the
   * regression the review round reproduced — before `max` existed, the well
   * was left stranded at the literal `44` forever, because a caller-side
   * clamp compared its own already-clamped `4` to the value already held
   * and skipped the `onChange` that would otherwise have corrected it.
   */
  it('commits a typed value once, on blur, and never strands the well past the ceiling (ui/Stepper K, R21)', async () => {
    const user = userEvent.setup()
    const seed = await seeded(
      tripOutcomeSet(TRIP, E_GAS, 'consumed'),
      tripConsumedCountSet(TRIP, E_GAS, 2),
    )
    renderSheet(seed, E_GAS)

    const well = screen.getByRole('textbox', { name: /consumed count/i })
    await user.clear(well)
    await user.type(well, '44')
    expect(await seed.authored()).toEqual([])

    await user.tab()

    // Clamped to the Bring-count (4) by `Stepper`'s own `max` — never the
    // literal `44` typed, and not left stranded there.
    expect(well).toHaveValue('4')
    expect(await seed.authored()).toEqual([
      {
        type: 'trip.consumed_count_set',
        payload: { entry_id: E_GAS, count: 4 },
      },
    ])
  })

  /**
   * **Finding I3.** The sheet is reachable on a closed Trip in three taps
   * (F5 is drawn at every phase deliberately), and this block was live and
   * lying there: `OWNED ×4 → ×2 AT CLOSE.` reads the count the close already
   * reduced, names an event that has happened, and every raise emits an op
   * that changes the Depot by nothing — `closeTrip` returns `[]` once the
   * Trip is closed (R27 Layer B). Withheld, not greyed. The Entry's split
   * stays legible on the F5 row's own meta.
   */
  it('grows no stepper on a CLOSED Trip, where its consequence line would be false (I3)', async () => {
    const user = userEvent.setup()
    const seed = await seeded(
      tripOutcomeSet(TRIP, E_TENT, 'back'),
      tripOutcomeSet(TRIP, E_MAP, 'back'),
      tripOutcomeSet(TRIP, E_CRATE, 'back'),
      tripOutcomeSet(TRIP, E_INNER, 'back'),
      tripOutcomeSet(TRIP, E_HEADLAMP, 'back', 'mark'),
      tripOutcomeSet(TRIP, E_GAS, 'consumed'),
      tripConsumedCountSet(TRIP, E_GAS, 2),
      // What the close itself authored, then the phase move.
      gearOwnedCountSet(GAS, 4),
      tripPhaseMoved(TRIP, 'closed'),
    )
    renderSheet(seed, E_GAS)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/AT CLOSE/)).toBeNull()

    // The chips themselves stay live — a phase locks nothing, and only the
    // stepper's own consequence line is the false statement.
    await user.click(chipNamed('● BACK'))
    expect(await seed.authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: { entry_id: E_GAS, outcome: 'back' },
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

  /**
   * **The inside-count is the row's, not the sheet's** — README §7 and
   * ruling F1, decisive over board §02's own annotation card: "the container
   * row is ordinary — no rail, meta `→ SHELF L-TOP · 12 INSIDE` — and **its
   * sheet states** `ITS CONTENTS KEEP THEIR OWN OUTCOMES.`" `Inner` still
   * rides inside `Crate B` on this Trip (the fixture's own
   * `tripEntryMoved`), proving the sentence's claim rather than merely
   * stating it with nothing actually nested.
   */
  it("adds the container's one clause, states no inside-count, and authors no op on its contents", async () => {
    const user = userEvent.setup()
    const seed = await seeded()
    renderSheet(seed, E_CRATE)

    expect(
      screen.getByText('OUTCOME · ITS CONTENTS KEEP THEIR OWN OUTCOMES.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/INSIDE/)).not.toBeInTheDocument()

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

/**
 * Two renderings this file's own fact composition produces that no board
 * draws and no ruling names — pinned as they behave today rather than left
 * to drift, per this codebase's standing rule that a decision taken in code
 * the boards never reached gets written down and challenged (a design
 * round, not this diff, settles whether either should read differently).
 * `Unpack.tsx`'s own `describe('DESTINATION mode — two code-authored
 * renderings, unpinned by any ruling', …)` is the precedent this mirrors —
 * no board frame here draws this sheet for anything but a Counted Entry.
 */
describe('two code-authored renderings, unpinned by any ruling', () => {
  it('reads OUTCOME · → path for a Single Entry with a home', async () => {
    const seed = await seeded()
    renderSheet(seed, E_MAP)

    expect(screen.getByText('OUTCOME · → Bak 3')).toBeInTheDocument()
  })

  it('collapses to the bare word OUTCOME for a Single Entry with no home path', async () => {
    // `Tent, 3p` carries no `residence` register at all — the fully-Loose
    // case — so `returnPathOf` answers `[]` and the fact has nothing left
    // to say beyond the label itself. This is the sheet's own
    // `description`, which is what a screen reader hears right after the
    // title: the worst case this composition reaches is one word.
    const seed = await seeded()
    renderSheet(seed, E_TENT)

    const sheet = screen.getByRole('dialog', { name: 'Tent, 3p' })
    const fact = screen.getByText('OUTCOME')
    expect(sheet).toHaveAttribute('aria-describedby', fact.id)
  })
})

/**
 * **F7's roster variant** (`docs/design/README.md` §7, §5h; board §02
 * "Per-Piece outcome sheet — Headlamp") — the outcome sheet with a roster
 * above the verbs, opened for a per-person Entry. `Headlamp` gains two more
 * Participants here (Els, Kees) beside `seeded()`'s own Mark, with Mark and
 * Els already `back` and Kees left open — the board's own "2 of 3 resolved"
 * shape, one Piece short of full.
 */
describe('the outcome sheet — the roster variant (F7)', () => {
  function withThreePieces(...extra: readonly OpSpec[]): readonly OpSpec[] {
    return [
      personRecorded('els', 'Els'),
      tripParticipantAdded(TRIP, 'els'),
      personRecorded('kees', 'Kees'),
      tripParticipantAdded(TRIP, 'kees'),
      tripOutcomeSet(TRIP, E_HEADLAMP, 'back', 'mark'),
      tripOutcomeSet(TRIP, E_HEADLAMP, 'back', 'els'),
      // Kees's own Piece left open.
      ...extra,
    ]
  }

  it('names the sheet by the gear and describes it with 2 OF 3 RESOLVED and the return path', async () => {
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    const sheet = screen.getByRole('dialog', { name: 'Headlamp' })
    const fact = screen.getByText('OUTCOME · 2 OF 3 RESOLVED · → Bak 3')
    expect(sheet).toHaveAttribute('aria-describedby', fact.id)
  })

  it('draws one row per Piece, EVERYONE selected on open', async () => {
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    const rows = screen.getAllByTestId('roster-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Els'),
      expect.stringContaining('Kees'),
      expect.stringContaining('Mark'),
    ])
    // Every row is part of the selection on open — the `SELECTED ✓` grammar
    // pinned on all three rather than none, since `EVERYONE` is the default.
    for (const row of rows) {
      expect(row).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('draws a consumed Piece filled, the identical tone a back Piece takes', async () => {
    const seed = await seeded(
      ...withThreePieces(tripOutcomeSet(TRIP, E_HEADLAMP, 'consumed', 'kees')),
    )
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    const circles = screen.getAllByTestId('person-circle')
    // Els, Kees, Mark — `tripParticipants`' own alphabetical order.
    expect(circles.map((circle) => circle.getAttribute('data-tone'))).toEqual([
      'filled',
      'filled',
      'filled',
    ])
    // The sheet is what states the difference the tone cannot — Kees's own
    // row still reads CONSUMED, not BACK.
    const kees = screen.getAllByTestId('roster-row')[1]
    expect(kees).toHaveTextContent('CONSUMED')
  })

  it('draws a lost Piece with the attention tone, apart from the other two', async () => {
    const seed = await seeded(
      ...withThreePieces(tripOutcomeSet(TRIP, E_HEADLAMP, 'lost', 'kees')),
    )
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    const circles = screen.getAllByTestId('person-circle')
    expect(circles.map((circle) => circle.getAttribute('data-tone'))).toEqual([
      'filled',
      'attention',
      'filled',
    ])
  })

  it('toggles a row into and out of the selection with SELECTED ✓', async () => {
    const user = userEvent.setup()
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    const kees = screen.getAllByTestId('roster-row')[1]
    if (kees === undefined) throw new Error('no Kees row')
    expect(kees).toHaveTextContent('SELECTED ✓')

    await user.click(kees)

    expect(kees).not.toHaveTextContent('SELECTED ✓')
    expect(kees).toHaveAttribute('aria-pressed', 'false')

    await user.click(kees)

    expect(kees).toHaveTextContent('SELECTED ✓')
  })

  it('restores the full selection on an EVERYONE tap', async () => {
    const user = userEvent.setup()
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    const kees = screen.getAllByTestId('roster-row')[1]
    if (kees === undefined) throw new Error('no Kees row')
    await user.click(kees)
    expect(kees).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByTestId('roster-everyone'))

    for (const row of screen.getAllByTestId('roster-row')) {
      expect(row).toHaveAttribute('aria-pressed', 'true')
    }
  })

  /**
   * **§5g E10** — with two of three already `back`, tapping `BACK` under
   * `EVERYONE` writes **one** op, for Kees alone: the redundant-write guard
   * applied to a whole selection at once.
   */
  it('writes one op per Piece that changes, skipping the ones already there', async () => {
    const user = userEvent.setup()
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    await user.click(chipNamed('● BACK'))

    expect(await seed.authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: { entry_id: E_HEADLAMP, outcome: 'back', person_id: 'kees' },
      },
    ])
  })

  it('applies only to a narrowed selection, leaving the rest alone', async () => {
    const user = userEvent.setup()
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    const rows = screen.getAllByTestId('roster-row')
    const els = rows[0]
    const mark = rows[2]
    if (els === undefined || mark === undefined) throw new Error('no rows')
    // Narrow to Mark alone.
    await user.click(els)
    const kees = rows[1]
    if (kees === undefined) throw new Error('no Kees row')
    await user.click(kees)

    await user.click(chipNamed('▲ LOST'))

    expect(await seed.authored()).toEqual([
      {
        type: 'trip.outcome_set',
        payload: { entry_id: E_HEADLAMP, outcome: 'lost', person_id: 'mark' },
      },
    ])
  })

  it('raises no chip as current — a selection can hold mixed outcomes', async () => {
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    for (const chip of screen.getAllByTestId('outcome-chip')) {
      expect(chip).not.toHaveAttribute('data-current')
    }
  })

  it('grows no stepper in this variant', async () => {
    const user = userEvent.setup()
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    await user.click(chipNamed('CONSUMED'))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('states the roster footer, not the plain one', async () => {
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    expect(
      screen.getByText(
        'EVERYONE IS SELECTED ON OPEN. TAP A ROW TO NARROW. ONE OP PER PIECE THAT CHANGES.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/LOST KEEPS THE HOME SLOT/),
    ).not.toBeInTheDocument()
  })

  /**
   * **Ruling R23.** `personId` seeds the selection to that one Piece alone
   * — the unit-level twin of `Unpack.test.tsx`'s own end-to-end proof.
   */
  it('seeds the selection to personId alone when one is given', async () => {
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true, 'kees')

    const rows = screen.getAllByTestId('roster-row')
    expect(rows[0]).toHaveAttribute('aria-pressed', 'false') // Els
    expect(rows[1]).toHaveAttribute('aria-pressed', 'true') // Kees
    expect(rows[2]).toHaveAttribute('aria-pressed', 'false') // Mark
  })

  /**
   * The defensive half: a `personId` naming nobody currently included (a
   * stale prop, a Piece removed between the tap and this mount) falls back
   * to `EVERYONE` rather than seeding an empty, useless selection.
   */
  it('falls back to EVERYONE when personId names no included Piece', async () => {
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true, 'nobody-on-this-trip')

    for (const row of screen.getAllByTestId('roster-row')) {
      expect(row).toHaveAttribute('aria-pressed', 'true')
    }
  })

  /**
   * **Ruling R24** — the board's own drawn colours the sheet had not yet
   * painted: a resolved Piece's status word in the packed green, a lost
   * one in attention, and a selected row's own background tint.
   */
  it("paints a resolved Piece's status word packed-green and a lost one in attention", async () => {
    const seed = await seeded(
      ...withThreePieces(tripOutcomeSet(TRIP, E_HEADLAMP, 'lost', 'kees')),
    )
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    const rows = screen.getAllByTestId('roster-row')
    // Els: back — resolved, packed-green.
    expect(within(rows[0]!).getByText('● BACK')).toHaveAttribute(
      'data-tone',
      'filled',
    )
    // Kees: lost — attention.
    expect(within(rows[1]!).getByText('▲ LOST')).toHaveAttribute(
      'data-tone',
      'attention',
    )
  })

  /**
   * **Minor 5** — roster mode's chips are actions applied to a selection,
   * not toggles: none of them can ever become "pressed," so the attribute
   * is withheld entirely rather than stating `false` forever.
   */
  it('states no aria-pressed on any chip in roster mode', async () => {
    const seed = await seeded(...withThreePieces())
    renderSheet(seed, E_HEADLAMP, () => {}, true)

    for (const chip of screen.getAllByTestId('outcome-chip')) {
      expect(chip).not.toHaveAttribute('aria-pressed')
    }
  })
})
