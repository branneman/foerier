import {
  containmentView,
  depotCounts,
  dimension,
  dimensionValues,
  homePath,
  ownerLabel,
  sliceDepot,
  tagsOf,
  type ContainmentView,
  type DepotState,
  type DimensionId,
  type GearState,
  type SliceGroup,
} from '@foerier/shared'
import { GearRow, Logo } from '@foerier/ui'
import { useMemo } from 'react'
import { Link } from 'wouter'

import { SliceBar } from '../components/SliceBar'
import { useDepot } from '../depot/store'
import { useSliceSpec } from '../depot/useSliceSpec'
import { DESKTOP, useMediaQuery } from '../shell/useMediaQuery'
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
 *   selector five later slices extend.
 * - **`ui/`'s `GearRow`**, which `Find` shares — the duplication
 *   [architecture §12.4](../../../docs/architecture-design.md) named as the
 *   reason to extract.
 *
 * **One count line.** `9 OF 128` covers search and filters together, so S2's
 * `4 MATCHES` read is gone. `128 GEAR · 214 PIECES` survives as the desktop
 * title row's headline, where the board puts it.
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

/** `×N` for counted gear only — a single reads `—` in the table (§03). */
function qtyFor(gear: GearState): string | undefined {
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

  return (
    <Link href={`/gear/${gear.id}`} asChild>
      <GearRow
        name={gear.name?.value ?? ''}
        href={`/gear/${gear.id}`}
        // Only the home world exists today; the amber trip read and the ▲
        // unaccounted read arrive with the trip and outcome slices, and are
        // deliberately not placeholder'd (the same call `Find` made in S2b).
        whereabouts="⌂ HOME"
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

function Group({
  group,
  state,
  view,
  layout,
  selectedId,
}: {
  group: SliceGroup
  state: DepotState
  view: ContainmentView
  layout: 'row' | 'table'
  selectedId: string | undefined
}) {
  return (
    <>
      {group.label !== '' && (
        // Packing's group header minus the journey rail: surface band, name
        // 16/600, right mono count (Screens A §03).
        <li className={styles['groupHeader']}>
          <span className={styles['groupName']}>{group.label}</span>
          <span className={styles['groupCount']}>{group.gear.length}</span>
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
    <div className={styles['screen']}>
      <div className={styles['main']}>
        {!isDesktop && (
          <header className={styles['header']}>
            <Logo size={28} title="foerier" />
          </header>
        )}

        <div className={styles['titleRow']}>
          <h1 className={styles['title']}>Depot</h1>
          {isDesktop && (
            <span className={styles['headline']}>
              {counts.gear} GEAR · {counts.pieces} PIECES
            </span>
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
          {isDesktop && (
            // The `+` is decoration; the phone FAB and this button are the
            // same action, so they carry the same accessible name.
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
                      sort: spec.sort === 'name-asc' ? 'name-desc' : 'name-asc',
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
              />
            ))}
          </ul>
        )}
      </div>

      {!isDesktop && (
        <Link href="/add" className={styles['fab']} aria-label="Add gear">
          +
        </Link>
      )}
    </div>
  )
}
