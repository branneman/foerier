import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'

import { MAX_BATCH_BYTES, MAX_BATCH_OPS } from '@foerier/shared'

import type { AuthVariables } from '../auth/middleware.ts'
import type { RateLimiter } from '../auth/rateLimiter.ts'
import { SyncError, type SyncService } from './service.ts'

/**
 * `POST /sync/push` and `GET /sync/pull` — exactly `docs/sync-protocol.md`
 * §6.1 and §6.4.
 *
 * **The tenancy rule the whole sell-later story rests on:** `householdId`
 * comes only from `c.get('auth')`, set by `requireAuth`, and *never* from the
 * body, the query string, or a header (`auth-design.md` §9.3).
 */
export interface SyncRoutesDeps {
  service: SyncService
  requireAuth: MiddlewareHandler<{ Variables: AuthVariables }>
  limiter: RateLimiter
}

type Vars = { Variables: AuthVariables }

type BatchErrorCode =
  'bad_request' | 'payload_too_large' | 'rate_limited' | 'server_error'

/** §6.3's one shape for every batch-level failure. */
function batchError(
  c: Context<Vars>,
  status: 400 | 413 | 429 | 500,
  code: BatchErrorCode,
  message: string,
) {
  return c.json({ error: { code, message, detail: {} } }, status)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A `SyncError` and a driver failure both become the same `server_error` to
 * the client — §6.3 has no code for either, and its per-op set is closed —
 * but they are logged distinctly, which is the whole point of `SyncError`
 * existing as its own type: a `SyncError` in the log means an invariant
 * `sync/service.ts` owns was violated and the batch was refused
 * deliberately, not that Postgres is unreachable.
 */
function serverError(c: Context<Vars>, error: unknown) {
  if (error instanceof SyncError) {
    console.error(`sync push refused: ${error.reason}: ${error.message}`)
  } else {
    console.error('sync push failed:', error)
  }
  return batchError(c, 500, 'server_error', 'Something went wrong.')
}

export function createSyncRoutes({
  service,
  requireAuth,
  limiter,
}: SyncRoutesDeps) {
  const sync = new Hono<Vars>()

  sync.use('*', requireAuth)

  // `/sync/*` gets its own bucket, much higher than `/auth/*`'s, and keyed by
  // Device rather than by IP: every caller here is already authenticated, so
  // there is no enumeration risk to guard against, only the box's own
  // capacity — and a household's devices can share one NAT'd IP, which IP
  // keying would needlessly conflate. Sized generously because a returning
  // offline client legitimately bursts after a long disconnection (§6.3).
  sync.use('*', async (c, next) => {
    const { deviceId } = c.get('auth')
    if (!limiter.take(deviceId)) {
      return batchError(c, 429, 'rate_limited', 'Too many requests.')
    }
    await next()
    return undefined
  })

  sync.post('/push', async (c) => {
    // Measured on the raw bytes, before parsing: a parsed array cannot say
    // what the request weighed on the wire (§1.4, §6.1).
    const buf = await c.req.arrayBuffer()
    if (buf.byteLength > MAX_BATCH_BYTES) {
      return batchError(
        c,
        413,
        'payload_too_large',
        'Batch exceeds 1 MB. Halve it and retry.',
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(buf))
    } catch {
      return batchError(c, 400, 'bad_request', 'Body is not valid JSON.')
    }

    if (!isPlainObject(parsed)) {
      return batchError(c, 400, 'bad_request', 'Body must be a JSON object.')
    }
    const ops = parsed['ops']
    if (!Array.isArray(ops)) {
      return batchError(c, 400, 'bad_request', 'Body must be { ops: [...] }.')
    }

    // Taken deliberately over 400 (§6.3): its documented client response is
    // "halve the batch and retry", which is self-healing, while 400's is to
    // dead-letter. A client that miscounts its own chunking should not cost
    // a quartermaster their work.
    if (ops.length > MAX_BATCH_OPS) {
      return batchError(
        c,
        413,
        'payload_too_large',
        'Batch exceeds 500 ops. Halve it and retry.',
      )
    }

    const { householdId } = c.get('auth')

    try {
      const result = await service.push(householdId, ops)
      return c.json(result)
    } catch (error) {
      return serverError(c, error)
    }
  })

  sync.get('/pull', async (c) => {
    const { householdId } = c.get('auth')

    const sinceParam = c.req.query('since')
    const since = sinceParam === undefined ? 0 : Number(sinceParam)
    if (!Number.isFinite(since) || since < 0) {
      return batchError(
        c,
        400,
        'bad_request',
        'since must be a non-negative integer.',
      )
    }

    const limitParam = c.req.query('limit')
    const limit = limitParam === undefined ? undefined : Number(limitParam)

    try {
      const result = await service.pull(householdId, since, limit)
      return c.json(result)
    } catch (error) {
      return serverError(c, error)
    }
  })

  return sync
}
