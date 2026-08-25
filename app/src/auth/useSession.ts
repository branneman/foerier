import { useCallback, useEffect, useState } from 'react'

import type { Session, SessionStore } from './sessionStore'

export interface SessionState {
  session: Session | null
  loading: boolean
  /** Set when a 401 ended the session, so the sign-in screen can say so. */
  sessionLost: boolean
}

export function useSession(store: SessionStore) {
  const [state, setState] = useState<SessionState>({
    session: null,
    loading: true,
    sessionLost: false,
  })

  useEffect(() => {
    let cancelled = false
    void store.read().then((session) => {
      if (!cancelled) setState({ session, loading: false, sessionLost: false })
    })
    return () => {
      cancelled = true
    }
  }, [store])

  const signIn = useCallback(
    async (session: Session) => {
      await store.write(session)
      setState({ session, loading: false, sessionLost: false })
    },
    [store],
  )

  /**
   * The 401 contract (`auth-design.md` §7.2).
   *
   * Marks the session invalid and routes to `/signin` — and **keeps the op log
   * and the outbox untouched**. Queued ops authored offline are the user's
   * work and are not auth's to discard (story 26). They flush after a
   * successful re-sign-in as the same Login.
   *
   * The one case that *does* drop data — signing in as a different Household —
   * belongs to the sign-in path, not here, and warns first.
   */
  const handleUnauthorized = useCallback(async () => {
    await store.clear()
    setState({ session: null, loading: false, sessionLost: true })
  }, [store])

  const signOut = useCallback(async () => {
    await store.clear()
    setState({ session: null, loading: false, sessionLost: false })
  }, [store])

  // `sessionLost` is the boolean from `state`; the callback that SETS it is
  // named differently on purpose — one spread collision here silently
  // replaced a flag the sign-in screen reads with a function.
  return { ...state, signIn, signOut, handleUnauthorized }
}
