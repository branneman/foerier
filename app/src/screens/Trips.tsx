import {
  tripLabel,
  tripPhaseMoved,
  tripSections,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { useMemo, useState } from 'react'
import { Link } from 'wouter'

import { PhaseSheet } from '../components/PhaseSheet'
import { ReopenConfirm } from '../components/ReopenConfirm'
import { TripCard } from '../components/TripCard'
import { useDepot } from '../depot/store'
import { tripStartMonth } from '../depot/trips'
import styles from './Trips.module.css'

/**
 * The phase the closed ledger row's `REOPEN` moves a Trip to — the one it was
 * in when it was closed, and the one the board's sentence names. The SET PHASE
 * sheet is where the other three are reachable.
 *
 * **One constant because two authors of it is one edit away from a lie.** The
 * confirm's sentence is parameterised by this (`It returns to Unpack exactly
 * as it stood`) and the op writes it; everywhere else in this screen the word
 * the user reads and the value written are already the same variable, and
 * spelling it twice here would let a change to the copy name a phase the op
 * does not write.
 */
const REOPEN_TO: PhaseKey = 'unpack'

/**
 * **Trips** — `Screens B` §02's phone frame and `Screens A` §04's `Trips roomy
 * — cards 2-up`, and the second of the app's four destinations to become a
 * screen rather than a line of placeholder text.
 *
 * ## The section names are the selector's, not the screen's
 *
 * `tripSections` partitions into `active`, `planned` and `closed`, but the
 * board draws a header for **`CLOSED` alone**: the active card and the draft
 * card sit under the title with nothing between them, because a header over a
 * single card is noise. So `ACTIVE` and `PLANNED` are how the state is
 * partitioned and `CLOSED` is the only drawn copy (spec §4.1).
 *
 * That is also why the two forward sections render into **one** list. The
 * board's Roomy excerpt puts the active card and the dashed card side by side
 * in a single 2-up grid, which two adjacent grids could not do — the second
 * would start its own row. Their partition survives in DOM order and in each
 * card's `variant`, which is what actually distinguishes them.
 *
 * ## Nothing constrains `active` to one
 *
 * The boards draw a single active card because their scenario has one Trip
 * under way. Over-claim is guarded rather than prevented (spec §5.2), so two
 * active Trips are a reachable and legitimate state and this renders N cards.
 * A screen that special-cased the first would drop the rest silently.
 *
 * ## The sheets are the screen's, not the card's
 *
 * `ui/`'s primitives have no `open` prop — mounted is open — so a caller
 * writes `{open && <Sheet …/>}` and mount is what resets a sheet's own drafts
 * (`docs/specs/2026-08-29-radix-conversion.md`). A card that owned its sheet
 * would put one per Trip in the tree; instead each card asks, and the id of
 * whichever Trip asked is what this holds.
 */
export function Trips() {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)

  // Memoed on the fold, as `Depot` memoes `depotCounts`: the partition and its
  // two orders are pure functions of the state, and the store hands out a new
  // object only when the fold actually changed.
  const sections = useMemo(() => tripSections(state), [state])

  const [phaseTripId, setPhaseTripId] = useState<string | null>(null)
  const [reopenTripId, setReopenTripId] = useState<string | null>(null)

  // Held by id and looked up again on each render, never held as an object: a
  // Trip captured in state would go stale the moment a pulled op moved its
  // phase, and the sheet would then draw `● NOW` against a phase the Trip has
  // left. `undefined` is reachable only through S14's delete, and unmounts.
  const phaseTrip = phaseTripId === null ? undefined : state.trips[phaseTripId]
  const reopenTrip =
    reopenTripId === null ? undefined : state.trips[reopenTripId]

  // The two forward sections, flattened into one list that remembers which
  // section each Trip came out of. The variant travels with the Trip rather
  // than being asked for again at the card: `isActive` is the only definition
  // of active-ness in the codebase and `tripSections` has already asked it.
  const cards: readonly { trip: TripState; variant: 'active' | 'planned' }[] = [
    ...sections.active.map((trip) => ({ trip, variant: 'active' as const })),
    ...sections.planned.map((trip) => ({ trip, variant: 'planned' as const })),
  ]
  const nothing = cards.length === 0 && sections.closed.length === 0

  return (
    <div className={styles['screen']}>
      <div className={styles['titleRow']}>
        <h1 className={styles['title']}>Trips</h1>
        {/* F3's first step is its own screen, following Add gear: the flow is
            labelled desk work, dense picker, keyboard-friendly. */}
        <Link href="/trips/new" className={styles['new']}>
          + NEW
        </Link>
      </div>

      {nothing ? (
        <p className={styles['empty']}>No trips.</p>
      ) : (
        <>
          {cards.length > 0 && (
            <ul className={styles['cards']}>
              {cards.map(({ trip, variant }) => (
                <li
                  key={trip.id}
                  className={styles['cardItem']}
                  data-testid="trip-entry"
                  data-trip={trip.id}
                >
                  <TripCard
                    trip={trip}
                    variant={variant}
                    onOpenPhase={() => setPhaseTripId(trip.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          {sections.closed.length > 0 && (
            <>
              <h2 className={styles['sectionHead']}>CLOSED</h2>
              <ul className={styles['rows']}>
                {sections.closed.map((trip) => (
                  <ClosedRow
                    key={trip.id}
                    trip={trip}
                    onReopen={() => setReopenTripId(trip.id)}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {phaseTrip !== undefined && (
        <PhaseSheet trip={phaseTrip} onClose={() => setPhaseTripId(null)} />
      )}

      {reopenTrip !== undefined && (
        <ReopenConfirm
          trip={reopenTrip}
          to={REOPEN_TO}
          onCancel={() => setReopenTripId(null)}
          onConfirm={() => {
            emit(tripPhaseMoved(reopenTrip.id, REOPEN_TO))
            setReopenTripId(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * A closed Trip is a **ledger row**, not a card: muted name, mono meta, and a
 * `REOPEN` — "closing clears nothing, so a trip closed too early, or one whose
 * lost gear turns up months later, returns to Unpack exactly as it stood".
 *
 * The board's meta reads `JUL 2025 · 54 PIECES · 1 LOST`. The two counts need
 * S7's Entries and S10's outcomes; the date is the segment that exists today,
 * and a Trip with no start date carries no meta rather than a fabricated one.
 */
function ClosedRow({
  trip,
  onReopen,
}: {
  trip: TripState
  onReopen: () => void
}) {
  const label = tripLabel(trip)
  const meta = tripStartMonth(trip)

  return (
    <li className={styles['row']} data-testid="trip-entry" data-trip={trip.id}>
      <Link
        href={`/trips/${trip.id}`}
        className={styles['rowMain']}
        // Named for what it does *and* which Trip it does it to, so the link
        // and the `REOPEN` beside it are two distinguishable controls on one
        // row rather than a bare name and a bare verb.
        aria-label={`Open ${label}`}
      >
        <span className={styles['rowName']}>{label}</span>
        {meta !== null && (
          <span
            className={styles['rowMeta']}
            data-testid={`closed-meta-${trip.id}`}
          >
            {meta}
          </span>
        )}
      </Link>

      <button
        type="button"
        className={styles['reopen']}
        // A list of rows whose buttons all read `REOPEN` is unnavigable by
        // control list, and reopening is the one action on this screen that
        // needs saying which Trip it is about before it is pressed.
        aria-label={`Reopen ${label}`}
        onClick={onReopen}
      >
        <span>REOPEN</span>
        <span className={styles['chevron']} aria-hidden="true">
          ›
        </span>
      </button>
    </li>
  )
}
