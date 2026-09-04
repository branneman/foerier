import { Link } from 'wouter'

import type { SyncStatus } from '../depot/syncEngine'
import { syncLabel, syncTone } from '../depot/syncLabel'
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
 * - The sync line, when `header.syncLine` **and** a {@link ScreenBandProps.sync}
 *   was handed in. A screen that draws no sync line omits `sync`, and the
 *   wrapper then gates on the back link alone — `InviteIssued`'s case, where
 *   `band` would be true at Split for a half that does not exist and the
 *   `<header>` would render empty, the very thing `band` exists to prevent.
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
  /** The engine's status, or omitted for a screen that draws no sync line. */
  readonly sync?: SyncStatus
  /** A `data-testid` for the sync line, for the one suite that names it
   * (`Packing.test.tsx`'s `packing-sync`). */
  readonly syncTestId?: string
}

export function ScreenBand({
  header,
  back,
  sync,
  syncTestId,
}: ScreenBandProps) {
  const drawSync = header.syncLine && sync !== undefined
  if (!header.backLink && !drawSync) return null

  return (
    <header className={styles['header']}>
      {header.backLink && <BackLink href={back.href} label={back.label} />}
      {drawSync && (
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
