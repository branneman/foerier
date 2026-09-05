import { formatHlc, type OpEnvelope } from '@foerier/shared'
import { describe, expect, it } from 'vitest'

import { createHttpTransport, fakeTransport, type Fetch } from './transport'

/**
 * The transport is the one place `fetch` is called for `/sync`
 * (`docs/sync-protocol.md` §6). The `createHttpTransport` suite exercises it
 * against an injected fake `fetch` — never `vi.fn()`, never a patched global
 * (`docs/testing.md`) — proving the header, and the §6.3 error mapping. The
 * `fakeTransport` suite exercises the in-memory server directly, proving it
 * assigns seqs the way `api/src/sync/service.ts` does, since Task 18's
 * outbox tests are only as good as this fidelity.
 *
 * Absence of an optional field (`retryAfter`, `seq`) is asserted with
 * `Object.hasOwn`, never left to `toEqual` alone: `toEqual` ignores a
 * property explicitly set to `undefined`, so it cannot distinguish a truly
 * absent key from one holding `undefined` — exactly the distinction
 * `exactOptionalPropertyTypes`'s "conditional spread, never assigned
 * `undefined`" discipline exists to protect.
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

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
  })
}

describe('createHttpTransport', () => {
  it('sends the bearer token on push and on pull', async () => {
    const seen: (string | null)[] = []
    const doFetch: Fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen.push(new Headers(init?.headers).get('authorization'))
      return jsonResponse({ results: [], household_seq: 0 })
    }) as Fetch

    const transport = createHttpTransport({
      baseUrl: 'https://api.example/api/v1',
      token: () => 'tok-123',
      fetch: doFetch,
    })

    await transport.push([])
    await transport.pull(0, 10)

    expect(seen).toEqual(['Bearer tok-123', 'Bearer tok-123'])
  })

  it('maps a 401 to unauthorized', async () => {
    const doFetch: Fetch = (async () =>
      jsonResponse(
        { error: { code: 'unauthorized', message: 'no token', detail: {} } },
        { status: 401 },
      )) as Fetch

    const transport = createHttpTransport({
      baseUrl: 'https://api.example/api/v1',
      token: () => null,
      fetch: doFetch,
    })

    const result = await transport.push([anOp()])

    if (result.ok) throw new Error('expected push to fail')
    expect(result.status).toBe(401)
    expect(result.code).toBe('unauthorized')
    expect(Object.hasOwn(result, 'retryAfter')).toBe(false)
  })

  it('maps a 413 to payload_too_large', async () => {
    const doFetch: Fetch = (async () =>
      jsonResponse(
        {
          error: {
            code: 'payload_too_large',
            message: 'too big',
            detail: {},
          },
        },
        { status: 413 },
      )) as Fetch

    const transport = createHttpTransport({
      baseUrl: 'https://api.example/api/v1',
      token: () => 'tok',
      fetch: doFetch,
    })

    const result = await transport.push([anOp()])

    if (result.ok) throw new Error('expected push to fail')
    expect(result.status).toBe(413)
    expect(result.code).toBe('payload_too_large')
    expect(Object.hasOwn(result, 'retryAfter')).toBe(false)
  })

  it('reads Retry-After from a 429', async () => {
    const doFetch: Fetch = (async () =>
      jsonResponse(
        { error: { code: 'rate_limited', message: 'slow down', detail: {} } },
        { status: 429, headers: { 'Retry-After': '30' } },
      )) as Fetch

    const transport = createHttpTransport({
      baseUrl: 'https://api.example/api/v1',
      token: () => 'tok',
      fetch: doFetch,
    })

    const result = await transport.push([anOp()])

    expect(result).toEqual({
      ok: false,
      status: 429,
      code: 'rate_limited',
      retryAfter: 30,
    })
  })

  it('maps a network throw to the 5xx class', async () => {
    const doFetch: Fetch = (() =>
      Promise.reject(new TypeError('fetch failed'))) as Fetch

    const transport = createHttpTransport({
      baseUrl: 'https://api.example/api/v1',
      token: () => 'tok',
      fetch: doFetch,
    })

    const result = await transport.pull(0, 500)

    if (result.ok) throw new Error('expected pull to fail')
    expect(result.status).toBe(0)
    expect(result.code).toBe('network')
    expect(Object.hasOwn(result, 'retryAfter')).toBe(false)
  })
})

describe('fakeTransport', () => {
  it('the fake assigns gapless seqs and returns duplicates with their original seq', async () => {
    const transport = fakeTransport()
    const opA = anOp()
    const opB = anOp()

    const first = await transport.push([opA, opB])
    if (!first.ok) throw new Error('expected push to succeed')
    expect(first.body.results).toEqual([
      { op_id: opA.id, status: 'accepted', seq: 1 },
      { op_id: opB.id, status: 'accepted', seq: 2 },
    ])
    expect(first.body.household_seq).toBe(2)

    const opC = anOp()
    const second = await transport.push([opA, opC])
    if (!second.ok) throw new Error('expected push to succeed')
    expect(second.body.results).toEqual([
      { op_id: opA.id, status: 'duplicate', seq: 1 },
      { op_id: opC.id, status: 'accepted', seq: 3 },
    ])
    expect(second.body.household_seq).toBe(3)
  })

  it('rejects a queued op without assigning it a seq or advancing household_seq', async () => {
    const transport = fakeTransport()
    const op = anOp()
    transport.server.queueRejection(op.id, 'household_mismatch')

    const result = await transport.push([op])

    if (!result.ok) throw new Error('expected push to succeed')
    expect(result.body.results).toHaveLength(1)
    const outcome = result.body.results[0]!
    expect(outcome.op_id).toBe(op.id)
    expect(outcome.status).toBe('rejected')
    expect(outcome.code).toBe('household_mismatch')
    expect(Object.hasOwn(outcome, 'seq')).toBe(false)
    expect(result.body.household_seq).toBe(0)
  })

  it('queues an error for one method without consuming it on a call to the other', async () => {
    const transport = fakeTransport()
    transport.server.queueError('pull', {
      status: 429,
      code: 'rate_limited',
      retryAfter: 5,
    })

    const pushResult = await transport.push([anOp()])
    expect(pushResult.ok).toBe(true)

    const pullResult = await transport.pull(0, 10)
    expect(pullResult).toEqual({
      ok: false,
      status: 429,
      code: 'rate_limited',
      retryAfter: 5,
    })
  })
})
