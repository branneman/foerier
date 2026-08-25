import type { Kysely } from 'kysely'

import type { Clock, OpEnvelope, StoredOp } from '@foerier/shared'

import type { Database } from '../db/schema.ts'
import { validateOp, type RejectionCode } from './envelope.ts'

/**
 * The op store behind `/sync` — push, pull, and sequence assignment, exactly
 * `docs/sync-protocol.md` §6.1, §6.4, §6.6 and §8.1.
 *
 * This module is the thin server in its entirety (§6.2). It validates the
 * envelope, assigns a sequence, and hands ops back in sequence order. It has
 * **no op vocabulary**: it never inspects `type` beyond storing it and never
 * inspects `payload` beyond "is a JSON object", so an op type invented by a
 * client newer than this deploy is stored and returned unchanged.
 */

/**
 * A failure the sync service diagnosed itself, as opposed to one the driver
 * threw at it.
 *
 * Both become the same `server_error` to the client (§6.3 has no code for
 * this, and its per-op set is closed), so the distinction is entirely for the
 * operator: a `SyncError` in the log means an invariant this module owns was
 * violated and the batch was refused deliberately, not that Postgres was
 * unreachable. The route logs the two differently; the client cannot tell.
 */
export class SyncError extends Error {
  /** Precise in the log, never rendered to a client. */
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'SyncError'
    this.reason = reason
  }
}

/** One entry per submitted op, in request order, always (§6.1). */
export interface PushOutcome {
  op_id: string
  status: 'accepted' | 'duplicate' | 'rejected'
  /** Present on `accepted` and `duplicate`. A duplicate carries the seq the op
   * **already had** — never a new one (§8.1). */
  seq?: number
  /** Present on `rejected`, from the closed set in §6.3. */
  code?: RejectionCode
}

export interface PushResult {
  results: PushOutcome[]
  /** The household's high-water mark after the push. */
  household_seq: number
}

export interface PullResult {
  ops: StoredOp[]
  /** The highest seq in this page, or the request's `since` when it is empty. */
  cursor: number
  /** Whether `limit` truncated the page. */
  has_more: boolean
  /**
   * The household's high-water mark. Because seqs are gapless it *is* the op
   * count, which is what makes the first-sync progress determinate (§7.6).
   */
  household_seq: number
}

export interface SyncServiceDeps {
  db: Kysely<Database>
  clock: Clock
}

/** §6.4. */
export const DEFAULT_PULL_LIMIT = 500
export const MAX_PULL_LIMIT = 1000

/**
 * A submitted op's place in the outcome list, decided before any seq exists.
 *
 * `pending` and `repeat` both carry an *offset* into the run of new seqs the
 * counter is about to hand out rather than a seq, because the seqs are not
 * known until the counter has been bumped — and the counter cannot be bumped
 * until the whole batch has been classified, since the amount to bump it by
 * is the number of genuinely new ops.
 */
type Slot =
  | { kind: 'rejected'; op_id: string; code: RejectionCode }
  | { kind: 'duplicate'; op_id: string; seq: number }
  | { kind: 'pending'; op: OpEnvelope; offset: number }
  | { kind: 'repeat'; op_id: string; offset: number }

/**
 * The `op_id` to echo for an op that failed validation.
 *
 * A rejection can be a value with no usable `id` at all — `null`, a string,
 * an object whose `id` is a number. There is nothing to echo then, and the
 * client does not need one: `results` is in request order, always, so an
 * unidentifiable op is still matched to its outbox entry by position.
 */
function opIdOf(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) return ''
  const id = (raw as Record<string, unknown>)['id']
  return typeof id === 'string' ? id : ''
}

/**
 * §6.4: defaults to 500, maximum 1000.
 *
 * A nonsensical limit falls back to the default rather than being honoured.
 * A limit of 0 honoured literally would return an empty page with `has_more`
 * set forever — a sync that looks alive and never advances — which is a worse
 * answer than ignoring the client's bug. A malformed query parameter is the
 * route's `bad_request` to raise (§6.3); this is the floor under it.
 */
function pageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PULL_LIMIT
  const whole = Math.floor(limit)
  if (whole < 1) return DEFAULT_PULL_LIMIT
  return Math.min(whole, MAX_PULL_LIMIT)
}

export function createSyncService({ db, clock }: SyncServiceDeps) {
  /**
   * §6.1. One transaction for the batch, one outcome per submitted op.
   *
   * **The statement order below is load-bearing.** See the block comments;
   * every one of them describes a bug that a single-threaded test suite
   * cannot catch.
   */
  async function push(
    householdId: string,
    raw: unknown[],
  ): Promise<PushResult> {
    // Validation touches no database state, so it happens before the lock is
    // taken: holding a household's lock across it would serialise its pushes
    // for longer than the write actually needs.
    const validated = raw.map((op) => validateOp(op, householdId))

    return db.transaction().execute(async (trx) => {
      // 1. Serialise every push for this household, FIRST.
      //
      // This lock is what makes step 2 authoritative. Two concurrent
      // re-pushes of the same op must not both observe it as absent, or both
      // would reserve a seq and one of them would leave a hole where a row
      // never lands. Taking the lock before reading removes the window
      // entirely, at the cost of serialising writers *per household only*
      // (§6.6).
      const household = await trx
        .selectFrom('household')
        .select('op_seq')
        .where('id', '=', householdId)
        .forUpdate()
        .executeTakeFirstOrThrow()

      // 2. Which of these ops do we already hold?
      //
      // Reading before reserving — rather than reserving `n` seqs for `n`
      // submitted ops and letting `ON CONFLICT DO NOTHING` swallow the
      // re-pushes — is what keeps the sequence gapless. A burnt seq is
      // survivable for a cursor, which only ever asks "greater than", but not
      // for the first-sync fold, which reads `household_seq` as the op count
      // and would over-report forever.
      const candidates = [
        ...new Set(validated.flatMap((v) => (v.ok ? [v.op.id] : []))),
      ]
      const existing =
        candidates.length === 0
          ? []
          : await trx
              .selectFrom('op')
              .select(['op_id', 'seq'])
              .where('household_id', '=', householdId)
              .where('op_id', 'in', candidates)
              .execute()
      const storedSeq = new Map(existing.map((row) => [row.op_id, row.seq]))

      // 3. Classify the batch in request order, counting the new ops.
      //
      // A batch may also repeat an op *within itself*. The second occurrence
      // is a duplicate of the first, not a second row: it takes the seq the
      // first occurrence is about to get, and reserves nothing of its own.
      const offsetInBatch = new Map<string, number>()
      let newCount = 0
      const slots: Slot[] = validated.map((result, index) => {
        if (!result.ok) {
          return {
            kind: 'rejected',
            op_id: opIdOf(raw[index]),
            code: result.code,
          }
        }
        const op = result.op
        const already = storedSeq.get(op.id)
        if (already !== undefined) {
          return { kind: 'duplicate', op_id: op.id, seq: already }
        }
        const earlier = offsetInBatch.get(op.id)
        if (earlier !== undefined) {
          return { kind: 'repeat', op_id: op.id, offset: earlier }
        }
        const offset = newCount++
        offsetInBatch.set(op.id, offset)
        return { kind: 'pending', op, offset }
      })

      // 4. Reserve exactly that many seqs. The returned value is the top of a
      //    contiguous range; ops take consecutive seqs in request order
      //    (§6.6). Deliberately not a Postgres `SEQUENCE`: those are
      //    non-transactional, so a client can pull past a seq that has not
      //    committed yet and never see it again.
      const reserved =
        newCount === 0
          ? household.op_seq
          : (
              await trx
                .updateTable('household')
                .set((eb) => ({ op_seq: eb('op_seq', '+', newCount) }))
                .where('id', '=', householdId)
                .returning('op_seq')
                .executeTakeFirstOrThrow()
            ).op_seq
      const base = reserved - newCount

      // 5. Store the new ops. `received_at` is diagnostic only (§1.1) and is
      //    written once, never updated — a re-push must be invisible to every
      //    other client (§8.1).
      const receivedAt = new Date(clock.now())
      const rows = slots.flatMap((slot) =>
        slot.kind === 'pending'
          ? [
              {
                op_id: slot.op.id,
                household_id: householdId,
                seq: base + 1 + slot.offset,
                aggregate: slot.op.aggregate,
                aggregate_id: slot.op.aggregate_id,
                type: slot.op.type,
                hlc: slot.op.hlc,
                device_id: slot.op.device_id,
                payload: JSON.stringify(slot.op.payload),
                received_at: receivedAt,
              },
            ]
          : [],
      )

      if (rows.length > 0) {
        const inserted = await trx
          .insertInto('op')
          .values(rows)
          .onConflict((oc) => oc.column('op_id').doNothing())
          .returning('op_id')
          .execute()

        // `ON CONFLICT DO NOTHING` is §8.1's belt to step 2's braces: under
        // the household lock, an op this transaction classified as new cannot
        // already exist *in this household*. It can still collide on the
        // primary key, which is global — an `op_id` some other household
        // already stored, which means either a client bug or an attack. That
        // must not pass silently: the response would promise a seq that no
        // row occupies, which is precisely the gap the whole ordering above
        // exists to prevent. Fail the batch loudly instead.
        if (inserted.length !== rows.length) {
          // `RETURNING` already tells us which rows landed, so name the
          // offender rather than reporting a count an operator cannot act on.
          const stored = new Set(inserted.map((row) => row.op_id))
          const collided = rows
            .filter((row) => !stored.has(row.op_id))
            .map((row) => row.op_id)
          throw new SyncError(
            'op_id_collision',
            `op_id already stored outside household ${householdId}: ` +
              collided.join(', '),
          )
        }
      }

      const results: PushOutcome[] = slots.map((slot) => {
        switch (slot.kind) {
          case 'rejected':
            return { op_id: slot.op_id, status: 'rejected', code: slot.code }
          case 'duplicate':
            return { op_id: slot.op_id, status: 'duplicate', seq: slot.seq }
          case 'repeat':
            return {
              op_id: slot.op_id,
              status: 'duplicate',
              seq: base + 1 + slot.offset,
            }
          case 'pending':
            return {
              op_id: slot.op.id,
              status: 'accepted',
              seq: base + 1 + slot.offset,
            }
        }
      })

      return { results, household_seq: reserved }
    })
  }

  /**
   * §6.4. Ops with `seq > since`, ascending, capped at `limit`.
   *
   * **Every op, including the caller's own.** Filtering by device would save
   * a little bandwidth and cost a device the ability to recover its own work
   * after a local wipe.
   */
  async function pull(
    householdId: string,
    since: number,
    limit?: number,
  ): Promise<PullResult> {
    const size = pageSize(limit)

    // One row past the page, to answer `has_more` by observation rather than
    // by inferring it from the high-water mark.
    const rows = await db
      .selectFrom('op')
      .selectAll()
      .where('household_id', '=', householdId)
      .where('seq', '>', since)
      .orderBy('seq', 'asc')
      .limit(size + 1)
      .execute()

    const has_more = rows.length > size
    const page = has_more ? rows.slice(0, size) : rows

    // Read after the page, never before. A push that commits between the two
    // statements then shows up as a `household_seq` slightly ahead of the
    // cursor — the client pages once more and gets the ops. The reverse
    // ordering could report a high-water mark *below* a seq already handed
    // out, which is the one answer a determinate progress count must never
    // give.
    const household = await db
      .selectFrom('household')
      .select('op_seq')
      .where('id', '=', householdId)
      .executeTakeFirstOrThrow()

    const ops: StoredOp[] = page.map((row) => ({
      id: row.op_id,
      household_id: row.household_id,
      aggregate: row.aggregate,
      aggregate_id: row.aggregate_id,
      type: row.type,
      hlc: row.hlc,
      device_id: row.device_id,
      payload: row.payload,
      seq: row.seq,
      received_at: row.received_at.toISOString(),
    }))

    return {
      ops,
      cursor: ops.at(-1)?.seq ?? since,
      has_more,
      household_seq: household.op_seq,
    }
  }

  return { push, pull }
}

export type SyncService = ReturnType<typeof createSyncService>
