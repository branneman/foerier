import { guessDeviceLabel as deviceLabelFromUserAgent } from '@foerier/shared'
import { startRegistration } from '@simplewebauthn/browser'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'wouter'

import type { AuthApi, DeviceRow, PasskeyRow } from '../auth/api'
import { BUILD_SHA } from '../build'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import { DESKTOP, useMediaQuery } from '../shell/useMediaQuery'
import styles from './Account.module.css'
import {
  DeviceList,
  SignOutRemoteSheet,
  SignOutThisDeviceSheet,
  useDeviceSignOut,
} from './Devices'
import { People } from './People'

export interface AccountProps {
  api: AuthApi
  token: string
  /** The Login's `person_id` — the key `useDepot` reads the name through. */
  personId: string
  /** Ends the App-level session — `useSession`'s `signOut`, threaded down
   * through `App.tsx`. Account's own DEVICES card unfolds the same rows and
   * sheets `Devices.tsx` builds (boards §11/§12), so it needs the same
   * callback `Devices` takes as `onSignedOut`. */
  onSignOut: () => void | Promise<void>
  /** Injectable for tests; defaults to the real IndexedDB wipe — see
   * `useDeviceSignOut`'s own doc comment in `Devices.tsx`. */
  clearLocalData?: (onBlocked: () => void) => Promise<void>
}

/* ---- a client-side guess at this device's label (spec §6.5) ---- */

/**
 * A client-side guess like `Firefox on Android`, prefilled into the
 * add-a-passkey name field and editable before the ceremony's result is saved
 * (`docs/specs/2026-08-28-auth-device-links.md` §6.5). Never authoritative —
 * an empty or whitespace label falls back server-side to the real derivation,
 * `deviceLabelFrom` in `api/src/auth/session.ts`.
 *
 * The actual browser/platform table lives in `@foerier/shared`'s
 * `guessDeviceLabel` (imported here as `deviceLabelFromUserAgent`), shared
 * with that server-side derivation so the two surfaces cannot drift apart
 * again the way they already had (`final-review.md` finding 10). This
 * function is only the client's own read of `navigator.userAgent` and its
 * own fallback — an empty string, so the field starts blank rather than
 * claiming a guess it does not have.
 */
function guessDeviceLabel(): string {
  return deviceLabelFromUserAgent(navigator.userAgent) ?? ''
}

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

function isToday(iso: string): boolean {
  return iso.slice(0, 10) === new Date().toISOString().slice(0, 10)
}

function lastUsedLabel(iso: string | null): string {
  if (iso === null) return 'NEVER'
  return isToday(iso) ? 'TODAY' : formatDate(iso)
}

/**
 * Three states, not a boolean: `devices`/`passkeys` initialise to `[]`, and
 * an app whose defining property is that the network is often absent must
 * not read a failed fetch as "0 signed in" — that is a confident, specific,
 * *wrong* statement about the household's security posture, not an empty
 * state (`final-review.md` finding 2). Only `'loaded'` may say "none".
 */
type LoadStatus = 'loading' | 'loaded' | 'failed'

/**
 * Whether this device can hold a platform passkey at all
 * (`docs/design/README.md` §11: the add button "renders only where the
 * device supports passkeys"). Starts `false` — hidden — and stays that way
 * both while the check is pending and where the API is absent entirely; it
 * flips to `true` only once the browser has actually answered yes. Offering
 * the button on a device that cannot honour it is the exact insult this gate
 * exists to avoid.
 */
function usePlatformAuthenticatorAvailable(): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Read as an optional method rather than requiring `PublicKeyCredential`
    // itself to be a constructor: a real browser's is, but what actually
    // matters — here and to any caller — is only whether this one static
    // method exists.
    const check = (
      window.PublicKeyCredential as
        | {
            isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>
          }
        | undefined
    )?.isUserVerifyingPlatformAuthenticatorAvailable
    if (typeof check !== 'function') return

    check()
      .then((result) => {
        if (!cancelled) setAvailable(result)
      })
      .catch(() => {
        // Treated the same as "no" — nothing useful distinguishes a check
        // that failed from one that came back empty-handed.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return available
}

/**
 * The fourth destination (`docs/design/README.md` §11), reached from the
 * avatar rather than a tab. Section order is **frequency order, not
 * alphabetical** — YOU → PASSKEYS → DEVICES → footer — and that order is
 * load-bearing, not cosmetic: it is the same reasoning the boards give for
 * every other ordering decision in this slice.
 *
 * **PEOPLE arrived at S4**, in the slot the board reserves for `PEOPLE &
 * LOGINS`. The rule that kept it out at S3.5 — "an affordance that leads
 * nowhere is worse than a missing one", the same rule that kept the whole
 * `ACCOUNT` affordance out of the shell until then — now argues the other
 * way: it leads to a real screen where People are recorded and renamed.
 *
 * It is titled **`PEOPLE`** rather than the board's `PEOPLE & LOGINS`
 * because that is all it can hold. S5 (story 28) renames it and adds the
 * right column, the login meta line, and the outstanding-invite row; those
 * three obligations are written down in
 * `docs/specs/2026-08-29-people-and-ownership.md` §7.
 *
 * **`Add a passkey on this device` renders only where the device can make
 * one** — gated on {@link usePlatformAuthenticatorAvailable}, hidden while
 * that check is pending and hidden where the API is absent.
 *
 * **The DEVICES and PASSKEYS section anatomy differs only in *what exists*
 * between phone and Desktop**, per `frontend-design.md` §3.2: below Desktop
 * this renders the phone's summary (`N devices signed in.` + an `All
 * devices` row into `/account/devices`); at Desktop the boards draw the
 * summary unfolded into the full list inline, so that is a media query and
 * not a container query — the same rule the shell's own three nav treatments
 * already follow.
 *
 * **`SIGN OUT` in the footer, and the DEVICES card's own rows, are built
 * once and reused, not redrawn here.** `Devices.tsx` (Task 10) owns the two
 * confirm sheets, the per-row `SIGN OUT`, and the sign-out sequence
 * (`api.signOut`, `clearLocalData`, `unsyncedCount`) as
 * {@link useDeviceSignOut} and {@link DeviceList}; this screen only renders
 * them. Below Desktop, the footer stays a doorway to the pushed Devices
 * screen — boards §12 draws both sheets there, over the full list. At
 * Desktop that screen is a dead end (`App.tsx` redirects `/account/devices`
 * straight back here), so boards §11's unfolded DEVICES card renders the
 * same sheets inline instead, and the footer opens "sign out this device"
 * directly rather than navigating anywhere.
 */
export function Account({
  api,
  token,
  personId,
  onSignOut,
  clearLocalData,
}: AccountProps) {
  const peopleCount = useDepot(
    (depot) => Object.keys(depot.state.people).length,
  )
  const personName = useDepot(
    (depot) => depot.state.people[personId]?.name?.value ?? null,
  )
  const sync = useDepot((depot) => depot.sync)
  const isDesktop = useMediaQuery(DESKTOP)
  const canAddPasskey = usePlatformAuthenticatorAvailable()

  const [householdName, setHouseholdName] = useState<string | null>(null)
  const [passkeys, setPasskeys] = useState<readonly PasskeyRow[]>([])
  const [passkeysStatus, setPasskeysStatus] = useState<LoadStatus>('loading')
  const [devices, setDevices] = useState<readonly DeviceRow[]>([])
  const [devicesStatus, setDevicesStatus] = useState<LoadStatus>('loading')
  const [addingPasskey, setAddingPasskey] = useState(false)
  const [passkeyLabel, setPasskeyLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const {
    remoteTarget,
    thisDeviceOpen,
    unsynced,
    blocked,
    error: signOutError,
    busy: signOutBusy,
    select: selectDevice,
    openThisDeviceConfirm,
    cancelRemote,
    confirmRemote,
    cancelThisDevice,
    confirmThisDevice,
  } = useDeviceSignOut({
    api,
    token,
    onSignedOut: onSignOut,
    onRevoked: (id) =>
      setDevices((rows) => rows.filter((row) => row.id !== id)),
    ...(clearLocalData === undefined ? {} : { clearLocalData }),
  })

  useEffect(() => {
    let cancelled = false
    void api
      .me(token)
      .then((me) => {
        if (!cancelled) setHouseholdName(me.household_name)
      })
      .catch((error: unknown) => {
        console.error('account: could not load /auth/me', error)
      })
    return () => {
      cancelled = true
    }
  }, [api, token])

  const loadPasskeys = useCallback(async () => {
    try {
      const { passkeys: rows } = await api.listPasskeys(token)
      setPasskeys(rows)
      setPasskeysStatus('loaded')
    } catch (error) {
      console.error('account: could not load passkeys', error)
      setPasskeysStatus('failed')
    }
  }, [api, token])

  useEffect(() => {
    void loadPasskeys()
  }, [loadPasskeys])

  useEffect(() => {
    let cancelled = false
    void api
      .listDevices(token)
      .then(({ devices: rows }) => {
        if (!cancelled) {
          setDevices(rows)
          setDevicesStatus('loaded')
        }
      })
      .catch((error: unknown) => {
        console.error('account: could not load devices', error)
        if (!cancelled) setDevicesStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [api, token])

  function openAddPasskey() {
    setPasskeyLabel(guessDeviceLabel())
    setAddingPasskey(true)
  }

  async function saveNewPasskey() {
    setBusy(true)
    try {
      const options = await api.addPasskeyOptions(token)
      // The OS passkey sheet is an external surface, recreated nowhere here
      // (the same rule sign-in and join already follow).
      const response = await startRegistration({ optionsJSON: options })
      await api.addPasskeyVerify(token, response, passkeyLabel)
      setAddingPasskey(false)
      setPasskeyLabel('')
      await loadPasskeys()
    } catch (error) {
      console.error('account: could not add a passkey', error)
    } finally {
      setBusy(false)
    }
  }

  async function removePasskey(id: string) {
    try {
      await api.removePasskey(token, id)
      await loadPasskeys()
    } catch (error) {
      console.error('account: could not remove passkey', error)
    }
  }

  const initial =
    personName === null || personName.trim() === ''
      ? ''
      : personName.trim().charAt(0).toUpperCase()
  const householdLabel =
    householdName === null ? '' : `${householdName.toUpperCase()} HOUSEHOLD`
  const currentDevice = devices.find((device) => device.current)

  return (
    <div className={styles['screen']}>
      {/* Below Desktop this is a pushed screen off Depot; at Desktop the
          216px sidebar is already the nav, so no back link or sync line
          repeats here (`docs/design/README.md` §11). */}
      {!isDesktop && (
        <header className={styles['header']}>
          <Link href="/" className={styles['back']}>
            ‹ DEPOT
          </Link>
          <span className={styles['sync']}>
            <span className={styles['syncDot']} aria-hidden="true" />
            {syncLabel(sync)}
          </span>
        </header>
      )}

      {isDesktop ? (
        <div className={styles['titleRow']}>
          <h1 className={styles['title']}>Account</h1>
          <div className={styles['who']} data-testid="account-who">
            <span className={styles['whoName']}>{personName}</span>
            <span className={styles['whoHousehold']}>{householdLabel}</span>
          </div>
        </div>
      ) : (
        <>
          <h1 className={styles['title']}>Account</h1>
          <div className={styles['you']} data-testid="account-who">
            <span className={styles['avatar']} aria-hidden="true">
              {initial}
            </span>
            <div>
              <div className={styles['youName']}>{personName}</div>
              <div className={styles['youHousehold']}>{householdLabel}</div>
            </div>
          </div>
        </>
      )}

      <div className={isDesktop ? styles['cardsGrid'] : styles['sections']}>
        <section className={isDesktop ? styles['card'] : styles['section']}>
          <div className={styles['sectionHead']}>
            <span className={styles['sectionLabel']}>PASSKEYS</span>
            {passkeys.length > 0 && (
              <span className={styles['sectionCount']}>{passkeys.length}</span>
            )}
          </div>

          {passkeysStatus === 'loading' ? (
            // Not "None on this login" — that is a fact this screen does
            // not have yet (`final-review.md` finding 2).
            <p className={styles['nudgeLine']}>Loading…</p>
          ) : passkeysStatus === 'failed' ? (
            <p className={styles['nudgeLine']}>
              Passkeys could not be loaded. Check your connection.
            </p>
          ) : passkeys.length === 0 ? (
            <>
              <p className={styles['nudgeLine']}>None on this login.</p>
              <p className={styles['nudgeBody']}>
                Until one exists, a new device signs in with a device link.
              </p>
            </>
          ) : (
            <ul className={styles['rows']}>
              {passkeys.map((passkey) => (
                <li key={passkey.id} className={styles['row']}>
                  <div>
                    <div className={styles['rowTitle']}>
                      {passkey.label ?? 'Unnamed passkey'}
                    </div>
                    <div className={styles['rowMeta']}>
                      ADDED {formatDate(passkey.created_at)} · LAST USED{' '}
                      {lastUsedLabel(passkey.last_used_at)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles['remove']}
                    onClick={() => void removePasskey(passkey.id)}
                  >
                    REMOVE
                  </button>
                </li>
              ))}
            </ul>
          )}

          {addingPasskey ? (
            <div className={styles['addForm']}>
              <label className={styles['field']}>
                <span className={styles['fieldLabel']}>Passkey name</span>
                <input
                  className={styles['input']}
                  value={passkeyLabel}
                  onChange={(event) => setPasskeyLabel(event.target.value)}
                  autoFocus
                />
              </label>
              <div className={styles['addActions']}>
                <button
                  type="button"
                  className={styles['primary']}
                  onClick={() => void saveNewPasskey()}
                  disabled={busy}
                >
                  Save passkey
                </button>
                <button
                  type="button"
                  className={styles['ghost']}
                  onClick={() => setAddingPasskey(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            canAddPasskey && (
              <button
                type="button"
                className={styles['bordered']}
                onClick={openAddPasskey}
              >
                Add a passkey on this device
              </button>
            )
          )}
        </section>

        <section className={isDesktop ? styles['card'] : styles['section']}>
          <div className={styles['sectionHead']}>
            <span className={styles['sectionLabel']}>DEVICES</span>
            {isDesktop && devices.length > 0 && (
              <span className={styles['sectionCount']}>
                {devices.length} SIGNED IN
              </span>
            )}
          </div>

          {isDesktop ? (
            devicesStatus === 'failed' ? (
              <p className={styles['nudgeLine']}>
                Devices could not be loaded. Check your connection.
              </p>
            ) : (
              // The current Device's own row carries no per-row `SIGN OUT`
              // here — boards §11's desktop frame draws none, because the
              // footer below already reaches it (`showSignOutOnCurrent`
              // false is the one anatomy difference the boards draw between
              // this card and the pushed Devices screen).
              <DeviceList
                devices={devices}
                onSelect={selectDevice}
                showSignOutOnCurrent={false}
              />
            )
          ) : (
            <>
              <p className={styles['summaryLine']}>
                {devicesStatus === 'loading'
                  ? 'Loading…'
                  : devicesStatus === 'failed'
                    ? 'Devices could not be loaded. Check your connection.'
                    : `${devices.length} devices signed in.`}
              </p>
              <Link href="/account/devices" className={styles['row']}>
                <div>
                  <div className={styles['rowTitle']}>All devices</div>
                  <div className={styles['rowMeta']}>
                    THIS ONE:{' '}
                    {(currentDevice?.label ?? 'THIS DEVICE').toUpperCase()}
                  </div>
                </div>
                <span className={styles['chevron']} aria-hidden="true">
                  ›
                </span>
              </Link>
            </>
          )}

          <Link href="/account/device-link" className={styles['bordered']}>
            Sign in on another device
          </Link>
        </section>
      </div>

      <section className={isDesktop ? styles['card'] : styles['section']}>
        <div className={styles['sectionHead']}>
          {/* `PEOPLE`, not the board's `PEOPLE & LOGINS`: S5 adds the second
              half and renames it then. */}
          <span className={styles['sectionLabel']}>PEOPLE</span>
        </div>

        {isDesktop ? (
          // The board draws desktop with the summary rows unfolded — "all
          // three people inline". A media query, because it decides which
          // elements exist (`frontend-design.md` §3.2).
          <People personId={personId} variant="inline" />
        ) : (
          <Link href="/account/people" className={styles['row']}>
            <div>
              <div className={styles['rowTitle']}>People</div>
              <div className={styles['rowMeta']}>
                {peopleCount} {peopleCount === 1 ? 'PERSON' : 'PEOPLE'}
              </div>
            </div>
            <span className={styles['chevron']} aria-hidden="true">
              ›
            </span>
          </Link>
        )}
      </section>

      <footer className={styles['footer']}>
        {isDesktop ? (
          // `/account/devices` redirects straight back here at Desktop
          // (`App.tsx`), so this opens "sign out this device" in place
          // rather than navigating anywhere.
          <button
            type="button"
            className={styles['signOut']}
            onClick={() => void openThisDeviceConfirm()}
          >
            SIGN OUT
          </button>
        ) : (
          // `?signout` (read by `Devices.tsx`) lands directly on this
          // Device's own confirm sheet, rather than sharing a plain href
          // with the `All devices ›` row above and costing an extra tap.
          <Link href="/account/devices?signout" className={styles['signOut']}>
            SIGN OUT
          </Link>
        )}
        <span className={styles['build']}>
          BUILD {BUILD_SHA.slice(0, 7).toUpperCase()}
        </span>
      </footer>

      {remoteTarget !== null && (
        <SignOutRemoteSheet
          device={remoteTarget}
          busy={signOutBusy}
          onCancel={cancelRemote}
          onConfirm={confirmRemote}
        />
      )}
      {thisDeviceOpen && (
        <SignOutThisDeviceSheet
          unsyncedCount={unsynced}
          blocked={blocked}
          error={signOutError}
          busy={signOutBusy}
          onCancel={cancelThisDevice}
          onConfirm={confirmThisDevice}
        />
      )}
    </div>
  )
}
