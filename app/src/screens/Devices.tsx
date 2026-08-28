import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearch } from 'wouter'

import type { AuthApi, DeviceRow } from '../auth/api'
import { useDepot } from '../depot/store'
import { syncLabel, syncTone } from '../depot/syncLabel'
import { clearLocalData as clearLocalDataForReal } from '../depot/wiring'
import styles from './Devices.module.css'

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

/** `LAST SEEN` carries a time (`docs/design/README.md` §12's
 * `2026-08-19 14:32`) — unlike a passkey's `LAST USED`, which only ever
 * needs day granularity. */
function formatDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

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
                {device.current && (
                  <span className={styles['badge']}>THIS DEVICE</span>
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
 */
export function SignOutRemoteSheet({
  device,
  busy,
  onCancel,
  onConfirm,
}: {
  device: DeviceRow | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (device === null) return null
  const label = device.label ?? 'Unknown device'

  return (
    <div
      className={styles['scrim']}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className={styles['sheet']}
        role="alertdialog"
        aria-modal="true"
        aria-label={`Sign out ${label}?`}
      >
        <span className={styles['grabber']} aria-hidden="true" />
        <h2 className={styles['title']}>Sign out {label}?</h2>
        <p className={styles['body']}>
          It loses access at its next sync. Everything already synced stays with
          the household.
        </p>
        <div className={styles['actions']}>
          <button
            type="button"
            className={styles['confirmAttention']}
            onClick={onConfirm}
            disabled={busy}
          >
            Sign out device
          </button>
          <button
            type="button"
            className={styles['ghost']}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
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
  open,
  unsyncedCount,
  blocked,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean
  unsyncedCount: number
  /** A second tab of the app is holding `foerier` open, so the delete this
   * sheet is waiting on cannot complete yet — genuinely rare (fix round 1),
   * but silent otherwise: the confirm button would sit disabled with
   * nothing to explain why. */
  blocked: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!open) return null

  return (
    <div
      className={styles['scrim']}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className={styles['sheet']}
        role="alertdialog"
        aria-modal="true"
        aria-label="Sign out this device?"
      >
        <span className={styles['grabber']} aria-hidden="true" />
        <h2 className={styles['title']}>Sign out this device?</h2>
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
        <p className={styles['body']}>
          Local data is removed from this device. Synced work stays with the
          household.
        </p>
        <div className={styles['actions']}>
          <button
            type="button"
            className={styles['confirmAttention']}
            onClick={onConfirm}
            disabled={busy}
          >
            Sign out and clear
          </button>
          <button
            type="button"
            className={styles['ghost']}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export interface UseDeviceSignOutArgs {
  api: AuthApi
  token: string
  /** Ends the App-level session once local data is gone — `useSession`'s
   * `signOut`, threaded down through `App.tsx`. Distinct from
   * `handleUnauthorized`: this path is a deliberate, local choice, not a
   * 401, and it is the one auth action allowed to clear the log. */
  onSignedOut: () => void
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
    // A fresh sheet never opens already showing a stale block left over
    // from a previous, cancelled attempt.
    setBlocked(false)
    setThisDeviceOpen(true)
  }, [readUnsyncedCount])

  function selectRemote(device: DeviceRow) {
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
    try {
      await api.revokeDevice(token, remoteTarget.id)
      onRevoked(remoteTarget.id)
    } catch (error) {
      console.error('devices: could not revoke the device', error)
    } finally {
      setBusy(false)
      setRemoteTarget(null)
    }
  }

  function cancelThisDevice() {
    setThisDeviceOpen(false)
  }

  async function confirmThisDevice() {
    setBusy(true)
    setBlocked(false)
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
      onSignedOut()
      navigate('/signin')
    } finally {
      setBusy(false)
      setBlocked(false)
      setThisDeviceOpen(false)
    }
  }

  return {
    remoteTarget,
    thisDeviceOpen,
    unsynced,
    blocked,
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
  onSignedOut: () => void
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
  const [devices, setDevices] = useState<readonly DeviceRow[]>([])
  const search = useSearch()
  const autoOpenedRef = useRef(false)

  const loadDevices = useCallback(async () => {
    try {
      const { devices: rows } = await api.listDevices(token)
      setDevices(rows)
    } catch (error) {
      console.error('devices: could not load devices', error)
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
      <header className={styles['header']}>
        <Link href="/account" className={styles['back']}>
          ‹ ACCOUNT
        </Link>
        <span className={styles['sync']}>
          <span
            className={`${styles['syncDot']} ${
              syncTone(sync) === 'unreachable'
                ? styles['syncDotUnreachable']
                : ''
            }`}
            aria-hidden="true"
          />
          {syncLabel(sync)}
        </span>
      </header>

      <h1 className={styles['title']}>Devices</h1>
      <p className={styles['count']}>
        {devices.length} signed in with this login.
      </p>

      <DeviceList devices={devices} onSelect={select} />

      <p className={styles['hint']}>
        SIGNING OUT A DEVICE REACHES IT AT ITS NEXT SYNC.
      </p>

      <SignOutRemoteSheet
        device={remoteTarget}
        busy={busy}
        onCancel={cancelRemote}
        onConfirm={confirmRemote}
      />
      <SignOutThisDeviceSheet
        open={thisDeviceOpen}
        unsyncedCount={unsynced}
        blocked={blocked}
        busy={busy}
        onCancel={cancelThisDevice}
        onConfirm={confirmThisDevice}
      />
    </div>
  )
}
