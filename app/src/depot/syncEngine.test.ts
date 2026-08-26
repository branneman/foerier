import {
  createHlcClock,
  formatHlc,
  MAX_BATCH_BYTES,
  type Clock,
  type HlcClock,
  type OpEnvelope,
  type StoredOp,
} from '@foerier/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { inMemoryOpLog, type LoggedOp, type MetaKey, type OpLog } from './opLog'
import {
  createFakeServer,
  type PullBody,
  type Transport,
  type TransportResult,
} from './transport'
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  createSyncEngine,
  SYNC_INTERVAL_MS,
  type BootstrapProgress,
  type Schedule,
  type SyncStatus,
} from './syncEngine'

/**
 * The engine is where Task 16's log, Task 17's transport and the server's
 * contract are finally driven together, so every collaborator here is a real
 * fake driven by hand — no `vi.mock`, no `vi.fn()`. `vi.useFakeTimers()`
 * appears exactly once, for the 30-second interval trigger, because that is
 * the one behaviour whose *only* observable is the passage of real time.
 *
 * Two orderings dominate the suite, both from `docs/sync-protocol.md` §8.5:
 * the page is folded and durably written **before** the cursor moves, and a
 * fold that throws must leave the cursor where it was. Both are asserted
 * through a recording `OpLog` decorator that interleaves its calls with the
 * fold callback in one `events` array — an order assertion, not a spy count.
 *
 * Backoff is randomised, so nothing here asserts an exact delay without first
 * making the randomness deterministic: `random` is injected, and the
 * assertions are about bounds, growth and the cap.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const OTHER_DEVICE = 'aaaaaaaa-0000-7000-8000-000000000002'
const BASE_MS = 1_700_000_000_000

let nextId = 0
function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

function anOp(overrides: Partial<OpEnvelope> = {}): OpEnvelope {
  return {
    id: anId(),
    household_id: HOUSEHOLD,
    aggregate: 'gear',
    aggregate_id: anId(),
    type: 'gear.recorded',
    hlc: formatHlc({ ms: BASE_MS, counter: nextId }),
    device_id: DEVICE,
    payload: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Hand-driven collaborators
// ---------------------------------------------------------------------------

interface MutableClock extends Clock {
  advance(ms: number): void
}

function fakeClock(start = BASE_MS): MutableClock {
  let now = start
  return {
    now: () => now,
    advance(ms) {
      now += ms
    },
  }
}

/** A scheduled backoff retry, captured rather than run. `run()` resolves when
 * the retry it stands for has finished, which is what lets every backoff test
 * step the engine forward without a timer of any kind. */
interface ScheduledRetry {
  ms: number
  cancelled: boolean
  run(): Promise<void>
}

function fakeSchedule(): { schedule: Schedule; scheduled: ScheduledRetry[] } {
  const scheduled: ScheduledRetry[] = []
  const schedule: Schedule = (fn, ms) => {
    const entry: ScheduledRetry = { ms, cancelled: false, run: () => fn() }
    scheduled.push(entry)
    return () => {
      entry.cancelled = true
    }
  }
  return { schedule, scheduled }
}

/** Records the two writes whose relative order §8.5 pins — the durable page
 * write and the cursor advance — alongside the fold, in one shared array. */
function recordingLog(inner: OpLog, events: string[]): OpLog {
  return {
    append: (op) => inner.append(op),
    ingest: async (ops) => {
      await inner.ingest(ops)
      events.push(`ingest:${ops.length}`)
    },
    since: (lsn) => inner.since(lsn),
    all: () => inner.all(),
    outbox: (limit) => inner.outbox(limit),
    markPushed: async (entries) => {
      await inner.markPushed(entries)
      for (const entry of entries) {
        events.push(`pushed:${entry.opId}:${entry.seq}`)
      }
    },
    deadLetter: (entries) => inner.deadLetter(entries),
    deadLetters: () => inner.deadLetters(),
    readMeta: <T>(key: MetaKey) => inner.readMeta<T>(key),
    writeMeta: async (key, value) => {
      await inner.writeMeta(key, value)
      if (key === 'cursor') events.push(`cursor:${String(value)}`)
    },
  }
}

function recordingHlc(inner: HlcClock, seen: string[]): HlcClock {
  return {
    issue: () => inner.issue(),
    receive: (remoteHlc) => {
      seen.push(remoteHlc)
      return inner.receive(remoteHlc)
    },
    state: () => inner.state(),
  }
}

interface RecordingTransport extends Transport {
  pushes: (readonly OpEnvelope[])[]
  pulls: { since: number; limit: number }[]
}

function recordingTransport(inner: Transport): RecordingTransport {
  const pushes: (readonly OpEnvelope[])[] = []
  const pulls: { since: number; limit: number }[] = []
  return {
    pushes,
    pulls,
    push(ops) {
      pushes.push(ops)
      return inner.push(ops)
    },
    pull(since, limit) {
      pulls.push({ since, limit })
      return inner.pull(since, limit)
    },
  }
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

interface Harness {
  log: OpLog
  server: ReturnType<typeof createFakeServer>
  transport: RecordingTransport
  clock: MutableClock
  hlc: HlcClock
  engine: ReturnType<typeof createSyncEngine>
  statuses: SyncStatus[]
  folds: (readonly OpEnvelope[])[]
  progress: (BootstrapProgress | null)[]
  scheduled: ScheduledRetry[]
  events: string[]
  hlcSeen: string[]
}

function createHarness(
  options: {
    random?: () => number
    pageSize?: number
    onOps?: (ops: readonly OpEnvelope[]) => void
    transport?: (inner: Transport) => Transport
  } = {},
): Harness {
  const events: string[] = []
  const hlcSeen: string[] = []
  const log = recordingLog(inMemoryOpLog(), events)
  const server = createFakeServer()
  const clock = fakeClock()
  const hlc = recordingHlc(createHlcClock(clock), hlcSeen)
  const base: Transport = {
    push: (ops) => Promise.resolve(server.push(ops)),
    pull: (since, limit) => Promise.resolve(server.pull(since, limit)),
  }
  const transport = recordingTransport(
    options.transport ? options.transport(base) : base,
  )
  const { schedule, scheduled } = fakeSchedule()

  const statuses: SyncStatus[] = []
  const folds: (readonly OpEnvelope[])[] = []
  const progress: (BootstrapProgress | null)[] = []

  const engine = createSyncEngine({
    log,
    transport,
    clock,
    hlc,
    onOps: (ops) => {
      folds.push(ops)
      events.push(`fold:${ops.length}`)
      options.onOps?.(ops)
    },
    onStatus: (status) => statuses.push(status),
    onBootstrap: (p) => progress.push(p),
    schedule,
    ...(options.random === undefined ? {} : { random: options.random }),
    ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
  })

  return {
    log,
    server,
    transport,
    clock,
    hlc,
    engine,
    statuses,
    folds,
    progress,
    scheduled,
    events,
    hlcSeen,
  }
}

/**
 * Lets the engine's serialised chain run to completion without calling into
 * the engine to do it. Every collaborator in this suite resolves
 * synchronously, so the chain is pure microtasks and a bounded number of
 * turns drains it deterministically — no timer, and no `flush()` doing the
 * trigger's work for it and hiding a listener that was never wired.
 */
async function drainMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 100; turn += 1) await Promise.resolve()
}

async function appendAll(
  log: OpLog,
  ops: readonly OpEnvelope[],
): Promise<void> {
  for (const op of ops) await log.append(op)
}

function idsOf(ops: readonly OpEnvelope[]): string[] {
  return ops.map((op) => op.id)
}

function recordFor(records: readonly LoggedOp[], id: string): LoggedOp {
  const found = records.find((record) => record.op.id === id)
  if (found === undefined) throw new Error(`no record for ${id}`)
  return found
}

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Push — the outbox
// ---------------------------------------------------------------------------

describe('the sync engine pushing its outbox', () => {
  it('pushes the outbox in lsn order', async () => {
    const h = createHarness()
    const ops = [anOp(), anOp(), anOp()]
    await appendAll(h.log, ops)

    await h.engine.flush()

    expect(h.transport.pushes).toHaveLength(1)
    expect(idsOf(h.transport.pushes[0]!)).toEqual(idsOf(ops))
  })

  it('chunks a 501-op outbox into two pushes', async () => {
    const h = createHarness()
    const ops = Array.from({ length: 501 }, () => anOp())
    await appendAll(h.log, ops)

    await h.engine.flush()

    expect(h.transport.pushes.map((batch) => batch.length)).toEqual([500, 1])
    expect(h.transport.pushes.flatMap(idsOf)).toEqual(idsOf(ops))
  })

  it('chunks by byte size as well as by count', async () => {
    const h = createHarness()
    // Three ops of ~400 KB: two fit inside the 1 MB body limit, three do not,
    // and all three are far below the 500-op count limit — so only the byte
    // budget can explain the split.
    const ops = Array.from({ length: 3 }, () =>
      anOp({ payload: { note: 'x'.repeat(400_000) } }),
    )
    await appendAll(h.log, ops)

    await h.engine.flush()

    expect(h.transport.pushes.map((batch) => batch.length)).toEqual([2, 1])
    for (const batch of h.transport.pushes) {
      expect(JSON.stringify({ ops: batch }).length).toBeLessThanOrEqual(
        MAX_BATCH_BYTES,
      )
    }
  })

  it('writes the seq of an accepted op and clears it from the outbox', async () => {
    const h = createHarness()
    const op = anOp()
    await h.log.append(op)

    await h.engine.flush()

    // From the push response, not from the pull that follows it: the seq is
    // written the moment the server reports it.
    expect(h.events).toContain(`pushed:${op.id}:1`)
    expect(recordFor(await h.log.all(), op.id).seq).toBe(1)
    expect(await h.log.outbox(10)).toEqual([])
    expect(await h.log.deadLetters()).toEqual([])
  })

  it('treats a duplicate exactly as an accepted op', async () => {
    const h = createHarness()
    const op = anOp()
    // The server already holds it at seq 1 — the push response of a previous
    // attempt was lost, or a pull brought it back. Either way the re-push
    // comes back `duplicate` carrying the seq it already had (§8.1).
    h.server.push([op])
    await h.log.append(op)

    await h.engine.flush()

    // Identical treatment to an accepted op, and proven on the push path
    // rather than through the pull that follows it.
    expect(h.events).toContain(`pushed:${op.id}:1`)
    expect(recordFor(await h.log.all(), op.id).seq).toBe(1)
    expect(await h.log.outbox(10)).toEqual([])
    expect(await h.log.deadLetters()).toEqual([])
  })

  it('dead-letters a rejected op but leaves it folded', async () => {
    const h = createHarness()
    const doomed = anOp()
    const fine = anOp()
    h.server.queueRejection(doomed.id, 'household_mismatch')
    await appendAll(h.log, [doomed, fine])

    await h.engine.flush()

    expect(await h.log.deadLetters()).toEqual([
      { opId: doomed.id, code: 'household_mismatch' },
    ])
    // Still in the log, so a re-fold still includes it: it is local truth
    // that failed to *publish* (§6.5). It is simply out of the outbox.
    const record = recordFor(await h.log.all(), doomed.id)
    expect(record.deadLettered).toBe(true)
    expect(record.op).toEqual(doomed)
    expect(await h.log.outbox(10)).toEqual([])
    expect(recordFor(await h.log.all(), fine.id).seq).toBe(1)
  })

  it('re-pushes the byte-identical op after a lost response', async () => {
    const h = createHarness({ random: () => 1 })
    const op = anOp()
    h.server.queueLostResponse('push')
    await h.log.append(op)

    await h.engine.flush()
    expect(h.transport.pushes).toHaveLength(1)
    expect(h.scheduled).toHaveLength(1)

    await h.scheduled[0]!.run()

    expect(h.transport.pushes).toHaveLength(2)
    // Byte-identical, not merely equivalent: a re-push that "improved" the
    // queued op would break the server's op_id idempotency (§8.1).
    expect(JSON.stringify(h.transport.pushes[1])).toBe(
      JSON.stringify(h.transport.pushes[0]),
    )
    // The write landed on the lost attempt, so the retry is a duplicate and
    // reports the seq the op already had.
    expect(recordFor(await h.log.all(), op.id).seq).toBe(1)
  })

  it('pulls after a push when household_seq exceeds the cursor', async () => {
    const h = createHarness()
    const remote = anOp({ device_id: OTHER_DEVICE })
    h.server.push([remote])
    const mine = anOp()
    await h.log.append(mine)

    await h.engine.flush()

    expect(h.transport.pulls).toEqual([{ since: 0, limit: 500 }])
    expect(h.folds.flatMap(idsOf)).toEqual([remote.id, mine.id])
    expect(await h.log.readMeta<number>('cursor')).toBe(2)

    // And not when it does not exceed it: a push whose only op was rejected
    // takes no seq, so the mark stays where the cursor already is and there
    // is nothing to fetch.
    const doomed = anOp()
    h.server.queueRejection(doomed.id, 'household_mismatch')
    await h.log.append(doomed)

    await h.engine.flush()

    expect(h.transport.pushes).toHaveLength(2)
    expect(h.transport.pulls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Pull — the cursor
// ---------------------------------------------------------------------------

describe('the sync engine pulling pages', () => {
  it('advances the cursor only after the page is folded and written', async () => {
    const h = createHarness()
    h.server.push([anOp({ device_id: OTHER_DEVICE }), anOp()])

    await h.engine.pull()

    // §8.5: the durable write, then the fold, then — and only then — the
    // cursor. The cursor is the only record of what has been seen.
    expect(h.events).toEqual(['ingest:2', 'fold:2', 'cursor:2'])
  })

  it('does not advance the cursor when folding throws', async () => {
    const h = createHarness({
      onOps: () => {
        throw new Error('fold failed')
      },
    })
    const remote = anOp({ device_id: OTHER_DEVICE })
    h.server.push([remote])

    await expect(h.engine.pull()).rejects.toThrow('fold failed')

    expect(await h.log.readMeta<number>('cursor')).toBe(null)
    // The page is durably in the log, so the re-pull that follows is an
    // idempotent re-ingest rather than a second copy.
    expect(idsOf((await h.log.all()).map((record) => record.op))).toEqual([
      remote.id,
    ])
  })

  it('pages a pull until has_more is false', async () => {
    const h = createHarness({ pageSize: 2 })
    h.server.push(
      Array.from({ length: 5 }, () => anOp({ device_id: OTHER_DEVICE })),
    )

    await h.engine.pull()

    expect(h.transport.pulls).toEqual([
      { since: 0, limit: 2 },
      { since: 2, limit: 2 },
      { since: 4, limit: 2 },
    ])
    expect(await h.log.readMeta<number>('cursor')).toBe(5)
    expect(h.folds.map((page) => page.length)).toEqual([2, 2, 1])
  })

  it('stops paging when has_more is false even though household_seq exceeds the cursor', async () => {
    // The server reads the high-water mark *after* the page, so this response
    // is legal and common on a household being written to (§6.4). A client
    // that looped on `cursor < household_seq` would never finish.
    const pulls: number[] = []
    const remote = anOp({ device_id: OTHER_DEVICE })
    const stored: StoredOp = {
      ...remote,
      seq: 1,
      received_at: '2026-08-25T00:00:00.000Z',
    }
    const h = createHarness({
      transport: () => ({
        push: () =>
          Promise.resolve({
            ok: true,
            body: { results: [], household_seq: 9 },
          }),
        pull: (since) => {
          pulls.push(since)
          const body: PullBody = {
            ops: since === 0 ? [stored] : [],
            cursor: since === 0 ? 1 : since,
            has_more: false,
            household_seq: 9,
          }
          return Promise.resolve({ ok: true, body })
        },
      }),
    })

    await h.engine.pull()

    expect(pulls).toEqual([0])
    expect(h.engine.status()).toBe('idle')
    expect(h.engine.bootstrap()).toBe(null)
    expect(await h.log.readMeta<number>('cursor')).toBe(1)
  })

  it('feeds every received op`s hlc to the local clock', async () => {
    const h = createHarness({ pageSize: 2 })
    const remote = Array.from({ length: 3 }, (_unused, index) =>
      anOp({
        device_id: OTHER_DEVICE,
        hlc: formatHlc({ ms: BASE_MS + 1000 * (index + 1), counter: 0 }),
      }),
    )
    h.server.push(remote)

    await h.engine.pull()

    expect(h.hlcSeen).toEqual(remote.map((op) => op.hlc))
    // §2.5's max: the local clock has adopted the furthest physical time it
    // saw, so the next op this device authors sorts after all three.
    expect(h.hlc.state().ms).toBe(BASE_MS + 3000)
  })
})

// ---------------------------------------------------------------------------
// Errors — §6.3, exactly
// ---------------------------------------------------------------------------

describe('the sync engine handling errors', () => {
  it('backs off exponentially with jitter on a 5xx and retries indefinitely', async () => {
    const h = createHarness({ random: () => 1 })
    await h.log.append(anOp())
    for (let n = 0; n < 12; n += 1) {
      h.server.queueError('push', { status: 503, code: 'server_error' })
    }

    await h.engine.flush()
    const delays = [h.scheduled[0]!.ms]
    for (let n = 1; n < 12; n += 1) {
      await h.scheduled[n - 1]!.run()
      delays.push(h.scheduled[n]!.ms)
    }

    // random() === 1 is the top of each window, so the whole shape shows:
    // doubling from 1 s, then clamped at 5 min, forever.
    expect(delays).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000,
      300_000, 300_000, 300_000,
    ])
    expect(h.engine.status()).toBe('offline')

    // Twelve consecutive failures and it is still retrying — and the retry
    // that finds the server healthy drains the outbox.
    await h.scheduled[11]!.run()
    expect(await h.log.outbox(10)).toEqual([])
    expect(h.engine.status()).toBe('idle')

    // Full jitter: every delay lies anywhere in [0, window], never at a fixed
    // point, so a thundering herd cannot re-form.
    const rolls = [0, 0.5, 0.25, 0.75]
    let roll = 0
    const jittered = createHarness({
      random: () => rolls[roll++ % rolls.length]!,
    })
    await jittered.log.append(anOp())
    for (let n = 0; n < 4; n += 1) {
      jittered.server.queueError('push', { status: 500, code: 'server_error' })
    }
    await jittered.engine.flush()
    for (let n = 1; n < 4; n += 1) await jittered.scheduled[n - 1]!.run()

    const observed = jittered.scheduled.map((entry) => entry.ms)
    expect(observed).toHaveLength(4)
    observed.forEach((ms, n) => {
      const window = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** n)
      expect(ms).toBeGreaterThanOrEqual(0)
      expect(ms).toBeLessThanOrEqual(window)
    })
    expect(new Set(observed).size).toBeGreaterThan(1)
  })

  it('halves the batch on a 413', async () => {
    const h = createHarness()
    await appendAll(
      h.log,
      Array.from({ length: 10 }, () => anOp()),
    )
    h.server.queueError('push', { status: 413, code: 'payload_too_large' })

    await h.engine.flush()

    expect(h.transport.pushes.map((batch) => batch.length)).toEqual([10, 5, 5])
    expect(await h.log.outbox(10)).toEqual([])
    expect(h.scheduled).toEqual([])
  })

  it('honours Retry-After on a 429', async () => {
    // random() === 1 makes the plain backoff exactly 1 s, so a delay of 42 s
    // can only have come from the header.
    const h = createHarness({ random: () => 1 })
    await h.log.append(anOp())
    h.server.queueError('push', {
      status: 429,
      code: 'rate_limited',
      retryAfter: 42,
    })

    await h.engine.flush()

    expect(h.scheduled.map((entry) => entry.ms)).toEqual([42_000])
    expect(h.engine.status()).toBe('offline')

    await h.scheduled[0]!.run()
    expect(await h.log.outbox(10)).toEqual([])
  })

  it('freezes on a 401 and keeps every queued op', async () => {
    const h = createHarness()
    const ops = [anOp(), anOp(), anOp()]
    await appendAll(h.log, ops)
    h.server.queueError('push', { status: 401, code: 'unauthorized' })

    await h.engine.flush()

    expect(h.engine.status()).toBe('signed-out')
    expect(h.statuses).toContain('signed-out')
    // A 401 must never cost a user queued offline work (§6.3).
    expect(idsOf((await h.log.outbox(10)).map((record) => record.op))).toEqual(
      idsOf(ops),
    )
    expect(await h.log.deadLetters()).toEqual([])
    expect(h.scheduled).toEqual([])

    // Frozen: further work is not attempted until the app re-authenticates.
    await h.engine.flush()
    await h.engine.pull()
    expect(h.transport.pushes).toHaveLength(1)
    expect(h.transport.pulls).toEqual([])
  })

  it('dead-letters the batch on a 400 and does not retry it', async () => {
    const h = createHarness()
    const ops = [anOp(), anOp()]
    await appendAll(h.log, ops)
    h.server.queueError('push', { status: 400, code: 'bad_request' })

    await h.engine.flush()

    expect(await h.log.deadLetters()).toEqual(
      ops.map((op) => ({ opId: op.id, code: 'bad_request' })),
    )
    expect(h.transport.pushes).toHaveLength(1)
    expect(h.scheduled).toEqual([])
    // Dead-lettered, so out of the outbox — but still in the log, still
    // folded (§6.5).
    expect(await h.log.outbox(10)).toEqual([])
    expect(await h.log.all()).toHaveLength(2)
  })

  it('dead-letters a single op that a 413 cannot halve any further', async () => {
    const h = createHarness()
    const op = anOp()
    await h.log.append(op)
    h.server.queueError('push', { status: 413, code: 'payload_too_large' })

    await h.engine.flush()

    // A batch of one cannot be halved, so retrying it forever would wedge the
    // outbox behind an op the server will never take.
    expect(await h.log.deadLetters()).toEqual([
      { opId: op.id, code: 'payload_too_large' },
    ])
    expect(h.transport.pushes).toHaveLength(1)
    expect(h.scheduled).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Bootstrap — §7.6
// ---------------------------------------------------------------------------

describe('the sync engine bootstrapping a new device', () => {
  it('reports determinate bootstrap progress across pages', async () => {
    const h = createHarness({ pageSize: 2 })
    h.server.push(
      Array.from({ length: 5 }, () => anOp({ device_id: OTHER_DEVICE })),
    )

    await h.engine.pull()

    expect(h.progress).toEqual([
      // `household_seq` arrives *with* the first page (§6.4), so the
      // denominator is unknown for exactly one round trip and is reported as
      // `0` — the screen renders that as `OP 0 OF —` rather than showing
      // nothing at all until a page lands.
      { folded: 0, total: 0, paused: false },
      { folded: 2, total: 5, paused: false },
      { folded: 4, total: 5, paused: false },
      { folded: 5, total: 5, paused: false },
      null,
    ])
    expect(h.statuses).toContain('bootstrapping')
    expect(h.engine.bootstrap()).toBe(null)
    expect(h.engine.status()).toBe('idle')
  })

  it('bootstraps a device that authored before it ever pulled', async () => {
    // The **cursor** is what means "has never pulled"; an empty log means
    // "has never authored", which is a different question. A Device that
    // joined, recorded gear offline and only then first-synced holds a
    // non-empty log at cursor 0 and is folding the household's whole history
    // just the same — so it gets a determinate number, not nothing.
    const h = createHarness({ pageSize: 2 })
    await h.log.append(anOp())
    h.server.push(
      Array.from({ length: 3 }, () => anOp({ device_id: OTHER_DEVICE })),
    )

    await h.engine.pull()

    expect(h.progress).toEqual([
      { folded: 0, total: 0, paused: false },
      { folded: 2, total: 3, paused: false },
      { folded: 3, total: 3, paused: false },
      null,
    ])
  })

  it('pauses rather than restarting when a bootstrap page fails', async () => {
    let calls = 0
    const h = createHarness({
      pageSize: 2,
      transport: (inner) => ({
        push: (ops) => inner.push(ops),
        pull: (since, limit) => {
          calls += 1
          if (calls === 2) {
            const failure: TransportResult<PullBody> = {
              ok: false,
              status: 503,
              code: 'server_error',
            }
            return Promise.resolve(failure)
          }
          return inner.pull(since, limit)
        },
      }),
      random: () => 1,
    })
    h.server.push(
      Array.from({ length: 5 }, () => anOp({ device_id: OTHER_DEVICE })),
    )

    await h.engine.pull()

    expect(h.progress).toEqual([
      { folded: 0, total: 0, paused: false },
      { folded: 2, total: 5, paused: false },
      { folded: 2, total: 5, paused: true },
    ])
    // The cursor is kept, so the retry resumes from page two.
    expect(await h.log.readMeta<number>('cursor')).toBe(2)
    expect(h.engine.status()).toBe('offline')

    await h.scheduled[0]!.run()

    expect(h.transport.pulls.map((call) => call.since)).toEqual([0, 2, 2, 4])
    expect(h.progress).toEqual([
      { folded: 0, total: 0, paused: false },
      { folded: 2, total: 5, paused: false },
      { folded: 2, total: 5, paused: true },
      { folded: 4, total: 5, paused: false },
      { folded: 5, total: 5, paused: false },
      null,
    ])
    expect(h.folds.flatMap((page) => page).length).toBe(5)
  })

  it('does not bootstrap a device that has already pulled an empty household', async () => {
    const h = createHarness()

    await h.engine.pull()
    await h.engine.pull()

    // Recorded across both pulls, not sampled at the end: the bug is a
    // transient that a settled-state assertion (just checking the last value)
    // would sail straight past. The first pull is this device's one
    // legitimate bootstrap round trip against an empty household — `{0, 0,
    // false}` then `null`. A second pull must report nothing at all: no
    // second `{0, 0, false}`, no second `null`, no second 'bootstrapping'
    // status — because `cursor === 0` cannot distinguish "never pulled" from
    // "pulled an empty household", and testing it would re-enter the
    // bootstrap on every 30-second trigger forever.
    expect(h.progress).toEqual([{ folded: 0, total: 0, paused: false }, null])
    expect(h.statuses.filter((status) => status === 'bootstrapping')).toEqual([
      'bootstrapping',
    ])
  })

  it('writes the cursor as 0 after pulling an empty household', async () => {
    const h = createHarness()

    await h.engine.pull()

    // `null` (never written) and `0` (written, found nothing) are the two
    // states the single bootstrap guard above depends on staying distinct.
    // `toBeFalsy()` would pass on either and is exactly the trap: it does not
    // tell `0` apart from the `null` that means something else entirely.
    expect(await h.log.readMeta<number>('cursor')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Triggers — never on a render path
// ---------------------------------------------------------------------------

describe('the sync engine triggers', () => {
  it('syncs when the browser comes back online', async () => {
    const h = createHarness()
    h.engine.start()
    await h.log.append(anOp())

    window.dispatchEvent(new Event('online'))
    await drainMicrotasks()

    // Asserted before any `flush()`: a `flush()` here would push, see the
    // mark exceed the cursor and pull all by itself, so the same two numbers
    // would hold with no listener wired at all.
    expect(h.transport.pushes).toHaveLength(1)
    expect(h.transport.pulls).toHaveLength(1)

    h.engine.stop()
    await h.log.append(anOp())
    window.dispatchEvent(new Event('online'))
    await drainMicrotasks()

    expect(h.transport.pushes).toHaveLength(1)
  })

  it('syncs when the document becomes visible again', async () => {
    const h = createHarness()
    h.engine.start()
    await h.log.append(anOp())

    document.dispatchEvent(new Event('visibilitychange'))
    await drainMicrotasks()

    expect(h.transport.pushes).toHaveLength(1)
    expect(h.transport.pulls).toHaveLength(1)

    h.engine.stop()
    await h.log.append(anOp())
    document.dispatchEvent(new Event('visibilitychange'))
    await drainMicrotasks()

    expect(h.transport.pushes).toHaveLength(1)
  })

  it('does not let a trigger stampede through a backoff window', async () => {
    const h = createHarness({ random: () => 1 })
    h.engine.start()
    await h.log.append(anOp())
    h.server.queueError('push', { status: 503, code: 'server_error' })

    await h.engine.flush()
    expect(h.transport.pushes).toHaveLength(1)
    const delay = h.scheduled[0]!.ms

    // The clock has not moved, so the window is still open. A trigger fires
    // at least twice a minute, so without this gate §6.3's 5-minute cap
    // would be unenforceable — the backoff would be whatever the interval is.
    document.dispatchEvent(new Event('visibilitychange'))
    await drainMicrotasks()
    expect(h.transport.pushes).toHaveLength(1)

    h.clock.advance(delay)
    document.dispatchEvent(new Event('visibilitychange'))
    await drainMicrotasks()
    expect(h.transport.pushes).toHaveLength(2)

    h.engine.stop()
  })

  it('unwires its triggers when a 401 freezes it', async () => {
    vi.useFakeTimers()
    const h = createHarness()
    h.engine.start()
    await h.log.append(anOp())
    h.server.queueError('push', { status: 401, code: 'unauthorized' })

    await h.engine.flush()
    expect(h.engine.status()).toBe('signed-out')

    // A frozen engine is dead, and a dead engine holding a live interval and
    // two DOM listeners is a leak every re-authentication would repeat.
    expect(vi.getTimerCount()).toBe(0)

    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2)
    await drainMicrotasks()

    expect(h.transport.pushes).toHaveLength(1)
    expect(h.transport.pulls).toEqual([])
    // And the queued work is still queued (§6.3).
    expect(await h.log.outbox(10)).toHaveLength(1)
  })

  it('syncs on the interval, and stops when the engine stops', async () => {
    vi.useFakeTimers()
    const h = createHarness()
    h.engine.start()
    await h.log.append(anOp())

    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS)
    expect(h.transport.pushes).toHaveLength(1)

    h.engine.stop()
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 3)
    expect(h.transport.pushes).toHaveLength(1)
  })
})
