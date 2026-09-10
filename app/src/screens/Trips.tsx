import {
  listTotals,
  packingTotals,
  phaseOf,
  reopenTrip,
  tripLabel,
  tripNameOrUnnamed,
  tripSections,
  unaccountedOf,
  unpackTotals,
  type PhaseKey,
  type TripState,
} from '@foerier/shared'
import { useMemo, useState } from 'react'
import { Link } from 'wouter'

import { pieceLabel } from '../components/GearListSection'
import { PhaseSheet } from '../components/PhaseSheet'
import { ReopenConfirm } from '../components/ReopenConfirm'
import { TripCard } from '../components/TripCard'
import type { PersonRow } from '../household/people'
import { useHousehold } from '../household/store'
import {
  lostLabel,
  packingProgress,
  tripHasUnaccounted,
  tripParticipants,
  tripStartMonth,
  unpackProgress,
  type ProgressLine,
} from '../household/trips'
import { SPLIT, useMediaQuery } from '../shell/useMediaQuery'
import styles from './Trips.module.css'
import { PRINT_HIDDEN } from '../print'

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
 *
 * ## The new-trip step is the Depot's FAB
 *
 * "The Trips list gains the Depot's 56px FAB as `+ NEW`'s drawn control (F3
 * had the step, no frame)." It goes exactly where `Depot`'s goes, at the same
 * widths: **the FAB accompanies the bottom tab bar**, so it is drawn from
 * Compact through Roomy and withheld from Split up, where the nav is a rail
 * or a sidebar and there is no bar for a floating button to clear. From
 * Split up the title row carries the step instead, as `Depot`'s carries
 * `+ Add gear` (`docs/design/README.md` §5).
 */
export function Trips() {
  const state = useHousehold((depot) => depot.state)
  const emitAll = useHousehold((depot) => depot.emitAll)
  const isSplit = useMediaQuery(SPLIT)

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
  // Named `reopenTarget`, not `reopenTrip`: `reopenTrip` is the gesture this
  // screen emits through, and one name for both would let a rename land the
  // bare `trip.phase_moved` this screen used to emit straight back.
  const reopenTarget =
    reopenTripId === null ? undefined : state.trips[reopenTripId]

  // The two forward sections, flattened into one list that remembers which
  // section each Trip came out of. The variant travels with the Trip rather
  // than being asked for again at the card: `isActive` is the only definition
  // of active-ness in the codebase and `tripSections` has already asked it.
  //
  // `entryCount` rides along the same way: `TripCard` does not call
  // `listTotals` itself (§5's `ui/` rule against a component reading the
  // store), so the screen reads it once per Trip and hands down the number.
  // `participants` joins it here — it was the card's one remaining store
  // read, and lifting it is what makes the card props-in: §5.2's bar is that
  // a read a parent already has, or could pass, is lifted, and this screen
  // holds the fold either way.
  //
  // `buildListHref` too: below Split the trip screen *is* the editor
  // (`/trips/:id`); from Split up the builder is (`/trips/:id/list`, with
  // `?from=trips` for `GearListBuilder.tsx`'s own door). `TripCard` asks no
  // media query of its own — `isSplit` above is this screen's, already read
  // for the `+ NEW` slot — so the resolved route arrives as a plain prop,
  // same as the count.
  //
  // Fix round F5. Memoed the way `sections` above is: `listTotals` →
  // `entriesOf` sorts, and its comparator resolves `entryLabel` (a Depot
  // lookup plus `foldText`) per comparison — unmemoed, that ran again on
  // every render, including `setPhaseTripId`/`setReopenTripId` clicks that
  // touch neither `state` nor `isSplit`. `entryCount` is `0`, uncomputed,
  // on the active card: `TripCard` draws the count for `planned` only, so
  // an active Trip's `listTotals` call priced a sort nobody was going to
  // read.
  // `progress` is `entryCount`'s mirror: read for the `active` section and
  // nothing goes down with a `planned` card, exactly as the entry count is
  // read for `planned` and passed as an uncomputed `0` on the active one.
  // Ruling A11's "on Active cards only" is stated at both ends — `TripCard`
  // draws it for the `active` variant alone — and neither end re-derives
  // active-ness: this is `tripSections`' own partition, which asked
  // `isActive` once, and `isActive` is the codebase's one definition of it.
  //
  // **F13: which totals table applies is `phaseOf`'s question, asked once
  // here.** `unpackTotals` at Unpack, `packingTotals` at every other Active
  // phase (Pack-out, On trip) — `packingProgress`/`unpackProgress`
  // (`household/trips.ts`) then compose the identical `ProgressLine` shape
  // from either table, so `TripCard` draws one prop and asks no `shared/`
  // function of its own.
  const cards: readonly {
    trip: TripState
    variant: 'active' | 'planned'
    entryCount: number
    participants: readonly PersonRow[]
    buildListHref: string
    progress?: ProgressLine
  }[] = useMemo(
    () => [
      ...sections.active.map((trip) => ({
        trip,
        variant: 'active' as const,
        entryCount: 0,
        participants: tripParticipants(state, trip),
        buildListHref: isSplit
          ? `/trips/${trip.id}/list?from=trips`
          : `/trips/${trip.id}`,
        progress:
          phaseOf(trip) === 'unpack'
            ? unpackProgress(unpackTotals(trip, state))
            : packingProgress(packingTotals(trip, state)),
      })),
      ...sections.planned.map((trip) => ({
        trip,
        variant: 'planned' as const,
        entryCount: listTotals(trip, state).entries,
        participants: tripParticipants(state, trip),
        buildListHref: isSplit
          ? `/trips/${trip.id}/list?from=trips`
          : `/trips/${trip.id}`,
      })),
    ],
    [sections, state, isSplit],
  )
  const nothing = cards.length === 0 && sections.closed.length === 0

  // Same fix, for the CLOSED ledger's per-row reads: keyed by id rather
  // than held as a parallel array, since `ClosedRow` looks its own Trip up
  // by id below. F18 adds `lost` (`unpackTotals(trip, state).lost`, a
  // Trip's own history) and `attention` (`tripHasUnaccounted`, the live
  // standing) beside the piece count `listTotals` already supplied.
  //
  // **`unaccountedOf(state)` is read once**, above the map, and shared
  // across every closed row rather than let `tripHasUnaccounted` call it
  // once per row (review I5). That function is a full walk of every
  // visible Trip's Entries with a per-comparison label sort behind it —
  // `unaccountedOf`'s own docstring says it is meant to be called once per
  // fold, `whereabouts.ts`'s own memo the precedent for taking that
  // literally — and fifteen closed Trips calling it fifteen times inside
  // this map would be fifteen full-household walks on every render this
  // memo re-runs.
  //
  const closedMeta = useMemo(() => {
    const standings = unaccountedOf(state)
    return new Map(
      sections.closed.map((trip) => [
        trip.id,
        {
          pieces: listTotals(trip, state).pieces,
          lost: unpackTotals(trip, state).lost,
          attention: tripHasUnaccounted(trip, standings),
        },
      ]),
    )
  }, [sections, state])

  return (
    // A fragment, because the FAB is the screen's **sibling** — see the note
    // beside it below.
    <>
      <div className={styles['screen']} data-testid="trips-screen">
        <div className={styles['titleRow']}>
          <h1 className={styles['title']}>Trips</h1>
          {isSplit && (
            // The `+` is decoration; this and the FAB it stands in for below
            // Split are the same action, so they carry the same accessible
            // name — `Depot`'s rule for the same pair.
            <Link
              href="/trips/new"
              className={styles['new']}
              aria-label="New trip"
              {...PRINT_HIDDEN}
            >
              + New trip
            </Link>
          )}
        </div>

        {nothing ? (
          <p className={styles['empty']}>No trips.</p>
        ) : (
          <>
            {cards.length > 0 && (
              <ul className={styles['cards']}>
                {cards.map(
                  ({
                    trip,
                    variant,
                    entryCount,
                    participants,
                    buildListHref,
                    progress,
                  }) => (
                    <li
                      key={trip.id}
                      className={styles['cardItem']}
                      data-testid="trip-entry"
                      data-trip={trip.id}
                    >
                      <TripCard
                        trip={trip}
                        variant={variant}
                        entryCount={entryCount}
                        participants={participants}
                        buildListHref={buildListHref}
                        progress={progress}
                        onOpenPhase={() => setPhaseTripId(trip.id)}
                      />
                    </li>
                  ),
                )}
              </ul>
            )}

            {sections.closed.length > 0 && (
              <>
                <h2 className={styles['sectionHead']}>CLOSED</h2>
                <ul className={styles['rows']}>
                  {sections.closed.map((trip) => {
                    // The fallback is unreachable — the memo is keyed off
                    // this same list.
                    const meta = closedMeta.get(trip.id) ?? {
                      pieces: 0,
                      lost: 0,
                      attention: false,
                    }
                    return (
                      <ClosedRow
                        key={trip.id}
                        trip={trip}
                        pieces={meta.pieces}
                        lost={meta.lost}
                        lostIsAttention={meta.attention}
                        onReopen={() => setReopenTripId(trip.id)}
                      />
                    )
                  })}
                </ul>
              </>
            )}
          </>
        )}

        {phaseTrip !== undefined && (
          <PhaseSheet
            trip={phaseTrip}
            onClose={() => setPhaseTripId(null)}
            // The sheet writes the op and reports; the close is this
            // screen's, as it is for every other overlay here (§5n K29).
            onPicked={() => setPhaseTripId(null)}
          />
        )}

        {reopenTarget !== undefined && (
          <ReopenConfirm
            trip={reopenTarget}
            to={REOPEN_TO}
            onCancel={() => setReopenTripId(null)}
            onConfirm={() => {
              // `reopenTrip` (`gestures.ts`) — every closed Trip may reopen
              // now (spec §5.1); this back-fills a posting for any Gear
              // this Trip's own close reduced before this register existed
              // (spec §5.2), then moves the phase.
              emitAll(
                reopenTrip(reopenTarget, REOPEN_TO, state),
                `REOPEN · ${tripLabel(reopenTarget)}`,
              )
              setReopenTripId(null)
            }}
          />
        )}
      </div>

      {!isSplit && (
        // F3's first step is its own screen, following Add gear: the flow is
        // labelled desk work, dense picker, keyboard-friendly.
        //
        // **Outside `.screen`, and that is load-bearing.** The button is
        // `position: sticky`, so it comes to rest where flow puts it — and it
        // has to rest at the foot of the shell's main area, whose bottom edge
        // is the tab bar's top edge. Inside `.screen` it would rest at the end
        // of that element's content box instead. The container `.screen`
        // declares stays either way: the 40rem query the cards fold on
        // resolves against it.
        <Link
          href="/trips/new"
          className={styles['fab']}
          aria-label="New trip"
          {...PRINT_HIDDEN}
        >
          +
        </Link>
      )}
    </>
  )
}

/**
 * A closed Trip is a **ledger row**, not a card: muted name, mono meta, and a
 * `REOPEN` — "closing clears nothing, so a trip closed too early, or one whose
 * lost gear turns up months later, returns to Unpack exactly as it stood".
 *
 * The board's meta reads `JUL 2025 · 54 PIECES · 1 LOST`. S7 supplies the
 * piece count — `listTotals(trip, state).pieces`, read once in `Trips()` and
 * handed down rather than read here, the same reason `TripCard`'s
 * `entryCount` arrives as a prop rather than a second store read in a
 * component with none of its own. S10 (F18) supplies `1 LOST`: the **number**
 * is `unpackTotals(trip, state).lost`, a Trip's own history and never
 * re-derived here; the **colour** is `lostIsAttention`
 * (`tripHasUnaccounted`, `household/trips.ts`) — attention while any of it
 * is still an active standing, muted once every one has been re-homed. Both
 * arrive as props for the identical reason the piece count already does:
 * this component reads no store of its own.
 *
 * Only the **date** segment and the **lost** segment can be absent — a Trip
 * closed with no start date drops the date, and zero lost drops the segment
 * the same way. The piece count is never absent: it is a real fold of
 * whatever Entries the Trip held, zero included, so the meta line no longer
 * disappears entirely the way it did before S7, when a missing date left
 * nothing else to show. `N CONSUMED` never joins any of them (F18) — a
 * closed ledger states what left the Depot for good and what is still
 * unaccounted for, not the whole of what came back.
 *
 * ## `REOPEN` is on every closed row (S11, spec §5.1)
 *
 * S10's `reopenBlocked` withheld this control on a Trip whose close lowered
 * an owned count, because re-closing it would have subtracted the
 * Consumed-count a second time. S11 (spec §2) makes the *close* correct
 * instead — it reads what this Trip has already posted before it ever
 * reduces again — so there is nothing left for a gate on this row to
 * prevent, and `NO REOPEN — COUNTS LOWERED AT CLOSE` retires with it. Every
 * closed Trip draws `REOPEN`.
 */
function ClosedRow({
  trip,
  pieces,
  lost,
  lostIsAttention,
  onReopen,
}: {
  trip: TripState
  pieces: number
  lost: number
  lostIsAttention: boolean
  onReopen: () => void
}) {
  const label = tripLabel(trip)
  // `TripCard`'s split, and this row is the strongest case for it: its
  // `REOPEN` opens `ReopenConfirm`, which has titled itself
  // `Reopen Unnamed trip?` since S6 — so a nameless closed row used to
  // announce `Reopen —` and then open a dialog calling the same Trip
  // something else, one tap apart. The visible `rowName` below stays the
  // glyph: a list column is exactly where `—` is right (§5c).
  const spokenName = tripNameOrUnnamed(trip)
  const month = tripStartMonth(trip)
  const meta = [month, pieceLabel(pieces)]
    .filter((part): part is string => part !== null)
    .join(' · ')
  const lostText = lostLabel(lost)

  return (
    <li className={styles['row']} data-testid="trip-entry" data-trip={trip.id}>
      <Link
        href={`/trips/${trip.id}`}
        className={styles['rowMain']}
        // Named for what it does *and* which Trip it does it to, so the link
        // and the `REOPEN` beside it are two distinguishable controls on one
        // row rather than a bare name and a bare verb.
        aria-label={`Open ${spokenName}`}
      >
        <span className={styles['rowName']}>{label}</span>
        {/* `pieceLabel` always returns a string, so `meta` is never empty —
            unlike the old date-only line, this row always has something to
            say. `1 LOST` is its own element rather than joined into the same
            text node: it is the one segment with a colour question, and a
            single text node could only colour all of the line or none of
            it — `TripCard`'s reversed-range `▲` is the same split. */}
        <span
          className={styles['rowMeta']}
          data-testid={`closed-meta-${trip.id}`}
        >
          {meta}
          {lostText !== null && (
            <>
              {' · '}
              <span
                className={
                  lostIsAttention ? styles['lostAttention'] : undefined
                }
              >
                {lostText}
              </span>
            </>
          )}
        </span>
      </Link>

      <button
        type="button"
        className={styles['reopen']}
        // A list of rows whose buttons all read `REOPEN` is unnavigable by
        // control list, and reopening is the one action on this screen that
        // needs saying which Trip it is about before it is pressed.
        aria-label={`Reopen ${spokenName}`}
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
