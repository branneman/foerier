import {
  DIMENSIONS,
  dimension,
  groupLabel,
  type DimensionId,
  type DimensionValue,
  type SliceResult,
  type SliceSpec,
  type SortKey,
} from '@foerier/shared'
import { Chip } from '@foerier/ui'
import { useState } from 'react'

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

function selectedOf(spec: SliceSpec, id: DimensionId): readonly string[] {
  return spec.filters[id] ?? []
}

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

  function withFilters(id: DimensionId, values: readonly string[]): SliceSpec {
    const filters = { ...spec.filters }
    if (values.length === 0) delete filters[id]
    else filters[id] = values
    return { ...spec, filters }
  }

  function apply(id: DimensionId, value: string) {
    const of = dimension(id)
    const current = selectedOf(spec, id)
    // Arity decides add-or-replace, so a later single-valued dimension needs
    // no branch of its own here.
    const next =
      of.arity === 'single'
        ? [value]
        : current.includes(value)
          ? current
          : [...current, value]
    onChange(withFilters(id, next))
    setPicking(null)
  }

  function remove(id: DimensionId, value: string) {
    onChange(
      withFilters(
        id,
        selectedOf(spec, id).filter((held) => held !== value),
      ),
    )
  }

  return (
    <div className={styles['bar']}>
      <div className={styles['chips']}>
        {DIMENSIONS.flatMap((of) =>
          selectedOf(spec, of.id).map((value) => (
            <Chip
              key={`${of.id}:${value}`}
              label={`${of.label}: ${formatFor(of.id, value)}`}
              selected
              onClick={() => setPicking(of.id)}
              onRemove={() => remove(of.id, value)}
            />
          )),
        )}

        {DIMENSIONS.filter(
          // A single-valued dimension has nothing left to add once it holds a
          // value; a multi-valued one always does.
          (of) => of.arity === 'multi' || selectedOf(spec, of.id).length === 0,
        ).map((of) => (
          <Chip
            key={`ghost-${of.id}`}
            label={`+ ${of.label}`}
            ghost
            onClick={() => setPicking(of.id)}
          />
        ))}
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

      {picking === 'tag' && (
        <TagPicker
          mode="slice"
          vocabulary={valuesFor('tag')}
          applied={selectedOf(spec, 'tag')}
          onApply={(tag) => apply('tag', tag)}
          onRemove={(tag) => remove('tag', tag)}
          onClose={() => setPicking(null)}
        />
      )}

      {picking !== null && picking !== 'tag' && (
        <ValueMenu
          title={dimension(picking).label}
          values={valuesFor(picking)}
          format={(value) => formatFor(picking, value)}
          selected={selectedOf(spec, picking)}
          onPick={(value) => apply(picking, value)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
