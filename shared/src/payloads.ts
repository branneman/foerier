import type { EntrySource, Owner, Residence } from './state.ts'

/**
 * The **tolerant** half of the reader (`docs/sync-protocol.md` §5.3). Its
 * counterpart is `authoring.ts`, which is strict: foerier is strict about what
 * it emits and liberal in what it accepts, on the one interface that must stay
 * forward-compatible forever.
 *
 * Every payload field the reducer touches comes through here, and nothing
 * comes through a cast. A field this cannot read is reported `absent`, which
 * means the register is left exactly as it was — never coerced, never
 * defaulted, and never a reason to reject the op.
 *
 * ## Why three outcomes and not two
 *
 * Obligation 5: **absent is not null.** A field not addressed by an op leaves
 * its register alone; a field explicitly `null` *cleared* it, and that is a
 * write like any other. Collapsing the two silently destroys data. No op in
 * S2's catalogue is nullable — which is exactly why the distinction is built
 * and fixtured now, before `trip.dates_set` comes to depend on it.
 *
 * A malformed value reports `absent` rather than a fourth outcome: for the
 * fold the two carry the same instruction, and the op is retained verbatim in
 * the log either way, so nothing is lost.
 */
export type Read<T> =
  { kind: 'absent' } | { kind: 'null' } | { kind: 'value'; value: T }

const ABSENT: Read<never> = { kind: 'absent' }
const NULL: Read<never> = { kind: 'null' }

function raw(p: Record<string, unknown>, key: string): Read<unknown> {
  // `hasOwn`, not `in`: a payload is parsed JSON, and reading up the prototype
  // chain would let a key like `toString` masquerade as a field.
  if (!Object.hasOwn(p, key)) return ABSENT
  const value = p[key]
  if (value === null) return NULL
  return { kind: 'value', value }
}

function refine<T>(
  p: Record<string, unknown>,
  key: string,
  parse: (value: unknown) => T | undefined,
): Read<T> {
  const r = raw(p, key)
  if (r.kind !== 'value') return r
  const parsed = parse(r.value)
  return parsed === undefined ? ABSENT : { kind: 'value', value: parsed }
}

export function readString(
  p: Record<string, unknown>,
  key: string,
): Read<string> {
  return refine(p, key, (v) => (typeof v === 'string' ? v : undefined))
}

/** Any string. An unknown enum member is a value, not an error (obligation 4). */
export const readOpen = readString

export function readBoolean(
  p: Record<string, unknown>,
  key: string,
): Read<boolean> {
  return refine(p, key, (v) => (typeof v === 'boolean' ? v : undefined))
}

/** `int ≥ 0` throughout the catalogue. */
export function readCount(
  p: Record<string, unknown>,
  key: string,
): Read<number> {
  return refine(p, key, (v) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined,
  )
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function readResidence(
  p: Record<string, unknown>,
  key: string,
): Read<Residence> {
  return refine(p, key, (v) => {
    if (!isRecord(v)) return undefined
    if (v['in'] === 'loose') return { in: 'loose' }
    if (v['in'] === 'place' || v['in'] === 'gear') {
      const id = v['id']
      return typeof id === 'string' ? { in: v['in'], id } : undefined
    }
    return undefined
  })
}

export function readOwner(
  p: Record<string, unknown>,
  key: string,
): Read<Owner> {
  return refine(p, key, (v) => {
    if (!isRecord(v)) return undefined
    if (v['type'] === 'shared') return { type: 'shared' }
    if (v['type'] === 'person') {
      // The wire is snake_case, state is camelCase, and this is one of the two
      // places the reducer boundary performs that mapping.
      const personId = v['person_id']
      return typeof personId === 'string'
        ? { type: 'person', personId }
        : undefined
    }
    return undefined
  })
}

/**
 * Reads an Entry's `source` ([sync §4.4](../../docs/sync-protocol.md)).
 *
 * The wire's `gear_id` becomes `gearId`, the same split `readOwner` already
 * has over `person_id`. An unrecognised `from`, a depot source with no
 * `gear_id`, or a trip-only source with a non-boolean `container` all read
 * `absent`: the op still folds and the Entry is still created, it simply
 * carries no source. Never rejected — §5.3's tolerant reader is absolute.
 */
export function readSource(
  p: Record<string, unknown>,
  key: string,
): Read<EntrySource> {
  return refine(p, key, (v) => {
    if (!isRecord(v)) return undefined
    if (v['from'] === 'depot') {
      const gearId = v['gear_id']
      return typeof gearId === 'string' && gearId !== ''
        ? { from: 'depot', gearId }
        : undefined
    }
    if (v['from'] === 'trip_only') {
      const name = v['name']
      const container = v['container']
      if (typeof container !== 'boolean') return undefined
      if (name !== null && typeof name !== 'string') return undefined
      return { from: 'trip_only', name, container }
    }
    return undefined
  })
}
