import {
  authorOp,
  createHlcClock,
  emptyState,
  fold,
  gearRecorded,
  gearRenamed,
  MAX_OP_BYTES,
  placeRecorded,
  type Clock,
  type DepotState,
  type IdSource,
  type OpAuthor,
  type OpEnvelope,
  type OpSpec,
} from '@foerier/shared'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  flushPendingFirstPerson,
  inMemoryPendingStore,
  type PendingFirstPerson,
  type PendingStore,
} from '../auth/pendingFirstPerson'
import { inMemoryOpLog, type OpLog } from './opLog'
import {
  createDepotStore,
  DepotProvider,
  useDepot,
  type DepotSnapshot,
  type DepotStoreState,
  type EngineFactory,
  type SyncHooks,
} from './store'
import { createSyncEngine, type SyncEngine } from './syncEngine'
import {
  createFakeServer,
  fakeTransport,
  type FakeServer,
  type Transport,
} from './transport'

/**
 * The store is where Task 16's log, Task 18's engine and `shared/`'s reducer
 * finally meet, so every collaborator here is a real fake driven by hand —
 * no `vi.mock`, no `vi.fn()`, and no fake timers. The two orderings the suite
 * exists to pin are both from `docs/sync-protocol.md`:
 *
 * - **§8.5, author:** append to the durable log *before* folding into memory.
 *   Asserted through a recording {@link OpLog} decorator that interleaves its
 *   own calls with the store's fold in one `events` array — an order
 *   assertion, not a spy count.
 * - **§5.3, the snapshot:** a snapshot written by a *different* build SHA is
 *   discarded and the whole log re-folded. Asserted by seeding a snapshot
 *   whose state contains a Place **no op in the log produces**: if the
 *   snapshot was used the ghost is visible, and if it was discarded it cannot
 *   be.
 *
 * The build SHA is injected rather than read from `import.meta.env`, for the
 * same reason the clock is: a test needs two different SHAs in one file.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const OTHER_DEVICE = 'aaaaaaaa-0000-7000-8000-000000000002'
const BASE_MS = 1_700_000_000_000
const SHA = 'f0e21e4'
const OTHER_SHA = '9c31aa7'

let nextId = 0

function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

function fixedClock(start = BASE_MS): Clock {
  return { now: () => start }
}

function anAuthor(device = DEVICE): OpAuthor {
  return {
    household_id: HOUSEHOLD,
    device_id: device,
    ids,
    hlc: createHlcClock(fixedClock()),
  }
}

/** Awaits every piece of work the store has queued so far. Not a durability
 * signal — that is `emitDurable`, and the suite says so where it matters. */
function drained(store: { getState(): DepotStoreState }): Promise<void> {
  return store.getState().drained()
}

/** One macrotask, for the debounced snapshot and for the engine's own queue. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// Hand-driven collaborators
// ---------------------------------------------------------------------------

/** Records the append and the catch-up read, so the fold can be interleaved
 * with them in one array. */
function recordingLog(inner: OpLog, events: string[]): OpLog {
  return {
    ...inner,
    append: async (op) => {
      const record = await inner.append(op)
      events.push('append')
      return record
    },
    since: async (lsn) => {
      const records = await inner.since(lsn)
      events.push('since')
      return records
    },
  }
}

/**
 * An {@link OpLog} whose appends resolve **out of the order they were made** —
 * the first call waits longest. Serialised through the store's queue that is
 * invisible; run in parallel it pulls `lsn` order and HLC order apart.
 */
function reorderingLog(inner: OpLog, longest: number): OpLog {
  let delay = longest
  return {
    ...inner,
    append: async (op) => {
      const wait = delay > 0 ? delay-- : 0
      await new Promise<void>((resolve) => setTimeout(resolve, wait))
      return inner.append(op)
    },
  }
}

/**
 * An {@link OpLog} whose first `failures` appends **reject** — a full quota, a
 * blocked upgrade, IndexedDB in a private window. The op never reaches the
 * log, so nothing downstream may act as though it did.
 */
function failingLog(inner: OpLog, failures: number): OpLog {
  let left = failures
  return {
    ...inner,
    append: (op) => {
      if (left > 0) {
        left -= 1
        return Promise.reject(new Error('opLog: the write was refused'))
      }
      return inner.append(op)
    },
  }
}

/** An {@link OpLog} whose `append` only completes when the test says so. */
function gatedLog(inner: OpLog): OpLog & { release(): void } {
  const waiting: (() => void)[] = []
  return {
    ...inner,
    append: async (op) => {
      await new Promise<void>((resolve) => waiting.push(resolve))
      return inner.append(op)
    },
    release() {
      for (const resolve of waiting.splice(0)) resolve()
    },
  }
}

interface FakeEngine extends SyncEngine {
  hooks: SyncHooks
  started: boolean
  flushes: number
}

/** A {@link SyncEngine} that does nothing but remember what it was asked to
 * do, and hands the test the hooks the store wired into it. */
function fakeEngines(events?: string[]): {
  factory: EngineFactory
  built: FakeEngine[]
} {
  const built: FakeEngine[] = []
  const factory: EngineFactory = (hooks) => {
    const engine: FakeEngine = {
      hooks,
      started: false,
      flushes: 0,
      flush() {
        engine.flushes += 1
        events?.push('nudge')
        return Promise.resolve()
      },
      pull: () => Promise.resolve(),
      start() {
        engine.started = true
      },
      stop() {
        engine.started = false
      },
      status: () => 'idle',
      bootstrap: () => null,
    }
    built.push(engine)
    return engine
  }
  return { factory, built }
}

/** The real engine, over a real in-memory server — the harness for everything
 * that has to cross the sync boundary for real. */
function liveEngines(
  log: OpLog,
  transport: Transport,
): { factory: EngineFactory; built: SyncEngine[] } {
  const built: SyncEngine[] = []
  const factory: EngineFactory = (hooks) => {
    const engine = createSyncEngine({
      log,
      transport,
      clock: fixedClock(),
      hlc: createHlcClock(fixedClock()),
      onOps: hooks.onOps,
      onStatus: hooks.onStatus,
      onBootstrap: hooks.onBootstrap,
    })
    built.push(engine)
    return engine
  }
  return { factory, built }
}

const running: DepotStoreState[] = []

/** Every store the suite starts is stopped again, so no engine is left
 * holding an interval or a `window` listener between files. */
afterEach(() => {
  for (const state of running.splice(0)) state.stopSync()
})

function startStore(deps: {
  log: OpLog
  engine: EngineFactory
  author?: OpAuthor
  sha?: string
  snapshotDebounceMs?: number
}) {
  const store = createDepotStore({
    log: deps.log,
    engine: deps.engine,
    author: deps.author ?? anAuthor(),
    sha: deps.sha ?? SHA,
    snapshotDebounceMs: deps.snapshotDebounceMs ?? 0,
  })
  running.push(store.getState())
  return store
}

function liveHarness(log: OpLog = inMemoryOpLog(), transport?: Transport) {
  const server: FakeServer = createFakeServer()
  const wire = transport ?? fakeTransport(server)
  const { factory, built } = liveEngines(log, wire)
  const store = startStore({ log, engine: factory })
  return { store, log, server, engines: built }
}

function anOp(spec: OpSpec, author: OpAuthor = anAuthor()): OpEnvelope {
  return authorOp(author, spec)
}

// ---------------------------------------------------------------------------

describe('the depot store', () => {
  it('emit appends to the log before folding into memory', async () => {
    const events: string[] = []
    const log = recordingLog(inMemoryOpLog(), events)
    const { factory, built } = fakeEngines(events)
    const store = startStore({ log, engine: factory })
    await drained(store)
    expect(built[0]!.started).toBe(true)

    events.length = 0
    store.subscribe((next, previous) => {
      if (next.state !== previous.state) events.push('fold')
    })

    store.getState().emit(placeRecorded(anId(), 'Shed'))
    await drained(store)

    // The whole of §8.5's authoring order, in one array.
    expect(events).toEqual(['append', 'since', 'fold', 'nudge'])
    expect(built[0]!.flushes).toBe(1)
  })

  it('emit never awaits the network', async () => {
    let pushes = 0
    // A transport that never answers: if `emit` awaited it, nothing below
    // would ever resolve and the fold would never happen.
    const stalled: Transport = {
      push: () => {
        pushes += 1
        return new Promise(() => undefined)
      },
      pull: () => new Promise(() => undefined),
    }
    const log = inMemoryOpLog()
    const { store } = liveHarness(log, stalled)
    await drained(store)

    const placeId = anId()
    const returned = store.getState().emit(placeRecorded(placeId, 'Shed'))
    expect(returned).toBeUndefined()

    await drained(store)
    expect(store.getState().state.places[placeId]?.name?.value).toBe('Shed')

    // …and the outbox was still nudged, it was just never waited on.
    await tick()
    expect(pushes).toBe(1)
  })

  it('emit serialises concurrent calls so hlcs stay strictly increasing', async () => {
    const inner = inMemoryOpLog()
    const log = reorderingLog(inner, 8)
    const { factory } = fakeEngines()
    const store = startStore({ log, engine: factory })
    await drained(store)

    for (let n = 0; n < 8; n += 1) {
      store.getState().emit(placeRecorded(anId(), `Place ${n}`))
    }
    await drained(store)

    const records = await log.all()
    expect(records).toHaveLength(8)
    expect(records.map((record) => record.lsn)).toEqual(
      records.map((_, index) => index + 1),
    )
    for (let n = 1; n < records.length; n += 1) {
      // The HLC is a fixed-width sortable string, so `<` is the order.
      expect(records[n - 1]!.op.hlc < records[n]!.op.hlc).toBe(true)
    }
    expect(Object.keys(store.getState().state.places)).toHaveLength(8)
  })

  it('folds the whole log on load when there is no snapshot', async () => {
    const log = inMemoryOpLog()
    const author = anAuthor()
    const placeId = anId()
    const gearId = anId()
    await log.append(anOp(placeRecorded(placeId, 'Shed'), author))
    await log.append(
      anOp(
        gearRecorded(gearId, {
          name: 'Tent',
          container: false,
          kind: 'single',
        }),
        author,
      ),
    )

    const { factory } = fakeEngines()
    const store = startStore({ log, engine: factory })
    expect(store.getState().status).toBe('loading')

    await drained(store)

    expect(store.getState().status).toBe('ready')
    expect(store.getState().state.places[placeId]?.name?.value).toBe('Shed')
    expect(store.getState().state.gear[gearId]?.name?.value).toBe('Tent')
  })

  it('starts from a snapshot written by the same build sha', async () => {
    const { log, ghostId, gearId, placeId } = await seededForSnapshot(SHA)
    const { factory } = fakeEngines()
    const store = startStore({ log, engine: factory, sha: SHA })
    await drained(store)

    const state = store.getState().state
    // The ghost is only in the snapshot, so its presence proves the snapshot
    // was the starting point…
    expect(state.places[ghostId]?.name?.value).toBe('Attic')
    // …the Place at lsn 1 is below the snapshot's mark and was not re-folded…
    expect(Object.hasOwn(state.places, placeId)).toBe(false)
    // …and the Gear above it was.
    expect(state.gear[gearId]?.name?.value).toBe('Tent')
  })

  it('discards a snapshot written by a different build sha and re-folds', async () => {
    const { log, ghostId, gearId, placeId } = await seededForSnapshot(OTHER_SHA)
    const { factory } = fakeEngines()
    const store = startStore({ log, engine: factory, sha: SHA })
    await drained(store)

    const state = store.getState().state
    // Nothing of the snapshot survives…
    expect(Object.hasOwn(state.places, ghostId)).toBe(false)
    // …and the whole log is folded, from lsn 1.
    expect(state.places[placeId]?.name?.value).toBe('Shed')
    expect(state.gear[gearId]?.name?.value).toBe('Tent')
  })

  it('writes a snapshot stamped with the current build sha', async () => {
    const log = inMemoryOpLog()
    const { factory } = fakeEngines()
    const store = startStore({ log, engine: factory, sha: SHA })
    await drained(store)

    const placeId = anId()
    store.getState().emit(placeRecorded(placeId, 'Shed'))
    await drained(store)
    await tick()
    await drained(store)

    const snapshot = await log.readMeta<DepotSnapshot>('snapshot')
    expect(snapshot?.sha).toBe(SHA)
    expect(snapshot?.lsn).toBe(1)
    expect(snapshot?.state.places[placeId]?.name?.value).toBe('Shed')
  })

  it('applies ops delivered by the engine without re-appending them', async () => {
    const { store, log, server, engines } = liveHarness()
    await drained(store)

    const gearId = anId()
    const elsewhere = anOp(
      gearRecorded(gearId, { name: 'Stove', container: false, kind: 'single' }),
      anAuthor(OTHER_DEVICE),
    )
    server.push([elsewhere])

    await engines[0]!.pull()
    await drained(store)

    expect(store.getState().state.gear[gearId]?.name?.value).toBe('Stove')
    const records = await log.all()
    expect(records).toHaveLength(1)
    expect(records[0]!.op.id).toBe(elsewhere.id)
    // Ingested, not authored here: it already carries the server's seq.
    expect(records[0]!.seq).toBe(1)
  })

  it('reports the dead-letter count', async () => {
    const log = inMemoryOpLog()
    const doomed = anOp(placeRecorded(anId(), 'Shed'))
    await log.append(doomed)

    const { store, server, engines } = liveHarness(log)
    server.queueRejection(doomed.id, 'unknown_type')
    await drained(store)
    expect(store.getState().deadLetterCount).toBe(0)

    await engines[0]!.flush()
    await drained(store)

    expect(store.getState().deadLetterCount).toBe(1)
  })

  it('refuses to author an op larger than MAX_OP_BYTES', async () => {
    const log = inMemoryOpLog()
    const { factory } = fakeEngines()
    const store = startStore({ log, engine: factory })
    await drained(store)

    const gearId = anId()
    store.getState().emit(gearRenamed(gearId, 'x'.repeat(MAX_OP_BYTES)))
    await drained(store)

    const refusal = store.getState().refusal
    expect(refusal?.reason).toBe('too-large')
    expect(refusal?.type).toBe('gear.renamed')
    expect(refusal?.bytes).toBeGreaterThan(MAX_OP_BYTES)
    // Refused, not accepted-then-lost: nothing was appended, nothing folded.
    expect(await log.all()).toHaveLength(0)
    expect(Object.hasOwn(store.getState().state.gear, gearId)).toBe(false)

    // …and the next ordinary op clears the refusal.
    store.getState().emit(gearRenamed(gearId, 'Tent'))
    await drained(store)
    expect(store.getState().refusal).toBeNull()
    expect(await log.all()).toHaveLength(1)
  })

  it('builds a fresh engine rather than resuming a frozen one', async () => {
    const log = inMemoryOpLog()
    await log.append(anOp(placeRecorded(anId(), 'Shed')))

    const { store, server, engines } = liveHarness(log)
    server.queueError('push', { status: 401, code: 'unauthorized' })
    await drained(store)

    await engines[0]!.flush()
    await drained(store)
    expect(store.getState().sync).toBe('signed-out')
    expect(await log.outbox(10)).toHaveLength(1)

    store.getState().resumeSync()
    expect(engines).toHaveLength(2)
    expect(engines[1]).not.toBe(engines[0])
    expect(store.getState().sync).not.toBe('signed-out')

    await engines[1]!.flush()
    await drained(store)
    expect(store.getState().sync).toBe('idle')

    // The queued op went out under the new engine; the frozen one would
    // never have run again.
    expect(await log.outbox(10)).toHaveLength(0)
    const pulled = server.pull(0, 10)
    expect(pulled.ok && pulled.body.ops).toHaveLength(1)
  })

  it('exposes the store through useDepot', async () => {
    const log = inMemoryOpLog()
    const { factory } = fakeEngines()
    const store = startStore({ log, engine: factory })
    await drained(store)

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(DepotProvider, { value: store }, children)
    const { result } = renderHook(() => useDepot((state) => state.status), {
      wrapper,
    })

    expect(result.current).toBe('ready')
  })
})

/**
 * Two records in the log — a Place at lsn 1, a Gear at lsn 2 — under a
 * snapshot taken at lsn 1 whose state holds a **ghost**: a Place no op in the
 * log produces. Which of the three is visible after a load says exactly
 * which path ran.
 */
async function seededForSnapshot(snapshotSha: string): Promise<{
  log: OpLog
  ghostId: string
  placeId: string
  gearId: string
}> {
  const log = inMemoryOpLog()
  const author = anAuthor()
  const placeId = anId()
  const gearId = anId()
  await log.append(anOp(placeRecorded(placeId, 'Shed'), author))
  await log.append(
    anOp(
      gearRecorded(gearId, { name: 'Tent', container: false, kind: 'single' }),
      author,
    ),
  )

  const ghostId = anId()
  const ghost: DepotState = fold(
    [anOp(placeRecorded(ghostId, 'Attic'), author)],
    emptyState(),
  )
  const snapshot: DepotSnapshot = { sha: snapshotSha, lsn: 1, state: ghost }
  await log.writeMeta('snapshot', snapshot)

  return { log, ghostId, placeId, gearId }
}

// ---------------------------------------------------------------------------
// The first Person — `auth/pendingFirstPerson.ts`'s seam, now closed
// ---------------------------------------------------------------------------

describe('flushPendingFirstPerson', () => {
  const PERSON = 'dddddddd-0000-7000-8000-000000000001'

  function aPending(): PendingFirstPerson {
    return { personId: PERSON, householdId: HOUSEHOLD, name: 'Bran' }
  }

  /** A real store over `log` — it is the store that satisfies `OpEmitter`. */
  function storeOver(log: OpLog) {
    const { factory } = fakeEngines()
    return startStore({ log, engine: factory })
  }

  it('flushPendingFirstPerson emits person.recorded with the pre-bound id', async () => {
    const log = inMemoryOpLog()
    const store = storeOver(log)
    await drained(store)
    const pending = aPending()
    const pendingStore: PendingStore = inMemoryPendingStore(pending)

    const emitted = await flushPendingFirstPerson(
      pending,
      store.getState(),
      pendingStore,
    )

    expect(emitted).toBe(true)
    const records = await log.all()
    expect(records).toHaveLength(1)
    expect(records[0]!.op.type).toBe('person.recorded')
    // The Invite's id, never a fresh one: this is what makes "a Login is
    // always a Person" true from the household's first second.
    expect(records[0]!.op.aggregate_id).toBe(PERSON)
    expect(records[0]!.op.payload['name']).toBe('Bran')
    expect(store.getState().state.people[PERSON]?.name?.value).toBe('Bran')
  })

  it('flushPendingFirstPerson clears the pending record only after the append', async () => {
    const log = gatedLog(inMemoryOpLog())
    const store = storeOver(log)
    const pending = aPending()
    const pendingStore: PendingStore = inMemoryPendingStore(pending)

    const flushing = flushPendingFirstPerson(
      pending,
      store.getState(),
      pendingStore,
    )
    await tick()

    // The append has not completed, so the record must still be there: it is
    // the local log that is the source of truth, and until the op is in it
    // nothing may be thrown away.
    expect(await pendingStore.read()).not.toBeNull()

    log.release()
    expect(await flushing).toBe(true)
    expect(await pendingStore.read()).toBeNull()
  })

  it('flushPendingFirstPerson keeps the pending record when the append fails', async () => {
    // The one append this flush makes is refused, so there is no
    // `person.recorded` in the log — and the joiner's name is the only copy
    // of something that can never be re-derived. Clearing it here would
    // leave the Login pointing at a Person nobody ever created, forever.
    const log = failingLog(inMemoryOpLog(), 1)
    const store = storeOver(log)
    await drained(store)
    const pending = aPending()
    const pendingStore: PendingStore = inMemoryPendingStore(pending)

    expect(
      await flushPendingFirstPerson(pending, store.getState(), pendingStore),
    ).toBe(false)
    expect(await pendingStore.read()).toEqual(pending)
    expect(await log.all()).toHaveLength(0)

    // …and the retry, once the log takes writes again, still authors the
    // pre-bound id.
    expect(
      await flushPendingFirstPerson(pending, store.getState(), pendingStore),
    ).toBe(true)
    expect(await pendingStore.read()).toBeNull()
    const records = await log.all()
    expect(records).toHaveLength(1)
    expect(records[0]!.op.aggregate_id).toBe(PERSON)
  })

  it('flushPendingFirstPerson is a no-op when nothing is pending', async () => {
    const log = inMemoryOpLog()
    const store = storeOver(log)
    await drained(store)
    const pendingStore: PendingStore = inMemoryPendingStore(null)

    expect(
      await flushPendingFirstPerson(null, store.getState(), pendingStore),
    ).toBe(false)
    await drained(store)
    expect(await log.all()).toHaveLength(0)
  })

  it('flushPendingFirstPerson does not emit a second op when run twice', async () => {
    const log = inMemoryOpLog()
    const store = storeOver(log)
    await drained(store)
    const pending = aPending()
    const pendingStore: PendingStore = inMemoryPendingStore(pending)

    expect(
      await flushPendingFirstPerson(pending, store.getState(), pendingStore),
    ).toBe(true)
    expect(
      await flushPendingFirstPerson(pending, store.getState(), pendingStore),
    ).toBe(false)

    await drained(store)
    const records = await log.all()
    expect(records).toHaveLength(1)
    expect(records[0]!.op.type).toBe('person.recorded')
  })
})
