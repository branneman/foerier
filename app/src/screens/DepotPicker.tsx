import {
  dimension,
  dimensionValues,
  EMPTY_SLICE,
  entriesOf,
  homePath,
  sliceDepot,
  systemIdSource,
  tripEntryAdded,
  tripLabel,
  visibleGear,
  type DimensionId,
  type SliceSpec,
} from '@foerier/shared'
import { Chip } from '@foerier/ui'
import { useMemo, useState } from 'react'
import { Link } from 'wouter'

import { TagPicker } from '../components/TagPicker'
import { ValueMenu } from '../components/ValueMenu'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import { useScreenHeader } from '../shell/useMediaQuery'
import styles from './DepotPicker.module.css'

/**
 * **`Add from the depot`** — the picker a Quartermaster adds gear to a Trip
 * from, in two variants of the same component
 * (`docs/specs/2026-08-29-the-gear-list.md` §4.3):
 *
 * - `'screen'` — `/trips/:id/add`, below Split only. A screen, not a sheet, on
 *   `docs/design/README.md` §3b's argument, every clause of which transfers:
 *   the OS keyboard owns the lower half for a whole sitting, and `IN LIST ✓`
 *   keeps the row visible after the add, so the sitting is a **batch loop**.
 *   The Home picker — the counter-precedent — closes on selection, exactly
 *   what this must not do.
 * - `'pane'` — the builder's left pane at Split and up (`/trips/:id/list`,
 *   Task 11), eyebrow `FROM THE DEPOT` in place of the screen's own header and
 *   title. Task 11 mounts this component as-is; nothing here is written for
 *   one variant and patched for the other.
 *
 * ## Narrowing is scoped, not the Depot's own `SliceBar`
 *
 * The board draws three ghost chips at 393 (`+ TAG` `+ KIND` `+ TRIP`) and two
 * at 900 (`+ TAG` `+ KIND`), with no rule stated either way — spec §4.3 rules
 * to follow each board at its own width, which is `+ TRIP` renders in the
 * `'screen'` variant only. `SliceBar` hard-codes the Depot's full
 * `DIMENSIONS` table (tag, kind, ownership, person, trip) and cannot be
 * handed this subset, so this component narrows through `sliceDepot`
 * directly with its own small dimension list rather than reusing that
 * component — the picking mechanics (`ValueMenu`, `TagPicker`, `Chip`) are
 * shared, the chip row is not.
 *
 * `spec.group` is always `'none'`: `sliceDepot`'s grouping is the Depot
 * list's own feature (Kind/Owner bands), and this picker draws a flat list,
 * so `result.groups` is always exactly zero or one group.
 *
 * `sliceDepot` filters through `visibleGear` internally, so **Retired Gear is
 * never offered** with no extra guard needed here.
 *
 * ## No claim read, and no flash on add
 *
 * A claim is a relationship between two Trips; this picker speaks for one,
 * and the over-claim band on `/trips/:id` is the signal a cross-Trip clash
 * exists. A second signal here — a read on this row, a flash on add — would
 * say it twice. `tripEntryAdded` lands as a local op with no confirmation of
 * any kind; the row's own `IN LIST ✓` is the only feedback, and it is
 * permanent for the sitting rather than transient.
 *
 * ## The meta slot carries the home path, and nothing else
 *
 * `Components` §03's "no whereabouts" is confirmed narrowly by the round: no
 * world chip, no status. `docs/design/README.md` §5 states the anatomy as
 * "40px rows (name + home path)" for the pane, and spec §4.3 the same for the
 * screen — home path alone, not the owner initial or the quantity annotations
 * a couple of the board's own row examples happen to draw (`SLAAPKAMER ▸
 * KAST · E`, `KELDER ▸ BAK 3 · ×4`). Those are richer than either the brief
 * or the prose anatomy asks for, and Depot.tsx's own `metaFor` already
 * combines owner + path + count for a *different* screen's meta slot — adding
 * that here would be a wider decision than this task was handed, so the row
 * draws the path alone: `LOOSE` for a piece of gear with no residence,
 * matching `GearDetail.tsx`'s `chipLocation` fallback for the identical
 * question.
 */
export interface DepotPickerProps {
  tripId: string
  variant: 'screen' | 'pane'
}

/** The dimensions this picker can narrow by, and at which width — spec
 * §4.3's one board inconsistency, followed rather than silently resolved. */
function dimensionsFor(variant: 'screen' | 'pane'): readonly DimensionId[] {
  return variant === 'screen' ? ['tag', 'kind', 'trip'] : ['tag', 'kind']
}

export function DepotPicker({ tripId, variant }: DepotPickerProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  // `splitPane: false` — this is not the detail pane of a list also on
  // screen. Only the `'screen'` variant renders what it answers: the `'pane'`
  // variant's own band (back link + sync) belongs to Task 11's builder page,
  // which draws one band for both panes together, per spec §4.4.
  const header = useScreenHeader({ splitPane: false })

  const [spec, setSpec] = useState<SliceSpec>(EMPTY_SLICE)
  const [picking, setPicking] = useState<DimensionId | null>(null)

  const trip = state.trips[tripId]
  const dimensions = dimensionsFor(variant)

  const totalGear = useMemo(() => visibleGear(state).length, [state])
  const result = useMemo(() => sliceDepot(state, spec), [state, spec])
  const rows = result.groups[0]?.gear ?? []

  // Every Gear this Trip already lists from the depot — `IN LIST ✓`'s whole
  // question. Scoped to entries whose source is a depot reference: a
  // trip-only Entry names no Gear and never reaches this picker either way.
  const listedIds = useMemo(() => {
    const ids = new Set<string>()
    if (trip === undefined) return ids
    for (const entry of entriesOf(trip, state)) {
      const source = entry.source?.value
      if (source !== undefined && source.from === 'depot') {
        ids.add(source.gearId)
      }
    }
    return ids
  }, [trip, state])

  function selectedOf(id: DimensionId): readonly string[] {
    return spec.filters[id] ?? []
  }

  function withFilters(id: DimensionId, values: readonly string[]): SliceSpec {
    const filters = { ...spec.filters }
    if (values.length === 0) delete filters[id]
    else filters[id] = values
    return { ...spec, filters }
  }

  // `SliceBar`'s own `apply`/`remove`, scoped to this picker's own state
  // rather than a caller-owned `spec` — narrowing here is this sitting's,
  // not a preference `useSliceSpec` would persist across visits.
  function apply(id: DimensionId, value: string) {
    const of = dimension(id)
    const current = selectedOf(id)
    const next =
      of.arity === 'single'
        ? [value]
        : current.includes(value)
          ? current
          : [...current, value]
    setSpec(withFilters(id, next))
    setPicking(null)
  }

  function remove(id: DimensionId, value: string) {
    setSpec(
      withFilters(
        id,
        selectedOf(id).filter((held) => held !== value),
      ),
    )
  }

  function addToTrip(gearId: string) {
    emit(
      tripEntryAdded(tripId, systemIdSource.next(), {
        from: 'depot',
        gearId,
      }),
    )
  }

  const backLabel = trip === undefined ? '' : tripLabel(trip)

  return (
    <div
      className={variant === 'screen' ? styles['screen'] : styles['pane']}
      data-testid="depot-picker"
    >
      {variant === 'screen' && header.band && (
        // The same band every pushed screen carries, under the same rule
        // (`frontend-design.md` §3.3): `useScreenHeader` decides both halves.
        <header className={styles['header']}>
          {header.backLink && (
            <Link href={`/trips/${tripId}`} className={styles['back']}>
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

      {variant === 'screen' ? (
        <h1 className={styles['title']}>Add from the depot</h1>
      ) : (
        <p className={styles['eyebrow']}>FROM THE DEPOT</p>
      )}

      <input
        type="search"
        className={styles['search']}
        aria-label="Search the depot"
        placeholder="Search the depot…"
        autoFocus
        value={spec.search}
        onChange={(event) => setSpec({ ...spec, search: event.target.value })}
      />

      <div className={styles['chips']}>
        {dimensions.flatMap((id) =>
          selectedOf(id).map((value) => (
            <Chip
              key={`${id}:${value}`}
              label={`${dimension(id).label}: ${dimension(id).format(value, state)}`}
              selected
              onClick={() => setPicking(id)}
              onRemove={() => remove(id, value)}
            />
          )),
        )}

        {dimensions
          .filter(
            (id) =>
              dimension(id).arity === 'multi' || selectedOf(id).length === 0,
          )
          .map((id) => (
            <Chip
              key={`ghost-${id}`}
              label={`+ ${dimension(id).label}`}
              ghost
              onClick={() => setPicking(id)}
            />
          ))}
      </div>

      {totalGear === 0 ? (
        // `Components` §07 verbatim — the same voice `Depot.tsx` would draw
        // for a genuinely empty household, restated here because this screen
        // never mounts `Depot.tsx` itself.
        <div className={styles['empty']} data-testid="depot-picker-empty">
          <p className={styles['emptyTitle']}>Empty depot.</p>
          <p className={styles['emptyLine']}>Add the first item.</p>
          <Link href="/add" className={styles['emptyAction']}>
            + Add gear
          </Link>
        </div>
      ) : result.shown === 0 ? (
        // `Components` §07 verbatim, the unmatched twin. `result.active`
        // counts search and filters together, exactly `SliceBar`'s
        // `CLEAR (n)` does — the same one narrowing question, asked here in
        // words instead of a parenthesised number.
        <div className={styles['empty']} data-testid="depot-picker-unmatched">
          <p className={styles['emptyTitle']}>No matches.</p>
          <p className={styles['emptyLine']}>
            {result.active} {result.active === 1 ? 'FILTER' : 'FILTERS'} ACTIVE
          </p>
          <button
            type="button"
            className={styles['emptyAction']}
            onClick={() => setSpec(EMPTY_SLICE)}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className={styles['rows']}>
          {rows.map((gear) => {
            const listed = listedIds.has(gear.id)
            const name = gear.name?.value ?? ''
            const path = homePath(state, gear.id)
              .map((segment) => segment.name)
              .join(' ▸ ')
            return (
              <li
                key={gear.id}
                className={`${styles['row']} ${listed ? styles['muted'] : ''}`}
                data-testid="depot-picker-row"
              >
                <div className={styles['main']}>
                  <span className={styles['name']}>{name}</span>
                  <span className={styles['meta']}>
                    {path === '' ? 'Loose' : path}
                  </span>
                </div>
                {listed ? (
                  <span className={styles['listed']}>IN LIST ✓</span>
                ) : (
                  <button
                    type="button"
                    className={styles['add']}
                    aria-label={`Add ${name}`}
                    onClick={() => addToTrip(gear.id)}
                  >
                    + ADD
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className={styles['hint']}>
        ADDING LISTS IT — GEAR DOES NOT MOVE UNTIL PACK-OUT
      </p>

      {picking === 'tag' && (
        <TagPicker
          mode="slice"
          vocabulary={dimensionValues(state, 'tag')}
          applied={selectedOf('tag')}
          onApply={(tag) => apply('tag', tag)}
          onRemove={(tag) => remove('tag', tag)}
          onClose={() => setPicking(null)}
        />
      )}

      {picking !== null && picking !== 'tag' && (
        <ValueMenu
          title={dimension(picking).label}
          values={dimensionValues(state, picking)}
          format={(value) => dimension(picking).format(value, state)}
          selected={selectedOf(picking)}
          onPick={(value) => apply(picking, value)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
