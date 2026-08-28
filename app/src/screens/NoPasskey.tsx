import { useRef, useState } from 'react'

import styles from './NoPasskey.module.css'

export interface NoPasskeyProps {
  /** Null while the Person exists only as a pre-bound id (`auth-design.md` §2.1). */
  personName: string | null
  onContinue: () => Promise<void>
}

/**
 * The compatibility path (`docs/design/README.md` §10), drawn deliberately
 * first-class: the same accent primary as every other confirm, **no amber, no
 * ▲, no "however"**.
 *
 * The first line reads "No passkey is made here" rather than the boards'
 * original "This device cannot make one" — the S3.5 departure. On the Android
 * builds this path exists for, the device *can* make one; what it cannot do is
 * make one in the credential store the household chose. A line that is
 * sometimes false fails this screen's whole discipline of stating plain facts.
 */
export function NoPasskey({ personName, onContinue }: NoPasskeyProps) {
  const [busy, setBusy] = useState(false)
  // A ref rather than `busy` alone: `onContinue` normally navigates the app
  // away once it resolves, but in isolation (and on a genuine double tap
  // faster than a render) `busy` can already be back to `false` by the time a
  // second click lands. This guard is permanent for the component's
  // lifetime — once started, never again — where `busy` stays purely
  // presentational.
  const started = useRef(false)

  async function go() {
    if (started.current) return
    started.current = true
    setBusy(true)
    try {
      await onContinue()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['screen']}>
      <h1 className={styles['title']}>Continue without a passkey</h1>
      <p className={styles['body']}>
        No passkey is made here. It stays signed in anyway — nothing is limited.
      </p>
      <p className={styles['body']}>
        A passkey added later, on any device that supports one, makes future
        sign-ins self-service.
      </p>
      <p className={styles['fact']}>You stay signed in until you sign out.</p>

      <div className={styles['spacer']} />

      <button
        type="button"
        className={styles['primary']}
        onClick={() => void go()}
        disabled={busy}
      >
        {personName === null ? 'Continue' : `Continue as ${personName}`}
      </button>
    </div>
  )
}
