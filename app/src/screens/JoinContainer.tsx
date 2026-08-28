import { startRegistration } from '@simplewebauthn/browser'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import type { StoreApi } from 'zustand/vanilla'

import type { AuthApi, InvitePreview, SignedIn } from '../auth/api'
import type { PendingStore } from '../auth/pendingFirstPerson'
import type { Session } from '../auth/sessionStore'
import { DepotProvider, type DepotStoreState } from '../depot/store'
import { Join, type DeadEndReason } from './Join'
import { NoPasskey } from './NoPasskey'

export interface JoinContainerProps {
  api: AuthApi
  pending: PendingStore
  onSignedIn: (session: Session) => Promise<void>
  /**
   * The Device's depot, once it has one. `null` until the session this flow
   * writes has been read back and a store built over it — a window the
   * success frame's first-sync card renders inside, so it is nullable rather
   * than required.
   */
  depot?: StoreApi<DepotStoreState> | null
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
  depot = null,
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
  const [noPasskey, setNoPasskey] = useState(false)
  // The joiner's typed name, hoisted out of `Join` so it survives the swap to
  // `NoPasskey` when the ceremony falls through. Held here rather than in
  // `Join` because `Join` unmounts the moment this container swaps it out.
  const [pendingName, setPendingName] = useState<string | null>(null)
  // Which path produced the session `Join`'s success frame is about to show —
  // read only once `justJoined` is true, but tracked from the start rather
  // than defaulting to either value, since a stale default here is exactly
  // how the success frame came to tell a passkey-less claim "Passkey saved on
  // this device" in the first place.
  const [passkeySaved, setPasskeySaved] = useState(false)

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
    //
    // Guarded to a non-empty hash: `load()` itself clears the fragment via
    // `replaceState` the instant it reads a secret, and — although the spec
    // says `replaceState` must never fire `hashchange` — jsdom fires it
    // anyway, which would otherwise re-run `load()` against the
    // now-empty hash it just cleared and dead-end a page that had just
    // loaded correctly. A legitimate second link always carries a secret.
    function onHashChange() {
      if (window.location.hash !== '') load()
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [api])

  /**
   * The one completion path, shared by both ways in: the register ceremony
   * and the token-only claim end with exactly the same steps — save the
   * joiner's name if there is one, sign the session in, mark the join done.
   * The only thing that differs between them is whether a credential was
   * actually made, and that difference is a parameter rather than a second
   * copy of this block — the second copy is what let the success frame tell
   * a passkey-less Device "Passkey saved on this device" in the first place.
   */
  async function completeSignIn(
    name: string | null,
    result: SignedIn,
    credentialCreated: boolean,
  ) {
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
    setPasskeySaved(credentialCreated)
    setJustJoined(true)
  }

  async function confirm(name: string | null) {
    if (secret === null) return

    const options = await api.registerOptions(secret)
    const attestation = await startRegistration({ optionsJSON: options })
    const result = await api.registerVerify(secret, attestation)

    await completeSignIn(name, result, true)
  }

  /**
   * The token-only path. No ceremony runs at all, so there is nothing to
   * detect and nothing that can be declined — which is exactly why it is also
   * reachable from the confirm frame's ghost, not only from a failure.
   */
  async function claim(name: string | null) {
    if (secret === null) return

    const result = await api.claimDevice(secret)

    await completeSignIn(name, result, false)
    setNoPasskey(false)
  }

  async function confirmOrFallThrough(name: string | null) {
    // `auth-design.md` §5: absent API, no usable authenticator, or a plain
    // refusal all land in the same place. The ghost door reaches it too, for
    // the device that *can* make a credential in a store its owner declined.
    if (typeof window.PublicKeyCredential !== 'function') {
      setNoPasskey(true)
      return
    }
    try {
      await confirm(name)
    } catch {
      setNoPasskey(true)
    }
  }

  // A device link never runs a ceremony — `device/claim` issues a token and
  // creates no credential, always (`auth-design.md` §5). So there is nothing
  // for a confirm frame to confirm, and "Join Veldkamp?" is the wrong question
  // to ask someone who is already a member signing in a second Device. Boards
  // §14 describe the link as signing that device in directly.
  const isDeviceLink = preview?.purpose === 'device'

  if (preview !== null && !justJoined && (noPasskey || isDeviceLink)) {
    return (
      <NoPasskey
        // Null on the device-link path: the Person is already recorded, and
        // their name lives in a fold this Device has not built yet.
        personName={isDeviceLink ? null : pendingName}
        onContinue={() => claim(isDeviceLink ? null : pendingName)}
      />
    )
  }

  const join = (
    <Join
      preview={preview}
      deadEnd={deadEnd}
      onConfirm={confirmOrFallThrough}
      onOpenSignIn={() => navigate('/signin')}
      onNoPasskey={() => setNoPasskey(true)}
      onNameChange={setPendingName}
      signedIn={justJoined}
      passkeySaved={passkeySaved}
      onOpenDepot={() => navigate('/')}
    />
  )

  // The provider only where there is something to provide: the success
  // frame's first-sync card reads the engine through it, and tolerates its
  // absence for the moment between signing in and the depot being built.
  return depot === null ? (
    join
  ) : (
    <DepotProvider value={depot}>{join}</DepotProvider>
  )
}
