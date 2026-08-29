import { startAuthentication } from '@simplewebauthn/browser'
import { depotCounts, visibleTrips } from '@foerier/shared'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Redirect, Route, Switch, useLocation } from 'wouter'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'

import { createAuthApi, type AuthApi } from './auth/api'
import { BUILD_SHA } from './build'
import {
  flushPendingFirstPerson,
  indexedDbPendingStore,
  type PendingStore,
} from './auth/pendingFirstPerson'
import { indexedDbSessionStore, type SessionStore } from './auth/sessionStore'
import { useSession } from './auth/useSession'
import { FirstSync } from './components/FirstSync'
import { DepotProvider, type DepotStoreState } from './depot/store'
import { syncLine, syncTone } from './depot/syncLabel'
import { createSessionDepot, type DepotFactory } from './depot/wiring'
import { DepotView } from './shell/DepotView'
import { Account } from './screens/Account'
import { AddGear } from './screens/AddGear'
import { InviteIssued } from './screens/InviteIssued'
import { Devices } from './screens/Devices'
import { People } from './screens/People'
import { Find } from './screens/Find'
import { JoinContainer } from './screens/JoinContainer'
import { SignIn } from './screens/SignIn'
import { NewTrip } from './screens/NewTrip'
import { Trip } from './screens/Trip'
import { Trips } from './screens/Trips'
import { AppShell } from './shell/AppShell'
import styles from './shell/AppShell.module.css'
import { DESKTOP, useMediaQuery } from './shell/useMediaQuery'

/**
 * Ask the browser not to evict us.
 *
 * It matters more from S3.5 on than it did before: a Device with no passkey
 * **cannot re-sign-in by itself** — lose the database and you lose the token,
 * and the way back is another Device's link. It protects the op log too, which
 * is the larger prize; the same eviction takes unsynced work with it.
 *
 * Best effort by design. An installed PWA on Android is generally granted this
 * automatically and a plain tab generally is not, and there is nothing useful
 * to tell the user either way.
 */
function requestPersistentStorage(): void {
  void navigator.storage?.persist?.().catch(() => undefined)
}

function EmptyState({ title, line }: { title: string; line: string }) {
  return (
    <div className={styles['emptyState']}>
      <h1>{title}</h1>
      <p>{line}</p>
    </div>
  )
}

/**
 * The shell, subscribed to the one thing above the routes that changes: the
 * engine's status. A separate component because the store only exists once
 * there is a session, and a hook cannot be conditional.
 *
 * It is also where the **401 contract** ([auth-design §7.2](auth-design.md))
 * is enforced. A 401 freezes the engine and reports `signed-out`; that is the
 * app's only signal that the Device's token is gone, and without acting on it
 * the depot would sit frozen forever with no route back — `/signin` redirects
 * away while a session exists. So the status is what calls
 * `handleUnauthorized`, which marks the session invalid and routes to
 * `/signin`, **keeping the op log and the outbox untouched**: queued offline
 * work is the Quartermaster's, and auth's to leave alone (story 26).
 */
function SignedInShell({
  store,
  personId,
  onSignedOut,
  children,
}: {
  store: StoreApi<DepotStoreState>
  personId: string
  onSignedOut: (store: StoreApi<DepotStoreState>) => void
  children: ReactNode
}) {
  const sync = useStore(store, (depot) => depot.sync)
  const bootstrap = useStore(store, (depot) => depot.bootstrap)
  const counts = useDestinationCounts(store)
  const accountInitial = useAccountInitial(store, personId)

  useEffect(() => {
    if (sync === 'signed-out') onSignedOut(store)
  }, [sync, store, onSignedOut])

  // A Device that has never pulled folds the household's whole op log before
  // it can show anything (`sync-protocol.md` §7.6), so the fold comes *ahead*
  // of the shell rather than inside it — there is nothing to navigate to yet.
  // Keyed off the engine's progress, never `sync`: the status cannot know a
  // pull is a bootstrap until the first page carries `household_seq`.
  if (bootstrap !== null) {
    return (
      <DepotProvider value={store}>
        <FirstSync variant="screen" />
      </DepotProvider>
    )
  }

  return (
    <AppShell
      syncLine={syncLine(sync)}
      syncTone={syncTone(sync)}
      counts={counts}
      accountInitial={accountInitial}
    >
      <DepotProvider value={store}>{children}</DepotProvider>
    </AppShell>
  )
}

/**
 * The counts the desktop sidebar draws beside each destination
 * (`Screens A` §02's SIDEBAR ANATOMY: `DEPOT 128 · TRIPS 3 · FIND` none).
 *
 * **A destination's count is the size of the list it opens.** So `/trips`
 * counts every non-deleted Trip — `visibleTrips`, which is the very list the
 * Trips screen partitions — and not the active ones: a household with a year
 * of finished trips behind it would otherwise read `TRIPS 0` while the row
 * opens onto a full ledger. Closed Trips are on that screen, so they are in
 * this number.
 *
 * `/find` still carries no entry, and never will: it answers a question, it
 * does not hold a collection.
 *
 * Read here rather than inside `AppShell` because the shell is rendered
 * *outside* the `DepotProvider` — deliberately, so the nav does not depend on
 * a store the signed-out shell has never had.
 */
function useDestinationCounts(
  store: StoreApi<DepotStoreState>,
): Readonly<Partial<Record<string, number>>> {
  const state = useStore(store, (depot) => depot.state)
  // Both memoed on the fold rather than recomputed on every sync tick:
  // `depotCounts` sorts the whole depot, and `visibleTrips` sorts every Trip.
  const gear = useMemo(() => depotCounts(state).gear, [state])
  const trips = useMemo(() => visibleTrips(state).length, [state])
  return { '/': gear, '/trips': trips }
}

/**
 * The letter in the avatar (`docs/design/README.md` §11).
 *
 * Read here rather than inside `AppShell` for the same reason the counts are:
 * the shell renders *outside* `DepotProvider`, deliberately, so the nav never
 * depends on a store the signed-out shell has never had.
 *
 * Null rather than a placeholder when the Person is not folded yet — a Login
 * can point at a `person_id` no op has created (`auth-design.md` §2.1), and an
 * invented letter is worse than an empty circle.
 */
function useAccountInitial(
  store: StoreApi<DepotStoreState>,
  personId: string,
): string | null {
  const state = useStore(store, (depot) => depot.state)
  const name = state.people[personId]?.name?.value
  return name === undefined || name === null || name === ''
    ? null
    : name.trim().charAt(0).toUpperCase()
}

/** Offline is normal, and surfaced as one quiet line rather than a dialog.
 * Used only by the sign-in screen, which genuinely cannot proceed without a
 * connection; the depot's own header reads the engine, not the radio. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}

/**
 * Module-level rather than a default argument: a default argument is
 * re-evaluated on every render, and a store identity that changes every
 * render is a store no effect can depend on.
 */
const defaultPendingStore = indexedDbPendingStore()

export interface AppProps {
  api?: AuthApi
  sessionStore?: SessionStore
  pendingStore?: PendingStore
  createDepot?: DepotFactory
}

export function App({
  api = createAuthApi(),
  sessionStore = indexedDbSessionStore,
  pendingStore = defaultPendingStore,
  createDepot = createSessionDepot,
}: AppProps = {}) {
  const { session, loading, sessionLost, signIn, signOut, handleUnauthorized } =
    useSession(sessionStore)
  const [, navigate] = useLocation()
  const online = useOnline()
  const isDesktop = useMediaQuery(DESKTOP)
  const [depotStore, setDepotStore] =
    useState<StoreApi<DepotStoreState> | null>(null)
  const [unsyncedCount, setUnsyncedCount] = useState(0)

  /**
   * Read the count **before** the session goes, because ending the session
   * drops the store that can answer the question. It is the whole reassurance
   * of the sign-in screen's session-lost line: the work is on the device and
   * flushes after the next sign-in, and saying so needs a real number.
   */
  const onSignedOut = useCallback(
    (store: StoreApi<DepotStoreState>) => {
      void store
        .getState()
        .unsyncedCount()
        .catch((error: unknown) => {
          console.error('depot: the unsynced count could not be read', error)
          return 0
        })
        .then(async (count) => {
          setUnsyncedCount(count)
          await handleUnauthorized()
        })
    },
    [handleUnauthorized],
  )

  /**
   * One depot per signed-in session. Building it starts the engine; the
   * cleanup stops it, and the next session gets a fresh one rather than a
   * resumed one — matching `depot/store.ts`'s "a frozen engine is never
   * resumed" rule.
   *
   * Signing out does not clear the local log from here. That is
   * `clearLocalData()`'s job, reached from the Devices screen's "sign out
   * this device" confirm sheet (boards §12), and it is deliberately not on
   * the path a 401 takes.
   */
  useEffect(() => {
    if (session === null) {
      setDepotStore(null)
      return
    }

    let cancelled = false
    let built: StoreApi<DepotStoreState> | null = null

    requestPersistentStorage()

    void createDepot(session)
      .then(async (store) => {
        built = store
        if (cancelled) {
          store.getState().stopSync()
          return
        }
        setDepotStore(store)

        // The joiner's name has been waiting for a store to author it
        // through since the moment they typed it. This is that moment — and
        // it is idempotent, so a second pass emits nothing.
        const pending = await pendingStore.read()
        if (pending !== null && !cancelled) {
          await flushPendingFirstPerson(pending, store.getState(), pendingStore)
        }
      })
      .catch((error: unknown) => {
        console.error('depot: the session store could not be built', error)
      })

    return () => {
      cancelled = true
      built?.getState().stopSync()
    }
  }, [session, createDepot, pendingStore])

  async function signInWithPasskey() {
    const options = await api.loginOptions()
    // The OS passkey sheet, including the browser's own cross-device QR flow,
    // is an external surface. Nothing of it is recreated here.
    const assertion = await startAuthentication({ optionsJSON: options })
    const result = await api.loginVerify(assertion)

    await signIn({
      token: result.token,
      loginId: result.login_id,
      personId: result.person_id,
      householdId: result.household_id,
      deviceId: result.device_id,
    })
    navigate('/')
  }

  // Auth never gates local work, but it does gate the shell before there is
  // any local work to do. Rendering nothing beats flashing the sign-in screen
  // at someone who is already signed in.
  if (loading) return null

  return (
    <Switch>
      <Route path="/join">
        {/* The depot is handed down so the success frame's first-sync card
            can read the engine. It does not exist until the Device has a
            session, which is why `JoinContainer` takes it as nullable. */}
        <JoinContainer
          api={api}
          pending={pendingStore}
          onSignedIn={signIn}
          depot={depotStore}
        />
      </Route>

      <Route path="/signin">
        {session !== null ? (
          <Redirect to="/" />
        ) : (
          <SignIn
            onSignIn={signInWithPasskey}
            online={online}
            buildSha={BUILD_SHA}
            {...(sessionLost ? { sessionLost: { unsyncedCount } } : {})}
          />
        )}
      </Route>

      <Route>
        {session === null ? (
          <Redirect to="/signin" />
        ) : depotStore === null ? null : (
          <SignedInShell
            store={depotStore}
            personId={session.personId}
            onSignedOut={onSignedOut}
          >
            <Switch>
              {/* One view for both routes: below Split it renders whichever
                  screen the route names, and at Split it renders the list and
                  the detail side by side (`shell/DepotView.tsx`). */}
              <Route path="/">
                <DepotView />
              </Route>
              <Route path="/gear/:id">
                <DepotView />
              </Route>
              <Route path="/add">
                <AddGear />
              </Route>
              {/* `/trips/new` **before** `/trips/:id`: wouter's `Switch`
                  renders the first match, so with the parameterised route
                  first, `new` is read as a Trip id and F3's first step
                  becomes `No such trip.` */}
              <Route path="/trips">
                <Trips />
              </Route>
              <Route path="/trips/new">
                <NewTrip />
              </Route>
              <Route path="/trips/:id">
                <Trip />
              </Route>
              <Route path="/find">
                <Find />
              </Route>
              <Route path="/account">
                <Account
                  api={api}
                  token={session.token}
                  personId={session.personId}
                  onSignOut={signOut}
                />
              </Route>
              <Route path="/account/device-link">
                <InviteIssued
                  api={api}
                  token={session.token}
                  personId={session.personId}
                  subjectPersonId={session.personId}
                  purpose="device"
                />
              </Route>
              <Route path="/account/devices">
                {isDesktop ? (
                  // The board unfolds the full list inline into Account's
                  // own DEVICES card at Desktop (§11) — the same rows, the
                  // same sheets, reached from there instead.
                  <Redirect to="/account" />
                ) : (
                  <Devices
                    api={api}
                    token={session.token}
                    onSignedOut={signOut}
                  />
                )}
              </Route>
              <Route path="/account/people">
                {isDesktop ? (
                  // The board unfolds "all three people inline" into
                  // Account's own PEOPLE card at Desktop (§11) — the same
                  // rows, reached from there instead. Exactly the redirect
                  // `/account/devices` above already takes, for the same
                  // reason: a media query decides what *exists*.
                  <Redirect to="/account" />
                ) : (
                  <People
                    api={api}
                    token={session.token}
                    personId={session.personId}
                  />
                )}
              </Route>
              <Route path="/account/people/:personId/invite">
                {(params) => (
                  <InviteIssued
                    api={api}
                    token={session.token}
                    personId={session.personId}
                    subjectPersonId={params.personId}
                    purpose="join"
                  />
                )}
              </Route>
              <Route path="/account/people/:personId/device-link">
                {(params) => (
                  <InviteIssued
                    api={api}
                    token={session.token}
                    personId={session.personId}
                    subjectPersonId={params.personId}
                    purpose="device"
                  />
                )}
              </Route>
              <Route>
                <EmptyState title="Not found." line="No such page." />
              </Route>
            </Switch>
          </SignedInShell>
        )}
      </Route>
    </Switch>
  )
}
