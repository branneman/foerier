import {
  MAX_BATCH_BYTES,
  MAX_BATCH_OPS,
  type Clock,
  type HlcClock,
  type OpEnvelope,
} from '@foerier/shared'

import type { LoggedOp, OpLog } from './opLog'
import type { PullBody, PushOutcome, Transport } from './transport'

/**
 * The client half of `/sync` (`docs/sync-protocol.md` §6): it drains the
 * outbox, pages the pull, keeps the cursor, backs off, and dead-letters what
 * the household will never accept. Everything it needs is injected — the log,
 * the transport, both clocks, the randomness behind the jitter and the timer
 * behind the backoff — so every tier below Tier 4 drives it by hand.
 *
 * ## Two orderings, both from §8.5, both silent data loss when reversed
 *
 * - **Author:** append to the local log *before* updating in-memory state. A
 *   crash between the two loses a render, not a fact. The engine owns only
 *   the log half of that; `store.ts` owns the other.
 * - **Pull:** fold and durably write the page *before* advancing the cursor.
 *   The cursor is the only record of what has been seen, so advancing it
 *   first turns any failure in between into permanent loss. Hence the exact
 *   order in {@link createSyncEngine}'s pull loop — `ingest`, then `onOps`,
 *   then `writeMeta('cursor')` — and hence a fold that throws propagates with
 *   the cursor untouched rather than being swallowed.
 *
 * ## `has_more` is the sole paging condition (§6.4)
 *
 * `household_seq` is a snapshot taken *after* the page was read, so
 * `has_more: false` alongside `cursor < household_seq` is legal and ordinary
 * on a household being written to. It is a **denominator**, and a moving one:
 * never a loop condition. A client that paged until `cursor` caught
 * `household_seq` would never finish against a busy household — and the
 * screen that would hang is the first sync, the app's one unavoidable loading
 * screen. The remainder simply arrives on the next ordinary pull.
 *
 * ## A dead-lettered op stays in the log and stays folded (§6.5)
 *
 * Dead-lettering is a publication failure, not a retraction. The op leaves
 * the outbox and nothing else; dropping it from the fold would make the
 * device's own state jump backwards under the user's hands.
 *
 * ## Nothing here runs on a render path
 *
 * `start()` wires the triggers — `online`, `visibilitychange`, and a
 * 30-second interval — and `store.ts` nudges `flush()` after every `emit`.
 */

/** §6.3: base 1 s, doubling. */
export const BACKOFF_BASE_MS = 1_000

/** §6.3: capped at 5 minutes, retrying indefinitely. */
export const BACKOFF_CAP_MS = 5 * 60 * 1_000

/** The heartbeat that picks up other devices' work while the app is open. */
export const SYNC_INTERVAL_MS = 30_000

/** §6.4's own default. The server's maximum is 1000. */
export const DEFAULT_PAGE_SIZE = 500

export type SyncStatus =
  'idle' | 'syncing' | 'offline' | 'signed-out' | 'bootstrapping'

/**
 * `total` is `household_seq` — the household's op count, because `seq` is
 * gapless (§6.4) — which is what makes the first sync determinate rather than
 * a spinner (§7.6). It may grow mid-flight, and completion is `has_more`,
 * never `folded === total`.
 */
export interface BootstrapProgress {
  folded: number
  total: number
  paused: boolean
}

export interface SyncEngine {
  flush(): Promise<void>
  pull(): Promise<void>
  start(): void
  stop(): void
  status(): SyncStatus
  bootstrap(): BootstrapProgress | null
}

/**
 * Schedules one backoff retry and returns a cancel function. Injected for the
 * same reason `Clock` is: a test drives the retry by hand instead of waiting
 * out five real minutes, and the delay it was asked for is observable.
 */
export type Schedule = (fn: () => Promise<void>, ms: number) => () => void

export interface SyncEngineDeps {
  log: OpLog
  transport: Transport
  clock: Clock
  hlc: HlcClock
  /** Received ops, for the store to fold. Called before the cursor moves. */
  onOps(ops: readonly OpEnvelope[]): void
  onStatus(s: SyncStatus): void
  onBootstrap(p: BootstrapProgress | null): void
  /** The jitter's source. Injected so a test can assert bounds exactly. */
  random?(): number
  schedule?: Schedule
  pageSize?: number
}

const defaultSchedule: Schedule = (fn, ms) => {
  const id = setTimeout(() => {
    void fn()
  }, ms)
  return () => clearTimeout(id)
}

const BATCH_ENVELOPE_BYTES = '{"ops":[]}'.length
const encoder = new TextEncoder()

function byteLengthOf(op: OpEnvelope): number {
  return encoder.encode(JSON.stringify(op)).length
}

/**
 * Takes the longest prefix of `records` that fits §6.1's 1 MB body limit,
 * counting the JSON the body will actually carry — the array's brackets and
 * the commas between ops included. Always takes at least one record: a single
 * op that cannot fit is a poison pill the caller dead-letters rather than a
 * batch to shrink further.
 */
function chunkOf(records: readonly LoggedOp[]): LoggedOp[] {
  const chunk: LoggedOp[] = []
  let bytes = BATCH_ENVELOPE_BYTES
  for (const record of records) {
    const size = byteLengthOf(record.op) + 1
    if (chunk.length > 0 && bytes + size > MAX_BATCH_BYTES) break
    bytes += size
    chunk.push(record)
  }
  return chunk
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const random = deps.random ?? Math.random
  const schedule = deps.schedule ?? defaultSchedule
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE

  let current: SyncStatus = 'idle'
  let progress: BootstrapProgress | null = null

  /** Set by a 401 and never cleared: re-authenticating builds a new engine. */
  let frozen = false
  /** A pull is owed — a push saw a higher mark, or a pull did not finish. */
  let pullWanted = false

  let attempt = 0
  let retryAt = 0
  let cancelRetry: (() => void) | null = null
  let queue: Promise<void> = Promise.resolve()

  let interval: ReturnType<typeof setInterval> | null = null
  let onOnline: (() => void) | null = null
  let onVisibility: (() => void) | null = null

  function setStatus(next: SyncStatus): void {
    if (next === current) return
    current = next
    deps.onStatus(next)
  }

  function setProgress(next: BootstrapProgress | null): void {
    progress = next
    deps.onBootstrap(next)
  }

  async function readCursor(): Promise<number> {
    return (await deps.log.readMeta<number>('cursor')) ?? 0
  }

  // -------------------------------------------------------------------------
  // Backoff — §6.3
  // -------------------------------------------------------------------------

  /** Full jitter: anywhere in `[0, window]`, so a household's devices cannot
   * re-form a thundering herd on the way back up. */
  function backoffDelay(): number {
    const window = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt)
    return Math.floor(random() * window)
  }

  function clearBackoff(): void {
    attempt = 0
    retryAt = 0
    cancelRetry?.()
    cancelRetry = null
  }

  function retryLater(failure: { retryAfter?: number }): void {
    // A 429's Retry-After is the server telling us when; anything else gets
    // the jittered backoff. Either way the attempt counts, so a repeated 429
    // still backs off (§6.3).
    const delay =
      failure.retryAfter === undefined
        ? backoffDelay()
        : Math.max(0, failure.retryAfter) * 1_000
    attempt += 1
    retryAt = deps.clock.now() + delay
    cancelRetry?.()
    cancelRetry = schedule(() => {
      cancelRetry = null
      retryAt = 0
      return serial(() => run('sync'))
    }, delay)
    setStatus('offline')
  }

  function freeze(): void {
    frozen = true
    cancelRetry?.()
    cancelRetry = null
    retryAt = 0
    // A frozen engine never runs again — recovery is a *new* engine, built
    // once the app has a token — so it lets go of the interval and both DOM
    // listeners here rather than leaving them for a `stop()` the caller has
    // no obvious reason to make. `start()`'s guard tolerates the unwiring.
    unwire()
    // A bootstrap caught by a 401 is paused like any other interruption: its
    // cursor is kept, and it resumes once the app has a token again.
    pauseBootstrap()
    // The outbox is untouched. A 401 must never cost a user queued offline
    // work (§6.3).
    setStatus('signed-out')
  }

  /** Releases the interval and both listeners. Idempotent; shared by
   * {@link freeze} and `stop()`. */
  function unwire(): void {
    if (interval !== null) {
      clearInterval(interval)
      interval = null
    }
    if (onOnline !== null) {
      window.removeEventListener('online', onOnline)
      onOnline = null
    }
    if (onVisibility !== null) {
      document.removeEventListener('visibilitychange', onVisibility)
      onVisibility = null
    }
  }

  // -------------------------------------------------------------------------
  // Push — the outbox
  // -------------------------------------------------------------------------

  function deadLetterAll(
    chunk: readonly LoggedOp[],
    code: string,
  ): Promise<void> {
    return deps.log.deadLetter(
      chunk.map((record) => ({ opId: record.op.id, code })),
    )
  }

  /** Returns how many records the response resolved, which is what tells the
   * loop it is making progress. */
  async function applyOutcomes(
    results: readonly PushOutcome[],
  ): Promise<number> {
    const pushed: { opId: string; seq: number }[] = []
    const rejected: { opId: string; code: string }[] = []

    for (const outcome of results) {
      if (outcome.status === 'rejected') {
        rejected.push({ opId: outcome.op_id, code: outcome.code ?? 'rejected' })
      } else if (typeof outcome.seq === 'number') {
        // `accepted` and `duplicate` are the same event to a client: the op
        // is in the household's log at this seq (§8.1).
        pushed.push({ opId: outcome.op_id, seq: outcome.seq })
      }
    }

    if (pushed.length > 0) await deps.log.markPushed(pushed)
    if (rejected.length > 0) await deps.log.deadLetter(rejected)
    return pushed.length + rejected.length
  }

  /** Returns `true` when it halted — frozen or backing off — and the caller
   * must not carry on to the pull. */
  async function pushOutbox(): Promise<boolean> {
    const cursor = await readCursor()
    let limit = MAX_BATCH_OPS

    for (;;) {
      const records = await deps.log.outbox(limit)
      if (records.length === 0) return false

      const chunk = chunkOf(records)
      const result = await deps.transport.push(chunk.map((record) => record.op))

      if (!result.ok) {
        if (result.status === 401) {
          freeze()
          return true
        }
        if (result.status === 400) {
          // The batch itself is malformed — a client bug. Dead-letter it, do
          // not retry (§6.3); it stays in the log and stays folded (§6.5).
          await deadLetterAll(chunk, result.code)
          continue
        }
        if (result.status === 413) {
          if (chunk.length === 1) {
            // Unhalvable. Retrying forever would wedge every op behind it.
            await deadLetterAll(chunk, result.code)
            continue
          }
          limit = Math.floor(chunk.length / 2)
          continue
        }
        retryLater(result)
        return true
      }

      clearBackoff()
      const settled = await applyOutcomes(result.body.results)
      if (result.body.household_seq > cursor) pullWanted = true

      if (settled === 0) {
        // The server answered but resolved nothing, so the outbox cannot
        // shrink and looping would spin. Leave it for the next flush.
        console.warn('sync: a push resolved no ops; leaving them queued')
        return false
      }
    }
  }

  // -------------------------------------------------------------------------
  // Pull — the cursor
  // -------------------------------------------------------------------------

  function pauseBootstrap(): void {
    if (progress !== null && !progress.paused) {
      // The cursor is kept, so this resumes; it never restarts (§7.6).
      setProgress({ ...progress, paused: true })
    }
  }

  function reportBootstrap(fresh: boolean, page: PullBody): void {
    if (progress === null) {
      if (!fresh || page.household_seq === 0) return
      setProgress({
        folded: page.ops.length,
        total: Math.max(page.household_seq, page.ops.length),
        paused: false,
      })
      setStatus('bootstrapping')
      return
    }
    const folded = progress.folded + page.ops.length
    // The denominator moves, and may already be behind what we just folded.
    setProgress({
      folded,
      total: Math.max(page.household_seq, folded),
      paused: false,
    })
  }

  /** Returns `true` when it halted. */
  async function pullPages(): Promise<boolean> {
    let cursor = await readCursor()
    // A device with nothing in its log is bootstrapping — as is one already
    // part-way through a bootstrap that paused. The `cursor === 0` guard is
    // what keeps this off the ordinary path: reading the whole log to ask
    // whether it is empty is affordable only on a device that has never
    // pulled, which is the only device where it can be.
    const fresh =
      progress !== null || (cursor === 0 && (await deps.log.all()).length === 0)

    for (;;) {
      const result = await deps.transport.pull(cursor, pageSize)

      if (!result.ok) {
        if (result.status === 401) {
          freeze()
          return true
        }
        if (result.status === 400) {
          // A malformed request is a client bug; there is no batch to
          // dead-letter, so record it and stop rather than spin.
          console.error('sync: /sync/pull rejected the request', result.code)
          pauseBootstrap()
          setStatus('idle')
          return true
        }
        pauseBootstrap()
        retryLater(result)
        return true
      }

      clearBackoff()
      const page = result.body

      // §2.5, once per op received, whether or not this device authored it.
      for (const op of page.ops) deps.hlc.receive(op.hlc)

      await deps.log.ingest(page.ops)
      deps.onOps(page.ops)
      // Only now. Everything above is durable or in memory; the cursor is the
      // only record of what has been seen (§8.5).
      await deps.log.writeMeta('cursor', page.cursor)
      cursor = page.cursor

      reportBootstrap(fresh, page)

      // `has_more` alone. Never `cursor < household_seq` (§6.4).
      if (!page.has_more) break
    }

    pullWanted = false
    if (progress !== null) setProgress(null)
    return false
  }

  // -------------------------------------------------------------------------
  // The one serialised worker
  // -------------------------------------------------------------------------

  function serial(work: () => Promise<void>): Promise<void> {
    const next = queue.then(work)
    // The tail must never reject, or one failed run — a fold that threw, say
    // — would skip every sync queued behind it. The caller's own promise
    // still carries the failure.
    queue = next.catch(() => undefined)
    return next
  }

  function canRun(): boolean {
    if (frozen) return false
    // Respect a backoff window rather than letting a trigger stampede past
    // it. The scheduled retry clears `retryAt` before it runs.
    return deps.clock.now() >= retryAt
  }

  /**
   * `flush` pushes and pulls only if the push earned one; `sync` (the
   * triggers, and every backoff retry) always pulls, because that is how a
   * device learns what the others have done; `pull` skips the push.
   */
  async function run(mode: 'flush' | 'sync' | 'pull'): Promise<void> {
    if (!canRun()) return
    if (mode !== 'flush') pullWanted = true
    setStatus(progress === null ? 'syncing' : 'bootstrapping')

    if (mode !== 'pull' && (await pushOutbox())) return
    if (pullWanted && (await pullPages())) return

    attempt = 0
    setStatus('idle')
  }

  function trigger(): void {
    void serial(() => run('sync')).catch((error: unknown) => {
      console.error('sync: a triggered sync failed', error)
    })
  }

  return {
    flush: () => serial(() => run('flush')),
    pull: () => serial(() => run('pull')),

    start() {
      if (interval !== null) return
      onOnline = () => {
        // The network is visibly back, so the reason for the backoff is gone.
        clearBackoff()
        trigger()
      }
      onVisibility = () => {
        if (document.visibilityState === 'visible') trigger()
      }
      window.addEventListener('online', onOnline)
      document.addEventListener('visibilitychange', onVisibility)
      interval = setInterval(trigger, SYNC_INTERVAL_MS)
    },

    stop() {
      unwire()
      cancelRetry?.()
      cancelRetry = null
    },

    status: () => current,
    bootstrap: () => progress,
  }
}
