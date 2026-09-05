import { authorOp, type OpAuthor, type OpSpec } from '../src/authoring.ts'
import type { IdSource } from '../src/boundaries.ts'
import { createHlcClock } from '../src/hlc.ts'
import type { OpEnvelope } from '../src/ops.ts'
import { applyOp, emptyState } from '../src/reduce.ts'
import type { HouseholdState } from '../src/state.ts'
import type { FakeClock } from './index.ts'

/**
 * A real in-memory client, for the convergence tier (`docs/testing.md`
 * Tier 2). Not a mock and not a stand-in: a real {@link createHlcClock} over a
 * fake wall clock, a real op log, and the real reducer. Only the transport is
 * fake — `receive` is the whole of it — because this tier proves the algebra,
 * not the wiring.
 *
 * What it deliberately mirrors from the app's own log:
 *
 * - **Dedupe by `op.id` before folding** (`sync-protocol.md` §8.3). Relaying
 *   an op twice, and pull handing a device back its own ops (§6.4), must both
 *   be no-ops — including in the *identity* of the state object, which is what
 *   keeps a memo downstream from being invalidated for nothing.
 * - **`hlc.receive` on every op received**, duplicate or not (§2.5). It is a
 *   clock event, not a log event, so it happens before the dedupe check.
 * - **Optimistic local apply on `emit`**, so a replica's state is the fold of
 *   its own log at every moment, not only after a round trip.
 */
export interface Replica {
  readonly deviceId: string
  emit(spec: OpSpec): OpEnvelope
  receive(ops: readonly OpEnvelope[]): void
  log(): readonly OpEnvelope[]
  state(): HouseholdState
}

/**
 * Module-global, so no two replicas can ever mint the same op id however they
 * are constructed — the device prefix keeps a failing assertion readable, but
 * the counter is what guarantees uniqueness. Uniqueness matters here in a way
 * ordering does not: `id` is the dedupe key at every layer, and nothing in
 * the fold ever reads it.
 */
let mintedOps = 0

function opIdsFor(deviceId: string): IdSource {
  const prefix = deviceId.slice(0, 8)
  return {
    next: () => {
      const suffix = (mintedOps++).toString(16).padStart(12, '0')
      return `${prefix}-0000-7000-8000-${suffix}`
    },
  }
}

export function createReplica(opts: {
  deviceId: string
  householdId: string
  clock: FakeClock
}): Replica {
  const author: OpAuthor = {
    household_id: opts.householdId,
    device_id: opts.deviceId,
    ids: opIdsFor(opts.deviceId),
    hlc: createHlcClock(opts.clock),
  }

  const entries: OpEnvelope[] = []
  const seen = new Set<string>()
  let state = emptyState()

  const record = (op: OpEnvelope): void => {
    seen.add(op.id)
    entries.push(op)
    state = applyOp(state, op)
  }

  return {
    deviceId: opts.deviceId,

    emit(spec) {
      const op = authorOp(author, spec)
      record(op)
      return op
    },

    receive(ops) {
      for (const op of ops) {
        // A received op advances the clock whether or not it is new (§2.5):
        // it is evidence about the peer's time either way.
        author.hlc.receive(op.hlc)
        if (seen.has(op.id)) continue
        record(op)
      }
    },

    // A copy: a caller holding the live array would watch its own snapshot
    // change under it mid-`exchange`, which is exactly the aliasing bug a
    // convergence test can least afford.
    log: () => [...entries],

    state: () => state,
  }
}

/**
 * One full round of the fake transport: each replica receives every op the
 * other holds and it does not. Both logs are read **before** either delivery,
 * so this is a genuine exchange of the two divergent states rather than a
 * relay of one replica's freshly-merged log back to the other.
 */
export function exchange(a: Replica, b: Replica): void {
  const fromA = a.log()
  const fromB = b.log()
  a.receive(fromB)
  b.receive(fromA)
}
