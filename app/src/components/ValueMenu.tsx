import type { DimensionValue } from '@foerier/shared'

import styles from './SortGroupSheet.module.css'

/**
 * The picker behind a ghost add-chip for any dimension that is **not** Tag.
 *
 * Tag has its own (`TagPicker`) because tags are the one dimension whose
 * vocabulary a Quartermaster can extend, and that moment — deciding a
 * spelling — needs a whole component's worth of defences. Every other
 * dimension picks from what already exists, which is one list of rows with
 * counts.
 *
 * The values are **derived, not declared** (`dimensionValues`), which is what
 * lets an unrecognised Kind from a peer on a different build appear here at
 * all: it is in the depot, so it is offered, with no list of known values for
 * anyone to have forgotten to update.
 */
export interface ValueMenuProps {
  /** `KIND` — the dimension's own chip label. */
  title: string
  values: readonly DimensionValue[]
  format: (value: string) => string
  selected: readonly string[]
  onPick: (value: string) => void
  onClose: () => void
}

export function ValueMenu({
  title,
  values,
  format,
  selected,
  onPick,
  onClose,
}: ValueMenuProps) {
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
        aria-label={title}
      >
        <span className={styles['grabber']} aria-hidden="true" />
        <h2 className={styles['title']}>{title}</h2>

        {values.length === 0 ? (
          <p className={styles['none']}>Nothing to narrow by yet.</p>
        ) : (
          <ul className={styles['rows']}>
            {values.map((entry) => (
              <li key={entry.value}>
                <button
                  type="button"
                  className={styles['row']}
                  aria-pressed={selected.includes(entry.value)}
                  onClick={() => onPick(entry.value)}
                >
                  <span>{format(entry.value)}</span>
                  <span className={styles['count']}>{entry.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
