import {
  acceptsMore,
  dimension,
  selectedOf,
  type DimensionId,
  type SliceSpec,
} from '@foerier/shared'
import { Chip } from '@foerier/ui'
import { Fragment, type ReactNode } from 'react'

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
  /**
   * **The overlay for the dimension currently open, rendered in its chip's
   * place** (§5n K17).
   *
   * From Split up a value picker is a popover, and a popover positions
   * against an element inside its own Radix root — so the chip cannot stay
   * here while the picker is rendered by the bar above. The caller hands in a
   * function instead: for the one open dimension this component calls it with
   * that chip's own element and draws what comes back, and for every other
   * chip it draws the chip.
   *
   * A function rather than a node, because *which* chip is the anchor is
   * decided here — the caller knows what is open, this component knows where
   * each chip is. Absent for a caller with no picker at all.
   */
  readonly overlayFor?: (id: DimensionId, anchor: ReactNode) => ReactNode
}

export function FilterChips({
  spec,
  dimensions,
  formatValue,
  onPick,
  onRemove,
  overlayFor,
}: FilterChipsProps) {
  /** A chip, or the overlay anchored to it when that dimension is open. */
  const withOverlay = (id: DimensionId, chip: ReactNode): ReactNode =>
    overlayFor?.(id, chip) ?? chip

  return (
    <>
      {dimensions.flatMap((id) =>
        selectedOf(spec, id).map((value) => (
          <Fragment key={`${id}:${value}`}>
            {withOverlay(
              id,
              <Chip
                label={`${dimension(id).label}: ${formatValue(id, value)}`}
                selected
                onClick={() => onPick(id)}
                onRemove={() => onRemove(id, value)}
              />,
            )}
          </Fragment>
        )),
      )}

      {/* A single-valued dimension has nothing left to add once it holds a
          value; a multi-valued one always does. `acceptsMore` reads that off
          the dimension table, so a later dimension's arity reaches both bars
          without either restating it. */}
      {dimensions
        .filter((id) => acceptsMore(spec, id))
        .map((id) => (
          <Fragment key={`ghost-${id}`}>
            {/* The ghost is the anchor only when the dimension holds no
                selected chip: with one, the selected chip above is where the
                reader's eye and the picker both belong. */}
            {selectedOf(spec, id).length === 0 ? (
              withOverlay(
                id,
                <Chip
                  label={`+ ${dimension(id).label}`}
                  ghost
                  onClick={() => onPick(id)}
                />,
              )
            ) : (
              <Chip
                label={`+ ${dimension(id).label}`}
                ghost
                onClick={() => onPick(id)}
              />
            )}
          </Fragment>
        ))}
    </>
  )
}
