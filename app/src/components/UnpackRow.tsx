import { outcomeGlyph, outcomeLabel, type OutcomeValue } from '@foerier/shared'
import {
  PersonCluster,
  StatusPill,
  type PersonClusterEntry,
  type StatusPillProps,
} from '@foerier/ui'
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
 * ## The `RE-HOMED` segment is muted, and lives inside the body button
 *
 * Task 14 (spec §4.6, board §7: *"muted, so the row says why it sits under
 * a room it did not leave from"*) — {@link UnpackRowProps.rehomed} draws a
 * `.rehomedSegment` span after `meta`, in `--color-ink-faint` rather than
 * `.meta`'s own `--color-ink-muted`. It sits **inside** the same body
 * button as the name and the meta, not beside them, so the row's own
 * accessible name still carries it. `meta` may legitimately be `''` while
 * `rehomed` is `true` (a re-home to Loose has no path to state), so the
 * segment never assumes a leading separator is wanted — it supplies its own
 * only when `meta` is non-empty.
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
 * **M3 gives the body a second reason to draw no button** —
 * {@link UnpackRowProps.canReHome}, `false` for a depot Entry whose Gear has
 * not yet synced. Only the body loses its button; the right slot (pill or
 * cluster) is untouched, since setting an outcome needs no Gear at all.
 *
 * ## A container row draws no rail
 *
 * F1: a container Entry is an ordinary row here — unlike `PackingRow`'s
 * CONTAINER mode, where a container is a group header with `JourneyRail`
 * beneath it, F5 has no journey to draw. This component never imports
 * `JourneyRail`.
 *
 * ## The cluster is this row's anatomy, not the sheet's (Task 13, F7)
 *
 * `PackingRow`'s identical shape one screen over: a 34px `PersonCluster`
 * and its own `×N`-carrying accessible name are **one control**
 * (`patterns.md` §5.4) — 44px hit areas on 32px centres let a tap meant for
 * one Person land on their neighbour, so no circle is ever a `<button>` of
 * its own. This component builds that control from the `cluster` prop's
 * plain data rather than accepting a pre-built node, because the accessible
 * name and the tap target are this row's own to build and clamp, exactly as
 * the pill is — `Unpack.tsx` hands down *who*, not *how it is wrapped*.
 *
 * Tapping the cluster calls the identical {@link UnpackRowProps.onOutcome}
 * the pill would — the caller (`Unpack.tsx`'s `openOutcome`) is what decides
 * this opens the sheet's roster variant rather than its plain one, by
 * reading the real Entry's own Kind once the sheet mounts. This row asks
 * that question of nobody.
 */
/**
 * **A meta segment led by `▸` takes the trip world's tone** (§5i G2).
 *
 * The glyph *is* the encoding — *"▸ says so — the two-worlds rule,
 * everywhere"* — so the row reads the mark the caller already wrote rather
 * than taking a second, parallel channel saying which segment is which. One
 * rule, stated once, and it generalises to whatever segment the trip world
 * reaches next.
 *
 * The split is on the segment separator, ` · `; the **path**'s own internal
 * `▸` (`→ SHELF L-TOP ▸ CRATE B`) never leads a segment, which is exactly
 * why *leads* is the test rather than *contains*.
 *
 * An untoned meta comes back as adjacent text nodes inside one span, which
 * `getByText` still matches whole — only a toned segment introduces a child
 * element, and those rows assert with `toHaveTextContent`.
 */
function metaSegments(meta: string): readonly ReactNode[] {
  return meta.split(' · ').flatMap((segment, index) => {
    const separator = index === 0 ? '' : ' · '
    return segment.startsWith('▸ ')
      ? [
          separator,
          <span key={segment} className={styles['tripSegment']}>
            {segment}
          </span>,
        ]
      : [`${separator}${segment}`]
  })
}

export interface UnpackRowProps {
  entryId: string
  name: string
  /** The return path, fully formatted by the caller — `→ SHELF L-TOP ▸
   * CRATE B · ×2`, a container's `→ SHELF L-TOP · 12 INSIDE`, a consumed
   * Counted's `→ BAK 3 · ×2 CONSUMED · ×2 BACK`, or `NOT IN DEPOT` for a
   * trip-only Entry. `''` draws no meta line at all — the Loose bucket's
   * fully-loose case, which has nothing to say. */
  meta: string
  /** `null` is open. Ignored when {@link tripOnly} is set, and unread when
   * {@link cluster} is given — a per-person Entry's outcome is per-Piece,
   * and the cluster's own tones are what state it. */
  outcome: OutcomeValue | null
  /** The pill's target — opens the outcome sheet (Task 12) — and the
   * cluster's, for the identical Entry (Task 13). */
  onOutcome: () => void
  /** The row body's target — opens the Home picker (Task 14). */
  onReHome: () => void
  /**
   * Task 13's 34px cluster, replacing the pill in the right slot for a
   * per-person, non-container Entry. `resolved`/`total` are
   * `countOfUnpack`'s own arithmetic over this Entry's Pieces, handed down
   * rather than re-derived from `people`'s tones here — one implementation
   * of "resolved over Pieces" (F7), read by both this row's accessible name
   * and the room header above it.
   */
  cluster?: {
    readonly people: readonly PersonClusterEntry[]
    readonly resolved: number
    readonly total: number
  }
  /** A trip-only Entry — see the docstring's "no button at all". */
  tripOnly?: boolean
  /** DESTINATION mode's own `RE-HOMED` segment (Task 14, spec §4.6) — see
   * the docstring's own section. Default `false`; PERSON and ALL mode never
   * set it (no board draws it there). */
  rehomed?: boolean
  /**
   * M3 — whether the body may open the re-home picker at all. Default
   * `true`. `false` for a depot Entry whose Gear has not yet synced to this
   * replica: `HomePicker` has nothing to read a residence from, so a body
   * button there would be a dead tap rather than the withheld act §3.7
   * asks for. The row still draws — only its body loses its button, the
   * identical shape a trip-only row's `.inertBody` already takes.
   */
  canReHome?: boolean
}

/**
 * `OutcomeValue | null` → `StatusPill`'s tone — the paint `ui/StatusPill`
 * does not itself know the meaning of (`patterns.md` §5.3).
 *
 * **`lost` takes its colour from the standing, not from the register**
 * (§5i G12), which is F18's own rule — *the word is history, the colour is
 * the standing* — reaching the pill. `RESOLVE` on gear detail re-homes and
 * leaves the outcome `lost`, so `▲ LOST` and `RE-HOMED` on one row are two
 * true facts: what happened, and where it went. Once the gear is home again
 * on a later clock the glyph and the word stay and the urgency goes — no
 * thermometer reading a room that is warm again.
 *
 * It reads the **same** `rehomed` flag the `RE-HOMED` segment draws from,
 * deliberately: the tone and the segment state one fact, and computing them
 * from two predicates is how they come apart.
 */
function toneForOutcome(
  outcome: OutcomeValue | null,
  rehomed: boolean,
): Exclude<StatusPillProps['tone'], undefined> {
  if (outcome === 'back') return 'packed'
  if (outcome === 'consumed') return 'dashed'
  if (outcome === 'lost') return rehomed ? 'muted' : 'attention'
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
  rehomed = false,
  canReHome = true,
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
      {(meta !== '' || rehomed) && (
        <span className={styles['meta']} data-testid="unpack-row-meta">
          {metaSegments(meta)}
          {rehomed && (
            <span
              className={styles['rehomedSegment']}
              data-testid="unpack-row-rehomed"
            >
              {meta !== '' ? ' · RE-HOMED' : 'RE-HOMED'}
            </span>
          )}
        </span>
      )}
    </>
  )

  return (
    <div className={styles['row']} data-testid={`unpack-row-${entryId}`}>
      {/* No *where* to open for a trip-only Entry — a plain span rather than
          a disabled button, which would still announce an act this row does
          not have (`PackingRow`'s ruling E9). */}
      {tripOnly || !canReHome ? (
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
        <button
          type="button"
          className={styles['cluster']}
          aria-label={`Outcome — ${name}, ${cluster.resolved} of ${cluster.total} resolved`}
          data-testid="unpack-row-cluster"
          onClick={onOutcome}
        >
          {/* `aria-hidden` + the button's own label above: this control
              already carries the whole fact as its accessible name, so
              `PersonCluster`'s own `role="img"` would announce the roster a
              second time (`PackingRow`'s identical pattern). */}
          <span aria-hidden="true" className={styles['clusterWrap']}>
            <PersonCluster
              people={cluster.people}
              size={34}
              label={`Outcome — ${name}, ${cluster.resolved} of ${cluster.total} resolved`}
            />
          </span>
        </button>
      ) : (
        <StatusPill
          glyph={outcomeGlyph(outcome)}
          label={outcomeLabel(outcome)}
          tone={toneForOutcome(outcome, rehomed)}
          onClick={onOutcome}
        />
      )}
    </div>
  )
}
