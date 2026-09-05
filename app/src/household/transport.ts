import type { OpEnvelope, StoredOp } from '@foerier/shared'

/**
 * The sync transport — the one place `fetch` is called for `/sync`
 * (`docs/sync-protocol.md` §6). Everything above this module (the sync
 * engine, the store) talks to a {@link Transport}, never to `fetch` directly,
 * so it can be driven against `fakeTransport` in every tier below Tier 4.
 *
 * `fetch` is injected — as `deps.fetch`, defaulting to `globalThis.fetch` —
 * rather than reached for globally, for the same reason `auth/api.ts` injects
 * it: tests hand it a real in-memory implementation instead of patching a
 * global (`docs/testing.md`).
 */

/** One entry per submitted op, in request order, always (§6.1). */
export interface PushOutcome {
  op_id: string
  status: 'accepted' | 'duplicate' | 'rejected'
  /** Present on `accepted` and `duplicate`. A duplicate carries the seq the
   * op **already had** — never a new one (§8.1). */
  seq?: number
  /** Present on `rejected`, from the closed set in §6.3. */
  code?: string
}

export interface PushBody {
  results: PushOutcome[]
  /** The household's high-water mark after the push. */
  household_seq: number
}

export interface PullBody {
  ops: StoredOp[]
  /** The highest seq in this page, or the request's `since` when it is empty. */
  cursor: number
  /** Whether `limit` truncated the page. */
  has_more: boolean
  /** The household's high-water mark, the same field push returns. */
  household_seq: number
}

/**
 * `ok: false`'s `code` is one of §6.3's closed set — `bad_request` ·
 * `unauthorized` · `payload_too_large` · `rate_limited` · `server_error` — or
 * `network` for a `fetch` that never reached the server, deliberately the
 * same class as `server_error` (both mean "retry with backoff").
 */
export type TransportResult<T> =
  | { ok: true; body: T }
  | { ok: false; status: number; code: string; retryAfter?: number }

export interface Transport {
  push(ops: readonly OpEnvelope[]): Promise<TransportResult<PushBody>>
  pull(since: number, limit: number): Promise<TransportResult<PullBody>>
}

export type Fetch = typeof globalThis.fetch

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** §6.3's per-status default, used only when the body carries no usable code. */
function defaultCodeFor(status: number): string {
  if (status === 400) return 'bad_request'
  if (status === 401) return 'unauthorized'
  if (status === 413) return 'payload_too_large'
  if (status === 429) return 'rate_limited'
  return 'server_error'
}

/**
 * Pulls a code out of a failed response's body, tolerating both shapes on
 * the wire: `/sync/*`'s `{ error: { code, message, detail } }` (§6.3) and
 * `/auth/*`'s flat `{ error: "unauthorized" }`. Never assumes either — a
 * body that matches neither, or fails to parse at all, falls back to the
 * status-code default rather than throwing.
 */
async function codeFrom(res: Response): Promise<string> {
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    return defaultCodeFor(res.status)
  }
  if (isPlainObject(parsed)) {
    const error = parsed['error']
    if (isPlainObject(error) && typeof error['code'] === 'string') {
      return error['code']
    }
    if (typeof error === 'string') return error
  }
  return defaultCodeFor(res.status)
}

function retryAfterFrom(res: Response): number | undefined {
  const header = res.headers.get('retry-after')
  if (header === null) return undefined
  const seconds = Number(header)
  return Number.isFinite(seconds) ? seconds : undefined
}

async function errorResultFrom<T>(res: Response): Promise<TransportResult<T>> {
  const code = await codeFrom(res)
  const retryAfter = retryAfterFrom(res)
  return {
    ok: false,
    status: res.status,
    code,
    ...(retryAfter === undefined ? {} : { retryAfter }),
  }
}

export function createHttpTransport(deps: {
  baseUrl: string
  token(): string | null
  fetch?: Fetch
}): Transport {
  const doFetch = deps.fetch ?? globalThis.fetch

  async function request<T>(
    path: string,
    init: RequestInit,
  ): Promise<TransportResult<T>> {
    const token = deps.token()

    let res: Response
    try {
      res = await doFetch(`${deps.baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        },
      })
    } catch {
      return { ok: false, status: 0, code: 'network' }
    }

    if (!res.ok) return errorResultFrom<T>(res)
    const body = (await res.json()) as T
    return { ok: true, body }
  }

  return {
    push: (ops) =>
      request<PushBody>('/sync/push', {
        method: 'POST',
        body: JSON.stringify({ ops }),
      }),

    pull: (since, limit) =>
      request<PullBody>(`/sync/pull?since=${since}&limit=${limit}`, {
        method: 'GET',
      }),
  }
}

// ---------------------------------------------------------------------------
// The fake — a real in-memory server, not a stub
// ---------------------------------------------------------------------------

/**
 * A queued response override for one method (`push` or `pull` have their own
 * queue — see {@link FakeServer}). `'error'` short-circuits the real logic
 * entirely, matching the real server: a batch-level 401/413/429/5xx is
 * decided before any op is read or stored. `'lost'` runs the real logic (so
 * a push's ops are genuinely committed, with real seqs) but reports back as
 * a network failure — §8.1's "the write lands, the reply does not".
 */
type QueuedOverride =
  | { kind: 'error'; status: number; code: string; retryAfter?: number }
  | { kind: 'lost' }

/**
 * The in-memory server behind {@link fakeTransport}. Assigns seqs exactly as
 * `api/src/sync/service.ts` does — dedupe against what is already stored,
 * then reserve a contiguous range for the genuinely new ops in request
 * order — so a duplicate always reports the seq it already had, never a
 * fresh one, and the sequence never gains a gap. It also mirrors the
 * within-batch case: a second occurrence of the same `op_id` in one push is
 * a duplicate of the first, not a second reservation.
 *
 * `queueError` and `queueLostResponse` are the drivable control surface,
 * each targeted at one `method`: `push` and `pull` each keep their own FIFO
 * queue, so queuing a failure for one never steals a call meant for the
 * other — load-bearing for a flush that pushes and then pulls in the same
 * round trip. `queueRejection` is a third, narrower override: it does not
 * touch the queue at all, but marks one `op_id` to come back `rejected` the
 * next time it appears in a `push`, consumed on that use. A rejected op
 * takes no seq and never advances `household_seq` — it never enters the
 * transaction at all, mirroring the real service, where a per-op rejection
 * is decided by validation before the household lock is even taken.
 */
export interface FakeServer {
  push(ops: readonly OpEnvelope[]): TransportResult<PushBody>
  pull(since: number, limit: number): TransportResult<PullBody>
  queueError(
    method: 'push' | 'pull',
    error: { status: number; code: string; retryAfter?: number },
  ): void
  queueLostResponse(method: 'push' | 'pull'): void
  queueRejection(opId: string, code: string): void
}

function overrideResult<T>(override: {
  status: number
  code: string
  retryAfter?: number
}): TransportResult<T> {
  return {
    ok: false,
    status: override.status,
    code: override.code,
    ...(override.retryAfter === undefined
      ? {}
      : { retryAfter: override.retryAfter }),
  }
}

export function createFakeServer(): FakeServer {
  const stored = new Map<string, StoredOp>()
  const bySeq: StoredOp[] = []
  let householdSeq = 0
  const pushOverrides: QueuedOverride[] = []
  const pullOverrides: QueuedOverride[] = []
  const rejections = new Map<string, string>()

  function realPush(ops: readonly OpEnvelope[]): PushBody {
    type Slot =
      | { kind: 'rejected'; op_id: string; code: string }
      | { kind: 'duplicate'; op_id: string; seq: number }
      | { kind: 'repeat'; op_id: string; offset: number }
      | { kind: 'pending'; op: OpEnvelope; offset: number }

    const offsetInBatch = new Map<string, number>()
    let newCount = 0
    const slots: Slot[] = ops.map((op) => {
      const code = rejections.get(op.id)
      if (code !== undefined) {
        rejections.delete(op.id)
        return { kind: 'rejected', op_id: op.id, code }
      }
      const existing = stored.get(op.id)
      if (existing !== undefined) {
        return { kind: 'duplicate', op_id: op.id, seq: existing.seq }
      }
      const earlier = offsetInBatch.get(op.id)
      if (earlier !== undefined) {
        return { kind: 'repeat', op_id: op.id, offset: earlier }
      }
      const offset = newCount++
      offsetInBatch.set(op.id, offset)
      return { kind: 'pending', op, offset }
    })

    const base = householdSeq
    householdSeq = base + newCount

    for (const slot of slots) {
      if (slot.kind !== 'pending') continue
      const seq = base + 1 + slot.offset
      const record: StoredOp = {
        ...slot.op,
        seq,
        received_at: new Date().toISOString(),
      }
      stored.set(slot.op.id, record)
      bySeq.push(record)
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

    return { results, household_seq: householdSeq }
  }

  function realPull(since: number, limit: number): PullBody {
    const beyond = bySeq.filter((op) => op.seq > since)
    const has_more = beyond.length > limit
    const page = beyond.slice(0, limit)
    return {
      ops: page,
      cursor: page.at(-1)?.seq ?? since,
      has_more,
      household_seq: householdSeq,
    }
  }

  return {
    push(ops) {
      const override = pushOverrides.shift()
      if (override?.kind === 'error') return overrideResult(override)
      if (override?.kind === 'lost') {
        realPush(ops)
        return { ok: false, status: 0, code: 'network' }
      }
      return { ok: true, body: realPush(ops) }
    },

    pull(since, limit) {
      const override = pullOverrides.shift()
      if (override?.kind === 'error') return overrideResult(override)
      if (override?.kind === 'lost') {
        realPull(since, limit)
        return { ok: false, status: 0, code: 'network' }
      }
      return { ok: true, body: realPull(since, limit) }
    },

    queueError(method, error) {
      const overrides = method === 'push' ? pushOverrides : pullOverrides
      overrides.push({ kind: 'error', ...error })
    },

    queueLostResponse(method) {
      const overrides = method === 'push' ? pushOverrides : pullOverrides
      overrides.push({ kind: 'lost' })
    },

    queueRejection(opId, code) {
      rejections.set(opId, code)
    },
  }
}

/**
 * A {@link Transport} backed by {@link createFakeServer}'s in-memory server,
 * so Tier 2 exercises the real protocol shape rather than a hand-waved one.
 * Accepts an existing {@link FakeServer} so a test can drive it (queue
 * errors, inspect its store) independently of the transport wrapping it.
 */
export function fakeTransport(
  server: FakeServer = createFakeServer(),
): Transport & { server: FakeServer } {
  return {
    server,
    push: (ops) => Promise.resolve(server.push(ops)),
    pull: (since, limit) => Promise.resolve(server.pull(since, limit)),
  }
}
