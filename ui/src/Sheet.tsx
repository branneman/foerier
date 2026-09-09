import * as Dialog from '@radix-ui/react-dialog'
import { useRef, type ReactElement, type ReactNode } from 'react'

import { restoreOpenerFocus } from './restoreOpenerFocus'
import styles from './Sheet.module.css'

/**
 * The bottom sheet — Radix Dialog wrapped exactly once
 * (`frontend-design.md` §5), so the rest of the app imports *our* component
 * and there is one place to restyle or replace it.
 *
 * **A picker, not a decision.** A `Sheet` dismisses on the scrim and on
 * Escape. Anything that asks the Quartermaster to decide something is a
 * {@link Confirm}, which does neither of the first and keeps the second.
 *
 * **There is no `open` prop: rendered is open.** Callers write
 * `{open && <Sheet …/>}`. The reason is not symmetry — `HomePicker` was
 * mounted permanently and early-returned `null`, so its EDIT mode and its
 * three drafts survived a close and came back on the next open. Mount is the
 * reset. The cost, recorded rather than discovered: Radix's `Presence` needs
 * an `open` transition to animate a sheet *out*, so the first exit animation
 * puts `open`/`onOpenChange` back and moves draft state below `Content`.
 *
 * **The accessible name is the visible title.** `Dialog.Title` carries it, so
 * a name cannot drift away from the words on screen the way a parallel
 * `aria-label` can. {@link description} extends what a reader hears on open
 * without touching the name itself — see its own doc.
 */
/**
 * **From Split up a sheet is a centred card, always** (§5n K18).
 *
 * This was `desktopCard`, an opt-in a caller reasoned about — and five sheets
 * passed it while their nearest siblings did not, so at Desktop the Owner
 * picker was a centred card and the Home picker a bottom sheet **on the same
 * edit sheet**. K18 rules the set instead of the callers: **two Desktop forms
 * and no third.** A sheet a board *draws* as a popover becomes one, and every
 * other sheet is this — not a flag, but what `Sheet` is at Desktop.
 *
 * So the prop is gone rather than defaulted to `true`: a default is still a
 * thing a caller can override, and the fault this closes was a caller
 * reasoning about it at all. The seven popover callers will switch **component**
 * when `ui/Popover` lands (K15–K17), not flag.
 */
export interface SheetProps {
  /** Drawn as the heading, and the sheet's accessible name. */
  title: string
  /** Escape, or a pointer-down on the scrim, or {@link Sheet.Close}. */
  onClose: () => void
  /** Sits opposite the title. Only `HomePicker`'s EDIT/DONE toggle uses it. */
  titleAction?: ReactNode
  /**
   * How the title is **painted**, never what it means — `PersonCircle`'s
   * rule (`patterns.md` §5.3). `display` is the sentence-case heading every
   * sheet and confirm in the app wears; `eyebrow` is the mono caps label
   * `Screens B` 02A draws for `SET PHASE`, and `PhaseSheet` is its only
   * caller.
   *
   * **An opt-in prop rather than a restyled primitive**, which is the whole
   * reason this waited: the board means *that* title. `Edit gear`, `Tags`,
   * `Home`, `Owner`, `Participants`, `Sort and group` and
   * `Sign out this device?` are all sentence case and would be wrong in
   * mono, so the tone has to be the caller's to pass.
   *
   * It changes paint and nothing else. The title is still `Dialog.Title`,
   * still the accessible name, and still the words the caller gave — an
   * eyebrow is not a `text-transform`, and a caller that wants caps types
   * them (`SET PHASE`), exactly as every other label in the app does.
   */
  titleTone?: 'display' | 'eyebrow'
  /**
   * The sheet's single describing paragraph, wired to `Dialog.Description`
   * so a screen reader reads it right after the title on open — name plus
   * description, the platform-idiomatic way to announce "what this is and
   * how far along it is" without folding the second fact into the name
   * itself (which would make the name a superset of the visible title and
   * spend the invariant above).
   *
   * **One node doing both jobs.** Pass the caller's own visible fact line
   * (`PieceStatusSheet`'s `PACKING STATUS · 1 OF 3 PACKED`) directly —
   * `Sheet` renders it `asChild`, wiring Radix's id and `aria-describedby`
   * onto that element rather than wrapping it in a second one. A caller
   * with no such line omits this, exactly as every caller did before it
   * existed.
   *
   * **`ReactElement`, not the looser `ReactNode`.** `asChild` reaches
   * Radix's `Slot`, which clones its child to attach `id` and needs exactly
   * one real element to clone onto — a bare string or a fragment reaches
   * `Slot` and misbehaves. The type says what the mechanism requires rather
   * than leaving it to a docblock a caller might not read.
   */
  description?: ReactElement
  children: ReactNode
}

function SheetRoot({
  title,
  onClose,
  titleAction,
  titleTone = 'display',
  description,
  children,
}: SheetProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Radix's modal `Dialog` restores focus to its `Dialog.Trigger` and to
  // nothing else — and a sheet that is mounted *because* it is open has no
  // trigger to render. Without this, closing leaves focus on `<body>`: the
  // keyboard is back at the top of the page and a screen reader has lost its
  // place. So the opener is captured during the first render, before Radix
  // moves focus, and restored by hand below.
  const opener = useRef<Element | null>(null)
  if (opener.current === null) opener.current = document.activeElement

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={`${styles['scrim']} ${styles['scrimAtSplit']}`}
        />
        <Dialog.Content
          ref={contentRef}
          className={`${styles['sheet']} ${styles['cardAtSplit']}`}
          tabIndex={-1}
          // The default, for pickers with no describing paragraph — Radix
          // warns about a missing `Description` unless told so explicitly.
          // A caller with one passes `description`, and then this is
          // omitted so Radix wires its own `Dialog.Description` id here
          // instead.
          {...(description === undefined
            ? { 'aria-describedby': undefined }
            : {})}
          // Radix focuses the first tabbable control. In `HomePicker` that is
          // the EDIT toggle — the one control that suspends the task the
          // sheet was opened for. Focus the sheet instead: the reader hears
          // the title, and the first Tab lands on the first control rather
          // than starting inside one.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            contentRef.current?.focus()
          }}
          // See `restoreOpenerFocus` (fix round F3): only claims the
          // restore — and only cancels Radix `FocusScope`'s own — when the
          // opener is still on the page.
          onCloseAutoFocus={(event) =>
            restoreOpenerFocus(opener.current, event)
          }
        >
          <span className={styles['grabber']} aria-hidden="true" />
          {titleAction === undefined ? (
            <Dialog.Title className={styles['title']} data-tone={titleTone}>
              {title}
            </Dialog.Title>
          ) : (
            <div className={styles['titleRow']}>
              <Dialog.Title className={styles['title']} data-tone={titleTone}>
                {title}
              </Dialog.Title>
              {titleAction}
            </div>
          )}
          {description !== undefined && (
            <Dialog.Description asChild>{description}</Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * The sheet's own ghost `Close`. A thin component of ours rather than a
 * re-export: `app/` imports `Sheet.Close` and never a Radix name, which is
 * what keeps "wrapped exactly once" literally true.
 */
function SheetClose({
  asChild = true,
  children,
}: {
  /** Defaults to `true` — every caller brings its own styled button. */
  asChild?: boolean
  children: ReactNode
}) {
  return <Dialog.Close asChild={asChild}>{children}</Dialog.Close>
}

export const Sheet = Object.assign(SheetRoot, { Close: SheetClose })
