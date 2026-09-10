import {
  ErrorBoundary,
  IconDepot,
  IconFind,
  IconTrips,
  Logo,
  Mark,
  PersonCircle,
} from '@foerier/ui'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation, useRoute } from 'wouter'

import { BUILD_SHA } from '../build'
import styles from './AppShell.module.css'
import { DESKTOP, SPLIT, useMediaQuery } from './useMediaQuery'

/**
 * The three-destination shell, in its three nav treatments
 * ([frontend-design §3.1](../../../docs/frontend-design.md), and the
 * **SIDEBAR ANATOMY** card on `Screens A` §02 as settled in R3).
 *
 * | Mode | Brand | Nav | Sync |
 * | --- | --- | --- | --- |
 * | below Split | mark, in the header | bottom tabs, three labels | header line |
 * | Split 52–64em | mark, atop the rail | 56px icon rail | dot only, in the rail |
 * | Desktop ≥64em | mark + wordmark | 216px sidebar, counts | line, in the sidebar |
 *
 * ## Why the mark is the shell's and not a screen's
 *
 * Every phone and Roomy frame opens with one band — mark left, chrome
 * right — and the mark is chrome: it says which app this is, which is a fact
 * about the shell and not about the destination inside it. It shipped as a
 * screen's job instead, and drifted exactly the way §3.2's screen band did
 * before `ScreenBand` existed: `Depot` and `Find` each drew their own, `Trips`
 * drew none, and only `Find` had a test. It also drifted in two ways a
 * per-screen copy invites — both drew `Logo` where the frames draw the bare
 * `Mark`, and both gated on `!isDesktop`, which is true at Split, where the
 * rail already carries one. Measured in a browser at 393px, the title landed
 * at 100px on Depot and 54px on Trips.
 *
 * So the condition is `mode === 'tabs'` and not `!isDesktop`: the mark is
 * drawn once per mode, by whichever of the three treatments owns the brand
 * slot, and a destination screen has nothing left to remember.
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
function AccountAvatar({
  initial,
  current,
}: {
  initial: string | null
  current: boolean
}) {
  return (
    <span aria-hidden="true">
      {/* `ui/PersonCircle` at its 22, the chrome-cluster size this band has
          always drawn. The accent-when-current paint used to be a
          `[aria-current='page'] .avatar` descendant rule reaching in from
          the link above; the caller states it as a tone instead, which is
          the primitive's own rule — a `ui/` prop names the paint and the
          caller owns what it means. */}
      <PersonCircle
        {...(initial === null ? {} : { label: initial })}
        size={22}
        tone={current ? 'accent' : 'control'}
      />
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
        <AccountAvatar initial={initial} current={isActive} />
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
          <AccountAvatar initial={initial} current={isActive} />
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
      <AccountAvatar initial={initial} current={isActive} />
    </Link>
  )
}

/**
 * The shell's own sync marker, in its three nav treatments and — since §5n
 * K24 — its three **states**.
 *
 * `attention` is the third, and it is the only one that is also a **route**:
 * offline has nothing to read, a refusal has a list of what was lost. So the
 * whole line becomes a button exactly then, and stays inert text otherwise
 * rather than being a permanently-clickable control that usually opens
 * nothing.
 *
 * The ▲ takes the dot's own slot rather than sitting beside it, which is what
 * keeps K10's foot — one 22px marker column, one text edge at 40 — aligned
 * across all three states.
 */
function SyncMarker({
  line,
  tone,
  mode,
  onOpenRefusals,
}: {
  line: string
  tone: 'reachable' | 'unreachable' | 'attention'
  mode: NavMode
  onOpenRefusals?: (() => void) | undefined
}) {
  const marker =
    tone === 'attention' ? (
      <span
        className={styles['syncMark']}
        data-testid="sync-dot"
        {...(mode === 'rail'
          ? { role: 'img' as const, 'aria-label': line }
          : { 'aria-hidden': true })}
      >
        ▲
      </span>
    ) : (
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

  // The ▲ is drawn in the line's own text at rail width too: the rail has no
  // room for words, and the mark alone plus its `aria-label` is what the dot
  // already does there.
  const body =
    mode === 'rail' ? (
      <span className={styles['railSync']}>{marker}</span>
    ) : (
      <span className={styles['syncLine']}>
        {marker}
        {line}
      </span>
    )

  if (tone !== 'attention' || onOpenRefusals === undefined) return body

  return (
    <button
      type="button"
      className={styles['syncRoute']}
      onClick={onOpenRefusals}
      aria-label={`${line} — what was not saved`}
    >
      {body}
    </button>
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
  syncTone?: 'reachable' | 'unreachable' | 'attention'
  /**
   * Opens the refusal sheet. Handed in rather than held here because the
   * sheet reads the store and this shell reads none — the same seam
   * `syncLine` already crosses.
   */
  onOpenRefusals?: (() => void) | undefined
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
   * `HouseholdProvider`, deliberately, so this is handed in rather than read
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
  onOpenRefusals,
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
  // **Keyed on the path**, which it could not be until panes scrolled
  // themselves. This used to key on a *scroll group*, because at Split
  // `DepotView` drew the Depot list and the gear detail as two panes of one
  // view over a single offset, and resetting on the route took the list to
  // the top on every row tap. §5n K21 moved the scrollport into each pane
  // (`usePaneScroll`), so a pane view no longer scrolls this box at all and
  // the workaround has nothing left to work around — the group and the path
  // are the same thing again.
  //
  // Layout, not passive: an effect lets the browser paint once at the carried
  // offset — clamped by the new screen's height — before the reset lands.
  useLayoutEffect(() => {
    const main = mainRef.current
    if (main !== null) main.scrollTop = 0
  }, [location])

  return (
    <div className="shell">
      {/* Below Split the sync line is the header. From Split up it moves into
          the nav, where the board puts it — "never in the main column at
          desktop" (SIDEBAR ANATOMY). */}
      {mode === 'tabs' && (
        <header className={styles['header']}>
          {/* `Mark`, not `Logo`: every phone and Roomy frame opens with the
              bare 28×22 duffel and no wordmark — the wordmark belongs to the
              216px sidebar, which is the one place a board draws it beside
              the mark. */}
          <Mark size={28} title="foerier" />
          <span className={styles['headerChrome']}>
            <SyncMarker
              line={syncLine}
              tone={syncTone}
              mode={mode}
              onOpenRefusals={onOpenRefusals}
            />
            <AccountLink mode={mode} initial={accountInitial} />
          </span>
        </header>
      )}

      {/*
       * The screen boundary — the middle of the three
       * (`frontend-design.md` §5), inside the scroller so a crashed screen
       * keeps the nav, the header and the sync line it was reached by. That
       * is the whole difference from the root boundary above it: a reader
       * who can still see the tab bar has somewhere to go.
       *
       * **Keyed on the location, so a boundary is never a trap.** Nothing
       * clears a boundary's own state but its retry, and a screen that
       * crashes deterministically would otherwise hold this box for the
       * rest of the session — every later navigation rendering the fallback
       * for a screen the reader has left. The key is not the scroll group:
       * a crash is not a scroll offset, and the Depot list and a gear
       * detail are two screens even where they share one scroller.
       */}
      <main className="shell__main" ref={mainRef}>
        <ErrorBoundary key={location} buildSha={BUILD_SHA} label="the screen">
          {children}
        </ErrorBoundary>
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
            <SyncMarker
              line={syncLine}
              tone={syncTone}
              mode={mode}
              onOpenRefusals={onOpenRefusals}
            />
          </span>
        )}
      </nav>
    </div>
  )
}
