import { useState } from 'react'

import type { InvitePreview } from '../auth/api'
import styles from './Join.module.css'

export type DeadEndReason = 'expired' | 'used' | 'unknown'

export interface JoinProps {
  preview: InvitePreview | null
  /** Non-null renders the dead end. */
  deadEnd: DeadEndReason | null
  onConfirm: (name: string | null) => Promise<void>
  onOpenSignIn: () => void
  signedIn: boolean
  onOpenDepot: () => void
}

function expiryChip(expiresAt: string, now = Date.now()) {
  const remainingMs = new Date(expiresAt).getTime() - now
  const hours = remainingMs / 3_600_000

  if (hours < 1) {
    const minutes = Math.max(0, Math.round(remainingMs / 60_000))
    return { label: `Expires in ${minutes} min`, urgent: true }
  }
  if (hours < 48) {
    return { label: `Expires in ${Math.round(hours)} h`, urgent: false }
  }
  return { label: `Expires in ${Math.round(hours / 24)} d`, urgent: false }
}

/**
 * `/join#<secret>` (`docs/design/README.md` §9).
 *
 * Opening the link does nothing but load the app and show a confirmation. The
 * Invite is consumed only by an explicit POST the user triggers — chat apps
 * and mail scanners fetch links to build previews, and a GET-consumes design
 * would let a preview burn a single-use Invite before its recipient ever
 * tapped it (`auth-design.md` §3.3).
 */
export function Join({
  preview,
  deadEnd,
  onConfirm,
  onOpenSignIn,
  signedIn,
  onOpenDepot,
}: JoinProps) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  if (signedIn) {
    return (
      <div className={styles['screen']}>
        <h1 className={styles['title']}>Signed in.</h1>
        <p className={styles['fact']}>Passkey saved on this device.</p>
        <div className={styles['spacer']} />
        <button
          type="button"
          className={styles['primary']}
          onClick={onOpenDepot}
        >
          Open the depot
        </button>
      </div>
    )
  }

  if (deadEnd !== null) {
    // One screen, swapped fact line. Deliberately NO attention colour — the
    // link is done, nothing of the user's is wrong (design README §9).
    const fact = {
      expired: 'This invite expired. Invites last 7 days.',
      used: 'This invite was already used. Invites are single-use.',
      unknown: 'This server does not know this link.',
    }[deadEnd]

    return (
      <div className={styles['screen']}>
        <h1 className={styles['title']}>Invite not valid.</h1>
        <p className={styles['fact']}>{fact}</p>
        <p className={styles['quiet']}>
          Ask a household member for a new one. Nothing was used up by opening
          this.
        </p>
        <div className={styles['spacer']} />
        <button
          type="button"
          className={styles['bordered']}
          onClick={onOpenSignIn}
        >
          Open sign-in
        </button>
      </div>
    )
  }

  if (preview === null) {
    return (
      <div className={styles['screen']}>
        <p className={styles['fact']}>Checking the link.</p>
      </div>
    )
  }

  const chip = expiryChip(preview.expires_at)

  // A Household with no Login yet is necessarily one whose first Person is
  // created as they join, so this is where the joiner names themselves.
  const namesThemselves = !preview.person_recorded

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm(namesThemselves ? name.trim() : null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['screen']}>
      <h1 className={styles['title']}>Join {preview.household_name}?</h1>

      <div className={styles['card']}>
        <div>
          <span className={styles['rowLabel']}>Household</span>
          <span className={styles['rowValue']}>{preview.household_name}</span>
        </div>

        <div className={styles['chips']}>
          <span className={styles['chip']} data-urgent={chip.urgent}>
            {chip.label}
          </span>
          <span className={styles['chip']}>Single use</span>
        </div>
      </div>

      {namesThemselves && (
        <>
          <p className={styles['quiet']}>
            This link starts a new household. Its first login is yours.
          </p>
          <label className={styles['field']}>
            <span className={styles['rowLabel']}>Your name</span>
            <input
              className={styles['input']}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
            />
          </label>
          <p className={styles['fact']}>Household and depot start empty.</p>
        </>
      )}

      <div className={styles['spacer']} />

      {/* The rule, stated where it is needed: nothing is consumed by opening. */}
      <p className={styles['fact']}>Opening this link changed nothing yet.</p>

      <button
        type="button"
        className={styles['primary']}
        onClick={() => void confirm()}
        disabled={busy || (namesThemselves && name.trim() === '')}
      >
        {namesThemselves ? 'Continue' : `Join ${preview.household_name}`}
      </button>
    </div>
  )
}
