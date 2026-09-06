import { outcomeGlyph, outcomeLabel, type OutcomeValue } from '@foerier/shared'
import { StatusPill, type StatusPillProps } from '@foerier/ui'
import type { ReactNode } from 'react'

import styles from './UnpackRow.module.css'

/**
 * **F5's row** (`docs/design/README.md` §7, ruling F6; spec §4.3) —
 * `PackingRow`'s sibling one slice later, over a simpler contract: this
 * component draws what it is handed rather than reading the store itself,
 * because DESTINATION mode's caller (`Unpack.tsx`) already has to walk
 * `unpackItems` once for the group arithmetic and would otherwise compute
 * every row's return path twice.
 *
 * ## Three slots, and the meta is where it goes, the pill is what happened
 *
 * Name; the return path as `meta`, already formatted in every one of its
 * forms by the caller (`Unpack.tsx`'s `returnPathMeta`) — never re-derived
 * here, since a second formatter is exactly the drift this file's siblings
 * exist to prevent; and the right slot, which is the pill, a per-person
 * cluster, or — for a trip-only Entry — faint mono text that is neither.
 *
 * ## The pill reuses `ui/StatusPill`, not a second control
 *
 * Four outcomes, `StatusPill`'s tones: `back` → `packed`, `open` (`null`) →
 * `not-packed`, `consumed` → `dashed`, `lost` → `attention` — `dashed` names
 * the border `StatusPill` paints, not the outcome that asked for it (its own
 * rule; `PersonCircle` already owns this word for the identical border). The
 * glyph and the label come from `outcomeGlyph`/`outcomeLabel` — `OUTCOMES`'
 * own words, never re-typed here. `StatusPill`'s own pill is carved out of
 * ruling O's 48px hit-area floor at **44**, drawn directly with no clamp
 * (`ui/src/StatusPill.test.tsx`); this row does not repeat that floor.
 *
 * ## A trip-only row draws no button at all
 *
 * Not a disabled one — `PackingRow`'s ruling E9 shape, transplanted: a
 * trip-only Entry has no *where* to re-home to and no outcome to open a
 * sheet onto, so both targets are withheld rather than offered inert. The
 * right slot's `CLEARS AT CLOSE` is text, not a pill shape — F6: "a pill
 * shape is a control on every other row" — and the row body is a plain
 * `<span>`, exactly as `PackingRow`'s inert per-person row is.
 *
 * ## A container row draws no rail
 *
 * F1: a container Entry is an ordinary row here — unlike `PackingRow`'s
 * CONTAINER mode, where a container is a group header with `JourneyRail`
 * beneath it, F5 has no journey to draw. This component never imports
 * `JourneyRail`.
 */
export interface UnpackRowProps {
  entryId: string
  name: string
  /** The return path, fully formatted by the caller — `→ SHELF L-TOP ▸
   * CRATE B · ×2`, a container's `→ SHELF L-TOP · 12 INSIDE`, a consumed
   * Counted's `→ BAK 3 · ×2 CONSUMED · ×2 BACK`, or `NOT IN DEPOT` for a
   * trip-only Entry. `''` draws no meta line at all — the Loose bucket's
   * fully-loose case, which has nothing to say. */
  meta: string
  /** `null` is open. Ignored when {@link tripOnly} is set. */
  outcome: OutcomeValue | null
  /** The pill's target — opens the outcome sheet (Task 12). */
  onOutcome: () => void
  /** The row body's target — opens the Home picker (Task 14). */
  onReHome: () => void
  /**
   * Task 13's 34px `PersonCluster`, replacing the pill in the right slot for
   * a per-person Entry. Absent in DESTINATION mode today — Task 13's row —
   * but the slot is shaped to take it now rather than being redrawn around
   * it later (`docs/design/README.md` §5h ruling R3).
   */
  cluster?: ReactNode
  /** A trip-only Entry — see the docstring's "no button at all". */
  tripOnly?: boolean
}

/** `OutcomeValue | null` → `StatusPill`'s tone — the paint `ui/StatusPill`
 * does not itself know the meaning of (`patterns.md` §5.3). */
function toneForOutcome(
  outcome: OutcomeValue | null,
): Exclude<StatusPillProps['tone'], undefined> {
  if (outcome === 'back') return 'packed'
  if (outcome === 'consumed') return 'dashed'
  if (outcome === 'lost') return 'attention'
  return 'not-packed'
}

export function UnpackRow({
  entryId,
  name,
  meta,
  outcome,
  onOutcome,
  onReHome,
  cluster,
  tripOnly = false,
}: UnpackRowProps) {
  const bodyContent = (
    <>
      <span className={styles['nameLine']}>
        <span className={styles['name']} data-testid="unpack-row-name">
          {name}
        </span>
        {/* The leading `{' '}` is not decoration — `PackingRow` and
            `EntryRow` carry the identical note beside their own badge:
            `.nameLine`'s flex `gap` separates the two spans on screen but is
            not a character, so without it the row's text content — and the
            body button's accessible name — reads `PassportsTRIP-ONLY`, one
            word, glued to the name (`patterns.md` §6.6). */}
        {tripOnly && (
          <>
            {' '}
            <span className={styles['badge']} data-testid="unpack-row-badge">
              TRIP-ONLY
            </span>
          </>
        )}
      </span>
      {meta !== '' && (
        <span className={styles['meta']} data-testid="unpack-row-meta">
          {meta}
        </span>
      )}
    </>
  )

  return (
    <div className={styles['row']} data-testid={`unpack-row-${entryId}`}>
      {/* No *where* to open for a trip-only Entry — a plain span rather than
          a disabled button, which would still announce an act this row does
          not have (`PackingRow`'s ruling E9). */}
      {tripOnly ? (
        <span className={styles['inertBody']}>{bodyContent}</span>
      ) : (
        <button
          type="button"
          className={styles['body']}
          data-testid="unpack-row-body"
          onClick={onReHome}
        >
          {bodyContent}
        </button>
      )}

      {tripOnly ? (
        <span className={styles['clears']} data-testid="unpack-row-clears">
          CLEARS AT CLOSE
        </span>
      ) : cluster !== undefined ? (
        cluster
      ) : (
        <StatusPill
          glyph={outcomeGlyph(outcome)}
          label={outcomeLabel(outcome)}
          tone={toneForOutcome(outcome)}
          onClick={onOutcome}
        />
      )}
    </div>
  )
}
