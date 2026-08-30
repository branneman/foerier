import { useSyncExternalStore } from 'react'

/**
 * One shell breakpoint, as a boolean.
 *
 * [Frontend-design §3.1](../../../docs/frontend-design.md) gives **shell**
 * questions to media queries — where nav lives, whether panes split, how
 * dense the page is — and §3.2 gives **component** questions to container
 * queries. This is the shell half, for the decisions a component cannot make
 * in CSS because they change *what is rendered* rather than how it is laid
 * out: the Depot's table has a `KIND` cell and a `TAGS` cell that no folding
 * row has, so choosing it in CSS would mean rendering both and hiding one,
 * putting every fact in the accessibility tree twice.
 *
 * `GearRow`'s own 2-line ↔ 1-line fold stays a container query, which is why
 * it folds inside Split's 308px list pane at a viewport of 900.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: the first paint
 * then reads the real width instead of rendering the phone layout and
 * correcting itself.
 *
 * **Fails open to `false`** where `matchMedia` does not exist — jsdom without
 * a stub, an old engine — so the answer is always the single-column layout
 * every mode falls back to.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window?.matchMedia !== 'function') {
        return () => {}
      }
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => {
      if (typeof window?.matchMedia !== 'function') {
        return false
      }
      return window.matchMedia(query).matches
    },
    // Server-rendered HTML has no viewport to measure. foerier does not
    // server-render, but the third argument is not optional and guessing
    // "wide" would be the worse guess.
    () => false,
  )
}

/** Desktop: the labeled sidebar, the 8-column table, column-head sorting. */
export const DESKTOP = '(min-width: 64em)'

/** Split and up: the two-pane list + detail unlock. */
export const SPLIT = '(min-width: 52em)'

/**
 * Where a screen is standing when it asks {@link useScreenHeader} — the one
 * fact the answer turns on that a breakpoint cannot supply.
 */
export interface ScreenPlacement {
  /**
   * Is this screen the **detail pane of a two-pane view at Split** — the list
   * it was pushed from drawn beside it at 52–64em?
   *
   * True for `GearDetail`, which `DepotView` renders in the right-hand pane
   * with the Depot list in the left — and true for nothing else. `DepotView`
   * is no longer the only two-pane view `App.tsx` has: `GearListBuilder`
   * (`/trips/:id/list`, S7) is a second, and it still answers `false` — it is
   * two panes of *itself*, not a detail pane of a list that is also on
   * screen, so its own back link is drawn at every width it exists at rather
   * than withheld the way `GearDetail`'s is (spec
   * `docs/specs/2026-08-29-the-gear-list.md` §4.11). Every other pushed
   * screen answers `false` too, `AddGear` included: `Screens A` §06 draws
   * `Add gear — split 900` as a pane with the Depot list beside it, and
   * `<Route path="/add">` renders it standalone, so the answer is about the
   * app as built rather than as drawn.
   *
   * Named for the placement rather than for the screen because that is what
   * the answer reads: a screen with its own list beside it needs no link back
   * to that list.
   */
  splitPane: boolean

  /**
   * At Desktop, does the 216px sidebar already carry the destination this
   * screen's own back link would point at? Defaults to `true`, because every
   * caller before S7 has exactly one back link and it always names a sidebar
   * row (`‹ DEPOT`, `‹ TRIPS`, `‹ ACCOUNT`, both of `InviteIssued`'s) — for
   * all of them `splitPane` alone was a sound proxy for "is the destination
   * already on the page", since the two questions happened to have the same
   * answer at every existing call site.
   *
   * `GearListBuilder` is the first screen where the two questions come
   * apart: it has two doors (spec §4.11), and only one of them
   * (`?from=trips`, `‹ TRIPS`) names the sidebar's own `TRIPS` row — the
   * other (the "trip" door, `‹ <name>`) names one specific Trip, which no
   * sidebar row ever carries. Passing `false` for that door keeps the back
   * link at Desktop rather than stranding the reader on browser Back, with
   * no route from the builder to the Trip they opened it from — S7 review
   * F4.
   */
  atDesktopSidebarCarriesDestination?: boolean
}

/** What {@link useScreenHeader} answers: the band, and the two things in it. */
export interface ScreenHeader {
  /**
   * Draw the `<header>` band at all? True exactly when it would hold
   * something — the two halves below are withheld at different widths, and at
   * Split a `splitPane` screen draws the sync line with no back link beside
   * it.
   */
  band: boolean
  /** Draw `‹ DEPOT` / `‹ TRIPS`? */
  backLink: boolean
  /** Draw the sync line in the main column? */
  syncLine: boolean
}

/**
 * Whether a pushed screen draws its own back link and its own sync line.
 * **Every screen that draws either half asks** — `AddGear`, `GearDetail`,
 * `Trip`, `NewTrip`, `Account`, `People`, `Devices`, `InviteIssued`,
 * `DepotPicker` and `GearListBuilder`, all ten of them — because a rule
 * spelled ten times is nine chances to spell it differently, and that is
 * exactly how `Account` came to carry `Trip`'s defect from a different
 * slice. Nine draw a sync line; `InviteIssued` draws only the back link,
 * and gates its band on {@link ScreenHeader.backLink} rather than on
 * {@link ScreenHeader.band}, since for a screen with no sync line the link
 * is the only thing the band could hold. (`DepotPicker`'s own `'pane'`
 * variant asks too but draws neither half itself — its band belongs to
 * `GearListBuilder`, which draws it for both panes together — so it is
 * counted here as a caller, not as a second `InviteIssued`-shaped
 * exception.)
 *
 * ## The sync line: at Split, and only at Split
 *
 * {@link AppShell} draws a **legible** marker in two of its three modes and
 * not in the third:
 *
 * | Mode | `AppShell`'s marker | So the screen draws |
 * | --- | --- | --- |
 * | below Split (`tabs`) | the header band's `● SYNCED`, in words | nothing |
 * | Split (`rail`) | a bare 6px dot; the words are an `aria-label` | **its own line** |
 * | Desktop (`sidebar`) | the sidebar's line, in words | nothing |
 *
 * So a screen draws its own sync line at Split alone. Both board frames that
 * draw a pushed screen at 900 agree: on `Screens A` §05 `Depot split` the
 * detail pane's own band carries `● SYNCED` while the rail beside it ends in a
 * bare dot, and §06's `Add gear — split 900` is the same pane, the same dot.
 *
 * ## The back link: unless its destination is already on the page
 *
 * `‹ DEPOT` points at the Depot. A screen owes the reader that link only where
 * the Depot is not already in front of them.
 *
 * - **At Desktop, never — unless {@link ScreenPlacement.atDesktopSidebarCarriesDestination}
 *   says the sidebar does not carry it.** The 216px sidebar is labeled
 *   navigation and the row the link points at is usually *in* it — which is
 *   what `Screens B` §02A's `Trip screen — S6 desktop` draws: the sidebar
 *   carries `TRIPS` and `SYNCED 14:32`, and the main column carries neither.
 *   `GearListBuilder`'s "trip" door is the one caller for which that is
 *   false, and it says so explicitly rather than being derived wrong from
 *   `splitPane` alone (S7 review F4).
 * - **At Split, it depends on {@link ScreenPlacement.splitPane}.** The rail
 *   draws no labels, so a screen standing alone there still owes the link —
 *   and every caller but `GearDetail` does stand alone, `GearListBuilder`
 *   included: it is two panes of *itself*, not a detail pane of a list also
 *   on screen, so it owes its own reader the link exactly as a standalone
 *   screen would. A detail pane does not: the list is beside it, which is why
 *   `Depot split` contains no `‹` anywhere.
 * - **Below Split, always.** There are no panes and the nav is three tabs.
 */
export function useScreenHeader({
  splitPane,
  atDesktopSidebarCarriesDestination = true,
}: ScreenPlacement): ScreenHeader {
  const isSplit = useMediaQuery(SPLIT)
  const isDesktop = useMediaQuery(DESKTOP)

  // Desktop is inside Split, so `!isSplit` already withholds the pane's link
  // at Desktop too — the sidebar's reason and the pane's reason happen to
  // agree there.
  //
  // The `splitPane: false` branch used to be `!isDesktop` alone, which reads
  // "never at Desktop" — sound for every caller through S3.5, wrong for
  // `GearListBuilder`'s "trip" door (S7 review F4): `!atDesktopSidebarCarries-
  // Destination` is `false` for every existing caller (the default), so this
  // is unchanged for all of them, and `true` only for the one door whose
  // destination the sidebar cannot name.
  const backLink = splitPane
    ? !isSplit
    : !isDesktop || !atDesktopSidebarCarriesDestination
  const syncLine = isSplit && !isDesktop

  return { band: backLink || syncLine, backLink, syncLine }
}
