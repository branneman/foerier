import { STAGES, stageLabel, type StageValue } from '@foerier/shared'

import styles from './JourneyRail.module.css'

/**
 * **A container's journey, as four chips** — ruling A15,
 * `docs/design/README.md` §1's "journey rail" bullet, spec §4.7.
 *
 * ## A chip sets that stage; it does not advance one
 *
 * `SET PHASE`'s answer verbatim, one world over. Every chip is a **direct
 * set**, backwards included — tapping `⌂ HOME` on a container sitting in the
 * car sends it home, which plain LWW makes correct and sync §3.3 makes
 * deliberate. There is no furthest-stage rule and there is deliberately no
 * `nextStage` in `shared/` for this to call: ruling A15 retired the idiom,
 * and Components §02's `TAP TO ADVANCE` annotation is corrected with it —
 * *advance* is the word that got it wrong.
 *
 * ## Tapping the current stage writes nothing
 *
 * The same rule the trip screen's SET PHASE keeps, and for a reason that
 * survives translation: **a redundant write moves the stamp LWW compares**,
 * so a no-op tap can beat — and silently discard — a genuine concurrent
 * write another Device made while this one was offline. At S6 that mistake
 * was *visible*, because `DAY N` reads the phase register's own stamp; here
 * it is invisible and exactly as wrong. The guard lives on the chip's own
 * `onClick` rather than in the caller, so no caller can forget it.
 *
 * ## A rail tap never confirms
 *
 * Ruling A2b's third act: this writes **one** register and rewrites nobody
 * else's. The contents' whereabouts follow a pointer, so nothing of theirs
 * is touched — which is the whole difference between this and a container
 * *move*, the one act on F4 that does confirm.
 *
 * ## The current chip stays undimmed — dim means future
 *
 * Three paints, one attribute: `past` is bordered + muted with a `✓`,
 * `current` is inverted with a `●`, `future` is dashed and dim.
 * `data-stage-state` carries which, so the stylesheet holds one selector per
 * state and no component decides a colour. **Only `future` is dim** — a
 * reader who has to tell "where it is now" from "where it has not been yet"
 * at arm's length in a garage gets the strongest paint on the answer.
 *
 * A `current` this build has no row for (`StageValue` is an open enum, and
 * story 20 makes it editable) simply matches no chip: every chip then draws
 * `future` and every chip is a live set. That is the honest read — nothing
 * here can name a stage it has never heard of — and it needs no branch of
 * its own.
 *
 * ## The marker glyph is hidden, and `aria-current` states the fact instead
 *
 * `✓` and `●` are a second painting of what `aria-current="step"` says, and
 * a chip whose accessible name were `CAR ●` would no longer be named for
 * the stage it sets. So the marker is `aria-hidden` and the name is the
 * stage's own word — the same word `stageLabel` gives the ▲ line and the
 * Pack picker's right-hand slot.
 *
 * ## Hit 48 at a drawn ~24 (ruling O)
 *
 * `JourneyRail.module.css` paints the chip at the phase chip's own 1.5rem
 * and grows it with a clamped, non-painting `::after`. The clamp grows
 * **vertically only**: the chips sit 4px apart on one line, so a horizontal
 * extension would put a tap meant for `CAR` on `PACKED`. Vertically it
 * reaches exactly the header's own 12px gaps, never into the header body's
 * target above it or the first row below. **Nothing in that chain may carry
 * `overflow: hidden`** — a clipped descendant is not hit-testable, and
 * `drawnSizes.test.ts` parses stylesheet text, so it would pass over a hit
 * area that does not exist.
 */
export interface JourneyRailProps {
  /** The container's stage — `stageOf`'s answer, absent read as `home`. */
  current: StageValue
  /** Emits `trip.container_stage_set`. Never called with {@link current}. */
  onSet: (stage: StageValue) => void
  /** The group's accessible name, e.g. `Journey — Duffel 90 L`. */
  label: string
}

export function JourneyRail({ current, onSet, label }: JourneyRailProps) {
  // `-1` for a stage this build has no row for — see the docstring: no chip
  // is then `past` and none is `current`, which is the honest read rather
  // than a case.
  const currentIndex = STAGES.findIndex((stage) => stage.id === current)

  return (
    <div
      className={styles['rail']}
      role="group"
      aria-label={label}
      data-testid="journey-rail"
    >
      {STAGES.map((stage, index) => {
        const state =
          stage.id === current
            ? 'current'
            : index < currentIndex
              ? 'past'
              : 'future'

        return (
          <button
            key={stage.id}
            type="button"
            className={styles['chip']}
            data-stage-state={state}
            data-testid="journey-chip"
            aria-current={state === 'current' ? 'step' : undefined}
            onClick={() => {
              // Ruling A15's own sentence, enforced here so no caller has to
              // remember it.
              if (stage.id === current) return
              onSet(stage.id)
            }}
          >
            {stageLabel(stage.id)}
            {state !== 'future' && (
              <span aria-hidden="true"> {state === 'current' ? '●' : '✓'}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
