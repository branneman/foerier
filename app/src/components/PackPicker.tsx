import {
  entriesOf,
  entryLabel,
  isContainerEntry,
  sameTripResidence,
  stageLabel,
  stageOf,
  subtreeOf,
  tripContainmentView,
  tripPath,
  type DepotState,
  type EntryState,
  type TripContainmentView,
  type TripHolderRef,
  type TripResidence,
  type TripState,
} from '@foerier/shared'
import { Sheet } from '@foerier/ui'
import { useMemo } from 'react'

import { useDepot } from '../depot/store'
import styles from './PackPicker.module.css'

/**
 * **Where a thing rides on this Trip** — ruling A2, and
 * `docs/design/README.md` §1's "Pack picker" bullet.
 *
 * ## The Home picker's twin, and not the Home picker
 *
 * Read `HomePicker.tsx` beside this file: the anatomy is that one's, borrowed
 * on purpose rather than re-invented. `Loose` first with its own meta line,
 * nesting indented 16px per level **capped at two**, deeper rows carrying the
 * ancestry the cap hid, the moved Entry and its whole subtree absent at any
 * depth with one footer saying so, the `MOVING … RIDE ALONG` context line, and
 * **mounted is open** — there is no `open` prop, callers write
 * `{picker && <PackPicker …/>}`.
 *
 * **`Loose` first here, last on the packing screen, and both are right.** A
 * picker lists *destinations*, so the default one goes first; the screen lists
 * *work*, and on day one everything is loose, so a first-position group of
 * sixty-one rows would push every journey rail permanently off-screen
 * (ruling A3). Neither is the other's bug.
 *
 * ## Two capabilities do not come across
 *
 * **Places.** The trip world has none — a `TripResidence` resolves against
 * Entries and nothing else (`tripContainment.ts`) — and offering one would
 * break the two-worlds rule outright.
 *
 * **Creation.** A trip container is an Entry on the gear list, which is what
 * the fact line at the foot of the sheet says in as many words. `HomePicker`'s
 * EDIT mode, rename and remove go with it: all three were Places-and-Gear
 * capabilities, and with nothing to create there is no mode to suspend
 * selection for. This component holds **no state at all** as a result, which
 * is why it carries no twin of `HomePicker`'s "opens in pick mode after a
 * close" test — there is nothing left that could survive one.
 *
 * ## The right-hand slot carries exactly one read
 *
 * Each row's right-hand mono is **that container's stage**
 * (`stageLabel(stageOf(…))`) — except the row that is the current residence,
 * where `● NOW` takes the slot instead. `docs/design/README.md` §1: "`● NOW`
 * on the current residence — taking that row's right-hand slot in place of the
 * container's stage, since one row cannot carry two right-hand reads and where
 * the gear stands outranks how far that holder has travelled", and the board
 * (`S9 Round`, the `Pack picker` artboard) draws the `Loose` row with `● NOW`
 * at the row's right edge. **The dated spec §4.5 states the swap the other way
 * round**, giving the stage the slot and `● NOW` a place beside the name; the
 * boards outrank it (`docs/design/README.md` is the shipped authority), and
 * the justification clause both documents share — *where the gear stands
 * outranks how far its holder has travelled* — only reads one way.
 *
 * ## The subtree exclusion is invariant 3 for the trip world
 *
 * `excludeEntryId` and every Entry reachable underneath it, at any depth, are
 * **absent** — not dimmed, not blocked. That is what stops a cycle being
 * authored on one Device at all. `tripContainmentView`'s cycle break is for
 * the cycles two Devices author while apart, which no picker can prevent.
 *
 * ## Selection moves and closes; the confirm is the caller's
 *
 * A tap calls `onSelect` and then `onClose` — **including a tap on the
 * `● NOW` row**, which the caller is the one that must drop; see
 * {@link PackPickerProps.onSelect}. Whether a confirm is owed is
 * ruling A2b's question and it is decided by *what is moving* — a container
 * move confirms, a plain Entry or Piece move does not — which is a fact the
 * caller holds and this sheet does not. {@link ContainerMoveConfirm} is
 * therefore a component beside this one rather than state inside it.
 */
export interface PackPickerProps {
  /** The Trip whose containers are the destinations. */
  tripId: string
  onClose: () => void
  /**
   * The destination that was tapped, followed immediately by `onClose`.
   *
   * **A selection equal to {@link current} is still reported, and suppressing
   * it is the caller's job.** This sheet is pure selection: it holds no Trip,
   * emits nothing, and a tap on the `● NOW` row is a legitimate thing for a
   * Quartermaster to do — the sheet cannot know whether the caller means to
   * author an op from it. But a redundant `trip.entry_moved` **moves the
   * stamp LWW compares** and reorders nothing for the better, so the caller
   * must drop a residence equal to the one it passed as `current` — exactly
   * as the trip screen's SET PHASE emits nothing when the phase tapped is
   * the phase the Trip is already in. `HomePicker` has the identical gap and
   * the identical contract, and `GearDetail`'s MOVE is the caller that
   * honours it there, through `sameResidence`, as `Packing.tsx` does here
   * through `sameTripResidence`.
   */
  onSelect: (residence: TripResidence) => void
  /** The sheet's heading: the name of the thing being placed. */
  title: string
  /**
   * The Entry being moved, when it is a container. It and its whole subtree
   * are not offered — invariant 3 — and it is what the `… ARE NOT OFFERED.`
   * footer names. Omit when the thing being placed cannot hold anything (a
   * plain Entry, a Piece), where there is no cycle to author: the footer goes
   * with it, because there is then no exclusion for it to describe.
   */
  excludeEntryId?: string
  /** Where it rides right now, marked `● NOW`. */
  current?: TripResidence
  /**
   * The context line, and what a container move's confirm will restate.
   *
   * **Independent of {@link excludeEntryId}**: a plain Entry or a Piece move
   * passes this and no exclusion, because neither can hold anything.
   */
  moving?: { name: string; insideCount: number }
}

interface ContainerRow {
  entryId: string
  name: string
  /** `true` for a trip-only container — `EntryRow`'s badge, same encoding. */
  tripOnly: boolean
  /** Levels below `Loose`. Indent is capped; this is not. */
  depth: number
  /** The ancestry the cap hid, `CRATE B ▸ STUFF SACK`, or `''`. */
  skipped: string
  /** `stageLabel`'s answer. Never absent: every row here is a container, and
   * a container always has a journey (`stageOf` reads an unset register as
   * `home`). */
  stage: string
}

/** Indent 16px per level, capped at **two** — `HomePicker`'s own constant and
 * its reason: a deep row runs out of row. */
const INDENT_CAP = 2

/**
 * `excludeEntryId` and every Entry reachable underneath it, at any depth —
 * the descendant half of invariant 3, over the Trip's tree. Empty when
 * `excludeEntryId` is unset.
 *
 * **The walk itself is `subtreeOf`'s, not a fourth copy of it** (review F4).
 * That function's own docstring names this call site as one of the copies it
 * was made public to collapse, and the half that would be silent if two
 * copies diverged is the cycle break: a container excluded from the picker on
 * one Device and offered on another is a divergence no test would see. All
 * this adds is invariant 3's *other* half — the moved container itself, which
 * `subtreeOf` deliberately excludes because its own caller is counting
 * contents.
 */
function excludedSubtree(
  view: TripContainmentView,
  excludeEntryId: string | undefined,
): ReadonlySet<string> {
  if (excludeEntryId === undefined) return new Set()
  return new Set([excludeEntryId, ...subtreeOf(view, excludeEntryId)])
}

/**
 * Every container under `holder`, at any depth — depth-first, so a
 * container's own children sit immediately beneath it.
 *
 * Only containers are ever rows ({@link isContainerEntry}, the one place that
 * question is answered): a plain Entry under the same holder simply is not a
 * destination.
 *
 * **The order is `entriesOf`'s, not `childrenOf`'s.** `childrenOf` returns ids
 * sorted by id — the order a *tree walk* has to agree on across replicas, and
 * meaningless to read — so `order` re-imposes the drawn one, exactly as
 * `tripContainment.ts`'s own doc tells a caller to.
 */
function containerRowsUnder(
  trip: TripState,
  state: DepotState,
  view: TripContainmentView,
  excluded: ReadonlySet<string>,
  order: ReadonlyMap<string, number>,
  holder: TripHolderRef,
  depth: number,
): ContainerRow[] {
  const here = view
    .childrenOf(holder)
    .filter((id) => !excluded.has(id))
    .map((id) => trip.entries?.[id])
    .filter((entry): entry is EntryState => entry !== undefined)
    .filter((entry) => isContainerEntry(entry, state))
    // The `??` arms are **unreachable** and exist for `Map.get`'s signature,
    // not for a real case: `childrenOf` only ever yields ids
    // `tripContainmentView` took from `entriesOf`, and `order` indexes that
    // same list. Kept rather than asserted away — nothing here comes through
    // a cast — and named so the next reader does not go looking for the
    // input that produces them.
    .sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )

  const rows: ContainerRow[] = []
  for (const entry of here) {
    const stage = stageOf(entry, state)
    // `stageOf` answers `null` for a non-container and nothing else, and
    // `here` is filtered to containers one block above — so this is a
    // **narrowing, not a case**, exactly as `tripContainment.ts`'s own
    // `lowestEdgeOf` skip is. Dropping a row here would be a bug; there is
    // no row to drop.
    if (stage === null) continue
    const source = entry.source?.value
    rows.push({
      entryId: entry.id,
      name: entryLabel(entry, state),
      tripOnly: source !== undefined && source.from === 'trip_only',
      depth,
      // Past the cap the indent stops saying where the row sits, so the row
      // says it itself — `tripPath`'s outermost-first segments, which is the
      // one place the trip world's breadcrumb is derived.
      skipped:
        depth > INDENT_CAP
          ? tripPath(trip, state, entry.id, view)
              .map((segment) => segment.name)
              .join(' ▸ ')
          : '',
      stage: stageLabel(stage),
    })
    rows.push(
      ...containerRowsUnder(
        trip,
        state,
        view,
        excluded,
        order,
        { kind: 'container', entryId: entry.id },
        depth + 1,
      ),
    )
  }
  return rows
}

export function PackPicker({
  tripId,
  onClose,
  onSelect,
  title,
  excludeEntryId,
  current,
  moving,
}: PackPickerProps) {
  const state = useDepot((depot) => depot.state)

  // The Trip is looked up **inside** the memo: it is derived from `state` and
  // never varies independently of it, so naming both in the dependency list
  // would state a variation that cannot happen.
  const { rows, hasContainer, excludedName } = useMemo<{
    rows: readonly ContainerRow[]
    hasContainer: boolean
    excludedName: string | null
  }>(() => {
    const trip: TripState | undefined = state.trips[tripId]
    if (trip === undefined) {
      return { rows: [], hasContainer: false, excludedName: null }
    }
    const view = tripContainmentView(trip, state)
    const entries = entriesOf(trip, state)
    const order = new Map<string, number>(
      entries.map((entry, index): [string, number] => [entry.id, index]),
    )
    const excludedEntry =
      excludeEntryId === undefined ? undefined : trip.entries?.[excludeEntryId]
    return {
      rows: containerRowsUnder(
        trip,
        state,
        view,
        excludedSubtree(view, excludeEntryId),
        order,
        { kind: 'loose' },
        0,
      ),
      // The **Trip's** state, not the offer's: moving the only container
      // leaves nothing to offer, and `No containers on this trip yet.` would
      // then be false. The footer already says why that list is short.
      hasContainer: entries.some((entry) => isContainerEntry(entry, state)),
      // The footer's subject is the **excluded Entry**, so its name comes
      // from that Entry rather than from `moving` — see the footer itself.
      // An Entry this replica cannot see gets no footer at all: a line
      // reading `— AND EVERYTHING INSIDE IT …` names nothing.
      excludedName:
        excludedEntry === undefined ? null : entryLabel(excludedEntry, state),
    }
  }, [state, tripId, excludeEntryId])

  function choose(residence: TripResidence) {
    onSelect(residence)
    onClose()
  }

  const nowMark = <span className={styles['now']}>● NOW</span>

  return (
    <Sheet
      title={title}
      onClose={onClose}
      description={<p className={styles['fact']}>WHERE IT GOES ON THIS TRIP</p>}
    >
      {moving !== undefined && (
        <p className={styles['context']} data-testid="moving-context">
          MOVING {moving.name} · {moving.insideCount} INSIDE RIDE ALONG
        </p>
      )}

      <ul className={styles['list']}>
        <li data-testid="pack-row">
          <button
            type="button"
            className={styles['row']}
            onClick={() => choose({ in: 'loose' })}
          >
            <span className={styles['rowMain']}>
              <span className={styles['rowName']} data-testid="pack-row-name">
                Loose
              </span>
              {/* The picker is where the trip world's default is taught, as
                  the Home picker teaches `LOOSE`. */}
              <span className={styles['rowMeta']}>NOT IN A CONTAINER</span>
            </span>
            {/* Nothing loose has a journey, so this slot holds `● NOW` or
                nothing at all. */}
            {sameTripResidence(current, { in: 'loose' }) && nowMark}
          </button>
        </li>

        {rows.map((row) => {
          const isNow = sameTripResidence(current, {
            in: 'container',
            entryId: row.entryId,
          })

          return (
            <li
              key={row.entryId}
              data-testid="pack-row"
              style={{
                paddingLeft: `${Math.min(row.depth, INDENT_CAP)}rem`,
              }}
            >
              <button
                type="button"
                className={styles['row']}
                onClick={() =>
                  choose({ in: 'container', entryId: row.entryId })
                }
              >
                <span className={styles['rowMain']}>
                  <span className={styles['nameLine']}>
                    <span
                      className={styles['rowName']}
                      data-testid="pack-row-name"
                    >
                      {row.name}
                    </span>
                    {/* `EntryRow`'s badge, same encoding and the same place:
                        a name adjunct, never trailing-column content — and
                        carrying its leading `{' '}` for the same reason, the
                        flex `gap` being no character at all. */}
                    {row.tripOnly && (
                      <>
                        {' '}
                        <span className={styles['badge']}>TRIP-ONLY</span>
                      </>
                    )}
                  </span>
                  {row.skipped !== '' && (
                    <span className={styles['rowMeta']}>{row.skipped}</span>
                  )}
                </span>
                {/* One right-hand read: `● NOW` where the gear stands, and
                    the stage everywhere else. */}
                {isNow ? (
                  nowMark
                ) : (
                  <span className={styles['stage']}>{row.stage}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {/* A quiet line and no button: the fix is one back-tap, and a CTA here
          would name the gear list from inside a picker. */}
      {!hasContainer && (
        <>
          <p className={styles['empty']}>No containers on this trip yet.</p>
          <p className={styles['emptyMeta']}>
            Add a container to the gear list to pack into it.
          </p>
        </>
      )}

      {/* Gated on the **exclusion**, not on `moving`, and named by the
          excluded Entry rather than by `moving.name`. The two props do not
          travel together: `moving` supplies the context line for a plain
          Entry or a Piece move too, and those pass no `excludeEntryId`
          because they can hold nothing — so a footer drawn on `moving` would
          state something false about the list beneath it. `HomePicker`'s
          identical line is safe only because its one `MOVE` caller always
          sets both. */}
      {excludedName !== null && (
        <p className={styles['fact']} data-testid="moving-footer">
          {excludedName} AND EVERYTHING INSIDE IT ARE NOT OFFERED.
        </p>
      )}

      {/* Where `HomePicker` puts `+ New place`. This picker never creates,
          and this is the line that says why. */}
      <p className={styles['fact']}>
        A TRIP CONTAINER IS AN ENTRY ON THE GEAR LIST.
      </p>

      <Sheet.Close>
        <button type="button" className={styles['close']}>
          Close
        </button>
      </Sheet.Close>
    </Sheet>
  )
}
