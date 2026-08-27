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
