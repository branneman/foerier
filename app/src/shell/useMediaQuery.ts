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

/** What {@link useScreenHeader} answers: two questions, two breakpoints. */
export interface ScreenHeader {
  /** Draw `‹ DEPOT` / `‹ TRIPS`? Withheld from Desktop. */
  backLink: boolean
  /** Draw the sync line in the main column? Withheld from Split up. */
  syncLine: boolean
}

/**
 * Whether `Trip`, `NewTrip`, `GearDetail` or `Account` draws its own back link
 * and its own sync line. **The two are withheld at two different widths**, and
 * the one place that says so is here — four screens ask, and a rule spelled
 * four times is three chances to spell it differently.
 *
 * Four, not every pushed screen: `AddGear`, `People` and `Devices` still spell
 * their own band and get it wrong. That debt is stated in
 * [frontend-design §3.3](../../../docs/frontend-design.md), which names what
 * each of them prints; converting them is a code change and deliberately not
 * this round's.
 *
 * - **The back link goes at Desktop.** From 64em the 216px sidebar is labeled
 *   navigation and the row a `‹ TRIPS` points at is *in* it. At Split the nav
 *   is a 56px icon rail with no labels, so a screen there still owes the
 *   reader the name of where they came from.
 * - **The sync line goes from Split up.** {@link AppShell} draws the header
 *   band on `mode === 'tabs'` alone; from 52em the marker moves into the nav,
 *   which is where the boards put it — *"never in the main column at
 *   desktop"*. A screen that kept drawing it would state `SYNCED` twice from
 *   52em — beside its title and again in the nav, where at Split the bare rail
 *   dot carries it as an `aria-label` and the Desktop sidebar draws it.
 *
 * The `<header>` element itself exists exactly when the back link does, and
 * needs no third answer: below Split is inside below Desktop, so a withheld
 * back link is never accompanied by a surviving sync line.
 */
export function useScreenHeader(): ScreenHeader {
  const isSplit = useMediaQuery(SPLIT)
  const isDesktop = useMediaQuery(DESKTOP)
  return { backLink: !isDesktop, syncLine: !isSplit }
}
