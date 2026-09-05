import { Confirm } from '@foerier/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useSearch } from 'wouter'

import type { AuthApi, DeviceRow } from '../auth/api'
import { formatDate, formatDateTime } from '../format'
import { useDepot } from '../depot/store'
import { clearLocalData as clearLocalDataForReal } from '../depot/wiring'
import { ScreenBand } from '../shell/ScreenBand'
import { useScreenHeader } from '../shell/useMediaQuery'
import styles from './Devices.module.css'

/**
 * Three states, not a boolean — same reasoning as `Account.tsx`'s own
 * `LoadStatus`: `devices` initialises to `[]`, and a failed fetch must not
 * read as "0 signed in with this login", a confident and wrong statement
 * about the household's security posture (`final-review.md` finding 2).
 */
type LoadStatus = 'loading' | 'loaded' | 'failed'

function deviceMeta(device: DeviceRow): string {
  if (device.current) {
    // A passkey-less current Device is a plain fact, not a warning — boards
    // §12: "NO PASSKEY HERE" rides the same mono meta line as the date, no
    // attention colour.
    return device.enrolled_passkey_here
      ? `SIGNED IN ${formatDate(device.created_at)}`
      : `SIGNED IN ${formatDate(device.created_at)} · NO PASSKEY HERE`
  }
  return `LAST SEEN ${formatDateTime(device.last_seen_at)}`
}

/**
 * The rows — coarse label, `THIS DEVICE` chip, meta, and a per-row `SIGN
 * OUT` — shared verbatim between the pushed Devices screen (below Desktop)
 * and Account's Desktop `DEVICES` card (`docs/design/README.md` §11/§12).
 * Built once and rendered in both places on purpose: two copies is how the
 * copy on one of them drifts (Task 10 brief).
 *
 * No IPs, no fingerprinting — the label is the coarse client guess or the
 * server's own UA-derived fallback, nothing finer.
 *
 * `showSignOutOnCurrent` is the one anatomy difference the boards actually
 * draw between the two surfaces: the pushed screen puts `SIGN OUT` on THIS
 * DEVICE's own row too, but Account's Desktop card omits it there because
 * the card's footer already carries that action (boards §11's desktop
 * frame draws the current row with no per-row action at all).
 */
export function DeviceList({
  devices,
  onSelect,
  showSignOutOnCurrent = true,
}: {
  devices: readonly DeviceRow[]
  onSelect: (device: DeviceRow) => void
  showSignOutOnCurrent?: boolean
}) {
  return (
    <ul className={styles['rows']}>
      {devices.map((device) => {
        const label = device.label ?? 'Unknown device'
        const showSignOut = !device.current || showSignOutOnCurrent
        return (
          <li key={device.id} className={styles['row']}>
            <div>
              <div className={styles['rowTitleGroup']}>
                <span className={styles['rowTitle']}>{label}</span>
                {/* `EntryRow`'s note, same shape: `.rowTitleGroup`'s flex
                    `gap` is not a character, so without a real space the row
                    announces `Firefox on AndroidTHIS DEVICE`. */}
                {device.current && (
                  <>
                    {' '}
                    <span className={styles['badge']}>THIS DEVICE</span>
                  </>
                )}
              </div>
              <div className={styles['rowMeta']}>{deviceMeta(device)}</div>
            </div>
            {showSignOut && (
              <button
                type="button"
                className={styles['signOut']}
                aria-label={
                  device.current ? 'Sign out this device' : `Sign out ${label}`
                }
                onClick={() => onSelect(device)}
              >
                SIGN OUT
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * **Remote confirm sheet** (boards §12): no `▲` — revoking another Device
 * destroys nothing, it only loses that Device its access at its next sync.
 *
 * **`error`** is the one line the boards do not draw. A revoke is a request,
 * and a request can fail; when it does the Device keeps its access, and a
 * sheet that had already closed would have said the opposite. So the sheet
 * stays up and states it, in the register the screen's own load failure
 * uses (`Devices could not be loaded. Check your connection.`) — fact
 * weight, no `▲`, because nothing was discarded.
 */
export function SignOutRemoteSheet({
  device,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  device: DeviceRow
  busy: boolean
  /** `api.revokeDevice` rejected. The Device still has access, and the
   * sheet is the only thing on screen that can say so. */
  error: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const label = device.label ?? 'Unknown device'

  return (
    <Confirm
      variant="sheet"
      title={`Sign out ${label}?`}
      description="It loses access at its next sync. Everything already synced stays with the household."
      onClose={onCancel}
      actions={
        <>
          {/* Action before Cancel is the boards' own order (§12: "bordered-
              attention 48 `Sign out device` + ghost Cancel"), and Radix gives
              initial focus to the Cancel wherever it sits in the DOM.

              Deliberately **not** a `Confirm.Action`, for the reason
              `SignOutThisDeviceSheet` gives below: that part closes the
              confirm on click, and this decision is not over when it is
              taken — the request is still in flight. `busy` and `error` are
              only ever readable because the sheet is still up saying them.
              It closes from `confirmRemote` once the revoke lands, or from
              the Cancel. */}
          <button
            type="button"
            className={styles['confirmAttention']}
            onClick={onConfirm}
            disabled={busy}
          >
            Sign out device
          </button>
          <Confirm.Cancel>
            <button type="button" className={styles['ghost']} disabled={busy}>
              Cancel
            </button>
          </Confirm.Cancel>
        </>
      }
    >
      {error && (
        <p className={styles['count']}>
          {label} could not be signed out. Check your connection.
        </p>
      )}
    </Confirm>
  )
}

/**
 * **Sign out this Device** (boards §12) — the only auth action that can
 * discard work, and therefore the only one carrying `▲`. The unsynced-count
 * line states the exact count and is omitted entirely at zero: inventing a
 * warning where there is nothing to warn about is the one failure this
 * screen exists to avoid.
 *
 * **`blocked`** carries the same discipline for a second, rarer fact
 * (fix round 1): a second tab of the app can be holding `foerier` open when
 * someone confirms here, in which case the clear this sheet is waiting on
 * cannot finish yet. Genuinely uncommon, but silent otherwise — the confirm
 * button would sit disabled with nothing on screen to explain why, which
 * is worse than the count being omitted at zero. No new register: it is the
 * same `attentionLine`, the same `▲`, stating what is true and nothing more
 * — never a timeout that gives up and claims the data is gone when a
 * blocked delete left it in place.
 */
export function SignOutThisDeviceSheet({
  unsyncedCount,
  blocked,
  error,
  busy,
  onCancel,
  onConfirm,
}: {
  unsyncedCount: number
  /** A second tab of the app is holding `foerier` open, so the delete this
   * sheet is waiting on cannot complete yet — genuinely rare (fix round 1),
   * but silent otherwise: the confirm button would sit disabled with
   * nothing to explain why. */
  blocked: boolean
  /** `clearLocalData` or `onSignedOut` rejected — genuinely rare, and
   * distinct from `blocked`: this is not waiting on anything, it failed.
   * Silent otherwise: the sheet used to close anyway, leaving `stopSync()`
   * already called with nothing on screen to say so (`final-review.md`
   * finding 4). */
  error: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Confirm
      variant="sheet"
      title="Sign out this device?"
      description="Local data is removed from this device. Synced work stays with the household."
      onClose={onCancel}
      actions={
        <>
          {/* Deliberately **not** a `Confirm.Action`: that part closes the
              confirm on click, and this is the one confirm in the app that
              has to outlive its own action. `blocked` and `error` are only
              ever readable because the sheet is still up saying them
              (`final-review.md` finding 4). It closes when the sequence
              finishes, from `confirmThisDevice`, or from the Cancel. */}
          <button
            type="button"
            className={styles['confirmAttention']}
            onClick={onConfirm}
            disabled={busy}
          >
            Sign out and clear
          </button>
          <Confirm.Cancel>
            <button type="button" className={styles['ghost']} disabled={busy}>
              Cancel
            </button>
          </Confirm.Cancel>
        </>
      }
    >
      {unsyncedCount > 0 && (
        <p className={styles['attentionLine']}>
          ▲ {unsyncedCount} changes not yet synced. Signing out clears them.
        </p>
      )}
      {blocked && (
        <p className={styles['attentionLine']}>
          ▲ Another tab has this open. Close it to finish signing out.
        </p>
      )}
      {error && (
        <p className={styles['attentionLine']}>
          ▲ Sign-out did not finish. Sync is stopped on this device — try again.
        </p>
      )}
    </Confirm>
  )
}

export interface UseDeviceSignOutArgs {
  api: AuthApi
  token: string
  /** Ends the App-level session once local data is gone — `useSession`'s
   * `signOut`, threaded down through `App.tsx`. Distinct from
   * `handleUnauthorized`: this path is a deliberate, local choice, not a
   * 401, and it is the one auth action allowed to clear the log.
   *
   * `useSession.signOut` is `async` — typed to allow (not require) a
   * `Promise` and awaited below, so `navigate('/signin')` cannot run before
   * its state update lands (`final-review.md` finding 4: `App.tsx` would
   * otherwise read a stale `session !== null` and bounce straight back). */
  onSignedOut: () => void | Promise<void>
  /** Called once a remote Device is actually revoked, so the caller's own
   * list drops it. */
  onRevoked: (deviceId: string) => void
  /** Injectable for tests; defaults to the real IndexedDB wipe
   * (`depot/wiring.ts`). Takes an `onBlocked` callback so a second tab
   * holding `foerier` open can be surfaced rather than left silent
   * (fix round 1). */
  clearLocalData?: (onBlocked: () => void) => Promise<void>
}

/**
 * The sign-out sequence and both sheets' state, built once
 * (`docs/specs/2026-08-28-auth-device-links-plan.md` Task 10) and shared by
 * the pushed Devices screen and Account's Desktop `DEVICES` card.
 */
export function useDeviceSignOut({
  api,
  token,
  onSignedOut,
  onRevoked,
  clearLocalData = clearLocalDataForReal,
}: UseDeviceSignOutArgs) {
  const [, navigate] = useLocation()
  const readUnsyncedCount = useDepot((depot) => depot.unsyncedCount)
  const stopSync = useDepot((depot) => depot.stopSync)

  const [remoteTarget, setRemoteTarget] = useState<DeviceRow | null>(null)
  const [thisDeviceOpen, setThisDeviceOpen] = useState(false)
  const [unsynced, setUnsynced] = useState(0)
  const [busy, setBusy] = useState(false)
  /** A second tab is holding `foerier` open, so `confirmThisDevice`'s
   * `clearLocalData` call is genuinely stuck waiting rather than merely
   * slow (fix round 1). */
  const [blocked, setBlocked] = useState(false)
  /** `confirmThisDevice` rejected — a genuine `clearLocalData` or
   * `onSignedOut` failure, not the `blocked` case above, which is handled
   * separately. `stopSync()` has already run by the time this can be set, so
   * the sheet stays open saying so rather than closing over a state the
   * person was never told about (`final-review.md` finding 4). */
  const [error, setError] = useState(false)
  /** `confirmRemote` rejected. Kept apart from `error` above because the
   * two sheets are never open together and reset on different openings —
   * and because a remote failure leaves nothing stopped: the Device simply
   * still has access, which the sheet stays up to say. */
  const [remoteError, setRemoteError] = useState(false)

  /**
   * Read the count **before** anything that could end the session — the
   * same ordering `App.tsx`'s `onSignedOut` comment documents for the
   * sign-in screen's session-lost line: ending the session drops the store
   * that can answer the question.
   */
  const openThisDeviceConfirm = useCallback(async () => {
    const count = await readUnsyncedCount().catch((error: unknown) => {
      console.error('devices: the unsynced count could not be read', error)
      return 0
    })
    setUnsynced(count)
    // A fresh sheet never opens already showing a stale block or error left
    // over from a previous, cancelled or failed attempt.
    setBlocked(false)
    setError(false)
    setThisDeviceOpen(true)
  }, [readUnsyncedCount])

  function selectRemote(device: DeviceRow) {
    // A fresh sheet never opens already showing a failure left over from a
    // previous, cancelled attempt — `openThisDeviceConfirm`'s rule.
    setRemoteError(false)
    setRemoteTarget(device)
  }

  function select(device: DeviceRow) {
    if (device.current) void openThisDeviceConfirm()
    else selectRemote(device)
  }

  function cancelRemote() {
    setRemoteTarget(null)
  }

  async function confirmRemote() {
    if (remoteTarget === null) return
    setBusy(true)
    setRemoteError(false)
    try {
      await api.revokeDevice(token, remoteTarget.id)
      onRevoked(remoteTarget.id)
      // The sheet closes here and nowhere else on this path: its confirm is
      // a plain button, not a `Confirm.Action`, so that the request has
      // somewhere to be in flight and somewhere to fail.
      setRemoteTarget(null)
    } catch (caught) {
      // Nothing to roll back — the Device still has access — only something
      // to say. The sheet stays open, busy clears, and the person can retry
      // or cancel, rather than watching it close over a revoke that never
      // happened.
      console.error('devices: could not revoke the device', caught)
      setRemoteError(true)
    } finally {
      setBusy(false)
    }
  }

  function cancelThisDevice() {
    setThisDeviceOpen(false)
  }

  async function confirmThisDevice() {
    setBusy(true)
    setBlocked(false)
    setError(false)
    try {
      // Best effort: revocation needs the network and clearing does not.
      // The app works offline everywhere else; a sign-out that failed for
      // want of signal would be the one place auth blocks a local action.
      // Safe because the token lives in the database `clearLocalData`
      // deletes — an unrevoked server row is inert, and falls out at the
      // one-year sliding expiry or from another Device's revoke.
      await api.signOut(token).catch(() => undefined)
      stopSync()
      // `onBlocked` only ever *reports*; it never resolves this call for
      // it. `clearLocalData` still doesn't return until the delete
      // genuinely completes, however long a second tab makes it wait, so
      // nothing below this line runs — and the session does not end — on a
      // guess (fix round 1: no timeout, no pretending it finished).
      await clearLocalData(() => setBlocked(true))
      // Awaited, not fired-and-forgotten: `useSession.signOut` sets its
      // `session` state only after its own `await store.clear()`, so
      // navigating before this resolves could land `/signin` while
      // `App.tsx` still reads a signed-in session and bounces straight back
      // over a just-deleted database (`final-review.md` finding 4).
      await onSignedOut()
      setThisDeviceOpen(false)
      navigate('/signin')
    } catch (caught) {
      // `stopSync()` above has already run and the server token may already
      // be revoked, so there is nothing left to roll back — only something
      // to say. The sheet stays open, busy clears, and `error` below lets
      // the person retry rather than the finally block silently closing it
      // over an unhandled rejection (`final-review.md` finding 4).
      console.error('devices: could not finish signing out this device', caught)
      setError(true)
    } finally {
      setBusy(false)
      setBlocked(false)
    }
  }

  return {
    remoteTarget,
    thisDeviceOpen,
    unsynced,
    blocked,
    error,
    remoteError,
    busy,
    select,
    openThisDeviceConfirm,
    cancelRemote,
    confirmRemote: () => void confirmRemote(),
    cancelThisDevice,
    confirmThisDevice: () => void confirmThisDevice(),
  }
}

export interface DevicesProps {
  api: AuthApi
  token: string
  onSignedOut: () => void | Promise<void>
  /** Injectable for tests; defaults to the real IndexedDB wipe. */
  clearLocalData?: (onBlocked: () => void) => Promise<void>
}

/**
 * The pushed screen, below Desktop (`docs/design/README.md` §12). At
 * Desktop `App.tsx` redirects `/account/devices` straight back to
 * `/account`, where the same rows and sheets unfold inline into the
 * `DEVICES` card instead — this component is never mounted there.
 */
export function Devices({
  api,
  token,
  onSignedOut,
  clearLocalData,
}: DevicesProps) {
  const sync = useDepot((depot) => depot.sync)
  // `splitPane: false` — `/account/devices` has no two-pane view, and at
  // Desktop it has no render at all: `App.tsx` redirects it to `/account`
  // there, where the same rows unfold into that screen's own card.
  const header = useScreenHeader({ splitPane: false })
  const [devices, setDevices] = useState<readonly DeviceRow[]>([])
  const [devicesStatus, setDevicesStatus] = useState<LoadStatus>('loading')
  const search = useSearch()
  const autoOpenedRef = useRef(false)

  const loadDevices = useCallback(async () => {
    try {
      const { devices: rows } = await api.listDevices(token)
      setDevices(rows)
      setDevicesStatus('loaded')
    } catch (error) {
      console.error('devices: could not load devices', error)
      setDevicesStatus('failed')
    }
  }, [api, token])

  useEffect(() => {
    void loadDevices()
  }, [loadDevices])

  const {
    remoteTarget,
    thisDeviceOpen,
    unsynced,
    blocked,
    error,
    remoteError,
    busy,
    select,
    openThisDeviceConfirm,
    cancelRemote,
    confirmRemote,
    cancelThisDevice,
    confirmThisDevice,
  } = useDeviceSignOut({
    api,
    token,
    onSignedOut,
    onRevoked: (id) =>
      setDevices((rows) => rows.filter((row) => row.id !== id)),
    ...(clearLocalData === undefined ? {} : { clearLocalData }),
  })

  // The Minor Task 9's review left behind: the footer `SIGN OUT` and the
  // `All devices ›` row used to share one href, so there was no way to land
  // directly on this Device's own confirm sheet. `?signout` (set by
  // `Account`'s footer link below Desktop) opens it as soon as the list
  // that names the current Device has loaded.
  useEffect(() => {
    if (autoOpenedRef.current) return
    if (search !== 'signout') return
    autoOpenedRef.current = true
    void openThisDeviceConfirm()
  }, [search, openThisDeviceConfirm])

  return (
    <div className={styles['screen']}>
      {/* `useScreenHeader`'s rule (`frontend-design.md` §3.3), the same one
          People asks one screen along: the back link unless its destination
          is already drawn, the sync line at Split alone — the one mode where
          `AppShell`'s marker is a bare rail dot with no words. */}
      <ScreenBand
        header={header}
        back={{ href: '/account', label: 'ACCOUNT' }}
        sync={sync}
      />

      <h1 className={styles['title']}>Devices</h1>
      <p className={styles['count']}>
        {devicesStatus === 'loading'
          ? 'Loading…'
          : devicesStatus === 'failed'
            ? 'Devices could not be loaded. Check your connection.'
            : `${devices.length} signed in with this login.`}
      </p>

      <DeviceList devices={devices} onSelect={select} />

      <p className={styles['hint']}>
        SIGNING OUT A DEVICE REACHES IT AT ITS NEXT SYNC.
      </p>

      {remoteTarget !== null && (
        <SignOutRemoteSheet
          device={remoteTarget}
          busy={busy}
          error={remoteError}
          onCancel={cancelRemote}
          onConfirm={confirmRemote}
        />
      )}
      {thisDeviceOpen && (
        <SignOutThisDeviceSheet
          unsyncedCount={unsynced}
          blocked={blocked}
          error={error}
          busy={busy}
          onCancel={cancelThisDevice}
          onConfirm={confirmThisDevice}
        />
      )}
    </div>
  )
}
