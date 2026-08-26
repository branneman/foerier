import type { PathSegment, WhereaboutsSlice } from '@foerier/shared'

import styles from './WhereaboutsCard.module.css'

/**
 * The Whereabouts card (`docs/design/README.md` §4): a surface at radius 12
 * with one stacked row per {@link WhereaboutsSlice} and a footer hint. S2b's
 * `whereabouts` selector always answers with exactly one `'home'` slice, so
 * this renders one `⌂ HOME SLOT` row today — the `▸ ON TRIP` amber row and
 * the `▲ UNACCOUNTED` variant are stories 9–11's work, on `'trip'`/`'lost'`
 * slice kinds that do not exist yet.
 *
 * **Maps over `slices`, never reads `slices[0]`** — the same shape `Find`'s
 * `CountedCard` already takes. That does not make a second slice kind free,
 * though: `HOME_LABEL` is hardcoded inside the map and `key={slice.kind}`
 * collides once two `'trip'` slices exist at once (multiple active trips).
 * The type will force both edits when that lands; this just keeps the
 * iteration shape from needing to change too.
 */

const HOME_LABEL = '⌂ HOME SLOT'

/** The path text for one slice's row: the full breadcrumb, or `LOOSE`
 * (`docs/ubiquitous-language.md`) rather than a blank row for gear residing
 * in no place and no container. */
function pathText(path: readonly PathSegment[]): string {
  if (path.length === 0) return 'LOOSE'
  return path.map((segment) => segment.name).join(' ▸ ')
}

export function WhereaboutsCard({
  slices,
}: {
  slices: readonly WhereaboutsSlice[]
}) {
  return (
    <div className={styles['card']}>
      {slices.map((slice) => (
        <div key={slice.kind} className={styles['row']}>
          <div className={styles['rowMain']}>
            <span className={styles['label']}>{HOME_LABEL}</span>
            <span className={styles['path']}>{pathText(slice.path)}</span>
          </div>
          <span className={styles['count']}>×{slice.count} THERE</span>
        </div>
      ))}
      <p className={styles['hint']}>
        SPLIT COUNT — BOTH TRUE AT ONCE. HOME SLOT IS KEPT WHILE OUT.
      </p>
    </div>
  )
}
