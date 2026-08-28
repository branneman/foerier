import { QrCode } from '@foerier/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'

import type { AuthApi, IssuedInvite } from '../auth/api'
import { useDepot } from '../depot/store'
import styles from './DeviceLink.module.css'

// This file builds only the **device-link** variant of boards §14 ("Invite
// issued — phone 393, one screen for both purposes"). The **join** variant
// (`‹ PEOPLE & LOGINS`, "Invite for <Person>", the person naming themselves)
// belongs to story 28 / S5's People & logins screen, which does not exist
// yet — building that half now would wire a `REVOKE INVITE` and a title
// around a screen nothing links to. Left as a comment, per Task 11's brief,
// rather than as a stub route or a half-built prop.

export interface DeviceLinkProps {
  api: AuthApi
  token: string
  /** The Login's `person_id` — the key `useDepot` reads the name the lead
   * line is personalised with ("as you, Mark"), same as `Account.tsx`. */
  personId: string
}

/**
 * `EXPIRES IN 58 min` (boards §14). A device link's whole lifetime is one
 * hour (`auth-design.md` §5's TTL for `purpose: 'device'`), so this only
 * ever needs minute granularity — unlike `Join.tsx`'s own `expiryChip`,
 * which also prints hours and days for the week-long join invite. Kept
 * separate rather than shared for that reason: the two chips answer to
 * different-lived Invites and would otherwise carry a branch neither needs.
 */
function minutesRemaining(expiresAt: string, now: number): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 60_000))
}

/** Ticks the chip live, at a resolution finer than the minute it displays
 * (boards §14: "live count, minute granularity") so a minute rolling over is
 * never more than half a minute late to appear. */
function useNowTicking(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}

/**
 * Invite issued — the device-link variant (`docs/design/README.md` §14).
 * Reached from Account's `Sign in on another device` (§11, DEVICES).
 *
 * **Issues exactly one Invite, ever, no matter how many times this
 * component renders.** `POST /auth/invites` hands back the secret exactly
 * once, and the Invite it names is single-use — a component that re-issues
 * on re-render does not just waste a request, it silently burns invites and
 * leaves a trail of dead links behind it, each failing later with no
 * explanation on screen. An empty-deps effect alone is not a strong enough
 * guard: React 19 Strict Mode deliberately double-invokes an effect on
 * mount in development to surface exactly this kind of non-idempotence, so
 * a `useRef` flag is what actually keeps this to one call
 * (`docs/specs/2026-08-28-auth-device-links-plan.md` Task 11).
 */
export function DeviceLink({ api, token, personId }: DeviceLinkProps) {
  const personName = useDepot(
    (depot) => depot.state.people[personId]?.name?.value ?? null,
  )
  const [, navigate] = useLocation()
  const issuedRef = useRef(false)
  const [invite, setInvite] = useState<IssuedInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const now = useNowTicking()

  useEffect(() => {
    if (issuedRef.current) return
    issuedRef.current = true
    void api
      .issueDeviceLink(token)
      .then(setInvite)
      .catch((error: unknown) => {
        console.error('device link: could not issue a link', error)
      })
  }, [api, token])

  // The secret rides in the URL **fragment**, never sent to a server
  // (`auth-design.md` §3.2) — built from `window.location.origin` so the
  // link is correct in dev, preview and production with no config lookup.
  // `/join#<secret>` is the one redemption route for both Invite purposes
  // (`JoinContainer.tsx` disambiguates by `preview.purpose`); boards §14's
  // drawn example (`/d/x2c8-…`) predates that unification.
  const link =
    invite === null ? null : `${window.location.origin}/join#${invite.secret}`

  async function copyLink() {
    if (link === null) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      console.error('device link: could not copy the link', error)
    }
  }

  async function revoke() {
    if (invite === null) return
    setRevoking(true)
    try {
      await api.revokeInvite(token, invite.id)
      // Nothing is left to show once the link is dead — the same reasoning
      // `useDeviceSignOut`'s sign-out sequence gives for navigating away
      // rather than rendering a revoked state in place.
      navigate('/account')
    } catch (error) {
      console.error('device link: could not revoke the link', error)
      setRevoking(false)
    }
  }

  const minutes =
    invite === null ? null : minutesRemaining(invite.expires_at, now)
  // Always true in practice — a device link's whole lifetime is one hour,
  // so it is never *not* under an hour. Deliberate, not a bug to normalise
  // away (Task 11's brief); the `< 60` test still names the real rule
  // rather than hardcoding the outcome.
  const urgent = minutes !== null && minutes < 60

  return (
    <div className={styles['screen']}>
      <header className={styles['header']}>
        <Link href="/account" className={styles['back']}>
          ‹ ACCOUNT
        </Link>
      </header>

      <h1 className={styles['title']}>Sign in on another device</h1>
      <p className={styles['lead']}>
        Open this on the other device. It signs that device in as{' '}
        {personName === null ? 'you' : `you, ${personName}`}.
      </p>

      {invite !== null && link !== null && (
        <div className={styles['card']}>
          <QrCode value={link} size={126} title="Device link" />

          <div className={styles['well']}>{link}</div>

          <button
            type="button"
            className={styles['copy']}
            onClick={() => void copyLink()}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>

          <div className={styles['chips']}>
            <span className={styles['chip']} data-urgent={urgent}>
              EXPIRES IN {minutes} min
            </span>
            <span className={styles['singleUse']}>SINGLE USE</span>
          </div>
        </div>
      )}

      <p className={styles['fact']}>
        The link is the credential. Treat it like a key.
      </p>

      <div className={styles['revokeRow']}>
        <button
          type="button"
          className={styles['revoke']}
          onClick={() => void revoke()}
          disabled={invite === null || revoking}
        >
          REVOKE LINK
        </button>
      </div>
    </div>
  )
}
