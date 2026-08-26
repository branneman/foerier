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

import { BUILD_SHA } from '../build'
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
 * ## Durability is answered per op, never by the queue being empty
 *
 * {@link DepotStoreState.emitDurable} resolves when **that** op is in the
 * log and rejects when it is not — refused for size, or refused by the log
 * itself. A caller that must not act until an op is durable (clearing the
 * joiner's name, `auth/pendingFirstPerson.ts`) waits on that and nothing
 * else. `drained()` answers a different and much weaker question — "has the
 * queue caught up" — and is true just as readily after a *failed* append, so
 * it must never be mistaken for a durability signal.
 *
 * ## An op that could not be written is surfaced, never swallowed
 *
 * A rejected append loses authored work more completely than an oversized op
 * does, because the user believes it saved. Both land in
 * {@link DepotStoreState.refusal}, which is the channel a screen reads to say
 * so.
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

/** The op the UI meant to author, and why it is not in the log. */
export interface OpRefusal {
  /**
   * `too-large` — §1.4's 16 KB per-op cap, refused before authoring.
   * `not-saved` — the local log rejected the write (a full quota, a blocked
   * upgrade, IndexedDB unavailable). Nothing was appended either way.
   */
  reason: 'too-large' | 'not-saved'
  /** The op type, for the message the screen shows. */
  type: string
  bytes: number
  limit: number
  /** What the log said, when it is the log that said no. */
  detail?: string
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
   * The same authoring path, with a per-op durability handshake: resolves
   * once **this** op is in the local log, and rejects when it never got
   * there. The caller that clears the joiner's name waits on exactly this
   * (`auth/pendingFirstPerson.ts`); a screen calls {@link emit} and reads
   * {@link refusal}.
   */
  emitDurable(spec: OpSpec): Promise<void>
  /**
   * Resolves once every piece of work queued **so far** has finished, however
   * it finished. A queue-drain signal for tests and teardown — **not** a
   * durability signal: it resolves just as readily after an append that
   * failed. Durability is {@link emitDurable}.
   */
  drained(): Promise<void>
  /**
   * How much of this Device's work the household has not accepted yet: the
   * outbox plus the dead-letter, which do not overlap (a dead-lettered record
   * has left the outbox).
   *
   * The number two screens state as a fact — the sign-in screen's *"N changes
   * saved here and not yet synced"* after a 401, and the Account screen's
   * `sign out this device` confirm sheet, which is the one action that
   * destroys it. Async because the outbox is a query over the log, never a
   * counter kept alongside it.
   */
  unsyncedCount(): Promise<number>
  /**
   * `RETRY NOW` on the first-sync card. A paused bootstrap keeps its cursor,
   * so this **resumes** — the engine reads the cursor back out of the log and
   * asks for the next page, never for the first one (§7.6).
   *
   * It is not decoration. A pull refused with a 400 pauses the bootstrap,
   * reports `idle` and schedules **no** retry (`syncEngine.ts`), so without a
   * hand on the screen that state never ends.
   */
  retrySync(): void
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
    // piece of work queued behind it. The job's *own* caller still sees the
    // failure — `emitDurable` rejects, and `refusal` records it — so this
    // catch drops nothing a caller was relying on.
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

  function refuse(refusal: OpRefusal): void {
    store.setState({ refusal })
  }

  function emitDurable(spec: OpSpec): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      enqueue(async () => {
        // One `try` around the whole job, so **every** exit settles the
        // promise the caller is holding. A job that threw before reaching an
        // explicit `reject` would otherwise leave that promise pending
        // forever — and the caller is the join path, where a hang is worse
        // than an error: a screen that never resolves rather than one that
        // can say what went wrong.
        let op: OpEnvelope | null = null
        let bytes = 0
        let appended = false

        try {
          op = authorOp(deps.author, spec)
          bytes = opByteLength(op)

          if (bytes > MAX_OP_BYTES) {
            // §1.4's cap is enforced by the server too, but only *after* the
            // 1 MB body check — so an op authored over it would be accepted
            // here, pushed as a batch of one, 413'd, and dead-lettered a
            // round trip later. Refusing to author is the difference between
            // telling the quartermaster now and losing their work quietly.
            refuse({
              reason: 'too-large',
              type: op.type,
              bytes,
              limit: MAX_OP_BYTES,
            })
            reject(
              new Error(
                `depot: refused to author ${op.type}: ${bytes} bytes is over the ${MAX_OP_BYTES}-byte cap`,
              ),
            )
            return
          }

          await deps.log.append(op)
          appended = true
          // Durable. Nothing below can un-write what the log now holds, so
          // this is the moment the caller was waiting for.
          resolve()

          await foldForward()
          if (store.getState().refusal !== null) {
            store.setState({ refusal: null })
          }
          // Fire-and-forget, deliberately: awaiting the network here would
          // put it on the path a caller waits for, which is the whole thing
          // §8.5 and architecture §3 forbid.
          nudge()
        } catch (error) {
          const failure =
            error instanceof Error ? error : new Error(String(error))

          if (appended) {
            // The op is in the log; the fold or the nudge is what failed. The
            // caller has already been told the truth — `resolve()` sits
            // immediately after `appended = true` with nothing awaited
            // between them, so this branch is unreachable with the caller
            // still waiting. **Keep those two adjacent.** Let the queue's
            // tail log the failure rather than pretend the write did not
            // happen: it did, and the next load folds it from the log (§8.4).
            throw failure
          }

          // The op is nowhere — the log refused it, or authoring itself did.
          // Saying so is the whole point: a caller that would otherwise throw
          // away its only copy of what the user typed has to be able to tell,
          // and a screen has to be able to say the change did not save.
          console.error('depot: an op could not be appended', failure)
          refuse({
            reason: 'not-saved',
            type: op?.type ?? spec.type,
            bytes,
            limit: MAX_OP_BYTES,
            detail: failure.message,
          })
          reject(failure)
        }
      })
    })
  }

  function emit(spec: OpSpec): void {
    // Nothing throws out of `emit`: the failure is already in `refusal`, and
    // a screen reads it there rather than catching it here.
    void emitDurable(spec).catch(() => undefined)
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
    emitDurable,
    drained: () => queue.then(() => undefined),
    async unsyncedCount(): Promise<number> {
      // No limit: this is a count, not a batch, and a device with more queued
      // ops than fit in one push still has to be able to say how many.
      const queued = await deps.log.outbox(Number.MAX_SAFE_INTEGER)
      return queued.length + store.getState().deadLetterCount
    },
    retrySync() {
      // `force`: an explicit tap must actually clear the backoff window it is
      // responding to, or the button does nothing while the wait is still
      // running — see `syncEngine.ts`'s `pull()`.
      engine.pull({ force: true }).catch((error: unknown) => {
        console.error('depot: the first sync could not be resumed', error)
      })
    },
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
 * The store above this component, or `null` where there is none — unlike
 * {@link useDepot}, which throws.
 *
 * The join screen is the reason: it renders in the window between a Device
 * signing in and its depot being built, so the first-sync card it composes
 * has to tolerate the absence rather than take the screen down with it.
 */
export function useDepotStore(): StoreApi<DepotStoreState> | null {
  return useContext(DepotContext)
}

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
