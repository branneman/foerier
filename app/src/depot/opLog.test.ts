import 'fake-indexeddb/auto'

import { formatHlc, type OpEnvelope, type StoredOp } from '@foerier/shared'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'

import { DB_NAME } from '../db'
import { indexedDbOpLog, inMemoryOpLog, type OpLog } from './opLog'

/**
 * The same suite runs against both implementations (`describe.each` below),
 * so `inMemoryOpLog` — the fake every tier above this one relies on — is
 * proved to *behave* like `indexedDbOpLog`, not merely resemble it
 * (`docs/testing.md`).
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

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
    hlc: formatHlc({ ms: 1_700_000_000_000, counter: nextId }),
    device_id: DEVICE,
    payload: {},
    ...overrides,
  }
}

function toStoredOp(op: OpEnvelope, seq: number): StoredOp {
  return { ...op, seq, received_at: '2026-08-25T00:00:00.000Z' }
}

/** Isolates every test — including the fresh-database tests below — from
 * whatever the previous test left behind. A harmless no-op when nothing has
 * ever opened `foerier`. */
function deleteFoerierDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onblocked = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('delete failed'))
  })
}

beforeEach(() => deleteFoerierDb())

const implementations: readonly (readonly [string, () => OpLog])[] = [
  ['inMemoryOpLog', inMemoryOpLog],
  ['indexedDbOpLog', indexedDbOpLog],
]

describe.each(implementations)('opLog (%s)', (_label, createLog) => {
  let log: OpLog

  beforeEach(() => {
    log = createLog()
  })

  it('assigns increasing lsns in append order', async () => {
    const first = await log.append(anOp())
    const second = await log.append(anOp())
    const third = await log.append(anOp())

    expect(first.lsn).toBe(1)
    expect(second.lsn).toBe(2)
    expect(third.lsn).toBe(3)
  })

  it('appends a locally-authored op with a null seq', async () => {
    const logged = await log.append(anOp())

    expect(logged.seq).toBeNull()
    expect(logged.deadLettered).toBe(false)
  })

  it('lists an appended op in the outbox', async () => {
    const logged = await log.append(anOp())

    const outbox = await log.outbox(10)
    expect(outbox.map((entry) => entry.op.id)).toEqual([logged.op.id])
  })

  it('removes an op from the outbox once markPushed writes its seq', async () => {
    const logged = await log.append(anOp())
    await log.markPushed([{ opId: logged.op.id, seq: 12 }])

    expect(await log.outbox(10)).toEqual([])

    const [record] = await log.since(0)
    expect(record?.seq).toBe(12)
  })

  it('removes an op from the outbox once ingest delivers it back with a seq', async () => {
    const op = anOp()
    await log.append(op)
    await log.ingest([toStoredOp(op, 34)])

    expect(await log.outbox(10)).toEqual([])

    // Guards the specific bug the name describes: an ingest that both
    // updates the existing row *and* inserts a duplicate would also leave
    // the outbox empty, so an empty outbox alone cannot tell them apart.
    const all = await log.all()
    expect(all).toHaveLength(1)
    expect(all[0]?.seq).toBe(34)
  })

  it('ingest does not duplicate an op already in the log', async () => {
    const op = anOp()
    await log.append(op)
    await log.ingest([toStoredOp(op, 5)])

    expect(await log.all()).toHaveLength(1)
  })

  it('ingest is idempotent for a page delivered twice', async () => {
    const stored = toStoredOp(anOp(), 9)

    await log.ingest([stored])
    await log.ingest([stored])

    const all = await log.all()
    expect(all).toHaveLength(1)
    expect(all[0]?.seq).toBe(9)
  })

  it('keeps a dead-lettered op in the log but out of the outbox', async () => {
    const logged = await log.append(anOp())
    await log.deadLetter([{ opId: logged.op.id, code: 'envelope_invalid' }])

    expect(await log.outbox(10)).toEqual([])

    const all = await log.all()
    expect(all).toHaveLength(1)
    expect(all[0]?.deadLettered).toBe(true)

    expect(await log.deadLetters()).toEqual([
      { opId: logged.op.id, code: 'envelope_invalid' },
    ])
  })

  it("orders deadLetters by the op's lsn, not opId or dead-letter call order", async () => {
    // Ids are deliberately *not* in append order, so a `deadLetters()` that
    // (mis)sorts by `opId` — which the real store's `getAll()` would do if
    // nothing else were asked of it — fails this the same way a naive
    // Map-insertion-order fake would, just from the other direction.
    const first = await log.append(
      anOp({ id: 'ffffffff-0000-7000-8000-000000000001' }),
    )
    const second = await log.append(
      anOp({ id: '11111111-0000-7000-8000-000000000002' }),
    )
    const third = await log.append(
      anOp({ id: '77777777-0000-7000-8000-000000000003' }),
    )

    // Dead-lettered out of both lsn order and opId order.
    await log.deadLetter([{ opId: third.op.id, code: 'envelope_invalid' }])
    await log.deadLetter([{ opId: first.op.id, code: 'envelope_invalid' }])
    await log.deadLetter([{ opId: second.op.id, code: 'envelope_invalid' }])

    expect(await log.deadLetters()).toEqual([
      { opId: first.op.id, code: 'envelope_invalid' },
      { opId: second.op.id, code: 'envelope_invalid' },
      { opId: third.op.id, code: 'envelope_invalid' },
    ])
  })

  it('rejects appending an op whose id is already in the log', async () => {
    // The real store's unique index on `op.id` throws `ConstraintError` here;
    // the fake must fail the same way rather than silently double-writing.
    const op = anOp()
    await log.append(op)

    await expect(log.append(op)).rejects.toThrow()
  })

  it('since(lsn) returns only records appended after that lsn', async () => {
    const first = await log.append(anOp())
    const second = await log.append(anOp())
    const third = await log.append(anOp())

    const after = await log.since(first.lsn)

    expect(after.map((entry) => entry.lsn)).toEqual([second.lsn, third.lsn])
  })

  it('round-trips meta values, and returns null for an unset key', async () => {
    await log.writeMeta('cursor', 481)

    expect(await log.readMeta<number>('cursor')).toBe(481)
    expect(await log.readMeta('hlc')).toBeNull()
  })

  it('never mutates a stored op', async () => {
    // Carries an unknown field too, so this also confirms it survives every
    // operation below that touches the record's bookkeeping — not just a
    // fresh append (that half is `preserves an unknown envelope field...`).
    const withExtra = { ...anOp(), future_field: 'unrecognised' } as OpEnvelope
    const before = structuredClone(withExtra)

    const logged = await log.append(withExtra)
    await log.markPushed([{ opId: withExtra.id, seq: 3 }])
    await log.deadLetter([{ opId: withExtra.id, code: 'envelope_invalid' }])
    await log.ingest([toStoredOp(withExtra, 3)])

    // `seq` and `deadLettered` are expected to change by now — only the op
    // envelope itself must stay byte-identical to what was authored (§5.3
    // obligation 6, load-bearing for the idempotent re-push in §8.1).
    const [record] = await log.since(0)
    expect(record?.op).toEqual(before)
    expect(logged.op).not.toBe(withExtra)
  })

  it('preserves an unknown envelope field through a store and a read', async () => {
    const withExtra = { ...anOp(), future_field: 'unrecognised' }
    await log.append(withExtra as OpEnvelope)

    const [stored] = await log.since(0)
    const storedOp = stored?.op as unknown as Record<string, unknown>

    expect(Object.hasOwn(storedOp, 'future_field')).toBe(true)
    expect(storedOp['future_field']).toBe('unrecognised')
  })
})

describe('indexedDbOpLog', () => {
  beforeEach(() => deleteFoerierDb())

  it('carries the auth store through the version 1 to 2 upgrade', async () => {
    const AUTH_STORE = 'auth'
    const SESSION_KEY = 'session'
    const seeded = { token: 'foe_test', loginId: '0f0000a1' }

    const v1 = await openDB(DB_NAME, 1, {
      upgrade(database) {
        database.createObjectStore(AUTH_STORE)
      },
    })
    await v1.put(AUTH_STORE, seeded, SESSION_KEY)
    v1.close()

    // Opening the op log runs the version 2 upgrade.
    await indexedDbOpLog().all()

    const v2 = await openDB(DB_NAME, 2)
    const survived = await v2.get(AUTH_STORE, SESSION_KEY)
    v2.close()

    expect(survived).toEqual(seeded)
  })
})
