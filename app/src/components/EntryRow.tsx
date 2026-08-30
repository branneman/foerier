import type { KindValue } from '@foerier/shared'
import { Stepper } from '@foerier/ui'

import styles from './EntryRow.module.css'

/**
 * **One line on a Trip's gear list** — the row `GearListSection` groups by
 * Kind (spec §4.2, `docs/design/README.md` §5's S7 round). Presentational,
 * like `ui/`'s `GearRow`: domain data in, callbacks out, no store read of its
 * own — `GearListSection` is the one place that resolves `entryLabel` /
 * `entryKind` / `bringCountOf` / `pieceCountOf` against the fold and hands
 * this component the answers.
 *
 * **Layout order is the board's, not the trailing-column's.** Review round
 * F1: every editable board that draws a trip-only row (the 900/1024 builder
 * panes, the trip-only sheet preview) draws `name → badge → spacer → ✕` —
 * the name is *not* `flex: 1`, the badge sits beside it, and a **separate**
 * flexible spacer pushes `✕` to the row's edge. Every other Kind gives the
 * name itself `flex: 1` and puts its own content in the trailing slot. So
 * the `TRIP-ONLY` badge is a **name adjunct**, not trailing-column content —
 * an earlier draft put it in the trailing slot and then correctly, but
 * wrongly, applied the trailing-column's own read-only rule to it. The badge
 * now renders **in both modes**; `.trailing`'s read-only rule is unchanged
 * by this — see below.
 *
 * **Anatomy is `kind` × `editable`, and the two do not compose the way a
 * single switch would suggest.** Below Split (`editable`) the trailing slot
 * is kind-specific — a dense `Stepper` on `counted`, a plain `×N` on
 * `per_person`, nothing on every other Kind (`single`, `trip_only`, and
 * anything `GearListSection`'s `rowKind` has mapped to `'ungrouped'`) — and
 * a row ends in `✕`. From Split up (`!editable`) none of that survives: no
 * `✕`, no stepper, and the trailing slot reads `×N` for `counted` alone and
 * `—` for every other Kind, `trip_only` included. That second rule is the
 * spec's own wording (§4.2: "the trailing column reads `×4` for a Counted
 * Entry and `—` for everything else") and is deliberately **not** "the
 * editable anatomy minus the interactive controls" — the read-only pane
 * states less about *quantity* than the editable one, which is a narrower
 * claim than "states nothing about this row's Kind": the `TRIP-ONLY` badge
 * and the group headers both still say so.
 *
 * **`onBringCountChange` never fires for a no-op edit.** `Stepper` reports
 * its well's value as `number | null` and can call back with the value
 * already current — a clamp, or clear-and-retype the same digits (its own
 * docstring). Two guards sit between that report and this row's callback:
 * `null` (the well is blank — nothing chosen, never `0`, invariant 11) is
 * swallowed here rather than forwarded, and a reported value equal to the
 * current `bringCount` is dropped too, so a redundant `trip.entry_bring_-
 * count_set` is never authored (spec §4.9's needless-write rule, S6's).
 * **Neither guard special-cases `0`**: `next === bringCount` is a plain
 * numeric comparison, so decrementing from `1` to `0` compares `0 !== 1` and
 * is forwarded exactly like any other genuine change — `EntryRow.test.tsx`
 * pins this against the specific refactor that would break it
 * (`if (!next) return`, which reads as the same guard and silently is not).
 */
export interface EntryRowProps {
  readonly label: string
  readonly kind: KindValue | 'trip_only'
  /** `null` only ever arrives for a non-`counted` Kind — see `bringCountOf`. */
  readonly bringCount: number | null
  readonly pieceCount: number
  readonly editable: boolean
  /** Emits `trip.entry_bring_count_set`. Never called with the current value. */
  readonly onBringCountChange: (next: number) => void
  /** Emits `trip.entry_removed`. Does not confirm — the tag-chip rule. */
  readonly onRemove: () => void
}

export function EntryRow({
  label,
  kind,
  bringCount,
  pieceCount,
  editable,
  onBringCountChange,
  onRemove,
}: EntryRowProps) {
  const isTripOnly = kind === 'trip_only'

  function handleStepperChange(next: number | null) {
    if (next === null) return
    if (next === bringCount) return
    onBringCountChange(next)
  }

  const trailingContent = trailing(
    kind,
    bringCount,
    pieceCount,
    editable,
    label,
    handleStepperChange,
  )

  const rowClassName = editable
    ? styles['row']
    : `${styles['row']} ${styles['readOnly']}`

  return (
    <div className={rowClassName} data-testid="entry-row">
      <span
        className={
          isTripOnly
            ? styles['label']
            : `${styles['label']} ${styles['labelGrow']}`
        }
      >
        {label}
      </span>
      {isTripOnly && (
        <span className={styles['badge']} data-testid="entry-row-badge">
          TRIP-ONLY
        </span>
      )}
      {isTripOnly && <span className={styles['spacer']} aria-hidden="true" />}
      {trailingContent !== null && (
        <span className={styles['trailing']}>{trailingContent}</span>
      )}
      {editable && (
        <button
          type="button"
          className={styles['remove']}
          aria-label={`Remove ${label}`}
          data-testid="entry-row-remove"
          onClick={onRemove}
        >
          ✕
        </button>
      )}
    </div>
  )
}

function trailing(
  kind: KindValue | 'trip_only',
  bringCount: number | null,
  pieceCount: number,
  editable: boolean,
  label: string,
  handleStepperChange: (next: number | null) => void,
) {
  if (!editable) {
    // The spec's own rule: `×N` for Counted alone, `—` for everything else —
    // per_person and trip_only included. Not "the editable anatomy minus the
    // controls"; see this file's docstring.
    return (
      <span data-testid="entry-row-count">
        {kind === 'counted' ? `×${pieceCount}` : '—'}
      </span>
    )
  }

  switch (kind) {
    case 'counted':
      return (
        <Stepper
          size="dense"
          value={bringCount}
          min={0}
          onChange={handleStepperChange}
          label={`Bring-count for ${label}`}
        />
      )
    case 'per_person':
      return <span data-testid="entry-row-count">×{pieceCount}</span>
    default:
      // `single`, `trip_only` (whose badge is a name adjunct, not trailing
      // content — see this file's docstring), and any Kind `GearListSection`
      // has already mapped to `'ungrouped'` — nothing to draw here.
      return null
  }
}
