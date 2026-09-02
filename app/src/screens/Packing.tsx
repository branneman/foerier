import {
  entriesOf,
  packingTotals,
  statusGlyph,
  tripLabel,
  type PackingCount,
} from '@foerier/shared'
import { useState } from 'react'
import { Link, useParams } from 'wouter'

import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import { useScreenHeader } from '../shell/useMediaQuery'
import styles from './Packing.module.css'

/**
 * How the list is partitioned: by the container it rides in, by whose it is,
 * or not at all. CONTAINER is the resting mode — the journey rail is the
 * screen's spine, and it lives on a container's own group header.
 */
type PackingMode = 'container' | 'person' | 'all'

const MODES: readonly { value: PackingMode; label: string }[] = [
  { value: 'container', label: 'CONTAINER' },
  { value: 'person', label: 'PERSON' },
  { value: 'all', label: 'ALL' },
]

/** The screen's one hint (ruling A9), and the whole of its instruction. */
const HINT =
  'TAP PILL = NEXT STATE · TAP CIRCLES = PER PERSON · TAP ROW = WHERE IT GOES'

/**
 * The bar's fill, as a percentage of the denominator the count line draws.
 *
 * `total === 0` is **reachable and not defensive**: ruling A5 excludes a
 * container from PIECES, so a Trip whose only Entries are containers has a
 * genuine `0/0` — a list with something on it and nothing to pack yet. An
 * empty bar is the honest paint for it.
 */
function percentOf(count: PackingCount): number {
  if (count.total === 0) return 0
  return Math.round((count.packed / count.total) * 100)
}

/**
 * **F4 — the screen the app lives on** (`docs/design/README.md` §1, spec
 * `docs/specs/2026-09-01-packing-and-the-journey.md` §4.1, §4.2 and §4.8).
 * This is its shell: the band, the title, the arithmetic, the two controls
 * and the one hint. The groups that hang beneath them are the next two
 * tasks — CONTAINER's rails and rows, then PERSON, ALL and the `○ LEFT`
 * filter's wiring.
 *
 * ## Its own route at every width, and not a pane
 *
 * `/trips/:id/packing` is width-gated by nothing, so `App.tsx` needs none of
 * the `isSplitOrWider ? <X/> : <Redirect/>` shape `/trips/:id/add` and
 * `/trips/:id/list` carry. **A packing row has no detail** — its two acts are
 * a pill and a sheet (ruling A2) — so there is no second pane for a wider
 * viewport to unlock, and ruling A10 caps the one column at 560 instead.
 *
 * ## It renders at every phase, Draft included
 *
 * A phase locks nothing (invariant 16, story 32), and **hiding a route is a
 * soft lock** the phase model forbids — the same reasoning that keeps every
 * editing capability available in every phase. The title is `Pack-out` at
 * every phase because it names the **activity**; the phase itself is already
 * stated on the card and the trip screen by a chip that is the control for
 * changing it, and a second copy of that fact here would be one nothing on
 * this screen can change.
 *
 * ## Every hook above the `No such trip.` guard
 *
 * `Trip.tsx`'s and `GearListBuilder.tsx`'s rule (S7 review F2), for the
 * identical reason: a control reachable against an unknown `tripId` would
 * author an op materialising a Trip that no delete op can remove before S14.
 * A Trip the fold has never seen is also a different fact from one that
 * exists and carries nothing — `state.trips[id]` is `undefined` for the
 * first and an entity with no registers for the second, which draws as an
 * ordinary unnamed Trip.
 *
 * ## The back link survives Desktop — and that is the flag's own reason
 *
 * `useScreenHeader({ splitPane: false, atDesktopSidebarCarriesDestination:
 * false })`, the **eleventh** caller. The flag has existed since S7, added
 * for `GearListBuilder`'s "trip" door, and **F4 needs no new rule**: the
 * 216px sidebar carries `TRIPS`, not `Alps 2026`, so the destination this
 * screen's link points at is not on the page and the link is owed at every
 * width.
 *
 * Worth stating outright, because this is the first screen where the flag's
 * *reason* is the **only** reason it applies — the builder passes it for one
 * of two doors and withholds it for the other, so a reader meeting F4 first
 * will otherwise read a Desktop back link as an exception to §3.3 rather
 * than as §3.3 answering the question it was written to answer. The sync
 * line is the ordinary rule: Split alone, where `AppShell` puts only a bare
 * 6px dot in the rail.
 *
 * ## What this screen does not draw
 *
 * **No over-claim band.** It is a property of the *gear list* — the trip
 * screen and the builder's right pane — and F4 is not the gear list. Two
 * Trips claiming one Piece is a fact about membership; this screen asks how
 * far along one Trip's own pack-out is.
 *
 * **No pinned footer bar and no `UNDO`** (ruling A9). `UNDO` is drawn and
 * not built — the third instance of the §3b/§3c precedent and the strongest,
 * because this screen holds the app's most tapped writes, so a reversal that
 * quietly weakens with time is worst on it and story 36 forbids exactly
 * that. With no action left the bar retires on the builder's own argument (a
 * read does not spend the thumb zone), and **the hint moves under the
 * controls row**, read once at the start rather than at the foot of
 * sixty-one rows.
 */
export function Packing() {
  const params = useParams<{ id: string }>()
  const tripId = params.id
  const state = useDepot((depot) => depot.state)
  const sync = useDepot((depot) => depot.sync)
  const header = useScreenHeader({
    splitPane: false,
    // See the docstring: the sidebar carries `TRIPS`, never one Trip's name,
    // so this screen's own back link is owed at Desktop too.
    atDesktopSidebarCarriesDestination: false,
  })

  // The two controls' own state. Both are drawn here and read by the groups
  // Tasks 10 and 11 add — `mode` chooses the partition, `leftOnly` filters
  // `!isPacked` in all three modes.
  const [mode, setMode] = useState<PackingMode>('container')
  const [leftOnly, setLeftOnly] = useState(false)

  const trip = tripId === undefined ? undefined : state.trips[tripId]

  if (tripId === undefined || trip === undefined) {
    return (
      <div className={styles['screen']}>
        <p className={styles['missing']}>No such trip.</p>
      </div>
    )
  }

  // `entriesOf` counts **lines**, which is what `0 ENTRIES.` says — not
  // `packingTotals`, which counts things that travel. The two differ on a
  // Trip holding only containers: ruling A5 excludes a container from PIECES
  // so the denominator stays reachable, so such a Trip has one Entry and no
  // pieces, and it is a list with something on it rather than an empty one.
  const empty = entriesOf(trip, state).length === 0
  const totals = packingTotals(trip, state)

  return (
    <div className={styles['screen']}>
      {header.band && (
        <header className={styles['header']}>
          {header.backLink && (
            <Link href={`/trips/${tripId}`} className={styles['back']}>
              ‹ {tripLabel(trip)}
            </Link>
          )}
          {header.syncLine && (
            <span className={styles['sync']} data-testid="packing-sync">
              <span className={styles['syncDot']} aria-hidden="true" />
              {syncLabel(sync)}
            </span>
          )}
        </header>
      )}

      <h1 className={styles['title']}>Pack-out</h1>

      {empty ? (
        /*
         * The trip screen's permanent fact, word for word: a domain fact and
         * not a promise — it is where a gear list comes from, true before
         * this slice and after it.
         *
         * **The count line and the bar are absent, not zeroed** — `● 0/0
         * PIECES` states an arithmetic nobody asked for. The controls and the
         * hint go with them, on the same argument carried one step: a
         * segmented control partitions a list, the pill filters one, and the
         * hint names three gestures on rows. With no rows all three are dead
         * affordances, which is exactly what spec §4.9 forbids when it argues
         * the `GEAR LIST` band draws no door to a screen that can only say
         * `0 ENTRIES.`. `Trip.tsx` takes the same shape — its empty region
         * replaces the `GEAR LIST` band, not merely the rows under it.
         */
        <section className={styles['empty']}>
          <p className={styles['emptyCount']}>0 ENTRIES.</p>
          <p className={styles['emptySource']}>
            The gear list is built from the depot.
          </p>
        </section>
      ) : (
        <>
          <div className={styles['counts']}>
            {/* The glyph is the packed marker from the one status table, not
                a literal: the numerator and the `●` state the same fact, and
                a ruling that repaints `packed` must not be able to leave them
                disagreeing. */}
            <span className={styles['packed']}>
              {`${statusGlyph('packed')} ${totals.packed}/${totals.total} PIECES`}
            </span>
            <span className={styles['left']}>{`${totals.left} LEFT`}</span>
          </div>

          {/* `aria-hidden`, because the line immediately above states the
              identical fact in words and in the ledger's own vocabulary. A
              `role="progressbar"` here would announce a third reading of one
              number — `FirstSync`'s bar earns its role by being the only
              statement of a percentage nothing else says. */}
          <div
            className={styles['bar']}
            data-testid="packing-bar"
            aria-hidden="true"
          >
            <div
              className={styles['fill']}
              style={{ inlineSize: `${percentOf(totals)}%` }}
            />
          </div>

          <div className={styles['controls']} data-testid="packing-controls">
            <fieldset className={styles['segmentedField']}>
              {/* No visible label on the board, so the group is named for
                  assistive technology alone — `ui/styles/utilities.css`'s own
                  recipe (`frontend-design.md` §4.1) rather than a fifth
                  hand-rolled copy of it. */}
              <legend className="visually-hidden">Group by</legend>
              <div className={styles['segmented']}>
                {MODES.map((option) => (
                  <label key={option.value} className={styles['segment']}>
                    <input
                      type="radio"
                      name="packing-mode"
                      value={option.value}
                      checked={mode === option.value}
                      onChange={() => setMode(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <button
              type="button"
              className={styles['filter']}
              aria-pressed={leftOnly}
              onClick={() => setLeftOnly(!leftOnly)}
            >
              ○ LEFT{leftOnly && <span aria-hidden="true"> ✕</span>}
            </button>
          </div>

          <p className={styles['hint']}>{HINT}</p>
        </>
      )}
    </div>
  )
}
