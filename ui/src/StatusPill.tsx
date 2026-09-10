import styles from './StatusPill.module.css'
import type { Ref } from 'react'

/**
 * The status pill — `frontend-design.md` §5's primitive of that name, built
 * at the point it had two callers (`patterns.md` §5.5's bar).
 *
 * The two are not the same control and the component does not pretend they
 * are. F4's in-row pill **states** a status and cycles on tap; the Piece
 * status sheet's `SET EVERYONE` chips **write** one. What they share is a
 * grammar, and it is the grammar this owns: pill radius, chip stroke, mono
 * caps, glyph then word, and a 44 floor reached by **paint** rather than by
 * ruling O's `::after` — which the in-row size must not have anyway, since
 * it sits at the edge of a row body whose own hit area it would overlap.
 *
 * ## The tone names the paint; the caller owns the status
 *
 * `PersonCircle`'s rule (`patterns.md` §5.3), and the reason the packing
 * vocabulary stays in `app/`: a caller maps its own status to a tone, so
 * this file never learns that `◐` means staged. The difference from
 * `PersonCircle` is only that these tones consume the design system's own
 * **status palette** — `--color-status-staged` and `--color-status-packed`
 * are semantic tokens named that way in `tokens.css` (`patterns.md` §6.2),
 * so naming the tones after them names paint, not domain.
 *
 * `plain` is the default and is what a control that *writes* wears: three
 * tinted buttons in a sheet would compete with the tinted pills on the rows
 * behind it, which is the reason the sheet's chips were drawn neutral.
 *
 * **`dashed` and `attention` are S10's third and fourth callers of the
 * identical grammar** — F5's outcome pill reuses this component rather than
 * growing a second one. `attention` joins the status palette's own
 * `--color-status-attention`. `dashed` is unfilled and named for what it
 * paints, exactly as `PersonCircle` already names this identical border —
 * this file still does not learn that a caller means *consumed*, *excluded*,
 * or anything else; it only learns that a border can be solid or dashed.
 *
 * **`muted` is `attention` drained** (§5i G12): the same faint ink, solid.
 * Its caller draws the same glyph and the same word and means *this was
 * true and has since been settled* — but that sentence is the caller's, and
 * this file learns only that a pill can stop asking for the eye.
 *
 * `ui/` never imports the store or a router (`frontend-design.md` §5).
 */
export interface StatusPillProps {
  /** `○ ◐ ●` — passed in, because this file knows no status vocabulary. */
  glyph: string
  /** Drawn as written; the stylesheet does not transform it. */
  label: string
  /** Names the paint. `plain` is the neutral a writing control wears. */
  tone?:
    | 'plain'
    | 'not-packed'
    | 'staged'
    | 'packed'
    | 'dashed'
    | 'attention'
    | 'muted'
  /**
   * `row` keeps its intrinsic width at a row's trailing edge; `action` shares
   * its row equally with its siblings. The two callers' one layout
   * difference.
   */
  size?: 'row' | 'action'
  onClick: () => void
  /**
   * **Forwarded to this component's own outermost element**, so a caller can
   * anchor a popover to it (§5n K17). Radix measures its anchor through a
   * ref, and a component that drops one fails silently — Floating UI never
   * runs and the popover paints off-screen with no error anywhere, which is
   * what `Chip` did until a browser was pointed at it.
   */
  ref?: Ref<HTMLElement>
}
export function StatusPill({
  glyph,
  label,
  tone = 'plain',
  size = 'row',
  onClick,
  ref,
}: StatusPillProps) {
  return (
    <button
      type="button"
      ref={ref as Ref<HTMLButtonElement>}
      className={styles['pill']}
      data-tone={tone}
      data-size={size}
      data-testid="status-pill"
      /* Also the only statement of its fact, so paper seals it rather than
         dropping it (§5n K7): the border goes and it reads as text, which is
         what a closed Trip already draws on screen (§5i G6). */
      data-print="seal"
      onClick={onClick}
    >
      {glyph} {label}
    </button>
  )
}
