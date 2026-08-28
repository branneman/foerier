import { personRecorded, type OpSpec } from '@foerier/shared'
import { openDB } from 'idb'

import { AUTH_STORE, DB_NAME, DB_VERSION, upgradeFoerierDb } from '../db'

/**
 * The Household's **first op**, and the record that keeps the joiner's name
 * safe until it can be authored.
 *
 * `auth-design.md` §3.4 step 2:
 *
 *   > Onboarding asks the joiner their name and emits the `person.create` op
 *   > **with that exact id**, as the Household's first op.
 *
 * (The op is called **`person.recorded`**. The MVP catalogue in
 * `sync-protocol.md` §4.2 is authoritative and auth-design's prose predates
 * it.)
 *
 * ## Why the name is persisted rather than emitted on the spot
 *
 * Joining and authoring are two different moments. The joiner may close the
 * tab between naming themselves and the depot store existing — the store is
 * built from the session, which the join flow has only just written — and
 * re-typing their name is not something to ask of them. So the join screen
 * saves `{personId, householdId, name}` here, and
 * {@link flushPendingFirstPerson} authors the op once there is a store to
 * author it through.
 *
 * ## Why the id must be the Invite's, never a fresh one
 *
 * The Invite pre-bound a `person_id` and the Login already points at it. Mint
 * a new id here and that Login points at a Person nobody ever created —
 * permanently, because ids are never rewritten. Using the pre-bound id is
 * what makes "a Login is always a Person" true from the Household's very
 * first second.
 *
 * ## Why the record is cleared after the *append*, not after a push
 *
 * The local op log is the source of truth (`sync-protocol.md` §7.5); a push
 * is a later, retryable event that may not happen for days on a device that
 * joined offline. Waiting for it would risk emitting the op twice, and
 * clearing before the append would risk losing the name entirely. So the
 * clear waits on exactly one thing: the op being durably in the log.
 */

export interface PendingFirstPerson {
  /** The Invite's pre-bound Person id. Never regenerate this. */
  personId: string
  householdId: string
  /** Exactly as the joiner typed it. */
  name: string
}

const KEY = 'pendingFirstPerson'

/**
 * Persisted rather than held in memory, for the reason in this module's
 * docstring: the joiner may close the tab between naming themselves and the
 * depot store existing.
 */
export interface PendingStore {
  save(pending: PendingFirstPerson): Promise<void>
  read(): Promise<PendingFirstPerson | null>
  clear(): Promise<void>
}

export const PENDING_KEY = KEY

/**
 * Backed by the same IndexedDB database the session uses. There is no separate
 * lifetime to manage, and a local wipe should take both.
 */
export function indexedDbPendingStore(): PendingStore {
  // Same `DB_NAME`/`DB_VERSION`/upgrade as `sessionStore.ts` and
  // `depot/opLog.ts` — see `../db.ts`'s docstring for why every opener of
  // `foerier` must pass the identical, idempotent upgrade rather than its own.
  //
  // Opened and closed per call, same as `opLog.ts`'s own `withDb` and for
  // the reason its comment gives: a connection left open here is exactly
  // what would block `clearLocalData()`'s `deleteDB(DB_NAME)` (sign-out
  // this device) from ever completing.
  async function withDb<T>(
    fn: (db: Awaited<ReturnType<typeof openDB>>) => Promise<T>,
  ): Promise<T> {
    const database = await openDB(DB_NAME, DB_VERSION, {
      upgrade: upgradeFoerierDb,
    })
    try {
      return await fn(database)
    } finally {
      database.close()
    }
  }

  return {
    async save(pending) {
      await withDb((db) => db.put(AUTH_STORE, pending, KEY))
    },
    async read() {
      try {
        return (await withDb((db) => db.get(AUTH_STORE, KEY))) ?? null
      } catch {
        return null
      }
    },
    async clear() {
      await withDb((db) => db.delete(AUTH_STORE, KEY))
    },
  }
}

/** A real in-memory implementation of the same interface, for tests. */
export function inMemoryPendingStore(
  initial: PendingFirstPerson | null = null,
): PendingStore {
  let current = initial
  return {
    save: (pending) => {
      current = pending
      return Promise.resolve()
    },
    read: () => Promise.resolve(current),
    clear: () => {
      current = null
      return Promise.resolve()
    },
  }
}

/**
 * The one call {@link flushPendingFirstPerson} needs from the depot store,
 * named as an interface so `auth/` does not depend on `depot/`.
 *
 * The store's ordinary `emit` is fire-and-forget and reports nothing, and a
 * queue-drain signal is not good enough here: it resolves just as readily
 * after an append that *failed*, and acting on that would clear the joiner's
 * name with no `person.recorded` anywhere. So this is the per-op handshake —
 * it resolves only when this op is in the log, and rejects when it is not.
 */
export interface OpEmitter {
  emitDurable(spec: OpSpec): Promise<void>
}

/**
 * Emits the Household's first `person.recorded`, with the Invite's pre-bound
 * Person id, and clears the pending record once the op is in the log.
 *
 * Idempotent: the pending record is the flush's own key, so a second run
 * after a successful one emits nothing. `pending` is what the caller read
 * from `store` — passed in rather than re-derived so the caller can decide
 * there is nothing to do without paying for a store read — and the store is
 * consulted again here only to answer whether the op is still owed.
 *
 * An append that fails leaves the record exactly where it was, so the next
 * run retries it. Returns whether the op reached the log.
 */
export async function flushPendingFirstPerson(
  pending: PendingFirstPerson | null,
  emitter: OpEmitter,
  store: PendingStore,
): Promise<boolean> {
  if (pending === null) return false
  // Already flushed by an earlier run, on this device, for this join.
  if ((await store.read()) === null) return false

  try {
    // Durable first. Only the append may license the clear.
    await emitter.emitDurable(personRecorded(pending.personId, pending.name))
  } catch (error) {
    // The op is not in the log, so the name is still the only copy of
    // something that cannot be re-derived. Keep it and let the caller retry.
    console.error('auth: the first person op could not be authored', error)
    return false
  }

  await store.clear()
  return true
}
