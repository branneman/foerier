import { startAuthentication } from '@simplewebauthn/browser'
import {
  createHlcClock,
  systemClock,
  systemIdSource,
  type OpAuthor,
} from '@foerier/shared'
import { useEffect, useState } from 'react'
import { Redirect, Route, Switch, useLocation } from 'wouter'
import type { StoreApi } from 'zustand/vanilla'

import { createAuthApi, type AuthApi } from './auth/api'
import { BUILD_SHA } from './build'
import {
  indexedDbPendingStore,
  type PendingStore,
} from './auth/pendingFirstPerson'
import {
  indexedDbSessionStore,
  type Session,
  type SessionStore,
} from './auth/sessionStore'
import { useSession } from './auth/useSession'
import { inMemoryOpLog } from './depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from './depot/store'
import { Depot } from './screens/Depot'
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
 * A local, non-persisted engine that never touches the network: nothing
 * before Task 23 wires the real transport from the session, so pretending to
 * sync here would be dishonest. It is a bridge, not a feature — replaced
 * wholesale by the real op log, HLC-restored, transport-backed engine Task 23
 * builds and provides the same way (`docs/specs/2026-08-25-depot-slice-plan.md`
 * Task 23).
 */
const localEngine: EngineFactory = () => ({
  start() {},
  stop() {},
  flush: () => Promise.resolve(),
  pull: () => Promise.resolve(),
  status: () => 'idle',
  bootstrap: () => null,
})

/** One in-memory store per signed-in session — real reducer, real op log,
 * nothing durable and nothing synced yet (see {@link localEngine}). */
function createLocalDepotStore(session: Session): StoreApi<DepotStoreState> {
  const author: OpAuthor = {
    household_id: session.householdId,
    device_id: session.deviceId,
    ids: systemIdSource,
    hlc: createHlcClock(systemClock),
  }
  return createDepotStore({
    log: inMemoryOpLog(),
    engine: localEngine,
    author,
  })
}

/** Offline is normal, and surfaced as one quiet line rather than a dialog. */
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

export interface AppProps {
  api?: AuthApi
  sessionStore?: SessionStore
  pendingStore?: PendingStore
}

export function App({
  api = createAuthApi(),
  sessionStore = indexedDbSessionStore,
  pendingStore = indexedDbPendingStore(),
}: AppProps = {}) {
  const { session, loading, sessionLost, signIn } = useSession(sessionStore)
  const [, navigate] = useLocation()
  const online = useOnline()
  const [depotStore, setDepotStore] =
    useState<StoreApi<DepotStoreState> | null>(null)

  // A fresh store per session — the previous one's engine is stopped, never
  // resumed, matching `depot/store.ts`'s own "a frozen engine is never
  // resumed" rule.
  useEffect(() => {
    if (session === null) {
      setDepotStore(null)
      return
    }
    const store = createLocalDepotStore(session)
    setDepotStore(store)
    return () => store.getState().stopSync()
  }, [session])

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
          <AppShell syncLine={online ? 'Synced' : 'Offline'}>
            <DepotProvider value={depotStore}>
              <Switch>
                <Route path="/">
                  <Depot />
                </Route>
                {/* Tasks 21 and 22's screens. Minimal placeholders here — do
                    not build them as part of this route wiring. */}
                <Route path="/gear/:id">
                  <div className={styles['emptyState']}>
                    <h1>Gear</h1>
                  </div>
                </Route>
                <Route path="/add">
                  <div className={styles['emptyState']}>
                    <h1>Add gear</h1>
                  </div>
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
            </DepotProvider>
          </AppShell>
        )}
      </Route>
    </Switch>
  )
}
