import { ExpiryChip, QrCode } from '@foerier/ui'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'

import type { AuthApi, IssuedInvite } from '../auth/api'
import { useHousehold } from '../household/store'
import { ScreenBand } from '../shell/ScreenBand'
import { useScreenHeader } from '../shell/useMediaQuery'
import styles from './InviteIssued.module.css'

// This file builds **both** halves of boards §14 ("Invite issued, one
// screen for both purposes"): a device link (own or another Person's) and a
// join Invite. It started as only the device-link variant — the join
// variant and the third entry point (a device link for someone else)
// waited on the People & logins screen (story 28 / S5), which now exists.

export interface InviteIssuedProps {
  api: AuthApi
  token: string
  /** The signed-in Login's Person. */
  personId: string
  /** Who the Invite is for. Equal to `personId` for the own device link. */
  subjectPersonId: string
  purpose: 'join' | 'device'
}

/**
 * Invite issued (`docs/design/README.md` §14) — three entry points sharing
 * one screen:
 *
 * - `/account/device-link` — Account's own `Sign in on another device`.
 * - `/account/people/:personId/device-link` — a device link minted against
 *   another Person's Login.
 * - `/account/people/:personId/invite` — a join Invite for a Person who has
 *   no Login yet.
 *
 * The back link, title, lead, fact line, QR title and the revoke button's
 * own label vary between them — the card, the copy button and the
 * mint-once guard below are identical regardless of which door the reader
 * came in. The revoke label follows the vocabulary
 * (`docs/design/README.md`'s Auth vocabulary & rules): a join Invite is not
 * a link, so "REVOKE LINK" is the wrong word for it — the board draws
 * `REVOKE INVITE` there and `REVOKE LINK` for both device-link entry
 * points, own and another's.
 *
 * ## The band above the title
 *
 * Half of `useScreenHeader`'s rule (`frontend-design.md` §3.3) is this
 * screen's and half is not. It has never drawn a sync line, so the sync half
 * has nothing to say to it; the back-link half does, and the answer is the
 * hook's rather than an unconditional link. All three routes are reachable at
 * **every** width — none carries the `Redirect to="/account"` that keeps
 * `People` and `Devices` below Desktop — and at Desktop the sidebar already
 * carries a labelled `Account` row, so both destinations this link points at
 * are on the page: `/account` is that row, and `/account/people` redirects to
 * it. A link that bounces through a redirect to a row already in the
 * navigation is exactly what the rule withholds.
 *
 * The `<header>` is gated on `backLink` rather than on `band`, because for
 * a screen that draws no sync line the back link is the only thing the band
 * could hold — and `band` exists so that a wrapper is never rendered empty.
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
export function InviteIssued({
  api,
  token,
  personId,
  subjectPersonId,
  purpose,
}: InviteIssuedProps) {
  const own = subjectPersonId === personId
  const header = useScreenHeader({ splitPane: false })
  const subjectName = useHousehold(
    (depot) => depot.state.people[subjectPersonId]?.name?.value ?? null,
  )
  const name = subjectName ?? 'this person'

  const [, navigate] = useLocation()
  const issuedRef = useRef(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [invite, setInvite] = useState<IssuedInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)

  /**
   * Boards §14 is one screen for both purposes, and the third entry point —
   * a device link for someone else — is S5's. The back link **follows the
   * route** rather than being fixed to `‹ ACCOUNT` as §14 draws it: a back
   * link that returns somewhere the reader has not been is worse than one
   * word of variance.
   */
  const copy = own
    ? {
        back: { href: '/account', label: 'ACCOUNT' },
        title: 'Sign in on another device',
        lead: `Open this on the other device. It signs that device in as ${
          subjectName === null ? 'you' : `you, ${subjectName}`
        }.`,
        fact: 'The link is the credential. Treat it like a key.',
        qrTitle: 'Device link',
        revokeLabel: 'REVOKE LINK',
      }
    : purpose === 'device'
      ? {
          back: { href: '/account/people', label: 'PEOPLE & LOGINS' },
          title: `Device link for ${name}`,
          lead: `Open this on ${name}’s device. It signs that device in as ${name}.`,
          fact: 'The link is the credential. Treat it like a key.',
          qrTitle: 'Device link',
          revokeLabel: 'REVOKE LINK',
        }
      : {
          back: { href: '/account/people', label: 'PEOPLE & LOGINS' },
          title: `Invite for ${name}`,
          lead: 'Hand it over yourself — foerier sends no mail.',
          fact: `It creates a login for ${name}. Nothing else can use it.`,
          qrTitle: 'Join invite',
          revokeLabel: 'REVOKE INVITE',
        }

  useEffect(() => {
    if (issuedRef.current) return
    issuedRef.current = true

    const issue =
      purpose === 'join'
        ? api.issueJoinInvite(token, subjectPersonId)
        : own
          ? api.issueDeviceLink(token)
          : api.issueDeviceLinkFor(token, subjectPersonId)

    void issue.then(setInvite).catch((error: unknown) => {
      console.error('invite issued: could not issue a link', error)
    })
  }, [api, token, purpose, subjectPersonId, own])

  // The "Copied" swap on the button is transient — clear its timer on
  // unmount so a leftover callback never fires against an unmounted
  // component (harmless under React 18+'s own warning removal, but a
  // dangling timer serves nothing once the screen is gone).
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) {
        clearTimeout(copiedTimeoutRef.current)
      }
    }
  }, [])

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
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      console.error('invite issued: could not copy the link', error)
    }
  }

  async function revoke() {
    if (invite === null) return
    setRevoking(true)
    try {
      await api.revokeInvite(token, invite.id)
      // Nothing is left to show once the link is dead — the same reasoning
      // `useDeviceSignOut`'s sign-out sequence gives for navigating away
      // rather than rendering a revoked state in place. Goes back to
      // wherever the reader came from, not always `/account` — revoking a
      // join Invite from People & logins must not strand the reader on a
      // screen they never visited.
      navigate(copy.back.href)
    } catch (error) {
      console.error('invite issued: could not revoke the link', error)
      setRevoking(false)
    }
  }

  return (
    <div className={styles['screen']}>
      {/* No `sync` handed in: this screen draws no sync line, so the band
          gates on the back link alone (`frontend-design.md` §3.3). */}
      <ScreenBand header={header} back={copy.back} />

      <h1 className={styles['title']}>{copy.title}</h1>
      <p className={styles['lead']}>{copy.lead}</p>

      {invite !== null && link !== null && (
        <div className={styles['card']}>
          <QrCode value={link} size={126} title={copy.qrTitle} />

          <div className={styles['well']}>{link}</div>

          <button
            type="button"
            className={styles['copy']}
            onClick={() => void copyLink()}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>

          <div className={styles['chips']}>
            <ExpiryChip expiresAt={invite.expires_at} />
            <span className={styles['singleUse']}>SINGLE USE</span>
          </div>
        </div>
      )}

      <p className={styles['fact']}>{copy.fact}</p>

      <div className={styles['revokeRow']}>
        <button
          type="button"
          className={styles['revoke']}
          onClick={() => void revoke()}
          disabled={invite === null || revoking}
        >
          {copy.revokeLabel}
        </button>
      </div>
    </div>
  )
}
