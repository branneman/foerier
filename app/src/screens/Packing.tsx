import {
  containerTotals,
  countOf,
  disagreements,
  entriesOf,
  entryLabel,
  isContainerEntry,
  packingItems,
  packingTotals,
  stageOf,
  statusGlyph,
  tripContainmentView,
  tripContainerStageSet,
  tripEntryMoved,
  tripLabel,
  tripPath,
  tripPieceMoved,
  type DepotState,
  type Disagreement,
  type EntryState,
  type PackingCount,
  type StageValue,
  type TripHolderRef,
  type TripResidence,
  type TripState,
} from '@foerier/shared'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'wouter'

import { ContainerMoveConfirm } from '../components/ContainerMoveConfirm'
import { JourneyRail } from '../components/JourneyRail'
import { PackingRow } from '../components/PackingRow'
import { PackPicker, sameTripResidence } from '../components/PackPicker'
import { PieceStatusSheet } from '../components/PieceStatusSheet'
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

/** Where a gear list's groups come from, stated once and permanently for a
 * Trip that has none — a domain fact, not a promise, in the `0 ENTRIES.`
 * register. */
const NO_CONTAINERS = 'A CONTAINER ON THE GEAR LIST BECOMES A GROUP HERE.'

/** Indent 16px per level, capped at **two** levels below the top container —
 * the Home picker's constant and its reason, verbatim (ruling A4): a deep
 * row runs out of row, so past the cap the header states its own ancestry
 * instead. */
const INDENT_CAP = 2

/** One shared instance for an Entry with no `residence` register — it
 * carries no id, so there is nothing to distinguish. */
const LOOSE: TripResidence = Object.freeze({ in: 'loose' })

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
 * One group of CONTAINER mode: a trip container, or the `Loose` group that
 * closes the list.
 */
interface PackingGroup {
  readonly key: string
  /** `null` for `Loose`, which is a holder and not an Entry. */
  readonly entryId: string | null
  readonly name: string
  /** Ruling A14's amber tag on a trip-only container's header. */
  readonly tripOnly: boolean
  /** Levels below the top container. The indent is capped; this is not. */
  readonly depth: number
  /** The ancestry the cap hid, `CRATE B ▸ STUFF SACK`, or `''`. */
  readonly ancestry: string
  /** `null` for `Loose` — **nothing loose has a journey**, which is the one
   * thing that group's header lacks (ruling A3). */
  readonly stage: StageValue | null
  /** `9/12` — a container's contents **at any depth**, `Loose`'s own rows. */
  readonly count: PackingCount
  /** This group's own rows, in `entriesOf` order. Nested containers are not
   * rows: they are the groups that follow immediately (ruling A4). */
  readonly rowIds: readonly string[]
  /** Entries inside at any depth — the move context's `N INSIDE RIDE ALONG`. */
  readonly insideCount: number
}

interface ContainerView {
  readonly groups: readonly PackingGroup[]
  /** Whether the Trip holds any container at all — what {@link NO_CONTAINERS}
   * is gated on. */
  readonly hasContainer: boolean
  readonly disagreementOf: ReadonlyMap<string, Disagreement>
}

const EMPTY_VIEW: ContainerView = {
  groups: [],
  hasContainer: false,
  disagreementOf: new Map(),
}

/**
 * CONTAINER mode's whole shape, in one pass over the fold.
 *
 * **Nested containers are indented groups rendered immediately after their
 * parent's own rows** (ruling A4), so the reader walks the physical nesting;
 * the traversal is depth-first for exactly that reason. Order at every level
 * is {@link entriesOf}' — `childrenOf` sorts by id, which is the order a
 * *tree walk* must agree on across replicas and meaningless to read, so the
 * drawn order is re-imposed by filtering the drawn list rather than sorting
 * the walk's.
 *
 * `view` and `items` are built **once** and threaded through
 * {@link containerTotals} and {@link disagreements}: each is O(entries) to
 * build, and this screen draws one group per container, so letting them
 * default would pay N × O(entries) on the list the app is used on most —
 * `containerTotals`' own docstring asks for exactly this.
 */
function containerView(trip: TripState, state: DepotState): ContainerView {
  const view = tripContainmentView(trip, state)
  const entries = entriesOf(trip, state)
  const items = packingItems(trip, state)

  /** `holder`'s children in the **drawn** order. */
  function childrenInOrder(holder: TripHolderRef): readonly EntryState[] {
    const ids = new Set(view.childrenOf(holder))
    return entries.filter((entry) => ids.has(entry.id))
  }

  /** Entries inside `entryId` at any depth — the `seen` set makes
   * termination independent of the view it is handed. */
  function insideCountOf(entryId: string): number {
    const seen = new Set<string>()
    const stack = [entryId]
    while (stack.length > 0) {
      const current = stack.pop()
      if (current === undefined) continue
      for (const childId of view.childrenOf({
        kind: 'container',
        entryId: current,
      })) {
        if (seen.has(childId)) continue
        seen.add(childId)
        stack.push(childId)
      }
    }
    return seen.size
  }

  const groups: PackingGroup[] = []
  let hasContainer = false

  function pushContainersUnder(holder: TripHolderRef, depth: number): void {
    for (const entry of childrenInOrder(holder)) {
      if (!isContainerEntry(entry, state)) continue
      const stage = stageOf(entry, state)
      // `stageOf` answers `null` for a non-container and nothing else, and
      // the line above filtered to containers — a **narrowing, not a case**,
      // exactly as `PackPicker`'s own is. There is no group to drop here.
      if (stage === null) continue

      hasContainer = true
      const source = entry.source?.value
      groups.push({
        key: entry.id,
        entryId: entry.id,
        name: entryLabel(entry, state),
        tripOnly: source !== undefined && source.from === 'trip_only',
        depth,
        // Past the cap the indent stops saying where the group sits, so the
        // header says it itself — `tripPath`'s outermost-first segments, the
        // one place the trip world's breadcrumb is derived.
        ancestry:
          depth > INDENT_CAP
            ? tripPath(trip, state, entry.id, view)
                .map((segment) => segment.name)
                .join(' ▸ ')
            : '',
        stage,
        count: containerTotals(trip, state, entry.id, view, items),
        rowIds: childrenInOrder({ kind: 'container', entryId: entry.id })
          .filter((child) => !isContainerEntry(child, state))
          .map((child) => child.id),
        insideCount: insideCountOf(entry.id),
      })

      pushContainersUnder({ kind: 'container', entryId: entry.id }, depth + 1)
    }
  }

  pushContainersUnder({ kind: 'loose' }, 0)

  // **`Loose` last** (ruling A3), and drawing nothing when it is empty. On
  // day one everything is loose, so a first-position group of sixty-one rows
  // would push every journey rail — the screen's spine — permanently
  // off-screen. The Pack picker puts `Loose` first and is equally right: a
  // picker lists destinations, this lists work.
  const looseRowIds = childrenInOrder({ kind: 'loose' })
    .filter((entry) => !isContainerEntry(entry, state))
    .map((entry) => entry.id)

  if (looseRowIds.length > 0) {
    const inLoose = new Set(looseRowIds)
    groups.push({
      key: 'loose',
      entryId: null,
      name: 'Loose',
      tripOnly: false,
      depth: 0,
      ancestry: '',
      stage: null,
      // Its own rows and no subtree: everything inside a container is
      // counted by that container's own header.
      count: countOf(items.filter((item) => inLoose.has(item.entryId))),
      rowIds: looseRowIds,
      insideCount: 0,
    })
  }

  return {
    groups,
    hasContainer,
    disagreementOf: new Map(
      disagreements(trip, state, view).map((row) => [row.entryId, row]),
    ),
  }
}

/**
 * What the Pack picker is open for. The three arms are the three things that
 * can be moved on this screen, and they differ in exactly the two ways
 * ruling A2b cares about: whether the act can be seen where it was made (a
 * container's cannot, so it confirms) and which op says it.
 */
type PickerTarget =
  | { kind: 'entry'; entryId: string }
  | {
      kind: 'container'
      entryId: string
      name: string
      insideCount: number
    }
  | { kind: 'piece'; entryId: string; personId: string }

/** A container move, waiting on its confirm (ruling A2b). */
interface PendingMove {
  entryId: string
  movingName: string
  destinationName: string
  insideCount: number
  residence: TripResidence
}

/**
 * **F4 — the screen the app lives on** (`docs/design/README.md` §1, spec
 * `docs/specs/2026-09-01-packing-and-the-journey.md` §4.1, §4.2, §4.3 and
 * §4.7). The band, the title, the arithmetic, the two controls, the one hint
 * — and CONTAINER mode's groups beneath them. PERSON and ALL, and the
 * `○ LEFT` filter's wiring, are the next task.
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
 * ## The group header is the container's *where* target
 *
 * **A decision no board draws, and it is forced rather than invented.** A
 * container Entry never appears as a row anywhere on this screen — in
 * CONTAINER mode it is a group, PERSON mode's partition excludes it
 * (`packingItems` skips containers) and ALL mode draws no container rows at
 * all (ruling A8) — yet ruling A2b rules on a container *move*, the Pack
 * picker carries `excludeEntryId` and the `MOVING CRATE B · 5 INSIDE RIDE
 * ALONG` context line for one, and `ContainerMoveConfirm` exists to state
 * it. The group header is the only surface left, and it takes the row's own
 * two-track shape: **body = where** (this picker), **rail = how far along**.
 *
 * It is drawn ≥48 rather than at the board's ~22px text height, because the
 * board draws no control there at all: ruling O's standalone rule applies —
 * "a standalone control is simply drawn ≥48" — and the rail's own clamped
 * `::after` then meets it edge to edge instead of overlapping it.
 *
 * ## A move is suppressed when it changes nothing
 *
 * `PackPicker` reports a tap on its `● NOW` row like any other and says in
 * its own docblock that the caller must drop it. This is that caller: a
 * selection equal to the residence passed as `current` authors **no** op, in
 * all three arms of {@link PickerTarget}, for the journey rail's own reason
 * — a redundant write moves the stamp LWW compares and can beat a genuine
 * concurrent write from another Device.
 *
 * ## `Move` fires both callbacks, so cancel does not reopen anything
 *
 * `Confirm.Action` closes the dialog as well as running its `onClick`, and
 * Radix reports that close through `onOpenChange` — which is
 * `ContainerMoveConfirm`'s `onCancel`. So a successful `Move` calls
 * `onConfirm` **and then** `onCancel`, pinned by that component's own test.
 * Both handlers here therefore do the same one thing to the pending move —
 * clear it — and `onCancel` reopens nothing. Reopening the picker on cancel
 * would reopen it after every successful move too.
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
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  const header = useScreenHeader({
    splitPane: false,
    // See the docstring: the sidebar carries `TRIPS`, never one Trip's name,
    // so this screen's own back link is owed at Desktop too.
    atDesktopSidebarCarriesDestination: false,
  })

  // The two controls' own state. `mode` chooses the partition; `leftOnly`
  // filters `!isPacked` in all three modes and is the next task's wiring.
  const [mode, setMode] = useState<PackingMode>('container')
  const [leftOnly, setLeftOnly] = useState(false)

  // The three overlays this screen owns. `PackPicker` and `PieceStatusSheet`
  // can be open together — the sheet's trailing `MOVE` opens the picker for
  // one Piece over it, and closing the picker returns to the sheet.
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [sheetEntryId, setSheetEntryId] = useState<string | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)

  const trip = tripId === undefined ? undefined : state.trips[tripId]

  const view = useMemo<ContainerView>(
    () => (trip === undefined ? EMPTY_VIEW : containerView(trip, state)),
    [trip, state],
  )

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

  /** Where the thing the picker is open for rides **now** — the `● NOW`
   * mark, and the value a selection is compared against before anything is
   * authored. */
  // Arrow functions, not declarations: a hoisted `function` can in
  // principle be called before the `No such trip.` guard above, so
  // TypeScript declines to carry `trip`'s narrowing into one. These are
  // created after it and read the narrowed `TripState`.
  const currentResidenceOf = (target: PickerTarget): TripResidence => {
    if (target.kind !== 'piece') {
      return trip.entries?.[target.entryId]?.residence?.value ?? LOOSE
    }
    // A Piece with no residence register of its own reads its Entry's, then
    // loose — `packingItems`' layered read, taken from there rather than
    // restated so the picker's `● NOW` cannot disagree with the sheet's
    // `▸ DUFFEL 90 L`.
    for (const item of packingItems(trip, state)) {
      if (item.kind !== 'piece') continue
      if (item.entryId !== target.entryId) continue
      if (item.personId !== target.personId) continue
      return item.residence
    }
    return LOOSE
  }

  /** The destination's own name, for the confirm's title. A pointer this
   * replica cannot resolve reads `Loose`, which is what
   * `tripContainmentView` will make of it too. */
  const nameOfResidence = (residence: TripResidence): string => {
    if (residence.in === 'loose') return 'Loose'
    const container = trip.entries?.[residence.entryId]
    return container === undefined ? 'Loose' : entryLabel(container, state)
  }

  const selectResidence = (
    target: PickerTarget,
    residence: TripResidence,
  ): void => {
    // The suppression `PackPicker` hands its caller — see the docstring.
    if (sameTripResidence(currentResidenceOf(target), residence)) return

    if (target.kind === 'container') {
      // Ruling A2b: the ride-along is elsewhere on the screen and may be
      // filtered out of view, so this one act states itself first.
      setPendingMove({
        entryId: target.entryId,
        movingName: target.name,
        destinationName: nameOfResidence(residence),
        insideCount: target.insideCount,
        residence,
      })
      return
    }

    if (target.kind === 'piece') {
      emit(tripPieceMoved(tripId, target.entryId, target.personId, residence))
      return
    }

    emit(tripEntryMoved(tripId, target.entryId, residence))
  }

  const pickerEntry =
    picker === null ? undefined : trip.entries?.[picker.entryId]

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

          {mode === 'container' && (
            <div className={styles['groups']} data-testid="packing-groups">
              {view.groups.map((group) => {
                const headingId = `packing-group-${tripId}-${group.key}`
                // `null` is `Loose` — a holder, not an Entry. Read once into
                // a local so every branch below narrows on the same fact.
                const containerId = group.entryId
                const disagreement =
                  containerId === null
                    ? undefined
                    : view.disagreementOf.get(containerId)

                return (
                  <section
                    key={group.key}
                    className={styles['group']}
                    // The indent the cap allows, as a step rather than a
                    // pixel count — the stylesheet turns it into the 16px
                    // per level the Home picker's rule sets.
                    data-indent={String(Math.min(group.depth, INDENT_CAP))}
                    aria-labelledby={headingId}
                  >
                    <div
                      className={styles['groupHeader']}
                      data-testid="packing-group-header"
                    >
                      {containerId === null ? (
                        /* `Loose` is a holder, not an Entry: there is
                           nothing to move and nothing to open a picker
                           onto, so its header is text. */
                        <div className={styles['headerBody']}>
                          <span className={styles['headerMain']}>
                            <span
                              id={headingId}
                              className={`${styles['groupName']} ${styles['looseName']}`}
                              data-testid="packing-group-name"
                            >
                              {group.name}
                            </span>
                            <span className={styles['groupMeta']}>
                              NOT IN A CONTAINER
                            </span>
                          </span>
                          <span className={styles['groupCount']}>
                            {group.count.packed}/{group.count.total}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles['headerBody']}
                          data-testid="packing-group-move"
                          onClick={() =>
                            setPicker({
                              kind: 'container',
                              entryId: containerId,
                              name: group.name,
                              insideCount: group.insideCount,
                            })
                          }
                        >
                          <span className={styles['headerMain']}>
                            <span className={styles['headerNameLine']}>
                              <span
                                id={headingId}
                                className={styles['groupName']}
                                data-testid="packing-group-name"
                              >
                                {group.name}
                              </span>
                              {/* Ruling A14: a trip-only container is an
                                  ordinary group plus this tag — the row
                                  treatment promoted to the header. */}
                              {group.tripOnly && (
                                <span className={styles['badge']}>
                                  TRIP-ONLY
                                </span>
                              )}
                            </span>
                            {group.ancestry !== '' && (
                              <span className={styles['groupMeta']}>
                                {group.ancestry}
                              </span>
                            )}
                          </span>
                          <span className={styles['groupCount']}>
                            {group.count.packed}/{group.count.total}
                          </span>
                        </button>
                      )}

                      {/* A rail inside a rail is correct: the rail is that
                          container's own journey, and story 10's
                          disagreement case is exactly the nested one. */}
                      {group.stage !== null && containerId !== null && (
                        <JourneyRail
                          current={group.stage}
                          label={`Journey — ${group.name}`}
                          onSet={(stage) =>
                            emit(
                              tripContainerStageSet(tripId, containerId, stage),
                            )
                          }
                        />
                      )}

                      {disagreement !== undefined && (
                        <p
                          className={styles['disagreement']}
                          data-testid="packing-disagreement"
                        >
                          {/* The `▲` in its own element — the trip card's
                              date warning verbatim: a single text node would
                              force the attention class onto the whole line
                              or onto none of it, and the `▲` is the system's
                              attention mark while the sentence beside it is
                              the ledger stating a count. */}
                          <span className={styles['attention']}>▲</span>{' '}
                          {disagreement.label} · {disagreement.notPacked} INSIDE
                          NOT PACKED
                        </p>
                      )}
                    </div>

                    <ul className={styles['rows']}>
                      {group.rowIds.map((entryId) => (
                        <li key={entryId}>
                          <PackingRow
                            tripId={tripId}
                            entryId={entryId}
                            onOpenPicker={() =>
                              setPicker({ kind: 'entry', entryId })
                            }
                            onOpenPieceSheet={() => setSheetEntryId(entryId)}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}

              {/* A Trip with no containers draws the one `Loose` group
                  holding everything, and below the last row the permanent
                  fact — where a group comes from, said once. */}
              {!view.hasContainer && (
                <p className={styles['fact']}>{NO_CONTAINERS}</p>
              )}
            </div>
          )}
        </>
      )}

      {sheetEntryId !== null && (
        <PieceStatusSheet
          tripId={tripId}
          entryId={sheetEntryId}
          onClose={() => setSheetEntryId(null)}
          onOpenPieceMove={(personId) =>
            setPicker({ kind: 'piece', entryId: sheetEntryId, personId })
          }
        />
      )}

      {/* The Entry lookup is the mount condition rather than a fallback
          title: an Entry another Device removed between opening the picker
          and this render has no name to draw, and a sheet titled with a
          UUID would be worse than no sheet. */}
      {pickerEntry !== undefined && picker !== null && (
        <PackPicker
          tripId={tripId}
          title={entryLabel(pickerEntry, state)}
          current={currentResidenceOf(picker)}
          onClose={() => setPicker(null)}
          onSelect={(residence) => selectResidence(picker, residence)}
          {...(picker.kind === 'container'
            ? {
                excludeEntryId: picker.entryId,
                moving: {
                  name: picker.name,
                  insideCount: picker.insideCount,
                },
              }
            : {})}
        />
      )}

      {pendingMove !== null && (
        <ContainerMoveConfirm
          movingName={pendingMove.movingName}
          destinationName={pendingMove.destinationName}
          insideCount={pendingMove.insideCount}
          onConfirm={() => {
            emit(
              tripEntryMoved(
                tripId,
                pendingMove.entryId,
                pendingMove.residence,
              ),
            )
            setPendingMove(null)
          }}
          // `Move` fires this too — see the docstring. It clears and
          // reopens nothing, which is the whole of the handling.
          onCancel={() => setPendingMove(null)}
        />
      )}
    </div>
  )
}
