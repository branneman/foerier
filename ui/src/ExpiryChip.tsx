import { useEffect, useState } from 'react'

import styles from './ExpiryChip.module.css'

/**
 * `EXPIRES IN 6 d` · `EXPIRES IN 3 h` · `EXPIRES IN 58 min`
 * (`docs/design/README.md` §14).
 *
 * **Not a `Chip`.** `ui/Chip` is the tag-and-filter chip settled by
 * Components §04 and §06 — 36px or 32px, three appearances, a `#`-bearing
 * label somebody taps. This is §14's own separate anatomy: radius 999, 1.5px
 * stroke, mono 10/600, inert, and a *status* rather than a value. Two
 * components that share a border radius are not one component.
 *
 * Three callers, which is what moved it out of a screen's CSS module: the
 * invite card on `InviteIssued`, the outstanding-invite row on People &
 * logins, and the confirm card on `Join` — the same Invite, read from the
 * other end of the handover.
 */
export interface ExpiryChipProps {
  /** ISO string or Date — when the Invite dies. */
  expiresAt: string | Date
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The **displayed** string only, and nothing else may read it. `d` floors and
 * `min` rounds on purpose: a fresh 7-day Invite reads `6 d`, because a link
 * claiming `7 d` on the day it dies is a lie in the direction that costs
 * somebody a handover, while a minute's rounding either way costs nothing.
 */
function label(remainingMs: number): string {
  const remaining = Math.max(0, remainingMs)
  if (remaining >= 2 * DAY) return `${Math.floor(remaining / DAY)} d`
  if (remaining >= HOUR) return `${Math.floor(remaining / HOUR)} h`
  return `${Math.round(remaining / MINUTE)} min`
}

/**
 * Forces a re-render every 30s so the count is live at minute granularity
 * (§14). Deliberately a trigger only — it holds no time value, and the
 * component reads `Date.now()` fresh at render, so a render caused by
 * anything else is never computed against a stale "now".
 */
function useTick(intervalMs = 30_000): void {
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((count) => count + 1), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
}

export function ExpiryChip({ expiresAt }: ExpiryChipProps) {
  useTick()

  const remainingMs = new Date(expiresAt).getTime() - Date.now()

  // Computed from the raw figure, never from `label`'s rounded output: a
  // freshly issued one-hour link has ~3,599,900ms left, which prints as
  // "60 min", and a check on the printed number would call it not urgent for
  // the first ~45 seconds of exactly the link that must always read amber.
  const urgent = remainingMs <= HOUR

  return (
    <span className={styles['chip']} data-urgent={urgent}>
      EXPIRES IN {label(remainingMs)}
    </span>
  )
}
