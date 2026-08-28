import { openDB, type IDBPDatabase } from 'idb'

import { AUTH_STORE, DB_NAME, DB_VERSION, upgradeFoerierDb } from '../db'

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

const SESSION_KEY = 'session'

let dbPromise: Promise<IDBPDatabase> | null = null

// `DB_NAME`/`DB_VERSION`/the upgrade itself come from `../db.ts`, which owns
// the schema for the whole app: every module that opens `foerier` must
// request the same version and pass the same idempotent upgrade, or
// whichever one wins the race to cross the version boundary silently skips
// the stores the others need (see that module's docstring).
//
// This connection is cached and kept open for the app's whole lifetime
// (unlike `depot/opLog.ts`'s per-call `withDb`, which that file's own
// comment explains is deliberate precisely to avoid this) — so it is also
// the one thing standing between "sign out this device" and completing:
// `clearLocalData()` (`depot/wiring.ts`) calls `deleteDB(DB_NAME)`, and
// IndexedDB does not grant a delete while a same-origin connection is still
// open, no matter which tab or which module holds it. Without `blocking`
// here, that delete waits forever — discovered by Tier 5's real-browser
// sign-out journey, which a component test's injected `clearLocalData`
// never exercises. `blocking` fires on *this* connection when another
// wants past it, so it closes and lets the delete through.
function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade: upgradeFoerierDb,
    blocking() {
      const opened = dbPromise
      dbPromise = null
      void opened?.then((database) => database.close())
    },
  })
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
