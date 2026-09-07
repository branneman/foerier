import {
  closeTrip,
  isKnownPhase,
  overClaimsIfActive,
  phaseLabel,
  isActivePhase,
  phaseOf,
  PHASES,
  reopenBlocked,
  reopenTrip,
  tripPhaseMoved,
  unpackTotals,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { Sheet } from '@foerier/ui'
import { useState } from 'react'
import { useLocation } from 'wouter'

import { useHousehold } from '../household/store'
import { openLabel } from '../household/trips'
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
 * Three special cases now, not two.
 *
 * **Entering `closed` is gated on `open = 0`, invariant 18's own gate — the
 * discharge of this file's earlier "entering `closed` is unguarded" note**
 * (spec §8.3 predates S10's outcomes). While
 * {@link unpackTotals}`(trip, state).open` is greater than zero the row
 * stays tappable — the sheet's own standing rule, D7, never a disabled row —
 * and the tap **routes to F5** (`/trips/:id/unpack`) instead of writing
 * anything: there is nowhere else in this build a Quartermaster can go to
 * close the gap, so sending them back out to hunt for the band's link would
 * be the dead-end the rejected board alternative draws (spec §4.8). At
 * `open = 0` the row is the ordinary setter, except that what it emits is
 * `closeTrip(trip, state)` (`gestures.ts`) rather than a bare
 * `trip.phase_moved` — the same gesture F5's own close card calls, so this
 * sheet can never emit half of the close batch. **The second copy of this
 * gate lives in `Unpack.tsx`'s close card** (F11); both read `unpackTotals`
 * off the fold their own render already holds — never a raw `PackingCount`
 * prop, and neither re-derives the other's arithmetic.
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
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)
  const [, navigate] = useLocation()

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
  // F12's own read, asked once — `choose` below closes over this same
  // `trip`/`state` pair, so a second call inside it would read the
  // identical fold, not a fresher one; the object is kept whole (not just
  // `.open`) because the row's own meta wants `openLabel`'s exact words,
  // the same ones `Unpack.tsx`'s count line and `TripCard`'s progress line
  // draw, never re-spelled here.
  const unpackCount = unpackTotals(trip, state)
  const open = unpackCount.open
  // `reopenBlocked` (`gestures.ts`), never re-derived — the identical read
  // the closed ledger row makes before withholding its own `REOPEN`, so the
  // app's two doors out of `closed` cannot disagree about whether there is
  // one. `false` for every Trip that is not closed, so this says nothing
  // about any other row.
  const blocked = reopenBlocked(trip, state)
  // Withheld, never greyed (`patterns.md` §3.7): on a Trip whose close
  // lowered an owned count the four rows out of `closed` are the second door
  // onto a re-close that would subtract the Consumed-count again, so they do
  // not render at all. What is left is the Trip's own `● NOW`, which is a
  // true statement of where the Trip stands, and the footnote below carries
  // the reason in place of its usual promise.
  const rows = blocked ? PHASES.filter((row) => row.id === current) : PHASES

  function move(phase: PhaseKey) {
    emit(tripPhaseMoved(trip.id, phase))
    onClose()
  }

  /**
   * Leaving `closed` goes through `reopenTrip` (`gestures.ts`) rather than
   * {@link move}'s bare `tripPhaseMoved`, for the reason this file already
   * states one direction over: a bare op past a gate is exactly the
   * corruption the gesture exists to prevent, arriving through a second
   * door. `move` stays bare for every other transition, which is right —
   * none of them owes the Depot anything.
   *
   * Unreachable while `blocked` is true, because the rows that would reach
   * it are withheld above; the gate is here so a future row cannot inherit
   * the emit without it.
   */
  function reopen(phase: PhaseKey) {
    for (const spec of reopenTrip(trip, phase, state)) emit(spec)
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
    // F12: entering `closed` is gated on `open = 0`, invariant 18's own
    // gate — this file's docstring has the full reasoning. `open` is the
    // same read taken above, off the fold this render already closed over;
    // there is no fresher one a second call inside a click handler could
    // reach.
    if (phase === 'closed') {
      if (open > 0) {
        // D7: still tappable, never a dead row — the tap goes where the
        // gap can actually be closed, and the sheet gets out of the way of
        // it rather than leaving a claim it cannot back up on screen.
        navigate(`/trips/${trip.id}/unpack`)
        onClose()
        return
      }
      // `closeTrip` carries the summed per-Gear reduction, the floor at
      // zero, `trip.phase_moved` last, and the already-closed guard — never
      // re-derived here. This discharges the defect this task was written
      // to close: a bare `tripPhaseMoved` past this gate is exactly the
      // corruption F5's own close card exists to prevent, arriving through
      // a second door.
      for (const spec of closeTrip(trip, state)) emit(spec)
      onClose()
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
        {rows.map((row) => {
          const now = row.id === current
          // F12: the `CLOSED` row's own right-hand meta — drawn only while
          // there is still a gap for it to name. Withheld on the row that
          // is itself `● NOW`: `choose` returns early, without reading
          // `open` at all, the moment the tapped row is the current phase
          // (`DAY N`'s own rule, restated), so a meta claiming the tap would
          // route somewhere would be a promise this sheet does not keep for
          // that row. Whether a Trip can *actually* be `closed` with
          // `open > 0` — a peer on an older build, or data from before this
          // task's own fix — is a fact about the fold this component does
          // not have to settle to draw correctly either way.
          const openHere = row.id === 'closed' && !now && open > 0
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
                {openHere && (
                  // `openLabel` — never re-spelled: `Unpack.tsx`'s count
                  // line, the close card's summary and `TripCard`'s
                  // progress line all draw the identical words off the
                  // identical function, and a literal `{open} OPEN` here
                  // would be a fifth spelling waiting to drift the day any
                  // of the other four is repainted. Ruling D: the `›` is
                  // decoration and stays out of the accessible name on
                  // every row that carries one — this button has no
                  // `aria-label` to do that wholesale, so the glyph alone
                  // is `aria-hidden` instead.
                  <span
                    className={styles['openMeta']}
                    data-testid="phase-row-open"
                  >
                    {openLabel(unpackCount)} <span aria-hidden="true">›</span>
                  </span>
                )}
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

        **It is swapped, not merely dropped, where the rows are withheld.**
        `ANY ROW TAPPABLE` is a promise, and a sheet drawing one row cannot
        keep it; leaving the sentence there would state something the sheet
        has just stopped doing. The replacement names the same fact the
        closed ledger row's own meta names, in this sheet's voice — and, like
        that one, it is code-authored copy no board reached (`design/README.md`
        §5j).
      */}
      <p className={styles['footnote']}>
        {blocked
          ? 'CLOSED — COUNTS LOWERED AT CLOSE. NO DATE OR COUNT EVER MOVES A PHASE.'
          : 'ANY ROW TAPPABLE, BACKWARDS INCLUDED. NO DATE OR COUNT EVER MOVES A PHASE.'}
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
          onConfirm={() => reopen(reopenTo)}
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
