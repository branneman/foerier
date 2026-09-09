import {
  acceptsMore,
  dimension,
  selectedOf,
  type DimensionId,
  type SliceSpec,
} from '@foerier/shared'
import { Chip } from '@foerier/ui'

/**
 * The filter chip row — one selected chip per narrowed value, then a dashed
 * ghost per dimension that still has something to add.
 *
 * **Two bars draw it and only one of them is `SliceBar`.** `DepotPicker`
 * narrows by a *subset* of the dimension table and wants none of the bar's
 * other parts — no count line, no `CLEAR (n)`, no arrange readout — so
 * reusing `SliceBar` there was and is wrong. What the two share is this row
 * and the spec transitions under it, which is what got extracted rather than
 * the component around them.
 *
 * **It renders the chips and not their container.** The two callers' wrappers
 * genuinely differ — the Depot's bleeds to the gutter and scrolls sideways
 * below a 40rem container, the picker's simply wraps — so each keeps its own
 * `.chips` rule and this goes inside it. A component that swallowed the
 * wrapper would have to grow a prop for the difference, which is a layout
 * decision belonging to the screen.
 *
 * The **order** of the dimensions is the caller's list, not the table's, so a
 * caller narrowing by a subset (`DepotPicker`) draws exactly what it offers.
 */
export interface FilterChipsProps {
  /** The narrowing being drawn. */
  readonly spec: SliceSpec
  /** Which dimensions this bar offers, in the order it offers them. */
  readonly dimensions: readonly DimensionId[]
  /**
   * A value's drawn form — a Person id becomes a name, a tag keeps its `#`.
   * A prop because one caller formats through the fold it already holds and
   * the other through its own memo, and neither is this component's to reach
   * for.
   */
  readonly formatValue: (id: DimensionId, value: string) => string
  /** A chip or a ghost was tapped: open that dimension's picker. */
  readonly onPick: (id: DimensionId) => void
  /** A selected chip's `✕`. */
  readonly onRemove: (id: DimensionId, value: string) => void
}

export function FilterChips({
  spec,
  dimensions,
  formatValue,
  onPick,
  onRemove,
}: FilterChipsProps) {
  return (
    <>
      {dimensions.flatMap((id) =>
        selectedOf(spec, id).map((value) => (
          <Chip
            key={`${id}:${value}`}
            label={`${dimension(id).label}: ${formatValue(id, value)}`}
            selected
            onClick={() => onPick(id)}
            onRemove={() => onRemove(id, value)}
          />
        )),
      )}

      {/* A single-valued dimension has nothing left to add once it holds a
          value; a multi-valued one always does. `acceptsMore` reads that off
          the dimension table, so a later dimension's arity reaches both bars
          without either restating it. */}
      {dimensions
        .filter((id) => acceptsMore(spec, id))
        .map((id) => (
          <Chip
            key={`ghost-${id}`}
            label={`+ ${dimension(id).label}`}
            ghost
            onClick={() => onPick(id)}
          />
        ))}
    </>
  )
}
