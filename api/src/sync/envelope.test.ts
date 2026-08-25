import { describe, expect, it } from 'vitest'

import type { OpEnvelope } from '@foerier/shared'

import { validateOp } from './envelope.ts'

/**
 * Fixtures straight out of `docs/sync-protocol.md` §1's worked example, so a
 * failing test points at the spec rather than at an arbitrary UUID this file
 * invented.
 */
const HOUSEHOLD_ID = '3f2b0c1a-9d44-4f5e-8b7a-1c2d3e4f5061'
const OTHER_HOUSEHOLD_ID = '11111111-2222-4333-8444-555555555555'
const OP_ID = '0198f2a1-c4ea-7c31-9b02-6f1a4d3e88b0'
const AGGREGATE_ID = '0198e0b7-2a11-7f4c-93de-5a6b7c8d9e0f'
const DEVICE_ID = '0198c33d-77aa-7e10-a4bb-0c9d8e7f6a5b'

/** A fresh, well-formed envelope every call — nothing shared to mutate. */
function baseOp(): OpEnvelope {
  return {
    id: OP_ID,
    household_id: HOUSEHOLD_ID,
    aggregate: 'trip',
    aggregate_id: AGGREGATE_ID,
    type: 'trip.entry_status_set',
    hlc: '2026-08-24T10:03:11.442Z-0007',
    device_id: DEVICE_ID,
    payload: {
      entry_id: '0198e0b8-1c02-7a55-b1d4-2e3f4a5b6c7d',
      status: 'packed',
    },
  }
}

describe('validateOp', () => {
  it('accepts a well-formed op', () => {
    const op = baseOp()
    const result = validateOp(op, HOUSEHOLD_ID)

    expect(result.ok).toBe(true)
    // Identity, not a rebuilt copy — the validator hands back what it was given.
    if (result.ok) expect(result.op).toBe(op)
  })

  it('rejects a missing or non-string id as op_id_invalid', () => {
    const { id: _id, ...withoutId } = baseOp()
    expect(validateOp(withoutId, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'op_id_invalid',
    })

    const withNumericId = { ...baseOp(), id: 12345 }
    expect(validateOp(withNumericId, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'op_id_invalid',
    })
  })

  it('rejects a UUIDv4 as op_id_invalid', () => {
    // The catalogue says UUIDv7 (`id`'s idempotency guarantee relies on the
    // time-ordering); a v4 is a well-formed UUID but the wrong version.
    const op = { ...baseOp(), id: crypto.randomUUID() }
    expect(op.id[14]).toBe('4')

    expect(validateOp(op, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'op_id_invalid',
    })
  })

  it('rejects an hlc that does not match the §2.2 grammar as hlc_invalid', () => {
    const op = { ...baseOp(), hlc: '2026-08-24T10:03:11.442+02:00-0007' }
    expect(validateOp(op, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'hlc_invalid',
    })
  })

  it('rejects an hlc with the right shape but an impossible date as hlc_invalid', () => {
    // Shape-valid per the regex — four digits, two digits, two digits — but
    // month 13 does not exist.
    const op = { ...baseOp(), hlc: '2026-13-01T10:03:11.442Z-0007' }
    expect(validateOp(op, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'hlc_invalid',
    })
  })

  it("rejects a household_id that is not the token's as household_mismatch", () => {
    const op = { ...baseOp(), household_id: OTHER_HOUSEHOLD_ID }
    expect(validateOp(op, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'household_mismatch',
    })
  })

  it('never rewrites a mismatched household_id', () => {
    const op = { ...baseOp(), household_id: OTHER_HOUSEHOLD_ID }
    validateOp(op, HOUSEHOLD_ID)

    // Silence would hide a client bug indistinguishable from an attack
    // (auth-design.md §9.3) — the input must come through untouched, not
    // silently corrected to the token's household.
    expect(op.household_id).toBe(OTHER_HOUSEHOLD_ID)
  })

  it('rejects a missing aggregate, aggregate_id, type or device_id as envelope_invalid', () => {
    for (const field of [
      'aggregate',
      'aggregate_id',
      'type',
      'device_id',
    ] as const) {
      const op = baseOp()
      delete (op as unknown as Record<string, unknown>)[field]
      expect(validateOp(op, HOUSEHOLD_ID)).toEqual({
        ok: false,
        code: 'envelope_invalid',
      })
    }
  })

  it('rejects an absent payload and a null payload as envelope_invalid', () => {
    const { payload: _payload, ...withoutPayload } = baseOp()
    expect(Object.hasOwn(withoutPayload, 'payload')).toBe(false)
    expect(validateOp(withoutPayload, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'envelope_invalid',
    })

    const withNullPayload = { ...baseOp(), payload: null }
    expect(validateOp(withNullPayload, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'envelope_invalid',
    })
  })

  it('accepts an empty payload object', () => {
    const op = { ...baseOp(), payload: {} }
    expect(validateOp(op, HOUSEHOLD_ID)).toEqual({ ok: true, op })
  })

  it('rejects a seq or received_at sent on push as envelope_invalid', () => {
    const withSeq = { ...baseOp(), seq: 4471 }
    expect(validateOp(withSeq, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'envelope_invalid',
    })

    const withReceivedAt = {
      ...baseOp(),
      received_at: '2026-08-24T10:03:12.881Z',
    }
    expect(validateOp(withReceivedAt, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'envelope_invalid',
    })
  })

  it('rejects an op over 16 KB serialised as op_too_large', () => {
    // 'é' is one UTF-16 code unit (string length 1) but two UTF-8 bytes.
    // 10,000 of them is a ~10.3K-character JSON document — comfortably under
    // MAX_OP_BYTES if measured in characters — but its real byte length is
    // over 20K. A validator that measured .length instead of bytes would
    // wrongly accept this op.
    const note = 'é'.repeat(10_000)
    const op = { ...baseOp(), payload: { note } }
    const charLength = JSON.stringify(op).length
    const byteLength = Buffer.byteLength(JSON.stringify(op), 'utf8')
    expect(charLength).toBeLessThan(16 * 1024)
    expect(byteLength).toBeGreaterThan(16 * 1024)

    expect(validateOp(op, HOUSEHOLD_ID)).toEqual({
      ok: false,
      code: 'op_too_large',
    })
  })

  it('accepts an unknown aggregate and an unknown type — the server has no vocabulary', () => {
    const op = {
      ...baseOp(),
      aggregate: 'spaceship',
      type: 'spaceship.warp_engaged',
    }
    expect(validateOp(op, HOUSEHOLD_ID)).toEqual({ ok: true, op })
  })

  it('preserves unknown envelope fields verbatim', () => {
    const op = { ...baseOp(), future_field: 'from a client newer than us' }
    const result = validateOp(op, HOUSEHOLD_ID)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Identity — the validator does not rebuild the envelope, so an unknown
    // field it never even looks at rides along for free.
    expect(result.op).toBe(op)
    expect(Object.hasOwn(result.op, 'future_field')).toBe(true)
    expect(
      (result.op as unknown as Record<string, unknown>)['future_field'],
    ).toBe('from a client newer than us')
  })
})
