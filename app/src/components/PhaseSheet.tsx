import {
  isKnownPhase,
  overClaimsIfActive,
  phaseLabel,
  isActivePhase,
  phaseOf,
  PHASES,
  tripPhaseMoved,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { Sheet } from '@foerier/ui'
import { useState } from 'react'

import { useDepot } from '../depot/store'
import { ActivationConfirm } from './ActivationConfirm'
import { overClaimGroups } from './OverClaimBand'
import styles from './PhaseSheet.module.css'
import { ReopenConfirm } from './ReopenConfirm'

/**
 * **SET PHASE** — the board's excerpt, and the only control that moves a Trip
 * through `DRAFT → PACK-OUT → ON TRIP → UNPACK → CLOSED`.
 *
 * Five rows in `PHASES` order, the current one marked `● NOW`, **any row
 * tappable, backwards included**, and the footnote that says why: *no date or
 * count ever moves a phase*. A phase is set by a quartermaster and by nothing
 * else — "we had left" until the duffel turns out to be still in the hall — so
 * there is no transition graph here to encode. `PHASES` is a table, invariant
 * 16 makes every move expressible in either direction, and the sequence is the
 * only structure the sheet needs.
 *
 * It emits `trip.phase_moved` itself, unlike the participant picker beside it:
 * there is exactly one caller shape — a chip on a Trip that already exists —
 * so nothing is served by handing the move back up.
 *
 * Two special cases, and only two.
 *
 * **Entering `closed` is unguarded**, per spec §8.3. That is honest rather
 * than provisional: the close gate counts *open outcomes* (invariant 18) and
 * nothing can be open until S10 builds outcomes at all. S10 adds the gate; a
 * stub here would be a claim about a check the app does not perform.
 *
 * **Leaving `closed` confirms** — see {@link ReopenConfirm}.
 *
 * **Entering an Active phase from a non-Active one previews the over-claim
 * band** (widened from `draft → pack_out` alone by amendment ruling J) — spec
 * §4.5's second guarded moment, {@link ActivationConfirm}. Reopening's
 * three-line comment above states the general shape; activation is the same
 * shape a level earlier, since a Draft's own row is what triggers it rather
 * than an already-active phase's.
 *
 * **The gate is asked of the filtered block, not the raw selector** (Task 14
 * review F1). `overClaimsIfActive` is deliberately unscoped to `trip.id` —
 * it can report a conflict between two *other* Trips entirely — so gating on
 * its bare length opened this sheet, with nothing above the body, for a
 * Draft that shares no Gear with anyone. `overClaimGroups` is what
 * `ActivationConfirm` draws from, so it is also what decides whether to open
 * it — the same rule `OverClaimBand` already follows for its own `null`
 * return.
 */
export interface PhaseSheetProps {
  trip: TripState
  onClose: () => void
}

export function PhaseSheet({ trip, onClose }: PhaseSheetProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)

  // The phase a reopen is waiting on, and `null` when nothing is. Mount is
  // the reset — `ui/`'s primitives have no `open` prop, so a caller writes
  // `{open && <PhaseSheet …/>}` and a declined reopen cannot come back on the
  // next open.
  const [reopenTo, setReopenTo] = useState<PhaseKey | null>(null)
  // The phase an activation preview is waiting on, and `null` when none is
  // up. It holds the **target phase** rather than a boolean (ruling J): the
  // preview now mounts for any transition entering Active, so the sheet has
  // to name the phase it would move to and the confirm has to move to that
  // same one.
  const [activating, setActivating] = useState<PhaseKey | null>(null)

  const current = phaseOf(trip)
  // The hypothetical `overClaimsIfActive` asks — spec §4.5: "what if `trip`
  // were active right now" — and `overClaimGroups` is what filters that
  // hypothetical down to conflicts naming `trip.id` at all (see this file's
  // own docstring on F1). Both are recomputed on every render exactly like
  // `Trip.tsx`'s own `overClaimsFor`, so a settle route taken from inside
  // `ActivationConfirm` shrinks this list live rather than waiting for a
  // remount.
  const activationGroups = overClaimGroups(
    overClaimsIfActive(state, trip.id),
    trip.id,
    state,
  )
  // Through `isKnownPhase` rather than a `PHASES.some(…)` of our own: the
  // phase table's own docstring reserves every question about it for a named
  // function beside it, and this is one — "is there a row at all" is the one
  // thing the resolving accessors cannot answer, because each of them
  // *resolves* the miss. A lookup here would put "what an unrecognised phase
  // means" in two places, and this screen's copy is the one that would drift.
  const known = isKnownPhase(current)

  function move(phase: PhaseKey) {
    emit(tripPhaseMoved(trip.id, phase))
    onClose()
  }

  function choose(phase: PhaseKey) {
    // Tapping the phase the Trip is already in writes **nothing**. `DAY N` is
    // the phase register's own stamp (`shared/src/selectors/trip.ts`), so a
    // redundant move would silently reset a Trip on `DAY 12` to `DAY 1` — the
    // same class of harm as S4's "a needless write moves `recordedAt`", and
    // worse here because the count is the chip's whole content.
    if (phase === current) {
      onClose()
      return
    }
    // Only `closed` is guarded on the way out. An unrecognised phase is not
    // `closed`, and confirming it would claim knowledge of a phase this build
    // does not have.
    if (current === 'closed') {
      setReopenTo(phase)
      return
    }
    // Spec §4.5's second guarded moment, widened by amendment ruling J to
    // **any transition whose target is Active and whose source is not**.
    // S7 shipped this as `draft → pack_out` alone, on the grounds that
    // "starting pack-out on a draft" was the domain's own phrase and a Draft
    // jumping straight to `on_trip` or `unpack` was a case no board drew. But
    // every row of this sheet is tappable, invariant 17 makes all three active
    // phases equally activating, and so the narrow guard simply missed two
    // one-tap routes into exactly the state it exists to preview.
    //
    // `isActivePhase` is the one definition of active-ness in the codebase
    // and both halves of this ask it — re-deriving either side is the defect
    // three separate S6 reviews caught. `closed` is already handled above, so
    // closed → Active keeps the reopen confirm and never reaches here.
    // Active → Active mounts nothing, because the source is Active.
    //
    // Skipped entirely when there is nothing to warn about: "never blocks"
    // also means never adding a screen nobody needs.
    if (
      !isActivePhase(current) &&
      isActivePhase(phase) &&
      activationGroups.length > 0
    ) {
      setActivating(phase)
      return
    }
    move(phase)
  }

  return (
    // `SET PHASE` and nothing longer: every sheet carries a short label, and
    // the chip that opened this one is the Trip's own — on the Trip's own
    // screen, under the Trip's own name — so naming the Trip here would
    // repeat the line the reader is already looking at.
    <Sheet title="SET PHASE" onClose={onClose} desktopCard>
      {!known && (
        // §3.4: the value is drawn **exactly as it arrived**, because
        // inventing a casing for it would be coercion by another name
        // (`sync-protocol.md` §5.3, obligation 4). `phaseLabel` is what
        // returns it unchanged, so the rule stays in one place. The five rows
        // stay tappable underneath, which is what keeps a Trip from being
        // stranded in a phase this build cannot leave.
        <p className={styles['unknown']} data-testid="phase-now">
          <span className={styles['now']}>● NOW</span> — {phaseLabel(current)}
        </p>
      )}

      <ul className={styles['rows']}>
        {PHASES.map((row) => {
          const now = row.id === current
          return (
            <li key={row.id}>
              <button
                type="button"
                className={styles['row']}
                data-testid="phase-row"
                aria-pressed={now}
                onClick={() => choose(row.id)}
              >
                <span>{row.label}</span>
                {now && <span className={styles['now']}>● NOW</span>}
              </button>
            </li>
          )
        })}
      </ul>

      {/*
        The board's footnote, both sentences. The first is not decoration: a
        list of five rows with one marked reads as a status readout, and
        nothing else on screen says the row *above* the current one can be
        tapped. It is the discoverability of the sheet's whole point, and the
        second sentence is the reason — a phase is set by a quartermaster and
        by nothing else.
      */}
      <p className={styles['footnote']}>
        ANY ROW TAPPABLE, BACKWARDS INCLUDED. NO DATE OR COUNT EVER MOVES A
        PHASE.
      </p>

      <Sheet.Close>
        <button type="button" className={styles['close']}>
          Close
        </button>
      </Sheet.Close>

      {reopenTo !== null && (
        <ReopenConfirm
          trip={trip}
          to={reopenTo}
          onCancel={() => setReopenTo(null)}
          onConfirm={() => move(reopenTo)}
        />
      )}

      {activating !== null && (
        <ActivationConfirm
          trip={trip}
          to={activating}
          groups={activationGroups}
          onCancel={() => setActivating(null)}
          onConfirm={() => move(activating)}
        />
      )}
    </Sheet>
  )
}
