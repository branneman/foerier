import { formatHlc, type OpEnvelope } from '@foerier/shared'
import { describe, expect, it } from 'vitest'

import { createHttpTransport, fakeTransport, type Fetch } from './transport'

/**
 * The transport is the one place `fetch` is called for `/sync`
 * (`docs/sync-protocol.md` §6). Tests 1–5 exercise `createHttpTransport`
 * against an injected fake `fetch` — never `vi.fn()`, never a patched global
 * (`docs/testing.md`) — proving the header, and the §6.3 error mapping. Test
 * 6 exercises `fakeTransport`'s in-memory server directly, proving it assigns
 * seqs the way `api/src/sync/service.ts` does, since Task 18's outbox tests
 * are only as good as this fidelity.
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

    expect(result).toEqual({ ok: false, status: 401, code: 'unauthorized' })
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

    expect(result).toEqual({
      ok: false,
      status: 413,
      code: 'payload_too_large',
    })
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

    expect(result).toEqual({ ok: false, status: 0, code: 'network' })
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
})
