import styles from './SegmentedControl.module.css'

/**
 * The segmented control — **one component, two sizes**, `Stepper`'s own
 * shape (`docs/design/README.md` §5, ruled there against two boards
 * disagreeing on a size) and adopted here for the same reason: three screens
 * had hand-rolled this box, `patterns.md` §5.5 named it, and the copies had
 * drifted.
 *
 * **`default` is h48 in the body face** — Add gear's `Kind` and `Recorded as`,
 * primary form controls on a phone. **`dense` is h40 in the mono label
 * face** — gear detail's edit sheet and F4's `CONTAINER | PERSON | ALL`.
 *
 * ## Why the face rides the size rather than taking a prop of its own
 *
 * All three callers co-vary: the 48 one is body-faced, both 40s are mono
 * caps. A second prop would be a channel nobody asks for, and this repo's
 * habit is not to invent one — split them the day a board draws a 48 in mono
 * or a 40 in body. Recorded here rather than left for a reader to wonder at.
 *
 * ## What the three copies disagreed about, and what won
 *
 * - **A focus ring.** `GearDetail`'s copy had `:has(input:checked)` and no
 *   `:has(input:focus-visible)`, so a keyboard user moving through its Kind
 *   selector saw nothing at all. Both sizes draw one here.
 * - **`overflow: hidden`.** Two copies clipped, to round their end corners.
 *   **A clipped descendant is not hit-testable**, so the dense size's `::after`
 *   extension would be dead on arrival inside one — and a `drawnSizes`-style
 *   test, which reads stylesheet *text*, would find the rule and pass over a
 *   hit area that does not exist. `Packing`'s copy had already worked this
 *   out; the end segments round themselves and nothing clips.
 * - **The hit extension itself.** Ruling O: 40 painted plus 4 above and
 *   below, **inset 0 horizontally**, because three segments share a row edge
 *   to edge and a horizontal grow would land a tap meant for `PERSON` on
 *   `CONTAINER`. The 48 size needs none — a standalone control is simply
 *   drawn ≥48.
 *
 * ## The fieldset stays with the caller
 *
 * This renders the box and its segments, never a `<fieldset>` or `<legend>`:
 * Add gear draws `Kind` visibly and F4 hides `Group by`, and one of them
 * also puts a fact line inside its fieldset. A `legendHidden` prop would be
 * this component deciding a thing the screen already knows. Callers wrap.
 *
 * `ui/` never imports the store or a router (`frontend-design.md` §5): props
 * in, callbacks out, and the caller owns what a value *means*
 * (`patterns.md` §5.3).
 */
export interface SegmentedOption<T extends string> {
  value: T
  /** Drawn as written. The mono size uppercases in CSS, never in the string. */
  label: string
}

export interface SegmentedControlProps<T extends string> {
  /**
   * The radio group's `name`. Two segmented controls on one page must not
   * share it, or checking one clears the other.
   */
  name: string
  options: readonly SegmentedOption<T>[]
  /**
   * **`undefined` draws the control with nothing checked**, which is a state
   * the app really has: gear detail's edit sheet may not assert a Kind for a
   * Gear whose `kind` register nobody wrote (`docs/design/README.md` §4). A
   * caller with no such state simply never passes it.
   */
  value: T | undefined
  onChange: (next: T) => void
  /** `default` is h48 in the body face; `dense` is h40 in mono caps. */
  size?: 'default' | 'dense'
}

export function SegmentedControl<T extends string>({
  name,
  options,
  value,
  onChange,
  size = 'default',
}: SegmentedControlProps<T>) {
  return (
    <div className={styles['segmented']} data-size={size}>
      {options.map((option) => (
        <label key={option.value} className={styles['segment']}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
