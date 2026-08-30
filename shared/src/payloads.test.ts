import { describe, expect, it } from 'vitest'

import {
  readBoolean,
  readCount,
  readOpen,
  readOwner,
  readResidence,
  readSource,
  readString,
} from './payloads.ts'

describe('the absent / null / value distinction', () => {
  it('reports an absent key as absent — the register keeps what it had', () => {
    expect(readString({}, 'name')).toEqual({ kind: 'absent' })
  })

  it('reports an explicit null as null — a clear is a write like any other', () => {
    expect(readString({ name: null }, 'name')).toEqual({ kind: 'null' })
  })

  it('reports a value as a value', () => {
    expect(readString({ name: 'Tent' }, 'name')).toEqual({
      kind: 'value',
      value: 'Tent',
    })
  })

  it('treats an unreadable value as absent, never coercing it', () => {
    expect(readString({ name: 42 }, 'name')).toEqual({ kind: 'absent' })
    expect(readCount({ count: -1 }, 'count')).toEqual({ kind: 'absent' })
    expect(readCount({ count: 1.5 }, 'count')).toEqual({ kind: 'absent' })
    expect(readCount({ count: '3' }, 'count')).toEqual({ kind: 'absent' })
    expect(readBoolean({ container: 'yes' }, 'container')).toEqual({
      kind: 'absent',
    })
  })

  it('does not read up the prototype chain', () => {
    expect(readString({}, 'toString')).toEqual({ kind: 'absent' })
  })
})

describe('readOpen', () => {
  it('keeps an unfamiliar enum member verbatim', () => {
    expect(readOpen({ kind: 'rented' }, 'kind')).toEqual({
      kind: 'value',
      value: 'rented',
    })
  })
})

describe('readResidence', () => {
  it('reads the three shapes of sync-protocol §4', () => {
    expect(readResidence({ r: { in: 'loose' } }, 'r')).toEqual({
      kind: 'value',
      value: { in: 'loose' },
    })
    expect(readResidence({ r: { in: 'place', id: 'p1' } }, 'r')).toEqual({
      kind: 'value',
      value: { in: 'place', id: 'p1' },
    })
    expect(readResidence({ r: { in: 'gear', id: 'g1' } }, 'r')).toEqual({
      kind: 'value',
      value: { in: 'gear', id: 'g1' },
    })
  })

  it('ignores an unknown `in`, a missing id, and a non-object', () => {
    expect(readResidence({ r: { in: 'van', id: 'v' } }, 'r')).toEqual({
      kind: 'absent',
    })
    expect(readResidence({ r: { in: 'place' } }, 'r')).toEqual({
      kind: 'absent',
    })
    expect(readResidence({ r: 'loose' }, 'r')).toEqual({ kind: 'absent' })
    expect(readResidence({ r: ['loose'] }, 'r')).toEqual({ kind: 'absent' })
  })

  it('drops an unknown extra key but keeps the residence', () => {
    expect(
      readResidence({ r: { in: 'place', id: 'p1', slot: 'left top' } }, 'r'),
    ).toEqual({
      kind: 'value',
      value: { in: 'place', id: 'p1' },
    })
  })
})

describe('readOwner', () => {
  it("maps the wire's person_id onto state's personId", () => {
    expect(readOwner({ o: { type: 'shared' } }, 'o')).toEqual({
      kind: 'value',
      value: { type: 'shared' },
    })
    expect(readOwner({ o: { type: 'person', person_id: 'x' } }, 'o')).toEqual({
      kind: 'value',
      value: { type: 'person', personId: 'x' },
    })
  })

  it('ignores a person owner with no person_id', () => {
    expect(readOwner({ o: { type: 'person' } }, 'o')).toEqual({
      kind: 'absent',
    })
  })
})

describe('readSource', () => {
  it('reads the two shapes of sync-protocol §4.4', () => {
    expect(readSource({ s: { from: 'depot', gear_id: 'g1' } }, 's')).toEqual({
      kind: 'value',
      value: { from: 'depot', gearId: 'g1' },
    })
    expect(
      readSource(
        { s: { from: 'trip_only', name: 'Passports', container: true } },
        's',
      ),
    ).toEqual({
      kind: 'value',
      value: { from: 'trip_only', name: 'Passports', container: true },
    })
  })

  it('keeps an explicit null name on a trip-only source', () => {
    expect(
      readSource(
        { s: { from: 'trip_only', name: null, container: false } },
        's',
      ),
    ).toEqual({
      kind: 'value',
      value: { from: 'trip_only', name: null, container: false },
    })
  })

  it('ignores an unrecognised from, a non-object, an array, and null', () => {
    expect(
      readSource({ s: { from: 'elsewhere', gear_id: 'g1' } }, 's'),
    ).toEqual({ kind: 'absent' })
    expect(readSource({ s: 'depot' }, 's')).toEqual({ kind: 'absent' })
    expect(readSource({ s: ['depot'] }, 's')).toEqual({ kind: 'absent' })
    // An explicit null is a clear, not a malformed value (obligation 5) — the
    // one outcome this reader does not collapse into `absent`.
    expect(readSource({ s: null }, 's')).toEqual({ kind: 'null' })
  })

  it('ignores a depot source with a missing, non-string, or empty gear_id', () => {
    expect(readSource({ s: { from: 'depot' } }, 's')).toEqual({
      kind: 'absent',
    })
    expect(readSource({ s: { from: 'depot', gear_id: 7 } }, 's')).toEqual({
      kind: 'absent',
    })
    expect(readSource({ s: { from: 'depot', gear_id: '' } }, 's')).toEqual({
      kind: 'absent',
    })
  })

  it('ignores a trip-only source with a non-boolean container', () => {
    expect(
      readSource(
        { s: { from: 'trip_only', name: 'x', container: 'yes' } },
        's',
      ),
    ).toEqual({ kind: 'absent' })
  })
})
