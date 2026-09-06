import {
  bringCountOf,
  consumedCountOf,
  containmentView,
  entryLabel,
  isContainerEntry,
  outcomeGlyph,
  outcomeLabel,
  outcomeOf,
  ownedCountOf,
  returnPathOf,
  subtreeOf,
  tripConsumedCountSet,
  tripContainmentView,
  tripOutcomeSet,
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
 * over: `trip`/`entry` arrive as props (the caller already has them, exactly
 * as `PhaseSheet` is handed its `trip`), and `state`/`emit` come from the
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
 * ## The fact line never shows the split
 *
 * The board's own drawn example (`S10 Round…dc.html` §02) keeps
 * `OUTCOME · ×4 BROUGHT · → BAK 3` on screen while `CONSUMED` is the raised
 * chip and the stepper reads `×2`: the header fact states what was
 * **brought**, unconditionally, and the split/consequence are the stepper
 * block's own fact, stated once there (F9) rather than duplicated here.
 *
 * ## The container's fact is an addition, not a replacement
 *
 * Spec §4.4: *"a container's fact line **adds** `CONTAINER · 12 INSIDE ·
 * ITS CONTENTS KEEP THEIR OWN OUTCOMES.`"* — read literally: the quantity
 * clause becomes the container's own (`CONTAINER · N INSIDE`, `N` from
 * {@link subtreeOf} over the Trip's own containment, `returnPathMeta`'s
 * identical read), the return path stays where it always sits, and the
 * reassurance sentence is appended at the very end. No board frame draws
 * this exact composition — this file's own test pins it as written rather
 * than inventing a fallback the way `Unpack.tsx`'s `returnPathMeta` already
 * does for its own code-authored cases.
 */
export interface OutcomeSheetProps {
  trip: TripState
  entry: EntryState
  onClose: () => void
}

/** BACK · OPEN · CONSUMED · LOST — the board's own drawn order
 * (`S10 Round…dc.html` §02), not `OUTCOMES`'s own table order with `OPEN`
 * appended: the mock draws `OPEN` second, between `BACK` and `CONSUMED`, on
 * both sheets it shows chips for. */
const CHIP_IDS: readonly (OutcomeValue | null)[] = [
  'back',
  null,
  'consumed',
  'lost',
]

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

export function OutcomeSheet({ trip, entry, onClose }: OutcomeSheetProps) {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)

  const view = useMemo(() => containmentView(state), [state])
  const tripView = useMemo(
    () => tripContainmentView(trip, state),
    [trip, state],
  )

  const outcome = outcomeOf(entry)
  const container = isContainerEntry(entry, state)
  const bringCount = bringCountOf(entry, state)
  const consumedCount = consumedCountOf(entry, state)
  const title = entryLabel(entry, state)
  const gear = depotGearOf(entry, state)

  const fact = useMemo(() => {
    const path = returnPathOf(entry, state, view)
    const pathText = path.map((segment) => segment.name).join(' ▸ ')

    const parts: string[] = ['OUTCOME']
    if (container) {
      parts.push(`CONTAINER · ${subtreeOf(tripView, entry.id).size} INSIDE`)
    } else if (bringCount !== null) {
      parts.push(`×${bringCount} BROUGHT`)
    }
    if (pathText !== '') parts.push(`→ ${pathText}`)

    let text = parts.join(' · ')
    if (container) {
      text = `${text} · ITS CONTENTS KEEP THEIR OWN OUTCOMES.`
    }
    return text
  }, [entry, state, view, tripView, container, bringCount])

  function choose(next: OutcomeValue | null) {
    // A redundant write moves the stamp LWW compares — see this file's own
    // docstring — so tapping the outcome the Entry already carries writes
    // nothing.
    if (next === outcome) return
    emit(tripOutcomeSet(trip.id, entry.id, next))
  }

  function handleConsumedChange(next: number | null) {
    if (next === null || bringCount === null || consumedCount === null) return
    const clamped = Math.min(Math.max(next, 1), bringCount)
    // The same needless-write guard, one register over: `Stepper`'s `+`
    // button has no ceiling of its own (`EntryRow`'s identical shape), so a
    // tap past the Bring-count would otherwise re-author the value already
    // held.
    if (clamped === consumedCount) return
    emit(tripConsumedCountSet(trip.id, entry.id, clamped))
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
