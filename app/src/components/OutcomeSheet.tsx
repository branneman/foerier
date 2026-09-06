import {
  bringCountOf,
  consumedCountOf,
  entryLabel,
  isContainerEntry,
  outcomeGlyph,
  outcomeLabel,
  outcomeOf,
  ownedCountOf,
  OUTCOMES,
  returnPathOf,
  tripConsumedCountSet,
  tripOutcomeSet,
  type ContainmentView,
  type EntryState,
  type HouseholdState,
  type OutcomeValue,
  type TripState,
} from '@foerier/shared'
import { Sheet, Stepper } from '@foerier/ui'
import { useMemo } from 'react'

import { useHousehold } from '../household/store'
import styles from './OutcomeSheet.module.css'

/**
 * **F5's outcome sheet** (`docs/design/README.md` §7, rulings F5/F9; spec
 * §4.4) — the control the row's pill opens. `PhaseSheet`'s shape one register
 * over: `trip`/`entry`/`view` arrive as props (the caller already has them,
 * exactly as `PhaseSheet` is handed its `trip`, and `Unpack.tsx` already
 * builds one `ContainmentView` for the whole screen — `containerTotals`'s own
 * rule against a second build per caller), and `state`/`emit` come from the
 * store directly.
 *
 * ## A picker, and it says so
 *
 * Unlike `PhaseSheet`, which closes itself after every write, this sheet
 * **stays open after a tap** — spec §4.4's "a tap writes one op and the sheet
 * stays open until dismissed on the scrim". `PhaseSheet` calling `onClose()`
 * after `move()` is not a precedent to copy here: a Quartermaster resolving a
 * gear list works through many rows in one sitting, and a sheet that closed
 * on every tap would force a re-open per Entry.
 *
 * ## Tapping the current outcome writes nothing
 *
 * `JourneyRail`'s rule, restated for this register: a redundant
 * `trip.outcome_set` still carries a *later* HLC than whatever sits in the
 * register, so it can beat — and silently discard — a genuine concurrent
 * write from a Device that was offline. The guard lives on {@link choose},
 * not in the caller, so nothing upstream has to remember it.
 *
 * ## Four chips, not `ui/StatusPill`
 *
 * `JourneyRail`'s own precedent, not `PieceStatusSheet`'s: `StatusPill`'s
 * tones say *what happened* (packed/staged/dashed/attention), but this row
 * has to say something `StatusPill` has no tone for — *which chip is the
 * Entry's current outcome*, drawn dashed, filled and ring-lit
 * (`docs/design/README.md` §7's own words: "raised and focus-ringed"). A
 * fifth `StatusPill` tone would teach `ui/` a fact about *selection* rather
 * than about *paint*, which is precisely the line `ui/StatusPill.tsx`'s own
 * docstring draws — so this file hand-rolls the chip, in the pill's grammar
 * (44px, `--radius-pill`, mono caps) rather than a fifth tone.
 *
 * ## The stepper's gate is `consumedCountOf`, not a re-derived Kind check
 *
 * {@link consumedCountOf} already answers `null` for a container (checked
 * first) and for anything that is not a Counted depot Entry — which is
 * exactly "container, per-person and Single grow no stepper" (spec §4.4),
 * stated once in `shared/` rather than re-typed here as `kind === 'counted'
 * && !container`.
 *
 * ## The ceiling is `ui/Stepper`'s `max`, not a caller-side clamp
 *
 * A caller-side clamp (`Math.min(next, bringCount)` before deciding whether
 * to emit) leaves `Stepper`'s own text buffer canonicalised against a bound
 * it never learns — commit a value past the Bring-count and the well is left
 * showing the untruncated digits forever, because the caller's guard skips
 * the `onChange` that would otherwise change `value` and re-fire `Stepper`'s
 * `[value]` resync. Passing {@link ownedCountOf}'s sibling fact,
 * `bringCount`, in as `max` lets `Stepper` canonicalise its own buffer at the
 * one place that already canonicalises `min` (`ui/Stepper.tsx`'s docstring,
 * ruling R21).
 *
 * ## The fact line never shows the split
 *
 * The board's own drawn example (`S10 Round…dc.html` §02) keeps
 * `OUTCOME · ×4 BROUGHT · → BAK 3` on screen while `CONSUMED` is the raised
 * chip and the stepper reads `×2`: the header fact states what was
 * **brought**, unconditionally, and the split/consequence are the stepper
 * block's own fact, stated once there (F9) rather than duplicated here.
 *
 * ## The container's fact adds one clause, and states no inside-count
 *
 * `docs/design/README.md` §7 and ruling F1 (the decisive readings, over
 * board §02's own annotation card — see the review round that settled this):
 * *"the container row is ordinary — no rail, meta `→ SHELF L-TOP · 12
 * INSIDE` — and **its sheet states** `ITS CONTENTS KEEP THEIR OWN
 * OUTCOMES.`"* The inside-count is the **row**'s meta (`Unpack.tsx`'s
 * `returnPathMeta`, already drawing it), not the sheet's — this sheet states
 * no quantity at all for a container, and adds only the reassurance clause
 * after the path.
 *
 * ## A Single/per-person Entry's fact is code-authored, unpinned by any board
 *
 * No board frame draws this sheet for anything but a Counted Entry, so the
 * bare-`OUTCOME` collapse below is this file's own reading, not a drawn
 * string — see {@link fact}'s own comment.
 */
export interface OutcomeSheetProps {
  trip: TripState
  entry: EntryState
  /** The home world's containment, built once per fold by the caller
   * (`Unpack.tsx`'s own `view`) — never rebuilt here. */
  view: ContainmentView
  onClose: () => void
}

/**
 * BACK · OPEN · CONSUMED · LOST — the board's own drawn order
 * (`S10 Round…dc.html` §02: both sheets it draws chips for put `OPEN`
 * second, between `BACK` and `CONSUMED`). `OPEN` has no row in `OUTCOMES` —
 * it is the absence of one — so its insertion point is this file's own, but
 * the other three's **relative** order is derived from `OUTCOMES` itself
 * rather than restated: `OUTCOMES`' own docstring claims "the outcome
 * sheet's chip order," so a second, hand-typed `['back', 'consumed',
 * 'lost']` here is exactly the drift `ownerOf`/`phaseOf`'s family of rules
 * warns against — Task 13's roster sheet draws the identical four chips, and
 * two independently-typed orders for one table is how they end up drawing
 * different ones.
 */
const CHIP_IDS: readonly (OutcomeValue | null)[] = OUTCOMES.flatMap(
  (row, index) => (index === 0 ? [row.id, null] : [row.id]),
)

/** The depot Gear a depot Entry names, or `undefined` — `Unpack.tsx`'s
 * `depotGearOf`, restated here rather than exported from a screen file. */
function depotGearOf(entry: EntryState, state: HouseholdState) {
  const source = entry.source?.value
  if (source === undefined || source.from !== 'depot') return undefined
  return state.gear[source.gearId]
}

/**
 * F9's stepper block — split into its own component so every value it draws
 * is a plain `number`, never the outer scope's `number | null`: the caller
 * only mounts this once `bringCount`/`consumedCount` are both known, and a
 * second `!== null` re-check here would just restate that gate.
 */
function ConsumedStepperBlock({
  title,
  bringCount,
  consumedCount,
  owned,
  onChange,
}: {
  title: string
  bringCount: number
  consumedCount: number
  owned: number
  onChange: (next: number | null) => void
}) {
  const back = bringCount - consumedCount
  return (
    <div className={styles['stepperBlock']}>
      <div className={styles['stepperRow']}>
        <span className={styles['stepperLabel']}>CONSUMED</span>
        <Stepper
          value={consumedCount}
          min={1}
          max={bringCount}
          onChange={onChange}
          label={`Consumed count for ${title}`}
        />
        <span className={styles['back']}>×{back} BACK</span>
      </div>
      <p className={styles['consequence']}>
        {`THE REST CAME BACK. OWNED ×${owned} → ×${Math.max(owned - consumedCount, 0)} AT CLOSE.`}
      </p>
    </div>
  )
}

export function OutcomeSheet({
  trip,
  entry,
  view,
  onClose,
}: OutcomeSheetProps) {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)

  const outcome = outcomeOf(entry)
  const container = isContainerEntry(entry, state)
  const bringCount = bringCountOf(entry, state)
  const consumedCount = consumedCountOf(entry, state)
  const title = entryLabel(entry, state)
  const gear = depotGearOf(entry, state)

  const fact = useMemo(() => {
    const path = returnPathOf(entry, state, view)
    const pathText = path.map((segment) => segment.name).join(' ▸ ')

    // A container states no quantity at all — F1's own reading, settled over
    // board §02's annotation card: the inside-count is the **row**'s meta,
    // not this sheet's. Everything else — a Single, an unrecognised Kind, an
    // unsynced Gear, a per-person container's Entry-level outcome — is
    // **code-authored, unpinned by any board**: no board frame draws this
    // sheet for anything but a Counted Entry, so a Single with a home path
    // reads `OUTCOME · → <path>` and one with none (the fully-Loose case)
    // collapses to the bare word `OUTCOME` — `Sheet`'s own `description`,
    // which is what a screen reader hears right after the title.
    // `OutcomeSheet.test.tsx` pins both as they behave today, exactly as
    // `Unpack.tsx`'s own `returnPathMeta`/`headerlessMeta` pin their own
    // code-authored renderings, rather than inventing a fallback string no
    // ruling has settled.
    const parts: string[] = ['OUTCOME']
    if (!container && bringCount !== null) {
      parts.push(`×${bringCount} BROUGHT`)
    }
    if (pathText !== '') parts.push(`→ ${pathText}`)

    let text = parts.join(' · ')
    if (container) {
      text = `${text} · ITS CONTENTS KEEP THEIR OWN OUTCOMES.`
    }
    return text
  }, [entry, state, view, container, bringCount])

  function choose(next: OutcomeValue | null) {
    // A redundant write moves the stamp LWW compares — see this file's own
    // docstring — so tapping the outcome the Entry already carries writes
    // nothing.
    if (next === outcome) return
    emit(tripOutcomeSet(trip.id, entry.id, next))
  }

  function handleConsumedChange(next: number | null) {
    // `Stepper`'s own `min`/`max` already clamped `next` into
    // `[1, bringCount]` and canonicalised its buffer before calling this —
    // ruling R21. Nothing here re-derives that ceiling.
    if (next === null || consumedCount === null) return
    if (next === consumedCount) return
    emit(tripConsumedCountSet(trip.id, entry.id, next))
  }

  // consumedCountOf already answers `null` for a container (checked first)
  // and for anything that is not a Counted depot Entry — never re-derived
  // as `kind === 'counted' && !container` here.
  const showStepper =
    outcome === 'consumed' && consumedCount !== null && bringCount !== null

  return (
    <Sheet
      title={title}
      onClose={onClose}
      desktopCard
      description={<p className={styles['fact']}>{fact}</p>}
    >
      <div
        className={styles['chips']}
        role="group"
        aria-label={`Outcome — ${title}`}
      >
        {CHIP_IDS.map((id) => {
          const current = id === outcome
          return (
            <button
              key={id ?? 'open'}
              type="button"
              className={styles['chip']}
              data-current={current ? 'true' : undefined}
              aria-pressed={current}
              data-testid="outcome-chip"
              onClick={() => choose(id)}
            >
              {outcomeGlyph(id)} {outcomeLabel(id)}
            </button>
          )
        })}
      </div>

      {showStepper && bringCount !== null && consumedCount !== null && (
        <ConsumedStepperBlock
          title={title}
          bringCount={bringCount}
          consumedCount={consumedCount}
          owned={
            gear === undefined ? bringCount : (ownedCountOf(gear) ?? bringCount)
          }
          onChange={handleConsumedChange}
        />
      )}

      <p className={styles['footer']}>
        ONE OP PER TAP. LOST KEEPS THE HOME SLOT AND STAYS SEARCHABLE.
      </p>

      <Sheet.Close>
        <button type="button" className={styles['close']}>
          Close
        </button>
      </Sheet.Close>
    </Sheet>
  )
}
