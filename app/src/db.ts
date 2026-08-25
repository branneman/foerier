import type { IDBPDatabase } from 'idb'

/**
 * The identity and schema of the app's one IndexedDB database — shared by
 * `auth/` (session, pending-first-person) and `depot/` (the op log). Neither
 * feature owns the database; the app does, which is why this lives at the
 * top of `src/` rather than inside either.
 *
 * ## Why every opener must pass the identical, idempotent upgrade
 *
 * IndexedDB only runs the `upgrade` callback belonging to whichever
 * connection happens to be the one that actually crosses the version
 * boundary — not every connection that requests the new version. If each
 * module carried its own upgrade logic, whichever one's `openDB()` call won
 * that race would create only *its* stores, silently stranding whatever the
 * others needed the first time a device upgrades. So this one function
 * builds the **entire** schema, idempotently, and every opener uses it.
 */
export const DB_NAME = 'foerier'

/** Bumped 1 → 2 to add the op log (`depot/opLog.ts`) alongside the
 * pre-existing `auth` store. */
export const DB_VERSION = 2

export const AUTH_STORE = 'auth'
export const OP_STORE = 'op'
export const META_STORE = 'meta'
export const DEAD_LETTER_STORE = 'deadLetter'
export const OP_ID_INDEX = 'op.id'
export const SEQ_INDEX = 'seq'

export function upgradeFoerierDb(database: IDBPDatabase): void {
  if (!database.objectStoreNames.contains(AUTH_STORE)) {
    database.createObjectStore(AUTH_STORE)
  }

  if (!database.objectStoreNames.contains(OP_STORE)) {
    const op = database.createObjectStore(OP_STORE, {
      keyPath: 'lsn',
      autoIncrement: true,
    })
    op.createIndex(OP_ID_INDEX, 'op.id', { unique: true })
    op.createIndex(SEQ_INDEX, 'seq')
  }

  if (!database.objectStoreNames.contains(META_STORE)) {
    database.createObjectStore(META_STORE)
  }

  if (!database.objectStoreNames.contains(DEAD_LETTER_STORE)) {
    database.createObjectStore(DEAD_LETTER_STORE, { keyPath: 'opId' })
  }
}
