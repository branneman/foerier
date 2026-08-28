import { useState } from 'react'

import { Logo } from '@foerier/ui'

import { ExplainerSheet } from '../components/ExplainerSheet'
import styles from './SignIn.module.css'

export type SignInState = 'idle' | 'ceremony' | 'failed'

export interface SignInProps {
  onSignIn: () => Promise<void>
  /** Sync state is one quiet line, never a blocking dialog. */
  online: boolean
  buildSha: string
  /** Shown when a token was revoked or expired and the sync client noticed. */
  sessionLost?: { unsyncedCount: number } | undefined
}

/**
 * The signed-out shell (`docs/design/README.md` §8).
 *
 * Loads offline from the service worker with zero data. **No username, no
 * password, no email — one button.** Discoverable credentials mean the
 * authenticator already knows which credential belongs to `foerier.app`.
 */
export function SignIn({
  onSignIn,
  online,
  buildSha,
  sessionLost,
}: SignInProps) {
  const [state, setState] = useState<SignInState>('idle')
  const [explainerOpen, setExplainerOpen] = useState(false)

  async function signIn() {
    setState('ceremony')
    try {
      await onSignIn()
    } catch {
      setState('failed')
    }
  }

  const busy = state === 'ceremony'

  return (
    <div className={styles['screen']} data-ceremony={busy}>
      <header className={styles['header']}>
        {!online && (
          <>
            <span className={styles['offlineDot']} aria-hidden="true" />
            <span>Offline</span>
          </>
        )}
      </header>

      <div className={styles['centre']}>
        <div className={styles['column']}>
          <Logo size={72} title="foerier" />
          <p className={styles['ledgerLine']}>
            The household&rsquo;s gear ledger.
          </p>
        </div>
      </div>

      <div className={styles['actions']}>
        {/*
          Fact weight, deliberately: no ▲, no red, no modal, no banner. This
          must never read as data loss — the work is on the device and flushes
          after the next sign-in (docs/design/README.md §15).
        */}
        {sessionLost !== undefined && (
          <p className={styles['muted']}>
            Signed out on this device.{' '}
            {sessionLost.unsyncedCount > 0
              ? `${sessionLost.unsyncedCount} changes saved here and not yet synced.`
              : 'Nothing unsynced.'}
          </p>
        )}

        {state === 'failed' && (
          <>
            <p className={styles['attention']}>
              ▲ Sign-in did not complete. Nothing changed.
            </p>
            <p className={styles['secondary']}>
              Try again, or ask a household member for a device link.
            </p>
          </>
        )}

        {!online && (
          <p className={styles['muted']}>
            Offline. Sign-in needs a connection.
          </p>
        )}

        <button
          type="button"
          className={styles['primary']}
          onClick={() => void signIn()}
          disabled={!online || busy}
        >
          Sign in
        </button>

        {/* Stays enabled offline — it needs no network. */}
        <button
          type="button"
          className={styles['ghost']}
          onClick={() => setExplainerOpen(true)}
        >
          No passkey on this device?
        </button>

        <p className={styles['footnote']}>
          Sign-in is a passkey. No passwords, no email.
        </p>
        <p className={styles['build']}>
          BUILD {buildSha.slice(0, 7).toUpperCase()}
        </p>
      </div>

      {explainerOpen && (
        <ExplainerSheet onClose={() => setExplainerOpen(false)} />
      )}
    </div>
  )
}
