import type { OpEnvelope, StoredOp } from '@foerier/shared'
import { openDB, type IDBPDatabase } from 'idb'

import {
  DB_NAME,
  DB_VERSION,
  DEAD_LETTER_STORE,
  META_STORE,
  OP_ID_INDEX,
  OP_STORE,
  upgradeFoerierDb,
} from '../db'

/**
 * The client's durable op log — local source of truth for the offline-first
 * design (`docs/sync-protocol.md` §7.5). Two implementations, one contract:
 * `inMemoryOpLog` is a real fake used by every tier above this one,
 * `indexedDbOpLog` is what actually ships. The shared test suite in
 * `opLog.test.ts` runs against both, so the fake is proved to *behave* like
 * the real thing rather than merely resemble it.
 *
 * ## Why `lsn`, not `seq`
 *
 * A locally-authored op has no `seq` until the server assigns one, so `seq`
 * can key neither the log nor a snapshot's high-water mark. `lsn` is a purely
 * local append counter: never sent, never compared across devices, and
 * meaningless beyond "written to this device's log before that one".
 *
 * ## The outbox is a query, not a second structure
 *
 * Every record with `seq === null` and `deadLettered === false`, in `lsn`
 * order (§8.1). A record never pushed and a record whose push response was
 * lost are indistinguishable — which is exactly right, because re-pushing is
 * idempotent by `op_id`.
 *
 * ## Ingest updates by `op.id`; it does not insert blindly
 *
 * Pull returns the device's own ops too (§6.4), so an op already in the local
 * log arrives again carrying its server `seq`. Ingest writes that `seq` onto
 * the existing record rather than creating a second one — the op leaves the
 * outbox the moment it comes back through pull, whether or not its own push
 * response ever arrived (§8.3). An op ingest has never seen before (from
 * another device, or a lost local record) is inserted as new, at the next
 * `lsn`.
 *
 * ## A dead-lettered op stays in the log and stays folded (§6.5)
 *
 * It is local truth that failed to *publish*; dropping it from the fold would
 * make the device's own state jump backwards under the user's hands.
 *
 * ## Never mutate a stored op (§5.3 obligation 6)
 *
 * A re-push must be byte-identical, so nothing here ever rewrites the fields
 * of an op once appended or ingested — only the `seq` and `deadLettered`
 * bookkeeping around it changes.
 */

export interface LoggedOp {
  lsn: number
  op: OpEnvelope
  seq: number | null
  deadLettered: boolean
}

export type MetaKey = 'cursor' | 'hlc' | 'snapshot' | 'deviceId'

export interface OpLog {
  append(op: OpEnvelope): Promise<LoggedOp>
  ingest(ops: readonly StoredOp[]): Promise<void>
  since(lsn: number): Promise<LoggedOp[]>
  all(): Promise<LoggedOp[]>
  outbox(limit: number): Promise<LoggedOp[]>
  markPushed(entries: readonly { opId: string; seq: number }[]): Promise<void>
  deadLetter(entries: readonly { opId: string; code: string }[]): Promise<void>
  deadLetters(): Promise<readonly { opId: string; code: string }[]>
  readMeta<T>(key: MetaKey): Promise<T | null>
  writeMeta(key: MetaKey, value: unknown): Promise<void>
}

/**
 * Strips the two server-only fields off a {@link StoredOp}, leaving the
 * envelope exactly as authored. A shallow clone plus `delete` rather than
 * destructuring: destructuring the known fields out would silently drop any
 * unknown envelope field a tolerant reader must retain
 * (`docs/sync-protocol.md` §5.3).
 */
function envelopeOf(stored: StoredOp): OpEnvelope {
  const clone = structuredClone(stored) as unknown as Record<string, unknown>
  delete clone['seq']
  delete clone['received_at']
  return clone as unknown as OpEnvelope
}

/**
 * `deadLetters()` orders by the dead-lettered op's `lsn` in both
 * implementations — chronological, deterministic, and consistent with the
 * ordering `since`/`all`/`outbox` already give. An op that failed to publish
 * still occupies the `lsn` it was authored at, and a dead-lettered entry
 * whose op cannot be found (should not happen, but the store must not throw
 * over it) sorts last rather than crashing the read.
 */
function byLsn(a: { lsn: number }, b: { lsn: number }): number {
  return a.lsn - b.lsn
}

const UNKNOWN_LSN = Number.MAX_SAFE_INTEGER

// ---------------------------------------------------------------------------
// In-memory fake
// ---------------------------------------------------------------------------

export function inMemoryOpLog(): OpLog {
  const records: LoggedOp[] = []
  let nextLsn = 1
  const deadLetterEntries = new Map<
    string,
    { opId: string; code: string; lsn: number }
  >()
  const meta = new Map<MetaKey, unknown>()

  function findByOpId(opId: string): LoggedOp | undefined {
    return records.find((record) => record.op.id === opId)
  }

  return {
    append(op) {
      if (findByOpId(op.id)) {
        // Mirrors the real store's unique index on `op.id` (`ConstraintError`
        // on a duplicate `add()`) — the fake's whole job is to fail where the
        // real one fails.
        return Promise.reject(
          new Error(`opLog: an op with id ${op.id} is already in the log`),
        )
      }

      const stored: LoggedOp = {
        lsn: nextLsn++,
        op: structuredClone(op),
        seq: null,
        deadLettered: false,
      }
      records.push(stored)
      return Promise.resolve(structuredClone(stored))
    },

    ingest(ops) {
      for (const incoming of ops) {
        const existing = findByOpId(incoming.id)
        if (existing) {
          existing.seq = incoming.seq
        } else {
          records.push({
            lsn: nextLsn++,
            op: envelopeOf(incoming),
            seq: incoming.seq,
            deadLettered: false,
          })
        }
      }
      return Promise.resolve()
    },

    since(lsn) {
      return Promise.resolve(
        records
          .filter((record) => record.lsn > lsn)
          .map((record) => structuredClone(record)),
      )
    },

    all() {
      return Promise.resolve(records.map((record) => structuredClone(record)))
    },

    outbox(limit) {
      return Promise.resolve(
        records
          .filter((record) => record.seq === null && !record.deadLettered)
          .slice(0, limit)
          .map((record) => structuredClone(record)),
      )
    },

    markPushed(entries) {
      for (const entry of entries) {
        const record = findByOpId(entry.opId)
        if (record) record.seq = entry.seq
      }
      return Promise.resolve()
    },

    deadLetter(entries) {
      for (const entry of entries) {
        const record = findByOpId(entry.opId)
        deadLetterEntries.set(entry.opId, {
          opId: entry.opId,
          code: entry.code,
          lsn: record ? record.lsn : UNKNOWN_LSN,
        })
        if (record) record.deadLettered = true
      }
      return Promise.resolve()
    },

    deadLetters() {
      return Promise.resolve(
        [...deadLetterEntries.values()]
          .sort(byLsn)
          .map(({ opId, code }) => ({ opId, code })),
      )
    },

    readMeta<T>(key: MetaKey) {
      const value = meta.has(key) ? structuredClone(meta.get(key)) : null
      return Promise.resolve(value as T | null)
    },

    writeMeta(key, value) {
      meta.set(key, structuredClone(value))
      return Promise.resolve()
    },
  }
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

export function indexedDbOpLog(): OpLog {
  /**
   * Opens, runs `fn`, and closes again — rather than caching one long-lived
   * connection the way `sessionStore.ts` does. A stale open connection is
   * exactly what would block a future schema upgrade (or, in tests, block
   * `indexedDB.deleteDatabase` between cases), and the op log is written and
   * read far too often to make that trade for a small connection-reuse win.
   */
  async function withDb<T>(fn: (db: IDBPDatabase) => Promise<T>): Promise<T> {
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
    append(op) {
      return withDb(async (db) => {
        const record = {
          op: structuredClone(op),
          seq: null,
          deadLettered: false,
        }
        // The `op.id` unique index makes this reject with a `ConstraintError`
        // on a duplicate append, same as the in-memory fake above.
        const lsn = (await db.add(OP_STORE, record)) as number
        // `lsn` last: IndexedDB's in-line key generator may inject its own
        // `lsn` onto `record` as a side effect of `add()`, and the freshly
        // resolved key must win over that, not the other way round.
        return { ...record, lsn }
      })
    },

    async ingest(ops) {
      await withDb(async (db) => {
        const tx = db.transaction(OP_STORE, 'readwrite')
        const index = tx.store.index(OP_ID_INDEX)

        for (const incoming of ops) {
          const existing = (await index.get(incoming.id)) as
            LoggedOp | undefined

          if (existing) {
            await tx.store.put({ ...existing, seq: incoming.seq })
          } else {
            await tx.store.add({
              op: envelopeOf(incoming),
              seq: incoming.seq,
              deadLettered: false,
            })
          }
        }

        await tx.done
      })
    },

    since(lsn) {
      return withDb((db) =>
        db.getAll(OP_STORE, IDBKeyRange.lowerBound(lsn, true)),
      )
    },

    all() {
      return withDb((db) => db.getAll(OP_STORE))
    },

    outbox(limit) {
      return withDb(async (db) => {
        const results: LoggedOp[] = []
        let cursor = await db.transaction(OP_STORE).store.openCursor()
        while (cursor && results.length < limit) {
          const record = cursor.value as LoggedOp
          if (record.seq === null && !record.deadLettered) {
            results.push(record)
          }
          cursor = await cursor.continue()
        }
        return results
      })
    },

    async markPushed(entries) {
      await withDb(async (db) => {
        const tx = db.transaction(OP_STORE, 'readwrite')
        const index = tx.store.index(OP_ID_INDEX)

        for (const entry of entries) {
          const existing = (await index.get(entry.opId)) as LoggedOp | undefined
          if (existing) await tx.store.put({ ...existing, seq: entry.seq })
        }

        await tx.done
      })
    },

    async deadLetter(entries) {
      await withDb(async (db) => {
        const tx = db.transaction([OP_STORE, DEAD_LETTER_STORE], 'readwrite')
        const opStore = tx.objectStore(OP_STORE)
        const deadLetterStore = tx.objectStore(DEAD_LETTER_STORE)
        const index = opStore.index(OP_ID_INDEX)

        for (const entry of entries) {
          const existing = (await index.get(entry.opId)) as LoggedOp | undefined

          await deadLetterStore.put({
            opId: entry.opId,
            code: entry.code,
            lsn: existing ? existing.lsn : UNKNOWN_LSN,
          })

          if (existing) {
            await opStore.put({ ...existing, deadLettered: true })
          }
        }

        await tx.done
      })
    },

    deadLetters() {
      return withDb(async (db) => {
        const all = (await db.getAll(DEAD_LETTER_STORE)) as {
          opId: string
          code: string
          lsn: number
        }[]
        return all.sort(byLsn).map(({ opId, code }) => ({ opId, code }))
      })
    },

    readMeta<T>(key: MetaKey) {
      return withDb(async (db) => {
        const value = await db.get(META_STORE, key)
        return (value === undefined ? null : (value as T)) as T | null
      })
    },

    async writeMeta(key, value) {
      await withDb((db) => db.put(META_STORE, value, key))
    },
  }
}
