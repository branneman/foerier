/**
 * **What a control says about paper** (`docs/design/README.md` §5n K7).
 *
 * A print stylesheet may subtract and reflow, never add — and paper has no
 * acts, so every control is dropped: the nav by name in `layout.css`, and the
 * rest by these marks.
 *
 * **Marked rather than matched**, because in this app a `button` and an `a`
 * both routinely wrap the content itself — a packing row's body, a gear row,
 * a trip card, a task line — so a blanket `button, a { display: none }` would
 * print a Depot with no gear in it. A spread rather than a bare string so the
 * two are named once and a call site cannot mistype the value.
 */
export const PRINT_HIDDEN = { 'data-print': 'hide' } as const

/**
 * For a control that is **also the only statement of a fact** — F4's status
 * pill, F5's outcome pill, a per-person cluster. Hiding it would take the
 * fact with it, so it prints in §3.8's sealed treatment instead: the border
 * dropped, reading as text, which is what a closed Trip already draws on
 * screen (§5i G6).
 */
export const PRINT_SEALED = { 'data-print': 'seal' } as const
