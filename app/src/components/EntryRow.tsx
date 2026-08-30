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
 * **Anatomy is `kind` × `editable`, and the two do not compose the way a
 * single switch would suggest.** Below Split (`editable`) the trailing slot
 * is kind-specific — a dense `Stepper` on `counted`, a plain `×N` on
 * `per_person`, nothing on `single`, the amber `TRIP-ONLY` badge on
 * `trip_only` — and a row ends in `✕`. From Split up (`!editable`) none of
 * that survives: no `✕`, no stepper, no badge, and the trailing slot reads
 * `×N` for `counted` alone and `—` for every other Kind, per_person and
 * trip_only included. That second rule is the spec's own wording
 * (§4.2: "the trailing column reads `×4` for a Counted Entry and `—` for
 * everything else") and is deliberately **not** "the editable anatomy minus
 * the interactive controls" — the read-only pane states less, not the same
 * facts with the buttons removed.
 *
 * **A Kind this replica cannot resolve is drawn as `'single'`** —
 * `entryKind` returns `undefined` for a depot Entry whose Gear has not yet
 * reached this replica's fold (the ordinary cross-aggregate sync race, spec
 * §3.1), and `GearListSection` maps that, and any Kind string this build
 * does not recognise, to `'single'` before it ever reaches this component.
 * `'single'`'s anatomy — nothing editable, `—` read-only — is the same
 * conservative default `pieceCountOf` already takes for both cases
 * (`entry.ts`'s own table), so a row this replica cannot fully explain draws
 * as inert rather than guessing at a stepper or a badge it cannot back up.
 * This component only ever sees the mapped value; it does not itself decide
 * what an unresolved Kind means.
 *
 * **`onBringCountChange` never fires for a no-op edit.** `Stepper` reports
 * its well's value as `number | null` and can call back with the value
 * already current — a clamp, or clear-and-retype the same digits (its own
 * docstring). Two guards sit between that report and this row's callback:
 * `null` (the well is blank — nothing chosen, never `0`, invariant 11) is
 * swallowed here rather than forwarded, and a reported value equal to the
 * current `bringCount` is dropped too, so a redundant `trip.entry_bring_-
 * count_set` is never authored (spec §4.9's needless-write rule, S6's).
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
  function handleStepperChange(next: number | null) {
    if (next === null) return
    if (next === bringCount) return
    onBringCountChange(next)
  }

  return (
    <div className={styles['row']} data-testid="entry-row">
      <span className={styles['label']}>{label}</span>
      <span className={styles['trailing']}>
        {trailing(
          kind,
          bringCount,
          pieceCount,
          editable,
          label,
          handleStepperChange,
        )}
      </span>
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
    case 'trip_only':
      return (
        <span className={styles['badge']} data-testid="entry-row-badge">
          TRIP-ONLY
        </span>
      )
    default:
      // `single`, and any Kind `GearListSection` has already mapped to it —
      // nothing to draw.
      return null
  }
}
