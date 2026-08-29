import {
  isKnownPhase,
  phaseLabel,
  phaseName,
  phaseOf,
  PHASES,
  tripLabel,
  tripPhaseMoved,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { Confirm, Sheet } from '@foerier/ui'
import { useState } from 'react'

import { useDepot } from '../depot/store'
import styles from './PhaseSheet.module.css'

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
 */
export interface PhaseSheetProps {
  trip: TripState
  onClose: () => void
}

export function PhaseSheet({ trip, onClose }: PhaseSheetProps) {
  const emit = useDepot((depot) => depot.emit)

  // The phase a reopen is waiting on, and `null` when nothing is. Mount is
  // the reset — `ui/`'s primitives have no `open` prop, so a caller writes
  // `{open && <PhaseSheet …/>}` and a declined reopen cannot come back on the
  // next open.
  const [reopenTo, setReopenTo] = useState<PhaseKey | null>(null)

  const current = phaseOf(trip)
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
    move(phase)
  }

  return (
    <Sheet title="Set phase" onClose={onClose} desktopCard>
      {!known && (
        // §3.4: the value is drawn **exactly as it arrived**, because
        // inventing a casing for it would be coercion by another name
        // (`sync-protocol.md` §5.3, obligation 4). `phaseLabel` is what
        // returns it unchanged, so the rule stays in one place. The five rows
        // stay tappable underneath, which is what keeps a Trip from being
        // stranded in a phase this build cannot leave.
        <p className={styles['unknown']}>● NOW — {phaseLabel(current)}</p>
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
    </Sheet>
  )
}

/**
 * **Reopening a closed Trip is a decision**, so it goes through `Confirm`
 * rather than `Sheet`: the scrim does not dismiss it, which is the right
 * default for the one backward move that makes settled history live again.
 *
 * The confirmation is S6's even though the boards draw it beside things S6
 * cannot produce. Invariant 19 is a **domain** rule — leaving `closed` is a
 * deliberate, confirmed act, the same weight as deleting a trip — and S6 is
 * the slice that makes leaving `closed` possible at all; shipping the move
 * without the confirm would leave an invariant violated for five slices
 * (spec §6.3).
 *
 * What ships is the board's title and its second line, both true today and
 * true afterwards. The two mono blocks under them belong to other slices:
 * `1 ENTRY STILL OPEN — HEADLAMP, K · ▲ LOST` needs **S10**'s outcomes, and
 * the over-claim block needs **S7**'s Entries; architecture §8.3 gives
 * **S11** the reopen clause that fills the body from them. Neither block is
 * faked and neither is stubbed — an empty body states nothing false, while a
 * hard-coded count would.
 *
 * **The line names the phase the move goes to**, which is the one place this
 * departs from the board's drawn sentence. The board draws the reopen from a
 * closed ledger row, which targets `unpack` and reads *"It returns to Unpack
 * …"*; the SET PHASE sheet offers all four other rows, because invariant 16
 * makes every move expressible in either direction and the boards' own
 * footnote says any row is tappable. So the copy generalises rather than the
 * behaviour narrowing, and the word comes from the phase table
 * ({@link phaseName}) rather than from a casing rule invented at this screen.
 *
 * The primary stays **accent** rather than the attention colour a destructive
 * confirm carries: nothing was thrown away. The body says so.
 */
function ReopenConfirm({
  trip,
  to,
  onCancel,
  onConfirm,
}: {
  trip: TripState
  /** The phase the Trip is being reopened into — never `closed`. */
  to: PhaseKey
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Confirm
      // `tripLabel` is the one place a Trip's name is decided, so a Trip whose
      // `trip.created` has not arrived reads `Reopen —?` rather than
      // `Reopen ?`.
      title={`Reopen ${tripLabel(trip)}?`}
      description={`It returns to ${phaseName(to)} exactly as it stood. Closing cleared nothing.`}
      onClose={onCancel}
      actions={
        <>
          <Confirm.Cancel>
            <button type="button" className={styles['ghost']}>
              Cancel
            </button>
          </Confirm.Cancel>
          <Confirm.Action>
            <button
              type="button"
              className={styles['primary']}
              onClick={onConfirm}
            >
              Reopen
            </button>
          </Confirm.Action>
        </>
      }
    />
  )
}
