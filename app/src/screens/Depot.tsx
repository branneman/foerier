import {
  containmentView,
  depotCounts,
  dimension,
  dimensionValues,
  homePath,
  ownerLabel,
  rowWhereabouts,
  sliceDepot,
  tagsOf,
  whereabouts,
  type ContainmentView,
  type DepotState,
  type DimensionId,
  type GearState,
  type GroupKey,
  type SliceGroup,
} from '@foerier/shared'
import { GearRow, Logo } from '@foerier/ui'
import { useMemo } from 'react'
import { Link } from 'wouter'

import { SliceBar } from '../components/SliceBar'
import { useDepot } from '../depot/store'
import { useSliceSpec } from '../depot/useSliceSpec'
import { DESKTOP, SPLIT, useMediaQuery } from '../shell/useMediaQuery'
import styles from './Depot.module.css'

/**
 * The Depot list — the first screen a Quartermaster sees
 * (`docs/design/README.md` §2, §3, §3a). It never shows packing status: that
 * belongs to a Trip, and this is the year-round, at-home inventory.
 *
 * S3 rebuilt it on two things it did not have:
 *
 * - **`sliceDepot`**, the shared slicing engine. S2's name-substring filter
 *   lived inside this component; it is now one dimension-free case of a
 *   selector four later slices extend.
 * - **`ui/`'s `GearRow`**, which `Find` shares — the duplication
 *   [architecture §12.4](../../../docs/architecture-design.md) named as the
 *   reason to extract.
 *
 * **One count line.** `9 OF 128` covers search and filters together, so S2's
 * `4 MATCHES` read is gone. `128 GEAR` survives as the desktop title row's
 * headline, where the board puts it — the `· 214 PIECES` segment it used to
 * carry retired with amendment ruling L, which moved all PIECES arithmetic to
 * the Trip, the only place a piece count is a number somebody authored.
 */

/**
 * `PERSONAL E · ATTIC ▸ CRATE B · ×2` — the row's meta slot, owner first,
 * which is what the boards draw (`PERSONAL E · SLAAPKAMER ▸ KAST`,
 * `SHARED · ⌂ KELDER ▸ SHELF 2`).
 *
 * The owner segment is never empty — absence reads `SHARED` — so the meta
 * slot now always exists and the `undefined` branch below survives only for
 * a shape the reducer cannot produce.
 */
function metaFor(
  state: DepotState,
  gear: GearState,
  view: ContainmentView,
): string | undefined {
  const owner = ownerLabel(state, gear)
  const path = homePath(state, gear.id, view)
    .map((segment) => segment.name)
    .join(' ▸ ')
  // `ownedCount` outlives a `kind_set` back to `single` untouched, so it is
  // gated on `kind` here exactly as `depotCounts` and `GearDetail`'s
  // `metaLine` gate it (§12.4 — the three must agree).
  const count =
    gear.kind?.value === 'counted' && gear.ownedCount?.value !== undefined
      ? `×${gear.ownedCount.value}`
      : ''
  const meta = [owner, path, count].filter((part) => part !== '').join(' · ')
  return meta === '' ? undefined : meta
}

/** `×N` for counted gear only — a single reads `—` in the table (§03).
 * Exported for `DepotPicker.tsx`'s second caller (S7 review F1): the picker's
 * row draws the same `×N` for a Counted piece of gear, and a second copy of
 * this exact expression would be the drift `owner.ts`'s own docstring warns
 * about, just one file over. */
export function qtyFor(gear: GearState): string | undefined {
  return gear.kind?.value === 'counted' && gear.ownedCount?.value !== undefined
    ? `×${gear.ownedCount.value}`
    : undefined
}

function Row({
  state,
  gear,
  view,
  layout,
  selected,
}: {
  state: DepotState
  gear: GearState
  view: ContainmentView
  layout: 'row' | 'table'
  selected: boolean
}) {
  const inside = view.childrenOf({ kind: 'gear', id: gear.id }).length
  const meta = metaFor(state, gear, view)
  const path = homePath(state, gear.id, view)
    .map((segment) => segment.name)
    .join(' ▸ ')
  const kind = gear.kind?.value
  const qty = qtyFor(gear)
  // D9: the row's whereabouts slot takes `rowWhereabouts`'s text and tone —
  // the same call `Find.tsx`'s `PlainRow` makes, so the two rows cannot
  // drift. `HOME` above and the meta below both keep the **home** path
  // regardless, which is what makes the row itself the two-worlds split
  // (`docs/design/README.md` §5f D9).
  const { text: whereaboutsLabel, tone } = rowWhereabouts(
    whereabouts(state, gear.id, view),
  )

  return (
    <Link href={`/gear/${gear.id}`} asChild>
      <GearRow
        name={gear.name?.value ?? ''}
        href={`/gear/${gear.id}`}
        whereabouts={whereaboutsLabel}
        tone={tone}
        layout={layout}
        selected={selected}
        {...(gear.container?.value === true ? { insideCount: inside } : {})}
        {...(layout === 'table'
          ? {
              ...(kind === undefined
                ? {}
                : { kind: dimension('kind').format(kind, state) }),
              owner: ownerLabel(state, gear),
              ...(path === '' ? {} : { path }),
              ...(qty === undefined ? {} : { qty }),
              tags: tagsOf(gear),
            }
          : meta === undefined
            ? {}
            : { path: meta })}
      />
    </Link>
  )
}

/**
 * The container grouping's own meta line: the group's header names a
 * container, and its meta states **that container's own home path** — never
 * anything about the gear inside it — so two same-named stuff sacks stay
 * apart without indentation (`docs/design/README.md` §5f D5). Derived from
 * `group.key` rather than a `SliceGroup` field: the shape reaches every
 * grouping, and only this one has anything to say here.
 *
 * The sentinel check reads `dimension('container').pinned` — the same public
 * field `dimensionValues` already sorts on — rather than inferring "this key
 * is the sentinel" from `state.gear[group.key]` being absent. That absence
 * is not unique to the sentinel: a container id this replica has not yet
 * folded (the ordinary cross-aggregate sync race `dimension('container')`'s
 * own `format` already draws `—` for) would otherwise read as the sentinel
 * too, for a reason that has nothing to do with being the sentinel. D4: the
 * header's name is already the definition, so the sentinel carries no meta —
 * but an unfolded container's header falls through to the ordinary branch
 * below, where `homePath` on an unknown gear id answers `[]` and the `''`
 * check turns that into no meta line as well. Same pixels as the sentinel,
 * for the right reason, and the two cases stay distinguishable in the code.
 */
function groupHomeMeta(
  state: DepotState,
  view: ContainmentView,
  groupKey: GroupKey,
  group: SliceGroup,
): string | undefined {
  if (groupKey !== 'container') return undefined
  if (group.key === dimension('container').pinned) return undefined
  // `group.key` is already the container's own gear id (the grouping
  // table's `keyOf`), folded or not — no lookup into `state.gear` needed.
  const path = homePath(state, group.key, view)
    .map((segment) => segment.name)
    .join(' ▸ ')
  return path === '' ? undefined : path
}

function Group({
  group,
  state,
  view,
  layout,
  selectedId,
  groupKey,
}: {
  group: SliceGroup
  state: DepotState
  view: ContainmentView
  layout: 'row' | 'table'
  selectedId: string | undefined
  groupKey: GroupKey
}) {
  const meta = groupHomeMeta(state, view, groupKey, group)

  return (
    <>
      {group.label !== '' && (
        // Packing's group header minus the journey rail: surface band, name
        // 16/600, right mono count (Screens A §03).
        <li className={styles['groupHeader']} data-testid="depot-group-header">
          <span className={styles['groupNameStack']}>
            <span className={styles['groupName']}>{group.label}</span>
            {meta !== undefined && (
              <span
                className={styles['groupMeta']}
                data-testid="depot-group-meta"
              >
                {meta}
              </span>
            )}
          </span>
          <span
            className={styles['groupCount']}
            data-testid="depot-group-count"
          >
            {group.gear.length}
          </span>
        </li>
      )}
      {group.gear.map((gear) => (
        <li key={gear.id}>
          <Row
            state={state}
            gear={gear}
            view={view}
            layout={layout}
            selected={gear.id === selectedId}
          />
        </li>
      ))}
    </>
  )
}

export interface DepotProps {
  /** The gear the Split detail pane is showing, so its row stays visible
   * while the detail is read (`docs/design/README.md` §3a). */
  selectedId?: string
}

export function Depot({ selectedId }: DepotProps = {}) {
  const state = useDepot((depot) => depot.state)
  const [spec, setSpec] = useSliceSpec()
  const isDesktop = useMediaQuery(DESKTOP)
  const isSplit = useMediaQuery(SPLIT)

  const view = useMemo(() => containmentView(state), [state])
  const result = useMemo(() => sliceDepot(state, spec), [state, spec])
  const counts = useMemo(() => depotCounts(state), [state])
  // Both bound to the state this screen already holds, so `SliceBar` stays a
  // presentational component: one answers *what can be narrowed by*, the
  // other *how a value is drawn*. S4's PERSON needs the second because it
  // carries ids and draws names.
  const formatFor = useMemo(
    () => (id: DimensionId, value: string) =>
      dimension(id).format(value, state),
    [state],
  )

  const valuesFor = useMemo(
    () => (id: DimensionId) => dimensionValues(state, id),
    [state],
  )

  const layout = isDesktop ? 'table' : 'row'
  const nothingRecorded = result.total === 0

  return (
    // A fragment, because the FAB is the screen's **sibling** — see the note
    // beside it below.
    <>
      <div className={styles['screen']} data-testid="depot-screen">
        <div className={styles['main']}>
          {!isDesktop && (
            <header className={styles['header']}>
              <Logo size={28} title="foerier" />
            </header>
          )}

          <div className={styles['titleRow']}>
            <h1 className={styles['title']}>Depot</h1>
            {isDesktop && (
              <span className={styles['headline']}>{counts.gear} GEAR</span>
            )}
            <input
              type="search"
              className={styles['search']}
              aria-label="Search gear"
              placeholder="Search gear"
              value={spec.search}
              onChange={(event) =>
                setSpec({ ...spec, search: event.target.value })
              }
            />
            {isSplit && (
              // The `+` is decoration; the FAB below Split and this button are
              // the same action, so they carry the same accessible name.
              <Link
                href="/add"
                className={styles['addButton']}
                aria-label="Add gear"
              >
                + Add gear
              </Link>
            )}
          </div>

          <SliceBar
            spec={spec}
            result={result}
            valuesFor={valuesFor}
            formatFor={formatFor}
            onChange={setSpec}
            layout={isDesktop ? 'expanded' : 'collapsed'}
          />

          {nothingRecorded ? (
            <p className={styles['empty']}>Nothing recorded yet.</p>
          ) : result.shown === 0 ? (
            <p className={styles['empty']}>No matches.</p>
          ) : (
            <ul
              className={`${styles['list']} ${isDesktop ? styles['table'] : ''}`}
            >
              {isDesktop && (
                <li className={styles['columnHeads']}>
                  {/*
                   * "Click a column head = sort" (§2). Only GEAR sorts, because
                   * at S3 two of the three sort keys are name and the third —
                   * NEWEST FIRST — has no column to be the head of: nothing in
                   * the table shows when a piece of gear was recorded. That is
                   * why the expanded arrange row keeps its SORT options here
                   * rather than dropping them as "the ▾ control appears only
                   * where no heads exist" would suggest: dropping them would
                   * leave NEWEST FIRST unreachable at desktop width.
                   */}
                  <button
                    type="button"
                    className={styles['columnHead']}
                    onClick={() =>
                      setSpec({
                        ...spec,
                        sort:
                          spec.sort === 'name-asc' ? 'name-desc' : 'name-asc',
                      })
                    }
                  >
                    GEAR{' '}
                    {spec.sort === 'name-asc'
                      ? '↑'
                      : spec.sort === 'name-desc'
                        ? '↓'
                        : ''}
                  </button>
                  <span>KIND</span>
                  <span>OWNER</span>
                  <span>HOME</span>
                  <span>TAGS</span>
                  <span>QTY</span>
                  <span>WHEREABOUTS</span>
                </li>
              )}
              {result.groups.map((group) => (
                <Group
                  key={group.key}
                  group={group}
                  state={state}
                  view={view}
                  layout={layout}
                  selectedId={selectedId}
                  groupKey={spec.group}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {!isSplit && (
        // **Outside `.screen`, and that is load-bearing.** The button is
        // `position: sticky`, so it comes to rest where flow puts it — and it
        // has to rest at the foot of the shell's main area, whose bottom edge
        // is the tab bar's top edge. Inside `.screen` it would rest at the end
        // of that element's content box instead. The container `.screen`
        // declares stays either way: it is what the list's own queries resolve
        // against. `Trips` has the same arrangement for the same reason.
        <Link href="/add" className={styles['fab']} aria-label="Add gear">
          +
        </Link>
      )}
    </>
  )
}
