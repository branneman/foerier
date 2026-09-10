import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * **A pane is its own scrollport, and it resets on its own route**
 * (`docs/design/README.md` §5n K21).
 *
 * The shell's main area is one scroll container, which is right for a screen
 * and wrong for a view made of panes: `DepotView` renders the Depot list and
 * the gear detail as two panes that never unmount, so `/` and `/gear/:id`
 * were two routes over **one** offset. `AppShell` worked around that by
 * resetting on a *scroll group* rather than on the path — otherwise every row
 * tap took the list back to the top — which approximates the right answer by
 * refusing to reset at all.
 *
 * The right answer is per pane. Each pane scrolls itself (the CSS half, in
 * each view's own stylesheet), and each resets when **its own** route changes
 * while the other does not:
 *
 * - Tapping a Depot row takes the **detail** pane to the top and leaves the
 *   list exactly where the thumb left it.
 * - The list pane's offset therefore persists across every detail navigation
 *   within the view, being the same list throughout.
 * - The other pane's route change costs the reader nothing.
 *
 * **`key` is what the pane's own route is**, and the caller decides: the
 * detail pane passes the gear id, the list pane passes something that does
 * not change while the view is mounted. A pane that passes the whole location
 * has opted back into the behaviour this exists to end.
 *
 * **One half of that is not delivered yet, and it is not this hook's to
 * deliver.** `AppShell` keys the screen's `ErrorBoundary` on the location, so
 * every navigation remounts the view and a remounted pane starts at the top —
 * the list pane's offset therefore does *not* survive opening a row, however
 * constant its key. Moving that boundary into the panes is what finishes it,
 * and is recorded in `technical-debt.md` rather than done here: where a crash
 * is contained is a decision `AppShell` argues out loud.
 *
 * Story 38 (*come back to where I was*, Later) inherits a shape that can hold
 * a per-pane place honestly, which the single shared scroller could not.
 */
export function usePaneScroll<T extends HTMLElement>(
  key: string,
): RefObject<T | null> {
  const ref = useRef<T>(null)

  // Layout, not passive, for `AppShell`'s own reason: an effect lets the
  // browser paint once at the carried offset — clamped by the new content's
  // height — before the reset lands.
  useLayoutEffect(() => {
    const pane = ref.current
    if (pane !== null) pane.scrollTop = 0
  }, [key])

  return ref
}
