import {
  formatHlc,
  gearRecorded,
  systemIdSource,
  type Clock,
  type HlcParts,
  type IdSource,
  type OpEnvelope,
} from '@foerier/shared'
import { afterEach, describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'

import type { Session } from '../auth/sessionStore'
import { inMemoryOpLog, type OpLog } from './opLog'
import type { HouseholdStoreState } from './store'
import { createFakeServer, fakeTransport, type Transport } from './transport'
import { createSessionHousehold, restoreHlcClock } from './wiring'

/**
 * The wiring, driven over real fakes — an in-memory log and the in-memory
 * server behind `fakeTransport`, never a mocking framework
 * (`docs/testing.md`).
 *
 * The obligation under test that nothing else in the repo covers is
 * `docs/sync-protocol.md` §2.3: **the device persists the last HLC it issued
 * alongside its op log, and survives a restart with it.** A device that loses
 * it re-issues timestamps it has already used, which is the one path that
 * makes §3.6's `device_id` tiebreak reachable between a device and its own
 * past.
 */

const BASE_MS = 1_700_000_000_000
const SESSION: Session = {
  token: 'foe_test',
  loginId: '0f0000a1-0000-4000-8000-0000000000a1',
  personId: '0f0000a2-0000-4000-8000-0000000000a2',
  householdId: '0f0000a3-0000-4000-8000-0000000000a3',
  deviceId: '0f0000a4-0000-4000-8000-0000000000a4',
}

let nextId = 0
function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}
const ids: IdSource = { next: anId }

function fixedClock(now = BASE_MS): Clock {
  return { now: () => now }
}

/** One macrotask — long enough for the coalesced `meta.hlc` write and for the
 * engine's own queue to settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function until(
  condition: () => boolean | Promise<boolean>,
  attempts = 100,
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (await condition()) return
    await tick()
  }
  throw new Error('the condition never held')
}

const stores: StoreApi<HouseholdStoreState>[] = []

/** Every store here starts an engine, which arms an interval and two DOM
 * listeners. Nothing is left running between cases. */
async function depot(
  log: OpLog,
  transport: Transport,
): Promise<StoreApi<HouseholdStoreState>> {
  const store = await createSessionHousehold(SESSION, {
    log,
    transport,
    clock: fixedClock(),
    ids,
  })
  stores.push(store)
  return store
}

/** A server that is simply not there — every call a network failure, for as
 * long as the test needs it. */
const unreachable: Transport = {
  push: () => Promise.resolve({ ok: false, status: 0, code: 'network' }),
  pull: () => Promise.resolve({ ok: false, status: 0, code: 'network' }),
}

afterEach(() => {
  for (const store of stores.splice(0)) store.getState().stopSync()
})

function anOtherDeviceOp(): OpEnvelope {
  const spec = gearRecorded(anId(), {
    name: 'Beil',
    container: false,
    kind: 'single',
  })
  return {
    id: anId(),
    household_id: SESSION.householdId,
    aggregate: spec.aggregate,
    aggregate_id: spec.aggregate_id,
    type: spec.type,
    hlc: formatHlc({ ms: BASE_MS, counter: 1 }),
    device_id: '0f0000b4-0000-4000-8000-0000000000b4',
    payload: spec.payload,
  }
}

describe('the hlc restored from meta.hlc', () => {
  it('issues strictly after the state the previous session saved', async () => {
    const log = inMemoryOpLog()
    // Saved from a session whose wall clock ran ahead of this one's — the
    // case a plain `Date.now()` clock gets wrong.
    await log.writeMeta('hlc', { ms: BASE_MS + 5_000, counter: 3 })

    const hlc = await restoreHlcClock(log, fixedClock(BASE_MS))

    expect(hlc.issue()).toBe(formatHlc({ ms: BASE_MS + 5_000, counter: 4 }))
  })

  it('never re-issues an hlc it issued before the restart', async () => {
    const log = inMemoryOpLog()

    const before = await restoreHlcClock(log, fixedClock())
    before.issue()
    const last = before.issue()
    await tick()

    // The reload: a brand-new clock over the same log.
    const after = await restoreHlcClock(log, fixedClock())

    expect(after.issue() > last).toBe(true)
  })

  it('writes the state back after issuing', async () => {
    const log = inMemoryOpLog()
    const hlc = await restoreHlcClock(log, fixedClock())

    hlc.issue()
    hlc.issue()
    await tick()

    expect(await log.readMeta<HlcParts>('hlc')).toEqual(hlc.state())
  })

  it('writes the state back after receiving, so a peer pulls us forward', async () => {
    const log = inMemoryOpLog()
    const hlc = await restoreHlcClock(log, fixedClock())

    hlc.receive(formatHlc({ ms: BASE_MS + 9_000, counter: 2 }))
    await tick()

    expect(await log.readMeta<HlcParts>('hlc')).toEqual({
      ms: BASE_MS + 9_000,
      counter: 3,
    })
  })

  it('starts from zero rather than throwing when the saved state is junk', async () => {
    const log = inMemoryOpLog()
    await log.writeMeta('hlc', 'not an hlc')

    const hlc = await restoreHlcClock(log, fixedClock())

    expect(hlc.issue()).toBe(formatHlc({ ms: BASE_MS, counter: 0 }))
  })

  it('starts from zero when the log cannot be read at all', async () => {
    const unreadable: OpLog = {
      ...inMemoryOpLog(),
      readMeta: () => Promise.reject(new Error('IndexedDB is unavailable')),
    }

    const hlc = await restoreHlcClock(unreadable, fixedClock())

    expect(hlc.issue()).toBe(formatHlc({ ms: BASE_MS, counter: 0 }))
  })
})

describe('the session depot', () => {
  it('syncs on construction rather than waiting out the heartbeat', async () => {
    // A cold start that waited 30 seconds for the interval would show the
    // Quartermaster yesterday's household.
    const server = createFakeServer()
    server.push([anOtherDeviceOp()])
    const log = inMemoryOpLog()

    const store = await depot(log, fakeTransport(server))

    await until(() => Object.keys(store.getState().state.gear).length === 1)
    expect(Object.values(store.getState().state.gear)[0]?.name?.value).toBe(
      'Beil',
    )
  })

  it('pushes what the previous session queued offline', async () => {
    const server = createFakeServer()
    const log = inMemoryOpLog()

    // Author against a first session, with the server unreachable.
    const first = await depot(log, unreachable)
    first.getState().emit(
      gearRecorded(anId(), {
        name: 'Zeltbahn',
        container: false,
        kind: 'single',
      }),
    )
    await first.getState().drained()
    await until(async () => (await log.outbox(10)).length === 1)
    first.getState().stopSync()

    // The reload, now reachable.
    await depot(log, fakeTransport(server))

    await until(async () => (await log.outbox(10)).length === 0)
    expect((await log.all()).every((record) => record.seq !== null)).toBe(true)
  })

  it('stamps every op with the session and the restored clock', async () => {
    const log = inMemoryOpLog()
    await log.writeMeta('hlc', { ms: BASE_MS + 60_000, counter: 0 })

    const store = await depot(log, fakeTransport(createFakeServer()))
    store.getState().emit(
      gearRecorded(anId(), {
        name: 'Beil',
        container: false,
        kind: 'single',
      }),
    )
    await store.getState().drained()

    const [record] = await log.all()
    expect(record?.op.household_id).toBe(SESSION.householdId)
    expect(record?.op.device_id).toBe(SESSION.deviceId)
    expect(record?.op.hlc).toBe(formatHlc({ ms: BASE_MS + 60_000, counter: 1 }))
  })

  it('mints real UUIDv7 op ids by default', async () => {
    const log = inMemoryOpLog()
    const store = await createSessionHousehold(SESSION, {
      log,
      transport: fakeTransport(createFakeServer()),
      clock: fixedClock(),
    })
    stores.push(store)

    store.getState().emit(
      gearRecorded(systemIdSource.next(), {
        name: 'Bijl',
        container: false,
        kind: 'single',
      }),
    )
    await store.getState().drained()

    const [record] = await log.all()
    expect(record?.op.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
