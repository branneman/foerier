import {
  GROUP_KEYS,
  groupLabel,
  type GroupKey,
  type SliceSpec,
  type SortKey,
} from '@foerier/shared'
import { Sheet } from '@foerier/ui'

import styles from './SortGroupSheet.module.css'

/**
 * Sort and group — the pair that collapses behind the count line's arrange
 * readout on phone, and sits inline once there is room (Screens A §03,
 * Components §04).
 *
 * **The sheet primitive**: rows 40+, the current one marked `● NOW`. That is
 * the SET PHASE anatomy, reused deliberately rather than invented again — one
 * app should have exactly one way of saying "this is the one you are on".
 *
 * `GROUP BY` offers `NONE · KIND · OWNER` and **never TAG**. That is a
 * domain fact rather than a UI preference: tags are multi-valued, so a
 * three-tag piece of gear would land in three groups and the groups would not
 * partition the list. Slicing by tag is the filter's job.
 *
 * The options are **derived from `shared/`'s grouping table**, not listed
 * here, so a slice that adds a grouping adds a row there and nothing in this
 * file. Tag's absence is likewise not an omission to remember: a grouping
 * needs a `keyOf`, and Tag has none.
 *
 * ## Why this file exports two components
 *
 * The options are drawn twice and only one of them is a dialog: the expanded
 * arrange row is **in-page content**, not an overlay, so it must not carry a
 * `role="dialog"` and has nothing to close. That used to be an `inline` prop
 * on the sheet, which meant the inline caller had to pass an `onClose` that
 * did nothing. {@link SortGroupOptions} is the body on its own and
 * {@link SortGroupSheet} is that body inside `ui/`'s `Sheet` — so the dummy
 * `onClose` has no reason to exist and is gone.
 */
export interface SortGroupOptionsProps {
  spec: SliceSpec
  onChange: (spec: SliceSpec) => void
  /**
   * The expanded arrange row: laid out as a wrapping row in place, rather
   * than as the sheet's stacked column. Layout only — the controls, their
   * labels and their test ids are the same either way.
   */
  inline?: boolean
}

export interface SortGroupSheetProps {
  spec: SliceSpec
  onChange: (spec: SliceSpec) => void
  onClose: () => void
}

const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: 'name-asc', label: 'NAME A→Z' },
  { key: 'name-desc', label: 'NAME Z→A' },
  { key: 'newest', label: 'NEWEST FIRST' },
]

const GROUPS: readonly { key: GroupKey; label: string }[] = GROUP_KEYS.map(
  (key) => ({ key, label: groupLabel(key) }),
)

function Options<T extends string>({
  label,
  testId,
  options,
  current,
  onPick,
}: {
  label: string
  testId: string
  options: readonly { key: T; label: string }[]
  current: T
  onPick: (key: T) => void
}) {
  return (
    <div className={styles['group']} data-testid={testId}>
      <span className={styles['groupLabel']}>{label}</span>
      <ul className={styles['rows']}>
        {options.map((option) => (
          <li key={option.key}>
            <button
              type="button"
              className={styles['row']}
              aria-pressed={option.key === current}
              onClick={() => onPick(option.key)}
            >
              <span>{option.label}</span>
              {option.key === current && (
                <span className={styles['now']}>● NOW</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** SORT and GROUP BY, with no dialog around them. */
export function SortGroupOptions({
  spec,
  onChange,
  inline = false,
}: SortGroupOptionsProps) {
  return (
    <div className={inline ? styles['inline'] : styles['body']}>
      <Options
        label="SORT"
        testId="sort-options"
        options={SORTS}
        current={spec.sort}
        onPick={(sort) => onChange({ ...spec, sort })}
      />
      <Options
        label="GROUP BY"
        testId="group-options"
        options={GROUPS}
        current={spec.group}
        onPick={(group) => onChange({ ...spec, group })}
      />
    </div>
  )
}

/** The same options behind the count line's arrange readout, on phone. */
export function SortGroupSheet({
  spec,
  onChange,
  onClose,
}: SortGroupSheetProps) {
  return (
    <Sheet title="Sort and group" onClose={onClose} desktopCard>
      <SortGroupOptions spec={spec} onChange={onChange} />
    </Sheet>
  )
}
