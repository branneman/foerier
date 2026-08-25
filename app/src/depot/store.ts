import {
  authorOp,
  emptyState,
  fold,
  MAX_OP_BYTES,
  type DepotState,
  type OpAuthor,
  type OpEnvelope,
  type OpSpec,
} from '@foerier/shared'
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import type { OpLog } from './opLog'
import {
  opByteLength,
  type BootstrapProgress,
  type SyncEngine,
  type SyncStatus,
} from './syncEngine'

/**
 * The client's engine, assembled: the folded state the UI reads, the one path
 * by which an op is authored, and the join between the local log (`opLog.ts`),
 * the transport (`transport.ts`) and the sync engine (`syncEngine.ts`).
 *
 * ## `emit` is the only authoring path, and its order is `sync-protocol.md` §8.5
 *
 * ```
 * stamp id · household_id · device_id · hlc
 *   → append to the local log        ← durable FIRST
 *   → fold into memory
 *   → nudge the outbox
 * ```
 *
 * A crash between the append and the fold loses a render, not a fact. The
 * reverse order loses the fact. `emit` returns `void` and **the UI never
 * awaits it** (architecture §3: no async in any render path); everything it
 * does runs on {@link createDepotStore}'s single work queue, which is also
 * what keeps the HLC counter from racing itself — every op is stamped inside
 * the queue, so authoring order, `lsn` order and HLC order are the same
 * order, always.
 *
 * ## Memory is folded from the log, never from the caller's hand
 *
 * Both paths — a local `emit` and a page the engine pulled — end in the same
 * `since(lastLsn)` catch-up. That is one line of extra work and three
 * properties for free: an op is folded exactly once even if it arrives twice
 * (§8.3, our own ops come back through pull carrying a seq), it is folded in
 * `lsn` order however the two paths interleave, and in-memory state is
 * *literally* the fold of a durable prefix of the log — which is the
 * invariant the snapshot below is allowed to assume.
 *
 * ## The snapshot is keyed by build SHA (§5.3)
 *
 * §5.3 obligation 1 makes a reader **retain** an op it cannot fold. So a
 * snapshot taken by a build that could not fold some op is *wrong* for a
 * build that can, and a snapshot is only usable by the build that wrote it:
 * a different SHA discards it and re-folds the whole log. That is what makes
 * the tolerant reader safe rather than merely well-intentioned, and §7's
 * arithmetic is what makes the full re-fold affordable.
 *
 * ## The engine is built here, and a frozen one is never resumed
 *
 * A 401 freezes the engine permanently and unwires its timer and both DOM
 * listeners. Recovery is a **new** engine, once the app has a token again —
 * hence `deps.engine` is a factory rather than an instance, and
 * {@link DepotStoreState.resumeSync} builds a replacement rather than
 * restarting the corpse.
 */

/** The op the UI would have authored, and why the store would not. */
export interface OpRefusal {
  /** The only reason today: §1.4's 16 KB per-op cap. */
  reason: 'too-large'
  /** The op type that was refused, for the message the screen shows. */
  type: string
  bytes: number
  limit: number
}

/**
 * The materialised fold, and the two facts that decide whether it may be
 * used: the build that produced it and the `lsn` it covers up to.
 */
export interface DepotSnapshot {
  sha: string
  /** Every record with `lsn <= this` is already folded into `state`. */
  lsn: number
  state: DepotState
}

export interface DepotStoreState {
  /** The fold. Pure in-memory, read synchronously by every selector. */
  state: DepotState
  /** `loading` until the first fold completes; then `bootstrapping` for as
   * long as the engine reports a first sync, else `ready`. */
  status: 'loading' | 'bootstrapping' | 'ready'
  sync: SyncStatus
  bootstrap: BootstrapProgress | null
  /** Ops the household will never accept (§6.5). Visible, never silent. */
  deadLetterCount: number
  /**
   * Set when {@link DepotStoreState.emit} refused to author, cleared by the
   * next op it accepts. A refusal is not an error to throw at a render — it
   * is a fact a screen shows.
   */
  refusal: OpRefusal | null
  /** The one authoring path. Never awaited, never throws. */
  emit(spec: OpSpec): void
  /**
   * Resolves once every piece of work queued **so far** has finished — the
   * append included. The durability handshake: a caller that must not act
   * until an op is in the log (see `auth/pendingFirstPerson.ts`) waits on
   * this rather than on `emit`, which by design returns nothing.
   */
  settled(): Promise<void>
  /** After re-authenticating: build and start a **fresh** engine. */
  resumeSync(): void
  /** Sign-out and teardown: stop the engine and drop the pending snapshot. */
  stopSync(): void
}

/** What the store wires into every engine it builds. */
export interface SyncHooks {
  onOps(ops: readonly OpEnvelope[]): void
  onStatus(status: SyncStatus): void
  onBootstrap(progress: BootstrapProgress | null): void
}

export type EngineFactory = (hooks: SyncHooks) => SyncEngine

export interface DepotStoreDeps {
  log: OpLog
  /**
   * A **factory**, not an instance: a 401 freezes an engine for good, and the
   * store is what has to build the replacement.
   */
  engine: EngineFactory
  author: OpAuthor
  /** Defaults to the build's own SHA. Injected so a test can be two builds. */
  sha?: string
  snapshotDebounceMs?: number
}

/** Long enough that a burst of edits writes one snapshot, short enough that a
 * closed tab rarely loses more than a second of folding work. */
export const SNAPSHOT_DEBOUNCE_MS = 2_000

const BUILD_SHA = import.meta.env['VITE_GIT_SHA'] ?? 'dev'

export function createDepotStore(
  deps: DepotStoreDeps,
): StoreApi<DepotStoreState> {
  const sha = deps.sha ?? BUILD_SHA
  const debounceMs = deps.snapshotDebounceMs ?? SNAPSHOT_DEBOUNCE_MS

  /** The single work queue. Every durable write and every read that feeds
   * state runs on it, in order. */
  let queue: Promise<void> = Promise.resolve()
  /** The high-water mark of what `state` contains. */
  let lastLsn = 0
  let loaded = false
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null
  let engine: SyncEngine

  function enqueue(job: () => Promise<void>): void {
    // The tail must never reject: one failed job would otherwise skip every
    // piece of work queued behind it, and `settled()` would surface a
    // rejection to a UI that has nothing to do with it.
    queue = queue.then(job).catch((error: unknown) => {
      console.error('depot: a queued job failed', error)
    })
  }

  function statusOf(bootstrap: BootstrapProgress | null) {
    if (!loaded) return 'loading' as const
    return bootstrap === null ? ('ready' as const) : ('bootstrapping' as const)
  }

  // -------------------------------------------------------------------------
  // Folding
  // -------------------------------------------------------------------------

  /** Folds every record the log holds beyond {@link lastLsn}. The only way
   * anything reaches `state`. */
  async function foldForward(): Promise<void> {
    const records = await deps.log.since(lastLsn)
    if (records.length === 0) return
    lastLsn = records.at(-1)?.lsn ?? lastLsn
    const ops = records.map((record) => record.op)
    store.setState((current) => ({ state: fold(ops, current.state) }))
    scheduleSnapshot()
  }

  async function refreshDeadLetters(): Promise<void> {
    const entries = await deps.log.deadLetters()
    store.setState({ deadLetterCount: entries.length })
  }

  /**
   * The snapshot, if this build may use it. Anything else — none written yet,
   * one written by a **different build** (§5.3), or one that does not read
   * back as a snapshot at all — returns `null`, and the caller folds the whole
   * log instead. That is the recovery §8.4 promises: the log is the truth and
   * the snapshot is only ever an accelerator.
   */
  async function readSnapshot(): Promise<DepotSnapshot | null> {
    let snapshot: DepotSnapshot | null
    try {
      snapshot = await deps.log.readMeta<DepotSnapshot>('snapshot')
    } catch (error) {
      console.warn('depot: the snapshot could not be read', error)
      return null
    }

    if (snapshot === null) return null
    // The build check, and the whole reason a snapshot carries a SHA:
    // obligation 1 makes a reader retain ops it cannot fold, so a snapshot
    // taken by a build that could not fold some op is *wrong* for one that
    // can.
    if (snapshot.sha !== sha) return null
    if (typeof snapshot.lsn !== 'number') return null
    if (typeof snapshot.state !== 'object' || snapshot.state === null) {
      return null
    }
    return snapshot
  }

  async function load(): Promise<void> {
    const snapshot = await readSnapshot()

    if (snapshot !== null) {
      lastLsn = snapshot.lsn
      store.setState({ state: snapshot.state })
    }

    await foldForward()
    loaded = true
    store.setState({ status: statusOf(store.getState().bootstrap) })
    await refreshDeadLetters()
  }

  // -------------------------------------------------------------------------
  // The snapshot — debounced, never on a render path
  // -------------------------------------------------------------------------

  function scheduleSnapshot(): void {
    if (snapshotTimer !== null) clearTimeout(snapshotTimer)
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null
      enqueue(async () => {
        // Read `lastLsn` and the state inside the job, so the pair is the one
        // the queue last produced rather than two moments spliced together.
        const snapshot: DepotSnapshot = {
          sha,
          lsn: lastLsn,
          state: store.getState().state,
        }
        await deps.log.writeMeta('snapshot', snapshot)
      })
    }, debounceMs)
  }

  // -------------------------------------------------------------------------
  // Authoring
  // -------------------------------------------------------------------------

  function nudge(): void {
    engine.flush().catch((error: unknown) => {
      console.error('depot: the flush after an emit failed', error)
    })
  }

  function emit(spec: OpSpec): void {
    enqueue(async () => {
      const op = authorOp(deps.author, spec)
      const bytes = opByteLength(op)

      if (bytes > MAX_OP_BYTES) {
        // §1.4's cap is enforced by the server too, but only *after* the 1 MB
        // body check — so an op authored over it would be accepted here,
        // pushed as a batch of one, 413'd, and dead-lettered a round trip
        // later. Refusing to author is the difference between telling the
        // quartermaster now and losing their work quietly.
        store.setState({
          refusal: {
            reason: 'too-large',
            type: op.type,
            bytes,
            limit: MAX_OP_BYTES,
          },
        })
        return
      }

      await deps.log.append(op)
      await foldForward()
      if (store.getState().refusal !== null) store.setState({ refusal: null })
      // Fire-and-forget, deliberately: awaiting the network here would put it
      // on the path `settled()` waits for, which is the whole thing §8.5 and
      // architecture §3 forbid.
      nudge()
    })
  }

  // -------------------------------------------------------------------------
  // The engine
  // -------------------------------------------------------------------------

  const hooks: SyncHooks = {
    onOps: (ops) => {
      // The ops themselves are not folded from here: the engine has already
      // written them to the log (§8.5, pull), so the catch-up reads them back
      // in `lsn` order and skips the ones this device authored and folded
      // when it emitted them.
      if (ops.length > 0) enqueue(foldForward)
    },
    onStatus: (next) => {
      store.setState({ sync: next })
      // A sync round is the only thing that can dead-letter an op, so this is
      // the only moment the count can have changed.
      enqueue(refreshDeadLetters)
    },
    onBootstrap: (progress) => {
      store.setState({ bootstrap: progress, status: statusOf(progress) })
    },
  }

  function buildEngine(): void {
    engine = deps.engine(hooks)
    engine.start()
    // `onStatus` and `onBootstrap` only fire on a *change*, so a fresh
    // engine's state has to be read across rather than waited for —
    // otherwise the store would still be showing the frozen one's
    // `signed-out`.
    const bootstrap = engine.bootstrap()
    store.setState({
      sync: engine.status(),
      bootstrap,
      status: statusOf(bootstrap),
    })
  }

  const store = createStore<DepotStoreState>(() => ({
    state: emptyState(),
    status: 'loading',
    sync: 'idle',
    bootstrap: null,
    deadLetterCount: 0,
    refusal: null,
    emit,
    settled: () => queue.then(() => undefined),
    resumeSync() {
      // Never the old one: `freeze()` set a flag that is never cleared, and
      // unwired its timer and listeners on the way (`syncEngine.ts`).
      engine.stop()
      buildEngine()
      nudge()
    },
    stopSync() {
      engine.stop()
      if (snapshotTimer !== null) {
        clearTimeout(snapshotTimer)
        snapshotTimer = null
      }
    },
  }))

  enqueue(load)
  buildEngine()

  return store
}

// ---------------------------------------------------------------------------
// The React binding
// ---------------------------------------------------------------------------

/**
 * The app's one store instance, provided from where it is constructed (from
 * the session) rather than reached for as a module global — so a test renders
 * a screen over a store it seeded, and a sign-out can replace the whole thing.
 */
const DepotContext = createContext<StoreApi<DepotStoreState> | null>(null)

export const DepotProvider = DepotContext.Provider

/**
 * Selector-subscribed: a component re-renders only when the slice it asked
 * for changes, which is the whole reason the reducer returns identical
 * objects for a lost write (architecture §3).
 */
export function useDepot<T>(selector: (state: DepotStoreState) => T): T {
  const store = useContext(DepotContext)
  if (store === null) {
    throw new Error('useDepot: no DepotProvider above this component')
  }
  return useStore(store, selector)
}
