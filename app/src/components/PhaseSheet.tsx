import {
  isKnownPhase,
  overClaimsIfActive,
  phaseLabel,
  phaseOf,
  PHASES,
  tripEntryBringCountSet,
  tripEntryRemoved,
  tripLabel,
  tripPhaseMoved,
  type OverClaim,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { Confirm, Sheet } from '@foerier/ui'
import { useState } from 'react'

import { useDepot } from '../depot/store'
import { ConflictRows, overClaimGroups } from './OverClaimBand'
import styles from './PhaseSheet.module.css'
import { RemoveElsewhereConfirm } from './RemoveElsewhereConfirm'
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
 * **Entering `pack_out` from `draft` previews the over-claim band** — spec
 * §4.5's second guarded moment, {@link ActivationConfirm} below. Reopening's
 * three-line comment above states the general shape; activation is the same
 * shape a level earlier, since a Draft's own row is what triggers it rather
 * than an already-active phase's.
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
  // Whether the Draft → Pack-out preview is up. Set only when there is
  // something for it to show — see `choose` below.
  const [activating, setActivating] = useState(false)

  const current = phaseOf(trip)
  // The hypothetical `overClaimsIfActive` asks — spec §4.5: "what if `trip`
  // were active right now" — recomputed on every render exactly like
  // `Trip.tsx`'s own `overClaimsFor`, so a settle route taken from inside
  // `ActivationConfirm` shrinks this list live rather than waiting for a
  // remount.
  const activationOverClaims = overClaimsIfActive(state, trip.id)
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
    // Spec §4.5's second guarded moment, and only this one row: "starting
    // pack-out on a draft" is the domain's own phrase, not "activating a
    // draft into any active phase" — a Draft that jumps straight to `on_trip`
    // or `unpack` (any row is tappable, backwards included) is not a case
    // either the spec or a board draws, and this stays exactly as narrow as
    // both. Skipped entirely when there is nothing to warn about: "never
    // blocks" also means never adding a screen nobody needs.
    if (
      current === 'draft' &&
      phase === 'pack_out' &&
      activationOverClaims.length > 0
    ) {
      setActivating(true)
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

      {activating && (
        <ActivationConfirm
          trip={trip}
          overClaims={activationOverClaims}
          onCancel={() => setActivating(false)}
          onConfirm={() => move('pack_out')}
        />
      )}
    </Sheet>
  )
}

interface ActivationConfirmProps {
  readonly trip: TripState
  readonly overClaims: readonly OverClaim[]
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/**
 * **The `Start pack-out` preview** — spec §4.5's second sheet, `Screens
 * B:829-865`'s "Start pack-out — over-claim" frame. Stays local to this
 * module rather than becoming its own file the way {@link ReopenConfirm}
 * did: this confirm has exactly one caller, and `ReopenConfirm`'s own
 * docstring is explicit that two callers is what earned it a module of its
 * own.
 *
 * Anatomy is `Confirm`'s `SignOutThisDeviceSheet` shape: the ▲ block goes in
 * `children`, rendered between the title and `description`, which is exactly
 * "above the body" (spec's own words). The block itself is
 * `OverClaimBand`'s own two building blocks — `overClaimGroups` for the
 * copy, `ConflictRows` for the rows — so the one-trip/N-trip line and the
 * settle-route rules are read from one place rather than re-derived here.
 *
 * **`overClaims` arrives as a prop**, `OverClaimBand`'s own contract: the
 * caller decides which question it is asking (`overClaimsFor` for the
 * standing band, `overClaimsIfActive` for this hypothetical), and this
 * component never re-derives it.
 *
 * **The settle routes are live, not decorative.** `REMOVE HERE` and
 * `BRING ×N HERE` write against `trip.id` directly, exactly as `Trip.tsx`'s
 * own handlers do for the standing band — there being two Trips involved
 * doesn't change that this Trip's own aggregate is one write away.
 * `REMOVE ON <trip>` writes against a *different* Trip's aggregate, so it
 * goes through {@link RemoveElsewhereConfirm} exactly as the band's own
 * route does, nested inside this sheet rather than duplicated: a dead
 * `REMOVE ON` button would be worse than the one extra `useState`.
 *
 * **The primary is `Start pack-out`, filled accent, never attention** — the
 * over-claim colour stays on the block above it; starting pack-out is not
 * itself an alarming act, and nothing is discarded to do it.
 */
function ActivationConfirm({
  trip,
  overClaims,
  onCancel,
  onConfirm,
}: ActivationConfirmProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)

  // The Entry a `REMOVE ON <trip>` is waiting to confirm, and `null` when
  // nothing is — the same shape `Trip.tsx` keeps for its own standing band.
  const [removingElsewhere, setRemovingElsewhere] = useState<{
    otherTripId: string
    entryId: string
  } | null>(null)

  const groups = overClaimGroups(overClaims, trip.id, state)

  function handleRemoveHere(entryId: string) {
    emit(tripEntryRemoved(trip.id, entryId))
  }

  function handleBringFewer(entryId: string, count: number) {
    emit(tripEntryBringCountSet(trip.id, entryId, count))
  }

  function handleRemoveThere(otherTripId: string, entryId: string) {
    setRemovingElsewhere({ otherTripId, entryId })
  }

  return (
    <>
      <Confirm
        variant="sheet"
        title={`Start pack-out — ${tripLabel(trip)}?`}
        description="Starting warns, never blocks. Nothing is removed unless you choose it."
        onClose={onCancel}
        actions={
          <>
            <Confirm.Action>
              <button
                type="button"
                className={styles['activatePrimary']}
                onClick={onConfirm}
              >
                Start pack-out
              </button>
            </Confirm.Action>
            <Confirm.Cancel>
              <button type="button" className={styles['activateGhost']}>
                Cancel
              </button>
            </Confirm.Cancel>
          </>
        }
      >
        {groups.map((group) => (
          <div key={group.line} className={styles['activateSegment']}>
            <p
              className={styles['activateAttention']}
              data-testid="over-claim-attention"
            >
              {group.line}
            </p>
            <ConflictRows
              tripId={trip.id}
              overClaims={group.overClaims}
              onRemoveHere={handleRemoveHere}
              onRemoveThere={handleRemoveThere}
              onBringFewer={handleBringFewer}
            />
          </div>
        ))}
      </Confirm>

      {removingElsewhere !== null && (
        <RemoveElsewhereConfirm
          otherTripId={removingElsewhere.otherTripId}
          entryId={removingElsewhere.entryId}
          onClose={() => setRemovingElsewhere(null)}
        />
      )}
    </>
  )
}
