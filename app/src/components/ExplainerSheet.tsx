import { Sheet } from '@foerier/ui'

import styles from './ExplainerSheet.module.css'

/**
 * "No passkey on this device?" (`docs/design/README.md` §15).
 *
 * The only place in the entire product where the Maintainer is named — and
 * only in the second paragraph, for the one case that genuinely leaves the
 * product: a Household with a single Login that is signed in nowhere.
 */
export interface ExplainerSheetProps {
  onClose: () => void
}

export function ExplainerSheet({ onClose }: ExplainerSheetProps) {
  return (
    <Sheet title="No passkey on this device?" onClose={onClose}>
      <p className={styles['primaryPara']}>
        Ask a signed-in household member for a device link — People &amp; logins
        ▸ your name ▸ Device link. Opened here, it signs this device in.
      </p>

      <p className={styles['mutedPara']}>
        If yours is the only login and it is signed in nowhere, ask whoever runs
        your server for a new join invite.
      </p>

      <Sheet.Close>
        <button type="button" className={styles['close']}>
          Close
        </button>
      </Sheet.Close>
    </Sheet>
  )
}
