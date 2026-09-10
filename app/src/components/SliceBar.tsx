import {
  DIMENSIONS,
  dimension,
  groupLabel,
  selectedOf,
  withValueApplied,
  withValueRemoved,
  type DimensionId,
  type DimensionValue,
  type SliceResult,
  type SliceSpec,
  type SortKey,
} from '@foerier/shared'
import { useState } from 'react'

import { FilterChips } from './FilterChips'
import { SortGroupOptions, SortGroupSheet } from './SortGroupSheet'
import { TagPicker } from './TagPicker'
import { ValueMenu } from './ValueMenu'
import styles from './SliceBar.module.css'

/**
 * The slice bar at its **S3 ship state** (Components §04).
 *
 * Chips row · one count line · `CLEAR (n)` · the arrange readout. Everything
 * it renders comes from `shared/`'s dimension table, so the four later slices
 * that add a dimension add a row there and nothing here.
 *
 * ## The rules Components §04 settles, and where each lives
 *
 * - **The chip is 36px everywhere** — `ui/`'s `Chip`, which is where the
 *   32/36/40 drift across boards was settled.
 * - **Ghost add-chips are dimension-only** (`+ TAG`). The old value-carrying
 *   ghost (`+ TAG: #WINTER`) is retired; a ghost opens a picker, it does not
 *   carry an answer.
 * - **Single-valued dimensions hide their ghost while active**; `TAG` keeps
 *   its, because several tag chips AND together. Both fall straight out of
 *   `Dimension.arity` rather than being special-cased per dimension.
 * - **One count line.** `N OF M` covers search and filters together — they
 *   AND — so S2's shipped `4 MATCHES` becomes `4 OF 128`. Find keeps its own
 *   `N MATCHES · ON-DEVICE INDEX`: it answers a question rather than slicing
 *   a list, and the two reads are deliberately different.
 * - **`CLEAR (n)` is story 13's undo** and stays visible while anything
 *   narrows.
 *
 * ## Why `layout` is a prop and the row's fold is a container query
 *
 * "The expanded GROUP BY row appears only ≥600px container — desktop's."
 * Whether the screen is dense enough for an expanded arrange row is a
 * **shell** question — it moves with the sidebar and the pane structure — and
 * [frontend-design §3.1](../../../docs/frontend-design.md) gives shell
 * questions to media queries. `GearRow`'s own 2-line ↔ 1-line fold stays a
 * container query, per §3.2, which is why it folds inside Split's narrow list
 * pane at a viewport of 900.
 */
export interface SliceBarProps {
  spec: SliceSpec
  result: SliceResult
  /** What each dimension can currently be narrowed by — `dimensionValues`. */
  valuesFor: (id: DimensionId) => readonly DimensionValue[]
  /**
   * How one value of one dimension is drawn — `dimension(id).format(value,
   * state)`, bound to the state the screen already holds.
   *
   * Injected rather than called here, for the same reason `valuesFor` is: a
   * value is not always self-describing. S4's `PERSON` carries person ids and
   * draws names, so formatting needs the depot — and threading the whole
   * `HouseholdState` through a presentational component to reach one lookup would
   * be the wrong seam. The screen owns the state; this owns the anatomy.
   */
  formatFor: (id: DimensionId, value: string) => string
  onChange: (spec: SliceSpec) => void
  /** `expanded` puts GROUP BY inline; `collapsed` folds it behind the readout. */
  layout?: 'collapsed' | 'expanded'
}

const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  'name-asc': 'NAME A→Z',
  'name-desc': 'NAME Z→A',
  newest: 'NEWEST FIRST',
}

/** `NAME A→Z`, or `KIND · NAME A→Z` once grouped. The group half comes from
 * `shared/`'s grouping table, so this readout never has to be taught a new
 * grouping's name. */
function arrangeReadout(spec: SliceSpec): string {
  const sort = SORT_LABELS[spec.sort]
  return spec.group === 'none' ? sort : `${groupLabel(spec.group)} · ${sort}`
}

/** The whole table, in its own order: the Depot's bar offers every dimension. */
const DIMENSION_IDS: readonly DimensionId[] = DIMENSIONS.map((of) => of.id)

export function SliceBar({
  spec,
  result,
  valuesFor,
  formatFor,
  onChange,
  layout = 'collapsed',
}: SliceBarProps) {
  const [picking, setPicking] = useState<DimensionId | null>(null)
  const [arranging, setArranging] = useState(false)

  // The spec transitions are `slice.ts`'s, beside the table that states
  // arity — `DepotPicker`'s bar reads the same three, so a later dimension's
  // add-or-replace behaviour cannot be read two ways.
  function apply(id: DimensionId, value: string) {
    onChange(withValueApplied(spec, id, value))
    setPicking(null)
  }

  return (
    <div className={styles['bar']}>
      {/* The bar's own wrapper — it bleeds to the gutter and scrolls
          sideways below a 40rem container, which `DepotPicker`'s does not,
          so the container stays here and only the chips are shared. */}
      <div className={styles['chips']}>
        <FilterChips
          spec={spec}
          dimensions={DIMENSION_IDS}
          formatValue={formatFor}
          onPick={setPicking}
          onRemove={(id, value) => onChange(withValueRemoved(spec, id, value))}
          // **The picker is drawn in its own chip's place** (§5n K17): a
          // popover positions against an element inside its own Radix root,
          // so the chip goes in as the anchor rather than staying here while
          // the picker renders at the foot of the bar. Below Split the same
          // call draws the chip plainly and portals a sheet, which is what it
          // always did.
          overlayFor={(id, anchor) => {
            if (id !== picking) return undefined
            return id === 'tag' ? (
              <TagPicker
                mode="slice"
                anchor={anchor}
                vocabulary={valuesFor('tag')}
                applied={selectedOf(spec, 'tag')}
                onApply={(tag) => apply('tag', tag)}
                onRemove={(tag) => onChange(withValueRemoved(spec, 'tag', tag))}
                onClose={() => setPicking(null)}
              />
            ) : (
              <ValueMenu
                anchor={anchor}
                title={dimension(id).label}
                values={valuesFor(id)}
                format={(value) => formatFor(id, value)}
                selected={selectedOf(spec, id)}
                onPick={(value) => apply(id, value)}
                onClose={() => setPicking(null)}
              />
            )
          }}
        />
      </div>

      <div className={styles['countRow']}>
        <p className={styles['count']} data-testid="count-line">
          {result.shown} OF {result.total}
          {result.active > 0 && (
            <button
              type="button"
              className={styles['clear']}
              onClick={() =>
                // Filters and search only. Sort and group persist per device,
                // and clearing a narrowing is not a request to re-sort the
                // list under the reader.
                onChange({ ...spec, search: '', filters: {} })
              }
            >
              CLEAR ({result.active})
            </button>
          )}
        </p>

        {layout === 'collapsed' && (
          <button
            type="button"
            className={styles['readout']}
            data-testid="arrange-readout"
            onClick={() => setArranging(true)}
          >
            {arrangeReadout(spec)} <span aria-hidden="true">▾</span>
          </button>
        )}
      </div>

      {layout === 'expanded' && (
        <div className={styles['arrangeRow']}>
          <SortGroupOptions inline spec={spec} onChange={onChange} />
          {/* S9b — the one component `CONTAINER` makes spec §4.4's "changes
           * no component" untrue (`docs/design/README.md` §5f D5; recorded
           * in that spec's own §9.1). Every other dimension needs nothing
           * from this component; grouping by a partition does, because
           * nothing else on the bar tells a household that GROUP BY
           * CONTAINER files by immediate holder while the CONTAINER chip
           * itself still filters to any depth. The next dimension that
           * groups as well as filters inherits the same question.
           *
           * **The full stop belongs to the second clause, not to the first**
           * (§5g E11, which blessed the two-sentence shape and amended §5f D5
           * in place). `WhereaboutsCard`'s two-clause footer is the precedent,
           * and the bar's own middle dot is the separator between segments of
           * *one* fact — which these two are not. A single clause is a label
           * rather than a sentence and keeps its unterminated S3 form; S9b
           * terminated it unconditionally, so every `GROUP BY` in the app grew
           * a full stop no board draws. */}
          <span className={styles['hint']}>
            SEARCH + FILTERS COMBINE WITH AND
            {spec.group === 'container' &&
              '. GROUPS FILE EACH GEAR UNDER THE CONTAINER IT IS IN.'}
          </span>
        </div>
      )}

      {arranging && (
        <SortGroupSheet
          spec={spec}
          onChange={(next) => {
            onChange(next)
            setArranging(false)
          }}
          onClose={() => setArranging(false)}
        />
      )}
    </div>
  )
}
