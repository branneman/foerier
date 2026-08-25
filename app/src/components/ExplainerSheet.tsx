import { useEffect, useRef } from 'react'

import styles from './ExplainerSheet.module.css'

export interface ExplainerSheetProps {
  open: boolean
  onClose: () => void
}

/**
 * "No passkey on this device?" (`docs/design/README.md` §15).
 *
 * The only place in the entire product where the Maintainer is named — and
 * only in the second paragraph, for the one case that genuinely leaves the
 * product: a Household with a single Login that is signed in nowhere.
 */
export function ExplainerSheet({ open, onClose }: ExplainerSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={styles['scrim']}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={styles['sheet']}
        role="dialog"
        aria-modal="true"
        aria-label="No passkey on this device?"
        tabIndex={-1}
      >
        <span className={styles['grabber']} aria-hidden="true" />
        <h2 className={styles['title']}>No passkey on this device?</h2>

        <p className={styles['primaryPara']}>
          Ask a signed-in household member for a device link — People &amp;
          logins ▸ your name ▸ Device link. Opened here, it signs this device
          in.
        </p>

        <p className={styles['mutedPara']}>
          If yours is the only login and it is signed in nowhere, ask whoever
          runs your server for a new join invite.
        </p>

        <button type="button" className={styles['close']} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
