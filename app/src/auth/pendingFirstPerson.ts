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
  const open = () => openDB(DB_NAME, DB_VERSION, { upgrade: upgradeFoerierDb })

  return {
    async save(pending) {
      await (await open()).put(AUTH_STORE, pending, KEY)
    },
    async read() {
      try {
        return (await (await open()).get(AUTH_STORE, KEY)) ?? null
      } catch {
        return null
      }
    },
    async clear() {
      await (await open()).delete(AUTH_STORE, KEY)
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
 * The two calls {@link flushPendingFirstPerson} needs from the depot store,
 * named as an interface so `auth/` does not depend on `depot/`: `emit` is
 * fire-and-forget by design, so the durability handshake is `settled()`.
 */
export interface OpEmitter {
  emit(spec: OpSpec): void
  /** Resolves once every op emitted so far is durably in the local log. */
  settled(): Promise<void>
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
 * Returns whether it emitted.
 */
export async function flushPendingFirstPerson(
  pending: PendingFirstPerson | null,
  emitter: OpEmitter,
  store: PendingStore,
): Promise<boolean> {
  if (pending === null) return false
  // Already flushed by an earlier run, on this device, for this join.
  if ((await store.read()) === null) return false

  emitter.emit(personRecorded(pending.personId, pending.name))
  // Durable first. Only the append may license the clear.
  await emitter.settled()
  await store.clear()
  return true
}
