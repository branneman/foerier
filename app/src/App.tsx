import { startAuthentication } from '@simplewebauthn/browser'
import { useEffect, useState } from 'react'
import { Redirect, Route, Switch, useLocation } from 'wouter'

import { createAuthApi, type AuthApi } from './auth/api'
import { BUILD_SHA } from './build'
import {
  indexedDbPendingStore,
  type PendingStore,
} from './auth/pendingFirstPerson'
import { indexedDbSessionStore, type SessionStore } from './auth/sessionStore'
import { useSession } from './auth/useSession'
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
        ) : (
          <AppShell syncLine={online ? 'Synced' : 'Offline'}>
            <Switch>
              <Route path="/">
                <EmptyState title="Depot" line="Nothing recorded yet." />
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
          </AppShell>
        )}
      </Route>
    </Switch>
  )
}
