/**
 * The operation envelope, exactly as specified in `docs/sync-protocol.md` §1.
 *
 * These types mirror the **wire format byte for byte**, snake_case included,
 * and are never transformed on their way in or out. That is deliberate:
 * §1.2 obliges a reader to *retain unknown fields verbatim* while ignoring
 * them for the fold, and every camelCase mapping layer is a place that
 * obligation can quietly break. The `/sync` envelope is the one interface in
 * foerier that must stay forward-compatible forever, so it is the one place
 * that gets to be un-idiomatic.
 *
 * Folded state, selectors, and UI props are ordinary camelCase TypeScript.
 */

/** The four aggregates ops are scoped to (`sync-protocol.md` §1.1). */
export type Aggregate = 'gear' | 'place' | 'person' | 'trip'

/**
 * An aggregate tag as it arrives off the wire.
 *
 * Deliberately widened past {@link Aggregate}: a reader must **retain and
 * ignore** an unknown aggregate rather than reject the op
 * (`sync-protocol.md` §5.3). A closed union here would make a tolerant reader
 * impossible to write without casting, so the tolerance lives in the type.
 */
export type AggregateTag = Aggregate | (string & {})

/**
 * An op as authored by a device and pushed to the server.
 *
 * `type` is `<aggregate>.<verb>` and is **opaque to the server** — it is never
 * an enum, in TypeScript or in Postgres, because that would make the server's
 * op vocabulary a deploy-order dependency (`sync-protocol.md` §6.2).
 */
export interface OpEnvelope {
  /** UUIDv7, generated on the authoring device. The idempotency key at every layer. */
  id: string
  /** Tenant scope. Must equal the household the bearer token resolves to. */
  household_id: string
  aggregate: AggregateTag
  /** The aggregate **root**'s id; entities inside it are addressed in the payload. */
  aggregate_id: string
  type: string
  /** The Hybrid Logical Clock at authoring time (`sync-protocol.md` §2). */
  hlc: string
  /** The authoring Device. Provenance, and the LWW tiebreak. */
  device_id: string
  /** May be `{}` — present but empty — never absent, never `null`. */
  payload: Record<string, unknown>
}

/**
 * An op as the server returns it on pull: the authored envelope plus the two
 * fields the server adds on storage and never accepts on push.
 */
export interface StoredOp extends OpEnvelope {
  /** Server-assigned, monotonic per household, gapless. The pull cursor's unit. */
  seq: number
  /** RFC 3339 UTC. **Diagnostic only** — never used for ordering or merge. */
  received_at: string
}

/** Maximum serialised size of a single op, in bytes (`sync-protocol.md` §1.4). */
export const MAX_OP_BYTES = 16 * 1024

/** Maximum ops in one push batch (`sync-protocol.md` §1.4, §6.1). */
export const MAX_BATCH_OPS = 500

/** Maximum serialised size of one push batch, in bytes (`sync-protocol.md` §1.4). */
export const MAX_BATCH_BYTES = 1024 * 1024
