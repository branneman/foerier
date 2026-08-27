import type { GroupKey, SliceSpec, SortKey } from '@foerier/shared'

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
 * `GROUP BY` offers `NONE · KIND` and **never TAG**. That is a domain fact
 * rather than a UI preference: tags are multi-valued, so a three-tag piece of
 * gear would land in three groups and the groups would not partition the
 * list. Slicing by tag is the filter's job.
 */
export interface SortGroupSheetProps {
  spec: SliceSpec
  onChange: (spec: SliceSpec) => void
  onClose: () => void
  /** Rendered in place rather than over a scrim — the expanded arrange row. */
  inline?: boolean
}

const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: 'name-asc', label: 'NAME A→Z' },
  { key: 'name-desc', label: 'NAME Z→A' },
  { key: 'newest', label: 'NEWEST FIRST' },
]

const GROUPS: readonly { key: GroupKey; label: string }[] = [
  { key: 'none', label: 'NONE' },
  { key: 'kind', label: 'KIND' },
]

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

export function SortGroupSheet({
  spec,
  onChange,
  onClose,
  inline = false,
}: SortGroupSheetProps) {
  const body = (
    <>
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
    </>
  )

  if (inline) return <div className={styles['inline']}>{body}</div>

  return (
    <div
      className={styles['scrim']}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={styles['sheet']}
        role="dialog"
        aria-modal="true"
        aria-label="Sort and group"
      >
        <span className={styles['grabber']} aria-hidden="true" />
        <h2 className={styles['title']}>Sort and group</h2>
        {body}
      </div>
    </div>
  )
}
