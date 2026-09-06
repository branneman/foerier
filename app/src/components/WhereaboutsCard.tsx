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
 *
 * **S10 (F16(3)): the unaccounted standing is a footer, never a row.** A row
 * form — `▲ UNACCOUNTED` / `LAST SEEN: …` — was drawn beside the frame
 * (`docs/design/README.md` §06's "LOSING" panel) and then retired: a row
 * claims a place in the stack, and unaccounted is the *absence* of a place,
 * not a slice with one; drawing it as a row also left the home row's own
 * count over-stating what is actually on the shelf, since a `lost` outcome
 * writes nothing to the depot. No such row form was ever scaffolded in this
 * file — the standing instead turns the home row's own glyph `▲` and adds
 * {@link WhereaboutsCardUnaccounted}'s footer, exactly as shipped below.
 */

const HOME_LABEL = '⌂ HOME SLOT'
/** F16(3)'s glyph swap on the home row alone — never applied to a trip row,
 *  and never a second spelling of `HOME_LABEL`'s own word. */
const HOME_ATTENTION_LABEL = '▲ HOME SLOT'

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

/**
 * S10, F16(3): the unaccounted standing, a **footer**, never a row — the
 * form `docs/design/README.md` §06 draws and then retires, because a row
 * claims a place and unaccounted is the absence of one, and because a row
 * left the home row's own count over-stating what is on the shelf. `units`
 * and `ownedCount` travel together: `GearDetail` hands both `null` for
 * anything that is not Counted (D1's rule, restated for the standing —
 * `whereabouts.ts`'s own private `unaccountedPrefix` decides the identical
 * thing for the Depot column and states why per-person draws no count
 * either), and this component reads that pairing rather than re-deriving
 * Kind.
 */
export interface WhereaboutsCardUnaccounted {
  /** The Trip of the latest live `lost` outcome (`Unaccounted.tripName`). */
  tripName: string
  /** The standing's own unit count — `×1` for Counted, `2` for per-person's
   *  `2 OF 3`, and unread for Single, which states no quantity at all. */
  units: number
  /** `ownedCountOf`'s raw answer — `null` for anything that is not Counted,
   *  and this prop's own gate for the Counted form. */
  ownedCount: number | null
  /** `Unaccounted.pieceIds.length` — non-zero exactly for per-person, and
   *  the gate for §5i G10's `N OF M PIECES` form. The two gates are
   *  mutually exclusive by construction; a Single leaves `ownedCount`
   *  `null` and this `0`. */
  pieceTotal: number
  /** Opens the Home picker's settle route — never a `Link` like
   *  `overClaim`'s, because RESOLVE opens a sheet on this same screen
   *  rather than routing away from it. */
  onResolve: () => void
}

export interface WhereaboutsCardProps {
  slices: readonly WhereaboutsSlice[]
  /** Present exactly while the gear is over-claimed (D8). */
  overClaim?: WhereaboutsCardOverClaim
  /** Present exactly while the unaccounted standing holds (S10, F16(3)).
   *  Domain §4's precedence (an unresolved Entry on an Active Trip · the
   *  unaccounted standing · home) decides the **order** of the two footer
   *  lines below, not which one draws: §5i G11 stacks them, because this
   *  card is not one slot. The home row's own `▲` glyph reflects this prop
   *  alone either way — whether the shelf count is short is a fact about
   *  the standing, and never about what else is also true. */
  unaccounted?: WhereaboutsCardUnaccounted
}

/** One form per Kind, each naming that Kind's own unit — the same rule
 *  `unaccountedPrefix` (`whereabouts.ts`) applies to the Depot column,
 *  restated here because this component takes the pairing as props rather
 *  than the Gear itself:
 *
 *  - Counted → `×1 LAST SEEN: TESSIN 2025 · OWNED ×3`
 *  - per-person → `2 OF 3 PIECES · LAST SEEN: TESSIN 2025` (§5i G10), and
 *    never `OWNED` — per-person gear has no owned-count (invariant 6)
 *  - Single → `LAST SEEN: TESSIN 2025`, no counts at all (D1)
 *
 *  The leading `▲` is added by the caller of this function, matching how
 *  `overClaim.text` is drawn. */
function unaccountedText(unaccounted: WhereaboutsCardUnaccounted): string {
  if (unaccounted.ownedCount !== null) {
    return `×${unaccounted.units} LAST SEEN: ${unaccounted.tripName} · OWNED ×${unaccounted.ownedCount}`
  }
  if (unaccounted.pieceTotal > 0) {
    return `${unaccounted.units} OF ${unaccounted.pieceTotal} PIECES · LAST SEEN: ${unaccounted.tripName}`
  }
  return `LAST SEEN: ${unaccounted.tripName}`
}

export function WhereaboutsCard({
  slices,
  overClaim,
  unaccounted,
}: WhereaboutsCardProps) {
  const splits = slices.some((slice) => sliceCountLabel(slice) !== null)
  const homeAttention = unaccounted !== undefined

  return (
    <div className={styles['card']}>
      {slices.map((slice) => (
        <div key={rowKey(slice)} className={styles['row']}>
          <div className={styles['rowMain']}>
            <span
              className={`${styles['label']} ${
                slice.kind === 'trip'
                  ? styles['labelTrip']
                  : homeAttention
                    ? styles['labelAttention']
                    : ''
              }`}
            >
              {/* F16(3): the home row's own glyph, `▲` in place of `⌂`,
                  drawn here rather than folded into `rowLabel` — the trip
                  row never takes this branch. */}
              {slice.kind === 'home' && homeAttention
                ? HOME_ATTENTION_LABEL
                : rowLabel(slice)}
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

      {/* **The footer is a stack, one line per standing** (§5i G11) — this
          card is not one slot. Over-claim leads, because the fact about
          *now* leads; the standing sits beneath it. Each line carries its
          own `RESOLVE`, and they settle different things: D7's routes to
          the over-claim band, F16's opens the Home picker here.

          It used to be a chain, and the cost was D7's own rule broken —
          *never a ▲ with no door*. A Gear both over-claimed and unaccounted
          drew the over-claim alone, so the home row kept its `▲` (that
          glyph reads `unaccounted` and nothing else) while the route that
          settles it was unreachable until the over-claim was resolved
          first. Recoverable is not the same as reachable.

          One ▲ per row stays a row rule, and the one-slot surfaces — the
          Depot column, the 2-line row, Find — keep their precedence
          unchanged (`rowWhereabouts`). A footer is not a row. */}
      {overClaim !== undefined && (
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
      {unaccounted !== undefined && (
        <p className={`${styles['hint']} ${styles['attention']}`}>
          <span>▲ {unaccountedText(unaccounted)}</span>
          <button
            type="button"
            className={styles['resolve']}
            onClick={unaccounted.onResolve}
          >
            RESOLVE
          </button>
        </p>
      )}
      {overClaim === undefined && unaccounted === undefined && (
        <p className={styles['hint']}>
          {splits
            ? 'SPLIT COUNT — BOTH TRUE AT ONCE. HOME SLOT IS KEPT WHILE OUT.'
            : 'HOME SLOT IS KEPT WHILE OUT.'}
        </p>
      )}
    </div>
  )
}
