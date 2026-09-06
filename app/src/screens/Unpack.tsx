import {
  bringCountOf,
  containmentView,
  countOfUnpack,
  entriesOf,
  entryKind,
  entryLabel,
  isContainerEntry,
  returnPathOf,
  subtreeOf,
  tripContainmentView,
  tripLabel,
  unpackDestinationOf,
  unpackItems,
  unpackTotals,
  visiblePlaces,
  type ContainmentView,
  type EntryState,
  type HouseholdState,
  type OutcomeValue,
  type TripContainmentView,
  type TripState,
  type UnpackCount,
  type UnpackItem,
} from '@foerier/shared'
import { useMemo } from 'react'
import { useParams } from 'wouter'

import { UnpackRow } from '../components/UnpackRow'
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

/** Task 12 and Task 14 wire the outcome sheet and the Home picker onto these
 * two targets; DESTINATION mode's rows exist before either sheet does, so
 * both callbacks are a stated no-op rather than an invented behaviour. */
function noop(): void {
  // Wired by Task 12 (`onOutcome`) and Task 14 (`onReHome`).
}

/** One row this task draws — `UnpackRow`'s props, minus the callbacks and
 * the cluster slot `Unpack.tsx` does not fill yet. */
interface UnpackRowData {
  readonly entryId: string
  readonly name: string
  readonly meta: string
  readonly outcome: OutcomeValue | null
  readonly units: number
  readonly tripOnly?: boolean
}

/** One of F3's groups — a room, `Loose`, or the closing `Trip-only` group. */
interface UnpackGroup {
  readonly key: string
  readonly name: string
  readonly subtitle?: string
  readonly muted?: boolean
  /** `4/5` for a room or `Loose`; a plain count for `Trip-only`, which has
   * no outcomes to fraction. */
  readonly countLabel: string
  /** `Trip-only`'s count is history, not arithmetic — one step fainter than
   * a room's or `Loose`'s `resolved/units` (`Unpack.module.css`'s
   * `.groupCountFaint`). */
  readonly countFaint?: boolean
  readonly rows: readonly UnpackRowData[]
}

const NO_GROUPS: readonly UnpackGroup[] = []

/**
 * The return path meta, in every form DESTINATION mode draws (spec §4.3,
 * ruling F6) — **the caller's job, not `UnpackRow`'s**, so the row stays a
 * component that draws what it is handed rather than a second place these
 * four forms could drift from `unpackItems`' own fields.
 *
 * `destination` decides how much of {@link returnPathOf}'s path is worth
 * repeating: a room's own name is already the group header, so only what
 * sits *inside* it is drawn; the `Loose` bucket states nothing above the
 * row, so a gear resting in a loose container draws its whole path. Reading
 * `path[0]` for the drop is deliberately not a second `unpackDestinationOf`
 * call — `path` and `destination` are already required to agree, being the
 * same {@link ContainmentView}'s answer to the same gear.
 *
 * The suffix is one of three, in F1/F9's own precedence: a container's `N
 * INSIDE` first (a container never carries a plain quantity — F1), then a
 * consumed Counted's split (`item.consumed` is non-null only there), then a
 * Counted Entry's plain quantity — gated on {@link bringCountOf}, never on
 * `entryKind(entry, state) === 'counted'`, which is exactly the re-derivation
 * this file's own convention forbids. A Single, an unrecognised Kind and an
 * unsynced Gear all answer `null` there and draw no suffix at all.
 */
function returnPathMeta(
  entry: EntryState,
  state: HouseholdState,
  view: ContainmentView,
  tripView: TripContainmentView,
  container: boolean,
  item: Extract<UnpackItem, { kind: 'entry' }>,
): string {
  const source = entry.source?.value
  const gearId =
    source !== undefined && source.from === 'depot' ? source.gearId : undefined
  if (gearId === undefined) return ''

  const destination = unpackDestinationOf(gearId, state, view)
  const path = returnPathOf(entry, state, view)
  const visible = destination === null ? path : path.slice(1)
  const pathText = visible.map((segment) => segment.name).join(' ▸ ')

  const suffix: string[] = []
  if (container) {
    suffix.push(`${subtreeOf(tripView, entry.id).size} INSIDE`)
  } else if (item.outcome === 'consumed' && item.consumed !== null) {
    suffix.push(`×${item.consumed} CONSUMED`)
    suffix.push(`×${item.units - item.consumed} BACK`)
  } else if (bringCountOf(entry, state) !== null) {
    suffix.push(`×${item.units}`)
  }

  if (pathText === '') return suffix.join(' · ')
  return [`→ ${pathText}`, ...suffix].join(' · ')
}

/**
 * DESTINATION mode's groups (F3, spec §4.3) — one `containmentView` and one
 * `tripContainmentView`, each built exactly once and handed down to every
 * group, never rebuilt per group (`containerTotals`'s own rule, restated for
 * this screen). Rooms come from {@link visiblePlaces} — the depot's own
 * A→Z-by-name order, converged the identical way across every replica —
 * filtered to the ones this Trip's gear actually returns to; `Loose` and
 * `Trip-only` close the list (F3).
 *
 * **A per-person, non-container Entry is skipped here** — Task 13's row,
 * the 34px cluster this component's `cluster` slot is shaped to take. Its
 * units still count toward the group's own `resolved/total` header, read
 * from {@link unpackItems} directly rather than from the rows this function
 * renders, so the header states the Trip's true arithmetic even before
 * Task 13 draws every row it apportions.
 */
function destinationGroups(
  trip: TripState,
  state: HouseholdState,
  view: ContainmentView,
  tripView: TripContainmentView,
): readonly UnpackGroup[] {
  const items = unpackItems(trip, state)
  const itemsByEntry = new Map<string, UnpackItem[]>()
  for (const item of items) {
    const list = itemsByEntry.get(item.entryId)
    if (list === undefined) itemsByEntry.set(item.entryId, [item])
    else list.push(item)
  }

  const entries = entriesOf(trip, state)
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))

  const byPlace = new Map<string, string[]>()
  const looseIds: string[] = []
  const tripOnlyIds: string[] = []

  for (const entry of entries) {
    const kind = entryKind(entry, state)
    if (kind === 'trip_only') {
      tripOnlyIds.push(entry.id)
      continue
    }
    const source = entry.source?.value
    if (source === undefined || source.from !== 'depot') continue

    const destination = unpackDestinationOf(source.gearId, state, view)
    if (destination === null) {
      looseIds.push(entry.id)
      continue
    }
    const list = byPlace.get(destination)
    if (list === undefined) byPlace.set(destination, [entry.id])
    else list.push(entry.id)
  }

  function rowsFor(entryIds: readonly string[]): UnpackRowData[] {
    const rows: UnpackRowData[] = []
    for (const entryId of entryIds) {
      const entry = entryById.get(entryId)
      if (entry === undefined) continue
      const kind = entryKind(entry, state)
      const container = isContainerEntry(entry, state)
      // Task 13's row — the 34px cluster, not this task's scope.
      if (kind === 'per_person' && !container) continue

      const entryItems = itemsByEntry.get(entryId) ?? []
      const item = entryItems.find(
        (candidate): candidate is Extract<UnpackItem, { kind: 'entry' }> =>
          candidate.kind === 'entry',
      )
      if (item === undefined) continue

      rows.push({
        entryId,
        name: entryLabel(entry, state),
        meta: returnPathMeta(entry, state, view, tripView, container, item),
        outcome: item.outcome,
        units: item.units,
      })
    }
    return rows
  }

  function countLabelFor(entryIds: readonly string[]): string {
    const groupItems = entryIds.flatMap((id) => itemsByEntry.get(id) ?? [])
    const { resolved, total } = countOfUnpack(groupItems)
    return `${resolved}/${total}`
  }

  const groups: UnpackGroup[] = []

  for (const place of visiblePlaces(state)) {
    const entryIds = byPlace.get(place.id)
    if (entryIds === undefined || entryIds.length === 0) continue
    groups.push({
      key: place.id,
      name: place.name?.value ?? '',
      countLabel: countLabelFor(entryIds),
      rows: rowsFor(entryIds),
    })
  }

  if (looseIds.length > 0) {
    groups.push({
      key: 'loose',
      name: 'Loose',
      subtitle: 'NO HOME SLOT',
      muted: true,
      countLabel: countLabelFor(looseIds),
      rows: rowsFor(looseIds),
    })
  }

  if (tripOnlyIds.length > 0) {
    groups.push({
      key: 'trip-only',
      name: 'Trip-only',
      subtitle: 'TAKES NO OUTCOME · CLEARED AT CLOSE',
      muted: true,
      countLabel: String(tripOnlyIds.length),
      countFaint: true,
      rows: tripOnlyIds.map((entryId) => {
        const entry = entryById.get(entryId)
        return {
          entryId,
          name: entry === undefined ? '' : entryLabel(entry, state),
          meta: 'NOT IN DEPOT',
          outcome: null,
          units: 0,
          tripOnly: true,
        }
      }),
    })
  }

  return groups
}

/**
 * **F5 — Unpack's shell, and Task 10's DESTINATION mode** (`docs/design/
 * README.md` §7, spec `docs/specs/2026-09-05-unpack-resolve-and-close.md`
 * §4.1–§4.3). This task adds the groups, `UnpackRow` and the four outcome
 * pills over the shell Task 9 built. The segmented control, the `○ OPEN`
 * filter, the hint, the three sheets, the over-claim band and the close card
 * are every one of them a later task's scope and deliberately absent here —
 * PERSON and ALL mode are Task 11's, so this always renders DESTINATION.
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

  // One view of each kind, built once per fold and handed down to every
  // group — never one per group (`containerTotals`'s own rule).
  const view = useMemo<ContainmentView>(() => containmentView(state), [state])
  const tripView = useMemo<TripContainmentView | undefined>(
    () => (trip === undefined ? undefined : tripContainmentView(trip, state)),
    [trip, state],
  )

  const groups = useMemo<readonly UnpackGroup[]>(
    () =>
      trip === undefined || tripView === undefined
        ? NO_GROUPS
        : destinationGroups(trip, state, view, tripView),
    [trip, state, view, tripView],
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

          <div className={styles['groups']} data-testid="unpack-groups">
            {groups.map((group) => {
              const headingId = `unpack-group-${tripId}-${group.key}`
              return (
                <section
                  key={group.key}
                  className={styles['group']}
                  aria-labelledby={headingId}
                >
                  <div
                    className={styles['groupHeader']}
                    data-testid="unpack-group-header"
                  >
                    <div className={styles['headerMain']}>
                      <span
                        id={headingId}
                        className={`${styles['groupName']} ${
                          group.muted === true ? styles['mutedName'] : ''
                        }`}
                        data-testid="unpack-group-name"
                      >
                        {group.name}
                      </span>
                      {group.subtitle !== undefined && (
                        <span className={styles['groupMeta']}>
                          {group.subtitle}
                        </span>
                      )}
                    </div>
                    <span
                      className={`${styles['groupCount']} ${
                        group.countFaint === true
                          ? styles['groupCountFaint']
                          : ''
                      }`}
                    >
                      {group.countLabel}
                    </span>
                  </div>

                  <ul className={styles['rows']}>
                    {group.rows.map((row) => (
                      <li key={row.entryId}>
                        <UnpackRow
                          entryId={row.entryId}
                          name={row.name}
                          meta={row.meta}
                          outcome={row.outcome}
                          units={row.units}
                          onOutcome={noop}
                          onReHome={noop}
                          tripOnly={row.tripOnly ?? false}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
