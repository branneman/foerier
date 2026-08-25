import { startAuthentication } from '@simplewebauthn/browser'
import { useEffect, useState, type ReactNode } from 'react'
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
import { DepotProvider, type DepotStoreState } from './depot/store'
import { syncLine, syncTone } from './depot/syncLabel'
import { createSessionDepot, type DepotFactory } from './depot/wiring'
import { AddGear } from './screens/AddGear'
import { Depot } from './screens/Depot'
import { GearDetail } from './screens/GearDetail'
import { JoinContainer } from './screens/JoinContainer'
import { SignIn } from './screens/SignIn'
import { AppShell } from './shell/AppShell'
import styles from './shell/AppShell.module.css'

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
 */
function SignedInShell({
  store,
  children,
}: {
  store: StoreApi<DepotStoreState>
  children: ReactNode
}) {
  const sync = useStore(store, (depot) => depot.sync)

  return (
    <AppShell syncLine={syncLine(sync)} syncTone={syncTone(sync)}>
      <DepotProvider value={store}>{children}</DepotProvider>
    </AppShell>
  )
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
  const { session, loading, sessionLost, signIn } = useSession(sessionStore)
  const [, navigate] = useLocation()
  const online = useOnline()
  const [depotStore, setDepotStore] =
    useState<StoreApi<DepotStoreState> | null>(null)

  /**
   * One depot per signed-in session. Building it starts the engine; the
   * cleanup stops it, and the next session gets a fresh one rather than a
   * resumed one — matching `depot/store.ts`'s "a frozen engine is never
   * resumed" rule.
   *
   * Signing out does not clear the local log from here. That is
   * `clearLocalData()`'s job, reached from the Account screen's confirm
   * sheet, and it is deliberately not on the path a 401 takes.
   */
  useEffect(() => {
    if (session === null) {
      setDepotStore(null)
      return
    }

    let cancelled = false
    let built: StoreApi<DepotStoreState> | null = null

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
        <JoinContainer api={api} pending={pendingStore} onSignedIn={signIn} />
      </Route>

      <Route path="/signin">
        {session !== null ? (
          <Redirect to="/" />
        ) : (
          <SignIn
            onSignIn={signInWithPasskey}
            online={online}
            buildSha={BUILD_SHA}
            {...(sessionLost ? { sessionLost: { unsyncedCount: 0 } } : {})}
          />
        )}
      </Route>

      <Route>
        {session === null ? (
          <Redirect to="/signin" />
        ) : depotStore === null ? null : (
          <SignedInShell store={depotStore}>
            <Switch>
              <Route path="/">
                <Depot />
              </Route>
              <Route path="/gear/:id">
                <GearDetail />
              </Route>
              <Route path="/add">
                <AddGear />
              </Route>
              <Route path="/trips">
                <EmptyState title="Trips" line="No trips." />
              </Route>
              <Route path="/find">
                <EmptyState title="Find" line="Nothing to search yet." />
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
