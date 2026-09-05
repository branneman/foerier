import {
  containerText,
  LOOSE_TEXT,
  sliceCountLabel,
  stageWord,
  type PathSegment,
  type WhereaboutsSlice,
} from '@foerier/shared'
import { Link } from 'wouter'

import styles from './WhereaboutsCard.module.css'

/**
 * The Whereabouts card (`docs/design/README.md` §4): a surface at radius 12
 * with **one stacked row per {@link WhereaboutsSlice}** — home first, then
 * trip slices by name A→Z, the order `whereabouts` itself already returns —
 * and a footer that is the card's own summary of what it just said.
 *
 * Stays presentational (`frontend-design.md` §5): it takes domain data as
 * props, reads no store, and imports no selector for domain logic. **Whether
 * the gear splits is derived here, not passed** (D1): `slices.some((slice) =>
 * sliceCountLabel(slice) !== null)` is already D1's rule — *the right-hand
 * read names the unit that splits* — and a second boolean prop would be a
 * second spelling of it.
 */

const HOME_LABEL = '⌂ HOME SLOT'

/** The home row's value line: the full breadcrumb, or `LOOSE`
 * (`docs/ubiquitous-language.md`) rather than a blank row for gear residing
 * in no place and no container. `LOOSE_TEXT` and `containerText` are
 * `whereabouts.ts`'s own exports (S9b review finding 3) — this file no
 * longer keeps a private copy of either. */
function pathText(path: readonly PathSegment[]): string {
  if (path.length === 0) return LOOSE_TEXT
  return path.map((segment) => segment.name).join(' ▸ ')
}

/** A trip row's value line: container named when one or `MIXED` when more,
 *  the root's stage trailing only when every residence in the slice agrees
 *  on it (D2, D3) — never a second `MIXED`. */
function tripValueText(
  slice: Extract<WhereaboutsSlice, { kind: 'trip' }>,
): string {
  const segments = [containerText(slice.container)]
  if (slice.stage !== null) segments.push(stageWord(slice.stage))
  return segments.join(' · ')
}

/** `home:` or `trip:<tripId>` — the composite key two active Trips need
 *  (the closed defect: `key={slice.kind}` alone collides the moment a
 *  second `'trip'` slice exists). */
function rowKey(slice: WhereaboutsSlice): string {
  return slice.kind === 'home' ? 'home' : `trip:${slice.tripId}`
}

/** The label line: `⌂ HOME SLOT`, or `▸ ON TRIP — <name>` per active Trip. */
function rowLabel(slice: WhereaboutsSlice): string {
  return slice.kind === 'home' ? HOME_LABEL : `▸ ON TRIP — ${slice.tripName}`
}

/** The value line beneath the label: the home breadcrumb, or the trip's own
 *  container/stage pair (D2, D3) — never the trip name again, which the
 *  label line already carries. */
function rowValue(slice: WhereaboutsSlice): string {
  return slice.kind === 'home' ? pathText(slice.path) : tripValueText(slice)
}

export interface WhereaboutsCardOverClaim {
  /** The footer's stated fact — `claim.ts`'s two Counted-only numbers
   *  (`CLAIMED ×4 · OWNED ×2`) or the Piece row's string reused for every
   *  other Kind (`CLAIMED BY N TRIPS`, §6.1). `GearDetail` composes it,
   *  because the Counted-only branch is a domain rule this presentational
   *  component must not decide (decision 1). Drawn with a leading `▲`. */
  text: string
  /** Where `RESOLVE` routes — the first claiming Trip by name A→Z (D7). */
  href: string
  /** `RESOLVE`'s accessible name (D7: `Resolve on <trip>`), named
   *  independently of `text` because the fact line and the door it opens
   *  are two different sentences. */
  resolveLabel: string
}

export interface WhereaboutsCardProps {
  slices: readonly WhereaboutsSlice[]
  /** Present exactly while the gear is over-claimed (D8). */
  overClaim?: WhereaboutsCardOverClaim
}

export function WhereaboutsCard({ slices, overClaim }: WhereaboutsCardProps) {
  const splits = slices.some((slice) => sliceCountLabel(slice) !== null)

  return (
    <div className={styles['card']}>
      {slices.map((slice) => (
        <div key={rowKey(slice)} className={styles['row']}>
          <div className={styles['rowMain']}>
            <span
              className={`${styles['label']} ${
                slice.kind === 'trip' ? styles['labelTrip'] : ''
              }`}
            >
              {rowLabel(slice)}
            </span>
            <span className={styles['path']}>{rowValue(slice)}</span>
          </div>
          <span
            className={`${styles['count']} ${
              slice.kind === 'trip' ? styles['countTrip'] : ''
            }`}
          >
            {sliceCountLabel(slice)}
          </span>
        </div>
      ))}

      {overClaim === undefined ? (
        <p className={styles['hint']}>
          {splits
            ? 'SPLIT COUNT — BOTH TRUE AT ONCE. HOME SLOT IS KEPT WHILE OUT.'
            : 'HOME SLOT IS KEPT WHILE OUT.'}
        </p>
      ) : (
        <p className={`${styles['hint']} ${styles['attention']}`}>
          <span>▲ {overClaim.text}</span>
          <Link
            href={overClaim.href}
            className={styles['resolve']}
            aria-label={overClaim.resolveLabel}
          >
            RESOLVE
          </Link>
        </p>
      )}
    </div>
  )
}
