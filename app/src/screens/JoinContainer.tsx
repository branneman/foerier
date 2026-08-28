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
 * Best-effort: asks the installed service worker, if any, to check for a new
 * version before `takeSecretFromFragment` strips the Invite secret out of
 * the URL.
 *
 * With `registerType: 'autoUpdate'` (`vite.config.ts`), the moment a new
 * worker takes control, `virtual:pwa-register`'s runtime reloads the page.
 * That reload must not land after the fragment has already been rewritten to
 * a bare `/join` — the secret is single-use with a one-hour expiry, so a
 * reload landing after the strip destroys it with no way to retry. Calling
 * `update()` here and awaiting it means any resulting reload fires while
 * `#secret` is still in the URL, so it is harmless and the fresh build picks
 * the secret up normally on the reload.
 *
 * Every step below can fail — `navigator.serviceWorker` is absent in the
 * test environment and on an insecure origin, `getRegistration()` can
 * resolve `undefined`, and `update()` rejects when offline — and every
 * failure is treated as "proceed as if fresh". Refusing to redeem a link
 * because an update check could not be made would be worse than redeeming it
 * on an old build.
 */
async function checkForServiceWorkerUpdate(): Promise<void> {
  if (!('serviceWorker' in navigator)) return

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration?.update()
  } catch {
    // Offline, or nothing registered yet — proceed as if fresh.
  }
}

/** The shape this file writes into `history.state` while a link is live. */
interface RetainedSecretState {
  secret: string
}

function readRetainedSecret(): string | null {
  const state = window.history.state as RetainedSecretState | null
  return typeof state?.secret === 'string' ? state.secret : null
}

/**
 * Reads the Invite secret out of the URL **fragment**, falling back to a
 * copy retained in `history.state` from an earlier read of the same fragment
 * on this history entry.
 *
 * The fallback matters because, once the fragment has been stripped below,
 * the secret otherwise lives only in React state — and *any* reload (a
 * phone's pull-to-refresh, the `autoUpdate` reload landing a beat later than
 * expected despite `checkForServiceWorkerUpdate`) loses it. Since the Invite
 * is single-use, that strands a link that is still perfectly valid.
 */
function takeSecretFromFragment(): string | null {
  const fromFragment = window.location.hash.replace(/^#/, '')
  if (fromFragment === '') return readRetainedSecret()

  // Replace the history entry immediately with a bare `/join`, so a
  // screen-shared address bar and the back button do not carry the secret
  // around. Residual exposure — the chat app that delivered it, the clipboard
  // — is answered by single-use and a short lifetime, not by secrecy theatre.
  //
  // The secret rides along in the history *state* object rather than being
  // dropped, so a later reload of this same entry recovers it instead of
  // dead-ending an otherwise-still-valid link (see `readRetainedSecret`).
  // This does not weaken `auth-design.md` §3.2: that section's concern is
  // the address bar, server logs, and the `Referer` header, and none of
  // those ever see `history.state` — the address bar itself is still a bare
  // `/join` either way. `history.state` is same-origin script-readable,
  // exactly like the fragment it replaces and like the Device token already
  // sitting in IndexedDB, so retaining the secret here adds nothing to the
  // residual XSS exposure `auth-design.md` §7.4 already accepts and bounds.
  window.history.replaceState({ secret: fromFragment }, '', '/join')
  return fromFragment
}

/**
 * Drops a secret retained by `takeSecretFromFragment`, once its Invite is
 * consumed or dead-ended, so a spent secret does not linger in the history
 * entry indefinitely.
 */
function clearRetainedSecret(): void {
  window.history.replaceState(null, '', '/join')
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
    async function load() {
      // Must resolve before `takeSecretFromFragment()` runs — see that
      // function's and `checkForServiceWorkerUpdate`'s comments for why the
      // ordering, not merely doing both, is the fix.
      await checkForServiceWorkerUpdate()

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
          clearRetainedSecret()
          setDeadEnd('unknown')
        })
    }

    void load()

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
      if (window.location.hash !== '') void load()
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
    // The Invite is consumed — nothing left to recover on a reload.
    clearRetainedSecret()
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
