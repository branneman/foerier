import { openDB } from 'idb'

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  SEAM — the op layer is not built yet.                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `auth-design.md` §3.4 step 2 says that onboarding, having asked the joiner
 * their name, emits the Household's **first op** with the `person_id` the
 * Invite pre-bound:
 *
 *   > Onboarding asks the joiner their name and emits the `person.create` op
 *   > **with that exact id**, as the Household's first op.
 *
 * That cannot be completed here. The op log, the reducer, and `/sync` do not
 * exist yet, and their contract — the envelope, the HLC, and the catalogue —
 * is specified in [`sync-protocol.md`](../../../docs/sync-protocol.md).
 * Improvising an op format now is exactly the thing that document exists to
 * prevent, so this module **captures the two inputs and stops**.
 *
 * Note the op is called **`person.recorded`**, not `person.create`: the MVP
 * catalogue in `sync-protocol.md` §4.2 is authoritative and auth-design's
 * prose predates it.
 *
 * ## What closing this seam looks like
 *
 * When the op layer lands, {@link flushPendingFirstPerson} becomes:
 *
 * ```ts
 * emit({
 *   aggregate: 'person',
 *   aggregate_id: pending.personId,   // ← the Invite's pre-bound id
 *   type: 'person.recorded',
 *   payload: { name: pending.name },
 * })
 * ```
 *
 * The id **must** be the pre-bound one. That is the whole point: it is what
 * makes "a Login is always a Person" true from the Household's very first
 * second, rather than leaving a Login pointing at a Person nobody ever created.
 *
 * Until then, a freshly-bootstrapped Household has a Login whose `person_id`
 * resolves to no folded Person. That is *survivable by design* — §2.1 requires
 * such a Login to render as an unnamed Quartermaster rather than as an error —
 * but it is not finished, and the name is kept here so that nothing the joiner
 * typed is lost when it is.
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
 * Persisted rather than held in memory: the joiner may close the tab between
 * naming themselves and the op layer existing, and re-typing their name is not
 * something to ask of them.
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
  const open = () => openDB('foerier', 1)

  return {
    async save(pending) {
      await (await open()).put('auth', pending, KEY)
    },
    async read() {
      try {
        return (await (await open()).get('auth', KEY)) ?? null
      } catch {
        return null
      }
    },
    async clear() {
      await (await open()).delete('auth', KEY)
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
 * Called once the op layer exists. Today it is a no-op that reports what is
 * waiting, so the seam is observable rather than silent.
 */
export function flushPendingFirstPerson(pending: PendingFirstPerson | null): {
  emitted: false
  reason: 'op-layer-not-built'
  pending: PendingFirstPerson | null
} {
  return { emitted: false, reason: 'op-layer-not-built', pending }
}
