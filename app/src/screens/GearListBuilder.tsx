import {
  listTotals,
  phaseOf,
  tripEntryBringCountSet,
  tripEntryRemoved,
  tripLabel,
  type TripState,
} from '@foerier/shared'
import { Link, useSearch } from 'wouter'

import {
  entryCountLabel,
  GearListSection,
  pieceLabel,
} from '../components/GearListSection'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import { useScreenHeader } from '../shell/useMediaQuery'
import { DepotPicker } from './DepotPicker'
import styles from './GearListBuilder.module.css'

/**
 * **The builder** — `/trips/:id/list`, Split and up only
 * (`docs/specs/2026-08-29-the-gear-list.md` §4.4). Below Split the trip
 * screen (`Trip.tsx`) *is* the editor; from Split up editing moves here, into
 * two panes: the depot picker on the left, this Trip's own list — editable —
 * on the right.
 *
 * ## A media query, not a container query
 *
 * The two panes exist or they do not — `DepotView.tsx`'s own argument,
 * restated: rendering both to hide one would put every Entry in the
 * accessibility tree twice ([frontend-design §3.2](../../../docs/frontend-design.md)).
 * `440px | 1fr` at Desktop, `minmax(308px, 40%) | 1fr` at Split, 308px being
 * the pane width `GearRow` already folds inside — `DepotView.module.css`'s
 * own `19.25rem` list pane, reused verbatim.
 *
 * ## One band, housed in the right pane
 *
 * `DepotPicker`'s `'pane'` variant draws no header of its own — its own
 * docstring says so — because this screen draws **one** band (back link +
 * sync) for both panes together, per spec §4.4. It is drawn here, at the top
 * of the right pane's own column, rather than spanning both: the left pane
 * needs nothing above its `FROM THE DEPOT` eyebrow, and a full-width band
 * would separate that eyebrow from the search field beneath it for no reason.
 *
 * ## Two doors, one query param
 *
 * `BUILD LIST ›` on a Trips card (Task 13) gives `‹ TRIPS`; `EDIT LIST ›` on
 * the trip screen's section band (`Trip.tsx`) gives `‹ {label}`, the Trip's
 * own name — `InviteIssued`'s one-screen-three-doors shape (S5), the same
 * rule: where the link points is this screen's own decision, and whether it
 * is drawn at all is `useScreenHeader`'s.
 *
 * The door travels as `?from=trips` in the URL — `useSearch`, `Devices.tsx`'s
 * own precedent for a single-flag query param (`?signout`) rather than route
 * state, which wouter has no first-class carrier for across a navigation.
 * Its absence is the default: `Trip.tsx`'s `EDIT LIST ›` links here with no
 * query at all, so a bookmarked or directly-typed URL also falls back to the
 * "trip" door rather than to nothing. **Task 13's `BUILD LIST ›` is the only
 * caller expected to append it** — this task builds the mechanism and proves
 * it by navigating straight to the query string in its own tests, since
 * `TripCard.tsx` gains that link in a later task (spec's own plan, Task 13).
 *
 * ## `splitPane: false`, and why it agrees with the board rather than
 * conflicting
 *
 * The builder is two panes of *itself*, not a detail pane of a list also on
 * screen — `GearDetail` answers `true` because the Depot list sits beside it
 * and `Depot split` draws no back link at all, whereas the builder's own back
 * link is drawn at every width it exists at (spec §4.11). `useScreenHeader`
 * still computes `false` at Desktop for a `splitPane: false` screen — the
 * sidebar there carries `TRIPS`, the same destination `Trip.tsx` withholds
 * its own `‹ TRIPS` for — so this screen's back link goes at Split and not at
 * Desktop, exactly like every other `splitPane: false` screen. The board
 * draws `‹ TRIPS` at 1024 anyway because that frame is a bare pane with no
 * sidebar in the mockup; `docs/design/README.md` §5 names this "drawn but not
 * built" and calls it agreement rather than conflict, the same shape as
 * `Trips — split 900` and `Add gear — split 900` elsewhere in that doc.
 *
 * ## No `GEAR LIST` band, and no weight
 *
 * The band belongs to `Trip.tsx`, where it also hosts `EDIT LIST ›`'s
 * destination; this screen starts at the group bands `GearListSection`
 * draws and carries its own totals in the footer instead. `EST 48.2 KG` is
 * story 16, `LATER` — drawn nowhere here, header or footer, per spec §4.4.
 *
 * ## `Start pack-out` and the dashed row are documented no-ops
 *
 * `Start pack-out` renders for a Draft only (`phaseOf(trip) === 'draft'`) and
 * opens the over-claim preview Task 14 builds — over-claim moment #2, spec
 * §4.5. The dashed trip-only row opens `TripOnlySheet`, Task 12's — mirroring
 * `Trip.tsx`'s own identical row exactly, including the no-op. Both stay
 * documented no-ops rather than links to destinations that don't exist yet,
 * `Trip.tsx`'s own argument: a control that leads somewhere and lies about it
 * is worse than one that leads nowhere.
 */
export interface GearListBuilderProps {
  readonly tripId: string
}

export function GearListBuilder({ tripId }: GearListBuilderProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  // `splitPane: false` — see this file's own docstring on why that still
  // agrees with the board's `‹ TRIPS` at 1024 rather than conflicting with it.
  const header = useScreenHeader({ splitPane: false })
  const search = useSearch()
  const fromTrips = search === 'from=trips'

  // Every hook above runs regardless (S7 review F2's own guard, transplanted
  // from `DepotPicker.tsx`), so this early return costs nothing except the
  // work below it — exactly `Trip.tsx`'s and `DepotPicker.tsx`'s own
  // `No such trip.` guard, for the identical reason: a `+ ADD` or a stepper
  // reachable against an unknown `tripId` would author an op that
  // materialises a Trip no delete op can remove before S14.
  const trip: TripState | undefined = state.trips[tripId]

  if (trip === undefined) {
    return (
      <div className={styles['screen']} data-testid="gear-list-builder">
        <p className={styles['notFound']}>No such trip.</p>
      </div>
    )
  }

  const label = tripLabel(trip)
  const totals = listTotals(trip, state)
  const isDraft = phaseOf(trip) === 'draft'

  function handleBringCountChange(entryId: string, next: number) {
    emit(tripEntryBringCountSet(tripId, entryId, next))
  }

  // The tag-chip rule, restated for this pane: one op, the gear untouched,
  // re-adding two taps. Never confirms — `Trip.tsx`'s own `✕` handler,
  // duplicated rather than shared because the two screens have no component
  // in common to hold it.
  function handleRemoveEntry(entryId: string) {
    emit(tripEntryRemoved(tripId, entryId))
  }

  // Opens the over-claim preview Task 14 builds — over-claim moment #2, spec
  // §4.5. A documented no-op until then — see the task report.
  function handleStartPackOut() {}

  // Opens `TripOnlySheet` (Task 12). A documented no-op until then — mirrors
  // `Trip.tsx`'s own dashed row exactly. See the task report.
  function handleAddTripOnly() {}

  const backHref = fromTrips ? '/trips' : `/trips/${tripId}`
  const backLabel = fromTrips ? 'TRIPS' : label

  return (
    <div className={styles['split']} data-testid="gear-list-builder">
      <div className={styles['picker']}>
        <DepotPicker tripId={tripId} variant="pane" />
      </div>

      <div className={styles['builder']}>
        {header.band && (
          <header className={styles['header']}>
            {header.backLink && (
              <Link href={backHref} className={styles['back']}>
                ‹ {backLabel}
              </Link>
            )}
            {header.syncLine && (
              <span className={styles['sync']}>
                <span className={styles['syncDot']} aria-hidden="true" />
                {syncLabel(sync)}
              </span>
            )}
          </header>
        )}

        <div className={styles['titleRow']}>
          <h1 className={styles['title']}>{label} — gear list</h1>
          {isDraft && (
            <button
              type="button"
              className={styles['startPackOut']}
              onClick={handleStartPackOut}
            >
              Start pack-out
            </button>
          )}
        </div>

        <GearListSection
          trip={trip}
          editable
          onBringCountChange={handleBringCountChange}
          onRemove={handleRemoveEntry}
        />

        <button
          type="button"
          className={styles['tripOnlyRow']}
          onClick={handleAddTripOnly}
        >
          + TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE
        </button>

        <p className={styles['footer']} data-testid="gear-list-builder-footer">
          {entryCountLabel(totals.entries)} · {pieceLabel(totals.pieces)} ·{' '}
          {totals.perPerson} PER-PERSON · {totals.tripOnly} TRIP-ONLY
        </p>
      </div>
    </div>
  )
}
