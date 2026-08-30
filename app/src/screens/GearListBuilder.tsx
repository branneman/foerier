import {
  listTotals,
  overClaimsIfActive,
  phaseOf,
  tripEntryBringCountSet,
  tripEntryRemoved,
  tripLabel,
  tripPhaseMoved,
  UNNAMED_PERSON,
  type TripState,
} from '@foerier/shared'
import { useState } from 'react'
import { Link, useSearch } from 'wouter'

import { ActivationConfirm } from '../components/ActivationConfirm'
import {
  entryCountLabel,
  GearListSection,
  pieceLabel,
} from '../components/GearListSection'
import { overClaimGroups } from '../components/OverClaimBand'
import { TripOnlySheet } from '../components/TripOnlySheet'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import { tripParticipants } from '../depot/trips'
import { DESKTOP, useMediaQuery, useScreenHeader } from '../shell/useMediaQuery'
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
 * ## Two headers, not one flattened across both widths
 *
 * Task 11's first draft drew one header — back link + sync — inside the
 * right pane's own column at every width, following spec §4.4's prose
 * literally ("Right pane, top to bottom: the band row…"). Review (S7 review
 * F1) found the boards disagree with that flattening: at 900 the band, title
 * and footer do all sit inside the right pane, but at 1024 the band and
 * title are a **full-width strip above the grid** (`Screens B:292-299`),
 * carrying the back link, the title, Participants, `N PIECES`, and
 * `Start pack-out` on one row, separated from the panes by its own rule —
 * `.deskHeader`, below. The footer stays right-pane at both widths; dates and
 * weight are the MVP-variant's own held-back segments (spec §4.4), so
 * neither is drawn in the strip either. `isDesktop` (not `useScreenHeader`'s
 * `band`) is what switches between the two layouts, since the strip's title
 * and Participants are content the pane header never carried at all.
 *
 * **Sync is not redrawn in the strip.** The board's own 1024 mockup states it
 * there because that frame draws no sidebar (`docs/design/README.md` §5: "a
 * bare pane has no sidebar to carry it") — but the app's actual Desktop
 * shell always draws the labelled sidebar, which already states sync in
 * words, the same reason every other `splitPane: false` screen withholds its
 * own sync line at Desktop ([frontend-design §3.3](../../../docs/frontend-design.md)).
 * Redrawing it here would say the same fact twice on the one composed page,
 * exactly the defect `screenBand.test.tsx` exists to catch. Not requested by
 * review; recorded here since it is a real per-element decision this task
 * took rather than one review made for it.
 *
 * ## One band, housed in the right pane at Split
 *
 * At Split, `DepotPicker`'s `'pane'` variant draws no header of its own —
 * its own docstring says so — because this screen draws **one** band (back
 * link + sync) for both panes together, per spec §4.4. It is drawn at the
 * top of the right pane's own column there, rather than spanning both: the
 * left pane needs nothing above its `FROM THE DEPOT` eyebrow, and a
 * full-width band would separate that eyebrow from the search field beneath
 * it for no reason. At Desktop the strip above takes over this role instead.
 *
 * ## Two doors, one query param, and one asymmetric back link
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
 * Read with `URLSearchParams`, not a raw string-equality check (S7 review,
 * "also fix" list) — `search === 'from=trips'` would silently misread
 * `?x=1&from=trips` as the trip door, a trap for Task 13, which owns
 * appending it and may one day compose it with another param. Its absence is
 * the default: `Trip.tsx`'s `EDIT LIST ›` links here with no query at all,
 * so a bookmarked or directly-typed URL also falls back to the "trip" door
 * rather than to nothing. **Task 13's `BUILD LIST ›` is the only caller
 * expected to append it** — this task builds the mechanism and proves it by
 * navigating straight to the query string in its own tests, since
 * `TripCard.tsx` gains that link in a later task (spec's own plan, Task 13).
 *
 * **`splitPane: false`, but the back link's Desktop answer is not derived
 * from width alone (S7 review F4).** §3.3's rule — "the back link is drawn
 * unless its destination is already on the page" — used `splitPane` as a
 * proxy for that question, sound for every caller before this one because
 * each has exactly one back link and it always names a sidebar row (`‹
 * DEPOT`, `‹ TRIPS`, `‹ ACCOUNT`). This screen is the first where the proxy
 * fails: the `?from=trips` door's `‹ TRIPS` names the sidebar's own `TRIPS`
 * row (withheld at Desktop, same as every other caller), but the "trip"
 * door's `‹ {label}` names one specific Trip, which no sidebar row ever
 * carries (kept at Desktop). `useScreenHeader` takes an explicit
 * `atDesktopSidebarCarriesDestination` for exactly this — `fromTrips` here,
 * so the "trips" door still withholds and the "trip" door still shows.
 *
 * ## No `GEAR LIST` band, and no weight
 *
 * The band belongs to `Trip.tsx`, where it also hosts `EDIT LIST ›`'s
 * destination; this screen starts at the group bands `GearListSection`
 * draws and carries its own totals in the footer instead. `EST 48.2 KG` is
 * story 16, `LATER` — drawn nowhere here, header or footer, per spec §4.4.
 *
 * ## `Start pack-out` opens `ActivationConfirm`, or moves directly
 *
 * `Start pack-out` renders for a Draft only (`phaseOf(trip) === 'draft'`) —
 * over-claim moment #2, spec §4.5. Task 14 built `ActivationConfirm`
 * (`components/ActivationConfirm.tsx`) as `PhaseSheet`'s own preview and left
 * this button a documented no-op; Task 14's fix round wires it, since the
 * builder is the only place `Start pack-out` is ever reachable at Split and
 * above (the phone frame draws no such button at all, spec §4.4) and no
 * later task in this slice touches `app/`. Exactly `PhaseSheet.tsx`'s own
 * gate: `overClaimGroups(overClaimsIfActive(state, tripId), tripId, state)`
 * decides whether there is anything to preview, and a Draft with nothing to
 * warn about moves straight to `pack_out` — "never blocks" also means never
 * adding a screen nobody needs.
 *
 * The dashed trip-only row opens `TripOnlySheet` (Task 12), mirroring
 * `Trip.tsx`'s own identical row — that sheet owns its own
 * `trip.entry_added` emit, so this screen only opens it.
 */
export interface GearListBuilderProps {
  readonly tripId: string
}

export function GearListBuilder({ tripId }: GearListBuilderProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  const isDesktop = useMediaQuery(DESKTOP)
  const [tripOnlyOpen, setTripOnlyOpen] = useState(false)
  // Whether the Draft → Pack-out preview is up — `PhaseSheet.tsx`'s own
  // field of the same name and the same reason: set only when there is
  // something for `handleStartPackOut` to show.
  const [activating, setActivating] = useState(false)
  const search = useSearch()
  const fromTrips = new URLSearchParams(search).get('from') === 'trips'
  // `splitPane: false` — see this file's own docstring on the two-doors
  // section for why `atDesktopSidebarCarriesDestination` is not left at its
  // default here (S7 review F4).
  const header = useScreenHeader({
    splitPane: false,
    atDesktopSidebarCarriesDestination: fromTrips,
  })

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
  const participants = tripParticipants(state, trip)
  // `PhaseSheet.tsx`'s own gate, verbatim: the **filtered** block, not the
  // raw `overClaimsIfActive`, decides whether there is anything to preview
  // (Task 14 review F1) — `overClaimsIfActive` is deliberately unscoped to
  // `tripId` and can report a conflict naming two other Trips entirely.
  const activationGroups = overClaimGroups(
    overClaimsIfActive(state, trip.id),
    trip.id,
    state,
  )

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

  // Over-claim moment #2, spec §4.5 — `PhaseSheet.tsx`'s own `choose`,
  // narrowed to the one transition this button ever offers (`isDraft` already
  // gates the button's very existence, so there is no `current` to branch
  // on here).
  function handleStartPackOut() {
    if (activationGroups.length > 0) {
      setActivating(true)
      return
    }
    emit(tripPhaseMoved(tripId, 'pack_out'))
  }

  // Opens `TripOnlySheet`, which owns its own `trip.entry_added` emit —
  // mirrors `Trip.tsx`'s own dashed row exactly.
  function handleAddTripOnly() {
    setTripOnlyOpen(true)
  }

  const backHref = fromTrips ? '/trips' : `/trips/${tripId}`
  const backLabel = fromTrips ? 'TRIPS' : label

  const backLinkElement = header.backLink && (
    <Link href={backHref} className={styles['back']}>
      ‹ {backLabel}
    </Link>
  )

  const startPackOutButton = isDraft && (
    <button
      type="button"
      className={styles['startPackOut']}
      onClick={handleStartPackOut}
    >
      Start pack-out
    </button>
  )

  // The right pane's own body — identical at both widths, so it is computed
  // once rather than duplicated across the two layouts below.
  const listBody = (
    <>
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
    </>
  )

  return (
    <div className={styles['screen']} data-testid="gear-list-builder">
      {isDesktop && (
        <header
          className={styles['deskHeader']}
          data-testid="gear-list-builder-desk-header"
        >
          {backLinkElement}
          <h1 className={styles['title']}>{label} — gear list</h1>
          {participants.length > 0 && (
            // `Trip.tsx`'s own cluster, read-only here: this screen edits the
            // gear list, not Participants, so there is no trailing `+` ghost.
            <span
              className={styles['circles']}
              role="img"
              aria-label={`Participants: ${participants
                .map((person) => person.label)
                .join(', ')}`}
            >
              {participants.map((person) => (
                <span
                  key={person.id}
                  className={styles['circle']}
                  aria-hidden="true"
                >
                  {person.label === UNNAMED_PERSON
                    ? ''
                    : person.label.charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
          )}
          <span
            className={styles['pieces']}
            data-testid="gear-list-builder-pieces"
          >
            {pieceLabel(totals.pieces)}
          </span>
          {startPackOutButton}
        </header>
      )}

      <div className={styles['split']}>
        <div className={styles['picker']}>
          <DepotPicker tripId={tripId} variant="pane" />
        </div>

        <div className={styles['builder']}>
          {!isDesktop && header.band && (
            <header className={styles['header']}>
              {backLinkElement}
              {header.syncLine && (
                <span className={styles['sync']}>
                  <span className={styles['syncDot']} aria-hidden="true" />
                  {syncLabel(sync)}
                </span>
              )}
            </header>
          )}

          {!isDesktop && (
            <div className={styles['titleRow']}>
              <h1 className={styles['title']}>{label} — gear list</h1>
              {startPackOutButton}
            </div>
          )}

          {listBody}
        </div>
      </div>

      {tripOnlyOpen && (
        <TripOnlySheet tripId={tripId} onClose={() => setTripOnlyOpen(false)} />
      )}

      {activating && (
        <ActivationConfirm
          trip={trip}
          groups={activationGroups}
          onCancel={() => setActivating(false)}
          onConfirm={() => {
            emit(tripPhaseMoved(tripId, 'pack_out'))
            setActivating(false)
          }}
        />
      )}
    </div>
  )
}
