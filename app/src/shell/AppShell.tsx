import type { ReactNode } from 'react'
import { Link, useRoute } from 'wouter'

import styles from './AppShell.module.css'

/**
 * The three-tab shell: Depot · Trips · Find.
 *
 * Account is deliberately not a fourth tab — it is reached from the avatar, so
 * the tab bar stays at three (`docs/design/README.md` §11).
 */
export const DESTINATIONS = [
  { href: '/', label: 'Depot' },
  { href: '/trips', label: 'Trips' },
  { href: '/find', label: 'Find' },
] as const

function NavItem({ href, label }: { href: string; label: string }) {
  const [isActive] = useRoute(href)

  return (
    <Link
      href={href}
      className={styles['navItem']}
      {...(isActive ? { 'aria-current': 'page' as const } : {})}
    >
      {label}
    </Link>
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
}

export function AppShell({
  children,
  syncLine = 'OFFLINE',
  syncTone = 'unreachable',
}: AppShellProps) {
  return (
    <div className="shell">
      <header className={styles['syncLine']}>
        <span
          className={`${styles['syncDot']} ${
            syncTone === 'unreachable' ? styles['syncDotUnreachable'] : ''
          }`}
          aria-hidden="true"
        />
        {syncLine}
      </header>

      <main className="shell__main">{children}</main>

      <nav className={`${styles['nav']} shell__nav`} aria-label="Sections">
        {DESTINATIONS.map((destination) => (
          <NavItem key={destination.href} {...destination} />
        ))}
      </nav>
    </div>
  )
}
