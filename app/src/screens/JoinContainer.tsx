import { startRegistration } from '@simplewebauthn/browser'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'

import type { AuthApi, InvitePreview } from '../auth/api'
import type { PendingStore } from '../auth/pendingFirstPerson'
import type { Session } from '../auth/sessionStore'
import { Join, type DeadEndReason } from './Join'

export interface JoinContainerProps {
  api: AuthApi
  pending: PendingStore
  onSignedIn: (session: Session) => Promise<void>
}

/**
 * Reads the Invite secret out of the URL **fragment**.
 *
 * The fragment is never sent to a server, so the secret stays out of Caddy's
 * access log, out of any intermediary's log, and out of the `Referer` header
 * on any later navigation (`auth-design.md` §3.2).
 */
function takeSecretFromFragment(): string | null {
  const secret = window.location.hash.replace(/^#/, '')
  if (secret === '') return null

  // Replace the history entry immediately with a bare `/join`, so a
  // screen-shared address bar and the back button do not carry the secret
  // around. Residual exposure — the chat app that delivered it, the clipboard
  // — is answered by single-use and a short lifetime, not by secrecy theatre.
  window.history.replaceState(null, '', '/join')
  return secret
}

export function JoinContainer({
  api,
  pending,
  onSignedIn,
}: JoinContainerProps) {
  const [, navigate] = useLocation()
  // Whether THIS flow completed the join — not merely whether a session
  // exists. A quartermaster who is already signed in and opens a spent link
  // must see the dead end, not a success screen for something that did not
  // happen here.
  const [justJoined, setJustJoined] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [deadEnd, setDeadEnd] = useState<DeadEndReason | null>(null)

  useEffect(() => {
    function load() {
      const found = takeSecretFromFragment()
      if (found === null) {
        setDeadEnd('unknown')
        return
      }

      setSecret(found)
      setDeadEnd(null)
      setPreview(null)
      setJustJoined(false)

      void api
        .previewInvite(found)
        .then(setPreview)
        .catch(() => {
          // The server answers unknown, expired, used and revoked
          // identically, on purpose (auth-design.md §9.4), so the dead end
          // shows the only thing actually known: the link does not work.
          setDeadEnd('unknown')
        })
    }

    load()

    // A second link pasted into an open tab is a *fragment-only* navigation:
    // the browser changes the URL without reloading, so nothing would react
    // without this. Easy to miss, because opening a link from a chat app
    // always loads a fresh document and works either way.
    window.addEventListener('hashchange', load)
    return () => window.removeEventListener('hashchange', load)
  }, [api])

  async function confirm(name: string | null) {
    if (secret === null) return

    const options = await api.registerOptions(secret)
    const attestation = await startRegistration({ optionsJSON: options })
    const result = await api.registerVerify(secret, attestation)

    // The joiner's name and the Invite's pre-bound person_id are captured
    // here rather than authored here: the op needs a depot store, which is
    // built from the session this flow has only just written.
    // `flushPendingFirstPerson` emits it on the other side of that.
    if (name !== null && name !== '') {
      await pending.save({
        personId: result.person_id,
        householdId: result.household_id,
        name,
      })
    }

    await onSignedIn({
      token: result.token,
      loginId: result.login_id,
      personId: result.person_id,
      householdId: result.household_id,
      deviceId: result.device_id,
    })
    setJustJoined(true)
  }

  return (
    <Join
      preview={preview}
      deadEnd={deadEnd}
      onConfirm={confirm}
      onOpenSignIn={() => navigate('/signin')}
      signedIn={justJoined}
      onOpenDepot={() => navigate('/')}
    />
  )
}
