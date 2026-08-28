import { useRef, useState } from 'react'

import styles from './NoPasskey.module.css'

/**
 * The only copy this screen ever shows for a failed attempt — never a raw
 * error message, and never the reason (spent secret, expired invite,
 * offline, a 401) because none of those are the person's to sort out; "ask
 * for a new link" is the one action that always applies (`final-review.md`
 * finding 1).
 */
export const FAILURE_MESSAGE = 'Something went wrong. Ask for a new link.'

export interface NoPasskeyProps {
  /** Null while the Person exists only as a pre-bound id (`auth-design.md` §2.1). */
  personName: string | null
  onContinue: () => Promise<void>
  /**
   * Set by `JoinContainer` when it already knows this screen was reached
   * because the register ceremony genuinely failed — an expired or spent
   * secret, a network error — rather than because the person declined the OS
   * sheet. Null for a decline, and for the device-link path, where nothing
   * has been attempted yet: both leave this screen exactly as silent as
   * before.
   */
  initialError?: string | null
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
export function NoPasskey({
  personName,
  onContinue,
  initialError = null,
}: NoPasskeyProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  // A ref rather than `busy` alone: `onContinue` normally navigates the app
  // away once it resolves, but in isolation (and on a genuine double tap
  // faster than a render) `busy` can already be back to `false` by the time a
  // second click lands. This guard survives a *successful* run permanently —
  // the secret it redeemed is spent, so a second run must never fire — but a
  // *failed* run resets it: nothing was spent, and leaving it set would wedge
  // the button forever with no way back short of a reload.
  const started = useRef(false)

  async function go() {
    if (started.current) return
    started.current = true
    setBusy(true)
    setError(null)
    try {
      await onContinue()
    } catch {
      // Nothing was spent by a failed claim, so the guard resets — unlike the
      // success path, where it must stay set forever because the secret was.
      // Unlike before, the failure is no longer swallowed: this screen is
      // the person's only feedback on the device-link path, and a dead
      // secret retried here would otherwise show nothing at all
      // (`final-review.md` finding 1).
      started.current = false
      setError(FAILURE_MESSAGE)
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
      {/* Same mono `fact` register as everything else here — no `▲`, no
          amber: a spent link or an offline device is not the user's mistake
          (`docs/design/README.md` §9's dead-end frame). */}
      {error !== null && <p className={styles['fact']}>{error}</p>}

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
