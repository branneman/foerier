import { openDB, type IDBPDatabase } from 'idb'

import { DB_NAME, DB_VERSION, upgradeFoerierDb } from '../depot/opLog'

/**
 * Where the Device token lives (`auth-design.md` §6.1, §7.4).
 *
 * IndexedDB, in an `auth` store that will sit beside the op log. This is
 * honestly a trade rather than a win: IndexedDB is readable by any JavaScript
 * on the origin, so **an XSS on app.foerier.app means token theft**. The
 * alternative — an httpOnly cookie — is worse *here*, because `app.` → `api.`
 * is cross-origin and the cookie would need `SameSite=None` plus credentialed
 * CORS, reintroducing CSRF to defend against a vector closed by other means.
 *
 * The mitigations relied on instead are structural: a strict CSP with no
 * inline script, zero third-party JavaScript, React's default escaping, and
 * per-Device revocation to bound any theft that does happen.
 */

export interface Session {
  token: string
  loginId: string
  personId: string
  householdId: string
  deviceId: string
}

export interface SessionStore {
  read(): Promise<Session | null>
  write(session: Session): Promise<void>
  clear(): Promise<void>
}

const AUTH_STORE = 'auth'
const SESSION_KEY = 'session'

let dbPromise: Promise<IDBPDatabase> | null = null

// `DB_NAME`/`DB_VERSION`/the upgrade itself come from `depot/opLog.ts`, which
// now owns the schema: every module that opens `foerier` must request the
// same version and pass the same idempotent upgrade, or whichever one wins
// the race to cross the version boundary silently skips the stores the
// others need (see that module's docstring).
function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, { upgrade: upgradeFoerierDb })
  return dbPromise
}

export const indexedDbSessionStore: SessionStore = {
  async read() {
    try {
      return (await (await db()).get(AUTH_STORE, SESSION_KEY)) ?? null
    } catch {
      // A blocked or unavailable IndexedDB means signed out, not broken. The
      // app must still render its shell and say so.
      return null
    }
  },

  async write(session) {
    await (await db()).put(AUTH_STORE, session, SESSION_KEY)
  },

  async clear() {
    await (await db()).delete(AUTH_STORE, SESSION_KEY)
  },
}

/**
 * A real in-memory implementation of the same interface, for tests — not a
 * mocking-framework stub (`docs/testing.md`).
 */
export function inMemorySessionStore(
  initial: Session | null = null,
): SessionStore {
  let current = initial
  return {
    read: () => Promise.resolve(current),
    write: (session) => {
      current = session
      return Promise.resolve()
    },
    clear: () => {
      current = null
      return Promise.resolve()
    },
  }
}
