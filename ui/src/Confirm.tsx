import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { useRef, type ReactNode } from 'react'

import styles from './Sheet.module.css'

/**
 * A decision — Radix AlertDialog wrapped exactly once, beside {@link Sheet}.
 *
 * **Why a second primitive and not a `role` prop on `Sheet`.** The role is not
 * the only difference. AlertDialog ignores an outside pointer-down, gives
 * initial focus to its `Cancel`, and expects a `Description` — three defaults
 * that are right for a decision and wrong for a picker. Passing
 * `role="alertdialog"` to a Dialog would buy the announcement and none of the
 * behaviour.
 *
 * **Two variants, one confirm.** `card` is the centred confirmation card
 * (remove a place, move gear, retire gear); `sheet` is the same decision drawn
 * as a bottom sheet, which is how the boards draw Devices' two
 * (`docs/design/README.md` §12 calls them "confirm sheets"). What makes it a
 * confirm — the role, the dismissal rule, the focus target, the order — is
 * identical in both.
 *
 * **The scrim does not dismiss it**, on either variant. Three of the five
 * surfaces this replaced already behaved that way; the two on Devices did not.
 * A confirmation exists to make a decision deliberate, and a stray tap on the
 * dim area is not a decision — least of all on `SignOutThisDeviceSheet`, which
 * can be mid-flight with `stopSync()` already called. Escape still closes.
 *
 * As with `Sheet`, there is no `open` prop: rendered is open.
 */
export interface ConfirmProps {
  /** Drawn as the heading, and the confirm's accessible name. */
  title: string
  /** The one line stating the consequence. Radix requires it, and so do we. */
  description: ReactNode
  /** Escape, or {@link Confirm.Cancel}. Never the scrim. */
  onClose: () => void
  /**
   * The actions row: a {@link Confirm.Cancel} and, normally, one
   * {@link Confirm.Action}.
   *
   * "Normally", because `Confirm.Action` closes on click — which is right for
   * a decision that is over the moment it is taken, and wrong for the one
   * that is not. `SignOutThisDeviceSheet` has to outlive its own action to
   * say `▲ Another tab has this open`, so its confirm is a plain button and
   * the sheet closes when the sequence finishes. A `Cancel` is not optional
   * either way: it is what Radix gives initial focus to.
   */
  actions: ReactNode
  /** `card` is the centred card; `sheet` is the bottom-sheet anatomy. */
  variant?: 'card' | 'sheet'
  /**
   * Rendered between the title and the description — the `▲` lines that
   * `SignOutThisDeviceSheet` states above its body. Four of the five surfaces
   * have none.
   */
  children?: ReactNode
}

function ConfirmRoot({
  title,
  description,
  onClose,
  actions,
  variant = 'card',
  children,
}: ConfirmProps) {
  const sheet = variant === 'sheet'

  // See `Sheet.tsx`: Radix restores focus to a `Trigger` we never render, so
  // the opener is captured here and restored below.
  const opener = useRef<Element | null>(null)
  if (opener.current === null) opener.current = document.activeElement

  return (
    <AlertDialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className={`${styles['scrim']} ${styles['raised']}`}
        />
        <AlertDialog.Content
          className={
            sheet ? `${styles['sheet']} ${styles['raised']}` : styles['card']
          }
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const opened = opener.current
            if (opened instanceof HTMLElement) opened.focus()
          }}
        >
          {sheet && <span className={styles['grabber']} aria-hidden="true" />}
          <AlertDialog.Title className={styles['title']}>
            {title}
          </AlertDialog.Title>
          {children}
          <AlertDialog.Description
            className={
              sheet ? styles['descriptionSheet'] : styles['descriptionCard']
            }
          >
            {description}
          </AlertDialog.Description>
          <div
            className={sheet ? styles['actionsSheet'] : styles['actionsCard']}
          >
            {actions}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

/** The safe way out, and what Radix gives initial focus to. */
function ConfirmCancel({
  asChild = true,
  children,
}: {
  asChild?: boolean
  children: ReactNode
}) {
  return <AlertDialog.Cancel asChild={asChild}>{children}</AlertDialog.Cancel>
}

/**
 * The decision itself. Closes the confirm *and* runs whatever the caller's
 * own button does — the caller keeps its styling, which is why the button
 * primitives are not part of this slice.
 */
function ConfirmAction({
  asChild = true,
  children,
}: {
  asChild?: boolean
  children: ReactNode
}) {
  return <AlertDialog.Action asChild={asChild}>{children}</AlertDialog.Action>
}

export const Confirm = Object.assign(ConfirmRoot, {
  Cancel: ConfirmCancel,
  Action: ConfirmAction,
})
