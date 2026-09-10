import * as RadixPopover from '@radix-ui/react-popover'
import { useRef, type ReactNode } from 'react'

import { restoreOpenerFocus } from './restoreOpenerFocus'
import styles from './Popover.module.css'

/**
 * The anchored popover — Radix Popover wrapped exactly once
 * (`frontend-design.md` §5), the second of that section's primitives to
 * exist after {@link Sheet}.
 *
 * **What it is for.** Seven surfaces are described by their boards as *sheet
 * below Split, popover from Split up* — the desktop tag picker, the slice
 * bar's `ValueMenu`, the Piece picker, the Piece status sheet, the outcome
 * sheet and its roster variant, and the template source picker. All seven
 * approximated it with a centred `Sheet` until this landed. **Below Split
 * each is still the sheet it always was**: a media query decides which of the
 * two *exists* (§3.2), and the caller writes that fork.
 *
 * ## There is no trigger, and that is the whole design (§5n K17)
 *
 * Radix wants `Popover.Trigger` and `Popover.Content` as siblings under one
 * root, and it clones its trigger to attach `aria-expanded`, `aria-controls`,
 * a ref and an `onClick`. Two things in this app make that unusable:
 *
 * - **Mounted is open** (`patterns.md` §4.1). Every overlay here is written
 *   `{open && <Overlay …/>}`, because mount is what resets a picker's drafts
 *   — `HomePicker` used to keep EDIT mode and four drafts across a close. A
 *   Radix trigger drives `open` itself and would take that back.
 * - **The trigger is already a real control** with its own accessible name,
 *   its own props and — often — a `::after` hit extension clamped to its
 *   row (ruling O). Handing it to `Slot` to be cloned is exactly the kind of
 *   quiet rewriting §5b's floor audit spent a slice undoing.
 *
 * So **`Popover.Trigger` is not used at all.** The root wraps an
 * {@link PopoverProps.anchor} and the content; `open` stays the caller's own
 * state; the content is still written `{open && …}`. The caller's button is
 * untouched — it keeps its props, its name and its hit area, and it goes on
 * toggling the caller's own boolean.
 *
 * `anchor` is a `ReactNode` rather than a ref, which is `GearRow`'s
 * `anchorProps` idiom and the same seam `Sheet` and `Confirm` already use to
 * keep routing and store reads in `app/`.
 *
 * ## Where it lands (§5n K16)
 *
 * **Side bottom, always.** Never `right`: five of the seven triggers are a
 * row's right-edge control sitting one gutter from the pane edge at Split, so
 * a side popover collides on open every single time.
 *
 * **Alignment follows the trigger's own edge** — one rule rather than seven
 * decisions. `end` for a right-edge trigger in a row (a cluster, a pill);
 * `start` for a left-aligned one in a form or a bar (a ghost chip, a
 * picked-value row).
 *
 * **The seven placements**, and their alignment: tag picker `start`,
 * `ValueMenu` `start`, Piece picker `end`, Piece status sheet `end`, outcome
 * sheet `end`, outcome roster `end`, template source picker `start`.
 *
 * **Width is `min(20rem, available)`, floored at the trigger's own width.**
 * 20rem is the phone sheet's content measure, which is what these seven were
 * authored at; `available` is Radix's collision-aware value, so the cap is a
 * rule rather than a number about one pane.
 *
 * **The content scrolls itself** at `max-height: available` — the sheets' own
 * `svh` discipline one axis over, so a short viewport never clips a list.
 */
export interface PopoverProps {
  /**
   * The element the content is positioned against — normally the caller's own
   * trigger button, rendered here rather than beside the popover.
   *
   * It is **not** a Radix trigger: nothing is cloned onto it, and it does not
   * open anything by itself. The caller's `onClick` sets the caller's state,
   * and this component draws when that state says to.
   */
  anchor: ReactNode
  /** Dismissed by Escape, or by a pointer-down outside the content. */
  onClose: () => void
  /**
   * The accessible name. A popover is a `dialog` to assistive technology, so
   * it needs one — and unlike {@link Sheet} there is no visible title to take
   * it from, which is the point of the form: the trigger and its surroundings
   * are still on screen and a title would repeat them.
   */
  label: string
  /**
   * See the header. `end` for a right-edge trigger in a row, `start` for a
   * left-aligned one in a form or a bar.
   */
  align: 'start' | 'end'
  /**
   * `rows` bleeds the content to the edges, for a list whose rows carry their
   * own padding; `prose` insets it. The sheet's own two shapes, so a caller
   * that is one of these below Split is the same shape above it.
   */
  padding: 'rows' | 'prose'
  children: ReactNode
}

/** One step below the 12 between cards, so the gap reads *attached to*
 * rather than *sibling of* (§5n K15). */
const OFFSET = 8

export function Popover({
  anchor,
  onClose,
  label,
  align,
  padding,
  children,
}: PopoverProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  // Captured on mount, exactly as `Sheet` does: the element that had focus
  // when this opened is where focus goes back to, unless it has since left
  // the document.
  const opener = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement,
  )

  return (
    <RadixPopover.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {/* The caller's own control, positioned against but never rewritten. */}
      <RadixPopover.Anchor asChild>{anchor}</RadixPopover.Anchor>

      <RadixPopover.Portal>
        <RadixPopover.Content
          ref={contentRef}
          className={styles['content']}
          data-padding={padding}
          aria-label={label}
          side="bottom"
          align={align}
          sideOffset={OFFSET}
          // Collision handling, §5n K16: flip bottom→top when there is no
          // room below, shift along the align axis to stay on screen, and
          // keep the shell's own gutter between the content and the edge.
          avoidCollisions
          collisionPadding={16}
          onCloseAutoFocus={(event) =>
            restoreOpenerFocus(opener.current, event)
          }
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
