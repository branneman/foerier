import { IconDepot, IconFind, IconTrips, Logo, Mark } from '@foerier/ui'
import type { ReactNode } from 'react'
import { Link, useRoute } from 'wouter'

import styles from './AppShell.module.css'
import { DESKTOP, SPLIT, useMediaQuery } from './useMediaQuery'

/**
 * The three-destination shell, in its three nav treatments
 * ([frontend-design §3.1](../../../docs/frontend-design.md), and the
 * **SIDEBAR ANATOMY** card on `Screens A` §02 as settled in R3).
 *
 * | Mode | Nav | Sync |
 * | --- | --- | --- |
 * | below Split | bottom tabs, three labels | header line |
 * | Split 52–64em | 56px icon rail, mark on top | dot only, in the rail |
 * | Desktop ≥64em | 216px sidebar, logo + wordmark, counts | line, in the sidebar |
 *
 * ## Why the mode is a media query and not CSS
 *
 * The treatments differ in **which elements exist**, not just how they are
 * laid out: icons versus labels, a count versus none, a dot versus a dot and
 * a timestamp. Rendering all of it and hiding the surplus with `display:
 * none` would leave a count in the accessibility tree at phone width, on a
 * board that draws none there. That is exactly the line
 * [§3.2](../../../docs/frontend-design.md) now draws — a media query decides
 * which elements *exist*, a container query decides how what exists *lays
 * out*.
 *
 * ## The account affordance is deliberately absent
 *
 * R3 settles an `ACCOUNT` row pinned to the sidebar's bottom, a matching
 * avatar on the Split rail, and an avatar in the phone header. None is built,
 * and all three are blocked on one thing: **there is no Account screen** —
 * it is auth slice 4's (story 30), and `docs/design/README.md` §11 specifies
 * a whole screen for it. An affordance that leads nowhere is worse than a
 * missing one, so the anatomy lands now and its entry points land with the
 * screen they open. The sidebar's `margin-top: auto` group is already where
 * that row goes.
 */

/**
 * Account is deliberately not a fourth destination — it is reached from the
 * avatar, so the tab bar stays at three (`docs/design/README.md` §11).
 */
export const DESTINATIONS = [
  { href: '/', label: 'Depot', Icon: IconDepot },
  { href: '/trips', label: 'Trips', Icon: IconTrips },
  { href: '/find', label: 'Find', Icon: IconFind },
] as const

type NavMode = 'tabs' | 'rail' | 'sidebar'

function NavItem({
  href,
  label,
  Icon,
  mode,
  count,
}: {
  href: string
  label: string
  Icon: typeof IconDepot
  mode: NavMode
  count: number | undefined
}) {
  const [isActive] = useRoute(href)

  return (
    <Link
      href={href}
      className={`${styles['navItem']} ${styles[mode]}`}
      // The rail draws no label, so the link would otherwise have no
      // accessible name at all — a link nobody can follow.
      {...(mode === 'rail' ? { 'aria-label': label } : {})}
      {...(isActive ? { 'aria-current': 'page' as const } : {})}
    >
      {mode === 'rail' ? (
        <span className={styles['railSquare']}>
          <Icon />
        </span>
      ) : (
        <>
          <span>{label}</span>
          {/* Desktop only, and only where a count exists: `FIND` never has
              one, and `TRIPS` has none until trips do. */}
          {mode === 'sidebar' && count !== undefined && (
            <span className={styles['count']}>{count}</span>
          )}
        </>
      )}
    </Link>
  )
}

function SyncMarker({
  line,
  tone,
  mode,
}: {
  line: string
  tone: 'reachable' | 'unreachable'
  mode: NavMode
}) {
  const dot = (
    <span
      className={`${styles['syncDot']} ${
        tone === 'unreachable' ? styles['syncDotUnreachable'] : ''
      }`}
      data-testid="sync-dot"
      // In the rail the dot stands alone, so it is the thing that has to
      // carry the state; everywhere else the text beside it does, and a
      // second copy would only say it twice.
      {...(mode === 'rail'
        ? { role: 'img' as const, 'aria-label': line }
        : { 'aria-hidden': true })}
    />
  )

  if (mode === 'rail') return <span className={styles['railSync']}>{dot}</span>

  return (
    <span className={styles['syncLine']}>
      {dot}
      {line}
    </span>
  )
}

export interface AppShellProps {
  children: ReactNode
  /**
   * Sync state is one quiet header line, never a blocking dialog
   * (`docs/design/README.md`, Interactions). Offline is normal.
   */
  syncLine?: string
  /** Sage while the household is reachable, amber while it is not. The dot
   * is the only colour this line carries. */
  syncTone?: 'reachable' | 'unreachable'
  /**
   * What each destination counts, keyed by href — drawn in the sidebar only.
   * A destination with no entry simply has no count, which is how `FIND`
   * reads today and `TRIPS` reads until S6.
   */
  counts?: Readonly<Partial<Record<string, number>>>
}

export function AppShell({
  children,
  syncLine = 'OFFLINE',
  syncTone = 'unreachable',
  counts = {},
}: AppShellProps) {
  const isSplit = useMediaQuery(SPLIT)
  const isDesktop = useMediaQuery(DESKTOP)
  const mode: NavMode = isDesktop ? 'sidebar' : isSplit ? 'rail' : 'tabs'

  return (
    <div className="shell">
      {/* Below Split the sync line is the header. From Split up it moves into
          the nav, where the board puts it — "never in the main column at
          desktop" (SIDEBAR ANATOMY). */}
      {mode === 'tabs' && (
        <header className={styles['header']}>
          <SyncMarker line={syncLine} tone={syncTone} mode={mode} />
        </header>
      )}

      <main className="shell__main">{children}</main>

      <nav
        className={`${styles['nav']} ${styles[`nav-${mode}`]} shell__nav`}
        aria-label="Sections"
      >
        {mode === 'rail' && (
          <span className={styles['brand']}>
            <Mark size={26} />
          </span>
        )}
        {mode === 'sidebar' && (
          <span className={styles['brand']}>
            <Logo size={26} title="foerier" />
          </span>
        )}

        {DESTINATIONS.map((destination) => (
          <NavItem
            key={destination.href}
            href={destination.href}
            label={destination.label}
            Icon={destination.Icon}
            mode={mode}
            count={counts[destination.href]}
          />
        ))}

        {/* `margin-top: auto` pins this group to the bottom — and is where
            the ACCOUNT row goes when the Account screen exists. */}
        {mode !== 'tabs' && (
          <span className={styles['navFoot']}>
            <SyncMarker line={syncLine} tone={syncTone} mode={mode} />
          </span>
        )}
      </nav>
    </div>
  )
}
