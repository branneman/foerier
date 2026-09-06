import {
  entriesOf,
  tripLabel,
  unpackTotals,
  type UnpackCount,
} from '@foerier/shared'
import { useMemo } from 'react'
import { useParams } from 'wouter'

import { useHousehold } from '../household/store'
import { openLabel, resolvedLabel, resolvedPercent } from '../household/trips'
import { ScreenBand } from '../shell/ScreenBand'
import { useScreenHeader } from '../shell/useMediaQuery'
import styles from './Unpack.module.css'

/** `unpackTotals`' zero — the fold has nothing to fold before a Trip is
 * resolved, so the pre-guard memo below has an answer to hand back that is
 * not `unpackTotals` called on `undefined`. Never drawn: the guard below
 * returns before this value would reach the JSX. */
const EMPTY_COUNT: UnpackCount = {
  resolved: 0,
  total: 0,
  open: 0,
  back: 0,
  consumed: 0,
  lost: 0,
}

/**
 * **F5 — Unpack's shell** (`docs/design/README.md` §7, spec
 * `docs/specs/2026-09-05-unpack-resolve-and-close.md` §4.1–§4.2). This task
 * builds the frame seven later ones hang off: the route, the band, the
 * title, the count line, the bar and the empty state. The segmented control,
 * the `○ OPEN` filter, the hint, the groups, the three sheets, the
 * over-claim band and the close card are every one of them a later task's
 * scope and deliberately absent here.
 *
 * ## Its own route at every width, and reachable at every phase
 *
 * `Packing.tsx`'s own reasoning, restated for F5's route: F5 has no detail
 * pane to unlock at a wider viewport, and a phase locks nothing (invariant
 * 16), so hiding this route at any phase would be the soft lock the phase
 * model forbids.
 *
 * ## Every hook above the `No such trip.` guard
 *
 * `Packing.tsx`'s and `Trip.tsx`'s rule, for the identical reason (S7 review
 * F2): a control reachable against an unknown `tripId` would author an op
 * materialising a Trip no delete op can remove before S14.
 *
 * ## The back link survives Desktop
 *
 * `useScreenHeader({ splitPane: false, atDesktopSidebarCarriesDestination:
 * false })` — `Packing`'s own answer and the same reason: the 216px sidebar
 * names the Trips list, not this Trip, so the destination this screen's back
 * link points at is never already on the page.
 */
export function Unpack() {
  const params = useParams<{ id: string }>()
  const tripId = params.id
  const state = useHousehold((depot) => depot.state)
  const sync = useHousehold((depot) => depot.sync)
  const header = useScreenHeader({
    splitPane: false,
    // See the docstring: the sidebar carries `TRIPS`, never one Trip's name,
    // so this screen's own back link is owed at Desktop too.
    atDesktopSidebarCarriesDestination: false,
  })

  const trip = tripId === undefined ? undefined : state.trips[tripId]

  const totals = useMemo<UnpackCount>(
    () => (trip === undefined ? EMPTY_COUNT : unpackTotals(trip, state)),
    [trip, state],
  )

  if (tripId === undefined || trip === undefined) {
    return (
      <div className={styles['screen']}>
        <p className={styles['missing']}>No such trip.</p>
      </div>
    )
  }

  // `entriesOf` counts lines, which is what `0 ENTRIES.` says — F19's empty
  // register, `Packing.tsx`'s own reasoning transplanted: a Trip holding only
  // a trip-only Entry has a real `0/0` in `totals` and is not an empty list.
  const empty = entriesOf(trip, state).length === 0

  return (
    <div className={styles['screen']}>
      <ScreenBand
        header={header}
        back={{ href: `/trips/${tripId}`, label: tripLabel(trip) }}
        sync={sync}
        syncTestId="unpack-sync"
      />

      <h1 className={styles['title']}>Unpack</h1>

      {empty ? (
        // F19, `Packing.tsx`'s empty region word for word: a domain fact, not
        // a promise. The count line and the bar are absent, not zeroed — a
        // later task's controls, hint and close card go with them, for the
        // identical dead-affordance reason F4 already argues.
        <section className={styles['empty']}>
          <p className={styles['emptyCount']}>0 ENTRIES.</p>
          <p className={styles['emptySource']}>
            The gear list is built from the depot.
          </p>
        </section>
      ) : (
        <>
          <div className={styles['counts']}>
            {/* Composed by `resolvedLabel`/`openLabel` (`household/trips.ts`)
                rather than here, for `packedLabel`'s own reason: a later task
                reuses these two, and two spellings of `● 56/62 RESOLVED`
                is exactly the drift this codebase refuses. */}
            <span className={styles['resolved']}>{resolvedLabel(totals)}</span>
            <span className={styles['open']}>{openLabel(totals)}</span>
          </div>

          {/* `aria-hidden`, because the line immediately above states the
              identical fact in words and in the ledger's own vocabulary —
              `Packing.tsx`'s own reason for withholding a `progressbar`
              role here. */}
          <div
            className={styles['bar']}
            data-testid="unpack-bar"
            aria-hidden="true"
          >
            <div
              className={styles['fill']}
              style={{ inlineSize: `${resolvedPercent(totals)}%` }}
            />
          </div>
        </>
      )}
    </div>
  )
}
