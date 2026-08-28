import {
  normalizeTag,
  normalizeTagInput,
  type DimensionValue,
} from '@foerier/shared'
import { Sheet } from '@foerier/ui'
import { useState } from 'react'

import styles from './TagPicker.module.css'

/**
 * **The only place a tag's spelling is ever decided**
 * (`docs/design/README.md` §4a).
 *
 * There is **no Tag entity** — the vocabulary is whatever is currently
 * applied — and **there is no rename, ever**. A misspelling is corrected only
 * by removing it and applying the right one. So the moment of typing is the
 * only defence against `#Cooking` beside `#cooking`, and everything about
 * this component is that defence:
 *
 * - existing tags are offered **first, with counts**, so a near-duplicate
 *   becomes visible at the moment it would be created;
 * - creating is a **visibly distinct** row, never the default action;
 * - input is normalised **as it is typed**, and what the create row shows is
 *   exactly what the op will carry — `normalizeTag` is the payload, not a
 *   later cleanup.
 *
 * One anatomy, two modes:
 *
 * | Mode | `ON THIS GEAR` | `+ CREATE` |
 * | --- | --- | --- |
 * | `gear` — from gear detail's `+ tag` | yes, with ✕ | yes |
 * | `slice` — from the slice bar's `+ TAG` ghost | no | **no** |
 *
 * The slice bar picks from what exists and never creates, because a filter
 * for a tag nothing carries is a filter for nothing.
 *
 * **Trip-only gear is never tagged** (invariant 9). Neither mode ever mounts
 * on it — stated here because the trip-side screens reuse this picker from S7
 * on.
 */
export interface TagPickerProps {
  mode: 'gear' | 'slice'
  /** The household's whole vocabulary, with counts. */
  vocabulary: readonly DimensionValue[]
  /** What is on this gear (`gear` mode) or already selected (`slice` mode). */
  applied: readonly string[]
  /** The normalised tag. In `slice` mode it is always one that exists. */
  onApply: (tag: string) => void
  onRemove: (tag: string) => void
  onClose: () => void
}

/** One picker is open at a time — it is modal — so a fixed id is safe and
 * keeps the label's `htmlFor` readable. */
const INPUT_ID = 'tag-picker-input'

export function TagPicker({
  mode,
  vocabulary,
  applied,
  onApply,
  onRemove,
  onClose,
}: TagPickerProps) {
  // The field holds the **normalised** value, not the raw keystrokes. That is
  // what makes the create row an honest preview of the op: there is no second
  // cleanup step between what is shown and what is stored, and a typed `#` is
  // gone before it can become `##winter`.
  const [draft, setDraft] = useState('')

  // What the field holds may still end in the hyphen a trailing space became
  // (`cook-`, mid-word). What an op may carry never does — so the create row
  // offers `normalizeTag` of the draft, and that is exactly what it stores.
  const candidate = normalizeTag(draft)

  const appliedSet = new Set(applied)
  const offered = vocabulary.filter(
    (entry) => draft === '' || entry.value.includes(draft),
  )
  const canCreate =
    mode === 'gear' &&
    candidate !== null &&
    !appliedSet.has(candidate) &&
    !vocabulary.some((entry) => entry.value === candidate)

  return (
    <Sheet title="Tags" onClose={onClose} desktopCard>
      {/* The sheet's own rhythm is 12; this picker's blocks were drawn at 16
          and stay there, in a column of their own rather than by bending the
          primitive every other sheet shares. */}
      <div className={styles['body']}>
        {mode === 'gear' && (
          <div className={styles['group']} data-testid="on-this-gear">
            <span className={styles['groupLabel']}>ON THIS GEAR</span>
            {applied.length === 0 ? (
              <p className={styles['none']}>No tags yet.</p>
            ) : (
              <ul className={styles['chips']}>
                {applied.map((tag) => (
                  <li key={tag} className={styles['chip']}>
                    <span className={styles['chipLabel']}>#{tag}</span>
                    {/* No confirmation, deliberately: one op, instantly
                        reversible by re-applying. */}
                    <button
                      type="button"
                      className={styles['chipRemove']}
                      aria-label={`Remove #${tag}`}
                      onClick={() => onRemove(tag)}
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* `htmlFor` rather than a wrapping `<label>`: the `#` prefix sits in
            the well beside the input, and a wrapping label would fold it into
            the field's accessible name — announcing "Tag #" for a field whose
            name is Tag. */}
        <div className={styles['field']}>
          <label className={styles['fieldLabel']} htmlFor={INPUT_ID}>
            Tag
          </label>
          <span className={styles['well']}>
            {/* Drawn, never stored — and never typed, which is what makes
                `##winter` unreachable without a rule of its own. */}
            <span className={styles['hash']} aria-hidden="true">
              #
            </span>
            <input
              id={INPUT_ID}
              className={styles['input']}
              value={draft}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) =>
                setDraft(normalizeTagInput(event.target.value))
              }
            />
          </span>
        </div>

        <div className={styles['group']} data-testid="in-the-depot">
          <span className={styles['groupLabel']}>IN THE DEPOT</span>
          {offered.length === 0 ? (
            <p className={styles['none']}>
              {vocabulary.length === 0
                ? 'No tags in the depot yet.'
                : 'No matches.'}
            </p>
          ) : (
            <ul className={styles['rows']}>
              {offered.map((entry) => (
                <li key={entry.value}>
                  <button
                    type="button"
                    className={styles['row']}
                    disabled={appliedSet.has(entry.value)}
                    onClick={() => onApply(entry.value)}
                  >
                    <span className={styles['rowTag']}>#{entry.value}</span>
                    <span className={styles['rowCount']}>{entry.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canCreate && candidate !== null && (
          <button
            type="button"
            className={styles['create']}
            data-testid="create-tag"
            onClick={() => onApply(candidate)}
          >
            + CREATE #{candidate}
          </button>
        )}

        <p className={styles['fact']}>
          {
            'LOWERCASE · SPACES BECOME - · # IS DRAWN, NOT STORED · NO RENAME EXISTS — REMOVE + APPLY FIXES A SPELLING'
          }
        </p>

        <Sheet.Close>
          <button type="button" className={styles['close']}>
            Close
          </button>
        </Sheet.Close>
      </div>
    </Sheet>
  )
}
