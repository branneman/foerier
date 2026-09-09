import { Link } from 'wouter'

import type { SyncStatus } from '../household/syncEngine'
import { syncLabel, syncTone } from '../household/syncLabel'
import styles from './ScreenBand.module.css'
import type { ScreenHeader } from './useMediaQuery'

/**
 * The band a pushed screen draws above its title: `‹ DEPOT` and `● SYNCED`
 * ([frontend-design §3.3](../../../docs/frontend-design.md)).
 *
 * {@link useScreenHeader} decides the band and this component draws it —
 * the two halves of one rule, each stated once. For two slices the hook
 * centralised the *decision* while every screen still pasted the
 * *rendering*, and the drift that invites arrived on schedule: the dot is
 * amber while the household is unreachable (`docs/design/README.md`, "6px
 * dot: sage SYNCED / amber OFFLINE"), and two screens carried the tone while
 * eight drew a sage dot beside the word `OFFLINE`. The tone is now
 * `syncTone`'s answer, read here and nowhere else in a screen.
 *
 * ## What is drawn
 *
 * - The back link, when `header.backLink`, with the `‹ ` prefix spelled here
 *   so no caller spells it differently. The label is upper-cased by the
 *   stylesheet, because three callers hand in a Trip's mixed-case name.
 * - The sync line, when `header.syncLine`. **Every caller hands in a `sync`**
 *   (§5n K23): the prop was optional for one screen, `InviteIssued`, which
 *   drew no sync line for want of a Split frame, and the round drew it one.
 *   With the exemption gone the hook's answer is the whole gate, so a band
 *   can no longer be true for a half its caller declines to supply.
 * - Nothing at all — `null`, no wrapper — when neither half is drawn.
 *
 * `GearListBuilder` is the one caller that draws its back link outside this
 * band, in its own Desktop header row; {@link BackLink} is exported for it so
 * the prefix and the style stay one spelling.
 */
export interface ScreenBandProps {
  /** {@link useScreenHeader}'s answer. */
  readonly header: ScreenHeader
  /** Where `‹ <label>` points, and what it says — `DEPOT`, `TRIPS`,
   * `ACCOUNT`, `PEOPLE & LOGINS`, or a Trip's own label. */
  readonly back: { readonly href: string; readonly label: string }
  /** The engine's status. Required: `header.syncLine` decides whether it is
   * drawn, and a screen that could not answer this would be a screen the
   * hook says draws a line and cannot. */
  readonly sync: SyncStatus
  /** A `data-testid` for the sync line, for the suites that name it
   * (`Packing.test.tsx`'s `packing-sync`, `Unpack.test.tsx`'s
   * `unpack-sync`). */
  readonly syncTestId?: string
}

export function ScreenBand({
  header,
  back,
  sync,
  syncTestId,
}: ScreenBandProps) {
  if (!header.band) return null

  return (
    <header className={styles['header']}>
      {header.backLink && <BackLink href={back.href} label={back.label} />}
      {header.syncLine && (
        <span className={styles['sync']} data-testid={syncTestId}>
          <span
            className={`${styles['syncDot']} ${
              syncTone(sync) === 'unreachable'
                ? styles['syncDotUnreachable']
                : ''
            }`}
            data-testid="screen-band-dot"
            aria-hidden="true"
          />
          {syncLabel(sync)}
        </span>
      )}
    </header>
  )
}

/** `‹ <label>`, the band's back link on its own — for `GearListBuilder`'s
 * Desktop header row, the one place the link is drawn outside the band. */
export function BackLink({
  href,
  label,
}: {
  readonly href: string
  readonly label: string
}) {
  return (
    <Link href={href} className={styles['back']}>
      ‹ {label}
    </Link>
  )
}
