import type { ReactNode } from 'react'

import styles from './Band.module.css'

/**
 * The section band — a mono caps label on the left, and whatever the section
 * counts or leads to on the right.
 *
 * **Three copies of one anatomy, and the board named it first.** `Screens B`
 * §08 lists *"the band component with its count slot and trailing link"*
 * among what S12/S13's shell commit lands; the shell that landed was
 * `TripPanels` alone, so the band was spelled in `Trip.module.css`
 * (`GEAR LIST`, since S7), in `NotesPanel` and in `TasksPanel` — the last two
 * in parallel worktrees, each borrowing the first and saying so. The
 * extraction had to take all three at once, which is why it waited for a
 * moment when no branch held any of them open.
 *
 * **The anatomy is here; the content is the caller's.** This owns the row
 * (`space-between` on a baseline, the block padding and the hairline under
 * it), the label's paint, and the trailing group's reflow. What a band says —
 * `12 ENTRIES · 48 PIECES`, `3/7 TICKED`, `+ NOTE`, `PACKING ›` — is passed
 * in, along with the classes that paint it, because a count and a route are
 * facts about a section rather than about a band.
 *
 * **Two declarations on the label are load-bearing and easy to lose.**
 * `flex: none` and `white-space: nowrap`: the row is a non-wrapping flex
 * container of exactly two children, so a width deficit shrinks *both* in
 * proportion unless the label refuses. Without them a narrow band wraps
 * `GEAR LIST` into `GEAR` / `LIST` before the trailing slot — which is built
 * to absorb the whole deficit — wraps at all. jsdom computes no layout, so
 * `Band.test.tsx` pins them as stylesheet text.
 *
 * `ui/` never imports the store or a router (`frontend-design.md` §5): a
 * caller's `<Link>` arrives as a node.
 */
export interface BandProps {
  /** Drawn as written, in mono caps — the stylesheet transforms nothing. */
  label: string
  /**
   * Names the label element, for a section that points its
   * `aria-labelledby` at it. The band is a heading in the visual sense only,
   * so the caller decides what it names.
   */
  labelId?: string
  /**
   * The trailing group: a count, a route, or several. Rendered in one flex
   * item so `space-between` keeps them glued to the trailing edge, wrapping
   * as a right-aligned second line when the band runs out of room.
   *
   * A caller with two routes that must wrap *together* groups them itself —
   * `Trip`'s `.gearListRoutes` is the worked example, and that grouping is
   * the caller's because only it knows which of its children belong side by
   * side.
   */
  trailing?: ReactNode
  /** Only where a caller's own suite already reaches for the band by id. */
  testId?: string
}

export function Band({ label, labelId, trailing, testId }: BandProps) {
  return (
    <div
      className={styles['band']}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      <span
        className={styles['label']}
        {...(labelId === undefined ? {} : { id: labelId })}
      >
        {label}
      </span>
      {trailing !== undefined && (
        <span className={styles['trailing']}>{trailing}</span>
      )}
    </div>
  )
}
