import {
  createHlcClock,
  systemClock,
  systemIdSource,
  type Clock,
  type HlcClock,
  type HlcParts,
  type IdSource,
  type OpAuthor,
} from '@foerier/shared'
import { deleteDB } from 'idb'
import type { StoreApi } from 'zustand/vanilla'

import { API_BASE } from '../auth/api'
import type { Session } from '../auth/sessionStore'
import { DB_NAME } from '../db'
import { indexedDbOpLog, type OpLog } from './opLog'
import {
  createDepotStore,
  type DepotStoreState,
  type EngineFactory,
} from './store'
import { createSyncEngine, type SyncEngine } from './syncEngine'
import { createHttpTransport, type Transport } from './transport'

/**
 * Where the client's four pieces are finally joined into one running depot:
 * the durable op log, the HLC, the `/sync` transport, and the engine that
 * drains the outbox — assembled **once per signed-in session** and handed to
 * the app through `DepotProvider`.
 *
 * Everything is injectable, because everything above this module has to be
 * drivable without a browser or a server (`docs/testing.md`): Tier 3 renders
 * the whole app over an `inMemoryOpLog` and a `fakeTransport`, and only Tier 5
 * exercises what `createSessionDepot` builds by default.
 *
 * ## The engine's lifecycle is the session's lifecycle
 *
 * - **Sign-in** builds the store, which builds and starts the engine
 *   (`store.ts` → `buildEngine`).
 * - **A 401** freezes that engine for good and unwires its timer and both DOM
 *   listeners (`syncEngine.ts` → `freeze`). It touches neither the outbox nor
 *   the log: queued offline work is the Quartermaster's, not auth's to
 *   discard (story 26). Recovery is a *new* engine — `resumeSync()` — never a
 *   restart of the frozen one.
 * - **Sign-out of this Device** is the only auth action that clears local
 *   data, and {@link clearLocalData} is that action's other half.
 */

/** The shape `meta.hlc` is expected to hold. Anything else is treated as no
 * saved state at all rather than trusted into the clock. */
function isHlcParts(value: unknown): value is HlcParts {
  if (typeof value !== 'object' || value === null) return false
  const parts = value as Record<string, unknown>
  return (
    typeof parts['ms'] === 'number' &&
    Number.isFinite(parts['ms']) &&
    typeof parts['counter'] === 'number' &&
    Number.isFinite(parts['counter'])
  )
}

/**
 * Wraps a clock so that every HLC it issues or receives is written back to
 * `meta.hlc`, coalescing concurrent writes: one write is in flight at a time
 * and at most one more is owed, so a page of five hundred pulled ops costs two
 * writes rather than five hundred, and the value that lands is always the
 * latest.
 *
 * The write is deliberately **not** awaited by the caller. `issue()` is called
 * inside `authorOp`, on the store's work queue, immediately before the op is
 * appended; making the append wait on a second IndexedDB round trip would put
 * storage latency on the authoring path for a value that is an optimisation,
 * not a fact. Losing the last write costs monotonicity until the first op
 * arrives from another device (§2.5's `max` re-establishes it) and nothing
 * else — op ids are UUIDv7 and unique regardless.
 */
function persistingHlcClock(inner: HlcClock, log: OpLog): HlcClock {
  let writing = false
  let owed = false

  function persist(): void {
    if (writing) {
      owed = true
      return
    }
    writing = true
    void log
      .writeMeta('hlc', inner.state())
      .catch((error: unknown) => {
        // A clock that cannot be persisted is not a reason to refuse to
        // author. Say so and carry on.
        console.warn('depot: the hlc could not be persisted', error)
      })
      .finally(() => {
        writing = false
        if (owed) {
          owed = false
          persist()
        }
      })
  }

  return {
    issue: () => {
      const hlc = inner.issue()
      persist()
      return hlc
    },
    receive: (remoteHlc) => {
      const result = inner.receive(remoteHlc)
      persist()
      return result
    },
    state: () => inner.state(),
  }
}

/**
 * The device's HLC, restored from `meta.hlc` and persisting itself from here
 * on.
 *
 * `docs/sync-protocol.md` §2.3 requires each device to persist `last` — the
 * last HLC it issued — alongside its op log, and to survive a restart with it.
 * Without that, a device that reloads re-issues timestamps it has already
 * used, which is the one path that makes §3.6's `device_id` tiebreak
 * reachable between a device and its own past.
 *
 * A read that fails, or a value that is not an {@link HlcParts}, starts the
 * clock at zero rather than throwing: the first received op pulls it forward
 * (§2.5), and refusing to open the depot over an unreadable optimisation
 * would be the worse trade by far.
 */
export async function restoreHlcClock(
  log: OpLog,
  clock: Clock = systemClock,
): Promise<HlcClock> {
  let saved: unknown = null
  try {
    saved = await log.readMeta<unknown>('hlc')
  } catch (error) {
    console.warn('depot: the saved hlc could not be read', error)
  }

  const inner = isHlcParts(saved)
    ? createHlcClock(clock, saved)
    : createHlcClock(clock)

  return persistingHlcClock(inner, log)
}

export interface SessionDepotDeps {
  log?: OpLog
  transport?: Transport
  clock?: Clock
  ids?: IdSource
}

/** How the app builds a depot for a session. Injected so that Tier 3 can
 * render the real `App` over real fakes. */
export type DepotFactory = (
  session: Session,
) => Promise<StoreApi<DepotStoreState>>

export async function createSessionDepot(
  session: Session,
  deps: SessionDepotDeps = {},
): Promise<StoreApi<DepotStoreState>> {
  const log = deps.log ?? indexedDbOpLog()
  const clock = deps.clock ?? systemClock
  const transport =
    deps.transport ??
    createHttpTransport({ baseUrl: API_BASE, token: () => session.token })

  const hlc = await restoreHlcClock(log, clock)

  // The engine is built by the store, not here — a 401 freezes one
  // permanently, so the store has to be able to build a replacement. The
  // reference is kept only to kick off the first sync below.
  let engine: SyncEngine | null = null
  const buildEngine: EngineFactory = (hooks) => {
    const built = createSyncEngine({
      log,
      transport,
      clock,
      hlc,
      onOps: hooks.onOps,
      onStatus: hooks.onStatus,
      onBootstrap: hooks.onBootstrap,
    })
    engine = built
    return built
  }

  const author: OpAuthor = {
    household_id: session.householdId,
    device_id: session.deviceId,
    ids: deps.ids ?? systemIdSource,
    hlc,
  }

  const store = createDepotStore({ log, engine: buildEngine, author })

  // `engine` was assigned by `buildEngine`, which `createDepotStore` calls
  // synchronously — but TypeScript's control flow cannot see an assignment
  // made inside a callback, so the value is handed to a function with a
  // declared parameter type rather than narrowed here.
  firstSync(engine)

  return store
}

/**
 * `start()` only arms the 30-second heartbeat and the two DOM triggers, so
 * without this a cold start would sit on last session's state — and on
 * whatever that session queued offline — for half a minute. Push first, then
 * pull: this device's own work goes out ahead of everyone else's coming in.
 */
function firstSync(engine: SyncEngine | null): void {
  if (engine === null) return
  void engine
    .flush()
    .then(() => engine.pull())
    .catch((error: unknown) => {
      console.error('depot: the first sync of the session failed', error)
    })
}

/**
 * **Sign out this Device** — the one auth action that clears local data
 * (`docs/design/User Flows.dc.html`: "unsynced changes … signing out clears
 * them"). Everything the household put on this device goes: the op log, the
 * cursor, the HLC, the snapshot, the session token and the pending first
 * Person, all of which live in the one `foerier` database.
 *
 * A 401 must never take this path. It leaves the log alone and the engine
 * frozen, and the header says `SIGNED OUT · SAVED ON DEVICE` (story 26).
 *
 * The confirm sheet that states the unsynced count before this runs belongs
 * to the Devices screen (`screens/Devices.tsx`, S3.5's Task 10), which is
 * this function's one caller; the count behind it is the store's own
 * `unsyncedCount()` (`depot/store.ts`) — `deadLetterCount` plus the length of
 * `log.outbox(…)` — read while the store is still alive, before the sheet's
 * confirm button ever runs this.
 */
export async function clearLocalData(): Promise<void> {
  await deleteDB(DB_NAME, {
    blocked: () => {
      // Another tab is holding the database open. Nothing to do but say so —
      // the delete completes as soon as that connection closes.
      console.warn('depot: another tab is holding the database open')
    },
  })
}
