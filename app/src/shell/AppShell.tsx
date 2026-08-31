import { IconDepot, IconFind, IconTrips, Logo, Mark } from '@foerier/ui'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation, useRoute } from 'wouter'

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
 * ## The account affordance
 *
 * R3 settles an `ACCOUNT` row pinned to the sidebar's bottom, a matching
 * avatar on the Split rail, and an avatar in the phone header. All three were
 * left unbuilt until the Account screen existed to open — an affordance that
 * leads nowhere is worse than a missing one — and now that it does (auth
 * slice 4, story 30; `docs/design/README.md` §11), all three land here. The
 * sidebar's `margin-top: auto` group is where the row goes, same as always.
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
          {/* Desktop only, and only where a count exists. A count is the
              size of the list the destination opens, so `FIND` is the one row
              that never has one — it answers a question rather than holding a
              collection.

              `aria-hidden`, deliberately: a destination is called Depot
              whether it holds nothing or two hundred things, and folding the
              count in made the link's accessible name change as gear was
              recorded — "Depot 0", then "Depot 1". Announced, that is as
              easily a room number as a tally. The count is a glance
              affordance; the Depot screen's own `128 GEAR` headline is where
              the fact is actually stated, and stated unambiguously. */}
          {mode === 'sidebar' && count !== undefined && (
            <span className={styles['count']} aria-hidden="true">
              {count}
            </span>
          )}
        </>
      )}
    </Link>
  )
}

/**
 * The `ACCOUNT` row's avatar, in all three modes.
 *
 * `initial` is `aria-hidden` — the same rule the sidebar's count already
 * follows (`NavItem` above): a name that changes as the Person folds in
 * reads as data, and "Account M" announced is as easily an initial as it is
 * a stray letter. The circle carries no accessible content of its own; the
 * link around it supplies the name.
 *
 * `null` draws an empty circle rather than a placeholder letter. A Login can
 * point at a `person_id` no op has ever created yet — a half-finished
 * bootstrap, or a Person op still queued on someone else's phone
 * (`auth-design.md` §2.1) — and there is then no initial to draw. Inventing
 * one would be a fact the app does not have.
 */
function AccountAvatar({ initial }: { initial: string | null }) {
  return (
    <span className={styles['avatar']}>
      {initial !== null && <span aria-hidden="true">{initial}</span>}
    </span>
  )
}

/**
 * The door: a labelled row in the sidebar, an avatar above the sync dot on
 * the rail, an avatar beside the sync line in the phone header. The rail and
 * the header draw no label, so without `aria-label` the link would have no
 * accessible name at all — a link nobody can follow, same reasoning as
 * `NavItem`'s rail branch above.
 */
function AccountLink({
  mode,
  initial,
}: {
  mode: NavMode
  initial: string | null
}) {
  const [isActive] = useRoute('/account')
  const current = isActive ? { 'aria-current': 'page' as const } : {}

  if (mode === 'sidebar') {
    return (
      <Link
        href="/account"
        className={`${styles['navItem']} ${styles['sidebar']} ${styles['accountRow']}`}
        {...current}
      >
        <AccountAvatar initial={initial} />
        <span>Account</span>
      </Link>
    )
  }

  if (mode === 'rail') {
    return (
      <Link
        href="/account"
        className={`${styles['navItem']} ${styles['rail']}`}
        aria-label="Account"
        {...current}
      >
        <span className={styles['railSquare']}>
          <AccountAvatar initial={initial} />
        </span>
      </Link>
    )
  }

  return (
    <Link
      href="/account"
      className={styles['headerAccount']}
      aria-label="Account"
      {...current}
    >
      <AccountAvatar initial={initial} />
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
   * A count is the **size of the list the destination opens**, which is why
   * `FIND` is the one row that carries none: it answers a question rather
   * than holding a collection. A destination with no entry simply draws no
   * count.
   */
  counts?: Readonly<Partial<Record<string, number>>>
  /**
   * The letter the avatar draws, or `null` for an empty circle
   * (`docs/design/README.md` §11). `AppShell` renders outside
   * `DepotProvider`, deliberately, so this is handed in rather than read
   * here — see `useAccountInitial` in `App.tsx`.
   */
  accountInitial?: string | null
}

export function AppShell({
  children,
  syncLine = 'OFFLINE',
  syncTone = 'unreachable',
  counts = {},
  accountInitial = null,
}: AppShellProps) {
  const isSplit = useMediaQuery(SPLIT)
  const isDesktop = useMediaQuery(DESKTOP)
  const mode: NavMode = isDesktop ? 'sidebar' : isSplit ? 'rail' : 'tabs'

  const [location] = useLocation()
  const mainRef = useRef<HTMLElement>(null)

  // The main area is the shell's scroll container (`ui/styles/layout.css`),
  // and it outlives the route: nothing unmounts it, so its offset is carried
  // into whatever the next route renders, and a reader part-way down a
  // two-hundred-item Depot who opened a gear would land part-way down the
  // gear's screen.
  //
  // **This is a new behaviour, not a restoration of the document scroller's.**
  // `history.pushState` does not reset scroll — measured, an offset of 1200
  // survives both the call and a full re-render — so the old scroller kept its
  // offset too and was merely *clamped* by a shorter next screen. Most screens
  // were shorter, which is why it read as a reset. Chosen because landing at
  // the top of a screen you have just opened is the behaviour the app wants,
  // not because anything is being preserved.
  //
  // Never a restore: restoring is per history entry rather than per path, and
  // nothing here holds history entries. One place says it, rather than each
  // screen, for `useScreenHeader`'s reason (`frontend-design.md` §3.3) — a
  // rule spelled per screen is one chance per screen to spell it differently.
  //
  // **Keyed on a scroll group, not on the path**, because the two are not the
  // same thing at Split: `DepotView` renders the Depot list and the gear
  // detail as two panes of one view that never unmounts, so `/` and
  // `/gear/:id` are two routes over a single scroll offset and resetting on
  // the route would take the list to the top on every row tap. Below Split
  // and at Desktop that view renders one screen or the other, so there the
  // path is the group. (Panes with scrollers of their own would be the more
  // design-true answer and would move this reset's target with them; that is
  // left to the task that builds them.)
  const scrollGroup =
    isSplit && !isDesktop && (location === '/' || location.startsWith('/gear/'))
      ? 'depot-split'
      : location

  // Layout, not passive: an effect lets the browser paint once at the carried
  // offset — clamped by the new screen's height — before the reset lands.
  useLayoutEffect(() => {
    const main = mainRef.current
    if (main !== null) main.scrollTop = 0
  }, [scrollGroup])

  return (
    <div className="shell">
      {/* Below Split the sync line is the header. From Split up it moves into
          the nav, where the board puts it — "never in the main column at
          desktop" (SIDEBAR ANATOMY). */}
      {mode === 'tabs' && (
        <header className={styles['header']}>
          <SyncMarker line={syncLine} tone={syncTone} mode={mode} />
          <AccountLink mode={mode} initial={accountInitial} />
        </header>
      )}

      <main className="shell__main" ref={mainRef}>
        {children}
      </main>

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

        {/* `margin-top: auto` pins this group to the bottom — ACCOUNT above
            the sync marker, as the sidebar anatomy and the Split rail both
            settle it. */}
        {mode !== 'tabs' && (
          <span className={styles['navFoot']}>
            <AccountLink mode={mode} initial={accountInitial} />
            <SyncMarker line={syncLine} tone={syncTone} mode={mode} />
          </span>
        )}
      </nav>
    </div>
  )
}
