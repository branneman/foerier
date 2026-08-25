import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { OpEnvelope } from '@foerier/shared'
import { countingIdSource, fakeClock } from '@foerier/shared/testUtils'
import type { FakeClock } from '@foerier/shared/testUtils'

import type { Database } from '../../src/db/schema.ts'
import { createSyncService, type SyncService } from '../../src/sync/service.ts'
import { resetHouseholds, seedHousehold, NOW } from './harness.ts'
import { testDb } from './testDb.ts'

/**
 * The sync service — push, pull, and sequence assignment
 * (`docs/sync-protocol.md` §6.1, §6.4, §6.6, §8.1).
 *
 * Tier 2s, against the real local Postgres: every claim in this file is about
 * what a transaction and a row lock actually do, and none of it survives being
 * asserted against a fake.
 *
 * UUID registry slots #6 and #7 (`docs/testing.md`). Household B exists so the
 * per-household claims — `household_seq` counts *this* household's ops, a pull
 * sees only its own — are proved against a database that holds another
 * household's ops at the same time, not against an empty one.
 */
describe('the sync service', () => {
  const HOUSEHOLD_A = '0f000006-0000-4000-8000-000000000006'
  const HOUSEHOLD_B = '0f000007-0000-4000-8000-000000000007'

  const DEVICE_A = '0198c33d-77aa-7e10-a4bb-0c9d8e7f6a5b'
  const DEVICE_B = '0198c33d-88bb-7e10-a4bb-0c9d8e7f6a5c'
  const AGGREGATE_ID = '0198e0b7-2a11-7f4c-93de-5a6b7c8d9e0f'

  let db: Kysely<Database>
  let clock: FakeClock
  let sync: SyncService
  let ids: ReturnType<typeof countingIdSource>

  beforeAll(async () => {
    db = await testDb()
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await resetHouseholds(db, [HOUSEHOLD_A, HOUSEHOLD_B])
    await seedHousehold(db, { id: HOUSEHOLD_A, name: 'Veldkamp' })
    await seedHousehold(db, { id: HOUSEHOLD_B, name: 'Oosterhuis' })
    clock = fakeClock(NOW)
    sync = createSyncService({ db, clock })
    ids = countingIdSource(1)
  })

  /** A fresh, well-formed envelope every call — nothing shared to mutate. */
  function anOp(overrides: Partial<OpEnvelope> = {}): OpEnvelope {
    return {
      id: ids.next(),
      household_id: HOUSEHOLD_A,
      aggregate: 'gear',
      aggregate_id: AGGREGATE_ID,
      type: 'gear.recorded',
      hlc: '2026-08-25T09:00:00.000Z-0000',
      device_id: DEVICE_A,
      payload: { name: 'Tent' },
      ...overrides,
    }
  }

  /** Every seq stored for one household, ascending — the gaplessness probe. */
  async function storedSeqs(householdId: string): Promise<number[]> {
    const rows = await db
      .selectFrom('op')
      .select('seq')
      .where('household_id', '=', householdId)
      .orderBy('seq', 'asc')
      .execute()
    return rows.map((row) => row.seq)
  }

  async function householdSeq(householdId: string): Promise<number> {
    const row = await db
      .selectFrom('household')
      .select('op_seq')
      .where('id', '=', householdId)
      .executeTakeFirstOrThrow()
    return row.op_seq
  }

  describe('push', () => {
    it('assigns consecutive seqs in request order', async () => {
      const ops = [anOp(), anOp(), anOp()]

      const result = await sync.push(HOUSEHOLD_A, ops)

      expect(result.results).toEqual([
        { op_id: ops[0]!.id, status: 'accepted', seq: 1 },
        { op_id: ops[1]!.id, status: 'accepted', seq: 2 },
        { op_id: ops[2]!.id, status: 'accepted', seq: 3 },
      ])
      expect(result.household_seq).toBe(3)

      // Request order, not insertion order the database happened to pick.
      const stored = await db
        .selectFrom('op')
        .select(['op_id', 'seq'])
        .where('household_id', '=', HOUSEHOLD_A)
        .orderBy('seq', 'asc')
        .execute()
      expect(stored.map((row) => row.op_id)).toEqual(ops.map((op) => op.id))
    })

    it('leaves no gap when a batch is entirely re-pushed', async () => {
      const ops = [anOp(), anOp(), anOp()]
      await sync.push(HOUSEHOLD_A, ops)

      const again = await sync.push(HOUSEHOLD_A, ops)

      expect(again.results.map((r) => r.status)).toEqual([
        'duplicate',
        'duplicate',
        'duplicate',
      ])
      // The trap: reserving three seqs for three submitted ops and letting
      // ON CONFLICT DO NOTHING swallow the re-pushes burns 4, 5 and 6 on rows
      // that never exist. A cursor survives that; the first-sync fold, which
      // reads household_seq as the op count, over-reports forever.
      expect(await storedSeqs(HOUSEHOLD_A)).toEqual([1, 2, 3])
      expect(again.household_seq).toBe(3)
      expect(await householdSeq(HOUSEHOLD_A)).toBe(3)
    })

    it('leaves no gap when a batch mixes new ops and re-pushes', async () => {
      const [first, second] = [anOp(), anOp()]
      await sync.push(HOUSEHOLD_A, [first, second])

      const third = anOp()
      const fourth = anOp()
      // The last element repeats an op from *within this same batch* — the
      // other way a re-push arrives. It is a duplicate of the third, not a
      // second row, and it must reserve nothing of its own.
      const result = await sync.push(HOUSEHOLD_A, [
        first,
        third,
        second,
        fourth,
        third,
      ])

      expect(result.results).toEqual([
        { op_id: first.id, status: 'duplicate', seq: 1 },
        { op_id: third.id, status: 'accepted', seq: 3 },
        { op_id: second.id, status: 'duplicate', seq: 2 },
        { op_id: fourth.id, status: 'accepted', seq: 4 },
        { op_id: third.id, status: 'duplicate', seq: 3 },
      ])
      // Two new ops in a batch of five means exactly two new seqs.
      expect(await storedSeqs(HOUSEHOLD_A)).toEqual([1, 2, 3, 4])
      expect(result.household_seq).toBe(4)
    })

    it('returns the original seq for a duplicate, and does not update received_at', async () => {
      const op = anOp()
      const first = await sync.push(HOUSEHOLD_A, [op])
      expect(first.results[0]).toEqual({
        op_id: op.id,
        status: 'accepted',
        seq: 1,
      })

      const receivedAt = async (): Promise<Date> => {
        const row = await db
          .selectFrom('op')
          .select('received_at')
          .where('household_id', '=', HOUSEHOLD_A)
          .where('op_id', '=', op.id)
          .executeTakeFirstOrThrow()
        return row.received_at
      }
      const before = await receivedAt()

      // A day later — an outbox retrying after an ambiguous timeout. The
      // re-push must be invisible to every other client (§8.1): same seq, and
      // a received_at that did not move.
      clock.advance(24 * 60 * 60 * 1000)
      const again = await sync.push(HOUSEHOLD_A, [op])

      expect(again.results[0]).toEqual({
        op_id: op.id,
        status: 'duplicate',
        seq: 1,
      })
      expect((await receivedAt()).getTime()).toBe(before.getTime())
      expect(before.getTime()).toBe(NOW)
    })

    it('commits accepted ops even when a neighbour is rejected', async () => {
      const good = anOp()
      const foreign = anOp({ household_id: HOUSEHOLD_B })
      const alsoGood = anOp()

      const result = await sync.push(HOUSEHOLD_A, [good, foreign, alsoGood])

      expect(result.results).toEqual([
        { op_id: good.id, status: 'accepted', seq: 1 },
        {
          op_id: foreign.id,
          status: 'rejected',
          code: 'household_mismatch',
        },
        { op_id: alsoGood.id, status: 'accepted', seq: 2 },
      ])
      // The batch is atomic in the database and per-op in the response: one
      // bad op must not roll back — or wedge the outbox behind — its
      // neighbours (§6.1).
      expect(await storedSeqs(HOUSEHOLD_A)).toEqual([1, 2])
      expect(result.household_seq).toBe(2)
      // …and the rejected op went nowhere, least of all household B.
      expect(await storedSeqs(HOUSEHOLD_B)).toEqual([])
    })

    it('stores nothing at all when every op in the batch is rejected', async () => {
      const result = await sync.push(HOUSEHOLD_A, [
        'not an op at all',
        anOp({ id: 'not-a-uuid' }),
        anOp({ hlc: 'yesterday' }),
      ])

      expect(result.results.map((r) => r.status)).toEqual([
        'rejected',
        'rejected',
        'rejected',
      ])
      expect(result.results.map((r) => r.code)).toEqual([
        'envelope_invalid',
        'op_id_invalid',
        'hlc_invalid',
      ])
      // A value that is not even an object has no id to echo; request order
      // is what matches it back to the outbox entry.
      expect(result.results[0]?.op_id).toBe('')
      expect(await storedSeqs(HOUSEHOLD_A)).toEqual([])
      // No seq was reserved for an op that was never going to be stored.
      expect(result.household_seq).toBe(0)
      expect(await householdSeq(HOUSEHOLD_A)).toBe(0)
    })

    it('returns one result per submitted op, in request order', async () => {
      const known = anOp()
      await sync.push(HOUSEHOLD_A, [known])

      const fresh = anOp()
      const bad = anOp({ household_id: HOUSEHOLD_B })
      const alsoFresh = anOp()

      const result = await sync.push(HOUSEHOLD_A, [
        fresh,
        known,
        bad,
        alsoFresh,
      ])

      expect(result.results).toHaveLength(4)
      expect(result.results.map((r) => r.op_id)).toEqual([
        fresh.id,
        known.id,
        bad.id,
        alsoFresh.id,
      ])
      expect(result.results.map((r) => r.status)).toEqual([
        'accepted',
        'duplicate',
        'rejected',
        'accepted',
      ])
      // An accepted op carries a seq and no code; a rejection the reverse.
      expect(Object.hasOwn(result.results[0]!, 'code')).toBe(false)
      expect(Object.hasOwn(result.results[2]!, 'seq')).toBe(false)
    })

    it('household_seq equals the number of ops stored for that household', async () => {
      await sync.push(HOUSEHOLD_A, [anOp(), anOp(), anOp()])
      const b = await sync.push(HOUSEHOLD_B, [
        anOp({ household_id: HOUSEHOLD_B }),
        anOp({ household_id: HOUSEHOLD_B }),
      ])

      // Gapless is what lets the first-sync fold read household_seq as "how
      // many ops am I about to receive" and show a determinate number (§7.6).
      const a = await sync.push(HOUSEHOLD_A, [anOp()])
      expect(a.household_seq).toBe((await storedSeqs(HOUSEHOLD_A)).length)
      expect(a.household_seq).toBe(4)
      expect(b.household_seq).toBe((await storedSeqs(HOUSEHOLD_B)).length)
      expect(b.household_seq).toBe(2)

      const pulled = await sync.pull(HOUSEHOLD_A, 0)
      expect(pulled.household_seq).toBe(pulled.ops.length)
    })
  })

  describe('pull', () => {
    it('pull returns ops with seq strictly greater than since', async () => {
      const ops = [anOp(), anOp(), anOp()]
      await sync.push(HOUSEHOLD_A, ops)

      const page = await sync.pull(HOUSEHOLD_A, 1)

      expect(page.ops.map((op) => op.seq)).toEqual([2, 3])
      expect(page.ops.map((op) => op.id)).toEqual([ops[1]!.id, ops[2]!.id])
      expect(page.cursor).toBe(3)
      expect(page.has_more).toBe(false)
      expect(page.household_seq).toBe(3)
    })

    it('pull echoes since as the cursor when the page is empty', async () => {
      await sync.push(HOUSEHOLD_A, [anOp(), anOp(), anOp()])

      const page = await sync.pull(HOUSEHOLD_A, 3)

      expect(page.ops).toEqual([])
      // Not 0, and not the high-water mark: the client's own cursor back, so
      // a caught-up client does not rewind and re-fold the whole log.
      expect(page.cursor).toBe(3)
      expect(page.has_more).toBe(false)
      expect(page.household_seq).toBe(3)
    })

    it('pull sets has_more when the page is truncated by limit', async () => {
      await sync.push(HOUSEHOLD_A, [anOp(), anOp(), anOp()])

      const first = await sync.pull(HOUSEHOLD_A, 0, 2)
      expect(first.ops.map((op) => op.seq)).toEqual([1, 2])
      expect(first.has_more).toBe(true)
      expect(first.cursor).toBe(2)

      const second = await sync.pull(HOUSEHOLD_A, first.cursor, 2)
      expect(second.ops.map((op) => op.seq)).toEqual([3])
      expect(second.has_more).toBe(false)
      expect(second.cursor).toBe(3)
    })

    it('pull clamps limit to 1000', async () => {
      const ops = Array.from({ length: 1001 }, () => anOp())
      await sync.push(HOUSEHOLD_A, ops)

      const page = await sync.pull(HOUSEHOLD_A, 0, 5000)

      expect(page.ops).toHaveLength(1000)
      expect(page.ops[999]?.seq).toBe(1000)
      expect(page.cursor).toBe(1000)
      expect(page.has_more).toBe(true)
      expect(page.household_seq).toBe(1001)
    })

    it("pull returns the pushing device's own ops", async () => {
      const mine = anOp({ device_id: DEVICE_A })
      const theirs = anOp({ device_id: DEVICE_B })
      await sync.push(HOUSEHOLD_A, [mine, theirs])

      const page = await sync.pull(HOUSEHOLD_A, 0)

      // Filtering by device would save a little bandwidth and cost a device
      // the ability to recover its own work after a local wipe (§6.4).
      expect(page.ops.map((op) => op.id)).toEqual([mine.id, theirs.id])
      expect(page.ops.map((op) => op.device_id)).toEqual([DEVICE_A, DEVICE_B])
    })

    it('pull returns an unknown op type unchanged', async () => {
      // The server has no op vocabulary (§6.2): an aggregate and a type it has
      // never heard of, carrying payload fields it has never heard of, must
      // round-trip byte for byte — that is what lets a new client deploy
      // ahead of the server.
      const alien = anOp({
        aggregate: 'starship',
        type: 'starship.warped',
        payload: {
          destination: 'Risa',
          warp_factor: 9.975,
          crew: ['Ada', 'Bran'],
          nested: { deeper: { still: null } },
        },
      })

      await sync.push(HOUSEHOLD_A, [alien])
      const page = await sync.pull(HOUSEHOLD_A, 0)

      expect(page.ops).toHaveLength(1)
      const [stored] = page.ops
      expect(stored).toEqual({
        ...alien,
        seq: 1,
        received_at: new Date(NOW).toISOString(),
      })
    })
  })
})
