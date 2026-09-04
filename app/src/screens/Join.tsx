import { ExpiryChip } from '@foerier/ui'
import { useState } from 'react'

import type { InvitePreview } from '../auth/api'
import { FirstSync } from '../components/FirstSync'
import styles from './Join.module.css'

export type DeadEndReason = 'expired' | 'used' | 'unknown'

export interface JoinProps {
  preview: InvitePreview | null
  /** Non-null renders the dead end. */
  deadEnd: DeadEndReason | null
  onConfirm: (name: string | null) => Promise<void>
  onOpenSignIn: () => void
  /** The S3.5 door (`docs/design/README.md` §10) — a deliberate choice, not only a fallback. */
  onNoPasskey: () => void
  /**
   * Mirrors the typed name up to `JoinContainer` as it is typed, so it
   * survives the swap to `NoPasskey` if the ceremony falls through — this
   * component unmounts at that point, and its own `name` state goes with it.
   */
  onNameChange: (name: string) => void
  signedIn: boolean
  /**
   * Whether *this* sign-in actually made a credential. The register path
   * (`confirm`) does; the claim path (`claim`, both the device link and the
   * S3.5 fallback) never does — `device/claim` issues a token and creates no
   * credential, always (`auth-design.md` §5). Read only when `signedIn` is
   * true, but not optional: a stale default here is exactly how the success
   * frame told a passkey-less claim "Passkey saved on this device" in the
   * first place.
   */
  passkeySaved: boolean
  onOpenDepot: () => void
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
  onNoPasskey,
  onNameChange,
  signedIn,
  passkeySaved,
  onOpenDepot,
}: JoinProps) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  if (signedIn) {
    return (
      <div className={styles['screen']}>
        <h1 className={styles['title']}>Signed in.</h1>
        {/* The claim path (device link or S3.5 fallback) never makes a
            credential, so it gets `NoPasskey`'s own settled fact line rather
            than a claim the register path alone can make — the same
            discipline that turned "This device cannot make one" into "No
            passkey is made here" (`docs/design/README.md` §10). */}
        <p className={styles['fact']}>
          {passkeySaved
            ? 'Passkey saved on this device.'
            : 'You stay signed in until you sign out.'}
        </p>
        {/* The one screen a Quartermaster cannot walk past: a Device that has
            never pulled folds the household's history before the depot can
            show anything, so the CTA is gated on that fold rather than on
            having signed in. A brand-new household has nothing to fold, and
            `FirstSync` renders the ungated button instead. No spacer here:
            §9 puts the fold card in the body, and `FirstSync` owns its own
            spacer between the card and the CTA so only the button — never
            the card — sits in the thumb zone. */}
        <FirstSync onOpenDepot={onOpenDepot} />
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
          {/* `ui/ExpiryChip`, as on `InviteIssued` and People & logins — one
              reading of the same fact everywhere it is drawn (§14: floors
              days, ticks live, amber inside the last hour). A screen-local
              copy had rounded, so a fresh 7-day link read `7 d` on the day
              it dies. */}
          <ExpiryChip expiresAt={preview.expires_at} />
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
              onChange={(event) => {
                setName(event.target.value)
                onNameChange(event.target.value)
              }}
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

      {/* The S3.5 door (`docs/design/README.md` §10). The sign-in screen uses
          these exact words for its explainer sheet; here a secret is in hand,
          so they lead to the screen itself. Two destinations, deliberately —
          wiring both to one makes one of them a dead end. */}
      <button type="button" className={styles['ghost']} onClick={onNoPasskey}>
        No passkey on this device?
      </button>
    </div>
  )
}
