import { MAX_OP_BYTES, parseHlc, type OpEnvelope } from '@foerier/shared'

/**
 * Op envelope validation, exactly `docs/sync-protocol.md` §6.2 and §6.3.
 *
 * **The server validates the envelope and nothing else.** It never inspects
 * `type` beyond storing it, and never inspects `payload` beyond "is a JSON
 * object" — it has no op vocabulary, so it can never be out of date about
 * one. An unknown `aggregate` and an unknown `type` are accepted.
 *
 * The rejection set is closed at exactly five codes (§6.3); nothing here may
 * add a sixth.
 */
export type RejectionCode =
  | 'envelope_invalid'
  | 'op_id_invalid'
  | 'hlc_invalid'
  | 'household_mismatch'
  | 'op_too_large'

export type Validated =
  { ok: true; op: OpEnvelope } | { ok: false; code: RejectionCode }

/**
 * UUIDv7: version nibble `7`, variant nibble `8`/`9`/`a`/`b`, and lowercase
 * only — §1 requires "lowercase canonical hyphenated form". A well-formed
 * UUIDv4 fails this on the version nibble alone.
 */
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isUuidV7(s: string): boolean {
  return UUID_V7_PATTERN.test(s)
}

/**
 * Any-version canonical lowercase UUID shape. `household_id`, `aggregate_id`
 * and `device_id` are all typed as plain UUID in §1.1 — v7 is specified only
 * for `id` — so any of them may carry whatever version the minting slice
 * used. Used only for the *shape* check; `household_id`'s equality against
 * the token's household is a separate concern (`household_mismatch`, not
 * `envelope_invalid`).
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function isUuid(s: string): boolean {
  return UUID_PATTERN.test(s)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** The required string fields other than `id`, which gets its own code. */
const REQUIRED_STRING_FIELDS = [
  'household_id',
  'aggregate',
  'aggregate_id',
  'type',
  'hlc',
  'device_id',
] as const

/**
 * Validates one op off the wire against §1.1's envelope and §1.4's size
 * bound, without ever inspecting `type` or `payload`'s contents. Never
 * throws: a malformed `raw` is a rejection, not an exception.
 */
export function validateOp(raw: unknown, householdId: string): Validated {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'envelope_invalid' }
  }

  // `seq` and `received_at` are the server's to assign; a client sending
  // either is a malformed push, not a value to silently ignore (§6.1).
  if (Object.hasOwn(raw, 'seq') || Object.hasOwn(raw, 'received_at')) {
    return { ok: false, code: 'envelope_invalid' }
  }

  // `id` gets its own rejection code regardless of whether it is missing,
  // the wrong type, or simply not a UUIDv7 (§6.3).
  const id = raw['id']
  if (typeof id !== 'string' || !isUuidV7(id)) {
    return { ok: false, code: 'op_id_invalid' }
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(raw[field])) {
      return { ok: false, code: 'envelope_invalid' }
    }
  }

  // `household_id`'s *shape* is an envelope concern — a malformed value is
  // "malformed" per §6.3's envelope_invalid row, full stop. Equality against
  // the token's household is a separate, later check: `household_mismatch`
  // exists to surface a client bug indistinguishable from an attack
  // (auth-design.md §9.3), and folding a shape error into that code would
  // pollute the signal an operator watches for tenancy violations.
  if (!isUuid(raw['household_id'] as string)) {
    return { ok: false, code: 'envelope_invalid' }
  }

  // `aggregate_id` and `device_id` are shape-checked here rather than left
  // to the database for a reason that only shows up downstream: both
  // columns are Postgres `uuid` (task 11's migration, `api/migrations/
  // 0003_op.ts`). A non-empty-but-non-UUID value like `"abc"` would pass a
  // bare string check, reach the INSERT, and throw — turning what should be
  // a per-op `envelope_invalid` rejection into a batch-level 5xx. Under
  // §6.3 a client answers 5xx with indefinite retry, so that single
  // malformed op would wedge the entire outbox behind it forever — exactly
  // the failure §6.1's per-op response exists to prevent.
  if (
    !isUuid(raw['aggregate_id'] as string) ||
    !isUuid(raw['device_id'] as string)
  ) {
    return { ok: false, code: 'envelope_invalid' }
  }

  // `payload` may be `{}` — present but empty — never absent, never `null`
  // (§1.1, §1.3).
  if (!isPlainObject(raw['payload'])) {
    return { ok: false, code: 'envelope_invalid' }
  }

  // §6.3 defines `hlc_invalid` as failing §2.2's *grammar*, not calendar
  // validity. A day-of-month overflow (e.g. `2026-02-30…`, which JS `Date`
  // silently rolls forward to `2026-03-02`) matches the grammar and parses,
  // so it is accepted here rather than rejected — deliberately, not an
  // oversight. No legitimate client can emit one: `formatHlc` always builds
  // the string from `new Date(ms).toISOString()`, which is always a real
  // date. A rolled-over date is also harmless where it matters: the HLC is
  // compared as a plain string, so it still sorts consistently into the
  // total order, and an out-of-range date normally lands outside the
  // 5-minute drift bound, where the merge rule already applies the op
  // without adopting the peer's clock (§2.6). Rejecting it would be
  // stricter than the contract for no gain, at the cost of a user's work.
  // A genuinely unparseable date (e.g. month 13) still fails and returns
  // `hlc_invalid`.
  if (parseHlc(raw['hlc'] as string) === null) {
    return { ok: false, code: 'hlc_invalid' }
  }

  // Rejected outright, never rewritten: silence would hide a client bug
  // indistinguishable from an attack (auth-design.md §9.3).
  if (raw['household_id'] !== householdId) {
    return { ok: false, code: 'household_mismatch' }
  }

  // Bytes, not characters — a multi-byte character makes the two differ.
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_OP_BYTES) {
    return { ok: false, code: 'op_too_large' }
  }

  // Handed back exactly as given, not rebuilt: ops mirror the wire and are
  // never transformed, which is what keeps an unknown field verbatim.
  return { ok: true, op: raw as unknown as OpEnvelope }
}
